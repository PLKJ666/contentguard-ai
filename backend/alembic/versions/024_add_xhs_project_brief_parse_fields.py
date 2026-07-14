"""add xhs project brief parse fields

Revision ID: 024_xhs_project_brief_parse
Revises: 022_xhs_project_hierarchy
Create Date: 2026-03-24 23:59:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "024_xhs_project_brief_parse"
down_revision: Union[str, None] = "022_xhs_project_hierarchy"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _json_type() -> sa.JSON:
    return sa.JSON().with_variant(sa.dialects.postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.add_column("xhs_projects", sa.Column("brief_file_ref", sa.String(length=2048), nullable=True))
    op.add_column("xhs_projects", sa.Column("brief_file_name", sa.String(length=255), nullable=True))
    op.add_column("xhs_projects", sa.Column("brief_parse_result_json", _json_type(), nullable=True))


def downgrade() -> None:
    op.drop_column("xhs_projects", "brief_parse_result_json")
    op.drop_column("xhs_projects", "brief_file_name")
    op.drop_column("xhs_projects", "brief_file_ref")
