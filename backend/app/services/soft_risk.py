"""
软性风控服务
临界值、低置信度、历史记录触发警告
"""
from app.schemas.review import (
    SoftRiskContext,
    SoftRiskWarning,
    SoftRiskAction,
)


def evaluate_soft_risk(context: SoftRiskContext) -> list[SoftRiskWarning]:
    """
    评估软性风控

    规则：
    - 违规率接近阈值（90% 以上）→ 二次确认
    - ASR/OCR 置信度 60%-80% → 备注提示
    - 有历史类似违规 → 备注提示

    Args:
        context: 软性风控上下文

    Returns:
        警告列表（可能为空）
    """
    warnings: list[SoftRiskWarning] = []

    # 1. 临界值检测
    if (
        context.violation_rate is not None
        and context.violation_threshold is not None
        and context.violation_threshold > 0
    ):
        ratio = context.violation_rate / context.violation_threshold
        # 使用 round 避免浮点数精度问题 (0.045/0.05 = 0.8999999999999999)
        ratio = round(ratio, 10)
        if ratio >= 0.9 and ratio < 1.0:
            warnings.append(SoftRiskWarning(
                code="NEAR_THRESHOLD",
                message=f"违规率 {context.violation_rate:.1%} 接近阈值 {context.violation_threshold:.1%}",
                action_required=SoftRiskAction.CONFIRM,
                blocking=False,
            ))

    # 2. ASR 低置信度检测
    if context.asr_confidence is not None:
        if 0.6 <= context.asr_confidence < 0.8:
            warnings.append(SoftRiskWarning(
                code="LOW_CONFIDENCE_ASR",
                message=f"语音识别置信度较低 ({context.asr_confidence:.0%})，建议人工复核",
                action_required=SoftRiskAction.NOTE,
                blocking=False,
            ))

    # 3. OCR 低置信度检测
    if context.ocr_confidence is not None:
        if 0.6 <= context.ocr_confidence < 0.8:
            warnings.append(SoftRiskWarning(
                code="LOW_CONFIDENCE_OCR",
                message=f"字幕识别置信度较低 ({context.ocr_confidence:.0%})，建议人工复核",
                action_required=SoftRiskAction.NOTE,
                blocking=False,
            ))

    # 4. 历史违规检测
    if context.has_history_violation:
        warnings.append(SoftRiskWarning(
            code="HISTORY_RISK",
            message="该达人/内容存在历史类似违规记录",
            action_required=SoftRiskAction.NOTE,
            blocking=False,
        ))

    return warnings
