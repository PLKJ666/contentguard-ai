"""add min_selling_points to briefs

Revision ID: 261778c01ef8
Revises: 008
Create Date: 2026-02-11 18:16:59.557746

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '261778c01ef8'
down_revision: Union[str, None] = '008'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('briefs', sa.Column('min_selling_points', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('briefs', 'min_selling_points')
