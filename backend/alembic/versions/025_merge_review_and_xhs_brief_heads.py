"""merge review and xhs brief heads

Revision ID: 025_merge_review_xhs
Revises: 023_review_task_brand_exposure, 024_xhs_project_brief_parse
Create Date: 2026-03-25 00:10:00.000000

"""

from typing import Sequence, Union


revision: str = "025_merge_review_xhs"
down_revision: Union[tuple[str, str], None] = (
    "023_review_task_brand_exposure",
    "024_xhs_project_brief_parse",
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
