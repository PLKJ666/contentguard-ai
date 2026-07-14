"""Add manual task script/video upload fields

Revision ID: 002
Revises: 001
Create Date: 2026-02-04
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 原 manual_tasks 表已废弃，字段已合并到 003 的 tasks 表中
    pass


def downgrade() -> None:
    pass
