"""merge main and xhs heads

Revision ID: 020_merge_main_and_xhs_heads
Revises: 017, 019_xhs_rule_pack_p1
Create Date: 2026-03-24 19:30:00.000000

"""

from typing import Sequence, Union


revision: str = "020_merge_main_and_xhs_heads"
down_revision: Union[tuple[str, str], None] = ("017", "019_xhs_rule_pack_p1")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
