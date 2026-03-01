from src.tasks import download_video_task

if __name__ == "__main__":
    url = "https://www.youtube.com/watch?v=aqz-KE-bpKQ"
    print(f"Enqueueing download for {url}")

    result = download_video_task.delay(url)
    
    print(f"Task dispatched with ID: {result.id}")
    print("Check the Celery worker logs to see the progress!")
