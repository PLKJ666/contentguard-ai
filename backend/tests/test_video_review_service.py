"""
视频审核服务层测试 (TDD - 红色阶段)
测试覆盖: 违规检测核心逻辑、时长频次校验、风险等级分类
这些测试验证实际检测结果，而非仅 HTTP 状态码
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


class TestCompetitorLogoDetection:
    """竞品 Logo 检测逻辑"""

    @pytest.mark.asyncio
    async def test_detect_competitor_logo_in_frame(self):
        """检测画面中的竞品 Logo"""
        # 导入服务（实现后才能通过）
        from app.services.video_review import VideoReviewService

        service = VideoReviewService()

        # 模拟视频帧数据（包含竞品 Logo）
        mock_frames = [
            {"timestamp": 10.0, "objects": [{"label": "competitor-brand-A", "confidence": 0.95}]},
            {"timestamp": 45.0, "objects": [{"label": "competitor-brand-A", "confidence": 0.88}]},
        ]

        violations = await service.detect_competitor_logos(
            frames=mock_frames,
            competitors=["competitor-brand-A", "competitor-brand-B"]
        )

        # 应该检测到 2 处竞品露出
        assert len(violations) == 2
        assert violations[0]["type"] == "competitor_logo"
        assert violations[0]["timestamp"] == 10.0
        assert violations[0]["risk_level"] == "medium"

    @pytest.mark.asyncio
    async def test_no_detection_when_no_competitor(self):
        """无竞品时不应检测到违规"""
        from app.services.video_review import VideoReviewService

        service = VideoReviewService()

        mock_frames = [
            {"timestamp": 10.0, "objects": [{"label": "product-A", "confidence": 0.95}]},
        ]

        violations = await service.detect_competitor_logos(
            frames=mock_frames,
            competitors=["competitor-brand-X"]  # 不在画面中
        )

        assert len(violations) == 0

    @pytest.mark.asyncio
    async def test_ignore_low_confidence_detection(self):
        """忽略低置信度检测"""
        from app.services.video_review import VideoReviewService

        service = VideoReviewService()

        mock_frames = [
            {"timestamp": 10.0, "objects": [{"label": "competitor-brand-A", "confidence": 0.3}]},  # 低置信度
        ]

        violations = await service.detect_competitor_logos(
            frames=mock_frames,
            competitors=["competitor-brand-A"],
            min_confidence=0.7
        )

        assert len(violations) == 0


class TestForbiddenWordDetectionInSpeech:
    """口播违禁词检测（ASR）"""

    @pytest.mark.asyncio
    async def test_detect_forbidden_word_in_transcript(self):
        """检测语音转文字中的违禁词"""
        from app.services.video_review import VideoReviewService

        service = VideoReviewService()

        # 模拟 ASR 转写结果
        mock_transcript = [
            {"text": "这是一款很好的产品", "start": 0.0, "end": 3.0},
            {"text": "我们的产品是最好的", "start": 5.0, "end": 8.0},  # 包含"最好"
            {"text": "销量第一名", "start": 10.0, "end": 12.0},  # 包含"第一"
        ]

        violations = await service.detect_forbidden_words_in_speech(
            transcript=mock_transcript,
            forbidden_words=["最好", "第一", "最佳"]
        )

        # 应该检测到 2 处违规
        assert len(violations) == 2

        # 验证第一个违规
        assert violations[0]["type"] == "forbidden_word"
        assert violations[0]["content"] == "最好"
        assert violations[0]["timestamp"] == 5.0
        assert violations[0]["source"] == "speech"
        assert "suggestion" in violations[0]

        # 验证第二个违规
        assert violations[1]["content"] == "第一"
        assert violations[1]["timestamp"] == 10.0

    @pytest.mark.asyncio
    async def test_context_aware_detection(self):
        """语境感知检测 - 非广告语境不标记"""
        from app.services.video_review import VideoReviewService

        service = VideoReviewService()

        # 非广告语境
        mock_transcript = [
            {"text": "今天是我最开心的一天", "start": 0.0, "end": 3.0},  # 非广告语境
        ]

        violations = await service.detect_forbidden_words_in_speech(
            transcript=mock_transcript,
            forbidden_words=["最"],
            context_aware=True  # 启用语境感知
        )

        # 非广告语境不应标记
        assert len(violations) == 0

    @pytest.mark.asyncio
    async def test_ad_context_flagged(self):
        """广告语境应标记"""
        from app.services.video_review import VideoReviewService

        service = VideoReviewService()

        # 广告语境
        mock_transcript = [
            {"text": "我们的产品是最好的选择", "start": 0.0, "end": 3.0},
        ]

        violations = await service.detect_forbidden_words_in_speech(
            transcript=mock_transcript,
            forbidden_words=["最好"],
            context_aware=True
        )

        # 广告语境应标记
        assert len(violations) == 1


class TestForbiddenWordDetectionInSubtitle:
    """字幕违禁词检测（OCR）"""

    @pytest.mark.asyncio
    async def test_detect_forbidden_word_in_subtitle(self):
        """检测字幕中的违禁词"""
        from app.services.video_review import VideoReviewService

        service = VideoReviewService()

        # 模拟 OCR 结果
        mock_subtitles = [
            {"text": "限时特惠", "timestamp": 5.0},
            {"text": "效果最佳", "timestamp": 15.0},  # 包含"最佳"
            {"text": "立即购买", "timestamp": 25.0},
        ]

        violations = await service.detect_forbidden_words_in_subtitle(
            subtitles=mock_subtitles,
            forbidden_words=["最佳", "第一", "最好"]
        )

        assert len(violations) == 1
        assert violations[0]["content"] == "最佳"
        assert violations[0]["timestamp"] == 15.0
        assert violations[0]["source"] == "subtitle"


class TestDurationCheck:
    """时长校验"""

    @pytest.mark.asyncio
    async def test_product_display_duration_sufficient(self):
        """产品同框时长充足时通过"""
        from app.services.video_review import VideoReviewService

        service = VideoReviewService()

        # 模拟产品出现时间段
        mock_product_appearances = [
            {"start": 5.0, "end": 15.0},   # 10 秒
            {"start": 30.0, "end": 35.0},  # 5 秒
        ]

        violations = await service.check_product_display_duration(
            appearances=mock_product_appearances,
            min_seconds=10
        )

        # 总时长 15 秒 >= 要求 10 秒，应该通过
        assert len(violations) == 0

    @pytest.mark.asyncio
    async def test_product_display_duration_insufficient(self):
        """产品同框时长不足时报违规"""
        from app.services.video_review import VideoReviewService

        service = VideoReviewService()

        mock_product_appearances = [
            {"start": 5.0, "end": 8.0},  # 3 秒
        ]

        violations = await service.check_product_display_duration(
            appearances=mock_product_appearances,
            min_seconds=10
        )

        # 总时长 3 秒 < 要求 10 秒，应该报违规
        assert len(violations) == 1
        assert violations[0]["type"] == "duration_short"
        assert "3" in violations[0]["content"] or "秒" in violations[0]["content"]
        assert violations[0]["risk_level"] == "medium"


class TestBrandMentionFrequency:
    """品牌提及频次校验"""

    @pytest.mark.asyncio
    async def test_brand_mention_sufficient(self):
        """品牌提及次数充足时通过"""
        from app.services.video_review import VideoReviewService

        service = VideoReviewService()

        mock_transcript = [
            {"text": "今天介绍品牌A的产品", "start": 0.0, "end": 3.0},
            {"text": "品牌A真的很好用", "start": 10.0, "end": 13.0},
            {"text": "推荐大家试试品牌A", "start": 20.0, "end": 23.0},
        ]

        violations = await service.check_brand_mention_frequency(
            transcript=mock_transcript,
            brand_name="品牌A",
            min_mentions=3
        )

        # 提及 3 次 >= 要求 3 次，应该通过
        assert len(violations) == 0

    @pytest.mark.asyncio
    async def test_brand_mention_insufficient(self):
        """品牌提及次数不足时报违规"""
        from app.services.video_review import VideoReviewService

        service = VideoReviewService()

        mock_transcript = [
            {"text": "今天介绍品牌A的产品", "start": 0.0, "end": 3.0},
        ]

        violations = await service.check_brand_mention_frequency(
            transcript=mock_transcript,
            brand_name="品牌A",
            min_mentions=3
        )

        # 提及 1 次 < 要求 3 次，应该报违规
        assert len(violations) == 1
        assert violations[0]["type"] == "mention_missing"


class TestRiskLevelClassification:
    """风险等级分类"""

    @pytest.mark.asyncio
    async def test_legal_violation_is_high_risk(self):
        """法律违规（广告法）标记为高风险"""
        from app.services.video_review import VideoReviewService

        service = VideoReviewService()

        violation = {
            "type": "forbidden_word",
            "content": "最好",
            "category": "absolute_term",  # 广告法极限词
        }

        risk_level = service.classify_risk_level(violation)
        assert risk_level == "high"

    @pytest.mark.asyncio
    async def test_platform_violation_is_medium_risk(self):
        """平台规则违规标记为中风险"""
        from app.services.video_review import VideoReviewService

        service = VideoReviewService()

        violation = {
            "type": "duration_short",
            "category": "platform_rule",
        }

        risk_level = service.classify_risk_level(violation)
        assert risk_level == "medium"

    @pytest.mark.asyncio
    async def test_brand_guideline_is_low_risk(self):
        """品牌规范违规标记为低风险"""
        from app.services.video_review import VideoReviewService

        service = VideoReviewService()

        violation = {
            "type": "mention_missing",
            "category": "brand_guideline",
        }

        risk_level = service.classify_risk_level(violation)
        assert risk_level == "low"


class TestScoreCalculation:
    """合规分数计算"""

    @pytest.mark.asyncio
    async def test_perfect_score_no_violations(self):
        """无违规时满分"""
        from app.services.video_review import VideoReviewService

        service = VideoReviewService()

        score = service.calculate_score(violations=[])
        assert score == 100

    @pytest.mark.asyncio
    async def test_high_risk_violation_major_deduction(self):
        """高风险违规大幅扣分"""
        from app.services.video_review import VideoReviewService

        service = VideoReviewService()

        violations = [
            {"type": "forbidden_word", "risk_level": "high"},
        ]

        score = service.calculate_score(violations=violations)
        # 高风险违规应该扣 20-30 分
        assert score <= 80

    @pytest.mark.asyncio
    async def test_multiple_violations_cumulative_deduction(self):
        """多个违规累计扣分"""
        from app.services.video_review import VideoReviewService

        service = VideoReviewService()

        violations = [
            {"type": "forbidden_word", "risk_level": "high"},
            {"type": "forbidden_word", "risk_level": "high"},
            {"type": "duration_short", "risk_level": "medium"},
        ]

        score = service.calculate_score(violations=violations)
        # 多个违规累计，分数应该更低
        assert score <= 60

    @pytest.mark.asyncio
    async def test_score_never_below_zero(self):
        """分数不会低于 0"""
        from app.services.video_review import VideoReviewService

        service = VideoReviewService()

        # 大量违规
        violations = [{"type": "forbidden_word", "risk_level": "high"} for _ in range(20)]

        score = service.calculate_score(violations=violations)
        assert score >= 0


class TestFullReviewPipeline:
    """完整审核流程测试"""

    @pytest.mark.asyncio
    async def test_review_video_with_violations(self):
        """审核包含违规的视频"""
        from app.services.video_review import VideoReviewService

        service = VideoReviewService()

        # Mock AI 服务
        service.asr_service = AsyncMock()
        service.asr_service.transcribe.return_value = [
            {"text": "这是最好的产品", "start": 5.0, "end": 8.0},
        ]

        service.cv_service = AsyncMock()
        service.cv_service.detect_objects.return_value = [
            {"timestamp": 10.0, "objects": [{"label": "competitor-A", "confidence": 0.9}]},
        ]

        service.ocr_service = AsyncMock()
        service.ocr_service.extract_subtitles.return_value = []

        result = await service.review_video(
            video_url="https://example.com/video.mp4",
            platform="douyin",
            brand_id="brand-001",
            competitors=["competitor-A"],
            forbidden_words=["最好"],
        )

        # 验证结果结构
        assert "score" in result
        assert "summary" in result
        assert "violations" in result

        # 应该检测到违规
        assert len(result["violations"]) >= 2  # 至少：口播违禁词 + 竞品 Logo
        assert result["score"] < 100

        # 验证违规项结构
        for violation in result["violations"]:
            assert "type" in violation
            assert "content" in violation
            assert "timestamp" in violation
            assert "risk_level" in violation
            assert "suggestion" in violation

    @pytest.mark.asyncio
    async def test_review_clean_video(self):
        """审核无违规的视频"""
        from app.services.video_review import VideoReviewService

        service = VideoReviewService()

        # Mock AI 服务 - 无违规内容
        service.asr_service = AsyncMock()
        service.asr_service.transcribe.return_value = [
            {"text": "今天给大家分享护肤技巧", "start": 0.0, "end": 3.0},
        ]

        service.cv_service = AsyncMock()
        service.cv_service.detect_objects.return_value = []

        service.ocr_service = AsyncMock()
        service.ocr_service.extract_subtitles.return_value = []

        result = await service.review_video(
            video_url="https://example.com/clean_video.mp4",
            platform="douyin",
            brand_id="brand-001",
            competitors=[],
            forbidden_words=["最好"],
        )

        # 无违规，满分
        assert len(result["violations"]) == 0
        assert result["score"] == 100
