"""add tenant scope to brand learned rules

Revision ID: 029_learning_scope
Revises: 028_merge_operator_auth_heads
Create Date: 2026-04-17 15:10:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "029_learning_scope"
down_revision: Union[str, Sequence[str], None] = "028_merge_operator_auth_heads"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "brand_learned_rules",
        sa.Column("tenant_id", sa.String(length=64), nullable=True),
    )
    op.create_index(
        "ix_brand_learned_rules_tenant_id",
        "brand_learned_rules",
        ["tenant_id"],
        unique=False,
    )

    op.execute(
        """
        INSERT INTO tenants (id, name, is_active, created_at, updated_at)
        SELECT b.id, COALESCE(NULLIF(b.name, ''), '租户-' || b.id), TRUE, NOW(), NOW()
        FROM brands b
        LEFT JOIN tenants t ON t.id = b.id
        WHERE t.id IS NULL
        """
    )
    op.execute(
        """
        UPDATE brand_learned_rules
        SET tenant_id = brand_id
        WHERE tenant_id IS NULL
        """
    )

    op.alter_column("brand_learned_rules", "tenant_id", nullable=False)
    op.create_foreign_key(
        "fk_brand_learned_rules_tenant_id_tenants",
        "brand_learned_rules",
        "tenants",
        ["tenant_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.alter_column("brand_learned_rules", "brand_id", nullable=True)


def downgrade() -> None:
    op.execute("DELETE FROM brand_learned_rules WHERE brand_id IS NULL")
    op.alter_column("brand_learned_rules", "brand_id", nullable=False)
    op.drop_constraint(
        "fk_brand_learned_rules_tenant_id_tenants",
        "brand_learned_rules",
        type_="foreignkey",
    )
    op.drop_index("ix_brand_learned_rules_tenant_id", table_name="brand_learned_rules")
    op.drop_column("brand_learned_rules", "tenant_id")
