"""
Celery 应用配置
后台任务队列
"""
from celery import Celery
from celery.schedules import crontab

from app.config import settings

# 创建 Celery 应用
celery_app = Celery(
    "contentguard",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=["app.tasks.review", "app.tasks.xhs_batch"],
)

# 配置
celery_app.conf.update(
    # 任务序列化
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",

    # 时区
    timezone="Asia/Shanghai",
    enable_utc=True,

    # 任务配置
    task_track_started=True,
    task_time_limit=600,  # 10 分钟超时
    task_soft_time_limit=540,  # 9 分钟软超时

    # 结果配置
    result_expires=3600,  # 结果保留 1 小时

    # 并发配置
    worker_prefetch_multiplier=1,
    worker_concurrency=4,

    # 重试配置
    task_acks_late=True,
    task_reject_on_worker_lost=True,

    # 路由配置
    task_routes={
        "app.tasks.review.*": {"queue": "review"},
        "app.tasks.xhs_batch.*": {"queue": "xhs_batch"},
    },
    task_annotations={
        "app.tasks.xhs_batch.process_xhs_batch_item_task": {
            "soft_time_limit": 1140,
            "time_limit": 1200,
        },
        "app.tasks.xhs_batch.process_xhs_batch_job_task": {
            "soft_time_limit": 1140,
            "time_limit": 1200,
        },
    },

    # 队列配置
    task_default_queue="default",

    # 定时任务
    beat_schedule={
        # 每小时清理过期临时文件
        "cleanup-old-files": {
            "task": "app.tasks.review.cleanup_old_files_task",
            "schedule": crontab(minute=0),  # 每小时整点执行
        },
    },
)
