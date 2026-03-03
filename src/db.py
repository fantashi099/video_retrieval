import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from src.models import Base

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:password@localhost:5432/video_db")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def init_db():
    print("Creating database tables...")
    Base.metadata.create_all(bind=engine)
    print("Done!")

def reset_db():
    print("Dropping all database tables...")
    Base.metadata.drop_all(bind=engine)
    print("Recreating database tables...")
    Base.metadata.create_all(bind=engine)
    print("Done!")

if __name__ == "__main__":
    init_db()
