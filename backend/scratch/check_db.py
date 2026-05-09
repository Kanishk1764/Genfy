import sys
import os
sys.path.append(os.path.abspath('.'))

from database.db import engine, init_db
from sqlalchemy import inspect

def check():
    print("Running init_db...")
    try:
        init_db()
        print("init_db finished successfully.")
    except Exception as e:
        print("init_db failed with error:", e)
        return

    inspector = inspect(engine)
    print("Tables in DB:", inspector.get_table_names())
    
    if 'sessions' in inspector.get_table_names():
        columns = [col['name'] for col in inspector.get_columns('sessions')]
        print("Columns in 'sessions':", columns)
        for col in ['enhanced_prompt', 'pipeline_type']:
            if col in columns:
                print(f"  Column '{col}' exists.")
            else:
                print(f"  CRITICAL: Column '{col}' is MISSING!")
    else:
        print("ERROR: 'sessions' table does not exist!")

if __name__ == '__main__':
    check()
