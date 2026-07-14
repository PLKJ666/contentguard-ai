"""
工作台统计 API
各角色仪表盘所需数据
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.models.user import User, UserRole
from app.models.task import Task, TaskStage, TaskStatus
from app.models.project import Project
from app.models.organization import Brand, Agency, Creator
from app.api.deps import get_current_user

router = APIRouter(prefix="/dashboard", tags=["工作台"])


# ===== 响应模型 =====

class ReviewCount(BaseModel):
    """审核数量"""
    script: int = 0
    video: int = 0


class CreatorDashboard(BaseModel):
    """达人工作台数据"""
    total_tasks: int = 0
    pending_script: int = 0       # 待上传脚本
    pending_video: int = 0        # 待上传视频
    in_review: int = 0            # 审核中
    completed: int = 0            # 已完成
    rejected: int = 0             # 被驳回


class AgencyDashboard(BaseModel):
    """代理商工作台数据"""
    pending_review: ReviewCount   # 待审核
    pending_appeal: int = 0       # 待处理申诉
    today_passed: ReviewCount     # 今日通过
    in_progress: ReviewCount      # 进行中
    total_creators: int = 0       # 达人总数
    total_tasks: int = 0          # 任务总数


class BrandDashboard(BaseModel):
    """品牌方工作台数据"""
    total_projects: int = 0       # 项目总数
    active_projects: int = 0      # 进行中项目
    pending_review: ReviewCount   # 待终审
    total_agencies: int = 0       # 代理商总数
    total_tasks: int = 0          # 任务总数
    completed_tasks: int = 0      # 已完成任务


# ===== API =====

@router.get("/creator", response_model=CreatorDashboard)
async def get_creator_dashboard(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """达人工作台统计"""
    if current_user.role != UserRole.CREATOR:
        raise HTTPException(status_code=403, detail="仅达人可访问")

    result = await db.execute(
        select(Creator).where(Creator.user_id == current_user.id)
    )
    creator = result.scalar_one_or_none()
    if not creator:
        raise HTTPException(status_code=404, detail="达人信息不存在")

    creator_id = creator.id

    # 各阶段任务数
    stage_counts = {}
    for stage in TaskStage:
        count_result = await db.execute(
            select(func.count(Task.id)).where(
                and_(Task.creator_id == creator_id, Task.stage == stage)
            )
        )
        stage_counts[stage] = count_result.scalar() or 0

    total_result = await db.execute(
        select(func.count(Task.id)).where(Task.creator_id == creator_id)
    )
    total = total_result.scalar() or 0

    in_review = (
        stage_counts.get(TaskStage.SCRIPT_AI_REVIEW, 0) +
        stage_counts.get(TaskStage.SCRIPT_AGENCY_REVIEW, 0) +
        stage_counts.get(TaskStage.SCRIPT_BRAND_REVIEW, 0) +
        stage_counts.get(TaskStage.VIDEO_AI_REVIEW, 0) +
        stage_counts.get(TaskStage.VIDEO_AGENCY_REVIEW, 0) +
        stage_counts.get(TaskStage.VIDEO_BRAND_REVIEW, 0)
    )

    return CreatorDashboard(
        total_tasks=total,
        pending_script=stage_counts.get(TaskStage.SCRIPT_UPLOAD, 0),
        pending_video=stage_counts.get(TaskStage.VIDEO_UPLOAD, 0),
        in_review=in_review,
        completed=stage_counts.get(TaskStage.COMPLETED, 0),
        rejected=stage_counts.get(TaskStage.REJECTED, 0),
    )


@router.get("/agency", response_model=AgencyDashboard)
async def get_agency_dashboard(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """代理商工作台统计"""
    if current_user.role != UserRole.AGENCY:
        raise HTTPException(status_code=403, detail="仅代理商可访问")

    result = await db.execute(
        select(Agency).where(Agency.user_id == current_user.id)
    )
    agency = result.scalar_one_or_none()
    if not agency:
        raise HTTPException(status_code=404, detail="代理商信息不存在")

    agency_id = agency.id

    # 待审核脚本
    script_review_result = await db.execute(
        select(func.count(Task.id)).where(
            and_(Task.agency_id == agency_id, Task.stage == TaskStage.SCRIPT_AGENCY_REVIEW)
        )
    )
    pending_script = script_review_result.scalar() or 0

    # 待审核视频
    video_review_result = await db.execute(
        select(func.count(Task.id)).where(
            and_(Task.agency_id == agency_id, Task.stage == TaskStage.VIDEO_AGENCY_REVIEW)
        )
    )
    pending_video = video_review_result.scalar() or 0

    # 待处理申诉
    appeal_result = await db.execute(
        select(func.count(Task.id)).where(
            and_(Task.agency_id == agency_id, Task.is_appeal == True)
        )
    )
    pending_appeal = appeal_result.scalar() or 0

    # 进行中的脚本（AI审核+代理商审核+品牌方审核）
    script_stages = [
        TaskStage.SCRIPT_AI_REVIEW, TaskStage.SCRIPT_AGENCY_REVIEW, TaskStage.SCRIPT_BRAND_REVIEW,
    ]
    script_progress_result = await db.execute(
        select(func.count(Task.id)).where(
            and_(Task.agency_id == agency_id, Task.stage.in_(script_stages))
        )
    )
    in_progress_script = script_progress_result.scalar() or 0

    # 进行中的视频
    video_stages = [
        TaskStage.VIDEO_AI_REVIEW, TaskStage.VIDEO_AGENCY_REVIEW, TaskStage.VIDEO_BRAND_REVIEW,
    ]
    video_progress_result = await db.execute(
        select(func.count(Task.id)).where(
            and_(Task.agency_id == agency_id, Task.stage.in_(video_stages))
        )
    )
    in_progress_video = video_progress_result.scalar() or 0

    # 达人总数
    from sqlalchemy.orm import selectinload
    agency_loaded = await db.execute(
        select(Agency).options(selectinload(Agency.creators)).where(Agency.id == agency_id)
    )
    agency_with_creators = agency_loaded.scalar_one()
    total_creators = len(agency_with_creators.creators)

    # 任务总数
    total_result = await db.execute(
        select(func.count(Task.id)).where(Task.agency_id == agency_id)
    )
    total_tasks = total_result.scalar() or 0

    # 今日通过（UTC 零点起）
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

    today_script_result = await db.execute(
        select(func.count(Task.id)).where(
            and_(
                Task.agency_id == agency_id,
                Task.script_agency_status.in_([TaskStatus.PASSED, TaskStatus.FORCE_PASSED]),
                Task.script_agency_reviewed_at >= today_start,
            )
        )
    )
    today_passed_script = today_script_result.scalar() or 0

    today_video_result = await db.execute(
        select(func.count(Task.id)).where(
            and_(
                Task.agency_id == agency_id,
                Task.video_agency_status == TaskStatus.PASSED,
                Task.video_agency_reviewed_at >= today_start,
            )
        )
    )
    today_passed_video = today_video_result.scalar() or 0

    return AgencyDashboard(
        pending_review=ReviewCount(script=pending_script, video=pending_video),
        pending_appeal=pending_appeal,
        today_passed=ReviewCount(script=today_passed_script, video=today_passed_video),
        in_progress=ReviewCount(script=in_progress_script, video=in_progress_video),
        total_creators=total_creators,
        total_tasks=total_tasks,
    )


@router.get("/brand", response_model=BrandDashboard)
async def get_brand_dashboard(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """品牌方工作台统计"""
    if current_user.role != UserRole.BRAND:
        raise HTTPException(status_code=403, detail="仅品牌方可访问")

    result = await db.execute(
        select(Brand).where(Brand.user_id == current_user.id)
    )
    brand = result.scalar_one_or_none()
    if not brand:
        raise HTTPException(status_code=404, detail="品牌方信息不存在")

    brand_id = brand.id

    # 项目统计
    total_projects_result = await db.execute(
        select(func.count(Project.id)).where(Project.brand_id == brand_id)
    )
    total_projects = total_projects_result.scalar() or 0

    active_projects_result = await db.execute(
        select(func.count(Project.id)).where(
            and_(Project.brand_id == brand_id, Project.status == "active")
        )
    )
    active_projects = active_projects_result.scalar() or 0

    # 获取项目 ID 列表
    project_ids_result = await db.execute(
        select(Project.id).where(Project.brand_id == brand_id)
    )
    project_ids = [row[0] for row in project_ids_result.all()]

    pending_script = 0
    pending_video = 0
    total_tasks = 0
    completed_tasks = 0

    if project_ids:
        # 待终审脚本
        script_result = await db.execute(
            select(func.count(Task.id)).where(
                and_(Task.project_id.in_(project_ids), Task.stage == TaskStage.SCRIPT_BRAND_REVIEW)
            )
        )
        pending_script = script_result.scalar() or 0

        # 待终审视频
        video_result = await db.execute(
            select(func.count(Task.id)).where(
                and_(Task.project_id.in_(project_ids), Task.stage == TaskStage.VIDEO_BRAND_REVIEW)
            )
        )
        pending_video = video_result.scalar() or 0

        # 任务总数
        total_tasks_result = await db.execute(
            select(func.count(Task.id)).where(Task.project_id.in_(project_ids))
        )
        total_tasks = total_tasks_result.scalar() or 0

        # 已完成
        completed_result = await db.execute(
            select(func.count(Task.id)).where(
                and_(Task.project_id.in_(project_ids), Task.stage == TaskStage.COMPLETED)
            )
        )
        completed_tasks = completed_result.scalar() or 0

    # 代理商总数
    from sqlalchemy.orm import selectinload
    brand_loaded = await db.execute(
        select(Brand).options(selectinload(Brand.agencies)).where(Brand.id == brand_id)
    )
    brand_with_agencies = brand_loaded.scalar_one()
    total_agencies = len(brand_with_agencies.agencies)

    return BrandDashboard(
        total_projects=total_projects,
        active_projects=active_projects,
        pending_review=ReviewCount(script=pending_script, video=pending_video),
        total_agencies=total_agencies,
        total_tasks=total_tasks,
        completed_tasks=completed_tasks,
    )
