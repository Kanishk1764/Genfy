"""
Automated 90-Day Cryptographic Key Rotation Script per NIST SP 800-53 SC-12 Standards.
Rotates JWT_SECRET_KEY and FIELD_ENCRYPTION_KEY safely with zero downtime.
Appends current active keys into FIELD_ENCRYPTION_PREVIOUS_KEYS and JWT_PREVIOUS_SECRET_KEYS.
"""
import os
import sys
import secrets
from cryptography.fernet import Fernet

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env_path = os.path.join(backend_dir, ".env")

def rotate_keys():
    print("=== NIST SP 800-53 Cryptographic Key Rotation Utility ===")
    
    if not os.path.exists(env_path):
        print(f"[Rotation Error] .env file not found at {env_path}")
        return

    with open(env_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    env_dict = {}
    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            k, v = stripped.split("=", 1)
            env_dict[k.strip()] = v.strip()

    old_jwt_key = env_dict.get("JWT_SECRET_KEY", "")
    old_field_key = env_dict.get("FIELD_ENCRYPTION_KEY", "")

    new_jwt_key = secrets.token_hex(32)
    new_field_key = Fernet.generate_key().decode("utf-8")

    # Shift JWT keys
    prev_jwt_keys = [k.strip() for k in env_dict.get("JWT_PREVIOUS_SECRET_KEYS", "").split(",") if k.strip()]
    if old_jwt_key and old_jwt_key not in prev_jwt_keys:
        prev_jwt_keys.insert(0, old_jwt_key)

    # Shift Fernet keys
    prev_field_keys = [k.strip() for k in env_dict.get("FIELD_ENCRYPTION_PREVIOUS_KEYS", "").split(",") if k.strip()]
    if old_field_key and old_field_key not in prev_field_keys:
        prev_field_keys.insert(0, old_field_key)

    # Update dictionary
    env_dict["JWT_SECRET_KEY"] = new_jwt_key
    env_dict["JWT_PREVIOUS_SECRET_KEYS"] = ",".join(prev_jwt_keys)
    env_dict["FIELD_ENCRYPTION_KEY"] = new_field_key
    env_dict["FIELD_ENCRYPTION_PREVIOUS_KEYS"] = ",".join(prev_field_keys)

    # Rewrite .env file line by line while preserving structure
    new_lines = []
    updated_keys = set()
    
    for line in lines:
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and "=" in stripped:
            k, _ = stripped.split("=", 1)
            k = k.strip()
            if k in env_dict:
                new_lines.append(f"{k}={env_dict[k]}\n")
                updated_keys.add(k)
            else:
                new_lines.append(line)
        else:
            new_lines.append(line)

    # Add missing keys if not previously in file
    for k in ["JWT_PREVIOUS_SECRET_KEYS", "FIELD_ENCRYPTION_PREVIOUS_KEYS"]:
        if k not in updated_keys and k in env_dict:
            new_lines.append(f"{k}={env_dict[k]}\n")

    with open(env_path, "w", encoding="utf-8") as f:
        f.writelines(new_lines)

    print("[Rotation Success] Cryptographic keys rotated successfully!")
    print(f"  - New Primary JWT_SECRET_KEY: {new_jwt_key[:12]}...")
    print(f"  - Legacy JWT Fallback Keys: {len(prev_jwt_keys)} active")
    print(f"  - New Primary FIELD_ENCRYPTION_KEY: {new_field_key[:12]}...")
    print(f"  - Legacy Fernet Fallback Keys: {len(prev_field_keys)} active")
    print("=== Key Rotation Complete ===")

if __name__ == "__main__":
    rotate_keys()
