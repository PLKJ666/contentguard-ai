"""
Brief 相关 Schema

卖点格式 (selling_points: List[dict]):
  新格式: {"content": "卖点内容", "priority": "core|recommended|reference"}
  旧格式: {"content": "卖点内容", "required": true|false}
  兼容规则: required=true → priority="core", required=false → priority="recommended"
"""

from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, Field


# ===== 请求 =====


class BriefCreateRequest(BaseModel):
    """创建/更新 Brief 请求"""

    file_url: Optional[str] = None
    file_name: Optional[str] = None
    product_name: Optional[str] = None
    selling_points: Optional[List[dict]] = None
    min_selling_points: Optional[int] = None
    blacklist_words: Optional[List[dict]] = None
    competitors: Optional[List[str]] = None
    brand_tone: Optional[str] = None
    min_duration: Optional[int] = None
    max_duration: Optional[int] = None
    other_requirements: Optional[str] = None
    attachments: Optional[List[dict]] = None
    agency_attachments: Optional[List[dict]] = None
    creative_rubric: Optional[dict] = None


class BriefUpdateRequest(BaseModel):
    """更新 Brief 请求"""

    file_url: Optional[str] = None
    file_name: Optional[str] = None
    product_name: Optional[str] = None
    selling_points: Optional[List[dict]] = None
    min_selling_points: Optional[int] = None
    blacklist_words: Optional[List[dict]] = None
    competitors: Optional[List[str]] = None
    brand_tone: Optional[str] = None
    min_duration: Optional[int] = None
    max_duration: Optional[int] = None
    other_requirements: Optional[str] = None
    attachments: Optional[List[dict]] = None
    agency_attachments: Optional[List[dict]] = None
    creative_rubric: Optional[dict] = None


class AgencyBriefUpdateRequest(BaseModel):
    """代理商更新 Brief 请求（允许更新代理商附件 + 卖点 + 违禁词 + AI解析内容 + Rubric编辑）"""

    agency_attachments: Optional[List[dict]] = None
    product_name: Optional[str] = None
    selling_points: Optional[List[dict]] = None
    min_selling_points: Optional[int] = None
    blacklist_words: Optional[List[dict]] = None
    brand_tone: Optional[str] = None
    other_requirements: Optional[str] = None
    creative_rubric: Optional[dict] = None


# ===== 响应 =====


class BriefResponse(BaseModel):
    """Brief 响应"""

    id: str
    project_id: str
    project_name: Optional[str] = None
    file_url: Optional[str] = None
    file_name: Optional[str] = None
    product_name: Optional[str] = None
    selling_points: Optional[List[dict]] = None
    min_selling_points: Optional[int] = None
    blacklist_words: Optional[List[dict]] = None
    competitors: Optional[List[str]] = None
    brand_tone: Optional[str] = None
    min_duration: Optional[int] = None
    max_duration: Optional[int] = None
    other_requirements: Optional[str] = None
    attachments: Optional[List[dict]] = None
    agency_attachments: Optional[List[dict]] = None
    creative_rubric: Optional[dict] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
