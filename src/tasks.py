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
def download_video_task(self, video_url: str, job_id: str, video_name: str = None, force: bool = False):
    db = SessionLocal()
    try:
        job = db.query(Job).filter(Job.id == job_id).first()
        if not job:
            return {"error": "Job not found"}
        
        job.status = StatusEnum.PROCESSING
        job.error_log = "Processing started..."
        db.commit()

        # Extract info
        import yt_dlp
        ydl_opts_info = {'quiet': True, 'no_warnings': True}
        with yt_dlp.YoutubeDL(ydl_opts_info) as ydl:
            info = ydl.extract_info(video_url, download=False)
            youtube_id = info.get('id', None)
            title = video_name if video_name else info.get('title', 'Unknown')
            duration = info.get('duration', 0)

        if not youtube_id:
            raise Exception("Could not extract YouTube ID")

        # Handle forced re-ingestion
        if force:
            print(f"FORCED: Wiping old vectors for {youtube_id}...")
            from qdrant_client import QdrantClient
            from qdrant_client.models import Filter, FieldCondition, MatchValue
            client = QdrantClient("localhost", port=6333)
            try:
                client.delete(
                    collection_name="video_segments_siglip",
                    points_selector=Filter(
                        must=[FieldCondition(key="youtube_id", match=MatchValue(value=youtube_id))]
                    )
                )
            except Exception as e:
                print(f"Qdrant delete failed: {e}")

        # Sync database record
        existing_video = db.query(Video).filter(Video.youtube_id == youtube_id).first()
        if existing_video:
            if existing_video.status == StatusEnum.INDEXED and not force:
                job.status = StatusEnum.INDEXED
                db.commit()
                return {"youtube_id": youtube_id, "status": "duplicate"}
            
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

        # Download
        print(f"Downloading video {youtube_id}...")
        ydl_opts_dl = {
            'format': 'bestvideo[ext=mp4][vcodec^=avc1][height<=720]+bestaudio[ext=m4a]/best[ext=mp4]/best',
            'outtmpl': os.path.join(TMP_DIR, f'{youtube_id}.%(ext)s'),
            'quiet': True,
            'no_warnings': True,
            'restrictfilenames': True,
        }
        with yt_dlp.YoutubeDL(ydl_opts_dl) as ydl:
            error_code = ydl.download([video_url])
            
        if error_code != 0:
            raise Exception(f"yt-dlp error code: {error_code}")

        filepath = os.path.join(TMP_DIR, f"{youtube_id}.mp4")
        if not os.path.exists(filepath):
            raise Exception("File not found after download")

        # Move to segmentation
        job.error_log = "Downloading complete. Segmenting video..."
        db.commit()
        segment_video_task.delay(filepath, youtube_id, job_id)
        return {"youtube_id": youtube_id, "status": "processing"}

    except Exception as e:
        print(f"ERROR: {str(e)}")
        if job:
            job.status = StatusEnum.FAILED
            job.error_log = str(e)
            db.commit()
        raise e
    finally:
        db.close()

@celery_app.task(bind=True)
def segment_video_task(self, video_path: str, youtube_id: str, job_id: str = None):
    print(f"Starting segmentation for {video_path}")
    db = SessionLocal()
    job = None
    if job_id:
        job = db.query(Job).filter(Job.id == job_id).first()

    try:
        if not os.path.exists(video_path):
            raise FileNotFoundError(f"Video file not found: {video_path}")

        if job:
            job.error_log = "Segmenting video (TransNetV2)..."
            db.commit()

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
        
        # Edge Case: Zero-segment fallback
        if len(scenes_frames) == 0:
            print("WARNING: TransNetV2 found 0 scenes. Falling back to fixed 10s intervals.")
            cap_fallback = cv2.VideoCapture(video_path)
            total_frames = int(cap_fallback.get(cv2.CAP_PROP_FRAME_COUNT))
            cap_fallback.release()
            interval_frames = int(fps * 10)
            scenes_frames = [
                [i, min(i + interval_frames - 1, total_frames - 1)]
                for i in range(0, total_frames, interval_frames)
            ]
        
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
        
        if job:
            job.error_log = f"Segmentation complete ({len(scene_list)} scenes). Starting metadata extraction..."
            db.commit()

        # Trigger metadata extraction task
        print("Triggering extract_metadata_task...")
        extract_metadata_task.delay(scene_list, video_path, youtube_id, job_id)
        
        return {"youtube_id": youtube_id, "num_scenes": len(scene_list)}
    except Exception as e:
        print(f"ERROR in segment_video_task: {str(e)}")
        if job:
            job.status = StatusEnum.FAILED
            job.error_log = f"Segmentation failed: {str(e)}"
            db.commit()
        raise e
    finally:
        db.close()

@celery_app.task(bind=True)
def extract_metadata_task(self, scene_list: list, video_path: str, youtube_id: str, job_id: str = None):
    print(f"Starting metadata extraction (OCR, ASR, YOLO) for {youtube_id}...")
    db = SessionLocal()
    job = None
    if job_id:
        job = db.query(Job).filter(Job.id == job_id).first()

    try:
        import gc
        import cv2
        import torch

        # Update status
        if job:
            job.error_log = "Extracting Audio Transcription (Whisper)..."
            db.commit()
        
        # 1. ASR (faster-whisper)
        print(f"Loading faster-whisper (CPU) for {youtube_id}...")
        from faster_whisper import WhisperModel
        # Whisper model is kept on CPU to save VRAM for visual models
        whisper_model = WhisperModel("base", device="cpu", compute_type="int8")
        segments, info = whisper_model.transcribe(video_path, beam_size=5)
        
        asr_segments = list(segments)
        del whisper_model
        gc.collect()

        # Dynamic VRAM check for Visual Models
        use_gpu = False
        if torch.cuda.is_available():
            free_mem, _ = torch.cuda.mem_get_info()
            if free_mem > 1.5 * 1024 * 1024 * 1024:  # 1.5 GB threshold
                use_gpu = True
        
        device_str = "GPU" if use_gpu else "CPU"
        if job:
            job.error_log = f"Extracting Visual Metadata (OCR & YOLO) on {device_str}..."
            db.commit()
        
        # 2. OCR (easyocr) & YOLO (ultralytics)
        print(f"Loading EasyOCR ({device_str}) and YOLOv8n ({device_str})...")
        import easyocr
        from ultralytics import YOLO
        import logging
        logging.getLogger("ultralytics").setLevel(logging.WARNING)
        
        reader = easyocr.Reader(['en'], gpu=use_gpu, verbose=False)
        yolo_model = YOLO('yolov8n.pt')
        if use_gpu:
            yolo_model.to('cuda')
        
        cap = cv2.VideoCapture(video_path)
        total_scenes = len(scene_list)
        
        for i, scene in enumerate(scene_list):
            # Update progress every 5 scenes for better feedback
            if i % 5 == 0 and job:
                job.error_log = f"Processing Scene {i+1}/{total_scenes} (OCR & Objects)..."
                db.commit()

            # Match ASR text to scene boundaries
            scene_asr_text = []
            for s in asr_segments:
                if s.end >= scene["start_time"] and s.start <= scene["end_time"]:
                    scene_asr_text.append(s.text.strip())
            scene["asr_text"] = " ".join(scene_asr_text)
            
            # Extract mid frame for OCR and YOLO
            mid_frame_idx = int(scene["start_frame"] + (scene["end_frame"] - scene["start_frame"]) // 2)
            cap.set(cv2.CAP_PROP_POS_FRAMES, mid_frame_idx)
            ret, frame = cap.read()
            
            if ret:
                # OCR
                ocr_results = reader.readtext(frame, detail=0)
                scene["ocr_text"] = " ".join(ocr_results)
                
                # YOLO
                results = yolo_model(frame, verbose=False)
                tags = set()
                for r in results:
                    for c in r.boxes.cls:
                        tags.add(r.names[int(c)])
                scene["tags"] = list(tags)
            else:
                scene["ocr_text"] = ""
                scene["tags"] = []
                
        cap.release()
        del reader
        del yolo_model
        torch.cuda.empty_cache()
        gc.collect()
        
        if job:
            job.error_log = "Metadata extraction complete. Generating embeddings..."
            db.commit()

        print("Metadata extraction complete. Triggering embed_segments_task...")
        embed_segments_task.delay(scene_list, video_path, youtube_id, job_id)
        return {"youtube_id": youtube_id, "status": "metadata_extracted"}
    except Exception as e:
        print(f"ERROR in extract_metadata_task: {str(e)}")
        if job:
            job.status = StatusEnum.FAILED
            job.error_log = f"Metadata extraction failed: {str(e)}"
            db.commit()
        raise e
    finally:
        db.close()

@celery_app.task(bind=True)
def embed_segments_task(self, scene_list: list, video_path: str, youtube_id: str, job_id: str = None):
    print(f"Starting embedding task for {len(scene_list)} scenes from {youtube_id}")
    db = SessionLocal()
    job = None
    if job_id:
        job = db.query(Job).filter(Job.id == job_id).first()

    try:
        import grpc
        from src.protos import model_service_pb2, model_service_pb2_grpc

        if job:
            job.error_log = f"Preparing {len(scene_list)} frames for embedding..."
            db.commit()

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
            raise Exception("Generated 0 embeddings. Video unreadable.")

        if job:
            job.error_log = f"Generating embeddings via ModelService (VRAM-heavy)..."
            db.commit()

        print(f"Sending {len(images_bytes)} frames to ModelService...")
        options = [
            ('grpc.max_send_message_length', 100 * 1024 * 1024),
            ('grpc.max_receive_message_length', 100 * 1024 * 1024)
        ]
        with grpc.insecure_channel('localhost:50052', options=options) as channel:
            stub = model_service_pb2_grpc.ModelServiceStub(channel)
            req = model_service_pb2.EmbedImageBatchRequest(image_data_list=images_bytes)
            res = stub.EmbedImageBatch(req)
            
        if len(res.embeddings) != len(valid_scenes):
            raise Exception(f"Embedding count mismatch: expected {len(valid_scenes)}, got {len(res.embeddings)}")
            
        for scene, emb_obj in zip(valid_scenes, res.embeddings):
            vectors.append({
                "scene_idx": scene["scene_idx"],
                "start_time": scene["start_time"],
                "end_time": scene["end_time"],
                "ocr_text": scene.get("ocr_text", ""),
                "asr_text": scene.get("asr_text", ""),
                "tags": scene.get("tags", []),
                "vector": list(emb_obj.vector)
            })

        if job:
            job.error_log = f"Embeddings generated ({len(vectors)}). Storing in Qdrant..."
            db.commit()

        # Trigger Vector Storage Task
        print("Triggering store_vectors_task...")
        store_vectors_task.delay(vectors, youtube_id, job_id)

        return {"youtube_id": youtube_id, "embeddings_count": len(vectors)}
    except Exception as e:
        print(f"ERROR in embed_segments_task: {str(e)}")
        if job:
            job.status = StatusEnum.FAILED
            job.error_log = f"Embedding failed: {str(e)}"
            db.commit()
        raise e
    finally:
        db.close()

@celery_app.task(bind=True)
def store_vectors_task(self, vectors: list, youtube_id: str, job_id: str = None):
    print(f"Starting vector storage task for {youtube_id} ({len(vectors)} vectors)")
    db = SessionLocal()
    job = None
    if job_id:
        job = db.query(Job).filter(Job.id == job_id).first()

    try:
        from qdrant_client import QdrantClient
        from qdrant_client.models import PointStruct, VectorParams, Distance
        import uuid
        
        QDRANT_HOST = os.getenv("QDRANT_HOST", "localhost")
        QDRANT_PORT = int(os.getenv("QDRANT_PORT", 6333))
        COLLECTION_NAME = "video_segments_siglip"
        
        client = QdrantClient(QDRANT_HOST, port=QDRANT_PORT)
        
        vector_size = len(vectors[0]["vector"]) if vectors else 768
        
        if not client.collection_exists(COLLECTION_NAME):
            print(f"Creating collection '{COLLECTION_NAME}' with size {vector_size}...")
            client.create_collection(
                collection_name=COLLECTION_NAME,
                vectors_config=VectorParams(size=vector_size, distance=Distance.COSINE),
            )
            
            from qdrant_client.models import TextIndexParams, TokenizerType
            client.create_payload_index(COLLECTION_NAME, "ocr_text", TextIndexParams(type="text", tokenizer=TokenizerType.WORD, lowercase=True))
            client.create_payload_index(COLLECTION_NAME, "asr_text", TextIndexParams(type="text", tokenizer=TokenizerType.WORD, lowercase=True))
            client.create_payload_index(COLLECTION_NAME, "tags", "keyword")
            
        vid_record = db.query(Video).filter(Video.youtube_id == youtube_id).first()
        video_name = vid_record.title if vid_record else "Unknown"

        points = []
        for point in vectors:
            point_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{youtube_id}_{point['scene_idx']}"))
            segment_url = f"https://youtube.com/watch?v={youtube_id}&t={int(point['start_time'])}"
            
            payload = {
                "youtube_id": youtube_id,
                "video_name": video_name,
                "url": segment_url,
                "scene_idx": point["scene_idx"],
                "start_time": point["start_time"],
                "end_time": point["end_time"],
                "ocr_text": point.get("ocr_text", ""),
                "asr_text": point.get("asr_text", ""),
                "tags": point.get("tags", [])
            }
            points.append(PointStruct(id=point_id, vector=point["vector"], payload=payload))
            
        print(f"Uploading {len(points)} points to Qdrant...")
        client.upsert(collection_name=COLLECTION_NAME, wait=True, points=points)

        # Mark job and video as fully INDEXED
        if vid_record:
            vid_record.status = StatusEnum.INDEXED
        if job:
            job.status = StatusEnum.INDEXED
            job.error_log = "Success"
        db.commit()

        # Cleanup video file if it exists
        filepath = os.path.join(TMP_DIR, f"{youtube_id}.mp4")
        if os.path.exists(filepath):
            os.remove(filepath)
            print(f"Cleaned up {filepath}")

        return {"youtube_id": youtube_id, "status": "success"}
    except Exception as e:
        print(f"ERROR in store_vectors_task: {str(e)}")
        if job:
            job.status = StatusEnum.FAILED
            job.error_log = f"Storage failed: {str(e)}"
            db.commit()
        raise e
    finally:
        db.close()

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
