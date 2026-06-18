"""
Assets Router - Secure media file serving via HMAC-SHA256 time-limited signed URLs
"""
from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import FileResponse
import os
import mimetypes
from utils.media_security import verify_signed_asset_url

router = APIRouter(prefix="/api/assets", tags=["Assets"])

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

@router.get("/serve")
async def serve_signed_asset(
    path: str = Query(..., description="Relative asset file path"),
    expires: int = Query(..., description="Expiration timestamp"),
    sig: str = Query(..., description="HMAC-SHA256 signature")
):
    """
    Serve local image/video asset files with mandatory HMAC-SHA256 signature and expiration verification.
    """
    # 1. Verify HMAC signature & expiration timestamp
    if not verify_signed_asset_url(path, expires, sig):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access Denied: Invalid or expired signed asset link."
        )

    # 2. Directory traversal security check
    clean_path = path.lstrip("/").replace("\\", "/")
    if ".." in clean_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid asset path."
        )

    # 3. Locate absolute file path on server
    abs_path = os.path.abspath(os.path.join(BACKEND_DIR, clean_path))
    if not abs_path.startswith(BACKEND_DIR):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access Denied: Path outside media storage bounds."
        )

    if not os.path.exists(abs_path) or not os.path.isfile(abs_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset file not found."
        )

    # 4. Infer Content-Type
    media_type, _ = mimetypes.guess_type(abs_path)
    if not media_type:
        if abs_path.endswith(".png"):
            media_type = "image/png"
        elif abs_path.endswith(".jpg") or abs_path.endswith(".jpeg"):
            media_type = "image/jpeg"
        elif abs_path.endswith(".mp4"):
            media_type = "video/mp4"
        else:
            media_type = "application/octet-stream"

    return FileResponse(abs_path, media_type=media_type)
