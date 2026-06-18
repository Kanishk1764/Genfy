from fastapi import APIRouter, Depends, HTTPException, Response, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
import os
from database.db import get_db
from utils.auth import create_access_token, is_cookie_secure
from services.auth_service import get_github_access_token, get_github_user_profile
from services.user_service import get_or_create_github_user

router = APIRouter(tags=["Authentication"])

GITHUB_CLIENT_ID = os.getenv("GITHUB_CLIENT_ID")
GITHUB_CALLBACK_URL = os.getenv("GITHUB_CALLBACK_URL")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

@router.get("/auth/github")
async def github_login():
    """
    Step 1: Redirect user to GitHub's OAuth authorization page.
    """
    if not GITHUB_CLIENT_ID:
        raise HTTPException(status_code=500, detail="GitHub Client ID not configured.")
    github_auth_url = f"https://github.com/login/oauth/authorize?client_id={GITHUB_CLIENT_ID}&redirect_uri={GITHUB_CALLBACK_URL}&scope=user:email"
    return RedirectResponse(url=github_auth_url)

@router.get("/auth/github/callback")
async def github_callback(code: str, db: Session = Depends(get_db)):
    """
    Step 2: Handle callback from GitHub, exchange code for access token, get user profile, log user in.
    """
    try:
        # 1. Exchange code for access token
        access_token = await get_github_access_token(code)
        
        # 2. Get user profile from GitHub
        profile = await get_github_user_profile(access_token)
        print(f"[GitHub Auth] Profile fetched: {profile.get('login')} ({profile.get('email')})")
        
        if not profile.get("email"):
            print("❌ GitHub Auth Error: No email found in profile.")
            raise HTTPException(status_code=400, detail="Could not retrieve email from GitHub profile.")
            
        # 3. Get or create user in DB
        user = get_or_create_github_user(db, profile)
        print(f"[GitHub Auth] User in DB: {user.id}")
        
        # 4. Create session token (JWT)
        session_token = create_access_token(data={"sub": user.id})
        
        # 5. Set session cookie
        response = RedirectResponse(url=f"{FRONTEND_URL}/studio")
        response.set_cookie(
            key="session_token",
            value=session_token,
            httponly=True,
            secure=is_cookie_secure(),
            samesite="lax",
            path="/"
        )
        
        return response
        
    except Exception as e:
        import traceback
        print(f"❌ GitHub Auth Callback Error: {str(e)}")
        traceback.print_exc()
        # Redirect back to login with error
        return RedirectResponse(url=f"{FRONTEND_URL}/login?error=github_auth_failed")

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8001")
GOOGLE_CALLBACK_URL = f"{BACKEND_URL}/auth/google/callback"

@router.get("/auth/google")
async def google_login():
    """
    Step 1: Redirect user to Google's OAuth authorization page.
    """
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=500, detail="Google Client ID not configured.")
    from urllib.parse import urlencode
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": GOOGLE_CALLBACK_URL,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "offline",
        "prompt": "select_account"
    }
    google_auth_url = f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"
    return RedirectResponse(url=google_auth_url)

@router.get("/auth/google/callback")
async def google_callback(code: str, db: Session = Depends(get_db)):
    """
    Step 2: Handle callback from Google, exchange code for access token, log user in.
    """
    try:
        from services.auth_service import get_google_access_token, get_google_user_profile
        from services.user_service import get_or_create_google_user

        access_token = await get_google_access_token(code, GOOGLE_CALLBACK_URL)
        profile = await get_google_user_profile(access_token)
        print(f"[Google Auth] Profile fetched: {profile.get('email')}")

        if not profile.get("email"):
            raise HTTPException(status_code=400, detail="Could not retrieve email from Google profile.")

        user = get_or_create_google_user(db, profile)
        session_token = create_access_token(data={"sub": user.id})

        response = RedirectResponse(url=f"{FRONTEND_URL}/studio")
        response.set_cookie(
            key="session_token",
            value=session_token,
            httponly=True,
            secure=is_cookie_secure(),
            samesite="lax",
            path="/"
        )
        return response

    except Exception as e:
        import traceback
        print(f"❌ Google Auth Callback Error: {str(e)}")
        traceback.print_exc()
        return RedirectResponse(url=f"{FRONTEND_URL}/login?error=google_auth_failed")
