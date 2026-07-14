"""添加脚本粘贴文字字段

Revision ID: 014
Revises: 013
Create Date: 2026-02-27

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '014'
down_revision: Union[str, None] = '013'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tasks', sa.Column('script_text_content', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('tasks', 'script_text_content')
