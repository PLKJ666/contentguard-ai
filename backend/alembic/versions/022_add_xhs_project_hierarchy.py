"""add xhs project hierarchy

Revision ID: 022_xhs_project_hierarchy
Revises: 021_task_corrected_script_files
Create Date: 2026-03-24 22:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "022_xhs_project_hierarchy"
down_revision: Union[str, None] = "021_task_corrected_script_files"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _json_type() -> sa.JSON:
    return sa.JSON().with_variant(sa.dialects.postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "xhs_projects",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("tenant_id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("category_id", sa.String(length=64), nullable=False),
        sa.Column("client_name", sa.String(length=255), nullable=True),
        sa.Column("product_name", sa.String(length=255), nullable=True),
        sa.Column("project_brief", sa.Text(), nullable=True),
        sa.Column("shared_requirements", sa.Text(), nullable=True),
        sa.Column("remark", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
        sa.Column("created_by", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_xhs_projects_tenant_id", "xhs_projects", ["tenant_id"])
    op.create_index("ix_xhs_projects_category_id", "xhs_projects", ["category_id"])
    op.create_index("ix_xhs_projects_status", "xhs_projects", ["status"])

    op.create_table(
        "xhs_project_variants",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("tenant_id", sa.String(length=64), nullable=False),
        sa.Column("project_id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("selling_points", sa.Text(), nullable=True),
        sa.Column("appearance_notes", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_by", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["xhs_projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", "name", name="uq_xhs_project_variant_name"),
    )
    op.create_index("ix_xhs_project_variants_tenant_id", "xhs_project_variants", ["tenant_id"])
    op.create_index("ix_xhs_project_variants_project_id", "xhs_project_variants", ["project_id"])

    op.create_table(
        "xhs_direction_items",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("tenant_id", sa.String(length=64), nullable=False),
        sa.Column("project_id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
        sa.Column("main_variant_id", sa.String(length=64), nullable=True),
        sa.Column("secondary_variant_ids_json", _json_type(), nullable=True),
        sa.Column("content_style", sa.String(length=64), nullable=True),
        sa.Column("direction_brief", sa.Text(), nullable=True),
        sa.Column("extra_requirements", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_by", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["xhs_projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["main_variant_id"], ["xhs_project_variants.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", "name", name="uq_xhs_direction_item_name"),
    )
    op.create_index("ix_xhs_direction_items_tenant_id", "xhs_direction_items", ["tenant_id"])
    op.create_index("ix_xhs_direction_items_project_id", "xhs_direction_items", ["project_id"])
    op.create_index("ix_xhs_direction_items_status", "xhs_direction_items", ["status"])
    op.create_index("ix_xhs_direction_items_main_variant_id", "xhs_direction_items", ["main_variant_id"])

    op.add_column("xhs_batch_jobs", sa.Column("direction_id", sa.String(length=64), nullable=True))
    op.create_foreign_key(
        "fk_xhs_batch_jobs_direction_id_xhs_direction_items",
        "xhs_batch_jobs",
        "xhs_direction_items",
        ["direction_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_xhs_batch_jobs_direction_id", "xhs_batch_jobs", ["direction_id"])


def downgrade() -> None:
    op.drop_index("ix_xhs_batch_jobs_direction_id", table_name="xhs_batch_jobs")
    op.drop_constraint("fk_xhs_batch_jobs_direction_id_xhs_direction_items", "xhs_batch_jobs", type_="foreignkey")
    op.drop_column("xhs_batch_jobs", "direction_id")

    op.drop_index("ix_xhs_direction_items_main_variant_id", table_name="xhs_direction_items")
    op.drop_index("ix_xhs_direction_items_status", table_name="xhs_direction_items")
    op.drop_index("ix_xhs_direction_items_project_id", table_name="xhs_direction_items")
    op.drop_index("ix_xhs_direction_items_tenant_id", table_name="xhs_direction_items")
    op.drop_table("xhs_direction_items")

    op.drop_index("ix_xhs_project_variants_project_id", table_name="xhs_project_variants")
    op.drop_index("ix_xhs_project_variants_tenant_id", table_name="xhs_project_variants")
    op.drop_table("xhs_project_variants")

    op.drop_index("ix_xhs_projects_status", table_name="xhs_projects")
    op.drop_index("ix_xhs_projects_category_id", table_name="xhs_projects")
    op.drop_index("ix_xhs_projects_tenant_id", table_name="xhs_projects")
    op.drop_table("xhs_projects")
