import sys
import uvicorn
import os
import warnings

# Force UTF-8 output on Windows to prevent UnicodeEncodeError from box-drawing
# characters (──, ━━, etc.) in print statements when the console uses cp1252.
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if sys.stderr.encoding and sys.stderr.encoding.lower() != "utf-8":
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# Suppress Pydantic shadowing warnings from libraries (like google-genai)
warnings.filterwarnings("ignore", category=UserWarning, module="pydantic")
import io
import re
import time
import base64
import jwt  # pyjwt
import httpx
import json
import openai as openai_lib
import anthropic
import uuid
from datetime import datetime
import asyncio
import random
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from fastapi import FastAPI, HTTPException, BackgroundTasks, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any, Union, Set
from dotenv import load_dotenv

# --- AUTH AND DATABASE IMPORTS ---
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, and_
from database.db import get_db, init_db, SessionLocal, promote_admin_email
from database.models import User, Session as DBSession, Image as DBImage, CompareSession as DBCompareSession, CompareImage as DBCompareImage, UpscaledImage as DBUpscaledImage, GeminiTelemetryEvent
from database.storyboard_models import Storyboard, StoryboardCharacter, StoryboardFrame, StoryboardProduct, CharacterSheet
from utils.auth_middleware import get_current_user, get_optional_user
from utils.moderation import check_prompt_keywords, check_image_moderation, check_text_moderation
from routes.users import router as users_router
# ---------------------------------

# Import Google GenAI
from google import genai
from google.genai import types
from PIL import Image

# Load environment variables — override=True ensures .env always wins over stale shell exports
load_dotenv(override=True)
PROJECT_ID    = os.environ.get("GCP_PROJECT_ID")       # Vertex AI Primary
PROJECT_ID_2  = os.environ.get("GCP_PROJECT_ID_2")     # Vertex AI Secondary (Load balancing / 429 failover)
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")       # Google AI Studio (preferred)
KLING_API_KEY  = os.environ.get("KLING_API_KEY")
KLING_API_SECRET = os.environ.get("KLING_API_SECRET")
KLING_BASE_URL = "https://api.klingai.com"
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")
anthropic_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY) if ANTHROPIC_API_KEY else None
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
BFL_API_KEY    = os.environ.get("BFL_API_KEY")

# ── GLOBAL GEMINI CLIENTS (MULTI-PROJECT POOL & CIRCUIT BREAKER) ──────────────
# Supports multi-project Vertex AI round-robin, circuit-breaker health routing, and 429 quota failover.
VERTEX_PROJECT_IDS = [p for p in [PROJECT_ID, PROJECT_ID_2] if p]
global_clients: List[genai.Client] = []
flash_clients: List[genai.Client] = []
PROJECT_CLIENT_TO_ID: Dict[genai.Client, str] = {}
_PROJECT_COOLDOWN: Dict[str, float] = {}  # pid -> monotonic timestamp when cooldown expires
_PROJECT_COOLDOWN_LOCK = asyncio.Lock()
_vertex_client_idx = 0
_vertex_client_lock = asyncio.Lock()

if VERTEX_PROJECT_IDS:
    print(f"[Gemini] Using Vertex AI across projects: {VERTEX_PROJECT_IDS}")
    for pid in VERTEX_PROJECT_IDS:
        try:
            g_c = genai.Client(vertexai=True, project=pid, location="global")
            f_c = genai.Client(vertexai=True, project=pid, location="us-central1")
            global_clients.append(g_c)
            flash_clients.append(f_c)
            PROJECT_CLIENT_TO_ID[g_c] = pid
            PROJECT_CLIENT_TO_ID[f_c] = pid
            _PROJECT_COOLDOWN[pid] = 0.0
            print(f"[Gemini] -> Initialized Vertex AI client for project: {pid}")
        except Exception as e:
            print(f"[Gemini] -> Failed initializing client for {pid}: {e}")

    global_client = global_clients[0] if global_clients else None
    flash_client  = flash_clients[0] if flash_clients else None
elif GEMINI_API_KEY:
    print("[Gemini] Using Google AI Studio key (GEMINI_API_KEY) - Note: Free tier blocks image generation")
    global_client = genai.Client(api_key=GEMINI_API_KEY)
    flash_client  = genai.Client(api_key=GEMINI_API_KEY)
    global_clients = [global_client]
    flash_clients  = [flash_client]
else:
    global_client = None
    flash_client  = None
    global_clients = []
    flash_clients = []

async def get_ordered_vertex_clients() -> List[genai.Client]:
    """
    Returns Vertex AI clients prioritized by circuit-breaker health state,
    rotated via round-robin among healthy projects so traffic balances evenly.
    Any project currently on 429 cooldown is deprioritized to the tail of the list.
    """
    global _vertex_client_idx
    if not global_clients:
        return []
    if len(global_clients) == 1:
        return list(global_clients)

    now = time.monotonic()
    async with _PROJECT_COOLDOWN_LOCK:
        healthy = []
        cooling = []
        for c in global_clients:
            pid = PROJECT_CLIENT_TO_ID.get(c, "")
            cooldown_until = _PROJECT_COOLDOWN.get(pid, 0.0)
            if now >= cooldown_until:
                healthy.append(c)
            else:
                cooling.append((cooldown_until, c))

        # Sort cooling clients by soonest cooldown expiration
        cooling.sort(key=lambda x: x[0])
        cooling_clients = [c for _, c in cooling]

        if healthy:
            async with _vertex_client_lock:
                idx = _vertex_client_idx % len(healthy)
                _vertex_client_idx += 1
                ordered_healthy = healthy[idx:] + healthy[:idx]
            return ordered_healthy + cooling_clients
        else:
            return cooling_clients

# Concurrency throttle for Gemini Image Generation API to prevent GCP 429 burst capacity exhaustion.
# Kept strictly at 2 concurrent in-flight requests to respect Google's gateway concurrency cap.
_GEMINI_IMAGE_SEMAPHORE = asyncio.Semaphore(2)

# ── ASYNC TOKEN BUCKET RATE LIMITER & DISPATCH PACER ─────────────────────────
class AsyncTokenBucket:
    """
    Asynchronous Token Bucket rate limiter to smooth outbound requests to Vertex AI.
    Prevents burst capacity exhaustion by pacing requests below the combined RPM threshold
    while allowing initial micro-bursts of up to `capacity` requests.
    """
    def __init__(self, capacity: float = 2.0, refill_rate_per_sec: float = 0.25):
        self.capacity = capacity
        self.refill_rate = refill_rate_per_sec  # 0.25 = 1 token per 4.0s = 15 RPM
        self.tokens = capacity
        self.last_update = time.monotonic()
        self.lock = asyncio.Lock()
        self.last_dispatch = 0.0
        self.min_interval = 0.40  # 400ms microsecond socket spacing

    async def acquire(self):
        async with self.lock:
            while True:
                now = time.monotonic()
                elapsed = now - self.last_update
                self.tokens = min(self.capacity, self.tokens + elapsed * self.refill_rate)
                self.last_update = now

                since_last = now - self.last_dispatch
                if since_last < self.min_interval:
                    await asyncio.sleep(self.min_interval - since_last)
                    now = time.monotonic()

                if self.tokens >= 1.0:
                    self.tokens -= 1.0
                    self.last_dispatch = time.monotonic()
                    return

                deficit = 1.0 - self.tokens
                wait_time = deficit / self.refill_rate
                await asyncio.sleep(min(wait_time, 2.0))

_DISPATCH_TOKEN_BUCKET = AsyncTokenBucket(capacity=2.0, refill_rate_per_sec=0.25)

async def _pace_dispatch():
    await _DISPATCH_TOKEN_BUCKET.acquire()

def _format_user_friendly_error(error_input: Any) -> str:
    """Sanitize raw GCP/OpenAI/Flux exceptions and error strings into clean, user-friendly messages."""
    if not error_input:
        return "An unexpected error occurred. Please try again."
    raw = str(error_input).strip()
    raw_lower = raw.lower()

    if any(k in raw_lower for k in ["429", "resource_exhausted", "quota", "too many requests", "rate limit", "rate_limit"]):
        return "High server demand: AI model capacity temporarily reached. Please wait a few moments and try again."
    if any(k in raw_lower for k in ["safety", "prohibited", "blocked", "policy", "inappropriate", "flagged", "violat"]):
        return "Prompt blocked: The request violates safety or content guidelines. Please adjust your prompt."
    if any(k in raw_lower for k in ["timeout", "timed out", "deadlineexceeded", "504", "gateway timeout"]):
        return "Generation timed out. The upstream AI server was slow to respond. Please try again."
    if any(k in raw_lower for k in ["503", "unavailable", "server is busy", "overloaded", "high demand"]):
        return "AI service is temporarily unavailable due to high demand. Please try again shortly."
    if any(k in raw_lower for k in ["cancelled", "canceled by user"]):
        return "Generation cancelled."
    if "not found" in raw_lower:
        return "Requested resource not found."

    # If it's a lengthy technical RPC / Python stack / JSON error, provide a clean summary
    if len(raw) > 120 or "{" in raw or "google.rpc" in raw or "Traceback" in raw:
        return "AI generation failed due to a temporary upstream error. Please try again."
    return raw

# ── TELEMETRY GLOBALS (zero-cost hot-path tracking) ──────────────────────────
# These are simple in-memory primitives — never cause DB round trips in the
# generation path.  The actual telemetry rows are written as background tasks.
import collections
_gemini_active_count: int = 0          # In-flight Gemini calls right now
_gemini_active_lock = asyncio.Lock()   # Protects _gemini_active_count mutations
# Sliding window of UTC timestamps (float) of every Gemini dispatch in the
# last 60 seconds.  Used to compute burst_velocity_10s without any DB.
_gemini_dispatch_times: collections.deque = collections.deque(maxlen=500)
_gemini_dispatch_lock = asyncio.Lock()  # Protects _gemini_dispatch_times

async def _telemetry_increment() -> int:
    """Increment the active Gemini call counter. Returns concurrency BEFORE increment."""
    global _gemini_active_count
    async with _gemini_active_lock:
        snapshot = _gemini_active_count
        _gemini_active_count += 1
        return snapshot

async def _telemetry_decrement():
    """Decrement the active Gemini call counter."""
    global _gemini_active_count
    async with _gemini_active_lock:
        _gemini_active_count = max(0, _gemini_active_count - 1)

async def _telemetry_record_dispatch() -> tuple:
    """Record a dispatch timestamp. Returns (concurrency_at_dispatch, burst_velocity_10s)."""
    now = time.monotonic()
    concurrency = await _telemetry_increment()
    async with _gemini_dispatch_lock:
        _gemini_dispatch_times.append(now)
        # Count dispatches in the last 10 seconds (burst velocity)
        cutoff = now - 10.0
        burst = sum(1 for t in _gemini_dispatch_times if t >= cutoff)
    return concurrency, burst

def _write_telemetry_bg(
    model_used: str,
    pipeline_type: Optional[str],
    is_image_to_image: bool,
    aspect_ratio: str,
    latency_ms: int,
    status: str,
    error_code: Optional[str],
    concurrency_at_dispatch: int,
    burst_velocity_10s: int,
    retry_attempt: int = 0,
    backoff_delay_ms: Optional[int] = None,
    recovery_time_ms: Optional[int] = None,
    request_source: str = "STUDIO",
):
    """Write a single telemetry row in a fire-and-forget manner.
    
    Uses its own short-lived DB session — completely isolated from any
    request session.  Called via asyncio.create_task or BackgroundTasks.
    """
    try:
        db = SessionLocal()
        try:
            event = GeminiTelemetryEvent(
                model_used=model_used,
                pipeline_type=pipeline_type,
                is_image_to_image=is_image_to_image,
                aspect_ratio=aspect_ratio,
                latency_ms=latency_ms,
                status=status,
                error_code=error_code[:100] if error_code else None,
                concurrency_at_dispatch=concurrency_at_dispatch,
                burst_velocity_10s=burst_velocity_10s,
                retry_attempt=retry_attempt,
                backoff_delay_ms=backoff_delay_ms,
                recovery_time_ms=recovery_time_ms,
                request_source=request_source,
            )
            db.add(event)
            db.commit()
        except Exception as e:
            db.rollback()
            print(f"[Telemetry] Write failed (non-fatal): {e}")
        finally:
            db.close()
    except Exception:
        pass  # Never crash the server over telemetry

# Global trackers for forceful session cancellation
CANCELLED_SESSIONS: Set[str] = set()
RUNNING_SESSION_TASKS: Dict[str, asyncio.Task] = {}

# Simple in-memory cache for prompt sanitization (+ prompt: target prompt)
SANITIZATION_CACHE: Dict[str, str] = {}

# ── NANOBANANA CONFIGURATION SYSTEM ──────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
NANOBANANA_CONFIG_PATH = os.path.join(BASE_DIR, "data", "nanobanana_config.json")

def load_nanobanana_config() -> Dict[str, Any]:
    default_config = {
        "production": {
            "model": "gemini-3.1-flash-image",
            "temperature": 0.4
        },
        "beta": {
            "model": "gemini-3.1-flash-image",
            "temperature": 0.4
        }
    }
    try:
        data_dir = os.path.dirname(NANOBANANA_CONFIG_PATH)
        if not os.path.exists(data_dir):
            os.makedirs(data_dir, exist_ok=True)
        if os.path.exists(NANOBANANA_CONFIG_PATH):
            with open(NANOBANANA_CONFIG_PATH, "r") as f:
                return json.load(f)
        else:
            with open(NANOBANANA_CONFIG_PATH, "w") as f:
                json.dump(default_config, f, indent=2)
            return default_config
    except Exception as e:
        print(f"[Config] Error loading nanobanana config, returning defaults: {e}")
        return default_config

def save_nanobanana_config(config: Dict[str, Any]) -> bool:
    try:
        data_dir = os.path.dirname(NANOBANANA_CONFIG_PATH)
        if not os.path.exists(data_dir):
            os.makedirs(data_dir, exist_ok=True)
        with open(NANOBANANA_CONFIG_PATH, "w") as f:
            json.dump(config, f, indent=2)
        return True
    except Exception as e:
        print(f"[Config] Error saving nanobanana config: {e}")
        return False

# ── SMART UPSCALE DETECTION ───────────────────────────────────────────────────
# Detects when a user's edit prompt is asking for quality enhancement rather than
# a scene change, and replaces their raw text with a professionally engineered
# enhancement prompt that works for ANY image content type.

UPSCALE_KEYWORDS = [
    "high res", "highres", "hi res", "hires", "hi-res", "high-res",
    "hd", "4k", "8k", "upscale", "enhance", "sharpen",
    "improve quality", "better quality", "higher resolution",
    "clearer", "make it sharp", "increase resolution",
    "high definition", "higher quality", "more detail",
    "more detailed", "ultra quality", "max quality",
    "boost quality", "increase quality", "upgrade quality",
]

def _is_upscale_intent(edit_prompt: str) -> bool:
    """Detect if the user's edit prompt is asking for quality enhancement."""
    prompt_lower = edit_prompt.lower().strip()
    return any(kw in prompt_lower for kw in UPSCALE_KEYWORDS)

ENHANCE_REFINE_KEYWORDS = [
    "enhance and refine", "refine the existing image", "enhance the existing image",
    "keep the composition", "keep composition", "composition unchanged", "composition 100% unchanged",
    "do not redesign", "do not replace", "do not remove", "do not rearrange",
    "improve the anatomical accuracy", "improve anatomy", "anatomical accuracy",
    "refine anatomy", "enhance only", "retouch", "professionally retouched",
    "do not change composition", "do not change camera angle", "keep the image composition",
    "only upgrade the anatomy", "upgrading the anatomy", "high-quality fine detailing",
    "do not change framing", "no extra limbs", "no malformed hands", "no distorted faces",
    "correct any awkward anatomy", "naturally proportioned",
    "recreate the same composition", "recreate the same", "same proportion and angle",
    "match the color tone", "match the color tone and lighting", "same visual mood",
    "same framing", "same poses", "same pose", "same environment", "same camera perspective",
    "overall visual mood", "recreate the composition", "same lighting and color tone",
]

def _is_enhance_refine_intent(prompt: str) -> bool:
    """Detect if the prompt is asking to enhance/refine an existing/uploaded image with zero composition/theme changes."""
    if not prompt:
        return False
    prompt_lower = prompt.lower()
    return any(kw in prompt_lower for kw in ENHANCE_REFINE_KEYWORDS)

def _build_studio_enhance_refine_prompt(user_prompt: str = "", vision_desc: Optional[str] = None) -> str:
    """Builds a high-precision, zero-hallucination preservation and refinement prompt for image models."""
    return (
        "[TASK]: Surgical fidelity enhancement and micro-detail refinement of the uploaded reference image.\n"
        "[PRESERVATION MANDATE]: Lock and freeze 100% of the original composition, framing, camera angle, perspective, character placement, layout, colors, lighting atmosphere, and the exact artistic medium (whether illustration, concept art, painting, 3D render, or photo). Do NOT redesign, replace, add, or remove any objects, characters, or text.\n"
        "[REFINEMENT DIRECTIVE]: Upgrade anatomical coherence (correct hands, fingers, limbs, facial proportions), enhance sub-pixel surface textures (fabrics, metals, vegetation, architectural surfaces), sharpen edge clarity, and refine lighting fidelity while strictly maintaining the original artwork's identity, medium, and storytelling."
    )

STYLIZED_KEYWORDS = [
    "anime", "illustration", "cartoon", "3d render", "vector", "painting", 
    "sketch", "drawing", "watercolor", "graphic design", "logo", "icon", 
    "comic", "manga", "pixel art", "oil painting", "acrylic", "charcoal",
    "digital art", "concept art", "cel shaded", "flat design", "2d", "animated"
]

def _is_stylized_intent(prompt: str) -> bool:
    """Detect if the user is explicitly requesting a non-photorealistic artistic style."""
    prompt_lower = prompt.lower().strip()
    return any(kw in prompt_lower for kw in STYLIZED_KEYWORDS)

def _build_smart_upscale_prompt(original_prompt: str, is_beta: bool = True) -> str:
    """Build a universal enhancement prompt that reuses the same quality pipeline
    as regular generation, plus a strict preservation guard for image-to-image edits."""
    return (
        f"Enhance the natural detail of this exact image using Nanobanana 2's "
        f"organic texture rendering. "
        f"CRITICAL PRESERVATION: Keep the EXACT same composition, subjects, pose, "
        f"expression, framing, colors, lighting, and atmosphere. Change absolutely "
        f"nothing about the scene. "
        f"ENHANCE ONLY: natural film grain structure, authentic surface textures, "
        f"subtle micro-detail consistent with real camera optics, natural skin "
        f"finish if present, soft environmental depth. "
        f"DO NOT: over-sharpen, add artificial clarity, smooth surfaces, increase "
        f"saturation, or alter any element of the scene. "
        f"Treat this like developing a film negative — reveal only what was "
        f"already there. Original scene context: {original_prompt}"
    )


class ContentBlockedError(Exception):
    """Raised when a model blocks the prompt due to content policy.
    Caught by model orchestrators to trigger the prompt sanitizer middleman."""
    pass

app = FastAPI(title="Genfy Studio API")

cors_origins = [
    "http://genfyy.in",
    "https://genfyy.in",
    "http://www.genfyy.in",
    "https://www.genfyy.in",
    "http://localhost:3000",
    "http://localhost:3005",
    "http://localhost:3001",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3005",
    "http://genfy-frontend:3001",
]

frontend_env_url = os.getenv("FRONTEND_URL")
if frontend_env_url and frontend_env_url not in cors_origins:
    cors_origins.append(frontend_env_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:[0-9]+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_security_headers_and_https_redirect(request: Request, call_next):
    # 1. Reverse-Proxy HTTP -> HTTPS Redirect (Production mode)
    x_forwarded_proto = request.headers.get("x-forwarded-proto", "").lower()
    is_prod_env = os.getenv("ENVIRONMENT", "").lower() == "production" or os.getenv("BACKEND_URL", "").startswith("https://") or "genfyy.in" in os.getenv("BACKEND_URL", "")

    if x_forwarded_proto == "http" and is_prod_env:
        url = request.url.replace(scheme="https")
        return RedirectResponse(url, status_code=301)

    response = await call_next(request)

    # 2. HSTS Header (1 year, subdomains, preload) in Production
    if is_prod_env:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload"

    # 3. OWASP Hardening Security Headers (All Environments)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

    return response

# Include Auth Router
from routes.auth import router as auth_router
from routes.history import router as history_router
from routes.storyboard import router as storyboard_router
from routes.assets import router as assets_router
from fastapi.staticfiles import StaticFiles
def _is_local_path(url: str) -> bool:
    return bool(url and (url.startswith("/exports/") or url.startswith("exports/")))

# Keep static mount for backward compat — serves pre-migration /exports/* images.
# Once migration is complete and all DB URLs point to Supabase, this can be removed.
app.mount("/exports", StaticFiles(directory="exports"), name="exports")

app.include_router(auth_router)
app.include_router(users_router)
app.include_router(history_router)
app.include_router(storyboard_router)
app.include_router(assets_router)

import asyncio
from datetime import timedelta

async def cleanup_old_images_loop():
    # ── Wait 6 hours after startup before the FIRST cleanup run ────────────
    # This prevents images from being deleted the moment docker compose up
    # fires (e.g. after a redeploy, the old images would immediately be
    # candidates for deletion if the retention window had lapsed).
    print("[Cleanup] First run scheduled in 6 hours. Existing images are safe.")
    await asyncio.sleep(60 * 60 * 6)  # 6-hour initial grace period
    while True:
        try:
            print("[Cleanup] Running 30-day image cleanup check...")
            now = datetime.utcnow()
            cutoff = now - timedelta(days=30)
            cutoff_iso = cutoff.isoformat() + "Z"
            
            db = SessionLocal()
            exempt_filenames = set()
            try:
                # Get all users who are exempt from auto deletion
                exempt_users = db.query(User.id).filter(User.no_auto_delete == True).all()
                exempt_user_ids = [u[0] for u in exempt_users]
                
                # 1. Delete DBImage records older than 3 days (excluding exempt users)
                query = db.query(DBImage).filter(DBImage.created_at < cutoff_iso)
                if exempt_user_ids:
                    query = query.filter(DBImage.user_id.notin_(exempt_user_ids))
                old_images = query.all()
                
                if old_images:
                    print(f"[Cleanup] Found {len(old_images)} images older than 30 days to delete. Deleting DB records...")
                    for img in old_images:
                        db.delete(img)
                    db.commit()
                
                # Gather filenames of exempt users' images to protect their physical files
                if exempt_user_ids:
                    urls1 = db.query(DBImage.url).filter(DBImage.user_id.in_(exempt_user_ids), DBImage.url != None).all()
                    urls2 = db.query(DBCompareImage.url).filter(DBCompareImage.user_id.in_(exempt_user_ids), DBCompareImage.url != None).all()
                    urls3 = db.query(DBUpscaledImage.url).filter(DBUpscaledImage.user_id.in_(exempt_user_ids), DBUpscaledImage.url != None).all()
                    
                    for r in urls1 + urls2 + urls3:
                        if r[0]:
                            exempt_filenames.add(os.path.basename(r[0]))
            except Exception as e:
                print(f"[Cleanup] DB Error: {e}")
            finally:
                db.close()
            
            # 2. Delete physical files older than 30 days in exports/generated
            gen_dir = os.path.join("exports", "generated")
            if os.path.exists(gen_dir):
                for filename in os.listdir(gen_dir):
                    filepath = os.path.join(gen_dir, filename)
                    if os.path.isfile(filepath):
                        # If the file belongs to an exempt user, protect it
                        if filename in exempt_filenames:
                            continue
                        # Get file modification time
                        mtime = os.path.getmtime(filepath)
                        file_time = datetime.utcfromtimestamp(mtime)
                        if file_time < cutoff:
                            try:
                                os.remove(filepath)
                                print(f"[Cleanup] Deleted old physical file: {filename}")
                            except Exception as e:
                                print(f"[Cleanup] Failed to delete file {filename}: {e}")
            
        except Exception as e:
            print(f"[Cleanup] Loop Error: {e}")
            
        # Run every 24 hours (30-day retention doesn't need frequent checks)
        await asyncio.sleep(60 * 60 * 24)

# Initialize database
@app.on_event("startup")
async def startup_event():
    init_db()
    promote_admin_email()
    os.makedirs(os.path.join("exports", "generated"), exist_ok=True)
    asyncio.create_task(cleanup_old_images_loop())
    # ── Auto-migration: add enhanced_prompt column to images table if missing ──
    # Uses SQLAlchemy engine so it works on both local SQLite and server PostgreSQL.
    # Idempotent — safe to run on every startup.
    try:
        from database.db import engine as _engine, DATABASE_URL as _DB_URL
        from sqlalchemy import text as _text, inspect as _inspect
        with _engine.connect() as _conn:
            _inspector = _inspect(_engine)
            _cols = [c["name"] for c in _inspector.get_columns("images")]
            if "enhanced_prompt" not in _cols:
                _conn.execute(_text("ALTER TABLE images ADD COLUMN enhanced_prompt TEXT"))
                _conn.commit()
                print("[Migration] Added enhanced_prompt column to images table.")
            else:
                print("[Migration] enhanced_prompt column already exists — skipping.")
    except Exception as _mig_err:
        print(f"[Migration] Could not run auto-migration: {_mig_err}")


@app.get("/health")
async def health_check():
    """Health check endpoint for Docker and load balancers."""
    return {"status": "ok"}


def _utcnow() -> datetime:
    return datetime.utcnow()


def _trial_is_active(user: User) -> bool:
    if not getattr(user, "is_trial", False) or not getattr(user, "trial_ends_at", None):
        return False
    return _utcnow() < user.trial_ends_at


def _generation_access_error(user: User) -> Optional[HTTPException]:
    if not user.email_verified:
        return HTTPException(status_code=403, detail="Please verify your email first.")
    # Revoked access
    if not getattr(user, 'is_active', True):
        return HTTPException(status_code=403, detail="Your account access has been revoked. Please contact support.")
    if _trial_is_active(user):
        return None
    if user.plan_type != "not_selected":
        return None
    return HTTPException(status_code=402, detail="Please select a plan to continue.")


def _check_weekly_image_quota(user: User, db: Session) -> Optional[HTTPException]:
    """Returns 429 error if user has hit their weekly image generation limit."""
    if user.role == 'admin':
        return None
    limit = getattr(user, 'images_limit_per_week', 50) or 50
    week_ago = datetime.utcnow() - timedelta(days=7)
    count = (
        db.query(func.count(DBImage.id))
        .join(DBSession, DBImage.session_id == DBSession.id)
        .filter(
            DBSession.user_id == user.id,
            DBImage.status == 'completed',
            DBImage.created_at >= week_ago.isoformat()
        )
        .scalar() or 0
    )
    if count >= limit:
        return HTTPException(
            status_code=429,
            detail=f"Weekly limit reached: you have generated {count}/{limit} images this week. Limit resets in 7 days."
        )
    return None


def _check_daily_upscale_quota(user: User, db: Session) -> Optional[HTTPException]:
    """Returns 429 error if user has hit their daily upscale limit."""
    if user.role == 'admin':
        return None
    limit = getattr(user, 'upscales_limit_per_day', 5) or 5
    day_ago = datetime.utcnow() - timedelta(days=1)
    count = (
        db.query(func.count(DBUpscaledImage.id))
        .filter(
            DBUpscaledImage.user_id == user.id,
            DBUpscaledImage.created_at >= day_ago
        )
        .scalar() or 0
    )
    if count >= limit:
        return HTTPException(
            status_code=429,
            detail=f"Daily upscale limit reached: you have upscaled {count}/{limit} images today."
        )
    return None


def _ensure_session_owner(db: Session, session_id: str, user_id: str) -> None:
    session = db.query(DBSession.id).filter(DBSession.id == session_id, DBSession.user_id == user_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")


def _ensure_compare_session_owner(db: Session, compare_session_id: str, user_id: str) -> None:
    session = db.query(DBCompareSession.id).filter(
        DBCompareSession.id == compare_session_id,
        DBCompareSession.user_id == user_id,
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Compare session not found")


class GenerateRequest(BaseModel):
    prompt: str
    ratio: str
    quality: str
    categories: dict[str, str]
    models: List[str] = Field(default_factory=list)
    image_base64: Optional[str] = None
    chatgpt_model: str = "gpt-image-2"
    session_id: Optional[str] = None
    prompt_history: Optional[List[str]] = None   # Chronological list of past prompts for this image lineage
    vision_description: Optional[str] = None     # Pre-analyzed reference image description from Vision LLM


class RecommendRequest(BaseModel):
    selections: Dict[str, str]
    prompt: Optional[str] = ""

class AnalyzeRequest(BaseModel):
    image_base64: Optional[str] = None
    image_url: Optional[str] = None
    prompt_context: Optional[str] = None
    categories_context: Optional[str] = None


# ── VISION ANALYSIS CONFIG ───────────────────────────────────────────────────
# Model cascade for vision analysis: tries each in order, retrying up to
# MAX_RETRIES_PER_MODEL times with exponential backoff before moving to next.
MAX_RETRIES_PER_MODEL = 3
VISION_MODELS = [
    "gemini-2.5-flash",
]
# Feature Flag: Dual-Reference Texture Anchoring for Studio Edits
ENABLE_DUAL_REFERENCE_EDIT = os.getenv("ENABLE_DUAL_REFERENCE_EDIT", "true").lower() in ("true", "1", "yes")
ROOT_IMAGE_CACHE: Dict[str, str] = {}

class SessionCreateRequest(BaseModel):
    prompt: str
    model_ids: List[str]
    active_configs: dict = Field(default_factory=dict)
    parent_session_id: Optional[str] = None
    reference_image_id: Optional[str] = None
    ratio: str = "1:1"
    quality: str = "Standard"
    image_base64: Optional[Union[str, List[str]]] = None
    original_image_base64: Optional[str] = None   # Root turn-0 image for dual-reference texture anchoring
    edit_depth: int = 1
    vision_description: Optional[str] = None     # Pre-analyzed reference image description from Vision LLM
    edit_instruction: Optional[str] = None        # Raw edit instruction for edit flows (e.g. "make it rain outside")
    prompt_history: Optional[List[str]] = None    # Clean chronological history of edits
    edit_type: Optional[str] = "inpainting"       # "structural" vs "inpainting"

class CompareStartRequest(BaseModel):
    prompt: str
    models: List[str]
    ratio: str = "1:1"
    quality: str = "Standard"
    categories: dict = Field(default_factory=dict)
    image_base64: Optional[Union[str, List[str]]] = None
    chatgpt_model: str = "gpt-image-2"
    session_id: Optional[str] = None
    vision_description: Optional[str] = None     # Pre-analyzed reference image description from Vision LLM

class CompareFeedbackRequest(BaseModel):
    selected_image_id: str

class UpscaleRequest(BaseModel):
    image_id: Optional[str] = None
    image_url: Optional[str] = None

class EditImageRequest(BaseModel):
    edit_prompt: str
    full_prompt_override: Optional[str] = None
    reference_image_id: Optional[str] = None
    config_overrides: Optional[dict[str, str]] = None
    image_base64: Optional[Union[str, List[str]]] = None
    vision_description: Optional[str] = None
    ratio: str = "1:1"
    quality: str = "standard"
    model_ids: Optional[List[str]] = None


# ── MAPPINGS ────────────────────────────────────────────────────────────────

RATIO_MAP = {
    "1:1": "1:1",
    "1:4": "1:4",
    "1:8": "1:8",
    "2:3": "2:3",
    "3:2": "3:2",
    "3:4": "3:4",
    "4:1": "4:1",
    "4:3": "4:3",
    "4:5": "4:5",
    "5:4": "5:4",
    "8:1": "8:1",
    "9:16": "9:16",
    "16:9": "16:9",
    "21:9": "21:9",
}

QUALITY_MAP = {
    "Standard": "1K",
    "High": "2K",
    "Ultra": "4K",
}

# Kling supported ratios
KLING_RATIO_MAP = {
    "1:1": "1:1",
    "1:4": "1:4",
    "1:8": "1:8",
    "2:3": "2:3",
    "3:2": "3:2",
    "3:4": "3:4",
    "4:1": "4:1",
    "4:3": "4:3",
    "4:5": "4:5",
    "5:4": "5:4",
    "8:1": "8:1",
    "9:16": "9:16",
    "16:9": "16:9",
    "21:9": "21:9",
}


# ── KLING HELPERS ────────────────────────────────────────────────────────────

def _kling_jwt() -> str:
    """Generate a short-lived JWT for Kling API authentication."""
    now = int(time.time())
    payload = {
        "iss": KLING_API_KEY,
        "exp": now + 1800,  # 30 minutes
        "nbf": now - 5,
    }
    token = jwt.encode(payload, KLING_API_SECRET, algorithm="HS256")
    return token


async def _kling_generate(prompt: str, ratio: str, image_b64: Optional[Union[str, List[str]]] = None, quality: str = "Standard") -> List[str]:
    """Call Kling image generation API and poll until done. Returns list of image URLs."""
    if isinstance(image_b64, list):
        image_b64 = image_b64[0] if image_b64 else None

    if not KLING_API_KEY or not KLING_API_SECRET:
        raise HTTPException(status_code=500, detail="KLING_API_KEY / KLING_API_SECRET not set in .env")

    token = _kling_jwt()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    kling_ratio = KLING_RATIO_MAP.get(ratio, "1:1")

    payload: dict = {
        "model_name": "kling-v1",
        "prompt": prompt,
        "aspect_ratio": kling_ratio,
        "n": 1,
    }

    # Add reference image if provided
    if image_b64:
        b64_str = image_b64
        if "," in b64_str:
            b64_str = b64_str.split(",")[1]
        payload["image"] = b64_str

    print(f"[Kling] Submitting generation task. Ratio: {kling_ratio}")

    async with httpx.AsyncClient(timeout=90) as client:
        # Submit the task
        resp = await client.post(
            f"{KLING_BASE_URL}/v1/images/generations",
            json=payload,
            headers=headers,
        )

        print(f"[Kling] Submit response: {resp.status_code} {resp.text[:400]}")

        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Kling API error: {resp.text}")

        data = resp.json()

        # Extract task_id
        task_id = None
        try:
            task_id = data["data"]["task_id"]
        except (KeyError, TypeError):
            # Some versions return data directly as list
            try:
                task_id = data["data"][0]["task_id"]
            except Exception:
                pass

        if not task_id:
            # Maybe images are returned directly (synchronous mode)
            images = _extract_kling_images(data)
            if images:
                return images
            raise HTTPException(status_code=502, detail=f"Kling: no task_id in response: {data}")

        print(f"[Kling] Task ID: {task_id}. Polling for result...")

        # Poll for completion (max 120s)
        for attempt in range(40):
            await _async_sleep(3)

            # Re-generate token if needed (each 30 min expiry, but we're safe here)
            poll_token = _kling_jwt()
            poll_headers = {
                "Authorization": f"Bearer {poll_token}",
                "Content-Type": "application/json",
            }

            poll_resp = await client.get(
                f"{KLING_BASE_URL}/v1/images/generations/{task_id}",
                headers=poll_headers,
            )

            print(f"[Kling] Poll attempt {attempt+1}: {poll_resp.status_code}")

            if poll_resp.status_code != 200:
                continue

            poll_data = poll_resp.json()
            status = ""
            try:
                status = poll_data["data"]["task_status"]
            except (KeyError, TypeError):
                pass

            print(f"[Kling] Task status: {status}")

            if status == "succeed":
                return _extract_kling_images(poll_data)
            elif status == "failed":
                err = poll_data.get("data", {}).get("task_status_msg", "Unknown error")
                raise HTTPException(status_code=502, detail=f"Kling task failed: {err}")
            # else: still processing, keep polling

        raise HTTPException(status_code=504, detail="Kling task timed out after 120 seconds")


def _extract_kling_images(data: dict) -> List[str]:
    """Extract image URLs from Kling API response."""
    urls = []
    try:
        works = data["data"].get("task_result", {}).get("images", [])
        for img in works:
            url = img.get("url") or img.get("image_url")
            if url:
                urls.append(url)
    except Exception:
        pass
    return urls


async def _materialize_image_url(url: Optional[str]) -> Optional[str]:
    """Ensures an image URL is persisted locally.

    - Local /exports/ paths: returned as-is (already stored)
    - External URLs (Flux/Kling/ChatGPT): downloaded -> saved to local disk
    - data: URIs: returned as-is
    """
    if not url:
        return url
    if url.startswith("data:image"):
        return url
    # Already a local path — no action needed
    if _is_local_path(url):
        return url
    if not url.startswith(("http://", "https://")):
        return url

    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            content_type = resp.headers.get("content-type", "image/png").split(";")[0].strip() or "image/png"
            ext = content_type.split("/")[-1] if "/" in content_type else "png"

            local_url = _save_image_to_disk(resp.content, ext)
            return local_url
    except Exception as e:
        print(f"[_materialize_image_url] Failed to download {url[:80]}...: {e}")
        return url


async def _async_sleep(seconds: float):
    """Async-compatible sleep."""
    import asyncio
    await asyncio.sleep(seconds)


def _extract_anthropic_text(resp) -> str:
    """Safely extracts text content from an Anthropic message response,
    skipping ThinkingBlock objects that are present by default on Claude Sonnet 5.
    """
    if hasattr(resp, "content") and isinstance(resp.content, list):
        texts = [b.text for b in resp.content if getattr(b, "type", "") == "text"]
        return "".join(texts).strip()
    return ""


# ── GEMINI HELPER ─────────────────────────────────────────────────────────────

async def _sanitize_prompt(original_prompt: str) -> str:
    """Use gemini-2.5-flash to rewrite a prompt that triggered IMAGE_PROHIBITED_CONTENT.
    Replaces copyrighted characters / real people with generic visual descriptions,
    while preserving scene context and action details.
    """
    if original_prompt in SANITIZATION_CACHE:
        print(f"[Middleman] Using cached sanitized prompt.")
        return SANITIZATION_CACHE[original_prompt]

    print(f"[Middleman] Sanitizing blocked prompt: {original_prompt[:120]}")

    system_instruction = (
        "You are an expert AI prompt safety sanitizer and rewriter for generative image models.\n"
        "The original prompt was blocked by image safety filters (e.g. copyrighted IP, real people, "
        "or sensitive/policy-triggering words such as 'demonic', 'horror', 'violence', or dark themes near children).\n\n"
        "Your task: Rewrite the prompt so it expresses the EXACT SAME scene, subjects, composition, and visual intent, "
        "while eliminating all filter triggers:\n"
        "1. Replace copyrighted characters/IP with generic visual descriptions.\n"
        "2. Replace sensitive/forbidden words (e.g. 'demonic', 'evil', 'bloody') with safe aesthetic descriptors "
        "(e.g. 'sinister stylized gothic grin with sharp angular lines', 'dramatic theatrical shadowy face').\n"
        "3. Maintain all requested actions, colors, subjects, and poses.\n"
        "Output ONLY the final sanitized prompt text, no explanations, no quotes."
    )

    # Vertex AI uses specific model IDs; 'gemini-flash-latest' only works on Google AI Studio
    SANITIZER_MODELS = ["gemini-2.5-flash-lite", "gemini-1.5-flash"]

    # Ensure portrait skin quality is never lost during sanitization
    portrait_skin_guard = (
        "shot on Hasselblad X2D with 90mm f/2.5 portrait lens, Kodak Portra 400 skin tone rendering, "
        "healthy clear skin with authentic natural visible pore micro-detail, subtle epidermal grain, "
        "subsurface light scattering catching light on cheeks, individual eyelash definition, natural iris texture, "
        "tack sharp focus, zero face blur, no plastic airbrushing, no smoothing filters"
    )
    def _ensure_portrait_quality(txt: str) -> str:
        low = txt.lower()
        if any(w in low for w in ["woman", "man", "girl", "boy", "person", "people", "child", "face", "portrait"]):
            if "hasselblad" not in low and "pore" not in low:
                return f"{txt}, {portrait_skin_guard}"
        return txt

    # ── Attempt: Gemini Flash (with Vertex-compatible model names) ──
    gemini_client = flash_client if flash_client else global_client
    if gemini_client:
        for sanitizer_model in SANITIZER_MODELS:
            MAX_SANITIZATION_RETRIES = 2
            for attempt in range(MAX_SANITIZATION_RETRIES):
                try:
                    if attempt > 0:
                        await asyncio.sleep(2 * attempt)
                    response = await gemini_client.aio.models.generate_content(
                        model=sanitizer_model,
                        contents=[f"Rewrite this image generation prompt:\n\n{original_prompt}"],
                        config=types.GenerateContentConfig(
                            system_instruction=system_instruction,
                            temperature=0.4,
                        ),
                    )
                    sanitized = _ensure_portrait_quality(response.text.strip())
                    SANITIZATION_CACHE[original_prompt] = sanitized
                    print(f"[Middleman] [OK] Rewritten via {sanitizer_model}: {sanitized[:200]}")
                    return sanitized
                except Exception as e:
                    err_str = str(e)
                    print(f"[Middleman] {sanitizer_model} attempt {attempt+1} failed: {err_str[:150]}")
                    if "503" in err_str or "high demand" in err_str.lower():
                        continue  # retry same model
                    break  # try next model

    # ── Fallback: Claude Sonnet 5 / GPT-5.6-luna rewrite ──
    if ANTHROPIC_API_KEY:
        try:
            print("[Middleman] Gemini sanitizer unavailable, using Claude Sonnet 5...")
            ant_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
            resp = await asyncio.to_thread(
                ant_client.messages.create,
                model="claude-sonnet-5",
                system=system_instruction,
                messages=[{"role": "user", "content": f"Rewrite this image generation prompt:\n\n{original_prompt}"}],
                max_tokens=600,
            )
            raw_text = _extract_anthropic_text(resp)
            sanitized = _ensure_portrait_quality(raw_text)
            SANITIZATION_CACHE[original_prompt] = sanitized
            print(f"[Middleman] [OK] Rewritten via Claude Sonnet 5: {sanitized[:200]}")
            return sanitized
        except Exception as e_ant:
            print(f"[Middleman] Claude Sonnet 5 fallback failed: {e_ant}")

    if OPENAI_API_KEY:
        try:
            print("[Middleman] Using GPT-5.6-luna fallback...")
            oai_client = openai_lib.OpenAI(api_key=OPENAI_API_KEY)
            resp = await asyncio.to_thread(
                oai_client.chat.completions.create,
                model="gpt-5.6-luna",
                messages=[
                    {"role": "system", "content": system_instruction},
                    {"role": "user", "content": f"Rewrite this image generation prompt:\n\n{original_prompt}"},
                ],
                max_completion_tokens=300,
            )
            sanitized = _ensure_portrait_quality(resp.choices[0].message.content.strip())
            SANITIZATION_CACHE[original_prompt] = sanitized
            print(f"[Middleman] [OK] Rewritten via GPT-5.6-luna: {sanitized[:200]}")
            return sanitized
        except Exception as e:
            print(f"[Middleman] GPT-5.6-luna fallback failed: {e}")

    print(f"[Middleman] All sanitization attempts failed. Using original prompt.")
    return original_prompt


import os
import uuid

def _save_image_to_disk(image_bytes: bytes, ext: str = "png") -> str:
    """Saves raw image bytes directly to local disk (/exports/generated/...)."""
    os.makedirs(os.path.join("exports", "generated"), exist_ok=True)
    filename = f"{uuid.uuid4().hex}.{ext}"
    filepath = os.path.join("exports", "generated", filename)
    with open(filepath, "wb") as f:
        f.write(image_bytes)
    return f"/exports/generated/{filename}"


async def _tile_upscale(base_image_bytes: bytes, prompt: str, ratio: str, gemini_model: str = "gemini-3.1-flash-image", pipeline_type: str = "COMMERCIAL", upscaled_id: Optional[str] = None) -> Optional[str]:
    """Tile-based upscaling: splits a base image into 4 overlapping tiles,
    regenerates each at 4K resolution via Gemini img2img, then stitches
    them together with alpha blending for ~3.6x resolution increase.

    The tile prompt is pipeline-aware: AUTHENTIC tiles preserve candid skin
    texture; PORTRAIT tiles preserve beauty retouching; etc.

    Returns the URL of the final stitched image, or None on failure.
    """
    # ── Pipeline-aware tile prompts (defined OUTSIDE try so they're always available) ──
    _PIPELINE_TILE_HINTS = {
        "AUTHENTIC": (
            "This is a candid real-life photograph. "
            "Enhance resolution and surface detail while STRICTLY preserving the authentic, "
            "unretouched appearance. Keep natural skin pores, healthy youthful skin texture on hands, "
            "subtle real skin imperfections, natural hair strand texture, fabric thread detail. "
            "DO NOT smooth skin. DO NOT add commercial retouching. DO NOT make skin look plastic. "
            "Preserve the exact candid, unpolished, real-world texture of everything you see."
        ),
        "PORTRAIT": (
            "This is a professional beauty portrait. "
            "Enhance resolution and fine detail: individual eyelash separation, iris fiber detail, "
            "hair strand definition at hairline, subtle skin luminosity. "
            "Maintain the refined, elegant portrait complexion — preserve natural delicate skin texture. "
            "Do not add film grain or roughness to skin. Preserve the professional portrait quality."
        ),
        "COMMERCIAL": (
            "This is a commercial photograph. "
            "Enhance resolution and product/subject detail: fabric threads, material textures, "
            "surface sharpness, color accuracy. "
            "If models or people are present, preserve natural organic skin texture with visible pores; do NOT smooth skin or make it look plastic or rubbery. "
            "Maintain the clean commercial look with natural diffuse lighting, avoiding harsh glossy glare."
        ),
        "CINEMATIC": (
            "This is a cinematic film scene. "
            "Enhance resolution while preserving the cinematic color grading, "
            "anamorphic lens characteristics, film grain structure, and atmospheric depth. "
            "Do NOT over-sharpen. Preserve the intentional moody, filmic aesthetic."
        ),
        "FINEART": (
            "This is a digital art or illustration. "
            "Enhance resolution and line detail, color richness, and surface texture of the artwork. "
            "Preserve the exact art style and stylization — do not make it more photorealistic."
        ),
        "NATURE": (
            "This is a nature/landscape photograph. "
            "Enhance resolution and environmental detail: foliage texture, rock surfaces, "
            "atmospheric depth, water detail, cloud formation. "
            "Preserve the natural color science and atmospheric haze. Do not over-saturate."
        ),
    }
    pipeline_hint = _PIPELINE_TILE_HINTS.get(pipeline_type.upper(), _PIPELINE_TILE_HINTS["COMMERCIAL"])
    prompt_ctx = prompt.strip()[:120] if prompt else ""

    try:
        base_img = Image.open(io.BytesIO(base_image_bytes)).convert("RGB")
        orig_w, orig_h = base_img.size

        # Resolve closest supported ratio for Gemini
        _RATIOS = {
            "1:1": 1.0,
            "16:9": 16 / 9,
            "9:16": 9 / 16,
            "4:3": 4 / 3,
            "3:4": 3 / 4,
            "3:2": 3 / 2,
            "2:3": 2 / 3,
            "4:5": 4 / 5,
            "5:4": 5 / 4,
            "21:9": 21 / 9,
        }
        current_geom_ratio = orig_w / float(orig_h)
        matched_ratio = min(_RATIOS.keys(), key=lambda r: abs(_RATIOS[r] - current_geom_ratio))
        resolved_ratio = ratio if ratio in RATIO_MAP else matched_ratio

        print(f"[TileUpscale] Base image: {orig_w}×{orig_h}, ratio={resolved_ratio}, pipeline={pipeline_type}")

        # ── Native Aspect Ratio Quadrant Tiling (Zero Fake Padding) ───────────
        # By preserving the image's native aspect ratio across all 4 quadrants and
        # requesting Gemini in that exact aspect ratio, we eliminate all artificial
        # padding streaks, upside-down mirror artifacts, and macro recentering bugs.
        work_img = base_img

        overlap_pct = 0.10
        half_w = orig_w // 2
        half_h = orig_h // 2
        overlap_w = int(half_w * overlap_pct)
        overlap_h = int(half_h * overlap_pct)

        tiles_coords = [
            (0,                  0,                  half_w + overlap_w, half_h + overlap_h),  # Q1: top-left
            (half_w - overlap_w, 0,                  orig_w,             half_h + overlap_h),  # Q2: top-right
            (0,                  half_h - overlap_h, half_w + overlap_w, orig_h),              # Q3: bottom-left
            (half_w - overlap_w, half_h - overlap_h, orig_w,             orig_h),              # Q4: bottom-right
        ]

        tile_labels = ["top-left", "top-right", "bottom-left", "bottom-right"]

        # ── Photorealism & organic skin texture enhancement for tiles ──
        if pipeline_type.upper() != "FINEART":
            tile_realism_mandate = (
                "BEAUTY SKIN & PHOTOREALISM MANDATE: If human subjects or faces are present, render a refined radiant complexion, "
                "healthy clear skin with authentic natural pore texture, delicate epidermal grain, soft subsurface light scattering, "
                "and a natural luminous finish without digital airbrushing or plastic smoothing. "
                "STRICTLY FORBID plastic skin smoothing, wax doll look, or artificial CGI skin sheen. "
                "Render natural diffuse ambient light without harsh specular blowout, fake glow, or unnatural bounce light. "
                "Preserve individual eyelash separation, natural iris depth, and distinct hair strands at the hairline."
            )
            tile_negative_mandate = (
                "NEGATIVE: duplicate figures, ghosting, motion blur, double exposure, shifted people, phantom bodies, floating heads, "
                "no plastic skin, no airbrushed faces, no CGI appearance, no 3D render look, "
                "no excessive glossy shine, no harsh specular blowout, no artificial lighting halo."
            )
        else:
            tile_realism_mandate = ""
            tile_negative_mandate = "NEGATIVE: duplicate figures, ghosting, motion blur, double exposure."

        # ── Encode master reference image for dual-input spatial anchoring ──
        buf_master = io.BytesIO()
        work_img.save(buf_master, format="PNG")
        master_b64 = base64.b64encode(buf_master.getvalue()).decode("utf-8")

        upscaled_tiles: list[Image.Image] = []

        for idx, (crop_box, label) in enumerate(zip(tiles_coords, tile_labels)):
            if upscaled_id:
                try:
                    db_check = SessionLocal()
                    rec = db_check.query(DBUpscaledImage).filter(DBUpscaledImage.id == upscaled_id).first()
                    db_check.close()
                    if rec and rec.status == "cancelled":
                        print(f"[TileUpscale] Upscale {upscaled_id} was cancelled by user. Terminating processing.")
                        return None
                except Exception as check_err:
                    print(f"[TileUpscale] Check cancellation status failed: {check_err}")

            tile_crop = work_img.crop(crop_box)
            tile_w, tile_h = tile_crop.size
            print(f"[TileUpscale] Tile {idx+1}/4 ({label}): {tile_w}×{tile_h}")

            # Encode tile to base64 for img2img
            buf = io.BytesIO()
            tile_crop.save(buf, format="PNG")
            tile_b64 = base64.b64encode(buf.getvalue()).decode("utf-8")

            # ── Compose spatial anchoring prompt per quadrant ──
            tile_prompt = (
                f"Image 1 is the complete MASTER photograph showing the full scene and composition.\n"
                f"Image 2 is a cropped close-up section of Image 1 ({label} quadrant).\n"
                f"TASK: Upscale Image 2 to extreme 4K resolution with tack-sharp edge definition, rich surface textures, and photorealistic clarity.\n"
                f"{pipeline_hint}\n"
                f"{tile_realism_mandate}\n"
                f"{tile_negative_mandate}\n"
                f"CRITICAL SPATIAL MANDATE: Image 2 is strictly a cropped detail of Image 1. "
                f"Do NOT add heads, people, animals, pets, or subjects that do not exist in Image 2. "
                f"Do NOT reframe, recenter, or complete severed bodies or objects. "
                f"If any person, arm, limb, or subject is cut off by the border of Image 2, DO NOT extend or complete them. "
                f"DO NOT draw missing bodies, heads, or limbs. Keep the boundary cut exactly as framed in Image 2. "
                f"Render zero duplicate or phantom figures.\n"
                f"Preserve the exact crop boundaries, framing, and content of Image 2 matching its placement in Image 1. "
                f"Enhance ONLY resolution, micro-texture, and fine surface details.\n"
                f"Original scene context: {prompt_ctx}"
            )

            # Call Gemini with [master_image, tile_crop] in the quadrant's native aspect ratio
            try:
                tile_urls, _, _ = await _gemini_generate(
                    prompt=tile_prompt,
                    ratio=resolved_ratio,
                    quality="Ultra",  # 4K resolution per tile
                    image_b64=[master_b64, tile_b64],
                    gemini_model=gemini_model,
                    is_tile=True,  # bypass prompt enhancement entirely
                    temperature=0.1,  # Strict pixel and spatial fidelity
                    request_source="UPSCALE",
                )
                if tile_urls:
                    # Load the generated tile from local disk
                    tile_ref = tile_urls[0]
                    tile_path = tile_ref.lstrip("/")
                    if os.path.exists(tile_path):
                        with open(tile_path, "rb") as f:
                            tile_bytes = f.read()
                    elif os.path.exists(os.path.join("backend", tile_path)):
                        with open(os.path.join("backend", tile_path), "rb") as f:
                            tile_bytes = f.read()
                    if tile_bytes:
                        tile_img = Image.open(io.BytesIO(tile_bytes)).convert("RGB")
                    else:
                        print(f"[TileUpscale] Tile {idx+1}/4 ({label}): could not load generated tile")
                        fallback_h = int(round(4096 / current_geom_ratio))
                        tile_img = tile_crop.resize((4096, fallback_h), Image.LANCZOS)
                    upscaled_tiles.append(tile_img)
                    print(f"[TileUpscale] Tile {idx+1}/4 ({label}): generated {tile_img.size}")
                else:
                    print(f"[TileUpscale] Tile {idx+1}/4 ({label}): generation returned no image, using original crop")
                    fallback_h = int(round(4096 / current_geom_ratio))
                    upscaled_tiles.append(tile_crop.resize((4096, fallback_h), Image.LANCZOS))
            except Exception as e:
                print(f"[TileUpscale] Tile {idx+1}/4 ({label}) failed: {e}. Using original crop.")
                fallback_h = int(round(4096 / current_geom_ratio))
                upscaled_tiles.append(tile_crop.resize((4096, fallback_h), Image.LANCZOS))

        # ── Calculate output dimensions ──
        crop_w = tiles_coords[0][2] - tiles_coords[0][0]
        crop_h = tiles_coords[0][3] - tiles_coords[0][1]
        scale_x = upscaled_tiles[0].size[0] / float(crop_w)
        scale_y = upscaled_tiles[0].size[1] / float(crop_h)
        scale = (scale_x + scale_y) / 2.0

        out_half_w = int(round(half_w * scale))
        out_half_h = int(round(half_h * scale))
        out_w = out_half_w * 2
        out_h = out_half_h * 2

        overlap_out_w = int(round(overlap_w * scale))
        overlap_out_h = int(round(overlap_h * scale))

        tile_out_w = out_half_w + overlap_out_w
        tile_out_h = out_half_h + overlap_out_h

        print(f"[TileUpscale] Canvas: {out_w}×{out_h}, scale={scale:.4f}, overlap: {overlap_out_w}×{overlap_out_h}")

        resized_tiles = [
            t.resize((tile_out_w, tile_out_h), Image.LANCZOS)
            for t in upscaled_tiles
        ]

        # ── Stitch with narrow smoothstep blending at tile boundaries ──
        # Instead of a wide linear cross-fade over the entire overlap zone (which
        # superimposes slightly divergent generative details over 1000+ pixels and causes
        # double-exposure "motion blur" ghosts), we use a smoothstep S-curve transition
        # concentrated within a narrow corridor centered directly on the split seam.
        canvas = Image.new("RGB", (out_w, out_h))
        blend_corridor_w = min(96, max(32, overlap_out_w // 2))
        blend_corridor_h = min(96, max(32, overlap_out_h // 2))

        def _make_smoothstep_1d(length: int, center: int, width: int) -> np.ndarray:
            half_w = width // 2
            x0 = center - half_w
            x1 = center + half_w
            indices = np.arange(length, dtype=np.float32)
            arr = np.zeros(length, dtype=np.float32)
            mask_mid = (indices > x0) & (indices < x1)
            t = (indices[mask_mid] - x0) / float(width)
            arr[mask_mid] = 3.0 * t * t - 2.0 * t * t * t
            arr[indices >= x1] = 1.0
            return (arr * 255.0).astype(np.uint8)

        h_arr = _make_smoothstep_1d(tile_out_w, overlap_out_w, blend_corridor_w)
        v_arr = _make_smoothstep_1d(tile_out_h, overlap_out_h, blend_corridor_h)

        # Place Q1 (top-left) — base quadrant
        canvas.paste(resized_tiles[0], (0, 0))

        # Blend Q2 (top-right) — horizontal smoothstep transition centered at out_half_w
        q2 = resized_tiles[1]
        q2_x = out_half_w - overlap_out_w
        q2_mask = Image.fromarray(np.tile(h_arr, (tile_out_h, 1)), mode="L")
        canvas.paste(q2, (q2_x, 0), q2_mask)

        # Blend Q3 (bottom-left) — vertical smoothstep transition centered at out_half_h
        q3 = resized_tiles[2]
        q3_y = out_half_h - overlap_out_h
        q3_mask = Image.fromarray(np.tile(v_arr[:, None], (1, tile_out_w)), mode="L")
        canvas.paste(q3, (0, q3_y), q3_mask)

        # Blend Q4 (bottom-right) — separable 2D smoothstep transition
        q4 = resized_tiles[3]
        q4_x = out_half_w - overlap_out_w
        q4_y = out_half_h - overlap_out_h
        q4_weights = (v_arr[:, None].astype(np.float32) / 255.0) * (h_arr[None, :].astype(np.float32) / 255.0)
        q4_mask = Image.fromarray((q4_weights * 255.0).astype(np.uint8), mode="L")
        canvas.paste(q4, (q4_x, q4_y), q4_mask)

        final_img = canvas

        # ── Save final stitched image ──
        out_buf = io.BytesIO()
        final_img.save(out_buf, format="PNG")
        final_url = _save_image_to_disk(out_buf.getvalue(), "png")
        print(f"[TileUpscale] ✅ Final image saved: {final_url} ({final_img.size[0]}×{final_img.size[1]})")
        return final_url

    except Exception as e:
        print(f"[TileUpscale] ❌ Failed: {e}")
        import traceback
        traceback.print_exc()
        return None

def _extract_images_from_response(response) -> List[str]:
    """Parse a Gemini response and return base64 data URIs. Returns empty list if blocked."""
    results = []
    if not response.candidates:
        return results
    candidate = response.candidates[0]
    if not candidate.content or not candidate.content.parts:
        return results
    for part in candidate.content.parts:
        if getattr(part, 'text', None):
            print(f"[Gemini] Text part generated: {part.text}")
        if part.inline_data and part.inline_data.data:
            raw_bytes = part.inline_data.data
            mime = getattr(part.inline_data, 'mime_type', None) or 'image/png'
            data_len = len(raw_bytes) if raw_bytes else 0
            print(f"[Gemini] Image part: mime={mime}, size={data_len} bytes, magic={raw_bytes[:4].hex()}")

            # ── Step 1: Detect if Vertex AI returned already-base64-encoded bytes ──
            # Vertex AI sometimes returns the image as a base64 string stored as bytes
            # (e.g. b'iVBOR...' which is base64 of \x89PNG).
            # Detect this by checking if all bytes are valid base64 ASCII characters.
            image_bytes = raw_bytes  # default: assume raw binary
            try:
                decoded_str = raw_bytes.decode('ascii')
                # If it decodes as ASCII and looks like base64 (alphanumeric + /+=)
                import re as _re
                if _re.match(r'^[A-Za-z0-9+/=\r\n]+$', decoded_str.strip()):
                    decoded = base64.b64decode(decoded_str.strip())
                    print(f"[Gemini] Detected pre-encoded base64 from Vertex AI, decoded to {len(decoded)} bytes, magic={decoded[:4].hex()}")
                    image_bytes = decoded  # use the decoded raw image bytes
            except Exception:
                pass  # Not ASCII/base64, treat as raw binary

            # ── Step 2: Try PIL (re-encodes to clean PNG) ──
            try:
                gen_img = Image.open(io.BytesIO(image_bytes))
                buffer = io.BytesIO()
                gen_img.save(buffer, format="PNG")
                
                url = _save_image_to_disk(buffer.getvalue(), "png")
                results.append(url)
                print(f"[Gemini] [OK] Image extracted via PIL ({gen_img.size}) and saved to {url}")
                continue
            except Exception as pil_err:
                print(f"[Gemini] PIL failed: {pil_err}. Trying raw bytes...")

            # ── Step 3: Use image_bytes directly with magic-byte detection ──
            try:
                ext = "png"
                if image_bytes[:2] == b'\xff\xd8':  # JPEG
                    ext = "jpeg"
                elif image_bytes[:4] == b'\x89PNG':  # PNG
                    ext = "png"
                elif image_bytes[:4] == b'RIFF':  # WebP
                    ext = "webp"
                else:
                    mime_part = mime.split('/')[-1] if mime else "png"
                    ext = mime_part

                url = _save_image_to_disk(image_bytes, ext)
                results.append(url)
                print(f"[Gemini] [OK] Image extracted as raw {ext} ({len(image_bytes)} bytes) and saved to {url}")
            except Exception as raw_err:
                print(f"[Gemini] Raw extract also failed: {raw_err}")
    return results

UNIVERSAL_PHOTOREALISM_FOUNDATION = (
    # ── Skin Enhancement (Full Portrait-grade, applied when human skin is present) ──
    "all human skin rendered with healthy clear complexion, natural visible pore micro-detail, authentic delicate epidermal grain, "
    "subsurface light scattering on skin catching light with a soft warm glow across cheeks and forehead, "
    "medium format Hasselblad portrait resolving power applied to all human skin in frame regardless of shot distance, "
    "authentic skin tone consistency with Kodak Portra 400 color science, zero plastic airbrushing or artificial smoothing, "

    # ── Face & Eye Detail ──
    "all faces on identical sharp focal plane, "
    "eyes razor sharp with correct natural catchlights, "
    "individual eyelash definition, natural iris texture and fiber detail with natural depth, "
    "teeth individually separated with natural enamel texture if visible, "
    "natural hair strand separation at hairline, "

    # ── Lighting ──
    "all light from practical sources only — soft window light or Rembrandt lighting, "
    "no harsh white overexposed light sources in frame, "
    "no light blowout in background, "
    "warm natural light wrapping subjects organically, "
    "single dominant natural light source, light wrapping naturally around face contours, "
    "subtle environmental bounce fill, natural specular highlights on skin and surfaces, "

    # ── Photography standard ──
    "shot on Hasselblad X2D with 90mm f/2.5 portrait lens, medium format sensor depth and color richness, "
    "subjects tack sharp, "
    "background progressive natural bokeh with medium format character, "
    "zero global image softness, "
    "photorealistic — not rendered, not illustrated, "
    "looks like a photograph not an AI generation"
)

UNIVERSAL_NEGATIVE_FOUNDATION = (
    "no rendered appearance, "
    "no illustration look, "
    "no harsh overhead lighting, "
    "no light blowout, "
    "no global softness, "
    "no digital sharpening halos, no edge-enhancement artifacts"
)

# ── AUTHENTIC-SPECIFIC PHOTOREALISM: candid, real, no retouching language ──
# Must NOT contain "commercial retouching", "zero visible pores", or "smooth even complexion"
# because those directly conflict with BETA_AUTHENTIC_NEGATIVE ("no airbrushed skin").
AUTHENTIC_PHOTOREALISM_FOUNDATION = (
    "all human skin rendered with real natural texture, "
    "genuine skin with natural micro-detail — not smoothed or airbrushed, "
    "subsurface light scattering on all skin tones, "
    "all faces on identical sharp focal plane, "
    "eyes razor sharp with natural catchlights, "
    "hair strands separated at hairline, "
    "all light from practical ambient sources only, "
    "shot on Sony A7C 35mm f/1.8, "
    "subject tack sharp, face sharpest element in frame, "
    "background progressive natural bokeh, "
    "photorealistic candid photograph — not rendered, not illustrated"
)

AUTHENTIC_NEGATIVE_FOUNDATION = (
    "no commercial retouching, "
    "no rendered appearance, "
    "no studio lighting artifacts, "
    "no global softness"
)


async def _gemini_generate(prompt: str, ratio: str, quality: str, image_b64: Optional[Union[str, List[str]]] = None, gemini_model: str = "gemini-3.1-flash-image", is_tile: bool = False, temperature: float = 0.4, response_modalities: Optional[List[str]] = None, thinking_level: Optional[str] = None, top_p: Optional[float] = None, is_beta: bool = False, bypass_enhancement: bool = False, session_id: Optional[str] = None, request_source: str = "STUDIO") -> tuple:
    """Generate with Google Gemini (Nanobanana) and return base64 data URIs.
    
    Route B middleman: if the first attempt is blocked with IMAGE_PROHIBITED_CONTENT,
    the prompt is automatically rewritten by gemini-2.5-flash and retried once.
    """
    if not PROJECT_ID:
        raise HTTPException(status_code=500, detail="GCP_PROJECT_ID not set in backend .env")

    gemini_ratio = RATIO_MAP.get(ratio, "1:1")
    # Normalize quality to Title Case so "ultra", "Ultra", "ULTRA" all resolve
    gemini_quality = QUALITY_MAP.get(quality.strip().title(), "1K")

    print(f"[Gemini] Quality received: '{quality}' → resolved to: '{gemini_quality}'. Ratio: {gemini_ratio}")
    print(f"[Gemini] Realized prompt: {prompt[:100]}...")
    target_clients = await get_ordered_vertex_clients()
    if not target_clients:
        target_clients = [global_client] if global_client else [genai.Client(vertexai=True, project=PROJECT_ID, location="global")]

    # Build the image part list (without the text prompt — added inside helper)
    image_parts = []
    if image_b64:
        b64_list = image_b64 if isinstance(image_b64, list) else [image_b64]
        for idx, item in enumerate(b64_list):
            b64_str = str(item)
            if "," in b64_str:
                b64_str = b64_str.split(",")[1]
            try:
                image_bytes = base64.b64decode(b64_str)
                mime = "image/jpeg"
                if image_bytes.startswith(b'\x89PNG'):
                    mime = "image/png"
                elif image_bytes.startswith(b'RIFF'):
                    mime = "image/webp"
                image_parts.append(types.Part.from_bytes(data=image_bytes, mime_type=mime))
            except Exception as e:
                print(f"Error decoding uploaded image part {idx+1}: {e}")

    if is_tile:
        enhanced_prompt = prompt
        detected_pipeline = "COMMERCIAL"
    elif bypass_enhancement:
        enhanced_prompt = f"{prompt}, {UNIVERSAL_NEGATIVE_FOUNDATION}"
        detected_pipeline = "COMMERCIAL"
    else:
        enhanced_prompt, detected_pipeline = await _build_nanobanana_enhanced_prompt(prompt, quality, is_beta=is_beta)

    # ── Photorealism Foundation ──────────────────────────────────────────────
    # SKIP when smart composer succeeded (detected_pipeline starts with SMART_)
    # because Claude already composed a conflict-free, intent-aware prompt.
    # Only apply for legacy template fallback.
    raw_pipeline = detected_pipeline.replace("SMART_", "")
    if not is_tile and not bypass_enhancement and not detected_pipeline.startswith("SMART_") and not _is_stylized_intent(prompt):
        if raw_pipeline == "AUTHENTIC":
            enhanced_prompt = f"{enhanced_prompt}, {AUTHENTIC_PHOTOREALISM_FOUNDATION}, {AUTHENTIC_NEGATIVE_FOUNDATION}"
        elif raw_pipeline == "FINEART":
            pass  # Fine art pipelines don't need photorealism foundation
        else:
            enhanced_prompt = f"{enhanced_prompt}, {UNIVERSAL_PHOTOREALISM_FOUNDATION}, {UNIVERSAL_NEGATIVE_FOUNDATION}"
    # Normalise pipeline_type so DB stores clean value (AUTHENTIC not SMART_AUTHENTIC)
    detected_pipeline = raw_pipeline

    # ── Attempt 1: original prompt with Multi-Project Failover ──────────────
    async def _gemini_call_with_retry(client_pool, model_id, contents, config, max_retries=4):
        num_clients = max(1, len(client_pool))
        
        for attempt in range(max_retries):
            if session_id and session_id in CANCELLED_SESSIONS:
                print(f"[Gemini:{model_id}] Session {session_id} cancelled by user. Halting.")
                raise asyncio.CancelledError("Session cancelled by user")
            
            # Select client dynamically: prioritize healthy projects that are NOT on cooldown
            now = time.monotonic()
            current_client = None
            async with _PROJECT_COOLDOWN_LOCK:
                healthy_clients = [
                    c for c in client_pool
                    if now >= _PROJECT_COOLDOWN.get(PROJECT_CLIENT_TO_ID.get(c, ""), 0.0)
                ]
                if healthy_clients:
                    current_client = healthy_clients[attempt % len(healthy_clients)]
                else:
                    # All projects currently in cooldown
                    earliest_c = min(
                        client_pool,
                        key=lambda c: _PROJECT_COOLDOWN.get(PROJECT_CLIENT_TO_ID.get(c, ""), 0.0)
                    )
                    earliest_pid = PROJECT_CLIENT_TO_ID.get(earliest_c, "unknown")
                    earliest_expiry = _PROJECT_COOLDOWN.get(earliest_pid, 0.0)
                    cooldown_wait = max(0.5, earliest_expiry - now)
                    
                    if attempt < max_retries - 1 and cooldown_wait <= 30.0:
                        print(f"[Gemini:{model_id}] All GCP projects cooling down. Waiting {cooldown_wait:.1f}s for '{earliest_pid}' sliding quota window...")
                        current_client = earliest_c
                    else:
                        raise HTTPException(
                            status_code=429,
                            detail="AI generation capacity temporarily exhausted across all projects. Please try again shortly."
                        )

            # Wait if the selected client needs a moment to clear cooldown
            pid = PROJECT_CLIENT_TO_ID.get(current_client, "")
            cooldown_until = _PROJECT_COOLDOWN.get(pid, 0.0)
            now = time.monotonic()
            if now < cooldown_until:
                wait_duration = min(30.0, max(0.5, cooldown_until - now))
                elapsed = 0.0
                while elapsed < wait_duration:
                    if session_id and session_id in CANCELLED_SESSIONS:
                        raise asyncio.CancelledError("Session cancelled by user")
                    step = min(0.5, wait_duration - elapsed)
                    await asyncio.sleep(step)
                    elapsed += step
            
            try:
                # Enforce a 45s attempt timeout so we never hang for 120s+ on a stalled GCP cluster
                return await asyncio.wait_for(
                    asyncio.to_thread(
                        current_client.models.generate_content,
                        model=model_id,
                        contents=contents,
                        config=config,
                    ),
                    timeout=45.0
                )
            except asyncio.CancelledError:
                raise
            except (asyncio.TimeoutError, TimeoutError):
                if session_id and session_id in CANCELLED_SESSIONS:
                    raise asyncio.CancelledError("Session cancelled by user")
                print(f"[Gemini:{model_id}] Project client '{pid}' stalled (>45s gateway queue).")
                if pid:
                    async with _PROJECT_COOLDOWN_LOCK:
                        _PROJECT_COOLDOWN[pid] = time.monotonic() + 45.0
                if attempt < max_retries - 1:
                    await _pace_dispatch()
                    continue
                raise HTTPException(status_code=504, detail="Request timed out waiting for AI gateway capacity.")
            except Exception as e:
                if session_id and session_id in CANCELLED_SESSIONS:
                    raise asyncio.CancelledError("Session cancelled by user")
                err_str = str(e)
                is_quota_err = ("429" in err_str or "Too Many Requests" in err_str or "RESOURCE_EXHAUSTED" in err_str or "Quota" in err_str)
                
                if is_quota_err and attempt < max_retries - 1:
                    if pid:
                        async with _PROJECT_COOLDOWN_LOCK:
                            _PROJECT_COOLDOWN[pid] = time.monotonic() + 45.0
                        print(f"[Gemini:CircuitBreaker] Tripped 45s cooldown for project '{pid}' due to 429 quota exhaustion.")

                    # Check if another client in pool is healthy right now
                    now = time.monotonic()
                    async with _PROJECT_COOLDOWN_LOCK:
                        has_other_healthy = any(
                            now >= _PROJECT_COOLDOWN.get(PROJECT_CLIENT_TO_ID.get(c, ""), 0.0)
                            for c in client_pool if c != current_client
                        )
                    if has_other_healthy:
                        print(f"[Gemini:{model_id}] 429 on '{pid}'. Instant failover to secondary healthy GCP project...")
                        await _pace_dispatch()
                        continue
                    
                    # Both/all projects are cooling down: calculate jittered backoff
                    retry_after_match = re.search(r"retry[- ]after[: ]+(\d+)", err_str, re.IGNORECASE)
                    if retry_after_match:
                        sleep_time = min(25.0, max(2.0, float(retry_after_match.group(1))))
                    else:
                        base_backoff = 4.0
                        calc_backoff = min(20.0, base_backoff * (2 ** attempt))
                        sleep_time = round(random.uniform(2.0, calc_backoff), 2)

                    print(f"[Gemini:{model_id}] 429 across all projects. Backing off for {sleep_time}s before retry {attempt+1}/{max_retries}...")
                    elapsed = 0.0
                    while elapsed < sleep_time:
                        if session_id and session_id in CANCELLED_SESSIONS:
                            raise asyncio.CancelledError("Session cancelled by user")
                        step = min(0.5, sleep_time - elapsed)
                        await asyncio.sleep(step)
                        elapsed += step
                else:
                    raise

    if session_id and session_id in CANCELLED_SESSIONS:
        raise asyncio.CancelledError("Session cancelled by user")

    # ── Attempt 1: original prompt with accurate semaphore-scoped telemetry ──
    _tele_status = "success"
    _tele_error: Optional[str] = None
    _tele_conc = 1
    _tele_burst = 1
    _tele_start = time.monotonic()

    try:
        async with _GEMINI_IMAGE_SEMAPHORE:
            _tele_conc, _tele_burst = await _telemetry_record_dispatch()
            _tele_start = time.monotonic()
            try:
                await _pace_dispatch()
                response = await _gemini_call_with_retry(
                    client_pool=target_clients,
                    model_id=gemini_model,
                    contents=image_parts + [enhanced_prompt],
                    config=types.GenerateContentConfig(
                        response_modalities=response_modalities or ["IMAGE"],
                        temperature=temperature,
                        top_p=top_p,
                        image_config=types.ImageConfig(
                            aspect_ratio=gemini_ratio,
                            image_size=gemini_quality,
                        ),
                        thinking_config=types.ThinkingConfig(thinking_level=thinking_level) if thinking_level else types.ThinkingConfig(thinking_budget=8192),
                    ),
                )
            except Exception as _tele_exc:
                err_s = str(_tele_exc)
                if "429" in err_s or "RESOURCE_EXHAUSTED" in err_s or "Too Many Requests" in err_s:
                    _tele_status = "429"
                elif "503" in err_s:
                    _tele_status = "503"
                else:
                    _tele_status = "error"
                _tele_error = err_s[:100]
                raise
            finally:
                await _telemetry_decrement()
    finally:
        _elapsed_ms = int((time.monotonic() - _tele_start) * 1000)
        asyncio.get_event_loop().call_soon(
            lambda: asyncio.ensure_future(asyncio.to_thread(
                _write_telemetry_bg,
                gemini_model, detected_pipeline, bool(image_b64), gemini_ratio,
                _elapsed_ms, _tele_status, _tele_error,
                _tele_conc, _tele_burst,
                request_source=request_source,
            ))
        )

    if session_id and session_id in CANCELLED_SESSIONS:
        raise asyncio.CancelledError("Session cancelled by user")

    # Check if blocked or finished without image parts → trigger the middleman retry
    blocked = False
    if not response.candidates:
        blocked = True
    else:
        candidate = response.candidates[0]
        if not candidate.content or not candidate.content.parts:
            finish = str(getattr(candidate, 'finish_reason', 'UNKNOWN'))
            print(f"[Gemini] Candidate returned no image parts (finish_reason: {finish}) — triggering retry...")
            blocked = True

    if not blocked:
        results = _extract_images_from_response(response)
        if results:
            return results, enhanced_prompt, detected_pipeline
        else:
            blocked = True

    # ── Attempt 2: middleman rewrite + retry ────────────────────────────────
    if session_id and session_id in CANCELLED_SESSIONS:
        raise asyncio.CancelledError("Session cancelled by user")

    print("[Gemini] Invoking prompt middleman retry...")
    sanitized_prompt = await _sanitize_prompt(prompt)

    _tele_r_status = "success"
    _tele_r_error: Optional[str] = None
    _tele_r_conc = 1
    _tele_r_burst = 1
    _tele_r_start = time.monotonic()

    try:
        async with _GEMINI_IMAGE_SEMAPHORE:
            _tele_r_conc, _tele_r_burst = await _telemetry_record_dispatch()
            _tele_r_start = time.monotonic()
            try:
                await _pace_dispatch()
                retry_response = await _gemini_call_with_retry(
                    client_pool=target_clients,
                    model_id=gemini_model,
                    contents=image_parts + [sanitized_prompt],
                    config=types.GenerateContentConfig(
                        response_modalities=response_modalities or ["IMAGE"],
                        temperature=temperature,
                        image_config=types.ImageConfig(
                            aspect_ratio=gemini_ratio,
                            image_size=gemini_quality,
                        ),
                        thinking_config=types.ThinkingConfig(thinking_level=thinking_level) if thinking_level else types.ThinkingConfig(thinking_budget=8192),
                    ),
                )
            except Exception as _tele_r_exc:
                err_s = str(_tele_r_exc)
                if "429" in err_s or "RESOURCE_EXHAUSTED" in err_s or "Too Many Requests" in err_s:
                    _tele_r_status = "429"
                elif "503" in err_s:
                    _tele_r_status = "503"
                else:
                    _tele_r_status = "error"
                _tele_r_error = err_s[:100]
                raise
            finally:
                await _telemetry_decrement()
    finally:
        _elapsed_r_ms = int((time.monotonic() - _tele_r_start) * 1000)
        asyncio.get_event_loop().call_soon(
            lambda: asyncio.ensure_future(asyncio.to_thread(
                _write_telemetry_bg,
                gemini_model, detected_pipeline, bool(image_b64), gemini_ratio,
                _elapsed_r_ms, _tele_r_status, _tele_r_error,
                _tele_r_conc, _tele_r_burst, 1,
                request_source=request_source,
            ))
        )

    if not retry_response.candidates:
        raise HTTPException(status_code=400, detail="Blocked by content policy even after prompt rewrite.")

    retry_candidate = retry_response.candidates[0]
    if not retry_candidate.content or not retry_candidate.content.parts:
        finish = str(getattr(retry_candidate, 'finish_reason', 'UNKNOWN'))
        raise HTTPException(status_code=400, detail=f"Retry also blocked. Reason: {finish}")

    results = _extract_images_from_response(retry_response)
    if results:
        print(f"[Middleman] Retry succeeded with sanitized prompt.")
    return results, enhanced_prompt, detected_pipeline


# ── CHATGPT IMAGE QUALITY PIPELINE ────────────────────────────────────────────
# Mirrors the Nanobanana quality.py approach for maximum image fidelity

CHATGPT_QUALITY_SUFFIX = (
    "ultra high quality, maximum detail, 8K resolution, masterpiece, "
    "tack sharp focus, razor sharp edge definition, photorealistic textures, correct anatomy, "
    "coherent background, no artifacts, no noise, no distortion, "
    "professional studio lighting, accurate perspective, flawless render, "
    "shot on Hasselblad medium format, extreme micro-contrast between adjacent details, "
    "authentic epidermal pore texture with natural micro-detail and subsurface light scattering if skin is present, "
    "subsurface light scattering on skin if present"
)

CHATGPT_ARTIFACT_GUARDS = (
    "clean edges and boundaries, "
    "correct proportions throughout, "
    "coherent background without smearing, "
    "accurate facial features if present, "
    "lifelike skin with authentic pore micro-texture and fine natural grain if skin is present, "
    "warm natural skin tones with subsurface scattering if skin is present, "
    "proper hands and fingers if present, "
    "realistic material surfaces"
)

CHATGPT_CONSISTENCY_BONUS = (
    "consistent lighting, consistent color palette, consistent mood"
)

NEGATIVE_CONSTRAINTS = (
    "no blur, no motion blur, no noise, no grain, no pixelation, "
    "no compression artifacts, no watermarks, no text overlays, "
    "no over-smoothing, no plastic skin, no uncanny valley, "
    "no blending of adjacent fine details, no merging of individual strands or fibers, "
    "no smearing of textures into each other, no soft edges between distinct objects"
)

# ── AUTO HIGH-RES DETAIL DIRECTIVES ──────────────────────────────────────────
# Injected into EVERY generation so all images come out with maximum detail
# from the first pass. Each clause uses 'if present' so irrelevant ones are ignored.
DETAIL_ENHANCEMENT = (
    # ── STRANDS AND FIBERS (covers hair, beard, fur, feathers, rope, fabric threads) ──
    "every individual strand and fiber in the image rendered separately with clear gaps and never blending into adjacent strands whether it is hair or beard or fur or feathers or rope or thread, "

    # ── EYES ──
    "razor-sharp iris fibers with natural catchlight reflections and individually separated eyelashes if eyes are visible, "

    # ── SKIN ──
    "authentic organic skin texture with visible natural pore micro-detail and fine epidermal grain without airbrushing or plastic smoothing if skin is present, "

    # ── HANDS AND FINGERS ──
    "each finger and toe distinctly separated with clear gaps, healthy natural skin texture, and individually defined clean nails if hands or feet are present, "

    # ── FACE DETAILS ──
    "each tooth individually separated with natural enamel sheen and clean refined complexion if face is visible, "

    # ── ANIMALS ──
    "each scale and whisker and feather barb individually sharp and separated if animals are present, "

    # ── FABRIC AND CLOTHING ──
    "visible weave pattern with individually traceable threads and stitches and sharp button and zipper detail if clothing is present, "

    # ── JEWELRY AND METAL ACCESSORIES ──
    "each chain link and gemstone facet and engraving individually defined with sharp edges if jewelry is present, "

    # ── NATURE AND PLANTS ──
    "each grass blade and leaf vein and flower petal and bark ridge individually separated and never merging if vegetation is present, "

    # ── WATER AND LIQUIDS ──
    "each water droplet and ripple and bubble and splash particle individually defined with its own sharp edge and refraction if water is present, "

    # ── FOOD ──
    "each grain and crumb and noodle strand and crystal individually separated with visible moisture and gloss if food is present, "

    # ── ARCHITECTURE ──
    "each brick and tile and shingle individually defined with visible mortar and grout gaps and sharp structural edges if buildings are present, "

    # ── METAL AND HARDWARE ──
    "crisp metal surfaces with individual rivets and bolts and mesh holes and realistic reflections and scratches if metal is present, "

    # ── GLASS AND WOOD ──
    "clear glass with individual refractions and sharp wood grain with individually defined knots and splinters if glass or wood is present, "

    # ── PARTICLES (sand, snow, dirt, dust) ──
    "each sand grain and snowflake and soil particle and dust mote individually visible and separated if particles are present, "

    # ── ATMOSPHERE ──
    "each smoke wisp and steam tendril and bokeh circle individually defined with clear edges if atmospheric effects are present, "

    # ── VEHICLES ──
    "sharp panel gaps and tire treads and headlight internals and reflective paint if vehicles are present, "

    # ── TEXT ──
    "razor-sharp text with each letter individually crisp and never bleeding into adjacent characters if text is visible, "

    # ── CROWDS ──
    "each person individually distinct and never merging into adjacent people if multiple subjects are present, "

    # ── SURFACE REALISM ──
    "realistic surface imperfections like scratches and wear and patina on all objects, "

    # ── GLOBAL MANDATE ──
    "every distinct element in the entire image must have a clear razor-sharp boundary separating it from all adjacent elements with absolute zero blending or merging"
)

# ── BETA MULTI-PIPELINE CONSTANTS (Nanobanana 2 Beta) ──

# Pipeline 1: COMMERCIAL
BETA_COMMERCIAL_QUALITY_SUFFIX = (
    "shot on Fujifilm GFX 100S with Fujinon 110mm f/2 lens, "
    "bright natural daylight, vivid accurate color reproduction, "
    "crisp edge definition, premium commercial photography, "
    "medium format lens resolving power, "
    "micro-contrast between every adjacent detail, "
    "individual fabric threads visible in clothing"
)
BETA_COMMERCIAL_ARTIFACT_GUARDS = (
    "correct anatomy, clean precise edges, accurate proportions, "
    "proper hands and fingers if present, "
    "sharp subject with background separation, coherent shadow placement"
)

# Professional skin block for COMMERCIAL pipeline — single direction: textured/real, NOT glossy.
# Used by both the legacy _build_commercial_prompt() and as reference for SmartComposer.
BETA_COMMERCIAL_SKIN = (
    "healthy well-maintained skin with clearly visible natural pore texture at close range, "
    "subtle natural skin tone variation across cheeks and forehead, "
    "soft subsurface light scattering, "
    "clean professional appearance achieved through good lighting and grooming — not through digital retouching, "
    "natural light oil/sheen on T-zone, fine lines and authentic skin micro-texture fully visible, "
    "looks like real skin photographed under flattering studio light, "
    "not airbrushed, not smoothed, not glossy"
)
BETA_COMMERCIAL_NEGATIVE = (
    "no film grain, no muted colors, no heavy vignette, "
    "no moody atmosphere, no underexposure, no blur, "
    "no HDR look, no overcast flat lighting, "
    "no digital sharpening halos, no edge-enhancement artifacts"
)
BETA_COMMERCIAL_DETAIL = (
    "natural depth of field with subject tack sharp, "
    "bright catchlights, accurate fabric and material textures, "
    "water droplets and surface details physically accurate if present, "
    "consistent warm-neutral daylight color balance"
)

# Pipeline 2: CINEMATIC
BETA_CINEMATIC_QUALITY_SUFFIX = (
    "shot on Arri Alexa 65, Zeiss Master Anamorphic lens, "
    "cinematic color grading, Kodak Vision3 250D color science, "
    "dramatic chiaroscuro lighting, clean grain-free digital cinema quality, "
    "anamorphic lens flares, deep cinematic shadows"
)
BETA_CINEMATIC_ARTIFACT_GUARDS = (
    "natural organic skin texture, authentic lighting falloff, "
    "coherent shadow placement, realistic material surfaces, "
    "proper facial anatomy if present, accurate environmental depth"
)
BETA_CINEMATIC_NEGATIVE = (
    "no digital sterile look, "
    "no artificial studio lighting, no over-saturation, "
    "no HDR look, no bright cheerful tones, "
    "no commercial photography feel, "
    "no film grain, no noise, no graininess, "
    "no digital sharpening halos, no edge-enhancement artifacts"
)
BETA_CINEMATIC_DETAIL = (
    "selective focus with natural depth falloff, "
    "atmospheric haze and environmental particles if appropriate, "
    "physically accurate shadow gradients, "
    "subtle color temperature variation between light sources, "
    "anamorphic bokeh on out-of-focus elements"
)

# Pipeline 3: AUTHENTIC / UGC
BETA_AUTHENTIC_QUALITY_SUFFIX = (
    "shot on iPhone 15 Pro Max or Sony A7C with 35mm f/1.8, "
    "natural ambient light, "
    "Fujifilm Eterna Vivid color profile, authentic candid moment, "
    "realistic everyday lighting conditions"
)
BETA_AUTHENTIC_ARTIFACT_GUARDS = (
    "natural unposed body language, authentic epidermal pore micro-texture "
    "and subtle natural micro-details if present, authentic messy or natural hair, "
    "believable unscripted environment, accurate casual clothing textures"
)
BETA_AUTHENTIC_NEGATIVE = (
    "no professional studio lighting, no perfect symmetrical pose, "
    "no dramatic shadows, no cinematic grading, "
    "no fine art composition, no commercial polish, "
    "no artificial color grading, "
    "no digital sharpening halos, no edge-enhancement artifacts"
)
BETA_AUTHENTIC_DETAIL = (
    "natural light wrapping organically around subject, "
    "subtle environmental reflections, authentic background clutter "
    "if appropriate, slight optical softness on edges, "
    "genuine micro-expressions if faces present, "
    "smartphone computational sharpness on subject face, "
    "portrait mode separation with face razor sharp, "
    "background elements progressively softer, "
    "natural detail in clothing print patterns"
)

# Pipeline 4: FINE ART
BETA_FINEART_QUALITY_SUFFIX = (
    "digital concept art, masterpiece composition, "
    "painterly brushwork visible in textures, "
    "dramatic chiaroscuro, rich saturated color palette, "
    "ArtStation and Behance quality"
)
BETA_FINEART_ARTIFACT_GUARDS = (
    "coherent anatomy if figures present, harmonious color theory, "
    "intentional stylized proportions, expressive facial features "
    "if present, detailed background world-building elements, "
    "consistent art style throughout"
)
BETA_FINEART_NEGATIVE = (
    "no photorealism, no photograph aesthetic, no 3D render look, "
    "no flat boring lighting, "
    "no stock photo composition, no generic AI art look"
)
BETA_FINEART_DETAIL = (
    "visible texture and brushwork in surfaces, "
    "dramatic rim lighting defining form edges, "
    "atmospheric perspective in backgrounds, "
    "intentional color harmony across the entire frame, "
    "expressive use of negative space"
)

# Pipeline 5: PORTRAIT
BETA_PORTRAIT_QUALITY_SUFFIX = (
    "shot on Hasselblad X2D with 90mm f/2.5 portrait lens, "
    "soft window light or Rembrandt lighting, "
    "Kodak Portra 400 skin tone rendering, "
    "medium format sensor depth and color richness, "
    "intimate close framing"
)
BETA_PORTRAIT_ARTIFACT_GUARDS = (
    "accurate facial anatomy, healthy clear complexion with authentic visible pore micro-detail, natural epidermal grain, "
    "zero acne or blemishes, correct eye catchlights, "
    "natural hair strand separation, authentic skin tone consistency, "
    "proper ear and neck anatomy"
)
BETA_PORTRAIT_NEGATIVE = (
    "no harsh shadows, no flat lighting, "
    "no digital sharpening halos, no edge-enhancement artifacts"
)
BETA_PORTRAIT_DETAIL = (
    "subsurface light scattering on skin catching light, "
    "individual eyelash definition, natural iris texture and depth, "
    "healthy clear skin, natural skin texture, subtle skin micro-details, light film grain, "
    "soft natural background bokeh with medium format character, "
    "emotional authenticity in expression, "
    "teeth individually separated with natural enamel texture, "
    "iris fiber detail with natural depth"
)

# Pipeline 6: NATURE
BETA_NATURE_QUALITY_SUFFIX = (
    "shot on Nikon Z9 with 24-70mm f/2.8S, "
    "Fujifilm Velvia 50 color science, "
    "natural golden hour or blue hour lighting, "
    "authentic environmental atmosphere, "
    "vast depth and scale, National Geographic quality"
)
BETA_NATURE_ARTIFACT_GUARDS = (
    "accurate perspective and horizon line, coherent sky and terrain, "
    "realistic cloud formations if present, natural vegetation density, "
    "accurate water physics and reflections if present, "
    "believable atmospheric haze at distance"
)
BETA_NATURE_NEGATIVE = (
    "no artificial studio lighting, no human subjects unless specified, "
    "no oversaturated fantasy colors, no HDR tone mapping look, "
    "no flat boring midday light, no digital painting style, "
    "no distorted perspective, "
    "no digital sharpening halos, no edge-enhancement artifacts"
)
BETA_NATURE_DETAIL = (
    "volumetric god rays through atmosphere if appropriate, "
    "micro-detail in foreground textures, "
    "natural color temperature shift from foreground to sky, "
    "authentic wind movement in vegetation if present, "
    "layered environmental depth from foreground to horizon"
)

# ── BETA UNIVERSAL SHARPNESS LAYERS (applied to ALL 6 pipelines) ──

BETA_SHARPNESS_V3 = (
    "shot on Sony A1 with 85mm GM lens at f/1.8, "
    "eye autofocus tracking — all human faces and skin rendered with razor-sharp portrait focal clarity regardless of framing or distance, "
    "zero face blur or distance softness, individual eyelash definition, natural iris texture and depth, "
    "teeth individually defined with natural enamel and gap separation, "
    "hair rendered strand by strand at hairline and crown, "
    "face is the sharpest element in the entire frame, "
    "no face softer than any object in the foreground"
)

BETA_SKIN_V3 = (
    "subsurface light scattering on skin catching light, "
    "healthy clear skin with natural skin texture and subtle skin micro-details, "
    "clean luminous complexion free of acne or blemishes, "
    "soft light scattering across cheeks and forehead, "
    "natural skin texture with healthy clear complexion, "
    "medium format Hasselblad portrait resolving power applied to all human skin in frame regardless of shot distance"
)

# ── PIPELINE-SPECIFIC SHARPNESS (replaces universal SHARPNESS_V3 / SKIN_V3 for non-portrait pipelines) ──

BETA_COMMERCIAL_SHARPNESS = (
    "tack sharp product and subject detail, crisp edge definition on all surfaces, "
    "accurate material texture resolution — fabric weave, metal grain, glass clarity, "
    "micro-contrast between adjacent fine details, "
    "if people present: face is the sharpest element in frame, individual eyelash definition, "
    "natural iris texture and depth, teeth individually defined, hair strand separation at hairline, "
    "healthy clear skin rendered with natural micro-texture and pore definition — not smoothed or plasticised, "
    "zero global softness, sharpness from premium lens quality not digital sharpening filters"
)

BETA_CINEMATIC_SHARPNESS = (
    "selective cinematic focus on subject with natural anamorphic depth falloff, "
    "high resolution film-quality detail, "
    "if people present: face is the sharpest element in frame, individual eyelash definition, "
    "natural iris texture and depth, teeth individually defined, hair strand separation at hairline, "
    "skin rendered with natural micro-texture under dramatic lighting — not smoothed or plasticised, "
    "natural lens breathing between focus planes, "
    "no digital over-sharpening, no visible film grain, no noise"
)

BETA_FINEART_CLARITY = (
    "intentional artistic detail and clarity in focal areas, "
    "visible brushwork texture and artistic mark-making, "
    "sharp definition on key compositional elements, "
    "rich detail in world-building elements and environmental storytelling, "
    "artistic color harmony and intentional palette choices"
)

BETA_NATURE_SHARPNESS = (
    "tack sharp foreground texture detail — rock grain, bark ridges, leaf veins, water droplets, "
    "environmental micro-detail across the entire scene, "
    "accurate atmospheric perspective with natural haze at distance, "
    "crisp horizon line and sky detail, "
    "if people present: face is the sharpest element in frame, individual eyelash definition, "
    "natural iris texture and depth, teeth individually defined, hair strand separation at hairline, "
    "skin rendered with natural micro-texture and subsurface light scattering — not smoothed, "
    "zero digital over-sharpening — natural optical resolution from premium glass"
)

BETA_UNIVERSAL_DEPTH_LAYERING = (
    "subject in sharp focus, background naturally out of focus"
)

BETA_UNIVERSAL_LIGHT_COHERENCE = (
    "single dominant natural light source, "
    "light wrapping naturally around face contours, "
    "subtle environmental bounce fill, "
    "natural specular highlights on skin and surfaces"
)

BETA_CORE_QUALITY_SUFFIX_V2 = (
    "shot on Fujifilm GFX 100S with GF 110mm f/2 R LM WR lens, "
    "medium format sensor sharpness and color depth, "
    "Kodak Portra 400 color science and skin rendering, "
    "natural window light as primary source, "
    "crisp optical resolution across subject plane, "
    "zero global softness — sharpness from lens quality not sharpening filters"
)

BETA_NEGATIVE_V3 = (
    "no distance face blur, no soft blurry faces in wide shots, "
    "no soft eyes, "
    "no merged teeth, "
    "no hair as single mass, "
    "no global image softness, "
    "no HDR grading, "
    "no artificial lighting, "
    "no over-saturation"
)


def _parse_json_from_response(text: str) -> dict:
    """Extracts and parses JSON from LLM responses, even if wrapped in markdown code blocks or containing preamble/postamble."""
    text = text.strip()
    
    # 1. Attempt standard parsing
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 2. Extract content between first '{' and last '}'
    start_idx = text.find('{')
    end_idx = text.rfind('}')
    if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
        json_candidate = text[start_idx:end_idx + 1]
        try:
            return json.loads(json_candidate)
        except json.JSONDecodeError:
            # Clean up trailing commas in JSON candidate before } or ]
            import re as _re
            cleaned = _re.sub(r',\s*([}\]])', r'\1', json_candidate)
            try:
                return json.loads(cleaned)
            except json.JSONDecodeError:
                pass
                
    # 3. Try markdown code block extraction
    import re as _re
    code_blocks = _re.findall(r'```(?:json)?\s*([\s\S]*?)\s*```', text)
    for block in code_blocks:
        try:
            return json.loads(block.strip())
        except json.JSONDecodeError:
            cleaned = _re.sub(r',\s*([}\]])', r'\1', block.strip())
            try:
                return json.loads(cleaned)
            except json.JSONDecodeError:
                pass

    raise json.JSONDecodeError("Failed to parse JSON from text", text, 0)


async def _classify_use_case(user_prompt: str) -> str:
    """Classifies a prompt into one of the 6 categories: COMMERCIAL, CINEMATIC, AUTHENTIC, FINEART, PORTRAIT, NATURE."""
    system_prompt = (
        "You are a use case classifier for an AI image generation tool.\n\n"
        "Read the user's prompt and classify it into EXACTLY ONE of these 6 categories:\n\n"
        "1. COMMERCIAL\n"
        "   Sports, product photography, real estate, automotive, corporate, non-person advertising campaigns\n\n"
        "2. CINEMATIC\n"
        "   Movie stills, dramatic scenes, moody storytelling, dark atmospheres, narrative shots\n\n"
        "3. AUTHENTIC\n"
        "   Social media, lifestyle, candid moments, UGC style, influencer content, everyday real life\n\n"
        "4. FINEART\n"
        "   Concept art, fantasy, illustration, painterly, surreal, stylized artistic work\n\n"
        "5. PORTRAIT\n"
        "   Headshots, beauty photography, makeup campaigns, face close-ups, character studies, emotional faces\n\n"
        "6. NATURE\n"
        "   Landscapes, travel, wildlife, outdoor environments, weather, environmental photography\n\n"
        "CRITICAL RULE: Any prompt focusing on a human face, headshot, beauty photoshoot, or makeup campaign MUST be classified as PORTRAIT, even if it mentions commercial advertising.\n\n"
        "Respond ONLY with a JSON object containing the key 'pipeline', whose value is the category name. E.g., {\"pipeline\": \"PORTRAIT\"}."
    )
    user_msg = f'Classify this prompt:\n\n"{user_prompt}"'

    if ANTHROPIC_API_KEY:
        try:
            print("[SmartPipeline] Using Claude Sonnet 5 for classification")
            ant_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
            resp = await asyncio.to_thread(
                ant_client.messages.create,
                model="claude-sonnet-5",
                system=system_prompt,
                messages=[{"role": "user", "content": user_msg}],
                max_tokens=300,
            )
            text_content = _extract_anthropic_text(resp)
            parsed = _parse_json_from_response(text_content)
            pipeline = parsed.get("pipeline", "COMMERCIAL").upper()
            if pipeline in ["COMMERCIAL", "CINEMATIC", "AUTHENTIC", "FINEART", "PORTRAIT", "NATURE"]:
                return pipeline
        except Exception as e_ant:
            print(f"[SmartPipeline] Claude Sonnet 5 classification failed: {e_ant}")

    if OPENAI_API_KEY:
        print("[SmartPipeline] Trying GPT-5.6-luna for classification")
        try:
            oai_client = openai_lib.OpenAI(api_key=OPENAI_API_KEY)
            resp = await asyncio.to_thread(
                oai_client.chat.completions.create,
                model="gpt-5.6-luna",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_msg},
                ],
                max_completion_tokens=150,
            )
            text_content = resp.choices[0].message.content.strip()
            parsed = _parse_json_from_response(text_content)
            pipeline = parsed.get("pipeline", "COMMERCIAL").upper()
            if pipeline in ["COMMERCIAL", "CINEMATIC", "AUTHENTIC", "FINEART", "PORTRAIT", "NATURE"]:
                return pipeline
        except Exception as e:
            print(f"[SmartPipeline] GPT-5.6-luna classification failed: {e}")
            
    print("[SmartPipeline] All classification providers failed, fallback to COMMERCIAL")
    return "COMMERCIAL"


def _build_commercial_prompt(user_prompt: str) -> str:
    parts = [user_prompt.strip()]
    parts.append(BETA_COMMERCIAL_ARTIFACT_GUARDS)
    parts.append(BETA_COMMERCIAL_QUALITY_SUFFIX)  # pipeline-specific camera/lens/film stock (Fujifilm GFX)
    parts.append(CHATGPT_CONSISTENCY_BONUS)
    parts.append(BETA_COMMERCIAL_NEGATIVE)
    parts.append(BETA_NEGATIVE_V3)
    parts.append(BETA_COMMERCIAL_DETAIL)
    parts.append(BETA_COMMERCIAL_SHARPNESS)  # pipeline-specific sharpness
    parts.append(BETA_COMMERCIAL_SKIN)       # single-direction professional skin — NO glossy/flawless language
    # NOTE: BETA_SKIN_V3 is intentionally excluded here — it contains "smooth luminous"
    #       and "commercial cosmetics retouching finish" which contradicts the texture-forward goal.
    parts.append(BETA_SHARPNESS_V3)          # face sharpness
    parts.append(BETA_UNIVERSAL_DEPTH_LAYERING)
    parts.append(BETA_UNIVERSAL_LIGHT_COHERENCE)
    return ", ".join(p.strip(", ") for p in parts if p)


def _build_cinematic_prompt(user_prompt: str) -> str:
    parts = [user_prompt.strip()]
    parts.append(BETA_CINEMATIC_ARTIFACT_GUARDS)
    parts.append(BETA_CINEMATIC_QUALITY_SUFFIX)  # pipeline-specific camera/lens/film stock (ARRI Alexa 65)
    parts.append(CHATGPT_CONSISTENCY_BONUS)
    parts.append(BETA_CINEMATIC_NEGATIVE)
    parts.append(BETA_NEGATIVE_V3)
    parts.append(BETA_CINEMATIC_DETAIL)
    parts.append(BETA_CINEMATIC_SHARPNESS)  # pipeline-specific sharpness (film-native, no portrait camera)
    parts.append(BETA_SKIN_V3)              # skin quality — same foundation as PORTRAIT/AUTHENTIC
    parts.append(BETA_SHARPNESS_V3)         # face sharpness — same foundation as PORTRAIT/AUTHENTIC
    parts.append(BETA_UNIVERSAL_DEPTH_LAYERING)
    parts.append(BETA_UNIVERSAL_LIGHT_COHERENCE)
    return ", ".join(p.strip(", ") for p in parts if p)


def _build_authentic_prompt(user_prompt: str) -> str:
    parts = [user_prompt.strip()]
    parts.append(BETA_AUTHENTIC_ARTIFACT_GUARDS)
    parts.append(BETA_AUTHENTIC_QUALITY_SUFFIX)  # pipeline-specific camera/lens/film stock
    parts.append(BETA_CORE_QUALITY_SUFFIX_V2)
    parts.append(CHATGPT_CONSISTENCY_BONUS)
    parts.append(BETA_AUTHENTIC_NEGATIVE)
    parts.append(BETA_NEGATIVE_V3)
    parts.append(BETA_AUTHENTIC_DETAIL)
    parts.append(BETA_SHARPNESS_V3)
    parts.append(BETA_SKIN_V3)
    parts.append(BETA_UNIVERSAL_DEPTH_LAYERING)
    parts.append(BETA_UNIVERSAL_LIGHT_COHERENCE)
    return ", ".join(p.strip(", ") for p in parts if p)


def _build_fineart_prompt(user_prompt: str) -> str:
    parts = [user_prompt.strip()]
    parts.append(BETA_FINEART_ARTIFACT_GUARDS)
    parts.append(CHATGPT_CONSISTENCY_BONUS)
    parts.append(BETA_FINEART_NEGATIVE)
    parts.append(BETA_FINEART_DETAIL)
    parts.append(BETA_FINEART_CLARITY)  # art-specific clarity (no cameras, no skin, no photorealism)
    return ", ".join(p.strip(", ") for p in parts if p)


def _build_portrait_prompt(user_prompt: str) -> str:
    parts = [user_prompt.strip()]
    parts.append(BETA_PORTRAIT_ARTIFACT_GUARDS)
    parts.append(BETA_PORTRAIT_QUALITY_SUFFIX)  # Hasselblad / Rembrandt / Portra 400 — the key portrait secret
    parts.append(BETA_CORE_QUALITY_SUFFIX_V2)
    parts.append(CHATGPT_CONSISTENCY_BONUS)
    parts.append(BETA_PORTRAIT_NEGATIVE)
    parts.append(BETA_NEGATIVE_V3)
    parts.append(BETA_PORTRAIT_DETAIL)
    parts.append(BETA_SHARPNESS_V3)
    parts.append(BETA_SKIN_V3)
    parts.append(BETA_UNIVERSAL_DEPTH_LAYERING)
    parts.append(BETA_UNIVERSAL_LIGHT_COHERENCE)
    return ", ".join(p.strip(", ") for p in parts if p)


def _build_nature_prompt(user_prompt: str) -> str:
    parts = [user_prompt.strip()]
    parts.append(BETA_NATURE_ARTIFACT_GUARDS)
    parts.append(BETA_NATURE_QUALITY_SUFFIX)  # pipeline-specific camera/lens/film stock (Nikon Z9 + Velvia 50)
    parts.append(CHATGPT_CONSISTENCY_BONUS)
    parts.append(BETA_NATURE_NEGATIVE)
    parts.append(BETA_NATURE_DETAIL)
    parts.append(BETA_NATURE_SHARPNESS)  # pipeline-specific sharpness (environmental detail)
    parts.append(BETA_SKIN_V3)           # skin quality — same foundation as PORTRAIT/AUTHENTIC
    parts.append(BETA_SHARPNESS_V3)      # face sharpness — same foundation as PORTRAIT/AUTHENTIC
    parts.append(BETA_UNIVERSAL_DEPTH_LAYERING)
    parts.append(BETA_UNIVERSAL_LIGHT_COHERENCE)
    return ", ".join(p.strip(", ") for p in parts if p)


async def _optimize_with_gpt(user_prompt: str, enhanced_prompt: str, pipeline_type: str) -> str:
    """Uses GPT-5.5-pro to generate <= 20 words of modifiers and appends them to enhanced_prompt."""
    prompts_dict = {
        "COMMERCIAL": (
            "You are optimizing a prompt for Nanobanana 2 Beta — COMMERCIAL pipeline.\n"
            "Generate ≤20 words of modifiers focused on: sharp focus, accurate colors, natural daylight, premium lens quality.\n"
            "NEVER use: grain, moody, dark, cinematic, painterly, muted, organic imperfections."
        ),
        "CINEMATIC": (
            "You are optimizing a prompt for Nanobanana 2 Beta — CINEMATIC pipeline.\n"
            "Generate ≤20 words emphasizing: film stocks, anamorphic lenses, dramatic lighting, atmospheric mood.\n"
            "Never use: crisp, sharp, bright, commercial, vivid, 8K, flawless."
        ),
        "AUTHENTIC": (
            "You are optimizing a prompt for Nanobanana 2 Beta — AUTHENTIC / UGC pipeline.\n"
            "Generate ≤20 words emphasizing: smartphone feel, candid lighting, natural unposed aesthetics, real-life environments.\n"
            "Never use: studio, perfect, flawless, dramatic, cinematic, masterpiece."
        ),
        "FINEART": (
            "You are optimizing a prompt for Nanobanana 2 Beta — FINE ART pipeline.\n"
            "Generate ≤20 words emphasizing: painterly techniques, illustration quality, artistic lighting, color theory.\n"
            "Never use: photorealistic, photograph, candid, sharp, crisp."
        ),
        "PORTRAIT": (
            "You are optimizing a prompt for Nanobanana 2 Beta — PORTRAIT pipeline.\n"
            "Generate ≤20 words emphasizing: portrait lens character, natural lighting, skin tone accuracy, emotional intimacy.\n"
            "Never use: wide angle, environmental, busy background, sharp background, action."
        ),
        "NATURE": (
            "You are optimizing a prompt for Nanobanana 2 Beta — NATURE pipeline.\n"
            "Generate ≤20 words emphasizing: natural light, landscape scale, weather atmosphere, wildlife authenticity.\n"
            "Never use: studio, artificial, people, urban, indoor."
        )
    }
    
    system_instruction = prompts_dict.get(pipeline_type, prompts_dict["COMMERCIAL"])
    system_prompt = (
        f"{system_instruction}\n\n"
        "Generate ONLY ≤20 words of prompt modifiers to append at the end.\n"
        "RULES:\n"
        "1. Do NOT repeat the user's input prompt.\n"
        "2. Respond with ONLY the short modifier string, nothing else. Do not include markdown code block syntax.\n\n"
        "ALWAYS include: \"Sony A1 85mm eye-tracking, healthy clear skin, natural skin texture, subtle skin micro-details, teeth individually defined\"\n"
        "NEVER use: plastic skin, airbrushing, over-smoothing, acne, pimples, heavy blemishes, raw skin, unretouched"
    )
    
    modifiers = ""
    user_msg = f"Generate ≤20 words of prompt modifiers for this concept:\n\"{user_prompt}\""

    if ANTHROPIC_API_KEY:
        try:
            print(f"[SmartPipeline] Using Claude Sonnet 5 for optimization ({pipeline_type})")
            ant_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
            resp = await asyncio.to_thread(
                ant_client.messages.create,
                model="claude-sonnet-5",
                system=system_prompt,
                messages=[{"role": "user", "content": user_msg}],
                max_tokens=300,
            )
            raw_mod = _extract_anthropic_text(resp)
            modifiers = raw_mod.strip('"').strip("'")
        except Exception as e_ant:
            print(f"[SmartPipeline] Claude Sonnet 5 optimization failed: {e_ant}")

    if not modifiers and OPENAI_API_KEY:
        print(f"[SmartPipeline] Trying GPT-5.6-luna for optimization ({pipeline_type})")
        try:
            oai_client = openai_lib.OpenAI(api_key=OPENAI_API_KEY)
            resp = await asyncio.to_thread(
                oai_client.chat.completions.create,
                model="gpt-5.6-luna",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_msg},
                ],
                max_completion_tokens=100,
            )
            modifiers = resp.choices[0].message.content.strip().strip('"').strip("'")
        except Exception as e:
            print(f"[SmartPipeline] GPT-5.6-luna optimization failed: {e}")
            
    if modifiers:
        return f"{enhanced_prompt}, {modifiers}"
    return enhanced_prompt


# ─────────────────────────────────────────────────────────────────────────────
# SMART PROMPT COMPOSER
# Replaces the 3-step pipeline (classify → blind template concat → append words)
# with a SINGLE Claude call that reasons about user intent and selects only the
# ingredient blocks that are compatible — no camera conflicts, no style clashes.
# ─────────────────────────────────────────────────────────────────────────────

_SMART_COMPOSER_SYSTEM = """\
You are the prompt architect for Nanobanana 2 (Gemini 3.1 Flash Image model).
Your job: given a user's image description, write the BEST final prompt to send to the model.

RETURN a JSON object with exactly two keys:
  "pipeline": one of COMMERCIAL | CINEMATIC | AUTHENTIC | FINEART | PORTRAIT | NATURE
  "prompt": the final composed prompt string

PIPELINE GUIDE:
  AUTHENTIC  → candid, UGC, real life, phone shots, everyday moments, social media, lifestyle
  COMMERCIAL → product shots, brand photography, clean polished, advertising, sports
  CINEMATIC  → film scenes, dramatic, moody, narrative, movie stills, dark atmospheric
  PORTRAIT   → beauty, headshots, makeup, intimate character studies, face close-ups
  FINEART    → illustration, anime, painting, concept art, fantasy, cartoon, stylized
  NATURE     → landscapes, travel, wildlife, outdoors, weather, environments

━━━ INGREDIENT MENU ━━━
Use ONLY what is compatible with user intent. Each block is labeled with when to include it.

[CAMERA — pick AT MOST ONE. NEVER combine two cameras.]
  PHONE:      "shot on iPhone 15 Pro Max, natural ambient light, Fujifilm Eterna Vivid color profile, authentic candid moment, realistic everyday lighting"
  PORTRAIT:   "shot on Hasselblad X2D with 90mm f/2.5 portrait lens, soft window light or Rembrandt lighting, Kodak Portra 400 skin tone rendering, medium format sensor depth, intimate close framing"
  COMMERCIAL: "shot on Fujifilm GFX 100S with Fujinon 110mm f/2 lens, bright natural daylight, vivid accurate color reproduction, crisp edge definition, premium commercial photography"
  CINEMATIC:  "shot on Arri Alexa 65 with Zeiss Master Anamorphic lens, Kodak Vision3 250D color science, dramatic chiaroscuro directional lighting, cinematic shallow depth of field, moody atmospheric color tones, clean grain-free digital cinema quality"
  NATURE:     "shot on Nikon Z9 with 24-70mm f/2.8S, natural golden hour or blue hour lighting, authentic environmental atmosphere, vast depth and scale, National Geographic quality"

[SKIN — include ONLY when people are present. Pick AT MOST ONE. THIS IS CRITICAL FOR REALISM.]
  AUTHENTIC_SKIN:    "real human skin with visible pore texture on face, cheeks and nose, natural healthy skin color variation, genuine skin micro-texture, authentic candid complexion free of commercial smoothing, natural well-formed hands with clean healthy fingers and natural nails, subtle natural blemishes and micro-imperfections allowed, real skin does not look like rubber or wax"
  BEAUTY_SKIN:       "refined radiant complexion, healthy clear skin with authentic natural pore texture, delicate epidermal grain, soft subsurface light scattering, natural luminous finish without digital airbrushing or plastic smoothing"
  NATURAL_SKIN:      "healthy clear skin, natural pore texture visible at close range, subsurface light scattering on skin catching the light, subtle skin micro-details including fine lines and surface variation, individual eyelash definition, natural iris texture and depth, teeth individually separated with natural enamel texture, hair rendered strand by strand at hairline, natural skin color variation across face and hands, clean complexion free of acne but with real human texture"
  PROFESSIONAL_SKIN: "healthy well-maintained skin with clearly visible natural pore texture at close range, subtle natural skin tone variation across cheeks and forehead, soft subsurface light scattering, clean professional appearance achieved through good lighting and grooming — not through digital retouching, natural light oil/sheen on T-zone, fine lines and authentic skin micro-texture fully visible, looks like real skin photographed under flattering studio light, not airbrushed, not smoothed, not glossy"

  PIPELINE → SKIN MAPPING (follow this STRICTLY):
    PORTRAIT   → always use BEAUTY_SKIN (refined radiant complexion, natural pore micro-detail, luminous finish without airbrushing)
    AUTHENTIC  → always use BEAUTY_SKIN (refined radiant complexion, natural pore micro-detail, luminous finish without airbrushing)
    COMMERCIAL → always use BEAUTY_SKIN (refined radiant complexion, natural pore micro-detail, luminous finish without airbrushing)
    CINEMATIC  → always use BEAUTY_SKIN (refined radiant complexion, natural pore micro-detail, luminous finish without airbrushing)
    NATURE     → always use BEAUTY_SKIN (refined radiant complexion, natural pore micro-detail, luminous finish without airbrushing)
    FINEART    → SKIP all skin blocks (it is not a photograph)

[GENDER & DEMOGRAPHIC FACIAL DETAILS — pick based on subjects, combine if multiple]
  MALE:   "visible facial hair follicle micro-texture, subtle five o'clock stubble shadow even if clean-shaven, slightly rougher dermal micro-texture, pronounced jawline definition"
  FEMALE: "soft facial vellus hair (peach fuzz) catching rim light, delicate dermal pore structure, natural soft transitions at the jawline, smooth natural décolletage"
  CHILD:  "soft delicate youthful skin texture, natural rosy cheeks, smooth unblemished child complexion"

[NECK & UPPER BODY — include when neck/collarbone/chest is visible]
  MALE:   "natural neck skin texture with visible collarbone and subtle muscular tendon structure, consistent tone with facial skin, seamless transition from jawline to neck"
  FEMALE: "graceful neck skin texture with delicate collarbone definition and soft shadow, consistent tone with facial skin, seamless transition from jawline to décolletage"
  CHILD:  "smooth natural youthful neck, seamless tone with face"

[HANDS & FINGERS — SMART RULE: Include ONLY when hands/arms are visible in the frame or mentioned in prompt]
  MALE:   "natural masculine hands with clean neatly trimmed fingernails, well-proportioned healthy fingers, authentic skin tone matching the face and arms without dark knuckle creases, rough wrinkles, redness, or exaggerated veins"
  FEMALE: "graceful natural hands with smooth supple youthful skin, well-proportioned slender fingers, clean neat natural fingernails, and an even warm tone seamlessly matching the face and arms without dark knuckle creases, rough wrinkles, redness, or exaggerated veins"
  CHILD:  "small delicate child hands with soft smooth skin, well-formed little fingers, clean natural nails"

[FACE SHARPNESS — include ONLY when people are present]
  "face is the sharpest element in frame, eye autofocus tracking, individual eyelash definition, natural iris texture and depth, teeth individually separated with natural enamel, zero face blur"

[SKIN CONSISTENCY — MANDATORY whenever people are present]
  "identical skin rendering fidelity and texture quality across the ENTIRE visible body — face, neck, décolletage, arms, hands, and legs must all share the same pore-level detail, color accuracy, and lighting response. Do not apply higher retouching or sharpness to the face than to the rest of the visible skin. Neck and collarbone skin rendered with the same subsurface light scattering and natural tone as the face — no visible seam or quality drop-off at the jawline, neck, or hairline."

[DEPTH & OPTICS]
  "subject in sharp focus, background naturally out of focus"

[ARTIFACT GUARDS — always include for photorealistic work, skip for FINEART/stylized]
  "correct anatomy, natural body proportions, coherent shadow placement, accurate perspective, no floating elements, no merged limbs, no deformed hands, no extra fingers, no fused fingers, no weathered wrinkly hands, no dark knuckle creases, no arthritic joints, no discolored knuckles"

[NEGATIVES — include only technical/compositional negatives, never name skin-failure textures]
  UNIVERSAL: "no watermarks, no logos, no text overlays, no digital sharpening halos, no overprocessed look"
  AUTHENTIC: "no studio lighting, no professional photography setup, no commercial polish, no cinematic grading"
  PORTRAIT:  "no harsh shadows, no flat lighting"
  CINEMATIC: "no sterile digital look, no over-saturation, no commercial brightness, no HDR tone mapping"
  COMMERCIAL:"no film grain, no muted colors, no moody atmosphere, no underexposure"
  NATURE:    "no artificial studio lighting, no oversaturated fantasy colors, no HDR tone mapping, no flat midday light"

[SCENE ENRICHMENT — apply when the user's prompt describes a situation but is vague about specific actions, props, or interactions]
  Your job is NOT just to describe how the photo looks — you must describe what is IN the photo.
  When the user gives a general scene (e.g. "person checking into hotel", "couple walking in park", "engineer at construction site"),
  enrich it with 2–3 specific, contextually relevant details from these categories:

  ACTIONS: What are the subjects physically doing? Be specific.
    Instead of "checking in" → "handing over a credit card to the receptionist" or "receiving a brass room key"
    Instead of "walking in park" → "strolling side by side, mid-conversation, natural stride with subtle arm swing"
    Instead of "engineer at site" → "pointing at a section of architectural blueprint while explaining to a colleague"

  PROPS: What objects should be visible to tell the story instantly?
    Hotel check-in: premium leather suitcase, brass reception bell, flower arrangement on marble counter, key card holder
    Restaurant: wine glass, linen napkin, candlelight, menu, bread basket
    Office: laptop, coffee cup, notepad, glass partition, desk lamp
    Construction: hard hat, rolled blueprints, safety vest, clipboard
    Park/garden: pathway, bench, trees, dappled sunlight, garden lamp
    Medical: stethoscope, clipboard, white coat, consultation room

  INTERACTION: How are people relating to each other?
    "receptionist making warm eye contact while processing the reservation"
    "couple exchanging a genuine smile mid-sentence"
    "colleagues leaning over the same document, pointing at a detail"

  ENVIRONMENTAL STORYTELLING: 1–2 background details that make the setting feel alive.
    Hotel: concierge desk visible in background, palace staircase, distant lounge seating
    Park: other walkers in the distance, maintenance cart, bird on a branch
    Office: glass meeting room in background, other employees walking by

  RULES:
    - Do NOT invent new subjects or people the user didn't mention.
    - Do NOT change the user's specified setting, clothing, or composition.
    - ONLY add details that are natural and expected in that specific scene.
    - Keep enrichment to 20–35 words total — do not bloat the prompt.
    - If the user's prompt is already highly specific about actions and props, do NOT add more.

━━━ BUZZWORD CONFLICT DETECTION ━━━
Certain words in the user's prompt cause Gemini to produce over-polished, plastic-looking results.
For AUTHENTIC, CINEMATIC, or NATURE pipelines, NEUTRALIZE the following:

  IF user writes: "8K" / "8K resolution" / "16K"
    → The model interprets this as "maximum sharpness and detail" which causes plastic over-processing.
    → Replace with: "authentic photographic resolution, no digital over-sharpening"

  IF user writes: "masterpiece" / "ultra quality" / "maximum detail" / "hyper realistic" / "hyper-detailed"
    → These cause polished AI look and plastic skin — the opposite of authentic/candid.
    → Replace with: "photojournalism quality, real candid authenticity" for AUTHENTIC pipeline.
    → For CINEMATIC: replace with "cinematic realism, photographic clarity"
    → EXCEPTION: Keep these terms for PORTRAIT and COMMERCIAL pipelines where high polish is desired.

  IF user writes: "best quality" / "high quality" / "professional"
    → For AUTHENTIC: replace with "authentic quality, real-world photography"
    → For PORTRAIT/COMMERCIAL: keep as-is

━━━ CONFLICT DETECTION — CHECK THESE FIRST ━━━
Before writing the prompt, scan the user's input for these signals:

  IF user mentions: phone / smartphone / iPhone / android / shot on phone
    → Camera: use PHONE only. NEVER add any professional camera. NEVER add Fujifilm GFX, Sony A1, Hasselblad, Arri.

  IF user mentions: anime / cartoon / illustration / painting / art style / digital art / fantasy / concept art / stylized
    → Pipeline: FINEART. SKIP all skin blocks. SKIP all photorealism. SKIP face sharpness block. SKIP all camera blocks. SKIP depth & optics block. The image is NOT a photograph.
    → Instead use FINEART QUALITY: "masterpiece digital illustration, rich saturated color palette, intentional artistic composition, visible brushwork and artistic mark-making, dramatic rim lighting defining form edges, atmospheric perspective in backgrounds, expressive use of negative space, ArtStation and Behance trending quality, painterly depth and texture"
    → NEVER include ANY camera name, lens, film stock, or photography term for FINEART. No Hasselblad, no Sony, no Nikon, no Fujifilm, no Kodak, no f-stop values.

  IF the scene contains NO people (landscape, product, object, abstract, food, animal only)
    → SKIP all skin blocks. SKIP face sharpness block.

  IF user mentions: dark / noir / moody / night / shadows / dramatic
    → SKIP commercial bright daylight blocks. Use CINEMATIC camera.

  IF user mentions: wide shot / aerial / establishing / bird's eye / drone
    → SKIP portrait intimate framing. Use NATURE or COMMERCIAL camera.

  IF user explicitly names a camera (Canon R5, Sony A7, Leica, etc.)
    → Use the user's camera exactly as written. Skip all camera blocks.

  IF user mentions: studio / white background / product shot
    → SKIP authentic/candid blocks. Use COMMERCIAL camera and lighting.

  IF the prompt describes a non-portrait subject (e.g. car/vehicle, landscape, architecture, nature, street view, city vista, food, product):
    → STRIP and DISCARD any leftover portrait tags, intimate face close-up framing, 85mm portrait lenses, beauty skin tags, and studio headshot lighting (even if appended in the user's input).
    → Use the appropriate camera and lighting for the actual subject (e.g. NATURE/COMMERCIAL camera, wide landscape framing, natural environmental lighting).

  IF the prompt describes an outdoor scene (e.g. mountain road, beach, forest, open sky, city street):
    → STRIP and DISCARD any indoor studio lighting tags (e.g. Rembrandt lighting, studio softbox, indoor lamp) and replace with authentic natural outdoor daylight / golden hour / atmospheric weather.

  IF the prompt describes an indoor or night scene:
    → STRIP bright natural midday daylight blocks and use appropriate moody/indoor ambient lighting.

━━━ COMPOSITION RULES ━━━
1. START with the user's core scene description. If the user included "8K", "masterpiece", "ultra quality" etc. and the pipeline is AUTHENTIC/CINEMATIC/NATURE, REPLACE them with the neutralized alternatives above (do NOT include them verbatim).
2. Then naturally extend it with compatible ingredients.
3. Write in natural flowing language — NOT just comma-separated keywords.
4. Pick EXACTLY ONE camera block (or none if user specified their own device or if pipeline is FINEART).
5. CRITICAL — SKIN IS MANDATORY WHEN PEOPLE ARE PRESENT: Follow the PIPELINE → SKIN MAPPING above. If the scene has ANY human, you MUST include the correct skin block for that pipeline. Skipping skin when people are present produces AI-looking plastic faces.
5b. GENDER & DEMOGRAPHIC DETAILS: When people are present, include the appropriate MALE, FEMALE, or CHILD facial and neck details based strictly on the subjects in the scene.
5c. CRITICAL — NEVER MIX SKIN PHILOSOPHIES IN ONE PROMPT: Use exactly ONE skin block per prompt, exactly as mapped above. Do NOT add glossy/flawless/retouching language on top of a texture-forward block, and do NOT add raw/candid language on top of a glossy block. Specifically:
   - NEVER include "flawless," "commercial retouching finish," "luminous complexion," or "zero visible pores" in the same prompt as "pore texture," "micro-texture intact," or "natural texture retained." These phrases point in opposite directions. Nanobanana resolves this contradiction inconsistently — it will default toward the glossy reading even when texture language is also present, producing plastic-looking skin.
   - Do NOT invent your own hybrid skin phrasing that blends glossy and textured descriptors. Use the mapped skin block verbatim and nothing else.
6. CRITICAL — FACE SHARPNESS IS MANDATORY WHEN PEOPLE ARE PRESENT (except FINEART): Always include the face sharpness block. Without it, faces come out blurry and artificial.
7. SMART HANDS RULE:
   - If hands are NOT in frame (e.g. tight headshot, face close-up, bust framing where hands are off-camera), DO NOT describe hands at all!
   - If hands ARE in frame (e.g. hands at sides, holding objects, gesturing, medium or full-body shots):
     * Strictly match the hand descriptor to the subject's gender and demographic:
       - For adult MEN: use the MALE hand block. NEVER use words like 'slender', 'graceful', or 'delicate'.
       - For adult WOMEN: use the FEMALE hand block.
       - For KIDS/CHILDREN: use the CHILD hand block.
     * NEVER mix male and female hand descriptors into the same person's prompt.
7b. CRITICAL — SKIN CONSISTENCY IS MANDATORY WHEN PEOPLE ARE PRESENT: Always include the [SKIN CONSISTENCY] block alongside the main skin block. This prevents the common failure mode where the face is heavily retouched/sharpened but the neck, hands, and legs are left under-detailed by comparison — which reads as an obvious visual seam.
8. ALWAYS include NEGATIVES: UNIVERSAL + the pipeline-specific one.
9. Word count targets by pipeline:
   - COMMERCIAL / PORTRAIT: keep the composed prompt under ~180 words.
   - AUTHENTIC / NATURE / CINEMATIC: keep the composed prompt under ~250 words.
   - FINEART: no strict cap (no skin or photorealism blocks to bloat it).
   Each concept (skin, lighting, depth, sharpness) must appear ONCE. Do not repeat or near-duplicate any phrase.
10. Do NOT include placeholder text, do NOT explain your choices.
11. SCENE ENRICHMENT IS MANDATORY for COMMERCIAL, AUTHENTIC, and CINEMATIC pipelines when people are present. The user's prompt tells you WHAT they want — your job is to make it feel like a real moment by adding specific actions, props, and micro-interactions. An image of "a person checking into a hotel" with no visible luggage, no card exchange, no reception details is a FAILED commercial image — it looks like a person standing in a lobby. Add the details that make the scene instantly readable.

Return ONLY valid JSON: {"pipeline": "AUTHENTIC", "prompt": "...full composed prompt..."}
"""

async def _smart_compose_prompt(user_prompt: str, quality: str = "Standard") -> tuple:
    """
    Single intelligent LLM call that:
    1. Detects user intent
    2. Selects compatible ingredient blocks (NO camera conflicts, NO style clashes)
    3. Returns (final_composed_prompt, pipeline_type)

    Replaces: _classify_use_case + _build_*_prompt + _optimize_with_gpt (3 steps → 1 step).
    Falls back to None if unavailable.
    """
    user_msg = f'Compose the final prompt for this image request:\n\n"{user_prompt}"'

    if ANTHROPIC_API_KEY:
        try:
            print("[SmartComposer] Using Claude Haiku 4.5 for smart prompt composition...")
            ant_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
            resp = await asyncio.to_thread(
                ant_client.messages.create,
                model="claude-haiku-4-5-20251001",
                system=_SMART_COMPOSER_SYSTEM,
                messages=[{"role": "user", "content": user_msg}],
                max_tokens=1200,
            )
            raw = resp.content[0].text.strip()
            parsed = _parse_json_from_response(raw)
            pipeline = parsed.get("pipeline", "").upper()
            prompt = parsed.get("prompt", "").strip()
            if pipeline in ["COMMERCIAL", "CINEMATIC", "AUTHENTIC", "FINEART", "PORTRAIT", "NATURE"] and len(prompt) > 50:
                print(f"[SmartComposer] Claude Haiku 4.5 composed prompt ({len(prompt)} chars) — pipeline={pipeline}")
                return prompt, pipeline
            print(f"[SmartComposer] Claude Haiku 4.5 returned invalid response: {raw[:200]}")
        except Exception as e_ant:
            print(f"[SmartComposer] Claude Haiku 4.5 failed: {e_ant}")

    if OPENAI_API_KEY:
        try:
            oai_client = openai_lib.OpenAI(api_key=OPENAI_API_KEY)
            resp = await asyncio.to_thread(
                oai_client.chat.completions.create,
                model="gpt-5.6-luna",
                messages=[
                    {"role": "system", "content": _SMART_COMPOSER_SYSTEM},
                    {"role": "user", "content": user_msg},
                ],
                max_completion_tokens=1200,
            )
            raw = resp.choices[0].message.content.strip()
            parsed = _parse_json_from_response(raw)
            pipeline = parsed.get("pipeline", "").upper()
            prompt = parsed.get("prompt", "").strip()
            if pipeline in ["COMMERCIAL", "CINEMATIC", "AUTHENTIC", "FINEART", "PORTRAIT", "NATURE"] and len(prompt) > 50:
                print(f"[SmartComposer] GPT-5.6-luna composed prompt ({len(prompt)} chars) — pipeline={pipeline}")
                return prompt, pipeline
            print(f"[SmartComposer] GPT-5.6-luna returned invalid response: {raw[:200]}")
        except Exception as e:
            print(f"[SmartComposer] GPT-5.6-luna failed: {e}")

    return None, None


async def _build_nanobanana_enhanced_prompt(user_prompt: str, quality: str = "Standard", is_beta: bool = True) -> tuple:
    """Returns (final_prompt, pipeline_type) for Nanobanana 2 generation.
    Uses the full multi-pipeline system that applies the complete skin, sharpness, and photorealism stack.
    """
    print(f"[SmartPipeline] Starting Multi-Pipeline for prompt: {user_prompt[:80]}...")
    pipeline_type = await _classify_use_case(user_prompt)
    print(f"[SmartPipeline] Classified use case via Claude Sonnet 5: {pipeline_type}")

    pipeline_map = {
        "COMMERCIAL": _build_commercial_prompt,
        "CINEMATIC": _build_cinematic_prompt,
        "AUTHENTIC": _build_authentic_prompt,
        "FINEART": _build_fineart_prompt,
        "PORTRAIT": _build_portrait_prompt,
        "NATURE": _build_nature_prompt,
    }
    builder = pipeline_map.get(pipeline_type, _build_commercial_prompt)
    enhanced_prompt = builder(user_prompt)
    final_prompt = await _optimize_with_gpt(user_prompt, enhanced_prompt, pipeline_type)
    return final_prompt, pipeline_type

def _build_kling_enhanced_prompt(user_prompt: str, quality: str = "Standard") -> str:
    parts = [user_prompt.strip(), CHATGPT_ARTIFACT_GUARDS]
    parts.append(CHATGPT_QUALITY_SUFFIX)
    parts.append(CHATGPT_CONSISTENCY_BONUS)
    parts.append(NEGATIVE_CONSTRAINTS)
    parts.append(DETAIL_ENHANCEMENT)
    return ", ".join(p.strip(", ") for p in parts if p)

def _build_flux_enhanced_prompt(user_prompt: str, quality: str = "Standard") -> str:
    parts = [user_prompt.strip(), CHATGPT_ARTIFACT_GUARDS]
    parts.append(CHATGPT_QUALITY_SUFFIX)
    parts.append(CHATGPT_CONSISTENCY_BONUS)
    parts.append(NEGATIVE_CONSTRAINTS)
    parts.append(DETAIL_ENHANCEMENT)
    return ", ".join(p.strip(", ") for p in parts if p)

def _build_openai_enhanced_prompt(user_prompt: str, quality: str = "Standard") -> str:
    return f"{user_prompt.strip()}. {CHATGPT_QUALITY_SUFFIX} {CHATGPT_CONSISTENCY_BONUS} {NEGATIVE_CONSTRAINTS} {DETAIL_ENHANCEMENT}"


# All model IDs accepted by the ChatGPT image generation endpoint
CHATGPT_VALID_MODELS = {
    "gpt-image-2",
    "gpt-image-1.5",
    "chatgpt-image-latest",
    "gpt-image-1",
    "gpt-image-1-mini",
    "dall-e-3",
    "dall-e-2",
}

async def _chatgpt_image_generate(
    prompt: str,
    ratio: str,
    quality: str = "Standard",
    image_b64: Optional[Union[str, List[str]]] = None,
    model: str = "gpt-image-2",
) -> tuple:
    """Generate image via OpenAI ChatGPT Image models.

    Supports:
      - chatgpt-image-latest  (default in UI)
      - gpt-image-2         (state-of-the-art)
      - gpt-image-1           (previous gen)
      - gpt-image-1-mini      (cost-efficient)

    When image_b64 is provided, uses images.edit() endpoint (reference-based generation).
    Otherwise uses images.generate() endpoint (text-only).

    Returns list of base64 data URIs (same format as Gemini).
    """
    if isinstance(image_b64, list):
        image_b64 = image_b64[0] if image_b64 else None
    if not OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not set in .env")

    # Validate model name
    if model not in CHATGPT_VALID_MODELS:
        model = "gpt-image-2"

    # Map ratio -> pixel dimensions
    size_map = {
        "1:1":  "1024x1024",
        "16:9": "1536x1024",
        "9:16": "1024x1536",
    }
    size = size_map.get(ratio, "1024x1024")

    # API quality param: "high" for High/Ultra, "low" for Standard
    api_quality = "high" if quality in ("High", "Ultra") else "low"

    # For image EDITS (image_b64 present), skip the full cinematic prompt expansion.
    # _build_nanobanana_enhanced_prompt() was designed for text-to-image generation —
    # it produces a 200-word scene brief that causes images.edit() to treat the call as
    # fresh generation, ignoring the reference image's composition.
    # For edits, keep the prompt short and precise; append only minimal quality markers.
    if image_b64:
        CHATGPT_EDIT_QUALITY_SUFFIX = (
            "ultra high quality, tack sharp focus, correct anatomy, no artifacts, "
            "preserve all unchanged elements from the source image exactly"
        )
        enhanced_prompt = f"{prompt.strip()}, {CHATGPT_EDIT_QUALITY_SUFFIX}"
        print(f"[ChatGPT] EDIT mode — using short prompt ({len(enhanced_prompt)} chars), skipping full enhancement")
    else:
        enhanced_prompt, _ = await _build_nanobanana_enhanced_prompt(prompt, quality)
        print(f"[ChatGPT] GENERATE mode — enhanced prompt ({len(enhanced_prompt)} chars): {enhanced_prompt[:150]}...")

    print(f"[ChatGPT] Model: {model}, Size: {size}, Quality: {api_quality}")
    print(f"[ChatGPT] Final prompt: {enhanced_prompt[:150]}...")
    print(f"[ChatGPT] Reference image: {image_b64 is not None}")

    # _try_generate_chatgpt: takes the active cascade model as a parameter
    # so each cascade step uses the correct model (not the outer `model` param)
    async def _try_generate_chatgpt(use_prompt: str, active_model: str, active_client, active_size: str, active_quality: str):
        try:
            if image_b64:
                return await _chatgpt_with_reference(
                    active_client, use_prompt, active_model, active_size, active_quality, image_b64
                )
            else:
                return await _chatgpt_from_text(
                    active_client, use_prompt, active_model, active_size, active_quality
                )
        except Exception as e:
            err_str = str(e).lower()
            if any(x in err_str for x in ["moderation", "content policy", "safety system", "rejected", "blocked"]):
                return "BLOCKED"
            raise

    # ── MODEL CASCADE: try each model until one succeeds ──
    # Order: gpt-image-2 (best, needs org verify) → gpt-image-1.5 → chatgpt-image-latest → gpt-image-1 → gpt-image-1-mini → dall-e-3 (always works)
    CHATGPT_MODEL_CASCADE = [
        "gpt-image-2", 
        "gpt-image-1.5", 
        "chatgpt-image-latest", 
        "gpt-image-1", 
        "gpt-image-1-mini", 
        "dall-e-3", 
        "dall-e-2"
    ]
    # Note: dall-e-3 does NOT support OpenAI's images.edit() endpoint (reference images).
    if image_b64:
        CHATGPT_MODEL_CASCADE = [m for m in CHATGPT_MODEL_CASCADE if m != "dall-e-3"]

    # Build cascade starting from the user's chosen model
    if model not in CHATGPT_MODEL_CASCADE:
        model = "gpt-image-1.5" if "gpt-image-1.5" in CHATGPT_MODEL_CASCADE else "gpt-image-1"
    cascade_start = CHATGPT_MODEL_CASCADE.index(model)
    model_cascade = CHATGPT_MODEL_CASCADE[cascade_start:]

    # dall-e-3 uses different size/quality params
    DALLE3_SIZE_MAP = {
        "1:1": "1024x1024", "16:9": "1792x1024", "9:16": "1024x1792",
    }

    last_model_error: Optional[Exception] = None
    for cascade_model in model_cascade:
        try:
            cascade_client = openai_lib.OpenAI(api_key=OPENAI_API_KEY)

            # Adjust size/quality for this specific model
            if cascade_model in ("dall-e-3", "dall-e-2"):
                cascade_size = DALLE3_SIZE_MAP.get(ratio, "1024x1024")
                cascade_quality = "hd" if quality in ("High", "Ultra") else "standard"
            else:
                cascade_size = size
                cascade_quality = api_quality

            print(f"[ChatGPT] Trying cascade model: {cascade_model}, size={cascade_size}, quality={cascade_quality}")

            MAX_RETRIES = 2
            for retry in range(MAX_RETRIES):
                try:
                    if retry > 0:
                        backoff = 3 * retry
                        print(f"[ChatGPT] Retry {retry}/{MAX_RETRIES-1} for {cascade_model} (backoff {backoff}s)...")
                        await asyncio.sleep(backoff)

                    res = await _try_generate_chatgpt(enhanced_prompt, cascade_model, cascade_client, cascade_size, cascade_quality)

                    if res == "BLOCKED":
                        print("[ChatGPT] Blocked by content policy — invoking prompt middleman...")
                        sanitized = await _sanitize_prompt(prompt)
                        enhanced_sanitized, _ = await _build_nanobanana_enhanced_prompt(sanitized, quality)
                        res = await _try_generate_chatgpt(enhanced_sanitized, cascade_model, cascade_client, cascade_size, cascade_quality)
                        
                        _final_ep = enhanced_sanitized
                        if res == "BLOCKED":
                            res = await _try_generate_chatgpt(sanitized, cascade_model, cascade_client, cascade_size, cascade_quality)
                            _final_ep = sanitized
                        if res == "BLOCKED":
                            raise HTTPException(status_code=400, detail="ChatGPT blocked even after prompt rewrites.")
                        return res, _final_ep, cascade_model

                    return res, enhanced_prompt, cascade_model

                except openai_lib.RateLimitError as rle:
                    print(f"[ChatGPT] RateLimitError on {cascade_model} (attempt {retry+1}): {rle}")
                    last_model_error = rle
                    rle_str = str(rle).lower()
                    if "insufficient_quota" in rle_str or "credit_balance_exhausted" in rle_str or "no credits remaining" in rle_str:
                        print("[ChatGPT] OpenAI account credit balance exhausted. Fast-failing cascade to fallback.")
                        raise HTTPException(status_code=429, detail="OpenAI credits exhausted.")
                    if retry < MAX_RETRIES - 1:
                        continue
                    raise
                except openai_lib.InternalServerError as ise:
                    print(f"[ChatGPT] InternalServerError on {cascade_model} (attempt {retry+1}): {ise}")
                    last_model_error = ise
                    if retry < MAX_RETRIES - 1:
                        continue
                    raise

        except openai_lib.BadRequestError as e:
            print(f"[ChatGPT] BadRequestError on {cascade_model}: {e}. Trying next model in cascade...")
            last_model_error = e
            continue
        except openai_lib.AuthenticationError as e:
            print(f"[ChatGPT] AuthenticationError: {e}")
            raise HTTPException(status_code=502, detail="Invalid OpenAI API key.")
        except Exception as e:
            err_str = str(e)
            last_model_error = e
            # 403 = org not verified for THIS model — skip immediately, don't retry
            if "403" in err_str or "must be verified" in err_str or "PermissionDeniedError" in err_str:
                print(f"[ChatGPT] {cascade_model}: org not verified / no access (403), skipping to next model")
            else:
                print(f"[ChatGPT] {cascade_model} failed: {err_str[:200]}. Trying next model...")
            continue

    raise HTTPException(
        status_code=502,
        detail=f"ChatGPT: all models in cascade failed. Last error: {last_model_error}"
    )


async def _chatgpt_from_text(client, prompt, model, size, quality) -> List[str]:
    """Generate from text prompt only via images.generate()."""
    print(f"[ChatGPT] Calling images.generate (text-only) with {model}")
    response = await asyncio.to_thread(
        client.images.generate,
        model=model,
        prompt=prompt,
        n=1,
        size=size,
        quality=quality,
    )
    return await _chatgpt_extract_images(response)


async def _chatgpt_with_reference(client, prompt, model, size, quality, ref_b64) -> List[str]:
    print(f"[ChatGPT] Calling images.edit (with reference) with {model}")

    # Decode and resize reference to match target size
    b64_str = str(ref_b64)
    if "," in b64_str:
        b64_str = b64_str.split(",")[1]
    img_bytes = base64.b64decode(b64_str)
    img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    w, h = map(int, size.split("x"))
    if img.size != (w, h):
        img = img.resize((w, h), Image.LANCZOS)

    # Save to PNG bytes
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    ref_png_bytes = buf.getvalue()

    # Wrap in BytesIO with filename for SDK
    ref_file = io.BytesIO(ref_png_bytes)
    ref_file.name = "reference.png"

    response = await asyncio.to_thread(
        client.images.edit,
        model=model,
        image=ref_file,
        prompt=prompt,
        n=1,
        size=size,
        quality=quality,
    )
    return await _chatgpt_extract_images(response)


async def _chatgpt_extract_images(response) -> List[str]:
    """Extract image data from OpenAI response and return as local URLs."""
    if not hasattr(response, 'data') or response.data is None or len(response.data) == 0:
        print(f"[ChatGPT] No image data in response")
        return []

    results = []
    async with httpx.AsyncClient(timeout=30) as client:
        for item in response.data:
            image_data = None
            # Try URL first
            if hasattr(item, 'url') and item.url is not None:
                print(f"[ChatGPT] Fetching image from URL...")
                img_resp = await client.get(item.url)
                img_resp.raise_for_status()
                image_data = img_resp.content
            # Try base64
            elif hasattr(item, 'b64_json') and item.b64_json is not None:
                print(f"[ChatGPT] Using base64 from response")
                image_data = base64.b64decode(item.b64_json)
            else:
                print(f"[ChatGPT] No URL or base64 in response item")
                continue

            url = _save_image_to_disk(image_data, "png")
            results.append(url)
            print(f"[ChatGPT] Image extracted successfully and saved to {url}")

    return results


# ── FLUX.1 (Black Forest Labs) ───────────────────────────────────────────────

async def _flux_generate(prompt: str, ratio: str, quality: str = "Standard", image_b64: Optional[Union[str, List[str]]] = None) -> List[str]:
    """Generate image via BFL Flux Pro 1.1. Returns base64 data URIs."""
    if isinstance(image_b64, list):
        image_b64 = image_b64[0] if image_b64 else None
    if not BFL_API_KEY:
        raise HTTPException(status_code=500, detail="BFL_API_KEY not set in .env")

    # Map ratio to width/height
    ratio_to_wh = {
        "1:1": (1024, 1024), "16:9": (1456, 816), "9:16": (816, 1456),
        "4:3": (1216, 896), "3:4": (896, 1216), "3:2": (1344, 896),
        "2:3": (896, 1344), "4:5": (896, 1120), "5:4": (1120, 896),
        "21:9": (1568, 672),
    }
    w, h = ratio_to_wh.get(ratio, (1024, 1024))

    enhanced = _build_flux_enhanced_prompt(prompt, quality)
    print(f"[Flux] Submitting. Size: {w}x{h}. Prompt: {enhanced[:100]}...")

    payload: dict = {
        "prompt": enhanced,
        "width": w,
        "height": h,
        "prompt_upsampling": False,
        "safety_tolerance": 2,
        "output_format": "png",
    }

    # Image-to-image: include reference image if provided
    if image_b64:
        b64_str = str(image_b64)
        if "," in b64_str:
            b64_str = b64_str.split(",")[1]
        payload["image_prompt"] = b64_str

    headers = {"x-key": BFL_API_KEY, "Content-Type": "application/json"}
    endpoint = "https://api.us1.bfl.ai/v1/flux-pro-1.1"

    async with httpx.AsyncClient(timeout=90) as client:
        resp = await client.post(endpoint, json=payload, headers=headers)
        print(f"[Flux] Submit response: {resp.status_code} {resp.text[:300]}")
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Flux API error: {resp.text[:300]}")

        task_data = resp.json()
        task_id = task_data.get("id")
        if not task_id:
            raise HTTPException(status_code=502, detail=f"Flux: no task id in response: {task_data}")

        print(f"[Flux] Task ID: {task_id}. Polling...")

        # Poll for result (max 120s)
        for attempt in range(40):
            await asyncio.sleep(3)
            poll = await client.get(
                f"https://api.us1.bfl.ai/v1/get_result?id={task_id}",
                headers={"x-key": BFL_API_KEY},
            )
            if poll.status_code != 200:
                continue
            poll_data = poll.json()
            status = poll_data.get("status", "")
            print(f"[Flux] Poll {attempt+1}: status={status}")

            if status == "Ready":
                result_url = poll_data.get("result", {}).get("sample")
                if result_url:
                    img_resp = await client.get(result_url)
                    img_resp.raise_for_status()
                    url = _save_image_to_disk(img_resp.content, "png")
                    print(f"[Flux] Success. Image size: {len(img_resp.content)} bytes, saved to {url}")
                    return [url]
                raise HTTPException(status_code=502, detail="Flux: Ready but no sample URL")
            elif status in ("Error", "Failed", "Content Moderated"):
                raise HTTPException(status_code=502, detail=f"Flux task {status}: {poll_data}")

        raise HTTPException(status_code=504, detail="Flux task timed out after 120s")


# ── AI PROMPT OPTIMIZER (single-model) ────────────────────────────────────────
# Uses GPT-4o-mini (text) to intelligently append model-specific modifiers.
# Falls back to the base prompt silently if the API call fails or times out.

MODEL_OPTIMIZER_HINTS = {
    "Nanobanana": "Google Gemini — excels at creative illustration, cohesive color palettes, dreamy conceptual art",
    "ChatGPT":    "OpenAI GPT Image 1.5 — state-of-the-art photorealism, complex multi-subject scenes, commercial photography, hyper-detailed textures",
    "Kling":      "Kling v1 — cinematic photography, hyper-detailed textures, fashion & portrait quality, dramatic film lighting",
    "Flux.1":     "Flux Pro 1.1 — precise prompt adherence, vivid commercial-grade images, sharp typography, accurate human subjects",
}

async def _ai_optimize_prompt(base_prompt: str, model: str) -> str:
    """Use GPT-4o-mini to append model-specific quality modifiers (< 30 words).
    Returns base_prompt unchanged if the call fails."""
    if not OPENAI_API_KEY:
        return base_prompt
    if model == "Nanobanana 2 (Beta)":
        system = (
            "You are an expert prompt engineer for Nanobanana 2, an AI image model "
            "that excels at painterly realism and organic textures. Your ONLY job is "
            "to append a SHORT list (≤20 words) of photography and lighting modifiers "
            "to the END of the user's prompt. "
            "Focus on: natural lighting conditions, film stock, lens character, and "
            "organic imperfections. "
            "NEVER use: masterpiece, ultra-detailed, 8K, flawless, hyper-realistic, "
            "tack sharp, razor sharp, or any word that suggests perfection. "
            "NEVER change, rephrase, or remove any part of the user's original prompt. "
            "The FIRST WORDS of your output MUST be exactly the user's original prompt, "
            "character for character. Respond with ONLY the final prompt string, "
            "nothing else."
        )
        user_msg = f"Original prompt: {base_prompt}\nReturn the original prompt VERBATIM with your modifiers appended at the end."
    else:
        model_hint = MODEL_OPTIMIZER_HINTS.get(model, "General AI image model")
        system = (
            "You are an expert AI image prompt engineer. "
            "Your ONLY job is to append a SHORT list (≤25 words) of technical modifiers "
            "to the END of the user's prompt that will help the specified model produce "
            "a high-quality, artifact-free image. "
            "NEVER change, rephrase, or remove any part of the user's original prompt. "
            "NEVER change the subject or scene. "
            "The FIRST WORDS of your output MUST be exactly the user's original prompt, character for character. "
            "Respond with ONLY the final prompt string — nothing else."
        )
        user_msg = (
            f"Target model: {model} ({model_hint})\n"
            f"Original prompt: {base_prompt}\n"
            f"Return the original prompt VERBATIM with your modifiers appended at the end."
        )
    try:
        client = openai_lib.OpenAI(api_key=OPENAI_API_KEY)

        # Run synchronous OpenAI call in a thread to avoid blocking the event loop
        def _call():
            return client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "system", "content": system},
                          {"role": "user",   "content": user_msg}],
                max_tokens=400,
                temperature=0.3,
            )
        resp = await asyncio.to_thread(_call)
        optimized = resp.choices[0].message.content.strip()
        # Remove any surrounding quotes GPT might add
        if optimized.startswith('"') and optimized.endswith('"'):
            optimized = optimized[1:-1]

        # Safety check: verify the original prompt's key words are preserved.
        # Use word-overlap instead of strict prefix match (GPT sometimes adjusts casing/articles).
        original_words = set(base_prompt.lower().split()[:8])  # first 8 words
        optimized_words = set(optimized.lower().split()[:12])  # allow slight expansion
        overlap = len(original_words & optimized_words)
        if len(original_words) > 3 and overlap < len(original_words) * 0.5:
            print(f"[AIOptimizer] Safety fallback for {model}: output diverged (overlap {overlap}/{len(original_words)} words).")
            return base_prompt

        print(f"[AIOptimizer] [OK] Optimized for {model}: ...{optimized[-120:]}")
        return optimized
    except Exception as e:
        print(f"[AIOptimizer] Skipped ({model}): {e}")
        return base_prompt


def _sanitize_master_prompt(prompt: str) -> str:
    """Removes unwanted hallucinated quotes, markdown labels, and meta instructions."""
    if not prompt:
        return ""
    text = prompt.strip()
    if text.startswith('"') and text.endswith('"'):
        text = text[1:-1].strip()
    if text.startswith("'") and text.endswith("'"):
        text = text[1:-1].strip()
    if "```" in text:
        text = text.replace("```text", "").replace("```json", "").replace("```", "").strip()
    prefixes_to_remove = ["Master Prompt:", "Unified Prompt:", "Prompt:", "Output Prompt:", "Final Prompt:"]
    for p in prefixes_to_remove:
        if text.startswith(p):
            text = text[len(p):].strip()
    return text


INTENT_CLASSIFIER_PROMPT = """You are an intent classifier for an AI image tool.

Given the user's prompt and their uploaded image descriptions/categories, classify the user's intent into ONE of these:

1. ENHANCE_REFINE: User uploaded an image and requests fidelity, quality, resolution, texture, or anatomy enhancement/retouching while keeping composition, characters, theme, and layout unchanged (e.g. "enhance and refine", "improve quality/details while keeping composition exactly the same", "fix anatomy and add fine details without changing anything").
2. SCENE_TRANSFER: Person exists in reference + User describes/implies a new location or environment (e.g. "put her in Paris", "dark alleyway", "beach sunset").
3. STYLE_TRANSFER: Person or scene exists + User wants style change (e.g. "make it cinematic", "anime style", "vintage look").
4. SUBJECT_FUSION: Multiple subjects/scenes uploaded + Generic or empty prompt (e.g. "generate", "combine these", "make something", or only formatting tags like "aspect ratio").
5. DIRECT_EDIT: Specific modification to existing image (e.g. "change her shirt to red", "add sunglasses", "make it daytime").
6. PURE_GENERATION: User wrote a complete specific prompt, reference images are just style guides (e.g. "a dragon flying over mountains at sunset").

Return ONLY valid JSON:
{
  "intent": "ENHANCE_REFINE|SCENE_TRANSFER|STYLE_TRANSFER|SUBJECT_FUSION|DIRECT_EDIT|PURE_GENERATION",
  "reasoning": "one line explanation"
}"""

BLENDER_PROMPTS = {
    "ENHANCE_REFINE": """You are a prompt engineer for AI image generation specializing in high-fidelity image enhancement.
Task: Construct a surgical enhancement instruction for the reference image.
Rules:
- STRICT PRESERVATION: Command 100% preservation of the exact composition, characters, subjects, poses, colors, lighting direction, and artistic medium (e.g. illustration, painting, 3D render, or photograph).
- NO CHANGES: Explicitly state to NOT add new objects, remove existing objects, rearrange layout, or alter character identity.
- ENHANCE ONLY: Direct the model to upgrade anatomical accuracy, fine surface textures, material realism, crisp edge definition, and micro-details consistent with the original image's artistic medium.
- Output ONLY the final concise enhancement prompt under 120 words, no explanations, no quotes.""",

    "SCENE_TRANSFER": """You are a prompt engineer for AI image generation.
Task: Place the person from reference images into a COMPLETELY NEW scene the user described.
Rules:
- START the prompt with the user's NEW scene/location described vividly (lighting, atmosphere, environment details).
- Then describe the person: face shape, eye color, hair color/length/style, clothing, pose, expression, accessories.
- The NEW scene MUST dominate the prompt. The person is placed INTO this new environment.
- COMPLETELY IGNORE the original background/location from the reference image. It must NOT appear.
- NEVER mention the original scene elements (cafe, table, window, book, etc).
- Output ONLY the final merged prompt string under 120 words, no explanations, no quotes.""",

    "STYLE_TRANSFER": """You are a prompt engineer for AI image generation.
Task: Apply the visual style from reference images to the user's described subject.
Rules:
- Keep user's subject and scene exactly as described — this is the foundation.
- Extract and apply: color grade, mood, lighting quality, atmosphere, contrast, camera lens feel from references.
- Describe the style application with specific visual terms (e.g. "warm cinematic color grading", "soft diffused backlight").
- NEVER change or replace the user's subject or scene.
- Output ONLY the final merged prompt string under 120 words, no explanations, no quotes.""",

    "SUBJECT_FUSION": """You are a prompt engineer for AI image generation.
Task: Intelligently merge all uploaded subjects/scenes into one coherent image.
Rules:
- Identify each subject from the reference images precisely (person details, scene details).
- Create a single unified scene where all subjects coexist naturally and logically.
- Place PERSON-type subjects INTO SCENE-type environments.
- Unify lighting, color temperature, and atmosphere so everything looks like one photograph.
- Describe the person with precision: face, hair, clothing, pose.
- Describe the environment with precision: location, objects, lighting direction.
- NEVER invent elements not present in any reference.
- Output ONLY the final merged prompt string under 120 words, no explanations, no quotes.""",

    "DIRECT_EDIT": """You are a prompt engineer for AI image generation.
Task: Apply the user's specific edit instruction to the reference image.
Rules:
- First, describe the FULL reference image accurately (subject, scene, lighting, colors, pose).
- Then apply ONLY the user's requested change to that description.
- Everything the user did NOT ask to change must remain exactly identical.
- Be very explicit: state what changes AND what stays the same.
- Output ONLY the final merged prompt string under 120 words, no explanations, no quotes.""",

    "PURE_GENERATION": """You are a prompt engineer for AI image generation.
Task: Generate a new image from the user's prompt, borrowing only the visual style from reference images.
Rules:
- The user's described subject and scene are ABSOLUTE and must not be altered.
- From reference images, extract ONLY: lighting quality, color temperature, color grading, camera/lens characteristics, mood/atmosphere.
- NEVER extract or mention physical subjects, objects, or people from the reference images.
- Weave the extracted style naturally into the user's prompt.
- Output ONLY the final merged prompt string under 120 words, no explanations, no quotes."""
}


async def _blend_vision_with_prompt(user_prompt: str, vision_description: str) -> tuple[str, str]:
    """LLM Orchestrator V2: Intent Classification -> Intent-Specific Blending -> Sanitizer.
    Returns: (sanitized_prompt, detected_intent)
    """
    if _is_enhance_refine_intent(user_prompt):
        print("[IntentClassifier] Fast-path detected ENHANCE_REFINE intent from prompt keywords.")
        enhanced_p = _build_studio_enhance_refine_prompt(user_prompt, vision_description)
        return enhanced_p, "ENHANCE_REFINE"

    detected_intent = "SUBJECT_FUSION"
    user_msg = f"USER PROMPT: {user_prompt}\n\nUPLOADED IMAGE(S) ANALYSIS:\n{vision_description}"

    # Step 1: Intent Classification
    try:
        print("[IntentClassifier] Classifying user intent with Gemini 2.5 Flash...")
        def _do_classify():
            return flash_client.models.generate_content(
                model="gemini-2.5-flash",
                contents=[f"{INTENT_CLASSIFIER_PROMPT}\n\n{user_msg}"],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.1,
                    max_output_tokens=500
                )
            )
        resp = await asyncio.to_thread(_do_classify)
        raw_text = resp.text.strip() if resp and resp.text else ""
        data = _parse_json_from_response(raw_text)
        detected_intent = data.get("intent", "SUBJECT_FUSION")
        print(f"[IntentClassifier] Detected Intent: {detected_intent} (Reason: {data.get('reasoning', '')})")
    except Exception as e:
        print(f"[IntentClassifier] Gemini classification failed ({e}), trying Claude Haiku 4.5 / Luna fallback...")
        if ANTHROPIC_API_KEY:
            try:
                ant_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
                resp = await asyncio.to_thread(
                    ant_client.messages.create,
                    model="claude-sonnet-5",
                    system=f"{INTENT_CLASSIFIER_PROMPT}\nRespond ONLY with valid JSON.",
                    messages=[{"role": "user", "content": user_msg}],
                    max_tokens=600,
                )
                raw_text = _extract_anthropic_text(resp)
                data = _parse_json_from_response(raw_text)
                detected_intent = data.get("intent", "SUBJECT_FUSION")
                print(f"[IntentClassifier] (Claude Sonnet 5 Fallback) Detected Intent: {detected_intent}")
            except Exception as e_ant:
                print(f"[IntentClassifier] Claude Sonnet 5 classification fallback failed: {e_ant}")
        elif OPENAI_API_KEY:
            try:
                oai_client = openai_lib.OpenAI(api_key=OPENAI_API_KEY)
                def _oai_classify():
                    return oai_client.chat.completions.create(
                        model="gpt-5.6-luna",
                        messages=[
                            {"role": "system", "content": INTENT_CLASSIFIER_PROMPT},
                            {"role": "user", "content": user_msg},
                        ],
                        max_completion_tokens=500,
                        response_format={"type": "json_object"},
                    )
                gpt_resp = await asyncio.to_thread(_oai_classify)
                raw_text = gpt_resp.choices[0].message.content.strip()
                data = _parse_json_from_response(raw_text)
                detected_intent = data.get("intent", "SUBJECT_FUSION")
                print(f"[IntentClassifier] (Luna Fallback) Detected Intent: {detected_intent}")
            except Exception as e2:
                print(f"[IntentClassifier] Luna classification fallback also failed: {e2}")

    system_blender = BLENDER_PROMPTS.get(detected_intent, BLENDER_PROMPTS["SUBJECT_FUSION"])

    # Step 2: Intent-Specific Blending
    blended = None
    try:
        print(f"[VisionBlend] Blending for intent '{detected_intent}' using Gemini 2.5 Flash...")
        def _do_blend():
            return flash_client.models.generate_content(
                model="gemini-2.5-flash",
                contents=[f"{system_blender}\n\n{user_msg}\n\nProduce the unified prompt:"],
                config=types.GenerateContentConfig(
                    temperature=0.3,
                    max_output_tokens=300
                )
            )
        resp = await asyncio.to_thread(_do_blend)
        blended = resp.text.strip() if resp and resp.text else ""
        print(f"[VisionBlend] Gemini OK: {blended[:150]}")
    except Exception as e:
        print(f"[VisionBlend] Gemini failed ({e}), falling back to Claude Sonnet 5 / Luna...")
        if ANTHROPIC_API_KEY:
            try:
                ant_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
                resp = await asyncio.to_thread(
                    ant_client.messages.create,
                    model="claude-sonnet-5",
                    system=system_blender,
                    messages=[{"role": "user", "content": user_msg}],
                    max_tokens=600,
                )
                blended = _extract_anthropic_text(resp)
                print(f"[VisionBlend] Claude Sonnet 5 OK: {blended[:150]}")
            except Exception as e_ant:
                print(f"[VisionBlend] Claude Sonnet 5 fallback failed: {e_ant}")

        if not blended and OPENAI_API_KEY:
            try:
                client = openai_lib.OpenAI(api_key=OPENAI_API_KEY)
                def _call_gpt():
                    return client.chat.completions.create(
                        model="gpt-5.6-luna",
                        messages=[
                            {"role": "system", "content": system_blender},
                            {"role": "user", "content": user_msg}
                        ],
                        max_completion_tokens=300,
                    )
                gpt_resp = await asyncio.to_thread(_call_gpt)
                blended = gpt_resp.choices[0].message.content.strip()
                print(f"[VisionBlend] GPT-5.6-luna OK: {blended[:150]}")
            except Exception as e2:
                print(f"[VisionBlend] GPT-5.6-luna fallback also failed: {e2}")

    if not blended:
        blended = (
            f"[TASK]: Visual fusion and enhancement.\n"
            f"[REFERENCE SCENE]: {vision_description}\n"
            f"[USER DIRECTIVE]: {user_prompt}\n"
            f"[CONSTRAINTS]: Preserve core reference elements, color harmony, and lighting atmosphere."
        )

    # Step 3: Sanitizer Pass
    sanitized = _sanitize_master_prompt(blended)
    return sanitized, detected_intent


EDIT_AWARE_BLENDER_PROMPT = """You are a prompt engineer for AI image editing.

You are given:
1. SOURCE IMAGE DESCRIPTION — a detailed analysis of the image the user wants to edit.
2. EDIT INSTRUCTION — what the user wants to change about that image.

Your task: Write a SINGLE image generation prompt that describes the SOURCE IMAGE exactly as it is, but with the user's requested edit applied.

CRITICAL RULES:
- Describe the FULL source image first: subject (face, hair, clothing, pose, expression), scene (location, objects, furniture), lighting, colors, atmosphere.
- Then apply ONLY the user's edit instruction. Change ONLY what the user asked to change.
- Everything the user did NOT mention must remain EXACTLY the same.
- If the edit is about weather/time (e.g. "make it rain", "night scene"), change ONLY the environmental elements (window view, lighting, atmosphere) — keep the person, pose, clothing, and indoor objects identical.
- NEVER invent new subjects or objects the user didn't request.
- NEVER remove elements the user didn't ask to remove.
- Output ONLY the final prompt string under 120 words, no explanations, no quotes, no brackets."""


async def _blend_edit_with_vision(edit_instruction: str, merged_prompt: str, vision_description: str) -> str:
    """Edit-Aware Orchestrator: Understands source image + edit instruction separately.

    Unlike the fresh-generation orchestrator, this function knows:
    - The vision_description describes the SOURCE image being edited
    - The edit_instruction is the SPECIFIC change the user wants
    - The goal is to preserve everything except the requested change
    """
    user_msg = f"""SOURCE IMAGE DESCRIPTION:
{vision_description}

EDIT INSTRUCTION: {edit_instruction}

Write the full image prompt with the edit applied:"""

    blended = None
    try:
        print(f"[EditBlend] Edit-aware blending with Gemini 2.5 Flash...")
        print(f"[EditBlend] Edit instruction: {edit_instruction}")
        def _do_edit_blend():
            return flash_client.models.generate_content(
                model="gemini-2.5-flash",
                contents=[f"{EDIT_AWARE_BLENDER_PROMPT}\n\n{user_msg}"],
                config=types.GenerateContentConfig(
                    temperature=0.2,
                    max_output_tokens=400
                )
            )
        resp = await asyncio.to_thread(_do_edit_blend)
        blended = resp.text.strip() if resp and resp.text else ""
        print(f"[EditBlend] Gemini OK: {blended[:200]}")
    except Exception as e:
        print(f"[EditBlend] Gemini failed ({e}), falling back to Claude Sonnet 5 / Luna...")
        if ANTHROPIC_API_KEY:
            try:
                ant_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
                resp = await asyncio.to_thread(
                    ant_client.messages.create,
                    model="claude-sonnet-5",
                    system=EDIT_AWARE_BLENDER_PROMPT,
                    messages=[{"role": "user", "content": user_msg}],
                    max_tokens=600,
                )
                blended = _extract_anthropic_text(resp)
                print(f"[EditBlend] Claude Sonnet 5 OK: {blended[:200]}")
            except Exception as e_ant:
                print(f"[EditBlend] Claude Sonnet 5 fallback failed: {e_ant}")

        if not blended and OPENAI_API_KEY:
            try:
                client = openai_lib.OpenAI(api_key=OPENAI_API_KEY)
                def _call_gpt():
                    return client.chat.completions.create(
                        model="gpt-5.6-luna",
                        messages=[{"role": "system", "content": EDIT_AWARE_BLENDER_PROMPT},
                                  {"role": "user", "content": user_msg}],
                        max_completion_tokens=400,
                    )
                gpt_resp = await asyncio.to_thread(_call_gpt)
                blended = gpt_resp.choices[0].message.content.strip()
                print(f"[EditBlend] GPT-5.6-luna OK: {blended[:200]}")
            except Exception as e2:
                print(f"[EditBlend] GPT-5.6-luna fallback also failed: {e2}")

    if not blended:
        # Fallback: simple but structured concatenation
        blended = f"{vision_description}. Edit: {edit_instruction}"
        print(f"[EditBlend] Using simple concatenation fallback")

    sanitized = _sanitize_master_prompt(blended)
    return sanitized



async def _resolve_edit_intent(prompt_history: List[str], current_edit: str) -> str:
    """Distil the accumulated edit chain into ONE short plain-English action sentence.

    IMPORTANT:
    prompt_history[0] is the root initial generation prompt (e.g. "A girl looking out of the window...").
    Because image_base64 is already supplied, we MUST NOT include prompt_history[0] or any full
    scene description in the edit instruction! Including scene descriptions causes image-to-image
    models to re-render and alter subject placement, pose, and layout.
    We only extract delta edit instructions from prompt_history[1:].

    Falls back silently to current_edit on any failure.
    """
    if not current_edit and not prompt_history:
        return ""

    # Extract actual edit instructions (skip prompt_history[0] which is base scene generation prompt)
    edit_history = prompt_history[1:] if (prompt_history and len(prompt_history) > 1) else []

    if not edit_history:
        # Single-turn edit or no prior edit steps — raw instruction is already the intent
        return current_edit

    # Cap history to last 5 entries to prevent runaway token usage
    capped_history = edit_history[-5:]

    history_lines = "\n".join(
        [f"Step {i+1}: {p}" for i, p in enumerate(capped_history)]
    )
    system_prompt = (
        "You are an image edit intent resolver.\n"
        "A user has been editing an image step by step. Each step is an edit modification instruction.\n"
        "Output a SINGLE SHORT SENTENCE combining all the net accumulated edit modifications.\n\n"
        "- Rules:\n"
        "- Output ONLY the combined edit actions. Do NOT output or describe the scene, subject, pose, or setting.\n"
        "- Keep it under 30 words.\n"
        "- If a later step contradicts an earlier one (e.g. 'dress blue' then 'dress red'), "
        "keep only the FINAL state ('dress red').\n"
        "- Do NOT carry forward previous camera angle rotations, viewpoint shifts, or scene descriptions from earlier steps into new edits, because the reference image already contains them.\n"
        "- Do NOT output generic meta-words like 'edit', 'instruction', 'change', or 'modify'. Always state the specific action.\n"
        "- Do NOT describe unchanged parts of the image.\n"
        "- Example: steps=['make dress blue'], new='make shoes white' "
        "→ output: 'make dress blue and make shoes white'\n"
        "Return ONLY the combined edit instruction. No quotes, no explanation."
    )
    user_msg = (
        f"Edit history:\n{history_lines}\n\n"
        f"New instruction: {current_edit}\n\n"
        "Output the combined instruction:"
    )

    degenerate_edits = {"edit", "edit instruction", "image edit", "edit image", "the edit", "change", "modify", "none", "no edit"}

    try:
        if global_client:
            resp = await global_client.aio.models.generate_content(
                model="gemini-2.5-flash-lite",
                contents=user_msg,
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    temperature=0.1,
                    max_output_tokens=80,
                ),
            )
            resolved = resp.text.strip().strip('"')
            if resolved and len(resolved.strip()) >= 3 and resolved.lower().strip(" .") not in degenerate_edits:
                print(f"[EditIntentResolver] Resolved chain (depth={len(capped_history)}): {resolved}")
                return resolved

        if OPENAI_API_KEY:
            oai_client = openai_lib.OpenAI(api_key=OPENAI_API_KEY)
            def _oai_resolve():
                return oai_client.chat.completions.create(
                    model="gpt-5.6-luna",
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_msg},
                    ],
                    max_completion_tokens=80,
                )
            resp = await asyncio.to_thread(_oai_resolve)
            resolved = resp.choices[0].message.content.strip().strip('"')
            if resolved and len(resolved.strip()) >= 3 and resolved.lower().strip(" .") not in degenerate_edits:
                print(f"[EditIntentResolver] (Luna) Resolved: {resolved}")
                return resolved

    except Exception as e:
        print(f"[EditIntentResolver] Failed, using raw instruction: {e}")

    return current_edit


CAMERA_ANGLE_KEYWORDS = [
    "angle", "from the left", "from the right", "from side", "from above",
    "from behind", "from below", "side profile view", "side-profile view", "profile view", "three-quarter", "three quarter",
    "low angle", "high angle", "top-down", "top down", "camera", "viewpoint", "perspective",
    "flat-lay", "flat lay", "overhead", "bird's eye", "birds eye", "worm's eye", "worms eye"
]

COMPOUND_EDIT_INDICATORS = [
    "change the", "change lighting", "lighting to", "golden hour", "warm light", "sunlight",
    "rim light", "rim lighting", "lighting", "dramatic lighting", "accentuate", "silhouette",
    "smile", "smiling", "laugh", "happy", "expression", "make him", "make her", "make them",
    "replace", "remove", "add a", "add an", "add some", "change color", "change hair",
    "instead of", "wearing a", "convert the", "transform the", "dress", "shirt", "blouse", "holding"
]

def _is_camera_angle_request(prompt: str) -> bool:
    if not prompt:
        return False
    lower = prompt.lower()
    return any(kw in lower for kw in CAMERA_ANGLE_KEYWORDS)

def _is_pure_camera_angle_request(prompt: str) -> bool:
    """Returns True ONLY if the request is exclusively a camera/viewpoint change
    without secondary scene modifications (lighting, expression, clothing, object changes)."""
    if not prompt:
        return False
    lower = prompt.lower()
    has_angle = any(kw in lower for kw in CAMERA_ANGLE_KEYWORDS)
    if not has_angle:
        return False
    # If it contains compound edit indicators or lighting terms, it is NOT a pure camera move
    has_compound = any(ind in lower for ind in COMPOUND_EDIT_INDICATORS)
    return not has_compound


def _parse_angles_from_text(text: str) -> tuple[float, float]:
    import re
    if not text:
        return 0.0, 0.0
    
    text_lower = text.lower()
    rotate = 0.0
    vertical = 0.0
    
    # 1. Semantic / Natural Language Alias Matching for Vertical Angles
    if any(k in text_lower for k in ["top-down", "top down", "flat-lay", "flat lay", "overhead", "bird's eye", "birds eye", "directly above", "from above looking down"]):
        vertical = 90.0
    elif any(k in text_lower for k in ["high angle", "from high above", "looking down from above"]):
        vertical = 45.0
    elif any(k in text_lower for k in ["worm's eye", "worms eye", "ground level"]):
        vertical = -60.0
    elif any(k in text_lower for k in ["low angle", "from below looking up", "looking up from below", "looking up"]):
        vertical = -45.0
    elif any(k in text_lower for k in ["eye level", "straight on", "front angle", "front view"]):
        vertical = 0.0

    # 2. Semantic / Natural Language Alias Matching for Horizontal Rotation
    if any(k in text_lower for k in ["from behind", "back view", "rear view", "from the back", "opposite side"]):
        rotate = 180.0
    elif any(k in text_lower for k in ["side profile", "profile view", "from the side", "side view"]):
        if "left" in text_lower:
            rotate = -90.0
        else:
            rotate = 90.0
    elif any(k in text_lower for k in ["three quarter", "three-quarter", "3/4 view", "3/4 angle"]):
        if "left" in text_lower:
            rotate = -45.0
        else:
            rotate = 45.0

    # 3. Explicit Regex Numeric Parsing (Overrides or refines semantic guesses)
    # Directional: "rotate 45 degrees to the left" / "from a 45 degree angle to the left" / "rotated 96° to the right"
    rot_match_dir = re.search(r"(?:rotat(?:ed|e)?\s*(?:the\s+)?(?:virtual\s+)?(?:camera\s+)?|(?:from|at)\s+(?:a\s+)?)(-?\d+(?:\.\d+)?)\s*(?:°|degrees?|deg)?\s*(?:angle\s+)?(?:around\s+the\s+subject\s+)?(?:horizontally\s+)?(?:to\s+the\s+|from\s+the\s+)?(right|left)", text, re.IGNORECASE)
    if rot_match_dir:
        val = float(rot_match_dir.group(1))
        direction = rot_match_dir.group(2).lower()
        rotate = val if direction == "right" else -val
    else:
        # Non-directional horizontal: "rotate the virtual camera 180 degrees horizontally" / "rotate 180° around the subject horizontally"
        rot_match_horiz = re.search(r"rotat(?:ed|e)?\s*(?:the\s+)?(?:virtual\s+)?(?:camera\s+)?(-?\d+(?:\.\d+)?)\s*(?:°|degrees?|deg)?\s*(?:around\s+the\s+subject\s+)?horizontally", text, re.IGNORECASE)
        if rot_match_horiz:
            rotate = float(rot_match_horiz.group(1))
        else:
            # Generic camera rotation: "rotate the virtual camera 45°"
            rot_match_cam = re.search(r"rotat(?:ed|e)?\s+(?:the\s+)?(?:virtual\s+)?camera\s+(-?\d+(?:\.\d+)?)\s*(?:°|degrees?|deg)?", text, re.IGNORECASE)
            if rot_match_cam:
                rotate = float(rot_match_cam.group(1))
            else:
                rot_match_gen = re.search(r"rotate(?:d)?\s*=?\s*(-?\d+(?:\.\d+)?)", text, re.IGNORECASE)
                if rot_match_gen:
                    rotate = float(rot_match_gen.group(1))
    
    # Explicit Vertical Regex Numeric Parsing
    # Directional vertical: "90° vertically" / "90 degrees vertically" / "0° vertically"
    vert_match_vertically = re.search(r"(-?\d+(?:\.\d+)?)\s*(?:°|degrees?|deg)?\s*vertical(?:ly)?", text, re.IGNORECASE)
    if vert_match_vertically:
        vertical = float(vert_match_vertically.group(1))
    else:
        vert_match_pitch = re.search(r"(-?\d+(?:\.\d+)?)\s*(?:°|degrees?|deg)?\s*(?:downward\s+|upward\s+)?pitch\s+tilt", text, re.IGNORECASE)
        if vert_match_pitch:
            vertical = float(vert_match_pitch.group(1))
        else:
            vert_match_dir = re.search(r"(\d+(?:\.\d+)?)\s*(?:°|degrees?|deg)?\s*(?:to\s+the\s+)?(downward|upward|high|low)", text, re.IGNORECASE)
            if vert_match_dir:
                val = float(vert_match_dir.group(1))
                direction = vert_match_dir.group(2).lower()
                vertical = val if ("down" in direction or "high" in direction) else -val
            else:
                vert_match_gen = re.search(r"vertical\s*=?\s*(-?\d+(?:\.\d+)?)", text, re.IGNORECASE)
                if vert_match_gen:
                    vertical = float(vert_match_gen.group(1))

    print(f"[AngleParser] Parsed rotate={rotate}°, vertical={vertical}° from text: ...{text[:80]}...")
    return rotate, vertical


async def _build_vision_anchored_edit_prompt(
    image_b64: Optional[Union[str, List[str]]],
    edit_instruction: str,
    history: Optional[List[str]] = None,
    original_image_b64: Optional[str] = None,
    edit_depth: int = 1
) -> str:
    """Uses gemini-2.5-flash (with GPT-5.6-luna fallback) to visually inspect the current state image
    and generate a high-precision, surgical preservation-anchored edit prompt for Nanobanana 2.
    """
    img_str = image_b64[0] if isinstance(image_b64, list) else image_b64

    texture_mandate = (
        "[PORTRAIT SKIN & TECHNICAL TEXTURE MANDATE]: Retain authentic skin pore micro-texture, fine natural epidermal grain, "
        "subsurface light scattering on all exposed skin with a natural warm glow, facial contours, individual hair strands, "
        "and textile weave without digital airbrushing, artificial beauty filters, or plastic smoothing."
    )

    default_fallback = (
        f"[TASK]: Surgical in-context preservation and targeted edit of the reference image.\n"
        f"[PRESERVATION MANDATE]: Lock and freeze 100% of the original subjects, facial identity, skin tone, hair color/style, "
        f"body posture, arm/hand gestures, clothing materials, background architecture, environment, and ambient lighting from the reference image.\n"
        f"{texture_mandate}\n"
        f"[TARGET MODIFICATIONS]: {edit_instruction}\n"
        f"[CONSTRAINTS]: Only apply the specific modifications requested. Do not alter color tone, ambient lighting, or unmentioned objects."
    )

    if not img_str:
        return default_fallback

    vision_system_instruction = (
        "You are an expert AI vision prompt engineer specializing in differential image editing and surgical preservation for generative image models.\n\n"
        "Your task is to visually inspect the provided reference image and the user's edit request, and generate an in-context instruction for Nanobanana 2 (Gemini Image model) that ensures ALL requested edits are executed faithfully while strictly preserving all unmentioned elements.\n\n"
        "CORE RULES:\n"
        "1. COMPLETE EDIT EXTRACTION (MULTI-INTENT): Carefully parse the user's entire prompt and extract EVERY requested modification, addition, removal, and alteration. Do NOT omit or drop any requested change.\n"
        "2. CONFLICT RESOLUTION: If the user requests to modify, replace, or transform any existing visual element (e.g. changing an object's color, changing a light projection/shadow, modifying an expression, shifting lighting), do NOT place that element in the PRESERVE section. Only preserve elements that are NOT targeted for change.\n"
        "3. ADDITIONS: When adding new subjects, people, or objects (e.g. adding kids, animals, props), describe how they fit into the scene (e.g. matching pose, scale, perspective, lighting).\n"
        "4. PRESERVATION & GESTURE ANCHORING: For all untargeted subjects and people, preserve their exact facial features, current hair color and style, clothing, limb angles, arm/hand gestures, and body posture directly from the reference image.\n"
        "5. VIEWPOINT, LIGHTING & EXPRESSION EDITS: When the user requests a new camera perspective, new lighting, or new facial expressions, enumerate each explicitly under TARGET MODIFICATIONS.\n"
        "6. ENVIRONMENT & BOUNDARIES: Explicitly inventory untargeted furniture, props, architecture, floor patterns, and lighting so they remain untouched.\n"
        "7. SAFETY COMPLIANCE: If the user prompt uses sensitive words, translate them into safe, high-art visual equivalents.\n\n"
        "STRUCTURE OF YOUR OUTPUT:\n"
        "- [TASK]: Surgical in-context edit.\n"
        "- [PRESERVE - UNCHANGED SUBJECTS & GESTURES]: Detailed visual description of only the untargeted subjects, their exact body postures, arm/hand gestures, current hair color/style, and clothing.\n"
        "- [PRESERVE - UNCHANGED ENVIRONMENT & PROPS]: Detailed inventory of only the untargeted background elements, furniture, fixtures, and room lighting.\n"
        "- [PORTRAIT SKIN & TECHNICAL TEXTURE MANDATE]: Retain authentic skin pore micro-texture, fine natural epidermal grain, subsurface light scattering on all exposed skin with a natural warm glow, facial contours, individual hair strands, and textile weave without digital airbrushing, artificial beauty filters, or plastic smoothing.\n"
        "- [TARGET MODIFICATIONS & ADDITIONS]: Enumerate ALL user-requested changes explicitly:\n"
        "  * Viewpoint & camera perspective shifts\n"
        "  * Lighting transformations & atmosphere\n"
        "  * Subject expression & pose adjustments\n"
        "  * Attribute changes / transformations\n"
        "  * New additions\n"
        "  * Removals / replacements (with matching seamless background infill)\n"
        "- [CONSTRAINTS]: Directives to preserve all untargeted subjects, exact gestures, and unchanged scene elements.\n\n"
        "RULES:\n"
        "- Ensure EVERY instruction from the user request is represented in the modifications section.\n"
        "- Keep the prompt clear, dense with visual cues, and under 250 words.\n"
        "- Output ONLY the prompt text, no conversational chatter or markdown wrappers."
    )

    history_context = ""
    if history and len(history) > 1:
        past_edits = [h for h in history[1:] if h and h.strip()]
        if past_edits:
            history_context = "Accumulated Previous Edits in this session:\n" + "\n".join(f"- {e}" for e in past_edits) + "\n\n"

    user_prompt_text = (
        f"{history_context}"
        f"Latest User Edit Request: \"{edit_instruction}\"\n\n"
        f"Examine the image carefully. Generate the structured preservation-anchored edit prompt incorporating all accumulated modifications seamlessly."
    )

    client = global_client if global_client else flash_client
    if not client:
        print("[VisionAnchoredEdit] No Gemini client available, using template fallback")
        return default_fallback

    def _prepare_thumb_bytes(b64_val: str) -> bytes:
        clean = b64_val.split(",")[1] if "," in b64_val else b64_val
        raw = base64.b64decode(clean)
        try:
            pil = Image.open(io.BytesIO(raw)).convert("RGB")
            pil.thumbnail((768, 768), Image.Resampling.LANCZOS)
            buf = io.BytesIO()
            pil.save(buf, format="JPEG", quality=80)
            return buf.getvalue()
        except Exception:
            return raw

    try:
        current_thumb_bytes = _prepare_thumb_bytes(img_str)
        current_part = types.Part.from_bytes(data=current_thumb_bytes, mime_type="image/jpeg")

        def _call_vision():
            return client.models.generate_content(
                model="gemini-2.5-flash",
                contents=[current_part, user_prompt_text],
                config=types.GenerateContentConfig(
                    system_instruction=vision_system_instruction,
                    temperature=0.2,
                    max_output_tokens=2048,
                    thinking_config=types.ThinkingConfig(thinking_budget=0),
                ),
            )

        res_obj = await asyncio.wait_for(
            asyncio.to_thread(_call_vision),
            timeout=20.0
        )
        if res_obj and res_obj.text:
            result = res_obj.text.strip()
            if "[PORTRAIT SKIN & TECHNICAL TEXTURE MANDATE]" not in result and "[TECHNICAL TEXTURE MANDATE]" not in result:
                if "[TARGET MODIFICATIONS" in result:
                    result = result.replace("[TARGET MODIFICATIONS", f"{texture_mandate}\n\n[TARGET MODIFICATIONS")
                else:
                    result = f"{result}\n\n{texture_mandate}"
            print(f"[VisionAnchoredEdit] Successfully built vision-anchored prompt ({len(result)} chars):\n{result}")
            return result
    except Exception as e:
        print(f"[VisionAnchoredEdit] Gemini vision error ({type(e).__name__}: {e}), trying Claude Haiku 4.5 vision fallback...")
        if ANTHROPIC_API_KEY:
            try:
                ant_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
                curr_b64 = base64.b64encode(current_thumb_bytes).decode('utf-8')
                claude_content = [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/jpeg",
                            "data": curr_b64
                        }
                    },
                    {
                        "type": "text",
                        "text": user_prompt_text
                    }
                ]
                def _call_claude_vision():
                    return ant_client.messages.create(
                        model="claude-sonnet-5",
                        system=vision_system_instruction,
                        messages=[{"role": "user", "content": claude_content}],
                        max_tokens=2048,
                    )
                claude_res = await asyncio.wait_for(asyncio.to_thread(_call_claude_vision), timeout=20.0)
                if claude_res and claude_res.content:
                    result = _extract_anthropic_text(claude_res)
                    if "[PORTRAIT SKIN & TECHNICAL TEXTURE MANDATE]" not in result and "[TECHNICAL TEXTURE MANDATE]" not in result:
                        if "[TARGET MODIFICATIONS" in result:
                            result = result.replace("[TARGET MODIFICATIONS", f"{texture_mandate}\n\n[TARGET MODIFICATIONS")
                        else:
                            result = f"{result}\n\n{texture_mandate}"
                    print(f"[VisionAnchoredEdit] (Claude Sonnet 5 Vision Fallback) Successfully built prompt ({len(result)} chars):\n{result}")
                    return result
            except Exception as e_ant:
                print(f"[VisionAnchoredEdit] Claude Sonnet 5 vision fallback failed: {e_ant}")
        elif OPENAI_API_KEY:
            try:
                oai_client = openai_lib.OpenAI(api_key=OPENAI_API_KEY)
                curr_url = f"data:image/jpeg;base64,{base64.b64encode(current_thumb_bytes).decode('utf-8')}"
                luna_content_items = [
                    {"type": "text", "text": user_prompt_text},
                    {"type": "image_url", "image_url": {"url": curr_url, "detail": "low"}}
                ]

                def _call_luna_vision():
                    return oai_client.chat.completions.create(
                        model="gpt-5.6-luna",
                        messages=[
                            {"role": "system", "content": vision_system_instruction},
                            {"role": "user", "content": luna_content_items}
                        ],
                        max_completion_tokens=2048,
                    )
                luna_res = await asyncio.wait_for(asyncio.to_thread(_call_luna_vision), timeout=20.0)
                if luna_res and luna_res.choices:
                    result = luna_res.choices[0].message.content.strip()
                    if "[PORTRAIT SKIN & TECHNICAL TEXTURE MANDATE]" not in result and "[TECHNICAL TEXTURE MANDATE]" not in result:
                        if "[TARGET MODIFICATIONS" in result:
                            result = result.replace("[TARGET MODIFICATIONS", f"{texture_mandate}\n\n[TARGET MODIFICATIONS")
                        else:
                            result = f"{result}\n\n{texture_mandate}"
                    print(f"[VisionAnchoredEdit] (Luna Vision Fallback) Successfully built prompt ({len(result)} chars):\n{result}")
                    return result
            except Exception as e2:
                print(f"[VisionAnchoredEdit] Luna vision fallback failed: {e2}")

    return default_fallback


async def _vision_scene_inventory(image_b64: str, master_prompt: str) -> Optional[str]:
    """Uses gemini-2.5-flash vision to describe WHAT is in the scene (identity, clothing,
    objects, environment) WITHOUT any angle/viewpoint interpretation.
    
    The vision model is great at scene understanding but unreliable at spatial reasoning.
    So we only ask it to inventory the scene contents — angle positioning is handled
    deterministically by _build_angle_viewpoint_description().
    
    Args:
        image_b64: Base64-encoded source image
        master_prompt: The original prompt used to generate the image
    
    Returns:
        A scene inventory string, or None on failure.
    """
    vision_prompt = (
        f"I am showing you a reference image. "
        f"It was originally generated with this prompt: \"{master_prompt}\"\n\n"
        f"Describe what exists in this scene. Do NOT describe the camera angle or viewpoint. List:\n"
        f"1. The subject(s): gender, hair color/length/style, facial hair status (be 100% accurate: clean-shaven vs stubble vs beard — never assume a beard if clean-shaven), facial details, skin tone\n"
        f"2. Clothing: exact colors, materials, fit, style of every garment\n"
        f"3. Accessories: jewelry, bags, hats, glasses, etc.\n"
        f"4. Objects/vehicles: make, model, color, distinguishing features\n"
        f"5. SPATIAL LAYOUT: Where is each subject/object positioned in the frame? "
        f"(e.g. 'the girl is on the LEFT side of the frame, the horse is on the RIGHT', "
        f"'the car is behind the person'). This is critical.\n"
        f"6. Environment: background elements, terrain, sky, vegetation, architecture\n"
        f"7. Lighting: natural/artificial, direction, warmth, time of day\n\n"
        f"Output a concise inventory paragraph under 140 words. "
        f"Do NOT mention camera angle, but DO include spatial positions."
    )

    client = flash_client if flash_client else global_client
    if not client:
        print("[VisionSceneInventory] No Gemini client available")
        return None

    try:
        img_str = image_b64[0] if isinstance(image_b64, list) else image_b64
        if not img_str:
            return None
        b64_clean = img_str.split(",")[1] if "," in img_str else img_str
        img_bytes = base64.b64decode(b64_clean)
        mime = "image/jpeg"
        if img_bytes.startswith(b'\x89PNG'):
            mime = "image/png"
        elif img_bytes.startswith(b'RIFF'):
            mime = "image/webp"

        image_part = types.Part.from_bytes(data=img_bytes, mime_type=mime)
        
        res_obj = await asyncio.to_thread(
            client.models.generate_content,
            model="gemini-2.5-flash",
            contents=[image_part, vision_prompt],
        )
        if res_obj and res_obj.text:
            result = res_obj.text.strip()
            print(f"[VisionSceneInventory] Scene inventory ({len(result)} chars): {result[:200]}")
            return result
    except Exception as e:
        print(f"[VisionSceneInventory] Gemini failed ({e}), trying Claude Sonnet 5 / Luna fallback...")
        if ANTHROPIC_API_KEY:
            try:
                ant_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
                curr_b64 = base64.b64encode(img_bytes).decode('utf-8')
                media_type = mime if mime in ["image/jpeg", "image/png", "image/gif", "image/webp"] else "image/jpeg"
                def _call_claude():
                    return ant_client.messages.create(
                        model="claude-sonnet-5",
                        messages=[{
                            "role": "user",
                            "content": [
                                {
                                    "type": "image",
                                    "source": {
                                        "type": "base64",
                                        "media_type": media_type,
                                        "data": curr_b64
                                    }
                                },
                                {"type": "text", "text": vision_prompt}
                            ]
                        }],
                        max_tokens=600,
                    )
                claude_res = await asyncio.to_thread(_call_claude)
                if claude_res and claude_res.content:
                    result = _extract_anthropic_text(claude_res)
                    print(f"[VisionSceneInventory] (Claude Sonnet 5 Fallback) Succeeded ({len(result)} chars): {result[:200]}")
                    return result
            except Exception as e_ant:
                print(f"[VisionSceneInventory] Claude Sonnet 5 fallback failed: {e_ant}")

        if OPENAI_API_KEY:
            try:
                oai_client = openai_lib.OpenAI(api_key=OPENAI_API_KEY)
                b64_url = f"data:{mime};base64,{base64.b64encode(img_bytes).decode('utf-8')}"
                def _call_luna():
                    return oai_client.chat.completions.create(
                        model="gpt-5.6-luna",
                        messages=[
                            {
                                "role": "user",
                                "content": [
                                    {"type": "text", "text": vision_prompt},
                                    {"type": "image_url", "image_url": {"url": b64_url, "detail": "low"}}
                                ]
                            }
                        ],
                        max_completion_tokens=300,
                    )
                luna_res = await asyncio.to_thread(_call_luna)
                if luna_res and luna_res.choices:
                    result = luna_res.choices[0].message.content.strip()
                    print(f"[VisionSceneInventory] (Luna Fallback) Succeeded ({len(result)} chars): {result[:200]}")
                    return result
            except Exception as e2:
                print(f"[VisionSceneInventory] Luna fallback also failed: {e2}")

    return None


def _build_angle_viewpoint_description(rotate: float, vertical: float) -> str:
    """Deterministically builds a precise viewpoint description from angle values.
    
    This handles the spatial reasoning that vision models are bad at.
    Returns a description of what the camera sees from the given angle.
    """
    # === Horizontal viewpoint (what parts of the subject are visible) ===
    abs_rot = abs(rotate)
    side = "right" if rotate > 0 else "left"
    
    if abs_rot <= 15:
        h_view = "The camera is at the original front position. The scene is viewed from the same angle as the original image."
    elif abs_rot <= 45:
        h_view = (
            f"The camera has moved {abs_rot}° to the {side} of the original position. "
            f"The scene is viewed from a front three-quarter angle. Everything in the scene "
            f"has shifted — what was on the {side} is now more central."
        )
    elif abs_rot <= 75:
        h_view = (
            f"The camera has moved {abs_rot}° to the {side}. The scene is viewed from roughly "
            f"the {side} side. Elements that were facing the camera are now seen at an angle. "
            f"The {side} sides of all people and objects are visible."
        )
    elif abs_rot <= 105:
        h_view = (
            f"The camera is at a {side}-side position ({abs_rot}° from the front). "
            f"The scene is viewed from the {side} side. Everything that was facing the camera "
            f"is now seen in profile. The {side} edges of desks, chairs, and people are prominent."
        )
    elif abs_rot <= 135:
        h_view = (
            f"The camera is behind and to the {side} ({abs_rot}° from the front). "
            f"The scene is mostly viewed from behind. The backs of all people and objects "
            f"are visible. Faces are mostly hidden. What was in the background is now closer."
        )
    elif abs_rot <= 165:
        h_view = (
            f"The camera is almost directly behind the scene ({abs_rot}° from the front). "
            f"Nearly everything is seen from the rear. All people's backs are visible, "
            f"faces are hidden. The background of the original image is now in the foreground."
        )
    else:
        h_view = (
            "The camera is directly behind the scene (180° from the front). "
            "Everything is viewed from the exact opposite direction. All people's backs "
            "are visible, all faces are completely hidden. What was the background is now "
            "the foreground, and vice versa. This is a complete reversal of the original viewpoint."
        )
    
    # === Vertical viewpoint ===
    if vertical >= 75:
        v_view = "The camera is positioned directly overhead looking straight down at the scene (90° top-down flat-lay perspective). The tops of all objects, surfaces, lids, and flat layouts are viewed directly from above."
    elif vertical > 30:
        v_view = "The camera is high above, looking down at the scene (bird's eye / high angle). The tops of heads, objects, and surfaces are prominent."
    elif vertical > 15:
        v_view = "The camera is above eye level, looking slightly down at the scene (high angle)."
    elif vertical < -40:
        v_view = "The camera is near ground level, looking up at the scene (worm's eye angle)."
    elif vertical < -15:
        v_view = "The camera is below eye level, looking slightly up at the scene (low angle)."
    else:
        v_view = "The camera is at eye level."
    
    return f"{h_view} {v_view}"


async def _rewrite_master_prompt_for_angle(master_prompt: str, scene_inventory: str, 
                                             rotate: float, vertical: float) -> Optional[str]:
    """Uses gemini-2.5-flash to rewrite the master prompt so the camera angle is naturally
    woven into the scene description itself.
    
    The model receives:
    - The original master prompt
    - The scene inventory (enriched details from vision analysis)
    - The exact angle values + what should be visible
    
    It outputs a single, natural-sounding prompt that describes the scene AS IF it was
    originally written from the new camera perspective.
    """
    # Build what-is-visible description for the LLM rewriter
    angle_desc = _build_angle_viewpoint_description(rotate, vertical)
    
    # Build spatial mirroring rule for the rewriter
    abs_rot = abs(rotate)
    if abs_rot > 90:
        mirror_rule = (
            f"CRITICAL SPATIAL RULE: Since the camera has rotated {rotate}° (more than 90° from the front), "
            f"LEFT-RIGHT positions in the frame MUST BE MIRRORED compared to the original image. "
            f"Objects/subjects that were on the LEFT in the original image MUST now appear on the RIGHT, "
            f"and vice versa. This is because you are now looking from the opposite direction — "
            f"imagine walking around behind someone, their left hand is now on YOUR right side."
        )
    else:
        side = "right" if rotate > 0 else "left"
        mirror_rule = (
            f"SPATIAL NOTE: The camera has shifted {abs_rot}° to the {side}. "
            f"Objects closer to the camera's new position may appear more prominent or larger. "
            f"The overall left-right layout shifts slightly."
        )
    
    rewrite_prompt = (
        f"You are rewriting an image generation prompt to change ONLY the camera angle.\n\n"
        f"ORIGINAL PROMPT: \"{master_prompt}\"\n\n"
        f"SCENE SUMMARY: {scene_inventory}\n\n"
        f"NEW CAMERA ANGLE: {rotate}° horizontal rotation, {vertical}° vertical tilt.\n"
        f"Camera position: {angle_desc}\n\n"
        f"{mirror_rule}\n\n"
        f"CRITICAL CONCEPT: Treat the ENTIRE IMAGE as ONE 3D scene. The camera orbits around the \n"
        f"CENTER of the scene — not around any individual person. Imagine the whole image is a \n"
        f"3D diorama, and you are walking around it. At 180°, you see the ENTIRE scene from the \n"
        f"opposite side: ALL people have their backs to you, what was the background is now the \n"
        f"foreground, and the entire spatial layout is reversed.\n\n"
        f"RULES:\n"
        f"1. Write a prompt of 80-100 WORDS.\n"
        f"2. Describe where the camera is relative to the WHOLE SCENE (not individual people).\n"
        f"3. Include scene-identifying details: room type, furniture, windows, objects, number of people.\n"
        f"4. Describe what the camera SEES from this position — which walls, windows, or elements \n"
        f"are now in the foreground vs background.\n"
        f"5. State the orientation of ALL people uniformly (e.g. 'all people have their backs to the camera', \n"
        f"'everyone is seen from the left side'). ALL people rotate together with the scene.\n"
        f"6. This is a FROZEN moment — nothing has moved, only the camera orbited.\n"
        f"7. Write as a flowing paragraph, no headers or bullet points.\n\n"
        f"Output ONLY the rewritten prompt, nothing else."
    )
    
    client = flash_client if flash_client else global_client
    if not client:
        return None
    
    try:
        res_obj = await asyncio.to_thread(
            client.models.generate_content,
            model="gemini-2.5-flash",
            contents=[rewrite_prompt],
        )
        if res_obj and res_obj.text:
            result = res_obj.text.strip()
            # Remove any quotes the model might wrap around the output
            if result.startswith('"') and result.endswith('"'):
                result = result[1:-1]
            print(f"[PromptRewriter] Rewritten master prompt ({len(result)} chars): {result[:200]}")
            return result
    except Exception as e:
        print(f"[PromptRewriter] Failed: {e}")
    
    return None


async def _rewrite_camera_angle_prompt(original_prompt: str, user_angle_request: str, 
                                        image_b64: Optional[str] = None, master_prompt: Optional[str] = None) -> tuple:
    """Rewrites the master prompt to naturally incorporate the camera angle.
    
    Pipeline:
    1. Vision model analyzes the image to get rich scene details (fills gaps in master prompt)
    2. LLM rewrites the master prompt to describe the scene FROM the new angle
    3. The rewritten prompt + reference image are sent to Nanobanana 2 together
    
    The reference image provides identity/consistency.
    The rewritten prompt tells the model what angle to render.
    
    Returns:
        Tuple of (prompt_string, rotate_degrees, vertical_degrees)
    """
    rotate, vertical = _parse_angles_from_text(user_angle_request)
    effective_master = master_prompt or original_prompt
    
    # Step 1: Get scene inventory from vision model (enriches the master prompt)
    scene_inventory = None
    if image_b64:
        img_str = image_b64[0] if isinstance(image_b64, list) else image_b64
        scene_inventory = await _vision_scene_inventory(img_str, effective_master)
    
    # Step 2: Rewrite the master prompt with angle woven in
    if scene_inventory:
        rewritten = await _rewrite_master_prompt_for_angle(
            effective_master, scene_inventory, rotate, vertical
        )
        if rewritten:
            print(f"[CameraAngleRewriter] Master prompt rewritten for {rotate}°/{vertical}° ({len(rewritten)} chars)")
            return rewritten, rotate, vertical
    
    # Step 3: Fallback — build angle description deterministically and combine
    angle_description = _build_angle_viewpoint_description(rotate, vertical)
    if scene_inventory:
        # Have scene inventory but LLM rewrite failed — combine mechanically
        fallback = (
            f"{scene_inventory}, viewed {angle_description.split('.')[0].lower()}. "
            f"Camera rotated {rotate}° horizontally, {vertical}° vertically from the original angle."
        )
    else:
        # No vision at all — use simplified template
        fallback = (
            f"Create a new angle of the subject in this image: rotate the virtual camera {rotate}° "
            f"around the subject horizontally and {vertical}° vertically, keeping the same framing, "
            f"identity, clothing, and styling as the original."
        )
    print(f"[CameraAngleRewriter] Fallback prompt: {fallback[:150]}")
    return fallback, rotate, vertical


# ── Edit Type Classifier (Pure Semantic LLM: Claude Haiku 4.5 + Gemini 2.5 Flash Fallback) ─────────────
async def _classify_edit_type(edit_instruction: str) -> str:
    """Classify an edit instruction as 'structural' or 'inpainting' using pure semantic LLM reasoning.
    Zero brittle keyword or regex matching.
    - 'structural': Introduces, adds, removes, or repositions an ENTIRE NEW physical subject, person, child, animal, or major structure.
    - 'inpainting': Modifies attributes of ALREADY EXISTING subjects, or adds wearable personal items (glasses, watches, jewelry, clothing) on existing people."""
    if not edit_instruction:
        return "inpainting"

    prompt = (
        "Classify this image edit instruction as either 'structural' or 'inpainting'.\n\n"
        "DEFINITIONS:\n"
        "- 'structural': ANY edit that introduces, adds, removes, or repositions an ENTIRE NEW physical entity or subject into the scene:\n"
        "  * Brand new human person, child, or character (e.g. 'add an athletic Indian man running beside her', 'add an energetic 8-year-old boy running between them', 'add a woman standing beside him', 'bring in a friend').\n"
        "  * Animals or pets (e.g. 'add a Siberian husky running alongside', 'add a golden retriever', 'add a cat on the porch').\n"
        "  * Major new furniture, architectural structures, vehicles, or physical objects (e.g. 'add a bicycle', 'add string lights and potted plants', 'remove the car').\n\n"
        "- 'inpainting': Edits that modify ATTRIBUTES of ALREADY EXISTING subjects, or add wearable personal items to existing people:\n"
        "  * Wearable accessories & tech on existing people: 'add sleek sunglasses to the man', 'add running headphones on the woman', 'add a fitness smartwatch on the boy's wrist', 'add gold hoop earrings', 'give him a hat'.\n"
        "  * Clothing & grooming: 'change top to mint green compression shirt', 'replace shorts with navy leggings', 'tie her hair in a braided ponytail', 'give him a stubble beard'.\n"
        "  * Atmosphere, lighting, weather: 'change time of day to golden sunset hour', 'make sky twilight blue', 'make it rainy'.\n\n"
        f"Instruction: \"{edit_instruction}\"\n\n"
        "Reply with exactly one word: structural or inpainting"
    )

    # 1. Primary: Claude Sonnet 5 via Anthropic (best intelligence & semantic reasoning)
    if ANTHROPIC_API_KEY:
        try:
            ant_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
            def _call_claude_classify():
                return ant_client.messages.create(
                    model="claude-sonnet-5",
                    system="You are a precise image edit classifier. Reply with ONLY 'structural' or 'inpainting'.",
                    messages=[{"role": "user", "content": prompt}],
                    max_tokens=300,
                )
            resp = await asyncio.wait_for(asyncio.to_thread(_call_claude_classify), timeout=6.0)
            text = _extract_anthropic_text(resp).lower().replace(".", "")
            if "structural" in text:
                print(f"[EditClassifier:Claude-Sonnet-5] → structural for: {edit_instruction[:65]}")
                return "structural"
            elif "inpainting" in text:
                print(f"[EditClassifier:Claude-Sonnet-5] → inpainting for: {edit_instruction[:65]}")
                return "inpainting"
        except Exception as ant_err:
            print(f"[EditClassifier:Claude-Sonnet-5] Notice ({ant_err}), falling back to Gemini 2.5 Flash")

    # 2. Secondary: Gemini 2.5 Flash
    client = global_client if global_client else flash_client
    if client:
        try:
            def _call_gemini():
                return client.models.generate_content(
                    model="gemini-2.5-flash",
                    contents=[prompt],
                    config=types.GenerateContentConfig(
                        temperature=0.0,
                        max_output_tokens=10,
                        thinking_config=types.ThinkingConfig(thinking_budget=0),
                    )
                )
            resp = await asyncio.wait_for(asyncio.to_thread(_call_gemini), timeout=4.0)
            if resp and resp.text:
                text = resp.text.strip().lower().replace(".", "")
                if "structural" in text:
                    print(f"[EditClassifier:Gemini-Flash] → structural for: {edit_instruction[:65]}")
                    return "structural"
                print(f"[EditClassifier:Gemini-Flash] → inpainting for: {edit_instruction[:65]}")
                return "inpainting"
        except Exception as gem_err:
            print(f"[EditClassifier:Gemini-Flash] Call failed: {gem_err}")

    # 3. Tertiary: GPT-5 nano via OpenAI
    if OPENAI_API_KEY:
        try:
            oai_client = openai_lib.OpenAI(api_key=OPENAI_API_KEY)
            def _call_oai():
                return oai_client.chat.completions.create(
                    model="gpt-5-nano",
                    messages=[
                        {"role": "system", "content": "You are a precise classifier. Reply with ONLY 'structural' or 'inpainting'."},
                        {"role": "user", "content": prompt}
                    ],
                    max_completion_tokens=10,
                    temperature=0.0
                )
            resp = await asyncio.wait_for(asyncio.to_thread(_call_oai), timeout=4.0)
            text = resp.choices[0].message.content.strip().lower().replace(".", "")
            if "structural" in text:
                print(f"[EditClassifier:GPT-5-nano] → structural for: {edit_instruction[:65]}")
                return "structural"
            elif "inpainting" in text:
                print(f"[EditClassifier:GPT-5-nano] → inpainting for: {edit_instruction[:65]}")
                return "inpainting"
        except Exception as oai_err:
            print(f"[EditClassifier:GPT-5-nano] Notice ({oai_err})")

    return "inpainting"


async def _synthesize_edit_prompt(prompt_history: List[str], current_edit: str) -> str:
    """Synthesize a contradiction-free prompt by resolving the full edit history.

    Uses gemini-2.5-flash as a fast, lightweight LLM Middleman to understand
    chronological intent and produce a single, unified image prompt that eliminates
    all contradictions (e.g. 'yellow text' -> 'black text' across iterations).
    Falls back silently to the raw current_edit if the LLM call fails.
    """
    if not prompt_history:
        return current_edit

    # Build a human-readable history for the LLM to reason over
    history_lines = "\n".join(
        [f"Step {i+1}: {p}" for i, p in enumerate(prompt_history)]
    )
    system_prompt = (
        "You are an expert Image Prompt Synthesizer. "
        "A user is editing an image prompt iteratively. "
        "Your job is to synthesize the history of prompts and the latest edit instruction "
        "into a single, cohesive, contradiction-free image description prompt. "
        "Clean up any repetitive or duplicated phrases (such as repeated style tags, camera angles, or aspect ratio keywords). "
        "Ensure the latest instruction is fully incorporated (e.g., if the user says 'make it a night scene', change the lighting to night, darkness, moonlight, etc., and remove any daylight/day keywords). "
        "Preserve exact colors, patterns, and materials of all clothing, accessories, and products unless the instruction explicitly asks to change them. "
        "Output ONLY the final synthesized prompt. No conversation, no quotes, no labels."
    )
    user_msg = (
        f"Here is the chronological edit history for this image:\n"
        + "\n".join([f"Step {i+1}: {p}" for i, p in enumerate(prompt_history)])
        + f"\n\nLatest instruction: {current_edit}\n\n"
        f"Synthesize all of the above into one perfect, unified, contradiction-free image prompt."
    )

    try:
        # Prefer Gemini 2.5 Flash (fast, cheap, available)
        if global_client:
            resp = await global_client.aio.models.generate_content(
                model="gemini-2.5-flash",
                contents=user_msg,
                config=types.GenerateContentConfig(system_instruction=system_prompt, temperature=0.2, max_output_tokens=1024),
            )
            synthesized = resp.text.strip().strip('"')
            print(f"[PromptSynthesizer] [OK] History depth={len(prompt_history)}: ...{synthesized[-150:]}")
            return synthesized

        # Fallback: GPT-4o-mini if Gemini unavailable
        if OPENAI_API_KEY:
            client = openai_lib.OpenAI(api_key=OPENAI_API_KEY)
            def _oai_call():
                return client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user",   "content": user_msg},
                    ],
                    max_tokens=1024,
                    temperature=0.2,
                )
            resp = await asyncio.to_thread(_oai_call)
            synthesized = resp.choices[0].message.content.strip().strip('"')
            print(f"[PromptSynthesizer] [OK] (OAI fallback) History depth={len(prompt_history)}: ...{synthesized[-150:]}")
            return synthesized

    except Exception as e:
        print(f"[PromptSynthesizer] Failed, using raw edit prompt: {e}")

    return current_edit


# ── MAIN ENDPOINT ─────────────────────────────────────────────────────────────

@app.post("/api/generate")
async def generate_image(
    request: GenerateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    access_error = _generation_access_error(current_user)
    if access_error:
        raise access_error

    if request.session_id:
        existing_session = db.query(DBSession).filter(DBSession.id == request.session_id).first()
        if existing_session and existing_session.user_id != current_user.id:
            raise HTTPException(status_code=404, detail="Session not found")

    print(f"[API] Received request for models: {request.models}, prompt: {request.prompt[:80]}")
    print(f"[API-DEBUG] Received prompt_history from frontend: {request.prompt_history}")

    # ── Content safety: instant keyword check (< 1ms) ──
    kw_safe, kw_reason = check_prompt_keywords(request.prompt)
    if not kw_safe:
        raise HTTPException(status_code=400, detail=f"Content blocked: {kw_reason}")

    # ── Vision-Aware Prompt Blending (before any optimization) ──
    optimized_prompt = request.prompt
    if request.vision_description:
        print(f"[API] ── VISION BLEND ── blending user prompt with reference image analysis...")
        optimized_prompt, _ = await _blend_vision_with_prompt(request.prompt, request.vision_description)
        print(f"[API] ── VISION BLENDED ── {optimized_prompt[:200]}")

    # ── Prompt Synthesis (edit mode) or AI Optimization (first generation) ──
    if request.prompt_history:
        # Edit with history: synthesize contradiction-free prompt via LLM Middleman
        print(f"[API] ── PROMPT SYNTHESIZER ── history depth={len(request.prompt_history)}")
        optimized_prompt = await _synthesize_edit_prompt(request.prompt_history, optimized_prompt)
        print(f"[API] ── SYNTHESIZED PROMPT ── {optimized_prompt[:200]}")
    elif len(request.models) == 1 and OPENAI_API_KEY:
        # First-time generation: use standard AI optimizer
        print(f"[API] ── BEFORE AI OPTIMIZER ── {optimized_prompt[:120]}")
        optimized_prompt = await _ai_optimize_prompt(optimized_prompt, request.models[0])
        print(f"[API] ── AFTER  AI OPTIMIZER ── {optimized_prompt[:200]}")

    results: List[dict] = []
    errors: List[str] = []

    # ── Nanobanana 2 & Pro (with auto-fallback to ChatGPT on quota exhaustion) ──
    if "Nanobanana 2" in request.models or "Nanobanana 2 (Beta)" in request.models:
        config = load_nanobanana_config()
        beta_cfg = config.get("beta", {"model": "gemini-3.1-flash-image", "temperature": 0.7})
        
        gemini_quota_exhausted = False
        gen_request_source = "EDIT" if (request.prompt_history or request.image_base64) else "STUDIO"

        async def run_single_nanobanana(cfg, label, response_modalities: Optional[List[str]] = None, thinking_level: Optional[str] = None, top_p: Optional[float] = None, is_beta: bool = False):
            nonlocal gemini_quota_exhausted
            try:
                base_prompt = request.prompt if (is_beta and not request.prompt_history) else optimized_prompt
                imgs, _, _ = await _gemini_generate(
                    prompt=base_prompt,
                    ratio=request.ratio,
                    quality=request.quality,
                    image_b64=request.image_base64,
                    gemini_model=cfg.get("model", "gemini-3.1-flash-image"),
                    temperature=cfg.get("temperature", 0.7),
                    response_modalities=response_modalities,
                    thinking_level=thinking_level,
                    top_p=top_p,
                    is_beta=is_beta,
                    request_source=gen_request_source,
                )
                return [{"model": label, "url": img} for img in imgs]
            except Exception as e:
                err_msg = str(e)
                is_quota = "RESOURCE_EXHAUSTED" in err_msg or "429" in err_msg or "quota" in err_msg.lower()
                if is_quota:
                    gemini_quota_exhausted = True
                return [{"model": label, "url": None, "error": err_msg}]

        tasks = []
        if "Nanobanana 2" in request.models:
            tasks.append(run_single_nanobanana(beta_cfg, "Nanobanana 2", response_modalities=["TEXT", "IMAGE"], thinking_level="minimal", top_p=0.85, is_beta=True))
        if "Nanobanana 2 (Beta)" in request.models and "Nanobanana 2" not in request.models:
            tasks.append(run_single_nanobanana(beta_cfg, "Nanobanana 2 (Beta)", response_modalities=["TEXT", "IMAGE"], thinking_level="minimal", top_p=0.85, is_beta=True))

        gen_results = await asyncio.gather(*tasks)
        for r_list in gen_results:
            for r in r_list:
                results.append(r)
                if r.get("error"):
                    errors.append(f"{r['model']}: {r['error']}")

        if gemini_quota_exhausted:
            # Model consistency: Strictly retain selected model without auto-falling back to ChatGPT
            for r in results:
                if r.get("model") in ["Nanobanana 2", "Nanobanana 2 (Beta)"] and r.get("error"):
                    r["error"] = _format_user_friendly_error(r["error"])

    if "Nanobanana Pro" in request.models:
        gemini_quota_exhausted = False
        try:
            imgs, _, _ = await _gemini_generate(
                prompt=optimized_prompt,
                ratio=request.ratio,
                quality=request.quality,
                image_b64=request.image_base64,
                gemini_model="gemini-3-pro-image",
                temperature=0.4,
                request_source="EDIT" if (request.prompt_history or request.image_base64) else "STUDIO",
            )
            for img in imgs:
                results.append({"model": "Nanobanana Pro", "url": img})
            print(f"[Gemini Pro] Got {len(imgs)} image(s)")
        except Exception as e:
            raw_err = str(e)
            err_msg = _format_user_friendly_error(raw_err)
            results.append({"model": "Nanobanana Pro", "url": None, "error": err_msg})
            errors.append(f"Nanobanana Pro: {err_msg}")
            print(f"[Gemini Pro] Error: {raw_err[:200]}")

    # ── ChatGPT Image ──
    if "ChatGPT" in request.models:
        try:
            imgs, _, _ = await _chatgpt_image_generate(
                prompt=optimized_prompt,
                ratio=request.ratio,
                quality=request.quality,
                image_b64=request.image_base64,
                model=request.chatgpt_model,
            )
            for img in imgs:
                results.append({"model": "ChatGPT", "url": img})
            print(f"[ChatGPT] Got {len(imgs)} image(s)")
        except Exception as e:
            err_msg = str(e)
            results.append({"model": "ChatGPT", "url": None, "error": err_msg})
            errors.append(f"ChatGPT: {err_msg}")
            print(f"[ChatGPT] Error: {err_msg}")

    # ── Kling ──
    if "Kling" in request.models:
        try:
            imgs = await _kling_generate(
                prompt=optimized_prompt,
                ratio=request.ratio,
                image_b64=request.image_base64,
                quality=request.quality
            )
            for img in imgs:
                results.append({"model": "Kling", "url": img})
            print(f"[Kling] Got {len(imgs)} image(s)")
        except Exception as e:
            err_msg = str(e)
            results.append({"model": "Kling", "url": None, "error": err_msg})
            errors.append(f"Kling: {err_msg}")
            print(f"[Kling] Error: {err_msg}")

    # ── Flux.1 ──
    if "Flux.1" in request.models:
        try:
            imgs = await _flux_generate(
                prompt=optimized_prompt,
                ratio=request.ratio,
                quality=request.quality
            )
            for img in imgs:
                results.append({"model": "Flux.1", "url": img})
            print(f"[Flux.1] Got {len(imgs)} image(s)")
        except Exception as e:
            err_msg = str(e)
            results.append({"model": "Flux.1", "url": None, "error": err_msg})
            errors.append(f"Flux.1: {err_msg}")
            print(f"[Flux.1] Error: {err_msg}")

    # ── OpenAI (DALL-E 3) ──
    if "OpenAI" in request.models:
        try:
            imgs = await _openai_generate(
                prompt=request.prompt,
                ratio=request.ratio,
                quality=request.quality
            )
            for img in imgs:
                results.append({"model": "OpenAI", "url": img})
            print(f"[OpenAI] Got {len(imgs)} image(s)")
        except Exception as e:
            err_msg = str(e)
            results.append({"model": "OpenAI", "url": None, "error": err_msg})
            errors.append(f"OpenAI: {err_msg}")
            print(f"[OpenAI] Error: {err_msg}")

    if not any(r["url"] for r in results) and errors:
        combined = "; ".join(errors)
        # Detect quota exhaustion — surface as 429 (not 502) so the frontend can show a clear message
        if "RESOURCE_EXHAUSTED" in combined or "429" in combined or "quota" in combined.lower():
            raise HTTPException(
                status_code=429,
                detail=f"API quota exhausted. Your free-tier limit has been reached. "
                       f"Please wait a few minutes or switch to ChatGPT / Flux. Details: {combined[:300]}"
            )
        raise HTTPException(status_code=502, detail=combined)

    session_id = request.session_id or str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    user_id = current_user.id

    # Save to Database
    try:
        existing_session = db.query(DBSession).filter(DBSession.id == session_id).first()
        if not existing_session:
            new_session = DBSession(
                id=session_id,
                user_id=user_id,
                parent_session_id=None,
                prompt=request.prompt,
                models=json.dumps(request.models),
                active_configs=json.dumps(request.categories),
                reference_image_id=None,
                ratio=request.ratio,
                quality=request.quality,
                created_at=now
            )
            db.add(new_session)

        for res in results:
            new_id = str(uuid.uuid4())
            new_image = DBImage(
                id=new_id,
                session_id=session_id,
                user_id=user_id,
                model_id=res["model"],
                status="completed" if res["url"] else "failed",
                url=res["url"] if res["url"] else "",
                created_at=now
            )
            db.add(new_image)
            res["id"] = new_id
            res["image_id"] = new_id
        db.commit()
    except Exception as e:
        print(f"[Database Error] Failed to save session: {e}")
        db.rollback()

    return {
        "status": "success",
        "session_id": session_id,
        "images": [r["url"] for r in results if r["url"]], # for backward compatibility if needed
        "results": results,
        "models_ran": [m for m in request.models if m in ("Nanobanana", "ChatGPT", "Kling", "Flux.1", "OpenAI")],
        "errors": errors,
    }


class PromptSuggestRequest(BaseModel):
    prompt: str


@app.post("/api/suggest-from-prompt")
async def suggest_from_prompt(request: PromptSuggestRequest):
    """Analyze a text prompt and suggest a complete 8-category style configuration.
    
    Primary: Gemini Flash (fast, free-tier)
    Fallback: GPT-4o-mini (if Gemini quota exhausted)
    """
    prompt_text = f"""You are a visual style expert for an AI image generation app.

The user has typed this image generation prompt:
"{request.prompt}"

Based on this prompt, suggest the single best complete configuration across all 8 style categories.
Pick the options that would make this prompt produce the most visually stunning result.

Available options for each category:
- visualStyle: Photorealistic, Cinematic, Anime, Oil Painting, Watercolor, Concept Art, 3D Render, Minimalist
- medium: Digital Art, Photography, Charcoal, Ink Drawing, Acrylic, Mixed Media
- lighting: Golden Hour, Blue Hour, Studio, Dramatic, Neon, Volumetric, Moonlight, Candlelight
- composition: Centered, Rule of Thirds, Flat Lay, Panoramic
- cameraAngle: Worm's Eye View, Dutch Angle, Bird's Eye, Extreme Close-Up, Wide Shot, Medium Shot, Close-Up, Low Angle
- lens: 24mm Wide, 50mm Normal, 85mm Portrait, 135mm Telephoto, Macro, Fisheye
- mood: Serene, Dramatic, Ethereal, Mysterious, Melancholic, Futuristic, Romantic, Epic
- colorPalette: Vibrant, Muted, Pastel, Monochrome, Earth Tones, Neon/Cyber, Warm Tones, Cool Tones

IMPORTANT:
- You MUST pick exactly one value from each category's available options above.
- Do NOT invent new options.
- Respond ONLY with a valid JSON object. No markdown, no explanation outside the JSON.

{{
  "suggested": {{
    "visualStyle": "",
    "medium": "",
    "lighting": "",
    "composition": "",
    "cameraAngle": "",
    "lens": "",
    "mood": "",
    "colorPalette": ""
  }},
  "reason": "one short sentence explaining why this combination suits the prompt"
}}"""

    # ── Attempt 1: Gemini Flash (primary) ──
    gemini_client = flash_client if flash_client else global_client
    if gemini_client:
        try:
            response = await gemini_client.aio.models.generate_content(
                model="gemini-2.5-flash-lite",
                contents=[prompt_text],
                config=types.GenerateContentConfig(
                    temperature=0.7,
                    response_mime_type="application/json",
                )
            )
            text_content = response.text.strip()
            parsed = json.loads(text_content)
            if parsed.get("suggested") and isinstance(parsed["suggested"], dict):
                print(f"[PromptSuggest] [OK] Gemini succeeded")
                return parsed
        except Exception as e:
            print(f"[PromptSuggest] Gemini failed: {e}")

    # ── Attempt 2: Claude Sonnet 5 fallback ──
    if ANTHROPIC_API_KEY:
        try:
            print("[PromptSuggest] Falling back to Claude Sonnet 5...")
            ant_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
            resp = await asyncio.to_thread(
                ant_client.messages.create,
                model="claude-sonnet-5",
                system="You are a visual style expert. Respond ONLY with valid JSON, no markdown.",
                messages=[{"role": "user", "content": prompt_text}],
                max_tokens=800,
            )
            text_content = _extract_anthropic_text(resp)
            parsed = _parse_json_from_response(text_content)
            if parsed.get("suggested") and isinstance(parsed["suggested"], dict):
                print(f"[PromptSuggest] [OK] Claude Sonnet 5 fallback succeeded")
                return parsed
        except Exception as e_ant:
            print(f"[PromptSuggest] Claude Sonnet 5 fallback failed: {e_ant}")

    # ── Attempt 3: GPT-5.6-luna fallback ──
    if OPENAI_API_KEY:
        try:
            print("[PromptSuggest] Falling back to GPT-5.6-luna...")
            oai_client = openai_lib.OpenAI(api_key=OPENAI_API_KEY)
            resp = await asyncio.to_thread(
                oai_client.chat.completions.create,
                model="gpt-5.6-luna",
                messages=[
                    {"role": "system", "content": "You are a visual style expert. Respond ONLY with valid JSON, no markdown."},
                    {"role": "user", "content": prompt_text},
                ],
                max_completion_tokens=500,
                response_format={"type": "json_object"},
            )
            text_content = resp.choices[0].message.content.strip()
            parsed = json.loads(text_content)
            if parsed.get("suggested") and isinstance(parsed["suggested"], dict):
                print(f"[PromptSuggest] [OK] GPT-5.6-luna fallback succeeded")
                return parsed
        except Exception as e:
            print(f"[PromptSuggest] GPT-5.6-luna fallback failed: {e}")

    print("[PromptSuggest] All providers failed, returning empty.")
    return {"suggested": {}, "reason": ""}


@app.post("/api/recommend-styles")
async def recommend_styles(request: RecommendRequest, current_user: User = Depends(get_current_user)):
    """AI-driven style recommendations based on user selections.
    
    Primary: Gemini Flash
    Fallback: GPT-5.6-luna (if Gemini quota exhausted)
    """
    access_error = _generation_access_error(current_user)
    if access_error:
        raise access_error

    # Read the compatibility JSON to feed to the AI
    try:
        with open("style_compatibility.json", "r") as f:
            style_data = json.load(f)["compatibilityRules"]
    except Exception as e:
        print(f"[AI Recommend] Failed to read rules: {e}")
        style_data = {"visualStyle": ["Photorealistic", "Cinematic", "Anime", "Oil Painting", "Watercolor", "Concept Art", "3D Render", "Minimalist"]}

    selected_list = "\n".join([f"- {k}: {v}" for k, v in request.selections.items()])
    free_text_line = f'\nThe user also described their vision as: "{request.prompt.strip()}"' if request.prompt.strip() else ""

    prompt_text = f"""You are a visual style expert for an AI image generation app called Fasty.

The user is configuring a style for their image. Here is what they have selected so far:
{selected_list}
{free_text_line}

Your job:
1. Recommend the single best complete configuration across all 8 categories (visualStyle, medium, lighting, composition, cameraAngle, lens, mood, colorPalette)
2. For any category the user already selected, keep their choice UNLESS it strongly conflicts with another selection
3. If there is a conflict, suggest a fix and explain it in one short sentence
4. Write a single sentence (max 15 words) explaining why this combination works visually
5. Suggest 2 alternative complete configurations the user might also love

IMPORTANT: Respond ONLY with a valid JSON object. No markdown, no explanation outside the JSON.

{{
  "recommended": {{
    "visualStyle": "",
    "medium": "",
    "lighting": "",
    "composition": "",
    "cameraAngle": "",
    "lens": "",
    "mood": "",
    "colorPalette": ""
  }},
  "reason": "",
  "conflicts": [
    {{ "category": "", "userPicked": "", "suggested": "", "why": "" }}
  ],
  "alternatives": [
    {{
      "label": "",
      "visualStyle": "", "medium": "", "lighting": "", "composition": "",
      "cameraAngle": "", "lens": "", "mood": "", "colorPalette": ""
    }}
  ]
}}"""

    empty_result = {
        "recommended": {},
        "reason": "AI recommendation unavailable. Kept your original choices.",
        "conflicts": [],
        "alternatives": []
    }

    # ── Attempt 1: Gemini Flash (primary) ──
    gemini_client = flash_client if flash_client else global_client
    if gemini_client:
        try:
            response = await gemini_client.aio.models.generate_content(
                model="gemini-2.5-flash-lite",
                contents=[prompt_text],
                config=types.GenerateContentConfig(
                    temperature=0.7,
                    response_mime_type="application/json",
                )
            )
            text_content = response.text.strip()
            parsed = json.loads(text_content)
            print(f"[AI Recommend] [OK] Gemini succeeded")
            return parsed
        except Exception as e:
            print(f"[AI Recommend] Gemini failed: {e}")

    # ── Attempt 2: Claude Sonnet 5 fallback ──
    if ANTHROPIC_API_KEY:
        try:
            print("[AI Recommend] Falling back to Claude Sonnet 5...")
            ant_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
            resp = await asyncio.to_thread(
                ant_client.messages.create,
                model="claude-sonnet-5",
                system="You are a visual style expert. Respond ONLY with valid JSON, no markdown.",
                messages=[{"role": "user", "content": prompt_text}],
                max_tokens=1000,
            )
            text_content = _extract_anthropic_text(resp)
            parsed = _parse_json_from_response(text_content)
            if parsed.get("recommended") and isinstance(parsed["recommended"], dict):
                print(f"[AI Recommend] [OK] Claude Sonnet 5 fallback succeeded")
                return parsed
        except Exception as e_ant:
            print(f"[AI Recommend] Claude Sonnet 5 fallback failed: {e_ant}")

    # ── Attempt 3: GPT-5.6-luna fallback ──
    if OPENAI_API_KEY:
        try:
            print("[AI Recommend] Falling back to GPT-5.6-luna...")
            oai_client = openai_lib.OpenAI(api_key=OPENAI_API_KEY)
            resp = await asyncio.to_thread(
                oai_client.chat.completions.create,
                model="gpt-5.6-luna",
                messages=[
                    {"role": "system", "content": "You are a visual style expert. Respond ONLY with valid JSON, no markdown."},
                    {"role": "user", "content": prompt_text},
                ],
                max_completion_tokens=800,
                response_format={"type": "json_object"},
            )
            text_content = resp.choices[0].message.content.strip()
            parsed = json.loads(text_content)
            print(f"[AI Recommend] [OK] GPT-5.6-luna fallback succeeded")
            return parsed
        except Exception as e:
            print(f"[AI Recommend] GPT-5.6-luna fallback failed: {e}")

    print("[AI Recommend] All providers failed.")
    return empty_result



@app.post("/api/analyze-image")
async def analyze_image(request: AnalyzeRequest, current_user: User = Depends(get_current_user)):
    """Analyze an uploaded image using Gemini Vision.
    
    Uses a retry + model cascade fallback:
      1. Try each model in VISION_MODELS order
      2. Retry each model up to MAX_RETRIES_PER_MODEL times (exponential backoff)
      3. If ALL models fail, return an empty-field dict — never raises 500
    """
    access_error = _generation_access_error(current_user)
    if access_error:
        raise access_error

    if not PROJECT_ID:
        raise HTTPException(status_code=500, detail="GCP_PROJECT_ID not set")

    print("[Vision] Analyzing image with fallback cascade...")

    # Robust image byte resolver handling base64, data URLs, local disk paths, and remote URLs
    image_bytes = None
    if request.image_base64:
        try:
            b64_clean = request.image_base64.split(",")[1] if "," in request.image_base64 else request.image_base64
            image_bytes = base64.b64decode(b64_clean)
        except Exception as e:
            print(f"[Vision] Failed to decode image_base64: {e}")

    if not image_bytes and request.image_url:
        url_str = request.image_url.strip()
        if url_str.startswith("data:image/"):
            try:
                b64_clean = url_str.split(",")[1] if "," in url_str else url_str
                image_bytes = base64.b64decode(b64_clean)
            except Exception as e:
                print(f"[Vision] Failed to decode data URL: {e}")
        elif url_str.startswith("blob:"):
            print(f"[Vision] Browser blob URL cannot be fetched server-side: {url_str[:60]}")
        else:
            filename = os.path.basename(url_str)
            candidate_paths = [
                url_str.lstrip("/"),
                os.path.join("exports", "generated", filename),
                os.path.join("backend", "exports", "generated", filename),
                os.path.join(".", url_str.lstrip("/")),
            ]
            for cpath in candidate_paths:
                if os.path.isfile(cpath):
                    try:
                        with open(cpath, "rb") as f:
                            image_bytes = f.read()
                        print(f"[Vision] Loaded {len(image_bytes)} bytes directly from local file: {cpath}")
                        break
                    except Exception as e:
                        print(f"[Vision] Error reading local file {cpath}: {e}")

            if not image_bytes:
                if url_str.startswith("http://") or url_str.startswith("https://"):
                    try:
                        import httpx
                        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                            res = await client.get(url_str)
                            if res.status_code == 200:
                                image_bytes = res.content
                    except Exception as e:
                        print(f"[Vision] Failed HTTP fetch for {url_str[:80]}: {e}")
                else:
                    clean_rel = url_str.lstrip("/")
                    full_url = f"http://127.0.0.1:8005/{clean_rel}"
                    try:
                        import httpx
                        async with httpx.AsyncClient(timeout=10.0) as client:
                            res = await client.get(full_url)
                            if res.status_code == 200:
                                image_bytes = res.content
                    except Exception as e:
                        print(f"[Vision] Failed local server fetch for {full_url}: {e}")

    if not image_bytes:
        # Return fallback empty result structure instead of 422/400 validation error
        return {
            "initial_yaw_offset": 0,
            "primary_feature": None,
            "category": "SCENE",
            "description": "Image analysis unavailable"
        }

    categories_context_str = request.categories_context or ""
    prompt = f"""You are a visual analyzer for an AI image generation tool.

STEP 1 — Classify this image into ONE category:
- PERSON: Contains a human subject as the main focus
- SCENE: A location, room, environment, or setting
- STYLE: Abstract, artistic, or mood/color reference
- PRODUCT: An object or product

STEP 2 — Based on category, extract accordingly:

IF PERSON:
  Extract with extreme precision:
  - Exact face characteristics (face shape, eye color, eyebrow shape, nose structure, lip shape, skin tone)
  - Hair (color, length, texture, style)
  - Clothing (every garment, color, fit, material)
  - Pose and body position
  - Expression
  - Accessories (jewelry, glasses, etc)

IF SCENE:
  Extract:
  - Location type and architectural style
  - Spatial layout and depth
  - Lighting source, quality, direction
  - Color palette and temperature
  - Key objects and their positions
  - Atmosphere and mood

IF STYLE:
  Extract:
  - Color grade and palette
  - Contrast and tone
  - Artistic style
  - Mood and atmosphere
  - Camera/lens characteristics

IF PRODUCT:
  Extract:
  - Object type and shape
  - Materials and textures
  - Colors and finish
  - Scale and proportions

Valid options:
{categories_context_str}

Return ONLY valid JSON with exactly these keys:
{{
  "category": "PERSON|SCENE|STYLE|PRODUCT",
  "description": "1 concise sentence generation-ready description",
  "detailed_description": "precise extraction based on category rules above",
  "visual_style_prompt": "comma-separated style tags",
  "lighting": "best matching lighting label from options, or empty string",
  "composition": "best matching composition label from options, or empty string",
  "style": "best matching style label from options, or empty string"
}}"""

    last_error = None
    for model_name in VISION_MODELS:
        delay = 1
        for attempt in range(MAX_RETRIES_PER_MODEL):
            try:
                print(f"[Vision] Trying {model_name}, attempt {attempt + 1}...")
                def _do_vision():
                    return flash_client.models.generate_content(
                        model=model_name,
                        contents=[
                            types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
                            prompt
                        ],
                        config=types.GenerateContentConfig(
                            response_mime_type="application/json"
                        )
                    )
                response = await asyncio.to_thread(_do_vision)
                result = _parse_json_from_response(response.text)
                # Ensure all expected keys exist
                result.setdefault("category", "STYLE")
                result.setdefault("description", "")
                result.setdefault("detailed_description", "")
                result.setdefault("style", "")
                result.setdefault("lighting", "")
                result.setdefault("composition", "")
                result.setdefault("visual_style_prompt", "")
                result["_model_used"] = model_name
                print(f"[Vision] Success via {model_name}: {result}")
                return result
            except Exception as e:
                last_error = e
                print(f"[Vision] {model_name} attempt {attempt + 1} failed: {e}")
                if attempt < MAX_RETRIES_PER_MODEL - 1:
                    await asyncio.sleep(delay)
                    delay *= 2  # exponential backoff

    # ── Fallback 1: Claude Sonnet 5 Vision ──
    if ANTHROPIC_API_KEY and image_bytes:
        try:
            print(f"[Vision] All Gemini models exhausted ({last_error}). Trying Claude Sonnet 5 Vision fallback...")
            ant_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
            b64_encoded = base64.b64encode(image_bytes).decode("utf-8")
            def _do_claude_vision():
                return ant_client.messages.create(
                    model="claude-sonnet-5",
                    system="You are an expert visual analyzer. Respond ONLY with a valid JSON object.",
                    messages=[
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "image",
                                    "source": {
                                        "type": "base64",
                                        "media_type": "image/jpeg",
                                        "data": b64_encoded
                                    }
                                },
                                {"type": "text", "text": prompt}
                            ]
                        }
                    ],
                    max_tokens=1500,
                )
            claude_resp = await asyncio.to_thread(_do_claude_vision)
            raw_json = _extract_anthropic_text(claude_resp)
            result = _parse_json_from_response(raw_json)
            result.setdefault("category", "STYLE")
            result.setdefault("description", "")
            result.setdefault("detailed_description", "")
            result.setdefault("style", "")
            result.setdefault("lighting", "")
            result.setdefault("composition", "")
            result.setdefault("visual_style_prompt", "")
            result["_model_used"] = "claude-haiku-4.5"
            print(f"[Vision] Success via Claude Haiku 4.5 Vision fallback: {result}")
            return result
        except Exception as e_claude:
            print(f"[Vision] Claude Haiku 4.5 Vision fallback failed: {e_claude}")

    # ── Fallback 2: GPT-5.6-luna Vision ──
    if OPENAI_API_KEY and image_bytes:
        try:
            print(f"[Vision] Trying GPT-5.6-luna Vision fallback...")
            oai_client = openai_lib.OpenAI(api_key=OPENAI_API_KEY)
            b64_encoded = base64.b64encode(image_bytes).decode("utf-8")
            b64_url = f"data:image/jpeg;base64,{b64_encoded}"
            def _do_luna_vision():
                return oai_client.chat.completions.create(
                    model="gpt-5.6-luna",
                    messages=[
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": prompt},
                                {"type": "image_url", "image_url": {"url": b64_url, "detail": "low"}}
                            ]
                        }
                    ],
                    max_completion_tokens=1000,
                    response_format={"type": "json_object"},
                )
            luna_resp = await asyncio.to_thread(_do_luna_vision)
            raw_json = luna_resp.choices[0].message.content.strip()
            result = _parse_json_from_response(raw_json)
            result.setdefault("category", "STYLE")
            result.setdefault("description", "")
            result.setdefault("detailed_description", "")
            result.setdefault("style", "")
            result.setdefault("lighting", "")
            result.setdefault("composition", "")
            result.setdefault("visual_style_prompt", "")
            result["_model_used"] = "gpt-5.6-luna"
            print(f"[Vision] Success via GPT-5.6-luna Vision fallback: {result}")
            return result
        except Exception as e_luna:
            print(f"[Vision] GPT-5.6-luna Vision fallback failed: {e_luna}")

    # All models exhausted — return minimal valid object, never 500
    print(f"[Vision] All fallbacks exhausted. Last error: {last_error}")
    return {
        "category": "STYLE",
        "description": "",
        "detailed_description": "",
        "style": "",
        "lighting": "",
        "composition": "",
        "visual_style_prompt": "",
        "_model_used": "none",
        "_fallback_exhausted": True
    }


async def _process_session_batch(session_id: str, request: SessionCreateRequest):
    db: Session = SessionLocal()
    try:
        images = db.query(DBImage).filter(DBImage.session_id == session_id).all()

        async def run_model(img_id, model_id):
            url = None
            status = "failed"
            error_msg = None
            detected_intent = None
            try:
                if session_id in CANCELLED_SESSIONS:
                    raise asyncio.CancelledError("Session cancelled by user")

                # ── Vision-Aware Prompt Blending ──
                effective_prompt = request.prompt
                if request.image_base64 and (_is_enhance_refine_intent(request.prompt) or _is_enhance_refine_intent(request.edit_instruction or "")):
                    detected_intent = "ENHANCE_REFINE"
                    effective_prompt = _build_studio_enhance_refine_prompt(request.prompt, request.vision_description)
                    print(f"[Session:{session_id}] ENHANCE_REFINE intent fast-path detected for {model_id}. Prompt:\n{effective_prompt[:150]}")
                elif request.edit_instruction:
                    if request.vision_description:
                        # Edit with a NEW reference image -> use edit-aware vision blender
                        print(f"[Session:{session_id}] Edit-aware blending for {model_id}...")
                        effective_prompt = await _blend_edit_with_vision(
                            request.edit_instruction, request.prompt, request.vision_description
                        )
                    else:
                        # Direct edit without new reference image -> synthesize clean history
                        if _is_pure_camera_angle_request(request.edit_instruction):
                            print(f"[Session:{session_id}] Pure camera angle change intent detected for {model_id}...")
                            orig = (request.prompt_history[0] if request.prompt_history else request.prompt) or request.prompt
                            effective_prompt, _cam_rotate, _cam_vertical = await _rewrite_camera_angle_prompt(
                                orig, request.edit_instruction,
                                image_b64=request.image_base64,
                                master_prompt=orig
                            )
                        else:
                            print(f"[Session:{session_id}] Synthesizing edit history for {model_id}...")
                            history = request.prompt_history or [request.prompt]
                            effective_prompt = await _synthesize_edit_prompt(history, request.edit_instruction)
                        # Save the synthesized / AI prompt to enhanced_prompt, preserving prompt as the user's authentic input
                        db.query(DBSession).filter(DBSession.id == session_id).update({"enhanced_prompt": effective_prompt})
                        db.commit()
                    print(f"[Session:{session_id}] Blended prompt: {effective_prompt[:200]}")
                elif request.vision_description:
                    # Fresh generation flow: use standard intent classification
                    print(f"[Session:{session_id}] Blending vision description with prompt for {model_id}...")
                    effective_prompt, detected_intent = await _blend_vision_with_prompt(
                        request.prompt, request.vision_description
                    )
                    print(f"[Session:{session_id}] Blended prompt: {effective_prompt[:200]}")

                if session_id in CANCELLED_SESSIONS:
                    raise asyncio.CancelledError("Session cancelled by user")

                print(f"[Session:{session_id}] Starting model: {model_id}")
                img_ep = None
                if model_id in ["Nanobanana 2", "Nanobanana 2 (Beta)", "Nanobanana Pro"]:
                    config = load_nanobanana_config()
                    is_beta_flag = False
                    use_top_p = None
                    if model_id in ["Nanobanana 2", "Nanobanana 2 (Beta)"]:
                        cfg = config.get("beta", {"model": "gemini-3.1-flash-image", "temperature": 0.7})
                        nb_model = cfg.get("model", "gemini-3.1-flash-image")
                        temp = cfg.get("temperature", 0.7)
                        is_beta_flag = True
                        use_top_p = 0.85
                    else: # Nanobanana Pro
                        nb_model = "gemini-3-pro-image"
                        temp = 0.4
                    
                    do_bypass = bool(request.vision_description)
                    nanobanana_prompt = effective_prompt
                    
                    image_input = request.image_base64
                    is_studio_direct_edit = bool(request.vision_description and detected_intent == "DIRECT_EDIT")
                    is_studio_enhance_refine = bool(
                        request.image_base64 and (
                            detected_intent == "ENHANCE_REFINE"
                            or _is_enhance_refine_intent(request.prompt)
                            or _is_enhance_refine_intent(request.edit_instruction or "")
                        )
                    )

                    if is_studio_enhance_refine:
                        template_used_name = "STUDIO-ENHANCE-REFINE"
                        nanobanana_prompt = _build_studio_enhance_refine_prompt(request.prompt, request.vision_description)
                        temp = 0.2
                        use_top_p = 0.75
                        do_bypass = True
                        print(f"[ENHANCE-REFINE] Precision enhancement protocol active (temp={temp}, top_p={use_top_p}):\n{nanobanana_prompt}")
                    elif (request.edit_instruction and request.image_base64 and not request.vision_description) or (is_studio_direct_edit and request.image_base64):
                        if _is_pure_camera_angle_request(request.edit_instruction):
                            template_used_name = "CAMERA-ANGLE-VISION-REWRITE"
                            cam_rot, cam_vert = _parse_angles_from_text(request.edit_instruction)
                            cam_texture_mandate = (
                                "[ULTRA PHOTOREALISM & SKIN DETAIL MANDATE]: Render with authentic organic skin texture, visible natural pore micro-detail, fine facial epidermal grain, "
                                "natural subsurface light scattering on warm skin tones, distinct individual hair strands, and razor-sharp micro-contrast on fabric fibers and textile weaves. "
                                "Strictly prohibit digital airbrushing, plastic skin smoothing, artificial beauty filters, blur, or cartoonish CGI sheen. "
                                "Shot on 80mm Hasselblad medium format, tack sharp focus, razor sharp edge fidelity, natural cinematic color grading."
                            )
                            nanobanana_prompt = (
                                f"[TASK]: Camera viewpoint transformation.\n"
                                f"[REFERENCE IMAGE]: Preserve the exact subject identity, product details, label text, materials, colors, lighting tone, and environment from the reference image.\n"
                                f"{cam_texture_mandate}\n"
                                f"[NEW VIEWPOINT]: {effective_prompt}\n"
                                f"[CONSTRAINTS]: Render this exact scene and subjects from the specified new camera angle. Do not alter branding, subject identity, or environment styling."
                            )
                            
                            temp = 0.3
                            use_top_p = 0.75
                            do_bypass = True
                            print(f"[CAMERA-ANGLE] Vision-rewritten prompt ({len(nanobanana_prompt)} chars, rot={cam_rot}°, vert={cam_vert}°):\n{nanobanana_prompt}")
                        else:
                            template_used_name = "VISION-ANCHORED-EDIT"
                            raw_instruction = request.edit_instruction or request.prompt
                            depth = getattr(request, "edit_depth", 1)

                            nanobanana_prompt = await _build_vision_anchored_edit_prompt(
                                image_b64=request.image_base64,
                                edit_instruction=raw_instruction,
                                history=request.prompt_history,
                                original_image_b64=request.original_image_base64,
                                edit_depth=depth
                            )

                            temp = 0.35
                            use_top_p = 0.75

                            if getattr(request, "edit_type", "inpainting") == "structural":
                                image_input = request.image_base64
                                print(f"[EDIT-APPROACH-2] Structural Addition active: modifying current scene canvas ({len(image_input)} chars)")
                            elif request.original_image_base64 and depth > 1:
                                image_input = request.original_image_base64
                                print(f"[EDIT-APPROACH-2] Structural Rebase active: re-anchoring to pristine structural lock reference ({len(image_input)} chars)")
                            else:
                                image_input = request.image_base64
                                print(f"[EDIT-APPROACH-2] Anchor mode: using base image state ({len(image_input)} chars)")
                        do_bypass = True
                        print(f"[EDIT-API-PROMPT] user_instruction='{request.edit_instruction}' template_used='{template_used_name}' final_prompt='{nanobanana_prompt}'")
                    else:
                        pass

                    batch_req_src = "EDIT" if (getattr(request, "is_edit", False) or getattr(request, "edit_instruction", None)) else "STUDIO"
                    imgs, _actual_ep, _actual_pt = await _gemini_generate(
                        nanobanana_prompt, request.ratio, request.quality, image_input, nb_model, 
                        temperature=temp, top_p=use_top_p, is_beta=is_beta_flag, bypass_enhancement=do_bypass,
                        session_id=session_id, request_source=batch_req_src
                    )
                    if imgs: 
                        url = imgs[0]
                        img_ep = _actual_ep

                    if url and not do_bypass and _actual_ep:
                        try:
                            save_db = SessionLocal()
                            try:
                                save_db.query(DBSession).filter(DBSession.id == session_id).update({
                                    "enhanced_prompt": _actual_ep,
                                    "pipeline_type": _actual_pt
                                })
                                save_db.commit()
                                print(f"[Session:{session_id}] Saved enhanced_prompt ({len(_actual_ep)} chars) + pipeline_type={_actual_pt} to DB")
                            except Exception as save_err:
                                print(f"[Session:{session_id}] Failed to save enhanced_prompt: {save_err}")
                                save_db.rollback()
                            finally:
                                save_db.close()
                        except Exception as e:
                            print(f"[Session:{session_id}] Could not compute enhanced_prompt for DB: {e}")
                elif model_id == "ChatGPT":
                    chatgpt_m = request.active_configs.get("chatgpt_model", "gpt-image-2")
                    imgs, _chatgpt_ep, _ = await _chatgpt_image_generate(effective_prompt, request.ratio, request.quality, request.image_base64, chatgpt_m)
                    if imgs: 
                        url = imgs[0]
                        img_ep = _chatgpt_ep
                elif model_id == "Flux.1":
                    imgs = await _flux_generate(effective_prompt, request.ratio, request.quality, image_b64=request.image_base64)
                    if imgs: url = imgs[0]
                elif model_id == "Kling":
                    imgs = await _kling_generate(effective_prompt, request.ratio, request.image_base64, request.quality)
                    if imgs: url = imgs[0]
                elif model_id == "OpenAI":
                    imgs, _chatgpt_ep, _ = await _chatgpt_image_generate(effective_prompt, request.ratio, request.quality, request.image_base64, "gpt-image-2")
                    if imgs: 
                        url = imgs[0]
                        img_ep = _chatgpt_ep
                else:
                    print(f"[Session:{session_id}] Unknown model: {model_id} — skipping")
                    error_msg = f"Unknown model: {model_id}"
                
                if url:
                    status = "completed"
                    print(f"[Session:{session_id}] {model_id} completed successfully")
                else:
                    print(f"[Session:{session_id}] {model_id} returned no image")
            except asyncio.CancelledError:
                status = "cancelled"
                error_msg = "Cancelled by user"
                print(f"[Session:{session_id}] {model_id} cancelled by user")
                raise
            except Exception as e:
                raw_err = str(e)
                error_msg = _format_user_friendly_error(raw_err)
                print(f"[Session:{session_id}] {model_id} FAILED: {raw_err}")
            finally:
                if session_id in CANCELLED_SESSIONS or status == "cancelled":
                    status = "cancelled"
                    error_msg = error_msg or "Cancelled by user"
                
                url = await _materialize_image_url(url)

                # Re-fetch or use a new session to update
                try:
                    update_db = SessionLocal()
                    try:
                        update_db.query(DBImage).filter(DBImage.id == img_id).update({
                            "status": status, 
                            "url": url,
                            "error_msg": error_msg,
                            "enhanced_prompt": img_ep
                        })
                        update_db.commit()
                    except Exception as db_err:
                        print(f"Database update failed for image {img_id}: {db_err}")
                        update_db.rollback()
                    finally:
                        update_db.close()
                except Exception as e:
                    print(f"Could not create database session for image {img_id}: {e}")

        tasks = [asyncio.create_task(run_model(img.id, img.model_id)) for img in images]

        # ── Parallel AI moderation (runs concurrently with generation) ──
        # If flagged within ~200ms, all generation tasks are cancelled immediately.
        has_image = bool(request.image_base64 or request.original_image_base64)
        moderation_task = None
        if has_image:
            mod_image = request.image_base64 if isinstance(request.image_base64, str) else (
                request.image_base64[0] if isinstance(request.image_base64, list) and request.image_base64 else None
            )
            if not mod_image:
                mod_image = request.original_image_base64
            if mod_image:
                moderation_task = asyncio.create_task(check_image_moderation(mod_image))
        elif request.prompt:
            moderation_task = asyncio.create_task(check_text_moderation(request.prompt))

        try:
            if moderation_task:
                # Wait for the fast moderation check (~150ms), then let generation continue
                try:
                    is_safe, block_reason = await asyncio.wait_for(asyncio.shield(moderation_task), timeout=4.0)
                    if not is_safe:
                        print(f"[Session:{session_id}] ⛔ Content safety moderation BLOCKED: {block_reason}")
                        # Cancel all running generation tasks
                        for t in tasks:
                            try:
                                t.cancel()
                            except Exception:
                                pass
                        # Update all images to failed in DB
                        try:
                            mod_db = SessionLocal()
                            mod_db.query(DBImage).filter(
                                DBImage.session_id == session_id,
                                DBImage.status.in_(["pending", "generating", "processing"])
                            ).update({
                                "status": "failed",
                                "error_msg": f"Content blocked: {block_reason}"
                            }, synchronize_session=False)
                            mod_db.commit()
                            mod_db.close()
                        except Exception as _mod_db_err:
                            print(f"[Session:{session_id}] Moderation DB cleanup error: {_mod_db_err}")
                        await asyncio.gather(*tasks, return_exceptions=True)
                        return  # Abort entire batch
                except asyncio.TimeoutError:
                    print(f"[Session:{session_id}] Content moderation timed out, failing open.")

            await asyncio.gather(*tasks)
        except asyncio.CancelledError:
            print(f"[Session:{session_id}] Session batch was cancelled by user.")
            try:
                clean_db = SessionLocal()
                clean_db.query(DBImage).filter(
                    DBImage.session_id == session_id,
                    DBImage.status.in_(["pending", "generating", "processing"])
                ).update({"status": "cancelled", "error_msg": "Cancelled by user"}, synchronize_session=False)
                clean_db.commit()
                clean_db.close()
            except Exception as _c_err:
                print(f"[Session:{session_id}] DB cleanup error: {_c_err}")
    finally:
        RUNNING_SESSION_TASKS.pop(session_id, None)
        CANCELLED_SESSIONS.discard(session_id)
        db.close()


async def _process_upscale(upscaled_id: str, original_url: str, prompt: str, ratio: str):
    db: Session = SessionLocal()
    try:
        upscaled_record = db.query(DBUpscaledImage).filter(DBUpscaledImage.id == upscaled_id).first()
        if not upscaled_record:
            return
            
        print(f"[Upscale:{upscaled_id}] Starting tile upscale for {original_url}")
        
        # Get the original image bytes
        if original_url.startswith("/exports/"):
            # It's a locally materialized image, read from disk
            local_path = original_url.lstrip("/")
            if not os.path.exists(local_path) and os.path.exists(os.path.join("backend", local_path)):
                local_path = os.path.join("backend", local_path)
            with open(local_path, "rb") as f:
                base_bytes = f.read()
        else:
            # It's a remote URL, download it
            async with httpx.AsyncClient() as client:
                resp = await client.get(original_url)
                resp.raise_for_status()
                base_bytes = resp.content
            
        # Run tile upscale — pass original prompt + pipeline_type for context-aware tile prompts
        nb_model = "gemini-3.1-flash-image"
        pipeline_type = "COMMERCIAL"  # default
        original = db.query(DBImage).filter(DBImage.id == upscaled_record.original_image_id).first()
        if original and original.session:
            pt = getattr(original.session, "pipeline_type", None)
            if pt:
                pipeline_type = pt.replace("SMART_", "")
        tile_url = await _tile_upscale(base_bytes, prompt, ratio, nb_model, pipeline_type=pipeline_type, upscaled_id=upscaled_id)
        
        # Refresh record in case it was cancelled while tile_upscale was running
        upscaled_record = db.query(DBUpscaledImage).filter(DBUpscaledImage.id == upscaled_id).first()
        if upscaled_record and upscaled_record.status == "cancelled":
            print(f"[Upscale:{upscaled_id}] Task was cancelled, not overwriting status.")
            return

        if tile_url:
            upscaled_record.status = "success"
            upscaled_record.url = tile_url
        else:
            if upscaled_record and upscaled_record.status != "cancelled":
                upscaled_record.status = "failed"
                upscaled_record.error_msg = "Tile upscale failed or was stopped"
            
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"[Upscale:{upscaled_id}] Failed: {e}")
        upscaled_record = db.query(DBUpscaledImage).filter(DBUpscaledImage.id == upscaled_id).first()
        if upscaled_record and upscaled_record.status != "cancelled":
            upscaled_record.status = "failed"
            upscaled_record.error_msg = str(e)
            db.commit()
    finally:
        db.close()


@app.post("/api/upscale")
async def request_upscale(
    request: UpscaleRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    # Check daily upscale quota first
    quota_error = _check_daily_upscale_quota(user, db)
    if quota_error:
        raise quota_error

    original = None
    if request.image_id:
        original = db.query(DBImage).filter(DBImage.id == request.image_id).first()

    if not original and request.image_url:
        clean_url = request.image_url.split("?")[0]
        filename = clean_url.split("/")[-1]
        original = db.query(DBImage).filter(
            or_(
                DBImage.url == request.image_url,
                DBImage.url == clean_url,
                DBImage.url.like(f"%{filename}")
            )
        ).first()

    if not original and request.image_url:
        ad_hoc_id = str(uuid.uuid4())
        original = DBImage(
            id=ad_hoc_id,
            session_id=None,
            user_id=user.id,
            model_id="Direct",
            status="completed",
            url=request.image_url,
            created_at=datetime.utcnow().isoformat()
        )
        db.add(original)
        db.commit()
        db.refresh(original)

    if not original:
        raise HTTPException(status_code=404, detail="Image not found")
        
    upscaled = DBUpscaledImage(
        user_id=user.id,
        original_image_id=original.id,
        status="pending"
    )
    db.add(upscaled)
    db.commit()
    db.refresh(upscaled)
    
    # We pass prompt and ratio from the original session
    prompt = original.session.prompt if original.session and original.session.prompt else ""
    ratio = original.session.ratio if original.session and original.session.ratio else "1:1"
    
    background_tasks.add_task(_process_upscale, upscaled.id, original.url, prompt, ratio)
    
    return {"status": "processing", "upscaled_id": upscaled.id}


@app.post("/api/upscale/{upscale_id}/cancel")
@app.delete("/api/upscale/{upscale_id}")
async def cancel_upscale(
    upscale_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    rec = db.query(DBUpscaledImage).filter(
        DBUpscaledImage.id == upscale_id,
        DBUpscaledImage.user_id == user.id
    ).first()
    if not rec:
        raise HTTPException(status_code=404, detail="Upscale record not found")
    
    rec.status = "cancelled"
    rec.error_msg = "Stopped by user"
    db.commit()
    print(f"[Upscale] User cancelled upscale {upscale_id}")
    return {"status": "cancelled", "id": upscale_id}

@app.get("/api/upscales")
async def get_upscales(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    upscales = db.query(DBUpscaledImage).filter(DBUpscaledImage.user_id == user.id).order_by(DBUpscaledImage.created_at.desc()).all()
    result = []
    for u in upscales:
        result.append({
            "id": u.id,
            "original_image_id": u.original_image_id,
            "url": u.url,
            "status": u.status,
            "error_msg": u.error_msg,
            "created_at": u.created_at.isoformat() if u.created_at else None
        })
    return {"upscales": result}


@app.get("/api/quota")
async def get_quota(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Returns the current user's usage vs. limits for the week/day."""
    is_admin = user.role == 'admin'
    week_ago = datetime.utcnow() - timedelta(days=7)
    day_ago = datetime.utcnow() - timedelta(days=1)
    images_used = (
        db.query(func.count(DBImage.id))
        .join(DBSession, DBImage.session_id == DBSession.id)
        .filter(DBSession.user_id == user.id, DBImage.status == 'completed', DBImage.created_at >= week_ago.isoformat())
        .scalar() or 0
    )
    upscales_used = (
        db.query(func.count(DBUpscaledImage.id))
        .filter(DBUpscaledImage.user_id == user.id, DBUpscaledImage.created_at >= day_ago)
        .scalar() or 0
    )
    return {
        "images_used_this_week": images_used,
        "images_limit_per_week": -1 if is_admin else (getattr(user, 'images_limit_per_week', 50) or 50),
        "upscales_used_today": upscales_used,
        "upscales_limit_per_day": -1 if is_admin else (getattr(user, 'upscales_limit_per_day', 5) or 5),
    }



# ── ADMIN ENDPOINTS ──────────────────────────────────────────────────────────

def _require_admin(user: User):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required.")


class AdminUpdateLimitsRequest(BaseModel):
    images_limit_per_week: Optional[int] = None
    upscales_limit_per_day: Optional[int] = None


class AdminUpdateAccessRequest(BaseModel):
    is_active: bool


class AdminUpdateNoDeleteRequest(BaseModel):
    no_auto_delete: bool


class AdminUpdateVideoAccessRequest(BaseModel):
    can_generate_video: bool


@app.get("/api/admin/users")
async def admin_list_users(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    _require_admin(user)
    week_ago = datetime.utcnow() - timedelta(days=7)
    day_ago = datetime.utcnow() - timedelta(days=1)
    all_users = db.query(User).order_by(User.created_at.desc()).all()
    result = []
    for u in all_users:
        # Count successful images this week
        images_this_week = (
            db.query(func.count(DBImage.id))
            .join(DBSession, DBImage.session_id == DBSession.id)
            .filter(DBSession.user_id == u.id, DBImage.status == 'completed', DBImage.created_at >= week_ago.isoformat())
            .scalar() or 0
        )
        # Count total images ever (standard, compare, storyboard frames, characters, products)
        total_std = (
            db.query(func.count(DBImage.id))
            .join(DBSession, DBImage.session_id == DBSession.id)
            .filter(DBSession.user_id == u.id, DBImage.status == 'completed')
            .scalar() or 0
        )
        total_cmp = (
            db.query(func.count(DBCompareImage.id))
            .join(DBCompareSession, DBCompareImage.compare_session_id == DBCompareSession.id)
            .filter(DBCompareSession.user_id == u.id, DBCompareImage.status == 'completed')
            .scalar() or 0
        )
        total_frames = (
            db.query(func.count(StoryboardFrame.id))
            .join(Storyboard, StoryboardFrame.storyboard_id == Storyboard.id)
            .filter(Storyboard.user_id == u.id, StoryboardFrame.image_path.isnot(None))
            .scalar() or 0
        )
        total_chars = (
            db.query(func.count(StoryboardCharacter.id))
            .join(Storyboard, StoryboardCharacter.storyboard_id == Storyboard.id)
            .filter(Storyboard.user_id == u.id, StoryboardCharacter.image_path.isnot(None))
            .scalar() or 0
        )
        total_prods = (
            db.query(func.count(StoryboardProduct.id))
            .join(Storyboard, StoryboardProduct.storyboard_id == Storyboard.id)
            .filter(Storyboard.user_id == u.id, StoryboardProduct.image_path.isnot(None))
            .scalar() or 0
        )
        total_images = total_std + total_cmp + total_frames + total_chars + total_prods
        # Count upscales today
        upscales_today = (
            db.query(func.count(DBUpscaledImage.id))
            .filter(DBUpscaledImage.user_id == u.id, DBUpscaledImage.created_at >= day_ago)
            .scalar() or 0
        )
        result.append({
            **u.to_dict(),
            "images_this_week": images_this_week,
            "total_images": total_images,
            "upscales_today": upscales_today,
        })
    return {"users": result}


@app.put("/api/admin/users/{user_id}/limits")
async def admin_update_limits(
    user_id: str,
    request: AdminUpdateLimitsRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    _require_admin(user)
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if request.images_limit_per_week is not None:
        target.images_limit_per_week = request.images_limit_per_week
    if request.upscales_limit_per_day is not None:
        target.upscales_limit_per_day = request.upscales_limit_per_day
    db.commit()
    return {"status": "ok", "user_id": user_id, "images_limit_per_week": target.images_limit_per_week, "upscales_limit_per_day": target.upscales_limit_per_day}


@app.put("/api/admin/users/{user_id}/access")
async def admin_update_access(
    user_id: str,
    request: AdminUpdateAccessRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    _require_admin(user)
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.role == "admin":
        raise HTTPException(status_code=400, detail="Cannot revoke access of another admin.")
    target.is_active = request.is_active
    db.commit()
    return {"status": "ok", "user_id": user_id, "is_active": target.is_active}


@app.put("/api/admin/users/{user_id}/no-delete")
async def admin_update_no_delete(
    user_id: str,
    request: AdminUpdateNoDeleteRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    _require_admin(user)
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    target.no_auto_delete = request.no_auto_delete
    db.commit()
    return {"status": "ok", "user_id": user_id, "no_auto_delete": target.no_auto_delete}


@app.put("/api/admin/users/{user_id}/video-access")
async def admin_update_video_access(
    user_id: str,
    request: AdminUpdateVideoAccessRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    _require_admin(user)
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    target.can_generate_video = request.can_generate_video
    db.commit()
    return {"status": "ok", "user_id": user_id, "can_generate_video": target.can_generate_video}


# ── TELEMETRY ADMIN ENDPOINTS ─────────────────────────────────────────────────

@app.get("/api/admin/telemetry/live")
async def admin_telemetry_live(user: User = Depends(get_current_user)):
    """Returns the real-time in-memory concurrency snapshot — zero DB cost."""
    _require_admin(user)
    return {
        "active_gemini_calls": _gemini_active_count,
        "semaphore_limit": 2,
        "semaphore_available": _GEMINI_IMAGE_SEMAPHORE._value,  # type: ignore[attr-defined]
    }


@app.get("/api/admin/telemetry/summary")
async def admin_telemetry_summary(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """7-day daily aggregate stats: request count, 429 rate, p50/p90/p95 latency, peak concurrency."""
    _require_admin(user)
    from datetime import timedelta
    cutoff = datetime.utcnow() - timedelta(days=7)

    events = (
        db.query(GeminiTelemetryEvent)
        .filter(GeminiTelemetryEvent.created_at >= cutoff)
        .order_by(GeminiTelemetryEvent.created_at.asc())
        .all()
    )

    # Group by IST date (UTC + 5:30)
    from collections import defaultdict
    from datetime import timedelta
    import statistics
    IST_OFFSET = timedelta(hours=5, minutes=30)
    daily: Dict[str, list] = defaultdict(list)
    for ev in events:
        day = (ev.created_at + IST_OFFSET).strftime("%Y-%m-%d")
        daily[day].append(ev)

    result = []
    for day in sorted(daily.keys()):
        evs = daily[day]
        total = len(evs)
        count_429 = sum(1 for e in evs if e.status == "429")
        latencies = sorted([e.latency_ms for e in evs if e.latency_ms is not None])
        peak_conc = max((e.concurrency_at_dispatch or 0 for e in evs), default=0)
        source_counts: Dict[str, int] = defaultdict(int)
        for e in evs:
            src = getattr(e, "request_source", None) or "STUDIO"
            source_counts[src] += 1

        def pct(arr, p):
            if not arr:
                return None
            idx = int(len(arr) * p / 100)
            return arr[min(idx, len(arr) - 1)]

        result.append({
            "date": day,
            "total_requests": total,
            "success_count": sum(1 for e in evs if e.status == "success"),
            "count_429": count_429,
            "rate_429_pct": round(count_429 / total * 100, 1) if total else 0,
            "p50_latency_ms": pct(latencies, 50),
            "p90_latency_ms": pct(latencies, 90),
            "p95_latency_ms": pct(latencies, 95),
            "peak_concurrency": peak_conc,
            "source_breakdown": dict(source_counts),
        })

    # Also compute overall 7-day totals
    all_latencies = sorted([e.latency_ms for e in events if e.latency_ms is not None])
    total_all = len(events)
    count_429_all = sum(1 for e in events if e.status == "429")
    total_sources: Dict[str, int] = defaultdict(int)
    for e in events:
        src = getattr(e, "request_source", None) or "STUDIO"
        total_sources[src] += 1

    def pct(arr, p):
        if not arr:
            return None
        idx = int(len(arr) * p / 100)
        return arr[min(idx, len(arr) - 1)]

    return {
        "days": result,
        "totals": {
            "total_requests": total_all,
            "count_429": count_429_all,
            "rate_429_pct": round(count_429_all / total_all * 100, 1) if total_all else 0,
            "p50_latency_ms": pct(all_latencies, 50),
            "p90_latency_ms": pct(all_latencies, 90),
            "p95_latency_ms": pct(all_latencies, 95),
            "source_breakdown": dict(total_sources),
        },
        "live": {
            "active_gemini_calls": _gemini_active_count,
        }
    }


@app.get("/api/admin/telemetry/incidents")
async def admin_telemetry_incidents(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Returns the last 100 non-success events (429s, 503s, errors) from the past 7 days."""
    _require_admin(user)
    from datetime import timedelta
    cutoff = datetime.utcnow() - timedelta(days=7)

    incidents = (
        db.query(GeminiTelemetryEvent)
        .filter(
            GeminiTelemetryEvent.created_at >= cutoff,
            GeminiTelemetryEvent.status != "success"
        )
        .order_by(GeminiTelemetryEvent.created_at.desc())
        .limit(100)
        .all()
    )

    IST_OFFSET = timedelta(hours=5, minutes=30)
    return {
        "incidents": [
            {
                "id": ev.id,
                "timestamp": (ev.created_at.isoformat() + "Z") if not ev.created_at.isoformat().endswith("Z") else ev.created_at.isoformat(),
                "timestamp_ist": (ev.created_at + IST_OFFSET).strftime("%d/%m/%Y, %I:%M:%S %p"),
                "status": ev.status,
                "model_used": ev.model_used,
                "error_code": ev.error_code,
                "concurrency_at_dispatch": ev.concurrency_at_dispatch,
                "burst_velocity_10s": ev.burst_velocity_10s,
                "latency_ms": ev.latency_ms,
                "retry_attempt": ev.retry_attempt,
                "backoff_delay_ms": ev.backoff_delay_ms,
                "recovery_time_ms": ev.recovery_time_ms,
                "pipeline_type": ev.pipeline_type,
                "aspect_ratio": ev.aspect_ratio,
                "is_image_to_image": ev.is_image_to_image,
                "request_source": getattr(ev, "request_source", None) or "STUDIO",
            }
            for ev in incidents
        ]
    }


@app.get("/api/admin/telemetry/hourly")
async def admin_telemetry_hourly(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Hourly heatmap: requests and 429s by hour-of-day (0-23) aggregated over the past 7 days."""
    _require_admin(user)
    from datetime import timedelta
    from collections import defaultdict
    cutoff = datetime.utcnow() - timedelta(days=7)

    events = (
        db.query(GeminiTelemetryEvent)
        .filter(GeminiTelemetryEvent.created_at >= cutoff)
        .all()
    )

    # Bucket by hour of day in Indian Standard Time (IST, UTC+5:30)
    IST_OFFSET = timedelta(hours=5, minutes=30)
    by_hour: Dict[int, Dict[str, int]] = {h: {"total": 0, "count_429": 0} for h in range(24)}
    for ev in events:
        h = (ev.created_at + IST_OFFSET).hour
        by_hour[h]["total"] += 1
        if ev.status == "429":
            by_hour[h]["count_429"] += 1

    heatmap = [
        {
            "hour": h,
            "total": by_hour[h]["total"],
            "count_429": by_hour[h]["count_429"],
            "rate_429_pct": round(by_hour[h]["count_429"] / by_hour[h]["total"] * 100, 1) if by_hour[h]["total"] else 0,
        }
        for h in range(24)
    ]
    return {"heatmap": heatmap}


def _normalize_media_url(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    url_str = str(url).strip()
    if not url_str:
        return None
    if url_str.startswith("http://") or url_str.startswith("https://") or url_str.startswith("data:"):
        return url_str
    if not url_str.startswith("/"):
        return f"/{url_str}"
    return url_str


def parse_datetime(val):
    if not val:
        return datetime.min
    if isinstance(val, datetime):
        if val.tzinfo is not None:
            return val.astimezone(timezone.utc).replace(tzinfo=None)
        return val
    val_str = str(val).strip()
    if not val_str:
        return datetime.min
    try:
        if val_str.endswith('Z'):
            val_str = val_str[:-1] + '+00:00'
        dt = datetime.fromisoformat(val_str)
        if dt.tzinfo is not None:
            return dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except Exception:
        pass
    for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(val_str, fmt)
            if dt.tzinfo is not None:
                return dt.astimezone(timezone.utc).replace(tzinfo=None)
            return dt
        except Exception:
            continue
    return datetime.min


@app.get("/api/admin/users/{user_id}/images")
async def admin_get_user_images(
    user_id: str,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    _require_admin(user)
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    
    fetch_count = limit + offset
    
    # 1. Standard generations
    standard_images = (
        db.query(DBImage, DBSession)
        .join(DBSession, DBImage.session_id == DBSession.id)
        .filter(DBSession.user_id == user_id, DBImage.status == 'completed')
        .order_by(DBImage.created_at.desc())
        .limit(fetch_count)
        .all()
    )
    
    # 2. Compare generations
    compare_images = (
        db.query(DBCompareImage, DBCompareSession)
        .join(DBCompareSession, DBCompareImage.compare_session_id == DBCompareSession.id)
        .filter(DBCompareSession.user_id == user_id, DBCompareImage.status == 'completed')
        .order_by(DBCompareImage.created_at.desc())
        .limit(fetch_count)
        .all()
    )
    
    # 3. Storyboard frames
    storyboard_frames = (
        db.query(StoryboardFrame, Storyboard)
        .join(Storyboard, StoryboardFrame.storyboard_id == Storyboard.id)
        .filter(
            Storyboard.user_id == user_id,
            or_(
                StoryboardFrame.image_path.isnot(None),
                StoryboardFrame.status.in_(['done', 'completed'])
            )
        )
        .order_by(StoryboardFrame.created_at.desc())
        .limit(fetch_count)
        .all()
    )

    # 4. Storyboard characters
    storyboard_characters = (
        db.query(StoryboardCharacter, Storyboard)
        .join(Storyboard, StoryboardCharacter.storyboard_id == Storyboard.id)
        .filter(Storyboard.user_id == user_id)
        .order_by(StoryboardCharacter.created_at.desc())
        .limit(fetch_count)
        .all()
    )

    # 5. Storyboard products
    storyboard_products = (
        db.query(StoryboardProduct, Storyboard)
        .join(Storyboard, StoryboardProduct.storyboard_id == Storyboard.id)
        .filter(Storyboard.user_id == user_id)
        .order_by(StoryboardProduct.created_at.desc())
        .limit(fetch_count)
        .all()
    )

    # 6. Storyboard contact sheets
    storyboard_sheets = (
        db.query(Storyboard)
        .filter(Storyboard.user_id == user_id, Storyboard.contact_sheet_url.isnot(None))
        .order_by(Storyboard.created_at.desc())
        .limit(fetch_count)
        .all()
    )
    
    combined = []
    for img, sess in standard_images:
        combined.append({
            "id": img.id,
            "url": _normalize_media_url(img.url),
            "model_id": img.model_id,
            "created_at": str(img.created_at or ""),
            "prompt": sess.prompt,
            "enhanced_prompt": img.enhanced_prompt if getattr(img, 'enhanced_prompt', None) else sess.enhanced_prompt,
            "ratio": sess.ratio,
            "quality": sess.quality,
            "type": "standard",
            "is_quarantined": bool(getattr(img, "is_quarantined", False)),
            "quarantined_at": img.quarantined_at.isoformat() if getattr(img, "quarantined_at", None) else None,
            "quarantine_reason": getattr(img, "quarantine_reason", None),
        })
        
    for img, sess in compare_images:
        combined.append({
            "id": img.id,
            "url": _normalize_media_url(img.url),
            "model_id": img.model_id,
            "created_at": str(img.created_at or ""),
            "prompt": img.original_prompt,
            "enhanced_prompt": img.tailored_prompt,
            "ratio": sess.ratio,
            "quality": sess.quality,
            "type": "compare",
            "is_quarantined": bool(getattr(img, "is_quarantined", False)),
            "quarantined_at": img.quarantined_at.isoformat() if getattr(img, "quarantined_at", None) else None,
            "quarantine_reason": getattr(img, "quarantine_reason", None),
        })
        
    for frame, sb in storyboard_frames:
        if not frame.image_path:
            continue
        combined.append({
            "id": frame.id,
            "url": _normalize_media_url(frame.image_path),
            "model_id": frame.model_used or "Storyboard Frame",
            "created_at": frame.created_at.isoformat() if isinstance(frame.created_at, datetime) else str(frame.created_at or ""),
            "prompt": frame.scene_prompt or f"Frame {frame.order_index + 1} ({sb.name})",
            "enhanced_prompt": frame.expanded_prompt or f"Storyboard: {sb.name}",
            "ratio": None,
            "quality": None,
            "type": "storyboard",
            "video_url": _normalize_media_url(frame.video_url) if getattr(frame, "video_url", None) else None,
            "is_quarantined": bool(getattr(frame, "is_quarantined", False)),
            "quarantined_at": frame.quarantined_at.isoformat() if getattr(frame, "quarantined_at", None) else None,
            "quarantine_reason": getattr(frame, "quarantine_reason", None),
        })

    for char, sb in storyboard_characters:
        c_created = char.created_at.isoformat() if isinstance(char.created_at, datetime) else str(char.created_at or "")
        sheets = db.query(CharacterSheet).filter(CharacterSheet.character_id == char.id).all()
        char_imgs = []
        if char.image_path:
            char_imgs.append((char.image_path, "Front View / Anchor"))
        for sheet in sheets:
            if sheet.front_body_url and sheet.front_body_url != char.image_path:
                char_imgs.append((sheet.front_body_url, "Front Body View"))
            if sheet.side_profile_url:
                char_imgs.append((sheet.side_profile_url, "Side Profile View"))
            if sheet.face_closeup_url:
                char_imgs.append((sheet.face_closeup_url, "Face Closeup View"))
        if isinstance(char.image_paths, list):
            for p in char.image_paths:
                if p and not any(p == existing[0] for existing in char_imgs):
                    char_imgs.append((p, "Reference Image"))
        
        for idx, (img_url, angle_label) in enumerate(char_imgs):
            if not img_url:
                continue
            combined.append({
                "id": f"{char.id}_{idx}",
                "url": _normalize_media_url(img_url),
                "model_id": char.dna_extraction_model or "Character Ref",
                "created_at": c_created,
                "prompt": f"Character: {char.name}" + (f" - {char.description}" if char.description else ""),
                "enhanced_prompt": f"Angle: {angle_label} | Storyboard: {sb.name}",
                "ratio": None,
                "quality": None,
                "type": "character"
            })

    for prod, sb in storyboard_products:
        p_created = prod.created_at.isoformat() if isinstance(prod.created_at, datetime) else str(prod.created_at or "")
        prod_imgs = []
        if prod.image_path:
            prod_imgs.append((prod.image_path, "Primary View"))
        if isinstance(prod.image_paths, list):
            for p in prod.image_paths:
                if p and not any(p == existing[0] for existing in prod_imgs):
                    prod_imgs.append((p, "Product Angle"))
        
        for idx, (img_url, angle_label) in enumerate(prod_imgs):
            if not img_url:
                continue
            combined.append({
                "id": f"{prod.id}_{idx}",
                "url": _normalize_media_url(img_url),
                "model_id": prod.dna_extraction_model or "Product Ref",
                "created_at": p_created,
                "prompt": f"Product: {prod.name}" + (f" - {prod.description}" if prod.description else ""),
                "enhanced_prompt": f"{angle_label} | Storyboard: {sb.name}",
                "ratio": None,
                "quality": None,
                "type": "product"
            })

    for sb in storyboard_sheets:
        if not sb.contact_sheet_url:
            continue
        combined.append({
            "id": f"cs_{sb.id}",
            "url": _normalize_media_url(sb.contact_sheet_url),
            "model_id": "Storyboard Sheet",
            "created_at": sb.created_at.isoformat() if isinstance(sb.created_at, datetime) else str(sb.created_at or ""),
            "prompt": f"Storyboard Contact Sheet: {sb.name}",
            "enhanced_prompt": sb.description or "Full Scene Contact Sheet Grid",
            "ratio": None,
            "quality": None,
            "type": "storyboard"
        })
        
    combined.sort(key=lambda item: parse_datetime(item["created_at"]), reverse=True)
    
    total_standard = (
        db.query(func.count(DBImage.id))
        .join(DBSession, DBImage.session_id == DBSession.id)
        .filter(DBSession.user_id == user_id, DBImage.status == 'completed')
        .scalar() or 0
    )
    
    total_compare = (
        db.query(func.count(DBCompareImage.id))
        .join(DBCompareSession, DBCompareImage.compare_session_id == DBCompareSession.id)
        .filter(DBCompareSession.user_id == user_id, DBCompareImage.status == 'completed')
        .scalar() or 0
    )
    
    total_frames = (
        db.query(func.count(StoryboardFrame.id))
        .join(Storyboard, StoryboardFrame.storyboard_id == Storyboard.id)
        .filter(
            Storyboard.user_id == user_id,
            or_(
                StoryboardFrame.image_path.isnot(None),
                StoryboardFrame.status.in_(['done', 'completed'])
            )
        )
        .scalar() or 0
    )

    total_chars = (
        db.query(func.count(StoryboardCharacter.id))
        .join(Storyboard, StoryboardCharacter.storyboard_id == Storyboard.id)
        .filter(Storyboard.user_id == user_id, StoryboardCharacter.image_path.isnot(None))
        .scalar() or 0
    )

    total_prods = (
        db.query(func.count(StoryboardProduct.id))
        .join(Storyboard, StoryboardProduct.storyboard_id == Storyboard.id)
        .filter(Storyboard.user_id == user_id, StoryboardProduct.image_path.isnot(None))
        .scalar() or 0
    )

    total_cs = (
        db.query(func.count(Storyboard.id))
        .filter(Storyboard.user_id == user_id, Storyboard.contact_sheet_url.isnot(None))
        .scalar() or 0
    )
    
    total = total_standard + total_compare + total_frames + total_chars + total_prods + total_cs
    paginated = combined[offset : offset + limit]
    
    return {
        "user": target.to_dict(),
        "images": paginated,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


def _parse_filter_date(val: Optional[str], is_end: bool = False) -> Optional[datetime]:
    if not val:
        return None
    cleaned = val.strip()
    try:
        if "T" in cleaned:
            dt = datetime.fromisoformat(cleaned.replace("Z", "+00:00"))
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None) if dt.tzinfo else dt
            if is_end:
                dt = dt.replace(hour=23, minute=59, second=59, microsecond=999999)
            return dt
        dt = datetime.strptime(cleaned, "%Y-%m-%d")
        if is_end:
            dt = dt.replace(hour=23, minute=59, second=59, microsecond=999999)
        return dt
    except Exception:
        return None


@app.get("/api/admin/generations")
async def admin_get_all_generations(
    limit: int = 50,
    offset: int = 0,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    type: Optional[str] = None,
    user_id: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    _require_admin(user)
    
    start_dt = _parse_filter_date(start_date, is_end=False) if start_date else None
    end_dt = _parse_filter_date(end_date, is_end=True) if end_date else None

    # Calculate ISO boundaries for string-based created_at fields
    start_iso = start_dt.strftime("%Y-%m-%d") if start_dt else None
    end_iso_next = (end_dt + timedelta(days=1)).strftime("%Y-%m-%d") if end_dt else None

    type_clean = (type or "").strip().lower()
    is_quarantined_only = type_clean in ("quarantined", "quarantine")
    include_standard = (type_clean in ("", "all", "standard")) or is_quarantined_only
    include_compare = (type_clean in ("", "all", "compare")) or is_quarantined_only
    include_storyboard = (type_clean in ("", "all", "storyboard")) or is_quarantined_only
    include_characters = (type_clean in ("", "all", "storyboard", "character")) and not is_quarantined_only
    include_products = (type_clean in ("", "all", "storyboard", "product")) and not is_quarantined_only

    combined = []

    # 1. Standard generations with user info
    if include_standard:
        q_std = (
            db.query(DBImage, DBSession, User)
            .join(DBSession, DBImage.session_id == DBSession.id)
            .join(User, or_(DBImage.user_id == User.id, DBSession.user_id == User.id))
            .filter(DBImage.status == 'completed')
        )
        if is_quarantined_only:
            q_std = q_std.filter(DBImage.is_quarantined == True)
        if start_iso:
            q_std = q_std.filter(DBImage.created_at >= start_iso)
        if end_iso_next:
            q_std = q_std.filter(DBImage.created_at < end_iso_next)
        if user_id:
            q_std = q_std.filter(or_(DBImage.user_id == user_id, DBSession.user_id == user_id))
        if search and search.strip():
            s_term = f"%{search.strip()}%"
            q_std = q_std.filter(
                or_(
                    User.email.ilike(s_term),
                    User.name.ilike(s_term),
                    DBSession.prompt.ilike(s_term),
                    DBImage.model_id.ilike(s_term)
                )
            )
        
        standard_images = q_std.order_by(DBImage.created_at.desc()).all()
        for img, sess, u in standard_images:
            img_created = str(img.created_at or "").strip()
            if start_dt or end_dt:
                img_dt = parse_datetime(img_created)
                if img_dt != datetime.min:
                    if start_dt and img_dt < start_dt:
                        continue
                    if end_dt and img_dt > end_dt:
                        continue
            combined.append({
                "id": img.id,
                "url": _normalize_media_url(img.url),
                "model_id": img.model_id,
                "created_at": img.created_at,
                "prompt": sess.prompt,
                "enhanced_prompt": img.enhanced_prompt if getattr(img, 'enhanced_prompt', None) else sess.enhanced_prompt,
                "ratio": sess.ratio,
                "quality": sess.quality,
                "type": "standard",
                "is_quarantined": bool(getattr(img, "is_quarantined", False)),
                "quarantined_at": img.quarantined_at.isoformat() if getattr(img, "quarantined_at", None) else None,
                "quarantine_reason": getattr(img, "quarantine_reason", None),
                "quarantined_by": getattr(img, "quarantined_by", None),
                "upstream_request_id": getattr(img, "upstream_request_id", None),
                "user": {
                    "id": u.id,
                    "email": u.email,
                    "name": u.name
                }
            })

    # 2. Compare generations with user info
    if include_compare:
        q_cmp = (
            db.query(DBCompareImage, DBCompareSession, User)
            .join(DBCompareSession, DBCompareImage.compare_session_id == DBCompareSession.id)
            .join(User, or_(DBCompareImage.user_id == User.id, DBCompareSession.user_id == User.id))
            .filter(DBCompareImage.status == 'completed')
        )
        if is_quarantined_only:
            q_cmp = q_cmp.filter(DBCompareImage.is_quarantined == True)
        if start_iso:
            q_cmp = q_cmp.filter(DBCompareImage.created_at >= start_iso)
        if end_iso_next:
            q_cmp = q_cmp.filter(DBCompareImage.created_at < end_iso_next)
        if user_id:
            q_cmp = q_cmp.filter(or_(DBCompareImage.user_id == user_id, DBCompareSession.user_id == user_id))
        if search and search.strip():
            s_term = f"%{search.strip()}%"
            q_cmp = q_cmp.filter(
                or_(
                    User.email.ilike(s_term),
                    User.name.ilike(s_term),
                    DBCompareImage.original_prompt.ilike(s_term),
                    DBCompareImage.model_id.ilike(s_term)
                )
            )
        
        compare_images = q_cmp.order_by(DBCompareImage.created_at.desc()).all()
        for img, sess, u in compare_images:
            img_created = str(img.created_at or "").strip()
            if start_dt or end_dt:
                img_dt = parse_datetime(img_created)
                if img_dt != datetime.min:
                    if start_dt and img_dt < start_dt:
                        continue
                    if end_dt and img_dt > end_dt:
                        continue
            combined.append({
                "id": img.id,
                "url": _normalize_media_url(img.url),
                "model_id": img.model_id,
                "created_at": img.created_at,
                "prompt": img.original_prompt,
                "enhanced_prompt": img.tailored_prompt,
                "ratio": sess.ratio,
                "quality": sess.quality,
                "type": "compare",
                "is_quarantined": bool(getattr(img, "is_quarantined", False)),
                "quarantined_at": img.quarantined_at.isoformat() if getattr(img, "quarantined_at", None) else None,
                "quarantine_reason": getattr(img, "quarantine_reason", None),
                "quarantined_by": getattr(img, "quarantined_by", None),
                "upstream_request_id": getattr(img, "upstream_request_id", None),
                "user": {
                    "id": u.id,
                    "email": u.email,
                    "name": u.name
                }
            })

    # 3. Storyboard frames with user info
    if include_storyboard:
        q_sb = (
            db.query(StoryboardFrame, Storyboard, User)
            .join(Storyboard, StoryboardFrame.storyboard_id == Storyboard.id)
            .join(User, Storyboard.user_id == User.id)
            .filter(
                or_(
                    StoryboardFrame.image_path.isnot(None),
                    StoryboardFrame.status.in_(['done', 'completed'])
                )
            )
        )
        if is_quarantined_only:
            q_sb = q_sb.filter(StoryboardFrame.is_quarantined == True)
        if start_dt:
            q_sb = q_sb.filter(StoryboardFrame.created_at >= start_dt)
        if end_dt:
            q_sb = q_sb.filter(StoryboardFrame.created_at <= end_dt)
        if user_id:
            q_sb = q_sb.filter(Storyboard.user_id == user_id)
        if search and search.strip():
            s_term = f"%{search.strip()}%"
            q_sb = q_sb.filter(
                or_(
                    User.email.ilike(s_term),
                    User.name.ilike(s_term),
                    StoryboardFrame.scene_prompt.ilike(s_term),
                    StoryboardFrame.expanded_prompt.ilike(s_term),
                    StoryboardFrame.model_used.ilike(s_term),
                    Storyboard.name.ilike(s_term)
                )
            )
        
        storyboard_frames = q_sb.order_by(StoryboardFrame.created_at.desc()).all()
        for frame, sb, u in storyboard_frames:
            if not frame.image_path:
                continue
            f_created = frame.created_at.isoformat() if isinstance(frame.created_at, datetime) else str(frame.created_at or "")
            if start_dt or end_dt:
                f_dt = parse_datetime(f_created)
                if f_dt != datetime.min:
                    if start_dt and f_dt < start_dt:
                        continue
                    if end_dt and f_dt > end_dt:
                        continue
            combined.append({
                "id": frame.id,
                "url": _normalize_media_url(frame.image_path),
                "model_id": frame.model_used or "Storyboard Frame",
                "created_at": f_created,
                "prompt": frame.scene_prompt or f"Frame {frame.order_index + 1} ({sb.name})",
                "enhanced_prompt": frame.expanded_prompt or f"Storyboard: {sb.name}",
                "ratio": None,
                "quality": None,
                "type": "storyboard",
                "video_url": _normalize_media_url(frame.video_url) if getattr(frame, "video_url", None) else None,
                "is_quarantined": bool(getattr(frame, "is_quarantined", False)),
                "quarantined_at": frame.quarantined_at.isoformat() if getattr(frame, "quarantined_at", None) else None,
                "quarantine_reason": getattr(frame, "quarantine_reason", None),
                "quarantined_by": getattr(frame, "quarantined_by", None),
                "user": {
                    "id": u.id,
                    "email": u.email,
                    "name": u.name
                }
            })

        # Also include Storyboard Contact Sheets (only if not quarantined-only filter)
        if not is_quarantined_only:
            q_cs = (
                db.query(Storyboard, User)
                .join(User, Storyboard.user_id == User.id)
                .filter(Storyboard.contact_sheet_url.isnot(None))
            )
            if start_dt:
                q_cs = q_cs.filter(Storyboard.created_at >= start_dt)
            if end_dt:
                q_cs = q_cs.filter(Storyboard.created_at <= end_dt)
            if user_id:
                q_cs = q_cs.filter(Storyboard.user_id == user_id)
            if search and search.strip():
                s_term = f"%{search.strip()}%"
                q_cs = q_cs.filter(
                    or_(
                        User.email.ilike(s_term),
                        User.name.ilike(s_term),
                        Storyboard.name.ilike(s_term),
                        Storyboard.description.ilike(s_term)
                    )
                )
            contact_sheets = q_cs.order_by(Storyboard.created_at.desc()).all()
            for sb, u in contact_sheets:
                if not sb.contact_sheet_url:
                    continue
                cs_created = sb.created_at.isoformat() if isinstance(sb.created_at, datetime) else str(sb.created_at or "")
                if start_dt or end_dt:
                    cs_dt = parse_datetime(cs_created)
                    if cs_dt != datetime.min:
                        if start_dt and cs_dt < start_dt:
                            continue
                        if end_dt and cs_dt > end_dt:
                            continue
                combined.append({
                    "id": f"cs_{sb.id}",
                    "url": _normalize_media_url(sb.contact_sheet_url),
                    "model_id": "Storyboard Sheet",
                    "created_at": cs_created,
                    "prompt": f"Storyboard Contact Sheet: {sb.name}",
                    "enhanced_prompt": sb.description or "Full Scene Contact Sheet Grid",
                    "ratio": None,
                    "quality": None,
                    "type": "storyboard",
                    "is_quarantined": False,
                    "quarantined_at": None,
                    "quarantine_reason": None,
                    "quarantined_by": None,
                    "user": {
                        "id": u.id,
                        "email": u.email,
                        "name": u.name
                    }
                })

    # 4. Storyboard characters with user info (only if not quarantined-only filter)
    if include_characters and not is_quarantined_only:
        q_chars = (
            db.query(StoryboardCharacter, Storyboard, User)
            .join(Storyboard, StoryboardCharacter.storyboard_id == Storyboard.id)
            .join(User, Storyboard.user_id == User.id)
        )
        if start_dt:
            q_chars = q_chars.filter(StoryboardCharacter.created_at >= start_dt)
        if end_dt:
            q_chars = q_chars.filter(StoryboardCharacter.created_at <= end_dt)
        if user_id:
            q_chars = q_chars.filter(Storyboard.user_id == user_id)
        if search and search.strip():
            s_term = f"%{search.strip()}%"
            q_chars = q_chars.filter(
                or_(
                    User.email.ilike(s_term),
                    User.name.ilike(s_term),
                    StoryboardCharacter.name.ilike(s_term),
                    StoryboardCharacter.description.ilike(s_term),
                    Storyboard.name.ilike(s_term)
                )
            )
        
        characters = q_chars.order_by(StoryboardCharacter.created_at.desc()).all()
        for char, sb, u in characters:
            c_created = char.created_at.isoformat() if isinstance(char.created_at, datetime) else str(char.created_at or "")
            if start_dt or end_dt:
                c_dt = parse_datetime(c_created)
                if c_dt != datetime.min:
                    if start_dt and c_dt < start_dt:
                        continue
                    if end_dt and c_dt > end_dt:
                        continue

            sheets = db.query(CharacterSheet).filter(CharacterSheet.character_id == char.id).all()
            char_imgs = []
            if char.image_path:
                char_imgs.append((char.image_path, "Front View / Anchor"))
            for sheet in sheets:
                if sheet.front_body_url and sheet.front_body_url != char.image_path:
                    char_imgs.append((sheet.front_body_url, "Front Body View"))
                if sheet.side_profile_url:
                    char_imgs.append((sheet.side_profile_url, "Side Profile View"))
                if sheet.face_closeup_url:
                    char_imgs.append((sheet.face_closeup_url, "Face Closeup View"))
            if isinstance(char.image_paths, list):
                for p in char.image_paths:
                    if p and not any(p == existing[0] for existing in char_imgs):
                        char_imgs.append((p, "Reference Image"))

            for idx, (img_url, angle_label) in enumerate(char_imgs):
                if not img_url:
                    continue
                combined.append({
                    "id": f"{char.id}_{idx}",
                    "url": _normalize_media_url(img_url),
                    "model_id": char.dna_extraction_model or "Character Ref",
                    "created_at": c_created,
                    "prompt": f"Character: {char.name}" + (f" - {char.description}" if char.description else ""),
                    "enhanced_prompt": f"Angle: {angle_label} | Storyboard: {sb.name}",
                    "ratio": None,
                    "quality": None,
                    "type": "character",
                    "is_quarantined": False,
                    "quarantined_at": None,
                    "quarantine_reason": None,
                    "quarantined_by": None,
                    "user": {
                        "id": u.id,
                        "email": u.email,
                        "name": u.name
                    }
                })

    # 5. Storyboard products with user info (only if not quarantined-only filter)
    if include_products and not is_quarantined_only:
        q_prods = (
            db.query(StoryboardProduct, Storyboard, User)
            .join(Storyboard, StoryboardProduct.storyboard_id == Storyboard.id)
            .join(User, Storyboard.user_id == User.id)
        )
        if start_dt:
            q_prods = q_prods.filter(StoryboardProduct.created_at >= start_dt)
        if end_dt:
            q_prods = q_prods.filter(StoryboardProduct.created_at <= end_dt)
        if user_id:
            q_prods = q_prods.filter(Storyboard.user_id == user_id)
        if search and search.strip():
            s_term = f"%{search.strip()}%"
            q_prods = q_prods.filter(
                or_(
                    User.email.ilike(s_term),
                    User.name.ilike(s_term),
                    StoryboardProduct.name.ilike(s_term),
                    StoryboardProduct.description.ilike(s_term),
                    Storyboard.name.ilike(s_term)
                )
            )
        
        products = q_prods.order_by(StoryboardProduct.created_at.desc()).all()
        for prod, sb, u in products:
            p_created = prod.created_at.isoformat() if isinstance(prod.created_at, datetime) else str(prod.created_at or "")
            if start_dt or end_dt:
                p_dt = parse_datetime(p_created)
                if p_dt != datetime.min:
                    if start_dt and p_dt < start_dt:
                        continue
                    if end_dt and p_dt > end_dt:
                        continue

            prod_imgs = []
            if prod.image_path:
                prod_imgs.append((prod.image_path, "Primary View"))
            if isinstance(prod.image_paths, list):
                for p in prod.image_paths:
                    if p and not any(p == existing[0] for existing in prod_imgs):
                        prod_imgs.append((p, "Product Angle"))

            for idx, (img_url, angle_label) in enumerate(prod_imgs):
                if not img_url:
                    continue
                combined.append({
                    "id": f"{prod.id}_{idx}",
                    "url": _normalize_media_url(img_url),
                    "model_id": prod.dna_extraction_model or "Product Ref",
                    "created_at": p_created,
                    "prompt": f"Product: {prod.name}" + (f" - {prod.description}" if prod.description else ""),
                    "enhanced_prompt": f"{angle_label} | Storyboard: {sb.name}",
                    "ratio": None,
                    "quality": None,
                    "type": "product",
                    "is_quarantined": False,
                    "quarantined_at": None,
                    "quarantine_reason": None,
                    "quarantined_by": None,
                    "user": {
                        "id": u.id,
                        "email": u.email,
                        "name": u.name
                    }
                })

    combined.sort(key=lambda item: parse_datetime(item["created_at"]), reverse=True)
    total = len(combined)
    paginated = combined[offset : offset + limit]

    return {
        "generations": paginated,
        "total": total,
        "limit": limit,
        "offset": offset,
        "start_date": start_date,
        "end_date": end_date,
        "type": type_clean or "all"
    }


class AdminQuarantineRequest(BaseModel):
    reason: str = "DMCA / Copyright Compliance"


@app.post("/api/admin/images/{image_id}/quarantine")
async def admin_quarantine_image(
    image_id: str,
    payload: AdminQuarantineRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Quarantine an image immediately under DMCA Safe Harbor, disabling public viewing while preserving forensic logs."""
    _require_admin(user)
    now_utc = datetime.utcnow()
    reason_str = (payload.reason or "").strip() or "DMCA / Copyright Compliance"

    # 1. DBImage
    img = db.query(DBImage).filter(DBImage.id == image_id).first()
    if img:
        img.is_quarantined = True
        img.quarantined_at = now_utc
        img.quarantine_reason = reason_str
        img.quarantined_by = user.id
        db.commit()
        return {"success": True, "message": "Image quarantined successfully", "image_id": image_id, "type": "standard"}

    # 2. DBCompareImage
    cmp_img = db.query(DBCompareImage).filter(DBCompareImage.id == image_id).first()
    if cmp_img:
        cmp_img.is_quarantined = True
        cmp_img.quarantined_at = now_utc
        cmp_img.quarantine_reason = reason_str
        cmp_img.quarantined_by = user.id
        db.commit()
        return {"success": True, "message": "Compare image quarantined successfully", "image_id": image_id, "type": "compare"}

    # 3. StoryboardFrame
    frame = db.query(StoryboardFrame).filter(StoryboardFrame.id == image_id).first()
    if frame:
        frame.is_quarantined = True
        frame.quarantined_at = now_utc
        frame.quarantine_reason = reason_str
        frame.quarantined_by = user.id
        db.commit()
        return {"success": True, "message": "Storyboard frame quarantined successfully", "image_id": image_id, "type": "storyboard"}

    raise HTTPException(status_code=404, detail=f"Image with id {image_id} not found")


@app.post("/api/admin/images/{image_id}/restore")
async def admin_restore_image(
    image_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Restore a previously quarantined image if counter-notice succeeds or notice withdrawn."""
    _require_admin(user)

    img = db.query(DBImage).filter(DBImage.id == image_id).first()
    if img:
        img.is_quarantined = False
        img.quarantined_at = None
        img.quarantine_reason = None
        img.quarantined_by = None
        db.commit()
        return {"success": True, "message": "Image restored successfully", "image_id": image_id, "type": "standard"}

    cmp_img = db.query(DBCompareImage).filter(DBCompareImage.id == image_id).first()
    if cmp_img:
        cmp_img.is_quarantined = False
        cmp_img.quarantined_at = None
        cmp_img.quarantine_reason = None
        cmp_img.quarantined_by = None
        db.commit()
        return {"success": True, "message": "Compare image restored successfully", "image_id": image_id, "type": "compare"}

    frame = db.query(StoryboardFrame).filter(StoryboardFrame.id == image_id).first()
    if frame:
        frame.is_quarantined = False
        frame.quarantined_at = None
        frame.quarantine_reason = None
        frame.quarantined_by = None
        db.commit()
        return {"success": True, "message": "Storyboard frame restored successfully", "image_id": image_id, "type": "storyboard"}

    raise HTTPException(status_code=404, detail=f"Image with id {image_id} not found")


@app.get("/api/admin/images/{image_id}/legal-packet")
async def admin_get_legal_packet(
    image_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Generate complete forensic legal packet for filing an indemnification claim with Google / OpenAI / Anthropic."""
    _require_admin(user)

    # 1. DBImage
    img = db.query(DBImage).filter(DBImage.id == image_id).first()
    if img:
        sess = db.query(DBSession).filter(DBSession.id == img.session_id).first()
        user_target = db.query(User).filter(User.id == (img.user_id or (sess.user_id if sess else None))).first()
        return {
            "legal_packet_version": "1.0",
            "generated_at_utc": datetime.utcnow().isoformat() + "Z",
            "image_id": img.id,
            "type": "standard",
            "image_url": _normalize_media_url(img.url),
            "model_id": img.model_id,
            "upstream_request_id": getattr(img, "upstream_request_id", None),
            "created_at": img.created_at,
            "is_quarantined": bool(getattr(img, "is_quarantined", False)),
            "quarantined_at": img.quarantined_at.isoformat() if getattr(img, "quarantined_at", None) else None,
            "quarantine_reason": getattr(img, "quarantine_reason", None),
            "quarantined_by": getattr(img, "quarantined_by", None),
            "prompt": sess.prompt if sess else None,
            "enhanced_prompt": img.enhanced_prompt or (sess.enhanced_prompt if sess else None),
            "aspect_ratio": sess.ratio if sess else None,
            "quality": sess.quality if sess else None,
            "user": {
                "id": user_target.id if user_target else None,
                "email": user_target.email if user_target else None,
                "name": user_target.name if user_target else None,
                "signup_ip": getattr(user_target, "signup_ip", None),
                "tos_accepted_at": user_target.tos_accepted_at.isoformat() if getattr(user_target, "tos_accepted_at", None) else None,
                "tos_version": getattr(user_target, "tos_version", "v1.0")
            } if user_target else None
        }

    # 2. DBCompareImage
    cmp_img = db.query(DBCompareImage).filter(DBCompareImage.id == image_id).first()
    if cmp_img:
        cmp_sess = db.query(DBCompareSession).filter(DBCompareSession.id == cmp_img.compare_session_id).first()
        user_target = db.query(User).filter(User.id == (cmp_img.user_id or (cmp_sess.user_id if cmp_sess else None))).first()
        return {
            "legal_packet_version": "1.0",
            "generated_at_utc": datetime.utcnow().isoformat() + "Z",
            "image_id": cmp_img.id,
            "type": "compare",
            "image_url": _normalize_media_url(cmp_img.url),
            "model_id": cmp_img.model_id,
            "upstream_request_id": getattr(cmp_img, "upstream_request_id", None),
            "created_at": cmp_img.created_at,
            "is_quarantined": bool(getattr(cmp_img, "is_quarantined", False)),
            "quarantined_at": cmp_img.quarantined_at.isoformat() if getattr(cmp_img, "quarantined_at", None) else None,
            "quarantine_reason": getattr(cmp_img, "quarantine_reason", None),
            "quarantined_by": getattr(cmp_img, "quarantined_by", None),
            "prompt": cmp_img.original_prompt,
            "enhanced_prompt": cmp_img.tailored_prompt,
            "aspect_ratio": cmp_sess.ratio if cmp_sess else None,
            "quality": cmp_sess.quality if cmp_sess else None,
            "user": {
                "id": user_target.id if user_target else None,
                "email": user_target.email if user_target else None,
                "name": user_target.name if user_target else None,
                "signup_ip": getattr(user_target, "signup_ip", None),
                "tos_accepted_at": user_target.tos_accepted_at.isoformat() if getattr(user_target, "tos_accepted_at", None) else None,
                "tos_version": getattr(user_target, "tos_version", "v1.0")
            } if user_target else None
        }

    # 3. StoryboardFrame
    frame = db.query(StoryboardFrame).filter(StoryboardFrame.id == image_id).first()
    if frame:
        sb = db.query(Storyboard).filter(Storyboard.id == frame.storyboard_id).first()
        user_target = db.query(User).filter(User.id == sb.user_id).first() if sb else None
        f_created = frame.created_at.isoformat() if isinstance(frame.created_at, datetime) else str(frame.created_at or "")
        return {
            "legal_packet_version": "1.0",
            "generated_at_utc": datetime.utcnow().isoformat() + "Z",
            "image_id": frame.id,
            "type": "storyboard",
            "image_url": _normalize_media_url(frame.image_path),
            "model_id": frame.model_used,
            "created_at": f_created,
            "is_quarantined": bool(getattr(frame, "is_quarantined", False)),
            "quarantined_at": frame.quarantined_at.isoformat() if getattr(frame, "quarantined_at", None) else None,
            "quarantine_reason": getattr(frame, "quarantine_reason", None),
            "quarantined_by": getattr(frame, "quarantined_by", None),
            "prompt": frame.scene_prompt,
            "enhanced_prompt": frame.expanded_prompt,
            "storyboard_name": sb.name if sb else None,
            "user": {
                "id": user_target.id if user_target else None,
                "email": user_target.email if user_target else None,
                "name": user_target.name if user_target else None,
                "signup_ip": getattr(user_target, "signup_ip", None),
                "tos_accepted_at": user_target.tos_accepted_at.isoformat() if getattr(user_target, "tos_accepted_at", None) else None,
                "tos_version": getattr(user_target, "tos_version", "v1.0")
            } if user_target else None
        }

    raise HTTPException(status_code=404, detail=f"Image with id {image_id} not found")


@app.get("/api/admin/stats")
async def admin_global_stats(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    _require_admin(user)
    week_ago = datetime.utcnow() - timedelta(days=7)
    total_users = db.query(func.count(User.id)).scalar() or 0
    total_images_std = db.query(func.count(DBImage.id)).filter(DBImage.status == 'completed').scalar() or 0
    total_images_cmp = db.query(func.count(DBCompareImage.id)).filter(DBCompareImage.status == 'completed').scalar() or 0
    total_images_frames = db.query(func.count(StoryboardFrame.id)).filter(StoryboardFrame.image_path.isnot(None)).scalar() or 0
    total_images_chars = db.query(func.count(StoryboardCharacter.id)).filter(StoryboardCharacter.image_path.isnot(None)).scalar() or 0
    total_images_prods = db.query(func.count(StoryboardProduct.id)).filter(StoryboardProduct.image_path.isnot(None)).scalar() or 0
    total_images = total_images_std + total_images_cmp + total_images_frames + total_images_chars + total_images_prods

    images_this_week = (
        db.query(func.count(DBImage.id))
        .filter(DBImage.status == 'completed', DBImage.created_at >= week_ago.isoformat())
        .scalar() or 0
    )
    active_users = db.query(func.count(User.id)).filter(User.is_active == True).scalar() or 0
    return {
        "total_users": total_users,
        "active_users": active_users,
        "total_images_generated": total_images,
        "images_this_week": images_this_week,
    }


@app.post("/api/sessions")
async def create_session(
    request: SessionCreateRequest, 
    background_tasks: BackgroundTasks, 
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    access_error = _generation_access_error(user)
    if access_error:
        raise access_error
    # Check weekly image quota
    quota_error = _check_weekly_image_quota(user, db)
    if quota_error:
        raise quota_error

    # ── Content safety: instant keyword check (< 1ms) ──
    kw_safe, kw_reason = check_prompt_keywords(request.prompt)
    if not kw_safe:
        raise HTTPException(status_code=400, detail=f"Content blocked: {kw_reason}")
    if request.edit_instruction:
        kw_safe2, kw_reason2 = check_prompt_keywords(request.edit_instruction)
        if not kw_safe2:
            raise HTTPException(status_code=400, detail=f"Content blocked: {kw_reason2}")

    session_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    
    expanded_model_ids = []
    for m in request.model_ids:
        if m not in expanded_model_ids:
            expanded_model_ids.append(m)

    # Store Active Configs as flat string from dict
    new_session = DBSession(
        id=session_id,
        user_id=user.id,
        parent_session_id=request.parent_session_id,
        prompt=request.prompt,
        models=json.dumps(expanded_model_ids),
        active_configs=json.dumps(request.active_configs),
        reference_image_id=request.reference_image_id,
        ratio=request.ratio,
        quality=request.quality,
        created_at=now
    )
    db.add(new_session)

    image_slots = []
    for model_id in expanded_model_ids:
        img_id = str(uuid.uuid4())
        new_image = DBImage(
            id=img_id,
            session_id=session_id,
            user_id=user.id,
            model_id=model_id,
            status="pending",
            url=None,
            created_at=now
        )
        db.add(new_image)
        image_slots.append({"image_id": img_id, "model_id": model_id, "status": "pending", "url": None})

    db.commit()

    task = asyncio.create_task(_process_session_batch(session_id, request))
    RUNNING_SESSION_TASKS[session_id] = task

    return {"session_id": session_id, "images": image_slots}


@app.post("/api/sessions/{session_id}/cancel")
async def cancel_session(
    session_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    _ensure_session_owner(db, session_id, user.id)
    CANCELLED_SESSIONS.add(session_id)
    task = RUNNING_SESSION_TASKS.get(session_id)
    if task and not task.done():
        task.cancel()
        print(f"[Session:{session_id}] Active asyncio task cancelled forcefully.")

    db.query(DBImage).filter(
        DBImage.session_id == session_id,
        DBImage.status.in_(["pending", "generating", "processing"])
    ).update({"status": "cancelled", "error_msg": "Stopped by user"}, synchronize_session=False)
    db.commit()

    print(f"[Session:{session_id}] Marked session images as cancelled.")
    return {"status": "cancelled", "session_id": session_id}


@app.get("/api/sessions/{session_id}")
async def get_session(
    session_id: str, 
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    _ensure_session_owner(db, session_id, user.id)

    session_row = db.query(DBSession).filter(DBSession.id == session_id, DBSession.user_id == user.id).first()
    if not session_row:
        raise HTTPException(status_code=404, detail="Session not found")

    # 1. Walk up to locate the root session of the family tree
    root_id = session_row.id
    curr = session_row
    visited = {curr.id}
    while curr.parent_session_id and curr.parent_session_id not in visited:
        parent = db.query(DBSession).filter(DBSession.id == curr.parent_session_id).first()
        if not parent:
            break
        curr = parent
        root_id = curr.id
        visited.add(root_id)

    # 2. Walk down from the root session to collect all descendant and sibling session IDs
    family_session_ids = {root_id}
    queue = [root_id]
    while queue:
        current_id = queue.pop(0)
        children = db.query(DBSession.id).filter(DBSession.parent_session_id == current_id).all()
        for child in children:
            child_id = child[0]
            if child_id not in family_session_ids:
                family_session_ids.add(child_id)
                queue.append(child_id)

    # 3. Retrieve all images belonging to the entire family tree session group
    images_rows = (
        db.query(DBImage)
        .filter(DBImage.session_id.in_(list(family_session_ids)))
        .order_by(DBImage.created_at.desc(), DBImage.id.desc())
        .all()
    )
    family_sessions = {
        s.id: s for s in db.query(DBSession).filter(DBSession.id.in_(list(family_session_ids))).all()
    }
    preview_images = [await _materialize_image_url(img.url) for img in images_rows if img.url and not getattr(img, "is_quarantined", False)]
    parsed_models = json.loads(session_row.models or "[]")
    parsed_configs = json.loads(session_row.active_configs or "{}")

    return {
        "id": session_row.id,
        "session_id": session_row.id,
        "parent_session_id": session_row.parent_session_id,
        "prompt": session_row.prompt,
        "enhanced_prompt": session_row.enhanced_prompt,  # full final prompt sent to model
        "pipeline_type": session_row.pipeline_type,       # e.g. AUTHENTIC, PORTRAIT
        "models": parsed_models,
        "active_configs": parsed_configs,
        "settings": {
            "models": parsed_models,
            "active_configs": parsed_configs,
        },
        "reference_image_id": session_row.reference_image_id,
        "preview_images": preview_images,
        "images": [
            {
                "id": img.id,
                "session_id": img.session_id,
                "model_id": img.model_id,
                "status": "quarantined" if getattr(img, "is_quarantined", False) else img.status,
                "url": None if getattr(img, "is_quarantined", False) else await _materialize_image_url(img.url),
                "is_quarantined": bool(getattr(img, "is_quarantined", False)),
                "prompt": (family_sessions.get(img.session_id).prompt if family_sessions.get(img.session_id) else session_row.prompt),
                "enhanced_prompt": (family_sessions.get(img.session_id).enhanced_prompt if family_sessions.get(img.session_id) else session_row.enhanced_prompt),
                "ratio": (family_sessions.get(img.session_id).ratio if family_sessions.get(img.session_id) else session_row.ratio),
                "quality": (family_sessions.get(img.session_id).quality if family_sessions.get(img.session_id) else session_row.quality),
                "error_msg": "Content unavailable due to legal/quarantine hold" if getattr(img, "is_quarantined", False) else img.error_msg,
                "created_at": img.created_at
            } for img in images_rows
        ]
    }


async def _load_image_b64_from_url_or_path(url_or_path: Optional[str]) -> Optional[str]:
    """Robustly loads an image from either a Supabase URL, HTTP(S) URL, or local disk path
    and returns its raw base64 encoded string.
    """
    if not url_or_path:
        return None
    cleaned = url_or_path.strip()
    if not cleaned:
        return None

    # Case 1: Already base64 string
    if cleaned.startswith("data:"):
        return cleaned.split(",")[1] if "," in cleaned else cleaned

    # Case 2: HTTP / HTTPS URL (Supabase, S3, CDN)
    if cleaned.startswith("http://") or cleaned.startswith("https://"):
        try:
            async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
                resp = await client.get(cleaned)
                if resp.status_code == 200:
                    return base64.b64encode(resp.content).decode("utf-8")
                else:
                    print(f"[ImageLoader] HTTP fetch failed: {resp.status_code} for {cleaned[:60]}")
        except Exception as e:
            print(f"[ImageLoader] HTTP fetch exception: {e} for {cleaned[:60]}")
        return None

    # Case 3: Local file path on disk (e.g. /exports/generated/..., exports/generated/...)
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    relative_clean = cleaned.lstrip("/\\")
    
    possible_paths = [
        cleaned,
        os.path.join(backend_dir, relative_clean),
        os.path.join(backend_dir, "..", relative_clean),
        os.path.abspath(cleaned)
    ]
    
    for candidate in possible_paths:
        if os.path.exists(candidate) and os.path.isfile(candidate):
            try:
                with open(candidate, "rb") as f:
                    file_bytes = f.read()
                if file_bytes:
                    return base64.b64encode(file_bytes).decode("utf-8")
            except Exception as e:
                print(f"[ImageLoader] Local file read error: {e} for {candidate}")

    print(f"[ImageLoader] Could not resolve image path/URL: {cleaned}")
    return None


@app.post("/api/sessions/{session_id}/images/{image_id}/edit")
async def edit_session_image(
    session_id: str, 
    image_id: str, 
    request: EditImageRequest, 
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    source_image = db.query(DBImage).filter(DBImage.id == image_id).first()
    if not source_image:
        raise HTTPException(status_code=404, detail="Image not found")
        
    parent_session = db.query(DBSession).filter(DBSession.id == source_image.session_id, DBSession.user_id == user.id).first()
    if not parent_session:
        raise HTTPException(status_code=404, detail="Session not found")

    # ── Content safety: instant keyword check on edit prompt (< 1ms) ──
    kw_safe, kw_reason = check_prompt_keywords(request.edit_prompt)
    if not kw_safe:
        raise HTTPException(status_code=400, detail=f"Content blocked: {kw_reason}")

    active_configs = json.loads(parent_session.active_configs)
    if request.config_overrides:
        active_configs.update(request.config_overrides)

    child_session_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    
    # Trace edit history and find root (turn-0) session for dual-reference texture anchoring
    prompt_history = []
    curr = parent_session
    root_session = parent_session
    while curr:
        prompt_history.insert(0, curr.prompt)
        if curr.parent_session_id:
            parent = db.query(DBSession).filter(DBSession.id == curr.parent_session_id).first()
            if parent:
                curr = parent
                root_session = parent
            else:
                break
        else:
            break

    edit_depth = max(1, len(prompt_history))
    original_root_b64 = None

    # Fetch root image if we are at edit depth >= 2 (i.e. root_session is different from parent_session)
    if ENABLE_DUAL_REFERENCE_EDIT and root_session.id != parent_session.id:
        root_img = db.query(DBImage).filter(DBImage.session_id == root_session.id, DBImage.status == "completed").first()
        if root_img and root_img.url:
            if root_img.id in ROOT_IMAGE_CACHE:
                original_root_b64 = ROOT_IMAGE_CACHE[root_img.id]
                print(f"[Edit] Dual-ref root image cache hit for root image {root_img.id}")
            else:
                try:
                    mat_url = await _materialize_image_url(root_img.url)
                    original_root_b64 = await _load_image_b64_from_url_or_path(mat_url or root_img.url)
                    if original_root_b64:
                        ROOT_IMAGE_CACHE[root_img.id] = original_root_b64
                        print(f"[Edit] Dual-ref root image load OK ({len(original_root_b64)} b64 chars) for root {root_img.id}")
                    else:
                        print(f"[Edit] Failed to load root image for dual-ref from {root_img.url}")
                except Exception as _re:
                    print(f"[Edit] Failed to fetch root image for dual-ref: {_re}")

    # ── Server-side image fetch (CORS-safe & local disk safe) ─────────────────
    final_image_base64 = request.image_base64
    if not final_image_base64 and source_image.url and request.edit_prompt:
        try:
            mat_url = await _materialize_image_url(source_image.url)
            final_image_base64 = await _load_image_b64_from_url_or_path(mat_url or source_image.url)
            if final_image_base64:
                print(f"[Edit] Server-side source image load OK: {len(final_image_base64)} b64 chars")
            else:
                print(f"[Edit] Server-side source image load failed for: {source_image.url}")
        except Exception as _img_err:
            print(f"[Edit] Server-side image fetch error: {_img_err}")

    # ── Prompt resolution ─────────────────────────────────────────────────────
    # RULE: full_prompt_override is ONLY used for pure style changes (no edit instruction).
    # When the user has typed an actual edit instruction, ignore full_prompt_override —
    # the background worker's EDIT-FIX path will build the exact right prompt from
    # the raw edit_instruction + the reference image. Using full_prompt_override here
    # buries the edit instruction inside a 500-word soup of style tags which the model
    # ignores, causing it to reproduce the original image.
    if request.edit_prompt and _is_upscale_intent(request.edit_prompt):
        is_beta = True
        merged_prompt = _build_smart_upscale_prompt(parent_session.prompt, is_beta=is_beta)
        print(f"[Edit] Upscale intent detected. Using smart enhancement prompt.")
    elif request.edit_prompt and _is_pure_camera_angle_request(request.edit_prompt):
        # Vision-guided camera angle: pass source image + original master prompt
        root_prompt = prompt_history[0] if prompt_history else parent_session.prompt
        merged_prompt, _edit_rot, _edit_vert = await _rewrite_camera_angle_prompt(
            parent_session.prompt, request.edit_prompt,
            image_b64=final_image_base64,
            master_prompt=root_prompt
        )
        print(f"[Edit] Pure camera angle intent detected (rot={_edit_rot}°, vert={_edit_vert}°). Prompt: {merged_prompt[:100]}")
    elif request.edit_prompt:
        # Store just the raw edit instruction. The background worker will
        # synthesize it with history or use it directly in the EDIT-FIX path.
        merged_prompt = request.edit_prompt
        print(f"[Edit] Using raw edit instruction as prompt: {merged_prompt[:100]}")
    elif request.full_prompt_override:
        # No edit instruction — pure style change (ratio/quality/preset change).
        # full_prompt_override is safe to use here.
        merged_prompt = request.full_prompt_override
    else:
        merged_prompt = parent_session.prompt

    model_id = source_image.model_id
    models_list = request.model_ids if request.model_ids else [model_id]

    # ── Quality Recovery Chain tracking ────────────────────────────────────────
    # Classify edit type (structural vs inpainting) — fast keyword check first
    raw_edit_instr = request.edit_prompt or ""
    child_edit_type = await _classify_edit_type(raw_edit_instr) if raw_edit_instr else "inpainting"

    # Inherit original_session_id from parent (root stays constant across all edits)
    child_original_session_id = (
        parent_session.original_session_id or root_session.id
    )

    # Inherit and advance the structural lock (Approach 2: Structural Rebase Protocol)
    # If the parent session was a structural edit, then the parent session IS the new structural lock!
    if parent_session.edit_type == "structural":
        effective_parent_struct_lock = parent_session.id
    else:
        effective_parent_struct_lock = parent_session.structural_lock_session_id or root_session.id

    if child_edit_type == "structural":
        # This edit introduces new subjects/major structure — it becomes the new structural anchor
        child_structural_lock_session_id = child_session_id
    else:
        # Inpainting / localized adjustment — anchor back to the existing structural lock
        child_structural_lock_session_id = effective_parent_struct_lock

    # Scope prompt history for Gemini vision inspection:
    # Only accumulate edits since the current structural lock baseline so prompt length and diffusion attention remain razor-sharp!
    scoped_prompt_history = []
    curr_hist = parent_session
    while curr_hist:
        scoped_prompt_history.insert(0, curr_hist.prompt)
        if curr_hist.id == effective_parent_struct_lock:
            break
        if curr_hist.parent_session_id:
            p_node = db.query(DBSession).filter(DBSession.id == curr_hist.parent_session_id).first()
            if p_node:
                curr_hist = p_node
            else:
                break
        else:
            break

    # Append this edit to the history JSON
    parent_history = []
    if parent_session.edit_history_json:
        try:
            parent_history = json.loads(parent_session.edit_history_json)
        except Exception:
            parent_history = []
    if raw_edit_instr:
        parent_history.append({
            "instruction": raw_edit_instr,
            "type": child_edit_type,
            "session_id": child_session_id,
        })
    child_edit_history_json = json.dumps(parent_history)

    new_session = DBSession(
        id=child_session_id,
        user_id=user.id,
        parent_session_id=session_id,
        prompt=merged_prompt,
        models=json.dumps(models_list),
        active_configs=json.dumps(active_configs),
        reference_image_id=request.reference_image_id,
        ratio=request.ratio or parent_session.ratio,
        quality=request.quality or parent_session.quality,
        created_at=now,
        original_session_id=child_original_session_id,
        structural_lock_session_id=child_structural_lock_session_id,
        edit_type=child_edit_type,
        edit_history_json=child_edit_history_json,
    )
    db.add(new_session)

    response_image_id = None
    response_model_id = None

    for m_id in models_list:
        new_img_id = str(uuid.uuid4())
        new_image = DBImage(
            id=new_img_id,
            session_id=child_session_id,
            user_id=user.id,
            model_id=m_id,
            status="pending",
            url=None,
            created_at=now
        )
        db.add(new_image)
        if m_id == model_id or response_image_id is None:
            response_image_id = new_img_id
            response_model_id = m_id

    db.commit()

    # Load pristine structural lock image base64 for Approach 2 Structural Rebase
    structural_lock_b64 = None
    if effective_parent_struct_lock:
        lock_img = db.query(DBImage).filter(
            DBImage.session_id == effective_parent_struct_lock,
            DBImage.status == "completed"
        ).first()
        if lock_img and lock_img.url:
            try:
                mat_url = await _materialize_image_url(lock_img.url)
                structural_lock_b64 = await _load_image_b64_from_url_or_path(mat_url or lock_img.url)
                if structural_lock_b64:
                    print(f"[Edit-Approach2] Loaded structural lock image from session {effective_parent_struct_lock} ({len(structural_lock_b64)} chars)")
            except Exception as e:
                print(f"[Edit-Approach2] Failed to load structural lock image: {e}")

    bg_req = SessionCreateRequest(
        prompt=merged_prompt,
        model_ids=models_list,
        active_configs=active_configs,
        reference_image_id=request.reference_image_id,
        ratio=request.ratio,
        quality=request.quality or parent_session.quality,
        image_base64=final_image_base64,  # Current degraded state for vision delta inspection
        original_image_base64=structural_lock_b64 or original_root_b64,  # Pristine structural lock reference
        edit_depth=edit_depth,
        vision_description=request.vision_description,
        edit_instruction=request.edit_prompt if request.edit_prompt else None,
        prompt_history=scoped_prompt_history if scoped_prompt_history else prompt_history,
        edit_type=child_edit_type
    )
    task = asyncio.create_task(_process_session_batch(child_session_id, bg_req))
    RUNNING_SESSION_TASKS[child_session_id] = task

    return {
        "session_id": child_session_id,
        "child_session_id": child_session_id,
        "image": {"image_id": response_image_id, "model_id": response_model_id, "status": "pending", "url": None}
    }


# ── Make Final Version — Quality Recovery ──────────────────────────────────────

class MakeFinalRequest(BaseModel):
    image_id: str   # the latest (potentially degraded) image to finalize
    quality: Optional[str] = None  # e.g. "Ultra", "High", "Standard"
    ratio: Optional[str] = None
    force_regenerate: Optional[bool] = False

MAKE_FINAL_QUALITY_SUFFIX = (
    "ultra high quality, tack sharp focus, photorealistic skin texture, "
    "correct anatomy, no artifacts, natural lighting, cinematic sharpness, "
    "preserve all subjects and composition from the reference exactly"
)

async def _caption_image_for_final(image_b64: str, original_prompt: str) -> str:
    """Use Gemini Flash to deeply caption the current state of a degraded image."""
    try:
        caption_prompt = (
            "Describe this image in extreme detail for the purpose of reproducing it faithfully.\n"
            "Cover ALL of the following:\n"
            "- Every subject (person, animal, object): their position, size, pose, expression, clothing, colors\n"
            "- Background elements: location, environment, objects, colors, lighting\n"
            "- Spatial relationships: what is next to what, in front of, behind, left, right\n"
            "- Any text visible in the image\n"
            "- Overall mood, lighting style, color palette\n"
            "Format as a single dense paragraph optimized for an image generation model.\n"
            "Do NOT include artistic commentary. Only factual visual description."
        )
        gemini_client = flash_client if flash_client else global_client
        resp = gemini_client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[
                types.Part.from_bytes(
                    data=base64.b64decode(image_b64),
                    mime_type="image/jpeg"
                ),
                caption_prompt
            ]
        )
        caption = resp.text.strip()
        print(f"[MakeFinal] Vision caption ({len(caption)} chars): {caption[:150]}...")
        return caption
    except Exception as e:
        print(f"[MakeFinal] Caption failed, using original prompt: {e}")
        return original_prompt



async def _generate_for_make_final(
    prompt: str,
    ratio: str,
    quality: str,
    image_b64: Optional[str],
    model_id: str
) -> List[str]:
    """Universal generator for Make Final Version: routes correctly to Nanobanana (Gemini), ChatGPT, etc."""
    if model_id in ["Nanobanana 2", "Nanobanana 2 (Beta)", "Nanobanana Pro"]:
        config = load_nanobanana_config()
        if model_id in ["Nanobanana 2", "Nanobanana 2 (Beta)"]:
            cfg = config.get("beta", {"model": "gemini-3.1-flash-image", "temperature": 0.7})
            nb_model = cfg.get("model", "gemini-3.1-flash-image")
            temp = 0.35
            use_top_p = 0.75
            is_beta = True
        else:
            nb_model = "gemini-3-pro-image"
            temp = 0.35
            use_top_p = 0.75
            is_beta = False
        imgs, ep, pt = await _gemini_generate(
            prompt, ratio, quality, image_b64, nb_model,
            temperature=temp, top_p=use_top_p, is_beta=is_beta, bypass_enhancement=True,
            request_source="EDIT"
        )
        return imgs or []
    elif model_id in ["ChatGPT", "OpenAI", "gpt-image-1", "gpt-image-2"]:
        chatgpt_m = "gpt-image-2"
        imgs, ep, _ = await _chatgpt_image_generate(prompt, ratio, quality, image_b64, chatgpt_m)
        return imgs or []
    elif model_id == "Flux.1":
        imgs = await _flux_generate(prompt, ratio, quality, image_b64=image_b64)
        return imgs or []
    elif model_id == "Kling":
        imgs = await _kling_generate(prompt, ratio, image_b64, quality)
        return imgs or []
    else:
        # Default fallback to Nanobanana 2
        imgs, ep, pt = await _gemini_generate(
            prompt, ratio, quality, image_b64, "gemini-3.1-flash-image",
            temperature=0.35, top_p=0.75, is_beta=True, bypass_enhancement=True,
            request_source="EDIT"
        )
        return imgs or []


async def _run_make_final_approach1(
    output_session_id: str,
    output_image_id: str,
    root_session: DBSession,
    latest_image_b64: str,
    model_id: str,
    ratio: str,
    quality: str,
):
    """Approach 1 — Full Re-render from Original.
    Vision-captions the latest degraded image, merges with original enhanced prompt,
    and re-renders with the root (original) image as reference.
    """
    db: Session = SessionLocal()
    try:
        # Step 1: Update image to 'generating'
        db.query(DBImage).filter(DBImage.id == output_image_id).update({"status": "generating"})
        db.commit()

        # Step 2: Load original root image
        root_img = db.query(DBImage).filter(
            DBImage.session_id == root_session.id,
            DBImage.status == "completed"
        ).first()
        root_b64 = None
        if root_img and root_img.url:
            try:
                mat_url = await _materialize_image_url(root_img.url)
                root_b64 = await _load_image_b64_from_url_or_path(mat_url or root_img.url)
            except Exception as e:
                print(f"[MakeFinal-A1] Failed to load root image: {e}")

        # Step 3: Caption the degraded latest image
        original_prompt = root_session.enhanced_prompt or root_session.prompt or ""
        delta_caption = await _caption_image_for_final(latest_image_b64, original_prompt)

        # Step 4: Build super prompt = original context + vision delta
        super_prompt = (
            f"A masterfully rendered high-resolution photograph: {delta_caption.strip()}\n\n"
            f"Preserve the authentic character styling, lighting, and environment from: {original_prompt.strip()}\n\n"
            f"{MAKE_FINAL_QUALITY_SUFFIX}"
        )

        # Step 5: Generate using root image as reference (if available)
        ref_b64 = root_b64 or latest_image_b64
        print(f"[MakeFinal-A1] Generating via {model_id} with reference ({len(ref_b64)} chars)...")
        result_urls = await _generate_for_make_final(
            prompt=super_prompt,
            ratio=ratio,
            quality=quality,
            image_b64=ref_b64,
            model_id=model_id
        )

        final_url = result_urls[0] if result_urls else None
        if final_url:
            final_url = await _materialize_image_url(final_url)
            db.query(DBImage).filter(DBImage.id == output_image_id).update({
                "status": "completed",
                "url": final_url,
                "enhanced_prompt": super_prompt,
            })
            print(f"[MakeFinal-A1] Done. URL: {final_url[:60]}")
        else:
            db.query(DBImage).filter(DBImage.id == output_image_id).update({
                "status": "failed",
                "error_msg": "Approach 1 generation returned no image"
            })
            print(f"[MakeFinal-A1] Failed — no URL returned")
        db.commit()
    except Exception as e:
        print(f"[MakeFinal-A1] Error: {e}")
        try:
            db.query(DBImage).filter(DBImage.id == output_image_id).update({
                "status": "failed",
                "error_msg": _format_user_friendly_error(e)
            })
            db.commit()
        except Exception:
            pass
    finally:
        db.close()


async def _run_make_final_approach2(
    output_session_id: str,
    output_image_id: str,
    current_session: DBSession,
    latest_image_b64: str,
    model_id: str,
    ratio: str,
    quality: str,
):
    """Approach 2 — Smart Structural Rebase.
    Finds the last structural lock, vision-captions the current state,
    collects all edits since the lock, builds a unified prompt,
    and re-renders from the structural lock image.
    """
    db: Session = SessionLocal()
    try:
        db.query(DBImage).filter(DBImage.id == output_image_id).update({"status": "generating"})
        db.commit()

        # Step 1: Find structural lock session
        struct_lock_session_id = current_session.structural_lock_session_id
        struct_lock_session = None
        if struct_lock_session_id:
            struct_lock_session = db.query(DBSession).filter(DBSession.id == struct_lock_session_id).first()

        # Fallback: find root (original_session_id)
        if not struct_lock_session:
            orig_id = current_session.original_session_id
            if orig_id:
                struct_lock_session = db.query(DBSession).filter(DBSession.id == orig_id).first()

        if not struct_lock_session:
            # Walk to root manually
            curr = current_session
            while curr.parent_session_id:
                parent = db.query(DBSession).filter(DBSession.id == curr.parent_session_id).first()
                if not parent:
                    break
                curr = parent
            struct_lock_session = curr

        # Step 2: Load structural lock image
        lock_img = db.query(DBImage).filter(
            DBImage.session_id == struct_lock_session.id,
            DBImage.status == "completed"
        ).first()
        lock_b64 = None
        if lock_img and lock_img.url:
            try:
                mat_url = await _materialize_image_url(lock_img.url)
                lock_b64 = await _load_image_b64_from_url_or_path(mat_url or lock_img.url)
            except Exception as e:
                print(f"[MakeFinal-A2] Failed to load lock image: {e}")

        # Step 3: Collect edit history since structural lock
        edit_history = []
        try:
            if current_session.edit_history_json:
                all_edits = json.loads(current_session.edit_history_json)
                # Filter to edits since (and including) the structural lock session
                found_lock = False
                for entry in all_edits:
                    if entry.get("session_id") == struct_lock_session_id:
                        found_lock = True
                    if found_lock:
                        edit_history.append(entry)
                if not found_lock:
                    edit_history = all_edits  # include all if lock not found in list
        except Exception:
            edit_history = []

        edit_instructions_text = "\n".join(
            f"- [{e.get('type','edit')}] {e.get('instruction','')}"
            for e in edit_history if e.get("instruction")
        )

        # Step 4: Vision caption the current image to capture exact state
        lock_prompt = struct_lock_session.enhanced_prompt or struct_lock_session.prompt or ""
        delta_caption = await _caption_image_for_final(latest_image_b64, lock_prompt)

        # Step 5: Build merged prompt
        edits_summary = edit_instructions_text.strip() if edit_instructions_text else "Preserve all subjects and scene composition."
        merged_prompt = (
            f"A masterfully rendered high-resolution photograph: {delta_caption.strip()}\n\n"
            f"Applied modifications from base scene: {edits_summary}\n\n"
            f"{MAKE_FINAL_QUALITY_SUFFIX}"
        )

        # Step 6: Generate using structural lock image as reference
        ref_b64 = lock_b64 or latest_image_b64

        print(f"[MakeFinal-A2] Generating via {model_id} with structural lock reference ({len(ref_b64)} chars)...")
        result_urls = await _generate_for_make_final(
            prompt=merged_prompt,
            ratio=ratio,
            quality=quality,
            image_b64=ref_b64,
            model_id=model_id
        )

        final_url = result_urls[0] if result_urls else None
        if final_url:
            final_url = await _materialize_image_url(final_url)
            db.query(DBImage).filter(DBImage.id == output_image_id).update({
                "status": "completed",
                "url": final_url,
                "enhanced_prompt": merged_prompt,
            })
            print(f"[MakeFinal-A2] Done. URL: {final_url[:60]}")
        else:
            db.query(DBImage).filter(DBImage.id == output_image_id).update({
                "status": "failed",
                "error_msg": "Approach 2 generation returned no image"
            })
            print(f"[MakeFinal-A2] Failed — no URL returned")
        db.commit()
    except Exception as e:
        print(f"[MakeFinal-A2] Error: {e}")
        try:
            db.query(DBImage).filter(DBImage.id == output_image_id).update({
                "status": "failed",
                "error_msg": _format_user_friendly_error(e)
            })
            db.commit()
        except Exception:
            pass
    finally:
        db.close()


@app.post("/api/sessions/{session_id}/make-final")
async def make_final_version(
    session_id: str,
    request: MakeFinalRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Trigger quality recovery for a degraded iterated image.
    Runs Approach 1 (full re-render from original) and Approach 2 (structural rebase)
    in parallel as background tasks. Returns two pending image IDs for polling.
    """
    # Robust source image lookup: by ID, or fallback to session's completed image
    source_image = None
    if request.image_id:
        source_image = db.query(DBImage).filter(DBImage.id == request.image_id).first()
    if not source_image:
        source_image = db.query(DBImage).filter(DBImage.session_id == session_id, DBImage.status == "completed").order_by(DBImage.created_at.desc()).first()
    if not source_image:
        source_image = db.query(DBImage).filter(DBImage.session_id == session_id).first()
    if not source_image:
        raise HTTPException(status_code=404, detail=f"Image {request.image_id} not found in session {session_id}")

    # Robust session lookup
    current_session = db.query(DBSession).filter(DBSession.id == session_id).first()
    if not current_session and source_image.session_id:
        current_session = db.query(DBSession).filter(DBSession.id == source_image.session_id).first()
    if not current_session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found")

    # Fetch the latest image as base64
    latest_b64 = None
    if source_image.url:
        try:
            mat_url = await _materialize_image_url(source_image.url)
            latest_b64 = await _load_image_b64_from_url_or_path(mat_url or source_image.url)
        except Exception as e:
            print(f"[MakeFinal] Failed to load latest image: {e}")
    if not latest_b64:
        raise HTTPException(status_code=400, detail="Could not load source image bytes for quality recovery")

    # Find root session
    root_session = current_session
    curr = current_session
    visited_mf: set = set()
    while curr.parent_session_id and curr.parent_session_id not in visited_mf:
        visited_mf.add(curr.id)
        parent = db.query(DBSession).filter(DBSession.id == curr.parent_session_id).first()
        if parent:
            curr = parent
            root_session = parent
        else:
            break

    model_id = source_image.model_id or "Nanobanana 2"
    ratio = request.ratio or current_session.ratio or root_session.ratio or "1:1"
    quality = request.quality or current_session.quality or root_session.quality or "Ultra"
    now = datetime.utcnow().isoformat()

    # ── Database Cache Check: Return existing completed/generating results if available ──
    force_regen = bool(getattr(request, "force_regenerate", False))
    if not force_regen:
        existing_a1 = db.query(DBSession).filter(
            DBSession.parent_session_id == session_id,
            DBSession.edit_type == "final_v1"
        ).order_by(DBSession.created_at.desc()).first()
        
        existing_a2 = db.query(DBSession).filter(
            DBSession.parent_session_id == session_id,
            DBSession.edit_type == "final_v2"
        ).order_by(DBSession.created_at.desc()).first()

        if existing_a1 and existing_a2:
            img1 = db.query(DBImage).filter(DBImage.session_id == existing_a1.id).order_by(DBImage.created_at.desc()).first()
            img2 = db.query(DBImage).filter(DBImage.session_id == existing_a2.id).order_by(DBImage.created_at.desc()).first()

            if img1 and img2:
                # Materialize URLs if available
                url1 = await _materialize_image_url(img1.url) if img1.url else None
                url2 = await _materialize_image_url(img2.url) if img2.url else None
                print(f"[MakeFinal] Returning existing cached DB results for session {session_id} (img1={img1.status}, img2={img2.status})")
                return {
                    "approach1": {
                        "session_id": existing_a1.id,
                        "image_id": img1.id,
                        "status": img1.status,
                        "url": url1 or img1.url,
                        "label": "Full Re-render from Original",
                        "error_msg": img1.error_msg
                    },
                    "approach2": {
                        "session_id": existing_a2.id,
                        "image_id": img2.id,
                        "status": img2.status,
                        "url": url2 or img2.url,
                        "label": "Smart Structural Rebase",
                        "error_msg": img2.error_msg
                    }
                }

    # Create Approach 1 session + image
    a1_sess_id = str(uuid.uuid4())
    a1_img_id = str(uuid.uuid4())
    a1_session = DBSession(
        id=a1_sess_id,
        user_id=user.id,
        parent_session_id=session_id,
        prompt=f"[Make Final v1] {current_session.prompt or ''}",
        models=json.dumps([model_id]),
        active_configs=current_session.active_configs or "{}",
        ratio=ratio,
        quality=quality,
        created_at=now,
        edit_type="final_v1",
        original_session_id=root_session.id,
    )
    a1_image = DBImage(
        id=a1_img_id,
        session_id=a1_sess_id,
        user_id=user.id,
        model_id=model_id,
        status="pending",
        url=None,
        created_at=now,
    )

    # Create Approach 2 session + image
    a2_sess_id = str(uuid.uuid4())
    a2_img_id = str(uuid.uuid4())
    a2_session = DBSession(
        id=a2_sess_id,
        user_id=user.id,
        parent_session_id=session_id,
        prompt=f"[Make Final v2] {current_session.prompt or ''}",
        models=json.dumps([model_id]),
        active_configs=current_session.active_configs or "{}",
        ratio=ratio,
        quality=quality,
        created_at=now,
        edit_type="final_v2",
        original_session_id=root_session.id,
    )
    a2_image = DBImage(
        id=a2_img_id,
        session_id=a2_sess_id,
        user_id=user.id,
        model_id=model_id,
        status="pending",
        url=None,
        created_at=now,
    )

    db.add(a1_session); db.add(a1_image)
    db.add(a2_session); db.add(a2_image)
    db.commit()

    # Snapshot current_session fields before db.close (avoid detached instance errors in bg tasks)
    _current_sess_snap = {
        "id": current_session.id,
        "structural_lock_session_id": current_session.structural_lock_session_id,
        "original_session_id": current_session.original_session_id,
        "edit_history_json": current_session.edit_history_json,
        "enhanced_prompt": current_session.enhanced_prompt,
        "prompt": current_session.prompt,
    }

    print(f"[MakeFinal] Launching A1={a1_img_id}, A2={a2_img_id} for session={session_id}")
    background_tasks.add_task(
        _run_make_final_approach1,
        a1_sess_id, a1_img_id, root_session, latest_b64, model_id, ratio, quality
    )
    background_tasks.add_task(
        _run_make_final_approach2,
        a2_sess_id, a2_img_id, current_session, latest_b64, model_id, ratio, quality
    )

    return {
        "approach1": {
            "session_id": a1_sess_id,
            "image_id": a1_img_id,
            "status": "pending",
            "label": "Full Re-render from Original",
        },
        "approach2": {
            "session_id": a2_sess_id,
            "image_id": a2_img_id,
            "status": "pending",
            "label": "Smart Structural Rebase",
        }
    }


class RefinePromptRequest(BaseModel):
    prompt: str
    ratio: str = "1:1"
    quality: str = "Standard"
    selections: dict = Field(default_factory=dict)  # e.g. {"style": "cinematic", "lighting": "dramatic"}

@app.post("/api/refine-prompt")
async def refine_prompt(request: RefinePromptRequest, current_user: Optional[User] = Depends(get_optional_user)):
    """Use AI to rewrite the prompt to incorporate newly selected settings.
    Auth is optional — this is a lightweight text-only helper, no image credits consumed.
    """

    # Build a human-readable settings description
    settings_lines = [f"- Aspect Ratio: {request.ratio}"]
    settings_lines.append(f"- Quality: {request.quality}")
    label_map = {
        "style": "Visual Style", "medium": "Medium", "lighting": "Lighting",
        "composition": "Composition", "camera": "Camera Angle",
        "lens": "Lens", "mood": "Mood", "color": "Color Palette"
    }
    for key, val in request.selections.items():
        label = label_map.get(key, key.title())
        settings_lines.append(f"- {label}: {val}")
    settings_text = "\n".join(settings_lines)

    system_instruction = (
        "You are an expert AI image prompt engineer. Your ONLY job is to apply a user's newly selected "
        "UI settings into their existing prompt — nothing more.\n\n"

        "STRICT RULES (never break these):\n"
        "1. ZERO HALLUCINATION: Do NOT invent new subjects, actions, scenes, backgrounds, or details "
        "that do not exist in the original prompt. If the original prompt says 'formula one car', "
        "do NOT add 'racing on a track', 'cheering fans', 'speed lines', or anything else.\n"
        "2. PRESERVE THE CORE: Keep the original prompt's subject, scene, and all existing details "
        "100% intact. Only add/change the things the user explicitly selected.\n"
        "3. CONFLICT RESOLUTION: If the original prompt contains settings (e.g. '16:9', 'cinematic', "
        "'dark mood', 'black and white') that CONFLICT with the newly selected settings, REMOVE the "
        "old conflicting mention and apply the new one. Do not keep both.\n"
        "4. CLEAN INTEGRATION: Naturally weave the new settings in. Do NOT just dump a comma list "
        "at the end if it can flow naturally. If the prompt is very short, a clean descriptor list "
        "is acceptable.\n"
        "5. NO EXPANSION: Do not make a short prompt long. Do not pad or elaborate.\n"
        "6. OUTPUT ONLY: Return ONLY the final prompt text — no explanations, no headers, no bullets.\n"
        "7. MULTI-PARAGRAPH: If the original prompt spans multiple paragraphs, keep that structure.\n\n"

        "FEW-SHOT EXAMPLES:\n\n"

        "Example 1 — Short prompt, no conflicts:\n"
        "  Original: 'Formula one car'\n"
        "  New settings: Aspect Ratio: 1:1, Visual Style: Cinematic, Lighting: Golden Hour\n"
        "  CORRECT output: 'Formula one car, cinematic style, golden hour lighting, 1:1 aspect ratio.'\n"
        "  WRONG output: 'A formula one car racing down a vibrant track with cheering fans under golden hour lighting...'\n\n"

        "Example 2 — Conflict resolution:\n"
        "  Original: 'A stray cat on a wall, wide 16:9 cinematic shot, dark moody lighting.'\n"
        "  New settings: Aspect Ratio: 1:1, Mood: Serene, Lighting: Golden Hour\n"
        "  CORRECT output: 'A stray cat on a wall, serene mood, golden hour lighting, 1:1 aspect ratio.'\n"
        "  WRONG output: 'A stray cat on a wall, wide 16:9 cinematic shot, dark moody lighting, serene, golden hour, 1:1.'\n\n"

        "Example 3 — Long prompt, partial update:\n"
        "  Original: 'A modern skyscraper at sunset. The glass facade reflects orange hues. "
        "Street level shows busy pedestrians and yellow taxis.'\n"
        "  New settings: Visual Style: Watercolor, Color Palette: Muted\n"
        "  CORRECT output: 'A modern skyscraper at sunset, watercolor style, muted color palette. "
        "The glass facade reflects soft orange hues. Street level shows busy pedestrians and yellow taxis.'\n"
    )

    user_message = (
        f"Original prompt:\n{request.prompt}\n\n"
        f"New settings selected by the user (apply these exactly, resolve any conflicts):\n{settings_text}\n\n"
        "Rewrite the prompt following the rules above. Return ONLY the rewritten prompt text."
    )

    # ── Attempt 1: Gemini Flash ──
    gemini_client = flash_client if flash_client else global_client
    if gemini_client:
        try:
            response = await gemini_client.aio.models.generate_content(
                model="gemini-2.5-flash-lite",
                contents=user_message,
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    temperature=0.4,
                    max_output_tokens=2048,
                )
            )
            refined = response.text.strip()
            print(f"[refine-prompt] [OK] Gemini succeeded")
            return {"status": "success", "refined_prompt": refined}
        except Exception as e:
            print(f"[refine-prompt] Gemini failed: {e}")

    # ── Attempt 2: Claude Sonnet 5 fallback ──
    if ANTHROPIC_API_KEY:
        try:
            print("[refine-prompt] Falling back to Claude Sonnet 5...")
            ant_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
            resp = await asyncio.to_thread(
                ant_client.messages.create,
                model="claude-sonnet-5",
                system=system_instruction,
                messages=[{"role": "user", "content": user_message}],
                max_tokens=2048,
            )
            refined = _extract_anthropic_text(resp)
            print(f"[refine-prompt] [OK] Claude Sonnet 5 fallback succeeded")
            return {"status": "success", "refined_prompt": refined}
        except Exception as e_ant:
            print(f"[refine-prompt] Claude Sonnet 5 fallback failed: {e_ant}")

    # ── Attempt 3: GPT-5.6-luna fallback ──
    if OPENAI_API_KEY:
        try:
            print("[refine-prompt] Falling back to GPT-5.6-luna...")
            oai_client = openai_lib.OpenAI(api_key=OPENAI_API_KEY)
            resp = await asyncio.to_thread(
                oai_client.chat.completions.create,
                model="gpt-5.6-luna",
                messages=[
                    {"role": "system", "content": system_instruction},
                    {"role": "user", "content": user_message},
                ],
                max_completion_tokens=2048,
            )
            refined = resp.choices[0].message.content.strip()
            print(f"[refine-prompt] [OK] GPT-5.6-luna fallback succeeded")
            return {"status": "success", "refined_prompt": refined}
        except Exception as e:
            print(f"[refine-prompt] GPT-5.6-luna fallback failed: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    raise HTTPException(status_code=500, detail="No AI provider available for prompt refinement.")


# ── OPENAI DALL·E 3 HELPER ────────────────────────────────────────────────────

async def _openai_generate(prompt: str, ratio: str, quality: str = "Standard") -> List[str]:
    """Generate image via OpenAI DALL·E 3. Returns list of image URLs.
    quality: Standard → standard, High/Ultra → hd
    """
    if not OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not set in .env")

    size_map = {
        "1:1":  "1024x1024",
        "16:9": "1792x1024",
        "9:16": "1024x1792",
    }
    size = size_map.get(ratio, "1024x1024")
    # HD mode costs 2× but is noticeably sharper — use for High / Ultra
    dalle_quality = "hd" if quality in ("High", "Ultra") else "standard"
    enhanced_prompt = _build_openai_enhanced_prompt(prompt, quality)

    print(f"[OpenAI] Generating. Size: {size}, DalleQuality: {dalle_quality}, Prompt: {enhanced_prompt[:100]}...")

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            "https://api.openai.com/v1/images/generations",
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json"
            },
            json={
                "model": "dall-e-3",
                "prompt": enhanced_prompt,
                "n": 1,
                "size": size,
                "quality": dalle_quality,
                "response_format": "url"
            }
        )
        print(f"[OpenAI] Response: {resp.status_code}")
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"OpenAI API error: {resp.text}")
        data = resp.json()
        urls = [item["url"] for item in data.get("data", [])]
        print(f"[OpenAI] Got {len(urls)} image URL(s)")
        return urls


# ── BLACK FOREST LABS FLUX HELPER ────────────────────────────────────────────

async def _flux_generate(prompt: str, ratio: str, quality: str = "Standard", image_b64: Optional[Union[str, List[str]]] = None) -> List[str]:
    """Generate image via BFL Flux.

    Nanobanana-grade resilience:
      1. Model cascade:  Ultra → Pro on failure
      2. Prompt sanitizer middleman:  content-moderated → _sanitize_prompt → retry
      3. Resilient auto-retries:  3 attempts per submit with exponential backoff

    quality: Standard -> flux-pro-1.1
             High     -> flux-pro-1.1 + prompt_upsampling
             Ultra    -> flux-pro-1.1-ultra (highest quality endpoint)
    image_b64: Optional reference image for image-to-image generation.
    """
    if not BFL_API_KEY:
        raise HTTPException(status_code=500, detail="BFL_API_KEY not set in .env")

    headers = {"X-Key": BFL_API_KEY, "Content-Type": "application/json"}

    def _build_payload(use_prompt: str, use_quality: str) -> tuple:
        """Build endpoint + payload for a given quality tier."""
        ep = _build_flux_enhanced_prompt(use_prompt, use_quality)
        if use_quality == "Ultra":
            endpoint = "https://api.bfl.ai/v1/flux-pro-1.1-ultra"
            ar_map = {"1:1": "1:1", "16:9": "16:9", "9:16": "9:16", "4:5": "4:5", "3:2": "3:2", "4:3": "4:3"}
            pl: Dict = {
                "prompt": ep,
                "aspect_ratio": ar_map.get(ratio, "1:1"),
                "safety_tolerance": 2,
                "output_format": "jpeg",
                "raw": False,
            }
            return endpoint, pl
        else:
            endpoint = "https://api.bfl.ai/v1/flux-pro-1.1"
            dim_map = {
                "1:1": (1024, 1024), "16:9": (1344, 768), "9:16": (768, 1344),
                "4:5": (896, 1120), "3:2": (1216, 832), "4:3": (1152, 896),
            }
            width, height = dim_map.get(ratio, (1024, 1024))
            pl = {
                "prompt": ep,
                "width": width, "height": height,
                "prompt_upsampling": use_quality in ("High", "Ultra"),
                "safety_tolerance": 2,
                "output_format": "jpeg",
            }
            return endpoint, pl

    async def _submit_and_poll(use_prompt: str, use_quality: str) -> List[str]:
        """Submit to Flux and poll with retries. Raises ContentBlockedError on moderation."""
        endpoint, payload = _build_payload(use_prompt, use_quality)
        print(f"[Flux] {use_quality} mode -> {endpoint.split('/')[-1]}")
        print(f"[Flux] Prompt: {use_prompt[:100]}...")

        # ── Resilient submit with 3 retries + exponential backoff ──
        last_exc: Optional[Exception] = None
        resp = None
        for attempt in range(3):
            try:
                if attempt > 0:
                    backoff = 3 * attempt
                    print(f"[Flux] Submit retry {attempt}/2 (backoff {backoff}s)...")
                    await asyncio.sleep(backoff)
                async with httpx.AsyncClient(timeout=180) as client:
                    resp = await client.post(endpoint, headers=headers, json=payload)
                    print(f"[Flux] Submit: {resp.status_code} {resp.text[:200]}")
                    if resp.status_code in (500, 502, 503):
                        raise Exception(f"BFL server error {resp.status_code}")
                    break
            except Exception as e:
                err_str = str(e)
                is_transient = any(x in err_str for x in ["500", "502", "503", "timeout", "Timeout", "UNAVAILABLE"])
                if is_transient:
                    last_exc = e
                    continue
                raise
        else:
            raise HTTPException(status_code=503, detail=f"Flux: all submit retries exhausted. Last error: {last_exc}")

        if resp is None or resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"BFL API error: {resp.text if resp else 'no response'}")

        task_id = resp.json().get("id")
        if not task_id:
            raise HTTPException(status_code=502, detail="BFL API: no task ID returned")

        print(f"[Flux] Task ID: {task_id}. Polling...")

        # Poll for result (max 150s, 50 x 3s)
        async with httpx.AsyncClient(timeout=180) as client:
            for poll_attempt in range(50):
                await asyncio.sleep(3)
                poll_resp = await client.get(
                    "https://api.bfl.ai/v1/get_result",
                    headers=headers,
                    params={"id": task_id}
                )
                if poll_resp.status_code != 200:
                    continue
                result = poll_resp.json()
                status = result.get("status")
                print(f"[Flux] Poll {poll_attempt+1}: {status}")

                if status == "Ready":
                    sample = result.get("result", {}).get("sample")
                    if sample:
                        print(f"[Flux] Materializing BFL URL immediately...")
                        materialized = await _materialize_image_url(sample)
                        return [materialized] if materialized else [sample]
                    raise HTTPException(status_code=502, detail="BFL: no sample in result")
                elif status in ("Content Moderated", "Request Moderated"):
                    raise ContentBlockedError(f"BFL task moderated: {status}")
                elif status == "Error":
                    raise HTTPException(status_code=502, detail=f"BFL task failed: {status}")

        raise HTTPException(status_code=504, detail="BFL Flux task timed out after 150s")

    # ── Main orchestration: cascade + sanitizer middleman ──
    # Quality cascade: Ultra → High → Standard (downgrades on failure)
    quality_cascade = []
    if quality == "Ultra":
        quality_cascade = ["Ultra", "High"]
    elif quality == "High":
        quality_cascade = ["High", "Standard"]
    else:
        quality_cascade = ["Standard"]

    last_error: Optional[Exception] = None
    for q_tier in quality_cascade:
        try:
            # Attempt 1: enhanced prompt
            return await _submit_and_poll(prompt, q_tier)
        except ContentBlockedError as cbe:
            # ── Prompt Sanitizer Middleman (Nanobanana Pillar #2) ──
            print(f"[Flux] Blocked by content moderation ({q_tier}) — invoking prompt middleman...")
            sanitized = await _sanitize_prompt(prompt)
            try:
                return await _submit_and_poll(sanitized, q_tier)
            except ContentBlockedError:
                print(f"[Flux] Still blocked after sanitization on {q_tier}. Trying lower tier...")
                last_error = cbe
            except Exception as e2:
                last_error = e2
                print(f"[Flux] {q_tier} sanitized retry failed: {e2}. Trying lower tier...")
        except Exception as e:
            last_error = e
            print(f"[Flux] {q_tier} failed: {str(e)[:200]}. Trying lower tier...")

    raise HTTPException(
        status_code=502,
        detail=f"Flux: all quality tiers in cascade failed. Last error: {last_error}"
    )


# ── CLAUDE PROMPT TAILORING HELPER ───────────────────────────────────────────

async def _claude_tailor_prompts(base_prompt: str, models: List[str]) -> Dict[str, str]:
    """Uses Gemini to tailor a prompt for each specified model's strengths (Anthropic fallback)."""
    if _is_camera_angle_request(base_prompt):
        print(f"[Compare] Camera angle intent detected in base_prompt. Applying spatial viewpoint rewriter...")
        base_prompt, _, _ = await _rewrite_camera_angle_prompt(base_prompt, base_prompt)

    # Anthropic API was returning 404s, so we use the working Gemini Flash instead.
    client = flash_client if flash_client else global_client
    if not client:
        return {m: base_prompt for m in models}

    if models == ["Nanobanana 2 (Beta)"]:
        prompt_text = f"""You are an expert prompt engineer for Nanobanana 2 only.
The user wants to generate this image: "{base_prompt}"

Your ONLY job is to append ≤25 words of Nanobanana-specific modifiers 
to the END of the original prompt.

Nanobanana 2 responds best to:
- Film stock references (Kodak Portra, Fujifilm Velvia, Ilford HP5)
- Natural lighting (golden hour, overcast diffused, window light)
- Painterly realism descriptors (soft color harmony, organic texture)
- Lens character (slight vignette, natural bokeh, optical softness)

NEVER change the subject or scene.
NEVER add: 8K, masterpiece, ultra-detailed, sharp, flawless.

Respond ONLY with a valid JSON object. No markdown, no explanation outside JSON.

{{"tailored_prompts": {{"Nanobanana 2 (Beta)": ""}} }}"""
    else:
        model_descriptions = {
            "Nanobanana": "Google Gemini image generation — excels at creative illustration, dreamy conceptual images, cohesive color palettes, and whimsical fantasy art",
            "ChatGPT":    "OpenAI ChatGPT Image (GPT Image 1.5) — state-of-the-art at photorealistic imagery, complex multi-subject scenes, hyper-detailed textures, precise compositional control, and commercial photography quality with built-in quality enhancement pipeline",
            "Kling":      "Kling v1 AI — specializes in cinematic photography, hyper-detailed textures, fashion and portrait photography, and dramatic film-quality lighting",
            "Flux.1":     "Black Forest Labs Flux Pro 1.1 — state-of-the-art at typography integration, precise prompt adherence, vivid commercial-grade images, and realistic human subjects",
        }

        model_list_str = "\n".join([
            f"- {m}: {model_descriptions.get(m, 'General purpose AI image generation model')}"
            for m in models
        ])

        prompt_text = f"""You are an expert prompt engineer for AI image generation models.

The user wants to generate images with this base prompt:
"{base_prompt}"

They want to run this on the following {len(models)} AI models simultaneously:
{model_list_str}

CRITICAL RULES — follow these exactly:
1. The SUBJECT, SCENE, and CORE CONTENT of the user's prompt must NEVER change.
   - Do NOT replace the subject with something else (e.g. do NOT turn an architecture prompt into an astronaut scene).
2. Your ONLY job is to APPEND a short list of model-specific technical modifiers to the END of the original prompt.
   - Modifiers include: render quality descriptors, lighting terms, camera/lens terms, artistic medium terms.
   - Keep the appended suffix under 30 words.
   - The original prompt text MUST appear VERBATIM at the START of each tailored prompt.
3. Do NOT rewrite, rephrase, or summarize the user's prompt.
4. Do NOT invent a new subject or narrative.

Example of CORRECT behavior:
- User prompt: "a minimalist concrete building at dusk"
- Nanobanana: "a minimalist concrete building at dusk, soft painterly light, cohesive cool color palette, concept art quality"
- ChatGPT: "a minimalist concrete building at dusk, ultra-detailed photorealistic textures, commercial photography quality, sharp focus"

Example of WRONG behavior (NEVER do this):
- User prompt: "a minimalist concrete building at dusk"
- WRONG: "a solitary astronaut standing on an alien planet at dusk" <- changed the subject entirely

Respond ONLY with a valid JSON object. No markdown, no explanation outside JSON.

{{"tailored_prompts": {{ {', '.join([f'"{m}": ""' for m in models])} }} }}"""

    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash-lite",
            contents=[prompt_text],
            config=types.GenerateContentConfig(
                temperature=0.3,  # Low temperature = more faithful, less hallucination
                response_mime_type="application/json",
            )
        )
        text = response.text.strip()
        parsed = json.loads(text)
        tailored = parsed.get("tailored_prompts", {})
        result = {}
        # Safety check prefix length — use min(40, len) to avoid index errors on short prompts
        check_len = min(40, len(base_prompt))
        for m in models:
            tp = tailored.get(m, base_prompt)
            # If Gemini diverged (didn't start with the original prompt), fall back to base
            if check_len > 10 and not tp.lower().startswith(base_prompt[:check_len].lower()):
                print(f"[TailorPrompts] Safety fallback for {m}: tailored prompt diverged. Using base prompt.")
                tp = base_prompt
            result[m] = tp
        print(f"[TailorPrompts] Tailored for {models} using Gemini Flash")
        return result
    except Exception as e:
        print(f"[TailorPrompts] Gemini error: {e}. Falling back to base prompt.")
        return {m: base_prompt for m in models}


# ── COMPARE BACKGROUND BATCH PROCESSOR ───────────────────────────────────────

async def _process_compare_batch(
    compare_session_id: str,
    image_slots: List[Dict],
    ratio: str,
    quality: str,
    image_base64: Optional[Union[str, List[str]]],
    chatgpt_model: str = "gpt-image-2",
):
    """Run each model generation in parallel and update compare_images table."""

    async def run_one(img_id: str, model_id: str, tailored_prompt: str):
        url = None
        error_msg = None
        status = "failed"
        try:
            if model_id in ["Nanobanana 2", "Nanobanana 2 (Beta)", "Nanobanana Pro"]:
                config = load_nanobanana_config()
                is_beta_flag = False
                use_top_p = None
                if model_id in ["Nanobanana 2", "Nanobanana 2 (Beta)"]:
                    cfg = config.get("beta", {"model": "gemini-3.1-flash-image", "temperature": 0.7})
                    nb_model = cfg.get("model", "gemini-3.1-flash-image")
                    temp = cfg.get("temperature", 0.7)
                    is_beta_flag = True
                    use_top_p = 0.85
                else: # Nanobanana Pro
                    nb_model = "gemini-3-pro-image"
                    temp = 0.4
                imgs, _, _ = await _gemini_generate(tailored_prompt, ratio, quality, image_base64, nb_model, temperature=temp, top_p=use_top_p, is_beta=is_beta_flag, request_source="COMPARE")
                if imgs: url = imgs[0]
            elif model_id == "ChatGPT":
                imgs, _, _ = await _chatgpt_image_generate(tailored_prompt, ratio, quality, image_base64, model=chatgpt_model)
                if imgs: url = imgs[0]
            elif model_id == "Kling":
                imgs = await _kling_generate(tailored_prompt, ratio, image_base64, quality)
                if imgs: url = imgs[0]
            elif model_id == "OpenAI":
                imgs = await _openai_generate(tailored_prompt, ratio, quality)
                if imgs: url = imgs[0]
            elif model_id == "Flux.1":
                imgs = await _flux_generate(tailored_prompt, ratio, quality)
                if imgs: url = imgs[0]
            else:
                error_msg = f"Model '{model_id}' is not yet integrated in this backend."

            if url:
                status = "completed"
            elif not error_msg:
                error_msg = "Model returned no image."

        except HTTPException as e:
            error_msg = e.detail
            print(f"[Compare] HTTPException for {model_id}: {e.detail}")
        except Exception as e:
            error_msg = str(e)
            print(f"[Compare] Unexpected error for {model_id}: {e}")

        try:
            update_db = SessionLocal()
            try:
                url = await _materialize_image_url(url)
                update_db.query(DBCompareImage).filter(DBCompareImage.id == img_id).update({
                    "status": status, 
                    "url": url, 
                    "error_msg": error_msg
                })
                update_db.commit()
            except Exception as db_err:
                print(f"[Compare] Database update failed for {model_id}: {db_err}")
                update_db.rollback()
            finally:
                update_db.close()
        except Exception as e:
            print(f"[Compare] Could not create database session for {model_id}: {e}")
        
        print(f"[Compare] {model_id} -> {status}")

    tasks = [run_one(s["id"], s["model_id"], s["tailored_prompt"]) for s in image_slots]
    await asyncio.gather(*tasks)


# ── COMPARE ENDPOINTS ─────────────────────────────────────────────────────────

@app.post("/api/compare/start")
async def compare_start(
    request: CompareStartRequest, 
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    access_error = _generation_access_error(user)
    if access_error:
        raise access_error

    # ── Content safety: instant keyword check (< 1ms) ──
    kw_safe, kw_reason = check_prompt_keywords(request.prompt)
    if not kw_safe:
        raise HTTPException(status_code=400, detail=f"Content blocked: {kw_reason}")

    """Start a multi-model comparison session. Returns compare_session_id and pending image slots."""
    compare_session_id = request.session_id or str(uuid.uuid4())
    now = datetime.utcnow().isoformat()

    if request.session_id:
        existing_session = db.query(DBCompareSession).filter(DBCompareSession.id == request.session_id).first()
        if existing_session and existing_session.user_id != user.id:
            raise HTTPException(status_code=404, detail="Compare session not found")

    print(f"[Compare] Starting session {compare_session_id} with models: {request.models}")

    # Tailor prompt for each model via Claude
    tailored = await _claude_tailor_prompts(request.prompt, request.models)

    # Check if session exists
    existing_session = db.query(DBCompareSession).filter(DBCompareSession.id == compare_session_id).first()
    
    expanded_models = []
    for model_id in request.models:
        if model_id not in expanded_models:
            expanded_models.append(model_id)

    if not existing_session:
        new_comp_session = DBCompareSession(
            id=compare_session_id,
            user_id=user.id,
            original_prompt=request.prompt,
            models=json.dumps(expanded_models),
            ratio=request.ratio,
            quality=request.quality,
            active_configs=json.dumps(request.categories),
            created_at=now
        )
        db.add(new_comp_session)

    image_slots = []
    for model_id in expanded_models:
        img_id = str(uuid.uuid4())
        tp_key = "Nanobanana 2" if model_id == "Nanobanana 2 (Beta)" else model_id
        tp = tailored.get(tp_key, request.prompt)
        new_comp_img = DBCompareImage(
            id=img_id,
            compare_session_id=compare_session_id,
            user_id=user.id,
            model_id=model_id,
            original_prompt=request.prompt,
            tailored_prompt=tp,
            status="pending",
            url=None,
            error_msg=None,
            iteration=0,
            created_at=now
        )
        db.add(new_comp_img)
        image_slots.append({"id": img_id, "model_id": model_id, "tailored_prompt": tp})

    db.commit()

    background_tasks.add_task(
        _process_compare_batch,
        compare_session_id, image_slots, request.ratio, request.quality, request.image_base64,
        chatgpt_model=request.chatgpt_model,
    )

    return {
        "compare_session_id": compare_session_id,
        "images": [
            {
                "id": s["id"],
                "model_id": s["model_id"],
                "original_prompt": request.prompt,
                "tailored_prompt": s["tailored_prompt"],
                "status": "pending",
                "url": None,
                "error_msg": None,
                "iteration": 0
            }
            for s in image_slots
        ]
    }


@app.get("/api/compare/{compare_session_id}")
async def get_compare_session(
    compare_session_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Poll the status of all images in a compare session."""
    _ensure_compare_session_owner(db, compare_session_id, user.id)
    session = db.query(DBCompareSession).filter(DBCompareSession.id == compare_session_id, DBCompareSession.user_id == user.id).first()

    images = db.query(DBCompareImage).filter(DBCompareImage.compare_session_id == compare_session_id).all()

    return {
        "id": session.id,
        "original_prompt": session.original_prompt,
        "models": json.loads(session.models),
        "ratio": session.ratio,
        "quality": session.quality,
        "active_configs": json.loads(session.active_configs),
        "created_at": session.created_at,
        "images": [
            {
                "id": img.id,
                "model_id": img.model_id,
                "original_prompt": img.original_prompt,
                "tailored_prompt": img.tailored_prompt,
                "status": img.status,
                "url": img.url,
                "error_msg": img.error_msg,
                "iteration": img.iteration,
                "created_at": img.created_at
            }
            for img in images
        ]
    }
@app.post("/api/compare/{compare_session_id}/feedback")
async def compare_feedback(
    compare_session_id: str,
    request: CompareFeedbackRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Regenerate specific models with user feedback appended to their tailored prompt."""
    _ensure_compare_session_owner(db, compare_session_id, user.id)
    session = db.query(DBCompareSession).filter(DBCompareSession.id == compare_session_id, DBCompareSession.user_id == user.id).first()

    now = datetime.utcnow().isoformat()
    new_slots = []

    for model_id, feedback_text in request.feedbacks.items():
        # Find the latest tailored prompt for this model
        latest = db.query(DBCompareImage).filter(
            DBCompareImage.compare_session_id == compare_session_id,
            DBCompareImage.model_id == model_id
        ).order_by(DBCompareImage.iteration.desc()).first()

        base_tp = latest.tailored_prompt if latest else session.original_prompt
        new_tp = f"{base_tp}, {feedback_text.strip()}" if feedback_text.strip() else base_tp
        new_iteration = (latest.iteration + 1) if latest else 1

        new_img_id = str(uuid.uuid4())
        new_comp_img = DBCompareImage(
            id=new_img_id,
            compare_session_id=compare_session_id,
            user_id=user.id,
            model_id=model_id,
            original_prompt=session.original_prompt,
            tailored_prompt=new_tp,
            status="pending",
            url=None,
            error_msg=None,
            iteration=new_iteration,
            created_at=now
        )
        db.add(new_comp_img)
        new_slots.append({"id": new_img_id, "model_id": model_id, "tailored_prompt": new_tp})
        print(f"[Compare/Feedback] {model_id} -> iteration {new_iteration}")

    db.commit()

    background_tasks.add_task(
        _process_compare_batch,
        compare_session_id, new_slots, request.ratio, request.quality, request.image_base64,
        chatgpt_model=request.chatgpt_model if hasattr(request, 'chatgpt_model') else "gpt-image-2",
    )

    return {
        "new_images": [
            {"id": s["id"], "model_id": s["model_id"], "tailored_prompt": s["tailored_prompt"], "status": "pending", "iteration": 0}
            for s in new_slots
        ]
    }


# ── NANOBANANA TESTING / PROMOTION ENDPOINTS ──────────────────────────────────
class NanobananaModelConfig(BaseModel):
    model: str
    temperature: float = 0.4

class NanobananaConfigUpdate(BaseModel):
    production: Optional[NanobananaModelConfig] = None
    beta: Optional[NanobananaModelConfig] = None

@app.get("/api/nanobanana/config")
async def get_nanobanana_config(user: User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Forbidden: Admin access required")
    return load_nanobanana_config()

@app.post("/api/nanobanana/config")
async def update_nanobanana_config(request: NanobananaConfigUpdate, user: User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Forbidden: Admin access required")
    
    current = load_nanobanana_config()
    if request.production:
        current["production"] = request.production.dict()
    if request.beta:
        current["beta"] = request.beta.dict()
    
    if save_nanobanana_config(current):
        return current
    raise HTTPException(status_code=500, detail="Failed to save configuration")

@app.post("/api/nanobanana/promote")
async def promote_nanobanana_config(user: User = Depends(get_current_user)):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Forbidden: Admin access required")
    
    current = load_nanobanana_config()
    current["production"] = current["beta"].copy()
    
    if save_nanobanana_config(current):
        return current
    raise HTTPException(status_code=500, detail="Failed to promote configuration")


@app.get("/api/health")
async def health_check():
    return {"status": "ok"}

@app.get("/api/download")
async def proxy_download_image(url: str, format: str = "png"):
    from fastapi.responses import Response
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(url, timeout=30.0)
            resp.raise_for_status()
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to fetch image: {str(e)}")
            
        try:
            img = Image.open(io.BytesIO(resp.content))
            
            output = io.BytesIO()
            if format.lower() == "tiff":
                # Convert to RGB if necessary (TIFF supports RGBA but sometimes fails with specific palettes)
                if img.mode not in ('L', 'RGB', 'RGBA', 'CMYK'):
                    img = img.convert('RGBA')
                img.save(output, format="TIFF", compression="tiff_deflate")
                media_type = "image/tiff"
                filename = f"genfy_{int(time.time())}.tiff"
            elif format.lower() in ["jpg", "jpeg"]:
                if img.mode in ("RGBA", "P"):
                    img = img.convert("RGB")
                img.save(output, format="JPEG", quality=100, subsampling=0)
                media_type = "image/jpeg"
                filename = f"genfy_{int(time.time())}.jpg"
            else:
                # Default format is PNG
                img.save(output, format="PNG")
                media_type = "image/png"
                filename = f"genfy_{int(time.time())}.png"
                
            output.seek(0)
            return Response(
                content=output.getvalue(),
                media_type=media_type,
                headers={"Content-Disposition": f'attachment; filename="{filename}"'}
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to process image: {str(e)}")

# ═══════════════════════════════════════════════════════════════════════════════
# CREATIVE SUITE API — Image Tool Surface
# These endpoints provide the complete API surface for the Creative Suite shell
# to render the Image Tool UI and call tool translations server-side.
# ═══════════════════════════════════════════════════════════════════════════════

# ── GET /api/styles — All style categories, ratios, qualities, models ────────

SUITE_STYLE_CATEGORIES = {
    "style": [
        {"id": "photorealistic", "label": "Photorealistic", "desc": "Real-world photographic quality", "prompt": "photorealistic, ultra realistic, highly detailed textures, natural lighting", "gradient": ["#8BA8C0", "#C9A96E", "#6B8E7F"], "thumbnail": "/previews/Photorealistic.jpg"},
        {"id": "cinematic", "label": "Cinematic", "desc": "Film-style dramatic visuals", "prompt": "cinematic style, dramatic lighting, film still, high contrast, movie quality", "gradient": ["#0D0D1A", "#E94560", "#533483"], "thumbnail": "/previews/Cinematic.jpg"},
        {"id": "anime", "label": "Anime", "desc": "Japanese animation style", "prompt": "anime style, cel shading, vibrant colors, clean outlines", "gradient": ["#FFB7C5", "#87CEEB", "#DDA0DD"], "thumbnail": "/previews/Anime.jpg"},
        {"id": "oil-paint", "label": "Oil Painting", "desc": "Classic painterly look", "prompt": "oil painting, visible brush strokes, rich textures, classical art style", "gradient": ["#8B4513", "#D2691E", "#A0522D"], "thumbnail": "/previews/Oilpainting.jpg"},
        {"id": "watercolor", "label": "Watercolor", "desc": "Soft blended paint", "prompt": "watercolor painting, soft edges, translucent colors, artistic wash", "gradient": ["#B5EAD7", "#FFDAC1", "#C7CEEA"], "thumbnail": "/previews/Watercolor.jpg"},
        {"id": "concept-art", "label": "Concept Art", "desc": "Detailed creative illustration", "prompt": "concept art, highly detailed, digital painting, production design style", "gradient": ["#1C1C4E", "#C05C7E", "#F3826F"], "thumbnail": "/previews/Conceptart.jpg"},
        {"id": "3d-render", "label": "3D Render", "desc": "CGI generated look", "prompt": "3D render, octane render, global illumination, volumetric lighting", "gradient": ["#1A1A2E", "#16213E", "#4FC3F7"], "thumbnail": "/previews/3drender.jpg"},
        {"id": "minimalist", "label": "Minimalist", "desc": "Clean and simple composition", "prompt": "minimalist, clean composition, simple forms, lots of negative space", "gradient": ["#E8E8E3", "#D4D4CF", "#BFBFBA"], "thumbnail": "/previews/Minimalist.jpg"},
    ],
    "medium": [
        {"id": "digital", "label": "Digital Art", "desc": "Modern digital painting", "prompt": "digital art, smooth shading, modern illustration", "gradient": ["#1A0533", "#6C3483", "#D2B4DE"], "thumbnail": "/previews/Digitalart.jpg"},
        {"id": "photography", "label": "Photography", "desc": "Captured via camera", "prompt": "professional photography, realistic lighting, high dynamic range", "gradient": ["#2C3E50", "#7F8C8D", "#ECF0F1"], "thumbnail": "/previews/Photography.jpg"},
        {"id": "charcoal", "label": "Charcoal", "desc": "Dark textured strokes", "prompt": "charcoal drawing, rough texture, high contrast shading", "gradient": ["#1C1C1C", "#404040", "#808080"], "thumbnail": "/previews/Charcoal.jpg"},
        {"id": "ink", "label": "Ink Drawing", "desc": "Line-based art", "prompt": "ink drawing, black lines, detailed linework, high contrast", "gradient": ["#0D0D0D", "#1A1A1A", "#F5F5F0"], "thumbnail": "/previews/Inkdrawing.jpg"},
        {"id": "acrylic", "label": "Acrylic", "desc": "Bold opaque paint", "prompt": "acrylic painting, bold colors, thick paint texture", "gradient": ["#FF6B6B", "#FFE66D", "#4ECDC4"], "thumbnail": "/previews/Acrylic.jpg"},
        {"id": "collage", "label": "Mixed Media", "desc": "Layered textures", "prompt": "mixed media collage, layered textures, experimental composition", "gradient": ["#E74C3C", "#F39C12", "#2ECC71"], "thumbnail": "/previews/Mixedmedia.jpg"},
    ],
    "lighting": [
        {"id": "natural", "label": "Natural", "desc": "Soft daylight", "prompt": "natural lighting, soft diffused daylight, no harsh shadows, even illumination", "gradient": ["#E8F5E9", "#A5D6A7", "#66BB6A"], "thumbnail": "/previews/Natural.jpg"},
        {"id": "golden", "label": "Golden Hour", "desc": "Warm sunlight", "prompt": "golden hour lighting, warm sunlight, soft shadows, sunset glow", "gradient": ["#FF8C42", "#FF5D01", "#FFBA08"], "thumbnail": "/previews/Goldenhour.jpg"},
        {"id": "blue-hour", "label": "Blue Hour", "desc": "Cool twilight", "prompt": "blue hour lighting, cool tones, soft ambient light", "gradient": ["#0D3349", "#1B6CA8", "#89C4F4"], "thumbnail": "/previews/Bluehour.jpg"},
        {"id": "studio", "label": "Studio", "desc": "Controlled lighting", "prompt": "studio lighting, softbox lighting, evenly lit subject", "gradient": ["#F0F0F0", "#D0D0D0", "#B0B0B0"], "thumbnail": "/previews/Studio.jpg"},
        {"id": "dramatic", "label": "Dramatic", "desc": "High contrast", "prompt": "dramatic lighting, deep shadows, strong highlights", "gradient": ["#0A0A0A", "#1C1C1C", "#8B0000"], "thumbnail": "/previews/Dramatic.jpg"},
        {"id": "neon", "label": "Neon", "desc": "Colorful artificial light", "prompt": "neon lighting, glowing lights, vibrant colors, cyberpunk glow", "gradient": ["#FF00FF", "#00FFFF", "#0A0A2E"], "thumbnail": "/previews/Neon.jpg"},
        {"id": "volumetric", "label": "Volumetric", "desc": "Light rays", "prompt": "volumetric lighting, god rays, fog, light beams", "gradient": ["#FFF8E1", "#F3E5AB", "#C5A028"], "thumbnail": "/previews/Volumetric.jpg"},
        {"id": "moonlight", "label": "Moonlight", "desc": "Night lighting", "prompt": "moonlight, cool blue tones, soft shadows", "gradient": ["#1C2951", "#2E4A7A", "#C8D8F0"], "thumbnail": "/previews/Moonlight.jpg"},
        {"id": "candlelight", "label": "Candlelight", "desc": "Warm soft glow", "prompt": "candlelight, warm glow, soft flickering light", "gradient": ["#FF6600", "#FF9900", "#FFCC00"], "thumbnail": "/previews/Candlelight.jpg"},
    ],
    "composition": [
        {"id": "centered", "label": "Centered", "desc": "Symmetrical framing", "prompt": "centered composition, symmetrical framing", "gradient": ["#2C3E50", "#3498DB", "#ECF0F1"], "thumbnail": "/previews/Centred.jpg"},
        {"id": "rule-thirds", "label": "Rule of Thirds", "desc": "Off-center balance", "prompt": "rule of thirds composition, balanced framing", "gradient": ["#1A472A", "#2D6A4F", "#74C69D"], "thumbnail": "/previews/Ruleofthirds.jpg"},
        {"id": "flat-lay", "label": "Flat Lay", "desc": "Top-down arrangement", "prompt": "flat lay, top down view", "gradient": ["#F8F0E3", "#E8D5B7", "#CBBAA0"], "thumbnail": "/previews/Flatlay.jpg"},
        {"id": "panoramic", "label": "Panoramic", "desc": "Ultra-wide landscape", "prompt": "panoramic composition, ultra wide view", "gradient": ["#0077B6", "#00B4D8", "#90E0EF"], "thumbnail": "/previews/Panoramic.jpg"},
    ],
    "camera": [
        {"id": "worms-eye", "label": "Worm's Eye View", "desc": "Looking straight up", "prompt": "worm's eye view, extreme low angle, looking up perspective", "gradient": ["#0A0A1A", "#1E1E3E", "#4040A0"], "thumbnail": "/previews/Wormseyeview.jpg"},
        {"id": "dutch", "label": "Dutch Angle", "desc": "Tilted dramatic frame", "prompt": "dutch angle, tilted frame, dynamic composition", "gradient": ["#1A0A0A", "#3E1E1E", "#A04040"], "thumbnail": "/previews/Dutchangle.jpg"},
        {"id": "birds-eye", "label": "Bird's Eye", "desc": "Looking down from above", "prompt": "bird's eye view, top down perspective", "gradient": ["#0A1A0A", "#1E3E1E", "#40A040"], "thumbnail": "/previews/Birdseye.jpg"},
        {"id": "extreme-cu", "label": "Extreme Close-Up", "desc": "Macro extreme detail", "prompt": "extreme close-up, macro detail, highly detailed subject", "gradient": ["#1A1A0A", "#3E3E1E", "#A0A040"], "thumbnail": "/previews/Extremecloseup.jpg"},
        {"id": "wide-shot", "label": "Wide Shot", "desc": "Full environment view", "prompt": "wide shot, full scene view, environmental composition", "gradient": ["#0A1A1A", "#1E3E3E", "#40A0A0"], "thumbnail": "/previews/Wideshot.jpg"},
        {"id": "medium-shot", "label": "Medium Shot", "desc": "Waist-up portrait", "prompt": "medium shot, waist-up framing", "gradient": ["#1A0A1A", "#3E1E3E", "#A04040"], "thumbnail": "/previews/Mediumshot.jpg"},
        {"id": "close-up", "label": "Close-Up", "desc": "Face or detail fill", "prompt": "close-up shot, detailed subject focus", "gradient": ["#1A0A08", "#3E2018", "#C06040"], "thumbnail": "/previews/Closeup.jpg"},
        {"id": "low-angle", "label": "Low Angle", "desc": "Looking up, heroic", "prompt": "low angle shot, looking up, dramatic perspective", "gradient": ["#080A1A", "#18203E", "#4060C0"], "thumbnail": "/previews/Lowangle.jpg"},
    ],
    "lens": [
        {"id": "24mm", "label": "24mm Wide", "desc": "Broad environmental", "prompt": "24mm wide lens, wide perspective, environmental depth", "gradient": ["#1A2A1A", "#2A4A2A", "#4A8A4A"], "thumbnail": "/previews/24mmwideperspective.jpg"},
        {"id": "50mm", "label": "50mm Normal", "desc": "Natural eye perspective", "prompt": "50mm lens, natural perspective", "gradient": ["#2A1A1A", "#4A2A2A", "#8A4A8A"], "thumbnail": "/previews/50mmnaturalview.jpg"},
        {"id": "85mm", "label": "85mm Portrait", "desc": "Flattering compression", "prompt": "85mm lens, portrait compression, shallow depth of field", "gradient": ["#1A1A2A", "#2A2A4A", "#4A4A8A"], "thumbnail": "/previews/85mmportraitcompression.jpg"},
        {"id": "135mm", "label": "135mm Telephoto", "desc": "Subject separation", "prompt": "135mm telephoto lens, strong subject isolation", "gradient": ["#2A1A2A", "#4A2A4A", "#8A4A8A"], "thumbnail": "/previews/135mmtelephotoisolation.jpg"},
        {"id": "macro", "label": "Macro", "desc": "Extreme close detail", "prompt": "macro photography, extreme close-up, shallow depth of field, fine details", "gradient": ["#1A2A2A", "#2A4A4A", "#4A8A8A"], "thumbnail": "/previews/Macroextremedetail.jpg"},
        {"id": "fisheye", "label": "Fisheye", "desc": "Distorted 180° view", "prompt": "fisheye lens, ultra wide distortion, curved perspective", "gradient": ["#2A2A1A", "#4A4A2A", "#8A8A4A"], "thumbnail": "/previews/Fisheyecurveddistortion.jpg"},
    ],
    "mood": [
        {"id": "serene", "label": "Serene", "desc": "Calm and peaceful", "prompt": "serene atmosphere, calm, peaceful", "gradient": ["#AED6F1", "#D6EAF8", "#EBF5FB"], "thumbnail": "/previews/Serene.jpg"},
        {"id": "dramatic-mood", "label": "Dramatic", "desc": "Intense and powerful", "prompt": "dramatic mood, intense, powerful", "gradient": ["#17202A", "#922B21", "#E74C3C"], "thumbnail": "/previews/Dramatic Intense.jpg"},
        {"id": "ethereal", "label": "Ethereal", "desc": "Dreamy, otherworldly", "prompt": "ethereal, dreamy, soft glow, otherworldly", "gradient": ["#D7BDE2", "#E8DAEF", "#FDFEFE"], "thumbnail": "/previews/Ethereal.jpg"},
        {"id": "mysterious", "label": "Mysterious", "desc": "Dark and intriguing", "prompt": "mysterious atmosphere, dark, cinematic shadows", "gradient": ["#0B0C10", "#1F2833", "#45A29E"], "thumbnail": "/previews/Mysterious.jpg"},
        {"id": "melancholic", "label": "Melancholic", "desc": "Introspective, foggy", "prompt": "melancholic mood, foggy, muted tones", "gradient": ["#5D6D7E", "#85929E", "#BFC9CA"], "thumbnail": "/previews/Melancholic.jpg"},
        {"id": "futuristic", "label": "Futuristic", "desc": "Tech neon cyberpunk", "prompt": "futuristic, cyberpunk, advanced technology", "gradient": ["#00FFFF", "#FF00FF", "#0A0A2E"], "thumbnail": "/previews/Futuristic.jpg"},
        {"id": "romantic", "label": "Romantic", "desc": "Soft warm tender", "prompt": "romantic mood, soft lighting, warm tones", "gradient": ["#FADBD8", "#F1948A", "#E74C3C"], "thumbnail": "/previews/Romantic.jpg"},
        {"id": "epic", "label": "Epic", "desc": "Grand awe-inspiring", "prompt": "epic scale, grand, cinematic, awe-inspiring", "gradient": ["#1A1A2E", "#C0392B", "#F39C12"], "thumbnail": "/previews/Epic.jpg"},
    ],
    "color": [
        {"id": "vibrant", "label": "Vibrant", "desc": "Bold saturated energy", "prompt": "vibrant colors, highly saturated", "gradient": ["#FF0055", "#00CCFF", "#FFFF00"], "thumbnail": "/previews/Vibrant.jpg"},
        {"id": "muted", "label": "Muted", "desc": "Desaturated film tones", "prompt": "muted colors, desaturated tones", "gradient": ["#9E9E9E", "#BDBDBD", "#757575"], "thumbnail": "/previews/Muted.jpg"},
        {"id": "pastel", "label": "Pastel", "desc": "Soft dreamy palette", "prompt": "pastel colors, soft tones", "gradient": ["#FFCCCC", "#CCFFCC", "#CCCCFF"], "thumbnail": "/previews/Pastel.jpg"},
        {"id": "monochrome", "label": "Monochrome", "desc": "Black white and grey", "prompt": "monochrome, black and white", "gradient": ["#000000", "#888888", "#FFFFFF"], "thumbnail": "/previews/Monochrome.jpg"},
        {"id": "earth", "label": "Earth Tones", "desc": "Browns terracottas", "prompt": "earth tones, natural colors, browns and greens", "gradient": ["#8B4513", "#556B2F", "#D2B48C"], "thumbnail": "/previews/Earthtones.jpg"},
        {"id": "neon-cyber", "label": "Neon/Cyber", "desc": "Electric on dark", "prompt": "neon cyberpunk colors, glowing accents", "gradient": ["#FF00FF", "#00FFFF", "#0D0D0D"], "thumbnail": "/previews/Neoncyber.jpg"},
        {"id": "warm", "label": "Warm Tones", "desc": "Oranges reds golds", "prompt": "warm color palette, reds, oranges, golden hues", "gradient": ["#FF6B35", "#FF8C42", "#FFC857"], "thumbnail": "/previews/Warm.jpg"},
        {"id": "cool", "label": "Cool Tones", "desc": "Blues cyans purples", "prompt": "cool color palette, blues, cyans, purples", "gradient": ["#0077B6", "#00B4D8", "#90E0EF"], "thumbnail": "/previews/Cool.jpg"},
    ],
    "camera_body": [
        {"id": "hasselblad", "label": "Hasselblad H6D", "desc": "100MP medium format", "prompt": "shot on Hasselblad H6D-100c medium format, Carl Zeiss Otus 100mm f/2.2 lens, ISO 64, 16-bit color depth", "gradient": ["#1A1A2E", "#4A4A6A", "#8A8AAA"], "thumbnail": "/previews/Hasselblad.jpg"},
        {"id": "phase-one", "label": "Phase One IQ4", "desc": "150MP ultra detail", "prompt": "shot on Phase One IQ4 150MP, Schneider Kreuznach 80mm f/2.8 LS lens, ISO 50, extreme resolving power", "gradient": ["#0D0D1A", "#2D2D4A", "#6D6D8A"], "thumbnail": "/previews/PhaseOne.jpg"},
        {"id": "canon-r5", "label": "Canon EOS R5", "desc": "45MP full frame", "prompt": "shot on Canon EOS R5, Canon RF 85mm f/1.2L USM lens, ISO 100, dual pixel CMOS AF", "gradient": ["#1A0A0A", "#8B0000", "#CC3333"], "thumbnail": "/previews/CanonR5.jpg"},
        {"id": "sony-a7rv", "label": "Sony A7R V", "desc": "61MP full frame", "prompt": "shot on Sony A7R V, Sony FE 85mm f/1.4 GM lens, ISO 100, high dynamic range", "gradient": ["#0A0A1A", "#1A1A3A", "#F5A623"], "thumbnail": "/previews/SonyA7RV.jpg"},
        {"id": "leica-m11", "label": "Leica M11", "desc": "60MP rangefinder", "prompt": "shot on Leica M11, Leica Summilux-M 50mm f/1.4 ASPH lens, ISO 64, Leica color science", "gradient": ["#1A1A1A", "#CC0000", "#E8E8E8"], "thumbnail": "/previews/LeicaM11.jpg"},
        {"id": "fuji-gfx", "label": "Fujifilm GFX 100S", "desc": "102MP medium format", "prompt": "shot on Fujifilm GFX 100S, Fujinon GF 110mm f/2 R LM WR lens, ISO 100, Fujifilm color science", "gradient": ["#0A1A0A", "#1A3A1A", "#4A8A4A"], "thumbnail": "/previews/FujiGFX.jpg"},
        {"id": "nikon-z9", "label": "Nikon Z9", "desc": "45.7MP full frame", "prompt": "shot on Nikon Z9, Nikkor Z 85mm f/1.2 S lens, ISO 64, EXPEED 7 processing", "gradient": ["#1A1A0A", "#3A3A1A", "#F5D623"], "thumbnail": "/previews/NikonZ9.jpg"},
    ],
}

SUITE_RATIOS = [
    {"id": "1:1",  "label": "Square",      "prompt": "square 1:1 aspect ratio"},
    {"id": "16:9", "label": "Landscape",    "prompt": "landscape 16:9 widescreen aspect ratio"},
    {"id": "9:16", "label": "Portrait",     "prompt": "portrait 9:16 vertical aspect ratio"},
    {"id": "4:5",  "label": "Social",       "prompt": "social media 4:5 aspect ratio"},
    {"id": "3:2",  "label": "Photo Print",  "prompt": "photo print 3:2 aspect ratio"},
    {"id": "2:3",  "label": "Poster",       "prompt": "poster 2:3 vertical aspect ratio"},
    {"id": "4:3",  "label": "Standard TV",  "prompt": "standard 4:3 aspect ratio"},
    {"id": "3:4",  "label": "Vertical",     "prompt": "vertical 3:4 aspect ratio"},
    {"id": "5:4",  "label": "Classic",      "prompt": "classic 5:4 aspect ratio"},
    {"id": "4:1",  "label": "Wide Banner",  "prompt": "wide banner 4:1 aspect ratio"},
    {"id": "1:4",  "label": "Tall Banner",  "prompt": "tall banner 1:4 aspect ratio"},
    {"id": "8:1",  "label": "Panoramic",    "prompt": "panoramic 8:1 aspect ratio"},
    {"id": "1:8",  "label": "Ultra Tall",   "prompt": "ultra-tall 1:8 aspect ratio"},
    {"id": "21:9", "label": "Cinematic",    "prompt": "cinematic ultrawide 21:9 aspect ratio"},
]

SUITE_QUALITIES = [
    {"id": "Standard", "label": "Standard", "resolution": "1K", "desc": "Fast · 1024px"},
    {"id": "High",     "label": "High",     "resolution": "2K", "desc": "Balanced · 2048px"},
    {"id": "Ultra",    "label": "Ultra",    "resolution": "4K", "desc": "Max detail · 4096px"},
]

SUITE_MODELS = [
    {"id": "Nanobanana 2",   "integrated": True,  "coming_soon": False},
    {"id": "Nanobanana Pro", "integrated": True,  "coming_soon": False},
    {"id": "ChatGPT",        "integrated": True,  "coming_soon": False, "sub_models": [
        {"id": "gpt-image-2",        "label": "GPT Image 2",         "desc": "State-of-the-art"},
        {"id": "gpt-image-1.5",      "label": "GPT Image 1.5",       "desc": "Previous flagship"},
        {"id": "chatgpt-image-latest","label": "ChatGPT Image Latest","desc": "Latest default"},
        {"id": "gpt-image-1",        "label": "GPT Image 1",         "desc": "Previous generation"},
        {"id": "gpt-image-1-mini",   "label": "GPT Image 1 Mini",    "desc": "Cost-efficient"},
    ]},
    {"id": "Kling",           "integrated": True,  "coming_soon": False},
    {"id": "Flux.1",          "integrated": True,  "coming_soon": False},
    {"id": "Midjourney",      "integrated": False, "coming_soon": True},
    {"id": "Stable Diffusion","integrated": False, "coming_soon": True},
    {"id": "Grok-2",          "integrated": False, "coming_soon": True},
]

SUITE_EDIT_TOOLS = [
    {"id": "relight",       "label": "Relight",       "icon": "sun",   "endpoint": "/api/tools/relight/translate"},
    {"id": "skin_enhancer", "label": "Skin Enhancer",  "icon": "crown", "endpoint": "/api/tools/skin-enhancer/translate"},
    {"id": "camera_angle",  "label": "Camera Angle",   "icon": "camera","endpoint": "/api/tools/camera/translate"},
]

SUITE_RELIGHT_PRESETS = [
    {"id": "original", "label": "Original Image Light (Match)", "hex": "#e2e8f0"},
    {"id": "white",    "label": "Neutral Studio",               "hex": "#ffffff"},
    {"id": "golden",   "label": "Golden Hour",                  "hex": "#ffaa33"},
    {"id": "sunset",   "label": "Warm Sunset",                  "hex": "#ff5522"},
    {"id": "cyan",     "label": "Cool Cinematic",               "hex": "#22ccff"},
    {"id": "neon",     "label": "Cyberpunk Neon",               "hex": "#ff22aa"},
]


@app.get("/api/styles")
async def get_styles():
    """Return all style categories, ratios, qualities, models, and edit tools.
    
    Used by the Creative Suite shell to render the Image Tool UI.
    No authentication required — this is static configuration data.
    """
    return {
        "categories": SUITE_STYLE_CATEGORIES,
        "ratios": SUITE_RATIOS,
        "qualities": SUITE_QUALITIES,
        "models": SUITE_MODELS,
        "edit_tools": SUITE_EDIT_TOOLS,
        "relight_presets": SUITE_RELIGHT_PRESETS,
    }


# ── POST /api/tools/relight/translate — Server-side relight prompt builder ───

class RelightTranslateRequest(BaseModel):
    rotate: float = 0      # -180 to 180 (horizontal orbit)
    elevation: float = 0   # -90 to 90 (vertical orbit)
    color_hex: str = "#ffffff"  # Light color hex

RELIGHT_COLOR_MAP = {
    "#e2e8f0": {"id": "original", "neutral": "the existing natural image lighting and ambient atmosphere"},
    "#ffffff": {"id": "white",    "neutral": "clean neutral white"},
    "#ffaa33": {"id": "golden",   "neutral": "warm golden-amber"},
    "#ff5522": {"id": "sunset",   "neutral": "warm orange-red"},
    "#22ccff": {"id": "cyan",     "neutral": "cool cyan-blue"},
    "#ff22aa": {"id": "neon",     "neutral": "vivid magenta-pink"},
}

def _fused_direction(rotate: float, elevation: float) -> str:
    """Produce a single crisp direction phrase from rotate + elevation angles."""
    high   = elevation > 25
    low    = elevation < -15
    vlow   = elevation < -45
    vhigh  = elevation > 60
    right  = rotate > 45 and rotate <= 150
    left   = rotate < -45 and rotate >= -150
    behind = rotate > 150 or rotate < -150

    if vhigh and behind: return "from directly above and behind the subject"
    if vhigh and right:  return "from steeply above on the right"
    if vhigh and left:   return "from steeply above on the left"
    if vhigh:            return "from directly overhead"
    if high and right:   return "from the upper-right"
    if high and left:    return "from the upper-left"
    if high and behind:  return "from above and behind the subject, creating rim light"
    if high:             return "from a high angle directly in front"
    if vlow and right:   return "from below on the right side"
    if vlow and left:    return "from below on the left side"
    if vlow:             return "from directly below the subject"
    if low and right:    return "from a low angle on the right"
    if low and left:     return "from a low angle on the left"
    if behind:           return "from directly behind the subject, creating strong rim light"
    if right:            return "from the right side"
    if left:             return "from the left side"
    if rotate > 10:      return "slightly off-center from the right"
    if rotate < -10:     return "slightly off-center from the left"
    return "from directly in front of the subject"


@app.post("/api/tools/relight/translate")
async def translate_relight(request: RelightTranslateRequest):
    """Translate relight UI controls (angle + color) into a text edit instruction.
    
    Returns the exact prompt string that should be passed as `edit_prompt`
    to the `/api/sessions/{id}/images/{img}/edit` endpoint.
    """
    direction = _fused_direction(request.rotate, request.elevation)
    color_info = RELIGHT_COLOR_MAP.get(request.color_hex.lower())

    if color_info and color_info["id"] == "original":
        instruction = (
            f"Relight scene by shifting the primary key light source to be {direction}. "
            f"Reposition main light rays, subject highlights, and cast shadows to match "
            f"this new directional light position, showing updated surface illumination while preserving "
            f"{color_info['neutral']}, color tone, subject identity, facial features, clothing, and core product details."
        )
    else:
        descriptor = color_info["neutral"] if color_info else request.color_hex
        instruction = (
            f"Add a {descriptor} light source to the scene, {direction}. "
            f"Illuminate surfaces facing this new light and cast natural shadows on surfaces facing away from it, "
            f"showing realistic directional highlights, rim light, and reflections. Do not apply a color wash across "
            f"the entire image. Preserve exact subject identity, facial features, clothing, and core product details."
        )

    return {"instruction": instruction, "direction": direction, "color_id": color_info["id"] if color_info else "custom"}


# ── POST /api/tools/skin-enhancer/translate ──────────────────────────────────

class SkinEnhancerTranslateRequest(BaseModel):
    version: str = "Flexible"       # Faithful | Creative | Flexible
    optimize_for: str = "Enhance skin"  # Enhance skin | Enhance everything | Improve light | Transform to real | No makeup
    sharpen: int = 0                # 0-100
    smart_grain: int = 13           # 0-100

SKIN_VERSION_MAP = {
    "Faithful": "subtly refine skin while faithfully preserving natural features, pores, and individuality",
    "Creative": "creatively enhance skin with elevated luminosity and a polished editorial finish",
    "Flexible": "improve skin in a balanced way — cleaner than natural, less polished than commercial",
}

SKIN_OPTIMIZE_MAP = {
    "Enhance skin":       "focus on skin texture refinement: reduce blemishes, even out tone, improve pore quality and surface smoothness while retaining realistic texture",
    "Enhance everything": "improve all facial features: skin clarity, eye definition, lip detail, hair strand separation, and overall face sharpness",
    "Improve light":      "improve skin luminosity — add healthy subsurface glow, correct dull or flat areas, and enhance how light falls across the skin",
    "Transform to real":  "make skin look authentically real: remove any plastic or AI-generated smoothness, restore natural pore texture, micro-imperfections, and genuine human skin variation",
    "No makeup":          "produce a clean natural no-makeup look: even skin tone without cosmetic sheen, reduce redness and blotchiness, retain all natural skin texture and individual character",
}

@app.post("/api/tools/skin-enhancer/translate")
async def translate_skin_enhancer(request: SkinEnhancerTranslateRequest):
    """Translate Skin Enhancer UI controls into a text edit instruction."""
    parts = []

    parts.append(SKIN_VERSION_MAP.get(request.version, SKIN_VERSION_MAP["Flexible"]))
    parts.append(SKIN_OPTIMIZE_MAP.get(request.optimize_for, SKIN_OPTIMIZE_MAP["Enhance skin"]))

    if request.sharpen > 0:
        label = "subtle" if request.sharpen < 30 else ("moderate" if request.sharpen < 70 else "strong")
        parts.append(f"apply {label} detail sharpening to fine features (pores, lashes, iris texture) — do not over-sharpen edges or skin surface")

    if request.smart_grain > 0:
        label = "minimal" if request.smart_grain < 20 else ("light" if request.smart_grain < 50 else ("moderate" if request.smart_grain < 75 else "visible"))
        parts.append(f"add {label} natural film grain across the skin to break up any remaining digital smoothness and improve photographic realism")
    else:
        parts.append("keep skin grain-free and clean")

    parts.append("preserve subject identity, pose, clothing, background, and overall composition exactly — only improve skin and facial quality as described above")

    instruction = f"Enhance the skin and facial quality in this image: {'. '.join(parts)}."
    return {"instruction": instruction, "version": request.version, "optimize_for": request.optimize_for}


# ── POST /api/tools/camera/translate ─────────────────────────────────────────

class CameraTranslateRequest(BaseModel):
    rotate: float = 0      # -180 to 180 (horizontal orbit)
    vertical: float = 0    # -90 to 90 (vertical elevation)
    zoom: float = 5        # 1-10 (1=extreme close, 10=wide)

def _build_camera_spatial_prompt(rotate: float, vertical: float, zoom: float) -> tuple[str, str, str, str, str]:
    # Vertical (elevation)
    if vertical > 60:    vertical_part = "bird's-eye view shot"
    elif vertical > 25:  vertical_part = "high-angle shot"
    elif vertical < -60: vertical_part = "worm's-eye view shot"
    elif vertical < -25: vertical_part = "low-angle shot"
    else:                vertical_part = "eye-level shot"

    # Horizontal rotation
    if rotate > 150 or rotate < -150: rotation_part = "viewed from directly behind"
    elif rotate > 90:   rotation_part = "viewed from the right side, slightly behind"
    elif rotate > 45:   rotation_part = "viewed from the right side"
    elif rotate > 10:   rotation_part = "slightly angled from the right"
    elif rotate < -90:  rotation_part = "viewed from the left side, slightly behind"
    elif rotate < -45:  rotation_part = "viewed from the left side"
    elif rotate < -10:  rotation_part = "slightly angled from the left"
    else:               rotation_part = "straight on"

    # Zoom — higher zoom = more telephoto/magnified (zoom=10 → extreme close-up, zoom=1 → wide)
    if zoom >= 9:   zoom_part = "extreme close-up"
    elif zoom >= 7: zoom_part = "close-up"
    elif zoom <= 2: zoom_part = "wide establishing shot"
    elif zoom <= 4: zoom_part = "medium-wide shot"
    else:           zoom_part = "medium shot"

    # Spatial camera position description
    if vertical > 60:
        if rotate > 150 or rotate < -150:
            spatial = "the camera is now physically positioned directly above and behind the subject, looking down from overhead"
        elif rotate > 45:
            spatial = "the camera is now physically positioned steeply above and to the right of the subject, looking down"
        elif rotate < -45:
            spatial = "the camera is now physically positioned steeply above and to the left of the subject, looking down"
        else:
            spatial = "the camera is now physically positioned directly overhead, looking straight down"
    elif vertical > 25:
        if rotate > 150 or rotate < -150:
            spatial = "the camera is now physically positioned at a high angle behind the subject"
        elif rotate > 45:
            spatial = "the camera is now physically positioned above and to the right of the subject, looking down, so more of the top of their head, shoulders, and the right side of their face/body are visible"
        elif rotate < -45:
            spatial = "the camera is now physically positioned above and to the left of the subject, looking down, so more of the top of their head, shoulders, and the left side of their face/body are visible"
        elif rotate > 10:
            spatial = "the camera is now physically positioned at a high angle slightly to the right of the subject"
        elif rotate < -10:
            spatial = "the camera is now physically positioned at a high angle slightly to the left of the subject"
        else:
            spatial = "the camera is now physically positioned at a high angle directly in front of the subject, looking down"
    elif vertical < -60:
        if rotate > 45:
            spatial = "the camera is now physically positioned near ground level looking steeply up at the subject from the right side"
        elif rotate < -45:
            spatial = "the camera is now physically positioned near ground level looking steeply up at the subject from the left side"
        else:
            spatial = "the camera is now physically positioned near ground level looking straight up at the subject"
    elif vertical < -25:
        if rotate > 150 or rotate < -150:
            spatial = "the camera is now physically positioned at a low angle behind the subject, looking up"
        elif rotate > 45:
            spatial = "the camera is now physically positioned at a low angle to the right of the subject, looking up, emphasizing height and stature"
        elif rotate < -45:
            spatial = "the camera is now physically positioned at a low angle to the left of the subject, looking up, emphasizing height and stature"
        elif rotate > 10:
            spatial = "the camera is now physically positioned at a low angle slightly to the right of the subject, looking up"
        elif rotate < -10:
            spatial = "the camera is now physically positioned at a low angle slightly to the left of the subject, looking up"
        else:
            spatial = "the camera is now physically positioned at a low angle directly in front of the subject, looking up"
    else:
        if rotate > 150 or rotate < -150:
            spatial = "the camera is now physically positioned directly behind the subject"
        elif rotate > 90:
            spatial = "the camera is now physically positioned to the right and slightly behind the subject"
        elif rotate > 45:
            spatial = "the camera is now physically positioned to the right side of the subject"
        elif rotate > 10:
            spatial = "the camera is now physically positioned slightly angled from the right"
        elif rotate < -90:
            spatial = "the camera is now physically positioned to the left and slightly behind the subject"
        elif rotate < -45:
            spatial = "the camera is now physically positioned to the left side of the subject"
        elif rotate < -10:
            spatial = "the camera is now physically positioned slightly angled from the left"
        else:
            spatial = "the camera is now physically positioned at eye-level straight in front of the subject"

    instruction = (
        f"Change camera angle: {spatial}, captured in a {vertical_part}, {zoom_part}. "
        f"The camera has physically moved to this new position so different perspective angles of the scene and surrounding space are now revealed. "
        f"Strictly preserve the subject's facial identity, hairstyle, clothing, and product details. The subject's orientation and body pose relative to camera must update to match the new vantage point (e.g. side profile or three-quarter view)."
    )

    return instruction, spatial, vertical_part, rotation_part, zoom_part


@app.post("/api/tools/camera/translate")
async def translate_camera(request: CameraTranslateRequest):
    """Translate Camera Angle UI controls (rotate + vertical + zoom) into a text edit instruction."""
    instruction, spatial, vert_p, rot_p, zoom_p = _build_camera_spatial_prompt(
        request.rotate, request.vertical, request.zoom
    )
    return {"instruction": instruction, "parts": [vert_p, rot_p, zoom_p, spatial]}


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8005))
    uvicorn.run("main:app", host="0.0.0.0", port=port)
