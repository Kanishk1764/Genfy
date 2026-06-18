from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session as DbSession
from typing import Dict, Any
from datetime import datetime

from database.db import get_db
from database.models import Session, Image, CompareSession, CompareImage, User
from utils.auth_middleware import get_current_user
router = APIRouter(
    prefix="/api/sessions",
    tags=["History"],
)


def _session_sort_key(created_at: Any) -> datetime:
    """Normalize stored timestamps so newest sessions always sort first."""
    if isinstance(created_at, datetime):
        return created_at
    if not created_at:
        return datetime.min

    raw = str(created_at).strip()
    for parser in (
        lambda value: datetime.fromisoformat(value.replace("Z", "+00:00")),
        lambda value: datetime.strptime(value, "%Y-%m-%d %H:%M:%S.%f"),
        lambda value: datetime.strptime(value, "%Y-%m-%d %H:%M:%S"),
    ):
        try:
            parsed = parser(raw)
            return parsed.replace(tzinfo=None) if getattr(parsed, "tzinfo", None) else parsed
        except Exception:
            continue

    return datetime.min


def _activity_sort_key(*timestamps: Any) -> datetime:
    """Pick the most recent meaningful timestamp for a session."""
    parsed_times = [_session_sort_key(ts) for ts in timestamps if ts]
    return max(parsed_times) if parsed_times else datetime.min


def _safe_json_parse(value: Any, fallback: Any):
    if value is None:
        return fallback
    if isinstance(value, (dict, list)):
        return value
    try:
        return __import__("json").loads(value)
    except Exception:
        return fallback

@router.get("", response_model=Dict[str, Any])
async def get_sessions(
    db: DbSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all sessions for the current user."""
    import logging
    logger = logging.getLogger(__name__)
    logger.warning(f"[API] Current user: {current_user.id}, email: {current_user.email}")

    sessions = (
        db.query(Session)
        .filter(Session.user_id == current_user.id)
        .filter(Session.parent_session_id == None)  # exclude edit child sessions — they show inline on the generate page
        .order_by(Session.created_at.desc(), Session.id.desc())
        .all()
    )
    logger.warning(f"[API] Found {len(sessions)} sessions for user {current_user.id}")
    compare_sessions = (
        db.query(CompareSession)
        .filter(CompareSession.user_id == current_user.id)
        .order_by(CompareSession.created_at.desc(), CompareSession.id.desc())
        .all()
    )

    session_map: Dict[str, Dict[str, Any]] = {}
    for sess in sessions:
        # Get images for this session in newest-first order so the preview
        # reflects the most recently generated outputs.
        images = (
            db.query(Image)
            .filter(Image.session_id == sess.id)
            .order_by(Image.created_at.desc(), Image.id.desc())
            .all()
        )
        # Fallback to parent images if empty
        if not images and sess.parent_session_id:
            curr = sess
            visited = {sess.id}
            while not images and curr.parent_session_id and curr.parent_session_id not in visited:
                visited.add(curr.parent_session_id)
                parent = db.query(Session).filter(Session.id == curr.parent_session_id).first()
                if not parent: break
                images = db.query(Image).filter(Image.session_id == parent.id).all()
                curr = parent

        image_count = len(images)
        # Use the stored DB URLs directly so polling stays fast and stable.
        # Filter to images with URLs first, then take up to 3
        images_with_urls = [img for img in images if img.url]
        preview_images = [img.url for img in images_with_urls[:3]]
        session_map[sess.id] = {
            "id": sess.id,
            "type": "session",
            "prompt": sess.prompt,
            "created_at": sess.created_at,
            "latest_activity_at": _activity_sort_key(
                sess.created_at,
                *(img.created_at for img in images),
            ).isoformat(),
            "image_count": image_count,
            "preview_images": preview_images
        }

    for sess in compare_sessions:
        images = (
            db.query(CompareImage)
            .filter(CompareImage.compare_session_id == sess.id)
            .order_by(CompareImage.created_at.desc(), CompareImage.id.desc())
            .all()
        )
        image_count = len(images)
        # Fallback to parent images if empty
        if not images and sess.parent_session_id:
            curr_id = sess.parent_session_id
            visited = {sess.id}
            while not images and curr_id and curr_id not in visited:
                visited.add(curr_id)
                parent = db.query(Session).filter(Session.id == curr_id).first()
                if not parent: break
                images = db.query(Image).filter(Image.session_id == parent.id).all()
                curr_id = parent.parent_session_id
            image_count = len(images)

        # Filter to images with URLs first, then take up to 3
        images_with_urls = [img for img in images if img.url]
        preview_images = [img.url for img in images_with_urls[:3]]
        existing = session_map.get(sess.id)
        if existing:
            existing["type"] = "compare"
            existing["prompt"] = sess.original_prompt or existing.get("prompt")
            existing["created_at"] = sess.created_at or existing.get("created_at")
            existing["image_count"] = max(existing.get("image_count", 0), image_count)
            existing["preview_images"] = list(dict.fromkeys(
                [*existing.get("preview_images", []), *preview_images]
            ))
            existing["latest_activity_at"] = max(
                _session_sort_key(existing.get("latest_activity_at") or existing.get("created_at")),
                _activity_sort_key(
                    sess.created_at,
                    *(img.created_at for img in images),
                )
            ).isoformat()
        else:
            session_map[sess.id] = {
                "id": sess.id,
                "type": "compare",
                "prompt": sess.original_prompt,
                "created_at": sess.created_at,
                "latest_activity_at": _activity_sort_key(
                    sess.created_at,
                    *(img.created_at for img in images),
                ).isoformat(),
                "image_count": image_count,
                "preview_images": preview_images
            }

    session_data = list(session_map.values())
    session_data.sort(
        key=lambda item: _session_sort_key(item.get("latest_activity_at") or item.get("created_at")),
        reverse=True
    )

    logger.warning(f"[API] Returning {len(session_data)} total sessions")
    return {"status": "success", "sessions": session_data}

@router.get("/{session_id}", response_model=Dict[str, Any])
async def get_session_details(
    session_id: str,
    db: DbSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get details for a specific session owned by the current user."""
    session = db.query(Session).filter(Session.id == session_id, Session.user_id == current_user.id).first()

    if session:
        all_images = []
        curr_session = session
        visited = {session.id}
        
        # Walk UP the parent chain (for when a child session is requested directly)
        while curr_session:
            curr_images = (
                db.query(Image)
                .filter(Image.session_id == curr_session.id)
                .order_by(Image.created_at.desc(), Image.id.desc())
                .all()
            )
            for img in curr_images:
                all_images.append({
                    "id": img.id, 
                    "url": img.url, 
                    "model_id": img.model_id, 
                    "status": img.status, 
                    "session_id": img.session_id,
                    "prompt": curr_session.prompt,
                    "ratio": curr_session.ratio if hasattr(curr_session, 'ratio') else None,
                    "quality": curr_session.quality if hasattr(curr_session, 'quality') else None,
                    "active_configs": _safe_json_parse(curr_session.active_configs, {}),
                    "created_at": img.created_at
                })
            
            if not curr_session.parent_session_id or curr_session.parent_session_id in visited:
                break
                
            visited.add(curr_session.parent_session_id)
            curr_session = db.query(Session).filter(Session.id == curr_session.parent_session_id).first()

        # Walk DOWN to child sessions (edits) — BFS so reload includes all edit results
        child_queue = [session.id]
        while child_queue:
            parent_id = child_queue.pop(0)
            children = (
                db.query(Session)
                .filter(Session.parent_session_id == parent_id)
                .order_by(Session.created_at.asc())
                .all()
            )
            for child in children:
                if child.id in visited:
                    continue
                visited.add(child.id)
                child_queue.append(child.id)
                child_images = (
                    db.query(Image)
                    .filter(Image.session_id == child.id)
                    .order_by(Image.created_at.desc(), Image.id.desc())
                    .all()
                )
                for img in child_images:
                    all_images.append({
                        "id": img.id,
                        "url": img.url,
                        "model_id": img.model_id,
                        "status": img.status,
                        "session_id": img.session_id,
                        "prompt": child.prompt,
                        "ratio": child.ratio if hasattr(child, 'ratio') else None,
                        "quality": child.quality if hasattr(child, 'quality') else None,
                        "active_configs": _safe_json_parse(child.active_configs, {}),
                        "created_at": img.created_at
                    })

        # Sort all images globally by created_at so edits bubble up to the top
        all_images.sort(key=lambda x: x.get("created_at") or "", reverse=True)
        image_data = all_images


        return {
            "status": "success",
            "session": {
                "id": session.id,
                "type": "session",
                "parent_session_id": session.parent_session_id,
                "prompt": session.prompt,
                "enhanced_prompt": session.enhanced_prompt if hasattr(session, 'enhanced_prompt') else None,
                "pipeline_type": session.pipeline_type if hasattr(session, 'pipeline_type') else None,
                "models": _safe_json_parse(session.models, []),
                "active_configs": _safe_json_parse(session.active_configs, {}),
                "created_at": session.created_at,
                "images": image_data
            }
        }

    compare_session = db.query(CompareSession).filter(
        CompareSession.id == session_id,
        CompareSession.user_id == current_user.id
    ).first()
    if not compare_session:
        raise HTTPException(status_code=404, detail="Session not found")

    images = (
        db.query(CompareImage)
        .filter(CompareImage.compare_session_id == session_id)
        .order_by(CompareImage.created_at.desc(), CompareImage.id.desc())
        .all()
    )

    image_data = [{"id": img.id, "url": img.url, "model_id": img.model_id, "status": img.status} for img in images]

    return {
        "status": "success",
        "session": {
            "id": compare_session.id,
            "type": "compare",
            "prompt": compare_session.original_prompt,
            "models": _safe_json_parse(compare_session.models, []),
            "ratio": compare_session.ratio,
            "quality": compare_session.quality,
            "active_configs": _safe_json_parse(compare_session.active_configs, {}),
            "created_at": compare_session.created_at,
            "images": image_data
        }
    }


@router.delete("/{session_id}", response_model=Dict[str, Any])
async def delete_session(
    session_id: str,
    db: DbSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Delete a session archive entry and all of its stored image rows."""
    session = db.query(Session).filter(Session.id == session_id).first()
    compare_session = db.query(CompareSession).filter(CompareSession.id == session_id).first()

    if not session and not compare_session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session and session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Session not found")
    if compare_session and compare_session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Session not found")

    deleted_types = []

    try:
        if session:
            db.query(Image).filter(Image.session_id == session_id).delete(synchronize_session=False)
            db.delete(session)
            deleted_types.append("session")

        if compare_session:
            db.query(CompareImage).filter(CompareImage.compare_session_id == session_id).delete(synchronize_session=False)
            db.delete(compare_session)
            deleted_types.append("compare")

        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete session: {e}")

    return {
        "status": "success",
        "id": session_id,
        "deleted_types": deleted_types
    }
