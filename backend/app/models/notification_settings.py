"""
用户通知偏好设置

说明：
- 只负责存储用户对于不同通知类型、不同渠道（push/email/sms）的开关偏好。
- 具体“通知内容/类型枚举”由前端页面定义，后端按 key 存储。
"""

from __future__ import annotations

from typing import Optional, TYPE_CHECKING

from sqlalchemy import String, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin
from app.models.types import JSONType

if TYPE_CHECKING:
    from app.models.user import User


class NotificationSettings(Base, TimestampMixin):
    __tablename__ = "notification_settings"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_notification_settings_user_id"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)

    user_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # 结构：{ "<setting_id>": {"email": true, "push": false, "sms": false}, ... }
    settings: Mapped[Optional[dict]] = mapped_column(JSONType, nullable=True)

    user: Mapped["User"] = relationship("User", lazy="selectin")

