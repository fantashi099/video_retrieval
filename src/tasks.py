import os
import yt_dlp
import cv2
from transnetv2_pytorch import TransNetV2
import torch
import gc
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
                    
                    print("Triggering segment_video_task...")
                    segment_video_task.delay(filepath, youtube_id)
                    
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

@celery_app.task(bind=True)
def segment_video_task(self, video_path: str, youtube_id: str):
    print(f"Starting segmentation for {video_path}")
    if not os.path.exists(video_path):
        raise FileNotFoundError(f"Video file not found: {video_path}")

    print("Loading TransNetV2 model...")
    model = TransNetV2()
    
    # Get FPS
    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    cap.release()
    
    if fps <= 0:
        raise ValueError(f"Could not read FPS from {video_path}")

    # Run inference
    print("Running inference to detect scenes...")
    _, _, all_frame_predictions = model.predict_video(video_path)
    
    # Convert to scenes
    scenes_frames = model.predictions_to_scenes(all_frame_predictions.cpu().numpy()).tolist()
    
    scene_list = []
    for i, (start_frame, end_frame) in enumerate(scenes_frames):
        start_sec = start_frame / fps
        end_sec = end_frame / fps
        scene_list.append({
            "youtube_id": youtube_id,
            "scene_idx": i,
            "start_time": start_sec,
            "end_time": end_sec,
            "start_frame": start_frame,
            "end_frame": end_frame
        })
        
    print(f"Detected {len(scene_list)} scenes.")
    
    # Free VRAM
    import torch
    import gc
    del model
    torch.cuda.empty_cache()
    gc.collect()
    
    # TODO: Pass scene_list to embedding task
    # embed_segments_task.delay(scene_list, video_path, youtube_id)
    
    return {"youtube_id": youtube_id, "num_scenes": len(scene_list)}
