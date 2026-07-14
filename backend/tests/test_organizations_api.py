"""
Organizations API comprehensive tests.

Tests cover the full organization relationship management:
  - Brand manages agencies (list, invite, remove, update permission)
  - Agency manages creators (list, invite, remove)
  - Agency views associated brands
  - Search agencies/creators by keyword
  - Permission / role checks (wrong roles -> 403, unauthenticated -> 401)

Uses the SQLite-backed test client from conftest.py.

NOTE: SQLite does not enforce FK constraints by default.  The tests rely on
application-level validation instead.  Some PostgreSQL-only features (e.g.
JSONB operators) are avoided.

NOTE: Many-to-many relationship operations (brand.agencies.append, etc.) use
SQLAlchemy's collection manipulation which requires eager loading.  The API
endpoints use selectinload, which works correctly in the async SQLite test DB.
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
ORG_URL = f"{API}/organizations"


# ---------------------------------------------------------------------------
# Auto-clear rate limiter state before each test
# ---------------------------------------------------------------------------
@pytest.fixture(autouse=True)
def _clear_rate_limiter():
    """Reset the in-memory rate limiter between tests.

    The RateLimitMiddleware is a singleton attached to the FastAPI app.
    Without clearing, cumulative API calls across tests can hit
    per-path limits configured on the shared application instance.
    """
    mw = app.middleware_stack
    while mw is not None:
        if isinstance(mw, RateLimitMiddleware):
            mw.requests.clear()
            break
        mw = getattr(mw, "app", None)
    yield


# ---------------------------------------------------------------------------
# Helper: unique email generator
# ---------------------------------------------------------------------------
def _email(prefix: str = "user") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}@test.com"


# ---------------------------------------------------------------------------
# Helper: register a user and return (access_token, user_response)
# ---------------------------------------------------------------------------
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


def _auth(token: str) -> dict:
    """Return Authorization header dict."""
    return {"Authorization": f"Bearer {token}"}


async def _send_brand_invite(client: AsyncClient, setup_data: dict) -> dict:
    resp = await client.post(
        f"{ORG_URL}/brand/agencies",
        json={"agency_id": setup_data["agency_id"]},
        headers=_auth(setup_data["brand_token"]),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _send_creator_invite(client: AsyncClient, setup_data: dict) -> dict:
    resp = await client.post(
        f"{ORG_URL}/agency/creators",
        json={"creator_id": setup_data["creator_id"]},
        headers=_auth(setup_data["agency_token"]),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _accept_brand_invite(client: AsyncClient, setup_data: dict) -> str:
    await _send_brand_invite(client, setup_data)
    resp = await client.get(
        f"{ORG_URL}/agency/brand-invites",
        headers=_auth(setup_data["agency_token"]),
    )
    assert resp.status_code == 200, resp.text
    items = resp.json()["items"]
    assert len(items) == 1
    message_id = items[0]["id"]
    accept_resp = await client.post(
        f"{ORG_URL}/agency/brand-invites/{message_id}/accept",
        headers=_auth(setup_data["agency_token"]),
    )
    assert accept_resp.status_code == 200, accept_resp.text
    return message_id


async def _accept_creator_invite(client: AsyncClient, setup_data: dict) -> str:
    await _send_creator_invite(client, setup_data)
    resp = await client.get(
        f"{ORG_URL}/creator/invites",
        headers=_auth(setup_data["creator_token"]),
    )
    assert resp.status_code == 200, resp.text
    items = resp.json()["items"]
    assert len(items) == 1
    message_id = items[0]["id"]
    accept_resp = await client.post(
        f"{ORG_URL}/creator/invites/{message_id}/accept",
        headers=_auth(setup_data["creator_token"]),
    )
    assert accept_resp.status_code == 200, accept_resp.text
    return message_id


# ---------------------------------------------------------------------------
# Fixture: setup_data -- register brand, agency, creator users
# ---------------------------------------------------------------------------
@pytest.fixture
async def setup_data(client: AsyncClient):
    """
    Create brand, agency, creator users.

    Returns a dict with keys:
      brand_token, brand_user, brand_id,
      agency_token, agency_user, agency_id,
      creator_token, creator_user, creator_id,
    """
    # 1. Register brand user
    brand_token, brand_user = await _register(client, "brand", "TestBrand")
    brand_id = brand_user["brand_id"]

    # 2. Register agency user
    agency_token, agency_user = await _register(client, "agency", "TestAgency")
    agency_id = agency_user["agency_id"]

    # 3. Register creator user
    creator_token, creator_user = await _register(client, "creator", "TestCreator")
    creator_id = creator_user["creator_id"]

    return {
        "brand_token": brand_token,
        "brand_user": brand_user,
        "brand_id": brand_id,
        "agency_token": agency_token,
        "agency_user": agency_user,
        "agency_id": agency_id,
        "creator_token": creator_token,
        "creator_user": creator_user,
        "creator_id": creator_id,
    }


# ===========================================================================
# Test class: Brand-Agency Management
# ===========================================================================

class TestBrandAgencyManagement:
    """Brand manages agencies: list, invite, remove, update permission."""

    @pytest.mark.asyncio
    async def test_list_agencies_empty(self, client: AsyncClient, setup_data):
        """Brand with no agencies sees an empty list."""
        resp = await client.get(
            f"{ORG_URL}/brand/agencies",
            headers=_auth(setup_data["brand_token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["items"] == []
        assert data["total"] == 0

    @pytest.mark.asyncio
    async def test_invite_agency_happy_path(self, client: AsyncClient, setup_data):
        """Brand can invite an existing agency -- returns 201."""
        data = await _send_brand_invite(client, setup_data)
        assert data["agency_id"] == setup_data["agency_id"]
        assert "message" in data

    @pytest.mark.asyncio
    async def test_list_agencies_after_invite(self, client: AsyncClient, setup_data):
        """Sending an invite alone does not create an active association."""
        await _send_brand_invite(client, setup_data)

        # List agencies
        resp = await client.get(
            f"{ORG_URL}/brand/agencies",
            headers=_auth(setup_data["brand_token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 0
        assert data["items"] == []

    @pytest.mark.asyncio
    async def test_list_pending_brand_invites_after_invite(self, client: AsyncClient, setup_data):
        """Agency sees a pending brand invite after it is sent."""
        await _send_brand_invite(client, setup_data)

        resp = await client.get(
            f"{ORG_URL}/agency/brand-invites",
            headers=_auth(setup_data["agency_token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        invite = data["items"][0]
        assert invite["brand_id"] == setup_data["brand_id"]
        assert invite["brand_name"] == "TestBrand"

    @pytest.mark.asyncio
    async def test_invite_agency_duplicate(self, client: AsyncClient, setup_data):
        """Inviting the same agency twice returns 400."""
        await _send_brand_invite(client, setup_data)

        # Duplicate invite
        resp2 = await client.post(
            f"{ORG_URL}/brand/agencies",
            json={"agency_id": setup_data["agency_id"]},
            headers=_auth(setup_data["brand_token"]),
        )
        assert resp2.status_code == 400

    @pytest.mark.asyncio
    async def test_invite_nonexistent_agency(self, client: AsyncClient, setup_data):
        """Inviting a non-existent agency returns 404."""
        resp = await client.post(
            f"{ORG_URL}/brand/agencies",
            json={"agency_id": "AG000000"},
            headers=_auth(setup_data["brand_token"]),
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_remove_agency_happy_path(self, client: AsyncClient, setup_data):
        """Brand can remove an invited agency."""
        await _accept_brand_invite(client, setup_data)

        # Remove
        resp = await client.delete(
            f"{ORG_URL}/brand/agencies/{setup_data['agency_id']}",
            headers=_auth(setup_data["brand_token"]),
        )
        assert resp.status_code == 200
        assert "message" in resp.json()

        # Verify list is empty again
        resp = await client.get(
            f"{ORG_URL}/brand/agencies",
            headers=_auth(setup_data["brand_token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["total"] == 0

    @pytest.mark.asyncio
    async def test_remove_nonexistent_agency(self, client: AsyncClient, setup_data):
        """Removing a non-associated agency still returns 200 (idempotent)."""
        resp = await client.delete(
            f"{ORG_URL}/brand/agencies/AG000000",
            headers=_auth(setup_data["brand_token"]),
        )
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_remove_agency_not_associated(self, client: AsyncClient, setup_data):
        """Removing an agency that exists but is not associated returns 200 (idempotent)."""
        # Register another agency that is NOT invited
        _, agency2_user = await _register(client, "agency", "UnrelatedAgency")
        agency2_id = agency2_user["agency_id"]

        resp = await client.delete(
            f"{ORG_URL}/brand/agencies/{agency2_id}",
            headers=_auth(setup_data["brand_token"]),
        )
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_update_agency_permission_happy_path(self, client: AsyncClient, setup_data):
        """Brand can update agency's force_pass_enabled permission."""
        await _accept_brand_invite(client, setup_data)

        # Update permission: disable force_pass
        resp = await client.put(
            f"{ORG_URL}/brand/agencies/{setup_data['agency_id']}/permission",
            json={"force_pass_enabled": False},
            headers=_auth(setup_data["brand_token"]),
        )
        assert resp.status_code == 200
        assert "message" in resp.json()

        # Verify via list
        resp = await client.get(
            f"{ORG_URL}/brand/agencies",
            headers=_auth(setup_data["brand_token"]),
        )
        assert resp.status_code == 200
        agency_item = resp.json()["items"][0]
        assert agency_item["force_pass_enabled"] is False

    @pytest.mark.asyncio
    async def test_update_agency_permission_enable(self, client: AsyncClient, setup_data):
        """Brand can re-enable force_pass_enabled after disabling it."""
        await _accept_brand_invite(client, setup_data)
        await client.put(
            f"{ORG_URL}/brand/agencies/{setup_data['agency_id']}/permission",
            json={"force_pass_enabled": False},
            headers=_auth(setup_data["brand_token"]),
        )

        # Re-enable
        resp = await client.put(
            f"{ORG_URL}/brand/agencies/{setup_data['agency_id']}/permission",
            json={"force_pass_enabled": True},
            headers=_auth(setup_data["brand_token"]),
        )
        assert resp.status_code == 200

        # Verify via list
        resp = await client.get(
            f"{ORG_URL}/brand/agencies",
            headers=_auth(setup_data["brand_token"]),
        )
        agency_item = resp.json()["items"][0]
        assert agency_item["force_pass_enabled"] is True

    @pytest.mark.asyncio
    async def test_update_permission_not_associated_agency(self, client: AsyncClient, setup_data):
        """Updating permission for a non-associated agency returns 404."""
        resp = await client.put(
            f"{ORG_URL}/brand/agencies/AG000000/permission",
            json={"force_pass_enabled": False},
            headers=_auth(setup_data["brand_token"]),
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_update_permission_existing_but_not_associated(self, client: AsyncClient, setup_data):
        """Updating permission for an agency that exists but is not associated returns 404."""
        # agency_id from setup_data exists but is NOT invited to this brand
        resp = await client.put(
            f"{ORG_URL}/brand/agencies/{setup_data['agency_id']}/permission",
            json={"force_pass_enabled": False},
            headers=_auth(setup_data["brand_token"]),
        )
        assert resp.status_code == 404


# ===========================================================================
# Test class: Agency-Creator Management
# ===========================================================================

class TestAgencyCreatorManagement:
    """Agency manages creators: list, invite, remove."""

    @pytest.mark.asyncio
    async def test_list_creators_empty(self, client: AsyncClient, setup_data):
        """Agency with no creators sees an empty list."""
        resp = await client.get(
            f"{ORG_URL}/agency/creators",
            headers=_auth(setup_data["agency_token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["items"] == []
        assert data["total"] == 0

    @pytest.mark.asyncio
    async def test_invite_creator_happy_path(self, client: AsyncClient, setup_data):
        """Agency can invite an existing creator -- returns 201."""
        data = await _send_creator_invite(client, setup_data)
        assert data["creator_id"] == setup_data["creator_id"]
        assert "message" in data

    @pytest.mark.asyncio
    async def test_list_creators_after_invite(self, client: AsyncClient, setup_data):
        """Sending an invite alone does not create an active creator association."""
        await _send_creator_invite(client, setup_data)

        # List
        resp = await client.get(
            f"{ORG_URL}/agency/creators",
            headers=_auth(setup_data["agency_token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 0
        assert data["items"] == []

    @pytest.mark.asyncio
    async def test_list_pending_creator_invites_after_invite(self, client: AsyncClient, setup_data):
        """Creator sees a pending agency invite after it is sent."""
        await _send_creator_invite(client, setup_data)

        resp = await client.get(
            f"{ORG_URL}/creator/invites",
            headers=_auth(setup_data["creator_token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        invite = data["items"][0]
        assert invite["agency_id"] == setup_data["agency_id"]
        assert invite["agency_name"] == "TestAgency"

    @pytest.mark.asyncio
    async def test_invite_creator_duplicate(self, client: AsyncClient, setup_data):
        """Inviting the same creator twice returns 400."""
        await _send_creator_invite(client, setup_data)

        # Duplicate invite
        resp2 = await client.post(
            f"{ORG_URL}/agency/creators",
            json={"creator_id": setup_data["creator_id"]},
            headers=_auth(setup_data["agency_token"]),
        )
        assert resp2.status_code == 400

    @pytest.mark.asyncio
    async def test_invite_nonexistent_creator(self, client: AsyncClient, setup_data):
        """Inviting a non-existent creator returns 404."""
        resp = await client.post(
            f"{ORG_URL}/agency/creators",
            json={"creator_id": "CR000000"},
            headers=_auth(setup_data["agency_token"]),
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_remove_creator_happy_path(self, client: AsyncClient, setup_data):
        """Agency can remove an invited creator."""
        await _accept_creator_invite(client, setup_data)

        # Remove
        resp = await client.delete(
            f"{ORG_URL}/agency/creators/{setup_data['creator_id']}",
            headers=_auth(setup_data["agency_token"]),
        )
        assert resp.status_code == 200
        assert "message" in resp.json()

        # Verify list is empty
        resp = await client.get(
            f"{ORG_URL}/agency/creators",
            headers=_auth(setup_data["agency_token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["total"] == 0

    @pytest.mark.asyncio
    async def test_remove_nonexistent_creator(self, client: AsyncClient, setup_data):
        """Removing a non-associated creator still returns 200 (idempotent)."""
        resp = await client.delete(
            f"{ORG_URL}/agency/creators/CR000000",
            headers=_auth(setup_data["agency_token"]),
        )
        assert resp.status_code == 200


# ===========================================================================
# Test class: Agency-Brands
# ===========================================================================

class TestAgencyBrands:
    """Agency views associated brands."""

    @pytest.mark.asyncio
    async def test_list_brands_empty(self, client: AsyncClient, setup_data):
        """Agency with no brand associations sees an empty list."""
        resp = await client.get(
            f"{ORG_URL}/agency/brands",
            headers=_auth(setup_data["agency_token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["items"] == []
        assert data["total"] == 0

    @pytest.mark.asyncio
    async def test_list_brands_after_invite(self, client: AsyncClient, setup_data):
        """Agency sees the brand in its list only after accepting the invite."""
        await _accept_brand_invite(client, setup_data)

        # Agency lists its brands
        resp = await client.get(
            f"{ORG_URL}/agency/brands",
            headers=_auth(setup_data["agency_token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert len(data["items"]) == 1
        brand_item = data["items"][0]
        assert brand_item["id"] == setup_data["brand_id"]
        assert brand_item["name"] == "TestBrand"

    @pytest.mark.asyncio
    async def test_list_brands_after_removal(self, client: AsyncClient, setup_data):
        """After brand removes the agency, the agency no longer sees the brand."""
        await _accept_brand_invite(client, setup_data)
        await client.delete(
            f"{ORG_URL}/brand/agencies/{setup_data['agency_id']}",
            headers=_auth(setup_data["brand_token"]),
        )

        # Agency lists its brands -- should be empty
        resp = await client.get(
            f"{ORG_URL}/agency/brands",
            headers=_auth(setup_data["agency_token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["total"] == 0

    @pytest.mark.asyncio
    async def test_list_brands_multiple(self, client: AsyncClient, setup_data):
        """Agency can be associated with multiple brands."""
        # Register a second brand
        brand2_token, brand2_user = await _register(client, "brand", "SecondBrand")
        brand2_id = brand2_user["brand_id"]

        # Two brands send invites
        await _send_brand_invite(client, setup_data)
        resp2 = await client.post(
            f"{ORG_URL}/brand/agencies",
            json={"agency_id": setup_data["agency_id"]},
            headers=_auth(brand2_token),
        )
        assert resp2.status_code == 201

        # Agency accepts both invites
        resp = await client.get(
            f"{ORG_URL}/agency/brand-invites",
            headers=_auth(setup_data["agency_token"]),
        )
        assert resp.status_code == 200
        invites = resp.json()["items"]
        assert len(invites) == 2
        for invite in invites:
            accept_resp = await client.post(
                f"{ORG_URL}/agency/brand-invites/{invite['id']}/accept",
                headers=_auth(setup_data["agency_token"]),
            )
            assert accept_resp.status_code == 200

        # Agency should see both brands
        resp = await client.get(
            f"{ORG_URL}/agency/brands",
            headers=_auth(setup_data["agency_token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2
        brand_ids = {item["id"] for item in data["items"]}
        assert setup_data["brand_id"] in brand_ids
        assert brand2_id in brand_ids


# ===========================================================================
# Test class: Organization Search
# ===========================================================================

class TestOrganizationSearch:
    """Search agencies and creators by keyword."""

    @pytest.mark.asyncio
    async def test_search_agencies_by_name(self, client: AsyncClient, setup_data):
        """Searching agencies by keyword finds matching results."""
        resp = await client.get(
            f"{ORG_URL}/search/agencies?keyword=TestAgency",
            headers=_auth(setup_data["brand_token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] >= 1
        names = [item["name"] for item in data["items"]]
        assert any("TestAgency" in n for n in names)

    @pytest.mark.asyncio
    async def test_search_agencies_partial_match(self, client: AsyncClient, setup_data):
        """Search is case-insensitive and supports partial keyword match."""
        resp = await client.get(
            f"{ORG_URL}/search/agencies?keyword=testagency",
            headers=_auth(setup_data["brand_token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] >= 1

    @pytest.mark.asyncio
    async def test_search_agencies_no_results(self, client: AsyncClient, setup_data):
        """Searching with a non-matching keyword returns empty results."""
        resp = await client.get(
            f"{ORG_URL}/search/agencies?keyword=NonExistentXYZ123",
            headers=_auth(setup_data["brand_token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 0
        assert data["items"] == []

    @pytest.mark.asyncio
    async def test_search_agencies_missing_keyword(self, client: AsyncClient, setup_data):
        """Searching agencies without keyword returns 422 (validation error)."""
        resp = await client.get(
            f"{ORG_URL}/search/agencies",
            headers=_auth(setup_data["brand_token"]),
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_search_creators_by_name(self, client: AsyncClient, setup_data):
        """Searching creators by keyword finds matching results."""
        resp = await client.get(
            f"{ORG_URL}/search/creators?keyword=TestCreator",
            headers=_auth(setup_data["agency_token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] >= 1
        names = [item["name"] for item in data["items"]]
        assert any("TestCreator" in n for n in names)

    @pytest.mark.asyncio
    async def test_search_creators_no_results(self, client: AsyncClient, setup_data):
        """Searching creators with a non-matching keyword returns empty results."""
        resp = await client.get(
            f"{ORG_URL}/search/creators?keyword=NonExistentXYZ123",
            headers=_auth(setup_data["agency_token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 0
        assert data["items"] == []

    @pytest.mark.asyncio
    async def test_search_creators_missing_keyword(self, client: AsyncClient, setup_data):
        """Searching creators without keyword returns 422 (validation error)."""
        resp = await client.get(
            f"{ORG_URL}/search/creators",
            headers=_auth(setup_data["agency_token"]),
        )
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_search_agencies_any_role(self, client: AsyncClient, setup_data):
        """All authenticated roles can search agencies."""
        for token_key in ("brand_token", "agency_token", "creator_token"):
            resp = await client.get(
                f"{ORG_URL}/search/agencies?keyword=Test",
                headers=_auth(setup_data[token_key]),
            )
            assert resp.status_code == 200, (
                f"Search agencies failed for {token_key}: {resp.status_code}"
            )

    @pytest.mark.asyncio
    async def test_search_creators_any_role(self, client: AsyncClient, setup_data):
        """All authenticated roles can search creators."""
        for token_key in ("brand_token", "agency_token", "creator_token"):
            resp = await client.get(
                f"{ORG_URL}/search/creators?keyword=Test",
                headers=_auth(setup_data[token_key]),
            )
            assert resp.status_code == 200, (
                f"Search creators failed for {token_key}: {resp.status_code}"
            )


# ===========================================================================
# Test class: Permission Checks
# ===========================================================================

class TestPermissionChecks:
    """Verify role-based access control and authentication requirements."""

    # --- Unauthenticated access -> 401 ---

    @pytest.mark.asyncio
    async def test_unauthenticated_list_brand_agencies(self, client: AsyncClient):
        """Unauthenticated access to list brand agencies returns 401."""
        resp = await client.get(f"{ORG_URL}/brand/agencies")
        assert resp.status_code in (401, 403)

    @pytest.mark.asyncio
    async def test_unauthenticated_invite_agency(self, client: AsyncClient):
        """Unauthenticated access to invite agency returns 401."""
        resp = await client.post(
            f"{ORG_URL}/brand/agencies",
            json={"agency_id": "AG000000"},
        )
        assert resp.status_code in (401, 403)

    @pytest.mark.asyncio
    async def test_unauthenticated_list_agency_creators(self, client: AsyncClient):
        """Unauthenticated access to list agency creators returns 401."""
        resp = await client.get(f"{ORG_URL}/agency/creators")
        assert resp.status_code in (401, 403)

    @pytest.mark.asyncio
    async def test_unauthenticated_search_agencies(self, client: AsyncClient):
        """Unauthenticated search for agencies returns 401."""
        resp = await client.get(f"{ORG_URL}/search/agencies?keyword=test")
        assert resp.status_code in (401, 403)

    @pytest.mark.asyncio
    async def test_unauthenticated_search_creators(self, client: AsyncClient):
        """Unauthenticated search for creators returns 401."""
        resp = await client.get(f"{ORG_URL}/search/creators?keyword=test")
        assert resp.status_code in (401, 403)

    # --- Wrong role: agency/creator trying brand endpoints -> 403 ---

    @pytest.mark.asyncio
    async def test_agency_cannot_list_brand_agencies(self, client: AsyncClient, setup_data):
        """Agency role cannot access brand's agency list -- expects 403."""
        resp = await client.get(
            f"{ORG_URL}/brand/agencies",
            headers=_auth(setup_data["agency_token"]),
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_creator_cannot_list_brand_agencies(self, client: AsyncClient, setup_data):
        """Creator role cannot access brand's agency list -- expects 403."""
        resp = await client.get(
            f"{ORG_URL}/brand/agencies",
            headers=_auth(setup_data["creator_token"]),
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_agency_cannot_invite_agency(self, client: AsyncClient, setup_data):
        """Agency role cannot invite agency to a brand -- expects 403."""
        resp = await client.post(
            f"{ORG_URL}/brand/agencies",
            json={"agency_id": setup_data["agency_id"]},
            headers=_auth(setup_data["agency_token"]),
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_creator_cannot_invite_agency(self, client: AsyncClient, setup_data):
        """Creator role cannot invite agency to a brand -- expects 403."""
        resp = await client.post(
            f"{ORG_URL}/brand/agencies",
            json={"agency_id": setup_data["agency_id"]},
            headers=_auth(setup_data["creator_token"]),
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_creator_cannot_remove_agency(self, client: AsyncClient, setup_data):
        """Creator role cannot remove agency from a brand -- expects 403."""
        resp = await client.delete(
            f"{ORG_URL}/brand/agencies/{setup_data['agency_id']}",
            headers=_auth(setup_data["creator_token"]),
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_creator_cannot_update_agency_permission(self, client: AsyncClient, setup_data):
        """Creator role cannot update agency permission -- expects 403."""
        resp = await client.put(
            f"{ORG_URL}/brand/agencies/{setup_data['agency_id']}/permission",
            json={"force_pass_enabled": False},
            headers=_auth(setup_data["creator_token"]),
        )
        assert resp.status_code == 403

    # --- Wrong role: brand/creator trying agency endpoints -> 403 ---

    @pytest.mark.asyncio
    async def test_brand_cannot_list_agency_creators(self, client: AsyncClient, setup_data):
        """Brand role cannot access agency's creator list -- expects 403."""
        resp = await client.get(
            f"{ORG_URL}/agency/creators",
            headers=_auth(setup_data["brand_token"]),
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_creator_cannot_list_agency_creators(self, client: AsyncClient, setup_data):
        """Creator role cannot access agency's creator list -- expects 403."""
        resp = await client.get(
            f"{ORG_URL}/agency/creators",
            headers=_auth(setup_data["creator_token"]),
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_brand_cannot_invite_creator(self, client: AsyncClient, setup_data):
        """Brand role cannot invite creator to an agency -- expects 403."""
        resp = await client.post(
            f"{ORG_URL}/agency/creators",
            json={"creator_id": setup_data["creator_id"]},
            headers=_auth(setup_data["brand_token"]),
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_creator_cannot_invite_creator(self, client: AsyncClient, setup_data):
        """Creator role cannot invite another creator to an agency -- expects 403."""
        resp = await client.post(
            f"{ORG_URL}/agency/creators",
            json={"creator_id": setup_data["creator_id"]},
            headers=_auth(setup_data["creator_token"]),
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_brand_cannot_remove_creator(self, client: AsyncClient, setup_data):
        """Brand role cannot remove creator from an agency -- expects 403."""
        resp = await client.delete(
            f"{ORG_URL}/agency/creators/{setup_data['creator_id']}",
            headers=_auth(setup_data["brand_token"]),
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_brand_cannot_list_agency_brands(self, client: AsyncClient, setup_data):
        """Brand role cannot access agency's brand list -- expects 403."""
        resp = await client.get(
            f"{ORG_URL}/agency/brands",
            headers=_auth(setup_data["brand_token"]),
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_creator_cannot_list_agency_brands(self, client: AsyncClient, setup_data):
        """Creator role cannot access agency's brand list -- expects 403."""
        resp = await client.get(
            f"{ORG_URL}/agency/brands",
            headers=_auth(setup_data["creator_token"]),
        )
        assert resp.status_code == 403
