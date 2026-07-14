"""FastAPI 应用入口"""
import asyncio
from datetime import datetime, timezone, timedelta
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from sqlalchemy import select
from app.config import settings
from app.logging_config import setup_logging
from app.middleware.rate_limit import RateLimitMiddleware
from app.api import health, auth, upload, scripts, videos, tasks, rules, ai_config, sse, projects, briefs, organizations, dashboard, export, profile, messages, brand_learning, reports, xhs, operator

# Initialize logging
logger = setup_logging()

# 环境判断
_is_production = settings.ENVIRONMENT == "production"
XHS_BATCH_RECOVERY_INTERVAL_SECONDS = 60

# 创建应用（生产环境禁用 API 文档）
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="AI 营销内容合规审核平台 API",
    docs_url=None if _is_production else "/docs",
    redoc_url=None if _is_production else "/redoc",
)

# CORS 配置（从环境变量读取允许的来源）
_cors_origins = [
    origin.strip()
    for origin in settings.CORS_ORIGINS.split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "X-Requested-With"],
)


# Security headers middleware
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        if _is_production:
            response.headers["Strict-Transport-Security"] = (
                "max-age=63072000; includeSubDomains; preload"
            )
        return response


app.add_middleware(SecurityHeadersMiddleware)

# Rate limiting (仅生产环境启用)
if _is_production:
    app.add_middleware(RateLimitMiddleware, default_limit=60, window_seconds=60)

# 注册路由
app.include_router(health.router, prefix="/api/v1")
app.include_router(auth.router, prefix="/api/v1")
app.include_router(upload.router, prefix="/api/v1")
app.include_router(scripts.router, prefix="/api/v1")
app.include_router(videos.router, prefix="/api/v1")
app.include_router(tasks.router, prefix="/api/v1")
app.include_router(rules.router, prefix="/api/v1")
app.include_router(ai_config.router, prefix="/api/v1")
app.include_router(sse.router, prefix="/api/v1")
app.include_router(projects.router, prefix="/api/v1")
app.include_router(briefs.router, prefix="/api/v1")
app.include_router(organizations.router, prefix="/api/v1")
app.include_router(dashboard.router, prefix="/api/v1")
app.include_router(export.router, prefix="/api/v1")
app.include_router(profile.router, prefix="/api/v1")
app.include_router(messages.router, prefix="/api/v1")
app.include_router(brand_learning.router, prefix="/api/v1")
app.include_router(reports.router, prefix="/api/v1")
app.include_router(xhs.router, prefix="/api/v1")
app.include_router(operator.router, prefix="/api/v1")


async def _recover_stuck_ai_review_tasks():
    """
    启动时恢复卡在 AI 审核阶段的任务

    当 uvicorn --reload 或进程重启时，asyncio.create_task 创建的后台 AI 审核
    协程会被杀死，导致任务永远停留在 *_ai_review 阶段。
    启动时扫描超过 5 分钟的 AI 审核任务，自动回退到上传阶段。
    """
    from app.database import AsyncSessionLocal
    from app.models.task import Task, TaskStage

    threshold = datetime.now(timezone.utc) - timedelta(minutes=5)

    async with AsyncSessionLocal() as db:
        try:
            # 查找卡住的脚本 AI 审核任务
            result = await db.execute(
                select(Task).where(
                    Task.stage == TaskStage.SCRIPT_AI_REVIEW,
                    Task.updated_at < threshold,
                )
            )
            stuck_script_tasks = list(result.scalars().all())

            for task in stuck_script_tasks:
                task.stage = TaskStage.SCRIPT_UPLOAD
                task.script_ai_score = None
                task.script_ai_result = None
                logger.warning(
                    f"启动恢复: 任务 {task.id} 从 script_ai_review 回退到 script_upload"
                )

            # 查找卡住的视频 AI 审核任务
            result2 = await db.execute(
                select(Task).where(
                    Task.stage == TaskStage.VIDEO_AI_REVIEW,
                    Task.updated_at < threshold,
                )
            )
            stuck_video_tasks = list(result2.scalars().all())

            for task in stuck_video_tasks:
                task.stage = TaskStage.VIDEO_UPLOAD
                task.video_ai_score = None
                task.video_ai_result = None
                logger.warning(
                    f"启动恢复: 任务 {task.id} 从 video_ai_review 回退到 video_upload"
                )

            total = len(stuck_script_tasks) + len(stuck_video_tasks)
            if total > 0:
                await db.commit()
                logger.info(f"启动恢复: 共恢复 {total} 个卡住的 AI 审核任务")
            else:
                logger.info("启动恢复: 没有卡住的 AI 审核任务")

        except Exception as e:
            logger.error(f"启动恢复失败: {e}")
            await db.rollback()


async def _recover_stuck_xhs_batch_tasks():
    """
    启动时恢复卡在 XHS 改写中的条目

    XHS 批量改写按条目分发到 worker，本地通过租约心跳保活。
    如果 worker 在条目运行中重启，租约会过期，启动时需要把这些 running 条目恢复并重新投递。
    """
    from app.tasks.xhs_batch import recover_stuck_xhs_batch_items_async

    recovered_count = await recover_stuck_xhs_batch_items_async(recovered_by="startup")
    if recovered_count:
        logger.info("启动恢复: 共恢复 %s 个卡住的 XHS 改写条目", recovered_count)


async def _run_periodic_xhs_batch_recovery(interval_seconds: int = XHS_BATCH_RECOVERY_INTERVAL_SECONDS) -> None:
    from app.tasks.xhs_batch import recover_stuck_xhs_batch_items_async

    try:
        while True:
            await asyncio.sleep(interval_seconds)
            try:
                recovered_count = await recover_stuck_xhs_batch_items_async(recovered_by="periodic")
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.error("XHS 周期恢复异常: %s", exc)
                continue
            if recovered_count:
                logger.info("周期恢复: 共恢复 %s 个卡住的 XHS 改写条目", recovered_count)
    except asyncio.CancelledError:
        logger.info("XHS 周期恢复任务已停止")
        raise


@app.on_event("startup")
async def startup_event():
    logger.info(f"Starting {settings.APP_NAME} v{settings.APP_VERSION}")
    # 恢复卡住的 AI 审核任务
    await _recover_stuck_ai_review_tasks()
    # 恢复卡住的 XHS 批量改写条目
    await _recover_stuck_xhs_batch_tasks()
    recovery_task = getattr(app.state, "xhs_batch_recovery_task", None)
    if recovery_task is None or recovery_task.done():
        app.state.xhs_batch_recovery_task = asyncio.create_task(_run_periodic_xhs_batch_recovery())
    # 启动 Redis SSE 订阅（Celery worker 通过 Redis 发送 SSE 通知到前端）
    sse_task = getattr(app.state, "sse_redis_subscriber_task", None)
    if sse_task is None or sse_task.done():
        app.state.sse_redis_subscriber_task = asyncio.create_task(sse.start_redis_subscriber())


@app.on_event("shutdown")
async def shutdown_event():
    recovery_task = getattr(app.state, "xhs_batch_recovery_task", None)
    if recovery_task is not None:
        recovery_task.cancel()
        try:
            await recovery_task
        except asyncio.CancelledError:
            pass
    sse_task = getattr(app.state, "sse_redis_subscriber_task", None)
    if sse_task is not None:
        sse_task.cancel()
        try:
            await sse_task
        except asyncio.CancelledError:
            pass


@app.get("/")
async def root():
    """根路径"""
    return {
        "message": f"Welcome to {settings.APP_NAME}",
        "version": settings.APP_VERSION,
        "docs": "disabled" if _is_production else "/docs",
    }
