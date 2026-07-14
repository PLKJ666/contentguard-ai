"""
特例审批服务
超时策略、审批流程
"""
from datetime import datetime, timedelta, timezone

from app.schemas.review import (
    RiskExceptionRecord,
    RiskExceptionStatus,
)


# 超时时间（小时）
TIMEOUT_HOURS = 48


def apply_timeout_policy(
    record: RiskExceptionRecord,
    current_time: datetime,
) -> RiskExceptionRecord:
    """
    应用超时策略

    规则：
    - 超过 48 小时未审批 → 自动拒绝
    - 记录自动拒绝原因

    Args:
        record: 特例记录
        current_time: 当前时间

    Returns:
        更新后的记录
    """
    # 只处理待审批状态
    if record.status != RiskExceptionStatus.PENDING:
        return record

    # 计算时间差
    apply_time = record.apply_time
    if isinstance(apply_time, str):
        apply_time = datetime.fromisoformat(apply_time.replace("Z", "+00:00"))

    # 确保时区一致
    if apply_time.tzinfo is None:
        apply_time = apply_time.replace(tzinfo=timezone.utc)
    if current_time.tzinfo is None:
        current_time = current_time.replace(tzinfo=timezone.utc)

    elapsed = current_time - apply_time

    if elapsed > timedelta(hours=TIMEOUT_HOURS):
        # 超时自动拒绝
        return RiskExceptionRecord(
            record_id=record.record_id,
            applicant_id=record.applicant_id,
            apply_time=record.apply_time,
            target_type=record.target_type,
            target_id=record.target_id,
            risk_rule_id=record.risk_rule_id,
            status=RiskExceptionStatus.REJECTED,
            valid_start_time=record.valid_start_time,
            valid_end_time=record.valid_end_time,
            reason_category=record.reason_category,
            justification=record.justification,
            attachment_url=record.attachment_url,
            current_approver_id=record.current_approver_id,
            approval_chain_log=record.approval_chain_log,
            auto_rejected=True,
            rejection_reason="timeout",
            last_status_at=current_time,
        )

    return record
