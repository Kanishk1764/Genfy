import sqlite3
import os

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
candidates = [
    os.path.join(backend_dir, "data", "genfy.db"),
    os.path.join(backend_dir, "genfy.db")
]
db_path = next((p for p in candidates if os.path.exists(p)), None)

if not db_path:
    print(f"Database path not found in {candidates}. Skipping migration.")
    exit(0)

print(f"Using database file at: {db_path}")
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

def add_column_if_not_exists(table, column_def):
    col_name = column_def.split()[0]
    cursor.execute(f"PRAGMA table_info({table});")
    existing_cols = [row[1] for row in cursor.fetchall()]
    if col_name not in existing_cols:
        print(f"Adding column {col_name} to table {table}...")
        cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column_def};")
    else:
        print(f"Column {col_name} already exists in table {table}.")

# Add User OTP columns
add_column_if_not_exists("users", "reset_otp_hash VARCHAR(255)")
add_column_if_not_exists("users", "reset_otp_created_at DATETIME")
add_column_if_not_exists("users", "reset_otp_attempts INTEGER DEFAULT 0")
add_column_if_not_exists("users", "reset_session_token VARCHAR(255)")

# Add PendingUser OTP columns
add_column_if_not_exists("pending_users", "otp_hash VARCHAR(255)")
add_column_if_not_exists("pending_users", "otp_created_at DATETIME")
add_column_if_not_exists("pending_users", "otp_attempts INTEGER DEFAULT 0")

conn.commit()
conn.close()
print("Migration completed successfully.")
