"""add creative_rubric and brand_learned_rules

Revision ID: 009
Revises: 261778c01ef8
Create Date: 2026-02-11
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision = '009'
down_revision = '261778c01ef8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Brief 表新增 creative_rubric JSON 字段
    op.add_column('briefs', sa.Column('creative_rubric', JSONB(), nullable=True))

    # 新建品牌学习规则表
    op.create_table(
        'brand_learned_rules',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('brand_id', sa.String(64), sa.ForeignKey('brands.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('type', sa.String(64), nullable=False),
        sa.Column('pattern', sa.Text(), nullable=False),
        sa.Column('reason', sa.Text(), nullable=False),
        sa.Column('source_task', sa.String(64), nullable=True),
        sa.Column('created_by', sa.String(32), nullable=False, server_default='ai_learning'),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('brand_learned_rules')
    op.drop_column('briefs', 'creative_rubric')
