"""add operator role and operator workspace

Revision ID: 027_operator_workspace
Revises: 261778c01ef8
Create Date: 2026-04-16 18:30:00.000000
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "027_operator_workspace"
down_revision = "261778c01ef8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "alembic_version",
        "version_num",
        existing_type=sa.String(length=32),
        type_=sa.String(length=64),
        existing_nullable=False,
    )
    op.execute("ALTER TYPE user_role_enum ADD VALUE IF NOT EXISTS 'operator'")

    op.create_table(
        "operators",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("agency_id", sa.String(length=64), nullable=False),
        sa.Column("workspace_id", sa.String(length=64), nullable=False),
        sa.Column("display_name", sa.String(length=100), nullable=False),
        sa.Column("permissions", sa.JSON(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_by", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["agency_id"], ["agencies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
        sa.UniqueConstraint("workspace_id"),
    )
    op.create_index("ix_operators_user_id", "operators", ["user_id"], unique=False)
    op.create_index("ix_operators_agency_id", "operators", ["agency_id"], unique=False)
    op.create_index("ix_operators_workspace_id", "operators", ["workspace_id"], unique=False)

    op.create_table(
        "operator_invites",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("agency_id", sa.String(length=64), nullable=False),
        sa.Column("workspace_id", sa.String(length=64), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=100), nullable=False),
        sa.Column("permissions", sa.JSON(), nullable=False),
        sa.Column("invite_token", sa.String(length=128), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.String(length=64), nullable=True),
        sa.Column("accepted_by_user_id", sa.String(length=64), nullable=True),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["agency_id"], ["agencies.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id"),
        sa.UniqueConstraint("invite_token"),
    )
    op.create_index("ix_operator_invites_agency_id", "operator_invites", ["agency_id"], unique=False)
    op.create_index("ix_operator_invites_workspace_id", "operator_invites", ["workspace_id"], unique=False)
    op.create_index("ix_operator_invites_email", "operator_invites", ["email"], unique=False)
    op.create_index("ix_operator_invites_invite_token", "operator_invites", ["invite_token"], unique=False)
    op.create_index("ix_operator_invites_status", "operator_invites", ["status"], unique=False)

    op.add_column("projects", sa.Column("config_scope_id", sa.String(length=64), nullable=True))
    op.add_column("projects", sa.Column("client_display_name", sa.String(length=255), nullable=True))
    op.add_column("projects", sa.Column("brand_display_name", sa.String(length=255), nullable=True))
    op.add_column("projects", sa.Column("project_remark", sa.Text(), nullable=True))
    op.create_index("ix_projects_config_scope_id", "projects", ["config_scope_id"], unique=False)
    op.execute("UPDATE projects SET config_scope_id = brand_id WHERE config_scope_id IS NULL")
    op.alter_column("projects", "brand_id", existing_type=sa.String(length=64), nullable=True)

    op.add_column("tasks", sa.Column("creator_display_name", sa.String(length=255), nullable=True))
    op.add_column("tasks", sa.Column("creator_platform", sa.String(length=50), nullable=True))
    op.add_column("tasks", sa.Column("creator_remark", sa.Text(), nullable=True))
    op.alter_column("tasks", "creator_id", existing_type=sa.String(length=64), nullable=True)


def downgrade() -> None:
    op.alter_column("tasks", "creator_id", existing_type=sa.String(length=64), nullable=False)
    op.drop_column("tasks", "creator_remark")
    op.drop_column("tasks", "creator_platform")
    op.drop_column("tasks", "creator_display_name")

    op.alter_column("projects", "brand_id", existing_type=sa.String(length=64), nullable=False)
    op.drop_index("ix_projects_config_scope_id", table_name="projects")
    op.drop_column("projects", "project_remark")
    op.drop_column("projects", "brand_display_name")
    op.drop_column("projects", "client_display_name")
    op.drop_column("projects", "config_scope_id")

    op.drop_index("ix_operator_invites_status", table_name="operator_invites")
    op.drop_index("ix_operator_invites_invite_token", table_name="operator_invites")
    op.drop_index("ix_operator_invites_email", table_name="operator_invites")
    op.drop_index("ix_operator_invites_workspace_id", table_name="operator_invites")
    op.drop_index("ix_operator_invites_agency_id", table_name="operator_invites")
    op.drop_table("operator_invites")

    op.drop_index("ix_operators_workspace_id", table_name="operators")
    op.drop_index("ix_operators_agency_id", table_name="operators")
    op.drop_index("ix_operators_user_id", table_name="operators")
    op.drop_table("operators")
    op.alter_column(
        "alembic_version",
        "version_num",
        existing_type=sa.String(length=64),
        type_=sa.String(length=32),
        existing_nullable=False,
    )
