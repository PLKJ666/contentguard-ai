"""
规则管理 API 测试
测试覆盖: 违禁词库、白名单、竞品库、平台规则、品牌方平台规则 CRUD
"""
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from httpx import AsyncClient

from app.schemas.review import ScriptReviewResponse, ViolationType


class TestForbiddenWords:
    """违禁词库管理"""

    @pytest.mark.asyncio
    async def test_list_forbidden_words_returns_200(self, client: AsyncClient, tenant_id: str):
        """查询违禁词列表返回 200"""
        response = await client.get(
            "/api/v1/rules/forbidden-words",
            headers={"X-Tenant-ID": tenant_id},
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_list_forbidden_words_returns_array(self, client: AsyncClient, tenant_id: str):
        """查询违禁词返回数组"""
        response = await client.get(
            "/api/v1/rules/forbidden-words",
            headers={"X-Tenant-ID": tenant_id},
        )
        data = response.json()

        assert "items" in data
        assert isinstance(data["items"], list)

    @pytest.mark.asyncio
    async def test_forbidden_word_has_category(self, client: AsyncClient, tenant_id: str):
        """违禁词包含分类信息"""
        response = await client.get(
            "/api/v1/rules/forbidden-words",
            headers={"X-Tenant-ID": tenant_id},
        )
        data = response.json()

        if data["items"]:
            word = data["items"][0]
            assert "category" in word  # 极限词、功效词、敏感词等
            assert "word" in word

    @pytest.mark.asyncio
    async def test_add_forbidden_word_returns_201(self, client: AsyncClient, tenant_id: str, forbidden_word: str):
        """添加违禁词返回 201"""
        response = await client.post(
            "/api/v1/rules/forbidden-words",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "word": forbidden_word,
                "category": "custom",
                "severity": "medium",
            }
        )
        assert response.status_code == 201
        data = response.json()
        assert data.get("id")
        assert data.get("word") == forbidden_word
        assert data.get("category") == "custom"
        assert data.get("severity") == "medium"

    @pytest.mark.asyncio
    async def test_add_duplicate_word_returns_409(self, client: AsyncClient, tenant_id: str, forbidden_word: str):
        """添加重复违禁词返回 409"""
        headers = {"X-Tenant-ID": tenant_id}
        # 先添加一次
        await client.post(
            "/api/v1/rules/forbidden-words",
            headers=headers,
            json={"word": forbidden_word, "category": "custom", "severity": "medium"}
        )
        # 再次添加
        response = await client.post(
            "/api/v1/rules/forbidden-words",
            headers=headers,
            json={"word": forbidden_word, "category": "custom", "severity": "medium"}
        )
        assert response.status_code == 409

    @pytest.mark.asyncio
    async def test_delete_forbidden_word_returns_204(self, client: AsyncClient, tenant_id: str, forbidden_word: str):
        """删除违禁词返回 204"""
        headers = {"X-Tenant-ID": tenant_id}
        # 先添加
        create_resp = await client.post(
            "/api/v1/rules/forbidden-words",
            headers=headers,
            json={"word": forbidden_word, "category": "custom", "severity": "low"}
        )
        word_id = create_resp.json()["id"]

        # 删除
        response = await client.delete(
            f"/api/v1/rules/forbidden-words/{word_id}",
            headers=headers,
        )
        assert response.status_code == 204

    @pytest.mark.asyncio
    async def test_filter_by_category(self, client: AsyncClient, tenant_id: str):
        """按分类筛选违禁词"""
        response = await client.get(
            "/api/v1/rules/forbidden-words?category=absolute",
            headers={"X-Tenant-ID": tenant_id},
        )
        assert response.status_code == 200


class TestWhitelist:
    """白名单管理"""

    @pytest.mark.asyncio
    async def test_list_whitelist_returns_200(self, client: AsyncClient, tenant_id: str):
        """查询白名单返回 200"""
        response = await client.get(
            "/api/v1/rules/whitelist",
            headers={"X-Tenant-ID": tenant_id},
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_add_to_whitelist_returns_201(self, client: AsyncClient, tenant_id: str, whitelist_term: str, brand_id: str):
        """添加白名单返回 201"""
        response = await client.post(
            "/api/v1/rules/whitelist",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "term": whitelist_term,
                "reason": "品牌方授权使用",
                "brand_id": brand_id,
            }
        )
        assert response.status_code == 201
        data = response.json()
        assert data.get("id")
        assert data.get("term") == whitelist_term
        assert data.get("brand_id") == brand_id

    @pytest.mark.asyncio
    async def test_whitelist_overrides_forbidden(self, client: AsyncClient, tenant_id: str, whitelist_term: str, brand_id: str):
        """白名单覆盖违禁词检测"""
        headers = {"X-Tenant-ID": tenant_id}
        # 先添加到白名单
        await client.post(
            "/api/v1/rules/whitelist",
            headers=headers,
            json={
                "term": whitelist_term,
                "reason": "品牌 slogan",
                "brand_id": brand_id,
            }
        )

        # 提交包含该词的脚本
        response = await client.post(
            "/api/v1/scripts/review",
            headers=headers,
            json={
                "content": f"我们是您的{whitelist_term}",
                "platform": "douyin",
                "brand_id": brand_id,
            }
        )
        data = response.json()
        parsed = ScriptReviewResponse.model_validate(data)

        flagged_words = [
            v.content for v in parsed.violations
            if v.type == ViolationType.FORBIDDEN_WORD
        ]
        assert whitelist_term not in flagged_words

    @pytest.mark.asyncio
    async def test_whitelist_scoped_to_brand(self, client: AsyncClient, tenant_id: str, whitelist_term: str, brand_id: str, other_brand_id: str):
        """白名单仅对指定品牌生效"""
        headers = {"X-Tenant-ID": tenant_id}
        # 为 brand-001 添加白名单
        await client.post(
            "/api/v1/rules/whitelist",
            headers=headers,
            json={
                "term": whitelist_term,
                "reason": "品牌方授权",
                "brand_id": brand_id,
            }
        )

        # 其他品牌提交应该仍被标记
        response = await client.post(
            "/api/v1/scripts/review",
            headers=headers,
            json={
                "content": f"这是{whitelist_term}",
                "platform": "douyin",
                "brand_id": other_brand_id,  # 不同品牌
            }
        )
        data = response.json()
        parsed = ScriptReviewResponse.model_validate(data)

        assert len(parsed.violations) > 0 or parsed.score < 100


class TestCompetitorList:
    """竞品库管理"""

    @pytest.mark.asyncio
    async def test_list_competitors_returns_200(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """查询竞品列表返回 200"""
        response = await client.get(
            f"/api/v1/rules/competitors?brand_id={brand_id}",
            headers={"X-Tenant-ID": tenant_id},
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_add_competitor_returns_201(self, client: AsyncClient, tenant_id: str, competitor_name: str, brand_id: str):
        """添加竞品返回 201"""
        response = await client.post(
            "/api/v1/rules/competitors",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "name": competitor_name,
                "brand_id": brand_id,
                "logo_url": "https://example.com/competitor-logo.png",
                "keywords": [competitor_name],
            }
        )
        assert response.status_code == 201
        data = response.json()
        assert data.get("id")
        assert data.get("name") == competitor_name
        assert data.get("brand_id") == brand_id

    @pytest.mark.asyncio
    async def test_competitor_has_logo(self, client: AsyncClient, tenant_id: str, competitor_name: str, brand_id: str):
        """竞品包含 Logo 信息（用于视觉检测）"""
        headers = {"X-Tenant-ID": tenant_id}
        await client.post(
            "/api/v1/rules/competitors",
            headers=headers,
            json={
                "name": competitor_name,
                "brand_id": brand_id,
                "logo_url": "https://example.com/logo-b.png",
                "keywords": [competitor_name],
            }
        )

        response = await client.get(
            f"/api/v1/rules/competitors?brand_id={brand_id}",
            headers=headers,
        )
        data = response.json()

        competitors = data.get("items", [])
        target = next((c for c in competitors if c.get("name") == competitor_name), None)
        assert target is not None
        assert target.get("logo_url")

    @pytest.mark.asyncio
    async def test_delete_competitor_returns_204(self, client: AsyncClient, tenant_id: str, competitor_name: str, brand_id: str):
        """删除竞品返回 204"""
        headers = {"X-Tenant-ID": tenant_id}
        create_resp = await client.post(
            "/api/v1/rules/competitors",
            headers=headers,
            json={
                "name": competitor_name,
                "brand_id": brand_id,
                "keywords": [competitor_name],
            }
        )
        competitor_id = create_resp.json()["id"]

        response = await client.delete(
            f"/api/v1/rules/competitors/{competitor_id}",
            headers=headers,
        )
        assert response.status_code == 204


class TestPlatformRules:
    """平台规则管理"""

    @pytest.mark.asyncio
    async def test_list_platform_rules_returns_200(self, client: AsyncClient, tenant_id: str):
        """查询平台规则返回 200"""
        response = await client.get(
            "/api/v1/rules/platforms",
            headers={"X-Tenant-ID": tenant_id},
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_get_platform_rules_by_name(self, client: AsyncClient, tenant_id: str):
        """按平台名称查询规则"""
        response = await client.get(
            "/api/v1/rules/platforms/douyin",
            headers={"X-Tenant-ID": tenant_id},
        )
        assert response.status_code == 200

        data = response.json()
        assert data["platform"] == "douyin"
        assert "rules" in data

    @pytest.mark.asyncio
    async def test_platform_rules_have_version(self, client: AsyncClient, tenant_id: str):
        """平台规则包含版本信息"""
        response = await client.get(
            "/api/v1/rules/platforms/douyin",
            headers={"X-Tenant-ID": tenant_id},
        )
        data = response.json()

        assert "version" in data
        assert "updated_at" in data

    @pytest.mark.asyncio
    async def test_supported_platforms(self, client: AsyncClient, tenant_id: str):
        """支持的平台列表"""
        response = await client.get(
            "/api/v1/rules/platforms",
            headers={"X-Tenant-ID": tenant_id},
        )
        data = response.json()

        platforms = [p["platform"] for p in data["items"]]
        assert "douyin" in platforms
        assert "xiaohongshu" in platforms
        assert "bilibili" in platforms


class TestRuleConflictDetection:
    """规则冲突检测"""

    @pytest.mark.asyncio
    async def test_detect_brief_platform_conflict(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """检测 Brief 与平台规则冲突（required_phrases）"""
        response = await client.post(
            "/api/v1/rules/validate",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "brand_id": brand_id,
                "platform": "douyin",
                "brief_rules": {
                    "required_phrases": ["绝对有效"],
                }
            }
        )
        assert response.status_code == 200

        data = response.json()
        assert "conflicts" in data
        assert isinstance(data["conflicts"], list)
        assert len(data["conflicts"]) > 0

    @pytest.mark.asyncio
    async def test_conflict_includes_details(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """冲突检测包含详细信息"""
        response = await client.post(
            "/api/v1/rules/validate",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "brand_id": brand_id,
                "platform": "douyin",
                "brief_rules": {
                    "required_phrases": ["最好的产品"],
                }
            }
        )
        data = response.json()

        assert data.get("conflicts")
        conflict = data["conflicts"][0]
        assert "brief_rule" in conflict
        assert "platform_rule" in conflict
        assert "suggestion" in conflict

    @pytest.mark.asyncio
    async def test_selling_points_conflict_detection(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """selling_points 字段也参与冲突检测"""
        response = await client.post(
            "/api/v1/rules/validate",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "brand_id": brand_id,
                "platform": "douyin",
                "brief_rules": {
                    "selling_points": ["100%纯天然成分", "绝对安全"],
                }
            }
        )
        data = response.json()
        assert len(data["conflicts"]) >= 2  # "100%" 和 "绝对" 都命中

    @pytest.mark.asyncio
    async def test_no_conflict_returns_empty(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """无冲突时返回空列表"""
        response = await client.post(
            "/api/v1/rules/validate",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "brand_id": brand_id,
                "platform": "douyin",
                "brief_rules": {
                    "selling_points": ["温和护肤", "适合敏感肌"],
                }
            }
        )
        data = response.json()
        assert data["conflicts"] == []

    @pytest.mark.asyncio
    async def test_duration_conflict_brief_max_below_platform_min(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """Brief 最长时长低于平台最短要求"""
        response = await client.post(
            "/api/v1/rules/validate",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "brand_id": brand_id,
                "platform": "douyin",  # 硬编码 min_seconds=7
                "brief_rules": {
                    "max_duration": 5,
                }
            }
        )
        data = response.json()
        assert len(data["conflicts"]) >= 1
        assert any("时长" in c["brief_rule"] for c in data["conflicts"])

    @pytest.mark.asyncio
    async def test_db_rules_participate_in_conflict_detection(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """DB 中 active 的规则参与冲突检测"""
        headers = {"X-Tenant-ID": tenant_id}

        # 创建并确认一条包含自定义违禁词的 DB 平台规则
        create_resp = await _create_platform_rule(client, tenant_id, brand_id, platform="douyin")
        rule_id = create_resp.json()["id"]

        custom_rules = {
            "forbidden_words": ["自定义违禁词ABC"],
            "restricted_words": [],
            "duration": {"min_seconds": 15, "max_seconds": 120},
            "content_requirements": [],
            "other_rules": [],
        }
        await client.put(
            f"/api/v1/rules/platform-rules/{rule_id}/confirm",
            headers=headers,
            json={"parsed_rules": custom_rules},
        )

        # 验证 DB 违禁词参与检测
        response = await client.post(
            "/api/v1/rules/validate",
            headers=headers,
            json={
                "brand_id": brand_id,
                "platform": "douyin",
                "brief_rules": {
                    "selling_points": ["这个自定义违禁词ABC很好"],
                }
            }
        )
        data = response.json()
        assert len(data["conflicts"]) >= 1
        assert any("自定义违禁词ABC" in c["suggestion"] for c in data["conflicts"])

    @pytest.mark.asyncio
    async def test_db_duration_conflict(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """DB 规则中的时长限制参与检测"""
        headers = {"X-Tenant-ID": tenant_id}

        # 创建 DB 规则：max_seconds=60
        create_resp = await _create_platform_rule(client, tenant_id, brand_id, platform="xiaohongshu")
        rule_id = create_resp.json()["id"]

        custom_rules = {
            "forbidden_words": [],
            "restricted_words": [],
            "duration": {"min_seconds": 10, "max_seconds": 60},
            "content_requirements": [],
            "other_rules": [],
        }
        await client.put(
            f"/api/v1/rules/platform-rules/{rule_id}/confirm",
            headers=headers,
            json={"parsed_rules": custom_rules},
        )

        # Brief 最短时长 90s > 平台最长 60s → 冲突
        response = await client.post(
            "/api/v1/rules/validate",
            headers=headers,
            json={
                "brand_id": brand_id,
                "platform": "xiaohongshu",
                "brief_rules": {
                    "min_duration": 90,
                }
            }
        )
        data = response.json()
        assert len(data["conflicts"]) >= 1
        assert any("最长限制" in c["platform_rule"] for c in data["conflicts"])

    @pytest.mark.asyncio
    async def test_db_and_hardcoded_rules_merge(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """DB 规则与硬编码规则合并检测"""
        headers = {"X-Tenant-ID": tenant_id}

        # DB 规则只包含自定义违禁词
        create_resp = await _create_platform_rule(client, tenant_id, brand_id, platform="douyin")
        rule_id = create_resp.json()["id"]

        await client.put(
            f"/api/v1/rules/platform-rules/{rule_id}/confirm",
            headers=headers,
            json={"parsed_rules": {
                "forbidden_words": ["DB专属词"],
                "restricted_words": [],
                "duration": None,
                "content_requirements": [],
                "other_rules": [],
            }},
        )

        # selling_points 同时包含 DB 违禁词和硬编码违禁词
        response = await client.post(
            "/api/v1/rules/validate",
            headers=headers,
            json={
                "brand_id": brand_id,
                "platform": "douyin",
                "brief_rules": {
                    "selling_points": ["这是DB专属词内容", "最好的选择"],
                }
            }
        )
        data = response.json()
        # 应同时检出 DB 违禁词和硬编码违禁词
        suggestions = [c["suggestion"] for c in data["conflicts"]]
        assert any("DB专属词" in s for s in suggestions)
        assert any("最好" in s for s in suggestions)

    @pytest.mark.asyncio
    async def test_unknown_platform_returns_empty(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """未知平台返回空冲突（无硬编码规则，无 DB 规则）"""
        response = await client.post(
            "/api/v1/rules/validate",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "brand_id": brand_id,
                "platform": "unknown_platform",
                "brief_rules": {
                    "selling_points": ["最好的产品"],
                }
            }
        )
        data = response.json()
        assert data["conflicts"] == []


# ==================== 品牌方平台规则（文档上传 + AI 解析） ====================

# Mock AI 解析返回的规则数据
MOCK_PARSED_RULES = {
    "forbidden_words": ["绝对有效", "最强", "第一"],
    "restricted_words": [
        {"word": "推荐", "condition": "不能用于医疗产品", "suggestion": "建议改为'供参考'"}
    ],
    "duration": {"min_seconds": 7, "max_seconds": 60},
    "content_requirements": ["必须展示产品正面", "需口播品牌名"],
    "other_rules": [
        {"rule": "字幕要求", "description": "视频必须添加中文字幕"}
    ],
}

MOCK_AI_JSON_RESPONSE = json.dumps(MOCK_PARSED_RULES, ensure_ascii=False)


def _mock_ai_client_for_parse():
    """创建用于文档解析的 mock AI 客户端"""
    client = MagicMock()
    client.chat_completion = AsyncMock(return_value=MagicMock(
        content=MOCK_AI_JSON_RESPONSE,
    ))
    client.close = AsyncMock()
    return client


async def _create_platform_rule(
    client: AsyncClient,
    tenant_id: str,
    brand_id: str,
    platform: str = "douyin",
    document_name: str = "规则文档.pdf",
) -> dict:
    """辅助函数：创建一条 draft 平台规则"""
    with patch(
        "app.api.rules.DocumentParser.download_and_parse",
        new_callable=AsyncMock,
        return_value="这是平台规则文档内容...",
    ), patch(
        "app.api.rules.AIServiceFactory.get_client",
        new_callable=AsyncMock,
        return_value=_mock_ai_client_for_parse(),
    ), patch(
        "app.api.rules.AIServiceFactory.get_config",
        new_callable=AsyncMock,
        return_value=MagicMock(models={"text": "gpt-4o"}),
    ):
        resp = await client.post(
            "/api/v1/rules/platform-rules/parse",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "document_url": "https://tos.example.com/rules.pdf",
                "document_name": document_name,
                "platform": platform,
                "brand_id": brand_id,
            },
        )
    return resp


class TestBrandPlatformRuleParse:
    """品牌方平台规则 — 上传文档 + AI 解析"""

    @pytest.mark.asyncio
    async def test_parse_returns_201_draft(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """上传文档解析返回 201，状态为 draft"""
        resp = await _create_platform_rule(client, tenant_id, brand_id)
        assert resp.status_code == 201

        data = resp.json()
        assert data["status"] == "draft"
        assert data["platform"] == "douyin"
        assert data["brand_id"] == brand_id
        assert data["id"].startswith("pr-")
        assert data["document_name"] == "规则文档.pdf"

    @pytest.mark.asyncio
    async def test_parse_returns_parsed_rules(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """解析后返回结构化规则"""
        resp = await _create_platform_rule(client, tenant_id, brand_id)
        data = resp.json()

        rules = data["parsed_rules"]
        assert "forbidden_words" in rules
        assert "restricted_words" in rules
        assert "duration" in rules
        assert "content_requirements" in rules
        assert "other_rules" in rules
        assert len(rules["forbidden_words"]) == 3
        assert "绝对有效" in rules["forbidden_words"]

    @pytest.mark.asyncio
    async def test_parse_empty_document_returns_400(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """空文档返回 400"""
        with patch(
            "app.api.rules.DocumentParser.download_and_parse",
            new_callable=AsyncMock,
            return_value="   ",
        ):
            resp = await client.post(
                "/api/v1/rules/platform-rules/parse",
                headers={"X-Tenant-ID": tenant_id},
                json={
                    "document_url": "https://tos.example.com/empty.pdf",
                    "document_name": "empty.pdf",
                    "platform": "douyin",
                    "brand_id": brand_id,
                },
            )
        assert resp.status_code == 400
        assert "内容为空" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_parse_unsupported_format_returns_400(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """不支持的文件格式返回 400"""
        with patch(
            "app.api.rules.DocumentParser.download_and_parse",
            new_callable=AsyncMock,
            side_effect=ValueError("不支持的文件格式: zip"),
        ):
            resp = await client.post(
                "/api/v1/rules/platform-rules/parse",
                headers={"X-Tenant-ID": tenant_id},
                json={
                    "document_url": "https://tos.example.com/file.zip",
                    "document_name": "file.zip",
                    "platform": "douyin",
                    "brand_id": brand_id,
                },
            )
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_parse_ai_failure_returns_empty_rules(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """AI 解析失败时返回空规则结构（降级处理）"""
        with patch(
            "app.api.rules.DocumentParser.download_and_parse",
            new_callable=AsyncMock,
            return_value="文档内容...",
        ), patch(
            "app.api.rules.AIServiceFactory.get_client",
            new_callable=AsyncMock,
            return_value=None,
        ):
            resp = await client.post(
                "/api/v1/rules/platform-rules/parse",
                headers={"X-Tenant-ID": tenant_id},
                json={
                    "document_url": "https://tos.example.com/rules.pdf",
                    "document_name": "rules.pdf",
                    "platform": "douyin",
                    "brand_id": brand_id,
                },
            )
        assert resp.status_code == 201
        rules = resp.json()["parsed_rules"]
        assert rules["forbidden_words"] == []
        assert rules["content_requirements"] == []
        assert rules["duration"] is None

    @pytest.mark.asyncio
    async def test_parse_multiple_platforms(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """同一品牌方可以上传不同平台的规则"""
        r1 = await _create_platform_rule(client, tenant_id, brand_id, platform="douyin")
        r2 = await _create_platform_rule(client, tenant_id, brand_id, platform="xiaohongshu")

        assert r1.status_code == 201
        assert r2.status_code == 201
        assert r1.json()["platform"] == "douyin"
        assert r2.json()["platform"] == "xiaohongshu"


class TestBrandPlatformRuleConfirm:
    """品牌方平台规则 — 确认/生效"""

    @pytest.mark.asyncio
    async def test_confirm_sets_active(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """确认规则后状态变为 active"""
        # 先创建 draft
        create_resp = await _create_platform_rule(client, tenant_id, brand_id)
        rule_id = create_resp.json()["id"]

        # 确认
        confirm_resp = await client.put(
            f"/api/v1/rules/platform-rules/{rule_id}/confirm",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "parsed_rules": MOCK_PARSED_RULES,
            },
        )
        assert confirm_resp.status_code == 200
        data = confirm_resp.json()
        assert data["status"] == "active"
        assert data["id"] == rule_id

    @pytest.mark.asyncio
    async def test_confirm_with_edited_rules(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """品牌方修改后确认"""
        create_resp = await _create_platform_rule(client, tenant_id, brand_id)
        rule_id = create_resp.json()["id"]

        edited_rules = {
            "forbidden_words": ["绝对有效", "最强", "第一", "新增的违禁词"],
            "restricted_words": [],
            "duration": {"min_seconds": 10, "max_seconds": 120},
            "content_requirements": ["必须展示产品"],
            "other_rules": [],
        }

        confirm_resp = await client.put(
            f"/api/v1/rules/platform-rules/{rule_id}/confirm",
            headers={"X-Tenant-ID": tenant_id},
            json={"parsed_rules": edited_rules},
        )
        assert confirm_resp.status_code == 200
        data = confirm_resp.json()
        assert "新增的违禁词" in data["parsed_rules"]["forbidden_words"]
        assert data["parsed_rules"]["duration"]["min_seconds"] == 10

    @pytest.mark.asyncio
    async def test_confirm_deactivates_old_rule(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """确认新规则后旧的 active 规则变 inactive"""
        # 创建并确认第一条规则
        r1 = await _create_platform_rule(client, tenant_id, brand_id, platform="douyin")
        rule1_id = r1.json()["id"]
        await client.put(
            f"/api/v1/rules/platform-rules/{rule1_id}/confirm",
            headers={"X-Tenant-ID": tenant_id},
            json={"parsed_rules": MOCK_PARSED_RULES},
        )

        # 创建并确认第二条规则（同品牌同平台）
        r2 = await _create_platform_rule(client, tenant_id, brand_id, platform="douyin")
        rule2_id = r2.json()["id"]
        await client.put(
            f"/api/v1/rules/platform-rules/{rule2_id}/confirm",
            headers={"X-Tenant-ID": tenant_id},
            json={"parsed_rules": MOCK_PARSED_RULES},
        )

        # 查询所有规则 — rule1 应该变 inactive，rule2 应该 active
        list_resp = await client.get(
            f"/api/v1/rules/platform-rules?brand_id={brand_id}&platform=douyin",
            headers={"X-Tenant-ID": tenant_id},
        )
        rules = list_resp.json()["items"]
        rule1 = next(r for r in rules if r["id"] == rule1_id)
        rule2 = next(r for r in rules if r["id"] == rule2_id)

        assert rule1["status"] == "inactive"
        assert rule2["status"] == "active"

    @pytest.mark.asyncio
    async def test_confirm_nonexistent_rule_returns_404(self, client: AsyncClient, tenant_id: str):
        """确认不存在的规则返回 404"""
        resp = await client.put(
            "/api/v1/rules/platform-rules/pr-nonexist/confirm",
            headers={"X-Tenant-ID": tenant_id},
            json={"parsed_rules": MOCK_PARSED_RULES},
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_confirm_cross_tenant_returns_404(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """不同租户确认规则返回 404（租户隔离）"""
        create_resp = await _create_platform_rule(client, tenant_id, brand_id)
        rule_id = create_resp.json()["id"]

        resp = await client.put(
            f"/api/v1/rules/platform-rules/{rule_id}/confirm",
            headers={"X-Tenant-ID": "other-tenant-xxx"},
            json={"parsed_rules": MOCK_PARSED_RULES},
        )
        assert resp.status_code == 404


class TestBrandPlatformRuleList:
    """品牌方平台规则 — 列表查询"""

    @pytest.mark.asyncio
    async def test_list_empty_returns_200(self, client: AsyncClient, tenant_id: str):
        """没有规则时返回空列表"""
        resp = await client.get(
            "/api/v1/rules/platform-rules",
            headers={"X-Tenant-ID": tenant_id},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["items"] == []
        assert data["total"] == 0

    @pytest.mark.asyncio
    async def test_list_returns_created_rules(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """创建规则后列表包含该规则"""
        await _create_platform_rule(client, tenant_id, brand_id, platform="douyin")
        await _create_platform_rule(client, tenant_id, brand_id, platform="xiaohongshu")

        resp = await client.get(
            f"/api/v1/rules/platform-rules?brand_id={brand_id}",
            headers={"X-Tenant-ID": tenant_id},
        )
        data = resp.json()
        assert data["total"] == 2
        platforms = {r["platform"] for r in data["items"]}
        assert platforms == {"douyin", "xiaohongshu"}

    @pytest.mark.asyncio
    async def test_list_filter_by_platform(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """按平台筛选"""
        await _create_platform_rule(client, tenant_id, brand_id, platform="douyin")
        await _create_platform_rule(client, tenant_id, brand_id, platform="xiaohongshu")

        resp = await client.get(
            f"/api/v1/rules/platform-rules?brand_id={brand_id}&platform=douyin",
            headers={"X-Tenant-ID": tenant_id},
        )
        data = resp.json()
        assert data["total"] == 1
        assert data["items"][0]["platform"] == "douyin"

    @pytest.mark.asyncio
    async def test_list_filter_by_status(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """按状态筛选"""
        r = await _create_platform_rule(client, tenant_id, brand_id)
        rule_id = r.json()["id"]

        # 确认一条
        await client.put(
            f"/api/v1/rules/platform-rules/{rule_id}/confirm",
            headers={"X-Tenant-ID": tenant_id},
            json={"parsed_rules": MOCK_PARSED_RULES},
        )

        # 再创建一条 draft
        await _create_platform_rule(client, tenant_id, brand_id, platform="douyin")

        # 只查 active
        resp = await client.get(
            f"/api/v1/rules/platform-rules?brand_id={brand_id}&status=active",
            headers={"X-Tenant-ID": tenant_id},
        )
        active_rules = resp.json()["items"]
        assert all(r["status"] == "active" for r in active_rules)

        # 只查 draft
        resp2 = await client.get(
            f"/api/v1/rules/platform-rules?brand_id={brand_id}&status=draft",
            headers={"X-Tenant-ID": tenant_id},
        )
        draft_rules = resp2.json()["items"]
        assert all(r["status"] == "draft" for r in draft_rules)

    @pytest.mark.asyncio
    async def test_list_tenant_isolation(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """租户隔离：不同租户看不到彼此的规则"""
        await _create_platform_rule(client, tenant_id, brand_id)

        resp = await client.get(
            "/api/v1/rules/platform-rules",
            headers={"X-Tenant-ID": "another-tenant-yyy"},
        )
        assert resp.json()["total"] == 0


class TestBrandPlatformRuleDelete:
    """品牌方平台规则 — 删除"""

    @pytest.mark.asyncio
    async def test_delete_returns_204(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """删除规则返回 204"""
        r = await _create_platform_rule(client, tenant_id, brand_id)
        rule_id = r.json()["id"]

        resp = await client.delete(
            f"/api/v1/rules/platform-rules/{rule_id}",
            headers={"X-Tenant-ID": tenant_id},
        )
        assert resp.status_code == 204

    @pytest.mark.asyncio
    async def test_delete_actually_removes(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """删除后列表中不再包含该规则"""
        r = await _create_platform_rule(client, tenant_id, brand_id)
        rule_id = r.json()["id"]

        await client.delete(
            f"/api/v1/rules/platform-rules/{rule_id}",
            headers={"X-Tenant-ID": tenant_id},
        )

        resp = await client.get(
            f"/api/v1/rules/platform-rules?brand_id={brand_id}",
            headers={"X-Tenant-ID": tenant_id},
        )
        ids = [r["id"] for r in resp.json()["items"]]
        assert rule_id not in ids

    @pytest.mark.asyncio
    async def test_delete_nonexistent_returns_404(self, client: AsyncClient, tenant_id: str):
        """删除不存在的规则返回 404"""
        resp = await client.delete(
            "/api/v1/rules/platform-rules/pr-nonexist",
            headers={"X-Tenant-ID": tenant_id},
        )
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_cross_tenant_returns_404(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """不同租户删除规则返回 404（租户隔离）"""
        r = await _create_platform_rule(client, tenant_id, brand_id)
        rule_id = r.json()["id"]

        resp = await client.delete(
            f"/api/v1/rules/platform-rules/{rule_id}",
            headers={"X-Tenant-ID": "other-tenant-zzz"},
        )
        assert resp.status_code == 404


class TestBrandPlatformRuleLifecycle:
    """品牌方平台规则 — 完整生命周期"""

    @pytest.mark.asyncio
    async def test_full_lifecycle(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """完整流程: 上传解析 → 确认生效 → 重新上传 → 旧规则停用"""
        headers = {"X-Tenant-ID": tenant_id}

        # 1. 上传并解析
        r1 = await _create_platform_rule(client, tenant_id, brand_id, platform="douyin")
        assert r1.status_code == 201
        rule1_id = r1.json()["id"]
        assert r1.json()["status"] == "draft"

        # 2. 确认生效
        confirm_resp = await client.put(
            f"/api/v1/rules/platform-rules/{rule1_id}/confirm",
            headers=headers,
            json={"parsed_rules": MOCK_PARSED_RULES},
        )
        assert confirm_resp.json()["status"] == "active"

        # 3. 重新上传新规则
        r2 = await _create_platform_rule(client, tenant_id, brand_id, platform="douyin")
        rule2_id = r2.json()["id"]
        assert r2.json()["status"] == "draft"

        # 4. 确认新规则
        await client.put(
            f"/api/v1/rules/platform-rules/{rule2_id}/confirm",
            headers=headers,
            json={"parsed_rules": MOCK_PARSED_RULES},
        )

        # 5. 验证旧规则自动停用
        list_resp = await client.get(
            f"/api/v1/rules/platform-rules?brand_id={brand_id}&platform=douyin",
            headers=headers,
        )
        rules = list_resp.json()["items"]
        rule1 = next(r for r in rules if r["id"] == rule1_id)
        rule2 = next(r for r in rules if r["id"] == rule2_id)
        assert rule1["status"] == "inactive"
        assert rule2["status"] == "active"

        # 6. 删除旧规则
        del_resp = await client.delete(
            f"/api/v1/rules/platform-rules/{rule1_id}",
            headers=headers,
        )
        assert del_resp.status_code == 204

        # 7. 验证只剩新规则
        final_resp = await client.get(
            f"/api/v1/rules/platform-rules?brand_id={brand_id}&platform=douyin",
            headers=headers,
        )
        assert final_resp.json()["total"] == 1
        assert final_resp.json()["items"][0]["id"] == rule2_id
