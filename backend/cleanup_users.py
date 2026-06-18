#!/usr/bin/env python
import sys
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Setup database - import all models to resolve relationships
from database.db import SessionLocal, init_db
from database.models import User
from database.storyboard_models import Storyboard

# IDs to keep
KEEP_USER_IDS = [
    "b08d8b89-e01b-4931-b67a-dc1dc2f27359",
    "53d50aab-40f6-491c-a993-8a7736dcf34d",
    "406869f3-3703-42b1-ac41-cccd42347b06"
]

def cleanup_database():
    print("Connecting to database...")
    init_db()
    db = SessionLocal()
    
    try:
        # Find all users NOT in the KEEP_USER_IDS list
        users_to_delete = db.query(User).filter(User.id.notin_(KEEP_USER_IDS)).all()
        
        if not users_to_delete:
            print("No users found to delete. The database only contains the kept users.")
            return

        print(f"Found {len(users_to_delete)} users to delete. Proceeding with deletion...")
        
        deleted_count = 0
        for user in users_to_delete:
            print(f"Deleting user: {user.email} (ID: {user.id}) and all associated data...")
            # SQLAlchemy will cascade delete sessions, images, and storyboards automatically
            db.delete(user)
            deleted_count += 1
            
        print("Committing changes to the database...")
        db.commit()
        print(f"Successfully deleted {deleted_count} users and completely freed up their storage!")
        
    except Exception as e:
        db.rollback()
        print(f"Error during cleanup: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    cleanup_database()
