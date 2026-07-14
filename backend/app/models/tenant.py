"""
租户模型
"""
from typing import TYPE_CHECKING
from sqlalchemy import String, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.ai_config import AIConfig
    from app.models.brand_learning import BrandLearnedRule
    from app.models.review import ReviewTask
    from app.models.rule import ForbiddenWord, WhitelistItem, Competitor, PlatformRule
    from app.models.xhs import (
        XHSBatchJob,
        XHSBrandPack,
        XHSBriefPack,
        XHSDirectionItem,
        XHSProject,
        XHSProjectVariant,
        XHSRulePack,
        XHSRiskPack,
    )


class Tenant(Base, TimestampMixin):
    """租户表"""
    __tablename__ = "tenants"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    # 关联关系
    ai_config: Mapped["AIConfig"] = relationship(
        "AIConfig",
        back_populates="tenant",
        uselist=False,
        lazy="selectin",
    )
    review_tasks: Mapped[list["ReviewTask"]] = relationship(
        "ReviewTask",
        back_populates="tenant",
        lazy="selectin",
    )
    forbidden_words: Mapped[list["ForbiddenWord"]] = relationship(
        "ForbiddenWord",
        back_populates="tenant",
        lazy="selectin",
    )
    whitelist_items: Mapped[list["WhitelistItem"]] = relationship(
        "WhitelistItem",
        back_populates="tenant",
        lazy="selectin",
    )
    competitors: Mapped[list["Competitor"]] = relationship(
        "Competitor",
        back_populates="tenant",
        lazy="selectin",
    )
    platform_rules: Mapped[list["PlatformRule"]] = relationship(
        "PlatformRule",
        back_populates="tenant",
        lazy="selectin",
    )
    learned_rules: Mapped[list["BrandLearnedRule"]] = relationship(
        "BrandLearnedRule",
        back_populates="tenant",
        lazy="selectin",
    )
    xhs_brand_packs: Mapped[list["XHSBrandPack"]] = relationship(
        "XHSBrandPack",
        back_populates="tenant",
        lazy="selectin",
    )
    xhs_rule_packs: Mapped[list["XHSRulePack"]] = relationship(
        "XHSRulePack",
        back_populates="tenant",
        lazy="selectin",
    )
    xhs_brief_packs: Mapped[list["XHSBriefPack"]] = relationship(
        "XHSBriefPack",
        back_populates="tenant",
        lazy="selectin",
    )
    xhs_risk_packs: Mapped[list["XHSRiskPack"]] = relationship(
        "XHSRiskPack",
        back_populates="tenant",
        lazy="selectin",
    )
    xhs_batch_jobs: Mapped[list["XHSBatchJob"]] = relationship(
        "XHSBatchJob",
        back_populates="tenant",
        lazy="selectin",
    )
    xhs_projects: Mapped[list["XHSProject"]] = relationship(
        "XHSProject",
        back_populates="tenant",
        lazy="selectin",
    )
    xhs_project_variants: Mapped[list["XHSProjectVariant"]] = relationship(
        "XHSProjectVariant",
        back_populates="tenant",
        lazy="selectin",
    )
    xhs_direction_items: Mapped[list["XHSDirectionItem"]] = relationship(
        "XHSDirectionItem",
        back_populates="tenant",
        lazy="selectin",
    )

    def __repr__(self) -> str:
        return f"<Tenant(id={self.id}, name={self.name})>"
