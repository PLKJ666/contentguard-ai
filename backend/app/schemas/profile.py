"""
用户资料相关 Schema
"""
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field


# ===== 角色附加信息 =====

class BrandProfile(BaseModel):
    id: str
    name: str
    logo: Optional[str] = None
    description: Optional[str] = None
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_email: Optional[str] = None


class AgencyProfile(BaseModel):
    id: str
    name: str
    logo: Optional[str] = None
    description: Optional[str] = None
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_email: Optional[str] = None


class CreatorProfile(BaseModel):
    id: str
    name: str
    avatar: Optional[str] = None
    bio: Optional[str] = None
    douyin_account: Optional[str] = None
    xiaohongshu_account: Optional[str] = None
    bilibili_account: Optional[str] = None


# ===== 响应 =====

class ProfileResponse(BaseModel):
    id: str
    email: Optional[str] = None
    phone: Optional[str] = None
    name: str
    avatar: Optional[str] = None
    role: str
    is_verified: bool = False
    created_at: Optional[datetime] = None
    brand: Optional[BrandProfile] = None
    agency: Optional[AgencyProfile] = None
    creator: Optional[CreatorProfile] = None


# ===== 请求 =====

class ProfileUpdateRequest(BaseModel):
    name: Optional[str] = Field(None, max_length=100)
    avatar: Optional[str] = Field(None, max_length=2048)
    phone: Optional[str] = Field(None, max_length=20)
    # 品牌方/代理商字段
    description: Optional[str] = None
    contact_name: Optional[str] = Field(None, max_length=100)
    contact_phone: Optional[str] = Field(None, max_length=20)
    contact_email: Optional[str] = Field(None, max_length=255)
    # 达人字段
    bio: Optional[str] = None
    douyin_account: Optional[str] = Field(None, max_length=100)
    xiaohongshu_account: Optional[str] = Field(None, max_length=100)
    bilibili_account: Optional[str] = Field(None, max_length=100)

