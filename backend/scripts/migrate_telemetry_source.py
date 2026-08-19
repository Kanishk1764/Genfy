"""
Automated, Idempotent Database Migration Script
Adds request_source column to gemini_telemetry_events table.
Supports both SQLite and PostgreSQL (genfy schema).
"""
import sys
import os

# Ensure backend dir is in sys.path
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from sqlalchemy import inspect, text
from database.db import engine, _SCHEMA, init_db
import database.models  # noqa: F401

def run_migration():
    print("[Migration] Starting telemetry request_source column migration...")
    try:
        init_db()
        inspector = inspect(engine)
        if inspector.has_table("gemini_telemetry_events", schema=_SCHEMA):
            cols = {c["name"] for c in inspector.get_columns("gemini_telemetry_events", schema=_SCHEMA)}
            if "request_source" not in cols:
                with engine.begin() as conn:
                    table_name = f"{_SCHEMA}.gemini_telemetry_events" if _SCHEMA else "gemini_telemetry_events"
                    conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN request_source VARCHAR(50) DEFAULT 'STUDIO'"))
                print(f"[Migration] Successfully added request_source column to {table_name}.")
            else:
                print("[Migration] Column request_source already exists in gemini_telemetry_events.")
        else:
            print("[Migration] Table gemini_telemetry_events does not exist yet (will be created on first init).")
        print("[Migration] Telemetry migration completed successfully.")
    except Exception as e:
        print(f"[Migration] Telemetry migration notice: {e}", file=sys.stderr)
        # Do not fail startup if column already exists or table is managed by create_all
        sys.exit(0)

if __name__ == "__main__":
    run_migration()
