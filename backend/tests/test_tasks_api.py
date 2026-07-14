"""
Tasks API comprehensive tests.

Tests cover the full task lifecycle:
  - Task creation (agency role)
  - Task listing (role-based filtering)
  - Script/video upload (creator role)
  - Agency/brand review flow (pass, reject, force_pass)
  - Appeal submission (creator role)
  - Appeal count adjustment (agency role)
  - Permission / role checks (403 for wrong roles)

Uses the SQLite-backed test client from conftest.py.

NOTE: SQLite does not enforce FK constraints by default.  The tests rely on
application-level validation instead.  Some PostgreSQL-only features (e.g.
JSONB operators) are avoided.
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
TASKS_URL = f"{API}/tasks"
PROJECTS_URL = f"{API}/projects"


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
    # The middleware stack is lazily built.  Walk through it to find our
    # RateLimitMiddleware instance and clear its request log.
    mw = app.middleware_stack
    while mw is not None:
        if isinstance(mw, RateLimitMiddleware):
            mw.requests.clear()
            break
        # BaseHTTPMiddleware wraps the next app in `self.app`
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
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201, f"Onboarding failed for {role}: {resp.text}"
    return token, resp.json()


def _auth(token: str) -> dict:
    """Return Authorization header dict."""
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Fixture: full scenario data
# ---------------------------------------------------------------------------
@pytest.fixture
async def setup_data(client: AsyncClient):
    """
    Create brand, agency, creator users + a project + task prerequisites.

    Returns a dict with keys:
      brand_token, brand_user, brand_id,
      agency_token, agency_user, agency_id,
      creator_token, creator_user, creator_id,
      project_id
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

    # 4. Brand creates a project
    # NOTE: We do NOT pass agency_ids here because the SQLite async test DB
    # triggers a MissingGreenlet error on lazy-loading the many-to-many
    # relationship inside Project.agencies.append().  The tasks API does not
    # validate project-agency assignment, so skipping this is safe for tests.
    resp = await client.post(PROJECTS_URL, json={
        "name": "Test Project",
        "description": "Integration test project",
    }, headers=_auth(brand_token))
    assert resp.status_code == 201, f"Project creation failed: {resp.text}"
    project_id = resp.json()["id"]

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
        "project_id": project_id,
    }


# ---------------------------------------------------------------------------
# Helper: create a task through the API (agency action)
# ---------------------------------------------------------------------------
async def _create_task(client: AsyncClient, setup: dict, name: str | None = None):
    """Create a task and return the response JSON."""
    body = {
        "project_id": setup["project_id"],
        "creator_id": setup["creator_id"],
    }
    if name:
        body["name"] = name
    resp = await client.post(
        TASKS_URL,
        json=body,
        headers=_auth(setup["agency_token"]),
    )
    assert resp.status_code == 201, f"Task creation failed: {resp.text}"
    return resp.json()


# ===========================================================================
# Test class: Task Creation
# ===========================================================================

class TestTaskCreation:
    """POST /api/v1/tasks"""

    @pytest.mark.asyncio
    async def test_create_task_happy_path(self, client: AsyncClient, setup_data):
        """Agency can create a task -- returns 201 with correct defaults."""
        data = await _create_task(client, setup_data)

        assert data["id"].startswith("TK")
        assert data["stage"] == "script_upload"
        assert data["sequence"] == 1
        assert data["appeal_count"] == 1
        assert data["is_appeal"] is False
        assert data["project"]["id"] == setup_data["project_id"]
        assert data["agency"]["id"] == setup_data["agency_id"]
        assert data["creator"]["id"] == setup_data["creator_id"]

    @pytest.mark.asyncio
    async def test_create_task_auto_name(self, client: AsyncClient, setup_data):
        """When name is omitted, auto-generates name like '{项目名} 任务1'."""
        data = await _create_task(client, setup_data)
        assert data["name"] == "Test Project 任务1"

    @pytest.mark.asyncio
    async def test_create_task_custom_name(self, client: AsyncClient, setup_data):
        """Custom name is preserved."""
        data = await _create_task(client, setup_data, name="My Custom Task")
        assert data["name"] == "My Custom Task"

    @pytest.mark.asyncio
    async def test_create_task_sequence_increments(self, client: AsyncClient, setup_data):
        """Creating multiple tasks for same project+creator increments sequence."""
        t1 = await _create_task(client, setup_data)
        t2 = await _create_task(client, setup_data)
        assert t2["sequence"] == t1["sequence"] + 1

    @pytest.mark.asyncio
    async def test_create_task_nonexistent_project(self, client: AsyncClient, setup_data):
        """Creating a task with invalid project_id returns 404."""
        resp = await client.post(TASKS_URL, json={
            "project_id": "PJ000000",
            "creator_id": setup_data["creator_id"],
        }, headers=_auth(setup_data["agency_token"]))
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_create_task_nonexistent_creator(self, client: AsyncClient, setup_data):
        """Creating a task with invalid creator_id returns 404."""
        resp = await client.post(TASKS_URL, json={
            "project_id": setup_data["project_id"],
            "creator_id": "CR000000",
        }, headers=_auth(setup_data["agency_token"]))
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_create_task_forbidden_for_brand(self, client: AsyncClient, setup_data):
        """Brand role cannot create tasks -- expects 403."""
        resp = await client.post(TASKS_URL, json={
            "project_id": setup_data["project_id"],
            "creator_id": setup_data["creator_id"],
        }, headers=_auth(setup_data["brand_token"]))
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_create_task_forbidden_for_creator(self, client: AsyncClient, setup_data):
        """Creator role cannot create tasks -- expects 403."""
        resp = await client.post(TASKS_URL, json={
            "project_id": setup_data["project_id"],
            "creator_id": setup_data["creator_id"],
        }, headers=_auth(setup_data["creator_token"]))
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_create_task_unauthenticated(self, client: AsyncClient):
        """Unauthenticated request returns 401."""
        resp = await client.post(TASKS_URL, json={
            "project_id": "PJ000000",
            "creator_id": "CR000000",
        })
        assert resp.status_code in (401, 403)


# ===========================================================================
# Test class: Task Listing
# ===========================================================================

class TestTaskListing:
    """GET /api/v1/tasks"""

    @pytest.mark.asyncio
    async def test_list_tasks_as_agency(self, client: AsyncClient, setup_data):
        """Agency sees tasks they created."""
        await _create_task(client, setup_data)

        resp = await client.get(TASKS_URL, headers=_auth(setup_data["agency_token"]))
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] >= 1
        assert len(data["items"]) >= 1
        assert data["page"] == 1

    @pytest.mark.asyncio
    async def test_list_tasks_as_creator(self, client: AsyncClient, setup_data):
        """Creator sees tasks assigned to them."""
        await _create_task(client, setup_data)

        resp = await client.get(TASKS_URL, headers=_auth(setup_data["creator_token"]))
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] >= 1

    @pytest.mark.asyncio
    async def test_list_tasks_as_brand(self, client: AsyncClient, setup_data):
        """Brand sees tasks belonging to their projects."""
        await _create_task(client, setup_data)

        resp = await client.get(TASKS_URL, headers=_auth(setup_data["brand_token"]))
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] >= 1

    @pytest.mark.asyncio
    async def test_list_tasks_filter_by_stage(self, client: AsyncClient, setup_data):
        """Stage filter narrows results."""
        await _create_task(client, setup_data)

        # Filter for script_upload -- should find the task
        resp = await client.get(
            f"{TASKS_URL}?stage=script_upload",
            headers=_auth(setup_data["agency_token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] >= 1

        # Filter for completed -- should be empty
        resp2 = await client.get(
            f"{TASKS_URL}?stage=completed",
            headers=_auth(setup_data["agency_token"]),
        )
        assert resp2.status_code == 200
        assert resp2.json()["total"] == 0


# ===========================================================================
# Test class: Task Detail
# ===========================================================================

class TestTaskDetail:
    """GET /api/v1/tasks/{task_id}"""

    @pytest.mark.asyncio
    async def test_get_task_detail(self, client: AsyncClient, setup_data):
        """All three roles can view the task detail."""
        task = await _create_task(client, setup_data)
        task_id = task["id"]

        for token_key in ("agency_token", "creator_token", "brand_token"):
            resp = await client.get(
                f"{TASKS_URL}/{task_id}",
                headers=_auth(setup_data[token_key]),
            )
            assert resp.status_code == 200, (
                f"Failed for {token_key}: {resp.status_code} {resp.text}"
            )
            assert resp.json()["id"] == task_id

    @pytest.mark.asyncio
    async def test_get_nonexistent_task(self, client: AsyncClient, setup_data):
        """Requesting a nonexistent task returns 404."""
        resp = await client.get(
            f"{TASKS_URL}/TK000000",
            headers=_auth(setup_data["agency_token"]),
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_get_task_detail_includes_video_brand_exposure(
        self, client: AsyncClient, setup_data, test_db_session
    ):
        """任务详情接口保留 video_ai_result.brand_exposure 字段"""
        task = await _create_task(client, setup_data)
        task_id = task["id"]

        from app.models.task import Task, TaskStage
        from sqlalchemy import update

        brand_exposure = {
            "score": 82,
            "level": "medium",
            "analysis": "品牌相关表达覆盖较完整",
            "visible_duration_seconds": 3.0,
            "mention_duration_seconds": 1.5,
            "related_duration_seconds": 5.5,
            "evidence": ["封面露出产品", "中段口播提及品牌"],
        }
        await test_db_session.execute(
            update(Task)
            .where(Task.id == task_id)
            .values(
                stage=TaskStage.VIDEO_AGENCY_REVIEW,
                video_ai_score=82,
                video_ai_result={
                    "score": 82,
                    "summary": "品牌曝光正常",
                    "violations": [],
                    "soft_warnings": [],
                    "brand_exposure": brand_exposure,
                },
            )
        )
        await test_db_session.commit()

        resp = await client.get(
            f"{TASKS_URL}/{task_id}",
            headers=_auth(setup_data["agency_token"]),
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["video_ai_result"]["brand_exposure"] == brand_exposure

    @pytest.mark.asyncio
    async def test_get_task_forbidden_other_agency(self, client: AsyncClient, setup_data):
        """An unrelated agency cannot view the task -- expects 403."""
        task = await _create_task(client, setup_data)
        task_id = task["id"]

        # Register another agency
        other_token, _ = await _register(client, "agency", "OtherAgency")
        resp = await client.get(
            f"{TASKS_URL}/{task_id}",
            headers=_auth(other_token),
        )
        assert resp.status_code == 403


# ===========================================================================
# Test class: Script Upload
# ===========================================================================

class TestScriptUpload:
    """POST /api/v1/tasks/{task_id}/script"""

    @pytest.mark.asyncio
    async def test_upload_script_happy_path(self, client: AsyncClient, setup_data):
        """Creator uploads a script -- stage advances to script_ai_review."""
        task = await _create_task(client, setup_data)
        task_id = task["id"]
        assert task["stage"] == "script_upload"

        resp = await client.post(
            f"{TASKS_URL}/{task_id}/script",
            json={
                "file_url": "https://oss.example.com/script.docx",
                "file_name": "script.docx",
            },
            headers=_auth(setup_data["creator_token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["stage"] == "script_ai_review"
        assert data["script_file_url"] == "https://oss.example.com/script.docx"
        assert data["script_file_name"] == "script.docx"

    @pytest.mark.asyncio
    async def test_upload_script_wrong_role(self, client: AsyncClient, setup_data):
        """Agency cannot upload script -- expects 403."""
        task = await _create_task(client, setup_data)
        task_id = task["id"]

        resp = await client.post(
            f"{TASKS_URL}/{task_id}/script",
            json={
                "file_url": "https://oss.example.com/script.docx",
                "file_name": "script.docx",
            },
            headers=_auth(setup_data["agency_token"]),
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_upload_script_wrong_creator(self, client: AsyncClient, setup_data):
        """A different creator cannot upload script to someone else's task."""
        task = await _create_task(client, setup_data)
        task_id = task["id"]

        # Register another creator
        other_token, _ = await _register(client, "creator", "OtherCreator")

        resp = await client.post(
            f"{TASKS_URL}/{task_id}/script",
            json={
                "file_url": "https://oss.example.com/script.docx",
                "file_name": "script.docx",
            },
            headers=_auth(other_token),
        )
        assert resp.status_code == 403


# ===========================================================================
# Test class: Video Upload
# ===========================================================================

class TestVideoUpload:
    """POST /api/v1/tasks/{task_id}/video"""

    @pytest.mark.asyncio
    async def test_upload_video_wrong_stage(self, client: AsyncClient, setup_data):
        """Uploading video when task is in script_upload stage returns 400."""
        task = await _create_task(client, setup_data)
        task_id = task["id"]

        resp = await client.post(
            f"{TASKS_URL}/{task_id}/video",
            json={
                "file_url": "https://oss.example.com/video.mp4",
                "file_name": "video.mp4",
                "duration": 30,
            },
            headers=_auth(setup_data["creator_token"]),
        )
        assert resp.status_code == 400


# ===========================================================================
# Test class: Script Review (Agency)
# ===========================================================================

class TestScriptReviewAgency:
    """POST /api/v1/tasks/{task_id}/script/review (agency)"""

    async def _advance_to_agency_review(self, client: AsyncClient, setup: dict, task_id: str):
        """Helper: upload script, then manually advance to SCRIPT_AGENCY_REVIEW
        by simulating AI review completion via direct DB manipulation.

        Since we cannot easily call the AI review completion endpoint, we use
        the task service directly through the test DB session.

        NOTE: For a pure API-level test we would call an AI-review-complete
        endpoint.  Since that endpoint doesn't exist (AI review is async /
        background), we advance the stage by uploading the script (which moves
        to script_ai_review) and then patching the stage directly.
        """
        # Upload script first
        resp = await client.post(
            f"{TASKS_URL}/{task_id}/script",
            json={
                "file_url": "https://oss.example.com/script.docx",
                "file_name": "script.docx",
            },
            headers=_auth(setup["creator_token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["stage"] == "script_ai_review"

    @pytest.mark.asyncio
    async def test_agency_review_wrong_stage(self, client: AsyncClient, setup_data):
        """Agency cannot review script if task is not in script_agency_review stage."""
        task = await _create_task(client, setup_data)
        task_id = task["id"]

        # Task is in script_upload, try to review
        resp = await client.post(
            f"{TASKS_URL}/{task_id}/script/review",
            json={"action": "pass"},
            headers=_auth(setup_data["agency_token"]),
        )
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_creator_cannot_review_script(self, client: AsyncClient, setup_data):
        """Creator role cannot review scripts -- expects 403."""
        task = await _create_task(client, setup_data)
        task_id = task["id"]

        resp = await client.post(
            f"{TASKS_URL}/{task_id}/script/review",
            json={"action": "pass"},
            headers=_auth(setup_data["creator_token"]),
        )
        assert resp.status_code == 403


# ===========================================================================
# Test class: Full Review Flow (uses DB manipulation for stage advancement)
# ===========================================================================

class TestFullReviewFlow:
    """End-to-end review flow tests using direct DB state manipulation.

    These tests manually set the task stage to simulate AI review completion,
    which is normally done by a background worker / Celery task.
    """

    @pytest.mark.asyncio
    async def test_agency_pass_advances_to_brand_review(
        self, client: AsyncClient, setup_data, test_db_session
    ):
        """Agency passes script review -> task moves to script_brand_review."""
        task = await _create_task(client, setup_data)
        task_id = task["id"]

        # Upload script (moves to script_ai_review)
        await client.post(
            f"{TASKS_URL}/{task_id}/script",
            json={"file_url": "https://x.com/s.docx", "file_name": "s.docx"},
            headers=_auth(setup_data["creator_token"]),
        )

        # Simulate AI review completion: advance stage to script_agency_review
        from app.models.task import Task, TaskStage
        from sqlalchemy import update
        await test_db_session.execute(
            update(Task)
            .where(Task.id == task_id)
            .values(
                stage=TaskStage.SCRIPT_AGENCY_REVIEW,
                script_ai_score=85,
            )
        )
        await test_db_session.commit()

        # Agency passes the review
        resp = await client.post(
            f"{TASKS_URL}/{task_id}/script/review",
            json={"action": "pass", "comment": "Looks good"},
            headers=_auth(setup_data["agency_token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        # Brand has final_review_enabled=True by default, so task should go to brand review
        assert data["stage"] == "script_brand_review"
        assert data["script_agency_status"] == "passed"

    @pytest.mark.asyncio
    async def test_agency_reject_moves_to_upload(
        self, client: AsyncClient, setup_data, test_db_session
    ):
        """Agency rejects script review -> task stage goes back to script_upload."""
        task = await _create_task(client, setup_data)
        task_id = task["id"]

        # Upload script
        await client.post(
            f"{TASKS_URL}/{task_id}/script",
            json={"file_url": "https://x.com/s.docx", "file_name": "s.docx"},
            headers=_auth(setup_data["creator_token"]),
        )

        # Simulate AI review completion
        from app.models.task import Task, TaskStage
        from sqlalchemy import update
        await test_db_session.execute(
            update(Task)
            .where(Task.id == task_id)
            .values(stage=TaskStage.SCRIPT_AGENCY_REVIEW, script_ai_score=40)
        )
        await test_db_session.commit()

        # Agency rejects
        resp = await client.post(
            f"{TASKS_URL}/{task_id}/script/review",
            json={"action": "reject", "comment": "Needs major rework"},
            headers=_auth(setup_data["agency_token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["stage"] == "script_upload"
        assert data["script_agency_status"] == "rejected"

    @pytest.mark.asyncio
    async def test_agency_force_pass_skips_brand_review(
        self, client: AsyncClient, setup_data, test_db_session
    ):
        """Agency force_pass -> task skips brand review, goes to video_upload."""
        task = await _create_task(client, setup_data)
        task_id = task["id"]

        # Upload script
        await client.post(
            f"{TASKS_URL}/{task_id}/script",
            json={"file_url": "https://x.com/s.docx", "file_name": "s.docx"},
            headers=_auth(setup_data["creator_token"]),
        )

        # Simulate AI review completion
        from app.models.task import Task, TaskStage
        from sqlalchemy import update
        await test_db_session.execute(
            update(Task)
            .where(Task.id == task_id)
            .values(stage=TaskStage.SCRIPT_AGENCY_REVIEW, script_ai_score=70)
        )
        await test_db_session.commit()

        # Agency force passes
        resp = await client.post(
            f"{TASKS_URL}/{task_id}/script/review",
            json={"action": "force_pass", "comment": "Override"},
            headers=_auth(setup_data["agency_token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["stage"] == "video_upload"
        assert data["script_agency_status"] == "force_passed"

    @pytest.mark.asyncio
    async def test_brand_pass_script_advances_to_video_upload(
        self, client: AsyncClient, setup_data, test_db_session
    ):
        """Brand passes script review -> task moves to video_upload."""
        task = await _create_task(client, setup_data)
        task_id = task["id"]

        # Advance directly to script_brand_review
        from app.models.task import Task, TaskStage
        from sqlalchemy import update
        await test_db_session.execute(
            update(Task)
            .where(Task.id == task_id)
            .values(stage=TaskStage.SCRIPT_BRAND_REVIEW, script_ai_score=90)
        )
        await test_db_session.commit()

        resp = await client.post(
            f"{TASKS_URL}/{task_id}/script/review",
            json={"action": "pass", "comment": "Approved by brand"},
            headers=_auth(setup_data["brand_token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["stage"] == "video_upload"
        assert data["script_brand_status"] == "passed"

    @pytest.mark.asyncio
    async def test_brand_cannot_force_pass(
        self, client: AsyncClient, setup_data, test_db_session
    ):
        """Brand cannot use force_pass action -- expects 400."""
        task = await _create_task(client, setup_data)
        task_id = task["id"]

        from app.models.task import Task, TaskStage
        from sqlalchemy import update
        await test_db_session.execute(
            update(Task)
            .where(Task.id == task_id)
            .values(stage=TaskStage.SCRIPT_BRAND_REVIEW)
        )
        await test_db_session.commit()

        resp = await client.post(
            f"{TASKS_URL}/{task_id}/script/review",
            json={"action": "force_pass"},
            headers=_auth(setup_data["brand_token"]),
        )
        assert resp.status_code == 400


# ===========================================================================
# Test class: Script Tooling Permissions
# ===========================================================================

class TestScriptToolingPermissions:
    """Permission checks for script tooling endpoints."""

    @pytest.mark.asyncio
    async def test_ai_rewrite_forbidden_for_other_agency(
        self, client: AsyncClient, setup_data, test_db_session
    ):
        """A different agency cannot call AI rewrite on someone else's task."""
        task = await _create_task(client, setup_data)
        task_id = task["id"]

        from app.models.task import Task, TaskStage
        from sqlalchemy import update
        await test_db_session.execute(
            update(Task)
            .where(Task.id == task_id)
            .values(stage=TaskStage.SCRIPT_AGENCY_REVIEW)
        )
        await test_db_session.commit()

        other_token, _ = await _register(client, "agency", "OtherRewriteAgency")
        resp = await client.post(
            f"{TASKS_URL}/{task_id}/script/ai-rewrite",
            json={
                "full_script": "原文脚本",
                "segment": "违规片段",
                "violation_content": "违规片段",
                "suggestion": "建议改写",
            },
            headers=_auth(other_token),
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_apply_fixes_forbidden_for_other_agency(self, client: AsyncClient, setup_data):
        """A different agency cannot apply in-place fixes to someone else's task."""
        task = await _create_task(client, setup_data)
        task_id = task["id"]

        other_token, _ = await _register(client, "agency", "OtherFixAgency")
        resp = await client.post(
            f"{TASKS_URL}/{task_id}/script/apply-fixes-to-file",
            json={"replacements": [{"from": "旧词", "to": "新词"}]},
            headers=_auth(other_token),
        )
        assert resp.status_code == 403


# ===========================================================================
# Test class: Appeal
# ===========================================================================

class TestAppeal:
    """POST /api/v1/tasks/{task_id}/appeal"""

    @pytest.mark.asyncio
    async def test_appeal_ai_reject_goes_to_agency_review(
        self, client: AsyncClient, setup_data, test_db_session
    ):
        """Creator can appeal AI auto-rejection -- skips AI, goes to agency review."""
        task = await _create_task(client, setup_data)
        task_id = task["id"]

        # Simulate AI auto-rejection: stage=script_upload + ai_auto_rejected in result
        from app.models.task import Task, TaskStage
        from sqlalchemy import update
        await test_db_session.execute(
            update(Task)
            .where(Task.id == task_id)
            .values(
                stage=TaskStage.SCRIPT_UPLOAD,
                script_ai_score=35,
                script_ai_result={"ai_auto_rejected": True, "ai_reject_reason": "违规词", "score": 35},
                appeal_count=1,
            )
        )
        await test_db_session.commit()

        resp = await client.post(
            f"{TASKS_URL}/{task_id}/appeal",
            json={"reason": "AI误判，内容没有违规。"},
            headers=_auth(setup_data["creator_token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["stage"] == "script_agency_review"
        assert data["is_appeal"] is True
        assert data["appeal_reason"] == "AI误判，内容没有违规。"
        assert data["appeal_count"] == 0

    @pytest.mark.asyncio
    async def test_appeal_no_remaining_count(
        self, client: AsyncClient, setup_data, test_db_session
    ):
        """Appeal fails when appeal_count is 0 -- expects 400."""
        task = await _create_task(client, setup_data)
        task_id = task["id"]

        from app.models.task import Task, TaskStage
        from sqlalchemy import update
        await test_db_session.execute(
            update(Task)
            .where(Task.id == task_id)
            .values(
                stage=TaskStage.SCRIPT_UPLOAD,
                script_ai_result={"ai_auto_rejected": True, "ai_reject_reason": "违规", "score": 30},
                appeal_count=0,
            )
        )
        await test_db_session.commit()

        resp = await client.post(
            f"{TASKS_URL}/{task_id}/appeal",
            json={"reason": "Please reconsider."},
            headers=_auth(setup_data["creator_token"]),
        )
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_appeal_not_ai_rejected(self, client: AsyncClient, setup_data):
        """Cannot appeal a task that is not AI-auto-rejected."""
        task = await _create_task(client, setup_data)
        task_id = task["id"]

        # Task is in script_upload but WITHOUT ai_auto_rejected
        resp = await client.post(
            f"{TASKS_URL}/{task_id}/appeal",
            json={"reason": "Why not?"},
            headers=_auth(setup_data["creator_token"]),
        )
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_appeal_wrong_role(
        self, client: AsyncClient, setup_data, test_db_session
    ):
        """Agency cannot submit an appeal -- expects 403."""
        task = await _create_task(client, setup_data)
        task_id = task["id"]

        from app.models.task import Task, TaskStage
        from sqlalchemy import update
        await test_db_session.execute(
            update(Task)
            .where(Task.id == task_id)
            .values(
                stage=TaskStage.SCRIPT_UPLOAD,
                script_ai_result={"ai_auto_rejected": True, "ai_reject_reason": "违规", "score": 30},
            )
        )
        await test_db_session.commit()

        resp = await client.post(
            f"{TASKS_URL}/{task_id}/appeal",
            json={"reason": "Agency should not be able to do this."},
            headers=_auth(setup_data["agency_token"]),
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_appeal_video_ai_reject_goes_to_video_agency_review(
        self, client: AsyncClient, setup_data, test_db_session
    ):
        """Appeal after video AI rejection goes to video_agency_review."""
        task = await _create_task(client, setup_data)
        task_id = task["id"]

        from app.models.task import Task, TaskStage, TaskStatus
        from sqlalchemy import update
        await test_db_session.execute(
            update(Task)
            .where(Task.id == task_id)
            .values(
                stage=TaskStage.VIDEO_UPLOAD,
                script_agency_status=TaskStatus.PASSED,
                script_brand_status=TaskStatus.PASSED,
                video_ai_score=25,
                video_ai_result={"ai_auto_rejected": True, "ai_reject_reason": "竞品露出", "score": 25},
                appeal_count=1,
            )
        )
        await test_db_session.commit()

        resp = await client.post(
            f"{TASKS_URL}/{task_id}/appeal",
            json={"reason": "不是竞品，是我自己的品牌。"},
            headers=_auth(setup_data["creator_token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["stage"] == "video_agency_review"
        assert data["is_appeal"] is True


# ===========================================================================
# Test class: Appeal Count
# ===========================================================================

class TestAppealCount:
    """POST /api/v1/tasks/{task_id}/appeal-count"""

    @pytest.mark.asyncio
    async def test_increase_appeal_count(self, client: AsyncClient, setup_data):
        """Agency can increase appeal count by 1."""
        task = await _create_task(client, setup_data)
        task_id = task["id"]
        original_count = task["appeal_count"]

        resp = await client.post(
            f"{TASKS_URL}/{task_id}/appeal-count",
            headers=_auth(setup_data["agency_token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["appeal_count"] == original_count + 1

    @pytest.mark.asyncio
    async def test_increase_appeal_count_wrong_role(self, client: AsyncClient, setup_data):
        """Creator cannot increase appeal count -- expects 403."""
        task = await _create_task(client, setup_data)
        task_id = task["id"]

        resp = await client.post(
            f"{TASKS_URL}/{task_id}/appeal-count",
            headers=_auth(setup_data["creator_token"]),
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_increase_appeal_count_wrong_agency(self, client: AsyncClient, setup_data):
        """A different agency cannot increase appeal count -- expects 403."""
        task = await _create_task(client, setup_data)
        task_id = task["id"]

        other_token, _ = await _register(client, "agency", "OtherAgency2")
        resp = await client.post(
            f"{TASKS_URL}/{task_id}/appeal-count",
            headers=_auth(other_token),
        )
        assert resp.status_code == 403


# ===========================================================================
# Test class: Pending Reviews
# ===========================================================================

class TestPendingReviews:
    """GET /api/v1/tasks/pending"""

    @pytest.mark.asyncio
    async def test_pending_reviews_agency(
        self, client: AsyncClient, setup_data, test_db_session
    ):
        """Agency sees tasks in script_agency_review / video_agency_review."""
        task = await _create_task(client, setup_data)
        task_id = task["id"]

        from app.models.task import Task, TaskStage
        from sqlalchemy import update
        await test_db_session.execute(
            update(Task)
            .where(Task.id == task_id)
            .values(stage=TaskStage.SCRIPT_AGENCY_REVIEW)
        )
        await test_db_session.commit()

        resp = await client.get(
            f"{TASKS_URL}/pending",
            headers=_auth(setup_data["agency_token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] >= 1
        ids = [item["id"] for item in data["items"]]
        assert task_id in ids

    @pytest.mark.asyncio
    async def test_pending_reviews_brand(
        self, client: AsyncClient, setup_data, test_db_session
    ):
        """Brand sees tasks in script_brand_review / video_brand_review."""
        task = await _create_task(client, setup_data)
        task_id = task["id"]

        from app.models.task import Task, TaskStage
        from sqlalchemy import update
        await test_db_session.execute(
            update(Task)
            .where(Task.id == task_id)
            .values(stage=TaskStage.SCRIPT_BRAND_REVIEW)
        )
        await test_db_session.commit()

        resp = await client.get(
            f"{TASKS_URL}/pending",
            headers=_auth(setup_data["brand_token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] >= 1
        ids = [item["id"] for item in data["items"]]
        assert task_id in ids

    @pytest.mark.asyncio
    async def test_pending_reviews_forbidden_for_creator(
        self, client: AsyncClient, setup_data
    ):
        """Creator cannot access pending reviews -- expects 403."""
        resp = await client.get(
            f"{TASKS_URL}/pending",
            headers=_auth(setup_data["creator_token"]),
        )
        assert resp.status_code == 403
