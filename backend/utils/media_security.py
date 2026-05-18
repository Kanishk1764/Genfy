"""
HMAC-SHA256 Signed Time-Limited Asset URL Engine for Media Access Control (AWS S3 Presigned URL Equivalent)
"""
import os
import hmac
import hashlib
import time
from urllib.parse import urlencode, quote

def _get_secret_key() -> str:
    return os.getenv("JWT_SECRET_KEY", "fallback_secret_key_genfy")

def generate_signed_asset_url(filepath: str, expires_in_seconds: int = 86400) -> str:
    """
    Generate a tamper-proof HMAC-SHA256 signed URL for a local image/media file.
    Default expiration: 24 Hours (86,400 seconds).
    """
    if not filepath:
        return ""

    # Clean path string
    clean_path = filepath.lstrip("/")
    expires = int(time.time()) + expires_in_seconds

    # Create HMAC signature of path + expires
    msg = f"{clean_path}:{expires}".encode("utf-8")
    secret = _get_secret_key()
    sig = hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()

    params = {
        "path": clean_path,
        "expires": expires,
        "sig": sig
    }
    return f"/api/assets/serve?{urlencode(params)}"


def verify_signed_asset_url(path: str, expires: int, sig: str) -> bool:
    """
    Verify HMAC-SHA256 signature and expiration timestamp.
    Returns True if valid and unexpired, False otherwise.
    """
    if not path or not expires or not sig:
        return False

    clean_path = path.lstrip("/")
    now = int(time.time())

    # Check link expiration
    if now > expires:
        return False

    # Compute expected signature
    msg = f"{clean_path}:{expires}".encode("utf-8")
    secret = _get_secret_key()
    expected_sig = hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()

    # Constant-time comparison to prevent timing attacks on signatures
    return hmac.compare_digest(expected_sig, sig)


def sign_image_url(url: str, expires_in_seconds: int = 86400) -> str:
    """
    Helper to convert any raw /exports/... or exports/... path into a signed asset URL.
    Leaves HTTP/HTTPS URLs (like Google/External URLs) untouched.
    """
    if not url:
        return url

    url_str = str(url).strip()

    # If it's already an external HTTP/HTTPS URL, return as-is
    if url_str.startswith("http://") or url_str.startswith("https://"):
        return url_str

    # If it's already a signed asset URL, return as-is
    if "/api/assets/serve" in url_str:
        return url_str

    # Sign local export path
    return generate_signed_asset_url(url_str, expires_in_seconds)
