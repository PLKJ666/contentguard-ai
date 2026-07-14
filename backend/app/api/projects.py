"""
项目 API
品牌方创建和管理项目，分配代理商
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.user import User, UserRole
from app.models.project import Project, project_agency_association
from app.models.task import Task
from app.models.organization import Brand, Agency
from app.api.deps import get_current_user, get_current_brand, get_current_agency
from app.schemas.project import (
    ProjectCreateRequest,
    ProjectUpdateRequest,
    ProjectAssignAgencyRequest,
    ProjectResponse,
    ProjectListResponse,
    AgencySummary,
)
from app.services.auth import generate_id
from app.services.message_service import create_message

router = APIRouter(prefix="/projects", tags=["项目"])


async def _project_to_response(project: Project, db: AsyncSession) -> ProjectResponse:
    """将项目模型转换为响应"""
    # 获取任务数量
    count_result = await db.execute(
        select(func.count(Task.id)).where(Task.project_id == project.id)
    )
    task_count = count_result.scalar() or 0

    agencies = []
    if project.agencies:
        agencies = [
            AgencySummary(id=a.id, name=a.name, logo=a.logo)
            for a in project.agencies
        ]

    return ProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        platform=project.platform,
        brand_id=project.brand_id,
        brand_name=project.brand.name if project.brand else None,
        client_display_name=project.client_display_name,
        brand_display_name=project.brand_display_name,
        project_remark=project.project_remark,
        status=project.status,
        start_date=project.start_date,
        deadline=project.deadline,
        agencies=agencies,
        task_count=task_count,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    request: ProjectCreateRequest,
    brand: Brand = Depends(get_current_brand),
    db: AsyncSession = Depends(get_db),
):
    """
    创建项目（品牌方操作）
    """
    project = Project(
        id=generate_id("PJ"),
        brand_id=brand.id,
        name=request.name,
        description=request.description,
        platform=request.platform,
        start_date=request.start_date,
        deadline=request.deadline,
        config_scope_id=brand.id,
        client_display_name=request.client_display_name,
        brand_display_name=request.brand_display_name,
        project_remark=request.project_remark,
        status="active",
    )
    db.add(project)
    await db.flush()

    # 分配代理商（直接 INSERT 关联表，避免 async 懒加载问题）
    if request.agency_ids:
        for agency_id in request.agency_ids:
            result = await db.execute(
                select(Agency).where(Agency.id == agency_id)
            )
            agency = result.scalar_one_or_none()
            if agency:
                await db.execute(
                    project_agency_association.insert().values(
                        project_id=project.id,
                        agency_id=agency.id,
                    )
                )
        await db.flush()

    await db.refresh(project)

    # 重新加载关联
    result = await db.execute(
        select(Project)
        .options(selectinload(Project.brand), selectinload(Project.agencies))
        .where(Project.id == project.id)
    )
    project = result.scalar_one()

    # 给品牌方用户发送项目创建成功消息
    brand_user_result = await db.execute(
        select(User).where(User.id == brand.user_id)
    )
    brand_user = brand_user_result.scalar_one_or_none()
    if brand_user:
        await create_message(
            db=db,
            user_id=brand_user.id,
            type="system_notice",
            title="项目创建成功",
            content=f"您的项目「{project.name}」已创建成功",
            related_project_id=project.id,
        )

    # 给被分配的代理商发送新项目通知
    if project.agencies:
        for agency in project.agencies:
            agency_user_result = await db.execute(
                select(User).where(User.id == agency.user_id)
            )
            agency_user = agency_user_result.scalar_one_or_none()
            if agency_user:
                await create_message(
                    db=db,
                    user_id=agency_user.id,
                    type="new_task",
                    title="新项目分配",
                    content=f"品牌方「{brand.name}」将您加入了项目「{project.name}」",
                    related_project_id=project.id,
                    sender_name=brand.name,
                )

    await db.commit()
    return await _project_to_response(project, db)


@router.get("", response_model=ProjectListResponse)
async def list_projects(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status_filter: Optional[str] = Query(None, alias="status"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    查询项目列表

    - 品牌方: 查看自己创建的项目
    - 代理商: 查看被分配的项目
    """
    if current_user.role == UserRole.BRAND:
        result = await db.execute(
            select(Brand).where(Brand.user_id == current_user.id)
        )
        brand = result.scalar_one_or_none()
        if not brand:
            raise HTTPException(status_code=404, detail="品牌方信息不存在")

        query = (
            select(Project)
            .options(selectinload(Project.brand), selectinload(Project.agencies))
            .where(Project.brand_id == brand.id)
        )
        count_query = select(func.count(Project.id)).where(Project.brand_id == brand.id)

        if status_filter:
            query = query.where(Project.status == status_filter)
            count_query = count_query.where(Project.status == status_filter)

    elif current_user.role == UserRole.AGENCY:
        result = await db.execute(
            select(Agency).where(Agency.user_id == current_user.id)
        )
        agency = result.scalar_one_or_none()
        if not agency:
            raise HTTPException(status_code=404, detail="代理商信息不存在")

        # 通过关联表查询
        project_ids_query = (
            select(project_agency_association.c.project_id)
            .where(project_agency_association.c.agency_id == agency.id)
        )
        project_ids_result = await db.execute(project_ids_query)
        project_ids = [row[0] for row in project_ids_result.all()]

        if not project_ids:
            return ProjectListResponse(items=[], total=0, page=page, page_size=page_size)

        query = (
            select(Project)
            .options(selectinload(Project.brand), selectinload(Project.agencies))
            .where(Project.id.in_(project_ids))
        )
        count_query = select(func.count(Project.id)).where(Project.id.in_(project_ids))

        if status_filter:
            query = query.where(Project.status == status_filter)
            count_query = count_query.where(Project.status == status_filter)

    else:
        raise HTTPException(status_code=403, detail="达人无权查看项目列表")

    query = query.order_by(Project.created_at.desc())

    # 总数
    count_result = await db.execute(count_query)
    total = count_result.scalar() or 0

    # 分页
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    projects = list(result.scalars().all())

    items = []
    for p in projects:
        items.append(await _project_to_response(p, db))

    return ProjectListResponse(items=items, total=total, page=page, page_size=page_size)


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """查询项目详情"""
    result = await db.execute(
        select(Project)
        .options(selectinload(Project.brand), selectinload(Project.agencies))
        .where(Project.id == project_id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    # 权限检查
    if current_user.role == UserRole.BRAND:
        brand_result = await db.execute(
            select(Brand).where(Brand.user_id == current_user.id)
        )
        brand = brand_result.scalar_one_or_none()
        if not brand or project.brand_id != brand.id:
            raise HTTPException(status_code=403, detail="无权访问此项目")
    elif current_user.role == UserRole.AGENCY:
        agency_result = await db.execute(
            select(Agency).where(Agency.user_id == current_user.id)
        )
        agency = agency_result.scalar_one_or_none()
        if not agency or agency not in project.agencies:
            raise HTTPException(status_code=403, detail="无权访问此项目")
    else:
        raise HTTPException(status_code=403, detail="无权访问此项目")

    return await _project_to_response(project, db)


@router.put("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: str,
    request: ProjectUpdateRequest,
    brand: Brand = Depends(get_current_brand),
    db: AsyncSession = Depends(get_db),
):
    """更新项目（品牌方操作）"""
    result = await db.execute(
        select(Project)
        .options(selectinload(Project.brand), selectinload(Project.agencies))
        .where(Project.id == project_id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    if project.brand_id != brand.id:
        raise HTTPException(status_code=403, detail="无权修改此项目")

    if request.name is not None:
        project.name = request.name
    if request.description is not None:
        project.description = request.description
    if request.platform is not None:
        project.platform = request.platform
    if request.start_date is not None:
        project.start_date = request.start_date
    if request.deadline is not None:
        project.deadline = request.deadline
    if request.client_display_name is not None:
        project.client_display_name = request.client_display_name
    if request.brand_display_name is not None:
        project.brand_display_name = request.brand_display_name
    if request.project_remark is not None:
        project.project_remark = request.project_remark
    if request.status is not None:
        project.status = request.status

    await db.flush()
    await db.refresh(project)

    return await _project_to_response(project, db)


@router.post("/{project_id}/agencies", response_model=ProjectResponse)
async def assign_agencies(
    project_id: str,
    request: ProjectAssignAgencyRequest,
    brand: Brand = Depends(get_current_brand),
    db: AsyncSession = Depends(get_db),
):
    """分配代理商到项目（品牌方操作）"""
    result = await db.execute(
        select(Project)
        .options(selectinload(Project.brand), selectinload(Project.agencies))
        .where(Project.id == project_id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    if project.brand_id != brand.id:
        raise HTTPException(status_code=403, detail="无权操作此项目")

    newly_assigned = []
    for agency_id in request.agency_ids:
        agency_result = await db.execute(
            select(Agency).where(Agency.id == agency_id)
        )
        agency = agency_result.scalar_one_or_none()
        if agency and agency not in project.agencies:
            project.agencies.append(agency)
            newly_assigned.append(agency)

    await db.flush()
    await db.refresh(project)

    # 给新分配的代理商发送通知
    for agency in newly_assigned:
        agency_user_result = await db.execute(
            select(User).where(User.id == agency.user_id)
        )
        agency_user = agency_user_result.scalar_one_or_none()
        if agency_user:
            await create_message(
                db=db,
                user_id=agency_user.id,
                type="new_task",
                title="新项目分配",
                content=f"品牌方「{brand.name}」将您加入了项目「{project.name}」",
                related_project_id=project.id,
                sender_name=brand.name,
            )

    await db.commit()
    return await _project_to_response(project, db)


@router.delete("/{project_id}/agencies/{agency_id}", response_model=ProjectResponse)
async def remove_agency_from_project(
    project_id: str,
    agency_id: str,
    brand: Brand = Depends(get_current_brand),
    db: AsyncSession = Depends(get_db),
):
    """从项目移除代理商（品牌方操作）"""
    result = await db.execute(
        select(Project)
        .options(selectinload(Project.brand), selectinload(Project.agencies))
        .where(Project.id == project_id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    if project.brand_id != brand.id:
        raise HTTPException(status_code=403, detail="无权操作此项目")

    agency_result = await db.execute(
        select(Agency).where(Agency.id == agency_id)
    )
    agency = agency_result.scalar_one_or_none()
    if agency and agency in project.agencies:
        project.agencies.remove(agency)

    await db.flush()
    await db.refresh(project)

    return await _project_to_response(project, db)
