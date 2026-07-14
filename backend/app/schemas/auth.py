"""
认证相关 Schema
"""
from typing import Optional
from pydantic import BaseModel, Field
from app.models.user import UserRole


class OnboardingRequest(BaseModel):
    """Logto 新用户 Onboarding 请求"""
    role: UserRole
    name: str = Field(..., min_length=1, max_length=100, description="用户姓名/昵称")
    company_name: Optional[str] = Field(None, max_length=200, description="公司名称（品牌方/代理商）")
    platform: Optional[str] = Field(None, pattern=r"^(douyin|xiaohongshu|bilibili)$", description="达人平台")
    platform_account: Optional[str] = Field(None, max_length=200, description="达人平台账号")
    operator_access_code: Optional[str] = Field(None, max_length=100, description="代运营身份开通码")


class MeResponse(BaseModel):
    """登录后用户状态响应"""
    needs_onboarding: bool
    logto_sub: Optional[str] = None
    email: Optional[str] = None
    name: Optional[str] = None
    # 以下字段仅 needs_onboarding=False 时有值
    id: Optional[str] = None
    phone: Optional[str] = None
    avatar: Optional[str] = None
    role: Optional[UserRole] = None
    is_verified: Optional[bool] = None
    brand_id: Optional[str] = None
    agency_id: Optional[str] = None
    creator_id: Optional[str] = None
    operator_id: Optional[str] = None
    tenant_id: Optional[str] = None
    tenant_name: Optional[str] = None


class UserResponse(BaseModel):
    """用户信息响应"""
    id: str
    email: Optional[str] = None
    phone: Optional[str] = None
    name: str
    avatar: Optional[str] = None
    role: UserRole
    is_verified: bool

    # 根据角色返回对应的组织 ID
    brand_id: Optional[str] = None
    agency_id: Optional[str] = None
    creator_id: Optional[str] = None
    operator_id: Optional[str] = None

    # 当前所属租户（品牌方）- 用于数据隔离
    tenant_id: Optional[str] = None
    tenant_name: Optional[str] = None

    class Config:
        from_attributes = True
