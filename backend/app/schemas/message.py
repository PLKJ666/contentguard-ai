"""
消息相关 Schema
"""
from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel


class MessageResponse(BaseModel):
    id: str
    type: str
    title: str
    content: str
    is_read: bool
    related_task_id: Optional[str] = None
    related_project_id: Optional[str] = None
    sender_name: Optional[str] = None
    related_agency_id: Optional[str] = None
    related_brand_id: Optional[str] = None
    action_status: Optional[str] = None
    created_at: Optional[datetime] = None


class MessageListResponse(BaseModel):
    items: List[MessageResponse]
    total: int
    page: int
    page_size: int


class UnreadCountResponse(BaseModel):
    count: int
