"""
小红书项目层级 schema。

用于承接：
1. 大项目
2. 产品版本
3. 方向单
"""
from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field, model_validator


class XHSProjectStatus(str, Enum):
    ACTIVE = "active"
    ARCHIVED = "archived"


class XHSDirectionStatus(str, Enum):
    DRAFT = "draft"
    ACTIVE = "active"
    ARCHIVED = "archived"


class XHSProjectBriefParseVariantSuggestion(BaseModel):
    name: str = ""
    selling_points: list[str] = Field(default_factory=list)
    appearance_notes: Optional[str] = None
    notes: Optional[str] = None


class XHSProjectBriefParseDirectionSuggestion(BaseModel):
    name: str = ""
    main_variant_name: Optional[str] = None
    secondary_variant_names: list[str] = Field(default_factory=list)
    content_style: Optional[str] = None
    direction_brief: Optional[str] = None
    extra_requirements: list[str] = Field(default_factory=list)


class XHSProjectBriefParseResult(BaseModel):
    product_name: str = ""
    project_brief: str = ""
    shared_requirements: str = ""
    key_points: list[str] = Field(default_factory=list)
    variant_suggestions: list[XHSProjectBriefParseVariantSuggestion] = Field(default_factory=list)
    direction_suggestions: list[XHSProjectBriefParseDirectionSuggestion] = Field(default_factory=list)


class XHSProjectBriefParseRequest(BaseModel):
    source_ref: str = Field(..., min_length=1, max_length=2048)
    file_name: str = Field(..., min_length=1, max_length=255)
    file_url: Optional[str] = Field(default=None, max_length=2048)
    category_id: Optional[str] = Field(default=None, max_length=64)


class XHSProjectBriefParseResponse(BaseModel):
    source_ref: str
    file_name: str
    extracted_text: str = ""
    brief_parse_result: XHSProjectBriefParseResult
    raw_result: dict[str, Any] = Field(default_factory=dict)


class XHSVariantBriefParseResult(BaseModel):
    name: str = ""
    selling_points: list[str] = Field(default_factory=list)
    appearance_notes: Optional[str] = None
    notes: Optional[str] = None


class XHSVariantBriefParseRequest(BaseModel):
    source_ref: Optional[str] = Field(default=None, max_length=2048)
    file_name: Optional[str] = Field(default=None, max_length=255)
    file_url: Optional[str] = Field(default=None, max_length=2048)
    raw_text: Optional[str] = None
    category_id: Optional[str] = Field(default=None, max_length=64)

    @model_validator(mode="after")
    def validate_source(self) -> "XHSVariantBriefParseRequest":
        has_raw_text = bool((self.raw_text or "").strip())
        has_file = bool((self.source_ref or "").strip() and (self.file_name or "").strip())
        if not has_raw_text and not has_file:
            raise ValueError("请上传版本 Brief 文件，或直接粘贴版本说明")
        return self


class XHSVariantBriefParseResponse(BaseModel):
    source_ref: Optional[str] = None
    file_name: Optional[str] = None
    extracted_text: str = ""
    brief_parse_result: XHSVariantBriefParseResult
    raw_result: dict[str, Any] = Field(default_factory=dict)


class XHSProjectCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    category_id: str = Field(..., min_length=1, max_length=64)
    client_name: Optional[str] = Field(default=None, max_length=255)
    product_name: Optional[str] = Field(default=None, max_length=255)
    brief_file_ref: Optional[str] = Field(default=None, max_length=2048)
    brief_file_name: Optional[str] = Field(default=None, max_length=255)
    brief_parse_result: Optional[XHSProjectBriefParseResult] = None
    project_brief: Optional[str] = None
    shared_requirements: Optional[str] = None
    remark: Optional[str] = None
    status: XHSProjectStatus = XHSProjectStatus.ACTIVE


class XHSProjectUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    category_id: Optional[str] = Field(default=None, min_length=1, max_length=64)
    client_name: Optional[str] = Field(default=None, max_length=255)
    product_name: Optional[str] = Field(default=None, max_length=255)
    brief_file_ref: Optional[str] = Field(default=None, max_length=2048)
    brief_file_name: Optional[str] = Field(default=None, max_length=255)
    brief_parse_result: Optional[XHSProjectBriefParseResult] = None
    project_brief: Optional[str] = None
    shared_requirements: Optional[str] = None
    remark: Optional[str] = None
    status: Optional[XHSProjectStatus] = None


class XHSProjectVariantCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    selling_points: Optional[str] = None
    appearance_notes: Optional[str] = None
    notes: Optional[str] = None
    is_primary: bool = False
    sort_order: int = 0


class XHSProjectVariantUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    selling_points: Optional[str] = None
    appearance_notes: Optional[str] = None
    notes: Optional[str] = None
    is_primary: Optional[bool] = None
    sort_order: Optional[int] = None


class XHSDirectionCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    status: XHSDirectionStatus = XHSDirectionStatus.DRAFT
    main_variant_id: Optional[str] = None
    secondary_variant_ids: list[str] = Field(default_factory=list)
    content_style: Optional[str] = Field(default=None, max_length=64)
    direction_brief: Optional[str] = None
    extra_requirements: Optional[str] = None
    notes: Optional[str] = None
    sort_order: int = 0


class XHSDirectionUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    status: Optional[XHSDirectionStatus] = None
    main_variant_id: Optional[str] = None
    secondary_variant_ids: Optional[list[str]] = None
    content_style: Optional[str] = Field(default=None, max_length=64)
    direction_brief: Optional[str] = None
    extra_requirements: Optional[str] = None
    notes: Optional[str] = None
    sort_order: Optional[int] = None


class XHSProjectResponse(BaseModel):
    id: str
    tenant_id: str
    name: str
    category_id: str
    client_name: Optional[str] = None
    product_name: Optional[str] = None
    brief_file_ref: Optional[str] = None
    brief_file_name: Optional[str] = None
    brief_parse_result: Optional[XHSProjectBriefParseResult] = None
    project_brief: Optional[str] = None
    shared_requirements: Optional[str] = None
    remark: Optional[str] = None
    status: XHSProjectStatus
    created_by: str
    variant_count: int = 0
    direction_count: int = 0
    batch_count: int = 0
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class XHSProjectVariantResponse(BaseModel):
    id: str
    tenant_id: str
    project_id: str
    name: str
    selling_points: Optional[str] = None
    appearance_notes: Optional[str] = None
    notes: Optional[str] = None
    is_primary: bool
    sort_order: int
    created_by: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class XHSDirectionResponse(BaseModel):
    id: str
    tenant_id: str
    project_id: str
    project_name: Optional[str] = None
    name: str
    status: XHSDirectionStatus
    main_variant_id: Optional[str] = None
    main_variant_name: Optional[str] = None
    secondary_variant_ids: list[str] = Field(default_factory=list)
    content_style: Optional[str] = None
    direction_brief: Optional[str] = None
    extra_requirements: Optional[str] = None
    notes: Optional[str] = None
    sort_order: int
    created_by: str
    batch_count: int = 0
    latest_batch_id: Optional[str] = None
    latest_batch_status: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
