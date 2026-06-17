"""
User management routes - Handle signup, login, email verification, password reset.
This is the main authentication router containing all auth endpoints.
"""
from fastapi import APIRouter, Depends, HTTPException, Response, status, Request
from sqlalchemy.orm import Session
from database.db import get_db
from database.models import (
    User, PendingUser, 
    Session as DBSession, Image as DBImage, 
    CompareSession as DBCompareSession, CompareImage as DBCompareImage,
    UpscaledImage as DBUpscaledImage
)
from database.storyboard_models import (
    Storyboard, StoryboardCharacter, StoryboardProduct, StoryboardFrame
)
from pydantic import BaseModel, EmailStr
from typing import Optional
import uuid
import secrets
import os
from datetime import datetime, timedelta
from fastapi.responses import JSONResponse
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

# Local imports
from services.email_service import (
    send_verification_email, 
    send_password_reset_email
)
from utils.email_validator import validate_email_comprehensive
from utils.token import (
    generate_reset_token, 
    hash_token, 
    verify_token_expiry, 
    generate_numeric_otp, 
    verify_otp_expiry
)
from utils.auth import (
    hash_password, 
    verify_password, 
    verify_password_and_needs_rehash, 
    validate_password_complexity, 
    create_access_token,
    is_cookie_secure
)
from utils.auth_middleware import get_current_user

router = APIRouter(prefix="/api/users", tags=["Users"])

# Configuration
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")

# Disposable email domain blocklist
_DISPOSABLE_DOMAINS = {
    "mailnull.com", "10minutemail.com", "guerrillamail.com", "trashmail.com",
    "yopmail.com", "throwam.com", "sharklasers.com", "guerrillamailblock.com",
    "grr.la", "guerrillamail.info", "spam4.me", "mailnesia.com",
    "dispostable.com", "fakeinbox.com", "tempmail.com", "temp-mail.org",
    "getnada.com", "discard.email", "maildrop.cc", "mailinator.com",
    "20minutemail.com", "mintemail.com", "spamgourmet.com", "spamgourmet.net",
    "tempr.email", "nwldx.com", "emailondeck.com", "getairmail.com",
    "filzmail.com", "spamok.com", "binkmail.com",
}
TRIAL_DURATION_DAYS = 7


# ==================== REQUEST SCHEMAS ====================

class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    name: str = None
    invite_token: Optional[str] = None

class VerifyOtpRequest(BaseModel):
    email: EmailStr
    otp: str

class ResendOtpRequest(BaseModel):
    email: EmailStr

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class GoogleSignInRequest(BaseModel):
    credential: str
    name: Optional[str] = None
    is_access_token: Optional[bool] = False
    is_signup: Optional[bool] = False

class ForgotPasswordRequest(BaseModel):
    email: EmailStr

class VerifyResetOtpRequest(BaseModel):
    email: EmailStr
    otp: str

class ResetPasswordRequest(BaseModel):
    email: EmailStr
    reset_session_token: str
    new_password: str

class VerifyEmailRequest(BaseModel):
    token: str

class ResendVerificationRequest(BaseModel):
    email: EmailStr

class UpdatePaymentInfoRequest(BaseModel):
    email: str
    plan_type: str

class UpdateProfileRequest(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None

class TopUpRequest(BaseModel):
    amount: int

class AcceptTosRequest(BaseModel):
    version: Optional[str] = "v1.0"



# ==================== HELPER FUNCTIONS ====================

def normalize_email(email: str) -> str:
    """Normalize Gmail addresses to prevent dot-trick and plus-trick abuse"""
    if not email:
        return email
    email = email.lower().strip()
    parts = email.split('@')
    if len(parts) != 2:
        return email
    local_part, domain = parts
    if domain in ['gmail.com', 'googlemail.com']:
        local_part = local_part.replace('.', '')
        if '+' in local_part:
            local_part = local_part.split('+')[0]
    return f"{local_part}@{domain}"


def _is_disposable_email(email: str) -> bool:
    """Check if email domain is disposable/throwaway"""
    try:
        domain = email.split("@")[1].lower()
        return domain in _DISPOSABLE_DOMAINS
    except IndexError:
        return False


def _utcnow() -> datetime:
    return datetime.utcnow()


def _trial_is_active(user: User) -> bool:
    if not user.is_trial or not user.trial_ends_at:
        return False
    return _utcnow() < user.trial_ends_at


def _activate_trial(user: User, plan_type: str = "starter") -> None:
    if user.has_used_trial:
        raise HTTPException(status_code=400, detail="Trial already used.")

    now = _utcnow()
    user.plan_type = plan_type
    user.payment_status = "pending"
    user.is_trial = True
    user.trial_started_at = now
    user.trial_ends_at = now + timedelta(days=TRIAL_DURATION_DAYS)
    user.has_used_trial = True


def get_user_next_action(user):
    """
    Finite State Machine - Determine user's next required action
    """
    if not user.email_verified:
        return "verify_email"
    if _trial_is_active(user):
        return "dashboard"
    if user.plan_type == 'not_selected':
        return "select_plan"
    
    # Dashboard is default if all above are met
    return "dashboard"


# ==================== AUTHENTICATION ENDPOINTS ====================

@router.post("/signup")
async def signup_user(
    signup_data: SignupRequest,
    request: Request,
    db: Session = Depends(get_db)
):
    """Create pending account & send 6-digit OTP verification code."""
    signup_data.email = normalize_email(signup_data.email)

    if _is_disposable_email(signup_data.email):
        raise HTTPException(status_code=400, detail="Disposable email addresses not permitted.")

    is_valid, message = validate_email_comprehensive(signup_data.email)
    if not is_valid:
        raise HTTPException(status_code=400, detail=f"Invalid email: {message}")

    # Check existing user
    if db.query(User).filter(User.email == signup_data.email).first():
        raise HTTPException(status_code=400, detail="An account with this email already exists. Please log in instead.")

    # Validate password complexity (OWASP standards)
    is_valid_pwd, pwd_msg = validate_password_complexity(signup_data.password)
    if not is_valid_pwd:
        raise HTTPException(status_code=400, detail=pwd_msg)

    # Client IP for legal provenance
    client_ip = request.headers.get("x-forwarded-for")
    if client_ip:
        client_ip = client_ip.split(",")[0].strip()
    elif request.client:
        client_ip = request.client.host

    # Generate 6-digit OTP
    otp_code = generate_numeric_otp(6)
    hashed_otp = hash_token(otp_code)

    now_utc = datetime.utcnow()
    pending_user = db.query(PendingUser).filter(PendingUser.email == signup_data.email).first()
    if pending_user:
        pending_user.otp_hash = hashed_otp
        pending_user.otp_created_at = now_utc
        pending_user.otp_attempts = 0
        pending_user.verification_token = hashed_otp
        pending_user.verification_token_created_at = now_utc
        pending_user.verification_sent_count += 1
        pending_user.password_hash = hash_password(signup_data.password)
        pending_user.name = signup_data.name
        pending_user.tos_accepted_at = None
        pending_user.tos_version = "v1.0"
        pending_user.signup_ip = client_ip
    else:
        pending_user = PendingUser(
            email=signup_data.email,
            password_hash=hash_password(signup_data.password),
            name=signup_data.name,
            otp_hash=hashed_otp,
            otp_created_at=now_utc,
            otp_attempts=0,
            verification_token=hashed_otp,
            verification_token_created_at=now_utc,
            tos_accepted_at=None,
            tos_version="v1.0",
            signup_ip=client_ip
        )
        db.add(pending_user)

    db.commit()
    db.refresh(pending_user)

    try:
        await send_verification_email(
            email=pending_user.email,
            otp_code=otp_code,
            user_name=pending_user.name
        )
    except Exception as e:
        print(f"❌ Failed to send verification email: {e}")
        raise HTTPException(status_code=500, detail="Failed to send verification email. Please check your email address.")

    return {
        "status": "otp_sent",
        "email": pending_user.email,
        "message": "Verification code sent to your email."
    }


@router.post("/verify-otp")
async def verify_signup_otp(
    request_data: VerifyOtpRequest,
    response: Response,
    db: Session = Depends(get_db)
):
    """Verify 6-digit OTP, activate account, issue 2-hour session cookie, and log user in directly."""
    email = normalize_email(request_data.email)
    otp = request_data.otp.strip()

    pending_user = db.query(PendingUser).filter(PendingUser.email == email).first()
    if not pending_user:
        raise HTTPException(status_code=404, detail="No pending registration found. Please sign up first.")

    if pending_user.otp_attempts >= 5:
        raise HTTPException(status_code=429, detail="Too many invalid attempts. Please click Resend Code for a new OTP.")

    if not verify_otp_expiry(pending_user.otp_created_at, minutes=10):
        raise HTTPException(status_code=400, detail="Verification code has expired. Please request a new code.")

    hashed_input = hash_token(otp)
    if pending_user.otp_hash != hashed_input:
        pending_user.otp_attempts += 1
        db.commit()
        remaining = 5 - pending_user.otp_attempts
        raise HTTPException(status_code=400, detail=f"Invalid verification code. {remaining} attempts remaining.")

    # Create active user
    existing_user = db.query(User).filter(User.email == email).first()
    if existing_user:
        db.delete(pending_user)
        db.commit()
        raise HTTPException(status_code=400, detail="User already registered. Please log in.")

    user = User(
        email=email,
        password_hash=pending_user.password_hash,
        name=pending_user.name,
        email_verified=True,
        auth_provider='email',
        created_at=datetime.utcnow(),
        role='user',
        tos_accepted_at=getattr(pending_user, "tos_accepted_at", None),
        tos_version=getattr(pending_user, "tos_version", "v1.0") or "v1.0",
        signup_ip=getattr(pending_user, "signup_ip", None)
    )
    _activate_trial(user)
    db.add(user)
    db.delete(pending_user)
    db.commit()
    db.refresh(user)

    # Issue 2-hour JWT session cookie
    access_token = create_access_token(data={"sub": user.id})
    response.set_cookie(
        key="session_token",
        value=access_token,
        httponly=True,
        secure=is_cookie_secure(),
        samesite="lax",
        path="/"
    )

    return {
        "status": "success",
        "message": "Account verified successfully!",
        "user": user.to_dict() | {"next_action": get_user_next_action(user)}
    }


@router.post("/resend-otp")
async def resend_signup_otp(
    request_data: ResendOtpRequest,
    db: Session = Depends(get_db)
):
    """Resend 6-digit signup OTP with rate-limiting cooldown."""
    email = normalize_email(request_data.email)
    pending_user = db.query(PendingUser).filter(PendingUser.email == email).first()

    if not pending_user:
        # Check if already verified user
        if db.query(User).filter(User.email == email).first():
            raise HTTPException(status_code=400, detail="Account is already verified. Please log in.")
        raise HTTPException(status_code=404, detail="No pending signup found for this email.")

    # 60-second cooldown check
    if pending_user.otp_created_at:
        elapsed = (datetime.utcnow() - pending_user.otp_created_at).total_seconds()
        if elapsed < 60:
            retry_after = int(60 - elapsed)
            raise HTTPException(status_code=429, detail=f"Please wait {retry_after} seconds before requesting a new code.")

    otp_code = generate_numeric_otp(6)
    pending_user.otp_hash = hash_token(otp_code)
    pending_user.otp_created_at = datetime.utcnow()
    pending_user.otp_attempts = 0
    pending_user.verification_sent_count += 1
    db.commit()

    await send_verification_email(
        email=pending_user.email,
        otp_code=otp_code,
        user_name=pending_user.name
    )

    return {"status": "success", "message": "New 6-digit verification code sent to your email."}


@router.post("/login")
async def login_user(
    response: Response,
    login_data: LoginRequest,
    db: Session = Depends(get_db)
):
    """Login and set session cookie"""
    login_data.email = normalize_email(login_data.email)
    user = db.query(User).filter(User.email == login_data.email).first()

    valid_password = False
    needs_rehash = False
    if user and user.password_hash:
        valid_password, needs_rehash = verify_password_and_needs_rehash(login_data.password, user.password_hash)
    else:
        # Prevent timing attacks on non-existent users or empty hashes
        verify_password_and_needs_rehash(login_data.password, "$argon2id$v=19$m=19456,t=2,p=1$ZHVtbXlzYWx0$dummyhash")

    if not user or not valid_password:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # Seamlessly upgrade legacy hash to Argon2id upon successful authentication
    if needs_rehash:
        user.password_hash = hash_password(login_data.password)
        db.commit()

    if not user.email_verified:
        return JSONResponse(
            status_code=403,
            content={
                "status": "error",
                "message": "Please verify your email.",
                "email_verified": False,
                "email": user.email
            }
        )

    access_token = create_access_token(data={"sub": user.id})
    response.set_cookie(
        key="session_token",
        value=access_token,
        httponly=True,
        secure=is_cookie_secure(),
        samesite="lax",
        path="/"
    )

    return {
        "status": "success",
        "user": user.to_dict() | {"next_action": get_user_next_action(user)}
    }


@router.post("/logout")
async def logout_user(response: Response):
    response.delete_cookie(key="session_token", httponly=True, samesite="lax", path="/")
    return {"status": "success", "message": "Logged out"}


@router.get("/me")
async def get_current_user_info(request: Request, response: Response, db: Session = Depends(get_db)):
    """Get current user info, automatically clearing stale cookies on invalid tokens."""
    from utils.auth import decode_access_token
    from fastapi.responses import JSONResponse as _JSONResponse

    token = request.cookies.get("session_token")

    if not token:
        return _JSONResponse(status_code=401, content={"status": "error", "detail": "Not authenticated"})

    payload = decode_access_token(token)

    if not payload:
        # Bad/stale cookie — delete it so the browser stops sending it
        resp = _JSONResponse(status_code=401, content={"status": "error", "detail": "Session expired. Please log in again."})
        resp.delete_cookie(key="session_token", httponly=True, samesite="lax", path="/")
        return resp

    user_id = payload.get("sub")
    if not user_id:
        resp = _JSONResponse(status_code=401, content={"status": "error", "detail": "Invalid session."})
        resp.delete_cookie(key="session_token", httponly=True, samesite="lax", path="/")
        return resp

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        resp = _JSONResponse(status_code=401, content={"status": "error", "detail": "User not found."})
        resp.delete_cookie(key="session_token", httponly=True, samesite="lax", path="/")
        return resp

    return {
        "status": "success",
        "user": user.to_dict() | {"next_action": get_user_next_action(user)}
    }


@router.post("/accept-tos")
async def accept_terms_of_service(
    request: Request,
    body: Optional[AcceptTosRequest] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Record user acceptance of Terms of Service."""
    now_utc = datetime.utcnow()
    user.tos_accepted_at = now_utc
    if body and body.version:
        user.tos_version = body.version
    elif not user.tos_version:
        user.tos_version = "v1.0"

    client_ip = (
        request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        or (request.client.host if request.client else None)
    )
    if client_ip and not user.signup_ip:
        user.signup_ip = client_ip

    db.commit()
    db.refresh(user)

    return {
        "status": "success",
        "message": "Terms and conditions accepted",
        "tos_accepted_at": user.tos_accepted_at.isoformat() + "Z" if user.tos_accepted_at else None,
        "tos_version": user.tos_version,
        "user": user.to_dict() | {"next_action": get_user_next_action(user)}
    }


@router.post("/google-signin")
async def google_signin(
    response: Response,
    request: Request,
    request_data: GoogleSignInRequest,
    db: Session = Depends(get_db)
):
    """Handle Google Sign-In"""
    try:
        if request_data.is_access_token:
            # Handle access token by calling Google's userinfo endpoint
            import requests as py_requests
            user_info_resp = py_requests.get(
                "https://www.googleapis.com/oauth2/v3/userinfo",
                headers={"Authorization": f"Bearer {request_data.credential}"}
            )
            if not user_info_resp.ok:
                raise Exception("Failed to fetch user info from Google")
            
            idinfo = user_info_resp.json()
            email = normalize_email(idinfo.get('email'))
            google_id = idinfo.get('sub')
            name = request_data.name or idinfo.get('name')
            picture = idinfo.get('picture')
        else:
            # Standard ID Token verification
            idinfo = id_token.verify_oauth2_token(
                request_data.credential,
                google_requests.Request(),
                GOOGLE_CLIENT_ID
            )
            email = normalize_email(idinfo.get('email'))
            google_id = idinfo.get('sub')
            name = request_data.name or idinfo.get('name')
            picture = idinfo.get('picture')

        if _is_disposable_email(email):
            raise HTTPException(status_code=400, detail="Disposable email not allowed.")

        # Client IP for legal provenance
        client_ip = request.headers.get("x-forwarded-for")
        if client_ip:
            client_ip = client_ip.split(",")[0].strip()
        elif request.client:
            client_ip = request.client.host

        user = db.query(User).filter(User.email == email).first()
        if request_data.is_signup and user:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Account already exists. Please log in instead."
            )

        if not user:
            user = User(
                email=email,
                name=name,
                google_id=google_id,
                auth_provider='google',
                profile_picture=picture,
                email_verified=True,
                created_at=datetime.utcnow(),
                role='user',
                tos_accepted_at=None,
                tos_version="v1.0",
                signup_ip=client_ip
            )
            _activate_trial(user)
            db.add(user)
        else:
            # Update existing user with Google info
            if not user.google_id:
                user.google_id = google_id
                user.auth_provider = 'google'
            if not user.profile_picture:
                user.profile_picture = picture

        db.commit()
        db.refresh(user)

        access_token = create_access_token(data={"sub": user.id})
        response.set_cookie(
            key="session_token",
            value=access_token,
            httponly=True,
            secure=is_cookie_secure(),
            samesite="lax",
            path="/"
        )

        return {
            "status": "success",
            "user": user.to_dict() | {"next_action": get_user_next_action(user)}
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Google auth failed: {str(e)}")


@router.post("/verify-email")
async def verify_email(
    response: Response,
    request_data: VerifyEmailRequest,
    db: Session = Depends(get_db)
):
    """
    Verify email token and promote PendingUser → User.

    This endpoint is intentionally idempotent:
    - React 18 Strict Mode double-invokes effects in dev, firing the POST twice.
    - Network retries can also cause duplicate requests.
    On the first call:  PendingUser found → promote to User → delete PendingUser.
    On the second call: PendingUser is gone, but User exists with the same hashed
                        token → return success immediately so the user isn't stuck.
    """
    hashed = hash_token(request_data.token)

    # ── First call path: PendingUser still exists ──────────────────────────────
    pending = db.query(PendingUser).filter(PendingUser.verification_token == hashed).first()

    if pending:
        if not verify_token_expiry(pending.verification_token_created_at, hours=24):
            raise HTTPException(status_code=400, detail="Verification link has expired. Please request a new one.")

        user = User(
            id=pending.id,
            email=pending.email,
            password_hash=pending.password_hash,
            name=pending.name,
            email_verified=True,
            # Store the hashed token on the User so we can handle duplicate requests
            verification_token=hashed,
            verification_token_created_at=pending.verification_token_created_at,
            created_at=datetime.utcnow(),
            role='user',
            tos_accepted_at=getattr(pending, "tos_accepted_at", None),
            tos_version=getattr(pending, "tos_version", "v1.0") or "v1.0",
            signup_ip=getattr(pending, "signup_ip", None)
        )
        _activate_trial(user)
        db.add(user)
        db.delete(pending)
        db.commit()
        db.refresh(user)

    else:
        # ── Idempotency path: PendingUser already deleted (duplicate request) ──
        user = db.query(User).filter(User.verification_token == hashed).first()
        if not user:
            raise HTTPException(
                status_code=400,
                detail="Verification link is invalid or has already expired. Please request a new one."
            )
        # User already verified — just re-issue the session cookie

    access_token = create_access_token(data={"sub": user.id})
    response.set_cookie(
        key="session_token",
        value=access_token,
        httponly=True,
        secure=is_cookie_secure(),
        samesite="lax",
        path="/"
    )

    return {
        "status": "success",
        "user": user.to_dict() | {"next_action": get_user_next_action(user)}
    }


@router.post("/start-trial")
async def start_trial(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Start a one-time 7-day trial for a verified account."""
    if not user.email_verified:
        raise HTTPException(status_code=403, detail="Please verify your email first.")
    if user.has_used_trial:
        raise HTTPException(status_code=400, detail="Trial already used.")

    _activate_trial(user)
    db.commit()
    db.refresh(user)

    return {
        "status": "success",
        "message": "Your 7-day trial has started.",
        "user": user.to_dict() | {"next_action": get_user_next_action(user)}
    }


@router.post("/resend-verification")
async def resend_verification(request_data: ResendVerificationRequest, db: Session = Depends(get_db)):
    """
    Re-send an email verification link.

    After a successful first verification, PendingUser is deleted and the User is
    created.  If the user somehow re-submits the resend form (e.g. back-button),
    we previously returned 404 because PendingUser no longer existed.  Now we
    check the User table first and return a helpful 400 instead.
    """
    email = normalize_email(request_data.email)

    # Check if the email already belongs to a verified user
    existing_user = db.query(User).filter(User.email == email).first()
    if existing_user:
        if existing_user.email_verified:
            raise HTTPException(
                status_code=400,
                detail="This email is already verified. Please log in."
            )
        # User record exists but not verified — shouldn't normally happen,
        # but handle it gracefully by treating them like a pending user.
        # Fall through to normal resend logic below (no PendingUser found branch).

    pending = db.query(PendingUser).filter(PendingUser.email == email).first()
    if not pending:
        # If we reach here the email is simply not registered at all
        raise HTTPException(status_code=404, detail="No pending registration found for this email. Please sign up first.")

    if pending.verification_sent_count >= 5:
        raise HTTPException(status_code=429, detail="Too many verification attempts. Please contact support.")

    token = generate_reset_token()
    pending.verification_token = hash_token(token)
    pending.verification_token_created_at = datetime.utcnow()
    pending.verification_sent_count += 1
    db.commit()

    await send_verification_email(email=pending.email, verification_token=token, user_name=pending.name)
    return {"status": "success", "message": "Verification link resent. Please check your inbox."}


@router.post("/forgot-password")
async def forgot_password(request_data: ForgotPasswordRequest, db: Session = Depends(get_db)):
    """Generate and send 6-digit OTP code for password reset."""
    email = normalize_email(request_data.email)
    user = db.query(User).filter(User.email == email).first()
    
    msg = {"status": "otp_sent", "email": email, "message": "If email is registered, a password reset code has been sent."}
    
    if not user or user.auth_provider in ['google', 'github']:
        return msg

    otp_code = generate_numeric_otp(6)
    user.reset_otp_hash = hash_token(otp_code)
    user.reset_otp_created_at = datetime.utcnow()
    user.reset_otp_attempts = 0
    db.commit()

    try:
        await send_password_reset_email(email=user.email, otp_code=otp_code, user_name=user.name)
    except Exception as e:
        print(f"❌ Failed to send password reset email: {e}")

    return msg


@router.post("/verify-reset-otp")
async def verify_reset_otp(request_data: VerifyResetOtpRequest, db: Session = Depends(get_db)):
    """Verify 6-digit password reset OTP and issue temporary reset authorization token."""
    email = normalize_email(request_data.email)
    otp = request_data.otp.strip()

    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=400, detail="Invalid email or verification code.")

    if user.reset_otp_attempts >= 5:
        raise HTTPException(status_code=429, detail="Too many invalid attempts. Please request a new reset code.")

    if not verify_otp_expiry(user.reset_otp_created_at, minutes=10):
        raise HTTPException(status_code=400, detail="Password reset code has expired. Please request a new code.")

    if user.reset_otp_hash != hash_token(otp):
        user.reset_otp_attempts += 1
        db.commit()
        remaining = 5 - user.reset_otp_attempts
        raise HTTPException(status_code=400, detail=f"Invalid verification code. {remaining} attempts remaining.")

    # Generate temporary reset authorization session token
    reset_session_token = secrets.token_urlsafe(32)
    user.reset_session_token = hash_token(reset_session_token)
    user.reset_otp_hash = None
    db.commit()

    return {
        "status": "success",
        "message": "Code verified! Please enter your new password.",
        "reset_session_token": reset_session_token
    }


@router.post("/reset-password")
async def reset_password(
    request_data: ResetPasswordRequest,
    response: Response,
    db: Session = Depends(get_db)
):
    """Set new password, clear reset token, set 2-hour session cookie, and log user in directly."""
    email = normalize_email(request_data.email)
    user = db.query(User).filter(User.email == email).first()

    if not user or not user.reset_session_token:
        raise HTTPException(status_code=400, detail="Invalid or expired reset session. Please request a new code.")

    if user.reset_session_token != hash_token(request_data.reset_session_token):
        raise HTTPException(status_code=400, detail="Invalid reset authorization token. Please try again.")

    is_valid_pwd, pwd_msg = validate_password_complexity(request_data.new_password)
    if not is_valid_pwd:
        raise HTTPException(status_code=400, detail=pwd_msg)

    # Update password and clear reset state
    user.password_hash = hash_password(request_data.new_password)
    user.reset_session_token = None
    user.reset_otp_hash = None
    user.reset_otp_created_at = None
    user.reset_otp_attempts = 0
    db.commit()
    db.refresh(user)

    # Issue 2-hour session cookie and log user in directly to the studio!
    access_token = create_access_token(data={"sub": user.id})
    response.set_cookie(
        key="session_token",
        value=access_token,
        httponly=True,
        secure=is_cookie_secure(),
        samesite="lax",
        path="/"
    )

    return {
        "status": "success",
        "message": "Password reset successful! Logging you in...",
        "user": user.to_dict() | {"next_action": get_user_next_action(user)}
    }


@router.post("/update-payment-info")
async def update_payment_info(request_data: UpdatePaymentInfoRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    valid_plans = ['starter', 'pro', 'enterprise', 'not_selected']
    if request_data.plan_type not in valid_plans:
        raise HTTPException(status_code=400, detail="Invalid plan")
    
    # Pricing: Starter=$9, Pro=$19, Enterprise=$79
    price_map = {'starter': 9, 'pro': 19, 'enterprise': 79, 'not_selected': None}
    
    user.plan_type = request_data.plan_type
    user.payment_amount = price_map.get(request_data.plan_type)
    user.payment_status = 'pending'
    db.commit()
    return {"status": "success", "plan_type": user.plan_type}


@router.post("/update-profile")
async def update_profile(
    request_data: UpdateProfileRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update user's name and/or email"""
    if request_data.name:
        user.name = request_data.name
    
    if request_data.email:
        new_email = normalize_email(request_data.email)
        # Check if email is already taken by another user
        existing_user = db.query(User).filter(User.email == new_email, User.id != user.id).first()
        if existing_user:
            raise HTTPException(status_code=400, detail="Email already in use by another account.")
        user.email = new_email

    db.commit()
    db.refresh(user)
    return {"status": "success", "user": user.to_dict()}


@router.post("/top-up")
async def top_up_tokens(
    request_data: TopUpRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Mock endpoint to top up token balance"""
    user.token_balance += request_data.amount
    db.commit()
    db.refresh(user)
    return {
        "status": "success", 
        "message": f"Successfully added {request_data.amount} tokens.",
        "token_balance": user.token_balance
    }


def _safe_remove_file(file_path_or_url: Optional[str]):
    if not file_path_or_url or not isinstance(file_path_or_url, str):
        return
    clean_path = file_path_or_url.strip()
    if clean_path.startswith("data:"):
        return  # in-memory base64 data URI

    import urllib.parse
    try:
        if clean_path.startswith("http://") or clean_path.startswith("https://"):
            parsed = urllib.parse.urlparse(clean_path)
            clean_path = parsed.path
    except Exception:
        pass

    clean_path = clean_path.lstrip("/\\")
    candidates = [
        clean_path,
        os.path.join(".", clean_path),
        os.path.join("data", clean_path),
        os.path.join("backend", clean_path),
        os.path.join("backend", "data", clean_path),
    ]

    for c in candidates:
        try:
            if os.path.isfile(c):
                os.remove(c)
                print(f"[DeleteAccount] Removed file from disk: {c}")
                break
        except Exception as e:
            print(f"[DeleteAccount] Could not remove file {c}: {e}")


@router.delete("/me")
async def delete_account(
    response: Response,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Permanently delete user account, all generated images, storyboards, upscales, and associated disk files"""
    try:
        user_id = user.id
        user_email = user.email

        # 1. Clean up regular studio images & physical files
        images = db.query(DBImage).filter(DBImage.user_id == user_id).all()
        for img in images:
            _safe_remove_file(img.url)
        db.query(DBImage).filter(DBImage.user_id == user_id).delete(synchronize_session=False)

        # 2. Clean up compare images & physical files
        compare_images = db.query(DBCompareImage).filter(DBCompareImage.user_id == user_id).all()
        for c_img in compare_images:
            _safe_remove_file(c_img.url)
        db.query(DBCompareImage).filter(DBCompareImage.user_id == user_id).delete(synchronize_session=False)

        # 3. Clean up upscaled images & physical files
        upscaled_images = db.query(DBUpscaledImage).filter(DBUpscaledImage.user_id == user_id).all()
        for u_img in upscaled_images:
            _safe_remove_file(u_img.url)
        db.query(DBUpscaledImage).filter(DBUpscaledImage.user_id == user_id).delete(synchronize_session=False)

        # 4. Clean up storyboard assets (frames, characters, products, videos)
        storyboards = db.query(Storyboard).filter(Storyboard.user_id == user_id).all()
        for sb in storyboards:
            # Frames
            for frame in sb.frames:
                _safe_remove_file(frame.image_path)
                _safe_remove_file(frame.video_url)
                _safe_remove_file(frame.transition_video_url)
            # Characters
            for char in sb.characters:
                _safe_remove_file(char.image_path)
                if isinstance(char.image_paths, list):
                    for p in char.image_paths:
                        _safe_remove_file(p)
            # Products
            for prod in sb.products:
                _safe_remove_file(prod.image_path)
                if isinstance(prod.image_paths, list):
                    for p in prod.image_paths:
                        _safe_remove_file(p)
            _safe_remove_file(sb.contact_sheet_url)

        # Delete storyboards (cascades to characters, products, frames)
        db.query(Storyboard).filter(Storyboard.user_id == user_id).delete(synchronize_session=False)

        # 5. Clean up sessions
        db.query(DBSession).filter(DBSession.user_id == user_id).delete(synchronize_session=False)
        db.query(DBCompareSession).filter(DBCompareSession.user_id == user_id).delete(synchronize_session=False)

        # 6. Clean up pending verification records
        db.query(PendingUser).filter(PendingUser.email == user_email).delete(synchronize_session=False)

        # 7. Permanently delete the user record
        db.delete(user)
        db.commit()
        print(f"[DeleteAccount] User {user_email} (ID: {user_id}) and all associated data permanently deleted.")
    except Exception as e:
        db.rollback()
        print(f"[DeleteAccount] Failed to delete account for user {user.email}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete account: {e}")

    # 8. Expire the session cookie
    response.delete_cookie(
        key="session_token",
        httponly=True,
        secure=is_cookie_secure(),
        samesite="lax",
        path="/"
    )
    return {"status": "success", "message": "Account, images, storyboards, and all related data have been permanently deleted."}

