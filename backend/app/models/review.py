"""
审核任务模型
"""
from typing import TYPE_CHECKING, Optional
from datetime import datetime
from sqlalchemy import String, Integer, Float, Text, ForeignKey, DateTime, Enum as SQLEnum
from app.models.types import JSONType
from sqlalchemy.orm import Mapped, mapped_column, relationship
import enum

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.tenant import Tenant


class TaskStatus(str, enum.Enum):
    """任务状态"""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    APPROVED = "approved"
    REJECTED = "rejected"


class Platform(str, enum.Enum):
    """投放平台"""
    DOUYIN = "douyin"
    XIAOHONGSHU = "xiaohongshu"
    BILIBILI = "bilibili"
    KUAISHOU = "kuaishou"


class ReviewTask(Base, TimestampMixin):
    """审核任务表 (AI 自动审核)"""
    __tablename__ = "review_tasks"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # 视频信息
    video_url: Mapped[str] = mapped_column(String(2048), nullable=False)
    platform: Mapped[Platform] = mapped_column(
        SQLEnum(Platform, name="platform_enum", values_callable=lambda x: [e.value for e in x]),
        nullable=False,
    )
    brand_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    creator_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)

    # 审核状态
    status: Mapped[TaskStatus] = mapped_column(
        SQLEnum(TaskStatus, name="task_status_enum", values_callable=lambda x: [e.value for e in x]),
        default=TaskStatus.PENDING,
        nullable=False,
        index=True,
    )
    progress: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    current_step: Mapped[str] = mapped_column(String(100), default="等待处理", nullable=False)

    # 审核结果
    score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # 违规详情 (JSON 数组)
    # [{"type": "forbidden_word", "content": "最好", "severity": "high", ...}]
    violations: Mapped[Optional[list]] = mapped_column(JSONType, nullable=True)

    # 软性风控提示 (JSON 数组)
    soft_warnings: Mapped[Optional[list]] = mapped_column(JSONType, nullable=True)

    # 品牌曝光评估 (JSON)
    brand_exposure: Mapped[Optional[dict]] = mapped_column(JSONType, nullable=True)

    # 审核要求 (JSON)
    requirements: Mapped[Optional[dict]] = mapped_column(JSONType, nullable=True)

    # 竞品列表
    competitors: Mapped[Optional[list]] = mapped_column(JSONType, nullable=True)

    # 错误信息
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # 关联
    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="review_tasks")
    def __repr__(self) -> str:
        return f"<ReviewTask(id={self.id}, status={self.status})>"
