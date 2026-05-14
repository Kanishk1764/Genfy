import bcrypt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHashError
from datetime import datetime, timedelta
from jose import jwt, JWTError
import os
import re
from typing import Tuple
from dotenv import load_dotenv

load_dotenv()

# Initialize Argon2id Hasher (Default settings: 19MB memory, 2 iterations, 1 parallelism)
_ph = PasswordHasher()

# Dummy Argon2id hash for constant-time verification when email is not found
_DUMMY_ARGON2_HASH = _ph.hash("DummyPassword123!")


def hash_password(password: str) -> str:
    """Hash a password using Argon2id (OWASP recommended memory-hard algorithm)."""
    return _ph.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Verify a password against its hash with dual support:
    1. Primary: Argon2id ($argon2id$)
    2. Backward Compatibility Fallback: bcrypt ($2b$, $2a$, $2y$)
    """
    if not hashed_password or not plain_password:
        return False

    try:
        if hashed_password.startswith("$argon2id$"):
            _ph.verify(hashed_password, plain_password)
            return True
        elif hashed_password.startswith(("$2b$", "$2a$", "$2y$")):
            # Fallback for legacy bcrypt hashes
            return bcrypt.checkpw(
                plain_password.encode('utf-8'),
                hashed_password.encode('utf-8')
            )
        else:
            # Fallback attempt for generic hashes
            _ph.verify(hashed_password, plain_password)
            return True
    except (VerifyMismatchError, InvalidHashError):
        return False
    except Exception as e:
        print(f"❌ Password verification error: {e}")
        return False


def verify_password_and_needs_rehash(plain_password: str, hashed_password: str) -> Tuple[bool, bool]:
    """
    Verifies password and indicates if the hash should be upgraded to Argon2id.
    Returns: (is_valid: bool, needs_rehash: bool)
    """
    if not hashed_password or not plain_password:
        return False, False

    # Check constant-time dummy if hash is invalid
    if hashed_password == "dummy":
        try:
            _ph.verify(_DUMMY_ARGON2_HASH, plain_password)
        except Exception:
            pass
        return False, False

    is_valid = verify_password(plain_password, hashed_password)
    needs_rehash = False

    if is_valid:
        # If successfully verified via legacy bcrypt, mark for rehash to Argon2id
        if not hashed_password.startswith("$argon2id$"):
            needs_rehash = True
        elif _ph.check_needs_rehash(hashed_password):
            needs_rehash = True

    return is_valid, needs_rehash


def validate_password_complexity(password: str) -> Tuple[bool, str]:
    """
    Validates password against OWASP security policy:
    - Minimum 8 characters
    - At least one uppercase letter (A-Z)
    - At least one lowercase letter (a-z)
    - At least one digit (0-9)
    - At least one special character (!@#$%^&*...)
    - No whitespace characters
    """
    if not password:
        return False, "Password cannot be empty."

    if len(password) < 8:
        return False, "Password must be at least 8 characters long."

    if " " in password:
        return False, "Password cannot contain spaces."

    if not re.search(r"[A-Z]", password):
        return False, "Password must contain at least one uppercase letter (A-Z)."

    if not re.search(r"[a-z]", password):
        return False, "Password must contain at least one lowercase letter (a-z)."

    if not re.search(r"\d", password):
        return False, "Password must contain at least one number (0-9)."

    if not re.search(r"[!@#$%^&*()_+\-=\[\]{};':\"\\|,.<>/?]", password):
        return False, "Password must contain at least one special character (!@#$%^&*...)."

    return True, ""


# ==================== JWT UTILITIES ====================

SECRET_KEY = os.getenv("JWT_SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("JWT_SECRET_KEY must be set in the environment.")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 720  # 12 hours

def create_access_token(data: dict, expires_delta: timedelta = None) -> str:
    """Create a JWT access token"""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def decode_access_token(token: str) -> dict:
    """Decode and validate a JWT token with multi-key rotation fallback support."""
    # 1. Try primary SECRET_KEY first
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        pass

    # 2. Try previous rotation keys if primary key fails
    prev_keys_str = os.getenv("JWT_PREVIOUS_SECRET_KEYS", "").strip()
    if prev_keys_str:
        for prev_key in prev_keys_str.split(","):
            prev_key = prev_key.strip()
            if prev_key:
                try:
                    payload = jwt.decode(token, prev_key, algorithms=[ALGORITHM])
                    return payload
                except JWTError:
                    continue

    return None


def is_cookie_secure() -> bool:
    """
    Determine if session cookies should be marked Secure=True.
    Enforces Secure=True in production, when COOKIE_SECURE=true,
    or when BACKEND_URL/FRONTEND_URL starts with https://.
    Allows unsecure cookies on localhost during local dev.
    """
    env_secure = os.getenv("COOKIE_SECURE", "").strip().lower()
    if env_secure == "true":
        return True

    environment = os.getenv("ENVIRONMENT", "").strip().lower()
    if environment == "production":
        return True

    backend_url = os.getenv("BACKEND_URL", "").strip().lower()
    frontend_url = os.getenv("FRONTEND_URL", "").strip().lower()
    if backend_url.startswith("https://") or frontend_url.startswith("https://") or "genfyy.in" in backend_url or "genfyy.in" in frontend_url:
        return True

    if env_secure == "false":
        return False

    return False
