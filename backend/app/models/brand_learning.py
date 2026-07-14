"""
品牌学习档案模型
存储 AI 从 force_pass 事件中学习到的审核规则
"""
from typing import TYPE_CHECKING, Optional
from sqlalchemy import String, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.organization import Brand
    from app.models.tenant import Tenant


class BrandLearnedRule(Base, TimestampMixin):
    """品牌学习规则表"""
    __tablename__ = "brand_learned_rules"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    brand_id: Mapped[Optional[str]] = mapped_column(
        String(64),
        ForeignKey("brands.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    # 规则类型: allowed_expression / tone_preference / false_positive / style_preference
    type: Mapped[str] = mapped_column(String(64), nullable=False)

    # 可泛化规则描述
    pattern: Mapped[str] = mapped_column(Text, nullable=False)

    # 规则原因
    reason: Mapped[str] = mapped_column(Text, nullable=False)

    # 来源任务 ID
    source_task: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    # 创建者: ai_learning / manual
    created_by: Mapped[str] = mapped_column(String(32), nullable=False, default="ai_learning")

    # 关联
    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="learned_rules")
    brand: Mapped[Optional["Brand"]] = relationship("Brand", backref="learned_rules")

    def __repr__(self) -> str:
        return (
            f"<BrandLearnedRule(id={self.id}, tenant_id={self.tenant_id}, "
            f"brand_id={self.brand_id}, type={self.type})>"
        )
