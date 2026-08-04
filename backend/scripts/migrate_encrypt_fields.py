"""
Zero-Downtime Safe Database Field Encryption Migration Script
Encrypts existing plain-text google_id, github_id, razorpay_payment_id, and razorpay_signature in SQLite DB.
Safe to run multiple times (idempotent).
"""
import os
import sys
import sqlite3

# Add backend root to sys.path
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, backend_dir)

from utils.encryption import encrypt_field

def run_migration():
    candidates = [
        os.path.join(backend_dir, "data", "genfy.db"),
        os.path.join(backend_dir, "genfy.db")
    ]
    db_path = next((p for p in candidates if os.path.exists(p)), None)
    if not db_path:
        print(f"[Migration] Database file not found in {candidates}. Skipping.")
        return

    print(f"=== Starting Field-Level Encryption Migration on {db_path} ===")
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        cursor.execute("SELECT id, google_id, github_id, razorpay_payment_id, razorpay_signature FROM users")
        rows = cursor.fetchall()
        print(f"[Migration] Found {len(rows)} user records in database.")

        updated_count = 0
        for row in rows:
            user_id, google_id, github_id, pay_id, sig = row
            updates = {}

            if google_id and not google_id.startswith("gAAAAA"):
                updates["google_id"] = encrypt_field(google_id)
            if github_id and not github_id.startswith("gAAAAA"):
                updates["github_id"] = encrypt_field(github_id)
            if pay_id and not pay_id.startswith("gAAAAA"):
                updates["razorpay_payment_id"] = encrypt_field(pay_id)
            if sig and not sig.startswith("gAAAAA"):
                updates["razorpay_signature"] = encrypt_field(sig)

            if updates:
                set_clause = ", ".join([f"{k} = ?" for k in updates.keys()])
                values = list(updates.values()) + [user_id]
                cursor.execute(f"UPDATE users SET {set_clause} WHERE id = ?", values)
                updated_count += 1

        conn.commit()
        print(f"[Migration] Successfully encrypted sensitive fields for {updated_count} user(s).")
        print("=== Migration Completed Successfully ===")

    except Exception as e:
        conn.rollback()
        print(f"[Migration Error] Migration failed: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    run_migration()
