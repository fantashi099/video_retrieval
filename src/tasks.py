import os
import yt_dlp
import cv2
from transnetv2_pytorch import TransNetV2
import torch
import gc
from src.celery_app import celery_app
from src.db import SessionLocal
from src.models import Video, Job, StatusEnum
from datetime import datetime, timezone, timedelta

TMP_DIR = "tmp/"

@celery_app.task(bind=True)
def download_video_task(self, video_url: str, job_id: str = None, video_name: str = None):
    print(f"Starting download task for {video_url} (Job: {job_id}, Name: {video_name})")
    os.makedirs(TMP_DIR, exist_ok=True)
    
    db = SessionLocal()
    
    if job_id:
        job = db.query(Job).filter(Job.id == job_id).first()
        if not job:
            print(f"Warning: Job {job_id} not found in DB.")
            job = Job(id=job_id, video_url=video_url, video_name=video_name, status=StatusEnum.PROCESSING)
            db.add(job)
    else:
        # Fallback if called directly without job_id
        job = Job(video_url=video_url, video_name=video_name, status=StatusEnum.PROCESSING)
        db.add(job)
        
    db.commit()
    db.refresh(job)
    
    try:
        ydl_opts = {
            'format': 'bestvideo[ext=mp4][vcodec^=avc1][height<=720]+bestaudio[ext=m4a]/best[ext=mp4]/best',
            'outtmpl': os.path.join(TMP_DIR, '%(id)s.%(ext)s'),
            'quiet': False,
            'no_warnings': True,
            'restrictfilenames': True,
        }
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(video_url, download=False)
            youtube_id = info.get('id')
            title = video_name if video_name else info.get('title')
            duration = info.get('duration')
            
            # Check for duplicate
            existing_video = db.query(Video).filter(Video.youtube_id == youtube_id).first()
            if existing_video:
                if existing_video.status == StatusEnum.INDEXED:
                    print(f"Video {youtube_id} already exists and is fully indexed.")
                    job.status = StatusEnum.INDEXED
                    db.commit()
                    return {"youtube_id": youtube_id, "status": "duplicate"}
                else:
                    print(f"Video {youtube_id} exists but is {existing_video.status}. Restarting processing...")
                    video = existing_video
                    video.status = StatusEnum.PROCESSING
                    db.commit()
            else:
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
            
            print(f"Downloading video {youtube_id}...")
            error_code = ydl.download([video_url])
            
            if error_code == 0:
                filepath = os.path.join(TMP_DIR, f"{youtube_id}.mp4")
                if os.path.exists(filepath):
                    print(f"Successfully downloaded to {filepath}")
                    # Update status to segmenting
                    video.status = StatusEnum.PROCESSING
                    job.status = StatusEnum.PROCESSING
                    job.error_log = "Downloading complete. Segmenting video..."
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

    
    # Dynamic VRAM Management: TransNetV2 uses a lot of memory for big videos.
    # If the system has very low free VRAM (< 2.5 GB), we force TransNet to use the CPU
    # which is slower but prevents Out-Of-Memory (OOM) crashes.
    device = 'auto'
    if torch.cuda.is_available():
        free_mem, total_mem = torch.cuda.mem_get_info()
        print(f"GPU VRAM Status: {free_mem / 1024**3:.2f} GB free out of {total_mem / 1024**3:.2f} GB max")
        if free_mem < 2.5 * 1024 * 1024 * 1024:  # 2.5 GB threshold
            print("WARNING: Low VRAM detected! Forcing TransNetV2 to CPU mode to prevent OOM crash.")
            device = 'cpu'
            
    print(f"Loading TransNetV2 model on device: {device}...")
    model = TransNetV2(device=device)
    
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
    del model
    torch.cuda.empty_cache()
    gc.collect()
    
    # Trigger embedding task
    print("Triggering embed_segments_task...")
    embed_segments_task.delay(scene_list, video_path, youtube_id)
    
    return {"youtube_id": youtube_id, "num_scenes": len(scene_list)}

@celery_app.task(bind=True)
def embed_segments_task(self, scene_list: list, video_path: str, youtube_id: str):
    print(f"Starting embedding task for {len(scene_list)} scenes from {youtube_id}")
    import grpc
    from src.protos import model_service_pb2, model_service_pb2_grpc

    cap = cv2.VideoCapture(video_path)
    
    vectors = []
    images_bytes = []
    valid_scenes = []
    
    for scene in scene_list:
        start_frame = scene["start_frame"]
        end_frame = scene["end_frame"]
        
        mid_frame = start_frame + (end_frame - start_frame) // 2
        cap.set(cv2.CAP_PROP_POS_FRAMES, mid_frame)
        ret, frame = cap.read()
        
        if not ret:
            print(f"Warning: Could not read frame {mid_frame}")
            continue
            
        _, buffer = cv2.imencode('.jpg', frame)
        images_bytes.append(buffer.tobytes())
        valid_scenes.append(scene)

    cap.release()
    
    if not images_bytes:
        print(f"Error: Generated 0 embeddings for {youtube_id}. Video might be unreadable.")
        return {"youtube_id": youtube_id, "embeddings_count": 0, "status": "failed"}

    print(f"Sending {len(images_bytes)} frames to ModelService over gRPC...")
    options = [
        ('grpc.max_send_message_length', 100 * 1024 * 1024),
        ('grpc.max_receive_message_length', 100 * 1024 * 1024)
    ]
    with grpc.insecure_channel('localhost:50052', options=options) as channel:
        stub = model_service_pb2_grpc.ModelServiceStub(channel)
        req = model_service_pb2.EmbedImageBatchRequest(image_data_list=images_bytes)
        res = stub.EmbedImageBatch(req)
        
    if len(res.embeddings) != len(valid_scenes):
        print("Error: Mismatch in number of embeddings returned from ModelService.")
        return {"youtube_id": youtube_id, "embeddings_count": 0, "status": "failed"}
        
    for scene, emb_obj in zip(valid_scenes, res.embeddings):
        vectors.append({
            "scene_idx": scene["scene_idx"],
            "start_time": scene["start_time"],
            "end_time": scene["end_time"],
            "vector": list(emb_obj.vector)
        })

    print(f"Successfully generated {len(vectors)} embeddings (Dimension: {len(vectors[0]['vector'])}).")

    # Trigger Vector Storage Task
    print("Triggering store_vectors_task...")
    store_vectors_task.delay(vectors, youtube_id)

    return {"youtube_id": youtube_id, "embeddings_count": len(vectors)}

@celery_app.task(bind=True)
def store_vectors_task(self, vectors: list, youtube_id: str):
    print(f"Starting vector storage task for {youtube_id} ({len(vectors)} vectors)")
    
    from qdrant_client import QdrantClient
    from qdrant_client.models import PointStruct, VectorParams, Distance
    import uuid
    
    QDRANT_HOST = os.getenv("QDRANT_HOST", "localhost")
    QDRANT_PORT = int(os.getenv("QDRANT_PORT", 6333))
    COLLECTION_NAME = "video_segments_siglip"
    
    client = QdrantClient(QDRANT_HOST, port=QDRANT_PORT)
    
    vector_size = len(vectors[0]["vector"]) if vectors else 512
    
    if not client.collection_exists(COLLECTION_NAME):
        print(f"Creating collection '{COLLECTION_NAME}' with size {vector_size}...")
        client.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=VectorParams(size=vector_size, distance=Distance.COSINE),
        )
        
    # Mark job and video as fully INDEXED
    db = SessionLocal()
    try:
        vid_record = db.query(Video).filter(Video.youtube_id == youtube_id).first()
        video_name = vid_record.title if vid_record else "Unknown"
        video_url = vid_record.url if vid_record else ""

        points = []
        for point in vectors:
            point_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{youtube_id}_{point['scene_idx']}"))
            
            payload = {
                "youtube_id": youtube_id,
                "video_name": video_name,
                "url": video_url,
                "scene_idx": point["scene_idx"],
                "start_time": point["start_time"],
                "end_time": point["end_time"]
            }
            
            points.append(
                PointStruct(id=point_id, vector=point["vector"], payload=payload)
            )
            
        print(f"Uploading {len(points)} points to Qdrant...")
        operation_info = client.upsert(
            collection_name=COLLECTION_NAME,
            wait=True,
            points=points
        )
        
        print(f"Upload finished. Status: {operation_info.status}")
        
        # Mark ALL matching jobs as INDEXED (handles re-ingestion duplicates)
        matching_jobs = db.query(Job).filter(Job.video_url.contains(youtube_id)).all()
        for job in matching_jobs:
            job.status = StatusEnum.INDEXED
            job.error_log = "Success"
        vid = db.query(Video).filter(Video.youtube_id == youtube_id).first()
        if vid:
            vid.status = StatusEnum.INDEXED
        db.commit()
    finally:
        db.close()
    
    return {"youtube_id": youtube_id, "status": operation_info.status, "points_inserted": len(points)}

@celery_app.task
def fail_stuck_jobs_task():
    db = SessionLocal()
    try:
        # Define timeout for stuck tasks (1 hour)
        timeout_threshold = datetime.now(timezone.utc) - timedelta(hours=1)
        
        stuck_jobs = db.query(Job).filter(
            Job.status == StatusEnum.PROCESSING,
            Job.updated_at < timeout_threshold
        ).all()
        
        count = 0
        for job in stuck_jobs:
            job.status = StatusEnum.FAILED
            job.error_log = "Watchdog: Job timed out (worker crashed or hung)."
            count += 1
            
        if count > 0:
            db.commit()
            print(f"Watchdog marked {count} stuck jobs as FAILED.")
    except Exception as e:
        print(f"Watchdog error: {e}")
    finally:
        db.close()
