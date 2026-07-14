"""
代运营相关 schema
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field

from app.schemas.project import ProjectResponse
from app.schemas.task import TaskResponse

class OperatorProjectCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    platform: Optional[str] = None
    client_display_name: Optional[str] = None
    brand_display_name: Optional[str] = None
    project_remark: Optional[str] = None


class OperatorTaskCreateRequest(BaseModel):
    project_id: str
    name: Optional[str] = None
    creator_display_name: str = Field(..., min_length=1, max_length=255)
    creator_platform: Optional[str] = None
    creator_remark: Optional[str] = None


class OperatorTaskReviewRequest(BaseModel):
    action: str = Field(..., pattern="^(pass|reject)$")
    comment: Optional[str] = None
    corrected_script: Optional[str] = None
    corrected_file_url: Optional[str] = None
    corrected_file_name: Optional[str] = None
    corrected_file_type: Optional[str] = None


class OperatorProjectListResponse(BaseModel):
    items: list[ProjectResponse]
    total: int


class OperatorTaskListResponse(BaseModel):
    items: list[TaskResponse]
    total: int
