"""
项目相关 Schema
"""
from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, Field


# ===== 请求 =====

class ProjectCreateRequest(BaseModel):
    """创建项目请求（品牌方操作）"""
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    platform: Optional[str] = None
    start_date: Optional[datetime] = None
    deadline: Optional[datetime] = None
    agency_ids: Optional[List[str]] = None  # 分配的代理商 ID 列表
    client_display_name: Optional[str] = None
    brand_display_name: Optional[str] = None
    project_remark: Optional[str] = None


class ProjectUpdateRequest(BaseModel):
    """更新项目请求"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    platform: Optional[str] = None
    start_date: Optional[datetime] = None
    deadline: Optional[datetime] = None
    status: Optional[str] = Field(None, pattern="^(active|completed|archived)$")
    client_display_name: Optional[str] = None
    brand_display_name: Optional[str] = None
    project_remark: Optional[str] = None


class ProjectAssignAgencyRequest(BaseModel):
    """分配代理商到项目"""
    agency_ids: List[str]


# ===== 响应 =====

class AgencySummary(BaseModel):
    """代理商摘要"""
    id: str
    name: str
    logo: Optional[str] = None


class ProjectResponse(BaseModel):
    """项目响应"""
    id: str
    name: str
    description: Optional[str] = None
    platform: Optional[str] = None
    brand_id: Optional[str] = None
    brand_name: Optional[str] = None
    client_display_name: Optional[str] = None
    brand_display_name: Optional[str] = None
    project_remark: Optional[str] = None
    status: str
    start_date: Optional[datetime] = None
    deadline: Optional[datetime] = None
    agencies: List[AgencySummary] = []
    task_count: int = 0
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ProjectListResponse(BaseModel):
    """项目列表响应"""
    items: List[ProjectResponse]
    total: int
    page: int
    page_size: int
