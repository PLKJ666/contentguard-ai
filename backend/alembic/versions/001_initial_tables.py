"""初始表结构

Revision ID: 001
Revises:
Create Date: 2024-01-15

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '001'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 创建枚举类型
    platform_enum = postgresql.ENUM(
        'douyin', 'xiaohongshu', 'bilibili', 'kuaishou',
        name='platform_enum',
        create_type=False,
    )
    platform_enum.create(op.get_bind(), checkfirst=True)

    task_status_enum = postgresql.ENUM(
        'pending', 'processing', 'completed', 'failed', 'approved', 'rejected',
        name='task_status_enum',
        create_type=False,
    )
    task_status_enum.create(op.get_bind(), checkfirst=True)

    # 租户表
    op.create_table(
        'tenants',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, default=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )

    # AI 配置表
    op.create_table(
        'ai_configs',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('tenant_id', sa.String(64), sa.ForeignKey('tenants.id', ondelete='CASCADE'), unique=True, nullable=False),
        sa.Column('provider', sa.String(50), nullable=False),
        sa.Column('base_url', sa.String(500), nullable=False),
        sa.Column('api_key_encrypted', sa.Text(), nullable=False),
        sa.Column('models', postgresql.JSONB(), nullable=False),
        sa.Column('temperature', sa.Float(), nullable=False, default=0.7),
        sa.Column('max_tokens', sa.Integer(), nullable=False, default=2000),
        sa.Column('available_models', postgresql.JSONB(), nullable=True),
        sa.Column('last_test_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_test_result', postgresql.JSONB(), nullable=True),
        sa.Column('is_configured', sa.Boolean(), nullable=False, default=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    op.create_index('ix_ai_configs_tenant_id', 'ai_configs', ['tenant_id'])

    # 审核任务表
    op.create_table(
        'review_tasks',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('tenant_id', sa.String(64), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('video_url', sa.String(2048), nullable=False),
        sa.Column('platform', platform_enum, nullable=False),
        sa.Column('brand_id', sa.String(64), nullable=False),
        sa.Column('creator_id', sa.String(64), nullable=False),
        sa.Column('status', task_status_enum, nullable=False, default='pending'),
        sa.Column('progress', sa.Integer(), nullable=False, default=0),
        sa.Column('current_step', sa.String(100), nullable=False, default='等待处理'),
        sa.Column('score', sa.Integer(), nullable=True),
        sa.Column('summary', sa.Text(), nullable=True),
        sa.Column('violations', postgresql.JSONB(), nullable=True),
        sa.Column('soft_warnings', postgresql.JSONB(), nullable=True),
        sa.Column('requirements', postgresql.JSONB(), nullable=True),
        sa.Column('competitors', postgresql.JSONB(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    op.create_index('ix_review_tasks_tenant_id', 'review_tasks', ['tenant_id'])
    op.create_index('ix_review_tasks_brand_id', 'review_tasks', ['brand_id'])
    op.create_index('ix_review_tasks_creator_id', 'review_tasks', ['creator_id'])
    op.create_index('ix_review_tasks_status', 'review_tasks', ['status'])

    # 违禁词表
    op.create_table(
        'forbidden_words',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('tenant_id', sa.String(64), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('word', sa.String(255), nullable=False),
        sa.Column('category', sa.String(100), nullable=False),
        sa.Column('severity', sa.String(50), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    op.create_index('ix_forbidden_words_tenant_id', 'forbidden_words', ['tenant_id'])
    op.create_index('ix_forbidden_words_word', 'forbidden_words', ['word'])
    op.create_index('ix_forbidden_words_category', 'forbidden_words', ['category'])

    # 白名单表
    op.create_table(
        'whitelist_items',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('tenant_id', sa.String(64), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('brand_id', sa.String(64), nullable=False),
        sa.Column('term', sa.String(255), nullable=False),
        sa.Column('reason', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    op.create_index('ix_whitelist_items_tenant_id', 'whitelist_items', ['tenant_id'])
    op.create_index('ix_whitelist_items_brand_id', 'whitelist_items', ['brand_id'])
    op.create_index('ix_whitelist_items_term', 'whitelist_items', ['term'])

    # 竞品表
    op.create_table(
        'competitors',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('tenant_id', sa.String(64), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('brand_id', sa.String(64), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('logo_url', sa.String(2048), nullable=True),
        sa.Column('keywords', postgresql.JSONB(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    op.create_index('ix_competitors_tenant_id', 'competitors', ['tenant_id'])
    op.create_index('ix_competitors_brand_id', 'competitors', ['brand_id'])



def downgrade() -> None:
    # 删除表
    op.drop_table('competitors')
    op.drop_table('whitelist_items')
    op.drop_table('forbidden_words')
    op.drop_table('review_tasks')
    op.drop_table('ai_configs')
    op.drop_table('tenants')

    # 删除枚举类型
    op.execute('DROP TYPE IF EXISTS task_status_enum')
    op.execute('DROP TYPE IF EXISTS platform_enum')
