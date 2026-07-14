export type XHSPackStatus = 'draft' | 'active' | 'archived'
export type XHSProjectStatus = 'active' | 'archived'
export type XHSDirectionStatus = 'draft' | 'active' | 'archived'
export type XHSBatchRunMode = 'trial' | 'full'
export type XHSBatchStatus =
  | 'pending'
  | 'splitting'
  | 'queued'
  | 'running'
  | 'awaiting_decision'
  | 'needs_decision'
  | 'partially_done'
  | 'completed'
  | 'done'
  | 'failed'
  | 'blocked'
  | 'cancelled'
  | 'exporting'
  | 'exported'

export type XHSInputType = 'text' | 'file' | 'feishu_link'
export type XHSExportType = 'all_md' | 'feishu'
export type XHSExportStatus = 'pending' | 'running' | 'completed' | 'failed'
export type XHSSourceType = 'upload' | 'feishu_link'

export interface XHSConfigConflict {
  field: string
  message: string
  severity: string
}

export interface XHSConfigValidationResponse {
  valid: boolean
  conflicts: XHSConfigConflict[]
}

export interface XHSBrandPackPayload {
  brand_facts: Array<Record<string, unknown>>
  products: Array<Record<string, unknown>>
  fact_graph: {
    nodes: Array<Record<string, unknown>>
    relations: Array<Record<string, unknown>>
  }
  optional_blocks: Array<Record<string, unknown>>
}

export interface XHSRulePackPayload {
  banned_terms: string[]
  risk_patterns: Array<Record<string, unknown>>
  replace_map: Record<string, string>
  format_rules: Record<string, unknown>
  structure_rules: Record<string, unknown>
}

export interface XHSBriefPackPayload {
  brand_facts: Record<string, unknown>
  sku_facts: Array<Record<string, unknown>>
  selling_point_priority: Array<Record<string, unknown>>
  recommended_phrasings: string[]
  forbidden_phrasings: string[]
  uncertain_fields: Array<Record<string, unknown>>
}

export interface XHSRiskPackPayload {
  risk_clues: Array<Record<string, unknown>>
  replace_hints: Array<Record<string, unknown>>
  confidence_level?: string | null
}

export interface XHSBrandPack {
  id: string
  tenant_id: string
  category_id: string
  version: string
  status: XHSPackStatus
  created_by: string
  created_at: string
  updated_at: string
  brand_name: string
  is_default: boolean
  pack: XHSBrandPackPayload
}

export interface XHSRulePack {
  id: string
  tenant_id: string
  category_id: string
  version: string
  status: XHSPackStatus
  created_by: string
  created_at: string
  updated_at: string
  name: string
  pack: XHSRulePackPayload
}

export interface XHSBriefPack {
  id: string
  tenant_id: string
  category_id: string
  version: string
  status: XHSPackStatus
  created_by: string
  created_at: string
  updated_at: string
  brand_name: string
  source_type: XHSSourceType
  source_ref?: string | null
  pack: XHSBriefPackPayload
}

export interface XHSRiskPack {
  id: string
  tenant_id: string
  category_id: string
  version: string
  status: XHSPackStatus
  created_by: string
  created_at: string
  updated_at: string
  name: string
  pack: XHSRiskPackPayload
}

export interface XHSBriefPackParseResponse {
  source_type: XHSSourceType
  source_ref?: string | null
  extracted_text: string
  pack: XHSBriefPackPayload
  validation: XHSConfigValidationResponse
}

export interface XHSProjectBriefVariantSuggestion {
  name: string
  selling_points: string[]
  appearance_notes?: string | null
  notes?: string | null
}

export interface XHSProjectBriefDirectionSuggestion {
  name: string
  main_variant_name?: string | null
  secondary_variant_names: string[]
  content_style?: string | null
  direction_brief?: string | null
  extra_requirements: string[]
}

export interface XHSProjectBriefParseResult {
  product_name: string
  project_brief: string
  shared_requirements: string
  key_points: string[]
  variant_suggestions: XHSProjectBriefVariantSuggestion[]
  direction_suggestions: XHSProjectBriefDirectionSuggestion[]
}

export interface XHSProjectBriefParseResponse {
  source_ref: string
  file_name: string
  extracted_text: string
  brief_parse_result: XHSProjectBriefParseResult
  raw_result: Record<string, unknown>
}

export interface XHSVariantBriefParseResult {
  name: string
  selling_points: string[]
  appearance_notes?: string | null
  notes?: string | null
}

export interface XHSVariantBriefParseResponse {
  source_ref?: string | null
  file_name?: string | null
  extracted_text: string
  brief_parse_result: XHSVariantBriefParseResult
  raw_result: Record<string, unknown>
}

export interface XHSProject {
  id: string
  tenant_id: string
  name: string
  category_id: string
  client_name?: string | null
  product_name?: string | null
  brief_file_ref?: string | null
  brief_file_name?: string | null
  brief_parse_result?: XHSProjectBriefParseResult | null
  project_brief?: string | null
  shared_requirements?: string | null
  remark?: string | null
  status: XHSProjectStatus
  created_by: string
  variant_count: number
  direction_count: number
  batch_count: number
  created_at: string
  updated_at: string
}

export interface XHSProjectVariant {
  id: string
  tenant_id: string
  project_id: string
  name: string
  selling_points?: string | null
  appearance_notes?: string | null
  notes?: string | null
  is_primary: boolean
  sort_order: number
  created_by: string
  created_at: string
  updated_at: string
}

export interface XHSDirection {
  id: string
  tenant_id: string
  project_id: string
  project_name?: string | null
  name: string
  status: XHSDirectionStatus
  main_variant_id?: string | null
  main_variant_name?: string | null
  secondary_variant_ids: string[]
  content_style?: string | null
  direction_brief?: string | null
  extra_requirements?: string | null
  notes?: string | null
  sort_order: number
  created_by: string
  batch_count: number
  latest_batch_id?: string | null
  latest_batch_status?: XHSBatchStatus | null
  created_at: string
  updated_at: string
}

export interface XHSBatchEstimateResponse {
  estimated_items: number
  total_split_items: number
  estimated_tokens: number
  estimated_cost: string
  split_strategy: string
}

export interface XHSBatchInputStats {
  raw_chars: number
  split_count: number
  planned_items?: number | null
  split_strategy?: string | null
  split_model?: string | null
  split_tokens?: number | null
  rule_split_count?: number | null
  ai_split_count?: number | null
  source_ref?: string | null
  source_file_name?: string | null
  parsed_from_file?: boolean | null
  parsed_from_feishu?: boolean | null
  parse_skipped_reason?: string | null
}

export interface XHSBatchExportSummary {
  all_md_status?: XHSExportStatus | null
  all_md_url?: string | null
  feishu_status?: XHSExportStatus | null
  feishu_doc_title?: string | null
  feishu_error?: string | null
}

export interface XHSBatchJob {
  id: string
  status: XHSBatchStatus
  category_id: string
  direction_id?: string | null
  direction_name?: string | null
  project_id?: string | null
  project_name?: string | null
  rule_pack_version?: string | null
  risk_pack_version?: string | null
  brand_pack_version?: string | null
  brief_pack_id?: string | null
  run_mode: XHSBatchRunMode
  trial_sample_count?: number | null
  input_type: XHSInputType
  estimated_tokens?: number | null
  estimated_cost?: string | null
  actual_tokens?: number | null
  actual_cost?: string | null
  system_blocked: boolean
  system_block_reason?: string | null
  total_items: number
  done_items: number
  running_items: number
  failed_items: number
  decision_items: number
  safe_rewrite_items: number
  input_stats: XHSBatchInputStats
  export: XHSBatchExportSummary
  export_all_md_status?: XHSExportStatus | null
  export_all_md_url?: string | null
  export_feishu_status?: XHSExportStatus | null
  export_feishu_doc_title?: string | null
  export_feishu_error?: string | null
  created_at: string
  updated_at: string
}

export interface XHSBatchDecisionOption {
  id: string
  title: string
  summary: string
  tradeoffs: string[]
  recommended: boolean
}

export interface XHSBatchItem {
  id: string
  batch_id: string
  item_id: string
  index?: number | null
  status: XHSBatchStatus
  round: number
  title?: string | null
  source_text?: string | null
  source_title_guess?: string | null
  final_title?: string | null
  final_body?: string | null
  final_hashtags: string[]
  copy_ready_text?: string | null
  quality_score?: string | number | null
  verifier_pass?: boolean | null
  verifier_confidence?: string | number | null
  verifier?: Record<string, unknown> | null
  rewrite_fail_reasons?: string[]
  decision_required: boolean
  decision_summary?: string | null
  decision_options: XHSBatchDecisionOption[]
  recommended_decision_option_id?: string | null
  selected_decision_option_id?: string | null
  safe_rewrite_used: boolean
  safe_rewrite_reason?: string | null
  duration_ms?: number | null
}

export interface XHSBatchItemListResponse {
  items: XHSBatchItem[]
  page: number
  page_size: number
  total: number
}

export interface XHSExportLog {
  id: string
  batch_id: string
  type: XHSExportType
  status: XHSExportStatus
  error?: string | null
  created_at: string
}

export interface XHSFeishuExportDoc {
  doc_token: string
  doc_title: string
  doc_url: string
  item_range: string
}

export interface XHSFeishuExportResponse {
  status: XHSExportStatus
  message: string
}

export interface XHSFeishuExportStatusResponse {
  status: XHSExportStatus
  docs: XHSFeishuExportDoc[]
  error?: string | null
}

export interface XHSBatchCreateRequest {
  category_id: string
  direction_id?: string
  rule_pack_version?: string
  risk_pack_version?: string
  brand_pack_version?: string
  brief_pack_id?: string
  style_template_id?: string
  run_mode: XHSBatchRunMode
  trial_sample_count?: number
  input_type: XHSInputType
  input_text?: string
  file_id?: string
  feishu_url?: string
  tag_policy?: Record<string, unknown>
  export_options?: Record<string, unknown>
}
