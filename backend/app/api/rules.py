"""
规则管理 API
违禁词库、白名单、竞品库、平台规则
"""
import json
import logging
import uuid
from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel, Field
from typing import Optional
from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.tenant import Tenant
from app.models.rule import ForbiddenWord, WhitelistItem, Competitor, PlatformRule, RuleStatus
from app.schemas.rules import (
    PlatformRuleParseRequest,
    PlatformRuleParseResponse,
    PlatformRuleConfirmRequest,
    PlatformRuleResponse as PlatformRuleDBResponse,
    PlatformRuleListResponse as PlatformRuleDBListResponse,
    ParsedRulesData,
    RuleDocumentParseRequest,
    RuleDocumentParseResponse,
    RuleDocumentConfirmRequest,
    RuleDocumentConfirmResponse,
    ParsedForbiddenWord,
    ParsedWhitelistItem,
    ParsedCompetitor,
)
from app.services.document_parser import DocumentParser
from app.services.ai_service import AIServiceFactory

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/rules", tags=["rules"])


# ==================== 请求/响应模型 ====================

class ForbiddenWordCreate(BaseModel):
    word: str
    category: str
    severity: str


class ForbiddenWordResponse(BaseModel):
    id: str
    word: str
    category: str
    severity: str


class ForbiddenWordListResponse(BaseModel):
    items: list[ForbiddenWordResponse]
    total: int


class WhitelistCreate(BaseModel):
    term: str
    reason: str
    brand_id: str


class WhitelistResponse(BaseModel):
    id: str
    term: str
    reason: str
    brand_id: str


class WhitelistListResponse(BaseModel):
    items: list[WhitelistResponse]
    total: int


class CompetitorCreate(BaseModel):
    name: str
    brand_id: str
    logo_url: Optional[str] = None
    keywords: list[str] = Field(default_factory=list)


class CompetitorResponse(BaseModel):
    id: str
    name: str
    brand_id: str
    logo_url: Optional[str] = None
    keywords: list[str] = Field(default_factory=list)


class CompetitorListResponse(BaseModel):
    items: list[CompetitorResponse]
    total: int


class PlatformRuleResponse(BaseModel):
    platform: str
    rules: list[dict]
    version: str
    updated_at: str


class PlatformListResponse(BaseModel):
    items: list[PlatformRuleResponse]
    total: int


class RuleValidateRequest(BaseModel):
    brand_id: str
    platform: str
    brief_rules: dict


class RuleConflict(BaseModel):
    brief_rule: str
    platform_rule: str
    suggestion: str


class RuleValidateResponse(BaseModel):
    conflicts: list[RuleConflict]


# ==================== 预置平台规则 ====================

_platform_rules = {
    "douyin": {
        "platform": "douyin",
        "rules": [
            {"type": "forbidden_word", "words": ["最好", "第一", "最佳", "绝对", "100%"]},
            {"type": "duration", "min_seconds": 7},
        ],
        "version": "2024.01",
        "updated_at": "2024-01-15T00:00:00Z",
    },
    "xiaohongshu": {
        "platform": "xiaohongshu",
        "rules": [
            {"type": "forbidden_word", "words": [
                "最好", "绝对", "100%", "第一", "最佳", "国家级", "顶级",
                "万能", "神器", "秒杀", "碾压", "永久", "根治",
                "一次见效", "立竿见影", "无副作用",
            ]},
        ],
        "version": "2024.06",
        "updated_at": "2024-06-15T00:00:00Z",
    },
    "bilibili": {
        "platform": "bilibili",
        "rules": [
            {"type": "forbidden_word", "words": ["最好", "第一"]},
        ],
        "version": "2024.01",
        "updated_at": "2024-01-12T00:00:00Z",
    },
}


# ==================== 辅助函数 ====================

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


# ==================== 违禁词库 ====================

@router.get("/forbidden-words", response_model=ForbiddenWordListResponse)
async def list_forbidden_words(
    category: str = None,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
) -> ForbiddenWordListResponse:
    """查询违禁词列表"""
    query = select(ForbiddenWord).where(ForbiddenWord.tenant_id == x_tenant_id)

    if category:
        query = query.where(ForbiddenWord.category == category)

    result = await db.execute(query)
    words = result.scalars().all()

    return ForbiddenWordListResponse(
        items=[
            ForbiddenWordResponse(
                id=w.id,
                word=w.word,
                category=w.category,
                severity=w.severity,
            )
            for w in words
        ],
        total=len(words),
    )


@router.post(
    "/forbidden-words",
    response_model=ForbiddenWordResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_forbidden_word(
    request: ForbiddenWordCreate,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
) -> ForbiddenWordResponse:
    """添加违禁词"""
    # 确保租户存在
    await _ensure_tenant_exists(x_tenant_id, db)

    # 检查重复
    result = await db.execute(
        select(ForbiddenWord).where(
            and_(
                ForbiddenWord.tenant_id == x_tenant_id,
                ForbiddenWord.word == request.word,
            )
        )
    )
    existing = result.scalar_one_or_none()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"违禁词已存在: {request.word}",
        )

    word_id = f"fw-{uuid.uuid4().hex[:8]}"
    word = ForbiddenWord(
        id=word_id,
        tenant_id=x_tenant_id,
        word=request.word,
        category=request.category,
        severity=request.severity,
    )
    db.add(word)
    await db.flush()

    return ForbiddenWordResponse(
        id=word.id,
        word=word.word,
        category=word.category,
        severity=word.severity,
    )


@router.delete("/forbidden-words/{word_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_forbidden_word(
    word_id: str,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    """删除违禁词"""
    result = await db.execute(
        select(ForbiddenWord).where(
            and_(
                ForbiddenWord.id == word_id,
                ForbiddenWord.tenant_id == x_tenant_id,
            )
        )
    )
    word = result.scalar_one_or_none()

    if not word:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"违禁词不存在: {word_id}",
        )

    await db.delete(word)
    await db.flush()


# ==================== 白名单 ====================

@router.get("/whitelist", response_model=WhitelistListResponse)
async def list_whitelist(
    brand_id: str = None,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
) -> WhitelistListResponse:
    """查询白名单"""
    query = select(WhitelistItem).where(WhitelistItem.tenant_id == x_tenant_id)

    if brand_id:
        query = query.where(WhitelistItem.brand_id == brand_id)

    result = await db.execute(query)
    items = result.scalars().all()

    return WhitelistListResponse(
        items=[
            WhitelistResponse(
                id=item.id,
                term=item.term,
                reason=item.reason,
                brand_id=item.brand_id,
            )
            for item in items
        ],
        total=len(items),
    )


@router.post(
    "/whitelist",
    response_model=WhitelistResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_to_whitelist(
    request: WhitelistCreate,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
) -> WhitelistResponse:
    """添加白名单"""
    # 确保租户存在
    await _ensure_tenant_exists(x_tenant_id, db)

    item_id = f"wl-{uuid.uuid4().hex[:8]}"
    item = WhitelistItem(
        id=item_id,
        tenant_id=x_tenant_id,
        brand_id=request.brand_id,
        term=request.term,
        reason=request.reason,
    )
    db.add(item)
    await db.flush()

    return WhitelistResponse(
        id=item.id,
        term=item.term,
        reason=item.reason,
        brand_id=item.brand_id,
    )


@router.delete("/whitelist/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_whitelist_item(
    item_id: str,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    """删除白名单项"""
    result = await db.execute(
        select(WhitelistItem).where(
            and_(
                WhitelistItem.id == item_id,
                WhitelistItem.tenant_id == x_tenant_id,
            )
        )
    )
    item = result.scalar_one_or_none()

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"白名单项不存在: {item_id}",
        )

    await db.delete(item)
    await db.flush()


# ==================== 竞品库 ====================

@router.get("/competitors", response_model=CompetitorListResponse)
async def list_competitors(
    brand_id: str = None,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
) -> CompetitorListResponse:
    """查询竞品列表"""
    query = select(Competitor).where(Competitor.tenant_id == x_tenant_id)

    if brand_id:
        query = query.where(Competitor.brand_id == brand_id)

    result = await db.execute(query)
    competitors = result.scalars().all()

    return CompetitorListResponse(
        items=[
            CompetitorResponse(
                id=c.id,
                name=c.name,
                brand_id=c.brand_id,
                logo_url=c.logo_url,
                keywords=c.keywords or [],
            )
            for c in competitors
        ],
        total=len(competitors),
    )


@router.post(
    "/competitors",
    response_model=CompetitorResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_competitor(
    request: CompetitorCreate,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
) -> CompetitorResponse:
    """添加竞品"""
    # 确保租户存在
    await _ensure_tenant_exists(x_tenant_id, db)

    comp_id = f"comp-{uuid.uuid4().hex[:8]}"
    competitor = Competitor(
        id=comp_id,
        tenant_id=x_tenant_id,
        brand_id=request.brand_id,
        name=request.name,
        logo_url=request.logo_url,
        keywords=request.keywords,
    )
    db.add(competitor)
    await db.flush()

    return CompetitorResponse(
        id=competitor.id,
        name=competitor.name,
        brand_id=competitor.brand_id,
        logo_url=competitor.logo_url,
        keywords=competitor.keywords or [],
    )


@router.delete("/competitors/{competitor_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_competitor(
    competitor_id: str,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    """删除竞品"""
    result = await db.execute(
        select(Competitor).where(
            and_(
                Competitor.id == competitor_id,
                Competitor.tenant_id == x_tenant_id,
            )
        )
    )
    competitor = result.scalar_one_or_none()

    if not competitor:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"竞品不存在: {competitor_id}",
        )

    await db.delete(competitor)
    await db.flush()


# ==================== 平台规则 ====================

@router.get("/platforms", response_model=PlatformListResponse)
async def list_platform_rules() -> PlatformListResponse:
    """查询所有平台规则"""
    return PlatformListResponse(
        items=[PlatformRuleResponse(**r) for r in _platform_rules.values()],
        total=len(_platform_rules),
    )


@router.get("/platforms/{platform}", response_model=PlatformRuleResponse)
async def get_platform_rules(platform: str) -> PlatformRuleResponse:
    """查询指定平台规则"""
    if platform not in _platform_rules:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"平台不存在: {platform}",
        )
    return PlatformRuleResponse(**_platform_rules[platform])


# ==================== 规则冲突检测 ====================

@router.post("/validate", response_model=RuleValidateResponse)
async def validate_rules(
    request: RuleValidateRequest,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
) -> RuleValidateResponse:
    """检测 Brief 与平台规则冲突（合并 DB 规则 + 硬编码兜底）"""
    conflicts = []

    # 1. 收集违禁词：DB active 规则优先，硬编码兜底
    db_rules = await get_active_platform_rules(
        x_tenant_id, request.brand_id, request.platform, db
    )
    forbidden_words: set[str] = set()
    min_seconds: Optional[int] = None
    max_seconds: Optional[int] = None

    if db_rules:
        forbidden_words.update(db_rules.get("forbidden_words", []))
        duration = db_rules.get("duration") or {}
        min_seconds = duration.get("min_seconds")
        max_seconds = duration.get("max_seconds")

    # 硬编码兜底
    hardcoded = _platform_rules.get(request.platform, {})
    for rule in hardcoded.get("rules", []):
        if rule.get("type") == "forbidden_word":
            forbidden_words.update(rule.get("words", []))
        elif rule.get("type") == "duration" and min_seconds is None:
            if rule.get("min_seconds") is not None:
                min_seconds = rule["min_seconds"]
            if rule.get("max_seconds") is not None and max_seconds is None:
                max_seconds = rule["max_seconds"]

    # 2. 检查卖点/必选短语与违禁词冲突
    phrases = list(request.brief_rules.get("required_phrases", []))
    phrases += list(request.brief_rules.get("selling_points", []))
    for phrase in phrases:
        for word in forbidden_words:
            if word in str(phrase):
                conflicts.append(RuleConflict(
                    brief_rule=f"卖点包含：{phrase}",
                    platform_rule=f"{request.platform} 禁止使用：{word}",
                    suggestion=f"卖点 '{phrase}' 包含违禁词 '{word}'，建议修改表述",
                ))

    # 3. 检查时长冲突
    brief_min = request.brief_rules.get("min_duration")
    brief_max = request.brief_rules.get("max_duration")
    if min_seconds and brief_max and brief_max < min_seconds:
        conflicts.append(RuleConflict(
            brief_rule=f"Brief 最长时长：{brief_max}秒",
            platform_rule=f"{request.platform} 最短要求：{min_seconds}秒",
            suggestion=f"Brief 最长 {brief_max}s 低于平台最短要求 {min_seconds}s，视频可能不达标",
        ))
    if max_seconds and brief_min and brief_min > max_seconds:
        conflicts.append(RuleConflict(
            brief_rule=f"Brief 最短时长：{brief_min}秒",
            platform_rule=f"{request.platform} 最长限制：{max_seconds}秒",
            suggestion=f"Brief 最短 {brief_min}s 超过平台最长限制 {max_seconds}s，建议调整",
        ))

    return RuleValidateResponse(conflicts=conflicts)


# ==================== 品牌方平台规则（文档上传 + AI 解析） ====================

def _format_platform_rule(rule: PlatformRule) -> PlatformRuleDBResponse:
    """将 ORM 对象转为响应 Schema"""
    return PlatformRuleDBResponse(
        id=rule.id,
        platform=rule.platform,
        brand_id=rule.brand_id,
        document_url=rule.document_url,
        document_name=rule.document_name,
        parsed_rules=ParsedRulesData(**(rule.parsed_rules or {})),
        status=rule.status,
        created_at=rule.created_at.isoformat() if rule.created_at else "",
        updated_at=rule.updated_at.isoformat() if rule.updated_at else "",
    )


@router.post(
    "/platform-rules/parse",
    response_model=PlatformRuleParseResponse,
    status_code=status.HTTP_201_CREATED,
)
async def parse_platform_rule_document(
    request: PlatformRuleParseRequest,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
) -> PlatformRuleParseResponse:
    """
    上传文档并通过 AI 解析平台规则

    流程:
    1. 下载文档
    2. 提取纯文本
    3. AI 解析出结构化规则
    4. 存入 DB (status=draft)
    5. 返回解析结果供品牌方确认
    """
    await _ensure_tenant_exists(x_tenant_id, db)

    # 品牌方用户的 tenant_id 即 brand_id；前端可能传空字符串
    if not request.brand_id or not request.brand_id.strip():
        request.brand_id = x_tenant_id

    # 1. 尝试提取文本；对图片型 PDF 走视觉解析
    document_text = ""
    image_b64_list: list[str] = []

    try:
        # 先检查是否为图片型 PDF
        image_b64_list = await DocumentParser.download_and_get_images(
            request.document_url, request.document_name,
        ) or []
    except Exception as e:
        logger.warning(f"图片 PDF 检测失败，回退文本模式: {e}")

    if not image_b64_list:
        # 非图片 PDF 或检测失败，走文本提取
        try:
            document_text = await DocumentParser.download_and_parse(
                request.document_url, request.document_name,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            logger.error(f"文档解析失败: {e}")
            raise HTTPException(status_code=400, detail=f"文档下载或解析失败: {e}")

        if not document_text.strip():
            raise HTTPException(status_code=400, detail="文档内容为空，无法解析")

    # 2. AI 解析（图片模式 or 文本模式）
    if image_b64_list:
        parsed_rules = await _ai_parse_platform_rules_vision(
            x_tenant_id, request.platform, image_b64_list, db,
        )
    else:
        parsed_rules = await _ai_parse_platform_rules(x_tenant_id, request.platform, document_text, db)

    # 3. 存入 DB (draft)
    rule_id = f"pr-{uuid.uuid4().hex[:8]}"
    rule = PlatformRule(
        id=rule_id,
        tenant_id=x_tenant_id,
        brand_id=request.brand_id,
        platform=request.platform,
        document_url=request.document_url,
        document_name=request.document_name,
        parsed_rules=parsed_rules,
        status=RuleStatus.DRAFT.value,
    )
    db.add(rule)
    await db.flush()

    return PlatformRuleParseResponse(
        id=rule.id,
        platform=rule.platform,
        brand_id=rule.brand_id,
        document_url=rule.document_url,
        document_name=rule.document_name,
        parsed_rules=ParsedRulesData(**parsed_rules),
        status=rule.status,
    )


@router.put(
    "/platform-rules/{rule_id}/confirm",
    response_model=PlatformRuleDBResponse,
)
async def confirm_platform_rule(
    rule_id: str,
    request: PlatformRuleConfirmRequest,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
) -> PlatformRuleDBResponse:
    """
    确认/编辑平台规则解析结果

    将 draft 状态的规则设为 active，同时将同 (tenant_id, brand_id, platform) 下
    已有的 active 规则设为 inactive。
    """
    result = await db.execute(
        select(PlatformRule).where(
            and_(
                PlatformRule.id == rule_id,
                PlatformRule.tenant_id == x_tenant_id,
            )
        )
    )
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail=f"规则不存在: {rule_id}")

    # 将同 (tenant_id, brand_id, platform) 下已有的 active 规则设为 inactive
    existing_active = await db.execute(
        select(PlatformRule).where(
            and_(
                PlatformRule.tenant_id == x_tenant_id,
                PlatformRule.brand_id == rule.brand_id,
                PlatformRule.platform == rule.platform,
                PlatformRule.status == RuleStatus.ACTIVE.value,
                PlatformRule.id != rule_id,
            )
        )
    )
    for old_rule in existing_active.scalars().all():
        old_rule.status = RuleStatus.INACTIVE.value

    # 更新当前规则
    rule.parsed_rules = request.parsed_rules.model_dump()
    rule.status = RuleStatus.ACTIVE.value
    await db.flush()
    await db.refresh(rule)

    return _format_platform_rule(rule)


@router.get(
    "/platform-rules",
    response_model=PlatformRuleDBListResponse,
)
async def list_brand_platform_rules(
    brand_id: Optional[str] = Query(None),
    platform: Optional[str] = Query(None),
    rule_status: Optional[str] = Query(None, alias="status"),
    x_tenant_id: str = Header("", alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
) -> PlatformRuleDBListResponse:
    """查询品牌方的平台规则列表

    支持两种查询模式：
    1. 品牌方自己查：靠 X-Tenant-ID header
    2. 代理商查特定品牌的规则：靠 brand_id query param
    """
    if brand_id:
        # 用 or_ 同时匹配 tenant_id 和 brand_id（兼容历史数据 brand_id 为空的情况）
        query = select(PlatformRule).where(
            or_(
                PlatformRule.brand_id == brand_id,
                and_(
                    PlatformRule.tenant_id == brand_id,
                    or_(PlatformRule.brand_id == None, PlatformRule.brand_id == ''),  # noqa: E711
                ),
            )
        )
    elif x_tenant_id:
        query = select(PlatformRule).where(PlatformRule.tenant_id == x_tenant_id)
    else:
        return PlatformRuleDBListResponse(items=[], total=0)

    if platform:
        query = query.where(PlatformRule.platform == platform)
    if rule_status:
        query = query.where(PlatformRule.status == rule_status)

    result = await db.execute(query.order_by(PlatformRule.created_at.desc()))
    rules = result.scalars().all()

    return PlatformRuleDBListResponse(
        items=[_format_platform_rule(r) for r in rules],
        total=len(rules),
    )


@router.delete(
    "/platform-rules/{rule_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_platform_rule(
    rule_id: str,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
):
    """删除平台规则"""
    result = await db.execute(
        select(PlatformRule).where(
            and_(
                PlatformRule.id == rule_id,
                PlatformRule.tenant_id == x_tenant_id,
            )
        )
    )
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail=f"规则不存在: {rule_id}")

    await db.delete(rule)
    await db.flush()


async def _ai_parse_platform_rules(
    tenant_id: str,
    platform: str,
    document_text: str,
    db: AsyncSession,
) -> dict:
    """
    使用 AI 将文档文本解析为结构化平台规则

    AI 失败时返回空规则结构（降级为手动编辑）
    """
    try:
        ai_client = await AIServiceFactory.get_client(tenant_id, db)
        if not ai_client:
            logger.warning(f"租户 {tenant_id} 未配置 AI 服务")
            return _empty_parsed_rules()

        config = await AIServiceFactory.get_config(tenant_id, db)
        if not config:
            logger.warning(f"租户 {tenant_id} AI 配置异常")
            return _empty_parsed_rules()

        text_model = config.models.get("text", "gpt-4o")

        # 截断过长文本（避免超出 token 限制）
        max_chars = 15000
        if len(document_text) > max_chars:
            document_text = document_text[:max_chars] + "\n...(文档内容已截断)"

        prompt = f"""你是平台广告合规规则分析专家。请从以下 {platform} 平台规则文档中提取结构化规则。

文档内容：
{document_text}

请以 JSON 格式返回，不要包含其他内容：
{{
  "forbidden_words": ["违禁词1", "违禁词2"],
  "restricted_words": [{{"word": "xx", "condition": "使用条件", "suggestion": "替换建议"}}],
  "duration": {{"min_seconds": 7, "max_seconds": null}},
  "content_requirements": ["必须展示产品正面", "需要口播品牌名"],
  "other_rules": [{{"rule": "规则名称", "description": "详细说明"}}]
}}

注意：
- forbidden_words: 明确禁止使用的词语
- restricted_words: 有条件限制的词语
- duration: 视频时长要求，如果文档未提及则为 null
- content_requirements: 内容上的硬性要求
- other_rules: 不属于以上分类的其他规则
- 如果某项没有提取到内容，使用空数组或 null
- 重要：JSON 字符串值中不要使用中文引号（""），使用单引号或直接省略"""

        response = await ai_client.chat_completion(
            messages=[{"role": "user", "content": prompt}],
            model=text_model,
            temperature=0.2,
            max_tokens=4000,
        )

        # 解析 AI 响应
        content = _extract_json_from_ai_response(response.content)
        parsed = json.loads(content)
        if isinstance(parsed, str):
            parsed = json.loads(parsed)

        # 校验并补全字段
        return {
            "forbidden_words": parsed.get("forbidden_words", []),
            "restricted_words": parsed.get("restricted_words", []),
            "duration": parsed.get("duration"),
            "content_requirements": parsed.get("content_requirements", []),
            "other_rules": parsed.get("other_rules", []),
        }

    except json.JSONDecodeError as e:
        logger.error(
            f"AI 返回内容非 JSON: {e}, 原始响应: {response.content[:500] if 'response' in dir() else 'N/A'}"
        )
        return _empty_parsed_rules()
    except Exception as e:
        logger.error(f"AI 解析平台规则失败: {e}")
        return _empty_parsed_rules()


async def _ai_parse_platform_rules_vision(
    tenant_id: str,
    platform: str,
    image_b64_list: list[str],
    db: AsyncSession,
) -> dict:
    """
    使用 AI 视觉模型从 PDF 页面图片中提取结构化平台规则。
    用于扫描件/截图型 PDF。
    """
    try:
        ai_client = await AIServiceFactory.get_client(tenant_id, db)
        if not ai_client:
            logger.warning(f"租户 {tenant_id} 未配置 AI 服务")
            return _empty_parsed_rules()

        config = await AIServiceFactory.get_config(tenant_id, db)
        if not config:
            logger.warning(f"租户 {tenant_id} AI 配置异常")
            return _empty_parsed_rules()

        vision_model = config.models.get("vision", config.models.get("text", "gpt-4o"))

        # 构建多模态消息
        content: list[dict] = [
            {
                "type": "text",
                "text": f"""你是平台广告合规规则分析专家。以下是 {platform} 平台规则文档的页面截图。
请仔细阅读所有页面，从中提取结构化规则。

请以 JSON 格式返回，不要包含其他内容：
{{
  "forbidden_words": ["违禁词1", "违禁词2"],
  "restricted_words": [{{"word": "xx", "condition": "使用条件", "suggestion": "替换建议"}}],
  "duration": {{"min_seconds": 7, "max_seconds": null}},
  "content_requirements": ["必须展示产品正面", "需要口播品牌名"],
  "other_rules": [{{"rule": "规则名称", "description": "详细说明"}}]
}}

注意：
- forbidden_words: 明确禁止使用的词语
- restricted_words: 有条件限制的词语
- duration: 视频时长要求，如果文档未提及则为 null
- content_requirements: 内容上的硬性要求
- other_rules: 不属于以上分类的其他规则
- 如果某项没有提取到内容，使用空数组或 null
- 重要：JSON 字符串值中不要使用中文引号（\u201c\u201d），使用单引号或直接省略""",
            }
        ]
        for b64 in image_b64_list:
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/png;base64,{b64}"},
            })

        response = await ai_client.chat_completion(
            messages=[{"role": "user", "content": content}],
            model=vision_model,
            temperature=0.2,
            max_tokens=4000,
        )

        # 解析 AI 响应
        resp_content = _extract_json_from_ai_response(response.content)
        parsed = json.loads(resp_content)
        if isinstance(parsed, str):
            parsed = json.loads(parsed)
        return {
            "forbidden_words": parsed.get("forbidden_words", []),
            "restricted_words": parsed.get("restricted_words", []),
            "duration": parsed.get("duration"),
            "content_requirements": parsed.get("content_requirements", []),
            "other_rules": parsed.get("other_rules", []),
        }

    except json.JSONDecodeError as e:
        logger.error(
            f"AI 视觉解析返回内容非 JSON: {e}, 原始响应: {response.content[:500] if 'response' in dir() else 'N/A'}"
        )
        return _empty_parsed_rules()
    except Exception as e:
        logger.error(f"AI 视觉解析平台规则失败: {e}")
        return _empty_parsed_rules()


def _extract_json_from_ai_response(raw: str) -> str:
    """
    从 AI 响应中提取并清理 JSON 文本。
    处理：markdown 代码块包裹、中文引号、前后额外文字等。
    """
    import re
    text = raw.strip()
    # 去掉 markdown ```json ... ``` 包裹
    m = re.search(r'```(?:json)?\s*\n(.*?)```', text, re.DOTALL)
    if m:
        text = m.group(1).strip()
    else:
        # 尝试提取第一个 { ... } 块（AI 可能在 JSON 前后加了说明文字）
        brace_match = re.search(r'\{.*\}', text, re.DOTALL)
        if brace_match:
            text = brace_match.group(0).strip()
    return _sanitize_json_string(text)


def _sanitize_json_string(text: str) -> str:
    """
    清理 AI 返回的 JSON 文本中的中文引号等特殊字符。
    中文引号 "" 在 JSON 字符串值内会破坏解析。
    """
    import re
    result = []
    in_string = False
    i = 0
    while i < len(text):
        ch = text[i]
        if ch == '\\' and in_string and i + 1 < len(text):
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
        elif in_string and ch in '\u201c\u201d\u300c\u300d':
            # 中文引号 "" 和「」 → 单引号
            result.append("'")
        elif not in_string and ch in '\u201c\u201d':
            # JSON 结构层的中文引号 → 英文双引号
            result.append('"')
        else:
            result.append(ch)
        i += 1
    return ''.join(result)


def _empty_parsed_rules() -> dict:
    """返回空的解析规则结构"""
    return {
        "forbidden_words": [],
        "restricted_words": [],
        "duration": None,
        "content_requirements": [],
        "other_rules": [],
    }


# ==================== 辅助函数（供其他模块调用） ====================

async def get_whitelist_for_brand(
    tenant_id: str,
    brand_id: Optional[str],
    db: AsyncSession,
) -> list[str]:
    """获取品牌白名单词汇"""
    if not brand_id:
        return []
    result = await db.execute(
        select(WhitelistItem).where(
            and_(
                WhitelistItem.tenant_id == tenant_id,
                WhitelistItem.brand_id == brand_id,
            )
        )
    )
    items = result.scalars().all()
    return [item.term for item in items]


async def get_other_brands_whitelist_terms(
    tenant_id: str,
    brand_id: Optional[str],
    db: AsyncSession,
) -> list[tuple[str, str]]:
    """
    获取其他品牌的白名单词汇（用于品牌安全检测）

    Returns:
        list of (term, owner_brand_id)
    """
    if not brand_id:
        return []
    result = await db.execute(
        select(WhitelistItem).where(
            and_(
                WhitelistItem.tenant_id == tenant_id,
                WhitelistItem.brand_id != brand_id,
            )
        )
    )
    items = result.scalars().all()
    return [(item.term, item.brand_id) for item in items]


async def get_forbidden_words_for_tenant(
    tenant_id: str,
    db: AsyncSession,
    category: str = None,
) -> list[dict]:
    """获取租户的违禁词列表"""
    query = select(ForbiddenWord).where(ForbiddenWord.tenant_id == tenant_id)
    if category:
        query = query.where(ForbiddenWord.category == category)

    result = await db.execute(query)
    words = result.scalars().all()

    return [
        {
            "id": w.id,
            "word": w.word,
            "category": w.category,
            "severity": w.severity,
        }
        for w in words
    ]


async def get_competitors_for_brand(
    tenant_id: str,
    brand_id: Optional[str],
    db: AsyncSession,
) -> list[dict]:
    """
    获取品牌方配置的竞品列表

    Returns:
        [{"name": "竞品名", "keywords": ["关键词1", ...]}]
    """
    if not brand_id:
        return []
    result = await db.execute(
        select(Competitor).where(
            and_(
                Competitor.tenant_id == tenant_id,
                Competitor.brand_id == brand_id,
            )
        )
    )
    competitors = result.scalars().all()
    return [
        {
            "name": c.name,
            "keywords": c.keywords or [],
        }
        for c in competitors
    ]


async def get_active_platform_rules(
    tenant_id: str,
    brand_id: Optional[str],
    platform: str,
    db: AsyncSession,
) -> Optional[dict]:
    """
    获取品牌方在该平台的生效规则 (active)

    Returns:
        parsed_rules dict 或 None（没有上传规则时）
    """
    if not brand_id:
        return None
    result = await db.execute(
        select(PlatformRule).where(
            and_(
                PlatformRule.tenant_id == tenant_id,
                PlatformRule.brand_id == brand_id,
                PlatformRule.platform == platform,
                PlatformRule.status == RuleStatus.ACTIVE.value,
            )
        )
    )
    rule = result.scalar_one_or_none()
    if not rule:
        return None
    return rule.parsed_rules


# ==================== 通用规则文档上传解析 ====================

@router.post(
    "/document-parse",
    response_model=RuleDocumentParseResponse,
)
async def parse_rule_document(
    request: RuleDocumentParseRequest,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
) -> RuleDocumentParseResponse:
    """
    上传文档 → AI 解析出违禁词/白名单/竞品 → 返回预览

    支持 rule_type: forbidden_words / whitelist / competitors
    追加模式：自动去重已有数据。
    """
    await _ensure_tenant_exists(x_tenant_id, db)

    # 品牌方用户的 tenant_id 即 brand_id；前端可能不传或传空
    if not request.brand_id:
        request.brand_id = x_tenant_id

    # 1. 提取文档内容
    document_text = ""
    image_b64_list: list[str] = []

    try:
        image_b64_list = await DocumentParser.download_and_get_images(
            request.document_url, request.document_name,
        ) or []
    except Exception as e:
        logger.warning(f"图片 PDF 检测失败，回退文本模式: {e}")

    if not image_b64_list:
        try:
            document_text = await DocumentParser.download_and_parse(
                request.document_url, request.document_name,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"文档下载或解析失败: {e}")

        if not document_text.strip():
            raise HTTPException(status_code=400, detail="文档内容为空，无法解析")

    # 2. AI 解析
    parsed = await _ai_parse_rule_document(
        tenant_id=x_tenant_id,
        rule_type=request.rule_type,
        document_text=document_text,
        image_b64_list=image_b64_list,
        db=db,
    )

    # 3. 去重：与 DB 中已有数据对比
    duplicates_removed = 0
    if request.rule_type == "forbidden_words":
        existing = await db.execute(
            select(ForbiddenWord.word).where(ForbiddenWord.tenant_id == x_tenant_id)
        )
        existing_words = {r[0] for r in existing.all()}
        original_count = len(parsed.get("forbidden_words", []))
        parsed["forbidden_words"] = [
            w for w in parsed.get("forbidden_words", [])
            if w.get("word") not in existing_words
        ]
        duplicates_removed = original_count - len(parsed["forbidden_words"])

    elif request.rule_type == "whitelist":
        existing = await db.execute(
            select(WhitelistItem.term).where(
                and_(WhitelistItem.tenant_id == x_tenant_id, WhitelistItem.brand_id == request.brand_id)
            )
        )
        existing_terms = {r[0] for r in existing.all()}
        original_count = len(parsed.get("whitelist_items", []))
        parsed["whitelist_items"] = [
            w for w in parsed.get("whitelist_items", [])
            if w.get("term") not in existing_terms
        ]
        duplicates_removed = original_count - len(parsed["whitelist_items"])

    elif request.rule_type == "competitors":
        existing = await db.execute(
            select(Competitor.name).where(
                and_(Competitor.tenant_id == x_tenant_id, Competitor.brand_id == request.brand_id)
            )
        )
        existing_names = {r[0] for r in existing.all()}
        original_count = len(parsed.get("competitors", []))
        parsed["competitors"] = [
            c for c in parsed.get("competitors", [])
            if c.get("name") not in existing_names
        ]
        duplicates_removed = original_count - len(parsed["competitors"])

    # 4. 构建响应
    fw_list = [ParsedForbiddenWord(**w) for w in parsed.get("forbidden_words", [])]
    wl_list = [ParsedWhitelistItem(**w) for w in parsed.get("whitelist_items", [])]
    comp_list = [ParsedCompetitor(**c) for c in parsed.get("competitors", [])]
    total = len(fw_list) + len(wl_list) + len(comp_list)

    return RuleDocumentParseResponse(
        rule_type=request.rule_type,
        document_name=request.document_name,
        forbidden_words=fw_list,
        whitelist_items=wl_list,
        competitors=comp_list,
        total_parsed=total,
        duplicates_removed=duplicates_removed,
    )


@router.post(
    "/document-confirm",
    response_model=RuleDocumentConfirmResponse,
)
async def confirm_rule_document(
    request: RuleDocumentConfirmRequest,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
) -> RuleDocumentConfirmResponse:
    """
    确认解析结果，批量写入 DB

    品牌方在前端编辑预览结果后调用此接口批量写入。
    自动跳过已存在的重复项。
    """
    await _ensure_tenant_exists(x_tenant_id, db)

    if not request.brand_id:
        request.brand_id = x_tenant_id

    added = 0
    skipped = 0

    if request.rule_type == "forbidden_words":
        for fw in request.forbidden_words:
            # 检查重复
            existing = await db.execute(
                select(ForbiddenWord).where(
                    and_(ForbiddenWord.tenant_id == x_tenant_id, ForbiddenWord.word == fw.word)
                )
            )
            if existing.scalar_one_or_none():
                skipped += 1
                continue
            word = ForbiddenWord(
                id=f"fw-{uuid.uuid4().hex[:8]}",
                tenant_id=x_tenant_id,
                word=fw.word,
                category=fw.category,
                severity=fw.severity,
            )
            db.add(word)
            added += 1

    elif request.rule_type == "whitelist":
        for wl in request.whitelist_items:
            existing = await db.execute(
                select(WhitelistItem).where(
                    and_(
                        WhitelistItem.tenant_id == x_tenant_id,
                        WhitelistItem.brand_id == request.brand_id,
                        WhitelistItem.term == wl.term,
                    )
                )
            )
            if existing.scalar_one_or_none():
                skipped += 1
                continue
            item = WhitelistItem(
                id=f"wl-{uuid.uuid4().hex[:8]}",
                tenant_id=x_tenant_id,
                brand_id=request.brand_id,
                term=wl.term,
                reason=wl.reason,
            )
            db.add(item)
            added += 1

    elif request.rule_type == "competitors":
        for comp in request.competitors:
            existing = await db.execute(
                select(Competitor).where(
                    and_(
                        Competitor.tenant_id == x_tenant_id,
                        Competitor.brand_id == request.brand_id,
                        Competitor.name == comp.name,
                    )
                )
            )
            if existing.scalar_one_or_none():
                skipped += 1
                continue
            competitor = Competitor(
                id=f"comp-{uuid.uuid4().hex[:8]}",
                tenant_id=x_tenant_id,
                brand_id=request.brand_id,
                name=comp.name,
                keywords=comp.keywords,
            )
            db.add(competitor)
            added += 1

    await db.flush()

    return RuleDocumentConfirmResponse(
        added=added,
        skipped_duplicates=skipped,
        total=added + skipped,
    )


async def _ai_parse_rule_document(
    tenant_id: str,
    rule_type: str,
    document_text: str,
    image_b64_list: list[str],
    db: AsyncSession,
) -> dict:
    """AI 解析规则文档（违禁词/白名单/竞品）"""
    try:
        ai_client = await AIServiceFactory.get_client(tenant_id, db)
        if not ai_client:
            raise HTTPException(
                status_code=400,
                detail="AI 服务未配置，请先在「AI配置」中设置 API 密钥",
            )

        config = await AIServiceFactory.get_config(tenant_id, db)
        if not config:
            raise HTTPException(
                status_code=400,
                detail="AI 服务配置异常，请检查「AI配置」",
            )

        # 根据 rule_type 构建不同的 prompt
        prompts = {
            "forbidden_words": """你是广告合规专家。请从以下文档中提取所有违禁词/敏感词。

以 JSON 格式返回：
{{
  "forbidden_words": [
    {{"word": "词语", "category": "分类(如: absolute/efficacy/misleading/vulgar/custom)", "severity": "严重程度(high/medium/low)"}}
  ]
}}

分类说明：
- absolute: 绝对化用语（最好、第一、唯一等）
- efficacy: 功效类禁用词（根治、永久、立竿见影等）
- misleading: 误导性词语
- vulgar: 低俗词语
- custom: 其他自定义分类

severity 说明：
- high: 法律明确禁止的
- medium: 平台规则限制的
- low: 建议避免的""",

            "whitelist": """你是广告合规专家。请从以下文档中提取品牌方允许使用的白名单词汇/表达。

以 JSON 格式返回：
{{
  "whitelist_items": [
    {{"term": "允许的词或表达", "reason": "为什么允许（简要说明）"}}
  ]
}}

白名单词汇通常包括：
- 品牌自身的专属用语
- 经过授权的表达
- 行业通用但不构成违规的词语""",

            "competitors": """你是市场分析专家。请从以下文档中提取所有竞争品牌/竞品信息。

以 JSON 格式返回：
{{
  "competitors": [
    {{"name": "竞品品牌名", "keywords": ["关键词1", "关键词2"]}}
  ]
}}

keywords 包括：竞品的产品名、简称、缩写、常见代称等。""",
        }

        base_prompt = prompts.get(rule_type, prompts["forbidden_words"])

        if image_b64_list:
            model = config.models.get("vision", config.models.get("text", "gpt-4o"))
            content: list[dict] = [{"type": "text", "text": base_prompt + "\n\n请仔细阅读以下文档页面截图：\n\n请只返回 JSON，不要包含其他内容。"}]
            for b64 in image_b64_list:
                content.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{b64}"},
                })
            response = await ai_client.chat_completion(
                messages=[{"role": "user", "content": content}],
                model=model,
                temperature=0.2,
                max_tokens=4000,
            )
        else:
            model = config.models.get("text", "gpt-4o")
            max_chars = 15000
            if len(document_text) > max_chars:
                document_text = document_text[:max_chars] + "\n...(文档内容已截断)"
            full_prompt = f"{base_prompt}\n\n文档内容：\n{document_text}\n\n请只返回 JSON，不要包含其他内容。"
            response = await ai_client.chat_completion(
                messages=[{"role": "user", "content": full_prompt}],
                model=model,
                temperature=0.2,
                max_tokens=4000,
            )

        content_text = _extract_json_from_ai_response(response.content)
        parsed = json.loads(content_text)
        if isinstance(parsed, str):
            parsed = json.loads(parsed)
        return parsed

    except json.JSONDecodeError as e:
        logger.error(f"AI 返回内容非 JSON: {e}")
        raise HTTPException(
            status_code=422,
            detail="AI 返回格式异常，解析失败。请重试或更换较短的文档。",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"AI 解析规则文档失败: {e}")
        raise HTTPException(
            status_code=502,
            detail=f"AI 解析服务异常: {str(e)[:200]}",
        )
