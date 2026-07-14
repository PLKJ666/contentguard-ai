"""
软性风控逻辑测试 (TDD - 红色阶段)
触发条件: 临界值、低置信度、历史记录
"""
import pytest

from app.schemas.review import SoftRiskContext, SoftRiskAction
from app.services.soft_risk import evaluate_soft_risk


class TestSoftRiskEvaluator:
    """软性风控判定"""

    @pytest.mark.asyncio
    async def test_near_threshold_warns(self):
        """临界值接近阈值触发二次确认提示"""
        context = SoftRiskContext(
            violation_rate=0.045,
            violation_threshold=0.05,
        )
        warnings = evaluate_soft_risk(context)
        matched = [
            w for w in warnings
            if w.code == "NEAR_THRESHOLD" and w.action_required == SoftRiskAction.CONFIRM
        ]
        assert matched
        assert all(w.blocking is False for w in matched)

    @pytest.mark.asyncio
    async def test_low_confidence_warns(self):
        """ASR/OCR 置信度处于 60%-80% 触发备注提示"""
        context = SoftRiskContext(
            asr_confidence=0.7,
            ocr_confidence=0.65,
        )
        warnings = evaluate_soft_risk(context)
        codes = {w.code for w in warnings}
        assert "LOW_CONFIDENCE_ASR" in codes or "LOW_CONFIDENCE_OCR" in codes
        assert all(w.action_required == SoftRiskAction.NOTE for w in warnings if "LOW_CONFIDENCE" in w.code)

    @pytest.mark.asyncio
    async def test_history_violation_warns(self):
        """历史记录存在类似违规触发备注提示"""
        context = SoftRiskContext(
            has_history_violation=True,
        )
        warnings = evaluate_soft_risk(context)
        matched = [w for w in warnings if w.code == "HISTORY_RISK"]
        assert matched
        assert all(w.action_required == SoftRiskAction.NOTE for w in matched)

    @pytest.mark.asyncio
    async def test_safe_context_returns_empty(self):
        """安全场景无软性提示"""
        context = SoftRiskContext(
            violation_rate=0.01,
            violation_threshold=0.05,
            asr_confidence=0.95,
            ocr_confidence=0.92,
            has_history_violation=False,
        )
        warnings = evaluate_soft_risk(context)
        assert warnings == []
