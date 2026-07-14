"""
用户模型
"""
from typing import TYPE_CHECKING, Optional
from datetime import datetime
from sqlalchemy import String, Boolean, DateTime, Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
import enum

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.organization import Brand, Agency, Creator
    from app.models.operator import Operator


class UserRole(str, enum.Enum):
    """用户角色"""
    BRAND = "brand"      # 品牌方
    AGENCY = "agency"    # 代理商
    CREATOR = "creator"  # 达人
    OPERATOR = "operator"  # 代运营


class User(Base, TimestampMixin):
    """用户表"""
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)

    # Logto 认证 (JWT sub)
    logto_id: Mapped[Optional[str]] = mapped_column(String(255), unique=True, nullable=True, index=True)

    # 账号基础字段（资料展示与历史兼容）
    email: Mapped[Optional[str]] = mapped_column(String(255), unique=True, nullable=True, index=True)
    phone: Mapped[Optional[str]] = mapped_column(String(20), unique=True, nullable=True, index=True)

    # 用户信息
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    avatar: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)

    # 角色
    role: Mapped[UserRole] = mapped_column(
        SQLEnum(UserRole, name="user_role_enum", values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        index=True,
    )

    # 状态
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # 最后登录
    last_login_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # 关联的组织（根据角色不同，关联到不同的组织）
    brand: Mapped[Optional["Brand"]] = relationship(
        "Brand",
        back_populates="user",
        uselist=False,
    )
    agency: Mapped[Optional["Agency"]] = relationship(
        "Agency",
        back_populates="user",
        uselist=False,
    )
    creator: Mapped[Optional["Creator"]] = relationship(
        "Creator",
        back_populates="user",
        uselist=False,
    )
    operator: Mapped[Optional["Operator"]] = relationship(
        "Operator",
        back_populates="user",
        uselist=False,
    )

    def __repr__(self) -> str:
        return f"<User(id={self.id}, email={self.email}, role={self.role})>"
