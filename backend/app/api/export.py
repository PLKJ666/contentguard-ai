"""
数据导出 API
支持导出任务数据和审计日志为 CSV 格式
"""
import csv
import io
from typing import Optional
from datetime import datetime, date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.user import User, UserRole
from app.models.task import Task, TaskStage
from app.models.project import Project
from app.models.organization import Brand, Agency, Creator
from app.models.operator import Operator
from app.models.audit_log import AuditLog
from app.api.deps import get_current_user, require_roles

router = APIRouter(prefix="/export", tags=["数据导出"])


def _iter_csv(header: list[str], rows: list[list[str]]):
    """
    生成 CSV 流式响应的迭代器。
    首行输出 UTF-8 BOM + 表头，之后逐行输出数据。
    """
    buf = io.StringIO()
    writer = csv.writer(buf)

    # 写入 BOM + 表头
    writer.writerow(header)
    yield "\ufeff" + buf.getvalue()
    buf.seek(0)
    buf.truncate(0)

    # 逐行写入数据
    for row in rows:
        writer.writerow(row)
        yield buf.getvalue()
        buf.seek(0)
        buf.truncate(0)


def _format_datetime(dt: Optional[datetime]) -> str:
    """格式化日期时间为字符串"""
    if dt is None:
        return ""
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def _format_stage(stage: Optional[TaskStage]) -> str:
    """将任务阶段转换为中文标签"""
    if stage is None:
        return ""
    stage_labels = {
        TaskStage.SCRIPT_UPLOAD: "待上传脚本",
        TaskStage.SCRIPT_AI_REVIEW: "脚本AI审核中",
        TaskStage.SCRIPT_AGENCY_REVIEW: "脚本代理商审核中",
        TaskStage.SCRIPT_BRAND_REVIEW: "脚本品牌方终审中",
        TaskStage.VIDEO_UPLOAD: "待上传视频",
        TaskStage.VIDEO_AI_REVIEW: "视频AI审核中",
        TaskStage.VIDEO_AGENCY_REVIEW: "视频代理商审核中",
        TaskStage.VIDEO_BRAND_REVIEW: "视频品牌方终审中",
        TaskStage.COMPLETED: "已完成",
        TaskStage.REJECTED: "已驳回",
    }
    return stage_labels.get(stage, stage.value)


@router.get("/tasks")
async def export_tasks(
    project_id: Optional[str] = Query(None, description="按项目ID筛选"),
    task_id: Optional[str] = Query(None, description="按任务ID筛选"),
    start_date: Optional[date] = Query(None, description="开始日期 (YYYY-MM-DD)"),
    end_date: Optional[date] = Query(None, description="结束日期 (YYYY-MM-DD)"),
    current_user: User = Depends(require_roles(UserRole.BRAND, UserRole.AGENCY, UserRole.OPERATOR)),
    db: AsyncSession = Depends(get_db),
):
    """
    导出任务数据为 CSV

    - 仅限品牌方和代理商角色
    - 支持按项目ID、时间范围筛选
    - 返回 CSV 文件流
    """
    # 构建查询，预加载关联数据
    query = (
        select(Task)
        .options(
            selectinload(Task.project).selectinload(Project.brand),
            selectinload(Task.agency),
            selectinload(Task.creator),
        )
        .order_by(Task.created_at.desc())
    )

    # 根据角色限定数据范围
    if current_user.role == UserRole.BRAND:
        result = await db.execute(
            select(Brand).where(Brand.user_id == current_user.id)
        )
        brand = result.scalar_one_or_none()
        if not brand:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="品牌方信息不存在",
            )
        # 品牌方只能导出自己项目下的任务
        query = query.join(Task.project).where(Project.brand_id == brand.id)

    elif current_user.role == UserRole.AGENCY:
        result = await db.execute(
            select(Agency).where(Agency.user_id == current_user.id)
        )
        agency = result.scalar_one_or_none()
        if not agency:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="代理商信息不存在",
            )
        # 代理商只能导出自己负责的任务
        query = query.where(Task.agency_id == agency.id)

    elif current_user.role == UserRole.OPERATOR:
        result = await db.execute(
            select(Operator).where(Operator.user_id == current_user.id)
        )
        operator = result.scalar_one_or_none()
        if not operator:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="代运营账号信息不存在",
            )
        query = query.join(Task.project).where(Project.config_scope_id == operator.workspace_id)

    # 可选筛选条件
    if project_id:
        query = query.where(Task.project_id == project_id)

    if task_id:
        query = query.where(Task.id == task_id)

    if start_date:
        query = query.where(Task.created_at >= datetime.combine(start_date, datetime.min.time()))

    if end_date:
        query = query.where(Task.created_at <= datetime.combine(end_date, datetime.max.time()))

    result = await db.execute(query)
    tasks = result.scalars().all()

    # 构建 CSV 数据
    header = ["任务ID", "任务名称", "项目名称", "客户名", "品牌名", "阶段", "达人名称", "达人平台", "代理商名称", "创建时间", "更新时间"]
    rows = []
    for task in tasks:
        creator_name = task.creator.name if task.creator else (task.creator_display_name or "")
        creator_platform = getattr(task, "creator_platform", "") or ""
        brand_name = ""
        client_name = ""
        if task.project:
            client_name = getattr(task.project, "client_display_name", "") or ""
            brand_name = (
                task.project.brand.name
                if task.project.brand
                else (getattr(task.project, "brand_display_name", "") or "")
            )
        rows.append([
            task.id,
            task.name,
            task.project.name if task.project else "",
            client_name,
            brand_name,
            _format_stage(task.stage),
            creator_name,
            creator_platform,
            task.agency.name if task.agency else "",
            _format_datetime(task.created_at),
            _format_datetime(task.updated_at),
        ])

    # 生成文件名
    filename = f"tasks_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"

    return StreamingResponse(
        _iter_csv(header, rows),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


@router.get("/audit-logs")
async def export_audit_logs(
    start_date: Optional[date] = Query(None, description="开始日期 (YYYY-MM-DD)"),
    end_date: Optional[date] = Query(None, description="结束日期 (YYYY-MM-DD)"),
    action: Optional[str] = Query(None, description="操作类型筛选 (如 login, create_project, review_task)"),
    current_user: User = Depends(require_roles(UserRole.BRAND)),
    db: AsyncSession = Depends(get_db),
):
    """
    导出审计日志为 CSV

    - 仅限品牌方角色
    - 支持按时间范围、操作类型筛选
    - 返回 CSV 文件流
    """
    # 验证品牌方身份
    result = await db.execute(
        select(Brand).where(Brand.user_id == current_user.id)
    )
    brand = result.scalar_one_or_none()
    if not brand:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="品牌方信息不存在",
        )

    # 构建查询
    query = select(AuditLog).order_by(AuditLog.created_at.desc())

    if start_date:
        query = query.where(AuditLog.created_at >= datetime.combine(start_date, datetime.min.time()))

    if end_date:
        query = query.where(AuditLog.created_at <= datetime.combine(end_date, datetime.max.time()))

    if action:
        query = query.where(AuditLog.action == action)

    result = await db.execute(query)
    logs = result.scalars().all()

    # 构建 CSV 数据
    header = ["日志ID", "操作类型", "资源类型", "资源ID", "操作用户", "用户角色", "详情", "IP地址", "操作时间"]
    rows = []
    for log in logs:
        rows.append([
            str(log.id),
            log.action or "",
            log.resource_type or "",
            log.resource_id or "",
            log.user_name or "",
            log.user_role or "",
            log.detail or "",
            log.ip_address or "",
            _format_datetime(log.created_at),
        ])

    # 生成文件名
    filename = f"audit_logs_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"

    return StreamingResponse(
        _iter_csv(header, rows),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )
