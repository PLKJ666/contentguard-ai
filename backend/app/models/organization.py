"""
组织模型：品牌方、代理商、达人
"""
from typing import TYPE_CHECKING, Optional
from datetime import datetime
from sqlalchemy import String, Boolean, Text, ForeignKey, DateTime, Table, Column
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.project import Project


# 品牌方-代理商 关联表（多对多）
brand_agency_association = Table(
    "brand_agency",
    Base.metadata,
    Column("brand_id", String(64), ForeignKey("brands.id", ondelete="CASCADE"), primary_key=True),
    Column("agency_id", String(64), ForeignKey("agencies.id", ondelete="CASCADE"), primary_key=True),
    Column("created_at", DateTime(timezone=True), default=datetime.utcnow),
    Column("is_active", Boolean, default=True),
)

# 代理商-达人 关联表（多对多）
agency_creator_association = Table(
    "agency_creator",
    Base.metadata,
    Column("agency_id", String(64), ForeignKey("agencies.id", ondelete="CASCADE"), primary_key=True),
    Column("creator_id", String(64), ForeignKey("creators.id", ondelete="CASCADE"), primary_key=True),
    Column("created_at", DateTime(timezone=True), default=datetime.utcnow),
    Column("is_active", Boolean, default=True),
)


class Brand(Base, TimestampMixin):
    """品牌方表（即租户）"""
    __tablename__ = "brands"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # 格式: BR123456
    user_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )

    # 品牌信息
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    logo: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # 联系信息
    contact_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    contact_phone: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    contact_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # 设置
    final_review_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)  # 终审开关

    # 状态
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # 关联
    user: Mapped["User"] = relationship("User", back_populates="brand")
    agencies: Mapped[list["Agency"]] = relationship(
        "Agency",
        secondary=brand_agency_association,
        back_populates="brands",
    )
    projects: Mapped[list["Project"]] = relationship(
        "Project",
        back_populates="brand",
    )

    def __repr__(self) -> str:
        return f"<Brand(id={self.id}, name={self.name})>"


class Agency(Base, TimestampMixin):
    """代理商表"""
    __tablename__ = "agencies"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # 格式: AG123456
    user_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )

    # 代理商信息
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    logo: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # 联系信息
    contact_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    contact_phone: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    contact_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # 权限设置（可被品牌方覆盖）
    force_pass_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)  # 强制通过权

    # 状态
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # 关联
    user: Mapped["User"] = relationship("User", back_populates="agency")
    brands: Mapped[list["Brand"]] = relationship(
        "Brand",
        secondary=brand_agency_association,
        back_populates="agencies",
    )
    creators: Mapped[list["Creator"]] = relationship(
        "Creator",
        secondary=agency_creator_association,
        back_populates="agencies",
    )

    def __repr__(self) -> str:
        return f"<Agency(id={self.id}, name={self.name})>"


class Creator(Base, TimestampMixin):
    """达人表"""
    __tablename__ = "creators"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # 格式: CR123456
    user_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )

    # 达人信息
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    avatar: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)
    bio: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # 社交账号
    douyin_account: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    xiaohongshu_account: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    bilibili_account: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # 状态
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # 关联
    user: Mapped["User"] = relationship("User", back_populates="creator")
    agencies: Mapped[list["Agency"]] = relationship(
        "Agency",
        secondary=agency_creator_association,
        back_populates="creators",
    )

    def __repr__(self) -> str:
        return f"<Creator(id={self.id}, name={self.name})>"
