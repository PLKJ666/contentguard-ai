"""
视频审核 API 测试 (TDD - 红色阶段)
测试覆盖: 视频上传、异步审核、审核结果、进度查询
"""
import pytest
from httpx import AsyncClient

from app.schemas.review import (
    VideoReviewSubmitResponse,
    VideoReviewProgressResponse,
    VideoReviewResultResponse,
    TaskStatus,
    RiskLevel,
    ViolationType,
)


class TestVideoUpload:
    """视频上传"""

    @pytest.mark.asyncio
    async def test_submit_video_url_returns_202(self, client: AsyncClient, tenant_id: str, video_url: str, brand_id: str, creator_id: str):
        """提交视频 URL 返回 202 Accepted（异步处理）"""
        response = await client.post(
            "/api/v1/videos/review",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "video_url": video_url,
                "platform": "douyin",
                "brand_id": brand_id,
                "creator_id": creator_id,
            }
        )
        assert response.status_code == 202

    @pytest.mark.asyncio
    async def test_submit_video_returns_review_id(self, client: AsyncClient, tenant_id: str, video_url: str, brand_id: str, creator_id: str):
        """提交视频返回审核任务 ID"""
        response = await client.post(
            "/api/v1/videos/review",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "video_url": video_url,
                "platform": "douyin",
                "brand_id": brand_id,
                "creator_id": creator_id,
            }
        )
        data = response.json()
        parsed = VideoReviewSubmitResponse.model_validate(data)
        assert parsed.review_id
        assert parsed.status == TaskStatus.PENDING

    @pytest.mark.asyncio
    async def test_submit_video_validates_url(self, client: AsyncClient, tenant_id: str, brand_id: str, creator_id: str):
        """校验视频 URL 格式"""
        response = await client.post(
            "/api/v1/videos/review",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "video_url": "invalid-url",
                "platform": "douyin",
                "brand_id": brand_id,
                "creator_id": creator_id,
            }
        )
        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_submit_video_validates_platform(self, client: AsyncClient, tenant_id: str, video_url: str, brand_id: str, creator_id: str):
        """校验投放平台"""
        response = await client.post(
            "/api/v1/videos/review",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "video_url": video_url,
                "platform": "invalid_platform",
                "brand_id": brand_id,
                "creator_id": creator_id,
            }
        )
        assert response.status_code == 422


class TestReviewProgress:
    """审核进度查询"""

    @pytest.mark.asyncio
    async def test_get_progress_returns_200(self, client: AsyncClient, tenant_id: str, video_url: str, brand_id: str, creator_id: str):
        """查询进度返回 200"""
        headers = {"X-Tenant-ID": tenant_id}
        # 先提交视频
        submit_resp = await client.post(
            "/api/v1/videos/review",
            headers=headers,
            json={
                "video_url": video_url,
                "platform": "douyin",
                "brand_id": brand_id,
                "creator_id": creator_id,
            }
        )
        review_id = submit_resp.json()["review_id"]

        # 查询进度
        response = await client.get(
            f"/api/v1/videos/review/{review_id}/progress",
            headers=headers,
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_get_progress_returns_status(self, client: AsyncClient, tenant_id: str, video_url: str, brand_id: str, creator_id: str):
        """查询进度返回状态信息"""
        headers = {"X-Tenant-ID": tenant_id}
        submit_resp = await client.post(
            "/api/v1/videos/review",
            headers=headers,
            json={
                "video_url": video_url,
                "platform": "douyin",
                "brand_id": brand_id,
                "creator_id": creator_id,
            }
        )
        review_id = submit_resp.json()["review_id"]

        response = await client.get(
            f"/api/v1/videos/review/{review_id}/progress",
            headers=headers,
        )
        data = response.json()
        parsed = VideoReviewProgressResponse.model_validate(data)

        assert parsed.review_id == review_id
        assert parsed.status in [TaskStatus.PENDING, TaskStatus.PROCESSING]
        assert 0 <= parsed.progress <= 100
        assert isinstance(parsed.current_step, str) and parsed.current_step

    @pytest.mark.asyncio
    async def test_progress_shows_current_step(self, client: AsyncClient, tenant_id: str, video_url: str, brand_id: str, creator_id: str):
        """进度显示当前处理步骤"""
        headers = {"X-Tenant-ID": tenant_id}
        submit_resp = await client.post(
            "/api/v1/videos/review",
            headers=headers,
            json={
                "video_url": video_url,
                "platform": "douyin",
                "brand_id": brand_id,
                "creator_id": creator_id,
            }
        )
        review_id = submit_resp.json()["review_id"]

        response = await client.get(
            f"/api/v1/videos/review/{review_id}/progress",
            headers=headers,
        )
        data = response.json()
        parsed = VideoReviewProgressResponse.model_validate(data)

        assert isinstance(parsed.current_step, str)

    @pytest.mark.asyncio
    async def test_get_progress_nonexistent_returns_404(self, client: AsyncClient, tenant_id: str):
        """查询不存在的审核任务返回 404"""
        response = await client.get(
            "/api/v1/videos/review/nonexistent-id/progress",
            headers={"X-Tenant-ID": tenant_id},
        )
        assert response.status_code == 404


class TestReviewResult:
    """审核结果查询"""

    @pytest.mark.asyncio
    async def test_get_result_processing_returns_202(self, client: AsyncClient, tenant_id: str, video_url: str, brand_id: str, creator_id: str):
        """查询处理中的审核返回 202 并返回进度结构"""
        headers = {"X-Tenant-ID": tenant_id}
        submit_resp = await client.post(
            "/api/v1/videos/review",
            headers=headers,
            json={
                "video_url": video_url,
                "platform": "douyin",
                "brand_id": brand_id,
                "creator_id": creator_id,
            }
        )
        review_id = submit_resp.json()["review_id"]

        response = await client.get(
            f"/api/v1/videos/review/{review_id}/result",
            headers=headers,
        )
        assert response.status_code == 202
        parsed = VideoReviewProgressResponse.model_validate(response.json())
        assert parsed.review_id == review_id
        assert parsed.status in [TaskStatus.PENDING, TaskStatus.PROCESSING]

    @pytest.mark.asyncio
    async def test_get_result_nonexistent_returns_404(self, client: AsyncClient, tenant_id: str):
        """查询不存在的审核任务返回 404"""
        response = await client.get(
            "/api/v1/videos/review/nonexistent-id/result",
            headers={"X-Tenant-ID": tenant_id},
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_get_result_completed_includes_brand_exposure(
        self, client: AsyncClient, test_db_session, tenant_id: str, brand_id: str, creator_id: str
    ):
        """已完成的旧视频审核结果接口返回品牌曝光评估"""
        from app.models.review import (
            ReviewTask,
            Platform as DBPlatform,
            TaskStatus as DBTaskStatus,
        )

        review_id = "test-review-brand-exposure"
        test_db_session.add(
            ReviewTask(
                id=review_id,
                tenant_id=tenant_id,
                video_url="https://example.com/video.mp4",
                platform=DBPlatform.DOUYIN,
                brand_id=brand_id,
                creator_id=creator_id,
                status=DBTaskStatus.COMPLETED,
                progress=100,
                current_step="完成",
                score=88,
                summary="审核完成",
                violations=[],
                soft_warnings=[],
                brand_exposure={
                    "score": 84,
                    "level": "high",
                    "analysis": "品牌在画面中持续露出",
                    "visible_duration_seconds": 3.5,
                    "mention_duration_seconds": 2.0,
                    "related_duration_seconds": 6.0,
                    "evidence": ["片头包装露出", "口播提到品牌名"],
                },
            )
        )
        await test_db_session.commit()

        response = await client.get(
            f"/api/v1/videos/review/{review_id}/result",
            headers={"X-Tenant-ID": tenant_id},
        )

        assert response.status_code == 200
        parsed = VideoReviewResultResponse.model_validate(response.json())
        assert parsed.brand_exposure is not None
        assert parsed.brand_exposure.visible_duration_seconds == pytest.approx(3.5)
        assert parsed.brand_exposure.mention_duration_seconds == pytest.approx(2.0)
        assert parsed.brand_exposure.related_duration_seconds == pytest.approx(6.0)


class TestViolationStructure:
    """违规项结构验证（使用 Mock 数据）"""

    @pytest.fixture
    def mock_completed_review(self):
        """Mock 已完成的审核结果"""
        return {
            "review_id": "test-review-001",
            "status": "completed",
            "score": 65,
            "summary": "发现 2 处违规",
            "violations": [
                {
                    "type": "forbidden_word",
                    "content": "最好",
                    "timestamp": 15,
                    "timestamp_end": 17,
                    "severity": "high",
                    "source": "speech",
                    "suggestion": "建议删除或替换",
                },
                {
                    "type": "competitor_logo",
                    "content": "竞品A",
                    "timestamp": 45,
                    "timestamp_end": 48,
                    "severity": "high",
                    "source": "visual",
                    "suggestion": "请移除画面中的竞品露出",
                },
            ]
        }

    @pytest.mark.asyncio
    async def test_violation_has_timestamp(self, mock_completed_review):
        """违规项包含时间戳"""
        parsed = VideoReviewResultResponse.model_validate(mock_completed_review)
        for violation in parsed.violations:
            assert violation.timestamp is not None
            assert violation.timestamp_end is not None
            assert violation.timestamp_end >= violation.timestamp

    @pytest.mark.asyncio
    async def test_violation_has_risk_level(self, mock_completed_review):
        """违规项包含风险等级"""
        parsed = VideoReviewResultResponse.model_validate(mock_completed_review)
        for violation in parsed.violations:
            assert violation.severity.value in ["high", "medium", "low"]

    @pytest.mark.asyncio
    async def test_violation_has_source(self, mock_completed_review):
        """违规项包含来源（语音/画面/字幕）"""
        parsed = VideoReviewResultResponse.model_validate(mock_completed_review)
        for violation in parsed.violations:
            assert violation.source is not None
            assert violation.source.value in ["speech", "visual", "subtitle", "text"]

    @pytest.mark.asyncio
    async def test_violation_has_suggestion(self, mock_completed_review):
        """违规项包含修改建议"""
        parsed = VideoReviewResultResponse.model_validate(mock_completed_review)
        for violation in parsed.violations:
            assert isinstance(violation.suggestion, str)
            assert violation.suggestion


class TestRiskLevelClassification:
    """风险等级分类逻辑"""

    @pytest.mark.asyncio
    async def test_legal_violation_is_high_risk(self):
        """法律违规（广告法极限词）标记为高风险"""
        from app.services.risk import classify_risk_level
        assert classify_risk_level(ViolationType.FORBIDDEN_WORD) == RiskLevel.HIGH
        assert classify_risk_level(ViolationType.EFFICACY_CLAIM) == RiskLevel.HIGH

    @pytest.mark.asyncio
    async def test_platform_violation_is_medium_risk(self):
        """平台规则违规标记为中风险"""
        from app.services.risk import classify_risk_level
        assert classify_risk_level(ViolationType.COMPETITOR_LOGO) == RiskLevel.MEDIUM

    @pytest.mark.asyncio
    async def test_brand_guideline_violation_is_low_risk(self):
        """品牌规范违规标记为低风险"""
        from app.services.risk import classify_risk_level
        assert classify_risk_level(ViolationType.MENTION_MISSING) == RiskLevel.LOW


class TestViolationDetection:
    """违规检测场景"""

    @pytest.mark.asyncio
    async def test_detect_competitor_logo(self, client: AsyncClient, tenant_id: str, video_url: str, brand_id: str, creator_id: str):
        """检测竞品 Logo - 提交成功并返回 review_id"""
        response = await client.post(
            "/api/v1/videos/review",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "video_url": video_url,
                "platform": "douyin",
                "brand_id": brand_id,
                "creator_id": creator_id,
                "competitors": ["competitor-brand-A", "competitor-brand-B"],
            }
        )
        assert response.status_code == 202
        parsed = VideoReviewSubmitResponse.model_validate(response.json())
        assert parsed.review_id

    @pytest.mark.asyncio
    async def test_detect_forbidden_word_in_speech(self, client: AsyncClient, tenant_id: str, video_url: str, brand_id: str, creator_id: str):
        """检测口播中的违禁词（ASR）"""
        response = await client.post(
            "/api/v1/videos/review",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "video_url": video_url,
                "platform": "douyin",
                "brand_id": brand_id,
                "creator_id": creator_id,
            }
        )
        assert response.status_code == 202
        parsed = VideoReviewSubmitResponse.model_validate(response.json())
        assert parsed.review_id

    @pytest.mark.asyncio
    async def test_detect_forbidden_word_in_subtitle(self, client: AsyncClient, tenant_id: str, video_url: str, brand_id: str, creator_id: str):
        """检测字幕中的违禁词（OCR）"""
        response = await client.post(
            "/api/v1/videos/review",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "video_url": video_url,
                "platform": "douyin",
                "brand_id": brand_id,
                "creator_id": creator_id,
            }
        )
        assert response.status_code == 202
        parsed = VideoReviewSubmitResponse.model_validate(response.json())
        assert parsed.review_id


class TestDurationAndFrequency:
    """时长与频次校验 (F-45)"""

    @pytest.mark.asyncio
    async def test_check_product_display_duration(self, client: AsyncClient, tenant_id: str, video_url: str, brand_id: str, creator_id: str):
        """校验产品同框时长 - 请求参数被接受"""
        response = await client.post(
            "/api/v1/videos/review",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "video_url": video_url,
                "platform": "douyin",
                "brand_id": brand_id,
                "creator_id": creator_id,
                "requirements": {
                    "min_product_display_seconds": 5,
                }
            }
        )
        assert response.status_code == 202
        parsed = VideoReviewSubmitResponse.model_validate(response.json())
        assert parsed.review_id

    @pytest.mark.asyncio
    async def test_check_brand_mention_frequency(self, client: AsyncClient, tenant_id: str, video_url: str, brand_id: str, creator_id: str):
        """校验品牌提及频次 - 请求参数被接受"""
        response = await client.post(
            "/api/v1/videos/review",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "video_url": video_url,
                "platform": "douyin",
                "brand_id": brand_id,
                "creator_id": creator_id,
                "requirements": {
                    "min_brand_mentions": 3,
                }
            }
        )
        assert response.status_code == 202
        parsed = VideoReviewSubmitResponse.model_validate(response.json())
        assert parsed.review_id

    @pytest.mark.asyncio
    async def test_duration_requirement_accepted(self, client: AsyncClient, tenant_id: str, brand_id: str, creator_id: str):
        """时长要求参数被正确接受"""
        # 提交带时长要求的审核请求
        response = await client.post(
            "/api/v1/videos/review",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "video_url": "https://example.com/short_display.mp4",
                "platform": "douyin",
                "brand_id": brand_id,
                "creator_id": creator_id,
                "requirements": {
                    "min_product_display_seconds": 10,
                }
            }
        )

        # 请求应该被接受
        assert response.status_code == 202
        parsed = VideoReviewSubmitResponse.model_validate(response.json())
        assert parsed.review_id
