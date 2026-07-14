"""
视频审核 API
"""
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.tenant import Tenant
from app.models.review import ReviewTask, TaskStatus as DBTaskStatus, Platform as DBPlatform
from app.schemas.review import (
    BrandExposureAssessment,
    VideoReviewRequest,
    VideoReviewSubmitResponse,
    VideoReviewProgressResponse,
    VideoReviewResultResponse,
    TaskStatus,
    Violation,
    ViolationType,
    RiskLevel,
    ViolationSource,
    SoftRiskWarning,
)

router = APIRouter(prefix="/videos", tags=["videos"])


async def _ensure_tenant_exists(tenant_id: str, db: AsyncSession) -> Tenant:
    """确保租户存在，不存在则自动创建"""
    result = await db.execute(
        select(Tenant).where(Tenant.id == tenant_id)
    )
    tenant = result.scalar_one_or_none()

    if not tenant:
        tenant = Tenant(id=tenant_id, name=f"租户-{tenant_id}")
        db.add(tenant)
        await db.flush()

    return tenant


@router.post(
    "/review",
    response_model=VideoReviewSubmitResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def submit_video_review(
    request: VideoReviewRequest,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
) -> VideoReviewSubmitResponse:
    """
    提交视频审核

    返回 202 Accepted，异步处理
    """
    # 确保租户存在
    await _ensure_tenant_exists(x_tenant_id, db)

    # 品牌方用户的 tenant_id 即 brand_id；前端可能传空字符串
    if not request.brand_id:
        request.brand_id = x_tenant_id

    review_id = f"review-{uuid.uuid4().hex[:12]}"

    # 创建审核任务
    task = ReviewTask(
        id=review_id,
        tenant_id=x_tenant_id,
        video_url=str(request.video_url),
        platform=DBPlatform(request.platform.value),
        brand_id=request.brand_id,
        creator_id=request.creator_id,
        status=DBTaskStatus.PENDING,
        progress=0,
        current_step="等待处理",
        competitors=request.competitors,
        requirements=request.requirements,
    )
    db.add(task)
    await db.commit()

    # 触发 Celery 异步任务
    try:
        from app.tasks.review import process_video_review_task
        process_video_review_task.delay(
            review_id=review_id,
            tenant_id=x_tenant_id,
            video_url=str(request.video_url),
            brand_id=request.brand_id,
            platform=request.platform.value,
        )
    except Exception:
        # Celery 不可用时，任务保持 PENDING 状态
        # 后续可通过定时任务或手动触发处理
        pass

    return VideoReviewSubmitResponse(
        review_id=review_id,
        status=TaskStatus.PENDING,
    )


@router.get(
    "/review/{review_id}/progress",
    response_model=VideoReviewProgressResponse,
)
async def get_review_progress(
    review_id: str,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
) -> VideoReviewProgressResponse:
    """
    查询审核进度
    """
    result = await db.execute(
        select(ReviewTask).where(
            and_(
                ReviewTask.id == review_id,
                ReviewTask.tenant_id == x_tenant_id,
            )
        )
    )
    task = result.scalar_one_or_none()

    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"审核任务不存在: {review_id}",
        )

    return VideoReviewProgressResponse(
        review_id=review_id,
        status=TaskStatus(task.status.value),
        progress=task.progress,
        current_step=task.current_step,
    )


@router.get("/review/{review_id}/result")
async def get_review_result(
    review_id: str,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    """
    查询审核结果

    - 未完成：返回 202 + 进度结构
    - 已完成：返回 200 + 结果结构
    """
    result = await db.execute(
        select(ReviewTask).where(
            and_(
                ReviewTask.id == review_id,
                ReviewTask.tenant_id == x_tenant_id,
            )
        )
    )
    task = result.scalar_one_or_none()

    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"审核任务不存在: {review_id}",
        )

    # 未完成：返回 202 + 进度
    if task.status in [DBTaskStatus.PENDING, DBTaskStatus.PROCESSING]:
        progress_response = VideoReviewProgressResponse(
            review_id=review_id,
            status=TaskStatus(task.status.value),
            progress=task.progress,
            current_step=task.current_step,
        )
        return JSONResponse(
            status_code=status.HTTP_202_ACCEPTED,
            content=progress_response.model_dump(),
        )

    # 失败：返回错误信息
    if task.status == DBTaskStatus.FAILED:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=task.error_message or "审核任务失败",
        )

    # 已完成：返回 200 + 结果
    violations = []
    if task.violations:
        for v in task.violations:
            violations.append(Violation(**v))

    soft_warnings = []
    if task.soft_warnings:
        for w in task.soft_warnings:
            soft_warnings.append(SoftRiskWarning(**w))

    brand_exposure = None
    if task.brand_exposure:
        brand_exposure = BrandExposureAssessment(**task.brand_exposure)

    return VideoReviewResultResponse(
        review_id=review_id,
        status=TaskStatus.COMPLETED,
        score=task.score or 100,
        summary=task.summary or "审核完成",
        violations=violations,
        soft_warnings=soft_warnings,
        brand_exposure=brand_exposure,
    )
