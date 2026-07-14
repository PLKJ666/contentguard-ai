"""添加代理商修正脚本字段

Revision ID: 015
Revises: 014
Create Date: 2026-03-05

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '015'
down_revision: Union[str, None] = '014'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tasks', sa.Column('script_agency_corrected', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('tasks', 'script_agency_corrected')
