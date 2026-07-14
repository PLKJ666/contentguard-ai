"""
Brief 模型
"""

from typing import TYPE_CHECKING, Optional
from sqlalchemy import String, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin
from app.models.types import JSONType

if TYPE_CHECKING:
    from app.models.project import Project


class Brief(Base, TimestampMixin):
    """Brief 文档表"""

    __tablename__ = "briefs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    project_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("projects.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
        index=True,
    )

    # 原始文件
    file_url: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)
    file_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # 解析后的结构化内容
    # 产品/品牌名称（从 Brief 文档中解析出来，AI 审核时使用，不使用品牌方设置的可更改公司名）
    product_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # 卖点要求: [{"content": "SPF50+", "priority": "core"}, ...]
    selling_points: Mapped[Optional[list]] = mapped_column(JSONType, nullable=True)

    # 代理商要求至少体现的卖点条数（0 或 None 表示不限制）
    min_selling_points: Mapped[Optional[int]] = mapped_column(nullable=True)

    # 违禁词: [{"word": "最好", "reason": "绝对化用语"}, ...]
    blacklist_words: Mapped[Optional[list]] = mapped_column(JSONType, nullable=True)

    # 竞品: ["竞品A", "竞品B", ...]
    competitors: Mapped[Optional[list]] = mapped_column(JSONType, nullable=True)

    # 品牌调性要求
    brand_tone: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # 时长要求（秒）
    min_duration: Mapped[Optional[int]] = mapped_column(nullable=True)
    max_duration: Mapped[Optional[int]] = mapped_column(nullable=True)

    # 其他要求（自由文本）
    other_requirements: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # 附件文档（品牌方上传的参考资料）
    # [{"id": "af1", "name": "达人拍摄指南.pdf", "url": "...", "size": "1.5MB"}, ...]
    attachments: Mapped[Optional[list]] = mapped_column(JSONType, nullable=True)

    # 代理商附件（代理商上传的补充资料，与品牌方 attachments 分开存储）
    # [{"id": "af1", "name": "达人拍摄指南.pdf", "url": "...", "size": "1.5MB"}, ...]
    agency_attachments: Mapped[Optional[list]] = mapped_column(JSONType, nullable=True)

    # Creative Rubric（AI 解析 Brief 时自动生成，代理商可编辑）
    # {"tone": {"target": "...", "do": [...], "dont": [...]}, "audience": {...}, "content_style": {...}, "structure": {...}}
    creative_rubric: Mapped[Optional[dict]] = mapped_column(JSONType, nullable=True)

    # 关联
    project: Mapped["Project"] = relationship("Project", back_populates="brief")

    def __repr__(self) -> str:
        return f"<Brief(id={self.id}, project_id={self.project_id})>"
