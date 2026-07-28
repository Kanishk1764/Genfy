#!/usr/bin/env python
"""Create a superadmin user in the database"""
import sys
import os
from datetime import datetime, timedelta
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Setup database - import all models to resolve relationships
from database.db import SessionLocal, init_db
from database.models import User
# Import storyboard models to resolve relationships
from database.storyboard_models import Storyboard, StoryboardCharacter, StoryboardFrame, StoryboardProduct
from utils.auth import hash_password
import uuid

def create_superadmin():
    """Create a superadmin user"""
    
    # Initialize database
    init_db()
    
    # Superadmin credentials
    email = "anoop@genfy.app"
    password = "Genfy@Admin123!Secure"
    name = "Anoop Dixit"
    
    # Create session
    db = SessionLocal()
    
    try:
        # Check if user already exists
        existing_user = db.query(User).filter(User.email == email).first()
        if existing_user:
            print(f"❌ Superadmin user with email '{email}' already exists!")
            print(f"   User ID: {existing_user.id}")
            print(f"   Role: {existing_user.role}")
            return
        
        # Create superadmin user
        superadmin = User(
            id=str(uuid.uuid4()),
            email=email,
            name=name,
            password_hash=hash_password(password),
            role='admin',  # superadmin role
            user_type='admin',
            email_verified=True,
            auth_provider='email',
            plan_type='enterprise',
            payment_status='completed',
            is_trial=False,
            token_balance=1000000000,  # Unlimited tokens
            created_at=datetime.utcnow()
        )
        
        db.add(superadmin)
        db.commit()
        db.refresh(superadmin)
        
        print("✅ Superadmin user created successfully!")
        print("\n" + "="*50)
        print("SUPERADMIN CREDENTIALS")
        print("="*50)
        print(f"Email:    {email}")
        print(f"Password: {password}")
        print(f"User ID:  {superadmin.id}")
        print(f"Role:     {superadmin.role}")
        print("="*50)
        print("\n⚠️  IMPORTANT:")
        print("- Save these credentials securely")
        print("- Change the password after first login")
        print("- Store in a password manager")
        
    except Exception as e:
        print(f"❌ Error creating superadmin: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    create_superadmin()
