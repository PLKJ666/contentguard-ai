"""添加企业资料与通知设置表

注意：该迁移最初误用了重复的 Revision ID 011，已调整为 017 以避免 Alembic 多头版本导致启动失败。

Revision ID: 017
Revises: 016
Create Date: 2026-03-13

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "017"
down_revision: Union[str, None] = "016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "agency_company_profiles",
        sa.Column("agency_id", sa.String(length=64), primary_key=True, nullable=False),
        sa.Column("company_name", sa.String(length=255), nullable=True),
        sa.Column("short_name", sa.String(length=255), nullable=True),
        sa.Column("business_license", sa.String(length=128), nullable=True),
        sa.Column("legal_person", sa.String(length=100), nullable=True),
        sa.Column("registered_capital", sa.String(length=100), nullable=True),
        sa.Column("establish_date", sa.Date(), nullable=True),
        sa.Column("business_scope", sa.Text(), nullable=True),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=True),
        sa.Column("verify_status", sa.String(length=20), nullable=False, server_default="unverified"),
        sa.Column("bank_name", sa.String(length=255), nullable=True),
        sa.Column("bank_account_last4", sa.String(length=4), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["agency_id"], ["agencies.id"], ondelete="CASCADE"),
    )

    op.create_table(
        "notification_settings",
        sa.Column("id", sa.String(length=64), primary_key=True, nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("settings", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("user_id", name="uq_notification_settings_user_id"),
    )
    op.create_index("ix_notification_settings_user_id", "notification_settings", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_notification_settings_user_id", table_name="notification_settings")
    op.drop_table("notification_settings")
    op.drop_table("agency_company_profiles")
