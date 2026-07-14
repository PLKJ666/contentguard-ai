"""Shared SQLAlchemy column types with cross-database compatibility."""
from sqlalchemy import JSON
from sqlalchemy.dialects.postgresql import JSONB

# Use JSONB on PostgreSQL, fall back to JSON on other databases (e.g., SQLite for tests)
JSONType = JSON().with_variant(JSONB, "postgresql")
