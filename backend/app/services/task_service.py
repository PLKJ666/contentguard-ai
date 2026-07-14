"""
任务服务
处理任务的创建、状态流转、审核等业务逻辑
"""

from typing import Optional, List, Tuple
from datetime import datetime, timezone
from sqlalchemy import select, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.task import Task, TaskStage, TaskStatus
from app.models.project import Project
from app.models.organization import Brand, Agency, Creator
from app.models.operator import Operator
from app.models.user import User, UserRole
from app.services.auth import generate_id


async def get_next_task_sequence(
    db: AsyncSession,
    project_id: str,
    creator_id: Optional[str] = None,
    creator_display_name: Optional[str] = None,
) -> int:
    """获取该项目下该达人的下一个任务序号"""
    conditions = [Task.project_id == project_id]
    if creator_id:
        conditions.append(Task.creator_id == creator_id)
    elif creator_display_name:
        conditions.append(
            and_(
                Task.creator_id.is_(None),
                Task.creator_display_name == creator_display_name,
            )
        )
    result = await db.execute(select(func.count(Task.id)).where(and_(*conditions)))
    count = result.scalar() or 0
    return count + 1


async def create_task(
    db: AsyncSession,
    project_id: str,
    agency_id: str,
    creator_id: Optional[str] = None,
    creator_display_name: Optional[str] = None,
    creator_platform: Optional[str] = None,
    creator_remark: Optional[str] = None,
    name: Optional[str] = None,
) -> Task:
    """
    创建任务（代理商操作）

    - 自动生成任务名称 "{项目名} 任务N"
    - 初始阶段: script_upload
    """
    # 获取序号
    sequence = await get_next_task_sequence(
        db,
        project_id,
        creator_id=creator_id,
        creator_display_name=creator_display_name,
    )

    # 生成任务名称
    if not name:
        proj_result = await db.execute(select(Project).where(Project.id == project_id))
        project = proj_result.scalar_one_or_none()
        project_name = project.name if project else project_id
        name = f"{project_name} 任务{sequence}"

    task = Task(
        id=generate_id("TK"),
        project_id=project_id,
        agency_id=agency_id,
        creator_id=creator_id,
        creator_display_name=creator_display_name,
        creator_platform=creator_platform,
        creator_remark=creator_remark,
        name=name,
        sequence=sequence,
        stage=TaskStage.SCRIPT_UPLOAD,
        appeal_count=1,  # 初始申诉次数
    )

    db.add(task)
    await db.flush()
    await db.refresh(task)

    return task


async def get_task_by_id(
    db: AsyncSession,
    task_id: str,
) -> Optional[Task]:
    """通过 ID 获取任务（带关联加载）"""
    result = await db.execute(
        select(Task)
        .options(
            selectinload(Task.project).selectinload(Project.brand),
            selectinload(Task.project).selectinload(Project.brief),
            selectinload(Task.agency),
            selectinload(Task.creator),
        )
        .where(Task.id == task_id)
    )
    return result.scalar_one_or_none()


async def check_task_permission(
    task: Task,
    user: User,
    db: AsyncSession,
) -> bool:
    """
    检查用户是否有权限访问任务

    - 达人: 只能访问分配给自己的任务
    - 代理商: 只能访问自己创建的任务
    - 品牌方: 可以访问自己项目下的所有任务
    """
    if user.role == UserRole.CREATOR:
        result = await db.execute(select(Creator).where(Creator.user_id == user.id))
        creator = result.scalar_one_or_none()
        return creator and task.creator_id == creator.id

    elif user.role == UserRole.AGENCY:
        result = await db.execute(select(Agency).where(Agency.user_id == user.id))
        agency = result.scalar_one_or_none()
        return agency and task.agency_id == agency.id

    elif user.role == UserRole.BRAND:
        result = await db.execute(select(Brand).where(Brand.user_id == user.id))
        brand = result.scalar_one_or_none()
        if not brand:
            return False

        result = await db.execute(select(Project).where(Project.id == task.project_id))
        project = result.scalar_one_or_none()
        return project and project.brand_id == brand.id

    elif user.role == UserRole.OPERATOR:
        result = await db.execute(select(Operator).where(Operator.user_id == user.id))
        operator = result.scalar_one_or_none()
        if not operator:
            return False

        result = await db.execute(select(Project).where(Project.id == task.project_id))
        project = result.scalar_one_or_none()
        return project and project.config_scope_id == operator.workspace_id

    return False


async def upload_script(
    db: AsyncSession,
    task: Task,
    file_url: Optional[str] = None,
    file_name: Optional[str] = None,
    text_content: Optional[str] = None,
) -> Task:
    """
    上传脚本（达人操作）

    - 支持文件上传或粘贴文字两种方式
    - 更新脚本信息
    - 状态流转到 script_ai_review
    """
    if task.stage not in [TaskStage.SCRIPT_UPLOAD, TaskStage.REJECTED]:
        raise ValueError(f"当前阶段 {task.stage.value} 不允许上传脚本")

    is_file_upload = bool(file_url and file_name)
    task.script_file_url = file_url  # 文件模式有值，文字模式为 None
    task.script_file_name = file_name or ("粘贴文本" if text_content else None)
    # 文件上传时忽略附带 text_content，避免旧前端或异常调用把占位文本写进脚本正文。
    task.script_text_content = None if is_file_upload else text_content
    task.script_uploaded_at = datetime.now(timezone.utc)
    task.stage = TaskStage.SCRIPT_AI_REVIEW

    # 重置旧的审核状态（从驳回/AI打回后重新上传时清除残留状态）
    task.script_agency_status = None
    task.script_agency_comment = None
    task.script_agency_corrected = None
    task.script_agency_corrected_file_url = None
    task.script_agency_corrected_file_name = None
    task.script_agency_corrected_file_type = None
    task.script_brand_status = None
    task.script_brand_comment = None

    # 如果是申诉重新上传，重置申诉状态
    if task.is_appeal:
        task.is_appeal = False
        task.appeal_reason = None

    await db.flush()
    await db.refresh(task)
    return task


async def upload_video(
    db: AsyncSession,
    task: Task,
    file_url: str,
    file_name: str,
    duration: Optional[int] = None,
    thumbnail_url: Optional[str] = None,
) -> Task:
    """
    上传视频（达人操作）

    - 更新视频信息
    - 状态流转到 video_ai_review
    """
    if task.stage not in [TaskStage.VIDEO_UPLOAD, TaskStage.REJECTED]:
        raise ValueError(f"当前阶段 {task.stage.value} 不允许上传视频")

    task.video_file_url = file_url
    task.video_file_name = file_name
    task.video_duration = duration
    task.video_thumbnail_url = thumbnail_url
    task.video_uploaded_at = datetime.now(timezone.utc)
    task.stage = TaskStage.VIDEO_AI_REVIEW

    # 重置旧的审核状态（从驳回/AI打回后重新上传时清除残留状态）
    task.video_agency_status = None
    task.video_agency_comment = None
    task.video_brand_status = None
    task.video_brand_comment = None

    # 如果是申诉重新上传，重置申诉状态
    if task.is_appeal:
        task.is_appeal = False
        task.appeal_reason = None

    await db.flush()
    await db.refresh(task)
    return task


AI_AUTO_REJECT_SCORE = 40
AI_SOFT_DISAGREE_THRESHOLD = 60  # AI 打低分但未达自动驳回线，人类通过则触发放宽学习


def _check_ai_auto_reject(score: int, result: dict) -> tuple[bool, str]:
    """
    判断 AI 审核结果是否应自动驳回（v2 格式）

    触发条件（任一）：
    1. legal / platform / brand_safety 有 violation → 打回
    2. content_quality 的 overall_verdict 为 needs_rework → 打回
    3. overall_score < 40 → 打回
    """
    if not result or not isinstance(result, dict):
        # 无有效结果，仅按分数判断
        if score < AI_AUTO_REJECT_SCORE:
            return True, f"综合评分 {score} 分，低于合格线 {AI_AUTO_REJECT_SCORE} 分"
        return False, ""

    reasons = []

    # 优先从 conclusions 结构读取（v2 格式）
    # AI 可能返回 "conclusions": null，用 or {} 确保不为 None
    conclusions = result.get("conclusions") or {}

    if conclusions:
        # 从 conclusions.violations 读取
        violations = conclusions.get("violations") or []
    else:
        # 兼容 v1 格式：直接从顶层 violations 读取
        violations = result.get("violations") or []

    # 过滤掉 None 元素，确保每个 violation 是 dict
    violations = [v for v in violations if v and isinstance(v, dict)]

    # 条件1: 法规合规有违规（兼容中英文维度名）
    legal_violations = [
        v for v in violations if v.get("dimension") in ("legal", "法规合规")
    ]
    if legal_violations:
        words = [v.get("content", "") for v in legal_violations[:5]]
        reasons.append(f"法规违规：{', '.join(words)}")

    # 条件2: 平台规则有违规
    platform_violations = [
        v for v in violations if v.get("dimension") in ("platform", "平台规则")
    ]
    if platform_violations:
        words = [v.get("content", "") for v in platform_violations[:5]]
        reasons.append(f"平台规则违规：{', '.join(words)}")

    # 条件3: 品牌安全有违规
    brand_violations = [
        v for v in violations if v.get("dimension") in ("brand_safety", "品牌安全")
    ]
    if brand_violations:
        words = [v.get("content", "") for v in brand_violations[:5]]
        reasons.append(f"品牌安全违规：{', '.join(words)}")

    # 条件4: content_quality needs_rework → 打回
    cq = conclusions.get("content_quality") or {}
    if isinstance(cq, dict) and cq.get("overall_verdict") == "needs_rework":
        reasons.append("内容质量评估为需要重做")

    # 条件5: 总分过低
    if score < AI_AUTO_REJECT_SCORE:
        reasons.append(f"综合评分 {score} 分，低于合格线 {AI_AUTO_REJECT_SCORE} 分")

    if reasons:
        return True, "；".join(reasons)
    return False, ""


async def complete_ai_review(
    db: AsyncSession,
    task: Task,
    review_type: str,  # "script" or "video"
    score: int,
    result: dict,
) -> Task:
    """
    完成 AI 审核

    - 更新 AI 审核结果
    - 标记严重问题：法规/平台/品牌安全有任何违规 或 总分 < 40
    - 脚本 / 视频审核都统一流转到代理商审核，由代理商决定是否打回达人
    """
    now = datetime.now(timezone.utc)
    auto_rejected, reject_reason = _check_ai_auto_reject(score, result)

    # 将分数和自动驳回信息写入 result，供学习触发和前端使用
    result["score"] = score
    if auto_rejected:
        result["ai_auto_rejected"] = True
        result["ai_reject_reason"] = reject_reason

    if review_type == "script":
        if task.stage != TaskStage.SCRIPT_AI_REVIEW:
            raise ValueError(f"当前阶段 {task.stage.value} 不在脚本 AI 审核中")

        task.script_ai_score = score
        task.script_ai_result = result
        task.script_ai_reviewed_at = now

        # 无论 AI 是否驳回，都推进到代理商审核
        # 代理商通过工作台处理 AI 违规，决定是否打回达人
        task.stage = TaskStage.SCRIPT_AGENCY_REVIEW

    elif review_type == "video":
        if task.stage != TaskStage.VIDEO_AI_REVIEW:
            raise ValueError(f"当前阶段 {task.stage.value} 不在视频 AI 审核中")

        task.video_ai_score = score
        task.video_ai_result = result
        task.video_ai_reviewed_at = now

        # 与脚本审核保持一致：即使 AI 判定为严重问题，也由代理商工作台处理后决定是否打回达人
        task.stage = TaskStage.VIDEO_AGENCY_REVIEW

    else:
        raise ValueError(f"不支持的审核类型: {review_type}")

    await db.flush()
    await db.refresh(task)
    return task


async def agency_review(
    db: AsyncSession,
    task: Task,
    reviewer_id: str,
    action: str,  # "pass" | "reject" | "force_pass"(仅脚本)
    skip_brand_review: bool = False,
    comment: Optional[str] = None,
    corrected_script: Optional[str] = None,
    corrected_file_url: Optional[str] = None,
    corrected_file_name: Optional[str] = None,
    corrected_file_type: Optional[str] = None,
) -> Task:
    """
    代理商审核

    - pass: 通过，进入品牌方审核（如果开启）或下一阶段
    - reject: 驳回，回到上传阶段
    - force_pass: 仅脚本阶段可用，跳过品牌方终审直接进入视频拍摄
    """
    now = datetime.now(timezone.utc)

    # 获取项目信息以检查是否开启品牌方终审
    project = await db.execute(
        select(Project)
        .options(selectinload(Project.brand))
        .where(Project.id == task.project_id)
    )
    project = project.scalar_one_or_none()
    brand_review_enabled = (
        project and project.brand and project.brand.final_review_enabled
    )
    should_enter_brand_review = brand_review_enabled and not skip_brand_review

    if task.stage == TaskStage.SCRIPT_AGENCY_REVIEW:
        if action == "pass":
            task.script_agency_status = TaskStatus.PASSED
            if should_enter_brand_review:
                task.stage = TaskStage.SCRIPT_BRAND_REVIEW
            else:
                task.stage = TaskStage.VIDEO_UPLOAD
        elif action == "reject":
            task.script_agency_status = TaskStatus.REJECTED
            task.stage = TaskStage.SCRIPT_UPLOAD  # 回到上传阶段，达人需重新上传
        elif action == "force_pass":
            # 跳过品牌方终审：代理商通过 + 品牌方自动标记为通过
            task.script_agency_status = TaskStatus.FORCE_PASSED
            task.script_brand_status = TaskStatus.PASSED
            task.stage = TaskStage.VIDEO_UPLOAD
        else:
            raise ValueError(f"不支持的操作: {action}")

        task.script_agency_comment = comment
        task.script_agency_reviewer_id = reviewer_id
        task.script_agency_reviewed_at = now
        # 保存修正后脚本（pass/force_pass 时有效）
        if corrected_script and action in ("pass", "force_pass"):
            task.script_agency_corrected = corrected_script
        if action in ("pass", "force_pass"):
            task.script_agency_corrected_file_url = corrected_file_url
            task.script_agency_corrected_file_name = corrected_file_name
            task.script_agency_corrected_file_type = corrected_file_type

    elif task.stage == TaskStage.VIDEO_AGENCY_REVIEW:
        if action == "force_pass":
            raise ValueError("视频审核阶段不支持跳过品牌终审")
        if action == "pass":
            task.video_agency_status = TaskStatus.PASSED
            if should_enter_brand_review:
                task.stage = TaskStage.VIDEO_BRAND_REVIEW
            else:
                task.stage = TaskStage.COMPLETED
        elif action == "reject":
            task.video_agency_status = TaskStatus.REJECTED
            task.stage = TaskStage.VIDEO_UPLOAD  # 回到上传阶段，达人需重新上传
        else:
            raise ValueError(f"不支持的操作: {action}")

        task.video_agency_comment = comment
        task.video_agency_reviewer_id = reviewer_id
        task.video_agency_reviewed_at = now

    else:
        raise ValueError(f"当前阶段 {task.stage.value} 不在代理商审核中")

    # 申诉任务处理：通过则恢复次数，驳回则仅重置标记
    if task.is_appeal:
        if action in ("pass", "force_pass"):
            task.appeal_count += 1
        task.is_appeal = False
        task.appeal_reason = None

    await db.flush()
    await db.refresh(task)
    return task


async def brand_review(
    db: AsyncSession,
    task: Task,
    reviewer_id: str,
    action: str,  # "pass" | "reject"
    comment: Optional[str] = None,
) -> Task:
    """
    品牌方终审

    - pass: 通过，进入下一阶段
    - reject: 驳回，回到上传阶段（需要走申诉流程）
    """
    now = datetime.now(timezone.utc)

    if task.stage == TaskStage.SCRIPT_BRAND_REVIEW:
        if action == "pass":
            task.script_brand_status = TaskStatus.PASSED
            task.stage = TaskStage.VIDEO_UPLOAD
        elif action == "reject":
            task.script_brand_status = TaskStatus.REJECTED
            task.stage = TaskStage.SCRIPT_UPLOAD  # 回到上传阶段，达人需重新上传
        else:
            raise ValueError(f"不支持的操作: {action}")

        task.script_brand_comment = comment
        task.script_brand_reviewer_id = reviewer_id
        task.script_brand_reviewed_at = now

    elif task.stage == TaskStage.VIDEO_BRAND_REVIEW:
        if action == "pass":
            task.video_brand_status = TaskStatus.PASSED
            task.stage = TaskStage.COMPLETED
        elif action == "reject":
            task.video_brand_status = TaskStatus.REJECTED
            task.stage = TaskStage.VIDEO_UPLOAD  # 回到上传阶段，达人需重新上传
        else:
            raise ValueError(f"不支持的操作: {action}")

        task.video_brand_comment = comment
        task.video_brand_reviewer_id = reviewer_id
        task.video_brand_reviewed_at = now

    else:
        raise ValueError(f"当前阶段 {task.stage.value} 不在品牌方审核中")

    await db.flush()
    await db.refresh(task)
    return task


async def submit_appeal(
    db: AsyncSession,
    task: Task,
    reason: str,
) -> Task:
    """
    提交申诉（达人操作）— 仅限 AI 打回时使用

    申诉 = 跳过 AI 审核，直接进入代理商人工审核
    代理商会看到这是一个申诉任务，可以查看 AI 打回原因和达人申诉理由
    """
    # 只有 AI 自动打回时才能申诉
    # AI 打回后 stage 回到 script_upload/video_upload，且 ai_result 有 ai_auto_rejected 标记
    is_script_ai_rejected = (
        task.stage == TaskStage.SCRIPT_UPLOAD
        and task.script_ai_result
        and task.script_ai_result.get("ai_auto_rejected")
    )
    is_video_ai_rejected = (
        task.stage == TaskStage.VIDEO_UPLOAD
        and task.video_ai_result
        and task.video_ai_result.get("ai_auto_rejected")
    )

    if not is_script_ai_rejected and not is_video_ai_rejected:
        raise ValueError("只有 AI 审核打回时才能申诉")

    if task.appeal_count <= 0:
        raise ValueError("申诉次数已用完，请联系代理商申请增加")

    # 消耗一次申诉次数
    task.appeal_count -= 1
    task.is_appeal = True
    task.appeal_reason = reason

    # 跳过 AI 审核，直接进入代理商审核
    if is_script_ai_rejected:
        task.stage = TaskStage.SCRIPT_AGENCY_REVIEW
    else:
        task.stage = TaskStage.VIDEO_AGENCY_REVIEW

    await db.flush()
    await db.refresh(task)
    return task


async def increase_appeal_count(
    db: AsyncSession,
    task: Task,
    additional_count: int = 1,
) -> Task:
    """
    增加申诉次数（代理商操作）
    """
    task.appeal_count += additional_count

    await db.flush()
    await db.refresh(task)
    return task


async def list_tasks_for_creator(
    db: AsyncSession,
    creator_id: str,
    page: int = 1,
    page_size: int = 20,
    stage: Optional[TaskStage] = None,
) -> Tuple[List[Task], int]:
    """获取达人的任务列表"""
    query = (
        select(Task)
        .options(
            selectinload(Task.project).selectinload(Project.brand),
            selectinload(Task.project).selectinload(Project.brief),
            selectinload(Task.agency),
            selectinload(Task.creator),
        )
        .where(Task.creator_id == creator_id)
    )

    if stage:
        query = query.where(Task.stage == stage)

    query = query.order_by(Task.created_at.desc())

    # 获取总数
    count_query = select(func.count(Task.id)).where(Task.creator_id == creator_id)
    if stage:
        count_query = count_query.where(Task.stage == stage)
    count_result = await db.execute(count_query)
    total = count_result.scalar() or 0

    # 分页
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    tasks = list(result.scalars().all())

    return tasks, total


async def list_tasks_for_agency(
    db: AsyncSession,
    agency_id: str,
    page: int = 1,
    page_size: int = 20,
    stage: Optional[TaskStage] = None,
    project_id: Optional[str] = None,
) -> Tuple[List[Task], int]:
    """获取代理商的任务列表"""
    query = (
        select(Task)
        .options(
            selectinload(Task.project).selectinload(Project.brand),
            selectinload(Task.project).selectinload(Project.brief),
            selectinload(Task.agency),
            selectinload(Task.creator),
        )
        .where(Task.agency_id == agency_id)
    )

    if stage:
        query = query.where(Task.stage == stage)
    if project_id:
        query = query.where(Task.project_id == project_id)

    query = query.order_by(Task.created_at.desc())

    # 获取总数
    count_query = select(func.count(Task.id)).where(Task.agency_id == agency_id)
    if stage:
        count_query = count_query.where(Task.stage == stage)
    if project_id:
        count_query = count_query.where(Task.project_id == project_id)
    count_result = await db.execute(count_query)
    total = count_result.scalar() or 0

    # 分页
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    tasks = list(result.scalars().all())

    return tasks, total


async def list_tasks_for_brand(
    db: AsyncSession,
    brand_id: str,
    page: int = 1,
    page_size: int = 20,
    stage: Optional[TaskStage] = None,
    project_id: Optional[str] = None,
) -> Tuple[List[Task], int]:
    """获取品牌方的任务列表（通过项目关联）"""
    if project_id:
        # 指定了项目 ID，直接筛选该项目的任务
        project_ids = [project_id]
    else:
        # 未指定项目，获取品牌方的所有项目
        project_ids_query = select(Project.id).where(Project.brand_id == brand_id)
        project_ids_result = await db.execute(project_ids_query)
        project_ids = [row[0] for row in project_ids_result.all()]

    if not project_ids:
        return [], 0

    query = (
        select(Task)
        .options(
            selectinload(Task.project).selectinload(Project.brand),
            selectinload(Task.project).selectinload(Project.brief),
            selectinload(Task.agency),
            selectinload(Task.creator),
        )
        .where(Task.project_id.in_(project_ids))
    )

    if stage:
        query = query.where(Task.stage == stage)

    query = query.order_by(Task.created_at.desc())

    # 获取总数
    count_query = select(func.count(Task.id)).where(Task.project_id.in_(project_ids))
    if stage:
        count_query = count_query.where(Task.stage == stage)
    count_result = await db.execute(count_query)
    total = count_result.scalar() or 0

    # 分页
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    tasks = list(result.scalars().all())

    return tasks, total


async def list_pending_reviews_for_agency(
    db: AsyncSession,
    agency_id: str,
    page: int = 1,
    page_size: int = 20,
) -> Tuple[List[Task], int]:
    """获取代理商待审核的任务列表"""
    stages = [TaskStage.SCRIPT_AGENCY_REVIEW, TaskStage.VIDEO_AGENCY_REVIEW]

    query = (
        select(Task)
        .options(
            selectinload(Task.project).selectinload(Project.brand),
            selectinload(Task.agency),
            selectinload(Task.creator),
        )
        .where(
            and_(
                Task.agency_id == agency_id,
                Task.stage.in_(stages),
            )
        )
    )

    query = query.order_by(Task.created_at.desc())

    # 获取总数
    count_query = select(func.count(Task.id)).where(
        and_(
            Task.agency_id == agency_id,
            Task.stage.in_(stages),
        )
    )
    count_result = await db.execute(count_query)
    total = count_result.scalar() or 0

    # 分页
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    tasks = list(result.scalars().all())

    return tasks, total


async def list_pending_reviews_for_brand(
    db: AsyncSession,
    brand_id: str,
    page: int = 1,
    page_size: int = 20,
) -> Tuple[List[Task], int]:
    """获取品牌方待审核的任务列表"""
    # 先获取品牌方的所有项目
    project_ids_query = select(Project.id).where(Project.brand_id == brand_id)
    project_ids_result = await db.execute(project_ids_query)
    project_ids = [row[0] for row in project_ids_result.all()]

    if not project_ids:
        return [], 0

    stages = [TaskStage.SCRIPT_BRAND_REVIEW, TaskStage.VIDEO_BRAND_REVIEW]

    query = (
        select(Task)
        .options(
            selectinload(Task.project).selectinload(Project.brand),
            selectinload(Task.agency),
            selectinload(Task.creator),
        )
        .where(
            and_(
                Task.project_id.in_(project_ids),
                Task.stage.in_(stages),
            )
        )
    )

    query = query.order_by(Task.created_at.desc())

    # 获取总数
    count_query = select(func.count(Task.id)).where(
        and_(
            Task.project_id.in_(project_ids),
            Task.stage.in_(stages),
        )
    )
    count_result = await db.execute(count_query)
    total = count_result.scalar() or 0

    # 分页
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    tasks = list(result.scalars().all())

    return tasks, total
