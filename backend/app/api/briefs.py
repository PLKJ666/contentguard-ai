"""
Brief API
项目 Brief 文档的 CRUD + AI 解析
"""

import ast
import json
import logging
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.user import User, UserRole
from app.models.project import Project
from app.models.brief import Brief
from app.models.organization import Brand, Agency
from app.models.operator import Operator
from app.api.deps import get_current_user
from app.schemas.brief import (
    BriefCreateRequest,
    BriefUpdateRequest,
    AgencyBriefUpdateRequest,
    BriefResponse,
)
from app.services.auth import generate_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects/{project_id}/brief", tags=["Brief"])
MIN_PDF_TEXT_CHARS_FOR_DIRECT_PARSE = 300
BRIEF_PARSE_MAX_ATTEMPTS = 4


async def _get_project_with_permission(
    project_id: str,
    current_user: User,
    db: AsyncSession,
    require_write: bool = False,
) -> Project:
    """获取项目并检查权限"""
    result = await db.execute(
        select(Project)
        .options(selectinload(Project.brand), selectinload(Project.agencies))
        .where(Project.id == project_id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    if current_user.role == UserRole.BRAND:
        brand_result = await db.execute(
            select(Brand).where(Brand.user_id == current_user.id)
        )
        brand = brand_result.scalar_one_or_none()
        if not brand or project.brand_id != brand.id:
            raise HTTPException(status_code=403, detail="无权访问此项目")
    elif current_user.role == UserRole.AGENCY:
        if require_write:
            raise HTTPException(status_code=403, detail="代理商无权修改 Brief")
        agency_result = await db.execute(
            select(Agency).where(Agency.user_id == current_user.id)
        )
        agency = agency_result.scalar_one_or_none()
        if not agency or agency not in project.agencies:
            raise HTTPException(status_code=403, detail="无权访问此项目")
    elif current_user.role == UserRole.CREATOR:
        # 达人可以查看 Brief（只读）
        if require_write:
            raise HTTPException(status_code=403, detail="达人无权修改 Brief")
    elif current_user.role == UserRole.OPERATOR:
        operator_result = await db.execute(
            select(Operator).where(Operator.user_id == current_user.id)
        )
        operator = operator_result.scalar_one_or_none()
        if not operator or project.config_scope_id != operator.workspace_id:
            raise HTTPException(status_code=403, detail="无权访问此项目")
    else:
        raise HTTPException(status_code=403, detail="无权访问")

    return project


def _brief_to_response(brief: Brief) -> BriefResponse:
    """转换 Brief 为响应"""
    return BriefResponse(
        id=brief.id,
        project_id=brief.project_id,
        project_name=brief.project.name if brief.project else None,
        file_url=brief.file_url,
        file_name=brief.file_name,
        product_name=brief.product_name,
        selling_points=brief.selling_points,
        min_selling_points=brief.min_selling_points,
        blacklist_words=brief.blacklist_words,
        competitors=brief.competitors,
        brand_tone=brief.brand_tone,
        min_duration=brief.min_duration,
        max_duration=brief.max_duration,
        other_requirements=brief.other_requirements,
        attachments=brief.attachments,
        agency_attachments=brief.agency_attachments,
        creative_rubric=brief.creative_rubric,
        created_at=brief.created_at,
        updated_at=brief.updated_at,
    )


@router.get("", response_model=BriefResponse)
async def get_brief(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取项目 Brief"""
    await _get_project_with_permission(project_id, current_user, db)

    result = await db.execute(
        select(Brief)
        .options(selectinload(Brief.project))
        .where(Brief.project_id == project_id)
    )
    brief = result.scalar_one_or_none()
    if not brief:
        raise HTTPException(status_code=404, detail="Brief 不存在")

    return _brief_to_response(brief)


@router.post("", response_model=BriefResponse, status_code=status.HTTP_201_CREATED)
async def create_brief(
    project_id: str,
    request: BriefCreateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """创建项目 Brief（品牌方操作）"""
    await _get_project_with_permission(project_id, current_user, db, require_write=True)

    # 检查是否已存在
    existing = await db.execute(select(Brief).where(Brief.project_id == project_id))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="该项目已有 Brief，请使用更新接口")

    brief = Brief(
        id=generate_id("BF"),
        project_id=project_id,
        file_url=request.file_url,
        file_name=request.file_name,
        product_name=request.product_name,
        selling_points=request.selling_points,
        min_selling_points=request.min_selling_points,
        blacklist_words=request.blacklist_words,
        competitors=request.competitors,
        brand_tone=request.brand_tone,
        min_duration=request.min_duration,
        max_duration=request.max_duration,
        other_requirements=request.other_requirements,
        attachments=request.attachments,
        agency_attachments=request.agency_attachments,
        creative_rubric=request.creative_rubric,
    )
    db.add(brief)
    await db.flush()

    # 重新加载
    result = await db.execute(
        select(Brief).options(selectinload(Brief.project)).where(Brief.id == brief.id)
    )
    brief = result.scalar_one()

    return _brief_to_response(brief)


@router.put("", response_model=BriefResponse)
async def update_brief(
    project_id: str,
    request: BriefUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """更新项目 Brief（品牌方操作）"""
    await _get_project_with_permission(project_id, current_user, db, require_write=True)

    result = await db.execute(
        select(Brief)
        .options(selectinload(Brief.project))
        .where(Brief.project_id == project_id)
    )
    brief = result.scalar_one_or_none()
    if not brief:
        raise HTTPException(status_code=404, detail="Brief 不存在")

    # 更新字段
    update_fields = request.model_dump(exclude_unset=True)
    for field, value in update_fields.items():
        setattr(brief, field, value)

    await db.flush()
    await db.refresh(brief)

    return _brief_to_response(brief)


@router.patch("/agency-attachments", response_model=BriefResponse)
async def update_brief_agency_attachments(
    project_id: str,
    request: AgencyBriefUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """更新 Brief 代理商配置（代理商操作）

    代理商可更新：agency_attachments、selling_points、blacklist_words。
    不能修改品牌方设置的核心 Brief 内容（文件、时长、竞品等）。
    """
    # 权限检查：代理商必须属于该项目
    result = await db.execute(
        select(Project)
        .options(selectinload(Project.brand), selectinload(Project.agencies))
        .where(Project.id == project_id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    if current_user.role == UserRole.AGENCY:
        agency_result = await db.execute(
            select(Agency).where(Agency.user_id == current_user.id)
        )
        agency = agency_result.scalar_one_or_none()
        if not agency or agency not in project.agencies:
            raise HTTPException(status_code=403, detail="无权访问此项目")
    elif current_user.role == UserRole.BRAND:
        # 品牌方也可以更新代理商附件
        brand_result = await db.execute(
            select(Brand).where(Brand.user_id == current_user.id)
        )
        brand = brand_result.scalar_one_or_none()
        if not brand or project.brand_id != brand.id:
            raise HTTPException(status_code=403, detail="无权访问此项目")
    else:
        raise HTTPException(status_code=403, detail="无权修改代理商附件")

    # 获取 Brief
    brief_result = await db.execute(
        select(Brief)
        .options(selectinload(Brief.project))
        .where(Brief.project_id == project_id)
    )
    brief = brief_result.scalar_one_or_none()
    if not brief:
        raise HTTPException(status_code=404, detail="Brief 不存在")

    # 更新代理商可编辑的字段
    update_fields = request.model_dump(exclude_unset=True)
    for field, value in update_fields.items():
        setattr(brief, field, value)

    await db.flush()
    await db.refresh(brief)

    return _brief_to_response(brief)


# ==================== AI 解析 ====================


class BriefParseResponse(BaseModel):
    """Brief AI 解析响应"""

    product_name: str = ""
    target_audience: str = ""
    content_requirements: str = ""
    selling_points: list[dict] = []
    blacklist_words: list[dict] = []
    creative_rubric: Optional[dict] = None


@router.post("/parse", response_model=BriefParseResponse)
async def parse_brief_with_ai(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    AI 解析 Brief 文档

    从品牌方上传的 Brief 文件中提取结构化信息：
    - 产品名称
    - 目标人群
    - 内容要求
    - 卖点建议
    - 违禁词建议
    """
    # 权限检查（代理商需要属于该项目）
    project = await _get_project_with_permission(project_id, current_user, db)

    # 获取 Brief
    result = await db.execute(
        select(Brief)
        .options(selectinload(Brief.project))
        .where(Brief.project_id == project_id)
    )
    brief = result.scalar_one_or_none()
    if not brief:
        raise HTTPException(
            status_code=404, detail="Brief 不存在，请先让品牌方创建 Brief"
        )

    # 收集所有可解析的文档 URL
    # 优先解析代理商上传的文件；若无则回退到品牌方文件
    documents: list[dict] = []

    if brief.agency_attachments:
        for att in brief.agency_attachments:
            if att.get("url") and att.get("name"):
                documents.append({"url": att["url"], "name": att["name"]})

    if not documents:
        raise HTTPException(status_code=400, detail="请先上传 Brief 文件后再解析")

    # 提取文本（每个文档限时 60 秒）；仅在文本过少时回退到图片 Vision。
    import asyncio
    from app.services.document_parser import DocumentParser

    all_texts = []
    all_images: list[str] = []  # base64 图片列表（用于图片型 PDF）

    for doc in documents:
        doc_name_lower = doc["name"].lower()
        extracted_text = ""
        try:
            extracted_text = await asyncio.wait_for(
                DocumentParser.download_and_parse(doc["url"], doc["name"]),
                timeout=60.0,
            )
            normalized_text = extracted_text.strip()
            if normalized_text:
                # 某些设计稿式 PDF 会被启发式误判成图片型，但实际可提取到足够文本。
                if (
                    doc_name_lower.endswith(".pdf")
                    and len(normalized_text) < MIN_PDF_TEXT_CHARS_FOR_DIRECT_PARSE
                ):
                    logger.info(
                        f"文档 {doc['name']} 提取到 {len(normalized_text)} 字符，低于 PDF 文本阈值，尝试图片 Vision 兜底"
                    )
                else:
                    all_texts.append(f"=== {doc['name']} ===\n{normalized_text}")
                    logger.info(f"成功解析文档 {doc['name']}，提取 {len(normalized_text)} 字符")
                    continue

            if doc_name_lower.endswith((".pdf", ".docx", ".doc", ".xlsx", ".xls")):
                if normalized_text:
                    logger.warning(f"文档 {doc['name']} 文本较少，尝试提取图片作为 Vision 兜底")
                else:
                    logger.warning(f"文档 {doc['name']} 文本提取为空，尝试提取嵌入图片")

                fallback_images = (
                    await DocumentParser.download_and_get_images(
                        doc["url"], doc["name"]
                    )
                    or []
                )
                if fallback_images:
                    all_images.extend(fallback_images)
                    logger.info(
                        f"文档 {doc['name']} 提取到 {len(fallback_images)} 张图片，将用 Vision 解析"
                    )
                    continue

            if normalized_text:
                all_texts.append(f"=== {doc['name']} ===\n{normalized_text}")
                logger.info(
                    f"文档 {doc['name']} 未提取到可用图片，回退使用 {len(normalized_text)} 字符的文本结果"
                )
            else:
                logger.warning(f"文档 {doc['name']} 文本和图片均为空，已跳过")
        except asyncio.TimeoutError:
            logger.warning(f"解析文档 {doc['name']} 超时(60s)，已跳过")
        except Exception as e:
            logger.warning(f"解析文档 {doc['name']} 失败: {e}")

    if not all_texts and not all_images:
        raise HTTPException(
            status_code=400, detail="所有文档均解析失败，无法提取文本内容"
        )

    combined_text = "\n\n".join(all_texts)

    # 截断过长文本
    max_chars = 15000
    if len(combined_text) > max_chars:
        combined_text = combined_text[:max_chars] + "\n...(内容已截断)"

    # 获取 AI 客户端
    from app.services.ai_service import AIServiceFactory

    tenant_id = project.config_scope_id or project.brand_id or "default"
    logger.info(
        "Brief AI 解析: project=%s, brand_id=%s, config_scope_id=%s, tenant_id=%s",
        project_id,
        project.brand_id,
        project.config_scope_id,
        tenant_id,
    )
    ai_client = await AIServiceFactory.get_client(tenant_id, db)
    if not ai_client:
        logger.error(f"Brief AI 解析失败: tenant_id={tenant_id} 无可用 AI 配置")
        raise HTTPException(
            status_code=400,
            detail=f"AI 服务未配置（租户: {tenant_id}），请先前往「AI 配置」页面设置 API 密钥和服务地址",
        )

    config = await AIServiceFactory.get_config(tenant_id, db)
    text_model = "gpt-4o"
    vision_model = "gpt-4o"
    if config and config.models:
        text_model = config.models.get("text", "gpt-4o")
        vision_model = config.models.get("vision", config.models.get("text", "gpt-4o"))

    # 构建 Brief 解析 prompt
    # 这里先只提取页面当前真正需要展示/保存的核心字段。
    # creative_rubric 体积大、生成慢，而当前同步解析链路并不会立即消费它，
    # 会显著增加超时概率，因此不再放进主解析请求中。
    brief_json_schema = """{
  "product_name": "产品名称",
  "target_audience": "目标人群描述",
  "content_requirements": "内容创作要求的简要总结",
  "selling_points": ["卖点1", "卖点2", "卖点3"],
  "blacklist_words": ["违禁词1", "违禁词2"]
}"""

    brief_instructions = """说明：
- product_name: 从文档中识别的产品/品牌名称
- target_audience: 目标消费人群
- content_requirements: 对达人创作内容的要求（时长、风格、场景等）
- selling_points: 产品卖点字符串数组
  - 尽量穷举文档里明确写出的核心卖点、功能点、差异化利益点，不要只做笼统总结
  - 最多返回 10 条，每条尽量控制在 30 个字以内
  - 按重要程度排序，最重要的放前面
  - 如果文档里有并列卖点，请拆开返回，不要合并成一句泛化描述
- blacklist_words: 需要避免的词语字符串数组
  - 最多返回 8 条，只返回词语本身，不要附带解释
- 如果文档信息很多，请优先保留最重要、最明确的要求，避免输出过长
- 重要：JSON 字符串值中不要使用中文引号（\u201c\u201d），使用单引号或直接省略"""

    # 根据文档类型选择 AI 解析模式
    use_vision = bool(all_images) and not combined_text.strip()

    last_error = None
    last_raw_response = ""
    for attempt in range(BRIEF_PARSE_MAX_ATTEMPTS):
        try:
            if use_vision:
                # 图片型 PDF — 使用 vision 模型多模态解析
                prompt_base = """你是营销内容合规审核专家。以下是品牌方 Brief 文档的页面截图。
请仔细阅读所有页面，并从中提取结构化信息。"""
                prompt_text = (
                    f"""{prompt_base}

请以 JSON 格式返回，不要包含其他内容：
{brief_json_schema}

{brief_instructions}"""
                    if attempt == 0 or not last_raw_response
                    else _build_json_retry_instruction(
                        prompt_base=prompt_base,
                        json_schema=brief_json_schema,
                        previous_response=last_raw_response,
                    )
                )
                msg_content: list[dict] = [
                    {
                        "type": "text",
                        "text": prompt_text,
                    }
                ]
                for b64 in all_images:
                    msg_content.append(
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/png;base64,{b64}"},
                        }
                    )

                response = await ai_client.chat_completion(
                    messages=[{"role": "user", "content": msg_content}],
                    model=vision_model,
                    temperature=0.2 if attempt == 0 else 0.0,
                    max_tokens=4000,
                )
            else:
                # 文本模式
                prompt_base = "你是营销内容合规审核专家。请从以下品牌方 Brief 文档中提取结构化信息。"
                prompt = (
                    f"""{prompt_base}

文档内容：
{combined_text}

请以 JSON 格式返回，不要包含其他内容：
{brief_json_schema}

{brief_instructions}"""
                    if attempt == 0 or not last_raw_response
                    else _build_json_retry_instruction(
                        prompt_base=prompt_base,
                        json_schema=brief_json_schema,
                        previous_response=last_raw_response,
                        source_text=combined_text,
                    )
                )

                response = await ai_client.chat_completion(
                    messages=[{"role": "user", "content": prompt}],
                    model=text_model,
                    temperature=0.2 if attempt == 0 else 0.0,
                    max_tokens=1800,
                )

            # 提取 JSON
            logger.info(
                f"AI 原始响应 (attempt={attempt}, vision={use_vision}): {response.content[:500]}"
            )
            last_raw_response = response.content
            content = _extract_json_from_response(response.content)
            logger.info(f"提取的 JSON: {content[:500]}")
            parsed = json.loads(content)
            if isinstance(parsed, str):
                parsed = json.loads(parsed)

            return BriefParseResponse(
                product_name=parsed.get("product_name", ""),
                target_audience=parsed.get("target_audience", ""),
                content_requirements=parsed.get("content_requirements", ""),
                selling_points=_normalize_selling_points(parsed.get("selling_points", [])),
                blacklist_words=_normalize_blacklist_words(parsed.get("blacklist_words", [])),
                creative_rubric=parsed.get("creative_rubric"),
            )

        except json.JSONDecodeError as e:
            last_error = e
            logger.warning(
                f"AI 返回内容非 JSON (attempt={attempt}): {e}, raw={response.content[:300]}"
            )
            continue
        except Exception as e:
            logger.error(f"AI 解析 Brief 失败: {e}")
            raise HTTPException(status_code=500, detail=f"AI 解析失败: {str(e)[:200]}")

    logger.error(
        "AI 解析 Brief JSON 格式错误，连续 %s 次自动重试均失败: %s",
        BRIEF_PARSE_MAX_ATTEMPTS,
        last_error,
    )
    raise HTTPException(status_code=500, detail="AI 解析结果格式错误，请重试")


def _normalize_selling_points(raw_points: object) -> list[dict]:
    normalized: list[dict] = []
    if not isinstance(raw_points, list):
        return normalized

    for item in raw_points:
        if isinstance(item, str):
            content = item.strip()
            if content:
                normalized.append({"content": content, "priority": "recommended"})
            continue

        if isinstance(item, dict):
            content = str(item.get("content", "")).strip()
            if not content:
                continue
            priority = str(item.get("priority", "recommended")).strip() or "recommended"
            if priority not in {"core", "recommended", "reference"}:
                priority = "recommended"
            normalized.append({"content": content, "priority": priority})

    return normalized


def _normalize_blacklist_words(raw_words: object) -> list[dict]:
    normalized: list[dict] = []
    if not isinstance(raw_words, list):
        return normalized

    for item in raw_words:
        if isinstance(item, str):
            word = item.strip()
            if word:
                normalized.append({"word": word, "reason": ""})
            continue

        if isinstance(item, dict):
            word = str(item.get("word", "")).strip()
            if not word:
                continue
            reason = str(item.get("reason", "")).strip()
            normalized.append({"word": word, "reason": reason})

    return normalized


def _extract_balanced_json_segment(text: str) -> Optional[str]:
    start_index = -1
    for index, char in enumerate(text):
        if char in "{[":
            start_index = index
            break

    if start_index == -1:
        return None

    stack: list[str] = []
    in_string = False
    escaped = False

    for index in range(start_index, len(text)):
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
                continue
            if char == "\\":
                escaped = True
                continue
            if char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
            continue
        if char in "{[":
            stack.append(char)
            continue
        if char in "}]":
            if not stack:
                continue
            expected = "}" if stack[-1] == "{" else "]"
            if char != expected:
                continue
            stack.pop()
            if not stack:
                return text[start_index : index + 1].strip()

    return None


def _strip_trailing_commas(text: str) -> str:
    result: list[str] = []
    in_string = False
    escaped = False
    index = 0

    while index < len(text):
        char = text[index]
        if in_string:
            result.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            index += 1
            continue

        if char == '"':
            in_string = True
            result.append(char)
            index += 1
            continue

        if char == ",":
            lookahead = index + 1
            while lookahead < len(text) and text[lookahead].isspace():
                lookahead += 1
            if lookahead < len(text) and text[lookahead] in "}]":
                index += 1
                continue

        result.append(char)
        index += 1

    return "".join(result)


def _normalize_json_candidate(text: str) -> str:
    import re

    normalized = (text or "").replace("\ufeff", "").replace("\r\n", "\n").replace("\r", "\n").strip()
    fence_match = re.fullmatch(r"```(?:json)?\s*(.*?)```", normalized, re.DOTALL | re.IGNORECASE)
    if fence_match:
        normalized = fence_match.group(1).strip()

    if normalized.lower().startswith("json\n"):
        normalized = normalized.split("\n", 1)[1].strip()

    return _sanitize_json_string(normalized)


def _iter_json_candidates(raw: str) -> list[str]:
    import re

    text = (raw or "").strip()
    candidates: list[str] = []

    def add(candidate: Optional[str]) -> None:
        value = (candidate or "").strip()
        if value and value not in candidates:
            candidates.append(value)

    add(text)

    for matched in re.finditer(r"```(?:json)?\s*(.*?)```", text, re.DOTALL | re.IGNORECASE):
        add(matched.group(1))

    if text.startswith("```"):
        lines = text.splitlines()
        if len(lines) > 1:
            body = "\n".join(lines[1:])
            if body.rstrip().endswith("```"):
                body = body.rstrip()[:-3]
            add(body)

    add(_extract_balanced_json_segment(text))

    first_brace = min(
        [index for index in (text.find("{"), text.find("[")) if index != -1],
        default=-1,
    )
    if first_brace != -1:
        last_brace = max(text.rfind("}"), text.rfind("]"))
        if last_brace > first_brace:
            add(text[first_brace : last_brace + 1])

    return candidates


def _extract_json_from_response(raw: str) -> str:
    """从 AI 响应中提取并修复 JSON 内容。"""
    last_error: Optional[Exception] = None

    for candidate in _iter_json_candidates(raw):
        normalized = _normalize_json_candidate(candidate)
        if not normalized:
            continue

        repair_candidates = [normalized]
        balanced = _extract_balanced_json_segment(normalized)
        if balanced and balanced not in repair_candidates:
            repair_candidates.append(balanced)

        trimmed_commas = _strip_trailing_commas(normalized)
        if trimmed_commas not in repair_candidates:
            repair_candidates.append(trimmed_commas)

        if balanced:
            balanced_trimmed = _strip_trailing_commas(balanced)
            if balanced_trimmed not in repair_candidates:
                repair_candidates.append(balanced_trimmed)

        for repair_candidate in repair_candidates:
            try:
                parsed = json.loads(repair_candidate)
                return json.dumps(parsed, ensure_ascii=False)
            except json.JSONDecodeError as exc:
                last_error = exc

            try:
                parsed = ast.literal_eval(repair_candidate)
            except (ValueError, SyntaxError) as exc:
                last_error = exc
                continue

            return json.dumps(parsed, ensure_ascii=False)

    raise json.JSONDecodeError("Unable to extract valid JSON from AI response", raw or "", 0) from last_error


def _sanitize_json_string(text: str) -> str:
    """
    清理 AI 返回的 JSON 文本中的中文引号等特殊字符。
    中文引号 "" 在 JSON 字符串值内会破坏解析。
    """
    result = []
    in_string = False
    i = 0
    while i < len(text):
        ch = text[i]
        if ch == "\\" and in_string and i + 1 < len(text):
            result.append(ch)
            result.append(text[i + 1])
            i += 2
            continue
        if ch == '"' and not in_string:
            in_string = True
            result.append(ch)
        elif ch == '"' and in_string:
            in_string = False
            result.append(ch)
        elif in_string and ch in "\u201c\u201d\u300c\u300d":
            # 中文引号 "" 和「」 → 单引号
            result.append("'")
        elif not in_string and ch in "\u201c\u201d":
            # JSON 结构层的中文引号 → 英文双引号
            result.append('"')
        else:
            result.append(ch)
        i += 1
    return "".join(result)


def _build_json_retry_instruction(
    *,
    prompt_base: str,
    json_schema: str,
    previous_response: str,
    source_text: str = "",
) -> str:
    previous_block = previous_response.strip()
    if len(previous_block) > 6000:
        previous_block = previous_block[:6000] + "\n...(上次输出已截断)"

    source_block = f"\n\n原始文档内容：\n{source_text}" if source_text else ""

    return (
        f"{prompt_base}\n\n"
        "你上一条回复不是合法 JSON，系统无法解析。\n"
        "现在请重新输出一个可直接被 json.loads 解析的单个 JSON 对象。\n"
        "硬性要求：\n"
        "- 不要 markdown 代码块\n"
        "- 不要解释、标题、前后缀\n"
        "- 不要注释\n"
        "- 不要尾逗号\n"
        "- 所有 JSON 键名必须使用英文双引号\n"
        "- 字段名必须与模板完全一致，不要新增字段\n"
        "- 如果某字段没有内容，使用空字符串、空数组或 null\n"
        "- 只返回一个 JSON 对象\n"
        f"{source_block}\n\n"
        f"你上一次的原始输出：\n{previous_block}\n\n"
        f"返回 JSON 模板：\n{json_schema}"
    )
