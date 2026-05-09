"""Symmetric field-level encryption utilities using MultiFernet (AES-128-CBC + HMAC-SHA256)"""
import os
import base64
from cryptography.fernet import Fernet, MultiFernet
from dotenv import load_dotenv

load_dotenv()

_ENV_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")

def _get_or_create_encryption_key() -> bytes:
    """Retrieve FIELD_ENCRYPTION_KEY from environment, or generate & append a secure key to .env if missing."""
    raw_key = os.getenv("FIELD_ENCRYPTION_KEY")
    if raw_key:
        try:
            return raw_key.encode("utf-8")
        except Exception:
            pass

    # Generate new 32-byte Fernet key
    new_key_bytes = Fernet.generate_key()
    new_key_str = new_key_bytes.decode("utf-8")

    try:
        if os.path.exists(_ENV_PATH):
            with open(_ENV_PATH, "a", encoding="utf-8") as f:
                f.write(f"\n# Field-Level Encryption Key\nFIELD_ENCRYPTION_KEY={new_key_str}\n")
            os.environ["FIELD_ENCRYPTION_KEY"] = new_key_str
            print("[Security] Generated new FIELD_ENCRYPTION_KEY and saved to backend/.env")
    except Exception as e:
        print(f"[Security Warning] Could not persist FIELD_ENCRYPTION_KEY to .env: {e}")

    return new_key_bytes


def _get_multi_fernet_cipher() -> MultiFernet:
    """Initialize MultiFernet with primary key and fallback to previous keys for rotation support."""
    primary_key = _get_or_create_encryption_key()
    ciphers = [Fernet(primary_key)]

    previous_keys_str = os.getenv("FIELD_ENCRYPTION_PREVIOUS_KEYS", "").strip()
    if previous_keys_str:
        for key_str in previous_keys_str.split(","):
            key_str = key_str.strip()
            if key_str:
                try:
                    ciphers.append(Fernet(key_str.encode("utf-8")))
                except Exception:
                    pass

    return MultiFernet(ciphers)


def encrypt_field(plaintext: str) -> str:
    """Encrypt a sensitive plaintext string into a Fernet ciphertext token using primary key."""
    if not plaintext:
        return ""
    try:
        cipher = _get_multi_fernet_cipher()
        encrypted_bytes = cipher.encrypt(plaintext.encode("utf-8"))
        return encrypted_bytes.decode("utf-8")
    except Exception as e:
        print(f"[Security Error] Field encryption error: {e}")
        return plaintext


def decrypt_field(ciphertext: str) -> str:
    """Decrypt a Fernet ciphertext token trying primary key first, then previous rotation keys."""
    if not ciphertext:
        return ""
    try:
        cipher = _get_multi_fernet_cipher()
        decrypted_bytes = cipher.decrypt(ciphertext.encode("utf-8"))
        return decrypted_bytes.decode("utf-8")
    except Exception:
        # Return as-is if unencrypted legacy data
        return ciphertext
