"""审计日志模型"""
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Text, DateTime, Integer, func
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base


class AuditLog(Base):
    """审计日志表 - 记录所有重要操作"""
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # 操作信息
    action: Mapped[str] = mapped_column(String(50), nullable=False, index=True)  # login, logout, create_project, review_task, etc.
    resource_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)  # user, project, task, brief, etc.
    resource_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)

    # 操作者
    user_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    user_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    user_role: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    # 详情
    detail: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON string with extra info
    ip_address: Mapped[Optional[str]] = mapped_column(String(45), nullable=True)

    # 时间
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
        index=True,
    )
