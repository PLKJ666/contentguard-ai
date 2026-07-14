"""add xhs batch assets and jobs

Revision ID: 018_xhs_batch_p0
Revises: 261778c01ef8
Create Date: 2026-03-19 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "018_xhs_batch_p0"
down_revision: Union[str, None] = "261778c01ef8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _json_type() -> sa.JSON:
    return sa.JSON().with_variant(sa.dialects.postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "xhs_brand_packs",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("tenant_id", sa.String(length=64), nullable=False),
        sa.Column("brand_name", sa.String(length=255), nullable=False),
        sa.Column("category_id", sa.String(length=64), nullable=False),
        sa.Column("version", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("pack_json", _json_type(), nullable=False),
        sa.Column("created_by", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "category_id", "version", name="uq_xhs_brand_pack_version"),
    )
    op.create_index("ix_xhs_brand_packs_tenant_id", "xhs_brand_packs", ["tenant_id"])
    op.create_index("ix_xhs_brand_packs_category_id", "xhs_brand_packs", ["category_id"])
    op.create_index("ix_xhs_brand_packs_status", "xhs_brand_packs", ["status"])

    op.create_table(
        "xhs_brief_packs",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("tenant_id", sa.String(length=64), nullable=False),
        sa.Column("brand_name", sa.String(length=255), nullable=False),
        sa.Column("category_id", sa.String(length=64), nullable=False),
        sa.Column("version", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
        sa.Column("pack_json", _json_type(), nullable=False),
        sa.Column("source_type", sa.String(length=32), nullable=False),
        sa.Column("source_ref", sa.String(length=2048), nullable=True),
        sa.Column("created_by", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "category_id", "version", name="uq_xhs_brief_pack_version"),
    )
    op.create_index("ix_xhs_brief_packs_tenant_id", "xhs_brief_packs", ["tenant_id"])
    op.create_index("ix_xhs_brief_packs_category_id", "xhs_brief_packs", ["category_id"])
    op.create_index("ix_xhs_brief_packs_status", "xhs_brief_packs", ["status"])

    op.create_table(
        "xhs_risk_packs",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("tenant_id", sa.String(length=64), nullable=False),
        sa.Column("category_id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("version", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
        sa.Column("pack_json", _json_type(), nullable=False),
        sa.Column("created_by", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "category_id", "version", name="uq_xhs_risk_pack_version"),
    )
    op.create_index("ix_xhs_risk_packs_tenant_id", "xhs_risk_packs", ["tenant_id"])
    op.create_index("ix_xhs_risk_packs_category_id", "xhs_risk_packs", ["category_id"])
    op.create_index("ix_xhs_risk_packs_status", "xhs_risk_packs", ["status"])

    op.create_table(
        "xhs_batch_jobs",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("tenant_id", sa.String(length=64), nullable=False),
        sa.Column("created_by", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("category_id", sa.String(length=64), nullable=False),
        sa.Column("rule_pack_version", sa.String(length=64), nullable=True),
        sa.Column("risk_pack_version", sa.String(length=64), nullable=True),
        sa.Column("brand_pack_version", sa.String(length=64), nullable=True),
        sa.Column("brief_pack_id", sa.String(length=64), nullable=True),
        sa.Column("style_template_id", sa.String(length=64), nullable=True),
        sa.Column("run_mode", sa.String(length=20), nullable=False, server_default="trial"),
        sa.Column("trial_sample_count", sa.Integer(), nullable=True),
        sa.Column("input_type", sa.String(length=32), nullable=False),
        sa.Column("input_stats_json", _json_type(), nullable=True),
        sa.Column("tag_policy_json", _json_type(), nullable=True),
        sa.Column("export_options_json", _json_type(), nullable=True),
        sa.Column("estimated_tokens", sa.Integer(), nullable=True),
        sa.Column("estimated_cost", sa.Numeric(12, 4), nullable=True),
        sa.Column("actual_tokens", sa.Integer(), nullable=True),
        sa.Column("actual_cost", sa.Numeric(12, 4), nullable=True),
        sa.Column("system_blocked", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("system_block_reason", sa.Text(), nullable=True),
        sa.Column("total_items", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("done_items", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("running_items", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("export_all_md_status", sa.String(length=32), nullable=True),
        sa.Column("export_all_md_url", sa.String(length=2048), nullable=True),
        sa.Column("export_feishu_status", sa.String(length=32), nullable=True),
        sa.Column("export_feishu_doc_title", sa.String(length=255), nullable=True),
        sa.Column("export_feishu_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_xhs_batch_jobs_tenant_id", "xhs_batch_jobs", ["tenant_id"])
    op.create_index("ix_xhs_batch_jobs_status", "xhs_batch_jobs", ["status"])
    op.create_index("ix_xhs_batch_jobs_category_id", "xhs_batch_jobs", ["category_id"])
    op.create_index("ix_xhs_batch_jobs_created_by", "xhs_batch_jobs", ["created_by"])

    op.create_table(
        "xhs_batch_items",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("batch_id", sa.String(length=64), nullable=False),
        sa.Column("item_id", sa.String(length=64), nullable=False),
        sa.Column("source_text", sa.Text(), nullable=False),
        sa.Column("source_title_guess", sa.String(length=255), nullable=True),
        sa.Column("split_by", sa.String(length=32), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("round", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("editor_output_json", _json_type(), nullable=True),
        sa.Column("verifier_json", _json_type(), nullable=True),
        sa.Column("verifier_pass", sa.Boolean(), nullable=True),
        sa.Column("verifier_confidence", sa.Numeric(5, 4), nullable=True),
        sa.Column("rewrite_fail_reasons_json", _json_type(), nullable=True),
        sa.Column("safe_rewrite_used", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("safe_rewrite_reason", sa.Text(), nullable=True),
        sa.Column("final_title", sa.String(length=255), nullable=True),
        sa.Column("final_body", sa.Text(), nullable=True),
        sa.Column("final_hashtags_json", _json_type(), nullable=True),
        sa.Column("copy_ready_text", sa.Text(), nullable=True),
        sa.Column("quality_score", sa.Numeric(5, 2), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("model_meta_json", _json_type(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["batch_id"], ["xhs_batch_jobs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("batch_id", "item_id", name="uq_xhs_batch_item_item_id"),
    )
    op.create_index("ix_xhs_batch_items_batch_id", "xhs_batch_items", ["batch_id"])
    op.create_index("ix_xhs_batch_items_status", "xhs_batch_items", ["status"])

    op.create_table(
        "xhs_export_logs",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("batch_id", sa.String(length=64), nullable=False),
        sa.Column("type", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("request_json", _json_type(), nullable=True),
        sa.Column("response_json", _json_type(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["batch_id"], ["xhs_batch_jobs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_xhs_export_logs_batch_id", "xhs_export_logs", ["batch_id"])


def downgrade() -> None:
    op.drop_index("ix_xhs_export_logs_batch_id", table_name="xhs_export_logs")
    op.drop_table("xhs_export_logs")

    op.drop_index("ix_xhs_batch_items_status", table_name="xhs_batch_items")
    op.drop_index("ix_xhs_batch_items_batch_id", table_name="xhs_batch_items")
    op.drop_table("xhs_batch_items")

    op.drop_index("ix_xhs_batch_jobs_created_by", table_name="xhs_batch_jobs")
    op.drop_index("ix_xhs_batch_jobs_category_id", table_name="xhs_batch_jobs")
    op.drop_index("ix_xhs_batch_jobs_status", table_name="xhs_batch_jobs")
    op.drop_index("ix_xhs_batch_jobs_tenant_id", table_name="xhs_batch_jobs")
    op.drop_table("xhs_batch_jobs")

    op.drop_index("ix_xhs_risk_packs_status", table_name="xhs_risk_packs")
    op.drop_index("ix_xhs_risk_packs_category_id", table_name="xhs_risk_packs")
    op.drop_index("ix_xhs_risk_packs_tenant_id", table_name="xhs_risk_packs")
    op.drop_table("xhs_risk_packs")

    op.drop_index("ix_xhs_brief_packs_status", table_name="xhs_brief_packs")
    op.drop_index("ix_xhs_brief_packs_category_id", table_name="xhs_brief_packs")
    op.drop_index("ix_xhs_brief_packs_tenant_id", table_name="xhs_brief_packs")
    op.drop_table("xhs_brief_packs")

    op.drop_index("ix_xhs_brand_packs_status", table_name="xhs_brand_packs")
    op.drop_index("ix_xhs_brand_packs_category_id", table_name="xhs_brand_packs")
    op.drop_index("ix_xhs_brand_packs_tenant_id", table_name="xhs_brand_packs")
    op.drop_table("xhs_brand_packs")
