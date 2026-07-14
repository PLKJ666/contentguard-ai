"""
特例审批超时策略测试 (TDD - 红色阶段)
默认行为: 48 小时超时自动拒绝 + 必须留痕
功能尚未实现，collect 阶段跳过
"""
import pytest
from datetime import datetime, timedelta, timezone

try:
    from app.schemas.review import RiskExceptionRecord, RiskExceptionStatus, RiskTargetType
    from app.services.risk_exception import apply_timeout_policy
except ImportError:
    pytest.skip("RiskException 功能尚未实现", allow_module_level=True)


class TestRiskExceptionTimeout:
    """超时自动拒绝"""

    @pytest.mark.asyncio
    async def test_auto_reject_after_48_hours(self):
        """超过 48 小时自动拒绝并记录原因"""
        now = datetime.now(timezone.utc)
        record = RiskExceptionRecord(
            record_id="rec-001",
            applicant_id="applicant-001",
            apply_time=now - timedelta(hours=49),
            target_type=RiskTargetType.INFLUENCER,
            target_id="influencer-001",
            risk_rule_id="rule-absolute-word",
            status=RiskExceptionStatus.PENDING,
            valid_start_time=now - timedelta(days=1),
            valid_end_time=now + timedelta(days=3),
            reason_category="业务强需",
            justification="临时投放",
            attachment_url=None,
            current_approver_id="approver-001",
            approval_chain_log=[],
            auto_rejected=False,
            rejection_reason=None,
            last_status_at=None,
        )

        updated = apply_timeout_policy(record, now)
        assert updated.status == RiskExceptionStatus.REJECTED
        assert updated.auto_rejected is True
        assert updated.rejection_reason == "timeout"
        assert updated.last_status_at is not None

    @pytest.mark.asyncio
    async def test_no_auto_reject_within_48_hours(self):
        """未超时不应自动拒绝"""
        now = datetime.now(timezone.utc)
        record = RiskExceptionRecord(
            record_id="rec-002",
            applicant_id="applicant-002",
            apply_time=now - timedelta(hours=24),
            target_type=RiskTargetType.CONTENT,
            target_id="content-001",
            risk_rule_id="rule-soft-risk",
            status=RiskExceptionStatus.PENDING,
            valid_start_time=now - timedelta(days=1),
            valid_end_time=now + timedelta(days=1),
            reason_category="误判",
            justification="内容无违规",
            attachment_url=None,
            current_approver_id="approver-002",
            approval_chain_log=[],
            auto_rejected=False,
            rejection_reason=None,
            last_status_at=None,
        )

        updated = apply_timeout_policy(record, now)
        assert updated.status == RiskExceptionStatus.PENDING
        assert updated.auto_rejected is False
