"""
消息/通知模型
"""
from typing import Optional
from sqlalchemy import String, Boolean, Text, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Message(Base, TimestampMixin):
    """消息表"""
    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)

    # 接收者
    user_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )

    # 消息类型: invite, new_task, pass, reject, appeal, system 等
    type: Mapped[str] = mapped_column(String(50), nullable=False)

    # 消息内容
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)

    # 已读状态
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # 关联信息（可选）
    related_task_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    related_project_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    sender_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # 邀请相关
    related_agency_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    related_brand_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    action_status: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # pending/accepted/rejected

    __table_args__ = (
        Index("idx_messages_user_id", "user_id"),
        Index("idx_messages_user_read", "user_id", "is_read"),
    )

    def __repr__(self) -> str:
        return f"<Message(id={self.id}, user_id={self.user_id}, type={self.type})>"
