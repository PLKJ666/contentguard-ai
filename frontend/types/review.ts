/**
 * 审核相关类型定义
 * 与后端 schemas/review.py 对齐
 */

// 审核任务状态（区别于 task.ts 中的 TaskStatus）
export type ReviewTaskStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'approved' | 'rejected'

export type RiskLevel = 'high' | 'medium' | 'low' | '高' | '中' | '低'

export type ViolationType =
  | 'forbidden_word'
  | 'efficacy_claim'
  | 'competitor_logo'
  | 'duration_short'
  | 'mention_missing'
  | 'brand_safety'
  | '竞品露出'
  | '品牌安全'
  | '画面质量'
  | '产品不符'
  | '口误'
  | '字幕错误'
  | string

export type ViolationSource = 'text' | 'speech' | 'subtitle' | 'visual' | '语音' | '字幕'

export type SoftRiskAction = 'confirm' | 'note'

export type Platform = 'douyin' | 'xiaohongshu' | 'bilibili' | 'kuaishou'

// 文本位置（脚本审核）
export interface Position {
  start: number
  end: number
}

// 违规项（与后端 Violation 对齐）
export interface Violation {
  type: ViolationType
  content: string
  severity: RiskLevel
  suggestion: string
  dimension?: string | null
  fixable?: boolean
  // 文本审核字段
  position?: Position | null
  // 视频审核字段
  timestamp?: number | null
  timestamp_end?: number | null
  source?: ViolationSource | null
}

// 软性风控提示（与后端 SoftRiskWarning 对齐）
export interface SoftRiskWarning {
  code: string
  message: string
  action_required: SoftRiskAction
  blocking: boolean
  context?: Record<string, unknown> | null
}

export interface BrandExposureAssessment {
  score?: number | null
  level?: 'high' | 'medium' | 'low' | null
  analysis?: string
  visible_duration_seconds?: number | null
  mention_duration_seconds?: number | null
  related_duration_seconds?: number | null
  evidence?: string[]
}

export type ContentType = 'hard_ad' | 'soft_ad' | 'mixed' | 'viral'
export type ConfidenceLevel = 'high' | 'medium' | 'low'
export type AudienceMatch = 'high' | 'medium' | 'low'
export type ContentVerdict = 'excellent' | 'good' | 'acceptable' | 'needs_improvement' | 'needs_rework'
export type SellingPointPriority = 'core' | 'recommended' | 'reference' | string

// ==================== v2 审核结构 ====================

export interface ContentTypeDetection {
  type: ContentType
  confidence: ConfidenceLevel
  reasoning: string
}

export interface ComplianceReasoning {
  text: string
  analysis: string
  conclusion: string
  severity?: ConfidenceLevel | null
}

export interface ComplianceDimensionCoT {
  reasoning: ComplianceReasoning[]
  summary: string
}

export interface ComplianceOfficerCoT {
  legal: ComplianceDimensionCoT
  platform: ComplianceDimensionCoT
  brand_safety: ComplianceDimensionCoT
}

export interface SellingPointReasoning {
  selling_point: string
  priority: SellingPointPriority
  analysis: string
  matched: boolean
}

export interface BriefMatchCoT {
  reasoning: SellingPointReasoning[]
  summary: string
}

export interface ContentQualityCoT {
  reasoning?: Record<string, unknown> | null
  highlights: string[]
  suggestions: string[]
}

export interface CreativeDirectorCoT {
  brief_match: BriefMatchCoT
  content_quality: ContentQualityCoT
}

export interface ChainOfThought {
  content_type?: ContentTypeDetection | null
  compliance_officer: ComplianceOfficerCoT
  creative_director: CreativeDirectorCoT
}

export interface DimensionConclusion {
  score: number
  passed: boolean
  issue_count: number
}

export interface ContentQualityConclusion {
  score: number
  passed: boolean
  issue_count: number
  viral_potential: ConfidenceLevel
  viral_reason: string
  audience_match: AudienceMatch
  audience_analysis: string
  overall_verdict: ContentVerdict
}

export interface SellingPointMatch {
  content: string
  priority: SellingPointPriority
  matched: boolean
  evidence?: string | null
}

export interface ReviewConclusions {
  legal: DimensionConclusion
  platform: DimensionConclusion
  brand_safety: DimensionConclusion
  brief_match: DimensionConclusion
  content_quality: ContentQualityConclusion
  violations: Violation[]
  selling_point_matches: SellingPointMatch[]
  overall_score: number
  overall_summary: string
}

export interface ReviewDimension {
  score: number
  passed: boolean
  issue_count: number
}

export interface ReviewDimensions {
  legal: ReviewDimension
  platform: ReviewDimension
  brand_safety: ReviewDimension
  brief_match: ReviewDimension
  content_quality?: ReviewDimension | null
}

export interface StructuredReviewResult {
  chain_of_thought?: ChainOfThought | null
  conclusions?: ReviewConclusions | null
  dimensions?: ReviewDimensions | null
  violations: Violation[]
  selling_point_matches: SellingPointMatch[]
  brand_exposure?: BrandExposureAssessment | null
  soft_warnings: SoftRiskWarning[]
}

// 前端内部使用的审核任务状态对象
export interface ReviewTask {
  review_id: string
  title?: string
  status: ReviewTaskStatus
  progress?: number
  current_step?: string
  score?: number
  summary?: string
  violations?: Violation[]
  soft_warnings?: SoftRiskWarning[]
  brand_exposure?: BrandExposureAssessment | null
  created_at: string
  completed_at?: string
}

// ==================== 请求/响应类型 ====================

export interface VideoReviewRequest {
  video_url: string
  platform: Platform
  brand_id: string
  creator_id: string
  competitors?: string[]
  requirements?: Record<string, unknown>
}

export interface VideoReviewResponse {
  review_id: string
  status: ReviewTaskStatus
}

export interface ReviewProgressResponse {
  review_id: string
  status: ReviewTaskStatus
  progress: number
  current_step: string
}

export interface ReviewResultResponse extends StructuredReviewResult {
  review_id: string
  status: ReviewTaskStatus
  score: number
  summary: string
}

// ==================== 脚本预审 ====================

export interface SoftRiskContext {
  violation_rate?: number
  violation_threshold?: number
  asr_confidence?: number
  ocr_confidence?: number
  has_history_violation?: boolean
}

export interface ScriptReviewRequest {
  content: string
  platform: Platform
  brand_id: string
  required_points?: string[]
  soft_risk_context?: SoftRiskContext
}

export interface ScriptReviewResponse extends StructuredReviewResult {
  score: number
  summary: string
  content_type?: ContentTypeDetection | null
  missing_points?: string[]
  ai_available: boolean
}
