"""
用户通知设置 Schema
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


NotificationChannel = Literal["email", "push", "sms"]


class NotificationSettingItem(BaseModel):
    id: str = Field(..., min_length=1, max_length=64)
    email: bool = False
    push: bool = False
    sms: bool = False


class NotificationSettingsResponse(BaseModel):
    items: list[NotificationSettingItem]


class NotificationSettingsUpdateRequest(BaseModel):
    items: list[NotificationSettingItem]

