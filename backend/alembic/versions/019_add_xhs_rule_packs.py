"""add xhs rule packs

Revision ID: 019_xhs_rule_pack_p1
Revises: 018_xhs_batch_p0
Create Date: 2026-03-24 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "019_xhs_rule_pack_p1"
down_revision: Union[str, None] = "018_xhs_batch_p0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _json_type() -> sa.JSON:
    return sa.JSON().with_variant(sa.dialects.postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "xhs_rule_packs",
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
        sa.UniqueConstraint("tenant_id", "category_id", "version", name="uq_xhs_rule_pack_version"),
    )
    op.create_index("ix_xhs_rule_packs_tenant_id", "xhs_rule_packs", ["tenant_id"])
    op.create_index("ix_xhs_rule_packs_category_id", "xhs_rule_packs", ["category_id"])
    op.create_index("ix_xhs_rule_packs_status", "xhs_rule_packs", ["status"])


def downgrade() -> None:
    op.drop_index("ix_xhs_rule_packs_status", table_name="xhs_rule_packs")
    op.drop_index("ix_xhs_rule_packs_category_id", table_name="xhs_rule_packs")
    op.drop_index("ix_xhs_rule_packs_tenant_id", table_name="xhs_rule_packs")
    op.drop_table("xhs_rule_packs")
