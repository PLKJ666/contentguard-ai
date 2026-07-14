"""Add product_name to briefs

Revision ID: 016
Revises: 015_add_script_agency_corrected
Create Date: 2026-03-10
"""

from alembic import op
import sqlalchemy as sa

revision = "016"
down_revision = "015"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE briefs ADD COLUMN IF NOT EXISTS product_name VARCHAR(255)")


def downgrade():
    op.execute("ALTER TABLE briefs DROP COLUMN IF EXISTS product_name")
