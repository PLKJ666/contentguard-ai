"""
任务模型
"""
from typing import TYPE_CHECKING, Optional
from datetime import datetime
from sqlalchemy import String, Integer, Text, ForeignKey, DateTime, Enum as SQLEnum, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
import enum

from app.models.base import Base, TimestampMixin
from app.models.types import JSONType

if TYPE_CHECKING:
    from app.models.project import Project
    from app.models.organization import Agency, Creator


class TaskStage(str, enum.Enum):
    """任务阶段"""
    SCRIPT_UPLOAD = "script_upload"           # 待上传脚本
    SCRIPT_AI_REVIEW = "script_ai_review"     # 脚本 AI 审核中
    SCRIPT_AGENCY_REVIEW = "script_agency_review"  # 脚本代理商审核中
    SCRIPT_BRAND_REVIEW = "script_brand_review"    # 脚本品牌方终审中
    VIDEO_UPLOAD = "video_upload"             # 待上传视频
    VIDEO_AI_REVIEW = "video_ai_review"       # 视频 AI 审核中
    VIDEO_AGENCY_REVIEW = "video_agency_review"    # 视频代理商审核中
    VIDEO_BRAND_REVIEW = "video_brand_review"      # 视频品牌方终审中
    COMPLETED = "completed"                   # 已完成
    REJECTED = "rejected"                     # 已驳回


class TaskStatus(str, enum.Enum):
    """任务状态"""
    PENDING = "pending"        # 待处理
    PROCESSING = "processing"  # 处理中
    PASSED = "passed"          # 通过
    REJECTED = "rejected"      # 驳回
    FORCE_PASSED = "force_passed"  # 强制通过


class Task(Base, TimestampMixin):
    """任务表"""
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)

    # 关联
    project_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    agency_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("agencies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    creator_id: Mapped[Optional[str]] = mapped_column(
        String(64),
        ForeignKey("creators.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    creator_display_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    creator_platform: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    creator_remark: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # 任务信息
    name: Mapped[str] = mapped_column(String(255), nullable=False)  # 如 "麦奶咖新品抖音种草 任务1"
    sequence: Mapped[int] = mapped_column(Integer, default=1, nullable=False)  # 序号

    # 当前阶段
    stage: Mapped[TaskStage] = mapped_column(
        SQLEnum(TaskStage, name="task_stage_enum", values_callable=lambda x: [e.value for e in x]),
        default=TaskStage.SCRIPT_UPLOAD,
        nullable=False,
        index=True,
    )

    # ===== 脚本相关 =====
    script_file_url: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)
    script_file_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    script_text_content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # 粘贴的文字脚本
    script_uploaded_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # 脚本 AI 审核结果
    script_ai_score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    script_ai_result: Mapped[Optional[dict]] = mapped_column(JSONType, nullable=True)
    script_ai_reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # 代理商修正后的脚本（应用合规修改后的文本版本）
    script_agency_corrected: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    script_agency_corrected_file_url: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)
    script_agency_corrected_file_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    script_agency_corrected_file_type: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # 脚本代理商审核
    script_agency_status: Mapped[Optional[TaskStatus]] = mapped_column(
        SQLEnum(TaskStatus, name="task_status_enum", values_callable=lambda x: [e.value for e in x]),
        nullable=True,
    )
    script_agency_comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    script_agency_reviewer_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    script_agency_reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # 脚本品牌方终审
    script_brand_status: Mapped[Optional[TaskStatus]] = mapped_column(
        SQLEnum(TaskStatus, name="task_status_enum", create_type=False, values_callable=lambda x: [e.value for e in x]),
        nullable=True,
    )
    script_brand_comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    script_brand_reviewer_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    script_brand_reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # ===== 视频相关 =====
    video_file_url: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)
    video_file_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    video_duration: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # 秒
    video_thumbnail_url: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)
    video_uploaded_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # 视频 AI 审核结果
    video_ai_score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    video_ai_result: Mapped[Optional[dict]] = mapped_column(JSONType, nullable=True)
    video_ai_reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # 视频代理商审核
    video_agency_status: Mapped[Optional[TaskStatus]] = mapped_column(
        SQLEnum(TaskStatus, name="task_status_enum", create_type=False, values_callable=lambda x: [e.value for e in x]),
        nullable=True,
    )
    video_agency_comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    video_agency_reviewer_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    video_agency_reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # 视频品牌方终审
    video_brand_status: Mapped[Optional[TaskStatus]] = mapped_column(
        SQLEnum(TaskStatus, name="task_status_enum", create_type=False, values_callable=lambda x: [e.value for e in x]),
        nullable=True,
    )
    video_brand_comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    video_brand_reviewer_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    video_brand_reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # ===== 申诉相关 =====
    appeal_count: Mapped[int] = mapped_column(Integer, default=1, nullable=False)  # 剩余申诉次数
    is_appeal: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)  # 是否为申诉
    appeal_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # 申诉理由
    appeal_request_status: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # pending/approved/rejected

    # 关联
    project: Mapped["Project"] = relationship("Project", back_populates="tasks")
    agency: Mapped["Agency"] = relationship("Agency", foreign_keys=[agency_id])
    creator: Mapped[Optional["Creator"]] = relationship("Creator", foreign_keys=[creator_id])

    def __repr__(self) -> str:
        return f"<Task(id={self.id}, name={self.name}, stage={self.stage})>"
