"""
规则模型
违禁词、白名单、竞品、平台规则
"""
import enum
from typing import TYPE_CHECKING, Optional
from sqlalchemy import String, Text, ForeignKey
from app.models.types import JSONType
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.tenant import Tenant


class RuleStatus(str, enum.Enum):
    """平台规则状态"""
    DRAFT = "draft"        # AI 解析完成，待确认
    ACTIVE = "active"      # 品牌方已确认，生效中
    INACTIVE = "inactive"  # 已停用


class ForbiddenWord(Base, TimestampMixin):
    """违禁词表"""
    __tablename__ = "forbidden_words"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    word: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    severity: Mapped[str] = mapped_column(String(50), nullable=False)

    # 关联
    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="forbidden_words")

    def __repr__(self) -> str:
        return f"<ForbiddenWord(word={self.word}, category={self.category})>"


class WhitelistItem(Base, TimestampMixin):
    """白名单表"""
    __tablename__ = "whitelist_items"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    brand_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)

    term: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    reason: Mapped[str] = mapped_column(Text, nullable=False)

    # 关联
    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="whitelist_items")

    def __repr__(self) -> str:
        return f"<WhitelistItem(term={self.term}, brand_id={self.brand_id})>"


class Competitor(Base, TimestampMixin):
    """竞品表"""
    __tablename__ = "competitors"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    brand_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    logo_url: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)

    # 关键词列表 (JSON 数组)
    keywords: Mapped[Optional[list]] = mapped_column(JSONType, nullable=True)

    # 关联
    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="competitors")

    def __repr__(self) -> str:
        return f"<Competitor(name={self.name}, brand_id={self.brand_id})>"


class PlatformRule(Base, TimestampMixin):
    """平台规则表 — 品牌方上传文档 + AI 解析"""
    __tablename__ = "platform_rules"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    brand_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    platform: Mapped[str] = mapped_column(String(50), nullable=False, index=True)

    # 文档信息
    document_url: Mapped[str] = mapped_column(String(2048), nullable=False)
    document_name: Mapped[str] = mapped_column(String(512), nullable=False)

    # AI 解析结果（JSON）
    parsed_rules: Mapped[Optional[dict]] = mapped_column(JSONType, nullable=True)

    # 状态
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=RuleStatus.DRAFT.value, index=True,
    )

    # 关联
    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="platform_rules")

    def __repr__(self) -> str:
        return f"<PlatformRule(id={self.id}, platform={self.platform}, status={self.status})>"
