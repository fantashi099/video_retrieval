import os
import yt_dlp
from src.celery_app import celery_app
from src.db import SessionLocal
from src.models import Video, Job, StatusEnum

TMP_DIR = "tmp/"

@celery_app.task(bind=True)
def download_video_task(self, video_url: str):
    print(f"Starting download task for {video_url}")
    os.makedirs(TMP_DIR, exist_ok=True)
    
    db = SessionLocal()
    # Create or get job
    job = Job(video_url=video_url, status=StatusEnum.PROCESSING)
    db.add(job)
    db.commit()
    db.refresh(job)
    
    try:
        ydl_opts = {
            'format': 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
            'outtmpl': os.path.join(TMP_DIR, '%(id)s.%(ext)s'),
            'quiet': False,
            'no_warnings': True,
            'restrictfilenames': True,
        }
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            # Extract info first
            info = ydl.extract_info(video_url, download=False)
            youtube_id = info.get('id')
            title = info.get('title')
            duration = info.get('duration')
            
            # Check for duplicate
            existing_video = db.query(Video).filter(Video.youtube_id == youtube_id).first()
            if existing_video:
                print(f"Video {youtube_id} already exists in database.")
                job.status = StatusEnum.INDEXED
                db.commit()
                return {"youtube_id": youtube_id, "status": "duplicate"}
            
            # Create video record
            video = Video(
                youtube_id=youtube_id,
                title=title,
                url=video_url,
                duration=duration,
                status=StatusEnum.PROCESSING
            )
            db.add(video)
            db.commit()
            
            # Download the video
            print(f"Downloading video {youtube_id}...")
            error_code = ydl.download([video_url])
            
            if error_code == 0:
                filepath = os.path.join(TMP_DIR, f"{youtube_id}.mp4")
                if os.path.exists(filepath):
                    print(f"Successfully downloaded to {filepath}")
                    video.status = StatusEnum.INDEXED
                    job.status = StatusEnum.INDEXED
                    db.commit()
                    return {"youtube_id": youtube_id, "status": "success", "filepath": filepath}
                else:
                    raise Exception("File not found after download")
            else:
                raise Exception(f"yt-dlp error code: {error_code}")
                
    except Exception as e:
        print(f"Error in download task: {str(e)}")
        job.status = StatusEnum.FAILED
        job.error_log = str(e)
        db.commit()
        raise e
    finally:
        db.close()
