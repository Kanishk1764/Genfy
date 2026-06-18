"""Database connection and session management — always uses Supabase (PostgreSQL)

SCHEMA ISOLATION
----------------
All Genfy tables live in the 'genfy' PostgreSQL schema (e.g. genfy.users,
genfy.sessions).  The 'public' schema — where other projects on the same
Supabase database keep their own tables — is NEVER touched.

How it works
  • MetaData is created with schema='genfy' so every SQLAlchemy model that
    uses Base will have __table_args__ = {'schema': 'genfy'} implicitly.
  • A connect event listener runs SET search_path TO genfy,public on every
    raw connection so that un-qualified SQL statements also land in 'genfy'.
  • init_db() creates the 'genfy' schema before running create_all().
"""
from sqlalchemy import create_engine, MetaData, event
from sqlalchemy import inspect, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os
from dotenv import load_dotenv

# override=True ensures .env always wins, even if DATABASE_URL is already in the
# system environment (e.g. a stale shell export from a previous session).
load_dotenv(override=True)

DATABASE_URL = os.getenv("DATABASE_URL", "")

# ── Hard guard: refuse to start without DATABASE_URL ────────────
if not DATABASE_URL:
    raise RuntimeError(
        "[DB] DATABASE_URL is not set. Add it to backend/.env."
    )

# Normalise legacy postgres:// → postgresql:// (Supabase / Heroku style)
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

_IS_SQLITE = DATABASE_URL.startswith("sqlite")
if _IS_SQLITE:
    print(f"[DB] Connected to SQLite: {DATABASE_URL}")
else:
    print(f"[DB] Connected to PostgreSQL (schema: genfy): {DATABASE_URL[:60]}...")

# ── Engine ────────────────────────────────────────────────────────────────────
if _IS_SQLITE:
    engine = create_engine(
        DATABASE_URL,
        echo=False,
        connect_args={"check_same_thread": False, "timeout": 60},  # SQLite requirement + 60s timeout
    )

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragmas(dbapi_conn, connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA busy_timeout=60000")
        cursor.close()
else:
    engine = create_engine(
        DATABASE_URL,
        echo=False,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=10,
    )

    # ── Schema isolation: set search_path on every new connection ──────────
    # This ensures all un-qualified table references resolve to 'genfy.*'
    # and NEVER accidentally hit the 'public.*' tables of other projects.
    @event.listens_for(engine, "connect")
    def _set_search_path(dbapi_conn, connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("SET search_path TO genfy, public")
        cursor.close()

# ── ORM Base — all models inherit schema='genfy' automatically ────────────────
# SQLite uses the default schema (None) because it has no schema concept.
_SCHEMA = None if _IS_SQLITE else "genfy"
metadata = MetaData(schema=_SCHEMA)
Base = declarative_base(metadata=metadata)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    """Dependency to get database session"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    """Initialize database tables inside the 'genfy' schema.

    ⚠️  SCHEMA ISOLATION: All CREATE / ALTER TABLE statements operate
    exclusively inside the 'genfy' schema.  The 'public' schema (used by
    other projects sharing this Supabase instance) is NEVER touched.
    """
    print("DEBUG: Starting Base.metadata.create_all...")

    # Ensure the 'genfy' schema exists before creating any tables inside it.
    if not _IS_SQLITE:
        with engine.begin() as conn:
            conn.execute(text("CREATE SCHEMA IF NOT EXISTS genfy"))
            print("[DB] Schema 'genfy' ensured.")

    try:
        Base.metadata.create_all(bind=engine)
    except Exception as e:
        if "already exists" in str(e) or "database is locked" in str(e):
            print(f"DEBUG: Handled concurrency during create_all: {e}")
        else:
            raise e

    # All inspector calls specify schema=_SCHEMA so they only look inside
    # the 'genfy' schema — never inside 'public'.
    inspector = inspect(engine)

    if inspector.has_table("images", schema=_SCHEMA):
        columns = {col["name"] for col in inspector.get_columns("images", schema=_SCHEMA)}
        with engine.begin() as conn:
            if "error_msg" not in columns:
                conn.execute(text("ALTER TABLE images ADD COLUMN error_msg TEXT"))
            if "is_quarantined" not in columns:
                conn.execute(text("ALTER TABLE images ADD COLUMN is_quarantined BOOLEAN DEFAULT FALSE"))
            if "quarantined_at" not in columns:
                conn.execute(text("ALTER TABLE images ADD COLUMN quarantined_at TIMESTAMP"))
            if "quarantine_reason" not in columns:
                conn.execute(text("ALTER TABLE images ADD COLUMN quarantine_reason TEXT"))
            if "quarantined_by" not in columns:
                conn.execute(text("ALTER TABLE images ADD COLUMN quarantined_by VARCHAR(36)"))
            if "upstream_request_id" not in columns:
                conn.execute(text("ALTER TABLE images ADD COLUMN upstream_request_id VARCHAR(255)"))

    if inspector.has_table("sessions", schema=_SCHEMA):
        columns = {col["name"] for col in inspector.get_columns("sessions", schema=_SCHEMA)}
        with engine.begin() as conn:
            if "enhanced_prompt" not in columns:
                conn.execute(text("ALTER TABLE sessions ADD COLUMN enhanced_prompt TEXT"))
            if "pipeline_type" not in columns:
                conn.execute(text("ALTER TABLE sessions ADD COLUMN pipeline_type VARCHAR(20)"))
            # Quality Recovery Chain columns
            if "original_session_id" not in columns:
                conn.execute(text("ALTER TABLE sessions ADD COLUMN original_session_id VARCHAR(36)"))
            if "structural_lock_session_id" not in columns:
                conn.execute(text("ALTER TABLE sessions ADD COLUMN structural_lock_session_id VARCHAR(36)"))
            if "edit_type" not in columns:
                conn.execute(text("ALTER TABLE sessions ADD COLUMN edit_type VARCHAR(20)"))
            if "edit_history_json" not in columns:
                conn.execute(text("ALTER TABLE sessions ADD COLUMN edit_history_json TEXT"))

    if inspector.has_table("compare_images", schema=_SCHEMA):
        columns = {col["name"] for col in inspector.get_columns("compare_images", schema=_SCHEMA)}
        with engine.begin() as conn:
            if "original_prompt" not in columns:
                conn.execute(text("ALTER TABLE compare_images ADD COLUMN original_prompt TEXT"))
            if "is_quarantined" not in columns:
                conn.execute(text("ALTER TABLE compare_images ADD COLUMN is_quarantined BOOLEAN DEFAULT FALSE"))
            if "quarantined_at" not in columns:
                conn.execute(text("ALTER TABLE compare_images ADD COLUMN quarantined_at TIMESTAMP"))
            if "quarantine_reason" not in columns:
                conn.execute(text("ALTER TABLE compare_images ADD COLUMN quarantine_reason TEXT"))
            if "quarantined_by" not in columns:
                conn.execute(text("ALTER TABLE compare_images ADD COLUMN quarantined_by VARCHAR(36)"))
            if "upstream_request_id" not in columns:
                conn.execute(text("ALTER TABLE compare_images ADD COLUMN upstream_request_id VARCHAR(255)"))

    if inspector.has_table("storyboard_characters", schema=_SCHEMA):
        columns = {col["name"] for col in inspector.get_columns("storyboard_characters", schema=_SCHEMA)}
        with engine.begin() as conn:
            if "image_paths" not in columns:
                conn.execute(text("ALTER TABLE storyboard_characters ADD COLUMN image_paths TEXT"))
            if "best_angle_index" not in columns:
                conn.execute(text("ALTER TABLE storyboard_characters ADD COLUMN best_angle_index INTEGER DEFAULT 0"))
            if "dna_version" not in columns:
                conn.execute(text("ALTER TABLE storyboard_characters ADD COLUMN dna_version INTEGER DEFAULT 1"))
            if "dna_extracted_at" not in columns:
                conn.execute(text("ALTER TABLE storyboard_characters ADD COLUMN dna_extracted_at TIMESTAMP"))
            if "dna_extraction_model" not in columns:
                conn.execute(text("ALTER TABLE storyboard_characters ADD COLUMN dna_extraction_model VARCHAR(100)"))
            if "dna_extraction_confidence" not in columns:
                conn.execute(text("ALTER TABLE storyboard_characters ADD COLUMN dna_extraction_confidence FLOAT"))

    if inspector.has_table("storyboard_frames", schema=_SCHEMA):
        columns = {col["name"] for col in inspector.get_columns("storyboard_frames", schema=_SCHEMA)}
        with engine.begin() as conn:
            if "parent_frame_id" not in columns:
                conn.execute(text("ALTER TABLE storyboard_frames ADD COLUMN parent_frame_id VARCHAR(36) REFERENCES storyboard_frames(id) ON DELETE SET NULL"))
            if "generation_cost_usd" not in columns:
                conn.execute(text("ALTER TABLE storyboard_frames ADD COLUMN generation_cost_usd FLOAT"))
            if "prompt_hash" not in columns:
                conn.execute(text("ALTER TABLE storyboard_frames ADD COLUMN prompt_hash VARCHAR(255)"))
            if "is_anchor" not in columns:
                conn.execute(text("ALTER TABLE storyboard_frames ADD COLUMN is_anchor BOOLEAN DEFAULT FALSE"))
            if "consistency_score" not in columns:
                conn.execute(text("ALTER TABLE storyboard_frames ADD COLUMN consistency_score FLOAT"))
            if "last_full_instruction" not in columns:
                conn.execute(text("ALTER TABLE storyboard_frames ADD COLUMN last_full_instruction TEXT"))
            if "relock_history" not in columns:
                conn.execute(text("ALTER TABLE storyboard_frames ADD COLUMN relock_history TEXT"))
            if "detected_character_ids" not in columns:
                conn.execute(text("ALTER TABLE storyboard_frames ADD COLUMN detected_character_ids TEXT"))
            if "detected_product_ids" not in columns:
                conn.execute(text("ALTER TABLE storyboard_frames ADD COLUMN detected_product_ids TEXT"))
            if "anchor_frame_outfit_description" not in columns:
                conn.execute(text("ALTER TABLE storyboard_frames ADD COLUMN anchor_frame_outfit_description TEXT"))
            if "generation_started_at" not in columns:
                conn.execute(text("ALTER TABLE storyboard_frames ADD COLUMN generation_started_at TIMESTAMP"))
            # Google Veo 3.1 video animation columns
            if "video_url" not in columns:
                conn.execute(text("ALTER TABLE storyboard_frames ADD COLUMN video_url VARCHAR(500)"))
            if "video_status" not in columns:
                conn.execute(text("ALTER TABLE storyboard_frames ADD COLUMN video_status VARCHAR(20)"))
            if "video_duration" not in columns:
                conn.execute(text("ALTER TABLE storyboard_frames ADD COLUMN video_duration INTEGER"))
            if "video_prompt" not in columns:
                conn.execute(text("ALTER TABLE storyboard_frames ADD COLUMN video_prompt TEXT"))
            if "transition_video_url" not in columns:
                conn.execute(text("ALTER TABLE storyboard_frames ADD COLUMN transition_video_url VARCHAR(500)"))
            if "transition_to_frame_id" not in columns:
                conn.execute(text("ALTER TABLE storyboard_frames ADD COLUMN transition_to_frame_id VARCHAR(36)"))
            if "transition_video_status" not in columns:
                conn.execute(text("ALTER TABLE storyboard_frames ADD COLUMN transition_video_status VARCHAR(20)"))
            if "transition_video_duration" not in columns:
                conn.execute(text("ALTER TABLE storyboard_frames ADD COLUMN transition_video_duration INTEGER"))
            if "transition_video_prompt" not in columns:
                conn.execute(text("ALTER TABLE storyboard_frames ADD COLUMN transition_video_prompt TEXT"))
            if "is_quarantined" not in columns:
                conn.execute(text("ALTER TABLE storyboard_frames ADD COLUMN is_quarantined BOOLEAN DEFAULT FALSE"))
            if "quarantined_at" not in columns:
                conn.execute(text("ALTER TABLE storyboard_frames ADD COLUMN quarantined_at TIMESTAMP"))
            if "quarantine_reason" not in columns:
                conn.execute(text("ALTER TABLE storyboard_frames ADD COLUMN quarantine_reason TEXT"))
            if "quarantined_by" not in columns:
                conn.execute(text("ALTER TABLE storyboard_frames ADD COLUMN quarantined_by VARCHAR(36)"))

    if inspector.has_table("storyboard_products", schema=_SCHEMA):
        columns = {col["name"] for col in inspector.get_columns("storyboard_products", schema=_SCHEMA)}
        with engine.begin() as conn:
            if "image_paths" not in columns:
                conn.execute(text("ALTER TABLE storyboard_products ADD COLUMN image_paths TEXT"))
            if "best_angle_index" not in columns:
                conn.execute(text("ALTER TABLE storyboard_products ADD COLUMN best_angle_index INTEGER DEFAULT 0"))
            if "product_dna" not in columns:
                conn.execute(text("ALTER TABLE storyboard_products ADD COLUMN product_dna TEXT"))
            if "dna_version" not in columns:
                conn.execute(text("ALTER TABLE storyboard_products ADD COLUMN dna_version INTEGER DEFAULT 1"))
            if "dna_extracted_at" not in columns:
                conn.execute(text("ALTER TABLE storyboard_products ADD COLUMN dna_extracted_at TIMESTAMP"))
            if "dna_extraction_model" not in columns:
                conn.execute(text("ALTER TABLE storyboard_products ADD COLUMN dna_extraction_model VARCHAR(100)"))
            if "dna_extraction_confidence" not in columns:
                conn.execute(text("ALTER TABLE storyboard_products ADD COLUMN dna_extraction_confidence FLOAT"))
            if "is_approved" not in columns:
                conn.execute(text("ALTER TABLE storyboard_products ADD COLUMN is_approved BOOLEAN DEFAULT FALSE"))

    if inspector.has_table("storyboards", schema=_SCHEMA):
        columns = {col["name"] for col in inspector.get_columns("storyboards", schema=_SCHEMA)}
        with engine.begin() as conn:
            if "chat_history" not in columns:
                conn.execute(text("ALTER TABLE storyboards ADD COLUMN chat_history JSON"))
            if "contact_sheet_url" not in columns:
                conn.execute(text("ALTER TABLE storyboards ADD COLUMN contact_sheet_url VARCHAR(500)"))
            if "slider_frame_count" not in columns:
                conn.execute(text("ALTER TABLE storyboards ADD COLUMN slider_frame_count INTEGER DEFAULT 6"))

    if inspector.has_table("character_sheets", schema=_SCHEMA):
        columns = {col["name"] for col in inspector.get_columns("character_sheets", schema=_SCHEMA)}
        with engine.begin() as conn:
            if "front_body_url" not in columns:
                conn.execute(text("ALTER TABLE character_sheets ADD COLUMN front_body_url VARCHAR(500)"))
            if "side_profile_url" not in columns:
                conn.execute(text("ALTER TABLE character_sheets ADD COLUMN side_profile_url VARCHAR(500)"))
            if "face_closeup_url" not in columns:
                conn.execute(text("ALTER TABLE character_sheets ADD COLUMN face_closeup_url VARCHAR(500)"))
            if "proportion_dna" not in columns:
                conn.execute(text("ALTER TABLE character_sheets ADD COLUMN proportion_dna TEXT"))
            if "is_approved" not in columns:
                conn.execute(text("ALTER TABLE character_sheets ADD COLUMN is_approved BOOLEAN DEFAULT FALSE"))
            if "generation_count" not in columns:
                conn.execute(text("ALTER TABLE character_sheets ADD COLUMN generation_count INTEGER DEFAULT 0"))

    if inspector.has_table("users", schema=_SCHEMA):
        columns = {col["name"] for col in inspector.get_columns("users", schema=_SCHEMA)}
        with engine.begin() as conn:
            if "is_active" not in columns:
                conn.execute(text("ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT TRUE NOT NULL"))
            if "images_limit_per_week" not in columns:
                conn.execute(text("ALTER TABLE users ADD COLUMN images_limit_per_week INTEGER DEFAULT 50"))
            if "no_auto_delete" not in columns:
                conn.execute(text("ALTER TABLE users ADD COLUMN no_auto_delete BOOLEAN DEFAULT FALSE NOT NULL"))
            if "upscales_limit_per_day" not in columns:
                conn.execute(text("ALTER TABLE users ADD COLUMN upscales_limit_per_day INTEGER DEFAULT 5"))
            if "can_generate_video" not in columns:
                conn.execute(text("ALTER TABLE users ADD COLUMN can_generate_video BOOLEAN DEFAULT FALSE NOT NULL"))
            # OTP & Reset Password columns
            if "reset_otp_hash" not in columns:
                conn.execute(text("ALTER TABLE users ADD COLUMN reset_otp_hash VARCHAR(255)"))
            if "reset_otp_created_at" not in columns:
                conn.execute(text("ALTER TABLE users ADD COLUMN reset_otp_created_at TIMESTAMP"))
            if "reset_otp_attempts" not in columns:
                conn.execute(text("ALTER TABLE users ADD COLUMN reset_otp_attempts INTEGER DEFAULT 0"))
            if "reset_session_token" not in columns:
                conn.execute(text("ALTER TABLE users ADD COLUMN reset_session_token VARCHAR(255)"))
            # Terms of Service & Legal Compliance columns
            if "tos_accepted_at" not in columns:
                conn.execute(text("ALTER TABLE users ADD COLUMN tos_accepted_at TIMESTAMP"))
            if "tos_version" not in columns:
                conn.execute(text("ALTER TABLE users ADD COLUMN tos_version VARCHAR(20) DEFAULT 'v1.0'"))
            if "signup_ip" not in columns:
                conn.execute(text("ALTER TABLE users ADD COLUMN signup_ip VARCHAR(45)"))

    if inspector.has_table("pending_users", schema=_SCHEMA):
        columns = {col["name"] for col in inspector.get_columns("pending_users", schema=_SCHEMA)}
        with engine.begin() as conn:
            if "otp_hash" not in columns:
                conn.execute(text("ALTER TABLE pending_users ADD COLUMN otp_hash VARCHAR(255)"))
            if "otp_created_at" not in columns:
                conn.execute(text("ALTER TABLE pending_users ADD COLUMN otp_created_at TIMESTAMP"))
            if "otp_attempts" not in columns:
                conn.execute(text("ALTER TABLE pending_users ADD COLUMN otp_attempts INTEGER DEFAULT 0"))
            # Terms of Service & Legal Compliance columns
            if "tos_accepted_at" not in columns:
                conn.execute(text("ALTER TABLE pending_users ADD COLUMN tos_accepted_at TIMESTAMP"))
            if "tos_version" not in columns:
                conn.execute(text("ALTER TABLE pending_users ADD COLUMN tos_version VARCHAR(20) DEFAULT 'v1.0'"))
            if "signup_ip" not in columns:
                conn.execute(text("ALTER TABLE pending_users ADD COLUMN signup_ip VARCHAR(45)"))

    # ── Telemetry table: auto-created by create_all, but also guard for
    # existing installs where create_all already ran before this table existed.
    telemetry_tbl = f"{_SCHEMA}.gemini_telemetry_events" if _SCHEMA else "gemini_telemetry_events"
    if not inspector.has_table("gemini_telemetry_events", schema=_SCHEMA):
        with engine.begin() as conn:
            conn.execute(text(f"""
                CREATE TABLE IF NOT EXISTS {telemetry_tbl} (
                    id VARCHAR(36) PRIMARY KEY,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
                    model_used VARCHAR(100),
                    pipeline_type VARCHAR(50),
                    is_image_to_image BOOLEAN DEFAULT FALSE,
                    aspect_ratio VARCHAR(20),
                    request_source VARCHAR(50) DEFAULT 'STUDIO',
                    latency_ms INTEGER,
                    status VARCHAR(20) NOT NULL DEFAULT 'success',
                    error_code VARCHAR(100),
                    http_status INTEGER,
                    concurrency_at_dispatch INTEGER,
                    burst_velocity_10s INTEGER,
                    retry_attempt INTEGER DEFAULT 0,
                    backoff_delay_ms INTEGER,
                    recovery_time_ms INTEGER
                )
            """))
            print(f"[DB] Created {telemetry_tbl} table.")
        # Add index on created_at for fast date-range queries
        try:
            with engine.begin() as conn:
                conn.execute(text(
                    f"CREATE INDEX IF NOT EXISTS ix_telemetry_created_at ON {telemetry_tbl} (created_at)"
                ))
        except Exception:
            pass  # Index may already exist
    else:
        columns = {col["name"] for col in inspector.get_columns("gemini_telemetry_events", schema=_SCHEMA)}
        with engine.begin() as conn:
            if "request_source" not in columns:
                conn.execute(text(f"ALTER TABLE {telemetry_tbl} ADD COLUMN request_source VARCHAR(50) DEFAULT 'STUDIO'"))
                print(f"[DB] Added request_source column to {telemetry_tbl}.")
                
    print("DEBUG: Base.metadata.create_all completed.")
    print("Database initialized")


def promote_admin_email():
    """Create or promote the ADMIN_EMAIL user to admin role on startup, and set display name to 'Anoop Dixit' for all admins."""
    admin_email = os.getenv("ADMIN_EMAIL", "")
    admin_password = os.getenv("ADMIN_PASSWORD", "")
    db = SessionLocal()
    try:
        from database.models import User
        from utils.auth import hash_password
        
        # 1. Handle ADMIN_EMAIL config promotion/creation
        if admin_email:
            user = db.query(User).filter(User.email == admin_email).first()
            if user:
                # Existing user — ensure admin role and name
                changed = False
                if user.role != "admin":
                    user.role = "admin"
                    changed = True
                if user.name != "Anoop Dixit":
                    user.name = "Anoop Dixit"
                    changed = True
                user.is_active = True
                user.images_limit_per_week = 99999
                user.upscales_limit_per_day = 99999
                if admin_password:
                    new_hash = hash_password(admin_password)
                    if user.password_hash != new_hash:
                        user.password_hash = new_hash
                        changed = True
                db.commit()
                if changed:
                    print(f"[Admin] Promoted {admin_email} to admin role and set name to Anoop Dixit.")
                else:
                    print(f"[Admin] {admin_email} is already admin.")
            elif admin_password:
                # Create the admin account from scratch
                new_admin = User(
                    email=admin_email,
                    password_hash=hash_password(admin_password),
                    name="Anoop Dixit",
                    role="admin",
                    is_active=True,
                    email_verified=True,
                    auth_provider="email",
                    plan_type="enterprise",
                    images_limit_per_week=99999,
                    upscales_limit_per_day=99999,
                )
                db.add(new_admin)
                try:
                    db.commit()
                    print(f"[Admin] Created admin account: {admin_email} with name Anoop Dixit")
                except Exception:
                    db.rollback()
                    print(f"[Admin] Admin account {admin_email} already created by concurrent worker.")
            else:
                print(f"[Admin] ADMIN_EMAIL '{admin_email}' not found and ADMIN_PASSWORD not set — cannot create admin.")
        
        # 2. Set all other admin users' names to 'Anoop Dixit'
        all_admins = db.query(User).filter(User.role == "admin").all()
        updated_count = 0
        for admin in all_admins:
            if admin.name != "Anoop Dixit":
                admin.name = "Anoop Dixit"
                updated_count += 1
        if updated_count > 0:
            db.commit()
            print(f"[Admin] Updated display name to 'Anoop Dixit' for {updated_count} admin accounts.")
            
    except Exception as e:
        db.rollback()
        print(f"[Admin] Failed to setup admin: {e}")
    finally:
        db.close()
