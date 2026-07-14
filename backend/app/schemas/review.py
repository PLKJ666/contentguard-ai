"""
审核相关的 Pydantic 模型（API 契约定义）

AI 审核体系 v2：
- 五维度审核（法规合规 / 平台规则 / 品牌安全 / Brief匹配 / 内容质量）
- 双角色 CoT（法务审核员 + 创意总监）
- 结构化推理链（每个发现包含 text/analysis/conclusion）
- 违规分级（fixable: 可修 vs 致命）
- 爆款潜力评估（viral_potential）
- Creative Rubric 检查清单
"""
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field, HttpUrl
from enum import Enum


# ==================== 枚举定义 ====================

class Platform(str, Enum):
    """支持的投放平台"""
    DOUYIN = "douyin"
    XIAOHONGSHU = "xiaohongshu"
    BILIBILI = "bilibili"
    KUAISHOU = "kuaishou"


class TaskStatus(str, Enum):
    """任务状态"""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    APPROVED = "approved"
    REJECTED = "rejected"


class RiskLevel(str, Enum):
    """风险等级"""
    HIGH = "high"      # 法律违规（广告法极限词）
    MEDIUM = "medium"  # 平台规则违规
    LOW = "low"        # 品牌规范违规


class ViolationType(str, Enum):
    """违规类型"""
    FORBIDDEN_WORD = "forbidden_word"    # 违禁词
    EFFICACY_CLAIM = "efficacy_claim"    # 功效宣称
    COMPETITOR_LOGO = "competitor_logo"  # 竞品露出
    DURATION_SHORT = "duration_short"    # 时长不足
    MENTION_MISSING = "mention_missing"  # 品牌提及不足
    BRAND_SAFETY = "brand_safety"        # 品牌安全风险
    FALSE_ADVERTISING = "false_advertising"  # 虚假宣传
    PLATFORM_RULE = "platform_rule"      # 平台规则违规
    TYPO = "typo"                        # 错别字/语病
    VERBAL_ERROR = "verbal_error"        # 口误（语音与脚本不一致）
    SUBTITLE_ERROR = "subtitle_error"    # 字幕错误


class ViolationSource(str, Enum):
    """违规来源"""
    TEXT = "text"        # 文本/脚本
    SPEECH = "speech"    # 语音（ASR）
    SUBTITLE = "subtitle"  # 字幕（OCR）
    VISUAL = "visual"    # 画面（CV）


class ViolationDimension(str, Enum):
    """违规所属维度"""
    LEGAL = "legal"
    PLATFORM = "platform"
    BRAND_SAFETY = "brand_safety"


class SellingPointPriority(str, Enum):
    """卖点优先级"""
    CORE = "core"              # 核心卖点，必须传达
    RECOMMENDED = "recommended"  # 推荐卖点，建议提及
    REFERENCE = "reference"      # 参考信息，不要求出现


class ContentVerdict(str, Enum):
    """内容质量总体评价"""
    EXCELLENT = "excellent"
    GOOD = "good"
    ACCEPTABLE = "acceptable"
    NEEDS_IMPROVEMENT = "needs_improvement"
    NEEDS_REWORK = "needs_rework"


class ViralPotential(str, Enum):
    """爆款潜力"""
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class SoftRiskAction(str, Enum):
    """软性风控动作"""
    CONFIRM = "confirm"  # 需要二次确认
    NOTE = "note"        # 需要填写备注


# ==================== 软性风控 ====================

class SoftRiskWarning(BaseModel):
    """软性风控提示（Warn-only）"""
    code: str = Field(..., description="提示类型代码")
    message: str = Field(..., description="提示内容")
    action_required: SoftRiskAction = Field(..., description="要求动作")
    blocking: bool = Field(default=False, description="是否阻断（默认不阻断）")
    context: Optional[dict] = Field(None, description="附加上下文")


class SoftRiskContext(BaseModel):
    """软性风控输入上下文"""
    violation_rate: Optional[float] = Field(None, ge=0, le=1, description="违规率")
    violation_threshold: Optional[float] = Field(None, ge=0, le=1, description="违规率阈值")
    asr_confidence: Optional[float] = Field(None, ge=0, le=1, description="ASR 置信度")
    ocr_confidence: Optional[float] = Field(None, ge=0, le=1, description="OCR 置信度")
    has_history_violation: Optional[bool] = Field(None, description="是否有历史类似违规")


# ==================== 位置与违规 ====================

class Position(BaseModel):
    """文本位置"""
    start: int = Field(..., description="起始位置")
    end: int = Field(..., description="结束位置")


class Violation(BaseModel):
    """违规项（统一结构）"""
    type: ViolationType = Field(..., description="违规类型")
    content: str = Field(..., description="违规内容")
    severity: RiskLevel = Field(..., description="严重程度")
    suggestion: str = Field(..., description="修改建议")
    dimension: Optional[str] = Field(None, description="所属维度: 法规合规/平台规则/品牌安全/Brief匹配/内容质量")
    fixable: bool = Field(True, description="是否可修复（false=致命必须修改，true=建议优化）")

    # 文本审核字段
    position: Optional[Position] = Field(None, description="文本位置（脚本审核）")

    # 视频审核字段
    timestamp: Optional[float] = Field(None, description="开始时间戳（秒）")
    timestamp_end: Optional[float] = Field(None, description="结束时间戳（秒）")
    source: Optional[ViolationSource] = Field(None, description="违规来源（视频审核）")


# ==================== CoT 推理链结构 ====================

class ComplianceReasoning(BaseModel):
    """法务审核员单条推理"""
    text: str = Field(..., description="原文片段")
    analysis: str = Field(..., description="推理过程")
    conclusion: str = Field(..., description="violation 或 acceptable")
    severity: Optional[str] = Field(None, description="high / medium / low")


class ComplianceDimensionCoT(BaseModel):
    """法务审核员单维度推理"""
    reasoning: list[ComplianceReasoning] = Field(default_factory=list)
    summary: str = Field("", description="维度总结")


class ComplianceOfficerCoT(BaseModel):
    """法务审核员完整推理（3 个维度）"""
    legal: ComplianceDimensionCoT = Field(default_factory=ComplianceDimensionCoT)
    platform: ComplianceDimensionCoT = Field(default_factory=ComplianceDimensionCoT)
    brand_safety: ComplianceDimensionCoT = Field(default_factory=ComplianceDimensionCoT)


class SellingPointReasoning(BaseModel):
    """创意总监卖点推理"""
    selling_point: str = Field(..., description="卖点原文")
    priority: str = Field(..., description="core / recommended")
    analysis: str = Field(..., description="推理过程")
    matched: bool = Field(..., description="是否匹配")


class BriefMatchCoT(BaseModel):
    """创意总监 Brief 匹配推理"""
    reasoning: list[SellingPointReasoning] = Field(default_factory=list)
    summary: str = Field("", description="卖点覆盖总结")


class RubricCheckItem(BaseModel):
    """Rubric 单条检查"""
    criterion: str = Field(..., description="检查条目（do/dont 原文）")
    result: str = Field(..., description="pass 或 fail")
    detail: str = Field("", description="具体说明")


class RubricDimensionCheck(BaseModel):
    """Rubric 单维度检查"""
    checklist: list[RubricCheckItem] = Field(default_factory=list)


class ContentQualityCoT(BaseModel):
    """创意总监内容质量推理"""
    reasoning: Optional[dict] = Field(None, description="tone/audience/content_style/structure 四维度检查")
    highlights: list[str] = Field(default_factory=list, description="内容亮点")
    suggestions: list[str] = Field(default_factory=list, description="改进建议")


class CreativeDirectorCoT(BaseModel):
    """创意总监完整推理（2 个维度）"""
    brief_match: BriefMatchCoT = Field(default_factory=BriefMatchCoT)
    content_quality: ContentQualityCoT = Field(default_factory=ContentQualityCoT)


class ContentTypeDetection(BaseModel):
    """内容类型判定（硬广/软广/混合/品牌曝光）"""
    type: str = Field(..., description="hard_ad / soft_ad / mixed / viral")
    confidence: str = Field(..., description="high / medium / low")
    reasoning: str = Field("", description="AI 判断理由")


class ChainOfThought(BaseModel):
    """完整推理链"""
    content_type: Optional[ContentTypeDetection] = Field(None, description="内容类型判定")
    compliance_officer: ComplianceOfficerCoT = Field(default_factory=ComplianceOfficerCoT)
    creative_director: CreativeDirectorCoT = Field(default_factory=CreativeDirectorCoT)


# ==================== 结论结构 ====================

class DimensionConclusion(BaseModel):
    """合规维度结论（legal / platform / brand_safety / brief_match）"""
    score: int = Field(..., ge=0, le=100)
    passed: bool
    issue_count: int = 0


class ContentQualityConclusion(BaseModel):
    """内容质量维度结论"""
    score: int = Field(..., ge=0, le=100)
    passed: bool = True
    issue_count: int = 0
    viral_potential: str = Field("medium", description="爆款潜力: high/medium/low")
    viral_reason: str = Field("", description="爆款潜力分析")
    audience_match: str = Field("medium", description="受众匹配度: high/medium/low")
    audience_analysis: str = Field("", description="内容受众与产品受众重合度分析")
    overall_verdict: str = Field("good", description="excellent/good/acceptable/needs_improvement/needs_rework")


class SellingPointMatch(BaseModel):
    """卖点匹配结果"""
    content: str
    priority: str = Field(..., description="core / recommended / reference")
    matched: bool
    evidence: Optional[str] = Field(None, description="AI 给出的匹配依据")


class BrandExposureAssessment(BaseModel):
    """品牌曝光评估（脚本/视频通用）"""
    score: Optional[int] = Field(None, ge=0, le=100, description="品牌曝光评分")
    level: str = Field("medium", description="high/medium/low")
    analysis: str = Field("", description="品牌曝光分析")
    visible_duration_seconds: Optional[float] = Field(
        None, ge=0, description="品牌/产品明确出镜时长（秒）"
    )
    mention_duration_seconds: Optional[float] = Field(
        None, ge=0, description="明确提及品牌名称时长（秒）"
    )
    related_duration_seconds: Optional[float] = Field(
        None, ge=0, description="品牌相关表达/介绍时长（秒）"
    )
    evidence: list[str] = Field(default_factory=list, description="证据点")


class ReviewConclusions(BaseModel):
    """审核结论汇总"""
    legal: DimensionConclusion
    platform: DimensionConclusion
    brand_safety: DimensionConclusion
    brief_match: DimensionConclusion
    content_quality: ContentQualityConclusion
    violations: list[Violation] = Field(default_factory=list)
    selling_point_matches: list[SellingPointMatch] = Field(default_factory=list)
    overall_score: int = Field(..., ge=0, le=100, description="加权总分")
    overall_summary: str = Field("", description="一句话总结")


# ==================== AI 审核完整结果 ====================

class AIReviewResult(BaseModel):
    """AI 审核完整结果（存入数据库的 JSON 格式）"""
    chain_of_thought: ChainOfThought = Field(default_factory=ChainOfThought)
    conclusions: ReviewConclusions


# ==================== Creative Rubric ====================

class RubricDimension(BaseModel):
    """Rubric 单维度定义"""
    name: str = Field("", description="维度名称")
    do_items: list[str] = Field(default_factory=list, description="推荐做法")
    dont_items: list[str] = Field(default_factory=list, description="避免做法")


class CreativeRubric(BaseModel):
    """创意审核标准（存入 Brief 表 creative_rubric 字段）"""
    tone: RubricDimension = Field(default_factory=RubricDimension, description="语言调性")
    audience: RubricDimension = Field(default_factory=RubricDimension, description="人群匹配")
    content_style: RubricDimension = Field(default_factory=RubricDimension, description="内容风格")
    structure: RubricDimension = Field(default_factory=RubricDimension, description="内容结构")


# ==================== 品牌学习档案 ====================

class LearnedRule(BaseModel):
    """品牌学习规则"""
    id: str = Field(..., description="规则ID: LR001")
    type: str = Field(..., description="allowed_expression/tone_preference/false_positive/style_preference")
    pattern: str = Field(..., description="什么情况下不应标记（可泛化规则）")
    reason: str = Field(..., description="为什么不应标记")
    source_task: Optional[str] = Field(None, description="来源任务ID")
    created_at: Optional[str] = Field(None, description="创建时间")
    created_by: str = Field("ai_learning", description="ai_learning 或 manual")


# ==================== 向后兼容维度视图 ====================

class ReviewDimension(BaseModel):
    """审核维度评分（简化视图，向后兼容）"""
    score: int = Field(..., ge=0, le=100)
    passed: bool
    issue_count: int = 0


class ReviewDimensions(BaseModel):
    """五维度审核结果"""
    legal: ReviewDimension         # 法规合规
    platform: ReviewDimension      # 平台规则
    brand_safety: ReviewDimension  # 品牌安全
    brief_match: ReviewDimension   # Brief 匹配度
    content_quality: Optional[ReviewDimension] = None  # 内容质量（新增）


# ==================== 脚本预审 ====================

class ScriptReviewRequest(BaseModel):
    """脚本预审请求"""
    content: str = Field(..., min_length=1, description="脚本内容")
    platform: Platform = Field(..., description="投放平台")
    brand_id: Optional[str] = Field(None, description="品牌 ID（可选，后端自动从 tenant_id 获取）")
    project_id: Optional[str] = Field(None, description="项目 ID（精确定位 Brief）")
    selling_points: Optional[list[dict]] = Field(None, description="卖点列表 [{content, priority}]")
    blacklist_words: Optional[list[dict]] = Field(None, description="Brief 黑名单词 [{word, reason}]")
    soft_risk_context: Optional[SoftRiskContext] = Field(None, description="软性风控上下文")
    file_url: Optional[str] = Field(None, description="脚本文件 URL（用于自动解析文本和提取图片）")
    file_name: Optional[str] = Field(None, description="原始文件名（用于判断格式）")
    review_mode: str = Field("script", description="审核模式: script=脚本预审, video=视频口播审核")


class ScriptReviewResponse(BaseModel):
    """
    脚本预审响应 v2

    结构：
    - score: 加权总分
    - summary: 整体摘要
    - chain_of_thought: 双角色推理链（法务审核员 + 创意总监）
    - conclusions: 五维度结论 + 违规列表 + 卖点匹配
    - dimensions: 五维度评分简化视图（向后兼容）
    - violations: 违规项列表（从 conclusions 提取，向后兼容）
    - selling_point_matches: 卖点匹配详情（从 conclusions 提取）
    - missing_points: 遗漏的核心卖点（向后兼容）
    """
    score: int = Field(..., ge=0, le=100, description="加权总分")
    summary: str = Field(..., description="审核摘要")

    # v2 完整结果
    content_type: Optional[ContentTypeDetection] = Field(None, description="内容类型判定（硬广/软广/混合/品牌曝光）")
    chain_of_thought: Optional[ChainOfThought] = Field(None, description="双角色推理链")
    conclusions: Optional[ReviewConclusions] = Field(None, description="五维度结论")

    # 简化视图（向后兼容）
    dimensions: Optional[ReviewDimensions] = Field(None, description="五维度评分")
    violations: list[Violation] = Field(default_factory=list, description="违规项列表")
    selling_point_matches: list[SellingPointMatch] = Field(default_factory=list, description="卖点匹配详情")
    brand_exposure: Optional[BrandExposureAssessment] = Field(None, description="品牌曝光评估")
    missing_points: Optional[list[str]] = Field(None, description="遗漏的核心卖点")
    soft_warnings: list[SoftRiskWarning] = Field(default_factory=list, description="软性风控提示")
    ai_available: bool = Field(True, description="AI 服务是否可用")


# ==================== 视频审核 ====================

class VideoReviewRequest(BaseModel):
    """视频审核请求"""
    video_url: HttpUrl = Field(..., description="视频 URL")
    platform: Platform = Field(..., description="投放平台")
    brand_id: Optional[str] = Field(None, description="品牌 ID（可选，后端自动从 tenant_id 获取）")
    creator_id: str = Field(..., description="达人 ID")
    competitors: Optional[list[str]] = Field(None, description="竞品列表")
    requirements: Optional[dict] = Field(None, description="审核要求（时长、频次等）")


class VideoReviewSubmitResponse(BaseModel):
    """视频审核提交响应（202 Accepted）"""
    review_id: str = Field(..., description="审核任务 ID")
    status: TaskStatus = Field(default=TaskStatus.PENDING, description="任务状态")


class VideoReviewProgressResponse(BaseModel):
    """视频审核进度响应"""
    review_id: str = Field(..., description="审核任务 ID")
    status: TaskStatus = Field(..., description="任务状态")
    progress: int = Field(..., ge=0, le=100, description="进度百分比")
    current_step: str = Field(..., description="当前处理步骤")


class VideoReviewResultResponse(BaseModel):
    """
    视频审核结果响应 v2

    与脚本审核使用同一套五维度结构
    """
    review_id: str = Field(..., description="审核任务 ID")
    status: TaskStatus = Field(default=TaskStatus.COMPLETED, description="任务状态")
    score: int = Field(..., ge=0, le=100, description="加权总分")
    summary: str = Field(..., description="审核摘要")

    # v2 完整结果
    chain_of_thought: Optional[ChainOfThought] = Field(None, description="双角色推理链")
    conclusions: Optional[ReviewConclusions] = Field(None, description="五维度结论")

    # 简化视图
    dimensions: Optional[ReviewDimensions] = Field(None, description="五维度评分")
    violations: list[Violation] = Field(default_factory=list, description="违规项列表")
    selling_point_matches: list[SellingPointMatch] = Field(default_factory=list, description="卖点匹配详情")
    brand_exposure: Optional[BrandExposureAssessment] = Field(None, description="品牌曝光评估")
    soft_warnings: list[SoftRiskWarning] = Field(default_factory=list, description="软性风控提示")
