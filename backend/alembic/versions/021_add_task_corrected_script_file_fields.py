"""add task corrected script file fields

Revision ID: 021_task_corrected_script_files
Revises: 020_merge_main_and_xhs_heads
Create Date: 2026-03-24 19:40:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "021_task_corrected_script_files"
down_revision: Union[str, None] = "020_merge_main_and_xhs_heads"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("script_agency_corrected_file_url", sa.String(length=2048), nullable=True))
    op.add_column("tasks", sa.Column("script_agency_corrected_file_name", sa.String(length=255), nullable=True))
    op.add_column("tasks", sa.Column("script_agency_corrected_file_type", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("tasks", "script_agency_corrected_file_type")
    op.drop_column("tasks", "script_agency_corrected_file_name")
    op.drop_column("tasks", "script_agency_corrected_file_url")
