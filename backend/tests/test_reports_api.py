"""
报表 API 测试
覆盖: GET /api/v1/reports
"""

import uuid
import pytest
from datetime import datetime, timezone
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from tests._logto_test_utils import make_test_logto_token


REPORTS_URL = "/api/v1/reports"
ONBOARDING_URL = "/api/v1/auth/onboarding"
PROJECTS_URL = "/api/v1/projects"
TASKS_URL = "/api/v1/tasks"


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, role: str, name: str, email: str) -> dict:
    token = make_test_logto_token(sub=f"{role}-{uuid.uuid4().hex[:10]}", email=email, name=name)
    resp = await client.post(
        ONBOARDING_URL,
        json={"role": role, "name": name},
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    return {"access_token": token, "user": resp.json()}


@pytest.mark.asyncio
async def test_reports_brand_success(client: AsyncClient, test_db_session: AsyncSession):
    brand = await _register(client, "brand", "报表品牌", "reports-brand@test.com")
    agency = await _register(client, "agency", "报表代理", "reports-agency@test.com")
    creator = await _register(client, "creator", "报表达人", "reports-creator@test.com")

    brand_token = brand["access_token"]
    agency_token = agency["access_token"]
    creator_id = creator["user"]["creator_id"]

    # brand creates a project
    proj_resp = await client.post(PROJECTS_URL, json={"name": "R Project", "platform": "douyin"}, headers=_auth(brand_token))
    assert proj_resp.status_code == 201, proj_resp.text
    project_id = proj_resp.json()["id"]

    # agency creates a task
    task_resp = await client.post(TASKS_URL, json={"project_id": project_id, "creator_id": creator_id}, headers=_auth(agency_token))
    assert task_resp.status_code == 201, task_resp.text
    task_id = task_resp.json()["id"]

    # Simulate video final review done today
    from app.models.task import Task, TaskStatus
    from sqlalchemy import update

    now = datetime.now(timezone.utc)
    await test_db_session.execute(
        update(Task)
        .where(Task.id == task_id)
        .values(
            video_ai_score=85,
            video_brand_status=TaskStatus.PASSED,
            video_brand_reviewed_at=now,
        )
    )
    await test_db_session.commit()

    resp = await client.get(f"{REPORTS_URL}?period=7d&platform=all", headers=_auth(brand_token))
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert "reportData" in body
    assert "reviewRecords" in body
    assert len(body["reportData"]) >= 1
    assert len(body["reviewRecords"]) >= 1

    today = now.date().isoformat()
    day_row = next((r for r in body["reportData"] if r["date"] == today), None)
    assert day_row is not None
    assert day_row["submitted"] == 1
    assert day_row["passed"] == 1
    assert day_row["failed"] == 0

    record = body["reviewRecords"][0]
    assert record["id"] == task_id
    assert record["platform"] == "douyin"
    assert record["score"] == 85
    assert record["status"] in ("passed", "warning", "failed")


@pytest.mark.asyncio
async def test_reports_forbidden_for_non_brand(client: AsyncClient):
    agency = await _register(client, "agency", "非品牌", "reports-forbidden@test.com")
    token = agency["access_token"]
    resp = await client.get(REPORTS_URL, headers=_auth(token))
    assert resp.status_code == 403
