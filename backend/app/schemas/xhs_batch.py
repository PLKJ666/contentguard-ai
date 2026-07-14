"""
小红书批量图文笔记 P0 schema。

这里显式区分：
1. Internal schema: 任务链路内部流转、可保留中间态。
2. API schema: 面向前端/开放接口，只暴露稳定字段。
"""
from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class XHSPackStatus(str, Enum):
    DRAFT = "draft"
    ACTIVE = "active"
    ARCHIVED = "archived"


class XHSBatchRunMode(str, Enum):
    TRIAL = "trial"
    FULL = "full"


class XHSBatchStatus(str, Enum):
    PENDING = "pending"
    SPLITTING = "splitting"
    QUEUED = "queued"
    RUNNING = "running"
    AWAITING_DECISION = "awaiting_decision"
    NEEDS_DECISION = "needs_decision"
    PARTIALLY_DONE = "partially_done"
    DONE = "done"
    EXPORTING = "exporting"
    EXPORTED = "exported"
    COMPLETED = "completed"
    FAILED = "failed"
    BLOCKED = "blocked"
    CANCELLED = "cancelled"


class XHSInputType(str, Enum):
    TEXT = "text"
    FILE = "file"
    FEISHU_LINK = "feishu_link"


class XHSExportType(str, Enum):
    ALL_MD = "all_md"
    FEISHU = "feishu"


class XHSExportStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class XHSSourceType(str, Enum):
    UPLOAD = "upload"
    FEISHU_LINK = "feishu_link"


class XHSSplitBy(str, Enum):
    RULE = "rule"
    WEAK_RULE = "weak_rule"
    AI_ASSISTED = "ai_assisted"


class FactNode(BaseModel):
    id: str
    node_type: str
    name: str
    attributes: dict[str, Any] = Field(default_factory=dict)


class FactRelation(BaseModel):
    source_id: str
    relation_type: str
    target_id: str
    attributes: dict[str, Any] = Field(default_factory=dict)


class BrandPackPayload(BaseModel):
    brand_facts: list[dict[str, Any]] = Field(default_factory=list)
    products: list[dict[str, Any]] = Field(default_factory=list)
    fact_graph: dict[str, list[Any]] = Field(
        default_factory=lambda: {"nodes": [], "relations": []},
    )
    optional_blocks: list[dict[str, Any]] = Field(default_factory=list)


class BriefPackPayload(BaseModel):
    brand_facts: dict[str, Any] = Field(default_factory=dict)
    sku_facts: list[dict[str, Any]] = Field(default_factory=list)
    selling_point_priority: list[dict[str, Any]] = Field(default_factory=list)
    recommended_phrasings: list[str] = Field(default_factory=list)
    forbidden_phrasings: list[str] = Field(default_factory=list)
    uncertain_fields: list[dict[str, Any]] = Field(default_factory=list)


class RiskPackPayload(BaseModel):
    risk_clues: list[dict[str, Any]] = Field(default_factory=list)
    replace_hints: list[dict[str, Any]] = Field(default_factory=list)
    confidence_level: Optional[str] = None


class RulePackPayload(BaseModel):
    banned_terms: list[str] = Field(default_factory=list)
    risk_patterns: list[dict[str, Any]] = Field(default_factory=list)
    replace_map: dict[str, str] = Field(default_factory=dict)
    format_rules: dict[str, Any] = Field(default_factory=dict)
    structure_rules: dict[str, Any] = Field(default_factory=dict)


class BatchJobCostSnapshot(BaseModel):
    estimated_tokens: Optional[int] = None
    estimated_cost: Optional[Decimal] = None
    actual_tokens: Optional[int] = None
    actual_cost: Optional[Decimal] = None


class BatchItemResultSnapshot(BaseModel):
    editor_output: Optional[dict[str, Any]] = None
    verifier: Optional[dict[str, Any]] = None
    verifier_pass: Optional[bool] = None
    verifier_confidence: Optional[Decimal] = None
    rewrite_fail_reasons: list[str] = Field(default_factory=list)
    safe_rewrite_used: bool = False
    safe_rewrite_reason: Optional[str] = None
    final_title: Optional[str] = None
    final_body: Optional[str] = None
    final_hashtags: list[str] = Field(default_factory=list)
    copy_ready_text: Optional[str] = None
    quality_score: Optional[Decimal] = None


class XHSBatchJobInternal(BaseModel):
    id: str
    tenant_id: str
    created_by: str
    status: XHSBatchStatus
    category_id: str
    direction_id: Optional[str] = None
    rule_pack_version: Optional[str] = None
    risk_pack_version: Optional[str] = None
    brand_pack_version: Optional[str] = None
    brief_pack_id: Optional[str] = None
    style_template_id: Optional[str] = None
    run_mode: XHSBatchRunMode
    trial_sample_count: Optional[int] = None
    input_type: XHSInputType
    input_stats: dict[str, Any] = Field(default_factory=dict)
    tag_policy: dict[str, Any] = Field(default_factory=dict)
    export_options: dict[str, Any] = Field(default_factory=dict)
    system_blocked: bool = False
    system_block_reason: Optional[str] = None
    total_items: int = 0
    done_items: int = 0
    running_items: int = 0
    costs: BatchJobCostSnapshot = Field(default_factory=BatchJobCostSnapshot)


class XHSBatchItemInternal(BaseModel):
    id: str
    batch_id: str
    item_id: str
    source_text: str
    source_title_guess: Optional[str] = None
    split_by: Optional[XHSSplitBy] = None
    status: XHSBatchStatus
    round: int = 0
    duration_ms: Optional[int] = None
    model_meta: dict[str, Any] = Field(default_factory=dict)
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    result: BatchItemResultSnapshot = Field(default_factory=BatchItemResultSnapshot)


class XHSPackBaseRequest(BaseModel):
    category_id: str
    version: str
    status: XHSPackStatus = XHSPackStatus.DRAFT


class XHSBrandPackCreateRequest(XHSPackBaseRequest):
    brand_name: str
    is_default: bool = False
    pack: BrandPackPayload


class XHSRulePackCreateRequest(XHSPackBaseRequest):
    name: str
    pack: RulePackPayload


class XHSRulePackUpdateRequest(BaseModel):
    name: Optional[str] = None
    version: Optional[str] = None
    status: Optional[XHSPackStatus] = None
    pack: Optional[RulePackPayload] = None


class XHSBrandPackUpdateRequest(BaseModel):
    brand_name: Optional[str] = None
    version: Optional[str] = None
    status: Optional[XHSPackStatus] = None
    is_default: Optional[bool] = None
    pack: Optional[BrandPackPayload] = None


class XHSBriefPackCreateRequest(XHSPackBaseRequest):
    brand_name: str
    source_type: XHSSourceType
    source_ref: Optional[str] = None
    pack: BriefPackPayload


class XHSBriefPackUpdateRequest(BaseModel):
    brand_name: Optional[str] = None
    version: Optional[str] = None
    status: Optional[XHSPackStatus] = None
    source_type: Optional[XHSSourceType] = None
    source_ref: Optional[str] = None
    pack: Optional[BriefPackPayload] = None


class XHSRiskPackCreateRequest(XHSPackBaseRequest):
    name: str
    pack: RiskPackPayload


class XHSRiskPackUpdateRequest(BaseModel):
    name: Optional[str] = None
    version: Optional[str] = None
    status: Optional[XHSPackStatus] = None
    pack: Optional[RiskPackPayload] = None


class XHSPackResponseBase(BaseModel):
    id: str
    tenant_id: str
    category_id: str
    version: str
    status: XHSPackStatus
    created_by: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class XHSBrandPackResponse(XHSPackResponseBase):
    brand_name: str
    is_default: bool
    pack: BrandPackPayload


class XHSRulePackResponse(XHSPackResponseBase):
    name: str
    pack: RulePackPayload


class XHSBriefPackResponse(XHSPackResponseBase):
    brand_name: str
    source_type: XHSSourceType
    source_ref: Optional[str] = None
    pack: BriefPackPayload


class XHSRiskPackResponse(XHSPackResponseBase):
    name: str
    pack: RiskPackPayload


class XHSBatchCreateRequest(BaseModel):
    category_id: str
    direction_id: Optional[str] = None
    rule_pack_version: Optional[str] = None
    risk_pack_version: Optional[str] = None
    brand_pack_version: Optional[str] = None
    brief_pack_id: Optional[str] = None
    style_template_id: Optional[str] = None
    run_mode: XHSBatchRunMode = XHSBatchRunMode.TRIAL
    trial_sample_count: Optional[int] = Field(default=None, ge=1)
    input_type: XHSInputType
    input_text: Optional[str] = None
    file_id: Optional[str] = None
    feishu_url: Optional[str] = None
    tag_policy: dict[str, Any] = Field(default_factory=dict)
    export_options: dict[str, Any] = Field(default_factory=dict)


class XHSBatchEstimateResponse(BaseModel):
    estimated_items: int
    total_split_items: int
    estimated_tokens: int
    estimated_cost: Decimal
    split_strategy: str


class XHSFeishuExportRequest(BaseModel):
    folder_token: Optional[str] = None
    doc_title: Optional[str] = None


class XHSFeishuExportDoc(BaseModel):
    doc_token: str
    doc_title: str
    doc_url: str
    item_range: str


class XHSFeishuExportResponse(BaseModel):
    status: XHSExportStatus
    message: str


class XHSFeishuExportStatusResponse(BaseModel):
    status: XHSExportStatus
    docs: list[XHSFeishuExportDoc] = Field(default_factory=list)
    error: Optional[str] = None


class XHSBatchInputStatsResponse(BaseModel):
    raw_chars: int = 0
    split_count: int = 0
    planned_items: Optional[int] = None
    split_strategy: Optional[str] = None
    split_model: Optional[str] = None
    split_tokens: Optional[int] = None
    rule_split_count: Optional[int] = None
    ai_split_count: Optional[int] = None
    source_ref: Optional[str] = None
    source_file_name: Optional[str] = None
    parsed_from_file: Optional[bool] = None
    parsed_from_feishu: Optional[bool] = None
    parse_skipped_reason: Optional[str] = None


class XHSBatchExportSummaryResponse(BaseModel):
    all_md_status: Optional[XHSExportStatus] = None
    all_md_url: Optional[str] = None
    feishu_status: Optional[XHSExportStatus] = None
    feishu_doc_title: Optional[str] = None
    feishu_error: Optional[str] = None


class XHSBatchJobResponse(BaseModel):
    id: str
    status: XHSBatchStatus
    category_id: str
    direction_id: Optional[str] = None
    direction_name: Optional[str] = None
    project_id: Optional[str] = None
    project_name: Optional[str] = None
    rule_pack_version: Optional[str] = None
    risk_pack_version: Optional[str] = None
    brand_pack_version: Optional[str] = None
    brief_pack_id: Optional[str] = None
    run_mode: XHSBatchRunMode
    trial_sample_count: Optional[int] = None
    input_type: XHSInputType
    estimated_tokens: Optional[int] = None
    estimated_cost: Optional[Decimal] = None
    actual_tokens: Optional[int] = None
    actual_cost: Optional[Decimal] = None
    system_blocked: bool
    system_block_reason: Optional[str] = None
    total_items: int
    done_items: int
    running_items: int
    failed_items: int = 0
    decision_items: int = 0
    safe_rewrite_items: int = 0
    input_stats: XHSBatchInputStatsResponse = Field(default_factory=XHSBatchInputStatsResponse)
    export: XHSBatchExportSummaryResponse = Field(default_factory=XHSBatchExportSummaryResponse)
    export_all_md_status: Optional[XHSExportStatus] = None
    export_all_md_url: Optional[str] = None
    export_feishu_status: Optional[XHSExportStatus] = None
    export_feishu_doc_title: Optional[str] = None
    export_feishu_error: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class XHSBatchDecisionOption(BaseModel):
    id: str
    title: str
    summary: str
    tradeoffs: list[str] = Field(default_factory=list)
    recommended: bool = False


class XHSBatchItemResponse(BaseModel):
    id: str
    batch_id: str
    item_id: str
    index: Optional[int] = None
    status: XHSBatchStatus
    round: int
    title: Optional[str] = None
    source_text: Optional[str] = None
    source_title_guess: Optional[str] = None
    final_title: Optional[str] = None
    final_body: Optional[str] = None
    final_hashtags: list[str] = Field(default_factory=list)
    copy_ready_text: Optional[str] = None
    quality_score: Optional[Decimal] = None
    verifier_pass: Optional[bool] = None
    verifier_confidence: Optional[Decimal] = None
    verifier: dict[str, Any] = Field(default_factory=dict)
    rewrite_fail_reasons: list[str] = Field(default_factory=list)
    decision_required: bool = False
    decision_summary: Optional[str] = None
    decision_options: list["XHSBatchDecisionOption"] = Field(default_factory=list)
    recommended_decision_option_id: Optional[str] = None
    selected_decision_option_id: Optional[str] = None
    safe_rewrite_used: bool
    safe_rewrite_reason: Optional[str] = None
    duration_ms: Optional[int] = None

    class Config:
        from_attributes = True


class XHSBatchItemListResponse(BaseModel):
    items: list[XHSBatchItemResponse] = Field(default_factory=list)
    page: int
    page_size: int
    total: int


class XHSBatchDecisionSubmitRequest(BaseModel):
    option_id: str


class XHSExportLogResponse(BaseModel):
    id: str
    batch_id: str
    type: XHSExportType
    status: XHSExportStatus
    error: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class XHSConfigConflict(BaseModel):
    field: str
    message: str
    severity: str = "error"


class XHSConfigValidationResponse(BaseModel):
    valid: bool
    conflicts: list[XHSConfigConflict] = Field(default_factory=list)


class XHSBriefPackParseRequest(BaseModel):
    brand_name: Optional[str] = None
    category_id: Optional[str] = None
    source_type: XHSSourceType
    source_text: Optional[str] = None
    source_ref: Optional[str] = None
    file_url: Optional[str] = None
    file_name: Optional[str] = None


class XHSBriefPackParseResponse(BaseModel):
    source_type: XHSSourceType
    source_ref: Optional[str] = None
    extracted_text: str
    pack: BriefPackPayload
    validation: XHSConfigValidationResponse
