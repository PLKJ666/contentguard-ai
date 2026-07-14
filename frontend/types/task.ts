import type { BrandExposureAssessment, SoftRiskWarning } from './review'

/**
 * 任务相关类型定义
 * 与后端 TaskStage/TaskStatus/TaskResponse 对齐
 */

// 任务阶段（对应后端 TaskStage）
export type TaskStage =
  | 'script_upload'
  | 'script_ai_review'
  | 'script_agency_review'
  | 'script_brand_review'
  | 'video_upload'
  | 'video_ai_review'
  | 'video_agency_review'
  | 'video_brand_review'
  | 'completed'
  | 'rejected'

// 审核状态（对应后端 TaskStatus）
export type TaskStatus =
  | 'pending'
  | 'processing'
  | 'passed'
  | 'rejected'
  | 'force_passed'

// 关联信息
export interface ProjectInfo {
  id: string
  name: string
  brand_name?: string | null
  client_display_name?: string | null
  brand_display_name?: string | null
  project_remark?: string | null
  platform?: string | null
}

export interface AgencyInfo {
  id: string
  name: string
}

export interface CreatorInfo {
  id?: string | null
  name: string
  avatar?: string | null
  platform?: string | null
  remark?: string | null
}

// ==================== 内容类型判定 ====================

export interface ContentTypeDetection {
  type: 'hard_ad' | 'soft_ad' | 'mixed' | 'viral'
  confidence: 'high' | 'medium' | 'low'
  reasoning: string
}

// ==================== 审核维度评分 ====================

export interface DimensionScore {
  score: number
  passed: boolean
  issue_count: number
}

// 五维度审核结果（v2: 增加 content_quality）
export interface ReviewDimensions {
  legal: DimensionScore
  platform: DimensionScore
  brand_safety: DimensionScore
  brief_match: DimensionScore
  content_quality: DimensionScore
}

// 卖点匹配结果
export interface SellingPointMatchResult {
  content: string
  priority: 'core' | 'recommended' | 'reference'
  matched: boolean
  evidence?: string
}

// ==================== Chain of Thought (CoT) ====================

// 合规官推理
export interface ComplianceReasoning {
  dimension: 'legal' | 'platform' | 'brand_safety'
  observations: string[]
  risk_assessment: string
  score: number
  passed: boolean
  violations_found: number
}

export interface ComplianceOfficerCoT {
  legal: ComplianceReasoning
  platform: ComplianceReasoning
  brand_safety: ComplianceReasoning
}

// 卖点推理
export interface SellingPointReasoning {
  content: string
  priority: 'core' | 'recommended' | 'reference'
  matched: boolean
  evidence: string
}

export interface BriefMatchCoT {
  selling_points: SellingPointReasoning[]
  overall_assessment: string
  score: number
  passed: boolean
}

// 创意总监推理
export interface RubricCheckItem {
  item: string
  met: boolean
  note: string
}

export interface ContentQualityCoT {
  rubric_checks: RubricCheckItem[]
  creative_assessment: string
  viral_assessment: string
  score: number
}

export interface CreativeDirectorCoT {
  brief_match: BriefMatchCoT
  content_quality: ContentQualityCoT
}

export interface ChainOfThought {
  compliance_officer: ComplianceOfficerCoT
  creative_director: CreativeDirectorCoT
}

// ==================== 结论 ====================

export interface DimensionConclusion {
  score: number
  passed: boolean
  issue_count: number
}

export type ContentVerdict = 'excellent' | 'good' | 'acceptable' | 'needs_improvement' | 'needs_rework'
export type ViralPotential = 'high' | 'medium' | 'low'

export type AudienceMatch = 'high' | 'medium' | 'low'

export interface ContentQualityConclusion {
  score: number
  passed: boolean
  issue_count: number
  viral_potential: ViralPotential
  viral_reason: string
  audience_match: AudienceMatch
  audience_analysis: string
  overall_verdict: ContentVerdict
}

export interface ReviewViolation {
  type: string
  content: string
  severity: 'high' | 'medium' | 'low'
  suggestion: string
  dimension: 'legal' | 'platform' | 'brand_safety' | 'brief_match' | 'content_quality'
  fixable: boolean
  source?: string
  timestamp?: number
  script_text?: string    // 口误：脚本原文
  actual_text?: string    // 口误：实际语音
}

export type SoftWarning = SoftRiskWarning

export interface ReviewConclusions {
  legal: DimensionConclusion
  platform: DimensionConclusion
  brand_safety: DimensionConclusion
  brief_match: DimensionConclusion
  content_quality: ContentQualityConclusion
  violations: ReviewViolation[]
  selling_point_matches: SellingPointMatchResult[]
  overall_score: number
  overall_summary: string
}

// ==================== AI 审核结果 ====================

export interface AIReviewResult {
  score: number
  summary?: string
  ai_auto_rejected?: boolean
  ai_reject_reason?: string
  ai_available?: boolean

  // v2: 内容类型判定 + Chain of Thought + 结论
  content_type?: ContentTypeDetection
  chain_of_thought?: ChainOfThought
  conclusions?: ReviewConclusions

  // 简化视图（从 conclusions 提取或旧格式兼容）
  dimensions?: ReviewDimensions
  selling_point_matches?: SellingPointMatchResult[]
  brand_exposure?: BrandExposureAssessment | null

  // 视频 ASR 相关
  speech_transcript?: string | null   // 语音转录文本
  asr_available?: boolean             // ASR 是否成功
  text_source?: string               // 文本来源: asr/ocr/approved_script

  // 视频内容分析（视频审核特有）
  selling_point_coverage?: Array<{
    content?: string
    conveyed?: boolean
    evidence?: string
    timestamp?: string | number | null
  }>
  subtitle_issues?: Array<{
    type?: string
    content?: string
    severity?: string
    suggestion?: string
    timestamp?: string | number | null
  }>
  new_content_analysis?: Array<{
    content: string
    compliant: boolean
    enhances: boolean
    note: string
  }>
  delivery_quality?: {
    score?: number
    overall?: string
    engagement?: string
    purchase_intent?: string
    platform_fit?: string
  }
  audio_track_analysis?: {
    transcript?: string
    tone_summary?: string
    creator_guidance?: {
      summary?: string
      must_fix?: string[]
      voiceover_plan?: Array<{
        segment?: string
        goal?: string
        emotion?: string
        pacing?: string
        instruction?: string
        emphasis_words?: string[]
      }>
      bgm_plan?: Array<{
        segment?: string
        style?: string
        action?: string
        cue_point?: string
        instruction?: string
      }>
    }
    delivery_signals?: {
      tone?: string
      emotion?: string
      energy_level?: string
      pacing?: string
      persuasiveness?: string
      brand_fit?: string
      summary?: string
    }
    bgm?: {
      present?: boolean
      style?: string
      intensity?: string
      fit?: string
      lyrics_risk?: boolean
      summary?: string
    }
    environment?: {
      has_noise?: boolean
      noise_types?: string[]
      clarity_score?: number | null
      summary?: string
    }
    violations?: Array<{
      type: string
      content: string
      severity: string
      suggestion: string
    }>
  }
  review_candidates?: ReviewCandidate[]
  creator_guidance_selected_candidate_ids?: string[]
  creator_card_content?: CreatorCardContent
  creator_visual_brief?: CreatorVisualBrief
  creator_image_generation?: CreatorImageGeneration

  // 脚本匹配度分析（视频审核特有）
  script_match?: {
    overall_score: number
    overall_assessment: string
    suggestion_for_reviewer?: string
    segments: Array<{
      script_segment: string
      segment_label: string
      status: 'matched' | 'adapted' | 'missing' | 'reordered'
      video_evidence?: string
      note?: string
    }>
    structure_preserved: boolean
    missing_segments: string[]
    key_deviations: string[]
  } | null

  // 旧格式兼容字段
  violations?: Array<{
    type: string
    content: string
    severity: string
    suggestion: string
    dimension?: string
    fixable?: boolean
    timestamp?: number
    source?: string
    script_text?: string    // 口误：脚本原文
    actual_text?: string    // 口误：实际语音
  }>
  soft_warnings?: SoftRiskWarning[]
}

export interface ReviewCandidate {
  id: string
  category: 'voice' | 'bgm' | 'content'
  start_sec: number
  end_sec: number
  time_range: string
  priority: 'high' | 'medium' | 'low'
  problem: string
  direct_fix: string
  where_to_change: string
  suggested_copy?: string
  bgm_action?: string
  evidence?: string
}

export interface CreatorCardItem {
  time_range: string
  title: string
  problem: string
  fix: string
  example?: string
}

export interface CreatorCardContent {
  title: string
  summary: string
  priorities: string[]
  sections: {
    voice: CreatorCardItem[]
    bgm: CreatorCardItem[]
    content: CreatorCardItem[]
  }
}

export interface VideoReviewContext {
  current_video_summary: string
  current_script_summary?: string
  current_strengths?: string[]
  current_main_issues: string[]
  timeline_observations: Array<{
    time_range: string
    current_state: string
    main_visual?: string
    main_message?: string
  }>
  multimodal_signals?: {
    voice?: {
      tone?: string
      emotion?: string
      energy_level?: string
      pacing?: string
      summary?: string
    }
    bgm?: {
      style?: string
      intensity?: string
      fit?: string
      summary?: string
    }
    environment?: {
      has_noise?: boolean
      noise_types?: string[]
      clarity_score?: number | null
      summary?: string
    }
  }
}

export interface ReviewDiagnosis {
  diagnosis_blocks: Array<{
    block_id: string
    time_range: string
    current_state: string
    expected_state?: string
    main_gap: string
    priority: 'high' | 'medium' | 'low'
    source_candidate_ids: string[]
  }>
}

export interface CreatorVisualBrief {
  meta: {
    task_id: string
    task_name: string
    project_name: string
    product_name?: string
    page_title: string
    objective: string
    audience: string
  }
  current_video_context: VideoReviewContext
  reference_context: {
    brief_core_message?: string
    key_selling_points: string[]
    brand_rules?: string[]
    must_keep_terms: string[]
    forbidden_visual_styles: string[]
    brand_colors?: string[]
  }
  diagnosis_context: ReviewDiagnosis
  timeline_blocks: Array<{
    block_id: string
    time_range: string
    segment_title: string
    current_problem: string
    content_task: string
    voice_direction?: string
    bgm_direction?: string
    emotion?: string[]
    must_keep_selling_points: string[]
    visual_anchor: string
    source_candidate_ids: string[]
  }>
  transition_blocks: Array<{
    time_range: string
    instruction: string
  }>
  product_assets: {
    packshot_urls: string[]
    reference_image_urls: string[]
    optional_icons?: string[]
  }
  page_plan: {
    page_count: number
    max_main_blocks_per_page: number
    max_info_blocks_per_segment: number
    ratio: '4:5' | '16:9'
    layout_variant?: 'portrait' | 'landscape'
  }
  visual_preferences?: {
    layout_variant?: 'portrait' | 'landscape'
    style_variant?: string
    feedback_instruction?: string
  }
  hard_constraints: string[]
}

export interface CreatorImageGeneration {
  generation_id: string
  brief_version: string
  prompt_version: string
  iteration_no: number
  input_brief: CreatorVisualBrief
  generated_pages: Array<{
    page_index: number
    image_url: string
    image_width?: number
    image_height?: number
    page_summary?: string
  }>
  layout_variant?: 'portrait' | 'landscape'
  style_variant?: string
  status: 'draft' | 'reviewing' | 'regenerating' | 'approved' | 'exported' | 'failed'
  feedback_history: Array<{
    iteration_no: number
    target_page?: number
    target_block_ids?: string[]
    feedback_type: 'layout' | 'style' | 'tone' | 'content_density' | 'other'
    instruction: string
    created_at: string
  }>
  fallback_reason?: string
}

// 任务响应（对应后端 TaskResponse）
export interface TaskResponse {
  id: string
  name: string
  sequence: number
  stage: TaskStage

  // 关联
  project: ProjectInfo
  agency: AgencyInfo
  creator: CreatorInfo

  // 脚本信息
  script_file_url?: string | null
  script_file_name?: string | null
  script_text_content?: string | null
  script_uploaded_at?: string | null
  script_ai_score?: number | null
  script_ai_result?: AIReviewResult | null
  script_agency_corrected?: string | null  // 代理商修正后的脚本
  script_agency_corrected_file_url?: string | null
  script_agency_corrected_file_name?: string | null
  script_agency_corrected_file_type?: string | null
  script_agency_status?: TaskStatus | null
  script_agency_comment?: string | null
  script_agency_reviewed_at?: string | null
  script_brand_status?: TaskStatus | null
  script_brand_comment?: string | null
  script_brand_reviewed_at?: string | null

  // 视频信息
  video_file_url?: string | null
  video_file_name?: string | null
  video_duration?: number | null
  video_thumbnail_url?: string | null
  video_uploaded_at?: string | null
  video_ai_score?: number | null
  video_ai_result?: AIReviewResult | null
  video_agency_status?: TaskStatus | null
  video_agency_comment?: string | null
  video_agency_reviewed_at?: string | null
  video_brand_status?: TaskStatus | null
  video_brand_comment?: string | null
  video_brand_reviewed_at?: string | null

  // 申诉
  appeal_count: number
  is_appeal: boolean
  appeal_reason?: string | null
  appeal_request_status?: 'pending' | 'approved' | 'rejected' | null

  // 时间
  created_at: string
  updated_at: string
}

export interface TaskListResponse {
  items: TaskResponse[]
  total: number
  page: number
  page_size: number
}

export interface TaskSummary {
  id: string
  name: string
  stage: TaskStage
  creator_name: string
  creator_avatar?: string | null
  project_name: string
  is_appeal: boolean
  appeal_reason?: string | null
  created_at: string
  updated_at: string
}

export interface ReviewTaskListResponse {
  items: TaskSummary[]
  total: number
  page: number
  page_size: number
}

// 请求类型
export interface TaskCreateRequest {
  project_id: string
  creator_id?: string
  creator_display_name?: string
  creator_platform?: string
  creator_remark?: string
  name?: string
}

export interface TaskScriptUploadRequest {
  file_url?: string
  file_name?: string
  text_content?: string
}

export interface TaskVideoUploadRequest {
  file_url: string
  file_name: string
  duration?: number
  thumbnail_url?: string
}

export interface CreatorGuidanceBoardRequest {
  candidates: ReviewCandidate[]
  layout_variant?: 'portrait' | 'landscape'
  style_variant?: string
  feedback_instruction?: string
  feedback_type?: 'layout' | 'style' | 'tone' | 'content_density' | 'other'
  target_page?: number
}

export interface TaskReviewRequest {
  action: 'pass' | 'reject' | 'force_pass'
  comment?: string
  corrected_script?: string
  corrected_file_url?: string
  corrected_file_name?: string
  corrected_file_type?: string
}

export interface AppealRequest {
  reason: string
}
