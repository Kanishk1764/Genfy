"""Authentication middleware for protected routes"""
from fastapi import Request, HTTPException, Depends, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from database.db import get_db
from database.models import User
from utils.auth import decode_access_token


async def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    """Get current authenticated user from Bearer token or HTTP-only cookie.
    
    Supports two auth methods (checked in order):
    1. Authorization: Bearer {token}  — for API/suite agent calls
    2. session_token cookie            — for browser UI (existing behavior)
    """
    token = None

    # 1. Check Authorization header first (API / suite agent path)
    auth_header = request.headers.get("authorization") or request.headers.get("Authorization")
    if auth_header and auth_header.lower().startswith("bearer "):
        token = auth_header[7:].strip()

    # 2. Fall back to cookie (browser UI path)
    if not token:
        token = request.cookies.get("session_token")

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated — provide Authorization: Bearer {token} header or session_token cookie"
        )

    payload = decode_access_token(token)

    if not payload:
        # Token is present but invalid (bad signature / expired).
        # Return a response that clears the cookie so the browser stops
        # re-sending it on every request, breaking the infinite 401 loop.
        response = JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={"detail": "Invalid or expired session token"}
        )
        response.delete_cookie(
            key="session_token",
            httponly=True,
            samesite="lax",
            path="/"
        )
        # We raise an exception carrying the response so FastAPI propagates it.
        from fastapi.exceptions import HTTPException as _HTTPException
        raise _HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session token",
            headers={"Set-Cookie": response.headers.get("set-cookie", "")}
        )

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid session token payload"
        )

    user = db.query(User).filter(User.id == user_id).first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found"
        )

    return user


async def get_optional_user(request: Request, db: Session = Depends(get_db)) -> User:
    """Get user if authenticated, otherwise return None. Supports Bearer + cookie."""
    token = None

    # Check Authorization header first
    auth_header = request.headers.get("authorization") or request.headers.get("Authorization")
    if auth_header and auth_header.lower().startswith("bearer "):
        token = auth_header[7:].strip()

    # Fall back to cookie
    if not token:
        token = request.cookies.get("session_token")

    if not token:
        return None

    payload = decode_access_token(token)
    if not payload:
        return None

    user_id = payload.get("sub")
    if not user_id:
        return None

    user = db.query(User).filter(User.id == user_id).first()
    return user


async def get_effective_storyboard_user(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> User:
    """Returns the effective user for storyboard operations.
    If current_user is an admin and provides X-Impersonate-User-Id header
    (or query param impersonate_user_id), resolves and returns the impersonated user.
    """
    impersonate_id = (
        request.headers.get("x-impersonate-user-id")
        or request.headers.get("X-Impersonate-User-Id")
        or request.query_params.get("impersonate_user_id")
    )
    if impersonate_id:
        impersonate_id = impersonate_id.strip()
        if impersonate_id and impersonate_id != current_user.id:
            if getattr(current_user, "role", "user") != "admin":
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Forbidden: Only administrators can impersonate other users."
                )
            target = db.query(User).filter(User.id == impersonate_id).first()
            if not target:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Impersonated user with ID '{impersonate_id}' not found."
                )
            setattr(target, "_impersonated_by", current_user.id)
            return target

    return current_user

