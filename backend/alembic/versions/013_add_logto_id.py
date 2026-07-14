"""添加 Logto 认证字段

Revision ID: 013
Revises: 012
Create Date: 2026-02-26

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '013'
down_revision: Union[str, None] = '012'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('logto_id', sa.String(255), nullable=True))
    op.create_unique_constraint('uq_users_logto_id', 'users', ['logto_id'])
    op.create_index('ix_users_logto_id', 'users', ['logto_id'])
    op.alter_column('users', 'password_hash', existing_type=sa.String(255), nullable=True)


def downgrade() -> None:
    op.alter_column('users', 'password_hash', existing_type=sa.String(255), nullable=False)
    op.drop_index('ix_users_logto_id', table_name='users')
    op.drop_constraint('uq_users_logto_id', 'users', type_='unique')
    op.drop_column('users', 'logto_id')
