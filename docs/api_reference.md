# Genfy API Reference Booklet

> **Base URL:** `https://genfyy.in` (production) or `http://localhost:8005` (local)
> **Auth:** JWT Bearer token via `Authorization: Bearer <token>` header or `access_token` cookie
> **Content-Type:** `application/json` (unless noted otherwise)

---

## Table of Contents

1. [Health Check](#1-health-check)
2. [Authentication & Users](#2-authentication--users)
3. [Image Generation (Core)](#3-image-generation-core)
4. [Sessions & Image Editing](#4-sessions--image-editing)
5. [History](#5-history)
6. [Upscaling](#6-upscaling)
7. [Compare (A/B Testing)](#7-compare-ab-testing)
8. [Prompt Helpers](#8-prompt-helpers)
9. [Styles & Configuration](#9-styles--configuration)
10. [Edit Tool Translators](#10-edit-tool-translators)
11. [Download Proxy](#11-download-proxy)
12. [Admin](#12-admin)
13. [Storyboard](#13-storyboard)
14. [Nanobanana Config](#14-nanobanana-config)

---

## 1. Health Check

### `GET /health`
### `GET /api/health`

Docker/load balancer health probe. No auth required.

```json
// Response 200
{ "status": "ok" }
```

---

## 2. Authentication & Users

All user routes are prefixed with `/api/users`.

---

### `POST /api/users/signup`

Create a new account. Sends verification email.

**Auth:** None

```json
// Request
{
  "email": "user@example.com",     // Required (EmailStr)
  "password": "securepass123",      // Required
  "name": "John Doe"               // Optional
}
```

```json
// Response 200
{
  "message": "Verification email sent",
  "next_action": "verify_email"
}
```

---

### `POST /api/users/login`

Authenticate and receive JWT token (set as HttpOnly cookie).

**Auth:** None

```json
// Request
{
  "email": "user@example.com",     // Required (EmailStr)
  "password": "securepass123"       // Required
}
```

```json
// Response 200
{
  "message": "Login successful",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "plan_type": "trial",
    "images_remaining": 50,
    "upscales_remaining": 10,
    "email_verified": true,
    "is_admin": false
  },
  "next_action": "dashboard",
  "token": "eyJhbGciOiJI..."
}
```

---

### `POST /api/users/google-signin`

Sign in with Google OAuth. Creates account if first time.

**Auth:** None

```json
// Request
{
  "credential": "google-jwt-or-access-token",   // Required
  "name": "John Doe",                            // Optional
  "is_access_token": false                        // Optional (default: false)
}
```

```json
// Response 200
// Same structure as /login response
```

---

### `POST /api/users/logout`

Clear auth cookie.

**Auth:** Required

```json
// Response 200
{ "message": "Logged out" }
```

---

### `GET /api/users/me`

Get current user profile.

**Auth:** Required

```json
// Response 200
{
  "id": "uuid",
  "email": "user@example.com",
  "name": "John Doe",
  "plan_type": "trial",
  "images_remaining": 45,
  "images_limit_per_week": 50,
  "upscales_remaining": 8,
  "upscales_limit_per_day": 10,
  "email_verified": true,
  "is_admin": false,
  "trial_ends_at": "2026-08-05T00:00:00Z"
}
```

---

### `POST /api/users/verify-email`

**Auth:** None

```json
// Request
{ "token": "verification-token-from-email" }
```

---

### `POST /api/users/resend-verification`

**Auth:** None

```json
// Request
{ "email": "user@example.com" }
```

---

### `POST /api/users/start-trial`

Activate free trial for current user.

**Auth:** Required

---

### `POST /api/users/forgot-password`

Send password reset email.

**Auth:** None

```json
// Request
{ "email": "user@example.com" }
```

---

### `POST /api/users/reset-password`

**Auth:** None

```json
// Request
{
  "token": "reset-token-from-email",
  "new_password": "newSecurePass123"
}
```

---

### `POST /api/users/update-payment-info`

**Auth:** Required

```json
// Request
{
  "email": "user@example.com",
  "plan_type": "pro"               // "trial" | "basic" | "pro" | "enterprise"
}
```

---

### `POST /api/users/update-profile`

**Auth:** Required

```json
// Request
{
  "name": "New Name",             // Optional
  "email": "new@example.com"      // Optional (EmailStr)
}
```

---

### `POST /api/users/top-up`

Add extra image credits.

**Auth:** Required

```json
// Request
{ "amount": 100 }
```

---

### `DELETE /api/users/me`

Delete current user account permanently.

**Auth:** Required

---

### `GET /auth/github`

Redirect to GitHub OAuth flow.

**Auth:** None

---

### `GET /auth/github/callback`

GitHub OAuth callback handler. Sets JWT cookie and redirects.

**Auth:** None

---

## 3. Image Generation (Core)

### `POST /api/generate`

> **This is the main image generation endpoint.**

Generate images from a text prompt using one or more AI models simultaneously.

**Auth:** Required

```json
// Request
{
  "prompt": "A majestic lion in golden hour light",      // Required
  "ratio": "1:1",                                         // Required — see /api/styles for options
  "quality": "Standard",                                  // Required — "Standard" | "High" | "Ultra"
  "categories": {                                         // Required — style category selections
    "style": "cinematic",
    "lighting": "golden",
    "medium": "photography",
    "composition": "centered",
    "camera": "medium-shot",
    "lens": "85mm",
    "mood": "epic",
    "color": "warm"
  },
  "models": ["ChatGPT", "Flux.1", "Kling"],              // Required — one or more model IDs
  "chatgpt_model": "gpt-image-2",                        // Optional (default: "gpt-image-2")
  "image_base64": "data:image/png;base64,...",            // Optional — reference image for editing
  "session_id": "uuid",                                   // Optional — continue existing session
  "prompt_history": ["original prompt", "edit 1"],        // Optional — past prompts for context
  "vision_description": "A photo of a lion..."            // Optional — pre-analyzed reference description
}
```

```json
// Response 200
{
  "session_id": "uuid",
  "images": [
    {
      "image_id": "uuid",
      "model_id": "ChatGPT",
      "status": "completed",          // "completed" | "failed" | "pending"
      "url": "https://xxx.supabase.co/storage/v1/object/public/genfy-images/generated/abc.png",
      "enhanced_prompt": "The full prompt that was sent to the model"
    },
    {
      "image_id": "uuid",
      "model_id": "Flux.1",
      "status": "completed",
      "url": "https://xxx.supabase.co/...",
      "enhanced_prompt": "..."
    }
  ],
  "errors": []
}
```

> [!IMPORTANT]
> **Model IDs:** `"Nanobanana 2"`, `"Nanobanana Pro"`, `"ChatGPT"`, `"Kling"`, `"Flux.1"`
>
> **ChatGPT sub-models:** `"gpt-image-2"`, `"gpt-image-1.5"`, `"chatgpt-image-latest"`, `"gpt-image-1"`, `"gpt-image-1-mini"`

---

## 4. Sessions & Image Editing

### `POST /api/sessions`

Create a new generation session (with multi-model support).

**Auth:** Required

```json
// Request
{
  "prompt": "A futuristic cityscape",                    // Required
  "model_ids": ["ChatGPT", "Flux.1"],                   // Required — list of model IDs
  "active_configs": {                                     // Optional — style config per model
    "ChatGPT": {"style": "cinematic"},
    "Flux.1": {"style": "anime"}
  },
  "ratio": "16:9",                                       // Optional (default: "1:1")
  "quality": "High",                                     // Optional (default: "Standard")
  "image_base64": "data:image/png;base64,...",           // Optional — reference image(s)
  "vision_description": "...",                            // Optional
  "edit_instruction": "make it rain outside",            // Optional — for edit flows
  "prompt_history": ["original prompt"],                 // Optional
  "parent_session_id": "uuid",                           // Optional — link to parent
  "reference_image_id": "uuid"                           // Optional — which image was edited
}
```

```json
// Response 200
{
  "session_id": "uuid",
  "images": [
    {
      "image_id": "uuid",
      "model_id": "ChatGPT",
      "status": "completed",
      "url": "https://..."
    }
  ],
  "errors": []
}
```

---

### `GET /api/sessions/{session_id}`

Get session details with all images and edit lineage.

**Auth:** Required

```json
// Response 200
{
  "session_id": "uuid",
  "prompt": "A futuristic cityscape",
  "created_at": "2026-07-29T06:00:00Z",
  "images": [
    {
      "image_id": "uuid",
      "model_id": "ChatGPT",
      "url": "https://...",
      "status": "completed",
      "enhanced_prompt": "..."
    }
  ],
  "children": [
    {
      "session_id": "child-uuid",
      "prompt": "make it rain",
      "reference_image_id": "parent-image-uuid",
      "images": [...]
    }
  ]
}
```

---

### `POST /api/sessions/{session_id}/images/{image_id}/edit`

Edit an existing image within a session.

**Auth:** Required

```json
// Request
{
  "edit_prompt": "Add rain and lightning to the scene",  // Required — the edit instruction
  "full_prompt_override": null,                          // Optional — bypass prompt synthesis
  "reference_image_id": null,                            // Optional
  "config_overrides": {"lighting": "dramatic"},          // Optional — override style selections
  "image_base64": null,                                  // Optional — additional reference
  "vision_description": null,                            // Optional
  "ratio": "1:1",                                        // Optional (default: "1:1")
  "quality": "standard",                                 // Optional (default: "standard")
  "model_ids": null                                      // Optional — override models to use
}
```

```json
// Response 200
{
  "child_session_id": "uuid",
  "image": {
    "image_id": "uuid",
    "model_id": "ChatGPT",
    "status": "pending",         // Initially pending, poll session to get result
    "url": null
  }
}
```

---

## 5. History

All history routes are prefixed with `/api/sessions` (same router as sessions above).

### `GET /api/sessions`

Get paginated generation history.

**Auth:** Required

**Query params:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | int | 1 | Page number |
| `per_page` | int | 20 | Items per page (max 100) |
| `search` | string | null | Search in prompts |

```json
// Response 200
{
  "sessions": [...],
  "total": 142,
  "page": 1,
  "per_page": 20,
  "total_pages": 8
}
```

---

### `GET /api/sessions/{session_id}` (History detail)

Returns the same structure as `GET /api/sessions/{session_id}` above.

---

### `DELETE /api/sessions/{session_id}`

Delete a session and all its images.

**Auth:** Required

```json
// Response 200
{ "message": "Session deleted" }
```

---

## 6. Upscaling

### `POST /api/upscale`

Upscale an existing image (4× tile-based upscaling).

**Auth:** Required

```json
// Request
{ "image_id": "uuid" }        // Required — ID of image to upscale
```

```json
// Response 200
{
  "upscaled_url": "https://xxx.supabase.co/storage/v1/object/public/genfy-images/generated/upscaled_abc.png",
  "original_image_id": "uuid"
}
```

---

### `GET /api/upscales`

Get all upscaled images for the current user.

**Auth:** Required

```json
// Response 200
[
  {
    "id": "uuid",
    "original_image_id": "uuid",
    "url": "https://...",
    "created_at": "2026-07-29T06:00:00Z"
  }
]
```

---

### `GET /api/quota`

Get remaining quotas for current user.

**Auth:** Required

```json
// Response 200
{
  "images_remaining": 45,
  "images_limit_per_week": 50,
  "upscales_remaining": 8,
  "upscales_limit_per_day": 10,
  "plan_type": "trial",
  "trial_active": true,
  "trial_ends_at": "2026-08-05T00:00:00Z"
}
```

---

## 7. Compare (A/B Testing)

### `POST /api/compare/start`

Generate the same prompt across multiple models for side-by-side comparison.

**Auth:** Required

```json
// Request
{
  "prompt": "A photorealistic portrait",                  // Required
  "models": ["ChatGPT", "Flux.1", "Kling"],              // Required — 2+ models
  "ratio": "1:1",                                         // Optional (default: "1:1")
  "quality": "Standard",                                  // Optional (default: "Standard")
  "categories": {"style": "cinematic"},                   // Optional
  "image_base64": null,                                   // Optional — reference image
  "chatgpt_model": "gpt-image-2",                        // Optional (default: "gpt-image-2")
  "session_id": null,                                     // Optional
  "vision_description": null                              // Optional
}
```

```json
// Response 200
{
  "compare_session_id": "uuid",
  "images": [
    { "image_id": "uuid", "model_id": "ChatGPT",  "status": "completed", "url": "..." },
    { "image_id": "uuid", "model_id": "Flux.1",   "status": "completed", "url": "..." },
    { "image_id": "uuid", "model_id": "Kling",    "status": "failed",    "url": null }
  ],
  "errors": ["Kling: rate limited"]
}
```

---

### `GET /api/compare/{compare_session_id}`

Get compare session results.

**Auth:** Required

---

### `POST /api/compare/{compare_session_id}/feedback`

Select the winning image from a comparison.

**Auth:** Required

```json
// Request
{ "selected_image_id": "uuid" }
```

---

## 8. Prompt Helpers

### `POST /api/suggest-from-prompt`

AI-powered: analyze a text prompt and suggest a complete 8-category style configuration.

**Auth:** None

```json
// Request
{ "prompt": "A cyberpunk city at night with neon signs" }
```

```json
// Response 200
{
  "suggestions": {
    "style": "cyberpunk",
    "medium": "digital",
    "lighting": "neon",
    "composition": "rule-thirds",
    "camera": "wide-shot",
    "lens": "24mm",
    "mood": "futuristic",
    "color": "neon-cyber"
  }
}
```

---

### `POST /api/recommend-styles`

Get style recommendations based on current selections.

**Auth:** None

```json
// Request
{
  "selections": {"style": "cinematic", "lighting": "dramatic"},   // Required — current selections
  "prompt": "A warrior in battle"                                   // Optional
}
```

---

### `POST /api/refine-prompt`

AI rewrite: refine the user's prompt to incorporate selected style settings.

**Auth:** Optional

```json
// Request
{
  "prompt": "a cat sitting on a bench",                  // Required
  "ratio": "1:1",                                        // Optional (default: "1:1")
  "quality": "Standard",                                 // Optional (default: "Standard")
  "selections": {"style": "cinematic", "mood": "serene"} // Optional
}
```

```json
// Response 200
{
  "refined_prompt": "A serene, cinematic shot of a cat sitting peacefully on a weathered park bench..."
}
```

---

### `POST /api/analyze-image`

Analyze a reference image using Vision AI to describe its content and style.

**Auth:** Required

```json
// Request
{
  "image_base64": "data:image/png;base64,...",           // Required
  "categories_context": "style, lighting, mood"          // Optional — categories to focus on
}
```

```json
// Response 200
{
  "description": "A portrait of a young woman in golden hour light...",
  "suggested_categories": {
    "style": "cinematic",
    "lighting": "golden",
    "mood": "serene"
  }
}
```

---

## 9. Styles & Configuration

### `GET /api/styles`

**The primary configuration endpoint for integration.** Returns all available style categories, ratios, quality levels, AI models, and edit tools.

**Auth:** None

```json
// Response 200
{
  "categories": {
    "style": [
      {
        "id": "cinematic",
        "label": "Cinematic",
        "desc": "Movie-like color grading",
        "prompt": "cinematic style, film color grading...",
        "gradient": ["#1A0A0A", "#8B6914", "#FFD700"],
        "thumbnail": "/previews/Cinematic.jpg"
      }
      // ... more styles
    ],
    "medium": [...],       // 6 options: digital, photography, charcoal, ink, acrylic, collage
    "lighting": [...],     // 9 options: natural, golden, blue-hour, studio, dramatic, neon, volumetric, moonlight, candlelight
    "composition": [...],  // 4 options: centered, rule-thirds, flat-lay, panoramic
    "camera": [...],       // 8 options: worms-eye, dutch, birds-eye, extreme-cu, wide-shot, medium-shot, close-up, low-angle
    "lens": [...],         // 6 options: 24mm, 50mm, 85mm, 135mm, macro, fisheye
    "mood": [...],         // 8 options: serene, dramatic-mood, ethereal, mysterious, melancholic, futuristic, romantic, epic
    "color": [...],        // 8 options: vibrant, muted, pastel, monochrome, earth, neon-cyber, warm, cool
    "camera_body": [...]   // 7 options: hasselblad, phase-one, canon-r5, sony-a7rv, leica-m11, fuji-gfx, nikon-z9
  },
  "ratios": [
    { "id": "1:1",  "label": "Square",    "prompt": "square 1:1 aspect ratio" },
    { "id": "16:9", "label": "Landscape",  "prompt": "landscape 16:9 widescreen aspect ratio" },
    { "id": "9:16", "label": "Portrait",   "prompt": "portrait 9:16 vertical aspect ratio" },
    { "id": "4:5",  "label": "Social",     "prompt": "social media 4:5 aspect ratio" },
    { "id": "3:2",  "label": "Photo Print","prompt": "photo print 3:2 aspect ratio" },
    { "id": "2:3",  "label": "Poster",     "prompt": "poster 2:3 vertical aspect ratio" },
    { "id": "4:3",  "label": "Standard TV","prompt": "standard 4:3 aspect ratio" },
    { "id": "3:4",  "label": "Vertical",   "prompt": "vertical 3:4 aspect ratio" },
    { "id": "5:4",  "label": "Classic",    "prompt": "classic 5:4 aspect ratio" },
    { "id": "4:1",  "label": "Wide Banner","prompt": "wide banner 4:1 aspect ratio" },
    { "id": "1:4",  "label": "Tall Banner","prompt": "tall banner 1:4 aspect ratio" },
    { "id": "8:1",  "label": "Panoramic",  "prompt": "panoramic 8:1 aspect ratio" },
    { "id": "1:8",  "label": "Ultra Tall", "prompt": "ultra-tall 1:8 aspect ratio" },
    { "id": "21:9", "label": "Cinematic",  "prompt": "cinematic ultrawide 21:9 aspect ratio" }
  ],
  "qualities": [
    { "id": "Standard", "label": "Standard", "resolution": "1K", "desc": "Fast · 1024px" },
    { "id": "High",     "label": "High",     "resolution": "2K", "desc": "Balanced · 2048px" },
    { "id": "Ultra",    "label": "Ultra",    "resolution": "4K", "desc": "Max detail · 4096px" }
  ],
  "models": [
    { "id": "Nanobanana 2",   "integrated": true,  "coming_soon": false },
    { "id": "Nanobanana Pro", "integrated": true,  "coming_soon": false },
    { "id": "ChatGPT",        "integrated": true,  "coming_soon": false,
      "sub_models": [
        { "id": "gpt-image-2",         "label": "GPT Image 2",          "desc": "State-of-the-art" },
        { "id": "gpt-image-1.5",       "label": "GPT Image 1.5",        "desc": "Previous flagship" },
        { "id": "chatgpt-image-latest", "label": "ChatGPT Image Latest", "desc": "Latest default" },
        { "id": "gpt-image-1",         "label": "GPT Image 1",          "desc": "Previous generation" },
        { "id": "gpt-image-1-mini",    "label": "GPT Image 1 Mini",     "desc": "Cost-efficient" }
      ]
    },
    { "id": "Kling",            "integrated": true,  "coming_soon": false },
    { "id": "Flux.1",           "integrated": true,  "coming_soon": false },
    { "id": "Midjourney",       "integrated": false, "coming_soon": true },
    { "id": "Stable Diffusion", "integrated": false, "coming_soon": true },
    { "id": "Grok-2",           "integrated": false, "coming_soon": true }
  ],
  "edit_tools": [
    { "id": "relight",       "label": "Relight",       "icon": "sun",    "endpoint": "/api/tools/relight/translate" },
    { "id": "skin_enhancer", "label": "Skin Enhancer",  "icon": "crown",  "endpoint": "/api/tools/skin-enhancer/translate" },
    { "id": "camera_angle",  "label": "Camera Angle",   "icon": "camera", "endpoint": "/api/tools/camera/translate" }
  ],
  "relight_presets": [
    { "id": "original", "label": "Original Image Light (Match)", "hex": "#e2e8f0" },
    { "id": "white",    "label": "Neutral Studio",               "hex": "#ffffff" },
    { "id": "golden",   "label": "Golden Hour",                  "hex": "#ffaa33" },
    { "id": "sunset",   "label": "Warm Sunset",                  "hex": "#ff5522" },
    { "id": "cyan",     "label": "Cool Cinematic",               "hex": "#22ccff" },
    { "id": "neon",     "label": "Cyberpunk Neon",               "hex": "#ff22aa" }
  ]
}
```

---

## 10. Edit Tool Translators

These endpoints convert UI controls (sliders, selectors) into text instructions for the edit endpoint. **No auth required.**

---

### `POST /api/tools/relight/translate`

Convert lighting angle/color controls to an edit instruction.

```json
// Request
{
  "rotate": 45.0,           // -180 to 180 (horizontal orbit)
  "elevation": 30.0,        // -90 to 90 (vertical orbit)
  "color_hex": "#ffaa33"    // Light color from presets
}
```

```json
// Response 200
{
  "instruction": "Add a warm golden-amber light source to the scene, from the upper-right...",
  "direction": "from the upper-right",
  "color_id": "golden"
}
```

> **Integration flow:** Call this → get `instruction` → pass it as `edit_prompt` to `POST /api/sessions/{id}/images/{img}/edit`

---

### `POST /api/tools/skin-enhancer/translate`

Convert skin enhancer UI controls to an edit instruction.

```json
// Request
{
  "version": "Flexible",           // "Faithful" | "Creative" | "Flexible"
  "optimize_for": "Enhance skin",  // "Enhance skin" | "Enhance everything" | "Improve light" | "Transform to real" | "No makeup"
  "sharpen": 40,                   // 0-100
  "smart_grain": 13                // 0-100
}
```

```json
// Response 200
{
  "instruction": "Enhance the skin and facial quality in this image: improve skin in a balanced way...",
  "version": "Flexible",
  "optimize_for": "Enhance skin"
}
```

---

### `POST /api/tools/camera/translate`

Convert camera angle UI controls to an edit instruction.

```json
// Request
{
  "rotate": -45.0,      // -180 to 180 (horizontal orbit)
  "vertical": 30.0,     // -90 to 90 (vertical elevation)
  "zoom": 5.0           // 1-10 (1=extreme close, 10=wide)
}
```

```json
// Response 200
{
  "instruction": "re-render the exact same scene from a high-angle shot, viewed from the left side, medium shot...",
  "parts": ["high-angle shot", "viewed from the left side", "medium shot"]
}
```

---

## 11. Download Proxy

### `GET /api/download`

Download/convert an image to any format via proxy (solves CORS issues).

**Auth:** None

**Query params:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `url` | string | Required | Image URL to download |
| `format` | string | `"png"` | Output format: `"png"`, `"jpg"`, `"jpeg"`, `"tiff"`, `"webp"` |

```
GET /api/download?url=https://xxx.supabase.co/storage/v1/object/public/genfy-images/generated/abc.png&format=tiff
```

Returns binary image with appropriate `Content-Type` and `Content-Disposition` headers.

---

## 12. Admin

All admin endpoints require `is_admin=true` on the user. Returns 403 otherwise.

### `GET /api/admin/users`

List all users with stats.

**Auth:** Admin required

---

### `PUT /api/admin/users/{user_id}/limits`

Update a user's generation/upscale limits.

```json
// Request
{
  "images_limit_per_week": 100,    // Optional
  "upscales_limit_per_day": 20     // Optional
}
```

---

### `PUT /api/admin/users/{user_id}/access`

Enable/disable a user account.

```json
// Request
{ "is_active": true }
```

---

### `PUT /api/admin/users/{user_id}/no-delete`

Toggle auto-deletion protection for a user's images.

```json
// Request
{ "no_auto_delete": true }
```

---

### `GET /api/admin/users/{user_id}/images`

Get all images for a specific user (admin view).

**Auth:** Admin required

---

### `GET /api/admin/generations`

Get all recent generations across all users.

**Auth:** Admin required

---

### `GET /api/admin/stats`

Platform-wide statistics.

**Auth:** Admin required

---

## 13. Storyboard

All storyboard routes are prefixed with `/api/storyboard`.

### Core CRUD

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/storyboard/create` | Create new storyboard |
| `GET` | `/api/storyboard/list` | List all storyboards for user |
| `GET` | `/api/storyboard/templates` | Get storyboard templates |
| `GET` | `/api/storyboard/{sb_id}` | Get storyboard details |
| `DELETE` | `/api/storyboard/{sb_id}` | Delete a storyboard |

### Brief & Scaffolding

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/storyboard/{sb_id}/upload-brief-pdf` | Upload brief PDF (multipart) |
| `POST` | `/api/storyboard/{sb_id}/ingest-brief` | AI-parse uploaded brief |
| `POST` | `/api/storyboard/ai-scaffold` | AI-generate storyboard structure from description |
| `POST` | `/api/storyboard/template-scaffold` | Create storyboard from template |

### Characters

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/storyboard/{sb_id}/character/create` | Add character with reference images |
| `GET` | `/api/storyboard/{sb_id}/characters` | List characters |
| `DELETE` | `/api/storyboard/{sb_id}/character/{char_id}` | Delete character |
| `POST` | `/api/storyboard/{sb_id}/character/{char_id}/analyze` | AI-analyze character from images |
| `POST` | `/api/storyboard/{sb_id}/character/{char_id}/generate-sheet` | Generate character reference sheet |
| `POST` | `/api/storyboard/{sb_id}/character/{char_id}/approve-sheet` | Approve generated sheet |
| `POST` | `/api/storyboard/{sb_id}/character/generate-from-description` | AI-generate character from text |

### Products

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/storyboard/{sb_id}/product/create` | Add product with reference images |
| `GET` | `/api/storyboard/{sb_id}/products` | List products |
| `DELETE` | `/api/storyboard/{sb_id}/product/{prod_id}` | Delete product |
| `POST` | `/api/storyboard/{sb_id}/product/{prod_id}/analyze` | AI-analyze product from images |
| `POST` | `/api/storyboard/{sb_id}/product/generate-from-description` | AI-generate product from text |

### Frames

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/storyboard/{sb_id}/frame/add` | Add a new frame |
| `GET` | `/api/storyboard/{sb_id}/frames` | List all frames |
| `DELETE` | `/api/storyboard/{sb_id}/frame/{frame_id}` | Delete a frame |
| `POST` | `/api/storyboard/{sb_id}/frame/{frame_id}/generate` | Generate frame image |
| `POST` | `/api/storyboard/{sb_id}/frame/{frame_id}/iterate` | Re-generate with modifications |
| `POST` | `/api/storyboard/{sb_id}/frame/{frame_id}/score-consistency` | Score visual consistency |
| `POST` | `/api/storyboard/{sb_id}/frame/{frame_id}/selective-relock` | Lock specific elements for re-gen |
| `PATCH` | `/api/storyboard/{sb_id}/frame/{frame_id}/set-anchor` | Set frame as visual anchor |
| `POST` | `/api/storyboard/{sb_id}/frame/{frame_id}/inspire-prompt` | AI-suggest prompt for this frame |

---

## 14. Nanobanana Config

### `GET /api/nanobanana/config`

Get current Nanobanana model configuration.

**Auth:** Admin required

---

### `POST /api/nanobanana/config`

Update Nanobanana model configuration.

**Auth:** Admin required

```json
// Request
{
  "models": {
    "nanobanana_2": {
      "flux_model": "flux-1.1-pro",
      "flux_endpoint": "https://api.bfl.ml/v1/flux-1.1-pro"
    }
  }
}
```

---

### `POST /api/nanobanana/promote`

Promote a model config to production.

**Auth:** Admin required

---

## Quick Integration Cheatsheet

### Generate an image programmatically:

```python
import httpx

# 1. Login
resp = httpx.post("https://genfyy.in/api/users/login", json={
    "email": "user@example.com",
    "password": "pass"
})
token = resp.json()["token"]
headers = {"Authorization": f"Bearer {token}"}

# 2. Get styles (optional — cache this)
styles = httpx.get("https://genfyy.in/api/styles").json()

# 3. Generate
result = httpx.post("https://genfyy.in/api/generate", json={
    "prompt": "A majestic eagle soaring over mountains",
    "ratio": "16:9",
    "quality": "Standard",
    "categories": {"style": "cinematic", "lighting": "golden"},
    "models": ["ChatGPT"]
}, headers=headers, timeout=120)

images = result.json()["images"]
for img in images:
    print(f"{img['model_id']}: {img['url']}")
```

### Edit an image:

```python
session_id = result.json()["session_id"]
image_id = images[0]["image_id"]

# Direct edit
edit = httpx.post(f"https://genfyy.in/api/sessions/{session_id}/images/{image_id}/edit", json={
    "edit_prompt": "Add dramatic storm clouds"
}, headers=headers, timeout=120)

# Or use a tool translator first
relight = httpx.post("https://genfyy.in/api/tools/relight/translate", json={
    "rotate": 45, "elevation": 30, "color_hex": "#ffaa33"
})
instruction = relight.json()["instruction"]

edit = httpx.post(f"https://genfyy.in/api/sessions/{session_id}/images/{image_id}/edit", json={
    "edit_prompt": instruction
}, headers=headers, timeout=120)
```

---

> [!NOTE]
> **Image URLs** are now served from Supabase CDN: `https://zgopqmkjsqcryoljzikh.supabase.co/storage/v1/object/public/genfy-images/generated/*.png`
>
> Legacy local paths (`/exports/generated/*.png`) are still supported for backward compatibility but will be phased out.
