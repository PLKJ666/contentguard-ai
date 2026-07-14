import type { SoftRiskWarning } from '@/types/review'

type LegacySoftWarning = {
  type?: string
  content?: string
  suggestion?: string
  code?: string
  message?: string
  action_required?: SoftRiskWarning['action_required']
  blocking?: boolean
  context?: Record<string, unknown> | null
  timestamp?: number | string | null
}

export type SoftWarningLike = SoftRiskWarning | LegacySoftWarning

export interface NormalizedSoftWarning {
  id: string
  code: string
  label: string
  content: string
  suggestion: string
  actionRequired?: SoftRiskWarning['action_required']
  blocking: boolean
  timestamp: number
  context?: Record<string, unknown> | null
}

const SOFT_WARNING_LABELS: Record<string, string> = {
  missing_selling_points: '卖点缺失',
  tone_mismatch: '语气不符',
  length_warning: '时长提示',
  style_warning: '风格提示',
  sensitive_topic: '敏感话题',
  audience_mismatch: '受众偏差',
  soft_warning: '提示',
}

const ACTION_SUGGESTION: Record<NonNullable<SoftRiskWarning['action_required']>, string> = {
  confirm: '需要人工二次确认',
  note: '建议补充备注说明',
}

function toTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export function normalizeSoftWarning(
  warning: SoftWarningLike,
  index: number,
): NormalizedSoftWarning {
  const legacyType = 'type' in warning ? warning.type : undefined
  const legacyContent = 'content' in warning ? warning.content : undefined
  const legacySuggestion = 'suggestion' in warning ? warning.suggestion : undefined
  const legacyTimestamp = 'timestamp' in warning ? warning.timestamp : undefined
  const code = warning.code || legacyType || 'soft_warning'
  const actionRequired = warning.action_required
  const suggestion = legacySuggestion || (actionRequired ? ACTION_SUGGESTION[actionRequired] : '')
  const context = warning.context || null

  return {
    id: `w-${index}`,
    code,
    label: SOFT_WARNING_LABELS[code] || code,
    content: warning.message || legacyContent || '',
    suggestion,
    actionRequired,
    blocking: warning.blocking ?? false,
    timestamp: toTimestamp(legacyTimestamp ?? context?.timestamp),
    context,
  }
}

export function normalizeSoftWarnings(warnings: SoftWarningLike[] | null | undefined): NormalizedSoftWarning[] {
  return (warnings || []).map(normalizeSoftWarning)
}

export function normalizeCoverageTimestamp(value: unknown): number {
  return toTimestamp(value)
}
