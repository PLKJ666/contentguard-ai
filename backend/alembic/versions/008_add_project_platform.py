"""添加项目发布平台字段

Revision ID: 008
Revises: 007
Create Date: 2026-02-10

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '008'
down_revision: Union[str, None] = '007'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('projects', sa.Column('platform', sa.String(50), nullable=True))


def downgrade() -> None:
    op.drop_column('projects', 'platform')
