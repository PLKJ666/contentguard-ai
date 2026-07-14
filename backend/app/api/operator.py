"""
代运营账号 API
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_operator
from app.database import get_db
from app.models.operator import Operator
from app.models.project import Project, project_agency_association
from app.models.task import Task
from app.schemas.operator import (
    OperatorProjectCreateRequest,
    OperatorProjectListResponse,
    OperatorTaskCreateRequest,
    OperatorTaskListResponse,
    OperatorTaskReviewRequest,
)
from app.schemas.project import ProjectResponse
from app.schemas.task import TaskResponse, TaskScriptUploadRequest, TaskVideoUploadRequest
from app.services.auth import decode_logto_token, generate_id
from app.services.task_service import (
    agency_review,
    create_task,
    get_task_by_id,
    upload_script,
    upload_video,
)

router = APIRouter(prefix="/operator", tags=["代运营"])


def _operator_brief_is_configured(brief) -> bool:
    if not brief:
        return False

    has_document = bool(
        (brief.file_url and brief.file_name)
        or (brief.agency_attachments and len(brief.agency_attachments) > 0)
    )
    has_structured_content = bool(
        (brief.product_name and brief.product_name.strip())
        or (brief.selling_points and len(brief.selling_points) > 0)
        or (brief.blacklist_words and len(brief.blacklist_words) > 0)
        or (brief.other_requirements and brief.other_requirements.strip())
    )
    return has_document and has_structured_content


def _project_to_response(project: Project) -> ProjectResponse:
    return ProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        platform=project.platform,
        brand_id=project.brand_id,
        brand_name=project.brand.name if project.brand else project.brand_display_name,
        client_display_name=project.client_display_name,
        brand_display_name=project.brand_display_name,
        project_remark=project.project_remark,
        status=project.status,
        start_date=project.start_date,
        deadline=project.deadline,
        agencies=[],
        task_count=len(project.tasks or []),
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


async def _get_operator_project_or_404(project_id: str, operator: Operator, db: AsyncSession) -> Project:
    result = await db.execute(
        select(Project)
        .options(selectinload(Project.tasks), selectinload(Project.brand), selectinload(Project.brief))
        .where(Project.id == project_id, Project.config_scope_id == operator.workspace_id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    return project


async def _get_operator_task_or_404(task_id: str, operator: Operator, db: AsyncSession) -> Task:
    task = await get_task_by_id(db, task_id)
    if not task or not task.project or task.project.config_scope_id != operator.workspace_id:
        raise HTTPException(status_code=404, detail="任务不存在")
    return task


@router.get("/projects", response_model=OperatorProjectListResponse)
async def list_operator_projects(
    operator: Operator = Depends(get_current_operator),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Project)
        .options(selectinload(Project.tasks), selectinload(Project.brand))
        .where(Project.config_scope_id == operator.workspace_id)
        .order_by(Project.created_at.desc())
    )
    projects = list(result.scalars().all())
    return OperatorProjectListResponse(
        items=[_project_to_response(project) for project in projects],
        total=len(projects),
    )


@router.post("/projects", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_operator_project(
    request: OperatorProjectCreateRequest,
    operator: Operator = Depends(get_current_operator),
    db: AsyncSession = Depends(get_db),
):
    project = Project(
        id=generate_id("PJ"),
        brand_id=None,
        config_scope_id=operator.workspace_id,
        name=request.name,
        description=request.description,
        platform=request.platform,
        client_display_name=request.client_display_name,
        brand_display_name=request.brand_display_name,
        project_remark=request.project_remark,
        status="active",
    )
    db.add(project)
    await db.flush()
    await db.execute(
        project_agency_association.insert().values(
            project_id=project.id,
            agency_id=operator.agency_id,
        )
    )
    await db.flush()
    result = await db.execute(
        select(Project)
        .options(selectinload(Project.tasks), selectinload(Project.brand))
        .where(Project.id == project.id)
    )
    project = result.scalar_one()
    return _project_to_response(project)


@router.get("/tasks", response_model=OperatorTaskListResponse)
async def list_operator_tasks(
    operator: Operator = Depends(get_current_operator),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Task)
        .options(
            selectinload(Task.project).selectinload(Project.brand),
            selectinload(Task.project).selectinload(Project.brief),
            selectinload(Task.agency),
            selectinload(Task.creator),
        )
        .join(Task.project)
        .where(Project.config_scope_id == operator.workspace_id)
        .order_by(Task.created_at.desc())
    )
    tasks = list(result.scalars().all())
    from app.api.tasks import _task_to_response

    return OperatorTaskListResponse(
        items=[_task_to_response(task) for task in tasks],
        total=len(tasks),
    )


@router.post("/tasks", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
async def create_operator_task(
    request: OperatorTaskCreateRequest,
    operator: Operator = Depends(get_current_operator),
    db: AsyncSession = Depends(get_db),
):
    project = await _get_operator_project_or_404(request.project_id, operator, db)
    if not _operator_brief_is_configured(project.brief):
        raise HTTPException(status_code=400, detail="请先上传并保存有效的项目 Brief")
    task = await create_task(
        db=db,
        project_id=project.id,
        agency_id=operator.agency_id,
        creator_id=None,
        creator_display_name=request.creator_display_name.strip(),
        creator_platform=request.creator_platform,
        creator_remark=request.creator_remark,
        name=request.name,
    )
    task = await get_task_by_id(db, task.id)
    from app.api.tasks import _task_to_response

    return _task_to_response(task)


@router.get("/tasks/{task_id}", response_model=TaskResponse)
async def get_operator_task(
    task_id: str,
    operator: Operator = Depends(get_current_operator),
    db: AsyncSession = Depends(get_db),
):
    task = await _get_operator_task_or_404(task_id, operator, db)
    from app.api.tasks import _task_to_response

    return _task_to_response(task)


@router.post("/tasks/{task_id}/script", response_model=TaskResponse)
async def upload_operator_task_script(
    task_id: str,
    request: TaskScriptUploadRequest,
    operator: Operator = Depends(get_current_operator),
    db: AsyncSession = Depends(get_db),
):
    task = await _get_operator_task_or_404(task_id, operator, db)
    if task.stage.value != "script_upload":
        raise HTTPException(status_code=400, detail="当前阶段不可上传脚本")

    task = await upload_script(
        db=db,
        task=task,
        file_url=request.file_url,
        file_name=request.file_name,
        text_content=request.text_content,
    )
    task = await get_task_by_id(db, task.id)

    project = task.project
    config_scope_id = project.config_scope_id or project.brand_id or operator.workspace_id
    from app.api.tasks import (
        _run_ai_review_with_timeout,
        _run_script_ai_review,
        _task_to_response,
    )

    try:
        from app.tasks.review import script_ai_review_task

        script_ai_review_task.delay(task.id, config_scope_id)
    except Exception:
        asyncio.create_task(
            _run_ai_review_with_timeout(
                _run_script_ai_review,
                task.id,
                config_scope_id,
                "script",
            )
        )

    return _task_to_response(task)


@router.post("/tasks/{task_id}/video", response_model=TaskResponse)
async def upload_operator_task_video(
    task_id: str,
    request: TaskVideoUploadRequest,
    operator: Operator = Depends(get_current_operator),
    db: AsyncSession = Depends(get_db),
):
    task = await _get_operator_task_or_404(task_id, operator, db)
    if task.stage.value != "video_upload":
        raise HTTPException(status_code=400, detail="当前阶段不可上传视频")

    task = await upload_video(
        db=db,
        task=task,
        file_url=request.file_url,
        file_name=request.file_name,
        duration=request.duration,
        thumbnail_url=request.thumbnail_url,
    )
    task = await get_task_by_id(db, task.id)

    project = task.project
    config_scope_id = project.config_scope_id or project.brand_id or operator.workspace_id
    from app.api.tasks import (
        _run_ai_review_with_timeout,
        _run_video_ai_review,
        _task_to_response,
    )

    try:
        from app.tasks.review import video_ai_review_task

        video_ai_review_task.delay(task.id, config_scope_id)
    except Exception:
        asyncio.create_task(
            _run_ai_review_with_timeout(
                _run_video_ai_review,
                task.id,
                config_scope_id,
                "video",
            )
        )

    return _task_to_response(task)


@router.post("/tasks/{task_id}/review", response_model=TaskResponse)
async def review_operator_task(
    task_id: str,
    request: OperatorTaskReviewRequest,
    operator: Operator = Depends(get_current_operator),
    db: AsyncSession = Depends(get_db),
):
    task = await _get_operator_task_or_404(task_id, operator, db)
    if task.stage.value not in {"script_agency_review", "video_agency_review"}:
        raise HTTPException(status_code=400, detail="当前阶段不可审核")

    task = await agency_review(
        db=db,
        task=task,
        action=request.action,
        reviewer_id=operator.user_id,
        skip_brand_review=True,
        comment=request.comment,
        corrected_script=request.corrected_script,
        corrected_file_url=request.corrected_file_url,
        corrected_file_name=request.corrected_file_name,
        corrected_file_type=request.corrected_file_type,
    )
    task = await get_task_by_id(db, task.id)
    from app.api.tasks import _task_to_response

    return _task_to_response(task)
