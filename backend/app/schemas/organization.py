"""
组织关系相关 Schema
"""
from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, Field


# ===== 通用 =====

class BrandSummary(BaseModel):
    """品牌方摘要"""
    id: str
    name: str
    logo: Optional[str] = None
    contact_name: Optional[str] = None

    class Config:
        from_attributes = True


class AgencySummary(BaseModel):
    """代理商摘要"""
    id: str
    name: str
    logo: Optional[str] = None
    contact_name: Optional[str] = None
    force_pass_enabled: bool = True

    class Config:
        from_attributes = True


class CreatorSummary(BaseModel):
    """达人摘要"""
    id: str
    name: str
    avatar: Optional[str] = None
    douyin_account: Optional[str] = None
    xiaohongshu_account: Optional[str] = None
    bilibili_account: Optional[str] = None

    class Config:
        from_attributes = True


# ===== 请求 =====

class InviteAgencyRequest(BaseModel):
    """邀请代理商"""
    agency_id: str


class InviteCreatorRequest(BaseModel):
    """邀请达人"""
    creator_id: str


class UpdateAgencyPermissionRequest(BaseModel):
    """更新代理商权限"""
    force_pass_enabled: bool


# ===== 响应 =====

class OrganizationListResponse(BaseModel):
    """组织列表通用响应"""
    items: list
    total: int


class BrandListResponse(BaseModel):
    """品牌方列表"""
    items: List[BrandSummary]
    total: int


class AgencyListResponse(BaseModel):
    """代理商列表"""
    items: List[AgencySummary]
    total: int


class CreatorListResponse(BaseModel):
    """达人列表"""
    items: List[CreatorSummary]
    total: int
