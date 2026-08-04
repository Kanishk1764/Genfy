"""
Automated, Idempotent Database Migration Script
Adds Legal Compliance, Terms of Service, and DMCA Quarantine columns to:
- users
- pending_users
- images
- compare_images
- storyboard_frames

This script is safe to run multiple times:
- Inspects existing schema before modifying
- Only adds columns if they do not already exist
- Supports both SQLite and PostgreSQL (genfy schema)
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
import database.storyboard_models  # noqa: F401

def run_migration():
    print("[Migration] Starting legal & DMCA quarantine columns migration...")
    
    # 1. Run Base init_db which includes create_all and schema inspection
    try:
        init_db()
        print("[Migration] init_db() completed successfully.")
    except Exception as e:
        print(f"[Migration] Error running init_db: {e}", file=sys.stderr)
        sys.exit(1)

    # 2. Detailed verification
    inspector = inspect(engine)
    required_checks = {
        "users": ["tos_accepted_at", "tos_version", "signup_ip"],
        "pending_users": ["tos_accepted_at", "tos_version", "signup_ip"],
        "images": ["is_quarantined", "quarantined_at", "quarantine_reason", "quarantined_by", "upstream_request_id"],
        "compare_images": ["is_quarantined", "quarantined_at", "quarantine_reason", "quarantined_by", "upstream_request_id"],
        "storyboard_frames": ["is_quarantined", "quarantined_at", "quarantine_reason", "quarantined_by"],
    }

    all_verified = True
    for table, expected_cols in required_checks.items():
        if inspector.has_table(table, schema=_SCHEMA):
            cols = {c["name"] for c in inspector.get_columns(table, schema=_SCHEMA)}
            missing = [c for c in expected_cols if c not in cols]
            if missing:
                print(f"[Migration] WARNING: Table '{table}' still missing columns: {missing}")
                all_verified = False
            else:
                print(f"[Migration] Table '{table}' verified: all legal columns present.")
        else:
            print(f"[Migration] Table '{table}' does not exist in schema '{_SCHEMA}' (will be created when accessed).")

    if all_verified:
        print("[Migration] All legal compliance & quarantine migrations verified successfully.")
    else:
        print("[Migration] Some columns were not applied.", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    run_migration()
