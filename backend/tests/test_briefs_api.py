"""
Briefs API comprehensive tests.

Tests cover the Brief CRUD endpoints under a project:
  - GET  /api/v1/projects/{project_id}/brief   (brand, agency, creator can read)
  - POST /api/v1/projects/{project_id}/brief   (brand only, 201)
  - PUT  /api/v1/projects/{project_id}/brief   (brand only)

Permissions:
  - Brand: full CRUD (create, read, update)
  - Agency: read only (403 on create/update), but only if assigned to project
  - Creator: read only (403 on create/update)
  - Unauthenticated: 401

Uses the SQLite-backed test client from conftest.py.
"""
import json
import uuid
import pytest
from httpx import AsyncClient

from app.api.briefs import _extract_json_from_response
from app.main import app
from app.middleware.rate_limit import RateLimitMiddleware
from tests._logto_test_utils import make_test_logto_token

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
API = "/api/v1"
ONBOARDING_URL = f"{API}/auth/onboarding"
PROJECTS_URL = f"{API}/projects"


def _brief_url(project_id: str) -> str:
    """Return the Brief endpoint URL for a given project."""
    return f"{API}/projects/{project_id}/brief"


def _brief_parse_url(project_id: str) -> str:
    """Return the Brief AI parse endpoint URL for a given project."""
    return f"{API}/projects/{project_id}/brief/parse"


def test_extract_json_from_response_accepts_fenced_json_with_trailing_commas():
    raw = """这里是整理结果：
```json
{
  "product_name": "芝士浓奶铁",
  "target_audience": "咖啡功能派打工人",
  "content_requirements": "突出浓郁口感和通勤场景",
  "selling_points": [{"content": "芝士+咖啡更浓郁", "priority": "core",}],
  "blacklist_words": []
}
```"""

    extracted = _extract_json_from_response(raw)
    parsed = json.loads(extracted)

    assert parsed["product_name"] == "芝士浓奶铁"
    assert parsed["selling_points"][0]["content"] == "芝士+咖啡更浓郁"


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


# ---------------------------------------------------------------------------
# Sample brief payloads
# ---------------------------------------------------------------------------
SAMPLE_BRIEF = {
    "selling_points": [
        {"text": "SPF50+ 防晒", "priority": 1},
        {"text": "轻薄不油腻", "priority": 2},
    ],
    "blacklist_words": [
        {"word": "最好", "reason": "绝对化用语"},
        {"word": "第一", "reason": "绝对化用语"},
    ],
    "competitors": ["竞品A", "竞品B"],
    "brand_tone": "活泼年轻",
    "min_duration": 15,
    "max_duration": 60,
    "other_requirements": "请在视频开头3秒内展示产品",
    "attachments": [],
}


# ---------------------------------------------------------------------------
# Fixture: Brand + Project setup
# ---------------------------------------------------------------------------
@pytest.fixture
async def brand_with_project(client: AsyncClient):
    """
    Register a brand user and create a project.

    Returns a dict with keys:
      brand_token, brand_user, brand_id, project_id
    """
    brand_token, brand_user = await _register(client, "brand", "BriefTestBrand")
    brand_id = brand_user["brand_id"]

    # Brand creates a project
    resp = await client.post(PROJECTS_URL, json={
        "name": "Brief Test Project",
        "description": "Project for brief testing",
    }, headers=_auth(brand_token))
    assert resp.status_code == 201, f"Project creation failed: {resp.text}"
    project_id = resp.json()["id"]

    return {
        "brand_token": brand_token,
        "brand_user": brand_user,
        "brand_id": brand_id,
        "project_id": project_id,
    }


# ===========================================================================
# Test class: Brief Creation
# ===========================================================================

class TestBriefCreation:
    """POST /api/v1/projects/{project_id}/brief"""

    @pytest.mark.asyncio
    async def test_create_brief_happy_path(
        self, client: AsyncClient, brand_with_project
    ):
        """Brand can create a brief -- returns 201 with correct data."""
        setup = brand_with_project
        url = _brief_url(setup["project_id"])

        resp = await client.post(url, json=SAMPLE_BRIEF, headers=_auth(setup["brand_token"]))
        assert resp.status_code == 201

        data = resp.json()
        assert data["id"].startswith("BF")
        assert data["project_id"] == setup["project_id"]
        assert data["brand_tone"] == "活泼年轻"
        assert data["min_duration"] == 15
        assert data["max_duration"] == 60
        assert data["other_requirements"] == "请在视频开头3秒内展示产品"
        assert len(data["selling_points"]) == 2
        assert len(data["blacklist_words"]) == 2
        assert data["competitors"] == ["竞品A", "竞品B"]
        assert data["attachments"] == []
        assert "created_at" in data
        assert "updated_at" in data

    @pytest.mark.asyncio
    async def test_create_brief_minimal_payload(
        self, client: AsyncClient, brand_with_project
    ):
        """Brand can create a brief with minimal fields (all optional)."""
        setup = brand_with_project
        url = _brief_url(setup["project_id"])

        resp = await client.post(url, json={}, headers=_auth(setup["brand_token"]))
        assert resp.status_code == 201

        data = resp.json()
        assert data["id"].startswith("BF")
        assert data["project_id"] == setup["project_id"]
        assert data["selling_points"] is None
        assert data["brand_tone"] is None

    @pytest.mark.asyncio
    async def test_create_brief_duplicate_returns_400(
        self, client: AsyncClient, brand_with_project
    ):
        """Creating a second brief on the same project returns 400."""
        setup = brand_with_project
        url = _brief_url(setup["project_id"])

        # First creation
        resp1 = await client.post(url, json=SAMPLE_BRIEF, headers=_auth(setup["brand_token"]))
        assert resp1.status_code == 201

        # Second creation -- should fail
        resp2 = await client.post(url, json={"brand_tone": "不同调性"}, headers=_auth(setup["brand_token"]))
        assert resp2.status_code == 400
        assert "已有" in resp2.json()["detail"]

    @pytest.mark.asyncio
    async def test_create_brief_agency_forbidden(
        self, client: AsyncClient, brand_with_project
    ):
        """Agency cannot create a brief -- expects 403."""
        setup = brand_with_project
        url = _brief_url(setup["project_id"])

        agency_token, _ = await _register(client, "agency", "AgencyNoBrief")

        resp = await client.post(url, json=SAMPLE_BRIEF, headers=_auth(agency_token))
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_create_brief_creator_forbidden(
        self, client: AsyncClient, brand_with_project
    ):
        """Creator cannot create a brief -- expects 403."""
        setup = brand_with_project
        url = _brief_url(setup["project_id"])

        creator_token, _ = await _register(client, "creator", "CreatorNoBrief")

        resp = await client.post(url, json=SAMPLE_BRIEF, headers=_auth(creator_token))
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_create_brief_nonexistent_project(self, client: AsyncClient):
        """Creating a brief on a nonexistent project returns 404."""
        brand_token, _ = await _register(client, "brand", "BrandNoProject")
        url = _brief_url("PJ000000")

        resp = await client.post(url, json=SAMPLE_BRIEF, headers=_auth(brand_token))
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_create_brief_wrong_brand_project(self, client: AsyncClient):
        """Brand cannot create a brief on another brand's project -- expects 403."""
        # Brand A creates a project
        brand_a_token, _ = await _register(client, "brand", "BrandA")
        resp = await client.post(PROJECTS_URL, json={
            "name": "BrandA Project",
        }, headers=_auth(brand_a_token))
        assert resp.status_code == 201
        project_id = resp.json()["id"]

        # Brand B tries to create a brief on Brand A's project
        brand_b_token, _ = await _register(client, "brand", "BrandB")
        url = _brief_url(project_id)

        resp = await client.post(url, json=SAMPLE_BRIEF, headers=_auth(brand_b_token))
        assert resp.status_code == 403


# ===========================================================================
# Test class: Brief Read
# ===========================================================================

class TestBriefRead:
    """GET /api/v1/projects/{project_id}/brief"""

    @pytest.mark.asyncio
    async def test_get_brief_by_brand(
        self, client: AsyncClient, brand_with_project
    ):
        """Brand can read the brief they created."""
        setup = brand_with_project
        url = _brief_url(setup["project_id"])

        # Create the brief first
        create_resp = await client.post(
            url, json=SAMPLE_BRIEF, headers=_auth(setup["brand_token"])
        )
        assert create_resp.status_code == 201

        # Read it back
        resp = await client.get(url, headers=_auth(setup["brand_token"]))
        assert resp.status_code == 200

        data = resp.json()
        assert data["project_id"] == setup["project_id"]
        assert data["brand_tone"] == "活泼年轻"
        assert data["min_duration"] == 15
        assert data["max_duration"] == 60
        assert len(data["selling_points"]) == 2

    @pytest.mark.asyncio
    async def test_get_brief_404_before_creation(
        self, client: AsyncClient, brand_with_project
    ):
        """Getting a brief that doesn't exist yet returns 404."""
        setup = brand_with_project
        url = _brief_url(setup["project_id"])

        resp = await client.get(url, headers=_auth(setup["brand_token"]))
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_get_brief_creator_can_read(
        self, client: AsyncClient, brand_with_project
    ):
        """Creator can read a brief (read-only access)."""
        setup = brand_with_project
        url = _brief_url(setup["project_id"])

        # Create the brief
        await client.post(url, json=SAMPLE_BRIEF, headers=_auth(setup["brand_token"]))

        # Creator reads
        creator_token, _ = await _register(client, "creator", "CreatorReader")
        resp = await client.get(url, headers=_auth(creator_token))
        assert resp.status_code == 200
        assert resp.json()["brand_tone"] == "活泼年轻"

    @pytest.mark.asyncio
    async def test_get_brief_nonexistent_project(self, client: AsyncClient):
        """Getting a brief on a nonexistent project returns 404."""
        brand_token, _ = await _register(client, "brand")
        url = _brief_url("PJ000000")

        resp = await client.get(url, headers=_auth(brand_token))
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_get_brief_wrong_brand(
        self, client: AsyncClient, brand_with_project
    ):
        """Another brand cannot read this brand's project brief -- expects 403."""
        setup = brand_with_project
        url = _brief_url(setup["project_id"])

        # Create the brief
        await client.post(url, json=SAMPLE_BRIEF, headers=_auth(setup["brand_token"]))

        # Another brand tries to read
        other_brand_token, _ = await _register(client, "brand", "OtherBrand")
        resp = await client.get(url, headers=_auth(other_brand_token))
        assert resp.status_code == 403


# ===========================================================================
# Test class: Brief Update
# ===========================================================================

class TestBriefUpdate:
    """PUT /api/v1/projects/{project_id}/brief"""

    @pytest.mark.asyncio
    async def test_update_brief_brand_tone(
        self, client: AsyncClient, brand_with_project
    ):
        """Brand can update the brand_tone field."""
        setup = brand_with_project
        url = _brief_url(setup["project_id"])

        # Create
        await client.post(url, json=SAMPLE_BRIEF, headers=_auth(setup["brand_token"]))

        # Update
        resp = await client.put(
            url,
            json={"brand_tone": "高端大气"},
            headers=_auth(setup["brand_token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["brand_tone"] == "高端大气"

    @pytest.mark.asyncio
    async def test_update_brief_selling_points(
        self, client: AsyncClient, brand_with_project
    ):
        """Brand can update selling_points list."""
        setup = brand_with_project
        url = _brief_url(setup["project_id"])

        # Create
        await client.post(url, json=SAMPLE_BRIEF, headers=_auth(setup["brand_token"]))

        new_selling_points = [
            {"text": "新卖点A", "priority": 1},
        ]
        resp = await client.put(
            url,
            json={"selling_points": new_selling_points},
            headers=_auth(setup["brand_token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["selling_points"]) == 1
        assert data["selling_points"][0]["text"] == "新卖点A"

    @pytest.mark.asyncio
    async def test_update_brief_duration_range(
        self, client: AsyncClient, brand_with_project
    ):
        """Brand can update min/max duration."""
        setup = brand_with_project
        url = _brief_url(setup["project_id"])

        # Create
        await client.post(url, json=SAMPLE_BRIEF, headers=_auth(setup["brand_token"]))

        resp = await client.put(
            url,
            json={"min_duration": 30, "max_duration": 120},
            headers=_auth(setup["brand_token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["min_duration"] == 30
        assert data["max_duration"] == 120

    @pytest.mark.asyncio
    async def test_update_brief_preserves_unchanged_fields(
        self, client: AsyncClient, brand_with_project
    ):
        """Updating one field does not affect other fields."""
        setup = brand_with_project
        url = _brief_url(setup["project_id"])

        # Create with full payload
        await client.post(url, json=SAMPLE_BRIEF, headers=_auth(setup["brand_token"]))

        # Update only brand_tone
        resp = await client.put(
            url,
            json={"brand_tone": "新调性"},
            headers=_auth(setup["brand_token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["brand_tone"] == "新调性"
        # Other fields should remain unchanged
        assert data["min_duration"] == 15
        assert data["max_duration"] == 60
        assert data["competitors"] == ["竞品A", "竞品B"]

    @pytest.mark.asyncio
    async def test_update_brief_404_before_creation(
        self, client: AsyncClient, brand_with_project
    ):
        """Updating a brief that doesn't exist returns 404."""
        setup = brand_with_project
        url = _brief_url(setup["project_id"])

        resp = await client.put(
            url,
            json={"brand_tone": "不存在的"},
            headers=_auth(setup["brand_token"]),
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_update_brief_agency_forbidden(
        self, client: AsyncClient, brand_with_project
    ):
        """Agency cannot update a brief -- expects 403."""
        setup = brand_with_project
        url = _brief_url(setup["project_id"])

        # Create the brief
        await client.post(url, json=SAMPLE_BRIEF, headers=_auth(setup["brand_token"]))

        # Agency tries to update
        agency_token, _ = await _register(client, "agency", "AgencyNoUpdate")
        resp = await client.put(
            url,
            json={"brand_tone": "Agency tone"},
            headers=_auth(agency_token),
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_update_brief_creator_forbidden(
        self, client: AsyncClient, brand_with_project
    ):
        """Creator cannot update a brief -- expects 403."""
        setup = brand_with_project
        url = _brief_url(setup["project_id"])

        # Create the brief
        await client.post(url, json=SAMPLE_BRIEF, headers=_auth(setup["brand_token"]))

        # Creator tries to update
        creator_token, _ = await _register(client, "creator", "CreatorNoUpdate")
        resp = await client.put(
            url,
            json={"brand_tone": "Creator tone"},
            headers=_auth(creator_token),
        )
        assert resp.status_code == 403


# ===========================================================================
# Test class: Brief Permissions
# ===========================================================================

class TestBriefPermissions:
    """Authentication and cross-project permission tests."""

    @pytest.mark.asyncio
    async def test_get_brief_unauthenticated(
        self, client: AsyncClient, brand_with_project
    ):
        """Unauthenticated GET brief returns 401."""
        setup = brand_with_project
        url = _brief_url(setup["project_id"])

        resp = await client.get(url)
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_create_brief_unauthenticated(
        self, client: AsyncClient, brand_with_project
    ):
        """Unauthenticated POST brief returns 401."""
        setup = brand_with_project
        url = _brief_url(setup["project_id"])

        resp = await client.post(url, json=SAMPLE_BRIEF)
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_update_brief_unauthenticated(
        self, client: AsyncClient, brand_with_project
    ):
        """Unauthenticated PUT brief returns 401."""
        setup = brand_with_project
        url = _brief_url(setup["project_id"])

        resp = await client.put(url, json={"brand_tone": "test"})
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_brief_with_invalid_token(
        self, client: AsyncClient, brand_with_project
    ):
        """Request with an invalid Bearer token returns 401."""
        setup = brand_with_project
        url = _brief_url(setup["project_id"])
        headers = {"Authorization": "Bearer invalid-garbage-token"}

        for method_func, kwargs in [
            (client.get, {}),
            (client.post, {"json": SAMPLE_BRIEF}),
            (client.put, {"json": {"brand_tone": "x"}}),
        ]:
            resp = await method_func(url, headers=headers, **kwargs)
            assert resp.status_code == 401, (
                f"Expected 401, got {resp.status_code} for {method_func.__name__}"
            )

    @pytest.mark.asyncio
    async def test_update_brief_wrong_brand(
        self, client: AsyncClient, brand_with_project
    ):
        """Another brand cannot update this brand's project brief -- expects 403."""
        setup = brand_with_project
        url = _brief_url(setup["project_id"])

        # Create the brief
        await client.post(url, json=SAMPLE_BRIEF, headers=_auth(setup["brand_token"]))

        # Another brand tries to update
        other_brand_token, _ = await _register(client, "brand", "WrongBrand")
        resp = await client.put(
            url,
            json={"brand_tone": "Hacker tone"},
            headers=_auth(other_brand_token),
        )
        assert resp.status_code == 403


class TestBriefAIParse:
    """POST /api/v1/projects/{project_id}/brief/parse"""

    @pytest.mark.asyncio
    async def test_parse_brief_retries_when_first_ai_response_is_not_json(
        self, client: AsyncClient, brand_with_project, monkeypatch
    ):
        setup = brand_with_project
        brief_url = _brief_url(setup["project_id"])
        parse_url = _brief_parse_url(setup["project_id"])

        create_resp = await client.post(
            brief_url,
            json={
                "agency_attachments": [
                    {
                        "name": "social-brief.pdf",
                        "url": "uploads/2026/03/files/social-brief.pdf",
                    }
                ]
            },
            headers=_auth(setup["brand_token"]),
        )
        assert create_resp.status_code == 201, create_resp.text

        async def fake_download_and_parse(document_url: str, document_name: str) -> str:
            return (
                "品牌方主推芝士浓奶铁，强调通勤提神和浓郁口感，要求前 3 秒出现产品，"
                "整体语气像真实分享，不能写绝对化和医疗功效。"
            ) * 8

        async def fake_download_and_get_images(document_url: str, document_name: str):
            raise AssertionError("文本模式不应回退到 Vision")

        class FakeAIClient:
            def __init__(self) -> None:
                self.calls = 0

            async def chat_completion(self, messages, model, temperature, max_tokens):
                self.calls += 1
                if self.calls == 1:
                    return type(
                        "FakeResponse",
                        (),
                        {
                            "content": "产品是芝士浓奶铁，目标人群是打工人，重点讲通勤提神和浓郁口感。",
                        },
                    )()
                return type(
                    "FakeResponse",
                    (),
                    {
                        "content": json.dumps(
                            {
                                "product_name": "芝士浓奶铁",
                                "target_audience": "打工人",
                                "content_requirements": "突出通勤提神和浓郁口感",
                                "selling_points": [{"content": "芝士+咖啡更浓郁", "priority": "core"}],
                                "blacklist_words": [],
                                "creative_rubric": None,
                            },
                            ensure_ascii=False,
                        )
                    },
                )()

        fake_ai_client = FakeAIClient()

        async def fake_get_client(tenant_id: str, db):
            return fake_ai_client

        async def fake_get_config(tenant_id: str, db):
            return type("FakeConfig", (), {"models": {"text": "text-model", "vision": "vision-model"}})()

        monkeypatch.setattr("app.services.document_parser.DocumentParser.download_and_parse", fake_download_and_parse)
        monkeypatch.setattr("app.services.document_parser.DocumentParser.download_and_get_images", fake_download_and_get_images)
        monkeypatch.setattr("app.services.ai_service.AIServiceFactory.get_client", fake_get_client)
        monkeypatch.setattr("app.services.ai_service.AIServiceFactory.get_config", fake_get_config)

        parse_resp = await client.post(parse_url, headers=_auth(setup["brand_token"]))
        assert parse_resp.status_code == 200, parse_resp.text
        parsed = parse_resp.json()
        assert fake_ai_client.calls == 2
        assert parsed["product_name"] == "芝士浓奶铁"
        assert parsed["selling_points"][0]["content"] == "芝士+咖啡更浓郁"

    @pytest.mark.asyncio
    async def test_parse_brief_can_succeed_on_third_ai_response(
        self, client: AsyncClient, brand_with_project, monkeypatch
    ):
        setup = brand_with_project
        brief_url = _brief_url(setup["project_id"])
        parse_url = _brief_parse_url(setup["project_id"])

        create_resp = await client.post(
            brief_url,
            json={
                "agency_attachments": [
                    {
                        "name": "social-brief.pdf",
                        "url": "uploads/2026/03/files/social-brief.pdf",
                    }
                ]
            },
            headers=_auth(setup["brand_token"]),
        )
        assert create_resp.status_code == 201, create_resp.text

        async def fake_download_and_parse(document_url: str, document_name: str) -> str:
            return (
                "品牌方主推芝士浓奶铁，强调通勤提神和浓郁口感，要求前 3 秒出现产品，"
                "整体语气像真实分享，不能写绝对化和医疗功效。"
            ) * 8

        async def fake_download_and_get_images(document_url: str, document_name: str):
            raise AssertionError("文本模式不应回退到 Vision")

        class FakeAIClient:
            def __init__(self) -> None:
                self.calls = 0

            async def chat_completion(self, messages, model, temperature, max_tokens):
                self.calls += 1
                if self.calls == 1:
                    return type("FakeResponse", (), {"content": "先讲产品，再讲卖点和限制词。"})()
                if self.calls == 2:
                    return type(
                        "FakeResponse",
                        (),
                        {
                            "content": """```json
{"product_name":"芝士浓奶铁","target_audience":"打工人","content_requirements":"突出通勤提神"
```""",
                        },
                    )()
                return type(
                    "FakeResponse",
                    (),
                    {
                        "content": json.dumps(
                            {
                                "product_name": "芝士浓奶铁",
                                "target_audience": "打工人",
                                "content_requirements": "突出通勤提神和浓郁口感",
                                "selling_points": [{"content": "芝士+咖啡更浓郁", "priority": "core"}],
                                "blacklist_words": [{"word": "最好", "reason": "绝对化"}],
                                "creative_rubric": None,
                            },
                            ensure_ascii=False,
                        )
                    },
                )()

        fake_ai_client = FakeAIClient()

        async def fake_get_client(tenant_id: str, db):
            return fake_ai_client

        async def fake_get_config(tenant_id: str, db):
            return type("FakeConfig", (), {"models": {"text": "text-model", "vision": "vision-model"}})()

        monkeypatch.setattr("app.services.document_parser.DocumentParser.download_and_parse", fake_download_and_parse)
        monkeypatch.setattr("app.services.document_parser.DocumentParser.download_and_get_images", fake_download_and_get_images)
        monkeypatch.setattr("app.services.ai_service.AIServiceFactory.get_client", fake_get_client)
        monkeypatch.setattr("app.services.ai_service.AIServiceFactory.get_config", fake_get_config)

        parse_resp = await client.post(parse_url, headers=_auth(setup["brand_token"]))
        assert parse_resp.status_code == 200, parse_resp.text
        parsed = parse_resp.json()
        assert fake_ai_client.calls == 3
        assert parsed["product_name"] == "芝士浓奶铁"
        assert parsed["blacklist_words"][0]["word"] == "最好"

    @pytest.mark.asyncio
    async def test_parse_brief_accepts_compact_string_arrays(
        self, client: AsyncClient, brand_with_project, monkeypatch
    ):
        setup = brand_with_project
        brief_url = _brief_url(setup["project_id"])
        parse_url = _brief_parse_url(setup["project_id"])

        create_resp = await client.post(
            brief_url,
            json={
                "agency_attachments": [
                    {
                        "name": "social-brief.docx",
                        "url": "uploads/2026/03/files/social-brief.docx",
                    }
                ]
            },
            headers=_auth(setup["brand_token"]),
        )
        assert create_resp.status_code == 201, create_resp.text

        async def fake_download_and_parse(document_url: str, document_name: str) -> str:
            return "主推芝士浓奶铁，适合通勤打工人，避免绝对化表达。"

        async def fake_download_and_get_images(document_url: str, document_name: str):
            raise AssertionError("文本模式不应回退到 Vision")

        class FakeAIClient:
            async def chat_completion(self, messages, model, temperature, max_tokens):
                return type(
                    "FakeResponse",
                    (),
                    {
                        "content": json.dumps(
                            {
                                "product_name": "芝士浓奶铁",
                                "target_audience": "通勤打工人",
                                "content_requirements": "突出提神和浓郁口感",
                                "selling_points": ["芝士+咖啡更浓郁", "通勤提神"],
                                "blacklist_words": ["最好", "第一"],
                            },
                            ensure_ascii=False,
                        )
                    },
                )()

        async def fake_get_client(tenant_id: str, db):
            return FakeAIClient()

        async def fake_get_config(tenant_id: str, db):
            return type("FakeConfig", (), {"models": {"text": "text-model", "vision": "vision-model"}})()

        monkeypatch.setattr("app.services.document_parser.DocumentParser.download_and_parse", fake_download_and_parse)
        monkeypatch.setattr("app.services.document_parser.DocumentParser.download_and_get_images", fake_download_and_get_images)
        monkeypatch.setattr("app.services.ai_service.AIServiceFactory.get_client", fake_get_client)
        monkeypatch.setattr("app.services.ai_service.AIServiceFactory.get_config", fake_get_config)

        parse_resp = await client.post(parse_url, headers=_auth(setup["brand_token"]))
        assert parse_resp.status_code == 200, parse_resp.text
        parsed = parse_resp.json()
        assert parsed["selling_points"][0]["content"] == "芝士+咖啡更浓郁"
        assert parsed["selling_points"][0]["priority"] == "recommended"
        assert parsed["blacklist_words"][0]["word"] == "最好"
        assert parsed["blacklist_words"][0]["reason"] == ""

    @pytest.mark.asyncio
    async def test_parse_brief_prefers_text_when_pdf_has_enough_content(
        self, client: AsyncClient, brand_with_project, monkeypatch
    ):
        setup = brand_with_project
        brief_url = _brief_url(setup["project_id"])
        parse_url = _brief_parse_url(setup["project_id"])

        create_resp = await client.post(
            brief_url,
            json={
                "agency_attachments": [
                    {
                        "name": "social-brief.pdf",
                        "url": "uploads/2026/03/files/social-brief.pdf",
                    }
                ]
            },
            headers=_auth(setup["brand_token"]),
        )
        assert create_resp.status_code == 201, create_resp.text

        extracted_text = "\n".join(
            [
                "McDonald's Social Brief",
                "主推芝士浓奶铁，强调浓郁、提神和通勤场景。",
                "目标人群是打工人咖啡功能派。",
                "不能写绝对化和医疗功效。",
            ]
        ) * 30

        async def fake_download_and_parse(document_url: str, document_name: str) -> str:
            assert document_name == "social-brief.pdf"
            return extracted_text

        async def fake_download_and_get_images(document_url: str, document_name: str):
            raise AssertionError("文本足够时不应回退到 Vision 图片解析")

        class FakeAIClient:
            def __init__(self) -> None:
                self.calls: list[dict] = []

            async def chat_completion(self, messages, model, temperature, max_tokens):
                self.calls.append(
                    {
                        "messages": messages,
                        "model": model,
                        "temperature": temperature,
                        "max_tokens": max_tokens,
                    }
                )
                return type(
                    "FakeResponse",
                    (),
                    {
                        "content": json.dumps(
                            {
                                "product_name": "芝士浓奶铁",
                                "target_audience": "咖啡功能派打工人",
                                "content_requirements": "突出浓郁口感和提神场景，避免绝对化表达。",
                                "selling_points": [{"content": "芝士+咖啡更浓郁", "priority": "core"}],
                                "blacklist_words": [{"word": "最强", "reason": "绝对化用语"}],
                            },
                            ensure_ascii=False,
                        )
                    },
                )()

        fake_ai_client = FakeAIClient()

        async def fake_get_client(tenant_id: str, db):
            assert tenant_id == setup["brand_id"]
            return fake_ai_client

        async def fake_get_config(tenant_id: str, db):
            return type("FakeConfig", (), {"models": {"text": "text-model", "vision": "vision-model"}})()

        monkeypatch.setattr("app.services.document_parser.DocumentParser.download_and_parse", fake_download_and_parse)
        monkeypatch.setattr("app.services.document_parser.DocumentParser.download_and_get_images", fake_download_and_get_images)
        monkeypatch.setattr("app.services.ai_service.AIServiceFactory.get_client", fake_get_client)
        monkeypatch.setattr("app.services.ai_service.AIServiceFactory.get_config", fake_get_config)

        parse_resp = await client.post(parse_url, headers=_auth(setup["brand_token"]))
        assert parse_resp.status_code == 200, parse_resp.text
        parsed = parse_resp.json()
        assert parsed["product_name"] == "芝士浓奶铁"
        assert parsed["selling_points"][0]["content"] == "芝士+咖啡更浓郁"
        assert fake_ai_client.calls[0]["model"] == "text-model"
        assert isinstance(fake_ai_client.calls[0]["messages"][0]["content"], str)
        assert "McDonald's Social Brief" in fake_ai_client.calls[0]["messages"][0]["content"]

    @pytest.mark.asyncio
    async def test_parse_brief_falls_back_to_vision_when_pdf_text_is_too_short(
        self, client: AsyncClient, brand_with_project, monkeypatch
    ):
        setup = brand_with_project
        brief_url = _brief_url(setup["project_id"])
        parse_url = _brief_parse_url(setup["project_id"])

        create_resp = await client.post(
            brief_url,
            json={
                "agency_attachments": [
                    {
                        "name": "scan-brief.pdf",
                        "url": "uploads/2026/03/files/scan-brief.pdf",
                    }
                ]
            },
            headers=_auth(setup["brand_token"]),
        )
        assert create_resp.status_code == 201, create_resp.text

        async def fake_download_and_parse(document_url: str, document_name: str) -> str:
            return "封面"

        async def fake_download_and_get_images(document_url: str, document_name: str):
            return ["ZmFrZS1pbWFnZS0x"]

        class FakeAIClient:
            def __init__(self) -> None:
                self.calls: list[dict] = []

            async def chat_completion(self, messages, model, temperature, max_tokens):
                self.calls.append({"messages": messages, "model": model})
                return type(
                    "FakeResponse",
                    (),
                    {
                        "content": json.dumps(
                            {
                                "product_name": "扫描版 Brief",
                                "target_audience": "",
                                "content_requirements": "",
                                "selling_points": [],
                                "blacklist_words": [],
                            },
                            ensure_ascii=False,
                        )
                    },
                )()

        fake_ai_client = FakeAIClient()

        async def fake_get_client(tenant_id: str, db):
            return fake_ai_client

        async def fake_get_config(tenant_id: str, db):
            return type("FakeConfig", (), {"models": {"text": "text-model", "vision": "vision-model"}})()

        monkeypatch.setattr("app.services.document_parser.DocumentParser.download_and_parse", fake_download_and_parse)
        monkeypatch.setattr("app.services.document_parser.DocumentParser.download_and_get_images", fake_download_and_get_images)
        monkeypatch.setattr("app.services.ai_service.AIServiceFactory.get_client", fake_get_client)
        monkeypatch.setattr("app.services.ai_service.AIServiceFactory.get_config", fake_get_config)

        parse_resp = await client.post(parse_url, headers=_auth(setup["brand_token"]))
        assert parse_resp.status_code == 200, parse_resp.text
        assert fake_ai_client.calls[0]["model"] == "vision-model"
        assert isinstance(fake_ai_client.calls[0]["messages"][0]["content"], list)
        assert fake_ai_client.calls[0]["messages"][0]["content"][1]["type"] == "image_url"
