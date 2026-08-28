#!/bin/bash
# ─────────────────────────────────────────────────────────────────────
#  Genfy — One-command deploy script for Google Cloud VM
#  Server IP: genfyy.in
#  Usage:     bash deploy.sh
# ─────────────────────────────────────────────────────────────────────
set -e

SERVER_IP="genfyy.in"
COMPOSE_FILE="docker-compose.yml"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║         Genfy — Docker Deploy                   ║"
echo "║         Server: $SERVER_IP                ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# 1. Verify we are in the right directory
if [ ! -f "$COMPOSE_FILE" ]; then
  echo "❌ ERROR: docker-compose.yml not found. Run this from the project root."
  exit 1
fi

# 2. Verify .env exists and has Supabase URL
if [ ! -f "backend/.env" ]; then
  echo "❌ ERROR: backend/.env is missing."
  exit 1
fi

if ! grep -q "postgresql://" backend/.env; then
  echo "❌ ERROR: DATABASE_URL in backend/.env does not point to Supabase (postgresql://)."
  exit 1
fi

echo "✅ Config checks passed"
echo ""

# ── DATA SAFETY AUDIT ─────────────────────────────────────────────────
echo "🗄️  Data safety audit..."
EXPORTS_DIR="backend/exports/generated"
if [ -d "$EXPORTS_DIR" ]; then
  IMG_COUNT=$(find "$EXPORTS_DIR" -type f \( -name "*.png" -o -name "*.jpg" -o -name "*.webp" \) 2>/dev/null | wc -l | tr -d ' ')
  DISK_USAGE=$(du -sh "$EXPORTS_DIR" 2>/dev/null | cut -f1)
  echo "   📸 Found $IMG_COUNT user-generated images using $DISK_USAGE on disk"
  echo "   ✅ Images are stored on HOST (bind mount) — they will survive this deploy"
else
  echo "   ⚠️  exports/generated/ not found — it will be created on first run"
fi
echo ""
echo "   ⛔ NEVER run: docker compose down -v"
echo "   ⛔ That would delete named volumes. Use: docker compose down (no -v)"
echo ""

# 3. Stop old containers gracefully
echo "🛑 Stopping existing containers..."
docker compose down --remove-orphans 2>/dev/null || true

# 4. Build fresh images (no cache for clean deploy)
echo ""
echo "🔨 Building images..."
docker compose build --no-cache

# 5. Start everything
echo ""
echo "🚀 Starting containers..."
docker compose up -d

# 6. Show status
echo ""
echo "📊 Container status:"
docker compose ps

# 7. Wait for backend health
echo ""
echo "⏳ Waiting for backend to become healthy..."
attempt=0
max=20
while [ $attempt -lt $max ]; do
  status=$(docker inspect --format='{{.State.Health.Status}}' genfy-backend 2>/dev/null || echo "unknown")
  if [ "$status" = "healthy" ]; then
    echo "✅ Backend is healthy!"
    break
  fi
  attempt=$((attempt + 1))
  echo "   Attempt $attempt/$max — status: $status"
  sleep 5
done

if [ $attempt -ge $max ]; then
  echo "⚠️  Backend health check timed out. Check logs:"
  echo "   docker logs genfy-backend --tail 50"
fi

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  🎉 Deploy complete!                            ║"
echo "║                                                  ║"
echo "║  Frontend : http://$SERVER_IP:3005        ║"
echo "║  Backend  : http://$SERVER_IP:8005        ║"
echo "║  Health   : http://$SERVER_IP:8005/health ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "Useful commands:"
echo "  docker logs genfy-backend  -f    # backend logs"
echo "  docker logs genfy-frontend -f    # frontend logs"
echo "  docker compose ps                # container status"
echo "  docker compose down              # stop everything"
