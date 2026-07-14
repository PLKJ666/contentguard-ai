"""
Export API tests.

Tests cover:
  - Task export as CSV (brand and agency roles allowed, creator denied)
  - Audit log export as CSV (brand only, agency and creator denied)
  - Unauthenticated access returns 401
  - CSV format validation (UTF-8 BOM, correct headers)

Uses the SQLite-backed test client from conftest.py.
"""
import csv
import io
import uuid
import pytest
from httpx import AsyncClient

from app.main import app
from app.middleware.rate_limit import RateLimitMiddleware
from tests._logto_test_utils import make_test_logto_token

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
API = "/api/v1"
ONBOARDING_URL = f"{API}/auth/onboarding"
EXPORT_URL = f"{API}/export"
PROJECTS_URL = f"{API}/projects"
TASKS_URL = f"{API}/tasks"
OPERATOR_URL = f"{API}/operator"


# ---------------------------------------------------------------------------
# Auto-clear rate limiter state before each test
# ---------------------------------------------------------------------------
@pytest.fixture(autouse=True)
def _clear_rate_limiter():
    """Reset the in-memory rate limiter between tests."""
    mw = app.middleware_stack
    while mw is not None:
        if isinstance(mw, RateLimitMiddleware):
            mw.requests.clear()
            break
        mw = getattr(mw, "app", None)
    yield


@pytest.fixture(autouse=True)
def _configure_operator_access_code(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        "app.api.auth.settings.OPERATOR_ACCESS_CODE",
        "portfolio-operator-test",
        raising=False,
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _email(prefix: str = "user") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}@test.com"


async def _register(client: AsyncClient, role: str, name: str | None = None):
    """Onboard a user via the API and return (access_token, user_data)."""
    email = _email(role)
    token = make_test_logto_token(sub=f"{role}-{uuid.uuid4().hex[:10]}", email=email, name=name or f"Test {role.title()}")
    resp = await client.post(
        ONBOARDING_URL,
        json={"role": role, "name": name or f"Test {role.title()}"},
        headers=_auth(token),
    )
    assert resp.status_code == 201, f"Onboarding failed for {role}: {resp.text}"
    return token, resp.json()


async def _register_operator(client: AsyncClient, name: str):
    email = _email("operator")
    token = make_test_logto_token(sub=f"operator-{uuid.uuid4().hex[:10]}", email=email, name=name)
    resp = await client.post(
        ONBOARDING_URL,
        json={"role": "operator", "name": name, "operator_access_code": "portfolio-operator-test"},
        headers=_auth(token),
    )
    assert resp.status_code == 201, f"Onboarding failed for operator: {resp.text}"
    return token, resp.json()


def _auth(token: str) -> dict:
    """Return Authorization header dict."""
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Shared fixture: register all three roles
# ---------------------------------------------------------------------------
@pytest.fixture
async def users(client: AsyncClient):
    """Register brand, agency and creator users. Returns dict with tokens and user data."""
    brand_token, brand_user = await _register(client, "brand", "ExportBrand")
    agency_token, agency_user = await _register(client, "agency", "ExportAgency")
    creator_token, creator_user = await _register(client, "creator", "ExportCreator")
    return {
        "brand_token": brand_token,
        "brand_user": brand_user,
        "agency_token": agency_token,
        "agency_user": agency_user,
        "creator_token": creator_token,
        "creator_user": creator_user,
    }


# ===========================================================================
# Test class: Export Tasks
# ===========================================================================

class TestExportTasks:
    """GET /api/v1/export/tasks"""

    @pytest.mark.asyncio
    async def test_brand_export_tasks_returns_csv(self, client: AsyncClient, users):
        """Brand can export tasks -- returns 200 with CSV content type."""
        resp = await client.get(
            f"{EXPORT_URL}/tasks",
            headers=_auth(users["brand_token"]),
        )
        assert resp.status_code == 200
        assert "text/csv" in resp.headers["content-type"]
        assert "content-disposition" in resp.headers
        assert "tasks_export_" in resp.headers["content-disposition"]
        assert ".csv" in resp.headers["content-disposition"]

    @pytest.mark.asyncio
    async def test_brand_export_tasks_empty_initially(self, client: AsyncClient, users):
        """Brand export with no tasks returns CSV with only the header row."""
        resp = await client.get(
            f"{EXPORT_URL}/tasks",
            headers=_auth(users["brand_token"]),
        )
        assert resp.status_code == 200
        body = resp.text
        # Strip BOM and parse
        content = body.lstrip("\ufeff").strip()
        lines = content.split("\n") if content else []
        # Should have exactly one line (the header) or be empty if no header
        # The API always outputs the header, so at least 1 line
        assert len(lines) >= 1
        # No data rows
        assert len(lines) == 1

    @pytest.mark.asyncio
    async def test_brand_export_tasks_with_project_filter(self, client: AsyncClient, users):
        """Brand can filter export by project_id query parameter."""
        resp = await client.get(
            f"{EXPORT_URL}/tasks?project_id=PJ000000",
            headers=_auth(users["brand_token"]),
        )
        assert resp.status_code == 200
        assert "text/csv" in resp.headers["content-type"]

    @pytest.mark.asyncio
    async def test_brand_export_tasks_with_date_filter(self, client: AsyncClient, users):
        """Brand can filter export by start_date and end_date query parameters."""
        resp = await client.get(
            f"{EXPORT_URL}/tasks?start_date=2024-01-01&end_date=2024-12-31",
            headers=_auth(users["brand_token"]),
        )
        assert resp.status_code == 200
        assert "text/csv" in resp.headers["content-type"]

    @pytest.mark.asyncio
    async def test_agency_export_tasks_returns_csv(self, client: AsyncClient, users):
        """Agency can export tasks -- returns 200 with CSV content type."""
        resp = await client.get(
            f"{EXPORT_URL}/tasks",
            headers=_auth(users["agency_token"]),
        )
        assert resp.status_code == 200
        assert "text/csv" in resp.headers["content-type"]
        assert "content-disposition" in resp.headers

    @pytest.mark.asyncio
    async def test_operator_export_tasks_returns_csv(self, client: AsyncClient):
        """Operator can export tasks inside its own workspace."""
        operator_token, _operator_user = await _register_operator(client, "代运营A")

        project_resp = await client.post(
            f"{OPERATOR_URL}/projects",
            json={"name": "代运营导出项目", "client_display_name": "客户A", "brand_display_name": "品牌A"},
            headers=_auth(operator_token),
        )
        assert project_resp.status_code == 201, project_resp.text
        project_id = project_resp.json()["id"]

        brief_resp = await client.post(
            f"{API}/projects/{project_id}/brief",
            json={
                "file_url": "https://example.com/operator-brief.pdf",
                "file_name": "operator-brief.pdf",
                "agency_attachments": [
                    {
                        "id": "att-operator-brief",
                        "name": "operator-brief.pdf",
                        "url": "https://example.com/operator-brief.pdf",
                        "size": "1MB",
                    }
                ],
                "selling_points": [{"content": "重点突出便携性", "required": True}],
            },
            headers=_auth(operator_token),
        )
        assert brief_resp.status_code == 201, brief_resp.text

        task_resp = await client.post(
            f"{OPERATOR_URL}/tasks",
            json={
                "project_id": project_id,
                "name": "代运营导出任务",
                "creator_display_name": "达人甲",
                "creator_platform": "douyin",
            },
            headers=_auth(operator_token),
        )
        assert task_resp.status_code == 201, task_resp.text

        export_resp = await client.get(
            f"{EXPORT_URL}/tasks",
            headers=_auth(operator_token),
        )
        assert export_resp.status_code == 200
        assert "text/csv" in export_resp.headers["content-type"]
        assert "代运营导出任务" in export_resp.text

    @pytest.mark.asyncio
    async def test_operator_task_creation_requires_brief(self, client: AsyncClient):
        """Operator must configure project brief before creating tasks."""
        operator_token, _operator_user = await _register_operator(client, "代运营B")

        project_resp = await client.post(
            f"{OPERATOR_URL}/projects",
            json={"name": "代运营未配置 Brief 项目"},
            headers=_auth(operator_token),
        )
        assert project_resp.status_code == 201, project_resp.text
        project_id = project_resp.json()["id"]

        task_resp = await client.post(
            f"{OPERATOR_URL}/tasks",
            json={
                "project_id": project_id,
                "name": "代运营任务",
                "creator_display_name": "达人乙",
                "creator_platform": "douyin",
            },
            headers=_auth(operator_token),
        )
        assert task_resp.status_code == 400, task_resp.text
        assert task_resp.json()["detail"] == "请先上传并保存有效的项目 Brief"

    @pytest.mark.asyncio
    async def test_operator_task_creation_rejects_empty_brief_record(self, client: AsyncClient):
        operator_token, _operator_user = await _register_operator(client, "代运营空Brief")

        project_resp = await client.post(
            f"{OPERATOR_URL}/projects",
            json={"name": "代运营空 Brief 项目"},
            headers=_auth(operator_token),
        )
        assert project_resp.status_code == 201, project_resp.text
        project_id = project_resp.json()["id"]

        empty_brief_resp = await client.post(
            f"{API}/projects/{project_id}/brief",
            json={},
            headers=_auth(operator_token),
        )
        assert empty_brief_resp.status_code == 201, empty_brief_resp.text

        task_resp = await client.post(
            f"{OPERATOR_URL}/tasks",
            json={
                "project_id": project_id,
                "name": "空 Brief 任务",
                "creator_display_name": "达人丙",
                "creator_platform": "douyin",
            },
            headers=_auth(operator_token),
        )
        assert task_resp.status_code == 400, task_resp.text
        assert task_resp.json()["detail"] == "请先上传并保存有效的项目 Brief"

    @pytest.mark.asyncio
    async def test_creator_export_tasks_forbidden(self, client: AsyncClient, users):
        """Creator cannot export tasks -- expects 403."""
        resp = await client.get(
            f"{EXPORT_URL}/tasks",
            headers=_auth(users["creator_token"]),
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_brand_export_tasks_with_data(
        self, client: AsyncClient, users, test_db_session
    ):
        """Brand export includes task rows when tasks exist in the database."""
        brand_token = users["brand_token"]
        agency_token = users["agency_token"]
        creator_id = users["creator_user"]["creator_id"]

        # Create a project as brand
        proj_resp = await client.post(PROJECTS_URL, json={
            "name": "Export Test Project",
            "description": "Project for export testing",
        }, headers=_auth(brand_token))
        assert proj_resp.status_code == 201
        project_id = proj_resp.json()["id"]

        # Create a task as agency
        task_resp = await client.post(TASKS_URL, json={
            "project_id": project_id,
            "creator_id": creator_id,
            "name": "Export Test Task",
        }, headers=_auth(agency_token))
        assert task_resp.status_code == 201

        # Export tasks
        resp = await client.get(
            f"{EXPORT_URL}/tasks",
            headers=_auth(brand_token),
        )
        assert resp.status_code == 200
        body = resp.text.lstrip("\ufeff").strip()
        lines = body.split("\n")
        # Header + at least one data row
        assert len(lines) >= 2
        # Verify the task name appears in the CSV body
        assert "Export Test Task" in body


# ===========================================================================
# Test class: Export Audit Logs
# ===========================================================================

class TestExportAuditLogs:
    """GET /api/v1/export/audit-logs"""

    @pytest.mark.asyncio
    async def test_brand_export_audit_logs_returns_csv(self, client: AsyncClient, users):
        """Brand can export audit logs -- returns 200 with CSV content type."""
        resp = await client.get(
            f"{EXPORT_URL}/audit-logs",
            headers=_auth(users["brand_token"]),
        )
        assert resp.status_code == 200
        assert "text/csv" in resp.headers["content-type"]
        assert "content-disposition" in resp.headers
        assert "audit_logs_export_" in resp.headers["content-disposition"]
        assert ".csv" in resp.headers["content-disposition"]

    @pytest.mark.asyncio
    async def test_brand_export_audit_logs_with_date_filter(self, client: AsyncClient, users):
        """Brand can filter audit logs by date range."""
        resp = await client.get(
            f"{EXPORT_URL}/audit-logs?start_date=2024-01-01&end_date=2024-12-31",
            headers=_auth(users["brand_token"]),
        )
        assert resp.status_code == 200
        assert "text/csv" in resp.headers["content-type"]

    @pytest.mark.asyncio
    async def test_brand_export_audit_logs_with_action_filter(self, client: AsyncClient, users):
        """Brand can filter audit logs by action type."""
        resp = await client.get(
            f"{EXPORT_URL}/audit-logs?action=onboarding",
            headers=_auth(users["brand_token"]),
        )
        assert resp.status_code == 200
        assert "text/csv" in resp.headers["content-type"]

    @pytest.mark.asyncio
    async def test_agency_export_audit_logs_forbidden(self, client: AsyncClient, users):
        """Agency cannot export audit logs -- expects 403."""
        resp = await client.get(
            f"{EXPORT_URL}/audit-logs",
            headers=_auth(users["agency_token"]),
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_creator_export_audit_logs_forbidden(self, client: AsyncClient, users):
        """Creator cannot export audit logs -- expects 403."""
        resp = await client.get(
            f"{EXPORT_URL}/audit-logs",
            headers=_auth(users["creator_token"]),
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_brand_export_audit_logs_contains_registration_log(
        self, client: AsyncClient, users
    ):
        """Audit logs export should contain the registration actions created during user setup."""
        resp = await client.get(
            f"{EXPORT_URL}/audit-logs",
            headers=_auth(users["brand_token"]),
        )
        assert resp.status_code == 200
        body = resp.text.lstrip("\ufeff").strip()
        lines = body.split("\n")
        # Header + at least one data row (the brand's own registration event)
        assert len(lines) >= 2
        # The onboarding action should appear in the body
        assert "onboarding" in body


# ===========================================================================
# Test class: Export Auth (unauthenticated)
# ===========================================================================

class TestExportAuth:
    """Unauthenticated requests to export endpoints."""

    @pytest.mark.asyncio
    async def test_export_tasks_unauthenticated(self, client: AsyncClient):
        """Unauthenticated request to export tasks returns 401."""
        resp = await client.get(f"{EXPORT_URL}/tasks")
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_export_audit_logs_unauthenticated(self, client: AsyncClient):
        """Unauthenticated request to export audit logs returns 401."""
        resp = await client.get(f"{EXPORT_URL}/audit-logs")
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_export_tasks_invalid_token(self, client: AsyncClient):
        """Request with an invalid token returns 401."""
        resp = await client.get(
            f"{EXPORT_URL}/tasks",
            headers=_auth("invalid.token.value"),
        )
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_export_audit_logs_invalid_token(self, client: AsyncClient):
        """Request with an invalid token to audit-logs returns 401."""
        resp = await client.get(
            f"{EXPORT_URL}/audit-logs",
            headers=_auth("invalid.token.value"),
        )
        assert resp.status_code == 401


# ===========================================================================
# Test class: Export CSV Format
# ===========================================================================

class TestExportCSVFormat:
    """Verify CSV structure: UTF-8 BOM, correct headers, parseable rows."""

    @pytest.mark.asyncio
    async def test_tasks_csv_has_utf8_bom(self, client: AsyncClient, users):
        """Task CSV response body starts with UTF-8 BOM character."""
        resp = await client.get(
            f"{EXPORT_URL}/tasks",
            headers=_auth(users["brand_token"]),
        )
        assert resp.status_code == 200
        body = resp.text
        assert body.startswith("\ufeff"), "CSV body should start with UTF-8 BOM"

    @pytest.mark.asyncio
    async def test_tasks_csv_headers(self, client: AsyncClient, users):
        """Task CSV contains the expected Chinese header columns."""
        resp = await client.get(
            f"{EXPORT_URL}/tasks",
            headers=_auth(users["brand_token"]),
        )
        assert resp.status_code == 200
        body = resp.text.lstrip("\ufeff")
        reader = csv.reader(io.StringIO(body))
        header = next(reader)
        expected = ["任务ID", "任务名称", "项目名称", "客户名", "品牌名", "阶段", "达人名称", "达人平台", "代理商名称", "创建时间", "更新时间"]
        assert header == expected

    @pytest.mark.asyncio
    async def test_audit_logs_csv_has_utf8_bom(self, client: AsyncClient, users):
        """Audit log CSV response body starts with UTF-8 BOM character."""
        resp = await client.get(
            f"{EXPORT_URL}/audit-logs",
            headers=_auth(users["brand_token"]),
        )
        assert resp.status_code == 200
        body = resp.text
        assert body.startswith("\ufeff"), "CSV body should start with UTF-8 BOM"

    @pytest.mark.asyncio
    async def test_audit_logs_csv_headers(self, client: AsyncClient, users):
        """Audit log CSV contains the expected Chinese header columns."""
        resp = await client.get(
            f"{EXPORT_URL}/audit-logs",
            headers=_auth(users["brand_token"]),
        )
        assert resp.status_code == 200
        body = resp.text.lstrip("\ufeff")
        reader = csv.reader(io.StringIO(body))
        header = next(reader)
        expected = ["日志ID", "操作类型", "资源类型", "资源ID", "操作用户", "用户角色", "详情", "IP地址", "操作时间"]
        assert header == expected

    @pytest.mark.asyncio
    async def test_tasks_csv_parseable_with_data(
        self, client: AsyncClient, users
    ):
        """Task CSV with data is parseable by Python csv module and rows match column count."""
        brand_token = users["brand_token"]
        agency_token = users["agency_token"]
        creator_id = users["creator_user"]["creator_id"]

        # Create project and task to ensure data exists
        proj_resp = await client.post(PROJECTS_URL, json={
            "name": "CSV Parse Project",
            "description": "For CSV parsing test",
        }, headers=_auth(brand_token))
        assert proj_resp.status_code == 201
        project_id = proj_resp.json()["id"]

        task_resp = await client.post(TASKS_URL, json={
            "project_id": project_id,
            "creator_id": creator_id,
            "name": "CSV Parse Task",
        }, headers=_auth(agency_token))
        assert task_resp.status_code == 201

        # Export and parse
        resp = await client.get(
            f"{EXPORT_URL}/tasks",
            headers=_auth(brand_token),
        )
        assert resp.status_code == 200
        body = resp.text.lstrip("\ufeff")
        reader = csv.reader(io.StringIO(body))
        rows = list(reader)
        # At least header + 1 data row
        assert len(rows) >= 2
        header = rows[0]
        assert len(header) == 11
        # All data rows have the same number of columns as the header
        for i, row in enumerate(rows[1:], start=1):
            assert len(row) == len(header), f"Row {i} has {len(row)} columns, expected {len(header)}"
