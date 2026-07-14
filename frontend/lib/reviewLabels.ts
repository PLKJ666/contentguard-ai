/**
 * 审核相关的中文标签映射工具
 * 统一管理 violation type / dimension / severity 等英文值到中文的映射
 */

/** 违规类型：英文 → 中文 */
const VIOLATION_TYPE_LABELS: Record<string, string> = {
  forbidden_word: '违禁词',
  efficacy_claim: '功效宣称',
  competitor_logo: '竞品露出',
  brand_safety: '品牌安全',
  platform_rule: '平台规则',
  false_advertising: '虚假宣传',
  typo: '错别字',
  verbal_error: '口误',
  subtitle_error: '字幕错误',
  duration_short: '时长不足',
  mention_missing: '品牌提及不足',
}

/** 审核维度：英文 → 中文 */
const DIMENSION_LABELS: Record<string, string> = {
  legal: '法规合规',
  platform: '平台规则',
  brand_safety: '品牌安全',
  brief_match: 'Brief匹配',
  content_quality: '内容质量',
}

/** 内容类型：英文 → 中文 */
const CONTENT_TYPE_LABELS: Record<string, string> = {
  hard_ad: '硬广',
  soft_ad: '软广',
  mixed: '混合',
  viral: '品牌曝光',
}

/** 严重程度：英文 → 中文 */
const SEVERITY_LABELS: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
}

/**
 * 获取违规类型的中文标签
 * 支持英文和中文输入（已是中文则直接返回）
 */
export function getViolationTypeLabel(type: string): string {
  return VIOLATION_TYPE_LABELS[type] || type
}

/**
 * 获取审核维度的中文标签
 * 支持英文和中文输入
 */
export function getDimensionLabel(key: string): string {
  return DIMENSION_LABELS[key] || key
}

/**
 * 获取内容类型的中文标签
 */
export function getContentTypeLabel(type: string): string {
  return CONTENT_TYPE_LABELS[type] || type
}

/**
 * 获取严重程度的中文标签
 */
export function getSeverityLabel(severity: string): string {
  return SEVERITY_LABELS[severity] || severity
}

// ==================== 驳回 comment 编译工具 ====================

export interface ViolationForComment {
  id: string
  type: string
  content: string
  suggestion?: string
}

/**
 * 将勾选的违规项 + 审核员补充说明编译为格式化的驳回 comment
 *
 * 格式：
 * 【AI 检测问题】
 * 1. [违禁词] 内容包含"最好"等绝对化用语
 *    → 建议：修改为"优质"等替代表达
 *
 * 【审核员补充】
 * 手动输入的补充说明...
 */
export function buildRejectComment(
  checkedViolations: Record<string, boolean>,
  violations: ViolationForComment[],
  rejectReason: string,
): string {
  const selected = violations.filter(v => checkedViolations[v.id])
  const hasSelected = selected.length > 0
  const hasReason = rejectReason.trim().length > 0

  const parts: string[] = []

  if (hasSelected) {
    const lines = selected.map((v, idx) => {
      let line = `${idx + 1}. [${getViolationTypeLabel(v.type)}] ${v.content}`
      if (v.suggestion) {
        line += `\n   → 建议：${v.suggestion}`
      }
      return line
    })
    parts.push(`【AI 检测问题】\n${lines.join('\n')}`)
  }

  if (hasReason) {
    if (hasSelected) {
      parts.push(`【审核员补充】\n${rejectReason.trim()}`)
    } else {
      // 只有补充说明，不加标题
      parts.push(rejectReason.trim())
    }
  }

  return parts.join('\n\n')
}

/**
 * 判断是否可以提交驳回：勾选了违规项或填写了补充说明
 */
export function canReject(
  checkedViolations: Record<string, boolean>,
  rejectReason: string,
): boolean {
  const hasChecked = Object.values(checkedViolations).some(Boolean)
  const hasReason = rejectReason.trim().length > 0
  return hasChecked || hasReason
}
