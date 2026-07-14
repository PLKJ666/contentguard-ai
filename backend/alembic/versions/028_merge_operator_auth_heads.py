"""merge operator and local auth heads

Revision ID: 028_merge_operator_auth_heads
Revises: 026_drop_legacy_local_auth, 027_operator_workspace
Create Date: 2026-04-16 20:45:00.000000
"""

from typing import Sequence, Union


revision: str = "028_merge_operator_auth_heads"
down_revision: Union[str, Sequence[str], None] = (
    "026_drop_legacy_local_auth",
    "027_operator_workspace",
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
