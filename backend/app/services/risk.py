"""
风险分类服务
根据违规类型判断风险等级
"""
from app.schemas.review import ViolationType, RiskLevel


def classify_risk_level(violation_type: ViolationType) -> RiskLevel:
    """
    根据违规类型分类风险等级

    规则：
    - 高风险 (HIGH): 法律违规（广告法极限词、功效宣称）
    - 中风险 (MEDIUM): 平台规则违规（竞品露出、时长不足）
    - 低风险 (LOW): 品牌规范违规（品牌提及不足）

    Args:
        violation_type: 违规类型

    Returns:
        RiskLevel: 风险等级
    """
    high_risk_types = {
        ViolationType.FORBIDDEN_WORD,
        ViolationType.EFFICACY_CLAIM,
    }

    medium_risk_types = {
        ViolationType.COMPETITOR_LOGO,
        ViolationType.DURATION_SHORT,
        ViolationType.BRAND_SAFETY,
    }

    low_risk_types = {
        ViolationType.MENTION_MISSING,
    }

    if violation_type in high_risk_types:
        return RiskLevel.HIGH
    elif violation_type in medium_risk_types:
        return RiskLevel.MEDIUM
    elif violation_type in low_risk_types:
        return RiskLevel.LOW
    else:
        # 默认中风险
        return RiskLevel.MEDIUM
