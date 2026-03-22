from sqlalchemy import Column, String, Integer, Enum, DateTime, Text, create_engine
from sqlalchemy.orm import declarative_base
from sqlalchemy.dialects.postgresql import UUID
import uuid
import enum
from datetime import datetime, timezone

Base = declarative_base()

class StatusEnum(enum.Enum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    INDEXED = "INDEXED"
    FAILED = "FAILED"

class Video(Base):
    __tablename__ = 'videos'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    youtube_id = Column(String, unique=True, nullable=False)
    title = Column(String, nullable=True)
    url = Column(String, nullable=False)
    duration = Column(Integer, nullable=True)
    status = Column(Enum(StatusEnum), default=StatusEnum.PENDING)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

class Job(Base):
    __tablename__ = 'jobs'

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    video_url = Column(String, nullable=False)
    video_name = Column(String, nullable=True)
    status = Column(Enum(StatusEnum), default=StatusEnum.PENDING)
    error_log = Column(Text, nullable=True)
    retry_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
