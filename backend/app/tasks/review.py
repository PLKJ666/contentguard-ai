"""
视频审核后台任务
完整的视频审核流程：下载 → 提取帧 → ASR → 视觉分析 → 生成报告
"""
import asyncio
import os
from datetime import datetime, timezone
from typing import Optional

from celery import shared_task
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.models.organization import Brand
from app.models.review import ReviewTask, TaskStatus as DBTaskStatus
from app.models.rule import ForbiddenWord, Competitor, PlatformRule, RuleStatus
from app.models.ai_config import AIConfig
from app.services.video_download import VideoDownloadService, DownloadResult
from app.services.keyframe import KeyFrameExtractor, ExtractionResult
from app.services.asr import VideoASRService, TranscriptionResult
from app.services.vision import CompetitorLogoDetector, VideoOCRService
from app.services.video_review import VideoReviewService
from app.utils.crypto import decrypt_api_key


# 异步数据库引擎
_async_engine = None
_async_session_factory = None


def get_async_engine():
    """获取异步数据库引擎"""
    global _async_engine
    if _async_engine is None:
        _async_engine = create_async_engine(
            settings.DATABASE_URL,
            echo=False,
            pool_size=5,
            max_overflow=10,
            pool_pre_ping=True,
            pool_recycle=3600,
        )
    return _async_engine


def get_async_session() -> sessionmaker:
    """获取异步会话工厂"""
    global _async_session_factory
    if _async_session_factory is None:
        _async_session_factory = sessionmaker(
            get_async_engine(),
            class_=AsyncSession,
            expire_on_commit=False,
        )
    return _async_session_factory


async def _run_with_isolated_task_db(coro_name: str, *args):
    """
    为 Celery 任务注入独立的异步会话工厂，避免复用跨 event loop 的 asyncpg 连接池。
    """
    from app.api import tasks as tasks_api

    task_engine = create_async_engine(
        settings.DATABASE_URL,
        echo=False,
        pool_size=5,
        max_overflow=10,
        pool_pre_ping=True,
        pool_recycle=3600,
    )
    task_session_factory = sessionmaker(
        task_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    original_session_factory = tasks_api.AsyncSessionLocal
    tasks_api.AsyncSessionLocal = task_session_factory
    try:
        task_coro = getattr(tasks_api, coro_name)
        await task_coro(*args)
    finally:
        tasks_api.AsyncSessionLocal = original_session_factory
        await task_engine.dispose()


async def update_review_progress(
    db: AsyncSession,
    review_id: str,
    progress: int,
    current_step: str,
    status: Optional[DBTaskStatus] = None,
):
    """更新审核进度"""
    result = await db.execute(
        select(ReviewTask).where(ReviewTask.id == review_id)
    )
    task = result.scalar_one_or_none()
    if task:
        task.progress = progress
        task.current_step = current_step
        if status:
            task.status = status
        await db.commit()


async def complete_review(
    db: AsyncSession,
    review_id: str,
    score: int,
    summary: str,
    violations: list[dict],
    status: DBTaskStatus = DBTaskStatus.COMPLETED,
    soft_warnings: Optional[list[dict]] = None,
    brand_exposure: Optional[dict] = None,
):
    """完成审核"""
    result = await db.execute(
        select(ReviewTask).where(ReviewTask.id == review_id)
    )
    task = result.scalar_one_or_none()
    if task:
        task.status = status
        task.progress = 100
        task.current_step = "完成"
        task.score = score
        task.summary = summary
        task.violations = violations
        if soft_warnings is not None:
            task.soft_warnings = soft_warnings
        if brand_exposure is not None:
            task.brand_exposure = brand_exposure
        task.completed_at = datetime.now(timezone.utc)
        await db.commit()


async def get_brand_name(db: AsyncSession, brand_id: str) -> Optional[str]:
    """获取品牌名称，用于旧版视频审核链路的品牌提及估算"""
    result = await db.execute(
        select(Brand.name).where(Brand.id == brand_id)
    )
    return result.scalar_one_or_none()


async def fail_review(
    db: AsyncSession,
    review_id: str,
    error: str,
):
    """审核失败"""
    result = await db.execute(
        select(ReviewTask).where(ReviewTask.id == review_id)
    )
    task = result.scalar_one_or_none()
    if task:
        task.status = DBTaskStatus.FAILED
        task.current_step = "失败"
        task.summary = f"审核失败: {error}"
        await db.commit()


async def get_ai_config(db: AsyncSession, tenant_id: str) -> Optional[dict]:
    """获取租户 AI 配置"""
    result = await db.execute(
        select(AIConfig).where(
            AIConfig.tenant_id == tenant_id,
            AIConfig.is_configured == True,
        )
    )
    config = result.scalar_one_or_none()
    if not config:
        return None

    return {
        "api_key": decrypt_api_key(config.api_key_encrypted),
        "base_url": config.base_url,
        "models": config.models,
    }


async def get_forbidden_words(db: AsyncSession, tenant_id: str) -> list[str]:
    """获取违禁词列表"""
    result = await db.execute(
        select(ForbiddenWord.word).where(ForbiddenWord.tenant_id == tenant_id)
    )
    return [row[0] for row in result.fetchall()]


async def get_competitors(db: AsyncSession, tenant_id: str, brand_id: str) -> list[str]:
    """获取竞品列表"""
    result = await db.execute(
        select(Competitor.name).where(
            Competitor.tenant_id == tenant_id,
            Competitor.brand_id == brand_id,
        )
    )
    return [row[0] for row in result.fetchall()]


async def get_platform_forbidden_words(
    db: AsyncSession, tenant_id: str, brand_id: str, platform: str,
) -> list[str]:
    """从 DB 获取品牌方在该平台的 active 规则中的违禁词"""
    result = await db.execute(
        select(PlatformRule).where(
            PlatformRule.tenant_id == tenant_id,
            PlatformRule.brand_id == brand_id,
            PlatformRule.platform == platform,
            PlatformRule.status == RuleStatus.ACTIVE.value,
        )
    )
    rule = result.scalar_one_or_none()
    if not rule or not rule.parsed_rules:
        return []
    return rule.parsed_rules.get("forbidden_words", [])


async def process_video_review(
    review_id: str,
    tenant_id: str,
    video_url: str,
    brand_id: str,
    platform: str,
):
    """
    处理视频审核（异步核心逻辑）

    流程：
    1. 下载视频
    2. 提取关键帧
    3. ASR 语音转写
    4. 视觉分析（竞品 Logo 检测）
    5. OCR 字幕提取
    6. 违规检测
    7. 生成报告
    """
    session_factory = get_async_session()
    download_service = VideoDownloadService()
    keyframe_extractor = KeyFrameExtractor()
    review_service = VideoReviewService()

    video_path = None
    frames_dir = None
    logo_detector = None
    ocr_service = None
    asr_service = None

    async with session_factory() as db:
        try:
            # 更新状态：处理中
            await update_review_progress(
                db, review_id, 5, "开始处理",
                status=DBTaskStatus.PROCESSING,
            )

            # 获取 AI 配置
            ai_config = await get_ai_config(db, tenant_id)
            if not ai_config:
                await fail_review(db, review_id, "AI 服务未配置")
                return

            # 获取规则
            forbidden_words = await get_forbidden_words(db, tenant_id)
            # 合并平台规则中的违禁词
            platform_fw = await get_platform_forbidden_words(db, tenant_id, brand_id, platform)
            existing_set = set(forbidden_words)
            for w in platform_fw:
                if w not in existing_set:
                    forbidden_words.append(w)
                    existing_set.add(w)
            competitors = await get_competitors(db, tenant_id, brand_id)
            brand_name = await get_brand_name(db, brand_id)

            # 初始化 AI 服务
            api_key = ai_config["api_key"]
            base_url = ai_config["base_url"]
            models = ai_config["models"]

            asr_service = VideoASRService(
                api_key=api_key,
                base_url=base_url,
                model=models.get("audio", "whisper-1"),
            )
            logo_detector = CompetitorLogoDetector(
                api_key=api_key,
                base_url=base_url,
                model=models.get("vision", "gpt-4o"),
            )
            ocr_service = VideoOCRService(
                api_key=api_key,
                base_url=base_url,
                model=models.get("vision", "gpt-4o"),
            )

            # 1. 下载视频
            await update_review_progress(db, review_id, 10, "下载视频")
            download_result: DownloadResult = await download_service.download(video_url)
            if not download_result.success:
                await fail_review(db, review_id, f"视频下载失败: {download_result.error}")
                return
            video_path = download_result.file_path

            # 2. 提取关键帧
            await update_review_progress(db, review_id, 25, "提取关键帧")
            extraction_result: ExtractionResult = await keyframe_extractor.extract_at_intervals(
                video_path,
                interval_seconds=2.0,
                max_frames=30,
            )
            if not extraction_result.success:
                await fail_review(db, review_id, f"关键帧提取失败: {extraction_result.error}")
                return
            frames_dir = extraction_result.output_dir
            frames = extraction_result.frames

            all_violations = []

            # 3. ASR 语音转写
            await update_review_progress(db, review_id, 40, "语音转写")
            transcript_result: TranscriptionResult = await asr_service.transcribe_video(video_path)
            transcript = []
            if transcript_result.success:
                transcript = [
                    {"text": seg.text, "start": seg.start, "end": seg.end}
                    for seg in transcript_result.segments
                ]

                # 检测口播违禁词
                speech_violations = await review_service.detect_forbidden_words_in_speech(
                    transcript,
                    forbidden_words,
                    context_aware=True,
                )
                all_violations.extend(speech_violations)

            # 4. 视觉分析 - 竞品 Logo 检测
            await update_review_progress(db, review_id, 60, "检测竞品 Logo")
            if competitors and frames:
                logo_violations = await logo_detector.detect(frames, competitors)
                all_violations.extend(logo_violations)

            # 5. OCR 字幕提取
            await update_review_progress(db, review_id, 75, "提取字幕")
            if frames:
                subtitles = await ocr_service.extract_subtitles(frames)

                # 检测字幕违禁词
                subtitle_violations = await review_service.detect_forbidden_words_in_subtitle(
                    subtitles,
                    forbidden_words,
                )
                all_violations.extend(subtitle_violations)

            # 6. 分流 violations / soft_warnings
            await update_review_progress(db, review_id, 90, "生成报告")

            hard_violations = []
            soft_warnings_data = []

            for v in all_violations:
                v_type = v.get("type", "")
                if v_type in ("forbidden_word", "efficacy_claim", "competitor_logo", "brand_safety"):
                    hard_violations.append(v)
                elif v_type in ("duration_short", "mention_missing"):
                    soft_warnings_data.append({
                        "code": f"video_{v_type}",
                        "message": v.get("content", ""),
                        "action_required": "note",
                        "blocking": False,
                        "context": {"suggestion": v.get("suggestion", "")},
                    })
                else:
                    hard_violations.append(v)  # 默认当硬性违规

            # 计算分数（仅硬性违规影响分数）
            score = review_service.calculate_score(hard_violations)
            brand_exposure = review_service.build_brand_exposure_assessment(
                transcript=transcript,
                subtitles=subtitles if frames else [],
                brand_name=brand_name,
            )

            if not hard_violations:
                summary = "视频内容合规，未发现违规项"
                if soft_warnings_data:
                    summary += f"（{len(soft_warnings_data)} 条提醒）"
            else:
                high_count = sum(1 for v in hard_violations if v.get("risk_level") == "high")
                summary = f"发现 {len(hard_violations)} 处违规"
                if high_count > 0:
                    summary += f"（{high_count} 处高风险）"

            # 7. 完成审核
            await complete_review(
                db,
                review_id,
                score=score,
                summary=summary,
                violations=hard_violations,
                soft_warnings=soft_warnings_data if soft_warnings_data else None,
                brand_exposure=brand_exposure,
            )

        except Exception as e:
            await fail_review(db, review_id, str(e))

        finally:
            # 清理资源
            if video_path:
                download_service.cleanup(video_path)
            if frames_dir:
                keyframe_extractor.cleanup(frames_dir)
            if logo_detector:
                await logo_detector.close()
            if ocr_service:
                await ocr_service.close()


@shared_task(
    bind=True,
    name="app.tasks.review.process_video_review_task",
    max_retries=3,
    default_retry_delay=60,
)
def process_video_review_task(
    self,
    review_id: str,
    tenant_id: str,
    video_url: str,
    brand_id: str,
    platform: str,
):
    """
    视频审核 Celery 任务

    Args:
        review_id: 审核任务 ID
        tenant_id: 租户 ID
        video_url: 视频 URL
        brand_id: 品牌 ID
        platform: 平台
    """
    try:
        # 运行异步任务
        asyncio.run(process_video_review(
            review_id=review_id,
            tenant_id=tenant_id,
            video_url=video_url,
            brand_id=brand_id,
            platform=platform,
        ))
    except Exception as e:
        # 重试
        raise self.retry(exc=e)


@shared_task(
    bind=True,
    name="app.tasks.review.script_ai_review_task",
    max_retries=2,
    default_retry_delay=30,
    soft_time_limit=300,   # 5 分钟软超时
    time_limit=360,        # 6 分钟硬超时
)
def script_ai_review_task(self, task_id: str, tenant_id: str):
    """
    脚本 AI 审核 Celery 任务

    从 asyncio.create_task 迁移到 Celery 队列，确保：
    1. 任务持久化，服务器重启不丢失
    2. 自动重试（最多 2 次）
    3. 可控并发数

    Args:
        task_id: 任务 ID
        tenant_id: 品牌方（租户）ID
    """
    import logging
    _logger = logging.getLogger(__name__)
    try:
        _logger.info(f"Celery: 开始脚本 AI 审核 task_id={task_id}")
        asyncio.run(_run_with_isolated_task_db("_run_script_ai_review", task_id, tenant_id))
        _logger.info(f"Celery: 脚本 AI 审核完成 task_id={task_id}")
    except Exception as e:
        _logger.error(f"Celery: 脚本 AI 审核失败 task_id={task_id}: {e}")
        raise self.retry(exc=e)


@shared_task(
    bind=True,
    name="app.tasks.review.video_ai_review_task",
    max_retries=2,
    default_retry_delay=60,
    soft_time_limit=540,   # 9 分钟软超时（视频审核耗时更长）
    time_limit=600,        # 10 分钟硬超时
)
def video_ai_review_task(self, task_id: str, tenant_id: str):
    """
    视频 AI 审核 Celery 任务

    视频审核流程较长（下载→ASR→抽帧→视觉→合规→合并），
    使用更长的超时时间。

    Args:
        task_id: 任务 ID
        tenant_id: 品牌方（租户）ID
    """
    import logging
    _logger = logging.getLogger(__name__)
    try:
        _logger.info(f"Celery: 开始视频 AI 审核 task_id={task_id}")
        asyncio.run(_run_with_isolated_task_db("_run_video_ai_review", task_id, tenant_id))
        _logger.info(f"Celery: 视频 AI 审核完成 task_id={task_id}")
    except Exception as e:
        _logger.error(f"Celery: 视频 AI 审核失败 task_id={task_id}: {e}")
        raise self.retry(exc=e)


@shared_task(name="app.tasks.review.cleanup_old_files_task")
def cleanup_old_files_task():
    """清理过期的临时文件"""
    from app.services.video_download import get_download_service

    service = get_download_service()
    deleted = service.cleanup_old_files(max_age_seconds=3600)
    return {"deleted_files": deleted}
