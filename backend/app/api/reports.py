"""
审核报表 API

当前实现面向品牌方视角：统计旗下项目的“视频最终审核结果”（品牌终审优先，其次代理商审核）。
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_brand
from app.database import get_db
from app.models.organization import Brand
from app.models.project import Project
from app.models.task import Task, TaskStatus
from app.schemas.reports import ReportsResponse, ReportDailyRow, ReportReviewRecord

router = APIRouter(prefix="/reports", tags=["报表"])


def _period_to_days(period: str) -> int:
    mapping = {"7d": 7, "30d": 30, "90d": 90}
    return mapping.get(period, 7)


def _format_reviewed_at(dt: datetime) -> str:
    # 展示用字符串，不携带时区；统一按 UTC 输出，避免前后端时区错位。
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M")

def _as_utc(dt: datetime) -> datetime:
    """Normalize possibly-naive datetimes (e.g. SQLite) to UTC-aware."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


@router.get("", response_model=ReportsResponse)
async def get_reports(
    period: str = Query("7d", description="统计周期: 7d/30d/90d"),
    platform: str = Query("all", description="投放平台: all/douyin/xiaohongshu/bilibili/..."),
    brand: Brand = Depends(get_current_brand),
    db: AsyncSession = Depends(get_db),
) -> ReportsResponse:
    days = _period_to_days(period)
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=days)

    platform_filter = None if platform == "all" else platform

    # 拉取可能落在时间范围内的任务：视频代理商审核/品牌终审有任一发生在范围内
    query = (
        select(Task)
        .join(Project, Project.id == Task.project_id)
        .options(selectinload(Task.project), selectinload(Task.creator))
        .where(Project.brand_id == brand.id)
        .where(
            or_(
                Task.video_brand_reviewed_at >= start,
                Task.video_agency_reviewed_at >= start,
            )
        )
    )
    if platform_filter:
        query = query.where(Project.platform == platform_filter)

    result = await db.execute(query)
    tasks = list(result.scalars().all())

    # 归一化为“视频最终审核事件”
    events: list[dict] = []
    for t in tasks:
        reviewed_at = t.video_brand_reviewed_at or t.video_agency_reviewed_at
        status = t.video_brand_status or t.video_agency_status
        if not reviewed_at or not status:
            continue
        reviewed_at_utc = _as_utc(reviewed_at)
        if reviewed_at_utc < start:
            continue

        score = int(t.video_ai_score or 0)
        passed = status in (TaskStatus.PASSED, TaskStatus.FORCE_PASSED)
        failed = status == TaskStatus.REJECTED

        # passed + 低分 -> warning，用于报表“待改进”展示
        if failed:
            report_status: str = "failed"
        elif passed and score and score < 80:
            report_status = "warning"
        else:
            report_status = "passed"

        proj_platform = (t.project.platform or "unknown") if t.project else "unknown"
        creator_name = (t.creator.name if t.creator else "")

        events.append(
            {
                "task_id": t.id,
                "date": reviewed_at_utc.date().isoformat(),
                "reviewed_at": reviewed_at_utc,
                "videoTitle": t.name,
                "creator": creator_name,
                "platform": proj_platform,
                "score": score,
                "status": report_status,
                "passed": passed,
                "failed": failed,
            }
        )

    # 日汇总
    by_day: dict[str, dict] = {}
    for e in events:
        d = e["date"]
        acc = by_day.setdefault(d, {"submitted": 0, "passed": 0, "failed": 0, "scores": []})
        acc["submitted"] += 1
        if e["failed"]:
            acc["failed"] += 1
        elif e["passed"]:
            acc["passed"] += 1
        if e["score"]:
            acc["scores"].append(e["score"])

    daily_rows: list[ReportDailyRow] = []
    for d, acc in by_day.items():
        scores = acc["scores"]
        avg = int(round(sum(scores) / len(scores))) if scores else 0
        daily_rows.append(
            ReportDailyRow(
                id=d,
                date=d,
                submitted=acc["submitted"],
                passed=acc["passed"],
                failed=acc["failed"],
                avgScore=avg,
            )
        )
    daily_rows.sort(key=lambda r: r.date, reverse=True)

    # 详细记录（按时间倒序）
    events.sort(key=lambda e: e["reviewed_at"], reverse=True)
    records: list[ReportReviewRecord] = [
        ReportReviewRecord(
            id=e["task_id"],
            videoTitle=e["videoTitle"],
            creator=e["creator"],
            platform=e["platform"],
            score=e["score"],
            status=e["status"],  # type: ignore[arg-type]
            reviewedAt=_format_reviewed_at(e["reviewed_at"]),
        )
        for e in events[:200]
    ]

    return ReportsResponse(reportData=daily_rows, reviewRecords=records)
