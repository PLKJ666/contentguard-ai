"""
品牌学习档案 API

功能：
- GET /brand-learning/rules — 查看品牌学习规则列表
- POST /brand-learning/rules — 手动添加规则
- DELETE /brand-learning/rules/{rule_id} — 删除规则
- POST /brand-learning/trigger — 触发 AI 学习分析（force_pass 时调用）
"""
import json
import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User, UserRole
from app.models.organization import Agency, Brand, brand_agency_association
from app.models.brand_learning import BrandLearnedRule
from app.models.operator import Operator
from app.models.task import Task
from app.models.brief import Brief
from app.models.project import Project
from app.api.deps import get_current_user
from app.services.auth import generate_id
from app.services.ai_service import AIServiceFactory

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/brand-learning", tags=["brand-learning"])


# ===== Schema =====

class LearnedRuleResponse(BaseModel):
    id: str
    type: str
    pattern: str
    reason: str
    source_task: Optional[str] = None
    created_by: str
    created_at: Optional[str] = None

    class Config:
        from_attributes = True


class LearnedRuleCreateRequest(BaseModel):
    type: str = Field(..., description="allowed_expression/tone_preference/false_positive/style_preference")
    pattern: str = Field(..., description="规则描述")
    reason: str = Field(..., description="规则原因")


class LearningTriggerRequest(BaseModel):
    task_id: str = Field(..., description="被 force_pass 的任务 ID")
    comment: Optional[str] = Field(None, description="代理商/品牌方 comment")


class LearningTriggerResponse(BaseModel):
    success: bool
    rule: Optional[LearnedRuleResponse] = None
    message: str = ""


# ===== API =====

@router.get("/rules", response_model=list[LearnedRuleResponse])
async def list_learned_rules(
    current_user: User = Depends(get_current_user),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    """查看当前配置空间的学习规则列表"""
    tenant_id, _ = await _resolve_learning_scope(current_user, x_tenant_id, db)
    result = await db.execute(
        select(BrandLearnedRule)
        .where(BrandLearnedRule.tenant_id == tenant_id)
        .order_by(BrandLearnedRule.created_at.desc())
    )
    rules = result.scalars().all()
    return [
        LearnedRuleResponse(
            id=r.id, type=r.type, pattern=r.pattern, reason=r.reason,
            source_task=r.source_task, created_by=r.created_by,
            created_at=str(r.created_at) if r.created_at else None,
        )
        for r in rules
    ]


@router.post("/rules", response_model=LearnedRuleResponse, status_code=201)
async def create_learned_rule(
    request: LearnedRuleCreateRequest,
    current_user: User = Depends(get_current_user),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    """手动添加学习规则"""
    tenant_id, brand_id = await _resolve_learning_scope(current_user, x_tenant_id, db)
    rule = BrandLearnedRule(
        id=generate_id("LR"),
        tenant_id=tenant_id,
        brand_id=brand_id,
        type=request.type,
        pattern=request.pattern,
        reason=request.reason,
        created_by="manual",
    )
    db.add(rule)
    await db.flush()
    await db.commit()

    return LearnedRuleResponse(
        id=rule.id, type=rule.type, pattern=rule.pattern, reason=rule.reason,
        source_task=None, created_by="manual",
        created_at=str(rule.created_at) if rule.created_at else None,
    )


@router.delete("/rules/{rule_id}")
async def delete_learned_rule(
    rule_id: str,
    current_user: User = Depends(get_current_user),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    """删除当前配置空间下的学习规则"""
    tenant_id, _ = await _resolve_learning_scope(current_user, x_tenant_id, db)
    result = await db.execute(
        select(BrandLearnedRule).where(
            BrandLearnedRule.id == rule_id,
            BrandLearnedRule.tenant_id == tenant_id,
        )
    )
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="规则不存在")

    await db.delete(rule)
    await db.commit()
    return {"detail": "已删除"}


@router.post("/trigger", response_model=LearningTriggerResponse)
async def trigger_learning(
    request: LearningTriggerRequest,
    current_user: User = Depends(get_current_user),
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    """
    触发 AI 学习分析

    在 force_pass 时调用，AI 分析为什么人类推翻了审核结果，
    提取可泛化的学习规则。
    """
    # 获取任务
    task_result = await db.execute(
        select(Task).where(Task.id == request.task_id)
    )
    task = task_result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")

    # 获取项目和品牌
    project_result = await db.execute(
        select(Project).where(Project.id == task.project_id)
    )
    project = project_result.scalar_one_or_none()
    if not project:
        return LearningTriggerResponse(success=False, message="项目不存在")

    tenant_id = project.config_scope_id or project.brand_id
    brand_id = project.brand_id
    if not tenant_id:
        return LearningTriggerResponse(success=False, message="项目缺少规则配置空间")

    # 获取 AI 审核结果
    ai_result = task.script_ai_result or task.video_ai_result
    if not ai_result:
        return LearningTriggerResponse(success=False, message="无 AI 审核结果")

    # 获取脚本内容
    script_content = ""
    if task.script_file_url and task.script_file_name:
        try:
            from app.services.document_parser import DocumentParser
            script_content = await DocumentParser.download_and_parse(
                task.script_file_url, task.script_file_name
            ) or ""
        except Exception:
            pass

    # 获取 Brief 摘要
    brief_summary = ""
    try:
        brief_result = await db.execute(
            select(Brief).where(Brief.project_id == project.id)
        )
        brief = brief_result.scalar_one_or_none()
        if brief:
            parts = []
            if brief.brand_tone:
                parts.append(f"品牌调性：{brief.brand_tone}")
            if brief.selling_points:
                sp_text = ", ".join(sp.get("content", "") for sp in brief.selling_points[:5])
                parts.append(f"卖点：{sp_text}")
            brief_summary = "；".join(parts)
    except Exception:
        pass

    # AI 学习分析
    try:
        ai_client = await AIServiceFactory.get_client(x_tenant_id, db)
        if not ai_client:
            return LearningTriggerResponse(success=False, message="AI 服务不可用")

        config = await AIServiceFactory.get_config(x_tenant_id, db)
        text_model = config.models.get("text", "gpt-4o") if config else "gpt-4o"

        # 构建学习分析 prompt
        violations_text = json.dumps(ai_result.get("violations", []), ensure_ascii=False, indent=2)
        comment_text = request.comment or "未填写"

        prompt = f"""以下是一次审核覆盖记录：

AI 原始审核结果中的违规项：
{violations_text}

脚本内容：
{script_content[:3000] if script_content else "（无法获取）"}

Brief 要求：{brief_summary or "（无法获取）"}

代理商/品牌方决策：force_pass（强制通过）
代理商 comment：{comment_text}

请分析人类为什么推翻了 AI 的判断，提取一条可泛化的学习规则。

以 JSON 返回：
{{
  "type": "allowed_expression/tone_preference/false_positive/style_preference",
  "pattern": "什么情况下不应标记（要可泛化，不要只针对这一个词/句）",
  "reason": "为什么不应标记（从品牌定位和平台特性角度解释）"
}}

type 说明：
- allowed_expression: 该表达方式在此品牌语境下是可接受的
- tone_preference: 品牌偏好的语言调性
- false_positive: AI 误判了这类表达
- style_preference: 品牌偏好的内容风格

要求：
- pattern 必须是可泛化的规则，不要只针对具体的词/句
- reason 要从品牌定位和平台特性角度解释
- 请只返回 JSON，不要包含其他内容"""

        response = await ai_client.chat_completion(
            messages=[{"role": "user", "content": prompt}],
            model=text_model,
            temperature=0.3,
            max_tokens=500,
        )

        result_text = response.content.strip()
        # 提取 JSON：去掉 markdown 包裹、前后额外文字
        import re
        m = re.search(r'```(?:json)?\s*\n(.*?)```', result_text, re.DOTALL)
        if m:
            result_text = m.group(1).strip()
        else:
            brace_match = re.search(r'\{.*\}', result_text, re.DOTALL)
            if brace_match:
                result_text = brace_match.group(0).strip()

        learned = json.loads(result_text)

        # 存入数据库
        rule = BrandLearnedRule(
            id=generate_id("LR"),
            tenant_id=tenant_id,
            brand_id=brand_id,
            type=learned.get("type", "false_positive"),
            pattern=learned.get("pattern", ""),
            reason=learned.get("reason", ""),
            source_task=request.task_id,
            created_by="ai_learning",
        )
        db.add(rule)
        await db.flush()

        # 通知品牌方
        try:
            if brand_id:
                from app.services.message_service import create_message

                brand_result2 = await db.execute(
                    select(Brand).where(Brand.id == brand_id)
                )
                brand_obj = brand_result2.scalar_one_or_none()
                if brand_obj and brand_obj.user_id:
                    await create_message(
                        db=db,
                        user_id=brand_obj.user_id,
                        type="system",
                        title="AI 新增学习规则",
                        content=f"AI 从任务 {request.task_id} 的审核覆盖中学习到新规则：{learned.get('pattern', '')}。如果您不认可此规则，可以在「学习档案管理」中删除。",
                        related_task_id=request.task_id,
                        sender_name="系统",
                    )
        except Exception as e:
            logger.warning(f"通知品牌方新学习规则失败: {e}")

        await db.commit()

        return LearningTriggerResponse(
            success=True,
            rule=LearnedRuleResponse(
                id=rule.id, type=rule.type, pattern=rule.pattern, reason=rule.reason,
                source_task=rule.source_task, created_by=rule.created_by,
                created_at=str(rule.created_at) if rule.created_at else None,
            ),
            message="学习规则已生成并通知品牌方",
        )

    except Exception as e:
        logger.error(f"AI 学习分析失败: {e}")
        return LearningTriggerResponse(success=False, message=f"学习分析失败: {str(e)[:100]}")


async def _resolve_learning_scope(
    user: User,
    x_tenant_id: str,
    db: AsyncSession,
) -> tuple[str, Optional[str]]:
    """解析学习档案的配置空间。

    - 品牌方：tenant_id = brand_id
    - 代理商：tenant_id = 当前选中的品牌 id
    - 代运营：tenant_id = operator.workspace_id
    """
    if user.role == UserRole.BRAND:
        result = await db.execute(select(Brand).where(Brand.user_id == user.id))
        brand = result.scalar_one_or_none()
        if not brand:
            raise HTTPException(status_code=404, detail="品牌不存在")
        if x_tenant_id and x_tenant_id != brand.id:
            raise HTTPException(status_code=403, detail="当前租户与品牌身份不匹配")
        return brand.id, brand.id

    if user.role == UserRole.AGENCY:
        if not x_tenant_id or x_tenant_id == "default":
            raise HTTPException(status_code=400, detail="代理商需先选择品牌租户")

        agency_result = await db.execute(select(Agency).where(Agency.user_id == user.id))
        agency = agency_result.scalar_one_or_none()
        if not agency:
            raise HTTPException(status_code=404, detail="代理商不存在")

        brand_result = await db.execute(
            select(Brand)
            .join(
                brand_agency_association,
                Brand.id == brand_agency_association.c.brand_id,
            )
            .where(
                Brand.id == x_tenant_id,
                brand_agency_association.c.agency_id == agency.id,
            )
        )
        brand = brand_result.scalar_one_or_none()
        if not brand:
            raise HTTPException(status_code=403, detail="无权访问当前品牌的学习档案")
        return brand.id, brand.id

    if user.role == UserRole.OPERATOR:
        operator_result = await db.execute(select(Operator).where(Operator.user_id == user.id))
        operator = operator_result.scalar_one_or_none()
        if not operator or not operator.is_active:
            raise HTTPException(status_code=404, detail="代运营账号不存在")
        if x_tenant_id and x_tenant_id != operator.workspace_id:
            raise HTTPException(status_code=403, detail="当前租户与代运营工作空间不匹配")
        return operator.workspace_id, None

    raise HTTPException(status_code=403, detail="当前角色无权操作学习档案")
