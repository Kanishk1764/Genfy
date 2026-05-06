FROM python:3.11-slim

WORKDIR /app

# System dependencies (psycopg2 needs libpq)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev \
    gcc \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies first (layer cache)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code (excluding venv, __pycache__, .db files — see .dockerignore)
COPY . .

# Exports dir for generated content (kept for backward compat during migration)
RUN mkdir -p /app/exports/generated /app/exports/storyboard /app/scripts

# Make entrypoint executable
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 8001

# Entrypoint: runs Supabase migration (if configured) then starts gunicorn.
# Migration is idempotent — already-migrated images are skipped on every restart.
ENTRYPOINT ["/app/entrypoint.sh"]
