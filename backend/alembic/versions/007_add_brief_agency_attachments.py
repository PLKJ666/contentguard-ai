"""添加 Brief 代理商附件字段

Revision ID: 007
Revises: 006
Create Date: 2026-02-10

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '007'
down_revision: Union[str, None] = '006'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('briefs', sa.Column('agency_attachments', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('briefs', 'agency_attachments')
