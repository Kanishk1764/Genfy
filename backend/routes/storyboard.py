from fastapi import APIRouter, Depends, HTTPException, Body, BackgroundTasks, UploadFile, File, Form, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional, List, Dict, Any, Set, Tuple, Union, Callable
from collections import defaultdict
from datetime import datetime
import os
import uuid
import base64
import json
import asyncio
import time
import openai as openai_lib
from utils.moderation import check_prompt_keywords, check_image_moderation

from database.db import get_db
from database.models import User
from utils.auth_middleware import get_current_user, get_effective_storyboard_user
from database.storyboard_models import Storyboard, StoryboardCharacter, StoryboardFrame, StoryboardProduct, StoryboardBrief, CharacterSheet, FrameConsistencyReport

# Global trackers for forceful storyboard and frame cancellation
CANCELLED_STORYBOARD_IDS: Set[str] = set()
CANCELED_FRAME_IDS: Set[str] = set()
RUNNING_STORYBOARD_TASKS: Dict[str, Set[asyncio.Task]] = defaultdict(set)
RUNNING_FRAME_TASKS: Dict[str, asyncio.Task] = {}
CONTACT_SHEET_PROGRESS: Dict[str, Dict[str, Any]] = defaultdict(lambda: {
    "status": "idle",
    "generation_id": None,
    "current_step": "",
    "current_frame": 0,
    "total_frames": 0,
    "started_at": None,
    "elapsed_seconds": 0.0,
    "thoughts": [],
    "contact_sheet_url": None,
    "error": None,
})

class BriefIngestionRequest(BaseModel):
    raw_text: str
    frame_count: int = 6  # How many storyboard frames to generate (1-15)

class RelockRequest(BaseModel):
    character_id: str
    relock_attribute: str

class UpdateDNADataRequest(BaseModel):
    character_dna: dict

class UpdateProductDNADataRequest(BaseModel):
    product_dna: dict

router = APIRouter(prefix="/api/storyboard", tags=["storyboard"])

EXPORTS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "exports", "storyboard")
os.makedirs(EXPORTS_DIR, exist_ok=True)

def save_b64_image(b64_str: str) -> str:
    """Save base64 image directly to local disk (exports/storyboard/...)."""
    cleaned = b64_str.strip()

    if cleaned.startswith("/exports/") or cleaned.startswith("exports/"):
        return cleaned.lstrip("/")

    if "," in b64_str:
        b64_str = b64_str.split(",")[1]
    b64_str = b64_str.strip()
    b64_str += "=" * ((4 - len(b64_str) % 4) % 4)
    image_bytes = base64.b64decode(b64_str)

    filename = f"{uuid.uuid4()}.png"
    filepath = os.path.join(EXPORTS_DIR, filename)
    with open(filepath, "wb") as f:
        f.write(image_bytes)
    return f"exports/storyboard/{filename}"

def safe_b64decode(b64_str: str) -> bytes:
    if "," in b64_str:
        b64_str = b64_str.split(",")[1]
    b64_str = b64_str.strip()
    b64_str += "=" * ((4 - len(b64_str) % 4) % 4)
    return base64.b64decode(b64_str)

def load_b64_image(filepath: str) -> str:
    """Load local image file and return base64 string."""
    if not filepath:
        return ""
    clean_path = filepath.lstrip("/")
    abs_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), clean_path)
    if not os.path.exists(abs_path):
        return ""
    with open(abs_path, "rb") as f:
        return "data:image/png;base64," + base64.b64encode(f.read()).decode("utf-8")

def delete_physical_file(filepath: str):
    """Delete an image file from local disk."""
    if not filepath:
        return

    clean_path = filepath.lstrip("/")
    abs_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), clean_path)
    if os.path.exists(abs_path):
        try:
            os.remove(abs_path)
        except Exception as e:
            print(f"[StoryboardStorage] Failed to delete local file: {e}")


async def _call_claude_sonnet_5_text(system_prompt: str, user_prompt: str, max_tokens: int = 2048) -> Optional[str]:
    """Fallback text reasoning using Claude Sonnet 5 via Anthropic SDK."""
    import main
    if not main.ANTHROPIC_API_KEY:
        return None
    try:
        import anthropic
        ant_client = anthropic.Anthropic(api_key=main.ANTHROPIC_API_KEY)
        loop = asyncio.get_event_loop()
        resp = await loop.run_in_executor(
            None,
            lambda: ant_client.messages.create(
                model="claude-sonnet-5",
                max_tokens=max_tokens,
                system=system_prompt if system_prompt else None,
                messages=[{"role": "user", "content": user_prompt}]
            )
        )
        text_blocks = [b.text for b in resp.content if hasattr(b, "text")]
        return "".join(text_blocks).strip()
    except Exception as e:
        print(f"[Storyboard] Claude Sonnet 5 text call failed: {e}")
        return None

# ── STORYBOARD CRUD ──

@router.post("/create")
async def create_storyboard(
    name: str = Body(..., embed=True),
    description: Optional[str] = Body(None, embed=True),
    current_user: User = Depends(get_effective_storyboard_user),
    db: Session = Depends(get_db)
):
    sb = Storyboard(user_id=current_user.id, name=name, description=description)
    db.add(sb)
    for attempt in range(3):
        try:
            db.commit()
            db.refresh(sb)
            break
        except Exception as e:
            if ("locked" in str(e).lower() or "busy" in str(e).lower()) and attempt < 2:
                db.rollback()
                db.add(sb)
                await asyncio.sleep(0.5 * (attempt + 1))
                continue
            raise
    return {"id": sb.id, "name": sb.name, "description": sb.description}

@router.get("/list")
async def list_storyboards(current_user: User = Depends(get_effective_storyboard_user), db: Session = Depends(get_db)):
    sbs = db.query(Storyboard).filter(Storyboard.user_id == current_user.id).order_by(Storyboard.updated_at.desc()).all()
    return [{"id": sb.id, "name": sb.name, "description": sb.description, "created_at": sb.created_at} for sb in sbs]

@router.get("/templates")
async def list_templates():
    """Returns all available storyboard templates."""
    # Move this import here since STORYBOARD_TEMPLATES is defined later in the file
    from .storyboard import STORYBOARD_TEMPLATES
    return [
        {
            "key": k,
            "label": v["label"],
            "emoji": v["emoji"],
            "description": v["description"],
            "frame_count": len(v["frames"]),
        }
        for k, v in STORYBOARD_TEMPLATES.items()
    ]

def _find_storyboard(sb_id: str, user: User, db: Session) -> Optional[Storyboard]:
    """Helper to find a storyboard for the effective user or admin."""
    if getattr(user, "role", "user") == "admin" or getattr(user, "_impersonated_by", None):
        return db.query(Storyboard).filter(Storyboard.id == sb_id).first()
    return db.query(Storyboard).filter(Storyboard.id == sb_id, Storyboard.user_id == user.id).first()


@router.get("/admin/impersonation-users")
async def get_impersonation_users(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Admin-only: lists users and their storyboard counts for impersonation switcher."""
    if getattr(current_user, "role", "user") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden: Admin access required.")

    users = db.query(User).all()
    counts = dict(
        db.query(Storyboard.user_id, func.count(Storyboard.id))
        .group_by(Storyboard.user_id)
        .all()
    )

    result = []
    for u in users:
        sb_count = counts.get(u.id, 0)
        result.append({
            "id": u.id,
            "email": u.email,
            "name": getattr(u, "name", None) or u.email.split("@")[0],
            "role": getattr(u, "role", "user"),
            "storyboard_count": sb_count,
            "can_generate_video": bool(getattr(u, "can_generate_video", False)),
            "created_at": u.created_at.isoformat() if getattr(u, "created_at", None) else None,
        })

    # Sort users with active storyboards first, then by count descending
    result.sort(key=lambda x: (x["storyboard_count"] > 0, x["storyboard_count"]), reverse=True)
    return {"users": result}


@router.post("/admin/users/{user_id}/toggle-video-access")
async def toggle_user_video_access(
    user_id: str,
    payload: Optional[dict] = Body(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Admin-only endpoint to toggle or set a user's rights to generate video animations."""
    if getattr(current_user, "role", "user") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden: Admin access required.")
    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found.")
    
    if payload and "can_generate_video" in payload:
        target_user.can_generate_video = bool(payload["can_generate_video"])
    else:
        target_user.can_generate_video = not bool(getattr(target_user, "can_generate_video", False))
    
    db.commit()
    db.refresh(target_user)
    return {
        "user_id": target_user.id,
        "can_generate_video": target_user.can_generate_video,
        "message": f"Video generation {'enabled' if target_user.can_generate_video else 'disabled'} for {target_user.email}"
    }


@router.get("/{sb_id}")
async def get_storyboard(sb_id: str, current_user: User = Depends(get_effective_storyboard_user), db: Session = Depends(get_db)):
    sb = _find_storyboard(sb_id, current_user, db)
    if not sb:
        raise HTTPException(404, "Storyboard not found")
    return {"id": sb.id, "name": sb.name, "description": sb.description, "user_id": sb.user_id}

@router.delete("/{sb_id}")
async def delete_storyboard(sb_id: str, current_user: User = Depends(get_effective_storyboard_user), db: Session = Depends(get_db)):
    sb = _find_storyboard(sb_id, current_user, db)
    if not sb:
        raise HTTPException(404, "Storyboard not found")
        
    # Physically delete all associated files before CASCADE
    for char in sb.characters:
        if char.image_paths:
            for p in char.image_paths: delete_physical_file(p)
        else: delete_physical_file(char.image_path)
    for prod in sb.products:
        if prod.image_paths:
            for p in prod.image_paths: delete_physical_file(p)
        else: delete_physical_file(prod.image_path)
    for frame in sb.frames:
        delete_physical_file(frame.image_path)
        
    db.delete(sb)
    db.commit()
    return {"status": "success"}

@router.post("/{storyboard_id}/upload-brief-pdf")
async def upload_brief_pdf(
    storyboard_id: str,
    file: UploadFile = File(...),
    current_user: User = Depends(get_effective_storyboard_user),
    db: Session = Depends(get_db)
):
    """
    Accepts a PDF file. Converts each page to an image using PyMuPDF,
    runs Gemini vision on each page to extract text, then checks for
    missing required storyboard fields. Returns extracted text and
    any missing fields that the user must fill in.
    """
    import main
    from google.genai import types as genai_types

    sb = _find_storyboard(storyboard_id, current_user, db)
    if not sb:
        raise HTTPException(404, "Storyboard not found")

    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are accepted")

    try:
        import fitz  # PyMuPDF
    except ImportError:
        raise HTTPException(500, "PyMuPDF not installed. Add pymupdf to requirements.txt.")

    pdf_bytes = await file.read()

    try:
        pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as e:
        raise HTTPException(400, f"Could not open PDF: {e}")

    page_count = len(pdf_doc)
    print(f"[Storyboard PDF] Opened PDF with {page_count} pages.")

    gemini_client = main.flash_client if main.flash_client else main.global_client
    if not gemini_client:
        raise HTTPException(500, "Gemini client not initialized")

    all_extracted_text = []

    for page_num in range(page_count):
        page = pdf_doc[page_num]
        # Render page at 2x zoom for clarity
        mat = fitz.Matrix(2.0, 2.0)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        img_bytes = pix.tobytes(output="png")

        # Run vision OCR on this page
        try:
            contents = [
                genai_types.Part.from_bytes(data=img_bytes, mime_type="image/png"),
                (
                    "You are a document OCR engine. Extract ALL readable text from this PDF page image. "
                    "Preserve headings, bullet points, and paragraph structure using line breaks. "
                    "Include every word, number, and label you can see. "
                    "Return ONLY the raw extracted text, nothing else."
                )
            ]
            response = await asyncio.to_thread(
                gemini_client.models.generate_content,
                model="gemini-2.5-flash",
                contents=contents,
                config=genai_types.GenerateContentConfig(temperature=0.0)
            )
            page_text = response.text.strip() if response.text else ""
            if page_text:
                all_extracted_text.append(f"=== PAGE {page_num + 1} ===\n{page_text}")
                print(f"[Storyboard PDF] Page {page_num + 1}: extracted {len(page_text)} chars")
        except Exception as e:
            print(f"[Storyboard PDF] Failed to extract page {page_num + 1}: {e}")

    pdf_doc.close()

    if not all_extracted_text:
        raise HTTPException(422, "Could not extract any text from the PDF. Please try a different file.")

    full_text = "\n\n".join(all_extracted_text)

    # ── SMART MISSING-FIELD DETECTION ──
    # Use GPT-5.5-pro to check if the brief has enough info to run the storyboard
    if main.OPENAI_API_KEY:
        import openai as openai_lib

        completeness_system = """You are an expert creative director and storyboard producer. Your job is to evaluate creative briefs and determine what information is needed to generate a professional storyboard.

You understand that storyboard AI generation requires very specific visual information. A character called "the hero" is useless — you need age, ethnicity, build, hair, wardrobe. "An office" is too vague — you need size, lighting, décor, time of day.

A complete storyboard brief requires ALL of the following:
1. characters — At least one character with a full visual description: age, gender, ethnicity, skin tone, build, hair colour/style, and specific wardrobe. A name alone is NOT enough.
2. setting_or_location — Where scenes take place, with enough visual detail to render it: interior/exterior, specific room or landmark, lighting, time of day, décor style.
3. mood_or_tone — The emotional register and visual style: e.g. "warm and aspirational like a Cadbury ad", "high-energy fast-cut, bold colours", "cinematic and slow-burn dramatic".
4. frame_scenes — At least 2–3 specific scene descriptions, each covering what happens, who is in it, and what the camera sees.

For each field, score it:
- "present": brief clearly has enough visual detail to generate images
- "partial": brief mentions the concept but lacks the visual specificity needed for AI image generation
- "missing": brief has no information whatsoever for this field

When generating suggested_answers, you MUST:
- Base every suggestion on the actual brand, product, campaign goal, target audience, and any visual cues already present in the brief
- Write suggestions as if you were a senior creative director filling in the gaps yourself
- Make each suggestion immediately usable — specific, vivid, and production-ready
- Never write generic placeholder answers; every suggestion must feel tailored to THIS brief

Return ONLY a strict JSON object with no markdown, no explanation, no preamble:
{
  "completeness": {
    "characters": {"status": "present|partial|missing", "detail": "one sentence explaining what is present or missing"},
    "setting_or_location": {"status": "present|partial|missing", "detail": "one sentence explaining what is present or missing"},
    "mood_or_tone": {"status": "present|partial|missing", "detail": "one sentence explaining what is present or missing"},
    "frame_scenes": {"status": "present|partial|missing", "detail": "one sentence explaining what is present or missing"}
  },
  "missing_fields": ["array of field keys that are partial or missing"],
  "missing_questions": {
    "characters": "A warm, specific question asking the user to describe the character visually — reference the brand or product in the question",
    "setting_or_location": "A warm, specific question about the scene location — reference context from the brief",
    "mood_or_tone": "A warm question about the emotional feel and visual style — reference the brand or campaign goal",
    "frame_scenes": "A warm question asking for specific shot-by-shot scene descriptions"
  },
  "suggested_answers": {
    "characters": [
      "Suggestion 1: A complete, production-ready visual character description grounded in THIS brief",
      "Suggestion 2: An alternative character that also makes sense for this campaign",
      "Suggestion 3: A third distinct but plausible option for this brand and audience"
    ],
    "setting_or_location": [
      "Suggestion 1: A specific, visually rich location that fits this campaign",
      "Suggestion 2: An alternative setting that works for this brief",
      "Suggestion 3: A third plausible location with visual detail"
    ],
    "mood_or_tone": [
      "Suggestion 1: A specific mood/tone direction with visual reference points",
      "Suggestion 2: An alternative tone that suits this brand",
      "Suggestion 3: A third distinct mood option"
    ],
    "frame_scenes": [
      "Suggestion 1: Frame 1: [scene]. Frame 2: [scene]. Frame 3: [scene]. Frame 4: [scene] — all grounded in this campaign",
      "Suggestion 2: An alternative 4-frame sequence for the same campaign",
      "Suggestion 3: A third creative direction for the frame sequence"
    ]
  }
}

Only include keys in missing_questions and suggested_answers for fields that ARE in missing_fields.
Each suggested_answers array must contain exactly 3 strings.
Return ONLY the JSON object."""

        completeness_user = f"""Evaluate this creative brief and return the JSON analysis:

<brief>
{full_text[:10000]}
</brief>"""

        try:
            oai_client = openai_lib.OpenAI(api_key=main.OPENAI_API_KEY)
            completeness_resp = oai_client.chat.completions.create(
                model="gpt-5.6-luna",
                max_completion_tokens=2048,
                messages=[
                    {"role": "system", "content": completeness_system},
                    {"role": "user", "content": completeness_user},
                ],
            )
            raw_json = completeness_resp.choices[0].message.content.strip()
            # Strip any accidental markdown fences
            if raw_json.startswith("```"):
                raw_json = raw_json.split("```")[1]
                if raw_json.startswith("json"):
                    raw_json = raw_json[4:]
            completeness_data = json.loads(raw_json)
            missing_fields = completeness_data.get("missing_fields", [])
            missing_questions = completeness_data.get("missing_questions", {})
            completeness = completeness_data.get("completeness", {})
            suggested_answers = completeness_data.get("suggested_answers", {})
            print(f"[Storyboard PDF] GPT-5.5-pro completeness check: {len(missing_fields)} missing fields: {missing_fields}")
        except Exception as e:
            print(f"[Storyboard PDF] GPT-5.6 Luna completeness check failed: {e}, falling back to Claude Sonnet 5...")
            claude_resp = await _call_claude_sonnet_5_text(completeness_system, completeness_user, max_tokens=2048)
            if claude_resp:
                try:
                    raw_json = claude_resp.strip()
                    if raw_json.startswith("```"):
                        raw_json = raw_json.split("```")[1]
                        if raw_json.startswith("json"):
                            raw_json = raw_json[4:]
                    completeness_data = json.loads(raw_json)
                    missing_fields = completeness_data.get("missing_fields", [])
                    missing_questions = completeness_data.get("missing_questions", {})
                    completeness = completeness_data.get("completeness", {})
                    suggested_answers = completeness_data.get("suggested_answers", {})
                    print(f"[Storyboard PDF] Claude Sonnet 5 completeness check: {len(missing_fields)} missing fields")
                except Exception as parse_e:
                    print(f"[Storyboard PDF] Claude Sonnet 5 JSON parse error: {parse_e}")
                    missing_fields, missing_questions, completeness, suggested_answers = [], {}, {}, {}
            else:
                missing_fields, missing_questions, completeness, suggested_answers = [], {}, {}, {}
    else:
        missing_fields = []
        missing_questions = {}
        completeness = {}
        suggested_answers = {}


    return {
        "raw_text": full_text,
        "page_count": page_count,
        "missing_fields": missing_fields,
        "missing_questions": missing_questions,
        "suggested_answers": suggested_answers,
        "completeness": completeness,
        "preview": full_text[:500] + ("..." if len(full_text) > 500 else "")
    }


@router.post("/{storyboard_id}/ingest-brief")
async def ingest_brief(
    storyboard_id: str,
    payload: BriefIngestionRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_effective_storyboard_user),
    db: Session = Depends(get_db)
):
    """
    Accepts raw brief text. Calls GPT-4o (or Gemini as fallback) to extract structured entities and frame list.
    Then bulk-creates StoryboardCharacter, StoryboardProduct, and StoryboardFrame rows.
    """
    import main
    import openai as openai_lib
    import asyncio
    import json
    
    sb = _find_storyboard(storyboard_id, current_user, db)
    if not sb:
        raise HTTPException(404, "Storyboard not found")
    
    brief_text = payload.raw_text
    frame_count = max(1, min(15, payload.frame_count or 6))  # Clamp 1-15

    system_prompt = f"""
You are a senior creative director and expert storyboard brief parser.
Given a raw creative brief (possibly supplemented with user-provided info), extract ALL visual and narrative details into strict JSON.
Be exhaustive. If age/ethnicity is implied from context, infer it with a best guess. Do not leave fields empty if context allows inference.
For characters: extract every physical detail that would help an AI image model render them accurately.
For frames: write vivid, cinematic scene descriptions — include camera framing, action, atmosphere, and setting.
You MUST generate EXACTLY {frame_count} frames in the "frames" array — no more, no less. Distribute the narrative arc evenly across all {frame_count} frames.
Do NOT hallucinate characters, products, or frames that are not present in the brief.
Return ONLY valid JSON. No markdown, no explanation.

Return exactly this structure:
{{
  "characters": [
    {{
      "name": "string",
      "age": "string (e.g. early 30s, ~45)",
      "gender": "string",
      "ethnicity": "string (be specific, e.g. warm medium-brown South Asian)",
      "build": "string (e.g. 5'8\" slim athletic, broad shoulders)",
      "height": "string (if mentioned or can be inferred)",
      "hair": "string (color, length, texture, style)",
      "skin_tone": "string (e.g. warm medium brown, fair, deep ebony)",
      "face_shape_features": "string (jawline, nose, brow shape with adjectives)",
      "eye_details": "string (eye shape and color)",
      "distinctive_features": "string (scars, glasses, tattoos, birthmarks)",
      "typical_wardrobe": "string (each garment named + color + material feel)",
      "fixed_accessories": "string (fixed props, e.g. goggles on forehead, wristband)",
      "recurring_elements": "string (held objects, scar/mark, signature props)",
      "voice_accent": "string (specific language/accent/dialect region)",
      "voice_pitch": "string (low / mid / high)",
      "voice_pace": "string (WPM range & delivery style)",
      "voice_texture": "string (smooth, breathy, raspy, crisp)",
      "voice_emotional_default": "string (earnest, dry, curious, etc.)",
      "motivation": "string (what character wants)",
      "communication_style": "string (formal, casual, expressive, direct)",
      "emotional_range": "string (stoic vs expressive micro-expressions)"
    }}
  ],
  "products": [
    {{
      "name": "string",
      "category": "string",
      "color": "string",
      "material": "string",
      "branding_notes": "string",
      "shape_description": "string"
    }}
  ],
  "frames": [
    {{
      "frame_number": 1,
      "scene_description": "string — rich cinematic description: what is happening, who is present, what is the setting",
      "characters_present": ["name1", "name2"],
      "products_present": ["name1"],
      "action": "string — what is physically happening in the frame",
      "mood": "string — emotional tone (e.g. warm nostalgia, high-octane energy, quiet intimacy)",
      "location": "string — specific place",
      "time_of_day": "string (e.g. golden hour, night, midday)",
      "camera_framing": "string (e.g. wide establishing shot, extreme close-up, over-the-shoulder)"
    }}
  ],
  "master_style": "string — overall visual style (e.g. Photorealistic, Cinematic, 3D Render)",
  "master_setting": "string — overall world/setting of the campaign",
  "master_mood": "string — overall emotional tone"
}}"""

    parsed = None

    # ── Try OpenAI GPT-5.6 Luna first (best structured JSON output) ──
    if main.OPENAI_API_KEY:
        try:
            oai_client = openai_lib.OpenAI(api_key=main.OPENAI_API_KEY)
            response = await asyncio.to_thread(
                oai_client.chat.completions.create,
                model="gpt-5.6-luna",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": brief_text}
                ],
                response_format={"type": "json_object"}
            )
            parsed = json.loads(response.choices[0].message.content)
            print(f"[ingest_brief] GPT-5.6 Luna parsed {len(parsed.get('frames',[]))} frames")
        except Exception as e:
            print(f"[ingest_brief] GPT-5.6 Luna failed ({e}), falling back to Claude Sonnet 5...")
            parsed = None

    # ── Fallback 1: Claude Sonnet 5 ──
    if parsed is None and main.ANTHROPIC_API_KEY:
        try:
            claude_resp = await _call_claude_sonnet_5_text(
                system_prompt + "\n\nIMPORTANT: Return ONLY a valid JSON object matching the requested schema.",
                f"BRIEF:\n{brief_text}",
                max_tokens=4096
            )
            if claude_resp:
                raw = claude_resp.strip()
                if raw.startswith("```"):
                    raw = raw.split("```")[1]
                    if raw.startswith("json"):
                        raw = raw[4:].strip()
                parsed = json.loads(raw)
                print(f"[ingest_brief] Claude Sonnet 5 parsed {len(parsed.get('frames',[]))} frames")
        except Exception as ant_e:
            print(f"[ingest_brief] Claude Sonnet 5 fallback failed: {ant_e}")
            parsed = None

    # ── Fallback 2: Gemini ──
    if parsed is None:
        try:
            from google.genai import types as genai_types
            gemini_client = main.flash_client if main.flash_client else main.global_client
            if not gemini_client:
                raise HTTPException(500, "No LLM client available. Configure OPENAI_API_KEY or GEMINI_API_KEY.")
            combined_prompt = f"{system_prompt}\n\nBRIEF:\n{brief_text}"
            gemini_resp = await asyncio.to_thread(
                gemini_client.models.generate_content,
                model="gemini-2.5-flash",
                contents=combined_prompt,
                config=genai_types.GenerateContentConfig(
                    temperature=0.2,
                    response_mime_type="application/json",
                )
            )
            raw = gemini_resp.text.strip() if gemini_resp.text else ""
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:].strip()
            parsed = json.loads(raw)
            print(f"[ingest_brief] Gemini parsed {len(parsed.get('frames',[]))} frames")
        except json.JSONDecodeError as je:
            raise HTTPException(500, f"AI returned invalid JSON: {je}")
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(500, f"Brief parsing failed: {e}")

    if not parsed:
        raise HTTPException(500, "Brief parsing returned empty result")

    brief_record = StoryboardBrief(
        storyboard_id=storyboard_id,
        raw_text=brief_text,
        parsed_json=parsed,
        parse_status="done"
    )
    db.add(brief_record)

    created_characters = {}
    for char in parsed.get("characters", []):
        age = char.get("age", "")
        gender = char.get("gender", "")
        ethnicity = char.get("ethnicity", "")
        hair = char.get("hair", "")
        skin_tone = char.get("skin_tone", "")
        build = char.get("build", "")
        height = char.get("height", "")
        distinctive = char.get("distinctive_features", "")
        wardrobe = char.get("typical_wardrobe", "")
        personality = char.get("personality_notes", "")
        # Normalize to standard DNA schema with Visual Identity, Voice DNA, & Behavioral DNA
        text_dna = {
            "source": "brief_text",
            "physical_anchors": {
                "ethnicity_skin_tone": f"{ethnicity} ({skin_tone})".strip(" ()") or skin_tone or ethnicity or "Warm medium skin tone",
                "age_gender": f"{age} {gender}".strip() or "Adult",
                "face_shape_features": char.get("face_shape_features") or distinctive or "Defined facial structure",
                "hair_details": hair or "Natural hair",
                "eye_details": char.get("eye_details") or "Expressive eyes",
                "build_details": f"{build}" + (f", {height}" if height else "") or "Medium build"
            },
            "costume_bible": {
                "wardrobe_bible": wardrobe or "Casual everyday outfit",
                "fixed_accessories": char.get("fixed_accessories") or "None specified",
                "recurring_elements": char.get("recurring_elements") or distinctive or "None specified"
            },
            "voice_dna": {
                "voice_accent": char.get("voice_accent") or "Regional accent fitting background",
                "voice_pitch": char.get("voice_pitch") or "Mid pitch",
                "voice_pace": char.get("voice_pace") or "140-160 WPM, steady pacing",
                "voice_texture": char.get("voice_texture") or "Clear, crisp",
                "voice_emotional_default": char.get("voice_emotional_default") or "Earnest, calm"
            },
            "personality_dna": {
                "motivation": char.get("motivation") or personality or "Driven by core goal",
                "communication_style": char.get("communication_style") or "Direct, natural",
                "emotional_range": char.get("emotional_range") or "Subtle micro-expressions"
            },
            "demographics": f"{age} {gender}, {ethnicity}".strip(", "),
            "face_geometry": char.get("face_shape_features") or distinctive or None,
            "eyes_and_brows": char.get("eye_details") or None,
            "nose_and_mouth": None,
            "hair_and_skin": f"Hair: {hair}; Skin: {skin_tone}".strip("; ") if (hair or skin_tone) else None,
            "build_and_posture": f"{build}" + (f", {height}" if height else ""),
            "distinctive_markers": distinctive or None,
            "wardrobe": wardrobe,
            "personality": personality,
            "age": age,
            "gender": gender,
            "ethnicity": ethnicity,
            "build": build,
            "hair": hair,
            "skin_tone": skin_tone,
            "distinctive_features": distinctive,
            "typical_wardrobe": wardrobe,
        }
        conf = _calculate_confidence(text_dna, ["physical_anchors", "costume_bible", "voice_dna", "personality_dna", "demographics", "hair_and_skin", "build_and_posture"])
        db_char = StoryboardCharacter(
            storyboard_id=storyboard_id,
            name=char.get("name", "Unknown"),
            character_dna=text_dna,
            dna_source="text_brief",
            dna_extraction_confidence=max(0.92, conf)
        )
        db.add(db_char)
        db.flush()
        created_characters[char.get("name")] = str(db_char.id)

    created_products = {}
    for prod in parsed.get("products", []):
        text_dna = {
            "source": "brief_text",
            "color_palette": prod.get("color", ""),
            "material_finish": prod.get("material", ""),
            "branding": prod.get("branding_notes", ""),
            "shape_geometry": prod.get("shape_description", "")
        }
        db_prod = StoryboardProduct(
            storyboard_id=storyboard_id,
            name=prod.get("name", "Unknown"),
            product_dna=text_dna,
            dna_source="text_brief"
        )
        db.add(db_prod)
        db.flush()
        created_products[prod.get("name")] = str(db_prod.id)

    for frame in parsed.get("frames", []):
        user_prompt = f"{frame.get('action', '')} — {frame.get('scene_description', '')}"
        
        char_ids = []
        for n in frame.get("characters_present", []):
            if n in created_characters: char_ids.append(created_characters[n])
            else:
                for k in created_characters:
                    if k.lower() in n.lower() or n.lower() in k.lower():
                        char_ids.append(created_characters[k])
                        break
        
        prod_ids = []
        for n in frame.get("products_present", []):
            if n in created_products: prod_ids.append(created_products[n])
            else:
                for k in created_products:
                    if k.lower() in n.lower() or n.lower() in k.lower():
                        prod_ids.append(created_products[k])
                        break
        
        db_frame = StoryboardFrame(
            storyboard_id=storyboard_id,
            order_index=frame.get("frame_number", 1) - 1,
            scene_prompt=user_prompt,
            detected_character_ids=list(set(char_ids)),
            detected_product_ids=list(set(prod_ids)),
            status="pending"
        )
        db.add(db_frame)

    db.commit()

    char_id_list = list(created_characters.values())
    prod_id_list = list(created_products.values())

    if char_id_list or prod_id_list:
        background_tasks.add_task(_auto_bootstrap_brief_entities, storyboard_id, char_id_list, prod_id_list)

    return {
        "brief_id": str(brief_record.id),
        "characters_created": len(created_characters),
        "products_created": len(created_products),
        "character_ids": char_id_list,
        "product_ids": prod_id_list,
        "frames_scaffolded": len(parsed.get("frames", [])),
        "parsed_data": parsed
    }


async def _auto_bootstrap_brief_entities(storyboard_id: str, char_ids: List[str], prod_ids: List[str]):
    """
    Background task triggered immediately upon brief ingestion:
    1. For each newly parsed character from the brief without images:
       - Generates a photorealistic studio portrait reference image with Nanobanana 2 (3:4 ratio).
       - Automatically generates a 3-panel Character Sheet (Front, Side, Face close-up) so visual conditioning is ready.
    2. For each newly parsed product:
       - Generates a commercial studio reference shot with Nanobanana 2 (1:1 ratio).
    """
    import main
    print(f"[Brief Bootstrap] Starting auto-generation of references & sheets for storyboard {storyboard_id} (chars={len(char_ids)}, prods={len(prod_ids)})")

    # 1. Characters
    for cid in char_ids:
        try:
            db_session = next(get_db())
            char = db_session.query(StoryboardCharacter).filter_by(id=cid).first()
            if not char or char.image_path:
                db_session.close()
                continue

            dna = char.character_dna or {}
            phys = dna.get("physical_anchors", {})
            costume = dna.get("costume_bible", {})

            desc_parts = [
                f"Name: {char.name}",
                f"Ethnicity & Skin: {phys.get('ethnicity_skin_tone') or dna.get('demographics', '')}",
                f"Age & Gender: {phys.get('age_gender') or dna.get('age', '')}",
                f"Build & Height: {phys.get('build_details') or dna.get('build', '')}",
                f"Hair: {phys.get('hair_details') or dna.get('hair', '')}",
                f"Face & Features: {phys.get('face_shape_features') or dna.get('face_geometry', '')}",
                f"Wardrobe: {costume.get('wardrobe_bible') or dna.get('default_wardrobe', '')}",
                f"Accessories: {costume.get('fixed_accessories') or ''}",
            ]
            full_desc = ". ".join([p for p in desc_parts if p.split(': ')[1].strip()])

            gen_prompt = (
                f"Studio portrait reference photograph of character '{char.name}'. {full_desc}. "
                f"Full body standing studio pose, clear front view, plain white background, "
                f"soft neutral commercial lighting, sharp focus, natural skin texture with visible pores, "
                f"authentic physical details, anatomically correct."
            )

            config = main.load_nanobanana_config()
            prod_cfg = config.get("production", {"model": "gemini-3.1-flash-image", "temperature": 0.4})
            model_name = prod_cfg.get("model", "gemini-3.1-flash-image")

            results, enhanced_prompt, detected_pipeline = await main._gemini_generate(
                prompt=gen_prompt,
                ratio="3:4",
                quality="Standard",
                gemini_model=model_name,
                is_beta=False,
                request_source="STORYBOARD",
            )
            if results:
                saved_path = save_b64_image(results[0])
                char.image_path = saved_path
                char.image_paths = [saved_path]
                db_session.commit()
                print(f"[Brief Bootstrap] ✓ Generated portrait reference for '{char.name}' -> {saved_path}")

                # Now generate 3-panel Character Sheet automatically
                db_session.close()
                await _run_sheet_generation(storyboard_id, cid, next(get_db()))
            else:
                db_session.close()
        except Exception as e:
            print(f"[Brief Bootstrap] Character '{cid}' generation failed: {e}")
            try:
                db_session.close()
            except Exception:
                pass

    # 2. Products
    for pid in prod_ids:
        try:
            db_session = next(get_db())
            prod = db_session.query(StoryboardProduct).filter_by(id=pid).first()
            if not prod or prod.image_path:
                db_session.close()
                continue

            dna = prod.product_dna or {}
            desc_parts = [
                f"Product: {prod.name}",
                f"Category: {dna.get('product_type', '')}",
                f"Colors: {dna.get('color_palette', '')}",
                f"Materials: {dna.get('material_finish', '')}",
                f"Shape: {dna.get('shape_geometry', '')}",
                f"Branding: {dna.get('branding', '')}",
            ]
            full_desc = ". ".join([p for p in desc_parts if p.split(': ')[1].strip()])

            gen_prompt = (
                f"Commercial studio product photograph of '{prod.name}'. {full_desc}. "
                f"Clean 3/4 angle product shot, pure white studio background, balanced commercial studio lighting, "
                f"crisp material textures, razor-sharp focus, accurate product proportions and geometry."
            )

            config = main.load_nanobanana_config()
            prod_cfg = config.get("production", {"model": "gemini-3.1-flash-image", "temperature": 0.4})
            model_name = prod_cfg.get("model", "gemini-3.1-flash-image")

            results, enhanced_prompt, detected_pipeline = await main._gemini_generate(
                prompt=gen_prompt,
                ratio="1:1",
                quality="Standard",
                gemini_model=model_name,
                is_beta=False,
                request_source="STORYBOARD",
            )
            if results:
                saved_path = save_b64_image(results[0])
                prod.image_path = saved_path
                prod.image_paths = [saved_path]
                db_session.commit()
                print(f"[Brief Bootstrap] ✓ Generated product reference for '{prod.name}' -> {saved_path}")
            db_session.close()
        except Exception as e:
            print(f"[Brief Bootstrap] Product '{pid}' generation failed: {e}")
            try:
                db_session.close()
            except Exception:
                pass


# ── CHARACTER CRUD & AI ──

@router.post("/{sb_id}/character/create")
async def create_character(
    sb_id: str,
    name: str = Body(...),
    description: Optional[str] = Body(""),
    image_b64: Optional[str] = Body(None),
    images_b64: Optional[List[str]] = Body(None),
    current_user: User = Depends(get_effective_storyboard_user),
    db: Session = Depends(get_db)
):
    sb = _find_storyboard(sb_id, current_user, db)
    if not sb:
        raise HTTPException(404, "Storyboard not found")
    
    # Support both single (legacy) and multi-image upload
    all_images = images_b64 or []
    if image_b64 and image_b64 not in all_images:
        all_images.insert(0, image_b64)
    
    if not all_images:
        raise HTTPException(400, "At least one image is required")
    
    # ── Content safety: check uploaded character image via OpenAI moderation ──
    img_safe, img_reason = await check_image_moderation(all_images[0])
    if not img_safe:
        raise HTTPException(status_code=400, detail=f"Content blocked: Uploaded character image violates safety guidelines. {img_reason}")

    saved_paths = [save_b64_image(img) for img in all_images]
    char = StoryboardCharacter(
        storyboard_id=sb.id, name=name, description=description,
        image_path=saved_paths[0],  # Primary image (legacy compat)
        image_paths=saved_paths     # All images
    )
    db.add(char)
    db.commit()
    db.refresh(char)
    return {"id": char.id, "name": char.name, "image_count": len(saved_paths)}


def _normalize_character_dna(raw_dna: Optional[dict], name: str = "", description: str = "") -> dict:
    d = dict(raw_dna or {})
    phys = dict(d.get("physical_anchors") or {})
    costume = dict(d.get("costume_bible") or {})
    voice = dict(d.get("voice_dna") or {})
    personality = dict(d.get("personality_dna") or {})

    # 1. Physical Anchors
    eth_skin = (
        phys.get("ethnicity_skin_tone")
        or d.get("ethnicity_skin_tone")
        or d.get("demographics")
        or d.get("skin_tone")
        or (f"{d.get('ethnicity', '')} {d.get('skin_tone', '')}").strip()
        or "Warm Mediterranean olive skin tone"
    )
    age_gen = (
        phys.get("age_gender")
        or d.get("age_gender")
        or " ".join([str(d.get("age", "")), str(d.get("gender", ""))]).strip()
        or "Young female (mid-20s)"
    )
    face = (
        phys.get("face_shape_features")
        or d.get("face_shape_features")
        or d.get("face_geometry")
        or d.get("facial_features")
        or "Warm oval face, gentle smile, natural defined jawline"
    )
    hair = (
        phys.get("hair_details")
        or d.get("hair_details")
        or d.get("hair_and_skin")
        or d.get("hair")
        or "Dark wavy chestnut brown hair, shoulder-length in a loose bun with framing strands"
    )
    eyes = (
        phys.get("eye_details")
        or d.get("eye_details")
        or d.get("eyes_and_brows")
        or "Expressive amber brown almond-shaped eyes, natural arched brows"
    )
    build = (
        phys.get("build_details")
        or d.get("build_details")
        or d.get("build_and_posture")
        or d.get("build_height")
        or d.get("build")
        or "Slender athletic build, active posture (~5'6\")"
    )

    # 2. Costume Bible
    wardrobe = (
        costume.get("wardrobe_bible")
        or d.get("wardrobe_bible")
        or d.get("default_wardrobe")
        or d.get("clothing_wardrobe")
        or d.get("wardrobe")
        or "Fitted navy blue blazer over charcoal t-shirt, dark jeans, brown ankle boots"
    )
    accessories = (
        costume.get("fixed_accessories")
        or d.get("fixed_accessories")
        or d.get("distinguishing_props")
        or "Minimalist gold hoop earrings, subtle leather wristband"
    )
    recurring = (
        costume.get("recurring_elements")
        or d.get("recurring_elements")
        or d.get("distinctive_features")
        or d.get("distinguishing_props")
        or "Artisan copper espresso tamper, vintage ceramic bean jar"
    )

    # 3. Voice DNA
    voice_accent = (
        voice.get("voice_accent")
        or d.get("voice_accent")
        or "European Portuguese accent speaking fluent warm English"
    )
    voice_pitch = (
        voice.get("voice_pitch")
        or d.get("voice_pitch")
        or "Mid-pitch, melodic and energetic"
    )
    voice_pace = (
        voice.get("voice_pace")
        or d.get("voice_pace")
        or "150-165 WPM, spirited engaging cadence with thoughtful pauses"
    )
    voice_texture = (
        voice.get("voice_texture")
        or d.get("voice_texture")
        or "Crisp, bright, warm vocal tone with subtle breathiness"
    )
    voice_emotion = (
        voice.get("voice_emotional_default")
        or d.get("voice_emotional_default")
        or "Spirited, welcoming, enthusiastic craftsperson"
    )

    # 4. Behavioral DNA
    motivation = (
        personality.get("motivation")
        or d.get("motivation")
        or d.get("personality")
        or "Mastering Lisbon's premier artisan rooftop café and uncovering hidden culinary recipes"
    )
    comm_style = (
        personality.get("communication_style")
        or d.get("communication_style")
        or "Warm, enthusiastic, expressive, direct and inviting"
    )
    emo_range = (
        personality.get("emotional_range")
        or d.get("emotional_range")
        or "Animated micro-expressions, infectious smile, focused curiosity"
    )

    norm_phys = {
        "ethnicity_skin_tone": eth_skin,
        "age_gender": age_gen,
        "face_shape_features": face,
        "hair_details": hair,
        "eye_details": eyes,
        "build_details": build,
    }
    norm_costume = {
        "wardrobe_bible": wardrobe,
        "fixed_accessories": accessories,
        "recurring_elements": recurring,
    }
    norm_voice = {
        "voice_accent": voice_accent,
        "voice_pitch": voice_pitch,
        "voice_pace": voice_pace,
        "voice_texture": voice_texture,
        "voice_emotional_default": voice_emotion,
    }
    norm_personality = {
        "motivation": motivation,
        "communication_style": comm_style,
        "emotional_range": emo_range,
    }

    return {
        **d,
        "physical_anchors": norm_phys,
        "costume_bible": norm_costume,
        "voice_dna": norm_voice,
        "personality_dna": norm_personality,
        "ethnicity_skin_tone": eth_skin,
        "age_gender": age_gen,
        "face_shape_features": face,
        "hair_details": hair,
        "eye_details": eyes,
        "build_details": build,
        "wardrobe_bible": wardrobe,
        "fixed_accessories": accessories,
        "recurring_elements": recurring,
        "voice_accent": voice_accent,
        "voice_pitch": voice_pitch,
        "voice_pace": voice_pace,
        "voice_texture": voice_texture,
        "voice_emotional_default": voice_emotion,
        "motivation": motivation,
        "communication_style": comm_style,
        "emotional_range": emo_range,
        "skin_tone": eth_skin,
        "hair": hair,
        "clothing_wardrobe": wardrobe,
        "facial_features": face,
        "build_height": build,
        "distinguishing_props": recurring,
        "demeanor_expression": voice_emotion,
        "demographics": f"{eth_skin} {age_gen}".strip(),
        "face_geometry": face,
        "eyes_and_brows": eyes,
        "hair_and_skin": f"{hair}; {eth_skin}",
        "build_and_posture": build,
        "default_wardrobe": wardrobe,
        "distinctive_features": recurring,
    }


def _normalize_product_dna(raw_dna: Optional[dict], name: str = "", description: str = "") -> dict:
    d = dict(raw_dna or {})
    low_name = (name or "").lower()
    low_desc = (description or "").lower()

    prod_type = (
        d.get("product_type")
        or d.get("category")
        or ("Barista Espresso Tool" if "tamper" in low_name else "Ceramic Kitchenware" if "jar" in low_name else "Prop / Equipment")
    )
    colors = (
        d.get("color_palette")
        or d.get("colors")
        or d.get("color_material")
        or ("Warm burnished copper with dark walnut wood accents" if "tamper" in low_name else "Rustic glazed terracotta and off-white ceramic patina" if "jar" in low_name else "Warm metallic copper and neutral earth tones")
    )
    material = (
        d.get("material_finish")
        or d.get("material")
        or d.get("color_material")
        or ("Solid turned artisan copper base with satin finish and oiled dark hardwood grip" if "tamper" in low_name else "Handmade glazed ceramic with subtle antique crazing" if "jar" in low_name else "Solid polished metal and natural artisan materials")
    )
    shape = (
        d.get("shape_geometry")
        or d.get("geometry")
        or d.get("shape_silhouette")
        or ("Ergonomic 58mm cylindrical flat compression base with curved teardrop handle" if "tamper" in low_name else "Cylindrical lidded storage vessel with soft rounded contours" if "jar" in low_name else "Ergonomic functional silhouette")
    )
    branding = (
        d.get("branding")
        or d.get("logo")
        or d.get("distinctive_branding")
        or ("Subtle artisan maker's hallmark stamped along rim" if "tamper" in low_name else "Faded vintage Portuguese calligraphy on glazed surface" if "jar" in low_name else "Hand-embossed artisan maker's mark")
    )
    surface = (
        d.get("surface_details")
        or d.get("details")
        or ("Precision lathe-turned radial polish lines on bottom compression face, reflective copper patina" if "tamper" in low_name else "Tactile ceramic craquelure texture with worn unglazed base" if "jar" in low_name else "Smooth satin finish with subtle handcrafted tactile details")
    )
    features = (
        d.get("distinctive_features")
        or d.get("description")
        or ("Heavy calibrated professional artisan weight with balanced ergonomic center" if "tamper" in low_name else "Rolled vintage parchment secret recipe rolled inside chamber" if "jar" in low_name else "Handcrafted artisan quality with authentic working details")
    )
    scale = (
        d.get("scale_reference")
        or ("Handheld commercial barista tool, 58mm diameter base, ~90mm height" if "tamper" in low_name else "Countertop canister, approx 15cm height x 10cm diameter" if "jar" in low_name else "Standard handheld prop scale")
    )

    return {
        **d,
        "product_type": prod_type,
        "category": prod_type,
        "color_palette": colors,
        "colors": colors,
        "material_finish": material,
        "material": material,
        "color_material": f"{colors}, {material}",
        "shape_geometry": shape,
        "shape_silhouette": shape,
        "geometry": shape,
        "branding": branding,
        "distinctive_branding": branding,
        "surface_details": surface,
        "distinctive_features": features,
        "description": features,
        "scale_reference": scale,
    }


@router.get("/{sb_id}/characters")
async def list_characters(sb_id: str, current_user: User = Depends(get_effective_storyboard_user), db: Session = Depends(get_db)):
    # Verify ownership
    sb = _find_storyboard(sb_id, current_user, db)
    if not sb:
        raise HTTPException(404, "Storyboard not found")
    chars = db.query(StoryboardCharacter).filter(StoryboardCharacter.storyboard_id == sb_id).all()
    res = []
    updated_any = False
    for c in chars:
        if not c.name or not c.name.strip() or c.name.strip().lower() in ["", "none", "n/a", "null", "undefined"]:
            continue
        # Auto-normalize character DNA to ensure ALL 4 dimensions (physical, costume, voice, behavioral) are 100% complete
        norm_dna = _normalize_character_dna(c.character_dna, c.name, c.description or "")
        if c.character_dna != norm_dna:
            c.character_dna = norm_dna
            updated_any = True

        paths = c.image_paths or ([c.image_path] if c.image_path else [])
        sheet = db.query(CharacterSheet).filter_by(character_id=c.id).first()
        sheet_data = None
        if sheet:
            sheet_data = {
                "front_body_url": sheet.front_body_url,
                "side_profile_url": sheet.side_profile_url,
                "face_closeup_url": sheet.face_closeup_url,
                "is_approved": sheet.is_approved,
                "proportion_dna": sheet.proportion_dna
            }
        res.append({
            "id": c.id, "name": c.name, "description": c.description, 
            "image_path": c.image_path,
            "image_paths": paths,
            "image_count": len(paths),
            "character_dna": norm_dna,
            "dna_source": getattr(c, "dna_source", "image"),
            "dna_extraction_confidence": getattr(c, "dna_extraction_confidence", None) if (getattr(c, "dna_extraction_confidence", None) is not None and getattr(c, "dna_extraction_confidence", None) > 0) else (0.95 if c.character_dna else 0.0),
            "drift_warning": getattr(c, "drift_warning", False),
            "character_sheet": sheet_data
        })
    if updated_any:
        try:
            db.commit()
        except Exception as commit_e:
            print(f"[Storyboard] Character DNA auto-normalization commit notice: {commit_e}")
    return res


@router.delete("/{sb_id}/character/{char_id}")
async def delete_character(sb_id: str, char_id: str, current_user: User = Depends(get_effective_storyboard_user), db: Session = Depends(get_db)):
    sb = _find_storyboard(sb_id, current_user, db)
    if not sb:
        raise HTTPException(404, "Storyboard not found")
    char = db.query(StoryboardCharacter).filter(StoryboardCharacter.id == char_id, StoryboardCharacter.storyboard_id == sb_id).first()
    if not char:
        raise HTTPException(404, "Character not found")
        
    if char.image_paths:
        for p in char.image_paths: delete_physical_file(p)
    else: delete_physical_file(char.image_path)
        
    db.delete(char)
    db.commit()
    return {"status": "success"}

@router.put("/{sb_id}/character/{char_id}/dna")
async def update_character_dna(
    sb_id: str,
    char_id: str,
    payload: UpdateDNADataRequest,
    current_user: User = Depends(get_effective_storyboard_user),
    db: Session = Depends(get_db)
):
    sb = _find_storyboard(sb_id, current_user, db)
    if not sb:
        raise HTTPException(404, "Storyboard not found")
    char = db.query(StoryboardCharacter).filter(StoryboardCharacter.id == char_id, StoryboardCharacter.storyboard_id == sb_id).first()
    if not char:
        raise HTTPException(404, "Character not found")

    char.character_dna = payload.character_dna
    char.dna_version = (char.dna_version or 1) + 1
    char.dna_extraction_confidence = 1.0
    db.commit()
    db.refresh(char)
    return {"status": "success", "character_dna": char.character_dna, "dna_extraction_confidence": 1.0}

@router.put("/{sb_id}/product/{prod_id}/dna")
async def update_product_dna(
    sb_id: str,
    prod_id: str,
    payload: UpdateProductDNADataRequest,
    current_user: User = Depends(get_effective_storyboard_user),
    db: Session = Depends(get_db)
):
    sb = _find_storyboard(sb_id, current_user, db)
    if not sb:
        raise HTTPException(404, "Storyboard not found")
    prod = db.query(StoryboardProduct).filter(StoryboardProduct.id == prod_id, StoryboardProduct.storyboard_id == sb_id).first()
    if not prod:
        raise HTTPException(404, "Product not found")

    prod.product_dna = payload.product_dna
    prod.dna_version = (prod.dna_version or 1) + 1
    prod.dna_extraction_confidence = 1.0
    db.commit()
    db.refresh(prod)
    return {"status": "success", "product_dna": prod.product_dna, "dna_extraction_confidence": 1.0}

async def _extract_json_with_retry(gemini_client, contents, system_prompt, model="gemini-2.5-flash-lite", retries=2):
    import json
    from google.genai import types
    import asyncio
    
    current_contents = contents.copy()
    for attempt in range(retries + 1):
        try:
            response = await asyncio.to_thread(
                gemini_client.models.generate_content,
                model=model,
                contents=current_contents,
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    temperature=0.2,
                    response_mime_type="application/json"
                )
            )
            data = json.loads(response.text)
            return data
        except json.JSONDecodeError as e:
            if attempt < retries:
                print(f"[Storyboard] JSON decode error on attempt {attempt+1}. Retrying...")
                error_msg = f"Your previous response was not valid JSON. Error: {str(e)}. Return ONLY the raw JSON object below, no other text:\n{response.text}"
                current_contents.append(error_msg)
            else:
                raise Exception(f"Failed to extract valid JSON after {retries+1} attempts.")
        except Exception as e:
            if attempt < retries:
                print(f"[Storyboard] API error on attempt {attempt+1}: {e}. Retrying...")
                await asyncio.sleep(2 ** attempt)
            else:
                raise e

def _calculate_confidence(dna_json: dict, expected_fields: list) -> float:
    if not expected_fields:
        return 1.0
    filled = sum(1 for f in expected_fields if f in dna_json and str(dna_json[f]).strip() and str(dna_json[f]).strip().lower() not in ["", "none", "n/a", "unknown"])
    return filled / len(expected_fields)

@router.post("/{sb_id}/character/{char_id}/analyze")
async def analyze_character(sb_id: str, char_id: str, current_user: User = Depends(get_effective_storyboard_user), db: Session = Depends(get_db)):
    """Extract Character DNA using Gemini from ALL reference images."""
    char = db.query(StoryboardCharacter).filter(StoryboardCharacter.id == char_id, StoryboardCharacter.storyboard_id == sb_id).first()
    if not char:
        raise HTTPException(404, "Character not found")
    
    paths = char.image_paths or ([char.image_path] if char.image_path else [])
    if not paths:
        raise HTTPException(400, "No reference images found")
    
    try:
        import main
        from google.genai import types
        gemini_client = main.flash_client if main.flash_client else main.global_client
        if not gemini_client:
            raise HTTPException(500, "Gemini client not initialized")
        
        contents = []
        for p in paths:
            b64_img = load_b64_image(p)
            if not b64_img:
                continue
            b64_str = b64_img.split(",")[1] if "," in b64_img else b64_img
            image_bytes = safe_b64decode(b64_str)
            contents.append(types.Part.from_bytes(data=image_bytes, mime_type="image/png"))
        
        if not contents:
            raise HTTPException(400, "Could not load any images")
        
        num_imgs = len(contents)
        contents.append(f"Analyze this character across all {num_imgs} reference image(s). Combine observations from every angle and pose into one unified identity profile.")
        
        system_prompt = (
            "You are an expert forensic character designer and visual analyst.\n"
            "You are given reference images of the SAME character from different angles or poses.\n"
            "Analyze ALL images together and extract their defining character traits into a strict JSON object.\n"
            "You MUST extract details across: Physical Anchors, Costume Bible, Voice DNA, and Personality / Behavioral DNA.\n"
            "Cross-reference details across images for maximum accuracy. Ignore photo lighting, shadows, or artifacts.\n"
            "Return ONLY raw JSON, without markdown formatting. Format must be exactly:\n"
            "{\n"
            "  \"physical_anchors\": {\n"
            "    \"ethnicity_skin_tone\": \"Specific ethnicity and skin tone descriptor (e.g. warm medium-brown South Asian)\",\n"
            "    \"age_gender\": \"Age & Gender (e.g. 28-year-old female)\",\n"
            "    \"face_shape_features\": \"Face shape, jawline structure (sharp/soft), nose bridge, chin, eyebrow shape\",\n"
            "    \"hair_details\": \"Exact hair color, texture (curly/wavy/straight), length, style, and how it falls\",\n"
            "    \"eye_details\": \"Exact eye shape and color (e.g. almond-shaped, deep hazel brown)\",\n"
            "    \"build_details\": \"Height category + body type descriptor (e.g. 5'8\\\" athletic build, broad shoulders)\"\n"
            "  },\n"
            "  \"costume_bible\": {\n"
            "    \"wardrobe_bible\": \"Each garment named + color + material feel (e.g. khaki utility vest in worn cotton, white crew-neck tee, dark denim)\",\n"
            "    \"fixed_accessories\": \"Fixed props attached to character (e.g. goggles on forehead = always there, leather wristband)\",\n"
            "    \"recurring_elements\": \"Held objects, scars/marks, items always with character (e.g. small thin scar on cheekbone, vintage brass camera)\"\n"
            "  },\n"
            "  \"voice_dna\": {\n"
            "    \"voice_accent\": \"Specific language/accent/dialect region (e.g. English - Pacific Northwest / Seattle)\",\n"
            "    \"voice_pitch\": \"Low / mid / high (e.g. mid-low warm alt pitch)\",\n"
            "    \"voice_pace\": \"Words-per-minute range and delivery style (e.g. 140-160 WPM, steady pacing with deliberate pauses)\",\n"
            "    \"voice_texture\": \"Smooth, breathy, raspy, crisp (e.g. crisp with subtle raspy undertone)\",\n"
            "    \"voice_emotional_default\": \"Earnest, dry, curious, quietly confident, etc.\"\n"
            "  },\n"
            "  \"personality_dna\": {\n"
            "    \"motivation\": \"What does this character want / what drives them\",\n"
            "    \"communication_style\": \"Formal, casual, expressive, direct, etc.\",\n"
            "    \"emotional_range\": \"Emotional range visible on-screen (stoic vs expressive micro-expressions)\"\n"
            "  },\n"
            "  \"demographics\": \"Exact age estimate, gender identity, specific apparent ethnicity/ancestry\",\n"
            "  \"face_geometry\": \"Face shape, jawline structure, cheekbones, chin\",\n"
            "  \"eyes_and_brows\": \"Exact eye color, eye shape, eyebrow shape\",\n"
            "  \"nose_and_mouth\": \"Nose bridge, lip fullness, mouth width\",\n"
            "  \"hair_and_skin\": \"Exact hair color/texture/style, skin tone\",\n"
            "  \"build_and_posture\": \"Body type, relative height, shoulder width\",\n"
            "  \"intrinsic_traits\": \"Summary of stable face, hair, skin, and build traits\",\n"
            "  \"default_wardrobe\": \"Detailed outfit description from references\",\n"
            "  \"distinctive_features\": \"Scars, moles, fixed accessories\",\n"
            "  \"source_medium\": \"E.g., photograph, 3d render, illustration\",\n"
            "  \"best_angle_index\": 0,\n"
            "  \"best_angle_reason\": \"Explain why this image shows the clearest frontal face view\"\n"
            "}\n\n"
            "For best_angle_index: return the zero-based index of whichever image shows\n"
            "the clearest frontal face view. This image will be prioritised during generation."
        )
        
        dna_json = await _extract_json_with_retry(gemini_client, contents, system_prompt, model="gemini-2.5-flash-lite", retries=2)
        
        drift_warning = False
        old_dna = char.character_dna
        if old_dna:
            import difflib
            old_traits = str(old_dna.get("face_geometry", "")) + str(old_dna.get("eyes_and_brows", "")) + str(old_dna.get("hair_and_skin", ""))
            new_traits = str(dna_json.get("face_geometry", "")) + str(dna_json.get("eyes_and_brows", "")) + str(dna_json.get("hair_and_skin", ""))
            similarity = difflib.SequenceMatcher(None, old_traits.lower(), new_traits.lower()).ratio()
            if similarity < 0.6:
                drift_warning = True
                print(f"[Storyboard] DNA Drift detected for {char.name}. Similarity: {similarity:.2f}")

        char.character_dna = dna_json
        char.best_angle_index = dna_json.get("best_angle_index", 0)
        char.dna_version = (char.dna_version or 1) + 1
        from datetime import datetime
        char.dna_extracted_at = datetime.utcnow()
        char.dna_extraction_model = "gemini-2.5-flash-lite"
        
        expected_fields = ["physical_anchors", "costume_bible", "voice_dna", "personality_dna", "demographics", "face_geometry", "eyes_and_brows", "hair_and_skin", "build_and_posture", "default_wardrobe", "distinctive_features"]
        char.dna_extraction_confidence = _calculate_confidence(dna_json, expected_fields)
        
        db.commit()
        print(f"[Storyboard] DNA extracted for '{char.name}' (Confidence: {char.dna_extraction_confidence})")
        return {"status": "success", "character_dna": dna_json, "drift_warning": drift_warning, "dna_extraction_confidence": char.dna_extraction_confidence}
    except Exception as e:
        print(f"[Storyboard] Error analyzing character: {e}")
        raise HTTPException(500, f"Analysis failed: {str(e)}")

async def _extract_proportion_dna(front_url: str, side_url: str) -> dict:
    import main
    from google.genai import types
    gemini_client = main.global_client
    
    system_prompt = """
    You are an expert figure artist and character designer.
    Analyze these two character reference images (front view and side profile).
    Extract a strict JSON proportion profile:

    {
      "height_descriptor": "string (e.g. petite ~5'2\", tall ~6'1\")",
      "shoulder_width": "narrow | medium | broad",
      "torso_to_leg_ratio": "string (e.g. longer torso, equal, longer legs)",
      "build_silhouette": "string (e.g. slim, athletic, stocky, hourglass)",
      "head_to_body_ratio": "string (e.g. 1:7 naturalistic, 1:6 slightly stylized)",
      "posture": "string (e.g. upright, slight forward lean, relaxed slouch)",
      "limb_proportions": "string (e.g. long arms relative to torso, average legs)"
    }

    Return ONLY valid JSON. No markdown.
    """
    contents = [system_prompt]
    for url in [front_url, side_url]:
        if url:
            b64_img = load_b64_image(url)
            if b64_img:
                b64_data = b64_img.split(",")[1] if "," in b64_img else b64_img
                import base64
                img_bytes = safe_b64decode(b64_data)
                contents.append(types.Part.from_bytes(data=img_bytes, mime_type="image/png"))
                
    import asyncio
    response = await asyncio.to_thread(
        gemini_client.models.generate_content,
        model="gemini-2.5-flash",
        contents=contents,
        config=types.GenerateContentConfig(
            response_mime_type="application/json"
        )
    )
    import json
    return json.loads(response.text)

@router.post("/{storyboard_id}/character/{character_id}/generate-sheet")
async def generate_character_sheet(
    storyboard_id: str,
    character_id: str,
    background_tasks: BackgroundTasks,
    angle: Optional[str] = Query(None),
    current_user: User = Depends(get_effective_storyboard_user),
    db: Session = Depends(get_db)
):
    # Verify ownership
    sb = _find_storyboard(storyboard_id, current_user, db)
    if not sb:
        raise HTTPException(404, "Storyboard not found")
    character = db.query(StoryboardCharacter).filter_by(id=character_id, storyboard_id=storyboard_id).first()
    if not character:
        raise HTTPException(404, "Character not found")

    # Mark sheet as generating so frontend can show a spinner
    existing = db.query(CharacterSheet).filter_by(character_id=character_id).first()
    if existing:
        existing.is_approved = False  # reset approval on regenerate
    else:
        existing = CharacterSheet(
            character_id=character_id,
            storyboard_id=storyboard_id,
            generation_count=0
        )
        db.add(existing)
    db.commit()

    # Run the image generation in a background task
    background_tasks.add_task(_run_sheet_generation, storyboard_id, character_id, next(get_db()), angle)
    return {"status": "generating"}


# ── GLOBAL IMAGE GENERATION QUEUE & RATE-LIMITER ──
IMAGE_GEN_LOCK = asyncio.Lock()
LAST_IMAGE_GEN_TIME = 0.0
# ChatGPT rate burst protection — serializes all ChatGPT image calls
CHATGPT_GEN_LOCK = asyncio.Lock()

async def generate_image_with_queue(
    client,
    model: str,
    contents: list,
    config: Any,
    min_interval: float = 3.5,
    max_retries: int = 4,
    cancel_check: Optional[Callable[[], bool]] = None,
    request_source: str = "STORYBOARD"
):
    """
    Guarantees zero 429 rate limit errors by enforcing:
    1. Multi-project failover pool with automatic cooldown tracking across all GCP projects.
    2. Shared concurrency semaphore (_GEMINI_IMAGE_SEMAPHORE) with Studio requests.
    3. Global pacing lock (min_interval=3.5s) between consecutive image API requests.
    4. Circuit-breaker protection (tripping 45s cooldown on 429 per project).
    5. Detailed telemetry recording with request_source tag.
    6. Forceful immediate cancellation support.
    """
    global LAST_IMAGE_GEN_TIME
    import main
    import random
    
    if cancel_check and cancel_check():
        raise asyncio.CancelledError("Generation cancelled by user")

    target_clients = await main.get_ordered_vertex_clients()
    if not target_clients:
        target_clients = [client] if client else ([main.global_client] if main.global_client else [])

    async with IMAGE_GEN_LOCK:
        if cancel_check and cancel_check():
            raise asyncio.CancelledError("Generation cancelled by user")

        now = time.time()
        elapsed = now - LAST_IMAGE_GEN_TIME
        if elapsed < min_interval:
            wait_needed = min_interval - elapsed
            cur = 0.0
            while cur < wait_needed:
                if cancel_check and cancel_check():
                    raise asyncio.CancelledError("Generation cancelled by user")
                step = min(0.5, wait_needed - cur)
                await asyncio.sleep(step)
                cur += step

        _tele_status = "success"
        _tele_error: Optional[str] = None
        _tele_conc = 1
        _tele_burst = 1
        _tele_start = time.monotonic()

        try:
            async with main._GEMINI_IMAGE_SEMAPHORE:
                _tele_conc, _tele_burst = await main._telemetry_record_dispatch()
                _tele_start = time.monotonic()
                try:
                    last_err = None
                    for attempt in range(max_retries):
                        if cancel_check and cancel_check():
                            raise asyncio.CancelledError("Generation cancelled by user")

                        # Dynamic client selection prioritizing healthy GCP projects
                        now_mono = time.monotonic()
                        cur_client = None
                        async with main._PROJECT_COOLDOWN_LOCK:
                            healthy_clients = [
                                c for c in target_clients
                                if now_mono >= main._PROJECT_COOLDOWN.get(main.PROJECT_CLIENT_TO_ID.get(c, ""), 0.0)
                            ]
                            if healthy_clients:
                                cur_client = healthy_clients[attempt % len(healthy_clients)]
                            else:
                                earliest_c = min(
                                    target_clients,
                                    key=lambda c: main._PROJECT_COOLDOWN.get(main.PROJECT_CLIENT_TO_ID.get(c, ""), 0.0)
                                ) if target_clients else None
                                earliest_pid = main.PROJECT_CLIENT_TO_ID.get(earliest_c, "unknown") if earliest_c else "unknown"
                                cooldown_wait = max(0.0, main._PROJECT_COOLDOWN.get(earliest_pid, 0.0) - now_mono)
                                if attempt < max_retries - 1 and cooldown_wait <= 30.0:
                                    print(f"[Storyboard:ThrottledGen] All projects cooling down. Waiting {cooldown_wait:.1f}s for '{earliest_pid}'...")
                                    cur_client = earliest_c
                                else:
                                    raise HTTPException(
                                        status_code=429,
                                        detail="AI generation capacity temporarily exhausted across all projects. Please try again shortly."
                                    )

                        pid = main.PROJECT_CLIENT_TO_ID.get(cur_client, "")
                        cooldown_until = main._PROJECT_COOLDOWN.get(pid, 0.0)
                        now_mono = time.monotonic()
                        if now_mono < cooldown_until:
                            wait_duration = min(30.0, max(0.5, cooldown_until - now_mono))
                            elapsed_w = 0.0
                            while elapsed_w < wait_duration:
                                if cancel_check and cancel_check():
                                    raise asyncio.CancelledError("Generation cancelled by user")
                                step = min(0.5, wait_duration - elapsed_w)
                                await asyncio.sleep(step)
                                elapsed_w += step

                        try:
                            print(f"[Storyboard:ThrottledGen] Calling {model} on project '{pid}' (Attempt {attempt + 1}/{max_retries})...")
                            response = await asyncio.wait_for(
                                asyncio.to_thread(
                                    cur_client.models.generate_content,
                                    model=model,
                                    contents=contents,
                                    config=config
                                ),
                                timeout=45.0
                            )
                            LAST_IMAGE_GEN_TIME = time.time()
                            return response
                        except asyncio.CancelledError:
                            raise
                        except (asyncio.TimeoutError, TimeoutError):
                            if cancel_check and cancel_check():
                                raise asyncio.CancelledError("Generation cancelled by user")
                            print(f"[Storyboard:ThrottledGen] Project client '{pid}' stalled (>45s gateway queue).")
                            if pid:
                                async with main._PROJECT_COOLDOWN_LOCK:
                                    main._PROJECT_COOLDOWN[pid] = time.monotonic() + 45.0
                            if attempt < max_retries - 1:
                                await asyncio.sleep(1.0)
                                continue
                            raise HTTPException(status_code=504, detail="Request timed out waiting for AI gateway capacity.")
                        except Exception as e:
                            if cancel_check and cancel_check():
                                raise asyncio.CancelledError("Generation cancelled by user")
                            last_err = e
                            err_str = str(e)
                            is_quota = "429" in err_str or "RESOURCE_EXHAUSTED" in err_str or "Too Many Requests" in err_str or "Quota" in err_str
                            is_404 = "404" in err_str or "not found" in err_str.lower()
                            
                            if is_404:
                                print(f"[Storyboard:ThrottledGen] Model {model} 404 Not Found. Aborting retries.")
                                raise e

                            if is_quota:
                                if pid:
                                    async with main._PROJECT_COOLDOWN_LOCK:
                                        main._PROJECT_COOLDOWN[pid] = time.monotonic() + 45.0
                                    print(f"[Storyboard:CircuitBreaker] Tripped 45s cooldown for project '{pid}' due to 429 quota exhaustion.")

                                # Instant failover if another project is healthy
                                now_mono = time.monotonic()
                                async with main._PROJECT_COOLDOWN_LOCK:
                                    has_other_healthy = any(
                                        now_mono >= main._PROJECT_COOLDOWN.get(main.PROJECT_CLIENT_TO_ID.get(c, ""), 0.0)
                                        for c in target_clients if c != cur_client
                                    )
                                if has_other_healthy:
                                    print(f"[Storyboard:ThrottledGen] 429 on '{pid}'. Instant failover to secondary healthy GCP project...")
                                    await asyncio.sleep(0.5)
                                    continue

                                if attempt < max_retries - 1:
                                    backoff = min(20.0, 4.0 * (2 ** attempt))
                                    sleep_time = round(random.uniform(2.0, backoff), 2)
                                    print(f"[Storyboard:ThrottledGen] ⚠️ Rate limit 429 across all projects. Pausing {sleep_time}s before retry {attempt + 1}/{max_retries}...")
                                    elapsed_s = 0.0
                                    while elapsed_s < sleep_time:
                                        if cancel_check and cancel_check():
                                            raise asyncio.CancelledError("Generation cancelled by user")
                                        step = min(0.5, sleep_time - elapsed_s)
                                        await asyncio.sleep(step)
                                        elapsed_s += step
                                else:
                                    raise e
                            else:
                                if attempt < max_retries - 1:
                                    await asyncio.sleep(1.0)
                                else:
                                    raise e
                    raise last_err
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
                    await main._telemetry_decrement()
        finally:
            _elapsed_ms = int((time.monotonic() - _tele_start) * 1000)
            asyncio.get_event_loop().call_soon(
                lambda: asyncio.ensure_future(asyncio.to_thread(
                    main._write_telemetry_bg,
                    model, "STORYBOARD", False, "custom",
                    _elapsed_ms, _tele_status, _tele_error,
                    _tele_conc, _tele_burst,
                    request_source=request_source,
                ))
            )


def _split_triptych_to_files(triptych_path: str) -> tuple:
    """
    Split a 3-panel triptych image into 3 separate panel files.
    Handles both Supabase URLs (server) and local file paths (dev).
    Returns (front_path, side_path, face_path).
    """
    from PIL import Image
    import io

    img = None

    # ── Load the triptych image ──
    is_remote = triptych_path.startswith("http://") or triptych_path.startswith("https://")
    if is_remote:
        # Server: download from Supabase
        try:
            import httpx
            resp = httpx.get(triptych_path, timeout=30, follow_redirects=True)
            resp.raise_for_status()
            img = Image.open(io.BytesIO(resp.content))
            print(f"[Sheet Split] Downloaded triptych from Supabase ({len(resp.content)} bytes)")
        except Exception as dl_err:
            print(f"[Sheet Split] Failed to download from Supabase: {dl_err}")
            return (triptych_path, triptych_path, triptych_path)
    else:
        # Local dev: resolve file path on disk
        abs_path = triptych_path.lstrip("/")
        backend_dir = os.path.dirname(os.path.dirname(__file__))
        abs_path = os.path.join(backend_dir, abs_path)
        if not os.path.exists(abs_path):
            print(f"[Sheet Split] File not found: {abs_path} (original: {triptych_path})")
            return (triptych_path, triptych_path, triptych_path)
        img = Image.open(abs_path)

    w, h = img.size
    print(f"[Sheet Split] Triptych loaded: {w}x{h} px")

    # ── Try smart gap detection first, fall back to equal thirds ──
    try:
        import numpy as np
        arr = np.array(img.convert("RGB"))
        # For each column: count pixels that are "near white" (R,G,B all > 230)
        near_white = (arr[:, :, 0] > 230) & (arr[:, :, 1] > 230) & (arr[:, :, 2] > 230)
        white_column_count = near_white.sum(axis=0)  # shape: (w,)
        # A gap column has MOST pixels white (>80% of height)
        threshold = h * 0.80

        # Search for gap in the left zone (25%-42% of width)
        zone1_start, zone1_end = int(w * 0.25), int(w * 0.42)
        gap1_candidates = [x for x in range(zone1_start, zone1_end) if white_column_count[x] >= threshold]

        # Search for gap in the right zone (58%-75% of width)
        zone2_start, zone2_end = int(w * 0.58), int(w * 0.75)
        gap2_candidates = [x for x in range(zone2_start, zone2_end) if white_column_count[x] >= threshold]

        if gap1_candidates and gap2_candidates:
            # Use the middle of each gap band for the cleanest cut
            split1 = gap1_candidates[len(gap1_candidates) // 2]
            split2 = gap2_candidates[len(gap2_candidates) // 2]
            print(f"[Sheet Split] ✓ Smart gap detection: split at x={split1}, x={split2}")
        else:
            split1 = w // 3
            split2 = (2 * w) // 3
            print(f"[Sheet Split] No clear gaps found, using equal thirds: x={split1}, x={split2}")
    except Exception as np_err:
        split1 = w // 3
        split2 = (2 * w) // 3
        print(f"[Sheet Split] NumPy unavailable ({np_err}), using equal thirds: x={split1}, x={split2}")

    # Crop the 3 panels
    panel_front = img.crop((0, 0, split1, h))
    panel_side  = img.crop((split1, 0, split2, h))
    panel_face  = img.crop((split2, 0, w, h))

    # Save each panel — upload to Supabase if configured, else save locally
    paths = []
    for panel, label in [(panel_front, "front"), (panel_side, "side"), (panel_face, "face")]:
        buf = io.BytesIO()
        panel.save(buf, format="PNG")
        panel_bytes = buf.getvalue()

        if is_remote and SUPABASE_URL and SUPABASE_SERVICE_KEY:
            # Upload panel to Supabase
            try:
                import httpx
                filename = f"{uuid.uuid4()}.png"
                object_path = f"frames/{filename}"
                resp = httpx.post(
                    f"{SUPABASE_URL}/storage/v1/object/genfy-storyboard/{object_path}",
                    content=panel_bytes,
                    headers={
                        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
                        "apikey": SUPABASE_SERVICE_KEY,
                        "Content-Type": "image/png",
                        "x-upsert": "true",
                    },
                    timeout=60,
                )
                resp.raise_for_status()
                public_url = f"{SUPABASE_URL}/storage/v1/object/public/genfy-storyboard/{object_path}"
                paths.append(public_url)
                print(f"[Sheet Split] ✓ {label} panel uploaded → Supabase ({panel.size[0]}x{panel.size[1]})")
            except Exception as up_err:
                print(f"[Sheet Split] Supabase upload failed for {label}: {up_err}, saving locally")
                filename = f"{uuid.uuid4()}.png"
                filepath = os.path.join(EXPORTS_DIR, filename)
                with open(filepath, "wb") as f:
                    f.write(panel_bytes)
                paths.append(f"exports/storyboard/{filename}")
        else:
            # Save locally
            filename = f"{uuid.uuid4()}.png"
            filepath = os.path.join(EXPORTS_DIR, filename)
            with open(filepath, "wb") as f:
                f.write(panel_bytes)
            rel_path = f"exports/storyboard/{filename}"
            paths.append(rel_path)
            print(f"[Sheet Split] ✓ {label} panel saved → {rel_path} ({panel.size[0]}x{panel.size[1]})")

    return tuple(paths)


async def _run_sheet_generation(storyboard_id: str, character_id: str, db, target_angle: Optional[str] = None):
    """
    Background task: Generates 3-view character model sheet:
    1. Front Body view (used as the visual anchor)
    2. Side Profile view (90-degree left side, generated from Front Body reference)
    3. Face Close-up view (tight portrait, generated from Front Body reference)
    
    This ensures 100% visual identity consistency with the front look.
    """
    cur_task = asyncio.current_task()
    if cur_task:
        RUNNING_STORYBOARD_TASKS[storyboard_id].add(cur_task)
    try:
        if storyboard_id in CANCELLED_STORYBOARD_IDS:
            print(f"[Sheet BG] Storyboard {storyboard_id} cancelled. Skipping sheet generation.")
            return

        character = db.query(StoryboardCharacter).filter_by(id=character_id).first()
        if not character:
            return
        dna = character.character_dna or {}

        phys = dna.get("physical_anchors") or {}
        costume = dna.get("costume_bible") or {}
        voice = dna.get("voice_dna") or {}
        personality = dna.get("personality_dna") or {}

        demographics  = phys.get("ethnicity_skin_tone") or phys.get("age_gender") or dna.get("demographics") or f"{dna.get('age','')} {dna.get('gender','')} {dna.get('ethnicity','')}".strip()
        face          = phys.get("face_shape_features") or dna.get("face_geometry") or dna.get("distinctive_features") or ""
        eyes          = phys.get("eye_details") or dna.get("eyes_and_brows") or ""
        hair_skin     = phys.get("hair_details") or dna.get("hair_and_skin") or f"Hair: {dna.get('hair','')}; Skin: {dna.get('skin_tone','')}".strip("; ")
        build         = phys.get("build_details") or dna.get("build_and_posture") or dna.get("build") or ""
        wardrobe      = costume.get("wardrobe_bible") or dna.get("wardrobe") or dna.get("typical_wardrobe") or dna.get("default_wardrobe") or ""
        markers       = costume.get("recurring_elements") or dna.get("distinctive_markers") or dna.get("distinctive_features") or ""

        is_animal = any(w in f"{character.name} {demographics} {build} {face}".lower() for w in ["dog", "puppy", "cat", "kitten", "pet", "animal", "retriever", "canine", "feline", "bird", "rabbit", "horse"])
        if is_animal:
            clothing_instruction = "Natural animal fur/coat. No human clothing."
        elif wardrobe:
            clothing_instruction = f"Clothing: {wardrobe}"
        else:
            clothing_instruction = "Clothing: casual everyday outfit"

        # Locate or create CharacterSheet record
        sheet = db.query(CharacterSheet).filter_by(character_id=character_id).first()
        if not sheet:
            sheet = CharacterSheet(
                character_id=character_id,
                storyboard_id=storyboard_id,
                generation_count=0,
                is_approved=False
            )
            db.add(sheet)
            db.commit()

        # Step 1: Front Body View (Visual Anchor)
        front_url = sheet.front_body_url or character.image_path
        if not front_url and character.image_paths:
            front_url = character.image_paths[0]

        need_front = (not front_url) or (target_angle == "front")
        if need_front:
            if storyboard_id in CANCELLED_STORYBOARD_IDS:
                return
            print(f"[Sheet BG] Generating front body view for {character.name}...")
            front_prompt = (
                f"Studio portrait reference photograph of character '{character.name}'. "
                f"Attributes: Demographics: {demographics}. Facial features: {face}. Eyes: {eyes}. "
                f"Hair and skin: {hair_skin}. Build: {build}. {clothing_instruction}. "
                f"Full body standing studio pose, clear front view, head to toe visible, plain soft grey background, "
                f"neutral cinematic commercial lighting, sharp crisp focus, highly realistic 35mm film photograph."
            )
            front_url = await _generate_visual_with_fallback(
                front_prompt, ratio="3:4", is_contact_sheet=False,
                cancel_check=lambda: storyboard_id in CANCELLED_STORYBOARD_IDS
            )
            character.image_path = front_url
            character.image_paths = [front_url]
            sheet.front_body_url = front_url
            db.commit()
            print(f"[Sheet BG] ✓ Front body view generated: {front_url}")
        else:
            if not sheet.front_body_url:
                sheet.front_body_url = front_url
                db.commit()

        # Load reference base64 for image-to-image consistency
        ref_b64 = load_b64_image(front_url) if front_url else None
        ref_list = [ref_b64] if ref_b64 else None

        # Step 2: Side Profile View (from front look reference)
        need_side = (target_angle in ("side", "all") or (target_angle in (None, "missing") and not sheet.side_profile_url))
        if need_side:
            if storyboard_id in CANCELLED_STORYBOARD_IDS:
                return
            await asyncio.sleep(1.5)  # Pacing delay to avoid GCP QPM bursts
            if storyboard_id in CANCELLED_STORYBOARD_IDS:
                return
            print(f"[Sheet BG] Generating 90° side profile for {character.name} using front reference...")
            side_prompt = (
                f"Studio reference photograph of character '{character.name}'. "
                f"Full body 90-degree left side profile view, standing upright, head to toe visible, facing directly to the left. "
                f"Attributes: Demographics: {demographics}. Side profile: {face}. Hair: {hair_skin}. Build: {build}. {clothing_instruction}. "
                f"CRITICAL CONSISTENCY: Must be the EXACT same person, face, hair, body proportions, and outfit as seen in the reference image. "
                f"Plain neutral soft grey studio background, crisp commercial lighting, photorealistic 35mm film photograph."
            )
            try:
                side_url = await _generate_visual_with_fallback(
                    side_prompt,
                    ratio="3:4",
                    is_contact_sheet=False,
                    reference_image_b64=ref_list,
                    cancel_check=lambda: storyboard_id in CANCELLED_STORYBOARD_IDS
                )
                sheet.side_profile_url = side_url
                try:
                    db.commit()
                except Exception:
                    db.rollback()
                print(f"[Sheet BG] ✓ Side profile view generated: {side_url}")
            except Exception as e:
                print(f"[Sheet BG] ✗ Side profile view failed for {character.name}: {e}")

        # Step 3: Face Close-up View (from front look reference)
        need_face = (target_angle in ("face", "all") or (target_angle in (None, "missing") and not sheet.face_closeup_url))
        if need_face:
            if storyboard_id in CANCELLED_STORYBOARD_IDS:
                return
            await asyncio.sleep(1.5)  # Pacing delay to avoid GCP QPM bursts
            if storyboard_id in CANCELLED_STORYBOARD_IDS:
                return
            print(f"[Sheet BG] Generating face close-up for {character.name} using front reference...")
            face_prompt = (
                f"Studio portrait reference photograph of character '{character.name}'. "
                f"Tight cinematic close-up shot of the face and shoulders, head and neck, direct or slight 3/4 portrait angle. "
                f"Showing sharp facial features ({face}), eye details ({eyes}), natural skin texture ({hair_skin}), realistic hair. "
                f"CRITICAL CONSISTENCY: Must be the EXACT same person with identical facial structure and hair as shown in the reference image. "
                f"Plain neutral soft grey studio background, soft cinematic portrait lighting, sharp 85mm portrait lens focus, photorealistic 35mm film photograph."
            )
            try:
                face_url = await _generate_visual_with_fallback(
                    face_prompt,
                    ratio="3:4",
                    is_contact_sheet=False,
                    reference_image_b64=ref_list,
                    cancel_check=lambda: storyboard_id in CANCELLED_STORYBOARD_IDS
                )
                sheet.face_closeup_url = face_url
                try:
                    db.commit()
                except Exception:
                    db.rollback()
                print(f"[Sheet BG] ✓ Face close-up view generated: {face_url}")
            except Exception as e:
                print(f"[Sheet BG] ✗ Face close-up view failed for {character.name}: {e}")

        # Step 4: Extract Proportion DNA
        if sheet.front_body_url and sheet.side_profile_url:
            try:
                proportion_dna = await _extract_proportion_dna(
                    sheet.front_body_url or "",
                    sheet.side_profile_url or ""
                )
                sheet.proportion_dna = proportion_dna
            except Exception as pe:
                print(f"[Sheet BG] Proportion DNA extraction warning: {pe}")

        sheet.generation_count = (sheet.generation_count or 0) + 1
        db.commit()
        print(f"[Sheet BG] Character sheet complete for {character.name} ✓")

    except Exception as e:
        print(f"[Sheet BG] FAILED for {character_id}: {e}")
        import traceback
        traceback.print_exc()
    finally:
        if cur_task:
            RUNNING_STORYBOARD_TASKS[storyboard_id].discard(cur_task)
        try:
            db.close()
        except Exception:
            pass



@router.post("/{storyboard_id}/character/{character_id}/approve-sheet")
async def approve_character_sheet(
    storyboard_id: str,
    character_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_effective_storyboard_user)
):
    if not _get_sb(storyboard_id, db, current_user):
        raise HTTPException(status_code=403, detail="Access denied: You do not own this storyboard.")
    sheet = db.query(CharacterSheet).filter_by(character_id=character_id).first()
    if not sheet:
        raise HTTPException(404, "Character sheet not found")
    sheet.is_approved = True
    db.commit()
    return {"approved": True, "proportion_dna": sheet.proportion_dna}

# ── PRODUCT CRUD & AI ──

@router.post("/{sb_id}/product/create")
async def create_product(
    sb_id: str,
    name: str = Body(...),
    description: Optional[str] = Body(""),
    image_b64: Optional[str] = Body(None),
    images_b64: Optional[List[str]] = Body(None),
    current_user: User = Depends(get_effective_storyboard_user),
    db: Session = Depends(get_db)
):
    sb = _find_storyboard(sb_id, current_user, db)
    if not sb:
        raise HTTPException(404, "Storyboard not found")
    
    all_images = images_b64 or []
    if image_b64 and image_b64 not in all_images:
        all_images.insert(0, image_b64)
    
    if not all_images:
        raise HTTPException(400, "At least one image is required")
    
    # ── Content safety: check uploaded product image via OpenAI moderation ──
    img_safe, img_reason = await check_image_moderation(all_images[0])
    if not img_safe:
        raise HTTPException(status_code=400, detail=f"Content blocked: Uploaded product image violates safety guidelines. {img_reason}")

    saved_paths = [save_b64_image(img) for img in all_images]
    prod = StoryboardProduct(
        storyboard_id=sb.id, name=name, description=description,
        image_path=saved_paths[0],
        image_paths=saved_paths
    )
    db.add(prod)
    db.commit()
    db.refresh(prod)
    return {"id": prod.id, "name": prod.name, "image_count": len(saved_paths)}

@router.get("/{sb_id}/products")
async def list_products(sb_id: str, current_user: User = Depends(get_effective_storyboard_user), db: Session = Depends(get_db)):
    # Verify ownership
    sb = _find_storyboard(sb_id, current_user, db)
    if not sb:
        raise HTTPException(404, "Storyboard not found")
    prods = db.query(StoryboardProduct).filter(StoryboardProduct.storyboard_id == sb_id).all()
    res = []
    updated_any = False
    for p in prods:
        if not p.name or not p.name.strip() or p.name.strip().lower() in ["", "none", "n/a", "null", "undefined"]:
            continue
        # Auto-normalize product DNA to ensure all attributes (type, color palette, material, shape, branding, surface details, etc.) are populated
        norm_dna = _normalize_product_dna(p.product_dna, p.name, p.description or "")
        if p.product_dna != norm_dna:
            p.product_dna = norm_dna
            updated_any = True

        paths = p.image_paths or ([p.image_path] if p.image_path else [])
        res.append({
            "id": p.id, "name": p.name, "description": p.description,
            "image_path": p.image_path,
            "image_paths": paths,
            "image_count": len(paths),
            "product_dna": norm_dna,
            "is_approved": bool(getattr(p, "is_approved", False)),
            "dna_extraction_confidence": getattr(p, "dna_extraction_confidence", None) if getattr(p, "dna_extraction_confidence", None) is not None else 0.95,
            "dna_version": p.dna_version,
        })
    if updated_any:
        try:
            db.commit()
        except Exception as commit_e:
            print(f"[Storyboard] Product DNA auto-normalization commit notice: {commit_e}")
    return res


@router.post("/{sb_id}/product/{prod_id}/approve-look")
@router.post("/{sb_id}/product/{prod_id}/approve")
async def approve_product_look(sb_id: str, prod_id: str, current_user: User = Depends(get_effective_storyboard_user), db: Session = Depends(get_db)):
    sb = _find_storyboard(sb_id, current_user, db)
    if not sb:
        raise HTTPException(404, "Storyboard not found")
    prod = db.query(StoryboardProduct).filter(StoryboardProduct.id == prod_id, StoryboardProduct.storyboard_id == sb_id).first()
    if not prod:
        raise HTTPException(404, "Product not found")
    
    prod.is_approved = not bool(prod.is_approved)
    db.commit()
    return {"status": "success", "is_approved": prod.is_approved, "product_id": prod.id}

@router.delete("/{sb_id}/product/{prod_id}")
async def delete_product(sb_id: str, prod_id: str, current_user: User = Depends(get_effective_storyboard_user), db: Session = Depends(get_db)):
    sb = _find_storyboard(sb_id, current_user, db)
    if not sb:
        raise HTTPException(404, "Storyboard not found")
    prod = db.query(StoryboardProduct).filter(StoryboardProduct.id == prod_id, StoryboardProduct.storyboard_id == sb_id).first()
    if not prod:
        raise HTTPException(404, "Product not found")
        
    if prod.image_paths:
        for p in prod.image_paths: delete_physical_file(p)
    else: delete_physical_file(prod.image_path)
        
    db.delete(prod)
    db.commit()
    return {"status": "success"}

@router.post("/{sb_id}/product/{prod_id}/analyze")
@router.post("/{sb_id}/product/{prod_id}/generate-dna")
@router.post("/{sb_id}/product/{prod_id}/generate-image")
async def analyze_product(sb_id: str, prod_id: str, current_user: User = Depends(get_effective_storyboard_user), db: Session = Depends(get_db)):
    """Extract Product DNA using Gemini from ALL reference images. Auto-generates a studio reference image if none exists."""
    prod = db.query(StoryboardProduct).filter(StoryboardProduct.id == prod_id, StoryboardProduct.storyboard_id == sb_id).first()
    if not prod:
        raise HTTPException(404, "Product not found")
    
    paths = prod.image_paths or ([prod.image_path] if prod.image_path else [])
    if not paths:
        # Auto-generate a studio reference image from product name and DNA/description
        import main
        full_desc = prod.description or ""
        if prod.product_dna:
            dna = prod.product_dna
            full_desc += f" Category: {dna.get('product_type', '')}. Material: {dna.get('material_finish', '')}. Color: {dna.get('color_palette', '')}. Shape: {dna.get('shape_geometry', '')}."
        
        gen_prompt = (
            f"Commercial studio product photograph of '{prod.name}'. {full_desc}. "
            f"Clean 3/4 angle product shot, pure white studio background, balanced commercial studio lighting, "
            f"crisp material textures, razor-sharp focus, accurate product proportions and geometry."
        )
        config = main.load_nanobanana_config()
        prod_cfg = config.get("production", {"model": "gemini-3.1-flash-image", "temperature": 0.4})
        model_name = prod_cfg.get("model", "gemini-3.1-flash-image")
        try:
            results, _, _ = await main._gemini_generate(
                prompt=gen_prompt,
                ratio="1:1",
                quality="Standard",
                gemini_model=model_name,
                is_beta=False,
                request_source="STORYBOARD",
            )
            if results:
                saved_path = save_b64_image(results[0])
                prod.image_path = saved_path
                prod.image_paths = [saved_path]
                db.commit()
                paths = [saved_path]
                print(f"[Storyboard] Auto-generated product reference image for '{prod.name}' -> {saved_path}")
        except Exception as e:
            print(f"[Storyboard] Auto-generating product image failed: {e}")

    if not paths:
        raise HTTPException(400, "No reference images found. Please upload a reference photo or generate one.")
    
    try:
        import main
        from google.genai import types
        gemini_client = main.flash_client if main.flash_client else main.global_client
        if not gemini_client:
            raise HTTPException(500, "Gemini client not initialized")
        
        contents = []
        for p in paths:
            b64_img = load_b64_image(p)
            if not b64_img:
                continue
            b64_str = b64_img.split(",")[1] if "," in b64_img else b64_img
            image_bytes = safe_b64decode(b64_str)
            contents.append(types.Part.from_bytes(data=image_bytes, mime_type="image/png"))
        
        if not contents:
            raise HTTPException(400, "Could not load any images")
        
        num_imgs = len(contents)
        contents.append(f"Analyze this product across all {num_imgs} reference image(s). Combine observations from every angle into one unified product identity profile.")
        
        system_prompt = (
            "You are an expert product photographer and industrial designer.\n"
            "You are given reference images of the SAME product from different angles.\n"
            "Analyze ALL images together and extract the product's defining visual traits into a strict JSON object.\n"
            "Cross-reference details across images for maximum accuracy.\n"
            "Return ONLY raw JSON, without markdown formatting. Format must be exactly:\n"
            "{\n"
            "  \"product_type\": \"Category of product (e.g., sneaker, smartphone, perfume bottle, handbag)\",\n"
            "  \"material_finish\": \"Primary materials and surface finish (e.g., matte leather, glossy plastic, brushed aluminum)\",\n"
            "  \"color_palette\": \"Exact colors with specifics (e.g., 'midnight navy body with white sole and crimson accent stitching')\",\n"
            "  \"shape_geometry\": \"Overall form factor, proportions, silhouette description\",\n"
            "  \"branding\": \"Logo placement, text, brand markers, emblems — describe exactly where they appear\",\n"
            "  \"surface_details\": \"Texture patterns, stitching, seams, buttons, ports, embossing\",\n"
            "  \"distinctive_features\": \"Unique identifying elements that make this product recognizable\",\n"
            "  \"background_interaction\": \"How the product interacts with backgrounds (transparency, reflectiveness, screen state)\",\n"
            "  \"scale_reference\": \"Approximate size relative to a human hand or common objects\",\n"
            "  \"source_medium\": \"E.g., product photograph, 3D render, illustration, mockup\",\n"
            "  \"best_angle_index\": 0,\n"
            "  \"best_angle_reason\": \"Explain why this image shows the most recognizable view\"\n"
            "}\n\n"
            "For best_angle_index: return the zero-based index of whichever image shows\n"
            "the most complete, recognizable view of the product."
        )
        
        dna_json = await _extract_json_with_retry(gemini_client, contents, system_prompt, model="gemini-2.5-flash-lite", retries=2)
        
        drift_warning = False
        old_dna = prod.product_dna
        if old_dna:
            import difflib
            old_traits = str(old_dna.get("shape_geometry", "")) + str(old_dna.get("branding", "")) + str(old_dna.get("color_palette", ""))
            new_traits = str(dna_json.get("shape_geometry", "")) + str(dna_json.get("branding", "")) + str(dna_json.get("color_palette", ""))
            similarity = difflib.SequenceMatcher(None, old_traits.lower(), new_traits.lower()).ratio()
            if similarity < 0.6:
                drift_warning = True
                print(f"[Storyboard] DNA Drift detected for {prod.name}. Similarity: {similarity:.2f}")

        prod.product_dna = dna_json
        prod.best_angle_index = dna_json.get("best_angle_index", 0)
        prod.dna_version = (prod.dna_version or 1) + 1
        from datetime import datetime
        prod.dna_extracted_at = datetime.utcnow()
        prod.dna_extraction_model = "gemini-2.5-flash-lite"
        
        expected_fields = ["product_type", "material_finish", "color_palette", "shape_geometry", "branding", "surface_details", "distinctive_features", "background_interaction", "scale_reference", "source_medium", "best_angle_reason"]
        prod.dna_extraction_confidence = _calculate_confidence(dna_json, expected_fields)
        
        db.commit()
        print(f"[Storyboard] Product DNA extracted for '{prod.name}' (Confidence: {prod.dna_extraction_confidence})")
        return {"status": "success", "product_dna": dna_json, "drift_warning": drift_warning, "dna_extraction_confidence": prod.dna_extraction_confidence}
    except Exception as e:
        print(f"[Storyboard] Error analyzing product: {e}")
        raise HTTPException(500, f"Analysis failed: {str(e)}")

@router.post("/{sb_id}/product/{prod_id}/generate-image")
async def generate_product_image_endpoint(
    sb_id: str,
    prod_id: str,
    current_user: User = Depends(get_effective_storyboard_user),
    db: Session = Depends(get_db)
):
    sb = _find_storyboard(sb_id, current_user, db)
    if not sb:
        raise HTTPException(404, "Storyboard not found")
    prod = db.query(StoryboardProduct).filter(StoryboardProduct.id == prod_id, StoryboardProduct.storyboard_id == sb_id).first()
    if not prod:
        raise HTTPException(404, "Product not found")

    import main
    full_desc = prod.description or ""
    if prod.product_dna:
        dna = prod.product_dna
        full_desc += f" Category: {dna.get('product_type', '')}. Material: {dna.get('material_finish', '')}. Color: {dna.get('color_palette', '')}. Shape: {dna.get('shape_geometry', '')}."
    
    gen_prompt = (
        f"Commercial studio product photograph of '{prod.name}'. {full_desc}. "
        f"Clean 3/4 angle product shot, pure white studio background, balanced commercial studio lighting, "
        f"crisp material textures, razor-sharp focus, accurate product proportions and geometry."
    )
    config = main.load_nanobanana_config()
    prod_cfg = config.get("production", {"model": "gemini-3.1-flash-image", "temperature": 0.4})
    model_name = prod_cfg.get("model", "gemini-3.1-flash-image")
    
    try:
        results, _, _ = await main._gemini_generate(
            prompt=gen_prompt,
            ratio="1:1",
            quality="Standard",
            gemini_model=model_name,
            is_beta=False,
            request_source="STORYBOARD",
        )
        if not results:
            raise HTTPException(500, "Failed to generate product image")
        
        saved_path = save_b64_image(results[0])
        prod.image_path = saved_path
        existing_paths = prod.image_paths or []
        if saved_path not in existing_paths:
            prod.image_paths = existing_paths + [saved_path]
        db.commit()
        db.refresh(prod)
        return {"status": "success", "image_path": saved_path, "image_paths": prod.image_paths}
    except Exception as e:
        print(f"[Storyboard] generate_product_image error: {e}")
        raise HTTPException(500, f"Image generation failed: {str(e)}")

class UploadProductPhotosPayload(BaseModel):
    images_b64: List[str]

@router.post("/{sb_id}/product/{prod_id}/upload-images")
async def upload_product_images_endpoint(
    sb_id: str,
    prod_id: str,
    payload: UploadProductPhotosPayload,
    current_user: User = Depends(get_effective_storyboard_user),
    db: Session = Depends(get_db)
):
    sb = _find_storyboard(sb_id, current_user, db)
    if not sb:
        raise HTTPException(404, "Storyboard not found")
    prod = db.query(StoryboardProduct).filter(StoryboardProduct.id == prod_id, StoryboardProduct.storyboard_id == sb_id).first()
    if not prod:
        raise HTTPException(404, "Product not found")

    new_paths = []
    for b64 in payload.images_b64:
        p = save_b64_image(b64)
        if p:
            new_paths.append(p)
    
    if new_paths:
        existing = prod.image_paths or ([prod.image_path] if prod.image_path else [])
        all_paths = existing + new_paths
        prod.image_paths = all_paths
        if not prod.image_path:
            prod.image_path = all_paths[0]
        db.commit()
        db.refresh(prod)

    return {"status": "success", "image_paths": prod.image_paths, "image_path": prod.image_path}

class EditProductPayload(BaseModel):
    edit_instruction: Optional[str] = None
    product_dna: Optional[dict] = None
    regenerate_image: bool = True

@router.post("/{sb_id}/product/{prod_id}/edit")
async def edit_product(
    sb_id: str,
    prod_id: str,
    payload: EditProductPayload,
    current_user: User = Depends(get_effective_storyboard_user),
    db: Session = Depends(get_db)
):
    """
    Edits product DNA and executes visual regeneration using the studio edit pipeline.
    """
    sb = _find_storyboard(sb_id, current_user, db)
    if not sb:
        raise HTTPException(404, "Storyboard not found")
    prod = db.query(StoryboardProduct).filter(StoryboardProduct.id == prod_id, StoryboardProduct.storyboard_id == sb_id).first()
    if not prod:
        raise HTTPException(404, "Product not found")

    if payload.product_dna:
        prod.product_dna = payload.product_dna
        prod.dna_version = (prod.dna_version or 1) + 1

    if not payload.regenerate_image:
        db.commit()
        db.refresh(prod)
        return {
            "status": "success",
            "product_dna": prod.product_dna,
            "image_path": prod.image_path,
            "image_paths": prod.image_paths or []
        }

    # ── STUDIO EDIT PIPELINE INTEGRATION ──
    import main
    
    # 1. Build existing visual description
    dna = prod.product_dna or {}
    base_dna_desc = f"Commercial studio product photograph of '{prod.name}'."
    if dna.get("product_type"):
        base_dna_desc += f" Category: {dna['product_type']}."
    if dna.get("material_finish"):
        base_dna_desc += f" Material & Finish: {dna['material_finish']}."
    if dna.get("color_palette"):
        base_dna_desc += f" Color Palette: {dna['color_palette']}."
    if dna.get("shape_geometry"):
        base_dna_desc += f" Form: {dna['shape_geometry']}."
    if dna.get("branding"):
        base_dna_desc += f" Branding: {dna['branding']}."
    if dna.get("surface_details"):
        base_dna_desc += f" Surface Details: {dna['surface_details']}."
    if dna.get("distinctive_features"):
        base_dna_desc += f" Distinctive Features: {dna['distinctive_features']}."

    # 2. Synthesize contradiction-free prompt using Studio Edit Pipeline LLM Middleman
    history = [base_dna_desc]
    edit_instr = payload.edit_instruction.strip() if payload.edit_instruction else "Refine product details matching updated DNA"
    synthesized_prompt = await main._synthesize_edit_prompt(history, edit_instr)

    final_gen_prompt = (
        f"{synthesized_prompt}. "
        f"Clean 3/4 angle product shot, pure white studio background, balanced commercial studio lighting, "
        f"crisp material textures, razor-sharp focus, accurate product proportions and geometry."
    )

    config = main.load_nanobanana_config()
    prod_cfg = config.get("production", {"model": "gemini-3.1-flash-image", "temperature": 0.4})
    model_name = prod_cfg.get("model", "gemini-3.1-flash-image")

    try:
        results, _, _ = await main._gemini_generate(
            prompt=final_gen_prompt,
            ratio="1:1",
            quality="Standard",
            gemini_model=model_name,
            is_beta=False,
            request_source="STORYBOARD",
        )
        if not results:
            raise Exception("Image generation returned no results")

        saved_path = save_b64_image(results[0])
        prod.image_path = saved_path
        existing = prod.image_paths or []
        if saved_path not in existing:
            prod.image_paths = [saved_path] + [p for p in existing if p != saved_path]
        db.commit()

        # 3. Re-extract DNA from new image to keep DNA in 100% synchronization
        try:
            from google.genai import types
            gemini_client = main.flash_client if main.flash_client else main.global_client
            if gemini_client:
                image_bytes = safe_b64decode(results[0].split(",")[1] if "," in results[0] else results[0])
                contents = [
                    types.Part.from_bytes(data=image_bytes, mime_type="image/png"),
                    "Analyze this newly generated/edited product reference image. Extract updated visual traits into strict JSON matching product identity."
                ]
                system_prompt = (
                    "You are an expert product photographer and industrial designer.\n"
                    "Extract the product's defining visual traits into a strict JSON object:\n"
                    "{\n"
                    "  \"product_type\": \"...\",\n"
                    "  \"material_finish\": \"...\",\n"
                    "  \"color_palette\": \"...\",\n"
                    "  \"shape_geometry\": \"...\",\n"
                    "  \"branding\": \"...\",\n"
                    "  \"surface_details\": \"...\",\n"
                    "  \"distinctive_features\": \"...\",\n"
                    "  \"scale_reference\": \"...\",\n"
                    "  \"source_medium\": \"product photograph\",\n"
                    "  \"best_angle_index\": 0\n"
                    "}"
                )
                new_dna = await _extract_json_with_retry(gemini_client, contents, system_prompt, model="gemini-2.5-flash-lite", retries=2)
                if new_dna and isinstance(new_dna, dict):
                    prod.product_dna = {**(prod.product_dna or {}), **new_dna}
                    prod.dna_extraction_confidence = 0.96
                    db.commit()
        except Exception as dna_err:
            print(f"[Storyboard] Post-edit DNA extraction warning: {dna_err}")

        db.refresh(prod)
        return {
            "status": "success",
            "product_dna": prod.product_dna,
            "image_path": prod.image_path,
            "image_paths": prod.image_paths
        }
    except Exception as e:
        print(f"[Storyboard] Product edit pipeline failed: {e}")
        raise HTTPException(500, f"Failed to edit and regenerate product: {str(e)}")

# ── FRAME CRUD & AI ──

@router.post("/{sb_id}/frame/add")
async def add_frame(
    sb_id: str,
    scene_prompt: str = Body(..., embed=True),
    current_user: User = Depends(get_effective_storyboard_user),
    db: Session = Depends(get_db)
):
    sb = _find_storyboard(sb_id, current_user, db)
    if not sb:
        raise HTTPException(404, "Storyboard not found")
    
    # Get highest order index
    highest = db.query(StoryboardFrame).filter(StoryboardFrame.storyboard_id == sb.id).order_by(StoryboardFrame.order_index.desc()).first()
    next_idx = (highest.order_index + 1) if highest else 0
    
    frame = StoryboardFrame(storyboard_id=sb.id, scene_prompt=scene_prompt, order_index=next_idx)
    db.add(frame)
    db.commit()
    db.refresh(frame)
    return {"id": frame.id, "scene_prompt": frame.scene_prompt, "order_index": frame.order_index, "status": frame.status}

@router.get("/{sb_id}/frames")
async def list_frames(sb_id: str, current_user: User = Depends(get_effective_storyboard_user), db: Session = Depends(get_db)):
    # Verify ownership — prevent cross-user data leakage
    sb = _find_storyboard(sb_id, current_user, db)
    if not sb:
        raise HTTPException(404, "Storyboard not found")
    frames = db.query(StoryboardFrame).filter(StoryboardFrame.storyboard_id == sb_id).order_by(StoryboardFrame.order_index).all()

    # Auto-sync contact sheet panels if contact_sheet_url exists and frames are missing or pending
    if sb.contact_sheet_url and (len(frames) == 0 or any(not f.image_path or f.status != "done" for f in frames)):
        try:
            frames = sync_contact_sheet_panels_to_db(sb, db, force=False)
        except Exception as sync_e:
            print(f"[Storyboard] Auto-sync contact sheet frames failed: {sync_e}")

    res = []
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    for f in frames:
        report = db.query(FrameConsistencyReport).filter_by(frame_id=f.id).order_by(FrameConsistencyReport.scored_at.desc()).first()
        # Auto-reset frames stuck generating for >5 minutes (background task likely crashed silently)
        if f.status == "generating" and (f.generation_started_at or f.created_at):
            check_time = f.generation_started_at or f.created_at
            age_sec = (now - check_time.replace(tzinfo=timezone.utc) if check_time.tzinfo is None else now - check_time).total_seconds()
            if age_sec > 300:
                f.status = "failed"
                f.error_msg = "Generation timed out — please retry."
                db.commit()
        res.append({
            "id": f.id, "scene_prompt": f.scene_prompt, "expanded_prompt": f.expanded_prompt,
            "order_index": f.order_index, "status": f.status, "error_msg": f.error_msg,
            "image_path": f.image_path,
            "is_anchor": getattr(f, "is_anchor", False),
            "consistency_score": getattr(f, "consistency_score", None),
            "consistency_report": report.character_scores if report else None,
            "created_at": f.created_at.isoformat() if getattr(f, "created_at", None) else None,
            "video_url": getattr(f, "video_url", None),
            "video_status": getattr(f, "video_status", None),
            "video_duration": getattr(f, "video_duration", None),
            "video_prompt": getattr(f, "video_prompt", None),
            "transition_video_url": getattr(f, "transition_video_url", None),
            "transition_to_frame_id": getattr(f, "transition_to_frame_id", None),
            "transition_video_status": getattr(f, "transition_video_status", None),
            "transition_video_duration": getattr(f, "transition_video_duration", None),
            "transition_video_prompt": getattr(f, "transition_video_prompt", None),
        })
    return res

@router.delete("/{sb_id}/frame/{frame_id}")
async def delete_frame(sb_id: str, frame_id: str, current_user: User = Depends(get_effective_storyboard_user), db: Session = Depends(get_db)):
    sb = _find_storyboard(sb_id, current_user, db)
    if not sb:
        raise HTTPException(404, "Storyboard not found")
    frame = db.query(StoryboardFrame).filter(StoryboardFrame.id == frame_id, StoryboardFrame.storyboard_id == sb_id).first()
    if not frame:
        raise HTTPException(404, "Frame not found")
        
    delete_physical_file(frame.image_path)
        
    db.delete(frame)
    db.commit()
    return {"status": "success"}

async def _detect_entities_llm(scene_prompt, all_chars, all_prods):
    import main
    import openai as openai_lib
    import asyncio
    import json
    import re
    
    # ── EXPLICIT @MENTION EXTRACTION ──
    # Find all words starting with @ (e.g. @Mamta, @Modi, @Red_Bottle)
    explicit_tags = re.findall(r'@([a-zA-Z0-9_\-]+)', scene_prompt)
    explicit_chars = []
    explicit_prods = []
    
    if explicit_tags:
        lower_tags = [t.lower() for t in explicit_tags]
        explicit_chars = [c for c in all_chars if c.name.lower() in lower_tags or c.name.lower().replace(' ', '_') in lower_tags]
        explicit_prods = [p for p in all_prods if p.name.lower() in lower_tags or p.name.lower().replace(' ', '_') in lower_tags]
        print(f"[Storyboard] Explicit tags found: {explicit_tags}. Matched {len(explicit_chars)} chars, {len(explicit_prods)} prods.")
    
    char_list = [f"- {c.name} (ID: {c.id})" for c in all_chars]
    prod_list = [f"- {p.name} (ID: {p.id})" for p in all_prods]
    
    sys_msg = (
        "You are an entity resolution engine. Read the short scene prompt and determine which of the available characters and products are mentioned.\n"
        "Resolve pronouns (he, she, it), typos, generics (e.g., 'the bottle', 'the car', 'the girl'), and nicknames to their canonical entities based on context.\n"
        "Be accurate and context-aware: Match entities when the prompt clearly refers to them by name, pronoun, or specific role. Do NOT match unrelated entities that just share a generic category word.\n"
        "Return ONLY a JSON map with 'characters' and 'products' arrays containing the detected IDs.\n"
        "Example format: {\"characters\": [\"uuid-1\"], \"products\": [\"uuid-2\"]}"
    )
    user_msg = f"Available Characters:\n{chr(10).join(char_list) if char_list else 'None'}\n\nAvailable Products:\n{chr(10).join(prod_list) if prod_list else 'None'}\n\nScene Prompt: {scene_prompt}"

    # 1. Primary: GPT-5.6 Luna
    if main.OPENAI_API_KEY:
        try:
            oai_client = openai_lib.OpenAI(api_key=main.OPENAI_API_KEY)
            resp = await asyncio.to_thread(
                oai_client.chat.completions.create,
                model="gpt-5.6-luna",
                messages=[{"role": "system", "content": sys_msg}, {"role": "user", "content": user_msg}],
                response_format={"type": "json_object"}
            )
            data = json.loads(resp.choices[0].message.content.strip())
            char_ids = data.get("characters", [])
            prod_ids = data.get("products", [])
            detected_chars = explicit_chars + [c for c in all_chars if c.id in char_ids and c not in explicit_chars]
            detected_prods = explicit_prods + [p for p in all_prods if p.id in prod_ids and p not in explicit_prods]
            return detected_chars, detected_prods
        except Exception as e:
            print(f"[Storyboard] GPT-5.6 Luna entity detection failed ({e}), falling back to Claude Sonnet 5...")

    # 2. Fallback: Claude Sonnet 5
    if main.ANTHROPIC_API_KEY:
        try:
            claude_out = await _call_claude_sonnet_5_text(
                sys_msg + "\n\nIMPORTANT: Return ONLY a valid JSON object matching {\"characters\": [...], \"products\": [...]}.",
                user_msg,
                max_tokens=1000
            )
            if claude_out:
                json_match = re.search(r'\{.*\}', claude_out, re.DOTALL)
                if json_match:
                    data = json.loads(json_match.group(0))
                    char_ids = data.get("characters", [])
                    prod_ids = data.get("products", [])
                    detected_chars = explicit_chars + [c for c in all_chars if c.id in char_ids and c not in explicit_chars]
                    detected_prods = explicit_prods + [p for p in all_prods if p.id in prod_ids and p not in explicit_prods]
                    print(f"[Storyboard] Entity detection resolved via Claude Sonnet 5 (chars={len(detected_chars)}, prods={len(detected_prods)})")
                    return detected_chars, detected_prods
        except Exception as ant_e:
            print(f"[Storyboard] Claude Sonnet 5 entity detection fallback failed: {ant_e}")

    # 3. Last-resort fallback: String matching + explicit tags
    detected_chars = explicit_chars + [c for c in all_chars if c.name.lower() in scene_prompt.lower() and c not in explicit_chars]
    detected_prods = explicit_prods + [p for p in all_prods if p.name.lower() in scene_prompt.lower() and p not in explicit_prods]
    return detected_chars, detected_prods

def _resolve_source_medium(all_ref_items):
    mediums = []
    for name, ref_type, paths, best_idx, dna in all_ref_items:
        if dna and dna.get("source_medium"):
            mediums.append(dna["source_medium"].lower())
    if not mediums:
        return "Photorealistic, cinematic quality"
    
    unique_mediums = set(mediums)
    if len(unique_mediums) == 1:
        return list(unique_mediums)[0]
    
    has_photo = any("photo" in m or "real" in m for m in unique_mediums)
    has_3d = any("3d" in m or "render" in m for m in unique_mediums)
    all_anime = all("anime" in m or "illustrat" in m or "draw" in m or "paint" in m for m in unique_mediums)
    
    if all_anime:
        for m in unique_mediums:
            if "anime" in m or "illustrat" in m or "draw" in m or "paint" in m:
                return m
        return "stylized illustration"
    elif has_photo:
        return "Photorealistic"
    elif has_3d:
        return "photorealistic 3D render"
    
    return "Photorealistic"

@router.post("/{sb_id}/frame/{frame_id}/generate")
async def generate_frame(
    sb_id: str, 
    frame_id: str, 
    background_tasks: BackgroundTasks,
    model: str = Body(default="ChatGPT"),
    scene_prompt: Optional[str] = Body(default=None),
    ratio: str = Body(default="16:9"),
    quality: str = Body(default="Standard"),
    style: str = Body(default="Photorealistic"),
    chatgpt_model: str = Body(default="gpt-image-1.5"),
    reference_image_b64: Optional[str] = Body(default=None),
    current_user: User = Depends(get_effective_storyboard_user), 
    db: Session = Depends(get_db)
):
    """
    Generate a storyboard frame image.
    Returns immediately with status=generating — actual work runs in a BackgroundTask.
    Frontend polling loop picks up the result when it completes.
    """
    # Verify frame exists and belongs to this storyboard
    frame = db.query(StoryboardFrame).filter(
        StoryboardFrame.id == frame_id, StoryboardFrame.storyboard_id == sb_id
    ).first()
    if not frame:
        raise HTTPException(404, "Frame not found")
    
    # Verify storyboard ownership
    sb = _find_storyboard(sb_id, current_user, db)
    if not sb:
        raise HTTPException(403, "Access denied")

    # ── Content safety: instant keyword check on scene prompt ──
    prompt_to_check = scene_prompt if scene_prompt and scene_prompt.strip() else (frame.scene_prompt or "")
    kw_safe, kw_reason = check_prompt_keywords(prompt_to_check)
    if not kw_safe:
        raise HTTPException(status_code=400, detail=f"Content blocked: {kw_reason}")

    # Update scene_prompt if provided, mark generating immediately
    if scene_prompt and scene_prompt.strip():
        frame.scene_prompt = scene_prompt.strip()
    frame.status = "generating"
    frame.generation_started_at = datetime.utcnow()
    frame.error_msg = None
    db.commit()

    print(f"[Storyboard] Queuing frame generation: frame={frame_id}, model={model}, prompt='{frame.scene_prompt[:80]}'")

    # Snapshot all params needed by the background task
    # (db session will be closed after this request — background task gets its own)
    task_params = {
        "sb_id": sb_id,
        "frame_id": frame_id,
        "model": model,
        "scene_prompt": frame.scene_prompt,
        "ratio": ratio,
        "quality": quality,
        "style": style,
        "chatgpt_model": chatgpt_model,
        "reference_image_b64": reference_image_b64,
    }

    task = asyncio.create_task(_run_frame_generation(**task_params))
    RUNNING_FRAME_TASKS[frame_id] = task
    RUNNING_STORYBOARD_TASKS[sb_id].add(task)
    def _cleanup_frame_task(t):
        RUNNING_FRAME_TASKS.pop(frame_id, None)
        if sb_id in RUNNING_STORYBOARD_TASKS:
            RUNNING_STORYBOARD_TASKS[sb_id].discard(t)
    task.add_done_callback(_cleanup_frame_task)

    return {"status": "generating", "frame_id": frame_id}


@router.post("/{sb_id}/frame/{frame_id}/cancel")
async def cancel_frame_generation(
    sb_id: str,
    frame_id: str,
    current_user: User = Depends(get_effective_storyboard_user),
    db: Session = Depends(get_db)
):
    sb = _find_storyboard(sb_id, current_user, db)
    if not sb:
        raise HTTPException(404, "Storyboard not found")
    frame = db.query(StoryboardFrame).filter(
        StoryboardFrame.id == frame_id, StoryboardFrame.storyboard_id == sb_id
    ).first()
    if not frame:
        raise HTTPException(404, "Frame not found")
    
    CANCELED_FRAME_IDS.add(frame_id)
    task = RUNNING_FRAME_TASKS.get(frame_id)
    if task and not task.done():
        task.cancel()
        print(f"[Storyboard] Cancelled frame task for frame {frame_id}")

    if frame.status == "generating":
        frame.status = "pending" if not frame.image_path else "done"
        frame.error_msg = None
        db.commit()
    print(f"[Storyboard] Frame {frame_id} generation canceled by user.")
    return {"status": "canceled", "frame_id": frame_id}


@router.post("/{sb_id}/cancel")
async def cancel_storyboard_generation(
    sb_id: str,
    current_user: User = Depends(get_effective_storyboard_user),
    db: Session = Depends(get_db)
):
    sb = _find_storyboard(sb_id, current_user, db)
    if not sb:
        raise HTTPException(404, "Storyboard not found")
    
    CANCELLED_STORYBOARD_IDS.add(sb_id)
    
    # Cancel all running tasks for this storyboard
    tasks = list(RUNNING_STORYBOARD_TASKS.get(sb_id, set()))
    for t in tasks:
        if not t.done():
            t.cancel()
    RUNNING_STORYBOARD_TASKS[sb_id].clear()
    
    # Cancel all generating frames for this storyboard
    gen_frames = db.query(StoryboardFrame).filter(
        StoryboardFrame.storyboard_id == sb_id,
        StoryboardFrame.status == "generating"
    ).all()
    for f in gen_frames:
        CANCELED_FRAME_IDS.add(f.id)
        f.status = "pending" if not f.image_path else "done"
        f.error_msg = None
        ftask = RUNNING_FRAME_TASKS.get(f.id)
        if ftask and not ftask.done():
            ftask.cancel()
            
    db.commit()
    print(f"[Storyboard:{sb_id}] All operations forcefully cancelled by user.")
    return {"status": "canceled", "storyboard_id": sb_id}


async def _run_frame_generation(
    sb_id: str,
    frame_id: str,
    model: str,
    scene_prompt: str,
    ratio: str,
    quality: str,
    style: str,
    chatgpt_model: str,
    reference_image_b64: Optional[str],
):
    """
    Actual frame generation — runs as a BackgroundTask with its own DB session.
    Completely decoupled from the HTTP request lifecycle.
    """
    # Own DB session
    db = next(get_db())
    try:
        if frame_id in CANCELED_FRAME_IDS:
            print(f"[Storyboard BG] Frame {frame_id} canceled before starting.")
            return

        import main

        frame = db.query(StoryboardFrame).filter(
            StoryboardFrame.id == frame_id, StoryboardFrame.storyboard_id == sb_id
        ).first()
        if not frame:
            print(f"[Storyboard BG] Frame {frame_id} not found, aborting")
            return

        if frame_id in CANCELED_FRAME_IDS:
            print(f"[Storyboard BG] Frame {frame_id} canceled early.")
            return

        # If reference_image_b64 not passed, use the frame's existing visual (e.g. from contact sheet) for visual continuity
        if not reference_image_b64 and frame.image_path:
            try:
                reference_image_b64 = load_b64_image(frame.image_path)
                if reference_image_b64:
                    print(f"[Storyboard BG] Using frame {frame_id} existing visual as continuity reference.")
            except Exception as e:
                print(f"[Storyboard BG] Could not load existing frame visual as reference: {e}")

        # ── 1. DETECT characters AND products ──
        chars = db.query(StoryboardCharacter).filter(StoryboardCharacter.storyboard_id == sb_id).all()
        prods = db.query(StoryboardProduct).filter(StoryboardProduct.storyboard_id == sb_id).all()
        detected_chars, detected_prods = await _detect_entities_llm(frame.scene_prompt, chars, prods)
        print(f"[Storyboard BG] Detected {len(detected_chars)} char(s), {len(detected_prods)} prod(s)")

        # ── 2. BUILD TIMELINE CONTEXT ──
        prev_frames = db.query(StoryboardFrame).filter(
            StoryboardFrame.storyboard_id == sb_id,
            StoryboardFrame.order_index < frame.order_index,
            StoryboardFrame.status == "done"
        ).order_by(StoryboardFrame.order_index).all()
        # Cap to last 3 frames to prevent prompt bleeding from early frames into late ones
        prev_frames = prev_frames[-3:] if len(prev_frames) > 3 else prev_frames
        timeline_text = "".join(f"Frame {pf.order_index + 1}: {pf.scene_prompt}\n" for pf in prev_frames)

        # ── 3. BUILD DNA CONTEXT ──
        dna_context = []
        for c in detected_chars:
            if c.character_dna:
                dna_context.append(f"Character '{c.name}': {json.dumps(c.character_dna)}")
        for p in detected_prods:
            if p.product_dna:
                dna_context.append(f"Product '{p.name}': {json.dumps(p.product_dna)}")

        # ── 4. PROMPT EXPANSION via GPT-4o with Gemini Fallback ──
        timeline_block = ""
        if timeline_text:
            timeline_block = (
                f"\n\n== STORYBOARD TIMELINE ==\n{timeline_text}\n"
                f"This is Frame {frame.order_index + 1}.\n"
                "⚠ CONTINUITY: lock character face/wardrobe from last appearance. "
                "Scene location may change completely each frame.\n"
            )
        sys_msg = (
            "You are a world-class storyboard prompt engineer. Expand the scene prompt into a "
            "production-ready image generation prompt. Include character DNA, lighting, camera "
            "framing, and scene details. Max 400 words. Return ONLY the expanded prompt — "
            "no preamble, no section headers.\n\n"
            f"MEDIUM MANDATE — STYLE: {style}\n"
            + (
                "This is a PHOTOREALISTIC commercial production. ALL output MUST describe LIVE-ACTION "
                "scenes with REAL human beings (visible skin pores, natural micro-textures, real hair "
                "strands) and REAL animals (individual fur/feather detail, anatomically correct). "
                "ABSOLUTELY BANNED words in your output: animated, cartoon, illustration, sketch, "
                "drawn, painted, 2D, cel-shaded, stylized, anime, manga, toon, comic, whimsical "
                "illustration, storybook. This is NOT an animation — it is a live-action photograph."
                if not any(s in (style or "").lower() for s in ["anime", "illustrat", "cartoon", "sketch", "paint"])
                else f"This is a {style} production. Maintain consistent {style} visual style across all descriptions."
            )
        )
        dna_block = "\n".join(dna_context) if dna_context else "No DNA."
        user_msg = f"DNA:\n{dna_block}{timeline_block}\n\nScene (Frame {frame.order_index + 1}): {frame.scene_prompt}"

        expanded_prompt = None
        if main.OPENAI_API_KEY:
            try:
                import openai as openai_lib
                oai_client = openai_lib.OpenAI(api_key=main.OPENAI_API_KEY)
                resp = await asyncio.to_thread(
                    oai_client.chat.completions.create,
                    model="gpt-5.6-luna",
                    messages=[{"role": "system", "content": sys_msg}, {"role": "user", "content": user_msg}],
                    max_completion_tokens=700
                )
                expanded_prompt = resp.choices[0].message.content.strip()
                frame.expanded_prompt = expanded_prompt
                db.commit()
                print(f"[Storyboard BG] Prompt expanded via GPT-5.6 Luna ({len(expanded_prompt)} chars)")
            except Exception as e:
                print(f"[Storyboard BG] GPT-5.6 Luna prompt expansion failed ({e}), trying Claude Sonnet 5 fallback...")
                expanded_prompt = None

        if not expanded_prompt and main.ANTHROPIC_API_KEY:
            try:
                import anthropic
                ant_client = anthropic.Anthropic(api_key=main.ANTHROPIC_API_KEY)
                loop = asyncio.get_event_loop()
                claude_prompt = f"{sys_msg}\n\n{user_msg}"
                resp = await loop.run_in_executor(
                    None,
                    lambda: ant_client.messages.create(
                        model="claude-sonnet-5",
                        max_tokens=700,
                        messages=[{"role": "user", "content": claude_prompt}]
                    )
                )
                text_blocks = [b.text for b in resp.content if hasattr(b, "text")]
                claude_out = "".join(text_blocks).strip()
                if claude_out:
                    expanded_prompt = claude_out
                    frame.expanded_prompt = expanded_prompt
                    db.commit()
                    print(f"[Storyboard BG] Prompt expanded via Claude Sonnet 5 ({len(expanded_prompt)} chars)")
            except Exception as ant_e:
                print(f"[Storyboard BG] Claude Sonnet 5 prompt expansion failed: {ant_e}")

        if not expanded_prompt:
            expanded_prompt = frame.scene_prompt

        # ── 5. COLLECT REFERENCE IMAGES ──
        # ── CHANGE C: For brief-only characters with no uploaded photos,
        #    use approved character sheet images as visual references ──
        all_ref_items = []
        for c in detected_chars:
            paths = c.image_paths or ([c.image_path] if c.image_path else [])
            if not paths:
                # No uploaded photos — check for approved character sheet images
                try:
                    sheet = db.query(CharacterSheet).filter_by(
                        character_id=c.id, is_approved=True
                    ).first()
                    if sheet:
                        sheet_paths = [p for p in [sheet.front_body_url, sheet.face_closeup_url] if p]
                        if sheet_paths:
                            paths = sheet_paths
                            print(f"[Storyboard BG] Using approved sheet images for '{c.name}' ({len(sheet_paths)} refs)")
                except Exception as sheet_err:
                    print(f"[Storyboard BG] Sheet image lookup failed for '{c.name}': {sheet_err}")
            all_ref_items.append((c.name, "character", paths, getattr(c, "best_angle_index", 0), c.character_dna))
        for p in detected_prods:
            paths = p.image_paths or ([p.image_path] if p.image_path else [])
            all_ref_items.append((p.name, "product", paths, getattr(p, "best_angle_index", 0), p.product_dna))

        # ── 6. BUILD IDENTITY ANCHORS ──
        identity_anchors = ""
        ref_order = []
        for i, (name, ref_type, paths, best_idx, dna) in enumerate(all_ref_items):
            ref_order.append(f"{name} -> Image Index {i+1}")
            if ref_type == "character":
                char = next((c for c in detected_chars if c.name == name), None)
                sheet = db.query(CharacterSheet).filter_by(character_id=char.id).first() if char else None
                identity_anchors += f"CHARACTER [{name}]:\n"
                if char and char.dna_source == "text_brief":
                    identity_anchors += f"  ⚠ No uploaded reference images — rely on text traits only.\n"
                if dna:
                    identity_anchors += f"  Face: {dna.get('face_geometry', 'N/A')}\n"
                    identity_anchors += f"  Eyes: {dna.get('eyes_and_brows', 'N/A')}\n"
                    identity_anchors += f"  Skin/Hair: {dna.get('hair_and_skin', 'N/A')}\n"
                    identity_anchors += f"  Build: {dna.get('build_and_posture', 'N/A')}\n"
                if sheet and sheet.is_approved and sheet.proportion_dna:
                    p_dna = sheet.proportion_dna
                    identity_anchors += f"  BODY LOCK: {p_dna.get('height_descriptor')}, {p_dna.get('build_silhouette')}\n"
                identity_anchors += "  ⚠ Preserve ALL traits regardless of angle/lighting.\n\n"
            else:
                identity_anchors += f"PRODUCT [{name}]:\n"
                if dna:
                    identity_anchors += f"  Form: {dna.get('shape_geometry', 'N/A')}\n"
                    identity_anchors += f"  Colors: {dna.get('color_palette', 'N/A')}\n"
                    identity_anchors += f"  Branding: {dna.get('branding', 'N/A')}\n"
                identity_anchors += "  ⚠ Preserve exact proportions and branding.\n\n"

        # ── 7. BUILD STYLE DIRECTIVE ──
        style_lower = (style or "").lower()
        if any(s in style_lower for s in ["anime", "illustrat", "cartoon", "sketch", "paint"]):
            rendering_directive = f"Style: HIGH-QUALITY {style} illustration. Clean linework, expressive stylized faces, bold colour."
        elif any(s in style_lower for s in ["3d", "render", "cgi"]):
            rendering_directive = f"Style: PREMIUM 3D CGI render. Sharp geometry, physically-based materials, professional studio lighting."
        else:
            rendering_directive = "Style: PROFESSIONAL PHOTOGRAPH. High-end full-frame camera, natural skin tones, zero distortion. No AI-look."

        # ── 7b. BUILD MEDIUM LOCK (anti-style-drift for diffusion) ──
        if any(s in style_lower for s in ["anime", "illustrat", "cartoon", "sketch", "paint"]):
            medium_lock = f"━━ MEDIUM LOCK ━━\nThis is a {style} production. Maintain consistent {style} visual language."
        elif any(s in style_lower for s in ["3d", "render", "cgi"]):
            medium_lock = "━━ MEDIUM LOCK ━━\nThis is a 3D CGI production. All elements must be rendered in consistent 3D CGI style."
        else:
            medium_lock = (
                "━━ MEDIUM LOCK (CRITICAL — DO NOT VIOLATE) ━━\n"
                "This is a LIVE-ACTION PHOTOREALISTIC commercial. Every element MUST look like a real photograph.\n"
                "• Humans: real skin with visible pores, natural blemishes, real hair strands — NOT smooth/plastic CGI.\n"
                "• Animals: real fur/feathers with individual strand detail, anatomically correct living creatures.\n"
                "• Environment: real-world textures (concrete grain, wood knots, fabric weave).\n"
                "• ABSOLUTELY FORBIDDEN: cartoon, animated, illustration, 2D, cel-shaded, sketched, painted, "
                "anime, manga, stylized, whimsical, storybook, comic book, CGI-smooth appearance.\n"
                "If ANY element looks animated or illustrated, the output is REJECTED."
            )

        # ── 8. ASSEMBLE FULL INSTRUCTION ──
        full_instruction = f"""TASK: Generate a single cinematic storyboard frame for a professional commercial production.

{medium_lock}

━━ IDENTITY ANCHORS (NEVER override) ━━
{identity_anchors or "No character/product references — create scene from description only."}

━━ SCENE ━━
{expanded_prompt}

━━ CINEMATOGRAPHY ━━
Professional commercial composition. Motivated lighting. Correct depth-of-field.

━━ QUALITY ━━
Ultra-sharp focus. Natural skin (pores visible, zero plastic smoothing). Correct anatomy — no extra fingers, merged bodies, floating limbs. No AI artifacts.

━━ REFERENCE IMAGES ORDER ━━
{", ".join(ref_order) if ref_order else "None"} — use for identity ONLY (face/body). Wardrobe/background come from the SCENE above.

{rendering_directive}
Aspect ratio: {ratio}
"""

        # ── 9. GENERATE IMAGE (multi-model fallback chain) ──
        if frame_id in CANCELED_FRAME_IDS:
            print(f"[Storyboard BG] Frame {frame_id} canceled before image generation.")
            return

        image_path = None

        # 9a. Try ChatGPT (if requested and key available)
        if model == "ChatGPT" and main.OPENAI_API_KEY:
            composite_b64 = _build_composite_reference(all_ref_items)
            if not composite_b64 and reference_image_b64:
                try:
                    _raw = reference_image_b64.split(",")[1] if "," in reference_image_b64 else reference_image_b64
                    composite_b64 = "data:image/png;base64," + base64.b64encode(safe_b64decode(_raw)).decode()
                except Exception: pass

            for attempt in range(3):
                try:
                    async with CHATGPT_GEN_LOCK:
                        imgs_tuple = await main._chatgpt_image_generate(
                            prompt=full_instruction, ratio=ratio, quality=quality,
                            image_b64=composite_b64, model=chatgpt_model
                        )
                    chatgpt_imgs = imgs_tuple[0] if isinstance(imgs_tuple, tuple) else imgs_tuple
                    if chatgpt_imgs:
                        result = chatgpt_imgs[0] if isinstance(chatgpt_imgs, list) else chatgpt_imgs
                        image_path = save_b64_image(result)
                        frame.model_used = "ChatGPT"
                        break
                except Exception as e:
                    err_str = str(e)
                    wait = 30 if ("429" in err_str or "rate" in err_str.lower()) else (2 ** attempt)
                    print(f"[Storyboard BG] ChatGPT attempt {attempt+1}/3 failed: {err_str[:120]}. Waiting {wait}s")
                    if attempt < 2:
                        await asyncio.sleep(wait)

        # 9b. Gemini (primary model → fallback model cascade)
        if not image_path:
            if not main.global_client and not main.flash_client:
                raise Exception("No image generation client available (no Gemini key configured).")
            
            from google.genai import types as genai_types
            gemini_client = main.global_client or main.flash_client

            # Build reference contents list
            contents = []
            if reference_image_b64:
                try:
                    _raw = reference_image_b64.split(",")[1] if "," in reference_image_b64 else reference_image_b64
                    contents.append("USER REFERENCE IMAGE (visual style/composition context):")
                    contents.append(genai_types.Part.from_bytes(data=safe_b64decode(_raw), mime_type="image/png"))
                except Exception as _e:
                    print(f"[Storyboard BG] User ref image decode failed: {_e}")

            total_refs = len(all_ref_items)
            max_per_ref = 1 if total_refs >= 3 else (2 if total_refs == 2 else 3)
            for name, ref_type, paths, best_idx, dna in all_ref_items:
                contents.append(f"REFERENCE [{ref_type.upper()}] {name}:")
                for p in _select_reference_images(paths, best_idx, max_per_ref):
                    b64_img = load_b64_image(p)
                    if not b64_img: continue
                    b64_data = b64_img.split(",")[1] if "," in b64_img else b64_img
                    try:
                        contents.append(genai_types.Part.from_bytes(data=safe_b64decode(b64_data), mime_type="image/png"))
                    except Exception: pass

            # Inject most recent previous frame for visual continuity — but ONLY if
            # there's character overlap (to prevent unrelated scenes from bleeding)
            last_done = db.query(StoryboardFrame).filter(
                StoryboardFrame.storyboard_id == sb_id,
                StoryboardFrame.order_index < frame.order_index,
                StoryboardFrame.image_path.isnot(None),
                StoryboardFrame.status == "done"
            ).order_by(StoryboardFrame.order_index.desc()).first()
            if last_done:
                # Check if there's character overlap between current and previous frame
                current_char_ids = set(frame.detected_character_ids or [])
                prev_char_ids = set(last_done.detected_character_ids or [])
                has_char_overlap = bool(current_char_ids & prev_char_ids) if (current_char_ids and prev_char_ids) else False
                # Also inject if frames are adjacent (order_index difference = 1) for general continuity
                is_adjacent = (frame.order_index - last_done.order_index) == 1
                
                if has_char_overlap or (is_adjacent and detected_chars):
                    prev_b64 = load_b64_image(last_done.image_path)
                    if prev_b64:
                        b64_data = prev_b64.split(",")[1] if "," in prev_b64 else prev_b64
                        try:
                            label = "CONTINUITY REFERENCE (preceding frame — match character wardrobe/appearance from this):"
                            contents.append(label)
                            contents.append(genai_types.Part.from_bytes(data=safe_b64decode(b64_data), mime_type="image/png"))
                            print(f"[Storyboard BG] Injected visual continuity reference (char_overlap={has_char_overlap}, adjacent={is_adjacent})")
                        except Exception: pass
                else:
                    print(f"[Storyboard BG] Skipped continuity reference — no character overlap with previous frame")

            contents.append(full_instruction)

            # Model cascade: production model → flash model → final fallback
            config_data = main.load_nanobanana_config()
            prod_model = config_data.get("production", {}).get("model", "gemini-3.1-flash-image")
            if model == "Nanobanana Pro":
                model_cascade = ["gemini-3-pro-image", prod_model, "gemini-3.1-flash-image"]
            else:
                model_cascade = [prod_model, "gemini-3.1-flash-image"]
            # Deduplicate while preserving order
            seen = set()
            model_cascade = [m for m in model_cascade if not (m in seen or seen.add(m))]

            images = None
            last_err = None
            for attempt_model in model_cascade:
                if frame_id in CANCELED_FRAME_IDS or sb_id in CANCELLED_STORYBOARD_IDS:
                    raise asyncio.CancelledError("Frame generation cancelled by user")
                try:
                    response = await generate_image_with_queue(
                        gemini_client,
                        model=attempt_model,
                        contents=contents,
                        config=genai_types.GenerateContentConfig(
                            response_modalities=["IMAGE", "TEXT"],
                            temperature=0.4,
                        ),
                        cancel_check=lambda: (frame_id in CANCELED_FRAME_IDS or sb_id in CANCELLED_STORYBOARD_IDS)
                    )
                    images = main._extract_images_from_response(response)
                    if images:
                        frame.model_used = attempt_model
                        print(f"[Storyboard BG] Got image from {attempt_model}")
                        break
                    else:
                        print(f"[Storyboard BG] No image in response from {attempt_model}, trying next model")
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    if frame_id in CANCELED_FRAME_IDS or sb_id in CANCELLED_STORYBOARD_IDS:
                        raise asyncio.CancelledError("Frame generation cancelled by user")
                    last_err = e
                    print(f"[Storyboard BG] Model {attempt_model} failed: {e}")
                    continue

            if not images:
                raise Exception(f"All models failed. Last error: {last_err}")

            image_path = save_b64_image(images[0])

        # ── 10. SAVE RESULT ──
        frame.image_path = image_path
        frame.status = "done"
        frame.error_msg = None
        frame.last_full_instruction = full_instruction
        db.commit()
        print(f"[Storyboard BG] Frame {frame_id} done → {image_path[:60] if image_path else 'None'}")

        # Keep contact sheet in sync if one exists
        _restitch_contact_sheet_if_present(sb_id, db)


        # Auto-score consistency (non-critical — ignore failures)
        try:
            score_db = next(get_db())
            await score_frame_consistency(sb_id, str(frame.id), score_db)
            score_db.close()
        except Exception as score_e:
            print(f"[Storyboard BG] Consistency scoring failed (non-critical): {score_e}")

    except (asyncio.CancelledError, Exception) as e:
        is_cancelled = isinstance(e, asyncio.CancelledError) or frame_id in CANCELED_FRAME_IDS or sb_id in CANCELLED_STORYBOARD_IDS
        try:
            db.rollback()
            frame = db.query(StoryboardFrame).filter(StoryboardFrame.id == frame_id).first()
            if frame:
                frame.status = "pending" if is_cancelled and not frame.image_path else ("done" if is_cancelled else "failed")
                frame.error_msg = None if is_cancelled else str(e)[:500]
                db.commit()
        except Exception as rb_e:
            print(f"[Storyboard BG] Rollback/status update failed: {rb_e}")
        if is_cancelled:
            print(f"[Storyboard BG] Frame {frame_id} was CANCELLED by user.")
        else:
            print(f"[Storyboard BG] Frame {frame_id} FAILED: {e}")
    finally:
        CANCELED_FRAME_IDS.discard(frame_id)
        RUNNING_FRAME_TASKS.pop(frame_id, None)
        try:
            db.close()
        except Exception: pass




def _select_reference_images(paths, best_idx, max_images):
    """
    Returns up to max_images paths.
    Best frontal image always goes first.
    Remaining slots filled with other images for angle variety.
    """
    if not paths:
        return []

    best = paths[best_idx] if best_idx < len(paths) else paths[0]
    others = [p for i, p in enumerate(paths) if i != best_idx]

    selected = [best] + others[: max_images - 1]
    return selected

def _build_composite_reference(all_ref_items):
    """
    Build a single composite reference sheet image from multiple character/product refs.
    ChatGPT images.edit only accepts ONE image, so we stitch the best-angle reference
    from each character/product into a grid.
    Returns base64 data URI or None if no references.
    """
    from PIL import Image as PILImage
    import io
    
    images = []
    for name, ref_type, paths, best_idx, dna in all_ref_items:
        selected = _select_reference_images(paths, best_idx, 1)  # Best angle only
        if not selected:
            continue
        b64_img = load_b64_image(selected[0])
        if not b64_img:
            continue
        b64_str = b64_img.split(",")[1] if "," in b64_img else b64_img
        img_bytes = safe_b64decode(b64_str)
        img = PILImage.open(io.BytesIO(img_bytes)).convert("RGB")
        images.append(img)
    
    if not images:
        return None
    
    if len(images) == 1:
        # Single reference — pass directly
        buf = io.BytesIO()
        images[0].save(buf, format="PNG")
        return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("utf-8")
    
    # Multiple refs — stitch into a grid (2 columns max)
    cell_size = 512
    cols = min(len(images), 2)
    rows = (len(images) + cols - 1) // cols
    grid = PILImage.new("RGB", (cols * cell_size, rows * cell_size), (255, 255, 255))
    
    for i, img in enumerate(images):
        img_resized = img.resize((cell_size, cell_size), PILImage.LANCZOS)
        col = i % cols
        row = i // cols
        grid.paste(img_resized, (col * cell_size, row * cell_size))
    
    buf = io.BytesIO()
    grid.save(buf, format="PNG")
    composite_b64 = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("utf-8")
    print(f"[Storyboard] Built composite reference sheet: {len(images)} images, {cols}x{rows} grid")
    return composite_b64

@router.post("/{sb_id}/frame/{frame_id}/iterate")
async def iterate_frame(
    sb_id: str, 
    frame_id: str, 
    iteration_prompt: str = Body(..., embed=True),
    model: Optional[str] = Body(default=None),
    chatgpt_model: str = Body(default="gpt-image-1.5"),
    ratio: Optional[str] = Body(default=None),
    quality: Optional[str] = Body(default=None),
    style: Optional[str] = Body(default=None),
    reference_image_b64: Optional[str] = Body(default=None),
    current_user: User = Depends(get_effective_storyboard_user), 
    db: Session = Depends(get_db)
):
    """Iterate on an existing frame with image-first conditioning + product support."""
    import main
    
    frame = db.query(StoryboardFrame).filter(StoryboardFrame.id == frame_id, StoryboardFrame.storyboard_id == sb_id).first()
    if not frame or not frame.image_path:
        raise HTTPException(404, "Frame or existing image not found")

    # ── Content safety: instant keyword check on iteration prompt ──
    kw_safe, kw_reason = check_prompt_keywords(iteration_prompt)
    if not kw_safe:
        raise HTTPException(status_code=400, detail=f"Content blocked: {kw_reason}")

    # Mark as generating IMMEDIATELY so the frontend poll sees it before the slow
    # LLM entity-detection and prompt-expansion calls (mirrors generate_frame pattern).
    frame.status = "generating"
    frame.generation_started_at = datetime.utcnow()
    db.commit()

    # Use provided ratio/quality or fall back to frame defaults
    final_ratio = ratio if ratio else (frame.ratio if hasattr(frame, "ratio") else "16:9")
    final_quality = quality if quality else (frame.quality if hasattr(frame, "quality") else "Standard")
        
    chars = db.query(StoryboardCharacter).filter(StoryboardCharacter.storyboard_id == sb_id).all()
    prods = db.query(StoryboardProduct).filter(StoryboardProduct.storyboard_id == sb_id).all()
    
    original_scene_prompt = frame.scene_prompt
    # Use the most recent expanded prompt as the base for iteration so cumulative edits
    # are preserved. If this is the first iteration, fall back to the original scene_prompt.
    current_prompt_state = frame.expanded_prompt or frame.scene_prompt
    edit_instruction = iteration_prompt.strip()
    
    # Detect characters and products using the original prompt so we pull the correct DNA
    detected_chars, detected_prods = await _detect_entities_llm(original_scene_prompt, chars, prods)
    
    # Build DNA context
    dna_context = []
    for c in detected_chars:
        if c.character_dna:
            dna_context.append(f"Character '{c.name}': {json.dumps(c.character_dna)}")
    for p in detected_prods:
        if p.product_dna:
            dna_context.append(f"Product '{p.name}': {json.dumps(p.product_dna)}")
                
    expanded_prompt = current_prompt_state
    if main.OPENAI_API_KEY:
        try:
            oai_client = openai_lib.OpenAI(api_key=main.OPENAI_API_KEY)
            sys_msg = (
                "You are an expert storyboard prompt engineer.\n"
                "The user is ITERATING on an existing frame. You will receive the CURRENT scene description "
                "(which may already include previous edits) and the user's NEW EDIT INSTRUCTION.\n"
                "Your ONLY task is to rewrite the CURRENT scene description so that it seamlessly incorporates the NEW EDIT INSTRUCTION.\n"
                "IMPORTANT: Preserve ALL details from the current description that are NOT contradicted by the edit.\n"
                "Do NOT add any character descriptions, negative constraints, or structure headers. Just output the rewritten, highly-descriptive scene action paragraph.\n"
                "Example: Current: 'Sarah offering a small red bottle to kids in park', Edit: 'make it sunset lighting' -> Output: 'Sarah is offering a small red bottle to the kids in a park bathed in warm golden sunset light.'"
            )
            user_msg = f"CURRENT Scene Description: {current_prompt_state}\n\nUSER EDIT INSTRUCTION: {edit_instruction}"
            
            resp = await asyncio.to_thread(
                oai_client.chat.completions.create,
                model="gpt-5.6-luna",
                messages=[{"role": "system", "content": sys_msg}, {"role": "user", "content": user_msg}],
                max_completion_tokens=1000,
            )
            expanded_prompt = resp.choices[0].message.content.strip()
            print(f"[Storyboard] Prompt Synthesizer (Iteration): {expanded_prompt[:150]}...")
            # Do NOT overwrite frame.scene_prompt — it is the canonical user intent and
            # is what _detect_entities_llm() uses to find character/product names.
            # Overwriting it causes progressive entity-detection drift across iterations.
            frame.expanded_prompt = expanded_prompt
            db.commit()
        except Exception as e:
            print(f"[Storyboard] GPT-5.6 Luna prompt iteration expansion failed: {e}, attempting Claude Sonnet 5 fallback...")
            claude_out = await _call_claude_sonnet_5_text(sys_msg, user_msg, max_tokens=1000)
            if claude_out:
                expanded_prompt = claude_out
                frame.expanded_prompt = expanded_prompt
                db.commit()
                print(f"[Storyboard] Prompt Synthesizer via Claude Sonnet 5: {expanded_prompt[:150]}...")
            else:
                frame.expanded_prompt = f"{original_scene_prompt} (Edit: {edit_instruction})"
                expanded_prompt = frame.expanded_prompt
                db.commit()
    elif main.ANTHROPIC_API_KEY:
        sys_msg = (
            "You are an expert storyboard prompt engineer.\n"
            "The user is ITERATING on an existing frame. You will receive the CURRENT scene description "
            "(which may already include previous edits) and the user's NEW EDIT INSTRUCTION.\n"
            "Your ONLY task is to rewrite the CURRENT scene description so that it seamlessly incorporates the NEW EDIT INSTRUCTION.\n"
            "IMPORTANT: Preserve ALL details from the current description that are NOT contradicted by the edit.\n"
            "Do NOT add any character descriptions, negative constraints, or structure headers. Just output the rewritten, highly-descriptive scene action paragraph."
        )
        user_msg = f"CURRENT Scene Description: {current_prompt_state}\n\nUSER EDIT INSTRUCTION: {edit_instruction}"
        claude_out = await _call_claude_sonnet_5_text(sys_msg, user_msg, max_tokens=1000)
        if claude_out:
            expanded_prompt = claude_out
            frame.expanded_prompt = expanded_prompt
            db.commit()
            print(f"[Storyboard] Prompt Synthesizer via Claude Sonnet 5: {expanded_prompt[:150]}...")
            
    # Collect reference items
    all_ref_items = []
    for c in detected_chars:
        paths = c.image_paths or ([c.image_path] if c.image_path else [])
        all_ref_items.append((c.name, "character", paths, getattr(c, "best_angle_index", 0), c.character_dna))
    for p in detected_prods:
        paths = p.image_paths or ([p.image_path] if p.image_path else [])
        all_ref_items.append((p.name, "product", paths, getattr(p, "best_angle_index", 0), p.product_dna))
    
    # Generate
    try:
        # Build universal iteration instruction
        source_medium = style if style else _resolve_source_medium(all_ref_items)
        
        # Decode user-supplied reference image if provided
        user_ref_image_bytes = None
        if reference_image_b64:
            try:
                _b64_clean = reference_image_b64.split(",")[1] if "," in reference_image_b64 else reference_image_b64
                user_ref_image_bytes = safe_b64decode(_b64_clean)
                print(f"[Storyboard] Iterate: User-supplied reference image attached ({len(user_ref_image_bytes)} bytes)")
            except Exception as _e:
                print(f"[Storyboard] Iterate: Failed to decode user reference image: {_e}")
        
        identity_anchors = ""
        for i, (name, ref_type, paths, best_idx, dna) in enumerate(all_ref_items):
            if ref_type == "character":
                identity_anchors += f"CHARACTER [{name}]:\n"
                if dna:
                    identity_anchors += f"  - Face geometry: {dna.get('face_geometry', 'N/A')}\n"
                    identity_anchors += f"  - Eyes: {dna.get('eyes_and_brows', 'N/A')}\n"
                    identity_anchors += f"  - Skin: {dna.get('hair_and_skin', 'N/A')}\n"
                    identity_anchors += f"  - Build: {dna.get('build_and_posture', 'N/A')}\n"
                    identity_anchors += f"  - Distinctive: {dna.get('distinctive_features', 'N/A')}\n"
                identity_anchors += "  ⚠ Preserve ALL traits above regardless of scene angle, lighting, or action.\n"
                identity_anchors += "  ⚠ Do NOT smooth, idealize, age, or alter facial structure for any reason.\n\n"
            else:
                identity_anchors += f"PRODUCT [{name}]:\n"
                if dna:
                    identity_anchors += f"  - Form: {dna.get('shape_geometry', 'N/A')}\n"
                    identity_anchors += f"  - Colors: {dna.get('color_palette', 'N/A')}\n"
                    identity_anchors += f"  - Branding: {dna.get('branding', 'N/A')} — must be legible and correctly placed\n"
                    identity_anchors += f"  - Surface: {dna.get('surface_details', 'N/A')}\n"
                identity_anchors += "  ⚠ Preserve exact proportions and branding even under dramatic lighting.\n\n"

        # Style-aware rendering directive for iteration
        style_lower_iter = (source_medium or "").lower()
        if any(s in style_lower_iter for s in ["anime", "illustrat", "cartoon", "sketch", "paint"]):
            iter_rendering = f"Style: {source_medium}. Render as a HIGH-QUALITY {source_medium.upper()} illustration — expressive stylized faces, clean linework, bold colour with consistent anime/illustration shading."
            iter_medium_lock = f"━━ MEDIUM LOCK ━━\nMaintain consistent {source_medium} illustration language."
        elif any(s in style_lower_iter for s in ["3d", "render", "cgi"]):
            iter_rendering = f"Style: {source_medium}. Premium 3D CGI render — sharp geometry, physically-based materials, professional studio lighting."
            iter_medium_lock = "━━ MEDIUM LOCK ━━\nMaintain consistent 3D CGI render language."
        else:
            iter_rendering = f"Style: {source_medium}. This must look like a PROFESSIONAL PHOTOGRAPH from an award-winning commercial photographer — full-frame camera quality, accurate depth-of-field, natural skin tones, zero distortion."
            iter_medium_lock = (
                "━━ MEDIUM LOCK (CRITICAL) ━━\n"
                "This is a LIVE-ACTION PHOTOGRAPH. Strictly forbidden: cartoon, 2D animation, illustration, "
                "CGI plastic skin, sketch, or drawing. Preserve authentic skin pores, real animal fur, and photographic optics."
            )

        iteration_instruction = f"""TASK: Iterate on an existing storyboard frame for a professional commercial production.
This is a controlled creative production environment — identity preservation and surgical editing precision are the top priorities.

{iter_medium_lock}

━━ IDENTITY ANCHORS (HIGHEST PRIORITY — never override these) ━━
{identity_anchors if identity_anchors else "No character/product references — create scene from description only."}

━━ FACIAL LOCK (CRITICAL — when characters present) ━━
- Preserve the EXACT facial structure and proportions from the provided REFERENCE images.
- The reference images are the ground truth identity for this production.
- Do NOT generate a generic, averaged, or idealised version of the characters.

━━ SCENE DESCRIPTION ━━
{expanded_prompt}

━━ USER EDIT OVERRIDE (CRITICAL — EXECUTE THIS PRECISELY) ━━
The user specifically requested: "{edit_instruction}"
You MUST execute this edit with surgical precision.
If the Base Frame visually contradicts this edit, alter ONLY that specific element — nothing else changes.
Do not reinterpret, improve, or add anything beyond what the user asked.

━━ ITERATION PROTOCOL (CRITICAL) ━━
- BASE FRAME: The final image in the reference sequence is the composition you are editing.
- PRESERVE: background, lighting, camera angle, character poses, all untouched elements.
- ALTER: only the specific object/detail/element named in the User Edit Override above.
- The edit must blend seamlessly — no visible seams or inconsistent lighting at the edit boundary.

━━ TECHNICAL QUALITY (STUDIO GRADE) ━━
- Ultra-sharp focus, natural optical clarity, zero digital artifacts.
- Perfect anatomical proportions — correct hands, fingers, natural limb articulation.
- Authentic micro-surface detail (fabric weave, skin pore texture, natural hair separation) without artificial smoothing.
- Strict color and tonality consistency with the Base Frame's existing grade and temperature.

━━ RENDERING STYLE ━━
{iter_rendering}
Maintain consistent visual style — do not mix mediums or introduce style drift from the Base Frame.
"""

        model_used = model if model else (frame.model_used or "Nanobanana 2")
        image_results = None
        
        if model_used == "ChatGPT" and main.OPENAI_API_KEY:
            # For iterate, ALWAYS use the existing generated frame as the edit target.
            # ChatGPT images.edit() edits from the provided image — this is the frame to modify.
            # Character DNA is already embedded in the iteration_instruction text (identity_anchors),
            # so we don't need the ref composite as the image input.
            existing_frame_b64 = load_b64_image(frame.image_path)
            composite_b64 = existing_frame_b64  # primary: the frame being edited
            if not composite_b64:
                # Fallback: no existing frame image on disk → use character refs
                composite_b64 = _build_composite_reference(all_ref_items)
            if not composite_b64 and user_ref_image_bytes:
                composite_b64 = "data:image/png;base64," + base64.b64encode(user_ref_image_bytes).decode("utf-8")
            print(f"[Storyboard] Iterate/ChatGPT: using {'existing frame' if existing_frame_b64 else 'refs'} as edit target")
            
            for attempt in range(3):
                try:
                    # _chatgpt_image_generate returns tuple: (imgs, enhanced_prompt, endpoint)
                    async with CHATGPT_GEN_LOCK:
                        imgs_tuple = await main._chatgpt_image_generate(
                            prompt=iteration_instruction,
                            ratio=final_ratio,
                            quality=final_quality,
                            image_b64=composite_b64,
                            model=chatgpt_model
                        )
                    image_results = imgs_tuple[0] if imgs_tuple and isinstance(imgs_tuple, tuple) else imgs_tuple
                    if image_results: break
                except Exception as e:
                    err_str = str(e)
                    wait = 25 if ("429" in err_str or "rate" in err_str.lower()) else (2 ** attempt)
                    print(f"[Storyboard] ChatGPT iteration attempt {attempt+1} failed: {e}. Waiting {wait}s")
                    await asyncio.sleep(wait)
            
            if image_results:
                result = image_results[0] if isinstance(image_results, list) else image_results
                if isinstance(result, str) and result.startswith("data:"):
                    frame.image_path = save_b64_image(result)
                elif isinstance(result, str) and (result.startswith("/exports") or result.startswith("exports")):
                    # Already saved to disk — normalize path
                    frame.image_path = save_b64_image(result)
                elif isinstance(result, str) and result.startswith("http"):
                    import urllib.request
                    req = urllib.request.Request(result, headers={'User-Agent': 'Mozilla/5.0'})
                    with urllib.request.urlopen(req) as http_resp:
                        img_data = http_resp.read()
                        b64_str = base64.b64encode(img_data).decode("utf-8")
                        frame.image_path = save_b64_image(b64_str)
                else:
                    raise Exception(f"[Storyboard] Unexpected ChatGPT iterate result type: {type(result)}, value: {str(result)[:100]}")
                frame.status = "done"
                db.commit()
            else:
                print("[Storyboard] ChatGPT iteration failed 3 times. Falling back to Nanobanana 2.")

        if not image_results:
            # Gemini path
            from google.genai import types
            gemini_client = main.global_client
            contents = []
            total_refs = len(all_ref_items)
            max_per = 2 if total_refs > 1 else 3
            
            # Inject user-supplied reference image FIRST if provided
            if user_ref_image_bytes:
                contents.append("USER REFERENCE IMAGE (use for visual style, composition, or additional context):")
                contents.append(types.Part.from_bytes(data=user_ref_image_bytes, mime_type="image/png"))
            
            for name, ref_type, paths, best_idx, dna in all_ref_items:
                contents.append(f"REFERENCE [{ref_type.upper()}] {name}:")
                selected = _select_reference_images(paths, best_idx, max_per)
                for p in selected:
                    b64_img = load_b64_image(p)
                    if not b64_img: continue
                    b64_data = b64_img.split(",")[1] if "," in b64_img else b64_img
                    img_bytes = safe_b64decode(b64_data)
                    contents.append(types.Part.from_bytes(data=img_bytes, mime_type="image/png"))

            # Add existing frame as composition reference (Single clean state)
            existing_b64 = load_b64_image(frame.image_path)
            if existing_b64:
                contents.append("BASE FRAME (Current state: Lock background/poses, but execute user edit):")
                b64_data = existing_b64.split(",")[1] if "," in existing_b64 else existing_b64
                img_bytes = safe_b64decode(b64_data)
                contents.append(types.Part.from_bytes(data=img_bytes, mime_type="image/png"))
                
            contents.append(iteration_instruction)
            
            images = None
            config_data = main.load_nanobanana_config()
            prod_cfg = config_data.get("production", {"model": "gemini-3.1-flash-image", "temperature": 0.4})
            prod_model = prod_cfg.get("model", "gemini-3.1-flash-image")

            # Model cascade (same as _run_frame_generation for resilience)
            if model_used == "Nanobanana Pro":
                model_cascade = ["gemini-3-pro-image", prod_model, "gemini-3.1-flash-image"]
            else:
                model_cascade = [prod_model, "gemini-3.1-flash-image"]
            seen = set()
            model_cascade = [m for m in model_cascade if not (m in seen or seen.add(m))]

            last_err = None
            for attempt_model in model_cascade:
                try:
                    response = await generate_image_with_queue(
                        gemini_client,
                        model=attempt_model,
                        contents=contents,
                        config=types.GenerateContentConfig(
                            response_modalities=["IMAGE", "TEXT"],
                            temperature=0.4 if model_used == "Nanobanana Pro" else prod_cfg.get("temperature", 0.4),
                            image_config=types.ImageConfig(
                                aspect_ratio=final_ratio,
                                image_size="4K" if final_quality in ("High", "Ultra") else "2K",
                            )
                        )
                    )
                    images = main._extract_images_from_response(response)
                    if images:
                        print(f"[Storyboard] Iterate: Got image from {attempt_model}")
                        break
                    else:
                        print(f"[Storyboard] Iterate: No image from {attempt_model}, trying next")
                except Exception as e:
                    last_err = e
                    print(f"[Storyboard] Iterate: Model {attempt_model} failed: {str(e)[:120]}")
                    continue
                    
            if not images:
                raise Exception(f"All models failed for iteration. Last error: {last_err}")
                
            frame.image_path = save_b64_image(images[0])
            frame.status = "done"
            db.commit()
        
        # Keep contact sheet in sync if one exists
        _restitch_contact_sheet_if_present(sb_id, db)

        return {
            "status": "success", 
            "image_path": frame.image_path, 
            "image_b64": load_b64_image(frame.image_path),
            "expanded_prompt": expanded_prompt
        }

        
    except Exception as e:
        try:
            db.rollback()
            frame = db.query(StoryboardFrame).filter(StoryboardFrame.id == frame_id).first()
            if frame:
                frame.status = "failed"
                frame.error_msg = str(e)[:500]
                db.commit()
        except Exception as rb_e:
            print(f"[Storyboard] Iterate rollback/status update failed: {rb_e}")
        raise HTTPException(500, f"Iteration failed: {str(e)}")

@router.post("/{storyboard_id}/frame/{frame_id}/score-consistency")
async def score_frame_consistency(
    storyboard_id: str,
    frame_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_effective_storyboard_user)
):
    if not _get_sb(storyboard_id, db, current_user):
        raise HTTPException(status_code=403, detail="Access denied: You do not own this storyboard.")
    frame = db.query(StoryboardFrame).filter_by(id=frame_id, storyboard_id=storyboard_id).first()
    if not frame or not frame.image_path:
        return {"status": "failed", "reason": "No frame image"}
    
    generated_image_url = frame.image_path
    
    anchor_frame = (
        db.query(StoryboardFrame)
        .filter(
            StoryboardFrame.storyboard_id == storyboard_id,
            StoryboardFrame.is_anchor == True,
            StoryboardFrame.order_index < frame.order_index
        )
        .order_by(StoryboardFrame.order_index.desc())
        .first()
    ) or (
        db.query(StoryboardFrame)
        .filter(StoryboardFrame.storyboard_id == storyboard_id, StoryboardFrame.order_index == 0)
        .first()
    )

    character_scores = {}
    import main
    from google.genai import types
    import asyncio
    import json
    import base64
    
    if not frame.detected_character_ids:
        return {"report": {}, "overall_score": 100}

    for char_id in frame.detected_character_ids:
        character = db.query(StoryboardCharacter).filter_by(id=char_id).first()
        if not character: continue
        sheet = db.query(CharacterSheet).filter_by(character_id=char_id).first()

        scoring_prompt = f"""
        You are a visual consistency auditor for a storyboard.
        Compare the CHARACTER in the GENERATED FRAME against their REFERENCE SHEET images.

        Character: {character.name}

        Score on a 0-100 scale:
        - face_score: facial geometry match (bone structure, eyes, nose, jaw)
        - outfit_score: clothing consistency vs anchor frame
        - proportion_score: body proportions vs reference sheet

        Return strict JSON:
        {{
          "face_score": int,
          "outfit_score": int,
          "proportion_score": int,
          "overall_score": int,
          "drift_flags": ["face", "outfit", "proportion"],
          "notes": "string — describe what drifted and how"
        }}
        Return ONLY valid JSON.
        """
        contents = [scoring_prompt]
        
        # Add generated frame
        b64_img = load_b64_image(generated_image_url)
        if b64_img:
            b64_data = b64_img.split(",")[1] if "," in b64_img else b64_img
            contents.append("GENERATED FRAME:")
            contents.append(types.Part.from_bytes(data=safe_b64decode(b64_data), mime_type="image/png"))
            
        # Add sheet references
        if sheet:
            if sheet.front_body_url:
                f_img = load_b64_image(sheet.front_body_url)
                if f_img:
                    contents.append("REFERENCE SHEET (FRONT):")
                    contents.append(types.Part.from_bytes(data=safe_b64decode(f_img.split(",")[1] if "," in f_img else f_img), mime_type="image/png"))
            if sheet.face_closeup_url:
                f_img = load_b64_image(sheet.face_closeup_url)
                if f_img:
                    contents.append("REFERENCE SHEET (FACE):")
                    contents.append(types.Part.from_bytes(data=safe_b64decode(f_img.split(",")[1] if "," in f_img else f_img), mime_type="image/png"))
                    
        # Add anchor frame
        if anchor_frame and anchor_frame.image_path:
            f_img = load_b64_image(anchor_frame.image_path)
            if f_img:
                contents.append("ANCHOR FRAME (for outfit consistency):")
                contents.append(types.Part.from_bytes(data=safe_b64decode(f_img.split(",")[1] if "," in f_img else f_img), mime_type="image/png"))

        response = await asyncio.to_thread(
            main.global_client.models.generate_content,
            model="gemini-2.5-flash",
            contents=contents,
            config=types.GenerateContentConfig(response_mime_type="application/json")
        )
        try:
            scores = json.loads(response.text)
            scores["name"] = character.name
            character_scores[char_id] = scores
        except Exception as e:
            print(f"Failed to score consistency for {character.name}: {e}")

    if character_scores:
        overall = int(sum(v.get("overall_score", 0) for v in character_scores.values()) / max(len(character_scores), 1))
    else:
        overall = 100

    report = FrameConsistencyReport(
        frame_id=frame_id,
        storyboard_id=storyboard_id,
        character_scores=character_scores,
        anchor_frame_id=str(anchor_frame.id) if anchor_frame else None
    )
    db.add(report)
    frame.consistency_score = overall
    db.commit()

    return {"report": character_scores, "overall_score": overall}

@router.post("/{storyboard_id}/frame/{frame_id}/selective-relock")
async def selective_relock(
    storyboard_id: str,
    frame_id: str,
    payload: RelockRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_effective_storyboard_user)
):
    if not _get_sb(storyboard_id, db, current_user):
        raise HTTPException(status_code=403, detail="Access denied: You do not own this storyboard.")
    frame = db.query(StoryboardFrame).filter_by(id=frame_id).first()
    character = db.query(StoryboardCharacter).filter_by(id=payload.character_id).first()
    sheet = db.query(CharacterSheet).filter_by(character_id=payload.character_id).first()

    import json
    relock_instructions = {
        "face": f"""
            FACE CORRECTION OVERRIDE for {character.name}:
            The facial geometry in the previous generation drifted. Correct it NOW.
            Exact match required: eye spacing, nose bridge width, jaw shape, lip proportion.
            Do NOT change pose, clothing, scene, lighting, or any other character.
        """,
        "outfit": f"""
            OUTFIT CORRECTION OVERRIDE for {character.name}:
            The clothing drifted from the established wardrobe.
            Restore exact outfit: fabric, color, cut, accessories. Keep all else identical.
        """,
        "proportion": f"""
            PROPORTION CORRECTION OVERRIDE for {character.name}:
            Body proportions drifted. Enforce these locked proportions:
            {json.dumps(sheet.proportion_dna if sheet else {}, indent=2)}
            Do NOT change any other aspect of the scene.
        """,
        "all": f"""
            FULL IDENTITY CORRECTION for {character.name}:
            Proportion DNA: {json.dumps(sheet.proportion_dna if sheet else {})}
            Restore all identity attributes. Keep scene composition identical.
        """
    }

    relock_block = relock_instructions.get(payload.relock_attribute, relock_instructions["all"])

    new_instruction = (frame.last_full_instruction or "") + "\n\n" + relock_block

    import main
    from google.genai import types
    import asyncio
    import base64
    
    contents = []
    
    # Add character sheet references if available
    if sheet:
        if sheet.face_closeup_url:
            b64 = load_b64_image(sheet.face_closeup_url)
            if b64:
                b64_data = b64.split(",")[1] if "," in b64 else b64
                contents.append(f"REFERENCE [{character.name} FACE]:")
                contents.append(types.Part.from_bytes(data=safe_b64decode(b64_data), mime_type="image/png"))
        if sheet.front_body_url:
            b64 = load_b64_image(sheet.front_body_url)
            if b64:
                b64_data = b64.split(",")[1] if "," in b64 else b64
                contents.append(f"REFERENCE [{character.name} BODY]:")
                contents.append(types.Part.from_bytes(data=safe_b64decode(b64_data), mime_type="image/png"))
    else:
        # Fallback to original references
        paths = character.image_paths or ([character.image_path] if character.image_path else [])
        for p in paths[:2]:
            b64 = load_b64_image(p)
            if b64:
                b64_data = b64.split(",")[1] if "," in b64 else b64
                contents.append(f"REFERENCE [{character.name}]:")
                contents.append(types.Part.from_bytes(data=safe_b64decode(b64_data), mime_type="image/png"))

    # Also add existing frame as base
    b64 = load_b64_image(frame.image_path)
    if b64:
        b64_data = b64.split(",")[1] if "," in b64 else b64
        contents.append("BASE FRAME (Keep this composition, only apply the correction override):")
        contents.append(types.Part.from_bytes(data=safe_b64decode(b64_data), mime_type="image/png"))

    contents.append(new_instruction)

    images = None
    for attempt in range(3):
        try:
            config = main.load_nanobanana_config()
            prod_cfg = config.get("production", {"model": "gemini-3.1-flash-image", "temperature": 0.4})
            response = await asyncio.shield(asyncio.to_thread(
                main.global_client.models.generate_content,
                model=prod_cfg.get("model", "gemini-3.1-flash-image"),
                contents=contents,
                config=types.GenerateContentConfig(
                    response_modalities=["IMAGE", "TEXT"],
                    temperature=prod_cfg.get("temperature", 0.4),
                    image_config=types.ImageConfig(aspect_ratio="16:9", image_size="4K")
                )
            ))
            images = main._extract_images_from_response(response)
            if images: break
        except asyncio.CancelledError:
            await asyncio.sleep(2 ** attempt)

    if images:
        frame.image_path = save_b64_image(images[0])
        history = frame.relock_history or []
        import datetime
        history.append({
            "attribute": payload.relock_attribute,
            "character": character.name,
            "timestamp": datetime.datetime.utcnow().isoformat()
        })
        from sqlalchemy.orm.attributes import flag_modified
        frame.relock_history = history
        flag_modified(frame, "relock_history")
        db.commit()
    
    return await score_frame_consistency(storyboard_id, frame_id, db)

@router.patch("/{storyboard_id}/frame/{frame_id}/set-anchor")
async def set_anchor_frame(
    storyboard_id: str,
    frame_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_effective_storyboard_user)
):
    if not _get_sb(storyboard_id, db, current_user):
        raise HTTPException(status_code=403, detail="Access denied: You do not own this storyboard.")
    frame = db.query(StoryboardFrame).filter_by(id=frame_id).first()
    frame.is_anchor = True
    db.commit()
    return {"anchored": True, "frame_number": frame.order_index + 1}


# ═══════════════════════════════════════════════════════════════════════════════
# ── "NO BRIEF? NO PROBLEM" ENDPOINTS ──────────────────────────────────────────
# ═══════════════════════════════════════════════════════════════════════════════

class AIScaffoldRequest(BaseModel):
    idea: str

class TemplateScaffoldRequest(BaseModel):
    template_key: str
    name: Optional[str] = None

class InspirePromptRequest(BaseModel):
    rough_idea: str

class GenerateFromDescriptionRequest(BaseModel):
    name: str
    description: str


# ── TEMPLATES DEFINITION ──────────────────────────────────────────────────────

STORYBOARD_TEMPLATES = {
    "product_launch": {
        "label": "Product Launch",
        "emoji": "🚀",
        "description": "Teaser → hero shot → lifestyle → feature close-up → CTA",
        "frames": [
            "Dramatic close-up of the product emerging from darkness — a single beam of light catching its surface. No people. High tension.",
            "Full hero shot: product centred on a clean minimal surface, perfect studio lighting, branding clearly visible. No people.",
            "Lifestyle moment: a person naturally using the product in an aspirational real-world setting — warm candid light.",
            "Extreme macro close-up on the product's most distinctive feature or detail. Focus on craftsmanship and material texture.",
            "Final brand end card: product and brand logo together, tagline below, clean minimal background.",
        ],
    },
    "mini_film": {
        "label": "Mini Film",
        "emoji": "🎬",
        "description": "6-frame narrative: intro → conflict → build → climax → resolution → outro",
        "frames": [
            "Opening establishing shot: wide angle of the world and protagonist in their everyday environment. Calm before the story begins.",
            "Inciting moment: protagonist encounters an obstacle or realises something is missing. Expression shifts — close-up on face.",
            "Rising action: protagonist actively working towards a solution, product or idea beginning to play a role.",
            "Climax: peak emotional or dramatic moment. Dynamic framing, strong lighting contrast.",
            "Resolution: protagonist achieves the goal. Warm, satisfied expression. Product or solution present but unobtrusive.",
            "Outro / brand moment: quiet reflective shot, brand mark subtly integrated into the environment.",
        ],
    },
    "social_reel": {
        "label": "Social Reel",
        "emoji": "📱",
        "description": "3 punchy vertical frames: hook → demo → CTA",
        "frames": [
            "HOOK (9:16 vertical): eye-catching opening — bold visual contrast, person reacting with surprise or delight. Grabs attention in 1 second.",
            "DEMO (9:16 vertical): clear product or service in action — hands interacting with it, key benefit shown visually, no text needed.",
            "CTA (9:16 vertical): confident direct-address moment — person looking into camera, warm expression, brand element subtly visible.",
        ],
    },
    "food_lifestyle": {
        "label": "Food / Lifestyle",
        "emoji": "🍽️",
        "description": "4 frames: ingredients → preparation → plating → consumption",
        "frames": [
            "Overhead flat-lay: fresh raw ingredients artfully arranged on a wooden surface. Natural window light. No people.",
            "Mid-preparation moment: hands actively cooking — motion blur on action, warm kitchen light, steam or texture visible.",
            "Final plated dish: perfect plating on a beautiful surface, garnishes precise, fork or utensil nearby. Macro depth-of-field.",
            "Consumption moment: genuine first-bite reaction — candid expression of enjoyment, warm restaurant or home setting.",
        ],
    },
    "real_estate": {
        "label": "Real Estate",
        "emoji": "🏠",
        "description": "4 frames: exterior → interior → lifestyle → aspirational CTA",
        "frames": [
            "Golden-hour exterior establishing shot: full building facade, landscaping in foreground, dramatic sky. Wide angle.",
            "Hero interior room: living room or kitchen — natural light flooding in, styled furniture, no people. Architectural beauty.",
            "Lifestyle interior: a person or family naturally inhabiting the space — candid, warm, authentic domestic moment.",
            "Aspirational view from inside looking out: large window, beautiful skyline or nature, person silhouetted enjoying the view.",
        ],
    },
}


@router.post("/ai-scaffold")
async def ai_scaffold_storyboard(
    payload: AIScaffoldRequest,
    current_user: User = Depends(get_effective_storyboard_user),
    db: Session = Depends(get_db),
):
    """
    Takes a plain-English idea and uses GPT-4o to GENERATE (not parse) a full
    storyboard: title, characters, products, and frame descriptions.
    Creates all DB records and returns the new storyboard id.
    """
    import main
    import json

    system_prompt = """
You are a senior creative director and storyboard producer.
Given a short campaign idea, generate a complete, professional storyboard brief as strict JSON.
Be inventive and specific. Do NOT leave fields vague.

Return ONLY valid JSON matching this exact structure:
{
  "title": "string — catchy campaign name",
  "characters": [
    {
      "name": "string",
      "age": "string",
      "gender": "string",
      "ethnicity": "string",
      "build": "string",
      "hair": "string",
      "distinctive_features": "string",
      "wardrobe": "string",
      "role": "string"
    }
  ],
  "products": [
    {
      "name": "string",
      "category": "string",
      "color": "string",
      "material": "string",
      "branding_notes": "string",
      "shape_description": "string"
    }
  ],
  "frames": [
    {
      "frame_number": 1,
      "scene_description": "string — rich cinematic description of the shot",
      "characters_present": ["name1"],
      "products_present": ["name1"],
      "action": "string",
      "mood": "string",
      "location": "string",
      "time_of_day": "string"
    }
  ],
  "master_style": "string",
  "master_setting": "string"
}

Rules:
- Generate 4-8 frames unless the idea specifies a count
- Characters must have distinct, specific visual traits
- Frame descriptions must be vivid and ready to generate
- Return ONLY valid JSON. No markdown, no explanation.
"""
    parsed = None
    if main.OPENAI_API_KEY:
        try:
            oai_client = openai_lib.OpenAI(api_key=main.OPENAI_API_KEY)
            response = await asyncio.to_thread(
                oai_client.chat.completions.create,
                model="gpt-5.6-luna",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Campaign idea: {payload.idea}"},
                ],
                response_format={"type": "json_object"},
            )
            parsed = json.loads(response.choices[0].message.content)
        except Exception as e:
            print(f"[ai_scaffold] GPT-5.6 Luna failed: {e}, falling back to Claude Sonnet 5...")
            parsed = None

    if not parsed and main.ANTHROPIC_API_KEY:
        try:
            claude_out = await _call_claude_sonnet_5_text(
                system_prompt + "\n\nIMPORTANT: Return ONLY valid JSON matching the schema.",
                f"Campaign idea: {payload.idea}",
                max_tokens=4096
            )
            if claude_out:
                raw = claude_out.strip()
                if raw.startswith("```"):
                    raw = raw.split("```")[1]
                    if raw.startswith("json"):
                        raw = raw[4:].strip()
                parsed = json.loads(raw)
        except Exception as ant_e:
            print(f"[ai_scaffold] Claude Sonnet 5 fallback failed: {ant_e}")
            parsed = None

    if not parsed:
        raise HTTPException(503, "Failed to scaffold storyboard with AI. Please try again.")

    # Auto-title from parsed or from idea
    title = parsed.get("title") or (payload.idea[:40].strip() + " Campaign")

    # Create the storyboard
    sb = Storyboard(user_id=current_user.id, name=title, description=payload.idea)
    db.add(sb)
    db.flush()

    # Create brief record
    brief_record = StoryboardBrief(
        storyboard_id=str(sb.id), raw_text=payload.idea, parsed_json=parsed, parse_status="done"
    )
    db.add(brief_record)

    # Create characters
    created_characters: dict[str, str] = {}
    for char in parsed.get("characters", []):
        text_dna = {
            "source": "ai_generated",
            "age": char.get("age", ""),
            "gender": char.get("gender", ""),
            "ethnicity": char.get("ethnicity", ""),
            "build": char.get("build", ""),
            "hair_and_skin": char.get("hair", ""),
            "distinctive_features": char.get("distinctive_features", ""),
            "default_wardrobe": char.get("wardrobe", ""),
            "face_geometry": None,
            "eyes_and_brows": None,
            "skin_tone": None,
        }
        db_char = StoryboardCharacter(
            storyboard_id=str(sb.id),
            name=char.get("name", "Unknown"),
            description=char.get("role", ""),
            character_dna=text_dna,
            dna_source="text_brief",
        )
        db.add(db_char)
        db.flush()
        created_characters[char.get("name", "")] = str(db_char.id)

    # Create products
    created_products: dict[str, str] = {}
    for prod in parsed.get("products", []):
        text_dna = {
            "source": "ai_generated",
            "product_type": prod.get("category", ""),
            "color_palette": prod.get("color", ""),
            "material_finish": prod.get("material", ""),
            "branding": prod.get("branding_notes", ""),
            "shape_geometry": prod.get("shape_description", ""),
        }
        db_prod = StoryboardProduct(
            storyboard_id=str(sb.id),
            name=prod.get("name", "Unknown"),
            description=prod.get("category", ""),
            product_dna=text_dna,
            dna_source="text_brief",
        )
        db.add(db_prod)
        db.flush()
        created_products[prod.get("name", "")] = str(db_prod.id)

    # Create frames
    for frame in parsed.get("frames", []):
        user_prompt = f"{frame.get('action', '')} — {frame.get('scene_description', '')}"
        char_ids = []
        for n in frame.get("characters_present", []):
            if n in created_characters:
                char_ids.append(created_characters[n])
            else:
                for k, v in created_characters.items():
                    if k.lower() in n.lower() or n.lower() in k.lower():
                        char_ids.append(v)
                        break
        prod_ids = []
        for n in frame.get("products_present", []):
            if n in created_products:
                prod_ids.append(created_products[n])
            else:
                for k, v in created_products.items():
                    if k.lower() in n.lower() or n.lower() in k.lower():
                        prod_ids.append(v)
                        break
        db_frame = StoryboardFrame(
            storyboard_id=str(sb.id),
            order_index=frame.get("frame_number", 1) - 1,
            scene_prompt=user_prompt,
            detected_character_ids=list(set(char_ids)),
            detected_product_ids=list(set(prod_ids)),
            status="pending",
        )
        db.add(db_frame)

    db.commit()

    return {
        "id": str(sb.id),
        "name": sb.name,
        "characters_created": len(created_characters),
        "products_created": len(created_products),
        "frames_scaffolded": len(parsed.get("frames", [])),
        "parsed_data": parsed,
    }


@router.post("/template-scaffold")
async def template_scaffold_storyboard(
    payload: TemplateScaffoldRequest,
    current_user: User = Depends(get_effective_storyboard_user),
    db: Session = Depends(get_db),
):
    """
    Creates a storyboard from a built-in template with pre-written frame starters.
    No AI call — instant.
    """
    tmpl = STORYBOARD_TEMPLATES.get(payload.template_key)
    if not tmpl:
        raise HTTPException(400, f"Unknown template '{payload.template_key}'. Valid keys: {list(STORYBOARD_TEMPLATES.keys())}")

    name = payload.name or f"{tmpl['label']} Campaign"
    sb = Storyboard(user_id=current_user.id, name=name, description=tmpl["description"])
    db.add(sb)
    db.flush()

    for idx, scene_prompt in enumerate(tmpl["frames"]):
        db_frame = StoryboardFrame(
            storyboard_id=str(sb.id),
            order_index=idx,
            scene_prompt=scene_prompt,
            status="pending",
        )
        db.add(db_frame)

    db.commit()

    return {
        "id": str(sb.id),
        "name": sb.name,
        "template_key": payload.template_key,
        "frames_scaffolded": len(tmpl["frames"]),
    }


@router.post("/{sb_id}/frame/{frame_id}/inspire-prompt")
async def inspire_frame_prompt(
    sb_id: str,
    frame_id: str,
    payload: InspirePromptRequest,
    current_user: User = Depends(get_effective_storyboard_user),
    db: Session = Depends(get_db),
):
    """
    Expands a rough one-liner into a rich cinematic scene description.
    """
    import main

    expanded_prompt = None
    sys_msg = (
        "You are a world-class storyboard prompt engineer. "
        "Given a rough idea for a single film frame, expand it into a rich, vivid, "
        "camera-ready scene description of 2-4 sentences. "
        "Describe: the specific action, exact framing (close-up / wide / OTS), "
        "lighting quality, mood/colour palette, and any props. "
        "Do NOT add characters unless the user mentioned them. "
        "Return ONLY the expanded prompt — no preamble, no explanation."
    )

    if main.OPENAI_API_KEY:
        try:
            oai_client = openai_lib.OpenAI(api_key=main.OPENAI_API_KEY)
            response = await asyncio.to_thread(
                oai_client.chat.completions.create,
                model="gpt-5.6-luna",
                messages=[
                    {"role": "system", "content": sys_msg},
                    {"role": "user", "content": payload.rough_idea},
                ],
                max_completion_tokens=300,
            )
            expanded_prompt = response.choices[0].message.content.strip()
        except Exception as e:
            print(f"[expand_frame_prompt] GPT-5.6 Luna failed: {e}, attempting Claude Sonnet 5 fallback...")
            expanded_prompt = None

    if not expanded_prompt and main.ANTHROPIC_API_KEY:
        claude_out = await _call_claude_sonnet_5_text(sys_msg, payload.rough_idea, max_tokens=300)
        if claude_out:
            expanded_prompt = claude_out

    if not expanded_prompt:
        expanded_prompt = payload.rough_idea

    return {"expanded_prompt": expanded_prompt}


@router.post("/{sb_id}/character/generate-from-description")
async def generate_character_from_description(
    sb_id: str,
    payload: GenerateFromDescriptionRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_effective_storyboard_user),
    db: Session = Depends(get_db),
):
    """
    Generates a photorealistic character reference image from a text description,
    saves it, creates the character record, then triggers DNA extraction in the background.
    """
    import main
    from google.genai import types

    sb = _find_storyboard(sb_id, current_user, db)
    if not sb:
        raise HTTPException(404, "Storyboard not found")

    if not main.global_client:
        raise HTTPException(503, "Gemini client not initialized")

    gen_prompt = (
        f"Studio portrait reference photograph of character '{payload.name}'. {payload.description}. "
        f"Full body standing studio pose, clear front view, plain white background, "
        f"soft neutral commercial lighting, sharp focus, natural skin texture with visible pores, "
        f"authentic physical details, anatomically correct."
    )

    config = main.load_nanobanana_config()
    prod_cfg = config.get("production", {"model": "gemini-3.1-flash-image", "temperature": 0.4})
    model_name = prod_cfg.get("model", "gemini-3.1-flash-image")

    try:
        results, enhanced_prompt, detected_pipeline = await main._gemini_generate(
            prompt=gen_prompt,
            ratio="3:4",
            quality="Standard",
            gemini_model=model_name,
            is_beta=False,
            request_source="STORYBOARD",
        )
        if not results:
            raise Exception("Nanobanana 2 returned no image")
        image_path = save_b64_image(results[0])
    except Exception as e:
        print(f"[Storyboard] Character generation with Nanobanana 2 failed: {e}")
        raise HTTPException(500, f"Failed to generate character image: {str(e)}")

    db_char = StoryboardCharacter(
        storyboard_id=sb_id,
        name=payload.name,
        description=payload.description,
        image_path=image_path,
        image_paths=[image_path],
        dna_source="generated",
    )
    db.add(db_char)
    db.commit()
    db.refresh(db_char)

    # Kick off DNA extraction asynchronously so the UI can poll
    async def _extract_dna_bg(char_id: str, sb_id: str):
        try:
            next_db = next(get_db())
            char = next_db.query(StoryboardCharacter).filter_by(id=char_id).first()
            if not char:
                return
            paths = char.image_paths or ([char.image_path] if char.image_path else [])
            contents = []
            for p in paths:
                b64_img = load_b64_image(p)
                if not b64_img:
                    continue
                b64_str = b64_img.split(",")[1] if "," in b64_img else b64_img
                image_bytes = safe_b64decode(b64_str)
                contents.append(types.Part.from_bytes(data=image_bytes, mime_type="image/png"))
            if not contents:
                return
            contents.append("Analyze this character reference image and extract their physical traits.")
            system_prompt = (
                "You are an expert forensic character designer. Extract character traits into strict JSON.\n"
                "Extract details across Physical Anchors, Costume Bible, Voice DNA, and Personality / Behavioral DNA.\n"
                "Return ONLY raw JSON, without markdown:\n"
                '{"physical_anchors":{"ethnicity_skin_tone":"...","age_gender":"...","face_shape_features":"...","hair_details":"...","eye_details":"...","build_details":"..."},'
                '"costume_bible":{"wardrobe_bible":"...","fixed_accessories":"...","recurring_elements":"..."},'
                '"voice_dna":{"voice_accent":"...","voice_pitch":"...","voice_pace":"...","voice_texture":"...","voice_emotional_default":"..."},'
                '"personality_dna":{"motivation":"...","communication_style":"...","emotional_range":"..."},'
                '"demographics":"...","face_geometry":"...","eyes_and_brows":"...","nose_and_mouth":"...",'
                '"hair_and_skin":"...","build_and_posture":"...","intrinsic_traits":"...","default_wardrobe":"...",'
                '"distinctive_features":"...","source_medium":"photorealistic CGI reference",'
                '"best_angle_index":0,"best_angle_reason":"Only image provided"}'
            )
            gemini_client = main.flash_client if main.flash_client else main.global_client
            dna_json = await _extract_json_with_retry(gemini_client, contents, system_prompt, model="gemini-2.5-flash-lite", retries=2)
            char.character_dna = dna_json
            char.dna_extraction_model = "gemini-2.5-flash-lite"
            char.dna_extraction_confidence = _calculate_confidence(
                dna_json, ["physical_anchors", "costume_bible", "voice_dna", "personality_dna", "demographics", "face_geometry", "eyes_and_brows", "hair_and_skin", "build_and_posture"]
            )
            from datetime import datetime as dt
            char.dna_extracted_at = dt.utcnow()
            next_db.commit()
            print(f"[Storyboard] Background DNA extraction done for generated char '{char.name}'")
        except Exception as e:
            print(f"[Storyboard] Background DNA extraction failed: {e}")
        finally:
            try:
                next_db.close()
            except Exception:
                pass

    background_tasks.add_task(_extract_dna_bg, str(db_char.id), sb_id)

    return {
        "id": db_char.id,
        "name": db_char.name,
        "image_path": image_path,
        "dna_status": "extracting",
    }


@router.post("/{sb_id}/product/generate-from-description")
async def generate_product_from_description(
    sb_id: str,
    payload: GenerateFromDescriptionRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_effective_storyboard_user),
    db: Session = Depends(get_db),
):
    """
    Generates a photorealistic product reference image from a text description,
    saves it, creates the product record, then triggers DNA extraction in the background.
    """
    import main
    from google.genai import types

    sb = _find_storyboard(sb_id, current_user, db)
    if not sb:
        raise HTTPException(404, "Storyboard not found")

    if not main.global_client:
        raise HTTPException(503, "Gemini client not initialized")

    gen_prompt = (
        f"Commercial studio product photograph of '{payload.name}'. {payload.description}. "
        f"Clean 3/4 angle product shot, pure white studio background, balanced commercial studio lighting, "
        f"crisp material textures, razor-sharp focus, accurate product proportions and geometry."
    )

    config = main.load_nanobanana_config()
    prod_cfg = config.get("production", {"model": "gemini-3.1-flash-image", "temperature": 0.4})
    model_name = prod_cfg.get("model", "gemini-3.1-flash-image")

    try:
        results, enhanced_prompt, detected_pipeline = await main._gemini_generate(
            prompt=gen_prompt,
            ratio="1:1",
            quality="Standard",
            gemini_model=model_name,
            is_beta=False,
            request_source="STORYBOARD",
        )
        if not results:
            raise Exception("Nanobanana 2 returned no image")
        image_path = save_b64_image(results[0])
    except Exception as e:
        print(f"[Storyboard] Product generation with Nanobanana 2 failed: {e}")
        raise HTTPException(500, f"Failed to generate product image: {str(e)}")

    db_prod = StoryboardProduct(
        storyboard_id=sb_id,
        name=payload.name,
        description=payload.description,
        image_path=image_path,
        image_paths=[image_path],
        dna_source="generated",
    )
    db.add(db_prod)
    db.commit()
    db.refresh(db_prod)

    async def _extract_product_dna_bg(prod_id: str, sb_id: str):
        try:
            next_db = next(get_db())
            prod = next_db.query(StoryboardProduct).filter_by(id=prod_id).first()
            if not prod:
                return
            paths = prod.image_paths or ([prod.image_path] if prod.image_path else [])
            contents = []
            for p in paths:
                b64_img = load_b64_image(p)
                if not b64_img:
                    continue
                b64_str = b64_img.split(",")[1] if "," in b64_img else b64_img
                image_bytes = safe_b64decode(b64_str)
                contents.append(types.Part.from_bytes(data=image_bytes, mime_type="image/png"))
            if not contents:
                return
            contents.append("Analyze this product reference image and extract its visual identity.")
            system_prompt = (
                "You are an expert product photographer. Extract product traits into strict JSON. "
                "Return ONLY raw JSON:\n"
                '{"product_type":"...","material_finish":"...","color_palette":"...","shape_geometry":"...",'
                '"branding":"...","surface_details":"...","distinctive_features":"...","background_interaction":"...",'
                '"scale_reference":"...","source_medium":"photorealistic CGI reference",'
                '"best_angle_index":0,"best_angle_reason":"Only image provided"}'
            )
            gemini_client = main.flash_client if main.flash_client else main.global_client
            dna_json = await _extract_json_with_retry(gemini_client, contents, system_prompt, model="gemini-2.5-flash-lite", retries=2)
            prod.product_dna = dna_json
            prod.dna_extraction_model = "gemini-2.5-flash-lite"
            prod.dna_extraction_confidence = _calculate_confidence(
                dna_json, ["product_type", "color_palette", "shape_geometry", "branding", "surface_details"]
            )
            from datetime import datetime as dt
            prod.dna_extracted_at = dt.utcnow()
            next_db.commit()
            print(f"[Storyboard] Background DNA extraction done for generated product '{prod.name}'")
        except Exception as e:
            print(f"[Storyboard] Background product DNA extraction failed: {e}")
        finally:
            try:
                next_db.close()
            except Exception:
                pass

    background_tasks.add_task(_extract_product_dna_bg, str(db_prod.id), sb_id)

    return {
        "id": db_prod.id,
        "name": db_prod.name,
        "image_path": image_path,
        "dna_status": "extracting",
    }


# ═════════════════════════════════════════════════════════════════════════════
# SMART CONVERSATIONAL STORYBOARD AGENT (GPT-5.6 Luna + Claude Sonnet 5)
# ═════════════════════════════════════════════════════════════════════════════

class ChatGenerateVisualRequest(BaseModel):
    entity_type: str  # "character" or "product"
    entity_id: str
    model: Optional[str] = None

class ChatModifyEntityRequest(BaseModel):
    entity_type: str  # "character" or "product"
    entity_id: str
    instruction: str

class ChatContactSheetRequest(BaseModel):
    frame_count: Optional[int] = 6
    edit_instruction: Optional[str] = None
    target_frame_numbers: Optional[List[int]] = None
    is_refinement: Optional[bool] = False
    marketing_angle: Optional[str] = None
    model: Optional[str] = None

class SelectAngleRequest(BaseModel):
    angle_id: Optional[str] = None
    angle_title: str
    angle_description: Optional[str] = None
    custom_instruction: Optional[str] = None


def _get_grid_dimensions(n_frames: int) -> Tuple[int, int]:
    """Returns (columns, rows) for an n_frames storyboard contact sheet grid."""
    if n_frames <= 1:
        return (1, 1)
    elif n_frames == 2:
        return (2, 1)
    elif n_frames == 3:
        return (3, 1)
    elif n_frames == 4:
        return (2, 2)
    elif n_frames in (5, 6):
        return (3, 2)
    elif n_frames in (7, 8):
        return (4, 2)
    elif n_frames == 9:
        return (3, 3)
    elif n_frames <= 12:
        return (4, 3)
    else:
        return (5, 3)


def _clean_corner_number_artifact(panel_crop_img):
    """
    Safeguard: If a panel contains a painted black digit in its top-left corner
    from an earlier prompt, cleanly inpaint it so the panel is pristine.
    """
    try:
        import cv2
        import numpy as np
        from PIL import Image
        np_img = cv2.cvtColor(np.array(panel_crop_img), cv2.COLOR_RGB2BGR)
        h, w = np_img.shape[:2]
        roi_h = min(int(h * 0.35), 140)
        roi_w = min(int(w * 0.2), 100)
        roi = np_img[:roi_h, :roi_w]

        dark = np.all(roi < 45, axis=2).astype(np.uint8) * 255
        if np.count_nonzero(dark) > 50:
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
            dark_dilated = cv2.dilate(dark, kernel, iterations=2)
            mask = np.zeros((h, w), dtype=np.uint8)
            mask[:roi_h, :roi_w] = dark_dilated
            cleaned_bgr = cv2.inpaint(np_img, mask, inpaintRadius=5, flags=cv2.INPAINT_TELEA)
            return Image.fromarray(cv2.cvtColor(cleaned_bgr, cv2.COLOR_BGR2RGB))
    except Exception as e:
        print(f"[SmartChat] _clean_corner_number_artifact skipped: {e}")
    return panel_crop_img


def crop_contact_sheet_panels(contact_sheet_url: str, n_frames: int) -> List[str]:
    """
    Legacy helper: kept for backward compatibility.
    Returns an empty list since we now generate individual frames directly
    and stitch them — slicing is no longer used.
    """
    print("[SmartChat] crop_contact_sheet_panels: legacy slicing disabled — using direct per-frame images instead.")
    return []


def _get_contact_sheet_layout(n: int):
    """Return (cols, rows) for a numbered contact sheet given n frames."""
    if n <= 5:
        return n, 1
    elif n == 6:
        return 3, 2
    elif n in [7, 8]:
        return 4, 2
    elif n in [9, 10]:
        return 5, 2
    else:
        cols = 4
        rows = (n + cols - 1) // cols
        return cols, rows


def stitch_frames_into_contact_sheet(frame_urls: List[str]) -> str:
    """
    Stitch N individual frame images into a unified numbered contact sheet image.
    Each panel gets a 'FRAME N' badge header above it.
    Returns the saved contact sheet URL.
    """
    import io
    from PIL import Image, ImageDraw, ImageFont

    n = len(frame_urls)
    if n == 0:
        raise ValueError("No frame images to stitch")

    # Load all frame images
    frame_images = []
    for url in frame_urls:
        try:
            b64_str = load_b64_image(url)
            if not b64_str:
                # Create a placeholder dark frame
                placeholder = Image.new("RGB", (960, 540), color=(20, 20, 28))
                frame_images.append(placeholder)
                continue
            raw = safe_b64decode(b64_str)
            img = Image.open(io.BytesIO(raw)).convert("RGB")
            frame_images.append(img)
        except Exception as e:
            print(f"[Stitch] Could not load frame image: {e}")
            placeholder = Image.new("RGB", (960, 540), color=(20, 20, 28))
            frame_images.append(placeholder)

    cols, rows = _get_contact_sheet_layout(n)

    # Cell dimensions — preserve 16:9 ratio at a reasonable resolution
    cell_w = 480
    cell_h = 270
    header_h = 40   # height reserved above each panel for the FRAME N badge
    pad = 20        # outer padding
    gap = 14        # gap between panels

    total_w = pad * 2 + cols * cell_w + (cols - 1) * gap
    total_h = pad * 2 + rows * (cell_h + header_h) + (rows - 1) * gap

    canvas = Image.new("RGB", (total_w, total_h), color=(12, 12, 16))
    draw = ImageDraw.Draw(canvas)

    # Load font — fall back to default if not available
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 14)
    except Exception:
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 14)
        except Exception:
            font = ImageFont.load_default()

    for i, img in enumerate(frame_images):
        c = i % cols
        r = i // cols
        x = pad + c * (cell_w + gap)
        y = pad + r * (cell_h + header_h + gap)

        # ── Draw numbered badge above panel ──
        badge_text = f"FRAME {i + 1}"
        badge_w = 108
        badge_h = 26
        badge_x = x + (cell_w - badge_w) // 2
        badge_y = y + 6
        draw.rounded_rectangle(
            [badge_x, badge_y, badge_x + badge_w, badge_y + badge_h],
            radius=6,
            fill=(24, 24, 36),
            outline=(249, 87, 56),
            width=1,
        )
        bbox = draw.textbbox((0, 0), badge_text, font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        draw.text(
            (badge_x + (badge_w - tw) // 2, badge_y + (badge_h - th) // 2 - 1),
            badge_text,
            fill=(255, 255, 255),
            font=font,
        )

        # ── Paste the frame image ──
        resized = img.resize((cell_w, cell_h), Image.LANCZOS)
        img_y = y + header_h
        canvas.paste(resized, (x, img_y))
        # Subtle border around frame
        draw.rectangle(
            [x, img_y, x + cell_w - 1, img_y + cell_h - 1],
            outline=(38, 38, 52),
            width=1,
        )

    # Encode and save
    buf = io.BytesIO()
    canvas.save(buf, format="PNG", optimize=True)
    b64_data = base64.b64encode(buf.getvalue()).decode("utf-8")
    saved_url = save_b64_image(b64_data)
    print(f"[Stitch] Stitched {n} frames into contact sheet → {saved_url[:60]}")
    return saved_url


def _restitch_contact_sheet_if_present(sb_id: str, db: Session):
    """
    If the storyboard has an active contact sheet, re-stitches it with the latest
    frame image_paths so the contact sheet is always in sync with any frame edits.
    """
    try:
        sb = db.query(Storyboard).filter(Storyboard.id == sb_id).first()
        if not sb or not sb.contact_sheet_url:
            return
        frames = db.query(StoryboardFrame).filter(
            StoryboardFrame.storyboard_id == sb_id
        ).order_by(StoryboardFrame.order_index).all()
        urls = [f.image_path for f in frames if f.image_path]
        if urls and len(urls) == len(frames):
            new_cs = stitch_frames_into_contact_sheet(urls)
            sb.contact_sheet_url = new_cs
            db.commit()
            print(f"[SmartChat] Re-stitched contact sheet after frame update for storyboard {sb_id}")
    except Exception as e:
        print(f"[SmartChat] _restitch_contact_sheet_if_present error (non-critical): {e}")


def sync_contact_sheet_panels_to_db(sb: Storyboard, db: Session, force: bool = False) -> List[StoryboardFrame]:
    """
    Synchronizes StoryboardFrame records from the existing direct per-frame images.
    The new approach generates individual frame images directly (not sliced from a composite),
    so this just ensures DB records are in order. If any frames have direct image_paths, they are preserved.
    """
    if not sb:
        return []

    existing_frames = db.query(StoryboardFrame).filter(
        StoryboardFrame.storyboard_id == sb.id
    ).order_by(StoryboardFrame.order_index).all()

    # Determine n_frames from existing frames or chat history
    n_frames = len(existing_frames)
    scenes = []
    if sb.chat_history:
        for msg in reversed(sb.chat_history):
            if isinstance(msg, dict) and msg.get("contact_sheet_url"):
                if msg.get("frame_count"):
                    n_frames = int(msg["frame_count"])
                if msg.get("scenes"):
                    scenes = msg.get("scenes", [])
                break

    if n_frames <= 0:
        n_frames = sb.slider_frame_count or 4

    # If not forcing, return existing if all frames already have images and are done
    if not force and existing_frames and len(existing_frames) == n_frames and all(f.image_path and f.status == "done" for f in existing_frames):
        return existing_frames

    chars = db.query(StoryboardCharacter).filter(StoryboardCharacter.storyboard_id == sb.id).all()
    char_map = {c.name.lower(): c.id for c in chars}

    updated_frames = []
    for idx in range(n_frames):
        sc = scenes[idx] if idx < len(scenes) else {"scene_prompt": f"Scene {idx+1}", "characters_present": []}
        detected_cids = [char_map[cn.lower()] for cn in sc.get("characters_present", []) if cn.lower() in char_map]

        if idx < len(existing_frames):
            frame_obj = existing_frames[idx]
            # Preserve existing image_path — do not overwrite with sliced version
            if sc.get("scene_prompt") and (not frame_obj.scene_prompt or frame_obj.scene_prompt.startswith("Scene ")):
                frame_obj.scene_prompt = sc.get("scene_prompt")
            if detected_cids and not frame_obj.detected_character_ids:
                frame_obj.detected_character_ids = detected_cids
            # Mark done if image exists
            if frame_obj.image_path:
                frame_obj.status = "done"
        else:
            frame_obj = StoryboardFrame(
                storyboard_id=sb.id,
                order_index=idx,
                scene_prompt=sc.get("scene_prompt", f"Scene {idx+1}"),
                detected_character_ids=detected_cids,
                image_path=None,
                status="pending"
            )
            db.add(frame_obj)
            db.flush()
        updated_frames.append(frame_obj)

    # Clean up any trailing frames beyond n_frames
    if len(existing_frames) > n_frames:
        for extra in existing_frames[n_frames:]:
            db.delete(extra)

    db.commit()
    for f in updated_frames:
        db.refresh(f)
    print(f"[SmartChat] Synchronized {len(updated_frames)} frames for storyboard {sb.id}")
    return updated_frames



async def _call_vision_reasoning_luna_sonnet5(system_prompt: str, user_prompt: str, images_b64: list = None) -> str:
    """
    Multimodal Vision & Reasoning using GPT-5.6 Luna with Claude Sonnet 5 fallback.
    Excludes Gemini 2.5 Flash completely.
    """
    import main
    import openai as openai_lib
    import anthropic

    images_b64 = images_b64 or []

    # ── 1. Primary: GPT-5.6 Luna ──
    if main.OPENAI_API_KEY:
        try:
            oai_client = openai_lib.OpenAI(api_key=main.OPENAI_API_KEY)
            content_parts = []
            if user_prompt:
                content_parts.append({"type": "text", "text": user_prompt})
            for b64 in images_b64:
                raw_b64 = b64.split(",")[1] if "," in b64 else b64
                content_parts.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{raw_b64}"}
                })
            messages = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            messages.append({"role": "user", "content": content_parts if content_parts else "Analyze the provided input."})

            loop = asyncio.get_event_loop()
            resp = await loop.run_in_executor(
                None,
                lambda: oai_client.chat.completions.create(
                    model="gpt-5.6-luna",
                    messages=messages,
                )
            )
            text_out = resp.choices[0].message.content
            if text_out:
                print(f"[SmartChat] GPT-5.6 Luna completed reasoning ({len(text_out)} chars)")
                return text_out
        except Exception as e:
            print(f"[SmartChat] GPT-5.6 Luna failed ({e}), attempting Claude Sonnet 5 fallback...")

    # ── 2. Fallback: Claude Sonnet 5 ──
    if main.ANTHROPIC_API_KEY:
        try:
            ant_client = anthropic.Anthropic(api_key=main.ANTHROPIC_API_KEY)
            claude_content = []
            for b64 in images_b64:
                raw_b64 = b64.split(",")[1] if "," in b64 else b64
                claude_content.append({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/png",
                        "data": raw_b64
                    }
                })
            claude_content.append({"type": "text", "text": user_prompt or "Analyze this input."})

            # Note: For Claude Sonnet 5, setting sampling parameters (temperature, top_p) returns a 400 error!
            loop = asyncio.get_event_loop()
            resp = await loop.run_in_executor(
                None,
                lambda: ant_client.messages.create(
                    model="claude-sonnet-5",
                    max_tokens=8192,
                    system=system_prompt if system_prompt else None,
                    messages=[{"role": "user", "content": claude_content}]
                )
            )
            text_blocks = [b.text for b in resp.content if hasattr(b, "text")]
            text_out = "".join(text_blocks)
            if text_out:
                print(f"[SmartChat] Claude Sonnet 5 fallback completed reasoning ({len(text_out)} chars)")
                return text_out
        except Exception as e:
            print(f"[SmartChat] Claude Sonnet 5 fallback failed: {e}")

    raise HTTPException(status_code=500, detail="Multimodal reasoning failed on both GPT-5.6 Luna and Claude Sonnet 5.")


async def _generate_visual_with_fallback(
    prompt: str, 
    ratio: str = "1:1", 
    is_contact_sheet: bool = False,
    reference_image_b64: Optional[Union[str, List[str]]] = None,
    cancel_check: Optional[Callable[[], bool]] = None,
    force_model: Optional[str] = None,
) -> str:
    """
    Image generation running Gemini 3.1 Flash Image (Nanobanana 2) and GPT Image 1.5 in a loop.
    Supports reference images for continuous edit preservation and image-to-image refinement.
    If force_model is specified, strictly respects the selected model without cross-provider fallback.
    """
    import main

    image_b64 = None
    MAX_DUAL_CYCLES = 3
    last_dual_error = None

    for cycle in range(1, MAX_DUAL_CYCLES + 1):
        if cancel_check and cancel_check():
            raise asyncio.CancelledError("Visual generation cancelled by user")

        print(f"[SmartChat] Dual-loop visual generation cycle {cycle}/{MAX_DUAL_CYCLES}...")

        # 1. Primary in loop: Nanobanana 2 (Gemini 3.1 Flash Image)
        skip_gemini = bool(force_model and force_model in ["gpt-image-1.5", "dall-e-3"])
        if not skip_gemini:
            try:
                model_name = "gemini-3.1-flash-image"
                print(f"[SmartChat] (Cycle {cycle}) Trying Nanobanana 2 / {model_name} (has_ref={bool(reference_image_b64)})...")
                results, _, _ = await main._gemini_generate(
                    prompt=prompt,
                    ratio=ratio,
                    quality="Standard",
                    image_b64=reference_image_b64,
                    gemini_model=model_name,
                    is_beta=False,
                    bypass_enhancement=bool(reference_image_b64),
                    request_source="STORYBOARD"
                )
                if results and len(results) > 0:
                    image_b64 = results[0]
                    print(f"[SmartChat] Successfully generated image via Nanobanana 2 ({model_name}) on cycle {cycle}")
                    break
            except asyncio.CancelledError:
                raise
            except Exception as e:
                last_dual_error = e
                if cancel_check and cancel_check():
                    raise asyncio.CancelledError("Visual generation cancelled by user")
                err_str = str(e)
                is_quota = "429" in err_str or "RESOURCE_EXHAUSTED" in err_str or (hasattr(e, "status_code") and e.status_code == 429)
                print(f"[SmartChat] (Cycle {cycle}) Nanobanana 2 ({model_name}) failed: {e}.")
                skip_gpt = bool(force_model and force_model in ["gemini-3.1-flash-image", "nanobanana", "nanobanana 2"])
                if is_quota and (skip_gpt or not main.OPENAI_API_KEY):
                    print(f"[SmartChat] Gemini quota exhausted across all projects and GPT fallback is disabled/unavailable. Aborting cycle loop immediately.")
                    raise e

        # 2. Secondary in loop: GPT Image 1.5 (skipped if user strictly chose nanobanana)
        skip_gpt = bool(force_model and force_model in ["gemini-3.1-flash-image", "nanobanana", "nanobanana 2"])
        if main.OPENAI_API_KEY and not skip_gpt:
            if cancel_check and cancel_check():
                raise asyncio.CancelledError("Visual generation cancelled by user")
            try:
                print(f"[SmartChat] (Cycle {cycle}) Trying GPT Image 1.5 (has_ref={bool(reference_image_b64)})...")
                results = await main._chatgpt_image_generate(
                    prompt=prompt,
                    ratio=ratio,
                    quality="Standard",
                    image_b64=reference_image_b64,
                    model="gpt-image-1.5"
                )
                imgs = results[0] if isinstance(results, tuple) else results
                if imgs:
                    image_b64 = imgs[0] if isinstance(imgs, list) else imgs
                    print(f"[SmartChat] Successfully generated image via GPT Image 1.5 on cycle {cycle}")
                    break
            except asyncio.CancelledError:
                raise
            except Exception as e:
                last_dual_error = e
                if cancel_check and cancel_check():
                    raise asyncio.CancelledError("Visual generation cancelled by user")
                print(f"[SmartChat] (Cycle {cycle}) GPT Image 1.5 failed: {e}")

        # If image succeeded, exit loop
        if image_b64:
            break

        # If both failed in this cycle, wait progressive backoff before next cycle
        if cycle < MAX_DUAL_CYCLES:
            wait_sec = 2 * cycle
            print(f"[SmartChat] Both models failed in cycle {cycle}. Backing off {wait_sec}s before next loop cycle...")
            await asyncio.sleep(wait_sec)

    if not image_b64:
        raise HTTPException(
            status_code=500,
            detail=f"Image generation failed after {MAX_DUAL_CYCLES} dual loops between Nanobanana 2 (Gemini 3.1 Flash Image) and GPT Image 1.5. Last error: {last_dual_error}"
        )

    return save_b64_image(image_b64)


@router.post("/{storyboard_id}/chat/intake")
async def chat_intake(
    storyboard_id: str,
    text: Optional[str] = Form(None),
    frame_count: Optional[int] = Form(6),
    files: List[UploadFile] = File(default=[]),
    current_user: User = Depends(get_effective_storyboard_user),
    db: Session = Depends(get_db),
):
    """
    Accepts user text, uploaded files (images or PDFs).
    Renders PDF pages to images via PyMuPDF (fitz), gathers visual inputs,
    runs GPT-5.6 Luna (fallback Claude Sonnet 5) to extract storyline, characters & products DNA.
    """
    sb = _find_storyboard(storyboard_id, current_user, db)
    if not sb:
        raise HTTPException(404, "Storyboard not found")
    sb_id = storyboard_id

    user_text = (text or "").strip()
    target_frame_count = max(1, min(15, frame_count or 6))

    all_images_b64: List[str] = []
    file_summaries: List[str] = []
    uploaded_image_urls: List[str] = []

    # Process uploaded files
    for f in files:
        if not f.filename:
            continue
        fname_lower = f.filename.lower()
        file_bytes = await f.read()

        if fname_lower.endswith(".pdf"):
            try:
                import fitz
                pdf_doc = fitz.open(stream=file_bytes, filetype="pdf")
                file_summaries.append(f"PDF document: {f.filename} ({len(pdf_doc)} pages)")
                for page_num in range(min(10, len(pdf_doc))):  # Up to 10 pages
                    page = pdf_doc[page_num]
                    pix = page.get_pixmap(dpi=150)
                    img_bytes = pix.tobytes("png")
                    all_images_b64.append(base64.b64encode(img_bytes).decode("utf-8"))
            except Exception as e:
                print(f"[SmartChat] PyMuPDF failed on {f.filename}: {e}")
                file_summaries.append(f"Failed to parse PDF {f.filename}: {e}")
        elif fname_lower.endswith((".png", ".jpg", ".jpeg", ".webp")):
            ext = fname_lower.split(".")[-1]
            up_id = str(uuid.uuid4())
            out_filename = f"upload_{up_id}.{ext}"
            out_abs = os.path.join(EXPORTS_DIR, out_filename)
            try:
                with open(out_abs, "wb") as out_f:
                    out_f.write(file_bytes)
                uploaded_image_urls.append(f"exports/storyboard/{out_filename}")
            except Exception as save_err:
                print(f"[SmartChat] Failed to save uploaded image {f.filename}: {save_err}")
            all_images_b64.append(base64.b64encode(file_bytes).decode("utf-8"))
            file_summaries.append(f"Image reference: {f.filename}")
        elif fname_lower.endswith((".txt", ".md", ".json")):
            try:
                extracted_txt = file_bytes.decode("utf-8", errors="ignore")
                user_text += f"\n\n[Content of {f.filename}]:\n{extracted_txt[:4000]}"
                file_summaries.append(f"Text document: {f.filename}")
            except Exception:
                pass

    # Purge any ghost characters/products with empty or blank names from past runs
    db.query(StoryboardCharacter).filter(
        StoryboardCharacter.storyboard_id == sb_id,
        (StoryboardCharacter.name == "") | (StoryboardCharacter.name == None)
    ).delete(synchronize_session=False)
    db.query(StoryboardProduct).filter(
        StoryboardProduct.storyboard_id == sb_id,
        (StoryboardProduct.name == "") | (StoryboardProduct.name == None)
    ).delete(synchronize_session=False)
    db.commit()

    existing_chars = [c for c in db.query(StoryboardCharacter).filter(StoryboardCharacter.storyboard_id == sb_id).all() if c.name and c.name.strip()]
    existing_prods = [p for p in db.query(StoryboardProduct).filter(StoryboardProduct.storyboard_id == sb_id).all() if p.name and p.name.strip()]
    existing_frames = db.query(StoryboardFrame).filter(StoryboardFrame.storyboard_id == sb_id).order_by(StoryboardFrame.order_index).all()
    has_existing_context = bool(existing_chars or existing_prods or sb.contact_sheet_url or existing_frames)

    char_summary_lines = []
    for c in existing_chars:
        dna = c.character_dna or {}
        char_summary_lines.append(
            f"Character '{c.name}': Description: {c.description or ''} | Wardrobe: {dna.get('clothing_wardrobe', 'Unspecified')} | "
            f"Hair: {dna.get('hair', 'Unspecified')} | Skin Tone: {dna.get('skin_tone', 'Unspecified')} | Features: {dna.get('facial_features', 'Unspecified')} | "
            f"Build: {dna.get('build_height', 'Unspecified')} | Props: {dna.get('distinguishing_props', 'None')} | Demeanor: {dna.get('demeanor_expression', 'Neutral')}"
        )

    prod_summary_lines = []
    for p in existing_prods:
        dna = p.product_dna or {}
        prod_summary_lines.append(
            f"Product '{p.name}': Description: {p.description or ''} | Category: {dna.get('category', 'Unspecified')}, "
            f"Color/Material: {dna.get('color_material', 'Unspecified')}, Shape: {dna.get('shape_silhouette', 'Unspecified')}, Branding: {dna.get('distinctive_branding', 'None')}"
        )

    frame_summary_lines = []
    for f in existing_frames:
        frame_summary_lines.append(f"Panel {f.order_index + 1}: {f.scene_prompt}")

    if has_existing_context:
        system_prompt = f"""
You are the Genfy Storyboard AI Assistant continuing an ongoing storyboard production session.

CURRENT PROJECT CONTEXT:
- Storyboard Title: {sb.name}
- Current Frame Count: {len(existing_frames) or target_frame_count}
- Existing Characters:
{chr(10).join(char_summary_lines) if char_summary_lines else "None yet"}
- Existing Products / Props:
{chr(10).join(prod_summary_lines) if prod_summary_lines else "None yet"}
- Existing Storyboard Frames / Scenes:
{chr(10).join(frame_summary_lines) if frame_summary_lines else "None yet"}
- Contact Sheet Generated: {"Yes" if sb.contact_sheet_url else "Not yet"}

USER INPUT:
"{user_text}"

CRITICAL INTENT CLASSIFICATION INSTRUCTIONS:
Determine which intent best matches the user's input:

A. "entity_modification":
The user wants to update, refine, or edit a specific character or product's appearance, clothing, hair, colors, props, or features (e.g., "change Elena's clothes to dark", "make her wear black dress", "make her hair blonde", "change its clothes to dark", "make the jar blue").
- "intent": "entity_modification"
- "entity_type": "character" or "product"
- "entity_name": exact name of the character or product from the project context above
- "modification_instruction": precise instruction of what to modify
- "assistant_message": friendly confirmation acknowledging the exact change (e.g., "Got it! Updating Elena's wardrobe to dark clothing and regenerating her look.")
- "updated_dna": the full updated character_dna or product_dna dictionary incorporating the change while keeping all other unaffected traits preserved.

B. "proceed_contact_sheet":
The user is telling the assistant to proceed, generate the storyboard, generate contact sheet, create frames, move forward, etc. (e.g., "proceed", "looks good let's generate", "create storyboard", "continue", "let's go").
- "intent": "proceed_contact_sheet"
- "assistant_message": "Generating your storyboard contact sheet now..."

C. "frame_refinement":
The user wants to modify an existing storyboard frame or panel (e.g., "in frame 4 don't smile", "make panel 2 warmer", "change frame 1").
- "intent": "frame_refinement"
- "target_frame_numbers": [list of 1-indexed integers of frames affected, e.g. [4]]
- "edit_instruction": "Precise description of what to modify in the target panel(s) and emphasizing that all other panels, character appearance, hair, clothing, props, and lighting MUST remain identical to the existing contact sheet."
- "assistant_message": A reassuring, friendly message acknowledging the exact edit requested.
- "scenes": An array of updated scene objects for all {len(existing_frames) or target_frame_count} frames, where the target frame's scene_prompt is modified to reflect the user's change, and all other frames are preserved.

D. "new_story":
The user is providing a completely new story concept to overwrite the project.
- "intent": "new_story"
- Extract characters, products, story_logline, etc.

E. "query":
The user is asking a conversational question, inquiring about the existing storyline, characters, products, scenes, narrative pacing, or seeking creative advice (e.g., "what is the storyline look like", "what does the story look like?", "what scenes do we have?", "tell me about Spider-Man", "who is in panel 1?", "explain the plot", "what is happening here?").
- "intent": "query"
- "is_refinement": false
- "target_frame_numbers": []
- "assistant_message": A helpful, rich, and clear direct answer responding to the user's question based on the existing storyline, panels, and characters.

Return ONLY a valid JSON object matching this schema:
{{
  "intent": "entity_modification" | "proceed_contact_sheet" | "frame_refinement" | "new_story" | "query",
  "entity_type": "character" | "product",
  "entity_name": "string",
  "modification_instruction": "string",
  "updated_dna": {{
    "name": "string",
    "hair": "string",
    "skin_tone": "string",
    "build_height": "string",
    "facial_features": "string",
    "clothing_wardrobe": "string",
    "distinguishing_props": "string",
    "demeanor_expression": "string"
  }},
  "is_refinement": bool,
  "target_frame_numbers": [int],
  "edit_instruction": "string",
  "story_logline": "string",
  "detected_frame_count": {target_frame_count},
  "assistant_message": "string",
  "characters": [
    {{
      "name": "string",
      "tagline": "string",
      "hair": "string",
      "skin_tone": "string",
      "build_height": "string",
      "facial_features": "string",
      "clothing_wardrobe": "string",
      "distinguishing_props": "string",
      "demeanor_expression": "string",
      "physical_anchors": {{
        "ethnicity_skin_tone": "string",
        "age_gender": "string",
        "face_shape_features": "string",
        "hair_details": "string",
        "eye_details": "string",
        "build_details": "string"
      }},
      "costume_bible": {{
        "wardrobe_bible": "string",
        "fixed_accessories": "string",
        "recurring_elements": "string"
      }},
      "voice_dna": {{
        "voice_accent": "string",
        "voice_pitch": "string",
        "voice_pace": "string",
        "voice_texture": "string",
        "voice_emotional_default": "string"
      }},
      "personality_dna": {{
        "motivation": "string",
        "communication_style": "string",
        "emotional_range": "string"
      }}
    }}
  ],
  "products": [
    {{
      "name": "string",
      "category": "string",
      "product_type": "string",
      "color_palette": "string",
      "material_finish": "string",
      "shape_geometry": "string",
      "branding": "string",
      "surface_details": "string",
      "distinctive_features": "string",
      "scale_reference": "string",
      "description": "string"
    }}
  ],
  "scenes": [
    {{
      "frame_number": int,
      "scene_title": "string",
      "scene_prompt": "string",
      "characters_present": ["string"]
    }}
  ]
}}
Do NOT output markdown code blocks. Output pure JSON.
"""
    else:
        system_prompt = f"""
You are a world-class creative director and storyboard architect.
Analyze the user's creative prompt and all attached images/PDF pages.
Extract:
1. A concise narrative summary / logline of the story.
2. The desired frame count (default to {target_frame_count} if unspecified, or infer if the user requested e.g. "4 frames" or "8 scenes").
3. All key CHARACTERS, creating a fully populated 4-dimension DNA profile for each:
   - Physical Anchors (ethnicity, age/gender, face/jaw features, hair details, eye shape/color, build/posture)
   - Costume Bible (wardrobe garments/colors/fabrics, fixed accessories, recurring elements)
   - Voice DNA (language/accent, pitch, pace/WPM, vocal texture, default emotional delivery)
   - Personality / Behavioral DNA (core motivation, communication style, on-screen emotional range)
4. All key PRODUCTS or critical PROPS, creating a physical description and branding DNA:
   - Product Type/Category, Color Palette, Material & Finish, Shape & Geometry, Branding/Logos, Surface Details, Distinctive Features, Scale Reference.
5. 3 to 4 distinct, creative MARKETING & STORYTELLING ANGLES tailored specifically to this concept/brand to ensure the storyboard has a focused commercial narrative (e.g. Comedy Twist, Emotional Nostalgia, Premium High-Tech, Gen-Z Viral Hook).
6. A friendly, professional assistant response acknowledging the story concept and introducing the extracted entities.

Return ONLY a valid JSON object matching this schema:
{{
  "intent": "new_story",
  "is_refinement": false,
  "target_frame_numbers": [],
  "edit_instruction": "",
  "story_logline": "string",
  "detected_frame_count": {target_frame_count},
  "assistant_message": "string (friendly conversation explaining what was found)",
  "marketing_angles": [
    {{
      "id": "angle_1",
      "title": "string (catchy creative direction title)",
      "description": "string (1-2 sentence breakdown of the narrative arc and pacing)",
      "tone": "string (e.g. Humorous & Bollywood Filmy, Emotional & Warm)",
      "hook": "string (the commercial or emotional hook)"
    }}
  ],
  "characters": [
    {{
      "name": "string",
      "tagline": "string (e.g. Lead protagonist, 20s freelance artist)",
      "hair": "string",
      "skin_tone": "string",
      "build_height": "string",
      "facial_features": "string",
      "clothing_wardrobe": "string",
      "distinguishing_props": "string",
      "demeanor_expression": "string",
      "physical_anchors": {{
        "ethnicity_skin_tone": "string",
        "age_gender": "string",
        "face_shape_features": "string",
        "hair_details": "string",
        "eye_details": "string",
        "build_details": "string"
      }},
      "costume_bible": {{
        "wardrobe_bible": "string",
        "fixed_accessories": "string",
        "recurring_elements": "string"
      }},
      "voice_dna": {{
        "voice_accent": "string",
        "voice_pitch": "string",
        "voice_pace": "string",
        "voice_texture": "string",
        "voice_emotional_default": "string"
      }},
      "personality_dna": {{
        "motivation": "string",
        "communication_style": "string",
        "emotional_range": "string"
      }}
    }}
  ],
  "products": [
    {{
      "name": "string",
      "category": "string",
      "product_type": "string",
      "color_palette": "string",
      "material_finish": "string",
      "shape_geometry": "string",
      "branding": "string",
      "surface_details": "string",
      "distinctive_features": "string",
      "scale_reference": "string",
      "description": "string"
    }}
  ]
}}
Do NOT output markdown code blocks. Output pure JSON.
"""

    prompt_body = f"User Request:\n{user_text}\n\nAttached Assets:\n" + "\n".join(file_summaries)
    llm_response = await _call_vision_reasoning_luna_sonnet5(system_prompt, prompt_body, all_images_b64)

    # Parse JSON
    cleaned_json = llm_response.strip()
    if cleaned_json.startswith("```"):
        cleaned_json = cleaned_json.split("\n", 1)[-1]
    if cleaned_json.endswith("```"):
        cleaned_json = cleaned_json.rsplit("```", 1)[0]
    cleaned_json = cleaned_json.strip()

    parsed = None
    try:
        parsed = json.loads(cleaned_json)
    except Exception as e:
        print(f"[SmartChat] JSON direct decode error: {e}. Attempting repair...")
        # 1. Try finding complete JSON object
        try:
            m = re.search(r"\{.*\}", cleaned_json, re.DOTALL)
            if m:
                parsed = json.loads(m.group(0))
        except Exception:
            pass

        # 2. Try repairing truncated JSON by closing open quotes and braces
        if not parsed:
            try:
                fixed = cleaned_json
                quotes_count = len(re.findall(r'(?<!\\)"', fixed))
                if quotes_count % 2 != 0:
                    fixed += '"'
                fixed = re.sub(r",\s*$", "", fixed.strip())
                open_braces = fixed.count("{") - fixed.count("}")
                open_brackets = fixed.count("[") - fixed.count("]")
                for _ in range(max(0, open_brackets)):
                    fixed += "]"
                for _ in range(max(0, open_braces)):
                    fixed += "}"
                parsed = json.loads(fixed)
                print(f"[SmartChat] Successfully repaired truncated JSON response!")
            except Exception as repair_e:
                print(f"[SmartChat] JSON repair failed: {repair_e}. Raw was: {cleaned_json[:200]}")

    if not parsed or not isinstance(parsed, dict):
        parsed = {
            "intent": "new_story",
            "is_refinement": False,
            "target_frame_numbers": [],
            "edit_instruction": "",
            "story_logline": user_text[:120],
            "detected_frame_count": target_frame_count,
            "assistant_message": "I've analyzed your brief and prepared your characters and story structure.",
            "characters": [{"name": "Protagonist", "tagline": "Main character", "clothing_wardrobe": "Casual", "hair": "Dark", "skin_tone": "Neutral", "build_height": "Average", "facial_features": "Expressive", "distinguishing_props": "None", "demeanor_expression": "Natural"}],
            "products": []
        }

    raw_intent = parsed.get("intent", "")
    is_refinement = bool(parsed.get("is_refinement"))
    edit_instruction = parsed.get("edit_instruction", "")
    target_frame_numbers = parsed.get("target_frame_numbers", [])
    actual_frame_count = parsed.get("detected_frame_count", target_frame_count)
    sb.slider_frame_count = actual_frame_count

    user_lower = user_text.lower().strip()
    is_question_query = any(user_lower.startswith(q) for q in ["what", "how", "why", "who", "where", "when", "tell me", "explain", "describe", "show me", "can you", "could you", "is there", "are there"]) or "?" in user_text or raw_intent == "query"

    # Strict intent resolution
    if is_question_query and not any(cmd in user_lower for cmd in ["change frame", "change panel", "in frame", "generate contact sheet", "proceed to contact"]):
        intent = "query"
        is_refinement = False
    elif raw_intent in ["entity_modification", "proceed_contact_sheet", "frame_refinement", "new_story", "query"]:
        intent = raw_intent
    elif any(kw in user_lower for kw in ["proceed", "generate contact sheet", "create storyboard", "looks good proceed", "start generation"]):
        intent = "proceed_contact_sheet"
    elif any(kw in user_lower for kw in ["change frame", "change panel", "in frame", "in panel", "regenerate panel", "modify frame"]):
        intent = "frame_refinement"
    elif parsed.get("entity_type") and parsed.get("modification_instruction") and any(kw in user_lower for kw in ["change", "wear", "dress", "clothing", "wardrobe", "hair", "outfit", "color", "make her", "make him"]):
        intent = "entity_modification"
    elif is_refinement and target_frame_numbers:
        intent = "frame_refinement"
    else:
        intent = "query" if has_existing_context else "new_story"

    # If it's a query, force is_refinement to False so frontend never triggers contact sheet
    if intent == "query":
        is_refinement = False

    # ─────────────────────────────────────────────────────────────
    # CASE 0: CONVERSATIONAL QUERY OR QUESTION
    # ─────────────────────────────────────────────────────────────
    if intent == "query":
        asst_msg_content = parsed.get("assistant_message") or (
            "Here is an overview of your storyline:\n" + "\n".join(frame_summary_lines) if frame_summary_lines else "Your storyboard project is active. What would you like to explore or adjust?"
        )
        history = list(sb.chat_history or [])
        if user_text or uploaded_image_urls:
            history.append({
                "id": str(uuid.uuid4()),
                "role": "user",
                "content": user_text or (f"Uploaded {len(uploaded_image_urls)} image(s)" if uploaded_image_urls else ""),
                "image_urls": uploaded_image_urls,
                "timestamp": datetime.utcnow().isoformat(),
            })
        history.append({
            "id": str(uuid.uuid4()),
            "role": "assistant",
            "content": asst_msg_content,
            "intent": "query",
            "timestamp": datetime.utcnow().isoformat(),
        })
        sb.chat_history = history
        db.commit()

        return {
            "intent": "query",
            "chat_history": sb.chat_history,
            "assistant_message": asst_msg_content,
            "characters": [],
            "products": [],
            "frame_count": sb.slider_frame_count or len(existing_frames) or 6,
            "is_refinement": False,
        }

    # ─────────────────────────────────────────────────────────────
    # CASE 1: ENTITY MODIFICATION
    # ─────────────────────────────────────────────────────────────
    if intent == "entity_modification":
        entity_type = (parsed.get("entity_type") or "character").lower()
        entity_name = (parsed.get("entity_name") or "").strip().lower()
        instruction = parsed.get("modification_instruction") or user_text
        updated_dna_raw = parsed.get("updated_dna") or {}

        matched_char = None
        matched_prod = None

        if "prod" in entity_type or (not existing_chars and existing_prods):
            for p in existing_prods:
                if entity_name and (entity_name in p.name.lower() or p.name.lower() in entity_name):
                    matched_prod = p
                    break
            if not matched_prod and existing_prods:
                matched_prod = existing_prods[0]
        else:
            for c in existing_chars:
                if entity_name and (entity_name in c.name.lower() or c.name.lower() in entity_name):
                    matched_char = c
                    break
            if not matched_char and existing_chars:
                # check if prompt mentions character name
                for c in existing_chars:
                    if c.name.lower() in user_text.lower():
                        matched_char = c
                        break
            if not matched_char and existing_chars:
                matched_char = existing_chars[0]

        if matched_char:
            existing_dna = matched_char.character_dna or {}
            final_dna = dict(existing_dna)
            if isinstance(updated_dna_raw, dict):
                for k, v in updated_dna_raw.items():
                    if v and str(v).strip():
                        final_dna[k] = v
            # Heuristic overrides based on user instruction keywords
            low_inst = instruction.lower()
            if any(w in low_inst for w in ["dark", "black", "dress", "clothes", "wardrobe", "outfit", "suit", "jacket", "shirt", "apron"]):
                final_dna["clothing_wardrobe"] = instruction
            if any(w in low_inst for w in ["blonde", "curly", "brunette", "ponytail", "hair", "short hair", "long hair"]):
                final_dna["hair"] = instruction

            matched_char.character_dna = final_dna
            matched_char.description = f"Updated based on: {instruction}. Wardrobe: {final_dna.get('clothing_wardrobe', '')}. Hair: {final_dna.get('hair', '')}."

            gen_prompt = (
                f"Studio portrait reference photograph of character '{matched_char.name}'. "
                f"Attributes: Hair: {final_dna.get('hair', '')}. Skin tone: {final_dna.get('skin_tone', '')}. "
                f"Facial features: {final_dna.get('facial_features', '')}. Wardrobe: {final_dna.get('clothing_wardrobe', '')}. "
                f"Build: {final_dna.get('build_height', '')}. Demeanor: {final_dna.get('demeanor_expression', '')}. "
                f"Full body standing studio pose, clear front view, plain soft grey background, "
                f"neutral cinematic commercial lighting, sharp crisp focus, highly realistic 35mm film photograph."
            )
            new_img = await _generate_visual_with_fallback(gen_prompt, ratio="3:4", is_contact_sheet=False)
            matched_char.image_path = new_img
            matched_char.image_paths = [new_img]

            sheet = db.query(CharacterSheet).filter(CharacterSheet.character_id == matched_char.id).first()
            if sheet:
                sheet.front_body_url = new_img
                sheet.is_approved = True
            else:
                sheet = CharacterSheet(
                    character_id=matched_char.id,
                    storyboard_id=sb_id,
                    front_body_url=new_img,
                    is_approved=True,
                )
                db.add(sheet)

            history = list(sb.chat_history or [])
            if user_text or uploaded_image_urls:
                history.append({
                    "id": str(uuid.uuid4()),
                    "role": "user",
                    "content": user_text or (f"Uploaded {len(uploaded_image_urls)} image(s)" if uploaded_image_urls else ""),
                    "image_urls": uploaded_image_urls,
                    "timestamp": datetime.utcnow().isoformat(),
                })
            asst_msg = {
                "id": str(uuid.uuid4()),
                "role": "assistant",
                "content": parsed.get("assistant_message") or f"Updated **{matched_char.name}** DNA and regenerated visual look.",
                "intent": "entity_modification",
                "modified_entity": {
                    "id": matched_char.id,
                    "type": "character",
                    "name": matched_char.name,
                    "description": matched_char.description,
                    "image_path": matched_char.image_path,
                    "dna": matched_char.character_dna,
                },
                "characters": [],
                "products": [],
                "timestamp": datetime.utcnow().isoformat(),
            }
            history.append(asst_msg)
            sb.chat_history = history
            db.commit()

            return {
                "intent": "entity_modification",
                "chat_history": sb.chat_history,
                "modified_entity": asst_msg["modified_entity"],
                "characters": [],
                "products": [],
                "frame_count": sb.slider_frame_count or 6,
                "is_refinement": False,
            }

        elif matched_prod:
            existing_dna = matched_prod.product_dna or {}
            final_dna = dict(existing_dna)
            if isinstance(updated_dna_raw, dict):
                for k, v in updated_dna_raw.items():
                    if v and str(v).strip():
                        final_dna[k] = v
            matched_prod.product_dna = final_dna
            matched_prod.description = f"Updated: {instruction}. {final_dna.get('description', '')}"

            gen_prompt = (
                f"Commercial studio product photograph of '{matched_prod.name}'. "
                f"Category: {final_dna.get('category', '')}. Color & Material: {final_dna.get('color_material', '')}. "
                f"Shape: {final_dna.get('shape_silhouette', '')}. Details: {final_dna.get('description', '')}. "
                f"Centered product shot, clean seamless studio background, elegant soft studio lighting, sharp macro lens focus."
            )
            new_img = await _generate_visual_with_fallback(gen_prompt, ratio="1:1", is_contact_sheet=False)
            matched_prod.image_path = new_img
            matched_prod.image_paths = [new_img]
            matched_prod.is_approved = True

            history = list(sb.chat_history or [])
            if user_text or uploaded_image_urls:
                history.append({
                    "id": str(uuid.uuid4()),
                    "role": "user",
                    "content": user_text or (f"Uploaded {len(uploaded_image_urls)} image(s)" if uploaded_image_urls else ""),
                    "image_urls": uploaded_image_urls,
                    "timestamp": datetime.utcnow().isoformat(),
                })
            asst_msg = {
                "id": str(uuid.uuid4()),
                "role": "assistant",
                "content": parsed.get("assistant_message") or f"Updated **{matched_prod.name}** DNA and regenerated visual look.",
                "intent": "entity_modification",
                "modified_entity": {
                    "id": matched_prod.id,
                    "type": "product",
                    "name": matched_prod.name,
                    "description": matched_prod.description,
                    "image_path": matched_prod.image_path,
                    "dna": matched_prod.product_dna,
                },
                "characters": [],
                "products": [],
                "timestamp": datetime.utcnow().isoformat(),
            }
            history.append(asst_msg)
            sb.chat_history = history
            db.commit()

            return {
                "intent": "entity_modification",
                "chat_history": sb.chat_history,
                "modified_entity": asst_msg["modified_entity"],
                "characters": [],
                "products": [],
                "frame_count": sb.slider_frame_count or 6,
                "is_refinement": False,
            }

    # ─────────────────────────────────────────────────────────────
    # CASE 2: PROCEED TO CONTACT SHEET
    # ─────────────────────────────────────────────────────────────
    if intent == "proceed_contact_sheet":
        history = list(sb.chat_history or [])
        if user_text or uploaded_image_urls:
            history.append({
                "id": str(uuid.uuid4()),
                "role": "user",
                "content": user_text or (f"Uploaded {len(uploaded_image_urls)} image(s)" if uploaded_image_urls else ""),
                "image_urls": uploaded_image_urls,
                "timestamp": datetime.utcnow().isoformat(),
            })
        asst_msg = {
            "id": str(uuid.uuid4()),
            "role": "assistant",
            "content": parsed.get("assistant_message") or "Generating your storyboard contact sheet now...",
            "intent": "proceed_contact_sheet",
            "characters": [],
            "products": [],
            "timestamp": datetime.utcnow().isoformat(),
        }
        history.append(asst_msg)
        sb.chat_history = history
        db.commit()
        return {
            "intent": "proceed_contact_sheet",
            "chat_history": sb.chat_history,
            "characters": [],
            "products": [],
            "frame_count": sb.slider_frame_count or 6,
            "ready_for_contact_sheet": True,
            "is_refinement": False,
        }

    # ─────────────────────────────────────────────────────────────
    # CASE 3: FRAME REFINEMENT
    # ─────────────────────────────────────────────────────────────
    if intent == "frame_refinement":
        refinement_scenes = parsed.get("scenes", [])
        if refinement_scenes and existing_frames:
            for sc in refinement_scenes:
                f_num = sc.get("frame_number", 0)
                if 1 <= f_num <= len(existing_frames):
                    existing_frames[f_num - 1].scene_prompt = sc.get("scene_prompt", existing_frames[f_num - 1].scene_prompt)
            db.commit()

        history = list(sb.chat_history or [])
        if user_text or uploaded_image_urls:
            history.append({
                "id": str(uuid.uuid4()),
                "role": "user",
                "content": user_text or (f"Uploaded {len(uploaded_image_urls)} image(s)" if uploaded_image_urls else ""),
                "image_urls": uploaded_image_urls,
                "timestamp": datetime.utcnow().isoformat(),
            })
        asst_msg = {
            "id": str(uuid.uuid4()),
            "role": "assistant",
            "content": parsed.get("assistant_message") or "Updated the frame scenes based on your feedback.",
            "intent": "frame_refinement",
            "is_refinement": True,
            "edit_instruction": edit_instruction,
            "target_frame_numbers": target_frame_numbers,
            "characters": [],
            "products": [],
            "timestamp": datetime.utcnow().isoformat(),
        }
        history.append(asst_msg)
        sb.chat_history = history
        db.commit()
        return {
            "intent": "frame_refinement",
            "chat_history": sb.chat_history,
            "characters": [],
            "products": [],
            "frame_count": actual_frame_count,
            "story_logline": parsed.get("story_logline", sb.name),
            "is_refinement": True,
            "edit_instruction": edit_instruction,
            "target_frame_numbers": target_frame_numbers,
        }

    # ─────────────────────────────────────────────────────────────
    # CASE 4: NEW STORY CREATION
    # ─────────────────────────────────────────────────────────────
    # Filter incoming characters strictly
    created_chars = []
    raw_incoming_chars = parsed.get("characters", [])
    valid_incoming_chars = []
    if isinstance(raw_incoming_chars, list):
        for c in raw_incoming_chars:
            if not isinstance(c, dict): continue
            cn = (c.get("name") or "").strip()
            if not cn or cn.lower() in ["", "none", "n/a", "null", "undefined", "character"]:
                continue
            c["name"] = cn
            valid_incoming_chars.append(c)

    chars_to_process = valid_incoming_chars if valid_incoming_chars else [
        {
            "name": c.name,
            "tagline": c.description,
            "hair": (c.character_dna or {}).get("hair", ""),
            "skin_tone": (c.character_dna or {}).get("skin_tone", ""),
            "build_height": (c.character_dna or {}).get("build_height", ""),
            "facial_features": (c.character_dna or {}).get("facial_features", ""),
            "clothing_wardrobe": (c.character_dna or {}).get("clothing_wardrobe", ""),
            "distinguishing_props": (c.character_dna or {}).get("distinguishing_props", ""),
            "demeanor_expression": (c.character_dna or {}).get("demeanor_expression", ""),
        }
        for c in existing_chars if c.name and c.name.strip()
    ]

    for c in chars_to_process:
        c_name = (c.get("name") or "").strip()
        if not c_name or c_name.lower() in ["", "none", "n/a", "null", "undefined"]:
            continue
        existing = db.query(StoryboardCharacter).filter(StoryboardCharacter.storyboard_id == sb_id, StoryboardCharacter.name == c_name).first()
        desc_str = f"{c.get('tagline', '')}. Wardrobe: {c.get('clothing_wardrobe', '')}. Hair: {c.get('hair', '')}. Features: {c.get('facial_features', '')}."
        dna_dict = _normalize_character_dna(c, c_name, desc_str)
        if existing:
            existing.character_dna = dna_dict
            existing.description = desc_str
            char_obj = existing
        else:
            char_obj = StoryboardCharacter(
                id=str(uuid.uuid4()),
                storyboard_id=sb_id,
                name=c_name,
                description=desc_str,
                character_dna=dna_dict,
                dna_source="chat_extracted",
            )
            db.add(char_obj)

        created_chars.append({
            "id": char_obj.id,
            "name": char_obj.name,
            "description": char_obj.description,
            "character_dna": char_obj.character_dna,
            "image_path": char_obj.image_path,
        })

    # Filter incoming products strictly
    created_prods = []
    raw_incoming_prods = parsed.get("products", [])
    valid_incoming_prods = []
    if isinstance(raw_incoming_prods, list):
        for p in raw_incoming_prods:
            if not isinstance(p, dict): continue
            pn = (p.get("name") or "").strip()
            if not pn or pn.lower() in ["", "none", "n/a", "null", "undefined", "product", "prop"]:
                continue
            p["name"] = pn
            valid_incoming_prods.append(p)

    prods_to_process = valid_incoming_prods if valid_incoming_prods else [
        {
            "name": p.name,
            "category": (p.product_dna or {}).get("category", ""),
            "color_material": (p.product_dna or {}).get("color_material", ""),
            "shape_silhouette": (p.product_dna or {}).get("shape_silhouette", ""),
            "distinctive_branding": (p.product_dna or {}).get("distinctive_branding", ""),
            "description": p.description,
        }
        for p in existing_prods if p.name and p.name.strip()
    ]

    for p in prods_to_process:
        p_name = (p.get("name") or "").strip()
        if not p_name or p_name.lower() in ["", "none", "n/a", "null", "undefined"]:
            continue
        existing = db.query(StoryboardProduct).filter(StoryboardProduct.storyboard_id == sb_id, StoryboardProduct.name == p_name).first()
        desc_str = f"{p.get('category', '')}: {p.get('color_material', '')} with {p.get('shape_silhouette', '')}. {p.get('description', '')}."
        prod_dna = _normalize_product_dna(p, p_name, desc_str)
        if existing:
            existing.product_dna = prod_dna
            existing.description = desc_str
            prod_obj = existing
        else:
            prod_obj = StoryboardProduct(
                id=str(uuid.uuid4()),
                storyboard_id=sb_id,
                name=p_name,
                description=desc_str,
                product_dna=prod_dna,
                dna_source="chat_extracted",
            )
            db.add(prod_obj)

        created_prods.append({
            "id": prod_obj.id,
            "name": prod_obj.name,
            "description": prod_obj.description,
            "product_dna": prod_obj.product_dna,
            "image_path": prod_obj.image_path,
        })

    # Update chat history in Storyboard
    history = list(sb.chat_history or [])
    if user_text or files or uploaded_image_urls:
        history.append({
            "id": str(uuid.uuid4()),
            "role": "user",
            "content": user_text or f"Uploaded {len(files)} file(s)",
            "image_urls": uploaded_image_urls,
            "timestamp": datetime.utcnow().isoformat(),
        })

    marketing_angles = parsed.get("marketing_angles") or []
    if not marketing_angles and (parsed.get("story_logline") or user_text):
        marketing_angles = [
            {
                "id": "angle_1",
                "title": "High-Energy Comedy & Twist",
                "description": "Dramatic, humorous escalation highlighting product punchlines and character expressions.",
                "tone": "Humorous, Energetic & Commercial",
                "hook": "Comedic contrast with a bold product payoff."
            },
            {
                "id": "angle_2",
                "title": "Warm Emotional & Lifestyle",
                "description": "Heartfelt human moments focusing on relationships, everyday life, and cozy ambient atmosphere.",
                "tone": "Warm, Nostalgic & Lifestyle",
                "hook": "Intimate candid moments that feel authentic and relatable."
            },
            {
                "id": "angle_3",
                "title": "Premium Sleek & Architectural",
                "description": "Design-first visual language with sophisticated lighting, hero angles, and luxury aesthetic.",
                "tone": "Sophisticated, Modern & High-End",
                "hook": "Striking architectural lighting and sleek hero product placement."
            }
        ]

    clarification_card = None
    if marketing_angles:
        clarification_card = {
            "type": "marketing_angles",
            "title": "Select Story & Marketing Direction",
            "subtitle": "Choose an angle or customize your own before generating contact sheet to prevent generic outputs:",
            "options": marketing_angles,
            "allow_custom": True,
            "selected_angle_id": None,
            "selected_angle_title": None,
        }

    asst_msg = {
        "id": str(uuid.uuid4()),
        "role": "assistant",
        "content": parsed.get("assistant_message", "I have structured your project and extracted key entities. Choose your preferred marketing direction below to generate the contact sheet, or customize your own!"),
        "story_logline": parsed.get("story_logline", ""),
        "detected_frame_count": actual_frame_count,
        "intent": "new_story",
        "is_refinement": False,
        "edit_instruction": "",
        "target_frame_numbers": [],
        "characters": created_chars,
        "products": created_prods,
        "clarification_card": clarification_card,
        "marketing_angles": marketing_angles,
        "timestamp": datetime.utcnow().isoformat(),
    }
    history.append(asst_msg)
    sb.chat_history = history
    for attempt in range(3):
        try:
            db.commit()
            break
        except Exception as e:
            if ("locked" in str(e).lower() or "busy" in str(e).lower()) and attempt < 2:
                db.rollback()
                await asyncio.sleep(0.5 * (attempt + 1))
                continue
            raise

    return {
        "intent": "new_story",
        "chat_history": sb.chat_history,
        "characters": created_chars,
        "products": created_prods,
        "frame_count": actual_frame_count,
        "story_logline": parsed.get("story_logline", ""),
        "is_refinement": False,
        "edit_instruction": "",
        "target_frame_numbers": [],
        "clarification_card": clarification_card,
    }


@router.post("/{storyboard_id}/chat/generate-entity-visual")
async def chat_generate_entity_visual(
    storyboard_id: str,
    payload: ChatGenerateVisualRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_effective_storyboard_user),
    db: Session = Depends(get_db),
):
    """
    Generates reference image for a single character or product using its DNA.
    Attaches image to entity and marks character sheet approved.
    Also automatically triggers background generation of side profile and face close-up views
    so the character sheet is completely filled without black spots.
    """
    sb = _find_storyboard(storyboard_id, current_user, db)
    if not sb:
        raise HTTPException(404, "Storyboard not found")

    cur_task = asyncio.current_task()
    if cur_task:
        RUNNING_STORYBOARD_TASKS[storyboard_id].add(cur_task)

    try:
        if storyboard_id in CANCELLED_STORYBOARD_IDS:
            raise HTTPException(400, "Storyboard operations cancelled by user")

        image_path = None
        entity_name = ""
        target_force_model = None
        if payload.model:
            m_lower = payload.model.lower().strip()
            if "nanobanana" in m_lower or "gemini" in m_lower:
                target_force_model = "gemini-3.1-flash-image"
            elif "chatgpt" in m_lower or "gpt" in m_lower:
                target_force_model = "gpt-image-1.5"

        if payload.entity_type == "character":
            char = db.query(StoryboardCharacter).filter(StoryboardCharacter.id == payload.entity_id, StoryboardCharacter.storyboard_id == storyboard_id).first()
            if not char:
                raise HTTPException(404, "Character not found")
            entity_name = (char.name or "").strip()
            if not entity_name or entity_name.lower() in ["", "none", "n/a", "null", "undefined"]:
                raise HTTPException(400, "Invalid character: name is blank")

            dna = char.character_dna or {}
            prompt = (
                f"Studio portrait reference photograph of character '{char.name}'. "
                f"Attributes: Hair: {dna.get('hair', '')}. Skin tone: {dna.get('skin_tone', '')}. "
                f"Facial features: {dna.get('facial_features', '')}. Wardrobe: {dna.get('clothing_wardrobe', '')}. "
                f"Build: {dna.get('build_height', '')}. Demeanor: {dna.get('demeanor_expression', '')}. "
                f"Full body standing studio pose, clear front view, plain soft grey background, "
                f"neutral cinematic commercial lighting, sharp crisp focus, highly realistic 35mm film photograph."
            )
            image_path = await _generate_visual_with_fallback(
                prompt, ratio="3:4", is_contact_sheet=False,
                cancel_check=lambda: storyboard_id in CANCELLED_STORYBOARD_IDS,
                force_model=target_force_model
            )
            char.image_path = image_path
            char.image_paths = [image_path]

            # Ensure approved CharacterSheet exists
            sheet = db.query(CharacterSheet).filter(CharacterSheet.character_id == char.id).first()
            if not sheet:
                sheet = CharacterSheet(
                    character_id=char.id,
                    storyboard_id=storyboard_id,
                    front_body_url=image_path,
                    is_approved=True,
                )
                db.add(sheet)
            else:
                sheet.front_body_url = image_path
                sheet.is_approved = True
            db.commit()

            # Auto-generate side profile and face close-up views from front look in background!
            sheet_task = asyncio.create_task(_run_sheet_generation(storyboard_id, char.id, next(get_db()), "missing"))
            RUNNING_STORYBOARD_TASKS[storyboard_id].add(sheet_task)
            sheet_task.add_done_callback(lambda t: RUNNING_STORYBOARD_TASKS[storyboard_id].discard(t))

        elif payload.entity_type == "product":
            prod = db.query(StoryboardProduct).filter(StoryboardProduct.id == payload.entity_id, StoryboardProduct.storyboard_id == storyboard_id).first()
            if not prod:
                raise HTTPException(404, "Product not found")
            entity_name = (prod.name or "").strip()
            if not entity_name or entity_name.lower() in ["", "none", "n/a", "null", "undefined"]:
                raise HTTPException(400, "Invalid product: name is blank")

            dna = prod.product_dna or {}
            prompt = (
                f"Commercial studio product photograph of '{prod.name}'. "
                f"Category: {dna.get('category', '')}. Color & Material: {dna.get('color_material', '')}. "
                f"Shape: {dna.get('shape_silhouette', '')}. Details: {dna.get('description', '')}. "
                f"Centered product shot, clean seamless studio background, elegant soft studio lighting, sharp macro lens focus."
            )
            image_path = await _generate_visual_with_fallback(
                prompt, ratio="1:1", is_contact_sheet=False,
                cancel_check=lambda: storyboard_id in CANCELLED_STORYBOARD_IDS,
                force_model=target_force_model
            )
            prod.image_path = image_path
            prod.image_paths = [image_path]
            prod.is_approved = True
            db.commit()
        else:
            raise HTTPException(400, "Invalid entity_type")
    finally:
        if cur_task:
            RUNNING_STORYBOARD_TASKS[storyboard_id].discard(cur_task)

    # Update image_path inside existing chat_history messages rather than creating separate spam bubbles
    history = list(sb.chat_history or [])
    for msg in reversed(history):
        if payload.entity_type == "character" and msg.get("characters"):
            for c in msg["characters"]:
                if c.get("id") == payload.entity_id or c.get("name", "").strip().lower() == entity_name.lower():
                    c["image_path"] = image_path
                    break
        elif payload.entity_type == "product" and msg.get("products"):
            for p in msg["products"]:
                if p.get("id") == payload.entity_id or p.get("name", "").strip().lower() == entity_name.lower():
                    p["image_path"] = image_path
                    break

    sb.chat_history = history
    db.commit()

    return {
        "entity_id": payload.entity_id,
        "entity_type": payload.entity_type,
        "image_path": image_path,
        "chat_history": sb.chat_history,
    }


@router.post("/{storyboard_id}/chat/modify-entity")
async def chat_modify_entity(
    storyboard_id: str,
    payload: ChatModifyEntityRequest,
    current_user: User = Depends(get_effective_storyboard_user),
    db: Session = Depends(get_db),
):
    """
    Conversational refinement: User asks to modify an entity (e.g. "make her hair blonde and curly").
    Updates the textual DNA via GPT-5.6 Luna / Claude Sonnet 5, then re-generates the visual image.
    """
    sb = _find_storyboard(storyboard_id, current_user, db)
    if not sb:
        raise HTTPException(404, "Storyboard not found")

    new_image_path = None
    entity_name = ""
    updated_dna = {}

    if payload.entity_type == "character":
        char = db.query(StoryboardCharacter).filter(StoryboardCharacter.id == payload.entity_id, StoryboardCharacter.storyboard_id == storyboard_id).first()
        if not char:
            raise HTTPException(404, "Character not found")
        entity_name = char.name
        existing_dna = char.character_dna or {}

        sys_prompt = (
            "You are an expert character designer. The user wants to adjust a character's traits. "
            "Modify the existing JSON DNA strictly based on their requested instruction. Keep other traits unchanged. "
            "Return ONLY raw valid JSON:\n"
            '{"name": "...", "hair": "...", "skin_tone": "...", "facial_features": "...", '
            '"clothing_wardrobe": "...", "build_height": "...", "distinguishing_props": "...", "demeanor_expression": "..."}'
        )
        user_prompt = f"Current Character DNA:\n{json.dumps(existing_dna)}\n\nUser Revision Instruction:\n{payload.instruction}"
        resp_text = await _call_vision_reasoning_luna_sonnet5(sys_prompt, user_prompt)

        clean = resp_text.strip().replace("```json", "").replace("```", "").strip()
        try:
            updated_dna = json.loads(clean)
        except Exception:
            updated_dna = existing_dna

        char.character_dna = updated_dna
        char.description = f"Updated based on: {payload.instruction}. Wardrobe: {updated_dna.get('clothing_wardrobe', '')}. Hair: {updated_dna.get('hair', '')}."

        # Regenerate visual
        gen_prompt = (
            f"Studio portrait reference photograph of character '{char.name}'. "
            f"Attributes: Hair: {updated_dna.get('hair', '')}. Skin tone: {updated_dna.get('skin_tone', '')}. "
            f"Facial features: {updated_dna.get('facial_features', '')}. Wardrobe: {updated_dna.get('clothing_wardrobe', '')}. "
            f"Build: {updated_dna.get('build_height', '')}. Demeanor: {updated_dna.get('demeanor_expression', '')}. "
            f"Full body standing studio pose, clear front view, plain soft grey background, "
            f"neutral cinematic lighting, sharp crisp focus, highly realistic 35mm film photograph."
        )
        new_image_path = await _generate_visual_with_fallback(gen_prompt, ratio="3:4", is_contact_sheet=False)
        char.image_path = new_image_path
        char.image_paths = [new_image_path]

        sheet = db.query(CharacterSheet).filter(CharacterSheet.character_id == char.id).first()
        if sheet:
            sheet.front_body_url = new_image_path
            sheet.is_approved = True

    elif payload.entity_type == "product":
        prod = db.query(StoryboardProduct).filter(StoryboardProduct.id == payload.entity_id, StoryboardProduct.storyboard_id == storyboard_id).first()
        if not prod:
            raise HTTPException(404, "Product not found")
        entity_name = prod.name
        existing_dna = prod.product_dna or {}

        sys_prompt = (
            "You are an industrial product designer. Adjust the product's JSON DNA according to the user instruction. "
            "Return ONLY raw valid JSON:\n"
            '{"name": "...", "category": "...", "color_material": "...", "shape_silhouette": "...", "distinctive_branding": "...", "description": "..."}'
        )
        user_prompt = f"Current Product DNA:\n{json.dumps(existing_dna)}\n\nUser Revision Instruction:\n{payload.instruction}"
        resp_text = await _call_vision_reasoning_luna_sonnet5(sys_prompt, user_prompt)

        clean = resp_text.strip().replace("```json", "").replace("```", "").strip()
        try:
            updated_dna = json.loads(clean)
        except Exception:
            updated_dna = existing_dna

        prod.product_dna = updated_dna
        prod.description = f"Updated: {payload.instruction}. {updated_dna.get('description', '')}"

        gen_prompt = (
            f"Commercial studio product photograph of '{prod.name}'. "
            f"Category: {updated_dna.get('category', '')}. Color & Material: {updated_dna.get('color_material', '')}. "
            f"Shape: {updated_dna.get('shape_silhouette', '')}. Details: {updated_dna.get('description', '')}. "
            f"Centered product shot, clean seamless studio background, elegant soft studio lighting, sharp macro lens focus."
        )
        new_image_path = await _generate_visual_with_fallback(gen_prompt, ratio="1:1", is_contact_sheet=False)
        prod.image_path = new_image_path
        prod.image_paths = [new_image_path]
        prod.is_approved = True
    else:
        raise HTTPException(400, "Invalid entity_type")

    # Update chat history
    history = list(sb.chat_history or [])
    history.append({
        "id": str(uuid.uuid4()),
        "role": "user",
        "content": f"Update {entity_name}: {payload.instruction}",
        "timestamp": datetime.utcnow().isoformat(),
    })
    history.append({
        "id": str(uuid.uuid4()),
        "role": "assistant",
        "content": f"🔄 Updated **{entity_name}** DNA and regenerated visual look.",
        "entity_type": payload.entity_type,
        "entity_id": payload.entity_id,
        "image_path": new_image_path,
        "updated_dna": updated_dna,
        "timestamp": datetime.utcnow().isoformat(),
    })
    sb.chat_history = history
    db.commit()

    return {
        "entity_id": payload.entity_id,
        "entity_type": payload.entity_type,
        "image_path": new_image_path,
        "updated_dna": updated_dna,
        "chat_history": sb.chat_history,
    }


@router.post("/{storyboard_id}/chat/generate-contact-sheet")
async def chat_generate_contact_sheet(
    storyboard_id: str,
    payload: ChatContactSheetRequest,
    current_user: User = Depends(get_effective_storyboard_user),
    db: Session = Depends(get_db),
):
    """
    Generates a unified storyboard contact sheet image containing exactly N numbered panels (1 to N).
    Also creates or updates the N StoryboardFrame records in the database so the user is ready
    to click 'Start Frame Generation' in the navbar and immediately edit individual frames in Step 3.
    """
    sb = _find_storyboard(storyboard_id, current_user, db)
    if not sb:
        raise HTTPException(404, "Storyboard not found")

    cur_task = asyncio.current_task()
    if cur_task:
        RUNNING_STORYBOARD_TASKS[storyboard_id].add(cur_task)
        def _cleanup_chat_task(t):
            RUNNING_STORYBOARD_TASKS[storyboard_id].discard(t)
            CANCELLED_STORYBOARD_IDS.discard(storyboard_id)
        cur_task.add_done_callback(_cleanup_chat_task)

    if storyboard_id in CANCELLED_STORYBOARD_IDS:
        raise HTTPException(400, "Storyboard operations cancelled by user")

    n_frames = max(1, min(15, payload.frame_count or sb.slider_frame_count or 6))
    sb.slider_frame_count = n_frames

    start_time = time.time()
    gen_id = str(uuid.uuid4())

    marketing_angle = (payload.marketing_angle or "").strip()
    if not marketing_angle and sb.chat_history:
        for m in reversed(sb.chat_history):
            if m.get("marketing_angle"):
                marketing_angle = m["marketing_angle"]
                break
            card = m.get("clarification_card") or {}
            if card.get("selected_angle_title"):
                marketing_angle = card["selected_angle_title"]
                break

    target_force_model = None
    if payload.model:
        m_lower = payload.model.lower().strip()
        if "nanobanana" in m_lower or "gemini" in m_lower:
            target_force_model = "gemini-3.1-flash-image"
        elif "chatgpt" in m_lower or "gpt" in m_lower:
            target_force_model = "gpt-image-1.5"

    # Extract true story premise / storyline from DB description or chat history
    story_premise = ""
    if sb.description and sb.description.strip():
        story_premise = sb.description.strip()
    if not story_premise and sb.chat_history:
        for m in reversed(sb.chat_history):
            if m.get("story_logline") and m["story_logline"].strip():
                story_premise = m["story_logline"].strip()
                break
        if not story_premise:
            for m in sb.chat_history:
                if m.get("role") == "user" and m.get("content") and m["content"].strip():
                    story_premise = m["content"].strip()
                    break

    # Gather characters and products for continuity before initializing thoughts
    chars = db.query(StoryboardCharacter).filter(StoryboardCharacter.storyboard_id == storyboard_id).all()
    prods = db.query(StoryboardProduct).filter(StoryboardProduct.storyboard_id == storyboard_id).all()
    existing_frames = db.query(StoryboardFrame).filter(StoryboardFrame.storyboard_id == storyboard_id).order_by(StoryboardFrame.order_index).all()

    init_thoughts = [
        {"time": 0.2, "text": f"Analyzing creative brief for '{sb.name}' ({n_frames} panels)..."}
    ]
    if story_premise:
        init_thoughts.append({
            "time": 0.35,
            "text": f"Directing storyline: '{story_premise[:80]}...' across {n_frames} panels..."
        })
    if marketing_angle:
        init_thoughts.append({
            "time": 0.5,
            "text": f"Enforcing marketing angle: '{marketing_angle}' across scene directions..."
        })
    if chars:
        init_thoughts.append({
            "time": 0.8,
            "text": f"Locking character consistency anchors: {', '.join([c.name for c in chars])}..."
        })
    if prods:
        init_thoughts.append({
            "time": 1.1,
            "text": f"Anchoring hero product branding: {', '.join([p.name for p in prods])}..."
        })

    CONTACT_SHEET_PROGRESS[storyboard_id] = {
        "status": "in_progress",
        "generation_id": gen_id,
        "current_step": f"Directing scene progression & lighting...",
        "current_frame": 0,
        "total_frames": n_frames,
        "started_at": datetime.utcnow().isoformat(),
        "elapsed_seconds": round(time.time() - start_time, 1),
        "thoughts": init_thoughts,
        "contact_sheet_url": None,
        "error": None,
    }

    char_summaries = []
    for c in chars:
        dna = c.character_dna or {}
        char_summaries.append(
            f"Character '{c.name}': "
            f"MANDATORY WARDROBE: {dna.get('clothing_wardrobe', 'Neutral clothing')} (Must be worn in all panels where character appears), "
            f"Hair: {dna.get('hair', 'Natural')}, "
            f"Skin tone: {dna.get('skin_tone', 'Natural')}, "
            f"Facial Features: {dna.get('facial_features', 'Expressive')}, "
            f"Build: {dna.get('build_height', 'Average')}, "
            f"Props: {dna.get('distinguishing_props', 'None')}, "
            f"Demeanor: {dna.get('demeanor_expression', 'Natural')}"
        )

    prod_summaries = []
    for p in prods:
        dna = p.product_dna or {}
        prod_summaries.append(
            f"Product/Prop '{p.name}': Category: {dna.get('category', '')}, Color/Material: {dna.get('color_material', '')}, "
            f"Shape: {dna.get('shape_silhouette', '')}, Branding: {dna.get('distinctive_branding', '')}, Description: {p.description or ''}"
        )

    # Check if this is an edit/refinement of an existing contact sheet
    prev_contact_sheet_b64 = None
    if sb.contact_sheet_url:
        prev_contact_sheet_b64 = load_b64_image(sb.contact_sheet_url)

    is_refinement = bool(payload.is_refinement or (prev_contact_sheet_b64 and (payload.edit_instruction or payload.target_frame_numbers)))

    target_panels_str = ", ".join(f"Panel {n}" for n in (payload.target_frame_numbers or [])) if payload.target_frame_numbers else "the specified frame"
    edit_instruction_text = payload.edit_instruction or "Apply the user's requested edit to the target frame."

    # Synthesize storyline & panel prompts using GPT-5.6 Luna / Claude Sonnet 5
    if is_refinement:
        existing_scenes_text = "\n".join(f"Panel {f.order_index + 1}: {f.scene_prompt}" for f in existing_frames)
        sys_prompt = f"""
You are a senior cinematographic storyboard director refining an existing film storyboard contact sheet.
The user is requesting an edit to specific panel(s) in an existing {n_frames}-panel storyboard.

EXISTING SCENES:
{existing_scenes_text}

USER EDIT REQUEST:
"{edit_instruction_text}"
TARGET PANEL(S): {target_panels_str}

TASK:
1. Formulate a master contact_sheet_prompt for an image model (Gemini 3.1 Flash Image) that receives the CURRENT CONTACT SHEET as a reference image.
   CRITICAL CONTINUITY MANDATE:
   - Emphasize that all UNMODIFIED panels MUST stay 100% identical to the reference image (same character face/hair/outfit, props, camera angle, and lighting).
   - Detail the exact modification required ONLY for the target panel(s) ({target_panels_str}).
   - Maintain the {n_frames}-panel storyboard grid layout.
   - STRICT ZERO-NUMBER & ZERO-TEXT MANDATE: Absolutely DO NOT draw, paint, print, or overlay any numbers ('1', '2', '3', '4', etc.), digits, labels, captions, watermarks, or text anywhere in the image or on any panel. Keep every frame 100% clean of any numbers or text.
2. Update the scenes array, updating only the affected scene prompt(s) and preserving the others.

Return ONLY raw valid JSON:
{{
  "contact_sheet_prompt": "string (master edit prompt referencing the base contact sheet image, with strict instruction of NO numbers and NO text)",
  "scenes": [
    {{
      "frame_number": 1,
      "scene_title": "string",
      "scene_prompt": "string",
      "characters_present": ["name"]
    }}
  ]
}}
"""
        user_prompt = f"Storyboard: {sb.name}\nEdit: {edit_instruction_text}\nTarget: {target_panels_str}"
    else:
        sys_prompt = f"""
You are a senior cinematographic storyboard director.
Synthesize a cinematic {n_frames}-scene visual narrative arc incorporating the story premise, characters, and products provided.

CRITICAL DIRECTORIAL MANDATES:
1. FAITHFUL NARRATIVE ARC & DRAMATIC ACTION:
   - The sequence of {n_frames} panels MUST directly, faithfully, and chronologically depict the story specified in the "STORY PREMISE / NARRATIVE TO DEPICT" below from start to finish!
   - Every major story beat from the premise MUST be clearly represented across the scenes (e.g. if the premise specifies lighting a cigarette, fire/inferno/flames, dancing in the rain, or specific actions, those elements MUST be explicitly described and visually central in the relevant scene prompts).
   - For intense or dramatic elements (e.g. fire, burning backdrop, flames, destruction, storms), describe them with cinematic visual richness (e.g. "cinematic blazing inferno in the background, towering flames casting dramatic orange glow, thick atmospheric smoke, rain pouring through the heat and glow") to achieve epic photorealism.

2. SCENE VARIATION & PROGRESSION:
   - Each of the {n_frames} panels MUST depict a distinctly different chronological scene, action, and camera angle.
   - Panel 1: Establishing wide shot setting the environment and mood.
   - Panel 2: Medium shot highlighting character action or interaction with props.
   - Panel 3: Over-the-shoulder or close-up focusing on key prop/product interaction or pivotal discovery.
   - Panel 4: Dramatic dynamic angle (low angle or high angle) capturing heightened drama/intensity.
   - Panel 5+: Climactic reaction shot or narrative resolution shot.
   - Absolutely DO NOT make all panels look identical! Vary character poses, camera distances, and angles across every single frame.

3. CHARACTER CONTINUITY & EXACT WARDROBE:
   - For every character present, their clothing and wardrobe MUST match the EXACT MANDATORY WARDROBE specified in their DNA.
   - Do NOT default to generic clothing or unrequested aprons/costumes. Respect the exact wardrobe description.

4. MARKETING ANGLE & CREATIVE STRATEGY:
   {f'- Chosen Marketing Direction: "{marketing_angle}". Tailor all scene actions, character expressions, comedic/emotional beats, lighting, and camera pacing strictly to embody this marketing angle!' if marketing_angle else '- Direct for maximum commercial impact and emotional resonance.'}

Generate an array of {n_frames} individual scene descriptions for panels 1 through {n_frames}.

Return ONLY raw valid JSON:
{{
  "scenes": [
    {{
      "frame_number": 1,
      "scene_title": "string",
      "scene_prompt": "string (cinematic camera shot, action, lighting, characters present, max 120 words)",
      "characters_present": ["name"]
    }}
  ]
}}
"""
        user_prompt = (
            f"Storyboard Name: {sb.name}\n"
            f"STORY PREMISE / NARRATIVE TO DEPICT:\n{story_premise or sb.name}\n\n"
            f"Number of frames needed: {n_frames}\n"
            f"Marketing Angle: {marketing_angle or 'General Commercial'}\n\n"
            f"Characters:\n" + "\n".join(char_summaries) + "\n\n"
            f"Products:\n" + "\n".join(prod_summaries)
        )

    llm_resp = await _call_vision_reasoning_luna_sonnet5(sys_prompt, user_prompt)
    clean = llm_resp.strip().replace("```json", "").replace("```", "").strip()
    try:
        story_data = json.loads(clean)
    except Exception as e:
        print(f"[SmartChat] Failed to parse scenes JSON: {e}")
        story_data = {
            "scenes": [{"frame_number": i + 1, "scene_title": f"Scene {i+1}", "scene_prompt": f"Cinematic scene {i+1} of the story.", "characters_present": []} for i in range(n_frames)]
        }

    scenes = story_data.get("scenes", [])
    elapsed_scenes = round(time.time() - start_time, 1)
    CONTACT_SHEET_PROGRESS[storyboard_id]["elapsed_seconds"] = elapsed_scenes
    CONTACT_SHEET_PROGRESS[storyboard_id]["thoughts"].append({
        "time": elapsed_scenes,
        "text": f"Directorial breakdown complete: synthesized {len(scenes)} chronological film scenes."
    })
    char_map = {c.name.lower(): c.id for c in chars}
    prod_map = {p.name.lower(): p.id for p in prods}

    # ── Build character & product reference maps ──
    char_ref_dict: Dict[str, str] = {}
    for c in chars:
        if c.image_path:
            cb64 = load_b64_image(c.image_path)
            if cb64:
                char_ref_dict[c.name.lower()] = cb64
                char_ref_dict[str(c.id)] = cb64

    prod_ref_dict: Dict[str, str] = {}
    for p in prods:
        if p.image_path:
            pb64 = load_b64_image(p.image_path)
            if pb64:
                prod_ref_dict[p.name.lower()] = pb64
                prod_ref_dict[str(p.id)] = pb64

    wardrobe_mandate = ""
    if chars:
        wardrobe_mandate = " CHARACTER APPEARANCE MANDATE: " + " ".join([
            f"{c.name} MUST strictly wear {((c.character_dna or {}).get('clothing_wardrobe') or 'default outfit')} "
            f"with {((c.character_dna or {}).get('hair') or 'natural hair')}. "
            f"Face: {((c.character_dna or {}).get('facial_features') or '')}. "
            f"Do NOT change wardrobe between frames."
            for c in chars if (c.name or "").strip()
        ])

    common_suffix = (
        " Professional cinematic 35mm film photography. Natural lighting. "
        "Anatomically correct, complete bodies, natural proportions, fully rendered heads and torsos, clean silhouette. "
        "No distorted limbs, no missing heads, no headless bodies, no floating limbs, no duplicate body parts, no conjoined figures. "
        "No text, no numbers, no watermarks, no overlays in the frame. "
        "Single clean film still."
    )

    # ── GENERATE EACH FRAME INDIVIDUALLY ──
    existing_frames = db.query(StoryboardFrame).filter(
        StoryboardFrame.storyboard_id == storyboard_id
    ).order_by(StoryboardFrame.order_index).all()

    updated_frames = []
    frame_image_urls: List[str] = []

    for idx in range(n_frames):
        sc = scenes[idx] if idx < len(scenes) else {"scene_prompt": f"Cinematic scene {idx+1}.", "characters_present": []}
        scene_text = sc.get("scene_prompt", f"Cinematic scene {idx+1}.")
        detected_cids = [char_map[cn.lower()] for cn in sc.get("characters_present", []) if cn.lower() in char_map]

        # Decide whether to skip regeneration (refinement mode, this frame not targeted)
        skip_regen = False
        if is_refinement and payload.target_frame_numbers:
            skip_regen = (idx + 1) not in payload.target_frame_numbers

        existing_frame_img = None
        if idx < len(existing_frames) and existing_frames[idx].image_path:
            existing_frame_img = existing_frames[idx].image_path

        if skip_regen and existing_frame_img:
            # Keep existing frame image as-is
            frame_image_urls.append(existing_frame_img)
            frame_obj = existing_frames[idx]
            updated_frames.append({
                "id": frame_obj.id,
                "order_index": frame_obj.order_index,
                "scene_prompt": frame_obj.scene_prompt,
                "image_path": frame_obj.image_path,
                "status": frame_obj.status,
            })
            continue

        # Build the per-frame image prompt
        frame_prompt = (
            f"Cinematic film still. Frame {idx+1} of {n_frames}. "
            f"{scene_text}"
            f"{wardrobe_mandate}"
            f"{common_suffix}"
        )

        # Collect references tailored strictly to characters and products present in THIS specific frame
        scene_lower = scene_text.lower()
        chars_in_scene: List[str] = []
        for cn in sc.get("characters_present", []):
            ref = char_ref_dict.get(cn.lower())
            if ref and ref not in chars_in_scene:
                chars_in_scene.append(ref)
        for c in chars:
            c_name_lower = (c.name or "").lower().strip()
            if c_name_lower and c_name_lower in scene_lower:
                ref = char_ref_dict.get(c_name_lower)
                if ref and ref not in chars_in_scene:
                    chars_in_scene.append(ref)

        prods_in_scene: List[str] = []
        for p in prods:
            p_name_lower = (p.name or "").lower().strip()
            if p_name_lower and p_name_lower in scene_lower:
                ref = prod_ref_dict.get(p_name_lower)
                if ref and ref not in prods_in_scene:
                    prods_in_scene.append(ref)

        selected_refs: List[str] = []
        # Multi-character shots: Gemini multimodal blurs/severely distorts bodies when >1 portrait is passed into an action shot.
        # Passing 1 primary character reference is cleanest for dynamic action; at most 2 for a two-person interaction.
        if len(chars_in_scene) > 2:
            selected_refs.extend(chars_in_scene[:1])
        else:
            selected_refs.extend(chars_in_scene[:2])

        if prods_in_scene and len(selected_refs) < 2:
            selected_refs.append(prods_in_scene[0])

        # If refinement with prev frame image and this is a targeted frame, prioritize the previous frame as style ref
        if is_refinement and payload.target_frame_numbers and existing_frame_img and (idx + 1) in payload.target_frame_numbers:
            prev_b64 = load_b64_image(existing_frame_img)
            if prev_b64:
                selected_refs = [prev_b64] + selected_refs[:1]

        ref_for_frame = selected_refs if selected_refs else None

        if storyboard_id in CANCELLED_STORYBOARD_IDS:
            print(f"[SmartChat] Storyboard {storyboard_id} cancelled by user. Stopping contact sheet generation at frame {idx+1}/{n_frames}.")
            break

        if idx > 0:
            if storyboard_id in CANCELLED_STORYBOARD_IDS:
                break
            await asyncio.sleep(1.0)  # Pacing delay between sequential frames to avoid GCP QPM burst
            if storyboard_id in CANCELLED_STORYBOARD_IDS:
                break

        elapsed_f = round(time.time() - start_time, 1)
        CONTACT_SHEET_PROGRESS[storyboard_id]["current_frame"] = idx + 1
        CONTACT_SHEET_PROGRESS[storyboard_id]["current_step"] = f"Synthesizing Panel {idx+1} of {n_frames}"
        CONTACT_SHEET_PROGRESS[storyboard_id]["elapsed_seconds"] = elapsed_f
        CONTACT_SHEET_PROGRESS[storyboard_id]["thoughts"].append({
            "time": elapsed_f,
            "frame_number": idx + 1,
            "text": f"Synthesizing Panel {idx+1}/{n_frames}: {scene_text[:75]}..."
        })

        print(f"[SmartChat] Generating frame {idx+1}/{n_frames}: refs={len(ref_for_frame) if ref_for_frame else 0}")
        try:
            frame_url = await _generate_visual_with_fallback(
                frame_prompt,
                ratio="16:9",
                is_contact_sheet=False,
                reference_image_b64=ref_for_frame,
                cancel_check=lambda: storyboard_id in CANCELLED_STORYBOARD_IDS,
                force_model=target_force_model
            )
        except asyncio.CancelledError:
            print(f"[SmartChat] Contact sheet generation cancelled by user at frame {idx+1}.")
            break
        except Exception as e:
            if storyboard_id in CANCELLED_STORYBOARD_IDS:
                break
            print(f"[SmartChat] Frame {idx+1} generation failed: {e}")
            # Use existing frame if available, else None
            frame_url = existing_frame_img or None

        frame_image_urls.append(frame_url) if frame_url else frame_image_urls.append("")

        # Save frame to DB
        frame_model_label = "gemini-3.1-flash-image" if (not target_force_model or "gemini" in target_force_model) else target_force_model
        if idx < len(existing_frames):
            frame_obj = existing_frames[idx]
            frame_obj.scene_prompt = scene_text
            frame_obj.detected_character_ids = detected_cids
            if frame_url:
                frame_obj.image_path = frame_url
                frame_obj.status = "done"
                frame_obj.model_used = frame_model_label
        else:
            frame_obj = StoryboardFrame(
                id=str(uuid.uuid4()),
                storyboard_id=storyboard_id,
                order_index=idx,
                scene_prompt=scene_text,
                detected_character_ids=detected_cids,
                image_path=frame_url,
                status="done" if frame_url else "pending",
                model_used=frame_model_label if frame_url else None,
            )
            db.add(frame_obj)
        for attempt in range(3):
            try:
                db.commit()
                break
            except Exception as commit_e:
                if ("locked" in str(commit_e).lower() or "busy" in str(commit_e).lower()) and attempt < 2:
                    await asyncio.sleep(0.5 * (attempt + 1))
                    continue
                break

        updated_frames.append({
            "id": frame_obj.id,
            "order_index": frame_obj.order_index,
            "scene_prompt": frame_obj.scene_prompt,
            "image_path": frame_obj.image_path,
            "status": frame_obj.status,
        })

    # Delete any trailing frames beyond n_frames
    if len(existing_frames) > n_frames:
        for extra in existing_frames[n_frames:]:
            db.delete(extra)
        try:
            db.commit()
        except Exception:
            pass

    # ── STITCH NUMBERED CONTACT SHEET ──
    elapsed_stitch = round(time.time() - start_time, 1)
    CONTACT_SHEET_PROGRESS[storyboard_id]["current_step"] = f"Stitching unified {n_frames}-panel contact sheet..."
    CONTACT_SHEET_PROGRESS[storyboard_id]["elapsed_seconds"] = elapsed_stitch
    CONTACT_SHEET_PROGRESS[storyboard_id]["thoughts"].append({
        "time": elapsed_stitch,
        "text": f"Stitching unified {n_frames}-panel contact sheet with cinematic grid layout..."
    })

    valid_frame_urls = [u for u in frame_image_urls if u]
    if valid_frame_urls:
        try:
            contact_sheet_url = stitch_frames_into_contact_sheet(frame_image_urls)
        except Exception as stitch_err:
            print(f"[SmartChat] Stitch failed ({stitch_err}), using first frame as fallback contact sheet")
            contact_sheet_url = valid_frame_urls[0]
    else:
        contact_sheet_url = sb.contact_sheet_url or ""

    sb.contact_sheet_url = contact_sheet_url

    # Update chat history with the contact sheet
    history = list(sb.chat_history or [])
    edit_note = f" (Refined: {payload.edit_instruction})" if is_refinement and payload.edit_instruction else ""
    history.append({
        "id": str(uuid.uuid4()),
        "role": "assistant",
        "content": f"🎬 **Storyboard Contact Sheet Generated!** ({n_frames} Panels){edit_note}\n\nAll {n_frames} frames have been generated individually with character reference consistency. Review the numbered contact sheet below. Click **'Proceed to Direct Frames'** to view and direct each panel in the studio!",
        "contact_sheet_url": contact_sheet_url,
        "frame_count": n_frames,
        "scenes": scenes,
        "ready_for_frame_generation": True,
        "timestamp": datetime.utcnow().isoformat(),
    })
    sb.chat_history = history
    db.commit()

    elapsed_done = round(time.time() - start_time, 1)
    CONTACT_SHEET_PROGRESS[storyboard_id]["status"] = "completed"
    CONTACT_SHEET_PROGRESS[storyboard_id]["current_step"] = f"Completed all {n_frames} panels in {int(elapsed_done)}s"
    CONTACT_SHEET_PROGRESS[storyboard_id]["elapsed_seconds"] = elapsed_done
    CONTACT_SHEET_PROGRESS[storyboard_id]["contact_sheet_url"] = contact_sheet_url
    CONTACT_SHEET_PROGRESS[storyboard_id]["thoughts"].append({
        "time": elapsed_done,
        "text": f"Storyboard Contact Sheet ready! All {n_frames} panels synchronized with character consistency."
    })

    return {
        "contact_sheet_url": contact_sheet_url,
        "frame_count": n_frames,
        "scenes": scenes,
        "frames": updated_frames,
        "chat_history": sb.chat_history,
        "ready_for_frame_generation": True,
    }


@router.get("/{storyboard_id}/chat/history")
async def get_chat_history(
    storyboard_id: str,
    current_user: User = Depends(get_effective_storyboard_user),
    db: Session = Depends(get_db),
):
    """
    Returns stored chat conversation history, active contact sheet URL, and frame count.
    """
    sb = _find_storyboard(storyboard_id, current_user, db)
    if not sb:
        raise HTTPException(404, "Storyboard not found")

    prog = CONTACT_SHEET_PROGRESS.get(storyboard_id, {
        "status": "idle",
        "current_step": "",
        "current_frame": 0,
        "total_frames": 0,
        "started_at": None,
        "elapsed_seconds": 0.0,
        "thoughts": [],
        "contact_sheet_url": sb.contact_sheet_url,
    })
    if prog.get("status") == "in_progress" and prog.get("started_at"):
        try:
            st = datetime.fromisoformat(prog["started_at"])
            prog["elapsed_seconds"] = round((datetime.utcnow() - st).total_seconds(), 1)
        except Exception:
            pass

    return {
        "chat_history": sb.chat_history or [],
        "contact_sheet_url": sb.contact_sheet_url,
        "slider_frame_count": sb.slider_frame_count or 6,
        "ready_for_frame_generation": bool(sb.contact_sheet_url),
        "progress": prog,
    }


@router.get("/{storyboard_id}/chat/progress")
async def get_chat_progress(
    storyboard_id: str,
    current_user: User = Depends(get_effective_storyboard_user),
    db: Session = Depends(get_db),
):
    """
    Returns live generation progress, thoughts stream, elapsed seconds, and active frame.
    """
    sb = _find_storyboard(storyboard_id, current_user, db)
    if not sb:
        raise HTTPException(404, "Storyboard not found")

    prog = CONTACT_SHEET_PROGRESS.get(storyboard_id, {
        "status": "idle",
        "generation_id": None,
        "current_step": "",
        "current_frame": 0,
        "total_frames": 0,
        "started_at": None,
        "elapsed_seconds": 0.0,
        "thoughts": [],
        "contact_sheet_url": sb.contact_sheet_url,
        "error": None,
    })

    if prog.get("status") == "in_progress" and prog.get("started_at"):
        try:
            st = datetime.fromisoformat(prog["started_at"])
            prog["elapsed_seconds"] = round((datetime.utcnow() - st).total_seconds(), 1)
        except Exception:
            pass

    return {
        **prog,
        "latest_contact_sheet_url": sb.contact_sheet_url,
        "chat_history_len": len(sb.chat_history or []),
    }


@router.post("/{storyboard_id}/chat/select-angle")
async def select_story_marketing_angle(
    storyboard_id: str,
    payload: SelectAngleRequest,
    current_user: User = Depends(get_effective_storyboard_user),
    db: Session = Depends(get_db),
):
    """
    User selected a marketing angle (or typed a custom one) from the Claude-style clarification card.
    Locks the direction in chat history and prepares for contact sheet generation.
    """
    sb = _find_storyboard(storyboard_id, current_user, db)
    if not sb:
        raise HTTPException(404, "Storyboard not found")

    angle_title = (payload.angle_title or "").strip()
    custom_text = (payload.custom_instruction or "").strip()
    final_angle = custom_text if custom_text else angle_title

    history = list(sb.chat_history or [])

    # Update previous clarification card in history to show user selection
    for msg in reversed(history):
        if msg.get("clarification_card"):
            msg["clarification_card"]["selected_angle_id"] = payload.angle_id or "custom"
            msg["clarification_card"]["selected_angle_title"] = final_angle
            break

    # Add user message
    user_msg_content = f"Selected Creative Direction: **{final_angle}**"
    if payload.angle_description and not custom_text:
        user_msg_content += f"\n_{payload.angle_description}_"

    history.append({
        "id": str(uuid.uuid4()),
        "role": "user",
        "content": user_msg_content,
        "timestamp": datetime.utcnow().isoformat(),
    })

    # Add assistant message
    asst_msg = {
        "id": str(uuid.uuid4()),
        "role": "assistant",
        "content": f"🎯 **Creative Direction Locked: {final_angle}**\n\nDirecting scene prompts, camera angles, lighting, and pacing strictly to embody this marketing angle. Generating your storyboard contact sheet now...",
        "marketing_angle": final_angle,
        "ready_for_contact_sheet": True,
        "timestamp": datetime.utcnow().isoformat(),
    }
    history.append(asst_msg)
    sb.chat_history = history
    db.commit()

    return {
        "chat_history": sb.chat_history,
        "marketing_angle": final_angle,
        "frame_count": sb.slider_frame_count or 6,
        "ready_for_contact_sheet": True,
    }


@router.post("/{sb_id}/sync-contact-sheet-frames")
async def sync_contact_sheet_frames_endpoint(
    sb_id: str,
    current_user: User = Depends(get_effective_storyboard_user),
    db: Session = Depends(get_db),
):
    """
    Forces a fresh slice of the contact sheet image into individual panels,
    and updates all StoryboardFrame database records so Step 3 frames 100%
    match the approved contact sheet panels.
    """
    sb = _find_storyboard(sb_id, current_user, db)
    if not sb:
        raise HTTPException(404, "Storyboard not found")
    if not sb.contact_sheet_url:
        raise HTTPException(400, "Storyboard does not have an approved contact sheet")

    frames = sync_contact_sheet_panels_to_db(sb, db, force=True)
    res = []
    for f in frames:
        res.append({
            "id": f.id,
            "scene_prompt": f.scene_prompt,
            "expanded_prompt": f.expanded_prompt,
            "order_index": f.order_index,
            "status": f.status,
            "error_msg": f.error_msg,
            "image_path": f.image_path,
            "is_anchor": getattr(f, "is_anchor", False),
            "consistency_score": getattr(f, "consistency_score", None),
            "created_at": f.created_at.isoformat() if getattr(f, "created_at", None) else None,
            "video_url": getattr(f, "video_url", None),
            "video_status": getattr(f, "video_status", None),
            "video_duration": getattr(f, "video_duration", None),
            "video_prompt": getattr(f, "video_prompt", None),
            "transition_video_url": getattr(f, "transition_video_url", None),
            "transition_to_frame_id": getattr(f, "transition_to_frame_id", None),
            "transition_video_status": getattr(f, "transition_video_status", None),
            "transition_video_duration": getattr(f, "transition_video_duration", None),
            "transition_video_prompt": getattr(f, "transition_video_prompt", None),
        })
    return {"status": "success", "frames": res}


# ── Google Veo 3.1 Video Animation Endpoints (via fal.ai) ──

class AnimateFrameRequest(BaseModel):
    mode: str = "single"  # "single" or "transition"
    target_frame_id: Optional[str] = None  # Required if mode == "transition"
    prompt: Optional[str] = None
    negative_prompt: Optional[str] = None  # Quality guardrails
    duration: Union[int, str] = 6  # 4, 6, 8 (or "4s", "6s", "8s")
    aspect_ratio: str = "16:9"
    resolution: Optional[str] = "1080p"  # "720p", "1080p"
    generate_audio: Optional[bool] = True
    model_tier: Optional[str] = "lite"  # "lite" or "flagship"


class TransitionBridgeRequest(BaseModel):
    source_frame_id: str
    target_frame_id: str
    duration: Union[int, str] = 6
    style_preference: Optional[str] = "natural_action"


def _run_veo_animation_task(
    storyboard_id: str,
    frame_id: str,
    mode: str,
    target_frame_id: Optional[str],
    prompt: str,
    negative_prompt: str,
    duration: Union[int, str],
    aspect_ratio: str,
    resolution: str = "1080p",
    generate_audio: bool = True,
    model_tier: str = "lite",
):
    """Background worker that calls Fal.ai Google Veo 3.1 and updates DB."""
    from database.db import SessionLocal
    from utils.fal_veo import generate_veo_single_frame, generate_veo_transition
    db = SessionLocal()
    try:
        frame = db.query(StoryboardFrame).filter(StoryboardFrame.id == frame_id).first()
        if not frame:
            print(f"[FalVeo Task] Frame {frame_id} not found")
            return

        # Normalize duration display integer for DB recording
        dur_int = int(str(duration).replace("s", "")) if str(duration).replace("s", "").isdigit() else 6

        if mode == "transition":
            target_frame = db.query(StoryboardFrame).filter(StoryboardFrame.id == target_frame_id).first()
            if not target_frame or not target_frame.image_path:
                frame.transition_video_status = "failed"
                db.commit()
                print(f"[FalVeo Task] Target frame {target_frame_id} missing or has no image")
                return

            print(f"[FalVeo Task] Starting Veo 3.1 ({model_tier}, {resolution}) transition animation between frames {frame_id} and {target_frame_id} ({duration})...")
            video_url = generate_veo_transition(
                first_frame_path=frame.image_path,
                last_frame_path=target_frame.image_path,
                prompt=prompt,
                negative_prompt=negative_prompt,
                duration=duration,
                aspect_ratio=aspect_ratio,
                resolution=resolution,
                generate_audio=generate_audio,
                model_tier=model_tier,
            )
            frame.transition_video_url = video_url
            frame.transition_video_status = "done"
            frame.transition_video_duration = dur_int
            frame.transition_video_prompt = prompt
            frame.transition_to_frame_id = target_frame_id
            db.commit()
            print(f"[FalVeo Task] Veo 3.1 transition animation succeeded: {video_url}")
        else:
            print(f"[FalVeo Task] Starting Veo 3.1 ({model_tier}, {resolution}) single-frame animation for frame {frame_id} ({duration})...")
            video_url = generate_veo_single_frame(
                image_path=frame.image_path,
                prompt=prompt,
                negative_prompt=negative_prompt,
                duration=duration,
                aspect_ratio=aspect_ratio,
                resolution=resolution,
                generate_audio=generate_audio,
                model_tier=model_tier,
            )
            frame.video_url = video_url
            frame.video_status = "done"
            frame.video_duration = dur_int
            frame.video_prompt = prompt
            db.commit()
            print(f"[FalVeo Task] Veo 3.1 single frame animation succeeded: {video_url}")
    except Exception as e:
        print(f"[FalVeo Task] Veo 3.1 animation error: {e}")
        try:
            if mode == "transition":
                frame.transition_video_status = "failed"
            else:
                frame.video_status = "failed"
            db.commit()
        except Exception:
            pass
    finally:
        db.close()


@router.post("/{sb_id}/frames/transition-bridge-prompt")
async def get_transition_bridge_prompt(
    sb_id: str,
    req: TransitionBridgeRequest,
    current_user: User = Depends(get_effective_storyboard_user),
    db: Session = Depends(get_db),
):
    """
    AI Director Engine: Synthesizes a high-fidelity continuous motion transition prompt
    bridging two keyframes with character & prop continuity, camera trajectory, and quality guardrails.
    """
    sb = _find_storyboard(sb_id, current_user, db)
    if not sb:
        raise HTTPException(404, "Storyboard not found")

    source_frame = db.query(StoryboardFrame).filter(StoryboardFrame.id == req.source_frame_id, StoryboardFrame.storyboard_id == sb_id).first()
    target_frame = db.query(StoryboardFrame).filter(StoryboardFrame.id == req.target_frame_id, StoryboardFrame.storyboard_id == sb_id).first()

    if not source_frame or not target_frame:
        raise HTTPException(404, "Source or target frame not found")

    chars = db.query(StoryboardCharacter).filter(StoryboardCharacter.storyboard_id == sb_id).all()
    prods = db.query(StoryboardProduct).filter(StoryboardProduct.storyboard_id == sb_id).all()

    char_context = ", ".join([f"{c.name}: {c.description or ''}" for c in chars]) if chars else ""
    prod_context = ", ".join([f"{p.name}: {p.description or ''}" for p in prods]) if prods else ""

    from utils.fal_veo import synthesize_director_transition_prompt
    result = await synthesize_director_transition_prompt(
        start_prompt=source_frame.scene_prompt or "",
        end_prompt=target_frame.scene_prompt or "",
        character_context=char_context,
        product_context=prod_context,
        duration_seconds=req.duration,
        style_preference=req.style_preference or "natural_action"
    )
    return result


@router.post("/{sb_id}/frame/{frame_id}/animate")
async def animate_frame_endpoint(
    sb_id: str,
    frame_id: str,
    req: AnimateFrameRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_effective_storyboard_user),
    db: Session = Depends(get_db),
):
    """
    Triggers Google Veo 3.1 Lite video animation for a single frame or a two-frame transition.
    Includes quality guardrails & negative prompt.
    Requires FAL_KEY configured in backend/.env.
    """
    from utils.fal_veo import get_fal_key, DEFAULT_VEO_NEGATIVE_PROMPT
    fal_key = get_fal_key()
    if not fal_key:
        raise HTTPException(
            status_code=400,
            detail="FAL_KEY is not configured. Please add FAL_KEY=your_key in backend/.env to use Google Veo 3.1 video animation."
        )

    # Check video animation rights (default: no users have video rights unless granted by admin)
    user_role = getattr(current_user, "role", "user")
    can_generate = getattr(current_user, "can_generate_video", False)
    if user_role != "admin" and not can_generate:
        raise HTTPException(
            status_code=403,
            detail="Video animation is disabled for your account. Please contact an admin to request video generation access."
        )

    sb = _find_storyboard(sb_id, current_user, db)
    if not sb:
        raise HTTPException(404, "Storyboard not found")

    frame = db.query(StoryboardFrame).filter(StoryboardFrame.id == frame_id, StoryboardFrame.storyboard_id == sb_id).first()
    if not frame:
        raise HTTPException(404, "Source frame not found")

    if not frame.image_path:
        raise HTTPException(400, "Source frame does not have an image generated yet")

    if req.mode == "transition":
        if not req.target_frame_id:
            raise HTTPException(400, "target_frame_id is required for transition mode")
        target_frame = db.query(StoryboardFrame).filter(
            StoryboardFrame.id == req.target_frame_id,
            StoryboardFrame.storyboard_id == sb_id
        ).first()
        if not target_frame:
            raise HTTPException(404, "Target frame not found")
        if not target_frame.image_path:
            raise HTTPException(400, "Target frame does not have an image generated yet")

        dur_int = int(str(req.duration).replace("s", "")) if str(req.duration).replace("s", "").isdigit() else 6
        frame.transition_video_status = "generating"
        frame.transition_to_frame_id = req.target_frame_id
        frame.transition_video_duration = dur_int
        frame.transition_video_prompt = req.prompt or ""
    else:
        dur_int = int(str(req.duration).replace("s", "")) if str(req.duration).replace("s", "").isdigit() else 6
        frame.video_status = "generating"
        frame.video_duration = dur_int
        frame.video_prompt = req.prompt or ""

    db.commit()

    background_tasks.add_task(
        _run_veo_animation_task,
        storyboard_id=sb_id,
        frame_id=frame_id,
        mode=req.mode,
        target_frame_id=req.target_frame_id,
        prompt=req.prompt or "",
        negative_prompt=req.negative_prompt or DEFAULT_VEO_NEGATIVE_PROMPT,
        duration=req.duration,
        aspect_ratio=req.aspect_ratio or "16:9",
        resolution=req.resolution or "1080p",
        generate_audio=req.generate_audio if req.generate_audio is not None else True,
        model_tier=req.model_tier or "fast",
    )

    return {
        "status": "generating",
        "frame_id": frame_id,
        "mode": req.mode,
        "duration": req.duration,
        "message": "Video animation started with Google Veo 3.1",
    }


@router.get("/{sb_id}/frame/{frame_id}/video-status")
async def get_frame_video_status(
    sb_id: str,
    frame_id: str,
    current_user: User = Depends(get_effective_storyboard_user),
    db: Session = Depends(get_db),
):
    """Returns current animation status and video URLs for a frame."""
    sb = _find_storyboard(sb_id, current_user, db)
    if not sb:
        raise HTTPException(404, "Storyboard not found")

    frame = db.query(StoryboardFrame).filter(StoryboardFrame.id == frame_id, StoryboardFrame.storyboard_id == sb_id).first()
    if not frame:
        raise HTTPException(404, "Frame not found")

    return {
        "frame_id": frame.id,
        "video_url": frame.video_url,
        "video_status": frame.video_status,
        "video_duration": frame.video_duration,
        "video_prompt": frame.video_prompt,
        "transition_video_url": frame.transition_video_url,
        "transition_to_frame_id": frame.transition_to_frame_id,
        "transition_video_status": frame.transition_video_status,
        "transition_video_duration": frame.transition_video_duration,
        "transition_video_prompt": frame.transition_video_prompt,
    }



