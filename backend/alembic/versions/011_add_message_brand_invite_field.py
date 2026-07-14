"""添加消息品牌方邀请相关字段

Revision ID: 011
Revises: 010
Create Date: 2026-02-25

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '011'
down_revision: Union[str, None] = '010'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('messages', sa.Column('related_brand_id', sa.String(64), nullable=True))


def downgrade() -> None:
    op.drop_column('messages', 'related_brand_id')
