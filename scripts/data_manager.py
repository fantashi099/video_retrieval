import os
import sys
import pandas as pd
import torch
from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct, VectorParams, Distance
from sqlalchemy import create_engine
from datetime import datetime

# Standard Project paths
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(PROJECT_ROOT)

from src.db import SessionLocal, DATABASE_URL
from src.models import Video, Job, StatusEnum

QDRANT_HOST = 'localhost'
QDRANT_PORT = 6333
QDRANT_COLLECTION = "video_segments_siglip"

def export_data(output_dir="aura_export"):
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
    
    print(f"--- Exporting Data to {output_dir}/ ---")
    
    # 1. Export PostgreSQL Data
    print("Exporting SQL Database (Videos & Jobs)...")
    db = SessionLocal()
    try:
        # Export Videos
        videos = db.query(Video).all()
        video_data = [
            {
                "youtube_id": v.youtube_id,
                "title": v.title,
                "url": v.url,
                "status": v.status.value if v.status else None,
                "duration": v.duration,
                "created_at": v.created_at
            } for v in videos
        ]
        df_videos = pd.DataFrame(video_data)
        df_videos.to_parquet(os.path.join(output_dir, "videos.parquet"))
        print(f"Exported {len(videos)} videos.")
        
        # Export Jobs (Optional: maybe only status=INDEXED or all)
        jobs = db.query(Job).all()
        job_data = [
            {
                "id": str(j.id),
                "video_url": j.video_url,
                "video_name": j.video_name,
                "status": j.status.value if j.status else None,
                "error_log": j.error_log,
                "created_at": j.created_at,
                "updated_at": j.updated_at
            } for j in jobs
        ]
        df_jobs = pd.DataFrame(job_data)
        df_jobs.to_parquet(os.path.join(output_dir, "jobs.parquet"))
        print(f"Exported {len(jobs)} jobs.")
        
    finally:
        db.close()
        
    # 2. Export Qdrant Data
    print("Exporting Qdrant Collection (Vectors & Payloads)...")
    client = QdrantClient(QDRANT_HOST, port=QDRANT_PORT)
    
    all_points = []
    offset = None
    while True:
        res = client.scroll(
            collection_name=QDRANT_COLLECTION,
            limit=1000,
            with_payload=True,
            with_vectors=True,
            offset=offset
        )
        points, next_offset = res
        for p in points:
            row = p.payload.copy()
            row["id"] = p.id
            row["vector"] = p.vector
            all_points.append(row)
        
        if not next_offset:
            break
        offset = next_offset
        
    df_qdrant = pd.DataFrame(all_points)
    df_qdrant.to_parquet(os.path.join(output_dir, "vectors.parquet"))
    print(f"Exported {len(all_points)} vector points.")
    print("\nSUCCESS: All data exported to", output_dir)

def import_data(input_dir="aura_export"):
    if not os.path.exists(input_dir):
        print(f"ERROR: Export directory {input_dir} not found.")
        return

    print(f"--- Importing Data from {input_dir}/ ---")
    
    # 1. Restore PostgreSQL Data
    print("Restoring SQL Database...")
    df_videos = pd.read_parquet(os.path.join(input_dir, "videos.parquet"))
    df_jobs = pd.read_parquet(os.path.join(input_dir, "jobs.parquet"))
    
    db = SessionLocal()
    try:
        # Restore Videos
        for _, row in df_videos.iterrows():
            existing = db.query(Video).filter(Video.youtube_id == row["youtube_id"]).first()
            if not existing:
                v = Video(
                    youtube_id=row["youtube_id"],
                    title=row["title"],
                    url=row["url"],
                    status=StatusEnum(row["status"]) if row["status"] else None,
                    duration=row["duration"],
                    created_at=row["created_at"]
                )
                db.add(v)
        
        # Restore Jobs
        for _, row in df_jobs.iterrows():
            existing = db.query(Job).filter(Job.id == row["id"]).first()
            if not existing:
                j = Job(
                    id=row["id"],
                    video_url=row["video_url"],
                    video_name=row["video_name"],
                    status=StatusEnum(row["status"]) if row["status"] else None,
                    error_log=row["error_log"],
                    created_at=row["created_at"],
                    updated_at=row["updated_at"]
                )
                db.add(j)
        db.commit()
        print(f"Restored SQL records ({len(df_videos)} videos, {len(df_jobs)} jobs).")
    finally:
        db.close()
        
    # 2. Restore Qdrant Data
    print("Restoring Qdrant Collection...")
    df_qdrant = pd.read_parquet(os.path.join(input_dir, "vectors.parquet"))
    client = QdrantClient(QDRANT_HOST, port=QDRANT_PORT)
    
    # Ensure collection exists
    try:
        client.get_collection(QDRANT_COLLECTION)
    except Exception:
        print(f"Creating collection {QDRANT_COLLECTION}...")
        client.create_collection(
            collection_name=QDRANT_COLLECTION,
            vectors_config=VectorParams(size=768, distance=Distance.COSINE)
        )
    
    points = []
    for _, row in df_qdrant.iterrows():
        payload = {k: v for k, v in row.to_dict().items() if k not in ["id", "vector"]}
        points.append(PointStruct(
            id=row["id"],
            vector=row["vector"].tolist(),
            payload=payload
        ))
        
        # Upsert in batches
        if len(points) >= 100:
            client.upsert(collection_name=QDRANT_COLLECTION, points=points)
            points = []
            
    if points:
        client.upsert(collection_name=QDRANT_COLLECTION, points=points)
        
    print(f"Restored {len(df_qdrant)} vector points.")
    print("\nSUCCESS: All data imported from", input_dir)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python data_manager.py [export|import] [directory]")
        sys.exit(1)
        
    cmd = sys.argv[1].lower()
    dir_path = sys.argv[2] if len(sys.argv) > 2 else "aura_export"
    
    if cmd == "export":
        export_data(dir_path)
    elif cmd == "import":
        import_data(dir_path)
    else:
        print(f"Unknown command: {cmd}")
