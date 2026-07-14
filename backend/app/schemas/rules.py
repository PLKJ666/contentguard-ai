"""
平台规则相关 Schema
"""
from typing import Optional
from pydantic import BaseModel, Field


class PlatformRuleParseRequest(BaseModel):
    """上传文档并解析"""
    document_url: str = Field(..., description="TOS 上传后的文件 URL")
    document_name: str = Field(..., description="原始文件名（用于判断格式）")
    platform: str = Field(..., description="目标平台 (douyin/xiaohongshu/bilibili/kuaishou)")
    brand_id: str = Field("", description="品牌 ID（可选，后端自动从 tenant_id 获取）")


class ParsedRulesData(BaseModel):
    """AI 解析出的结构化规则"""
    forbidden_words: list[str] = Field(default_factory=list, description="违禁词列表")
    restricted_words: list[dict] = Field(
        default_factory=list,
        description="限制词 [{word, condition, suggestion}]",
    )
    duration: Optional[dict] = Field(
        None,
        description="时长要求 {min_seconds, max_seconds}",
    )
    content_requirements: list[str] = Field(
        default_factory=list,
        description="内容要求（如'必须展示产品'）",
    )
    other_rules: list[dict] = Field(
        default_factory=list,
        description="其他规则 [{rule, description}]",
    )


class PlatformRuleParseResponse(BaseModel):
    """解析响应（draft 状态）"""
    id: str
    platform: str
    brand_id: str
    document_url: str
    document_name: str
    parsed_rules: ParsedRulesData
    status: str


class PlatformRuleConfirmRequest(BaseModel):
    """确认/编辑解析结果"""
    parsed_rules: ParsedRulesData = Field(..., description="品牌方可能修改过的规则")


class PlatformRuleResponse(BaseModel):
    """完整响应"""
    id: str
    platform: str
    brand_id: str
    document_url: str
    document_name: str
    parsed_rules: ParsedRulesData
    status: str
    created_at: str
    updated_at: str


class PlatformRuleListResponse(BaseModel):
    """列表响应"""
    items: list[PlatformRuleResponse]
    total: int


# ==================== 通用规则文档解析 ====================

class RuleDocumentParseRequest(BaseModel):
    """通用规则文档解析请求"""
    document_url: str = Field(..., description="TOS 上传后的文件 URL")
    document_name: str = Field(..., description="原始文件名")
    rule_type: str = Field(..., description="规则类型: forbidden_words/whitelist/competitors")
    brand_id: str = Field("", description="品牌 ID（可选，后端自动从 tenant_id 获取）")


class ParsedForbiddenWord(BaseModel):
    word: str
    category: str = "custom"
    severity: str = "medium"


class ParsedWhitelistItem(BaseModel):
    term: str
    reason: str = ""


class ParsedCompetitor(BaseModel):
    name: str
    keywords: list[str] = Field(default_factory=list)


class RuleDocumentParseResponse(BaseModel):
    """通用规则文档解析响应（预览）"""
    rule_type: str
    document_name: str
    forbidden_words: list[ParsedForbiddenWord] = Field(default_factory=list)
    whitelist_items: list[ParsedWhitelistItem] = Field(default_factory=list)
    competitors: list[ParsedCompetitor] = Field(default_factory=list)
    total_parsed: int = 0
    duplicates_removed: int = 0


class RuleDocumentConfirmRequest(BaseModel):
    """确认批量写入"""
    rule_type: str = Field(..., description="规则类型: forbidden_words/whitelist/competitors")
    brand_id: str = Field("", description="品牌 ID（可选，后端自动从 tenant_id 获取）")
    forbidden_words: list[ParsedForbiddenWord] = Field(default_factory=list)
    whitelist_items: list[ParsedWhitelistItem] = Field(default_factory=list)
    competitors: list[ParsedCompetitor] = Field(default_factory=list)


class RuleDocumentConfirmResponse(BaseModel):
    """批量写入结果"""
    added: int = 0
    skipped_duplicates: int = 0
    total: int = 0
