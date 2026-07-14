"""add brand exposure to review tasks

Revision ID: 023_review_task_brand_exposure
Revises: 022_xhs_project_hierarchy
Create Date: 2026-03-24 23:55:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "023_review_task_brand_exposure"
down_revision: Union[str, None] = "022_xhs_project_hierarchy"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _json_type() -> sa.JSON:
    return sa.JSON().with_variant(sa.dialects.postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.add_column("review_tasks", sa.Column("brand_exposure", _json_type(), nullable=True))


def downgrade() -> None:
    op.drop_column("review_tasks", "brand_exposure")
