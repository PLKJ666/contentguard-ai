"""
小红书批量图文笔记相关模型。
"""
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin
from app.models.types import JSONType

if TYPE_CHECKING:
    from app.models.tenant import Tenant


class XHSRulePack(Base, TimestampMixin):
    __tablename__ = "xhs_rule_packs"
    __table_args__ = (
        UniqueConstraint("tenant_id", "category_id", "version", name="uq_xhs_rule_pack_version"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    category_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    version: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft", index=True)
    pack_json: Mapped[dict] = mapped_column(JSONType, nullable=False)
    created_by: Mapped[str] = mapped_column(String(64), nullable=False)

    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="xhs_rule_packs")


class XHSProject(Base, TimestampMixin):
    __tablename__ = "xhs_projects"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    category_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    client_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    product_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    brief_file_ref: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)
    brief_file_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    brief_parse_result_json: Mapped[Optional[dict]] = mapped_column(JSONType, nullable=True)
    project_brief: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    shared_requirements: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    remark: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active", index=True)
    created_by: Mapped[str] = mapped_column(String(64), nullable=False)

    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="xhs_projects")
    variants: Mapped[list["XHSProjectVariant"]] = relationship(
        "XHSProjectVariant",
        back_populates="project",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    directions: Mapped[list["XHSDirectionItem"]] = relationship(
        "XHSDirectionItem",
        back_populates="project",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class XHSProjectVariant(Base, TimestampMixin):
    __tablename__ = "xhs_project_variants"
    __table_args__ = (
        UniqueConstraint("project_id", "name", name="uq_xhs_project_variant_name"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    project_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("xhs_projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    selling_points: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    appearance_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by: Mapped[str] = mapped_column(String(64), nullable=False)

    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="xhs_project_variants")
    project: Mapped["XHSProject"] = relationship("XHSProject", back_populates="variants")
    main_directions: Mapped[list["XHSDirectionItem"]] = relationship(
        "XHSDirectionItem",
        back_populates="main_variant",
        foreign_keys="XHSDirectionItem.main_variant_id",
        lazy="selectin",
    )


class XHSDirectionItem(Base, TimestampMixin):
    __tablename__ = "xhs_direction_items"
    __table_args__ = (
        UniqueConstraint("project_id", "name", name="uq_xhs_direction_item_name"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    project_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("xhs_projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft", index=True)
    main_variant_id: Mapped[Optional[str]] = mapped_column(
        String(64),
        ForeignKey("xhs_project_variants.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    secondary_variant_ids_json: Mapped[Optional[list]] = mapped_column(JSONType, nullable=True)
    content_style: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    direction_brief: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    extra_requirements: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by: Mapped[str] = mapped_column(String(64), nullable=False)

    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="xhs_direction_items")
    project: Mapped["XHSProject"] = relationship("XHSProject", back_populates="directions")
    main_variant: Mapped[Optional["XHSProjectVariant"]] = relationship(
        "XHSProjectVariant",
        back_populates="main_directions",
        foreign_keys=[main_variant_id],
    )
    batches: Mapped[list["XHSBatchJob"]] = relationship(
        "XHSBatchJob",
        back_populates="direction",
        lazy="selectin",
    )


class XHSBrandPack(Base, TimestampMixin):
    __tablename__ = "xhs_brand_packs"
    __table_args__ = (
        UniqueConstraint("tenant_id", "category_id", "version", name="uq_xhs_brand_pack_version"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    brand_name: Mapped[str] = mapped_column(String(255), nullable=False)
    category_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    version: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft", index=True)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    pack_json: Mapped[dict] = mapped_column(JSONType, nullable=False)
    created_by: Mapped[str] = mapped_column(String(64), nullable=False)

    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="xhs_brand_packs")


class XHSBriefPack(Base, TimestampMixin):
    __tablename__ = "xhs_brief_packs"
    __table_args__ = (
        UniqueConstraint("tenant_id", "category_id", "version", name="uq_xhs_brief_pack_version"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    brand_name: Mapped[str] = mapped_column(String(255), nullable=False)
    category_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    version: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft", index=True)
    pack_json: Mapped[dict] = mapped_column(JSONType, nullable=False)
    source_type: Mapped[str] = mapped_column(String(32), nullable=False)
    source_ref: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)
    created_by: Mapped[str] = mapped_column(String(64), nullable=False)

    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="xhs_brief_packs")


class XHSRiskPack(Base, TimestampMixin):
    __tablename__ = "xhs_risk_packs"
    __table_args__ = (
        UniqueConstraint("tenant_id", "category_id", "version", name="uq_xhs_risk_pack_version"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    category_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    version: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft", index=True)
    pack_json: Mapped[dict] = mapped_column(JSONType, nullable=False)
    created_by: Mapped[str] = mapped_column(String(64), nullable=False)

    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="xhs_risk_packs")


class XHSBatchJob(Base, TimestampMixin):
    __tablename__ = "xhs_batch_jobs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_by: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending", index=True)
    category_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    direction_id: Mapped[Optional[str]] = mapped_column(
        String(64),
        ForeignKey("xhs_direction_items.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    rule_pack_version: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    risk_pack_version: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    brand_pack_version: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    brief_pack_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    style_template_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    run_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="trial")
    trial_sample_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    input_type: Mapped[str] = mapped_column(String(32), nullable=False)
    input_stats_json: Mapped[Optional[dict]] = mapped_column(JSONType, nullable=True)
    tag_policy_json: Mapped[Optional[dict]] = mapped_column(JSONType, nullable=True)
    export_options_json: Mapped[Optional[dict]] = mapped_column(JSONType, nullable=True)
    estimated_tokens: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    estimated_cost: Mapped[Optional[float]] = mapped_column(Numeric(12, 4), nullable=True)
    actual_tokens: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    actual_cost: Mapped[Optional[float]] = mapped_column(Numeric(12, 4), nullable=True)
    system_blocked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    system_block_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    total_items: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    done_items: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    running_items: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    export_all_md_status: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    export_all_md_url: Mapped[Optional[str]] = mapped_column(String(2048), nullable=True)
    export_feishu_status: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    export_feishu_doc_title: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    export_feishu_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="xhs_batch_jobs")
    direction: Mapped[Optional["XHSDirectionItem"]] = relationship("XHSDirectionItem", back_populates="batches")
    items: Mapped[list["XHSBatchItem"]] = relationship(
        "XHSBatchItem",
        back_populates="batch",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    export_logs: Mapped[list["XHSExportLog"]] = relationship(
        "XHSExportLog",
        back_populates="batch",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class XHSBatchItem(Base):
    __tablename__ = "xhs_batch_items"
    __table_args__ = (
        UniqueConstraint("batch_id", "item_id", name="uq_xhs_batch_item_item_id"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    batch_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("xhs_batch_jobs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    item_id: Mapped[str] = mapped_column(String(64), nullable=False)
    source_text: Mapped[str] = mapped_column(Text, nullable=False)
    source_title_guess: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    split_by: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending", index=True)
    round: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    editor_output_json: Mapped[Optional[dict]] = mapped_column(JSONType, nullable=True)
    verifier_json: Mapped[Optional[dict]] = mapped_column(JSONType, nullable=True)
    verifier_pass: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    verifier_confidence: Mapped[Optional[float]] = mapped_column(Numeric(5, 4), nullable=True)
    rewrite_fail_reasons_json: Mapped[Optional[list]] = mapped_column(JSONType, nullable=True)
    safe_rewrite_used: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    safe_rewrite_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    final_title: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    final_body: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    final_hashtags_json: Mapped[Optional[list]] = mapped_column(JSONType, nullable=True)
    copy_ready_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    quality_score: Mapped[Optional[float]] = mapped_column(Numeric(5, 2), nullable=True)
    duration_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    model_meta_json: Mapped[Optional[dict]] = mapped_column(JSONType, nullable=True)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    batch: Mapped["XHSBatchJob"] = relationship("XHSBatchJob", back_populates="items")


class XHSExportLog(Base, TimestampMixin):
    __tablename__ = "xhs_export_logs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    batch_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("xhs_batch_jobs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    type: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    request_json: Mapped[Optional[dict]] = mapped_column(JSONType, nullable=True)
    response_json: Mapped[Optional[dict]] = mapped_column(JSONType, nullable=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    batch: Mapped["XHSBatchJob"] = relationship("XHSBatchJob", back_populates="export_logs")
