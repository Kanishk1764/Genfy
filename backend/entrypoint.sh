#!/bin/bash
set -e

# ── 1. Run Automated Database Migrations ──
echo "[Entrypoint] Running automated database schema & field encryption migrations..."
python3 scripts/migrate_otp_columns.py || true
python3 scripts/migrate_encrypt_fields.py || true
python3 scripts/migrate_legal_columns.py || true
python3 scripts/migrate_telemetry_source.py || true
echo "[Entrypoint] Database migrations completed."

# ── 2. Start gunicorn (server main process) ──
exec gunicorn main:app \
    --worker-class uvicorn.workers.UvicornWorker \
    --workers 2 \
    --bind 0.0.0.0:8001 \
    --timeout 300 \
    --keep-alive 120 \
    --graceful-timeout 30 \
    --access-logfile -

