/**
 * 规则管理类型定义
 * 与后端 api/rules.py 对齐
 */

// ===== 违禁词 =====

export interface ForbiddenWordCreate {
  word: string
  category: string
  severity: string
}

export interface ForbiddenWordResponse {
  id: string
  word: string
  category: string
  severity: string
}

export interface ForbiddenWordListResponse {
  items: ForbiddenWordResponse[]
  total: number
}

// ===== 白名单 =====

export interface WhitelistCreate {
  term: string
  reason: string
  brand_id: string
}

export interface WhitelistResponse {
  id: string
  term: string
  reason: string
  brand_id: string
}

export interface WhitelistListResponse {
  items: WhitelistResponse[]
  total: number
}

// ===== 竞品 =====

export interface CompetitorCreate {
  name: string
  brand_id: string
  logo_url?: string
  keywords: string[]
}

export interface CompetitorResponse {
  id: string
  name: string
  brand_id: string
  logo_url?: string | null
  keywords: string[]
}

export interface CompetitorListResponse {
  items: CompetitorResponse[]
  total: number
}

// ===== 平台规则 =====

export interface PlatformRuleResponse {
  platform: string
  rules: Record<string, unknown>[]
  version: string
  updated_at: string
}

export interface PlatformListResponse {
  items: PlatformRuleResponse[]
  total: number
}

// ===== 品牌方平台规则（文档上传 + AI 解析） =====

export interface ParsedRulesData {
  forbidden_words: string[]
  restricted_words: { word: string; condition: string; suggestion: string }[]
  duration: { min_seconds?: number; max_seconds?: number } | null
  content_requirements: string[]
  other_rules: { rule: string; description: string }[]
}

export interface PlatformRuleParseRequest {
  document_url: string
  document_name: string
  platform: string
  brand_id: string
}

export interface PlatformRuleParseResponse {
  id: string
  platform: string
  brand_id: string
  document_url: string
  document_name: string
  parsed_rules: ParsedRulesData
  status: string
}

export interface PlatformRuleConfirmRequest {
  parsed_rules: ParsedRulesData
}

export interface BrandPlatformRuleResponse {
  id: string
  platform: string
  brand_id: string
  document_url: string
  document_name: string
  parsed_rules: ParsedRulesData
  status: string  // draft / active / inactive
  created_at: string
  updated_at: string
}

export interface BrandPlatformRuleListResponse {
  items: BrandPlatformRuleResponse[]
  total: number
}

// ===== 通用规则文档上传解析 =====

export interface RuleDocumentParseRequest {
  document_url: string
  document_name: string
  rule_type: 'forbidden_words' | 'whitelist' | 'competitors'
  brand_id?: string
}

export interface ParsedForbiddenWord {
  word: string
  category: string
  severity: string
}

export interface ParsedWhitelistItem {
  term: string
  reason: string
}

export interface ParsedCompetitor {
  name: string
  keywords: string[]
}

export interface RuleDocumentParseResponse {
  rule_type: string
  document_name: string
  forbidden_words: ParsedForbiddenWord[]
  whitelist_items: ParsedWhitelistItem[]
  competitors: ParsedCompetitor[]
  total_parsed: number
  duplicates_removed: number
}

export interface RuleDocumentConfirmRequest {
  rule_type: 'forbidden_words' | 'whitelist' | 'competitors'
  brand_id?: string
  forbidden_words: ParsedForbiddenWord[]
  whitelist_items: ParsedWhitelistItem[]
  competitors: ParsedCompetitor[]
}

export interface RuleDocumentConfirmResponse {
  added: number
  skipped_duplicates: number
  total: number
}

// ===== 品牌学习档案 =====

export interface LearnedRuleResponse {
  id: string
  type: string
  pattern: string
  reason: string
  source_task?: string | null
  created_by: string
  created_at?: string | null
}

export interface LearnedRuleCreateRequest {
  type: string
  pattern: string
  reason: string
}

// ===== 规则冲突检测 =====

export interface RuleValidateRequest {
  brand_id: string
  platform: string
  brief_rules: Record<string, unknown>
}

export interface RuleConflict {
  brief_rule: string
  platform_rule: string
  suggestion: string
}

export interface RuleValidateResponse {
  conflicts: RuleConflict[]
}
