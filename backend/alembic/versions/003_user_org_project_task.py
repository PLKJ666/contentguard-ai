"""添加用户、组织、项目、任务表

Revision ID: 003
Revises: 002
Create Date: 2026-02-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '003'
down_revision: Union[str, None] = '002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 创建枚举类型
    user_role_enum = postgresql.ENUM(
        'brand', 'agency', 'creator',
        name='user_role_enum',
        create_type=False,
    )
    user_role_enum.create(op.get_bind(), checkfirst=True)

    task_stage_enum = postgresql.ENUM(
        'script_upload', 'script_ai_review', 'script_agency_review', 'script_brand_review',
        'video_upload', 'video_ai_review', 'video_agency_review', 'video_brand_review',
        'completed', 'rejected',
        name='task_stage_enum',
        create_type=False,
    )
    task_stage_enum.create(op.get_bind(), checkfirst=True)

    # 扩展 task_status_enum：添加 Task 模型需要的值
    op.execute("ALTER TYPE task_status_enum ADD VALUE IF NOT EXISTS 'passed'")
    op.execute("ALTER TYPE task_status_enum ADD VALUE IF NOT EXISTS 'force_passed'")

    # 用户表
    op.create_table(
        'users',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('email', sa.String(255), unique=True, nullable=True, index=True),
        sa.Column('phone', sa.String(20), unique=True, nullable=True, index=True),
        sa.Column('password_hash', sa.String(255), nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('avatar', sa.String(2048), nullable=True),
        sa.Column('role', postgresql.ENUM('brand', 'agency', 'creator', name='user_role_enum', create_type=False), nullable=False, index=True),
        sa.Column('is_active', sa.Boolean(), default=True, nullable=False),
        sa.Column('is_verified', sa.Boolean(), default=False, nullable=False),
        sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('refresh_token', sa.String(512), nullable=True),
        sa.Column('refresh_token_expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )

    # 品牌方表
    op.create_table(
        'brands',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('user_id', sa.String(64), sa.ForeignKey('users.id', ondelete='CASCADE'), unique=True, nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('logo', sa.String(2048), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('contact_name', sa.String(100), nullable=True),
        sa.Column('contact_phone', sa.String(20), nullable=True),
        sa.Column('contact_email', sa.String(255), nullable=True),
        sa.Column('final_review_enabled', sa.Boolean(), default=True, nullable=False),
        sa.Column('is_active', sa.Boolean(), default=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )

    # 代理商表
    op.create_table(
        'agencies',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('user_id', sa.String(64), sa.ForeignKey('users.id', ondelete='CASCADE'), unique=True, nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('logo', sa.String(2048), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('contact_name', sa.String(100), nullable=True),
        sa.Column('contact_phone', sa.String(20), nullable=True),
        sa.Column('contact_email', sa.String(255), nullable=True),
        sa.Column('force_pass_enabled', sa.Boolean(), default=True, nullable=False),
        sa.Column('is_active', sa.Boolean(), default=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )

    # 达人表
    op.create_table(
        'creators',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('user_id', sa.String(64), sa.ForeignKey('users.id', ondelete='CASCADE'), unique=True, nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('avatar', sa.String(2048), nullable=True),
        sa.Column('bio', sa.Text(), nullable=True),
        sa.Column('douyin_account', sa.String(100), nullable=True),
        sa.Column('xiaohongshu_account', sa.String(100), nullable=True),
        sa.Column('bilibili_account', sa.String(100), nullable=True),
        sa.Column('is_active', sa.Boolean(), default=True, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )

    # 品牌方-代理商关联表
    op.create_table(
        'brand_agency',
        sa.Column('brand_id', sa.String(64), sa.ForeignKey('brands.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('agency_id', sa.String(64), sa.ForeignKey('agencies.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('is_active', sa.Boolean(), default=True),
    )

    # 代理商-达人关联表
    op.create_table(
        'agency_creator',
        sa.Column('agency_id', sa.String(64), sa.ForeignKey('agencies.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('creator_id', sa.String(64), sa.ForeignKey('creators.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('is_active', sa.Boolean(), default=True),
    )

    # 项目表
    op.create_table(
        'projects',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('brand_id', sa.String(64), sa.ForeignKey('brands.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('start_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('deadline', sa.DateTime(timezone=True), nullable=True),
        sa.Column('status', sa.String(20), default='active', nullable=False, index=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )

    # 项目-代理商关联表
    op.create_table(
        'project_agency',
        sa.Column('project_id', sa.String(64), sa.ForeignKey('projects.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('agency_id', sa.String(64), sa.ForeignKey('agencies.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('is_active', sa.Boolean(), default=True),
    )

    # Brief 表
    op.create_table(
        'briefs',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('project_id', sa.String(64), sa.ForeignKey('projects.id', ondelete='CASCADE'), unique=True, nullable=False, index=True),
        sa.Column('file_url', sa.String(2048), nullable=True),
        sa.Column('file_name', sa.String(255), nullable=True),
        sa.Column('selling_points', postgresql.JSON(), nullable=True),
        sa.Column('blacklist_words', postgresql.JSON(), nullable=True),
        sa.Column('competitors', postgresql.JSON(), nullable=True),
        sa.Column('brand_tone', sa.Text(), nullable=True),
        sa.Column('min_duration', sa.Integer(), nullable=True),
        sa.Column('max_duration', sa.Integer(), nullable=True),
        sa.Column('other_requirements', sa.Text(), nullable=True),
        sa.Column('attachments', postgresql.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )

    # 任务表
    op.create_table(
        'tasks',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('project_id', sa.String(64), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('agency_id', sa.String(64), sa.ForeignKey('agencies.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('creator_id', sa.String(64), sa.ForeignKey('creators.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('sequence', sa.Integer(), default=1, nullable=False),
        sa.Column('stage', postgresql.ENUM(
            'script_upload', 'script_ai_review', 'script_agency_review', 'script_brand_review',
            'video_upload', 'video_ai_review', 'video_agency_review', 'video_brand_review',
            'completed', 'rejected',
            name='task_stage_enum', create_type=False
        ), default='script_upload', nullable=False, index=True),

        # 脚本相关
        sa.Column('script_file_url', sa.String(2048), nullable=True),
        sa.Column('script_file_name', sa.String(255), nullable=True),
        sa.Column('script_uploaded_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('script_ai_score', sa.Integer(), nullable=True),
        sa.Column('script_ai_result', postgresql.JSON(), nullable=True),
        sa.Column('script_ai_reviewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('script_agency_status', postgresql.ENUM('pending', 'processing', 'passed', 'rejected', 'force_passed', name='task_status_enum', create_type=False), nullable=True),
        sa.Column('script_agency_comment', sa.Text(), nullable=True),
        sa.Column('script_agency_reviewer_id', sa.String(64), nullable=True),
        sa.Column('script_agency_reviewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('script_brand_status', postgresql.ENUM('pending', 'processing', 'passed', 'rejected', 'force_passed', name='task_status_enum', create_type=False), nullable=True),
        sa.Column('script_brand_comment', sa.Text(), nullable=True),
        sa.Column('script_brand_reviewer_id', sa.String(64), nullable=True),
        sa.Column('script_brand_reviewed_at', sa.DateTime(timezone=True), nullable=True),

        # 视频相关
        sa.Column('video_file_url', sa.String(2048), nullable=True),
        sa.Column('video_file_name', sa.String(255), nullable=True),
        sa.Column('video_duration', sa.Integer(), nullable=True),
        sa.Column('video_thumbnail_url', sa.String(2048), nullable=True),
        sa.Column('video_uploaded_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('video_ai_score', sa.Integer(), nullable=True),
        sa.Column('video_ai_result', postgresql.JSON(), nullable=True),
        sa.Column('video_ai_reviewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('video_agency_status', postgresql.ENUM('pending', 'processing', 'passed', 'rejected', 'force_passed', name='task_status_enum', create_type=False), nullable=True),
        sa.Column('video_agency_comment', sa.Text(), nullable=True),
        sa.Column('video_agency_reviewer_id', sa.String(64), nullable=True),
        sa.Column('video_agency_reviewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('video_brand_status', postgresql.ENUM('pending', 'processing', 'passed', 'rejected', 'force_passed', name='task_status_enum', create_type=False), nullable=True),
        sa.Column('video_brand_comment', sa.Text(), nullable=True),
        sa.Column('video_brand_reviewer_id', sa.String(64), nullable=True),
        sa.Column('video_brand_reviewed_at', sa.DateTime(timezone=True), nullable=True),

        # 申诉相关
        sa.Column('appeal_count', sa.Integer(), default=1, nullable=False),
        sa.Column('is_appeal', sa.Boolean(), default=False, nullable=False),
        sa.Column('appeal_reason', sa.Text(), nullable=True),

        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('tasks')
    op.drop_table('briefs')
    op.drop_table('project_agency')
    op.drop_table('projects')
    op.drop_table('agency_creator')
    op.drop_table('brand_agency')
    op.drop_table('creators')
    op.drop_table('agencies')
    op.drop_table('brands')
    op.drop_table('users')

    # 删除枚举类型
    op.execute("DROP TYPE IF EXISTS task_stage_enum")
    op.execute("DROP TYPE IF EXISTS user_role_enum")
