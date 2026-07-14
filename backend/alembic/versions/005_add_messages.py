"""添加消息表

Revision ID: 005
Revises: 004
Create Date: 2026-02-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '005'
down_revision: Union[str, None] = '004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'messages',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('user_id', sa.String(64), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('type', sa.String(50), nullable=False),
        sa.Column('title', sa.String(255), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('is_read', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('related_task_id', sa.String(64), nullable=True),
        sa.Column('related_project_id', sa.String(64), nullable=True),
        sa.Column('sender_name', sa.String(100), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('idx_messages_user_id', 'messages', ['user_id'])
    op.create_index('idx_messages_user_read', 'messages', ['user_id', 'is_read'])


def downgrade() -> None:
    op.drop_index('idx_messages_user_read', table_name='messages')
    op.drop_index('idx_messages_user_id', table_name='messages')
    op.drop_table('messages')
