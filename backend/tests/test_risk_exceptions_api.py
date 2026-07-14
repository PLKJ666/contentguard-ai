"""
特例审批 API 测试 (TDD - 红色阶段)
要求: 48 小时超时自动拒绝 + 必须留痕
功能尚未实现，collect 阶段跳过
"""
import pytest
from datetime import datetime, timedelta, timezone
from httpx import AsyncClient

try:
    from app.schemas.review import (
        RiskExceptionRecord,
        RiskExceptionStatus,
    )
except ImportError:
    pytest.skip("RiskException 功能尚未实现", allow_module_level=True)


class TestRiskExceptionCRUD:
    """特例记录基础流程"""

    @pytest.mark.asyncio
    async def test_create_exception_returns_201(self, client: AsyncClient, tenant_id: str, applicant_id: str, approver_id: str):
        """创建特例返回 201"""
        now = datetime.now(timezone.utc)
        response = await client.post(
            "/api/v1/risk-exceptions",
            headers={"X-Tenant-ID": tenant_id},
            json={
                "applicant_id": applicant_id,
                "target_type": "influencer",
                "target_id": "influencer-001",
                "risk_rule_id": "rule-absolute-word",
                "reason_category": "业务强需",
                "justification": "业务需要短期投放",
                "attachment_url": "https://example.com/attach.png",
                "current_approver_id": approver_id,
                "valid_start_time": now.isoformat(),
                "valid_end_time": (now + timedelta(days=7)).isoformat(),
            }
        )
        assert response.status_code == 201
        parsed = RiskExceptionRecord.model_validate(response.json())
        assert parsed.status == RiskExceptionStatus.PENDING
        assert parsed.current_approver_id == approver_id

    @pytest.mark.asyncio
    async def test_get_exception_returns_200(self, client: AsyncClient, tenant_id: str, applicant_id: str, approver_id: str):
        """查询特例记录返回 200"""
        headers = {"X-Tenant-ID": tenant_id}
        now = datetime.now(timezone.utc)
        create_resp = await client.post(
            "/api/v1/risk-exceptions",
            headers=headers,
            json={
                "applicant_id": applicant_id,
                "target_type": "content",
                "target_id": "content-001",
                "risk_rule_id": "rule-soft-risk",
                "reason_category": "误判",
                "justification": "内容无违规",
                "current_approver_id": approver_id,
                "valid_start_time": now.isoformat(),
                "valid_end_time": (now + timedelta(days=3)).isoformat(),
            }
        )
        record_id = create_resp.json()["record_id"]

        response = await client.get(
            f"/api/v1/risk-exceptions/{record_id}",
            headers=headers,
        )
        assert response.status_code == 200
        parsed = RiskExceptionRecord.model_validate(response.json())
        assert parsed.record_id == record_id

    @pytest.mark.asyncio
    async def test_approve_exception_updates_status(self, client: AsyncClient, tenant_id: str, applicant_id: str, approver_id: str):
        """审批通过后状态更新为 approved"""
        headers = {"X-Tenant-ID": tenant_id}
        now = datetime.now(timezone.utc)
        create_resp = await client.post(
            "/api/v1/risk-exceptions",
            headers=headers,
            json={
                "applicant_id": applicant_id,
                "target_type": "order",
                "target_id": "order-001",
                "risk_rule_id": "rule-competitor",
                "reason_category": "测试豁免",
                "justification": "测试流程",
                "current_approver_id": approver_id,
                "valid_start_time": now.isoformat(),
                "valid_end_time": (now + timedelta(days=1)).isoformat(),
            }
        )
        record_id = create_resp.json()["record_id"]

        response = await client.post(
            f"/api/v1/risk-exceptions/{record_id}/approve",
            headers=headers,
            json={
                "approver_id": approver_id,
                "comment": "同意",
            }
        )
        assert response.status_code == 200
        parsed = RiskExceptionRecord.model_validate(response.json())
        assert parsed.status == RiskExceptionStatus.APPROVED

    @pytest.mark.asyncio
    async def test_reject_exception_requires_reason(self, client: AsyncClient, tenant_id: str, applicant_id: str, approver_id: str):
        """驳回时需要理由"""
        headers = {"X-Tenant-ID": tenant_id}
        now = datetime.now(timezone.utc)
        create_resp = await client.post(
            "/api/v1/risk-exceptions",
            headers=headers,
            json={
                "applicant_id": applicant_id,
                "target_type": "influencer",
                "target_id": "influencer-002",
                "risk_rule_id": "rule-absolute-word",
                "reason_category": "业务强需",
                "justification": "需要豁免",
                "current_approver_id": approver_id,
                "valid_start_time": now.isoformat(),
                "valid_end_time": (now + timedelta(days=2)).isoformat(),
            }
        )
        record_id = create_resp.json()["record_id"]

        response = await client.post(
            f"/api/v1/risk-exceptions/{record_id}/reject",
            headers=headers,
            json={
                "approver_id": approver_id,
                "comment": "",
            }
        )
        assert response.status_code == 422
