import os
from celery import Celery

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

celery_app = Celery(
    "video_retrieval",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=['src.tasks']
)

celery_app.conf.update(
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='UTC',
    enable_utc=True,
    # Recycle workers after every task to forcefully release GPU VRAM/CUDA context
    worker_max_tasks_per_child=1,
    # Disable prefetching to ensure VRAM is only used when a task is actually running
    worker_prefetch_multiplier=1,
)

from celery.schedules import crontab
celery_app.conf.beat_schedule = {
    'fail-stuck-jobs': {
        'task': 'src.tasks.fail_stuck_jobs_task',
        'schedule': crontab(minute='*/5'),
    },
}
