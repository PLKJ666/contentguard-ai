/**
 * Brief 相关类型定义
 * 与后端 BriefResponse 对齐
 */

export interface BriefAttachment {
  id: string
  name: string
  url: string
  size?: string
}

export interface SellingPoint {
  content: string
  priority?: 'core' | 'recommended' | 'reference'
  required?: boolean  // 向后兼容旧格式
}

export interface BlacklistWord {
  word: string
  reason: string
}

// Creative Rubric — AI 自动生成或手动编辑
export interface RubricDimension {
  name: string
  do_items: string[]
  dont_items: string[]
}

export interface CreativeRubric {
  tone?: RubricDimension
  audience?: RubricDimension
  content_style?: RubricDimension
  structure?: RubricDimension
}

export interface BriefResponse {
  id: string
  project_id: string
  project_name?: string | null
  file_url?: string | null
  file_name?: string | null
  product_name?: string | null
  selling_points?: SellingPoint[] | null
  min_selling_points?: number | null
  blacklist_words?: BlacklistWord[] | null
  competitors?: string[] | null
  brand_tone?: string | null
  min_duration?: number | null
  max_duration?: number | null
  other_requirements?: string | null
  attachments?: BriefAttachment[] | null
  agency_attachments?: BriefAttachment[] | null
  creative_rubric?: CreativeRubric | null
  created_at: string
  updated_at: string
}

export interface BriefCreateRequest {
  file_url?: string | null
  file_name?: string | null
  product_name?: string | null
  selling_points?: SellingPoint[]
  min_selling_points?: number | null
  blacklist_words?: BlacklistWord[]
  competitors?: string[]
  brand_tone?: string | null
  min_duration?: number
  max_duration?: number
  other_requirements?: string | null
  attachments?: BriefAttachment[]
  agency_attachments?: BriefAttachment[]
  creative_rubric?: CreativeRubric | null
}
