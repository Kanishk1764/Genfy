"""SQLAlchemy database models for authentication and image sessions"""
from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Integer, JSON, Boolean, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from datetime import datetime
from database.db import Base
import uuid

from sqlalchemy.types import TypeDecorator
from utils.encryption import encrypt_field, decrypt_field

def generate_uuid():
    """Generate unique ID for records"""
    return str(uuid.uuid4())

class EncryptedString(TypeDecorator):
    """SQLAlchemy column type that transparently encrypts strings on write and decrypts on read."""
    impl = String
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value:
            # Prevent double-encrypting if already a Fernet token
            if str(value).startswith("gAAAAA"):
                return str(value)
            return encrypt_field(str(value))
        return value

    def process_result_value(self, value, dialect):
        if value:
            return decrypt_field(str(value))
        return value

class User(Base):
    """Main user table - stores verified users"""
    __tablename__ = "users"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    # Keep this as an internal bootstrap flag only; product access is plan-based.
    role = Column(String(20), default='user', nullable=False)
    
    user_type = Column(String(20), nullable=True)
    email = Column(String(255), nullable=False, unique=True)
    password_hash = Column(String(255), nullable=True)
    name = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    max_projects = Column(Integer, default=1)
    
    google_id = Column(EncryptedString(255), nullable=True)
    github_id = Column(EncryptedString(255), nullable=True)
    auth_provider = Column(String(50), default='email', nullable=False)
    profile_picture = Column(String(500), nullable=True)
    
    reset_token = Column(String(255), nullable=True)
    reset_token_created_at = Column(DateTime, nullable=True)
    reset_otp_hash = Column(String(255), nullable=True)
    reset_otp_created_at = Column(DateTime, nullable=True)
    reset_otp_attempts = Column(Integer, default=0)
    reset_session_token = Column(String(255), nullable=True)
    
    # Email Verification Fields
    email_verified = Column(Boolean, default=False, nullable=False)
    # SHA256-hashed token. Kept on the User record after verification so that
    # duplicate /verify-email requests (React 18 Strict Mode, network retries)
    # can find the user by token and return success instead of a 400 error.
    verification_token = Column(String(255), nullable=True)
    verification_token_created_at = Column(DateTime, nullable=True)
    verification_sent_count = Column(Integer, default=0)  # Rate limiting
    
    # Payment & Subscription Fields
    plan_type = Column(String(20), nullable=False, default='not_selected')  # "starter", "pro", "enterprise", "not_selected"
    payment_status = Column(String(20), default="pending")  # "pending", "completed", "failed"
    payment_amount = Column(Integer, nullable=True)  # 9 for starter, 19 for pro, 79 for enterprise
    razorpay_order_id = Column(String(255), nullable=True)
    razorpay_payment_id = Column(EncryptedString(255), nullable=True)
    razorpay_signature = Column(EncryptedString(500), nullable=True)
    payment_completed_at = Column(DateTime, nullable=True)
    
    # Trial Fields
    is_trial = Column(Boolean, default=False)
    trial_started_at = Column(DateTime, nullable=True)
    trial_ends_at = Column(DateTime, nullable=True)
    has_used_trial = Column(Boolean, default=False)
    
    # Token Tracking (for AI usage)
    token_balance = Column(Integer, default=1000000)
    total_tokens_consumed = Column(Integer, default=0)
    prompt_tokens_consumed = Column(Integer, default=0)
    completion_tokens_consumed = Column(Integer, default=0)

    # Usage Limits & Access Control
    is_active = Column(Boolean, default=True, nullable=False)       # False = access revoked
    can_generate_video = Column(Boolean, default=False, nullable=False) # False by default for all users
    images_limit_per_week = Column(Integer, default=50)             # max images generated per 7-day window
    upscales_limit_per_day = Column(Integer, default=5)             # max upscales triggered per 24h window
    no_auto_delete = Column(Boolean, default=False, nullable=False)  # True = exempt from 3-day deletion

    # Terms of Service Consent & Forensic Legal Logging
    tos_accepted_at = Column(DateTime, nullable=True)
    tos_version = Column(String(20), nullable=True, default="v1.0")
    signup_ip = Column(String(45), nullable=True)
    
    # Relationships to existing data
    sessions = relationship("Session", back_populates="user", cascade="all, delete-orphan", passive_deletes=True)
    compare_sessions = relationship("CompareSession", back_populates="user", cascade="all, delete-orphan", passive_deletes=True)
    storyboards = relationship("Storyboard", back_populates="user", cascade="all, delete-orphan", passive_deletes=True)

    def to_dict(self):
        """Convert user to dictionary for API responses"""
        return {
            "id": self.id,
            "user_type": self.user_type,
            "email": self.email,
            "name": self.name,
            "max_projects": self.max_projects,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "plan_type": self.plan_type,
            "payment_status": self.payment_status,
            "payment_amount": self.payment_amount,
            "role": self.role,
            "is_trial": self.is_trial,
            "trial_ends_at": self.trial_ends_at.isoformat() + "Z" if self.trial_ends_at else None,
            "trial_started_at": self.trial_started_at.isoformat() + "Z" if self.trial_started_at else None,
            "has_used_trial": self.has_used_trial,
            "token_balance": self.token_balance,
            "total_tokens_consumed": self.total_tokens_consumed,
            "prompt_tokens_consumed": self.prompt_tokens_consumed,
            "completion_tokens_consumed": self.completion_tokens_consumed,
            "is_active": self.is_active,
            "can_generate_video": bool(getattr(self, "can_generate_video", False)),
            "images_limit_per_week": self.images_limit_per_week,
            "upscales_limit_per_day": self.upscales_limit_per_day,
            "no_auto_delete": self.no_auto_delete,
            "tos_accepted_at": self.tos_accepted_at.isoformat() + "Z" if self.tos_accepted_at else None,
            "tos_version": self.tos_version
        }

class PendingUser(Base):
    """Temporary storage for users who haven't verified email yet"""
    __tablename__ = "pending_users"
    
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    email = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    name = Column(String(255), nullable=True)
    verification_token = Column(String, nullable=True)
    verification_token_created_at = Column(DateTime, nullable=True)
    otp_hash = Column(String, nullable=True)
    otp_created_at = Column(DateTime, nullable=True)
    otp_attempts = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    verification_sent_count = Column(Integer, default=1)
    tos_accepted_at = Column(DateTime, nullable=True)
    tos_version = Column(String(20), nullable=True, default="v1.0")
    signup_ip = Column(String(45), nullable=True)

# ── EXISTING DATA MODELS (Ported from raw SQL) ──

class Session(Base):
    __tablename__ = "sessions"
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=True) # ForeignKey added
    parent_session_id = Column(String(36), nullable=True)
    prompt = Column(Text, nullable=True)
    enhanced_prompt = Column(Text, nullable=True)   # full final prompt sent to the model
    pipeline_type = Column(String(20), nullable=True)  # e.g. AUTHENTIC, PORTRAIT, COMMERCIAL
    models = Column(Text, nullable=True) # JSON string
    active_configs = Column(Text, nullable=True) # JSON string
    reference_image_id = Column(String(36), nullable=True)
    ratio = Column(String(10), nullable=True)
    quality = Column(String(20), nullable=True)
    created_at = Column(String(50), nullable=True)
    # ── Quality Recovery Chain ──────────────────────────────────────────────────
    original_session_id = Column(String(36), nullable=True)           # always points to the root (depth-0) session
    structural_lock_session_id = Column(String(36), nullable=True)    # latest session where a structural edit completed
    edit_type = Column(String(20), nullable=True)                     # "original" | "structural" | "inpainting"
    edit_history_json = Column(Text, nullable=True)                   # JSON list of {instruction, type, session_id}

    user = relationship("User", back_populates="sessions")
    images = relationship("Image", back_populates="session", cascade="all, delete-orphan")

class Image(Base):
    __tablename__ = "images"
    id = Column(String(36), primary_key=True, default=generate_uuid)
    session_id = Column(String(36), ForeignKey("sessions.id"), nullable=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=True) # Add for direct lookup
    model_id = Column(String(50), nullable=True)
    status = Column(String(20), nullable=True)
    url = Column(Text, nullable=True)
    enhanced_prompt = Column(Text, nullable=True)  # new field
    error_msg = Column(Text, nullable=True)
    created_at = Column(String(50), nullable=True)
    # ── Legal & DMCA Quarantine ────────────────────────────────────────────────
    is_quarantined = Column(Boolean, default=False, nullable=False)
    quarantined_at = Column(DateTime, nullable=True)
    quarantine_reason = Column(Text, nullable=True)
    quarantined_by = Column(String(36), nullable=True)
    upstream_request_id = Column(String(255), nullable=True)

    session = relationship("Session", back_populates="images")

class CompareSession(Base):
    __tablename__ = "compare_sessions"
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=True) # ForeignKey added
    original_prompt = Column(Text, nullable=True)
    models = Column(Text, nullable=True) # JSON string
    ratio = Column(String(10), nullable=True)
    quality = Column(String(20), nullable=True)
    active_configs = Column(Text, nullable=True) # JSON string
    created_at = Column(String(50), nullable=True)

    user = relationship("User", back_populates="compare_sessions")
    images = relationship("CompareImage", back_populates="compare_session", cascade="all, delete-orphan")

class CompareImage(Base):
    __tablename__ = "compare_images"
    id = Column(String(36), primary_key=True, default=generate_uuid)
    compare_session_id = Column(String(36), ForeignKey("compare_sessions.id"), nullable=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=True) # Add for direct lookup
    model_id = Column(String(50), nullable=True)
    original_prompt = Column(Text, nullable=True)
    tailored_prompt = Column(Text, nullable=True)
    status = Column(String(20), nullable=True)
    url = Column(Text, nullable=True)
    error_msg = Column(Text, nullable=True)
    iteration = Column(Integer, default=0)
    created_at = Column(String(50), nullable=True)
    # ── Legal & DMCA Quarantine ────────────────────────────────────────────────
    is_quarantined = Column(Boolean, default=False, nullable=False)
    quarantined_at = Column(DateTime, nullable=True)
    quarantine_reason = Column(Text, nullable=True)
    quarantined_by = Column(String(36), nullable=True)
    upstream_request_id = Column(String(255), nullable=True)

    compare_session = relationship("CompareSession", back_populates="images")

class UpscaledImage(Base):
    __tablename__ = "upscaled_images"
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=True)
    original_image_id = Column(String(36), ForeignKey("images.id"), nullable=True)
    url = Column(Text, nullable=True)
    status = Column(String(20), nullable=True) # "pending", "success", "failed"
    error_msg = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User")
    original_image = relationship("Image")


class GeminiTelemetryEvent(Base):
    """Lightweight telemetry table for per-request Gemini API call metrics.

    Writes are always fire-and-forget (background task) — they NEVER block
    the generation hot-path. Reads are only served to admin endpoints.
    """
    __tablename__ = "gemini_telemetry_events"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    # What was called
    model_used = Column(String(100), nullable=True)           # e.g. "gemini-3.1-flash-image"
    pipeline_type = Column(String(50), nullable=True)          # e.g. "AUTHENTIC", "COMMERCIAL"
    is_image_to_image = Column(Boolean, default=False)         # True if image_b64 was provided
    aspect_ratio = Column(String(20), nullable=True)           # e.g. "16:9", "1:1"
    request_source = Column(String(50), nullable=True, default="STUDIO")  # "STUDIO", "STORYBOARD", "COMPARE", "EDIT"

    # How it performed
    latency_ms = Column(Integer, nullable=True)                # Wall-clock ms from dispatch to response
    status = Column(String(20), nullable=False, default="success")  # "success" | "429" | "503" | "timeout" | "error"
    error_code = Column(String(100), nullable=True)            # Raw error string snippet when status != success
    http_status = Column(Integer, nullable=True)               # Numeric HTTP/gRPC code if extractable

    # Concurrency state at dispatch time
    concurrency_at_dispatch = Column(Integer, nullable=True)   # How many Gemini calls were in-flight when this one started
    burst_velocity_10s = Column(Integer, nullable=True)        # Requests dispatched in the 10s window before this one

    # Retry info
    retry_attempt = Column(Integer, default=0)                 # 0 = first attempt, 1+ = retries
    backoff_delay_ms = Column(Integer, nullable=True)          # Cumulative backoff before this attempt

    # Recovery (only meaningful when status="429")
    recovery_time_ms = Column(Integer, nullable=True)          # Ms from first 429 until next success in the same chain

# Register Storyboard model with SQLAlchemy registry to avoid unbound relationship warnings
try:
    from database.storyboard_models import Storyboard  # noqa: F401
except Exception:
    pass

