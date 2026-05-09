# Genfy Image Tool — Database Schema

> **Engine:** PostgreSQL (Supabase) — fallback SQLite for local dev  
> **ORM:** SQLAlchemy (declarative)  
> **Source:** `backend/database/models.py` · `backend/database/storyboard_models.py`  
> **Connection:** `backend/database/db.py`

---

## Entity Relationship Diagram

```mermaid
erDiagram
    users ||--o{ sessions : "owns"
    users ||--o{ compare_sessions : "owns"
    users ||--o{ storyboards : "owns"
    users ||--o{ upscaled_images : "owns"
    sessions ||--o{ images : "contains"
    sessions ||--o| sessions : "parent → child (edit chain)"
    compare_sessions ||--o{ compare_images : "contains"
    images ||--o{ upscaled_images : "source"
    storyboards ||--o{ storyboard_characters : "has"
    storyboards ||--o{ storyboard_products : "has"
    storyboards ||--o{ storyboard_frames : "has"
    storyboards ||--o{ storyboard_briefs : "has"
    storyboard_characters ||--o{ character_sheets : "has"
    storyboard_frames ||--o{ frame_consistency_reports : "has"

    users {
        string id PK
        string email UK
        string role
        string plan_type
        int images_limit_per_week
    }
    sessions {
        string id PK
        string user_id FK
        string parent_session_id
        text prompt
        text enhanced_prompt
        string pipeline_type
    }
    images {
        string id PK
        string session_id FK
        string user_id FK
        string model_id
        string status
        text url
    }
    compare_sessions {
        string id PK
        string user_id FK
        text original_prompt
    }
    compare_images {
        string id PK
        string compare_session_id FK
        string model_id
        string status
        text url
    }
    upscaled_images {
        string id PK
        string user_id FK
        string original_image_id FK
        text url
        string status
    }
    storyboards {
        string id PK
        string user_id FK
        string name
    }
    storyboard_characters {
        string id PK
        string storyboard_id FK
        string name
        json character_dna
    }
    storyboard_frames {
        string id PK
        string storyboard_id FK
        int order_index
        string status
    }
```

---

## Module 1 — Core (Image Generation)

### Table: `users`

> Primary user accounts. Created on email signup or Google OAuth.

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | `VARCHAR(36)` | **PK** | `uuid4()` | Unique user ID |
| `role` | `VARCHAR(20)` | NOT NULL | `'user'` | `user` · `admin` |
| `user_type` | `VARCHAR(20)` | NULLABLE | — | Custom user classification |
| `email` | `VARCHAR(255)` | NOT NULL, **UNIQUE** | — | User's email address |
| `password_hash` | `VARCHAR(255)` | NULLABLE | — | Bcrypt hash (null for Google users) |
| `name` | `VARCHAR(255)` | NULLABLE | — | Display name |
| `created_at` | `DATETIME` | NOT NULL | `utcnow()` | Account creation timestamp |
| `max_projects` | `INTEGER` | — | `1` | Max allowed projects |
| `google_id` | `VARCHAR(255)` | **UNIQUE**, NULLABLE | — | Google OAuth sub ID |
| `github_id` | `VARCHAR(255)` | **UNIQUE**, NULLABLE | — | GitHub OAuth ID |
| `auth_provider` | `VARCHAR(50)` | NOT NULL | `'email'` | `email` · `google` · `github` |
| `profile_picture` | `VARCHAR(500)` | NULLABLE | — | Profile image URL |
| `reset_token` | `VARCHAR(255)` | NULLABLE | — | Password reset token |
| `reset_token_created_at` | `DATETIME` | NULLABLE | — | Reset token timestamp |
| `email_verified` | `BOOLEAN` | NOT NULL | `false` | Whether email is confirmed |
| `verification_token` | `VARCHAR(255)` | NULLABLE | — | SHA256-hashed verification token |
| `verification_token_created_at` | `DATETIME` | NULLABLE | — | Token creation time |
| `verification_sent_count` | `INTEGER` | — | `0` | Rate limit counter |
| `plan_type` | `VARCHAR(20)` | NOT NULL | `'not_selected'` | `not_selected` · `starter` · `pro` · `enterprise` |
| `payment_status` | `VARCHAR(20)` | — | `'pending'` | `pending` · `completed` · `failed` |
| `payment_amount` | `INTEGER` | NULLABLE | — | Amount in currency units (9/19/79) |
| `razorpay_order_id` | `VARCHAR(255)` | NULLABLE | — | Razorpay order reference |
| `razorpay_payment_id` | `VARCHAR(255)` | NULLABLE | — | Razorpay payment reference |
| `razorpay_signature` | `VARCHAR(500)` | NULLABLE | — | Razorpay webhook signature |
| `payment_completed_at` | `DATETIME` | NULLABLE | — | Payment completion time |
| `is_trial` | `BOOLEAN` | — | `false` | Currently on trial? |
| `trial_started_at` | `DATETIME` | NULLABLE | — | Trial start time |
| `trial_ends_at` | `DATETIME` | NULLABLE | — | Trial expiry time |
| `has_used_trial` | `BOOLEAN` | — | `false` | Has ever used a trial |
| `token_balance` | `INTEGER` | — | `1,000,000` | Remaining AI token balance |
| `total_tokens_consumed` | `INTEGER` | — | `0` | Lifetime total tokens used |
| `prompt_tokens_consumed` | `INTEGER` | — | `0` | Lifetime prompt tokens used |
| `completion_tokens_consumed` | `INTEGER` | — | `0` | Lifetime completion tokens used |
| `is_active` | `BOOLEAN` | NOT NULL | `true` | `false` = access revoked |
| `images_limit_per_week` | `INTEGER` | — | `50` | Max images per 7-day window |
| `upscales_limit_per_day` | `INTEGER` | — | `5` | Max upscales per 24h window |
| `no_auto_delete` | `BOOLEAN` | NOT NULL | `false` | Exempt from 3-day cleanup |

**Relationships:**
- `sessions` → `Session[]` (cascade delete)
- `compare_sessions` → `CompareSession[]` (cascade delete)
- `storyboards` → `Storyboard[]` (cascade delete)

---

### Table: `pending_users`

> Temporary holding table for users who signed up but haven't verified email yet. Rows are promoted to `users` on verification.

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | `VARCHAR` | **PK** | `uuid4()` | Temp user ID |
| `email` | `VARCHAR` | **UNIQUE**, NOT NULL, **INDEX** | — | Email being verified |
| `password_hash` | `VARCHAR` | NOT NULL | — | Bcrypt hash |
| `name` | `VARCHAR(255)` | NULLABLE | — | Display name |
| `verification_token` | `VARCHAR` | NOT NULL | — | Token sent via email |
| `verification_token_created_at` | `DATETIME` | NOT NULL | — | Token creation time |
| `created_at` | `DATETIME` | — | `utcnow()` | Row creation time |
| `verification_sent_count` | `INTEGER` | — | `1` | Emails sent (rate limit) |

---

### Table: `sessions`

> A generation or edit job. Each generation creates one session; each edit creates a **child session** linked via `parent_session_id`, forming an edit chain (tree).

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | `VARCHAR(36)` | **PK** | `uuid4()` | Session ID |
| `user_id` | `VARCHAR(36)` | **FK** → `users.id`, NULLABLE | — | Owner |
| `parent_session_id` | `VARCHAR(36)` | NULLABLE | — | Parent session (edit lineage). `null` = root generation. |
| `prompt` | `TEXT` | NULLABLE | — | User's input prompt (or merged edit prompt) |
| `enhanced_prompt` | `TEXT` | NULLABLE | — | Full final prompt after SmartComposer enhancement |
| `pipeline_type` | `VARCHAR(20)` | NULLABLE | — | Detected pipeline (see below) |
| `models` | `TEXT` | NULLABLE | — | JSON string array of model IDs: `["Nanobanana 2"]` |
| `active_configs` | `TEXT` | NULLABLE | — | JSON config object: `{"chatgpt_model": "gpt-image-2"}` |
| `reference_image_id` | `VARCHAR(36)` | NULLABLE | — | ID of reference image used |
| `ratio` | `VARCHAR(10)` | NULLABLE | — | Aspect ratio: `"16:9"` |
| `quality` | `VARCHAR(20)` | NULLABLE | — | Quality tier: `"Standard"` / `"High"` / `"Ultra"` |
| `created_at` | `VARCHAR(50)` | NULLABLE | — | ISO timestamp string |

**Pipeline type values:**

| Value | Description |
|---|---|
| `AUTHENTIC` | Natural, unposed photography |
| `PORTRAIT` | People-focused shots |
| `COMMERCIAL` | Product/brand imagery |
| `CINEMATIC` | Film-style dramatic visuals |
| `LANDSCAPE` | Nature/architecture/environment |
| `ARTISTIC` | Non-photographic styles (anime, oil painting, etc.) |

**Relationships:**
- `user` → `User` (many-to-one)
- `images` → `Image[]` (cascade delete)

**Edit chain example:**
```
Session A (root)  ←── parent_session_id = null
  └── Session B (relight edit)  ←── parent_session_id = A
       └── Session C (skin enhance)  ←── parent_session_id = B
```

---

### Table: `images`

> Individual generated images. Each session can produce multiple images (one per model when multi-model is used).

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | `VARCHAR(36)` | **PK** | `uuid4()` | Image ID |
| `session_id` | `VARCHAR(36)` | **FK** → `sessions.id`, NULLABLE | — | Parent session |
| `user_id` | `VARCHAR(36)` | **FK** → `users.id`, NULLABLE | — | Owner (denormalized for direct lookup) |
| `model_id` | `VARCHAR(50)` | NULLABLE | — | Which AI model generated this: `"Nanobanana 2"` / `"ChatGPT"` / etc. |
| `status` | `VARCHAR(20)` | NULLABLE | — | See status values below |
| `url` | `TEXT` | NULLABLE | — | CDN URL of generated image (null while pending) |
| `enhanced_prompt` | `TEXT` | NULLABLE | — | The exact prompt sent to this specific model |
| `error_msg` | `TEXT` | NULLABLE | — | Error message if `status = 'failed'` |
| `created_at` | `VARCHAR(50)` | NULLABLE | — | ISO timestamp string |

**Status values:**

| Status | Meaning |
|---|---|
| `pending` | Generation in progress |
| `completed` | Done — `url` is populated |
| `failed` | Error — check `error_msg` |

**Relationships:**
- `session` → `Session` (many-to-one)

---

### Table: `compare_sessions`

> Model comparison arena sessions. Multiple models generate the same prompt simultaneously for side-by-side evaluation.

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | `VARCHAR(36)` | **PK** | `uuid4()` | Compare session ID |
| `user_id` | `VARCHAR(36)` | **FK** → `users.id`, NULLABLE | — | Owner |
| `original_prompt` | `TEXT` | NULLABLE | — | The shared prompt |
| `models` | `TEXT` | NULLABLE | — | JSON array of model IDs |
| `ratio` | `VARCHAR(10)` | NULLABLE | — | Shared aspect ratio |
| `quality` | `VARCHAR(20)` | NULLABLE | — | Shared quality tier |
| `active_configs` | `TEXT` | NULLABLE | — | JSON config object |
| `created_at` | `VARCHAR(50)` | NULLABLE | — | ISO timestamp |

**Relationships:**
- `user` → `User` (many-to-one)
- `images` → `CompareImage[]` (cascade delete)

---

### Table: `compare_images`

> Individual model outputs within a comparison session. One row per model.

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | `VARCHAR(36)` | **PK** | `uuid4()` | Compare image ID |
| `compare_session_id` | `VARCHAR(36)` | **FK** → `compare_sessions.id`, NULLABLE | — | Parent compare session |
| `user_id` | `VARCHAR(36)` | **FK** → `users.id`, NULLABLE | — | Owner |
| `model_id` | `VARCHAR(50)` | NULLABLE | — | AI model used |
| `original_prompt` | `TEXT` | NULLABLE | — | Original user prompt |
| `tailored_prompt` | `TEXT` | NULLABLE | — | Model-specific enhanced prompt |
| `status` | `VARCHAR(20)` | NULLABLE | — | `pending` / `completed` / `failed` |
| `url` | `TEXT` | NULLABLE | — | CDN URL of result |
| `error_msg` | `TEXT` | NULLABLE | — | Error details |
| `iteration` | `INTEGER` | — | `0` | Regeneration count |
| `created_at` | `VARCHAR(50)` | NULLABLE | — | ISO timestamp |

**Relationships:**
- `compare_session` → `CompareSession` (many-to-one)

---

### Table: `upscaled_images`

> Upscaled versions of generated images.

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | `VARCHAR(36)` | **PK** | `uuid4()` | Upscale job ID |
| `user_id` | `VARCHAR(36)` | **FK** → `users.id`, NULLABLE | — | Owner |
| `original_image_id` | `VARCHAR(36)` | **FK** → `images.id`, NULLABLE | — | Source image |
| `url` | `TEXT` | NULLABLE | — | CDN URL of upscaled image |
| `status` | `VARCHAR(20)` | NULLABLE | — | `pending` / `success` / `failed` |
| `error_msg` | `TEXT` | NULLABLE | — | Error details |
| `created_at` | `DATETIME` | — | `utcnow()` | Creation timestamp |

**Relationships:**
- `user` → `User`
- `original_image` → `Image`

---

## Module 2 — Storyboard

### Table: `storyboards`

> Top-level storyboard project. Contains characters, products, and ordered frames.

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | `VARCHAR(36)` | **PK** | `uuid4()` | Storyboard ID |
| `user_id` | `VARCHAR(36)` | **FK** → `users.id` (CASCADE), NOT NULL | — | Owner |
| `name` | `VARCHAR(255)` | NOT NULL | — | Project name |
| `description` | `TEXT` | NULLABLE | — | Project description |
| `created_at` | `DATETIME` | NOT NULL | `utcnow()` | Created |
| `updated_at` | `DATETIME` | NOT NULL | `utcnow()` | Last updated (auto) |

**Relationships:**
- `user` → `User`
- `characters` → `StoryboardCharacter[]` (cascade delete)
- `products` → `StoryboardProduct[]` (cascade delete)
- `frames` → `StoryboardFrame[]` (cascade delete, ordered by `order_index`)

---

### Table: `storyboard_characters`

> Character definitions with uploaded reference images and AI-extracted identity DNA.

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | `VARCHAR(36)` | **PK** | `uuid4()` | Character ID |
| `storyboard_id` | `VARCHAR(36)` | **FK** → `storyboards.id` (CASCADE), NOT NULL | — | Parent storyboard |
| `name` | `VARCHAR(100)` | NOT NULL | — | Character name |
| `description` | `TEXT` | NULLABLE | — | Freeform description |
| `image_path` | `VARCHAR(500)` | NULLABLE | — | Legacy single reference image path |
| `image_paths` | `JSON` | NULLABLE | `[]` | Array of all reference image paths |
| `character_dna` | `JSON` | NULLABLE | — | AI-extracted identity sheet (facial features, build, distinguishing marks) |
| `best_angle_index` | `INTEGER` | NOT NULL | `0` | Index of clearest frontal face in `image_paths` |
| `dna_version` | `INTEGER` | NOT NULL | `1` | DNA schema version |
| `dna_extracted_at` | `DATETIME` | NULLABLE | — | When DNA was last extracted |
| `dna_extraction_model` | `VARCHAR(100)` | NULLABLE | — | AI model used for extraction |
| `dna_extraction_confidence` | `FLOAT` | NULLABLE | — | 0.0–1.0 confidence score |
| `dna_source` | `VARCHAR(20)` | NOT NULL | `'image'` | Source type: `image` / `text` |
| `created_at` | `DATETIME` | NOT NULL | `utcnow()` | Created |

---

### Table: `storyboard_products`

> Product/prop definitions with reference images and visual identity DNA.

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | `VARCHAR(36)` | **PK** | `uuid4()` | Product ID |
| `storyboard_id` | `VARCHAR(36)` | **FK** → `storyboards.id` (CASCADE), NOT NULL | — | Parent storyboard |
| `name` | `VARCHAR(100)` | NOT NULL | — | Product name |
| `description` | `TEXT` | NULLABLE | — | Freeform description |
| `image_path` | `VARCHAR(500)` | NULLABLE | — | Primary reference image |
| `image_paths` | `JSON` | NULLABLE | `[]` | All reference image paths |
| `product_dna` | `JSON` | NULLABLE | — | AI-extracted visual identity |
| `best_angle_index` | `INTEGER` | NOT NULL | `0` | Best reference image index |
| `dna_version` | `INTEGER` | NOT NULL | `1` | DNA schema version |
| `dna_extracted_at` | `DATETIME` | NULLABLE | — | Extraction timestamp |
| `dna_extraction_model` | `VARCHAR(100)` | NULLABLE | — | Model used |
| `dna_extraction_confidence` | `FLOAT` | NULLABLE | — | 0.0–1.0 confidence |
| `dna_source` | `VARCHAR(20)` | NOT NULL | `'image'` | `image` / `text` |
| `created_at` | `DATETIME` | NOT NULL | `utcnow()` | Created |

---

### Table: `storyboard_frames`

> Individual frames (shots) in a storyboard. Ordered via `order_index`. Each frame can be regenerated, and frames can chain via `parent_frame_id` for iterative refinement.

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | `VARCHAR(36)` | **PK** | `uuid4()` | Frame ID |
| `storyboard_id` | `VARCHAR(36)` | **FK** → `storyboards.id` (CASCADE), NOT NULL | — | Parent storyboard |
| `order_index` | `INTEGER` | NOT NULL | `0` | Position in sequence |
| `scene_prompt` | `TEXT` | NOT NULL | — | User's scene description |
| `expanded_prompt` | `TEXT` | NULLABLE | — | AI-expanded prompt with character DNA injected |
| `image_path` | `VARCHAR(500)` | NULLABLE | — | Path to generated frame image |
| `model_used` | `VARCHAR(50)` | NULLABLE | — | AI model used |
| `status` | `VARCHAR(20)` | — | `'pending'` | `pending` / `generating` / `done` / `failed` |
| `error_msg` | `TEXT` | NULLABLE | — | Error details |
| `parent_frame_id` | `VARCHAR(36)` | **FK** → `storyboard_frames.id` (SET NULL), NULLABLE | — | Previous version of this frame |
| `generation_cost_usd` | `FLOAT` | NULLABLE | `0.0` | Cost tracking |
| `prompt_hash` | `VARCHAR(255)` | NULLABLE | — | Hash for dedup/cache |
| `is_anchor` | `BOOLEAN` | NOT NULL | `false` | Anchor frame for consistency reference |
| `consistency_score` | `INTEGER` | NULLABLE | — | Character consistency rating |
| `last_full_instruction` | `TEXT` | NULLABLE | — | Last complete instruction sent to model |
| `relock_history` | `JSON` | NULLABLE | — | History of consistency re-lock attempts |
| `detected_character_ids` | `JSON` | NULLABLE | `[]` | Character IDs detected in this frame |
| `detected_product_ids` | `JSON` | NULLABLE | `[]` | Product IDs detected in this frame |
| `anchor_frame_outfit_description` | `TEXT` | NULLABLE | — | Outfit description from anchor frame |
| `created_at` | `DATETIME` | NOT NULL | `utcnow()` | Created |

---

### Table: `storyboard_briefs`

> Parsed creative briefs uploaded by the user. The system extracts structured frame/character/product data from raw text.

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | `VARCHAR(36)` | **PK** | `uuid4()` | Brief ID |
| `storyboard_id` | `VARCHAR(36)` | **FK** → `storyboards.id` (CASCADE), NOT NULL | — | Parent storyboard |
| `raw_text` | `TEXT` | NOT NULL | — | User-uploaded brief text |
| `parsed_json` | `JSON` | NULLABLE | — | AI-parsed structured output |
| `parse_status` | `VARCHAR(20)` | — | `'pending'` | `pending` / `completed` / `failed` |
| `created_at` | `DATETIME` | NOT NULL | `utcnow()` | Created |

---

### Table: `character_sheets`

> Multi-angle character reference sheets generated from DNA. Used for ensuring cross-frame consistency.

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | `VARCHAR(36)` | **PK** | `uuid4()` | Sheet ID |
| `character_id` | `VARCHAR(36)` | **FK** → `storyboard_characters.id` (CASCADE), NOT NULL | — | Character |
| `storyboard_id` | `VARCHAR(36)` | **FK** → `storyboards.id` (CASCADE), NOT NULL | — | Storyboard |
| `front_body_url` | `VARCHAR(500)` | NULLABLE | — | Full-body front view URL |
| `side_profile_url` | `VARCHAR(500)` | NULLABLE | — | Side profile view URL |
| `face_closeup_url` | `VARCHAR(500)` | NULLABLE | — | Face close-up view URL |
| `proportion_dna` | `JSON` | NULLABLE | — | Body proportion data |
| `is_approved` | `BOOLEAN` | NOT NULL | `false` | User-approved? |
| `generation_count` | `INTEGER` | NOT NULL | `0` | Times regenerated |
| `created_at` | `DATETIME` | NOT NULL | `utcnow()` | Created |

---

### Table: `frame_consistency_reports`

> Automated consistency scoring between frames. Compares character appearance in a frame against the anchor frame.

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | `VARCHAR(36)` | **PK** | `uuid4()` | Report ID |
| `frame_id` | `VARCHAR(36)` | **FK** → `storyboard_frames.id` (CASCADE), NOT NULL | — | Frame being scored |
| `storyboard_id` | `VARCHAR(36)` | **FK** → `storyboards.id` (CASCADE), NOT NULL | — | Parent storyboard |
| `character_scores` | `JSON` | NULLABLE | — | Per-character consistency scores |
| `anchor_frame_id` | `VARCHAR(36)` | NULLABLE | — | Reference anchor frame used |
| `scored_at` | `DATETIME` | NOT NULL | `utcnow()` | When scored |

---

## Foreign Key Map

```mermaid
graph LR
    subgraph Core
        U["users"] --> S["sessions"]
        U --> CS["compare_sessions"]
        U --> UI["upscaled_images"]
        S --> I["images"]
        I --> UI
        CS --> CI["compare_images"]
        U --> CI
        S -->|parent_session_id| S
    end

    subgraph Storyboard
        U --> SB["storyboards"]
        SB --> SC["storyboard_characters"]
        SB --> SP["storyboard_products"]
        SB --> SF["storyboard_frames"]
        SB --> SBR["storyboard_briefs"]
        SC --> CSH["character_sheets"]
        SF --> FCR["frame_consistency_reports"]
        SF -->|parent_frame_id| SF
    end
```

---

## Table Summary

| # | Table | Module | Rows (typical) | Purpose |
|---|---|---|---|---|
| 1 | `users` | Core | Hundreds | Registered accounts |
| 2 | `pending_users` | Core | Tens | Unverified signups (temporary) |
| 3 | `sessions` | Core | Thousands | Generation/edit jobs |
| 4 | `images` | Core | Thousands | Individual generated images |
| 5 | `compare_sessions` | Core | Hundreds | Model comparison jobs |
| 6 | `compare_images` | Core | Hundreds | Comparison results per model |
| 7 | `upscaled_images` | Core | Hundreds | High-res upscale results |
| 8 | `storyboards` | Storyboard | Tens | Storyboard projects |
| 9 | `storyboard_characters` | Storyboard | Tens | Character definitions + DNA |
| 10 | `storyboard_products` | Storyboard | Tens | Product/prop definitions |
| 11 | `storyboard_frames` | Storyboard | Hundreds | Individual storyboard shots |
| 12 | `storyboard_briefs` | Storyboard | Tens | Parsed creative briefs |
| 13 | `character_sheets` | Storyboard | Tens | Multi-angle reference sheets |
| 14 | `frame_consistency_reports` | Storyboard | Hundreds | Cross-frame consistency scores |

---

## Status Value Reference

| Table | Column | Values |
|---|---|---|
| `images` | `status` | `pending` → `completed` · `failed` |
| `compare_images` | `status` | `pending` → `completed` · `failed` |
| `upscaled_images` | `status` | `pending` → `success` · `failed` |
| `storyboard_frames` | `status` | `pending` → `generating` → `done` · `failed` |
| `storyboard_briefs` | `parse_status` | `pending` → `completed` · `failed` |
| `users` | `payment_status` | `pending` → `completed` · `failed` |

---

## JSON Column Schemas

### `sessions.models` (TEXT, JSON-encoded)
```json
["Nanobanana 2", "ChatGPT"]
```

### `sessions.active_configs` (TEXT, JSON-encoded)
```json
{
  "chatgpt_model": "gpt-image-2"
}
```

### `storyboard_characters.character_dna` (JSON)
```json
{
  "face": "oval face, high cheekbones, defined jawline",
  "eyes": "dark brown, almond-shaped, thick eyebrows",
  "hair": "black, medium length, slightly wavy",
  "skin": "medium brown, warm undertones",
  "build": "average height, athletic build",
  "distinguishing": "small scar on left eyebrow, dimple on right cheek"
}
```

### `storyboard_frames.detected_character_ids` (JSON)
```json
["char-uuid-1", "char-uuid-2"]
```

### `frame_consistency_reports.character_scores` (JSON)
```json
{
  "char-uuid-1": { "face": 85, "outfit": 72, "overall": 78 },
  "char-uuid-2": { "face": 91, "outfit": 90, "overall": 90 }
}
```

---

## Database Config

```python
# Connection string from .env
DATABASE_URL = "postgresql://user:pass@host:5432/genfy"

# Engine settings (PostgreSQL)
pool_size = 5
max_overflow = 10
pool_pre_ping = True     # health check before each use

# SQLite fallback (local dev only)
# DATABASE_URL = "sqlite:///./genfy.db"
```
