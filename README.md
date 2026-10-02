<div align="center">

# GENFY
### Enterprise Generative Visual Studio and Consistency Storyboard Suite

[![Next.js](https://img.shields.io/badge/Next.js-14_App_Router-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110+-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4+-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Supabase-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker&logoColor=white)](https://www.docker.com/)
[![License](https://img.shields.io/badge/License-Proprietary-gray?style=flat-square)](#license)

<br/>

Genfy is an enterprise visual synthesis and production platform designed for commercial creators, filmmakers, and digital studios. It solves the most demanding production bottlenecks in generative media: persistent character and product identity across frames, real-time spatial camera choreography, multimodal asset retrieval (Visual RAG), and physically accurate optical skin rendering.

[Key Features](#key-features) • [System Architecture](#system-architecture) • [Core Engines](#deep-dive-into-core-engines) • [Quick Start](#quick-start) • [API Guide](#api-quick-tour)

---

</div>

## Visual Showcase

| Cinematic Scene Composition | High-Fidelity Character Consistency | Commercial Product Render |
| :---: | :---: | :---: |
| ![Cinematic Showcase](PIPELINE%20GENERATIONS/CINEMATIC.png) | ![Portrait Showcase](PIPELINE%20GENERATIONS/PORTRAIT.png) | ![Commercial Showcase](PIPELINE%20GENERATIONS/COMMERCIAL.png) |
| *Multi-layer depth with volumetric lighting* | *Identity preserved across diverse angles* | *Physics-accurate textures and reflections* |

| Fine Art Textures | Macro and Environment Dynamics | Ultra-Resolution Upscale |
| :---: | :---: | :---: |
| ![Fine Art Showcase](PIPELINE%20GENERATIONS/FINEART.png) | ![Nature Showcase](PIPELINE%20GENERATIONS/NATURE.png) | ![Authentic Showcase](PIPELINE%20GENERATIONS/AUTHENTIC.png) |
| *Dynamic brushwork and impasto fidelity* | *Sub-millimeter detail reproduction* | *4K canvas expansion with zero degradation* |

---

## Key Features

- **Spatial Camera Choreographer:** Real-time 3D spherical pitch-yaw translation, vertical elevation anchoring (-90 degrees to +90 degrees), and optical focal length emulation (24mm wide angle up to 135mm telephoto compression).
- **Frame-to-Frame Continuity Engine:** Maintain persistent character facial geometry, hairstyles, wardrobe, and physical product branding across multi-scene narrative storyboards.
- **Multimodal Visual and Asset RAG:** Automated vector retrieval (pgvector) that injects verified character identity centroids, 3D product CAD references, and brand style recipes into the prompt synthesis pipeline.
- **Physical Subsurface Skin Engine:** Eliminates the synthetic plastic look with physically simulated subsurface scattering (SSS), micro-dermal pore textures, natural vellus hair, and true optical sensor noise.
- **Dynamic Photometric Relighting:** Spherical light vector placement with adjustable Lux intensity, Kelvin color temperature, and rim-light diffusion.
- **Omni-Pipeline Intelligence:** Automated prompt decomposition and model routing across Google Gemini 3 Flash, Imagen 3, Fal, Veo, and Kling AI with resilient failover.
- **Multi-Tenant Organization Hub:** Workspace tenant isolation, role-based team access controls (Owner, Admin, Member, Viewer), and project concurrency quotas.
- **Zero-Trust Security Infrastructure:** OWASP-compliant memory-hard Argon2id password hashing, AES-Fernet column encryption, and anti-tamper telemetry logging.

---

## System Architecture

```text
+----------------------------------------------------------------------------+
|                          NEXT.JS 14 FRONTEND STUDIO                        |
|        Tailwind CSS  *  TypeScript  *  WebGL Canvas  *  Lucide Icons       |
+----------------------------------------------------------------------------+
                                      |
                                      | HTTPS / WSS
                                      v
+----------------------------------------------------------------------------+
|                        NGINX REVERSE PROXY & SSL                           |
|       SSL Termination  *  Streaming Uploads (50MB)  *  Proxy Buffering     |
+----------------------------------------------------------------------------+
                                      |
                                      | Reverse Proxy
                                      v
+----------------------------------------------------------------------------+
|                       FASTAPI ORCHESTRATION SERVER                         |
|     Async Worker Engine  *  Token Middleware  *  Moderation Validator      |
+----------------------------------------------------------------------------+
         |                                           |
         v                                           v
+-----------------------------+     +----------------------------------------+
|   STORAGE & RAG VECTOR GRID |     |         OMNI GENERATION GRID           |
|                             |     |                                        |
| * PostgreSQL (genfy schema) |     | * Google Gemini 3 Flash / Vertex AI    |
| * pgvector Asset Retrieval  |     | * Kling AI Video & Motion API          |
| * Fernet Column Encryption  |     | * Fal.ai / Veo Latent Synthesis        |
| * Disk & Memory Asset Cache |     |                                        |
+-----------------------------+     +----------------------------------------+
```

```mermaid
flowchart TD
    Client["Next.js 14 Frontend Studio"]
    Nginx["Nginx Reverse Proxy and SSL"]
    API["FastAPI Orchestration Core"]

    DB[("PostgreSQL Database")]
    RAG["Multimodal Visual RAG Grid"]
    Vault["Fernet Encryption Engine"]
    Cache["Disk and Memory Asset Cache"]

    Gemini["Google Gemini 3 Flash"]
    Kling["Kling AI API"]
    FalVeo["Fal.ai and Veo Grid"]

    Client --> Nginx
    Nginx --> API
    API --> DB
    API --> RAG
    API --> Vault
    API --> Cache
    API --> Gemini
    API --> Kling
    API --> FalVeo
```

---

## Deep Dive into Core Engines

### 1. Multimodal Visual and Lore RAG
Standard generative AI tools rely entirely on fleeting context in text prompts. Genfy introduces a **Multimodal Retrieval-Augmented Generation (RAG)** architecture integrated directly into PostgreSQL:
- **Vector Embeddings for Creative Assets:** Character facial embeddings, costume textures, and CAD product specifications are indexed via `pgvector`.
- **Automated Reference Fusion:** When a creator prompts *"Elena enters the boardroom holding the titanium chronometer"*, Genfy automatically queries the asset vector database, fetches Elena's verified facial geometry and the watch's hardware spec tokens, and injects them into the generation payload.
- **Zero Hallucination:** Eliminates drifting product logos, mismatched clothing colors, and shifting facial features between scenes.

### 2. Frame-to-Frame Character and Product Continuity Engine
Maintaining visual continuity across a 20-frame storyboard requires sequential feedback loops:
1. **Reference Anchor Extraction:** Generates an initial multi-angle character sheet (Front, 45 degree 3/4 view, Profile, and Extreme Close-Up) that serves as the ground-truth anchor.
2. **Dynamic Brief Injection:** Automatically re-injects character facial embeddings and product bounding coordinates into subsequent sequential prompt assemblies.
3. **Automated Vision Referee Loop:** Every generated frame is evaluated by an integrated vision similarity model against the ground-truth sheet. If facial cosine similarity drops below 0.88, Genfy triggers an automated localized refinement pass before presenting the frame to the creator.

### 3. Ultra-Photorealistic Subsurface Skin Engine
Genfy addresses the artificial "wax doll" look common in diffusion models through physical optical simulation:
- **Subsurface Scattering (SSS):** Simulates internal photon absorption and diffusion through translucent epidermal and dermal layers, reproducing natural vascular warmth in ears, lips, and cheeks.
- **Micro-Dermal Surface Relief:** Preserves natural pores, vellus hair (peach fuzz), subtle skin hydration highlights, and natural dermal asymmetry.
- **Optical Sensor Emulsion:** Applies organic sensor noise profiles modelled after high-end cinema sensors (ARRI Alexa LF, Kodak Vision3 35mm), preventing digital smoothing artifacts.

### 4. Spatial Camera Translation and VLM Anchoring
Genfy implements a spherical coordinate translation algorithm that maps input angles to deterministic physical reference vectors:

```
Effective Yaw = ((Rotate + YawOffset) % 360 + 360) % 360
```

```typescript
// Translates 3D polar coordinates into deterministic vision-language anchors
export const translateCameraAngles = (
  rotate: number,
  vertical: number,
  zoom: number
): { instruction: string; spatial: string; verticalPart: string; zoomPart: string } => {
  // 1. Explicit vertical elevation pitch anchoring
  // 2. 8-sector horizontal body-relative orientation mapping
  // 3. Focal length and millimeter lens compression simulation
  return { instruction, spatial, verticalPart, zoomPart };
};
```

### 5. Multi-Tenant Organization Architecture and Connection Pooling
Data isolation operates through dedicated PostgreSQL schema namespaces (`genfy.*`) supported by an auto-healing connection pool:
- **Pool Capacity:** 15 base connections with burst capacity up to 25 overflow slots.
- **Connection Health Checks:** `pool_pre_ping=True` eliminates stale connection drops during proxy or database gateway timeouts.
- **Statement Circuit Breakers:** Automatic 60,000ms execution limit prevents resource starvation from runaway analytical queries.

---

## Repository Structure

```
Genfy/
├── backend/                        # FastAPI Application Server (Python 3.11)
│   ├── database/                   # SQLAlchemy Models, DB Connection & Pool Config
│   ├── dependencies/               # Injection Providers (DB, Auth, Current User)
│   ├── routes/                     # REST Endpoints (Storyboard, Assets, Auth, Users)
│   ├── services/                   # Business Logic, Email Services & Auth Handlers
│   ├── utils/                      # Encryption, Moderation, Media Security, Tokenizers
│   ├── scripts/                    # Schema Migrations, Key Rotation & Telemetry
│   ├── Dockerfile                  # Container Definition for Production Backend
│   └── main.py                     # Central Routing & AI Generation Pipeline
├── frontend/                       # Next.js 14 Web Application
│   ├── src/app/(studio)/           # Visual Studio Workspace, Generate, Storyboard, Admin
│   ├── src/app/(landing)/          # Marketing, Pricing, Gallery, Auth & Legal Pages
│   ├── src/components/             # Interactive Camera Popovers, Lighting Controls
│   ├── src/context/                # Authentication, Dialog Modal & Theme Providers
│   └── public/                     # Style Recipes, Curated Previews & Visual Showcases
├── nginx/                          # Nginx Reverse Proxy Config (50MB uploads & SSL)
├── docs/                           # Database Entity Documentation & API Reference
└── docker-compose.yml              # Complete Production Stack Orchestration
```

---

## Quick Start

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/)
- [Node.js 18+](https://nodejs.org/) (for local frontend development)
- [Python 3.11+](https://www.python.org/) (for local backend development)

### Deployment with Docker Compose

```bash
# 1. Clone the repository
git clone https://github.com/Kanishk1764/Genfy.git
cd Genfy

# 2. Configure environment files
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local

# 3. Build and launch services
docker compose up -d --build
```

Access endpoints:
- Frontend Studio: `http://localhost:3000`
- Backend API Documentation (Swagger UI): `http://localhost:8000/docs`
- Nginx Proxy: `http://localhost:80` (or configured SSL domain in production)

---

## Environment Configuration

Configure `backend/.env` with the necessary infrastructure keys:

```ini
# Database Connection (Supabase PostgreSQL / local SQLite fallback)
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT].supabase.co:5432/postgres

# Security and Cryptography
SECRET_KEY=your-super-secret-jwt-key-minimum-32-chars
ENCRYPTION_KEY=your-fernet-encryption-key-for-database-fields

# AI API Service Providers
GCP_PROJECT_ID=your-google-cloud-project-id
GEMINI_API_KEY=your-gemini-studio-api-key
KLING_API_KEY=your-kling-api-key
KLING_API_SECRET=your-kling-api-secret
FAL_KEY=your-fal-ai-api-key
```

---

## API Quick Tour

### Image Generation with Camera and Lighting Choreography

```bash
curl -X POST "http://localhost:8000/api/generate" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Cinematic portrait of an architect examining structural plans in a high-rise studio at twilight",
    "aspect_ratio": "16:9",
    "camera_settings": {
      "rotate": 45,
      "vertical": -20,
      "zoom": 6
    },
    "lighting_settings": {
      "angle": 120,
      "intensity": 85,
      "temperature": 6500
    },
    "style_preset": "Cinematic"
  }'
```

---

## Security and Compliance

- **Argon2id Hashing:** Defends against GPU-accelerated brute force attacks using memory-hard cost profiles.
- **Column-Level Cryptography:** Sensitive OAuth credentials and tokens are encrypted with AES-Fernet prior to database writes.
- **Automated Content Moderation:** Multi-phase safety scanner validates text prompts and synthetic image buffers against compliance policies.
- **Schema-Level Multi-Tenancy:** Isolated schema domains guarantee strict separation of customer data records.

---

## License

Proprietary Software. Copyright (c) 2026 [Kanishk1764](https://github.com/Kanishk1764). All rights reserved.
