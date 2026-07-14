"""
审核报表 Schema
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


ReportStatus = Literal["passed", "warning", "failed"]


class ReportDailyRow(BaseModel):
    id: str
    date: str = Field(..., description="YYYY-MM-DD")
    submitted: int = 0
    passed: int = 0
    failed: int = 0
    avgScore: int = 0


class ReportReviewRecord(BaseModel):
    id: str
    videoTitle: str
    creator: str
    platform: str
    score: int = 0
    status: ReportStatus
    reviewedAt: str


class ReportsResponse(BaseModel):
    reportData: list[ReportDailyRow]
    reviewRecords: list[ReportReviewRecord]

