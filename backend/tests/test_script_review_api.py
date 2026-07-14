"""
脚本预审 API 测试 (TDD - 红色阶段)
测试覆盖: 脚本提交、违规检测、语境理解
"""
import json
import pytest
from httpx import AsyncClient
from unittest.mock import AsyncMock, MagicMock, patch

from app.api.scripts import _parse_ai_response
from app.schemas.review import ScriptReviewResponse, ViolationType, SoftRiskAction


def _mock_script_review_ai_client(response_payload: dict) -> MagicMock:
    client = MagicMock()
    client.chat_completion = AsyncMock(return_value=MagicMock(
        content=json.dumps(response_payload),
        model="gpt-4o",
        usage={"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150},
        finish_reason="stop",
    ))
    client.close = AsyncMock()
    return client


class TestSubmitScript:
    """提交脚本预审"""

    @pytest.mark.asyncio
    async def test_submit_script_returns_200(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """提交脚本返回 200"""
        response = await client.post(
            "/api/v1/scripts/review",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "content": "这是一段测试脚本内容",
                "platform": "douyin",
                "brand_id": brand_id,
            }
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_submit_script_returns_review_result(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """提交脚本返回审核结果"""
        response = await client.post(
            "/api/v1/scripts/review",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "content": "这是一段测试脚本内容",
                "platform": "douyin",
                "brand_id": brand_id,
            }
        )
        data = response.json()
        parsed = ScriptReviewResponse.model_validate(data)

        assert isinstance(parsed.summary, str) and parsed.summary
        assert 0 <= parsed.score <= 100

    @pytest.mark.asyncio
    async def test_submit_script_returns_brand_exposure_when_ai_succeeds(
        self, client: AsyncClient, tenant_id: str, brand_id: str
    ):
        """AI 成功返回时，脚本审核响应包含品牌曝光评估"""
        ai_payload = {
            "content_type": {
                "type": "viral",
                "confidence": "high",
                "reasoning": "以品牌露出为主",
            },
            "chain_of_thought": {
                "content_type": {
                    "type": "viral",
                    "confidence": "high",
                    "reasoning": "以品牌露出为主",
                },
                "compliance_officer": {
                    "legal": {"reasoning": [], "summary": "未见法规问题"},
                    "platform": {"reasoning": [], "summary": "符合平台规范"},
                    "brand_safety": {"reasoning": [], "summary": "无品牌安全风险"},
                },
                "creative_director": {
                    "brief_match": {"reasoning": [], "summary": "卖点覆盖完整"},
                    "content_quality": {
                        "reasoning": {},
                        "highlights": ["品牌出现自然"],
                        "suggestions": [],
                    },
                },
            },
            "conclusions": {
                "legal": {"score": 92, "passed": True, "issue_count": 0},
                "platform": {"score": 91, "passed": True, "issue_count": 0},
                "brand_safety": {"score": 95, "passed": True, "issue_count": 0},
                "brief_match": {"score": 88, "passed": True, "issue_count": 0},
                "content_quality": {
                    "score": 90,
                    "passed": True,
                    "issue_count": 0,
                    "viral_potential": "high",
                    "viral_reason": "创意较强",
                    "audience_match": "high",
                    "audience_analysis": "与目标受众高度匹配",
                    "overall_verdict": "good",
                },
                "violations": [],
                "selling_point_matches": [],
                "overall_score": 91,
                "overall_summary": "品牌曝光表现良好",
            },
            "brand_exposure": {
                "score": 86,
                "level": "high",
                "analysis": "品牌在脚本中被明确提及并有持续相关表达",
                "visible_duration_seconds": 0,
                "mention_duration_seconds": 2.5,
                "related_duration_seconds": 6.0,
                "evidence": ["开头明确提到品牌名"],
            },
        }

        with patch(
            "app.api.scripts.AIServiceFactory.get_client",
            new_callable=AsyncMock,
            return_value=_mock_script_review_ai_client(ai_payload),
        ), patch(
            "app.api.scripts.AIServiceFactory.get_config",
            new_callable=AsyncMock,
            return_value=MagicMock(models={"text": "gpt-4o"}),
        ):
            response = await client.post(
                "/api/v1/scripts/review",
                headers={"X-Tenant-ID": tenant_id},
                json={
                    "content": "今天分享一下品牌A新品，品牌A在画面和文案里都有持续出现。",
                    "platform": "douyin",
                    "brand_id": brand_id,
                },
            )

        assert response.status_code == 200
        parsed = ScriptReviewResponse.model_validate(response.json())
        assert parsed.ai_available is True
        assert parsed.brand_exposure is not None
        assert parsed.brand_exposure.score == 86
        assert parsed.brand_exposure.related_duration_seconds == pytest.approx(6.0)
        assert parsed.brand_exposure.evidence == ["开头明确提到品牌名"]

    def test_parse_ai_response_does_not_append_brand_exposure_placeholder_when_present(self):
        """viral 模式下若已返回 brand_exposure，不应再补“品牌曝光度未返回”占位项"""
        ai_payload = {
            "content_type": {
                "type": "viral",
                "confidence": "high",
                "reasoning": "以品牌露出为主",
            },
            "chain_of_thought": {
                "compliance_officer": {},
                "creative_director": {},
            },
            "conclusions": {
                "legal": {"score": 100, "passed": True, "issue_count": 0},
                "platform": {"score": 100, "passed": True, "issue_count": 0},
                "brand_safety": {"score": 100, "passed": True, "issue_count": 0},
                "brief_match": {"score": 75, "passed": True, "issue_count": 0},
                "content_quality": {"score": 90, "passed": True, "issue_count": 0},
                "violations": [],
                "selling_point_matches": [],
                "overall_score": 88,
                "overall_summary": "品牌曝光良好",
            },
            "brand_exposure": {
                "score": 85,
                "level": "high",
                "analysis": "品牌曝光强",
                "related_duration_seconds": 30.0,
                "evidence": ["产品在多个片段持续出现"],
            },
        }
        brief_data = {
            "selling_points": [
                {"content": "核心卖点A", "priority": "core"},
                {"content": "推荐卖点B", "priority": "recommended"},
            ]
        }

        _, _, _, selling_point_matches, _, content_type, brand_exposure = _parse_ai_response(
            ai_payload,
            brief_data=brief_data,
        )

        assert content_type is not None
        assert content_type.type == "viral"
        assert brand_exposure is not None
        assert all(match.content != "品牌曝光度" for match in selling_point_matches)

    @pytest.mark.asyncio
    async def test_submit_empty_script_returns_422(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """提交空脚本返回 422"""
        response = await client.post(
            "/api/v1/scripts/review",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "content": "",
                "platform": "douyin",
                "brand_id": brand_id,
            }
        )
        assert response.status_code == 422


class TestForbiddenWordDetection:
    """违禁词检测"""

    @pytest.mark.asyncio
    async def test_ai_unavailable_returns_flag(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """AI 不可用时返回 ai_available=False（新设计：不做关键词回退）"""
        response = await client.post(
            "/api/v1/scripts/review",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "content": "我们的产品是全网最好的，销量第一",
                "platform": "douyin",
                "brand_id": brand_id,
            }
        )
        data = response.json()
        parsed = ScriptReviewResponse.model_validate(data)

        # 新设计：AI 不可用时返回 ai_available=False，不做关键词检测回退
        assert parsed.ai_available is False
        assert parsed.score == 0

    @pytest.mark.asyncio
    async def test_efficacy_word_not_detected_when_not_configured(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """品牌方未配置功效词时不检测功效词"""
        response = await client.post(
            "/api/v1/scripts/review",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "content": "使用我们的产品可以根治失眠问题",
                "platform": "douyin",
                "brand_id": brand_id,
            }
        )
        data = response.json()
        parsed = ScriptReviewResponse.model_validate(data)

        violation_types = [v.type for v in (parsed.violations or [])]
        assert ViolationType.EFFICACY_CLAIM not in violation_types


class TestContextUnderstanding:
    """语境理解（降低误报）— AI 可用时由 AI 做语境判断"""

    @pytest.mark.asyncio
    async def test_non_ad_context_returns_response(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """非广告语境提交返回有效响应"""
        response = await client.post(
            "/api/v1/scripts/review",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "content": "今天是我最开心的一天，因为见到了老朋友",
                "platform": "douyin",
                "brand_id": brand_id,
            }
        )
        assert response.status_code == 200
        data = response.json()
        parsed = ScriptReviewResponse.model_validate(data)
        assert isinstance(parsed.summary, str)

    @pytest.mark.asyncio
    async def test_story_context_returns_response(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """故事情节语境提交返回有效响应"""
        response = await client.post(
            "/api/v1/scripts/review",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "content": "他是第一个到达终点的人，大家都为他鼓掌",
                "platform": "douyin",
                "brand_id": brand_id,
            }
        )
        assert response.status_code == 200
        data = response.json()
        parsed = ScriptReviewResponse.model_validate(data)
        assert isinstance(parsed.summary, str)

    @pytest.mark.asyncio
    async def test_ad_context_returns_response(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """广告语境提交返回有效响应"""
        response = await client.post(
            "/api/v1/scripts/review",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "content": "我们的产品销量第一，品质最好",
                "platform": "douyin",
                "brand_id": brand_id,
            }
        )
        assert response.status_code == 200
        data = response.json()
        parsed = ScriptReviewResponse.model_validate(data)
        assert isinstance(parsed.summary, str)


class TestSellingPointCheck:
    """卖点遗漏检查"""

    @pytest.mark.asyncio
    async def test_selling_points_accepted_in_request(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """卖点参数被正确接受"""
        response = await client.post(
            "/api/v1/scripts/review",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "content": "这个产品很好用",
                "platform": "douyin",
                "brand_id": brand_id,
                "selling_points": [
                    {"content": "功效说明", "priority": "core"},
                    {"content": "使用方法", "priority": "core"},
                    {"content": "品牌名称", "priority": "recommended"},
                ],
            }
        )
        assert response.status_code == 200
        data = response.json()
        parsed = ScriptReviewResponse.model_validate(data)
        assert isinstance(parsed.summary, str)

    @pytest.mark.asyncio
    async def test_all_points_returns_response(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """所有卖点都覆盖时返回有效响应"""
        response = await client.post(
            "/api/v1/scripts/review",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "content": "品牌A的护肤精华，每天早晚各用一次，可以让肌肤更水润",
                "platform": "douyin",
                "brand_id": brand_id,
                "selling_points": [
                    {"content": "护肤精华", "priority": "core"},
                    {"content": "早晚各用一次", "priority": "core"},
                    {"content": "肌肤更水润", "priority": "recommended"},
                ],
            }
        )
        assert response.status_code == 200
        data = response.json()
        parsed = ScriptReviewResponse.model_validate(data)
        assert isinstance(parsed.summary, str)


class TestScoreCalculation:
    """合规分数计算 — AI 不可用时返回 score=0, ai_available=False"""

    @pytest.mark.asyncio
    async def test_clean_content_returns_response(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """合规内容返回有效响应"""
        response = await client.post(
            "/api/v1/scripts/review",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "content": "今天给大家分享一个护肤小技巧，记得每天早晚洁面哦",
                "platform": "douyin",
                "brand_id": brand_id,
            }
        )
        assert response.status_code == 200
        data = response.json()
        parsed = ScriptReviewResponse.model_validate(data)
        assert isinstance(parsed.score, int)

    @pytest.mark.asyncio
    async def test_violation_content_returns_response(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """违规内容返回有效响应"""
        response = await client.post(
            "/api/v1/scripts/review",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "content": "这是最好的产品，可以根治所有问题，效果第一",
                "platform": "douyin",
                "brand_id": brand_id,
            }
        )
        assert response.status_code == 200
        data = response.json()
        parsed = ScriptReviewResponse.model_validate(data)
        assert isinstance(parsed.score, int)

    @pytest.mark.asyncio
    async def test_score_range_valid(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """分数在有效范围内 0-100"""
        response = await client.post(
            "/api/v1/scripts/review",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "content": "任意内容",
                "platform": "douyin",
                "brand_id": brand_id,
            }
        )
        data = response.json()
        parsed = ScriptReviewResponse.model_validate(data)

        assert 0 <= parsed.score <= 100


class TestSoftRiskWarnings:
    """软性风控提示"""

    @pytest.mark.asyncio
    async def test_near_threshold_returns_response(self, client: AsyncClient, tenant_id: str, brand_id: str):
        """临界值提交返回有效响应"""
        response = await client.post(
            "/api/v1/scripts/review",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "content": "内容正常但指标接近阈值",
                "platform": "douyin",
                "brand_id": brand_id,
                "soft_risk_context": {
                    "violation_rate": 0.045,
                    "violation_threshold": 0.05,
                }
            }
        )
        assert response.status_code == 200
        data = response.json()
        parsed = ScriptReviewResponse.model_validate(data)
        assert isinstance(parsed.summary, str)
