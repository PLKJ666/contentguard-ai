"""
项目模型
"""
from typing import TYPE_CHECKING, Optional
from datetime import datetime
from sqlalchemy import String, Text, ForeignKey, DateTime, Table, Column, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.organization import Brand, Agency
    from app.models.task import Task
    from app.models.brief import Brief


# 项目-代理商 关联表（一个项目可以分配给多个代理商）
project_agency_association = Table(
    "project_agency",
    Base.metadata,
    Column("project_id", String(64), ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True),
    Column("agency_id", String(64), ForeignKey("agencies.id", ondelete="CASCADE"), primary_key=True),
    Column("created_at", DateTime(timezone=True), default=datetime.utcnow),
    Column("is_active", Boolean, default=True),
)


class Project(Base, TimestampMixin):
    """项目表"""
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    brand_id: Mapped[Optional[str]] = mapped_column(
        String(64),
        ForeignKey("brands.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    config_scope_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)

    # 项目信息
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    client_display_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    brand_display_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    project_remark: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # 时间
    start_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    deadline: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # 发布平台 (douyin/xiaohongshu/bilibili/kuaishou 等)
    platform: Mapped[Optional[str]] = mapped_column(String(50), nullable=True, default=None)

    # 状态
    status: Mapped[str] = mapped_column(
        String(20),
        default="active",  # active, completed, archived
        nullable=False,
        index=True,
    )

    # 关联
    brand: Mapped["Brand"] = relationship("Brand", back_populates="projects")
    agencies: Mapped[list["Agency"]] = relationship(
        "Agency",
        secondary=project_agency_association,
        backref="projects",
    )
    tasks: Mapped[list["Task"]] = relationship(
        "Task",
        back_populates="project",
    )
    brief: Mapped[Optional["Brief"]] = relationship(
        "Brief",
        back_populates="project",
        uselist=False,
    )

    def __repr__(self) -> str:
        return f"<Project(id={self.id}, name={self.name})>"
