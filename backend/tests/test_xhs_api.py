import json
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.xhs import XHSBatchItem, XHSBatchJob, XHSExportLog, XHSProject
from tests._logto_test_utils import make_test_logto_token

API = "/api/v1"
ONBOARDING_URL = f"{API}/auth/onboarding"


@pytest.fixture(autouse=True)
def configure_operator_access_code(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        "app.api.auth.settings.OPERATOR_ACCESS_CODE",
        "portfolio-operator-test",
        raising=False,
    )


def _auth(token: str, tenant_id: str = "tenant-xhs") -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "X-Tenant-ID": tenant_id,
    }


def _email(prefix: str = "user") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}@test.com"


async def _register(client: AsyncClient, role: str, name: str | None = None):
    email = _email(role)
    token = make_test_logto_token(
        sub=f"{role}-{uuid.uuid4().hex[:10]}",
        email=email,
        name=name or f"Test {role.title()}",
    )
    resp = await client.post(
        ONBOARDING_URL,
        json={"role": role, "name": name or f"Test {role.title()}"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201, resp.text
    return token, resp.json()


async def _register_operator(client: AsyncClient, name: str | None = None):
    email = _email("operator")
    token = make_test_logto_token(
        sub=f"operator-{uuid.uuid4().hex[:10]}",
        email=email,
        name=name or "Test Operator",
    )
    resp = await client.post(
        ONBOARDING_URL,
        json={
            "role": "operator",
            "name": name or "Test Operator",
            "operator_access_code": "portfolio-operator-test",
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201, resp.text
    return token, resp.json()


async def _create_and_publish_pack(
    client: AsyncClient,
    headers: dict[str, str],
    resource: str,
    payload: dict,
) -> dict:
    create_resp = await client.post(
        f"{API}/xhs/config/{resource}",
        headers=headers,
        json=payload,
    )
    assert create_resp.status_code == 201, create_resp.text
    pack = create_resp.json()

    publish_resp = await client.post(
        f"{API}/xhs/config/{resource}/{pack['id']}/publish",
        headers=headers,
    )
    assert publish_resp.status_code == 200, publish_resp.text
    return publish_resp.json()


async def _create_xhs_project_hierarchy(client: AsyncClient, headers: dict[str, str]) -> dict:
    project_resp = await client.post(
        f"{API}/xhs/projects",
        headers=headers,
        json={
            "name": "AKK 春季总代项目",
            "category_id": "beauty",
            "client_name": "AKK",
            "product_name": "AKK 双标系列",
            "project_brief": "整个项目围绕双标系列做小红书方向拆分。",
            "shared_requirements": "全项目都不能写绝对化表述，统一强调真实体验。",
            "remark": "第一轮测试项目",
        },
    )
    assert project_resp.status_code == 201, project_resp.text
    project = project_resp.json()

    gold_variant_resp = await client.post(
        f"{API}/xhs/projects/{project['id']}/variants",
        headers=headers,
        json={
            "name": "金标",
            "selling_points": "重点讲帕梅拉同款、日常管理体验。",
            "appearance_notes": "金色主视觉包装。",
            "notes": "适合做主推。",
            "is_primary": True,
            "sort_order": 1,
        },
    )
    assert gold_variant_resp.status_code == 201, gold_variant_resp.text
    gold_variant = gold_variant_resp.json()

    silver_variant_resp = await client.post(
        f"{API}/xhs/projects/{project['id']}/variants",
        headers=headers,
        json={
            "name": "银标",
            "selling_points": "重点讲轻负担、辅助搭带。",
            "appearance_notes": "银色主视觉包装。",
            "notes": "常用于带一句搭配。",
            "sort_order": 2,
        },
    )
    assert silver_variant_resp.status_code == 201, silver_variant_resp.text
    silver_variant = silver_variant_resp.json()

    direction_resp = await client.post(
        f"{API}/xhs/projects/{project['id']}/directions",
        headers=headers,
        json={
            "name": "帕梅拉金带银非报备",
            "status": "active",
            "main_variant_id": gold_variant["id"],
            "secondary_variant_ids": [silver_variant["id"]],
            "content_style": "非报备",
            "direction_brief": "主讲金标，顺带提一句银标，整体口语化。",
            "extra_requirements": "控制篇幅更短，语气像真实分享。",
            "notes": "适合先跑 trial。",
            "sort_order": 1,
        },
    )
    assert direction_resp.status_code == 201, direction_resp.text
    direction = direction_resp.json()

    return {
        "project": project,
        "gold_variant": gold_variant,
        "silver_variant": silver_variant,
        "direction": direction,
    }


@pytest.fixture
async def agency_auth(client: AsyncClient):
    token, user = await _register(client, "agency", "XHS Agency")
    return {"token": token, "user": user, "headers": _auth(token)}


class TestXHSProjectHierarchyAPI:
    @pytest.mark.asyncio
    async def test_operator_can_create_and_list_projects_with_workspace_tenant(self, client: AsyncClient):
        token, operator = await _register_operator(client, "XHS Operator")
        headers = _auth(token, operator["tenant_id"])

        create_resp = await client.post(
            f"{API}/xhs/projects",
            headers=headers,
            json={
                "name": "代运营小红书项目",
                "category_id": "beauty",
                "client_name": "操作客户",
                "product_name": "操作产品",
            },
        )
        assert create_resp.status_code == 201, create_resp.text
        project = create_resp.json()
        assert project["tenant_id"] == operator["tenant_id"]

        list_resp = await client.get(f"{API}/xhs/projects", headers=headers)
        assert list_resp.status_code == 200, list_resp.text
        projects = list_resp.json()
        assert any(item["id"] == project["id"] for item in projects)

    @pytest.mark.asyncio
    async def test_agency_can_parse_project_brief_and_store_result(self, client: AsyncClient, agency_auth, monkeypatch, test_db_session):
        async def fake_download_and_get_images(document_url: str, document_name: str):
            assert document_name == "akk-brief.pdf"
            return None

        async def fake_download_and_parse(document_url: str, document_name: str) -> str:
            assert document_url == "uploads/2026/03/xhs/akk-brief.pdf"
            assert document_name == "akk-brief.pdf"
            return "\n".join(
                [
                    "AKK 双标系列项目",
                    "金标主打帕梅拉同款和日常管理体验",
                    "银标用于轻负担辅助带一句",
                    "全项目不能写绝对化和医疗功效",
                ]
            )

        class FakeAIClient:
            async def chat_completion(self, messages, model, temperature, max_tokens):
                return type(
                    "FakeResponse",
                    (),
                    {
                        "content": json.dumps(
                            {
                                "product_name": "AKK 双标系列",
                                "project_brief": "这是一整个围绕双标系列做小红书种草拆解的项目，主推金标，银标作为辅助带一句。",
                                "shared_requirements": "全项目都不能写绝对化和医疗功效，语气要像真实分享。",
                                "key_points": ["主推金标", "银标可辅助带一句", "不能写绝对化", "不能写医疗功效"],
                                "variant_suggestions": [
                                    {
                                        "name": "金标",
                                        "selling_points": ["帕梅拉同款", "日常管理体验"],
                                        "appearance_notes": "金色主视觉包装",
                                        "notes": "适合做主推",
                                    },
                                    {
                                        "name": "银标",
                                        "selling_points": ["轻负担", "辅助搭带"],
                                        "appearance_notes": "银色主视觉包装",
                                        "notes": "适合带一句",
                                    },
                                ],
                                "direction_suggestions": [
                                    {
                                        "name": "帕梅拉金带银非报备",
                                        "main_variant_name": "金标",
                                        "secondary_variant_names": ["银标"],
                                        "content_style": "非报备",
                                        "direction_brief": "主讲金标，顺带提一句银标，整体口语化。",
                                        "extra_requirements": ["控制篇幅更短", "像真实分享"],
                                    }
                                ],
                            },
                            ensure_ascii=False,
                        )
                    },
                )()

        async def fake_get_client(tenant_id: str, db):
            assert tenant_id == "tenant-xhs"
            return FakeAIClient()

        async def fake_get_config(tenant_id: str, db):
            return type("FakeConfig", (), {"models": {"text": "gpt-4o-mini", "vision": "gpt-4o"}})()

        monkeypatch.setattr("app.api.xhs.DocumentParser.download_and_get_images", fake_download_and_get_images)
        monkeypatch.setattr("app.api.xhs.DocumentParser.download_and_parse", fake_download_and_parse)
        monkeypatch.setattr("app.api.xhs.AIServiceFactory.get_client", fake_get_client)
        monkeypatch.setattr("app.api.xhs.AIServiceFactory.get_config", fake_get_config)

        parse_resp = await client.post(
            f"{API}/xhs/projects/brief/parse",
            headers=agency_auth["headers"],
            json={
                "source_ref": "uploads/2026/03/xhs/akk-brief.pdf",
                "file_name": "akk-brief.pdf",
                "category_id": "beauty",
            },
        )
        assert parse_resp.status_code == 200, parse_resp.text
        parsed = parse_resp.json()
        assert parsed["brief_parse_result"]["product_name"] == "AKK 双标系列"
        assert parsed["brief_parse_result"]["variant_suggestions"][0]["name"] == "金标"
        assert parsed["brief_parse_result"]["direction_suggestions"][0]["name"] == "帕梅拉金带银非报备"

        create_resp = await client.post(
            f"{API}/xhs/projects",
            headers=agency_auth["headers"],
            json={
                "name": "AKK 春季总代项目",
                "category_id": "beauty",
                "client_name": "AKK",
                "product_name": parsed["brief_parse_result"]["product_name"],
                "brief_file_ref": "uploads/2026/03/xhs/akk-brief.pdf",
                "brief_file_name": "akk-brief.pdf",
                "brief_parse_result": parsed["brief_parse_result"],
                "project_brief": parsed["brief_parse_result"]["project_brief"],
                "shared_requirements": parsed["brief_parse_result"]["shared_requirements"],
            },
        )
        assert create_resp.status_code == 201, create_resp.text
        project = create_resp.json()
        assert project["brief_file_name"] == "akk-brief.pdf"
        assert project["brief_parse_result"]["key_points"][0] == "主推金标"

        result = await test_db_session.execute(select(XHSProject).where(XHSProject.id == project["id"]))
        saved_project = result.scalar_one()
        assert saved_project.brief_file_ref == "uploads/2026/03/xhs/akk-brief.pdf"
        assert saved_project.brief_parse_result_json["variant_suggestions"][1]["name"] == "银标"

    @pytest.mark.asyncio
    async def test_agency_can_parse_project_brief_when_ai_wraps_json_in_code_fence(self, client: AsyncClient, agency_auth, monkeypatch):
        async def fake_download_and_get_images(document_url: str, document_name: str):
            return None

        async def fake_download_and_parse(document_url: str, document_name: str) -> str:
            return "\n".join(
                [
                    "AKK 双标系列项目",
                    "金标主推帕梅拉同款和日常管理体验。",
                    "银标用于辅助带一句。",
                    "全项目不能写绝对化表述。",
                ]
            )

        class FakeAIClient:
            async def chat_completion(self, messages, model, temperature, max_tokens):
                return type(
                    "FakeResponse",
                    (),
                    {
                        "content": """```json
{
  "product_name": "AKK 双标系列",
  "project_brief": "这是围绕双标系列做的小红书种草项目，主推金标，银标辅助带一句。",
  "shared_requirements": "全项目都不能写绝对化表述，语气要像真实分享。",
  "key_points": ["主推金标", "银标辅助带一句", "不能写绝对化",],
  "variant_suggestions": [
    {
      "name": "金标",
      "selling_points": ["帕梅拉同款", "日常管理体验",],
      "appearance_notes": "金色主视觉包装",
      "notes": "适合做主推",
    }
  ],
  "direction_suggestions": []
}
```""",
                    },
                )()

        async def fake_get_client(tenant_id: str, db):
            return FakeAIClient()

        async def fake_get_config(tenant_id: str, db):
            return type("FakeConfig", (), {"models": {"text": "gpt-4o-mini", "vision": "gpt-4o"}})()

        monkeypatch.setattr("app.api.xhs.DocumentParser.download_and_get_images", fake_download_and_get_images)
        monkeypatch.setattr("app.api.xhs.DocumentParser.download_and_parse", fake_download_and_parse)
        monkeypatch.setattr("app.api.xhs.AIServiceFactory.get_client", fake_get_client)
        monkeypatch.setattr("app.api.xhs.AIServiceFactory.get_config", fake_get_config)

        parse_resp = await client.post(
            f"{API}/xhs/projects/brief/parse",
            headers=agency_auth["headers"],
            json={
                "source_ref": "uploads/2026/03/xhs/akk-brief.pdf",
                "file_name": "akk-brief.pdf",
                "category_id": "beauty",
            },
        )
        assert parse_resp.status_code == 200, parse_resp.text
        parsed = parse_resp.json()["brief_parse_result"]
        assert parsed["product_name"] == "AKK 双标系列"
        assert parsed["key_points"][0] == "主推金标"
        assert parsed["variant_suggestions"][0]["name"] == "金标"

    @pytest.mark.asyncio
    async def test_agency_can_retry_project_brief_parse_until_third_ai_response(self, client: AsyncClient, agency_auth, monkeypatch):
        async def fake_download_and_get_images(document_url: str, document_name: str):
            return None

        async def fake_download_and_parse(document_url: str, document_name: str) -> str:
            return "\n".join(
                [
                    "AKK 双标系列项目",
                    "金标主推帕梅拉同款和日常管理体验。",
                    "银标用于辅助带一句。",
                    "全项目不能写绝对化和医疗功效。",
                ]
            )

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
                            "content": "主推金标，银标辅助带一句，统一限制是不能写绝对化和医疗功效。",
                        },
                    )()
                if self.calls == 2:
                    return type(
                        "FakeResponse",
                        (),
                        {
                            "content": """```json
{"product_name":"AKK 双标系列","project_brief":"主推金标，银标辅助带一句","shared_requirements":"不能写绝对化和医疗功效"
```""",
                        },
                    )()
                return type(
                    "FakeResponse",
                    (),
                    {
                        "content": json.dumps(
                            {
                                "product_name": "AKK 双标系列",
                                "project_brief": "这是围绕双标系列做的小红书种草项目，主推金标，银标辅助带一句。",
                                "shared_requirements": "全项目都不能写绝对化和医疗功效，语气要像真实分享。",
                                "key_points": ["主推金标", "银标辅助带一句", "不能写绝对化", "不能写医疗功效"],
                                "variant_suggestions": [
                                    {
                                        "name": "金标",
                                        "selling_points": ["帕梅拉同款", "日常管理体验"],
                                        "appearance_notes": "金色主视觉包装",
                                        "notes": "适合做主推",
                                    }
                                ],
                                "direction_suggestions": [],
                            },
                            ensure_ascii=False,
                        )
                    },
                )()

        fake_ai_client = FakeAIClient()

        async def fake_get_client(tenant_id: str, db):
            return fake_ai_client

        async def fake_get_config(tenant_id: str, db):
            return type("FakeConfig", (), {"models": {"text": "gpt-4o-mini", "vision": "gpt-4o"}})()

        monkeypatch.setattr("app.api.xhs.DocumentParser.download_and_get_images", fake_download_and_get_images)
        monkeypatch.setattr("app.api.xhs.DocumentParser.download_and_parse", fake_download_and_parse)
        monkeypatch.setattr("app.api.xhs.AIServiceFactory.get_client", fake_get_client)
        monkeypatch.setattr("app.api.xhs.AIServiceFactory.get_config", fake_get_config)

        parse_resp = await client.post(
            f"{API}/xhs/projects/brief/parse",
            headers=agency_auth["headers"],
            json={
                "source_ref": "uploads/2026/03/xhs/akk-brief.pdf",
                "file_name": "akk-brief.pdf",
                "category_id": "beauty",
            },
        )
        assert parse_resp.status_code == 200, parse_resp.text
        parsed = parse_resp.json()["brief_parse_result"]
        assert fake_ai_client.calls == 3
        assert parsed["product_name"] == "AKK 双标系列"
        assert parsed["key_points"][0] == "主推金标"

    @pytest.mark.asyncio
    async def test_agency_can_parse_variant_brief_from_pasted_text(self, client: AsyncClient, agency_auth, monkeypatch):
        class FakeAIClient:
            async def chat_completion(self, messages, model, temperature, max_tokens):
                return type(
                    "FakeResponse",
                    (),
                    {
                        "content": json.dumps(
                            {
                                "name": "金标",
                                "selling_points": ["帕梅拉同款", "日常管理体验", "非报备更顺口"],
                                "appearance_notes": "金色主视觉包装，和银标有明显区分。",
                                "notes": "主讲金标时可以顺带一句银标，但不要写绝对化表述。",
                            },
                            ensure_ascii=False,
                        )
                    },
                )()

        async def fake_get_client(tenant_id: str, db):
            assert tenant_id == "tenant-xhs"
            return FakeAIClient()

        async def fake_get_config(tenant_id: str, db):
            return type("FakeConfig", (), {"models": {"text": "gpt-4o-mini"}})()

        monkeypatch.setattr("app.api.xhs.AIServiceFactory.get_client", fake_get_client)
        monkeypatch.setattr("app.api.xhs.AIServiceFactory.get_config", fake_get_config)

        raw_text = "\n".join(
            [
                "AKK 金标版本",
                "主打帕梅拉同款和日常管理体验。",
                "包装是金色主视觉。",
                "做非报备时语气更口语化，同时可以顺带一句银标。",
                "不能写绝对化表述。",
            ]
        )
        parse_resp = await client.post(
            f"{API}/xhs/variants/brief/parse",
            headers=agency_auth["headers"],
            json={
                "raw_text": raw_text,
                "category_id": "beauty",
            },
        )
        assert parse_resp.status_code == 200, parse_resp.text
        parsed = parse_resp.json()
        assert parsed["source_ref"] is None
        assert parsed["file_name"] is None
        assert parsed["extracted_text"] == raw_text
        assert parsed["brief_parse_result"]["name"] == "金标"
        assert parsed["brief_parse_result"]["selling_points"][0] == "帕梅拉同款"
        assert "金色主视觉包装" in parsed["brief_parse_result"]["appearance_notes"]
        assert "不要写绝对化表述" in parsed["brief_parse_result"]["notes"]

    @pytest.mark.asyncio
    async def test_agency_can_retry_variant_brief_parse_when_first_ai_response_is_not_json(self, client: AsyncClient, agency_auth, monkeypatch):
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
                            "content": "版本叫金标，重点是帕梅拉同款、日常管理体验，包装是金色，整体适合主推。",
                        },
                    )()
                return type(
                    "FakeResponse",
                    (),
                    {
                        "content": json.dumps(
                            {
                                "name": "金标",
                                "selling_points": ["帕梅拉同款", "日常管理体验"],
                                "appearance_notes": "金色主视觉包装",
                                "notes": "适合主推",
                            },
                            ensure_ascii=False,
                        )
                    },
                )()

        fake_ai_client = FakeAIClient()

        async def fake_get_client(tenant_id: str, db):
            return fake_ai_client

        async def fake_get_config(tenant_id: str, db):
            return type("FakeConfig", (), {"models": {"text": "gpt-4o-mini"}})()

        monkeypatch.setattr("app.api.xhs.AIServiceFactory.get_client", fake_get_client)
        monkeypatch.setattr("app.api.xhs.AIServiceFactory.get_config", fake_get_config)

        parse_resp = await client.post(
            f"{API}/xhs/variants/brief/parse",
            headers=agency_auth["headers"],
            json={
                "raw_text": "AKK 金标版本，主打帕梅拉同款和日常管理体验，包装是金色主视觉。",
                "category_id": "beauty",
            },
        )
        assert parse_resp.status_code == 200, parse_resp.text
        parsed = parse_resp.json()["brief_parse_result"]
        assert fake_ai_client.calls == 2
        assert parsed["name"] == "金标"
        assert parsed["selling_points"][0] == "帕梅拉同款"

    @pytest.mark.asyncio
    async def test_agency_can_create_project_variants_and_directions(self, client: AsyncClient, agency_auth):
        hierarchy = await _create_xhs_project_hierarchy(client, agency_auth["headers"])

        variants_resp = await client.get(
            f"{API}/xhs/projects/{hierarchy['project']['id']}/variants",
            headers=agency_auth["headers"],
        )
        assert variants_resp.status_code == 200, variants_resp.text
        variants = variants_resp.json()
        assert len(variants) == 2
        assert variants[0]["name"] == "金标"
        assert variants[0]["is_primary"] is True

        directions_resp = await client.get(
            f"{API}/xhs/projects/{hierarchy['project']['id']}/directions",
            headers=agency_auth["headers"],
        )
        assert directions_resp.status_code == 200, directions_resp.text
        directions = directions_resp.json()
        assert len(directions) == 1
        assert directions[0]["name"] == "帕梅拉金带银非报备"
        assert directions[0]["main_variant_name"] == "金标"
        assert directions[0]["secondary_variant_ids"] == [hierarchy["silver_variant"]["id"]]

        projects_resp = await client.get(
            f"{API}/xhs/projects?category_id=beauty",
            headers=agency_auth["headers"],
        )
        assert projects_resp.status_code == 200, projects_resp.text
        projects = projects_resp.json()
        assert len(projects) == 1
        assert projects[0]["variant_count"] == 2
        assert projects[0]["direction_count"] == 1
        assert projects[0]["batch_count"] == 0

    @pytest.mark.asyncio
    async def test_batch_can_link_to_direction_and_filter_by_project(self, client: AsyncClient, agency_auth):
        hierarchy = await _create_xhs_project_hierarchy(client, agency_auth["headers"])

        batch_resp = await client.post(
            f"{API}/xhs/batches",
            headers=agency_auth["headers"],
            json={
                "category_id": "beauty",
                "direction_id": hierarchy["direction"]["id"],
                "run_mode": "trial",
                "trial_sample_count": 2,
                "input_type": "text",
                "input_text": "第一篇笔记内容\\n\\n第二篇笔记内容",
                "tag_policy": {"max_count": 8},
                "export_options": {"all_md": True},
            },
        )
        assert batch_resp.status_code == 201, batch_resp.text
        batch = batch_resp.json()
        assert batch["direction_id"] == hierarchy["direction"]["id"]
        assert batch["direction_name"] == "帕梅拉金带银非报备"
        assert batch["project_id"] == hierarchy["project"]["id"]
        assert batch["project_name"] == "AKK 春季总代项目"

        list_resp = await client.get(
            f"{API}/xhs/batches?project_id={hierarchy['project']['id']}",
            headers=agency_auth["headers"],
        )
        assert list_resp.status_code == 200, list_resp.text
        list_data = list_resp.json()
        assert len(list_data) == 1
        assert list_data[0]["id"] == batch["id"]

        direction_resp = await client.get(
            f"{API}/xhs/directions/{hierarchy['direction']['id']}",
            headers=agency_auth["headers"],
        )
        assert direction_resp.status_code == 200, direction_resp.text
        direction = direction_resp.json()
        assert direction["batch_count"] == 1
        assert direction["latest_batch_id"] == batch["id"]


class TestXHSConfigAPI:
    @pytest.mark.asyncio
    async def test_agency_can_create_publish_and_update_rule_pack(self, client: AsyncClient, agency_auth):
        create_resp = await client.post(
            f"{API}/xhs/config/rule-packs",
            headers=agency_auth["headers"],
            json={
                "name": "小红书-美妆-基础规则",
                "category_id": "beauty",
                "version": "2026.03.1",
                "status": "draft",
                "pack": {
                    "banned_terms": ["治疗", "治愈"],
                    "risk_patterns": [{"id": "medical_claim", "pattern": "(治疗|治愈)", "severity": "high"}],
                    "replace_map": {"治疗": "改善体验"},
                    "format_rules": {"hashtag": {"max_count": 8}},
                    "structure_rules": {"preferred_sections": ["title", "hashtags"]},
                },
            },
        )
        assert create_resp.status_code == 201, create_resp.text
        pack = create_resp.json()
        assert pack["name"] == "小红书-美妆-基础规则"

        publish_resp = await client.post(
            f"{API}/xhs/config/rule-packs/{pack['id']}/publish",
            headers=agency_auth["headers"],
        )
        assert publish_resp.status_code == 200, publish_resp.text
        assert publish_resp.json()["status"] == "active"

        update_resp = await client.put(
            f"{API}/xhs/config/rule-packs/{pack['id']}",
            headers=agency_auth["headers"],
            json={
                "name": "小红书-美妆-升级规则",
                "version": "2026.03.2",
                "pack": {
                    "banned_terms": ["治疗", "绝对"],
                    "risk_patterns": [{"id": "absolute_claim", "pattern": "(绝对|第一)", "severity": "medium"}],
                    "replace_map": {"绝对": "更偏向"},
                    "format_rules": {"hashtag": {"max_count": 6}},
                    "structure_rules": {"preferred_sections": ["title", "experience", "hashtags"]},
                },
            },
        )
        assert update_resp.status_code == 200, update_resp.text
        data = update_resp.json()
        assert data["name"] == "小红书-美妆-升级规则"
        assert data["version"] == "2026.03.2"
        assert data["pack"]["replace_map"]["绝对"] == "更偏向"

    @pytest.mark.asyncio
    async def test_create_rule_pack_rejects_invalid_regex(self, client: AsyncClient, agency_auth):
        resp = await client.post(
            f"{API}/xhs/config/rule-packs",
            headers=agency_auth["headers"],
            json={
                "name": "坏规则",
                "category_id": "beauty",
                "version": "2026.03.9",
                "status": "draft",
                "pack": {
                    "banned_terms": [],
                    "risk_patterns": [{"id": "broken", "pattern": "(", "severity": "high"}],
                    "replace_map": {},
                    "format_rules": {},
                    "structure_rules": {},
                },
            },
        )
        assert resp.status_code == 400
        detail = resp.json()["detail"]
        assert detail["message"] == "配置校验失败"
        assert "risk_pattern 正则非法" in detail["conflicts"][0]["message"]

    @pytest.mark.asyncio
    async def test_agency_can_create_and_publish_brand_pack(self, client: AsyncClient, agency_auth):
        create_resp = await client.post(
            f"{API}/xhs/config/brand-packs",
            headers=agency_auth["headers"],
            json={
                "brand_name": "Brand A",
                "category_id": "beauty",
                "version": "2026.03.1",
                "status": "draft",
                "is_default": True,
                "pack": {
                    "brand_facts": [{"name": "fact"}],
                    "products": [],
                    "fact_graph": {"nodes": [], "relations": []},
                    "optional_blocks": [],
                },
            },
        )
        assert create_resp.status_code == 201, create_resp.text
        pack = create_resp.json()
        assert pack["brand_name"] == "Brand A"
        assert pack["status"] == "draft"

        publish_resp = await client.post(
            f"{API}/xhs/config/brand-packs/{pack['id']}/publish",
            headers=agency_auth["headers"],
        )
        assert publish_resp.status_code == 200, publish_resp.text
        assert publish_resp.json()["status"] == "active"

    @pytest.mark.asyncio
    async def test_agency_can_update_brand_pack(self, client: AsyncClient, agency_auth):
        create_resp = await client.post(
            f"{API}/xhs/config/brand-packs",
            headers=agency_auth["headers"],
            json={
                "brand_name": "Brand A",
                "category_id": "beauty",
                "version": "2026.03.1",
                "status": "draft",
                "is_default": False,
                "pack": {
                    "brand_facts": [],
                    "products": [],
                    "fact_graph": {"nodes": [], "relations": []},
                    "optional_blocks": [],
                },
            },
        )
        assert create_resp.status_code == 201, create_resp.text
        pack = create_resp.json()

        update_resp = await client.put(
            f"{API}/xhs/config/brand-packs/{pack['id']}",
            headers=agency_auth["headers"],
            json={
                "brand_name": "Brand A Plus",
                "version": "2026.03.2",
                "is_default": True,
                "pack": {
                    "brand_facts": [{"name": "升级卖点"}],
                    "products": [],
                    "fact_graph": {"nodes": [], "relations": []},
                    "optional_blocks": [],
                },
            },
        )
        assert update_resp.status_code == 200, update_resp.text
        data = update_resp.json()
        assert data["brand_name"] == "Brand A Plus"
        assert data["version"] == "2026.03.2"
        assert data["is_default"] is True
        assert data["pack"]["brand_facts"][0]["name"] == "升级卖点"

    @pytest.mark.asyncio
    async def test_agency_can_create_and_list_brief_pack(self, client: AsyncClient, agency_auth):
        create_resp = await client.post(
            f"{API}/xhs/config/brief-packs",
            headers=agency_auth["headers"],
            json={
                "brand_name": "Brand A",
                "category_id": "beauty",
                "version": "2026.03.2",
                "status": "draft",
                "source_type": "feishu_link",
                "source_ref": "https://feishu.example.com/doc/1",
                "pack": {
                    "brand_facts": {"brand": "Brand A"},
                    "sku_facts": [],
                    "selling_point_priority": [],
                    "recommended_phrasings": ["phrase"],
                    "forbidden_phrasings": [],
                    "uncertain_fields": [],
                },
            },
        )
        assert create_resp.status_code == 201, create_resp.text

        list_resp = await client.get(
            f"{API}/xhs/config/brief-packs?category_id=beauty",
            headers=agency_auth["headers"],
        )
        assert list_resp.status_code == 200, list_resp.text
        items = list_resp.json()
        assert len(items) == 1
        assert items[0]["source_type"] == "feishu_link"

    @pytest.mark.asyncio
    async def test_agency_can_update_brief_pack(self, client: AsyncClient, agency_auth):
        create_resp = await client.post(
            f"{API}/xhs/config/brief-packs",
            headers=agency_auth["headers"],
            json={
                "brand_name": "Brand A",
                "category_id": "beauty",
                "version": "2026.03.2",
                "status": "draft",
                "source_type": "upload",
                "source_ref": "file_1",
                "pack": {
                    "brand_facts": {"brand": "Brand A"},
                    "sku_facts": [],
                    "selling_point_priority": [],
                    "recommended_phrasings": ["旧表达"],
                    "forbidden_phrasings": [],
                    "uncertain_fields": [],
                },
            },
        )
        assert create_resp.status_code == 201, create_resp.text
        pack = create_resp.json()

        update_resp = await client.put(
            f"{API}/xhs/config/brief-packs/{pack['id']}",
            headers=agency_auth["headers"],
            json={
                "source_type": "feishu_link",
                "source_ref": "https://feishu.example.com/new",
                "pack": {
                    "brand_facts": {"brand": "Brand A"},
                    "sku_facts": [],
                    "selling_point_priority": [],
                    "recommended_phrasings": ["新表达"],
                    "forbidden_phrasings": [],
                    "uncertain_fields": [],
                },
            },
        )
        assert update_resp.status_code == 200, update_resp.text
        data = update_resp.json()
        assert data["source_type"] == "feishu_link"
        assert data["source_ref"] == "https://feishu.example.com/new"
        assert data["pack"]["recommended_phrasings"] == ["新表达"]

    @pytest.mark.asyncio
    async def test_create_brief_pack_rejects_conflicting_phrasings(self, client: AsyncClient, agency_auth):
        resp = await client.post(
            f"{API}/xhs/config/brief-packs",
            headers=agency_auth["headers"],
            json={
                "brand_name": "Brand A",
                "category_id": "beauty",
                "version": "2026.03.3",
                "status": "draft",
                "source_type": "upload",
                "pack": {
                    "brand_facts": {},
                    "sku_facts": [],
                    "selling_point_priority": [],
                    "recommended_phrasings": ["温和不刺激"],
                    "forbidden_phrasings": ["温和不刺激"],
                    "uncertain_fields": [],
                },
            },
        )
        assert resp.status_code == 400
        detail = resp.json()["detail"]
        assert detail["message"] == "配置校验失败"
        assert detail["conflicts"][0]["field"] == "phrasing"

    @pytest.mark.asyncio
    async def test_agency_can_update_risk_pack(self, client: AsyncClient, agency_auth):
        create_resp = await client.post(
            f"{API}/xhs/config/risk-packs",
            headers=agency_auth["headers"],
            json={
                "name": "基础风险包",
                "category_id": "beauty",
                "version": "2026.03.1",
                "status": "draft",
                "pack": {
                    "risk_clues": [{"text": "极限词"}],
                    "replace_hints": [],
                    "confidence_level": "medium",
                },
            },
        )
        assert create_resp.status_code == 201, create_resp.text
        pack = create_resp.json()

        update_resp = await client.put(
            f"{API}/xhs/config/risk-packs/{pack['id']}",
            headers=agency_auth["headers"],
            json={
                "name": "升级风险包",
                "version": "2026.03.2",
                "pack": {
                    "risk_clues": [{"text": "疗效承诺"}],
                    "replace_hints": [{"from": "包治百病", "to": "改善体验"}],
                    "confidence_level": "high",
                },
            },
        )
        assert update_resp.status_code == 200, update_resp.text
        data = update_resp.json()
        assert data["name"] == "升级风险包"
        assert data["version"] == "2026.03.2"
        assert data["pack"]["replace_hints"][0]["to"] == "改善体验"

    @pytest.mark.asyncio
    async def test_parse_brief_pack_from_text(self, client: AsyncClient, agency_auth):
        resp = await client.post(
            f"{API}/xhs/config/brief-packs/parse",
            headers=agency_auth["headers"],
            json={
                "source_type": "upload",
                "source_text": "\n".join(
                    [
                        "核心卖点：温和清洁，不拔干",
                        "亮点：适合敏感肌日常使用",
                        "禁止：不能写医疗功效",
                    ]
                ),
            },
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert "核心卖点" in data["extracted_text"]
        assert len(data["pack"]["selling_point_priority"]) >= 1
        assert any("不能写医疗功效" in item for item in data["pack"]["forbidden_phrasings"])
        assert data["validation"]["valid"] is True

    @pytest.mark.asyncio
    async def test_brand_cannot_access_agency_only_xhs_endpoints(self, client: AsyncClient):
        token, _ = await _register(client, "brand", "XHS Brand")
        resp = await client.get(
            f"{API}/xhs/config/risk-packs",
            headers=_auth(token),
        )
        assert resp.status_code == 403


class TestXHSBatchAPI:
    @pytest.mark.asyncio
    async def test_agency_can_create_and_list_batch_jobs(self, client: AsyncClient, agency_auth):
        create_resp = await client.post(
            f"{API}/xhs/batches",
            headers=agency_auth["headers"],
            json={
                "category_id": "beauty",
                "run_mode": "trial",
                "trial_sample_count": 3,
                "input_type": "text",
                "input_text": "note 1\n\nnote 2",
                "tag_policy": {"max_count": 5},
                "export_options": {"all_md": True},
            },
        )
        assert create_resp.status_code == 201, create_resp.text
        job = create_resp.json()
        assert job["status"] == "pending"
        assert job["run_mode"] == "trial"

        list_resp = await client.get(f"{API}/xhs/batches", headers=agency_auth["headers"])
        assert list_resp.status_code == 200, list_resp.text
        items = list_resp.json()
        assert len(items) == 1
        assert items[0]["id"] == job["id"]

        item_resp = await client.get(f"{API}/xhs/batches/{job['id']}/items", headers=agency_auth["headers"])
        assert item_resp.status_code == 200, item_resp.text
        batch_items = item_resp.json()
        assert batch_items["total"] == 2
        assert len(batch_items["items"]) == 2
        assert batch_items["items"][0]["item_id"] == "item_001"
        assert batch_items["items"][0]["index"] == 1
        assert batch_items["items"][0]["title"] == batch_items["items"][0]["source_title_guess"]
        assert batch_items["items"][1]["item_id"] == "item_002"

    @pytest.mark.asyncio
    async def test_list_batch_jobs_returns_failed_and_safe_rewrite_counts(self, client: AsyncClient, agency_auth, test_db_session):
        create_resp = await client.post(
            f"{API}/xhs/batches",
            headers=agency_auth["headers"],
            json={
                "category_id": "beauty",
                "run_mode": "full",
                "input_type": "text",
                "input_text": "note 1\n\nnote 2",
            },
        )
        assert create_resp.status_code == 201, create_resp.text
        job = create_resp.json()

        result = await test_db_session.execute(
            select(XHSBatchItem).where(XHSBatchItem.batch_id == job["id"]).order_by(XHSBatchItem.item_id.asc())
        )
        items = list(result.scalars().all())
        items[0].status = "failed"
        items[0].safe_rewrite_used = True
        items[1].status = "completed"
        await test_db_session.commit()

        list_resp = await client.get(f"{API}/xhs/batches", headers=agency_auth["headers"])
        assert list_resp.status_code == 200, list_resp.text
        batches = list_resp.json()
        assert len(batches) == 1
        assert batches[0]["id"] == job["id"]
        assert batches[0]["failed_items"] == 1
        assert batches[0]["safe_rewrite_items"] == 1

    @pytest.mark.asyncio
    async def test_list_batch_jobs_filters_by_effective_awaiting_decision_status(self, client: AsyncClient, agency_auth, test_db_session):
        create_resp = await client.post(
            f"{API}/xhs/batches",
            headers=agency_auth["headers"],
            json={
                "category_id": "beauty",
                "run_mode": "full",
                "input_type": "text",
                "input_text": "note 1\n\nnote 2\n\nnote 3",
            },
        )
        assert create_resp.status_code == 201, create_resp.text
        job = create_resp.json()

        job_result = await test_db_session.execute(select(XHSBatchJob).where(XHSBatchJob.id == job["id"]))
        saved_job = job_result.scalar_one()
        saved_job.status = "done"

        item_result = await test_db_session.execute(
            select(XHSBatchItem).where(XHSBatchItem.batch_id == job["id"]).order_by(XHSBatchItem.item_id.asc())
        )
        items = list(item_result.scalars().all())
        items[0].status = "completed"
        items[1].status = "failed"
        items[1].safe_rewrite_reason = "alignment_not_satisfied"
        items[1].rewrite_fail_reasons_json = ["主版本核心卖点和方向要求冲突"]
        items[2].status = "completed"
        await test_db_session.commit()

        awaiting_resp = await client.get(
            f"{API}/xhs/batches?status=awaiting_decision",
            headers=agency_auth["headers"],
        )
        assert awaiting_resp.status_code == 200, awaiting_resp.text
        awaiting_data = awaiting_resp.json()
        assert [batch["id"] for batch in awaiting_data] == [job["id"]]
        assert awaiting_data[0]["status"] == "done"
        assert awaiting_data[0]["decision_items"] == 1

        done_resp = await client.get(
            f"{API}/xhs/batches?status=done",
            headers=agency_auth["headers"],
        )
        assert done_resp.status_code == 200, done_resp.text
        assert done_resp.json() == []

    @pytest.mark.asyncio
    async def test_create_batch_validates_input_by_type(self, client: AsyncClient, agency_auth):
        resp = await client.post(
            f"{API}/xhs/batches",
            headers=agency_auth["headers"],
            json={
                "category_id": "beauty",
                "run_mode": "trial",
                "input_type": "feishu_link",
            },
        )
        assert resp.status_code == 400
        assert "feishu_url" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_create_batch_rejects_missing_selected_rule_pack(self, client: AsyncClient, agency_auth):
        resp = await client.post(
            f"{API}/xhs/batches",
            headers=agency_auth["headers"],
            json={
                "category_id": "beauty",
                "rule_pack_version": "2026.03.404",
                "run_mode": "trial",
                "input_type": "text",
                "input_text": "note 1\n\nnote 2",
            },
        )
        assert resp.status_code == 400
        assert "rule_pack_version" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_estimate_batch_rejects_missing_selected_brief_pack(self, client: AsyncClient, agency_auth):
        resp = await client.post(
            f"{API}/xhs/batches/estimate",
            headers=agency_auth["headers"],
            json={
                "category_id": "beauty",
                "brief_pack_id": "XFP_missing",
                "run_mode": "trial",
                "input_type": "text",
                "input_text": "note 1\n\nnote 2",
            },
        )
        assert resp.status_code == 400
        assert "brief_pack_id" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_create_batch_parses_file_input_when_possible(self, client: AsyncClient, agency_auth, monkeypatch, test_db_session):
        async def fake_download_and_parse(document_url: str, document_name: str) -> str:
            assert document_name == "script.docx"
            return "第一篇标题\n正文 A\n\n第二篇标题\n正文 B"

        monkeypatch.setattr("app.api.xhs.DocumentParser.download_and_parse", fake_download_and_parse)

        create_resp = await client.post(
            f"{API}/xhs/batches",
            headers=agency_auth["headers"],
            json={
                "category_id": "beauty",
                "run_mode": "full",
                "input_type": "file",
                "file_id": "uploads/2026/03/scripts/script.docx",
            },
        )
        assert create_resp.status_code == 201, create_resp.text
        job = create_resp.json()
        assert job["total_items"] == 2
        assert job["input_stats"]["source_file_name"] == "script.docx"

        result = await test_db_session.execute(
            select(XHSBatchItem).where(XHSBatchItem.batch_id == job["id"]).order_by(XHSBatchItem.item_id.asc())
        )
        items = list(result.scalars().all())
        assert len(items) == 2
        assert items[0].source_title_guess == "第一篇标题"

    @pytest.mark.asyncio
    async def test_estimate_batch_uses_file_preprocessing(self, client: AsyncClient, agency_auth, monkeypatch):
        async def fake_download_and_parse(document_url: str, document_name: str) -> str:
            return "标题一\n正文一\n\n标题二\n正文二"

        monkeypatch.setattr("app.api.xhs.DocumentParser.download_and_parse", fake_download_and_parse)

        resp = await client.post(
            f"{API}/xhs/batches/estimate",
            headers=agency_auth["headers"],
            json={
                "category_id": "beauty",
                "run_mode": "full",
                "input_type": "file",
                "file_id": "uploads/2026/03/scripts/script.docx",
            },
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["total_split_items"] == 2
        assert data["estimated_items"] == 2

    @pytest.mark.asyncio
    async def test_get_batch_job_returns_detail_summary_fields(self, client: AsyncClient, agency_auth, test_db_session):
        rule_pack = await _create_and_publish_pack(
            client,
            agency_auth["headers"],
            "rule-packs",
            {
                "name": "小红书-美妆-基础规则",
                "category_id": "beauty",
                "version": "2026.03.1",
                "status": "draft",
                "pack": {
                    "banned_terms": ["治疗", "治愈"],
                    "risk_patterns": [{"id": "medical_claim", "pattern": "(治疗|治愈)", "severity": "high"}],
                    "replace_map": {"治疗": "改善体验"},
                    "format_rules": {"hashtag": {"max_count": 8}},
                    "structure_rules": {"preferred_sections": ["title", "hashtags"]},
                },
            },
        )
        risk_pack = await _create_and_publish_pack(
            client,
            agency_auth["headers"],
            "risk-packs",
            {
                "name": "基础风险包",
                "category_id": "beauty",
                "version": "risk-v1",
                "status": "draft",
                "pack": {
                    "risk_clues": [{"text": "极限词"}],
                    "replace_hints": [],
                    "confidence_level": "medium",
                },
            },
        )
        brand_pack = await _create_and_publish_pack(
            client,
            agency_auth["headers"],
            "brand-packs",
            {
                "brand_name": "Brand A",
                "category_id": "beauty",
                "version": "brand-v2",
                "status": "draft",
                "is_default": True,
                "pack": {
                    "brand_facts": [{"name": "fact"}],
                    "products": [],
                    "fact_graph": {"nodes": [], "relations": []},
                    "optional_blocks": [],
                },
            },
        )
        brief_pack = await _create_and_publish_pack(
            client,
            agency_auth["headers"],
            "brief-packs",
            {
                "brand_name": "Brand A",
                "category_id": "beauty",
                "version": "2026.03.2",
                "status": "draft",
                "source_type": "feishu_link",
                "source_ref": "https://feishu.example.com/doc/1",
                "pack": {
                    "brand_facts": {"brand": "Brand A"},
                    "sku_facts": [],
                    "selling_point_priority": [],
                    "recommended_phrasings": ["phrase"],
                    "forbidden_phrasings": [],
                    "uncertain_fields": [],
                },
            },
        )

        create_resp = await client.post(
            f"{API}/xhs/batches",
            headers=agency_auth["headers"],
            json={
                "category_id": "beauty",
                "rule_pack_version": rule_pack["version"],
                "risk_pack_version": risk_pack["version"],
                "brand_pack_version": brand_pack["version"],
                "brief_pack_id": brief_pack["id"],
                "run_mode": "full",
                "input_type": "text",
                "input_text": "note 1\n\nnote 2",
            },
        )
        assert create_resp.status_code == 201, create_resp.text
        job = create_resp.json()

        result = await test_db_session.execute(
            select(XHSBatchItem).where(XHSBatchItem.batch_id == job["id"]).order_by(XHSBatchItem.item_id.asc())
        )
        items = list(result.scalars().all())
        items[0].status = "failed"
        items[1].status = "completed"
        items[1].safe_rewrite_used = True
        await test_db_session.commit()

        detail_resp = await client.get(
            f"{API}/xhs/batches/{job['id']}",
            headers=agency_auth["headers"],
        )
        assert detail_resp.status_code == 200, detail_resp.text
        data = detail_resp.json()
        assert data["failed_items"] == 1
        assert data["safe_rewrite_items"] == 1
        assert data["rule_pack_version"] == rule_pack["version"]
        assert data["risk_pack_version"] == risk_pack["version"]
        assert data["brand_pack_version"] == brand_pack["version"]
        assert data["brief_pack_id"] == brief_pack["id"]
        assert data["input_stats"]["raw_chars"] == len("note 1\n\nnote 2")
        assert data["input_stats"]["split_count"] == 2
        assert data["export"]["all_md_status"] is None
        assert data["export"]["feishu_status"] is None

    @pytest.mark.asyncio
    async def test_start_batch_dispatches_job(self, client: AsyncClient, agency_auth, monkeypatch):
        import app.api.xhs as xhs_api

        create_resp = await client.post(
            f"{API}/xhs/batches",
            headers=agency_auth["headers"],
            json={
                "category_id": "beauty",
                "run_mode": "trial",
                "input_type": "text",
                "input_text": "note 1\n\nnote 2",
            },
        )
        assert create_resp.status_code == 201, create_resp.text
        job = create_resp.json()

        dispatched: list[str] = []

        async def fake_dispatch(batch_id: str) -> None:
            dispatched.append(batch_id)

        monkeypatch.setattr(xhs_api, "_dispatch_xhs_batch_job", fake_dispatch)

        start_resp = await client.post(
            f"{API}/xhs/batches/{job['id']}/start",
            headers=agency_auth["headers"],
        )
        assert start_resp.status_code == 200, start_resp.text
        assert dispatched == [job["id"]]

    @pytest.mark.asyncio
    async def test_estimate_batch_returns_planned_trial_usage(self, client: AsyncClient, agency_auth, monkeypatch):
        import app.api.xhs as xhs_api

        async def fake_split_xhs_source_text(*args, **kwargs):
            return (
                [
                    {"content": "第一篇正文"},
                    {"content": "第二篇正文"},
                    {"content": "第三篇正文"},
                    {"content": "第四篇正文"},
                ],
                {"split_strategy": "ai_assisted"},
            )

        monkeypatch.setattr(xhs_api, "split_xhs_source_text", fake_split_xhs_source_text)

        resp = await client.post(
            f"{API}/xhs/batches/estimate",
            headers=agency_auth["headers"],
            json={
                "category_id": "beauty",
                "run_mode": "trial",
                "trial_sample_count": 2,
                "input_type": "text",
                "input_text": "原始长文本",
            },
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["estimated_items"] == 2
        assert data["total_split_items"] == 4
        assert data["split_strategy"] == "ai_assisted"
        assert data["estimated_tokens"] > 0
        assert float(data["estimated_cost"]) > 0

    @pytest.mark.asyncio
    async def test_create_batch_uses_split_service_result(self, client: AsyncClient, agency_auth, monkeypatch, test_db_session):
        import app.api.xhs as xhs_api

        async def fake_split_xhs_source_text(*args, **kwargs):
            return (
                [
                    {
                        "content": "AI 第一篇\n正文 A",
                        "title_guess": "AI 第一篇",
                        "split_by": "ai_assisted",
                        "model_meta": {"boundary_model": "split-model"},
                    },
                    {
                        "content": "AI 第二篇\n正文 B",
                        "title_guess": "AI 第二篇",
                        "split_by": "ai_assisted",
                        "model_meta": {"boundary_model": "split-model"},
                    },
                ],
                {"split_strategy": "ai_assisted", "split_model": "split-model", "split_tokens": 88},
            )

        monkeypatch.setattr(xhs_api, "split_xhs_source_text", fake_split_xhs_source_text)

        create_resp = await client.post(
            f"{API}/xhs/batches",
            headers=agency_auth["headers"],
            json={
                "category_id": "beauty",
                "run_mode": "trial",
                "input_type": "text",
                "input_text": "原始长文本",
            },
        )
        assert create_resp.status_code == 201, create_resp.text
        job = create_resp.json()
        assert job["total_items"] == 2

        result = await test_db_session.execute(
            select(XHSBatchItem).where(XHSBatchItem.batch_id == job["id"]).order_by(XHSBatchItem.item_id.asc())
        )
        items = list(result.scalars().all())
        assert len(items) == 2
        assert items[0].source_title_guess == "AI 第一篇"
        assert items[0].split_by == "ai_assisted"
        assert items[0].model_meta_json["boundary_model"] == "split-model"

    @pytest.mark.asyncio
    async def test_list_batch_items_supports_status_q_and_pagination(self, client: AsyncClient, agency_auth, test_db_session):
        create_resp = await client.post(
            f"{API}/xhs/batches",
            headers=agency_auth["headers"],
            json={
                "category_id": "beauty",
                "run_mode": "full",
                "input_type": "text",
                "input_text": "note 1\n\nnote 2\n\nnote 3",
            },
        )
        assert create_resp.status_code == 201, create_resp.text
        job = create_resp.json()

        result = await test_db_session.execute(
            select(XHSBatchItem).where(XHSBatchItem.batch_id == job["id"]).order_by(XHSBatchItem.item_id.asc())
        )
        items = list(result.scalars().all())
        items[0].status = "completed"
        items[0].final_title = "苹果肌分享"
        items[1].status = "failed"
        items[1].final_title = "通勤妆翻车"
        items[2].status = "completed"
        items[2].final_title = "苹果妆教程"
        await test_db_session.commit()

        resp = await client.get(
            f"{API}/xhs/batches/{job['id']}/items?status=completed&q=苹果&page=1&page_size=1",
            headers=agency_auth["headers"],
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["page"] == 1
        assert data["page_size"] == 1
        assert data["total"] == 2
        assert len(data["items"]) == 1
        assert data["items"][0]["index"] == 1
        assert data["items"][0]["title"] == "苹果肌分享"
        assert data["items"][0]["final_title"] == "苹果肌分享"

    @pytest.mark.asyncio
    async def test_list_batch_items_treats_failed_decision_items_as_needs_decision(self, client: AsyncClient, agency_auth, test_db_session):
        create_resp = await client.post(
            f"{API}/xhs/batches",
            headers=agency_auth["headers"],
            json={
                "category_id": "beauty",
                "run_mode": "full",
                "input_type": "text",
                "input_text": "note 1\n\nnote 2\n\nnote 3",
            },
        )
        assert create_resp.status_code == 201, create_resp.text
        job = create_resp.json()

        result = await test_db_session.execute(
            select(XHSBatchItem).where(XHSBatchItem.batch_id == job["id"]).order_by(XHSBatchItem.item_id.asc())
        )
        items = list(result.scalars().all())
        items[0].status = "completed"
        items[1].status = "failed"
        items[1].safe_rewrite_reason = "alignment_not_satisfied"
        items[1].rewrite_fail_reasons_json = ["主版本核心卖点和方向要求冲突"]
        items[2].status = "failed"
        items[2].rewrite_fail_reasons_json = ["AI 超时"]
        await test_db_session.commit()

        decision_resp = await client.get(
            f"{API}/xhs/batches/{job['id']}/items?status=needs_decision",
            headers=agency_auth["headers"],
        )
        assert decision_resp.status_code == 200, decision_resp.text
        decision_data = decision_resp.json()
        assert [item["item_id"] for item in decision_data["items"]] == ["item_002"]
        assert decision_data["items"][0]["decision_required"] is True

        failed_resp = await client.get(
            f"{API}/xhs/batches/{job['id']}/items?status=failed",
            headers=agency_auth["headers"],
        )
        assert failed_resp.status_code == 200, failed_resp.text
        failed_data = failed_resp.json()
        assert [item["item_id"] for item in failed_data["items"]] == ["item_003"]
        assert failed_data["items"][0]["decision_required"] is False

    @pytest.mark.asyncio
    async def test_list_batch_items_returns_source_and_risk_details(self, client: AsyncClient, agency_auth, test_db_session):
        create_resp = await client.post(
            f"{API}/xhs/batches",
            headers=agency_auth["headers"],
            json={
                "category_id": "beauty",
                "run_mode": "full",
                "input_type": "text",
                "input_text": "原文标题\n原文正文",
            },
        )
        assert create_resp.status_code == 201, create_resp.text
        job = create_resp.json()

        result = await test_db_session.execute(
            select(XHSBatchItem).where(XHSBatchItem.batch_id == job["id"]).order_by(XHSBatchItem.item_id.asc())
        )
        item = result.scalars().first()
        item.final_title = "终稿标题"
        item.final_body = "终稿正文"
        item.verifier_json = {"summary": "命中功效表达", "severity": "medium", "group": "compliance"}
        item.rewrite_fail_reasons_json = ["功效词过强", "缺少限制语"]
        await test_db_session.commit()

        resp = await client.get(
            f"{API}/xhs/batches/{job['id']}/items",
            headers=agency_auth["headers"],
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["items"][0]["source_text"] == "原文标题\n原文正文"
        assert data["items"][0]["verifier"]["summary"] == "命中功效表达"
        assert data["items"][0]["rewrite_fail_reasons"] == ["功效词过强", "缺少限制语"]

    @pytest.mark.asyncio
    async def test_promote_trial_batch_creates_full_batch(self, client: AsyncClient, agency_auth, monkeypatch):
        import app.api.xhs as xhs_api

        create_resp = await client.post(
            f"{API}/xhs/batches",
            headers=agency_auth["headers"],
            json={
                "category_id": "beauty",
                "run_mode": "trial",
                "trial_sample_count": 1,
                "input_type": "text",
                "input_text": "note 1\n\nnote 2",
            },
        )
        assert create_resp.status_code == 201, create_resp.text
        trial_job = create_resp.json()

        dispatched: list[str] = []

        async def fake_dispatch(batch_id: str) -> None:
            dispatched.append(batch_id)

        monkeypatch.setattr(xhs_api, "_dispatch_xhs_batch_job", fake_dispatch)

        promote_resp = await client.post(
            f"{API}/xhs/batches/{trial_job['id']}/promote",
            headers=agency_auth["headers"],
        )
        assert promote_resp.status_code == 201, promote_resp.text
        full_job = promote_resp.json()
        assert full_job["id"] != trial_job["id"]
        assert full_job["run_mode"] == "full"
        assert full_job["total_items"] == 2
        assert dispatched == [full_job["id"]]

    @pytest.mark.asyncio
    async def test_retry_batch_only_dispatches_failed_items(self, client: AsyncClient, agency_auth, monkeypatch, test_db_session):
        import app.api.xhs as xhs_api

        create_resp = await client.post(
            f"{API}/xhs/batches",
            headers=agency_auth["headers"],
            json={
                "category_id": "beauty",
                "run_mode": "full",
                "input_type": "text",
                "input_text": "note 1\n\nnote 2\n\nnote 3",
            },
        )
        assert create_resp.status_code == 201, create_resp.text
        job = create_resp.json()

        result = await test_db_session.execute(
            select(XHSBatchItem).where(XHSBatchItem.batch_id == job["id"]).order_by(XHSBatchItem.item_id.asc())
        )
        items = list(result.scalars().all())
        items[0].status = "completed"
        items[0].copy_ready_text = "稿件一"
        items[1].status = "failed"
        items[1].final_title = "旧失败稿"
        items[2].status = "failed"
        items[2].safe_rewrite_reason = "alignment_not_satisfied"
        items[2].rewrite_fail_reasons_json = ["主版本核心卖点和方向要求冲突"]
        items[2].final_title = "待你决定的失败稿"
        await test_db_session.commit()

        dispatched: list[tuple[str, list[str] | None]] = []

        async def fake_dispatch_items(batch_id: str, item_ids: list[str] | None) -> None:
            dispatched.append((batch_id, item_ids))

        monkeypatch.setattr(xhs_api, "_dispatch_xhs_batch_job_items", fake_dispatch_items)

        retry_resp = await client.post(
            f"{API}/xhs/batches/{job['id']}/retry",
            headers=agency_auth["headers"],
        )
        assert retry_resp.status_code == 200, retry_resp.text
        assert dispatched == [(job["id"], ["item_002"])]

        await test_db_session.refresh(items[1])
        await test_db_session.refresh(items[2])
        assert items[1].status == "pending"
        assert items[1].final_title is None
        assert items[1].model_meta_json["retry_requested"] is True
        assert items[2].status == "failed"
        assert items[2].final_title == "待你决定的失败稿"

    @pytest.mark.asyncio
    async def test_submit_batch_item_decision_requeues_selected_item(self, client: AsyncClient, agency_auth, monkeypatch, test_db_session):
        import app.api.xhs as xhs_api

        create_resp = await client.post(
            f"{API}/xhs/batches",
            headers=agency_auth["headers"],
            json={
                "category_id": "beauty",
                "run_mode": "full",
                "input_type": "text",
                "input_text": "note 1",
            },
        )
        assert create_resp.status_code == 201, create_resp.text
        job = create_resp.json()

        item = (
            await test_db_session.execute(
                select(XHSBatchItem).where(XHSBatchItem.batch_id == job["id"])
            )
        ).scalars().one()
        item.status = "needs_decision"
        item.final_title = "候选稿"
        item.final_body = "候选正文"
        item.copy_ready_text = "候选稿\n\n候选正文"
        item.model_meta_json = {
            "decision_summary": "方向规则和卖点要求冲突，需要人工裁决。",
            "decision_options": [
                {"id": "compliance_first", "title": "优先过审交付", "summary": "先过审", "tradeoffs": [], "recommended": True},
                {"id": "style_first", "title": "优先保原稿感", "summary": "先保原稿感", "tradeoffs": [], "recommended": False},
            ],
            "recommended_decision_option_id": "compliance_first",
        }
        await test_db_session.commit()

        dispatched: list[tuple[str, list[str] | None]] = []

        async def fake_dispatch_items(batch_id: str, item_ids: list[str] | None) -> None:
            dispatched.append((batch_id, item_ids))

        monkeypatch.setattr(xhs_api, "_dispatch_xhs_batch_job_items", fake_dispatch_items)

        decision_resp = await client.post(
            f"{API}/xhs/batches/{job['id']}/items/{item.item_id}/decision",
            headers=agency_auth["headers"],
            json={"option_id": "compliance_first"},
        )
        assert decision_resp.status_code == 200, decision_resp.text
        assert dispatched == [(job["id"], [item.item_id])]

        await test_db_session.refresh(item)
        assert item.status == "pending"
        assert item.final_title is None
        assert item.model_meta_json["selected_decision_option_id"] == "compliance_first"
        assert item.model_meta_json["retry_requested"] is True

    @pytest.mark.asyncio
    async def test_export_all_md_returns_markdown_document(self, client: AsyncClient, agency_auth, test_db_session):
        create_resp = await client.post(
            f"{API}/xhs/batches",
            headers=agency_auth["headers"],
            json={
                "category_id": "beauty",
                "run_mode": "full",
                "input_type": "text",
                "input_text": "note 1\n\nnote 2",
            },
        )
        assert create_resp.status_code == 201, create_resp.text
        job = create_resp.json()

        result = await test_db_session.execute(
            select(XHSBatchItem).where(XHSBatchItem.batch_id == job["id"]).order_by(XHSBatchItem.item_id.asc())
        )
        items = list(result.scalars().all())
        items[0].source_title_guess = "场景一"
        items[0].status = "completed"
        items[0].final_title = "标题一"
        items[0].final_body = "正文一"
        items[0].final_hashtags_json = ["#标签1", "#标签2"]
        items[0].copy_ready_text = "标题一\n\n正文一\n\n#标签1 #标签2"
        items[0].verifier_pass = True
        await test_db_session.commit()

        export_resp = await client.get(
            f"{API}/xhs/batches/{job['id']}/export/all.md",
            headers=agency_auth["headers"],
        )
        assert export_resp.status_code == 200, export_resp.text
        assert export_resp.headers["content-type"].startswith("text/markdown")
        assert "attachment;" in export_resp.headers["content-disposition"]
        assert "# 小红书批量终稿" in export_resp.text
        assert "## 0001｜场景一" in export_resp.text
        assert "标题：标题一" in export_resp.text

        log_result = await test_db_session.execute(
            select(XHSExportLog).where(XHSExportLog.batch_id == job["id"], XHSExportLog.type == "all_md")
        )
        export_log = log_result.scalars().one()
        assert export_log.status == "completed"
        assert export_log.response_json["url"].endswith("/export/all.md")

    @pytest.mark.asyncio
    async def test_export_feishu_creates_export_log_and_returns_completed(self, client: AsyncClient, agency_auth, monkeypatch, test_db_session):
        create_resp = await client.post(
            f"{API}/xhs/batches",
            headers=agency_auth["headers"],
            json={
                "category_id": "beauty",
                "run_mode": "full",
                "input_type": "text",
                "input_text": "note 1",
            },
        )
        assert create_resp.status_code == 201, create_resp.text
        job = create_resp.json()

        result = await test_db_session.execute(
            select(XHSBatchItem).where(XHSBatchItem.batch_id == job["id"]).order_by(XHSBatchItem.item_id.asc())
        )
        item = result.scalars().first()
        item.source_title_guess = "场景一"
        item.status = "completed"
        item.final_title = "标题一"
        item.final_body = "正文一"
        item.final_hashtags_json = ["#标签1"]
        item.copy_ready_text = "标题一\n\n正文一\n\n#标签1"
        item.verifier_pass = True
        await test_db_session.commit()

        def fake_build_feishu_export_result(**kwargs):
            return {
                "status": "completed",
                "docs": [
                    {
                        "doc_token": "doc_1",
                        "doc_title": "导出标题",
                        "doc_url": "https://feishu.mock/docx/doc_1",
                        "item_range": "1-1",
                    }
                ],
            }

        monkeypatch.setattr("app.api.xhs.build_feishu_export_result", fake_build_feishu_export_result)

        export_resp = await client.post(
            f"{API}/xhs/batches/{job['id']}/export/feishu",
            headers=agency_auth["headers"],
            json={"folder_token": "fld_123", "doc_title": "导出标题"},
        )
        assert export_resp.status_code == 200, export_resp.text
        assert export_resp.json()["status"] == "completed"

        log_result = await test_db_session.execute(
            select(XHSExportLog).where(XHSExportLog.batch_id == job["id"])
        )
        export_log = log_result.scalars().one()
        assert export_log.type == "feishu"
        assert export_log.status == "completed"
        assert export_log.response_json["docs"][0]["doc_token"] == "doc_1"

    @pytest.mark.asyncio
    async def test_export_feishu_status_returns_latest_docs(self, client: AsyncClient, agency_auth, test_db_session):
        create_resp = await client.post(
            f"{API}/xhs/batches",
            headers=agency_auth["headers"],
            json={
                "category_id": "beauty",
                "run_mode": "full",
                "input_type": "text",
                "input_text": "note 1",
            },
        )
        assert create_resp.status_code == 201, create_resp.text
        job = create_resp.json()

        test_db_session.add(
            XHSExportLog(
                id="log-feishu-1",
                batch_id=job["id"],
                type="feishu",
                status="completed",
                request_json={"doc_title": "导出标题"},
                response_json={
                    "docs": [
                        {
                            "doc_token": "doc_2",
                            "doc_title": "导出标题",
                            "doc_url": "https://feishu.mock/docx/doc_2",
                            "item_range": "1-2",
                        }
                    ]
                },
                error=None,
            )
        )
        await test_db_session.commit()

        status_resp = await client.get(
            f"{API}/xhs/batches/{job['id']}/export/feishu/status",
            headers=agency_auth["headers"],
        )
        assert status_resp.status_code == 200, status_resp.text
        data = status_resp.json()
        assert data["status"] == "completed"
        assert data["docs"][0]["doc_token"] == "doc_2"

    @pytest.mark.asyncio
    async def test_list_batch_export_logs_supports_type_filter(self, client: AsyncClient, agency_auth, test_db_session):
        create_resp = await client.post(
            f"{API}/xhs/batches",
            headers=agency_auth["headers"],
            json={
                "category_id": "beauty",
                "run_mode": "full",
                "input_type": "text",
                "input_text": "note 1",
            },
        )
        assert create_resp.status_code == 201, create_resp.text
        job = create_resp.json()

        test_db_session.add_all(
            [
                XHSExportLog(
                    id="log-allmd-1",
                    batch_id=job["id"],
                    type="all_md",
                    status="completed",
                    request_json={},
                    response_json={},
                    error=None,
                ),
                XHSExportLog(
                    id="log-feishu-2",
                    batch_id=job["id"],
                    type="feishu",
                    status="completed",
                    request_json={},
                    response_json={},
                    error=None,
                ),
            ]
        )
        await test_db_session.commit()

        resp = await client.get(
            f"{API}/xhs/batches/{job['id']}/exports?type=feishu",
            headers=agency_auth["headers"],
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert len(data) == 1
        assert data[0]["type"] == "feishu"
