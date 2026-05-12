"""Token generation and validation utilities"""
import secrets
import hashlib
from datetime import datetime, timedelta

def generate_reset_token() -> str:
    """Generate a cryptographically secure random token"""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """Hash a token using SHA256 for secure storage"""
    return hashlib.sha256(token.encode()).hexdigest()


def verify_token_expiry(created_at: datetime, hours: int = 1) -> bool:
    """Check if a token is still valid based on creation time"""
    expiry_time = created_at + timedelta(hours=hours)
    return datetime.utcnow() < expiry_time


def generate_numeric_otp(length: int = 6) -> str:
    """Generate a cryptographically secure 6-digit numeric OTP"""
    return "".join(str(secrets.randbelow(10)) for _ in range(length))


def verify_otp_expiry(created_at: datetime, minutes: int = 10) -> bool:
    """Check if an OTP is still valid (default 10 minutes)"""
    if not created_at:
        return False
    expiry_time = created_at + timedelta(minutes=minutes)
    return datetime.utcnow() < expiry_time

