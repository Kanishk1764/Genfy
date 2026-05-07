from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Integer, JSON, Float, Boolean
from sqlalchemy.orm import relationship
from database.db import Base
from database.models import generate_uuid
from datetime import datetime

class Storyboard(Base):
    __tablename__ = "storyboards"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    chat_history = Column(JSON, nullable=True, default=list)
    contact_sheet_url = Column(String(500), nullable=True)
    slider_frame_count = Column(Integer, nullable=True, default=6)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    user = relationship("User", back_populates="storyboards")
    characters = relationship("StoryboardCharacter", back_populates="storyboard", cascade="all, delete-orphan")
    products = relationship("StoryboardProduct", back_populates="storyboard", cascade="all, delete-orphan")
    frames = relationship("StoryboardFrame", back_populates="storyboard", cascade="all, delete-orphan", order_by="StoryboardFrame.order_index")

class StoryboardCharacter(Base):
    __tablename__ = "storyboard_characters"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    storyboard_id = Column(String(36), ForeignKey("storyboards.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    image_path = Column(String(500), nullable=True)  # Legacy single path (kept for compat)
    image_paths = Column(JSON, nullable=True, default=list)  # List of paths to reference images
    character_dna = Column(JSON, nullable=True)  # Extracted identity sheet
    best_angle_index = Column(Integer, default=0, nullable=False) # Index of clearest frontal face
    dna_version = Column(Integer, default=1, nullable=False)
    dna_extracted_at = Column(DateTime, nullable=True)
    dna_extraction_model = Column(String(100), nullable=True)
    dna_extraction_confidence = Column(Float, nullable=True) # 0-1 percentage
    dna_source = Column(String(20), default="image", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    storyboard = relationship("Storyboard", back_populates="characters")

class StoryboardFrame(Base):
    __tablename__ = "storyboard_frames"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    storyboard_id = Column(String(36), ForeignKey("storyboards.id", ondelete="CASCADE"), nullable=False)
    order_index = Column(Integer, default=0, nullable=False)
    
    scene_prompt = Column(Text, nullable=False)  # e.g., "Rahul in park"
    expanded_prompt = Column(Text, nullable=True) # AI expanded version with DNA
    
    image_path = Column(String(500), nullable=True) # Path to generated image
    model_used = Column(String(50), nullable=True)
    status = Column(String(20), default="pending")  # pending, generating, done, failed
    error_msg = Column(Text, nullable=True)
    
    parent_frame_id = Column(String(36), ForeignKey("storyboard_frames.id", ondelete="SET NULL"), nullable=True)
    generation_cost_usd = Column(Float, nullable=True, default=0.0)
    prompt_hash = Column(String(255), nullable=True)
    
    is_anchor = Column(Boolean, default=False, nullable=False)
    consistency_score = Column(Integer, nullable=True)
    last_full_instruction = Column(Text, nullable=True)
    relock_history = Column(JSON, nullable=True)
    detected_character_ids = Column(JSON, nullable=True, default=list)
    detected_product_ids = Column(JSON, nullable=True, default=list)
    anchor_frame_outfit_description = Column(Text, nullable=True)
    generation_started_at = Column(DateTime, nullable=True)  # When generation actually started (for watchdog timeout)
    
    # ── Google Veo 3.1 Video Animation Fields (via fal.ai) ──
    video_url = Column(String(500), nullable=True)  # Animated single-frame MP4 URL
    video_status = Column(String(20), nullable=True)  # pending, generating, done, failed
    video_duration = Column(Integer, nullable=True)  # 4, 5, 6, 8 seconds
    video_prompt = Column(Text, nullable=True)  # Motion description
    
    transition_video_url = Column(String(500), nullable=True)  # Two-frame transition MP4 URL
    transition_to_frame_id = Column(String(36), nullable=True)  # Target frame id for transition
    transition_video_status = Column(String(20), nullable=True)  # pending, generating, done, failed
    transition_video_duration = Column(Integer, nullable=True)  # 4, 5, 6, 8 seconds
    transition_video_prompt = Column(Text, nullable=True)  # Transition motion description
    
    # ── Legal & DMCA Quarantine ────────────────────────────────────────────────
    is_quarantined = Column(Boolean, default=False, nullable=False)
    quarantined_at = Column(DateTime, nullable=True)
    quarantine_reason = Column(Text, nullable=True)
    quarantined_by = Column(String(36), nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    storyboard = relationship("Storyboard", back_populates="frames")

class StoryboardProduct(Base):
    __tablename__ = "storyboard_products"
    
    id = Column(String(36), primary_key=True, default=generate_uuid)
    storyboard_id = Column(String(36), ForeignKey("storyboards.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    image_path = Column(String(500), nullable=True)   # Primary image (legacy compat)
    image_paths = Column(JSON, nullable=True, default=list)  # All reference image paths
    product_dna = Column(JSON, nullable=True)          # Extracted visual identity
    best_angle_index = Column(Integer, default=0, nullable=False)
    dna_version = Column(Integer, default=1, nullable=False)
    dna_extracted_at = Column(DateTime, nullable=True)
    dna_extraction_model = Column(String(100), nullable=True)
    dna_extraction_confidence = Column(Float, nullable=True) # 0-1 percentage
    dna_source = Column(String(20), default="image", nullable=False)
    is_approved = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    storyboard = relationship("Storyboard", back_populates="products")

class StoryboardBrief(Base):
    __tablename__ = "storyboard_briefs"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    storyboard_id = Column(String(36), ForeignKey("storyboards.id", ondelete="CASCADE"), nullable=False)
    raw_text = Column(Text, nullable=False)
    parsed_json = Column(JSON, nullable=True)
    parse_status = Column(String(20), default="pending")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

class CharacterSheet(Base):
    __tablename__ = "character_sheets"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    character_id = Column(String(36), ForeignKey("storyboard_characters.id", ondelete="CASCADE"), nullable=False)
    storyboard_id = Column(String(36), ForeignKey("storyboards.id", ondelete="CASCADE"), nullable=False)
    
    front_body_url = Column(String(500), nullable=True)
    side_profile_url = Column(String(500), nullable=True)
    face_closeup_url = Column(String(500), nullable=True)
    
    proportion_dna = Column(JSON, nullable=True)
    is_approved = Column(Boolean, default=False, nullable=False)
    generation_count = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

class FrameConsistencyReport(Base):
    __tablename__ = "frame_consistency_reports"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    frame_id = Column(String(36), ForeignKey("storyboard_frames.id", ondelete="CASCADE"), nullable=False)
    storyboard_id = Column(String(36), ForeignKey("storyboards.id", ondelete="CASCADE"), nullable=False)
    
    character_scores = Column(JSON, nullable=True)
    anchor_frame_id = Column(String(36), nullable=True)
    scored_at = Column(DateTime, default=datetime.utcnow, nullable=False)
