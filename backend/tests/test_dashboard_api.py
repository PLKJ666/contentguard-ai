"""
Dashboard API comprehensive tests.

Tests cover the three dashboard endpoints:
  - GET /api/v1/dashboard/creator  (creator role only)
  - GET /api/v1/dashboard/agency   (agency role only)
  - GET /api/v1/dashboard/brand    (brand role only)

Each endpoint returns zero-valued stats for a freshly registered user
and enforces role-based access (403 for wrong roles, 401 for unauthenticated).

Uses the SQLite-backed test client from conftest.py.
"""
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
DASHBOARD_CREATOR_URL = f"{API}/dashboard/creator"
DASHBOARD_AGENCY_URL = f"{API}/dashboard/agency"
DASHBOARD_BRAND_URL = f"{API}/dashboard/brand"


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
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201, f"Onboarding failed for {role}: {resp.text}"
    return token, resp.json()


def _auth(token: str) -> dict:
    """Return Authorization header dict."""
    return {"Authorization": f"Bearer {token}"}


# ===========================================================================
# Test class: Creator Dashboard
# ===========================================================================

class TestCreatorDashboard:
    """GET /api/v1/dashboard/creator"""

    @pytest.mark.asyncio
    async def test_creator_dashboard_happy_path(self, client: AsyncClient):
        """Creator gets dashboard stats -- all zeros for a freshly registered user."""
        token, user = await _register(client, "creator")

        resp = await client.get(DASHBOARD_CREATOR_URL, headers=_auth(token))
        assert resp.status_code == 200

        data = resp.json()
        assert data["total_tasks"] == 0
        assert data["pending_script"] == 0
        assert data["pending_video"] == 0
        assert data["in_review"] == 0
        assert data["completed"] == 0
        assert data["rejected"] == 0

    @pytest.mark.asyncio
    async def test_creator_dashboard_response_keys(self, client: AsyncClient):
        """Creator dashboard response contains all expected keys."""
        token, _ = await _register(client, "creator")

        resp = await client.get(DASHBOARD_CREATOR_URL, headers=_auth(token))
        assert resp.status_code == 200

        data = resp.json()
        expected_keys = {
            "total_tasks", "pending_script", "pending_video",
            "in_review", "completed", "rejected",
        }
        assert expected_keys.issubset(set(data.keys()))

    @pytest.mark.asyncio
    async def test_creator_dashboard_forbidden_for_brand(self, client: AsyncClient):
        """Brand role cannot access creator dashboard -- expects 403."""
        token, _ = await _register(client, "brand")

        resp = await client.get(DASHBOARD_CREATOR_URL, headers=_auth(token))
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_creator_dashboard_forbidden_for_agency(self, client: AsyncClient):
        """Agency role cannot access creator dashboard -- expects 403."""
        token, _ = await _register(client, "agency")

        resp = await client.get(DASHBOARD_CREATOR_URL, headers=_auth(token))
        assert resp.status_code == 403


# ===========================================================================
# Test class: Agency Dashboard
# ===========================================================================

class TestAgencyDashboard:
    """GET /api/v1/dashboard/agency"""

    @pytest.mark.asyncio
    async def test_agency_dashboard_happy_path(self, client: AsyncClient):
        """Agency gets dashboard stats -- all zeros for a freshly registered user."""
        token, user = await _register(client, "agency")

        resp = await client.get(DASHBOARD_AGENCY_URL, headers=_auth(token))
        assert resp.status_code == 200

        data = resp.json()
        assert data["pending_review"]["script"] == 0
        assert data["pending_review"]["video"] == 0
        assert data["pending_appeal"] == 0
        assert data["today_passed"]["script"] == 0
        assert data["today_passed"]["video"] == 0
        assert data["in_progress"]["script"] == 0
        assert data["in_progress"]["video"] == 0
        assert data["total_creators"] == 0
        assert data["total_tasks"] == 0

    @pytest.mark.asyncio
    async def test_agency_dashboard_response_keys(self, client: AsyncClient):
        """Agency dashboard response contains all expected keys."""
        token, _ = await _register(client, "agency")

        resp = await client.get(DASHBOARD_AGENCY_URL, headers=_auth(token))
        assert resp.status_code == 200

        data = resp.json()
        expected_keys = {
            "pending_review", "pending_appeal", "today_passed",
            "in_progress", "total_creators", "total_tasks",
        }
        assert expected_keys.issubset(set(data.keys()))

    @pytest.mark.asyncio
    async def test_agency_dashboard_nested_review_counts(self, client: AsyncClient):
        """Agency dashboard nested ReviewCount objects have correct structure."""
        token, _ = await _register(client, "agency")

        resp = await client.get(DASHBOARD_AGENCY_URL, headers=_auth(token))
        assert resp.status_code == 200

        data = resp.json()
        for key in ("pending_review", "today_passed", "in_progress"):
            assert "script" in data[key], f"Missing 'script' in {key}"
            assert "video" in data[key], f"Missing 'video' in {key}"
            assert isinstance(data[key]["script"], int)
            assert isinstance(data[key]["video"], int)

    @pytest.mark.asyncio
    async def test_agency_dashboard_forbidden_for_creator(self, client: AsyncClient):
        """Creator role cannot access agency dashboard -- expects 403."""
        token, _ = await _register(client, "creator")

        resp = await client.get(DASHBOARD_AGENCY_URL, headers=_auth(token))
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_agency_dashboard_forbidden_for_brand(self, client: AsyncClient):
        """Brand role cannot access agency dashboard -- expects 403."""
        token, _ = await _register(client, "brand")

        resp = await client.get(DASHBOARD_AGENCY_URL, headers=_auth(token))
        assert resp.status_code == 403


# ===========================================================================
# Test class: Brand Dashboard
# ===========================================================================

class TestBrandDashboard:
    """GET /api/v1/dashboard/brand"""

    @pytest.mark.asyncio
    async def test_brand_dashboard_happy_path(self, client: AsyncClient):
        """Brand gets dashboard stats -- all zeros for a freshly registered user."""
        token, user = await _register(client, "brand")

        resp = await client.get(DASHBOARD_BRAND_URL, headers=_auth(token))
        assert resp.status_code == 200

        data = resp.json()
        assert data["total_projects"] == 0
        assert data["active_projects"] == 0
        assert data["pending_review"]["script"] == 0
        assert data["pending_review"]["video"] == 0
        assert data["total_agencies"] == 0
        assert data["total_tasks"] == 0
        assert data["completed_tasks"] == 0

    @pytest.mark.asyncio
    async def test_brand_dashboard_response_keys(self, client: AsyncClient):
        """Brand dashboard response contains all expected keys."""
        token, _ = await _register(client, "brand")

        resp = await client.get(DASHBOARD_BRAND_URL, headers=_auth(token))
        assert resp.status_code == 200

        data = resp.json()
        expected_keys = {
            "total_projects", "active_projects", "pending_review",
            "total_agencies", "total_tasks", "completed_tasks",
        }
        assert expected_keys.issubset(set(data.keys()))

    @pytest.mark.asyncio
    async def test_brand_dashboard_forbidden_for_creator(self, client: AsyncClient):
        """Creator role cannot access brand dashboard -- expects 403."""
        token, _ = await _register(client, "creator")

        resp = await client.get(DASHBOARD_BRAND_URL, headers=_auth(token))
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_brand_dashboard_forbidden_for_agency(self, client: AsyncClient):
        """Agency role cannot access brand dashboard -- expects 403."""
        token, _ = await _register(client, "agency")

        resp = await client.get(DASHBOARD_BRAND_URL, headers=_auth(token))
        assert resp.status_code == 403


# ===========================================================================
# Test class: Dashboard Authentication
# ===========================================================================

class TestDashboardAuth:
    """Unauthenticated access to all dashboard endpoints."""

    @pytest.mark.asyncio
    async def test_creator_dashboard_unauthenticated(self, client: AsyncClient):
        """Unauthenticated request to creator dashboard returns 401."""
        resp = await client.get(DASHBOARD_CREATOR_URL)
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_agency_dashboard_unauthenticated(self, client: AsyncClient):
        """Unauthenticated request to agency dashboard returns 401."""
        resp = await client.get(DASHBOARD_AGENCY_URL)
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_brand_dashboard_unauthenticated(self, client: AsyncClient):
        """Unauthenticated request to brand dashboard returns 401."""
        resp = await client.get(DASHBOARD_BRAND_URL)
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_dashboard_with_invalid_token(self, client: AsyncClient):
        """Request with an invalid Bearer token returns 401."""
        headers = {"Authorization": "Bearer invalid-garbage-token"}

        for url in (DASHBOARD_CREATOR_URL, DASHBOARD_AGENCY_URL, DASHBOARD_BRAND_URL):
            resp = await client.get(url, headers=headers)
            assert resp.status_code == 401, f"Expected 401 for {url}, got {resp.status_code}"
