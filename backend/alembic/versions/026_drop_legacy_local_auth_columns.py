"""drop legacy local auth columns

Revision ID: 026_drop_legacy_local_auth
Revises: 025_merge_review_xhs
Create Date: 2026-04-07 16:30:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "026_drop_legacy_local_auth"
down_revision: Union[str, None] = "025_merge_review_xhs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("users", "refresh_token_expires_at")
    op.drop_column("users", "refresh_token")
    op.drop_column("users", "password_hash")


def downgrade() -> None:
    op.add_column("users", sa.Column("password_hash", sa.String(length=255), nullable=True))
    op.add_column("users", sa.Column("refresh_token", sa.String(length=512), nullable=True))
    op.add_column("users", sa.Column("refresh_token_expires_at", sa.DateTime(timezone=True), nullable=True))
