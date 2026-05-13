from sqlalchemy.orm import Session
from database.models import User
from datetime import datetime, timedelta

def get_or_create_github_user(db: Session, github_data: dict):
    """
    Find existing user by email or create a new one using GitHub profile data.
    """
    email = github_data.get("email")
    github_id = str(github_data.get("id"))
    name = github_data.get("name") or github_data.get("login")
    avatar_url = github_data.get("avatar_url")

    if not email:
        # Fallback to github_id based email if none found (rare but possible)
        email = f"{github_id}@github.com"

    user = db.query(User).filter(User.email == email).first()
    
    if not user:
        # Create new user
        user = User(
            email=email,
            name=name,
            github_id=github_id,
            auth_provider='github',
            profile_picture=avatar_url,
            email_verified=True,
            created_at=datetime.utcnow(),
            role='user',
        )
        user.plan_type = "starter"
        user.is_trial = True
        user.trial_started_at = datetime.utcnow()
        user.trial_ends_at = datetime.utcnow() + timedelta(days=7)
        user.has_used_trial = True
        db.add(user)
    else:
        # Update existing user with GitHub info if not already linked
        if not user.github_id:
            user.github_id = github_id
        
        # Always update profile picture if available
        if avatar_url:
            user.profile_picture = avatar_url
            
        # Ensure auth_provider is set correctly if it was email
        if user.auth_provider == 'email':
            user.auth_provider = 'github'
            user.email_verified = True # GitHub verified emails are trusted

    db.commit()
    db.refresh(user)
    return user
