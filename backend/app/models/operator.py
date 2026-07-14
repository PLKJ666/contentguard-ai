"""
代运营角色模型
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Optional
from datetime import datetime, timezone, timedelta
import secrets

from sqlalchemy import String, Boolean, ForeignKey, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin
from app.models.types import JSONType

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.organization import Agency


def build_operator_invite_expiry() -> datetime:
    """默认邀请有效期 7 天。"""
    return datetime.now(timezone.utc) + timedelta(days=7)


class Operator(Base, TimestampMixin):
    """代运营账号实体。"""
    __tablename__ = "operators"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
        index=True,
    )
    agency_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("agencies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    workspace_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    # 历史预留字段；当前产品不做 operator 细粒度权限拆分，不参与运行时权限判断。
    permissions: Mapped[dict] = mapped_column(JSONType, nullable=False, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    user: Mapped["User"] = relationship("User", back_populates="operator")
    agency: Mapped["Agency"] = relationship("Agency", lazy="selectin")

    def __repr__(self) -> str:
        return f"<Operator(id={self.id}, workspace_id={self.workspace_id})>"


class OperatorInvite(Base, TimestampMixin):
    """代运营邀请。"""
    __tablename__ = "operator_invites"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    agency_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("agencies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    workspace_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    permissions: Mapped[dict] = mapped_column(JSONType, nullable=False, default=dict)
    invite_token: Mapped[str] = mapped_column(
        String(128),
        nullable=False,
        unique=True,
        index=True,
        default=lambda: secrets.token_urlsafe(32),
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", index=True)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=build_operator_invite_expiry,
    )
    created_by: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    accepted_by_user_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    accepted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    agency: Mapped["Agency"] = relationship("Agency", lazy="selectin")

    def __repr__(self) -> str:
        return f"<OperatorInvite(id={self.id}, email={self.email}, status={self.status})>"
