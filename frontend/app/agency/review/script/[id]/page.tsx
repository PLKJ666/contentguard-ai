'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams, usePathname } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal, ConfirmModal } from '@/components/ui/Modal'
import { SuccessTag, WarningTag, ErrorTag } from '@/components/ui/Tag'
import { ReviewSteps, getAgencyReviewSteps, getOperatorReviewSteps } from '@/components/ui/ReviewSteps'
import { getViolationTypeLabel, buildRejectComment, canReject } from '@/lib/reviewLabels'
import { formatTaskDisplayTitle } from '@/lib/taskDisplay'
import {
  ArrowLeft,
  FileText,
  CheckCircle,
  XCircle,
  AlertTriangle,
  User,
  Clock,
  Eye,
  Shield,
  Download,
  MessageSquareWarning,
  Loader2,
  Wrench,
  ChevronDown,
  ChevronUp,
  Wand2,
  Copy,
  Check,
} from 'lucide-react'
import { FilePreview, FileInfoCard, FilePreviewModal, type FileInfo } from '@/components/ui/FilePreview'
import { api, extractErrorMessage } from '@/lib/api'
import { getPlatformInfo } from '@/lib/platforms'
import { normalizeSoftWarnings, type SoftWarningLike } from '@/lib/reviewWarnings'
import { extractScriptReviewInsights } from '@/lib/scriptReviewInsights'
import type { TaskResponse } from '@/types/task'

// ===== 修正工作台类型 =====
type FixCard = {
  id: string
  type: string
  content: string       // 违规原文
  suggestion: string    // 修改方向
  dimension?: string
  fixable: boolean      // true=精准替换, false=需AI重写
  severity: string
}

// 简单文本替换（精准替换）
function applyTextReplacements(
  original: string,
  replacements: Array<{ from: string; to: string }>
): string {
  let result = original
  for (const { from, to } of replacements) {
    if (from && to && from !== to) {
      result = result.split(from).join(to)
    }
  }
  return result
}

// 生成简单 diff 标注（用于预览）
function buildDiffHtml(original: string, corrected: string): React.ReactNode[] {
  if (original === corrected) return [<span key="0">{original}</span>]
  // 逐句对比
  const origLines = original.split('\n')
  const corrLines = corrected.split('\n')
  const maxLen = Math.max(origLines.length, corrLines.length)
  const nodes: React.ReactNode[] = []
  for (let i = 0; i < maxLen; i++) {
    const o = origLines[i] ?? ''
    const c = corrLines[i] ?? ''
    if (o === c) {
      nodes.push(<span key={i} className="text-text-primary">{c}{i < maxLen - 1 ? '\n' : ''}</span>)
    } else {
      nodes.push(
        <span key={i}>
          {o && <span className="bg-accent-coral/20 text-accent-coral line-through">{o}</span>}
          {o && c && <span className="text-text-tertiary"> → </span>}
          {c && <span className="bg-accent-green/20 text-accent-green">{c}</span>}
          {i < maxLen - 1 ? '\n' : ''}
        </span>
      )
    }
  }
  return nodes
}

// 计算修改幅度百分比
function calcChangeRatio(original: string, corrected: string): number {
  if (!original || original === corrected) return 0
  let diff = 0
  const minLen = Math.min(original.length, corrected.length)
  for (let i = 0; i < minLen; i++) {
    if (original[i] !== corrected[i]) diff++
  }
  diff += Math.abs(original.length - corrected.length)
  return Math.round((diff / original.length) * 100)
}

/**
 * 从 suggestion 文本里解析明确的词对映射，如：
 *   '啊啊啊～好可爱'→'第一眼就被Mimi的温柔感打动'；'狂笑'→'忍不住笑出声'
 * 返回 [{from, to}, ...] 供直接文本替换使用。
 */
function parseSuggestionPairs(suggestion: string): Array<{ from: string; to: string }> {
  const pairs: Array<{ from: string; to: string }> = []
  // 把各种弯引号统一成直引号，再做匹配
  const normalized = suggestion
    .replace(/[\u2018\u2019\u300C\u300E]/g, "'")   // 左弯引号 → '
    .replace(/[\u201C\u201D\u300D\u300F]/g, "'")   // 右弯引号 → '
  const re = /'([^']{1,60})'[\s]*[→\->＞]+[\s]*'([^']{1,80})'/g
  let m: RegExpExecArray | null
  while ((m = re.exec(normalized)) !== null) {
    if (m[1] && m[2] && m[1] !== m[2]) {
      pairs.push({ from: m[1], to: m[2] })
    }
  }
  return pairs
}

/**
 * 归一化字符串用于比较（全角→半角、多余空白合并）
 * 解决 AI 输出与原文字符编码不一致导致的匹配失败
 */
function normForCompare(s: string): string {
  return s
    .replace(/[\uFF01-\uFF5E]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 对元描述型违规（v.content 不在原文），通过 AI 重写结果与原文的行级对比，
 * 找出哪些行被修改了，返回行级替换对列表。
 * 用归一化字符串做前缀匹配，避免全角/半角差异导致匹配失败。
 */
function buildReplacementsFromLineDiff(
  originalText: string,
  rewrittenText: string
): Array<{ from: string; to: string }> {
  const origLines = originalText.split('\n').map(l => l.trim()).filter(Boolean)
  const rewLines = rewrittenText.split('\n').map(l => l.trim()).filter(Boolean)
  const origNorm = origLines.map(normForCompare)
  const rewNorm = rewLines.map(normForCompare)
  const pairs: Array<{ from: string; to: string }> = []
  const usedOrig = new Set<number>()

  for (let ri = 0; ri < rewLines.length; ri++) {
    const rewN = rewNorm[ri]
    if (rewN.length < 5) continue
    let bestIdx = -1
    let bestPrefixLen = 0
    for (let i = 0; i < origLines.length; i++) {
      if (usedOrig.has(i)) continue
      const origN = origNorm[i]
      if (origN.length < 5) continue
      // 用归一化字符串计算公共前缀
      let len = 0
      const minL = Math.min(origN.length, rewN.length)
      while (len < minL && origN[len] === rewN[len]) len++
      if (len > bestPrefixLen && len >= 3) {
        bestPrefixLen = len
        bestIdx = i
      }
    }
    // 归一化后不同才算改动，但 from/to 用原始未归一化文本
    if (bestIdx !== -1 && origNorm[bestIdx] !== rewN) {
      pairs.push({ from: origLines[bestIdx], to: rewLines[ri] })
      usedOrig.add(bestIdx)
    }
  }
  return pairs
}

/**
 * 当 v.content 是 AI 生成的元描述（如"缺失core卖点：..."）而非原文真实片段时，
 * 通过比对 rewritten 与 scriptText 的公共前缀/后缀，逆推出原文中对应的文本段落，
 * 用于精准文件替换。
 */
function resolveFromText(
  content: string,
  rewritten: string,
  scriptText: string
): string {
  // 如果 content 本身就存在于原文，直接用
  if (scriptText.includes(content)) return content
  if (!rewritten || !scriptText) return content

  // 寻找 rewritten 开头在 scriptText 中最长匹配前缀
  let prefixLen = 0
  for (let len = Math.min(30, rewritten.length); len >= 5; len--) {
    if (scriptText.includes(rewritten.substring(0, len))) {
      prefixLen = len
      break
    }
  }
  if (prefixLen === 0) return content

  const startIdx = scriptText.indexOf(rewritten.substring(0, prefixLen))

  // 寻找 rewritten 结尾在 scriptText 中最长匹配后缀
  let suffixLen = 0
  for (let len = Math.min(30, rewritten.length); len >= 4; len--) {
    const suffix = rewritten.substring(rewritten.length - len)
    const idx = scriptText.indexOf(suffix, startIdx)
    if (idx !== -1) {
      suffixLen = len
      break
    }
  }

  if (suffixLen > 0) {
    const suffix = rewritten.substring(rewritten.length - suffixLen)
    const endIdx = scriptText.indexOf(suffix, startIdx) + suffixLen
    return scriptText.substring(startIdx, endIdx)
  }

  // 找不到后缀，取到行尾
  let lineEnd = scriptText.indexOf('\n', startIdx + prefixLen)
  if (lineEnd === -1) lineEnd = scriptText.length
  return scriptText.substring(startIdx, lineEnd)
}

// 从 TaskResponse 映射到页面视图模型
function mapTaskToViewModel(task: TaskResponse) {
  const aiResult = task.script_ai_result
  const conclusions = aiResult?.conclusions
  const legacyConclusions = conclusions as ({
    soft_warnings?: unknown[]
    summary?: string
  } & Record<string, unknown>) | undefined

  // 提取违规项：优先 conclusions (v2)，回退顶层 (v1)
  const rawViolations = conclusions?.violations || aiResult?.violations || []
  // 提取卖点匹配
  const rawSellingPointMatches = conclusions?.selling_point_matches || aiResult?.selling_point_matches || []
  // 提取软性提醒
  const rawSoftWarnings = (aiResult?.soft_warnings || legacyConclusions?.soft_warnings || []) as SoftWarningLike[]
  // 提取维度评分
  let dimensions = aiResult?.dimensions
  if (conclusions && !dimensions) {
    dimensions = {
      legal: { score: conclusions.legal.score, passed: conclusions.legal.passed, issue_count: conclusions.legal.issue_count },
      platform: { score: conclusions.platform.score, passed: conclusions.platform.passed, issue_count: conclusions.platform.issue_count },
      brand_safety: { score: conclusions.brand_safety.score, passed: conclusions.brand_safety.passed, issue_count: conclusions.brand_safety.issue_count },
      brief_match: { score: conclusions.brief_match.score, passed: conclusions.brief_match.passed, issue_count: conclusions.brief_match.issue_count },
      content_quality: { score: conclusions.content_quality.score, passed: conclusions.content_quality.passed, issue_count: conclusions.content_quality.issue_count },
    }
  }

  return {
    id: task.id,
    title: formatTaskDisplayTitle({
      taskName: task.name,
      projectName: task.project?.name,
      sequence: task.sequence,
    }),
    creatorName: task.creator?.name || '未知达人',
    projectName: task.project?.name || '未知项目',
    brandName: task.project?.brand_name || '',
    platform: task.project?.platform || '',
    submittedAt: task.script_uploaded_at || task.created_at,
    aiScore: task.script_ai_score ?? 0,
    status: task.stage,
    file: {
      id: `file-${task.id}`,
      fileName: task.script_file_name || (task.script_text_content ? '粘贴文本.txt' : '未知文件'),
      fileSize: '',
      fileType: !task.script_file_url ? 'text/plain' : guessScriptMimeType(task.script_file_name),
      fileUrl: task.script_file_url || '',
      uploadedAt: task.script_uploaded_at || task.created_at,
    } as FileInfo,
    isAppeal: task.is_appeal,
    appealReason: task.appeal_reason || '',
    scriptContent: {
      opening: '',
      productIntro: '',
      demo: '',
      closing: '',
    },
    aiAnalysis: {
      violations: rawViolations.map((v: Record<string, unknown>, idx: number) => ({
        id: `v${idx + 1}`,
        type: v.type as string || '',
        content: v.content as string || '',
        suggestion: v.suggestion as string || '',
        severity: v.severity as string || 'medium',
        dimension: v.dimension as string | undefined,
        fixable: v.fixable as boolean | undefined,
        rewritten: v.rewritten as string || '',  // AI 审核阶段预生成的影子重写结果
      })),
      complianceChecks: normalizeSoftWarnings(rawSoftWarnings).map((w) => ({
        item: w.label,
        passed: false,
        note: w.content,
      })),
      dimensions,
      brandExposure: aiResult?.brand_exposure,
      sellingPointMatches: rawSellingPointMatches,
      sellingPoints: [] as Array<{ point: string; covered: boolean }>,
      viralPotential: conclusions?.content_quality?.viral_potential,
      viralReason: conclusions?.content_quality?.viral_reason,
      contentVerdict: conclusions?.content_quality?.overall_verdict,
      chainOfThought: aiResult?.chain_of_thought,
    },
    aiSummary: aiResult?.summary || conclusions?.overall_summary || legacyConclusions?.summary || '',
    scriptTextContent: task.script_text_content || null,
    scriptAgencyCorrected: task.script_agency_corrected || null,
    aiAutoRejected: aiResult?.ai_auto_rejected === true,
    aiRejectReason: aiResult?.ai_reject_reason || '',
  }
}

// 从 chain_of_thought 提取维度评语
function getDimensionSummary(cot: Record<string, unknown> | undefined, key: string): string {
  if (!cot) return ''
  const getSummary = (obj: unknown): string => {
    if (!obj || typeof obj !== 'object') return ''
    const o = obj as Record<string, unknown>
    if (typeof o.summary === 'string') return o.summary
    if (typeof o.risk_assessment === 'string') return o.risk_assessment
    if (typeof o.overall_assessment === 'string') return o.overall_assessment
    if (typeof o.creative_assessment === 'string') return o.creative_assessment
    return ''
  }
  if (key === 'legal' || key === 'platform' || key === 'brand_safety') {
    const co = cot.compliance_officer as Record<string, unknown> | undefined
    return getSummary(co?.[key])
  }
  if (key === 'brief_match') {
    const cd = cot.creative_director as Record<string, unknown> | undefined
    const bm = cd?.brief_match as Record<string, unknown> | undefined
    return getSummary(bm)
  }
  if (key === 'content_quality') {
    const cd = cot.creative_director as Record<string, unknown> | undefined
    const cq = cd?.content_quality as Record<string, unknown> | undefined
    const s = getSummary(cq)
    if (s) return s
    const highlights = cq?.highlights as string[] | undefined
    if (highlights?.length) return highlights[0]
    return ''
  }
  return ''
}

function guessScriptMimeType(fileName?: string | null): string {
  const ext = fileName?.split('.').pop()?.toLowerCase() || ''
  const mimeMap: Record<string, string> = {
    txt: 'text/plain',
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    csv: 'text/csv',
    rtf: 'application/rtf',
  }
  return mimeMap[ext] || 'application/octet-stream'
}

type ScriptTaskViewModel = ReturnType<typeof mapTaskToViewModel>

const DEFAULT_TASK: ScriptTaskViewModel = {
  id: '',
  title: '',
  creatorName: '',
  projectName: '',
  brandName: '',
  platform: '',
  submittedAt: '',
  aiScore: 0,
  status: 'script_agency_review',
  file: {
    id: '',
    fileName: '',
    fileSize: '',
    fileType: '',
    fileUrl: '',
    uploadedAt: '',
  } as FileInfo,
  isAppeal: false,
  appealReason: '',
  scriptContent: { opening: '', productIntro: '', demo: '', closing: '' },
  aiAnalysis: {
    violations: [],
    complianceChecks: [],
    dimensions: undefined,
    brandExposure: undefined,
    sellingPointMatches: [],
    sellingPoints: [],
    viralPotential: undefined,
    viralReason: undefined,
    contentVerdict: undefined,
    chainOfThought: undefined,
  },
  aiSummary: '',
  scriptTextContent: null,
  scriptAgencyCorrected: null,
  aiAutoRejected: false,
  aiRejectReason: '',
}

// ===== 修正工作台面板组件 =====
function WorkbenchPanel({
  task, taskId,
  surgicalChecked, setSurgicalChecked,
  surgicalReplacement, setSurgicalReplacement,
  rewriteExpanded, setRewriteExpanded,
  rewriteLoading, rewriteDecision, setRewriteDecision,
  correctedScript, setCorrectedScript,
  copied,
  onAIRewrite, onGenerate, generating, onCopy, onDownload, onDownloadFixedFile, fileFixLoading, onSubmit,
  getWorkbenchStatus, submitting, approvalLabel,
}: {
  task: ScriptTaskViewModel
  taskId: string
  surgicalChecked: Record<string, boolean>
  setSurgicalChecked: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  surgicalReplacement: Record<string, Array<{from: string; to: string}>>
  setSurgicalReplacement: React.Dispatch<React.SetStateAction<Record<string, Array<{from: string; to: string}>>>>
  rewriteExpanded: Record<string, boolean>
  setRewriteExpanded: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  rewriteLoading: Record<string, boolean>
  rewriteDecision: Record<string, 'accept' | 'reject' | null>
  setRewriteDecision: React.Dispatch<React.SetStateAction<Record<string, 'accept' | 'reject' | null>>>
  correctedScript: string | null
  setCorrectedScript: React.Dispatch<React.SetStateAction<string | null>>
  copied: boolean
  onAIRewrite: (id: string, content: string, suggestion: string) => void
  onGenerate: () => void
  generating: boolean
  onCopy: () => void
  onDownload: () => void
  onDownloadFixedFile: () => void
  fileFixLoading: boolean
  onSubmit: () => void
  getWorkbenchStatus: () => { total: number; aiCards: number; pendingAI: number }
  submitting: boolean
  approvalLabel: string
}) {
  const violations = task.aiAnalysis.violations
  const surgical = violations.filter(v => v.fixable !== false)
  const aiRewrites = violations.filter(v => v.fixable === false)
  const { pendingAI } = getWorkbenchStatus()
  const hasText = !!task.scriptTextContent
  const changeRatio = correctedScript && task.scriptTextContent
    ? calcChangeRatio(task.scriptTextContent, correctedScript) : 0
  // 原始文件类型（空表示纯文字粘贴）
  const originalFileExt = task.file?.fileUrl
    ? (task.file.fileName.includes('.') ? task.file.fileName.split('.').pop()!.toLowerCase() : '') : ''
  const hasOriginalFile = ['xlsx', 'xls', 'docx', 'doc', 'txt'].includes(originalFileExt)

  if (violations.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <CheckCircle size={40} className="text-accent-green mx-auto mb-3" />
          <p className="text-text-primary font-medium">未发现违规，无需修正</p>
          <p className="text-sm text-text-tertiary mt-1">可直接通过审核</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* 精准替换区 */}
      {surgical.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle size={16} className="text-accent-green" />
              精准替换 ({surgical.length} 项)
              <span className="text-xs font-normal text-text-tertiary">· 直接替换词句，不改变风格</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {surgical.map(v => (
              <div key={v.id} className={`p-3 rounded-lg border transition-colors ${
                surgicalChecked[v.id] ? 'border-accent-green/40 bg-accent-green/5' : 'border-border-subtle bg-bg-elevated'
              }`}>
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={surgicalChecked[v.id] || false}
                    onChange={() => setSurgicalChecked(prev => ({ ...prev, [v.id]: !prev[v.id] }))}
                    className="mt-1 w-4 h-4 accent-accent-indigo cursor-pointer flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="text-xs px-1.5 py-0.5 rounded bg-accent-coral/20 text-accent-coral font-medium">
                        {getViolationTypeLabel(v.type)}
                      </span>
                      {v.dimension && <span className="text-xs text-text-tertiary">{v.dimension}</span>}
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        v.severity === 'high' ? 'bg-red-500/20 text-red-400' :
                        v.severity === 'medium' ? 'bg-accent-amber/20 text-accent-amber' :
                        'bg-bg-page text-text-tertiary'
                      }`}>{v.severity === 'high' ? '高风险' : v.severity === 'medium' ? '中风险' : '低风险'}</span>
                    </div>
                    {/* 改动对列表 */}
                    {(() => {
                      const pairs = surgicalReplacement[v.id]
                      if (rewriteLoading[v.id]) {
                        return (
                          <div className="flex items-center gap-1.5 text-xs text-text-tertiary py-1">
                            <Loader2 size={12} className="animate-spin" />AI 分析中，请稍候...
                          </div>
                        )
                      }
                      if (pairs?.length) {
                        return (
                          <div className="space-y-2">
                            {pairs.map((pair, pi) => (
                              <div key={pi} className="space-y-1">
                                <div className="flex items-start gap-2">
                                  <span className="text-xs text-accent-coral font-medium mt-0.5 flex-shrink-0">改前</span>
                                  <p className="text-sm text-text-secondary bg-accent-coral/10 px-2 py-1 rounded line-through decoration-accent-coral/40 break-words flex-1">{pair.from}</p>
                                </div>
                                <div className="flex items-start gap-2">
                                  <span className="text-xs text-accent-green font-medium mt-0.5 flex-shrink-0">改后</span>
                                  <textarea
                                    value={pair.to}
                                    onChange={e => setSurgicalReplacement(prev => {
                                      const updated = [...(prev[v.id] || [])]
                                      updated[pi] = { ...updated[pi], to: e.target.value }
                                      return { ...prev, [v.id]: updated }
                                    })}
                                    rows={Math.min(4, Math.ceil(pair.to.length / 40) + 1)}
                                    className="flex-1 text-sm bg-accent-green/5 border border-accent-green/30 rounded px-2 py-1 text-text-primary focus:outline-none focus:border-accent-green resize-none"
                                  />
                                </div>
                              </div>
                            ))}
                            <button
                              onClick={() => onAIRewrite(v.id, v.content, v.suggestion)}
                              disabled={rewriteLoading[v.id]}
                              className="text-xs text-text-tertiary hover:text-accent-indigo flex items-center gap-1 disabled:opacity-50"
                            >
                              {rewriteLoading[v.id]
                                ? <><Loader2 size={11} className="animate-spin" />重新生成中...</>
                                : <><Wand2 size={11} />重新 AI 生成</>
                              }
                            </button>
                          </div>
                        )
                      }
                      return (
                        <div className="space-y-1.5">
                          <p className="text-sm text-text-secondary bg-accent-coral/10 px-2 py-1 rounded break-words">{v.content}</p>
                          <button
                            onClick={() => onAIRewrite(v.id, v.content, v.suggestion)}
                            disabled={rewriteLoading[v.id]}
                            className="text-xs text-accent-indigo hover:text-accent-indigo/80 flex items-center gap-1 disabled:opacity-50"
                          >
                            {rewriteLoading[v.id]
                              ? <><Loader2 size={12} className="animate-spin" />AI 重写中...</>
                              : <><Wand2 size={12} />单独 AI 重写此项</>
                            }
                          </button>
                        </div>
                      )
                    })()}
                    <p className="text-xs text-text-tertiary mt-1 break-words">{v.suggestion}</p>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* AI 重写区 */}
      {aiRewrites.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Wand2 size={16} className="text-accent-indigo" />
              需要 AI 重写 ({aiRewrites.length} 项)
              <span className="text-xs font-normal text-text-tertiary">· 每条必须逐个审阅确认</span>
              {pendingAI > 0 && (
                <span className="text-xs bg-accent-amber/20 text-accent-amber px-2 py-0.5 rounded-full">
                  待审阅 {pendingAI}/{aiRewrites.length}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {aiRewrites.map(v => {
              const expanded = rewriteExpanded[v.id]
              const loading = rewriteLoading[v.id]
              const result = surgicalReplacement[v.id]
              const decision = rewriteDecision[v.id]

              return (
                <div key={v.id} className={`rounded-lg border overflow-hidden ${
                  decision === 'accept' ? 'border-accent-green/40' :
                  decision === 'reject' ? 'border-border-subtle' :
                  'border-accent-amber/40'
                }`}>
                  {/* 卡片头 */}
                  <button
                    type="button"
                    onClick={() => setRewriteExpanded(prev => ({ ...prev, [v.id]: !prev[v.id] }))}
                    className="w-full flex items-center justify-between p-3 bg-bg-elevated hover:bg-bg-page transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      {decision == null && <AlertTriangle size={14} className="text-accent-amber" />}
                      {decision === 'accept' && <CheckCircle size={14} className="text-accent-green" />}
                      {decision === 'reject' && <XCircle size={14} className="text-text-tertiary" />}
                      <span className="text-xs px-1.5 py-0.5 rounded bg-accent-coral/20 text-accent-coral font-medium">
                        {getViolationTypeLabel(v.type)}
                      </span>
                      <span className="text-sm text-text-primary truncate max-w-[200px]">{v.content}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {decision == null && <span className="text-xs text-accent-amber">需审阅</span>}
                      {decision === 'accept' && <span className="text-xs text-accent-green">已采纳</span>}
                      {decision === 'reject' && <span className="text-xs text-text-tertiary">已跳过</span>}
                      {expanded ? <ChevronUp size={14} className="text-text-tertiary" /> : <ChevronDown size={14} className="text-text-tertiary" />}
                    </div>
                  </button>

                  {/* 展开内容 */}
                  {expanded && (
                    <div className="p-3 space-y-3 bg-bg-card border-t border-border-subtle">
                      <div>
                        <p className="text-xs text-text-tertiary mb-1">违规原文</p>
                        <p className="text-sm text-accent-coral bg-accent-coral/5 px-2 py-1 rounded">{v.content}</p>
                      </div>
                      <div>
                        <p className="text-xs text-text-tertiary mb-1">修改方向</p>
                        <p className="text-sm text-text-secondary">{v.suggestion}</p>
                      </div>

                      {/* AI 重写结果 */}
                      {!result && (
                        <Button
                          variant="secondary"
                          onClick={() => onAIRewrite(v.id, v.content, v.suggestion)}
                          disabled={loading}
                          className="w-full"
                        >
                          {loading ? (
                            <><Loader2 size={14} className="animate-spin mr-1" />影子写手重写中...</>
                          ) : (
                            <><Wand2 size={14} className="mr-1" />AI 重写此段</>
                          )}
                        </Button>
                      )}

                      {result && (
                        <div className="space-y-2">
                          <p className="text-xs text-text-tertiary">AI 改动点（{result.length} 处）</p>
                          {result.map((pair, pi) => (
                            <div key={pi} className="p-2 bg-bg-elevated rounded-lg text-sm space-y-1">
                              <p className="text-accent-coral line-through break-words">{pair.from}</p>
                              <p className="text-accent-green break-words">→ {pair.to}</p>
                            </div>
                          ))}
                          <div className="flex gap-2">
                            <Button
                              variant={decision === 'accept' ? 'success' : 'secondary'}
                              onClick={() => setRewriteDecision(prev => ({ ...prev, [v.id]: 'accept' }))}
                              className="flex-1"
                            >
                              <Check size={14} className="mr-1" />确认采纳
                            </Button>
                            <Button
                              variant={decision === 'reject' ? 'danger' : 'secondary'}
                              onClick={() => {
                                setRewriteDecision(prev => ({ ...prev, [v.id]: 'reject' }))
                              }}
                              className="flex-1"
                            >
                              <XCircle size={14} className="mr-1" />保留原文
                            </Button>
                          </div>
                          {decision === 'accept' && (
                            <button
                              type="button"
                              onClick={() => onAIRewrite(v.id, v.content, v.suggestion)}
                              disabled={loading}
                              className="text-xs text-text-tertiary hover:text-accent-indigo underline disabled:opacity-50"
                            >
                              {loading ? '重新生成中...' : '重新生成'}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {/* 改后脚本 + 提交区 */}
      <Card>
        <CardContent className="py-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-text-primary">修正后脚本</span>
            {correctedScript && changeRatio > 0 && (
              <span className="text-xs text-text-tertiary">
                修改幅度：{changeRatio}%
                {changeRatio > 30 && <span className="text-accent-amber ml-1">⚠ 改动较大</span>}
              </span>
            )}
          </div>

          {/* 有文字版：AI 批量重写按钮 */}
          {hasText && (
            <Button variant="secondary" onClick={onGenerate} disabled={generating} className="w-full">
              {generating
                ? <><Loader2 size={14} className="animate-spin mr-1" />AI 重写中，请稍候...</>
                : <><Wand2 size={14} className="mr-1" />{correctedScript ? '重新 AI 修正勾选项' : 'AI 修正勾选项并生成改后脚本'}</>
              }
            </Button>
          )}

          {/* 无文字版提示 */}
          {!hasText && !hasOriginalFile && (
            <div className="p-3 bg-bg-elevated rounded-lg border border-border-subtle">
              <p className="text-xs text-text-tertiary">脚本为文件上传，无法自动替换。可手动粘贴改后版本，或直接提交审核。</p>
            </div>
          )}

          {/* 改后脚本文本框（手动填写或自动生成后可编辑） */}
          <div>
            <p className="text-xs text-text-tertiary mb-1.5">
              {correctedScript ? '改后脚本（可手动编辑）' : '手动填写改后脚本（可选）'}
            </p>
            <textarea
              value={correctedScript || ''}
              onChange={e => setCorrectedScript(e.target.value || null)}
              rows={8}
              placeholder="在此粘贴或编辑修正后的脚本内容..."
              className="w-full bg-bg-elevated border border-border-subtle rounded-lg p-3 text-sm text-text-primary font-mono leading-relaxed resize-y focus:outline-none focus:border-accent-indigo placeholder:text-text-tertiary"
            />
          </div>

          {/* 操作按钮行 */}
          <div className="flex gap-2">
            {correctedScript && (
              <>
                <Button variant="secondary" onClick={onCopy} className="flex-1">
                  {copied ? <><Check size={14} className="mr-1 text-accent-green" />已复制</> : <><Copy size={14} className="mr-1" />复制</>}
                </Button>
                <Button variant="secondary" onClick={onDownload} className="flex-1">
                  <Download size={14} className="mr-1" />下载 .txt
                </Button>
              </>
            )}
            {/* 有原始文件（xlsx/docx/txt）时，始终显示下载原格式修改版按钮 */}
            {hasOriginalFile && (
              <Button
                variant="secondary"
                onClick={onDownloadFixedFile}
                disabled={fileFixLoading}
                className="flex-1"
              >
                {fileFixLoading
                  ? <><Loader2 size={14} className="animate-spin mr-1" />生成中...</>
                  : <><Download size={14} className="mr-1" />下载修改后 .{originalFileExt}</>
                }
              </Button>
            )}
          </div>

          <Button
            variant="success"
            onClick={onSubmit}
            disabled={submitting || pendingAI > 0}
            className="w-full"
          >
            {submitting ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
            {pendingAI > 0
              ? `请先处理 ${pendingAI} 个 AI 重写项`
              : approvalLabel
            }
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function ReviewProgressBar({ taskStatus, isOperatorMode }: { taskStatus: string; isOperatorMode: boolean }) {
  const steps = isOperatorMode ? getOperatorReviewSteps(taskStatus) : getAgencyReviewSteps(taskStatus)
  const currentStep = steps.find(s => s.status === 'current')

  return (
    <Card className="mb-6">
      <CardContent className="py-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-text-primary">审核流程</span>
          <span className="text-sm text-accent-indigo font-medium">
            当前：{currentStep?.label || (isOperatorMode ? '代运营审核' : '代理商审核')}
          </span>
        </div>
        <ReviewSteps steps={steps} />
      </CardContent>
    </Card>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 bg-bg-elevated rounded-full" />
        <div className="flex-1 space-y-2">
          <div className="h-6 bg-bg-elevated rounded w-1/3" />
          <div className="h-4 bg-bg-elevated rounded w-1/4" />
        </div>
      </div>
      <div className="h-16 bg-bg-elevated rounded-xl" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="h-32 bg-bg-elevated rounded-xl" />
          <div className="h-64 bg-bg-elevated rounded-xl" />
        </div>
        <div className="space-y-4">
          <div className="h-20 bg-bg-elevated rounded-xl" />
          <div className="h-40 bg-bg-elevated rounded-xl" />
          <div className="h-40 bg-bg-elevated rounded-xl" />
        </div>
      </div>
    </div>
  )
}

export default function AgencyScriptReviewPage() {
  const router = useRouter()
  const pathname = usePathname() || ''
  const toast = useToast()
  const params = useParams()
  const taskId = params.id as string
  const isOperatorMode = pathname.startsWith('/operator/')
  const reviewListPath = pathname.startsWith('/operator/') ? '/operator/tasks' : '/agency/review'

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [showApproveModal, setShowApproveModal] = useState(false)
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [showForcePassModal, setShowForcePassModal] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [checkedViolations, setCheckedViolations] = useState<Record<string, boolean>>({})
  const [forcePassReason, setForcePassReason] = useState('')
  const [viewMode, setViewMode] = useState<'file' | 'parsed' | 'workbench'>(isOperatorMode ? 'workbench' : 'file')
  const [showFilePreview, setShowFilePreview] = useState(false)
  const [showTextPreview, setShowTextPreview] = useState(false)
  const [task, setTask] = useState<ScriptTaskViewModel>(DEFAULT_TASK)

  // ===== 修正工作台状态 =====
  const [surgicalChecked, setSurgicalChecked] = useState<Record<string, boolean>>({})      // 精准替换：勾选状态
  const [surgicalReplacement, setSurgicalReplacement] = useState<Record<string, Array<{from: string; to: string}>>>({}) // 精准替换：AI 返回的改动对列表
  const [rewriteExpanded, setRewriteExpanded] = useState<Record<string, boolean>>({})      // AI重写：是否展开
  const [rewriteLoading, setRewriteLoading] = useState<Record<string, boolean>>({})        // AI重写：加载中
  const [rewriteDecision, setRewriteDecision] = useState<Record<string, 'accept' | 'reject' | null>>({}) // AI重写：决策
  const [correctedScript, setCorrectedScript] = useState<string | null>(null)             // 最终改后脚本
  const [copied, setCopied] = useState(false)


  const loadTask = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.getTask(taskId)
      const vm = mapTaskToViewModel(data)
      setTask(vm)
      // AI 驳回时自动切到工作台
      if (vm.aiAutoRejected) setViewMode('workbench')
    } catch (err: unknown) {
      const message = extractErrorMessage(err)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [taskId, toast])

  useEffect(() => {
    loadTask()
  }, [loadTask])

  // 初始化：复用 AI 审核阶段已产出的 rewritten，减少重复点击与等待
  useEffect(() => {
    const originalText = task.scriptTextContent || ''
    const prefilled: Record<string, Array<{ from: string; to: string }>> = {}
    for (const v of task.aiAnalysis.violations) {
      const rewritten = ((v as Record<string, unknown>).rewritten as string | undefined)?.trim()
      if (!rewritten) continue
      if (v.content && originalText.includes(v.content)) {
        prefilled[v.id] = [{ from: v.content, to: rewritten }]
        continue
      }
      const inferredPairs = buildReplacementsFromLineDiff(originalText, rewritten)
      if (inferredPairs.length > 0) {
        prefilled[v.id] = inferredPairs
      }
    }
    if (Object.keys(prefilled).length === 0) return
    setSurgicalReplacement(prev => {
      const merged = { ...prev }
      for (const [id, pairs] of Object.entries(prefilled)) {
        if (!merged[id]?.length) merged[id] = pairs
      }
      return merged
    })
  }, [task])

  // ===== 工作台：对单个违规项调用 AI，返回改动对列表 =====
  const handleAIRewrite = async (cardId: string, content: string, suggestion: string) => {
    const scriptText = task.scriptTextContent || ''
    setRewriteLoading(prev => ({ ...prev, [cardId]: true }))
    setRewriteDecision(prev => ({ ...prev, [cardId]: null }))
    try {
      const result = await api.aiRewriteSegment(taskId, {
        full_script: scriptText,
        segment: scriptText,  // 始终传全文，让 AI 自己定位需要改的地方
        violation_content: content,
        suggestion,
        ...(task.brandName ? { brand_context: task.brandName } : {}),
      })
      setSurgicalReplacement(prev => ({ ...prev, [cardId]: result.replacements }))
    } catch {
      toast.error('AI 重写失败，请重试')
    } finally {
      setRewriteLoading(prev => ({ ...prev, [cardId]: false }))
    }
  }

  const buildSelectedReplacements = useCallback(() => {
    const replacements: Array<{ from: string; to: string }> = []

    for (const v of task.aiAnalysis.violations) {
      if (v.fixable === false) {
        // AI 重写卡：仅采纳项
        if (rewriteDecision[v.id] !== 'accept') continue
      } else {
        // 精准替换卡：仅勾选项
        if (!surgicalChecked[v.id]) continue
      }
      const pairs = surgicalReplacement[v.id]
      if (pairs?.length) {
        replacements.push(...pairs)
      }
    }

    // 去重并过滤无效替换
    const deduped: Array<{ from: string; to: string }> = []
    const seen = new Set<string>()
    for (const r of replacements) {
      const from = (r.from || '').trim()
      const to = (r.to || '').trim()
      if (!from || !to || from === to) continue
      if (seen.has(from)) continue
      seen.add(from)
      deduped.push({ from, to })
    }
    return deduped
  }, [task, surgicalChecked, surgicalReplacement, rewriteDecision])

  // ===== 工作台：生成改后脚本（勾选的精准替换 + 已采纳的 AI 重写） =====
  const [generating, setGenerating] = useState(false)
  const generateCorrectedScript = useCallback(async () => {
    const originalText = task.scriptTextContent || ''
    if (!originalText) {
      toast.error('脚本文字内容不可用，无法生成改后版本')
      return
    }

    const checkedSurgical = task.aiAnalysis.violations.filter(v => v.fixable !== false && surgicalChecked[v.id])
    const acceptedAICount = task.aiAnalysis.violations.filter(v => v.fixable === false && rewriteDecision[v.id] === 'accept').length
    if (checkedSurgical.length === 0 && acceptedAICount === 0) {
      toast.error('请先勾选修正项，或先采纳至少 1 个 AI 重写项')
      return
    }

    // 对勾选但尚未 AI 重写的项，自动触发
    const latestReplacement: Record<string, Array<{from: string; to: string}>> = { ...surgicalReplacement }
    const needsRewrite = checkedSurgical.filter(v => !latestReplacement[v.id]?.length)
    if (needsRewrite.length > 0) {
      setGenerating(true)
      try {
        // 逐项改写，避免“所有卡片共享同一组替换对”
        const rewriteResults = await Promise.all(
          needsRewrite.map(async v => {
            const result = await api.aiRewriteSegment(taskId, {
              full_script: originalText,
              segment: v.content,
              violation_content: v.content,
              suggestion: v.suggestion,
              ...(task.brandName ? { brand_context: task.brandName } : {}),
            })
            return { id: v.id, replacements: result.replacements }
          })
        )
        const updates: Record<string, Array<{from: string; to: string}>> = {}
        for (const item of rewriteResults) {
          updates[item.id] = item.replacements
        }
        Object.assign(latestReplacement, updates)
        setSurgicalReplacement(prev => ({ ...prev, ...updates }))
      } catch {
        toast.error('AI 重写失败，请重试')
        return
      } finally {
        setGenerating(false)
      }
    }

    // 收集所有勾选项的替换对（用 latestReplacement 避免 state 异步问题）
    const allReplacements: Array<{ from: string; to: string }> = []
    for (const v of checkedSurgical) {
      const pairs = latestReplacement[v.id] || []
      allReplacements.push(...pairs)
    }
    // 加入 AI 重写卡已采纳项
    for (const v of task.aiAnalysis.violations.filter(v => v.fixable === false && rewriteDecision[v.id] === 'accept')) {
      const pairs = latestReplacement[v.id] || surgicalReplacement[v.id] || []
      allReplacements.push(...pairs)
    }
    // 去重
    const seen = new Set<string>()
    const deduped = allReplacements.filter(r => {
      const from = r.from?.trim()
      if (!from || !r.to?.trim() || from === r.to?.trim()) return false
      if (seen.has(from)) return false
      seen.add(from)
      return true
    })

    if (deduped.length === 0) {
      toast.error('未找到可替换内容，请检查修改建议是否包含具体词句')
      return
    }

    const corrected = applyTextReplacements(originalText, deduped)
    setCorrectedScript(corrected)
    toast.success(`已生成改后版本：${deduped.length} 处替换`)
  }, [task, taskId, surgicalChecked, surgicalReplacement, rewriteDecision, toast])

  // ===== 工作台：复制到剪贴板 =====
  const handleCopy = async () => {
    if (!correctedScript) return
    await navigator.clipboard.writeText(correctedScript)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // ===== 工作台：下载 txt（纯文字版） =====
  const handleDownload = () => {
    if (!correctedScript) return
    const blob = new Blob([correctedScript], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${task.title}_修正版.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ===== 工作台：文件原地修改后下载（xlsx/docx 保持原格式） =====
  const [fileFixLoading, setFileFixLoading] = useState(false)
  const handleDownloadFixedFile = async () => {
    const replacements = buildSelectedReplacements()
    if (replacements.length === 0) {
      toast.error('未找到可替换内容，请先勾选修正项或采纳 AI 重写项')
      return
    }
    setFileFixLoading(true)
    try {
      const { blob, modified, replacementCount } = await api.applyFixesToFile(taskId, replacements)
      const ext = task.file.fileName.split('.').pop() || 'bin'
      const baseName = task.file.fileName.replace(/\.[^.]+$/, '')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${baseName}_修正版.${ext}`
      a.click()
      URL.revokeObjectURL(url)
      if (modified) {
        toast.success(`修改后文件已下载（命中替换 ${replacementCount} 处）`)
      } else {
        toast.warning('文件已下载，但未匹配到可替换文本')
      }
    } catch (err: unknown) {
      const message = extractErrorMessage(err)
      toast.error(`文件修改失败: ${message}`)
    } finally {
      setFileFixLoading(false)
    }
  }

  const uploadCorrectedScriptFile = useCallback(async () => {
    if (!task.file.fileUrl) return null

    const replacements = buildSelectedReplacements()
    if (replacements.length === 0) return null

    const { blob, modified } = await api.applyFixesToFile(taskId, replacements)
    if (!modified) return null

    const originalName = task.file.fileName || `${task.title}_脚本`
    const dotIndex = originalName.lastIndexOf('.')
    const baseName = dotIndex >= 0 ? originalName.slice(0, dotIndex) : originalName
    const ext = dotIndex >= 0 ? originalName.slice(dotIndex) : ''
    const correctedName = `${baseName}_修正版${ext}`
    const uploadFile = new File([blob], correctedName, {
      type: blob.type || task.file.fileType || guessScriptMimeType(originalName),
    })
    const uploaded = await api.proxyUpload(uploadFile, 'script')
    return {
      corrected_file_url: uploaded.url,
      corrected_file_name: uploaded.file_name,
      corrected_file_type: uploadFile.type || uploaded.file_type,
    }
  }, [buildSelectedReplacements, task, taskId])

  // ===== 工作台完成度检查 =====
  const getWorkbenchStatus = useCallback(() => {
    const violations: FixCard[] = task.aiAnalysis.violations.map(v => ({
      id: v.id, type: v.type, content: v.content, suggestion: v.suggestion,
      dimension: v.dimension, fixable: v.fixable !== false, severity: v.severity,
    }))
    const aiCards = violations.filter(v => !v.fixable)
    const pendingAI = aiCards.filter(v => rewriteDecision[v.id] == null)
    return { total: violations.length, aiCards: aiCards.length, pendingAI: pendingAI.length }
  }, [task, rewriteDecision])

  const handleApprove = async () => {
    setSubmitting(true)
    try {
      const correctedFilePayload = correctedScript ? await uploadCorrectedScriptFile() : null
      await api.reviewScript(taskId, {
        action: 'pass',
        ...(correctedScript ? { corrected_script: correctedScript } : {}),
        ...(correctedFilePayload || {}),
      })
      setShowApproveModal(false)
      toast.success(
        isOperatorMode
          ? (correctedScript ? '已应用修改并通过脚本审核，进入视频阶段' : '脚本审核已通过，进入视频阶段')
          : (correctedScript ? '已应用修改并提交品牌方终审' : '已提交品牌方终审')
      )
      router.push(reviewListPath)
    } catch (err: unknown) {
      const message = extractErrorMessage(err)
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleReject = async () => {
    if (!canReject(checkedViolations, rejectReason)) {
      toast.error('请勾选问题或填写驳回原因')
      return
    }
    const comment = buildRejectComment(checkedViolations, task.aiAnalysis.violations, rejectReason)
    setSubmitting(true)
    try {
      await api.reviewScript(taskId, { action: 'reject', comment })
      setShowRejectModal(false)
      toast.success('已驳回')
      router.push(reviewListPath)
    } catch (err: unknown) {
      const message = extractErrorMessage(err)
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleForcePass = async () => {
    if (isOperatorMode) {
      return
    }
    if (!forcePassReason.trim()) {
      toast.error('请填写跳过终审原因')
      return
    }
    setSubmitting(true)
    try {
      const correctedFilePayload = correctedScript ? await uploadCorrectedScriptFile() : null
      await api.reviewScript(taskId, {
        action: 'force_pass',
        comment: forcePassReason,
        ...(correctedScript ? { corrected_script: correctedScript } : {}),
        ...(correctedFilePayload || {}),
      })
      setShowForcePassModal(false)
      toast.success('脚本已通过，跳过品牌终审，进入视频拍摄')
      router.push(reviewListPath)
    } catch (err: unknown) {
      const message = extractErrorMessage(err)
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  const isTextOnlyScript = !task.file.fileUrl
  const creativeInsights = extractScriptReviewInsights(task.aiAnalysis.chainOfThought as Record<string, unknown> | undefined)
  const hasCreativeInsights = (
    creativeInsights.audience.length > 0 ||
    creativeInsights.tone.length > 0 ||
    creativeInsights.contentStyle.length > 0 ||
    creativeInsights.structure.length > 0 ||
    creativeInsights.highlights.length > 0 ||
    creativeInsights.suggestions.length > 0 ||
    creativeInsights.qualitySummary ||
    creativeInsights.briefSummary
  )

  const getTextScriptDownloadName = () => {
    const raw = (task.file.fileName || `${task.title}_原始脚本`).trim()
    return /\.[^.]+$/.test(raw) ? raw : `${raw}.txt`
  }

  const downloadTextScript = () => {
    const text = task.scriptTextContent?.trim()
    if (!text) {
      toast.error('脚本文本为空，无法下载')
      return
    }
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = getTextScriptDownloadName()
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleOriginalPreview = () => {
    if (isTextOnlyScript) {
      setShowTextPreview(true)
      return
    }
    if (!task.file.fileUrl) {
      toast.error('原始脚本文件不可预览')
      return
    }
    setShowFilePreview(true)
  }

  const handleOriginalDownload = async () => {
    if (isTextOnlyScript) {
      downloadTextScript()
      return
    }
    if (!task.file.fileUrl) {
      toast.error('原始脚本文件不可下载')
      return
    }
    try {
      await api.downloadFile(task.file.fileUrl, task.file.fileName)
    } catch (err: unknown) {
      const message = extractErrorMessage(err)
      toast.error(message)
    }
  }

  if (loading) {
    return <LoadingSkeleton />
  }

  return (
    <div className="space-y-4">
      {/* 顶部导航 */}
      <div className="flex items-center gap-4">
        <button type="button" onClick={() => router.back()} className="p-2 hover:bg-bg-elevated rounded-full">
          <ArrowLeft size={20} className="text-text-primary" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-text-primary">{task.title}</h1>
            {task.isAppeal && (
              <span className="flex items-center gap-1 px-2 py-1 text-xs bg-accent-amber/20 text-accent-amber rounded-full font-medium">
                <MessageSquareWarning size={12} />
                申诉
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 mt-1 text-sm text-text-secondary">
            <span>{task.creatorName}</span>
            {task.brandName && <span>{task.brandName}</span>}
            {task.platform && <span>{getPlatformInfo(task.platform)?.name || task.platform}</span>}
            <span className="flex items-center gap-1">
              <Clock size={14} />
              {task.submittedAt}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isOperatorMode ? (
            <div className="flex items-center gap-2 rounded-lg bg-accent-indigo/10 px-3 py-2 text-sm font-medium text-accent-indigo">
              <Wrench size={14} />
              修正工作台
            </div>
          ) : (
            <div className="flex items-center gap-1 p-1 bg-bg-elevated rounded-lg">
              <button
                type="button"
                onClick={() => setViewMode('file')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  viewMode === 'file' ? 'bg-bg-card text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                原文件
              </button>
              <button
                type="button"
                onClick={() => setViewMode('parsed')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  viewMode === 'parsed' ? 'bg-bg-card text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                AI解析
              </button>
              <button
                type="button"
                onClick={() => setViewMode('workbench')}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  viewMode === 'workbench' ? 'bg-accent-indigo text-white shadow-sm' : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                <Wrench size={13} />
                修正工作台
              </button>
            </div>
          )}
        </div>
      </div>

      {/* AI 驳回警告横幅 */}
      {task.aiAutoRejected && (
        <div className="p-4 rounded-xl bg-accent-coral/10 border border-accent-coral/40 flex items-start gap-3">
          <XCircle size={20} className="text-accent-coral mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-accent-coral font-semibold text-sm">AI 审核发现严重违规，需人工处理</p>
            {task.aiRejectReason && (
              <p className="text-text-secondary text-sm mt-1">{task.aiRejectReason}</p>
            )}
            <p className="text-text-tertiary text-xs mt-1">请在「修正工作台」中处理违规后提交，或直接驳回给达人修改</p>
          </div>
        </div>
      )}

      {/* 申诉理由 */}
      {task.isAppeal && task.appealReason && (
        <div className="p-4 rounded-xl bg-accent-amber/10 border border-accent-amber/30">
          <p className="text-sm text-accent-amber font-medium mb-1 flex items-center gap-1">
            <MessageSquareWarning size={14} />
            申诉理由
          </p>
          <p className="text-text-secondary">{task.appealReason}</p>
        </div>
      )}

      {/* 审核流程进度条 */}
      <ReviewProgressBar taskStatus={task.status} isOperatorMode={isOperatorMode} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左侧：脚本内容 */}
        <div className="lg:col-span-2 space-y-4">
          {/* 原始提交信息卡片 */}
          {isTextOnlyScript ? (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-bg-elevated">
              <div className="w-12 h-12 rounded-xl bg-bg-page flex items-center justify-center flex-shrink-0">
                <FileText size={22} className="text-accent-indigo" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">{task.file.fileName}</p>
                <p className="text-xs text-text-tertiary">文本脚本 · 无附件文件</p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  type="button"
                  onClick={handleOriginalPreview}
                  className="p-2.5 rounded-lg hover:bg-bg-page transition-colors"
                  title="预览文本"
                >
                  <Eye size={18} className="text-text-secondary" />
                </button>
                <button
                  type="button"
                  onClick={downloadTextScript}
                  className="p-2.5 rounded-lg hover:bg-bg-page transition-colors"
                  title="下载文本"
                >
                  <Download size={18} className="text-text-secondary" />
                </button>
              </div>
            </div>
          ) : (
            <FileInfoCard
              file={task.file}
              onPreview={handleOriginalPreview}
              onDownload={handleOriginalDownload}
            />
          )}

          {viewMode === 'workbench' ? (
            <WorkbenchPanel
              task={task}
              taskId={taskId}
              surgicalChecked={surgicalChecked}
              setSurgicalChecked={setSurgicalChecked}
              surgicalReplacement={surgicalReplacement}
              setSurgicalReplacement={setSurgicalReplacement}
              rewriteExpanded={rewriteExpanded}
              setRewriteExpanded={setRewriteExpanded}
              rewriteLoading={rewriteLoading}
              rewriteDecision={rewriteDecision}
              setRewriteDecision={setRewriteDecision}
              correctedScript={correctedScript}
              setCorrectedScript={setCorrectedScript}
              copied={copied}
              onAIRewrite={handleAIRewrite}
              onGenerate={generateCorrectedScript}
              generating={generating}
              onCopy={handleCopy}
              onDownload={handleDownload}
              onDownloadFixedFile={handleDownloadFixedFile}
              fileFixLoading={fileFixLoading}
              onSubmit={() => setShowApproveModal(true)}
              getWorkbenchStatus={getWorkbenchStatus}
              submitting={submitting}
              approvalLabel={
                isOperatorMode
                  ? (correctedScript ? '应用修改并通过脚本审核 →' : '通过脚本审核 →')
                  : (correctedScript ? '应用修改并提交品牌终审 →' : '提交品牌终审 →')
              }
            />
          ) : viewMode === 'file' ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText size={18} className="text-accent-indigo" />
                  {isTextOnlyScript ? '文本预览' : '文件预览'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isTextOnlyScript ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-text-tertiary">该任务为粘贴文本提交，无原始附件文件</p>
                      <Button variant="secondary" size="sm" onClick={downloadTextScript}>
                        <Download size={14} className="mr-1" />下载 .txt
                      </Button>
                    </div>
                    <pre className="text-sm text-text-primary whitespace-pre-wrap break-words bg-bg-elevated border border-border-subtle rounded-lg p-3 max-h-[560px] overflow-auto">
                      {task.scriptTextContent || '暂无文本内容'}
                    </pre>
                  </div>
                ) : task.file.fileUrl ? (
                  <FilePreview file={task.file} />
                ) : (
                  <p className="text-sm text-text-tertiary text-center py-8">暂无文件</p>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText size={18} className="text-accent-indigo" />
                  AI 审核分析
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {task.aiSummary ? (
                  <div className="p-4 bg-bg-elevated rounded-lg">
                    <div className="text-xs text-accent-indigo font-medium mb-2">AI 总结</div>
                    <p className="text-text-primary">{task.aiSummary}</p>
                  </div>
                ) : (
                  <p className="text-sm text-text-tertiary text-center py-4">暂无 AI 分析总结</p>
                )}
                {task.aiAnalysis.violations.length > 0 && (
                  <div className="p-4 bg-bg-elevated rounded-lg">
                    <div className="text-xs text-accent-coral font-medium mb-2">发现问题 ({task.aiAnalysis.violations.length})</div>
                    <div className="space-y-2">
                      {task.aiAnalysis.violations.map((v) => (
                        <div key={v.id} className="text-sm">
                          <span className="text-accent-coral font-medium">[{getViolationTypeLabel(v.type)}]</span>
                          <span className="text-text-primary ml-1">{v.content}</span>
                          <p className="text-xs text-accent-indigo mt-0.5">{v.suggestion}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {!isOperatorMode && task.aiAnalysis.sellingPointMatches.length > 0 && (
                  <div className="p-4 bg-bg-elevated rounded-lg">
                    <div className="text-xs text-accent-green font-medium mb-2">卖点匹配概览</div>
                    <div className="space-y-1">
                      {task.aiAnalysis.sellingPointMatches.map((sp: { content: string; priority: string; matched: boolean; evidence?: string }, idx: number) => (
                        <div key={idx} className="flex items-center gap-2 text-sm">
                          {sp.matched ? <CheckCircle size={14} className="text-accent-green flex-shrink-0" /> : <XCircle size={14} className="text-accent-coral flex-shrink-0" />}
                          <span className="text-text-primary">{sp.content}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            sp.priority === 'core' ? 'bg-accent-coral/20 text-accent-coral' :
                            sp.priority === 'recommended' ? 'bg-accent-amber/20 text-accent-amber' :
                            'bg-bg-page text-text-tertiary'
                          }`}>{sp.priority === 'core' ? '核心' : sp.priority === 'recommended' ? '推荐' : '参考'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {!isOperatorMode && task.aiAnalysis.brandExposure && (
                  <div className="p-4 bg-bg-elevated rounded-lg">
                    <div className="text-xs text-accent-indigo font-medium mb-2">品牌曝光评估</div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
                      <div>
                        <p className="text-[11px] text-text-tertiary">曝光评分</p>
                        <p className="text-sm font-semibold text-text-primary">{task.aiAnalysis.brandExposure.score ?? '--'}</p>
                      </div>
                      <div>
                        <p className="text-[11px] text-text-tertiary">曝光等级</p>
                        <p className="text-sm font-semibold text-text-primary">{task.aiAnalysis.brandExposure.level || '--'}</p>
                      </div>
                      <div>
                        <p className="text-[11px] text-text-tertiary">品牌相关时长</p>
                        <p className="text-sm font-semibold text-text-primary">{task.aiAnalysis.brandExposure.related_duration_seconds ?? '--'} 秒</p>
                      </div>
                    </div>
                    {task.aiAnalysis.brandExposure.analysis && (
                      <p className="text-sm text-text-secondary">{task.aiAnalysis.brandExposure.analysis}</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* 右侧：AI 分析面板 */}
        <div className="space-y-4">
          {/* AI 评分 */}
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">AI 综合评分</span>
                <span className={`text-3xl font-bold ${task.aiScore >= 85 ? 'text-accent-green' : task.aiScore >= 70 ? 'text-yellow-400' : 'text-accent-coral'}`}>
                  {task.aiScore}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* 维度评分 */}
          {task.aiAnalysis.dimensions && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Shield size={16} className="text-accent-indigo" />
                  维度评分
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(['legal', 'platform', 'brand_safety', 'brief_match', 'content_quality'] as const).map(key => {
                  const dim = (task.aiAnalysis.dimensions as unknown as Record<string, { score: number; passed: boolean; issue_count: number }>)?.[key]
                  if (!dim) return null
                  const label = { legal: '法规合规', platform: '平台规则', brand_safety: '品牌安全', brief_match: 'Brief匹配', content_quality: '内容质量' }[key]
                  const dimSummary = getDimensionSummary(task.aiAnalysis.chainOfThought as Record<string, unknown> | undefined, key)
                  return (
                    <div key={key} className={`p-2 rounded-lg ${dim.passed ? 'bg-accent-green/5' : 'bg-accent-coral/5'}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-text-primary">{label}</span>
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-bold ${dim.passed ? 'text-accent-green' : 'text-accent-coral'}`}>{dim.score}</span>
                          {dim.passed ? <CheckCircle size={14} className="text-accent-green" /> : <XCircle size={14} className="text-accent-coral" />}
                        </div>
                      </div>
                      {dimSummary && <p className="text-xs text-text-tertiary mt-1 line-clamp-2">{dimSummary}</p>}
                    </div>
                  )
                })}
                {task.aiAnalysis.viralPotential && (
                  <div className="flex items-center justify-between p-2 rounded-lg bg-accent-indigo/5">
                    <span className="text-sm text-text-primary">爆款潜力</span>
                    <span className={`text-sm font-medium ${task.aiAnalysis.viralPotential === 'high' ? 'text-accent-green' : task.aiAnalysis.viralPotential === 'medium' ? 'text-accent-amber' : 'text-text-tertiary'}`}>
                      {task.aiAnalysis.viralPotential === 'high' ? '高' : task.aiAnalysis.viralPotential === 'medium' ? '中' : '低'}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {hasCreativeInsights && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Eye size={16} className="text-accent-indigo" />
                  创意洞察
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {creativeInsights.briefSummary && (
                  <div className="p-3 rounded-lg bg-bg-elevated">
                    <div className="text-xs text-accent-indigo font-medium mb-1">Brief 判断</div>
                    <p className="text-sm text-text-secondary">{creativeInsights.briefSummary}</p>
                  </div>
                )}
                {creativeInsights.qualitySummary && (
                  <div className="p-3 rounded-lg bg-bg-elevated">
                    <div className="text-xs text-accent-indigo font-medium mb-1">内容质量判断</div>
                    <p className="text-sm text-text-secondary">{creativeInsights.qualitySummary}</p>
                  </div>
                )}
                {creativeInsights.audience.length > 0 && (
                  <div className="p-3 rounded-lg bg-bg-elevated">
                    <div className="text-xs text-accent-green font-medium mb-2">受众匹配</div>
                    <div className="space-y-2">
                      {creativeInsights.audience.map((item, idx) => (
                        <div key={`${item.criterion}-${idx}`} className="text-sm">
                          <p className="text-text-primary">{item.criterion || '受众判断'}</p>
                          <p className="text-xs text-text-tertiary mt-0.5">{item.detail}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {creativeInsights.tone.length > 0 && (
                  <div className="p-3 rounded-lg bg-bg-elevated">
                    <div className="text-xs text-accent-amber font-medium mb-2">表达接受度</div>
                    <div className="space-y-2">
                      {creativeInsights.tone.map((item, idx) => (
                        <div key={`${item.criterion}-${idx}`} className="text-sm">
                          <p className="text-text-primary">{item.criterion || '表达方式'}</p>
                          <p className="text-xs text-text-tertiary mt-0.5">{item.detail}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {creativeInsights.contentStyle.length > 0 && (
                  <div className="p-3 rounded-lg bg-bg-elevated">
                    <div className="text-xs text-accent-indigo font-medium mb-2">内容风格</div>
                    <div className="space-y-2">
                      {creativeInsights.contentStyle.map((item, idx) => (
                        <div key={`${item.criterion}-${idx}`} className="text-sm">
                          <p className="text-text-primary">{item.criterion || '风格判断'}</p>
                          <p className="text-xs text-text-tertiary mt-0.5">{item.detail}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {creativeInsights.structure.length > 0 && (
                  <div className="p-3 rounded-lg bg-bg-elevated">
                    <div className="text-xs text-accent-indigo font-medium mb-2">结构与钩子</div>
                    <div className="space-y-2">
                      {creativeInsights.structure.map((item, idx) => (
                        <div key={`${item.criterion}-${idx}`} className="text-sm">
                          <p className="text-text-primary">{item.criterion || '结构判断'}</p>
                          <p className="text-xs text-text-tertiary mt-0.5">{item.detail}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {creativeInsights.highlights.length > 0 && (
                  <div className="p-3 rounded-lg bg-bg-elevated">
                    <div className="text-xs text-accent-green font-medium mb-2">创意亮点</div>
                    <div className="space-y-1">
                      {creativeInsights.highlights.map((item, idx) => (
                        <p key={idx} className="text-sm text-text-secondary">- {item}</p>
                      ))}
                    </div>
                  </div>
                )}
                {creativeInsights.suggestions.length > 0 && (
                  <div className="p-3 rounded-lg bg-bg-elevated">
                    <div className="text-xs text-accent-amber font-medium mb-2">优化建议</div>
                    <div className="space-y-1">
                      {creativeInsights.suggestions.map((item, idx) => (
                        <p key={idx} className="text-sm text-text-secondary">- {item}</p>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* 违规检测 */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle size={16} className="text-orange-500" />
                违规检测 ({task.aiAnalysis.violations.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {task.aiAnalysis.violations.map((v) => (
                <div key={v.id} className={`p-3 rounded-lg border ${checkedViolations[v.id] ? 'bg-bg-elevated border-border-subtle' : 'bg-orange-500/10 border-orange-500/30'}`}>
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={checkedViolations[v.id] || false}
                      onChange={() => setCheckedViolations((prev) => ({ ...prev, [v.id]: !prev[v.id] }))}
                      className="mt-1 accent-accent-indigo"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <WarningTag>{getViolationTypeLabel(v.type)}</WarningTag>
                        {v.dimension && <span className="text-xs text-text-tertiary">{{ legal: '法规合规', platform: '平台规则', brand_safety: '品牌安全', brief_match: 'Brief匹配', content_quality: '内容质量', '法规合规': '法规合规', '平台规则': '平台规则', '品牌安全': '品牌安全', 'Brief匹配': 'Brief匹配', '内容质量': '内容质量' }[v.dimension as string] || v.dimension}</span>}
                      </div>
                      <p className="text-sm text-text-primary">{v.content}</p>
                      <p className="text-xs text-accent-indigo mt-1">{v.suggestion}</p>
                    </div>
                  </div>
                </div>
              ))}
              {task.aiAnalysis.violations.length === 0 && (
                <p className="text-sm text-text-tertiary text-center py-4">未发现违规内容</p>
              )}
            </CardContent>
          </Card>

          {/* 舆情提示 */}
          {task.aiAnalysis.complianceChecks.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle size={16} className="text-orange-500" />
                  舆情提示（仅参考）
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {task.aiAnalysis.complianceChecks.map((check, idx) => (
                  <div key={idx} className="p-3 bg-orange-500/10 rounded-lg border border-orange-500/30">
                    <div className="flex items-center gap-2 mb-1">
                      <WarningTag>{check.item}</WarningTag>
                    </div>
                    {check.note && (
                      <p className="text-sm text-text-secondary">{check.note}</p>
                    )}
                    <p className="text-xs text-text-tertiary mt-1">软性风险仅作提示，不影响审核结果</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* 卖点匹配 */}
          {!isOperatorMode && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <CheckCircle size={16} className="text-accent-green" />
                卖点匹配
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {task.aiAnalysis.sellingPointMatches && task.aiAnalysis.sellingPointMatches.length > 0 ? (
                task.aiAnalysis.sellingPointMatches.map((sp: { content: string; priority: string; matched: boolean; evidence?: string }, idx: number) => (
                  <div key={idx} className="flex items-start gap-2 p-2 rounded-lg bg-bg-elevated">
                    {sp.matched ? <CheckCircle size={16} className="text-accent-green flex-shrink-0 mt-0.5" /> : <XCircle size={16} className="text-accent-coral flex-shrink-0 mt-0.5" />}
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-text-primary">{sp.content}</span>
                        <span className={`px-1.5 py-0.5 text-xs rounded ${
                          sp.priority === 'core' ? 'bg-accent-coral/20 text-accent-coral' :
                          sp.priority === 'recommended' ? 'bg-accent-amber/20 text-accent-amber' :
                          'bg-bg-page text-text-tertiary'
                        }`}>{sp.priority === 'core' ? '核心' : sp.priority === 'recommended' ? '推荐' : '参考'}</span>
                      </div>
                      {sp.evidence && <p className="text-xs text-text-tertiary mt-0.5">{sp.evidence}</p>}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-text-tertiary text-center py-4">暂无卖点数据</p>
              )}
            </CardContent>
          </Card>
          )}

          {!isOperatorMode && task.aiAnalysis.brandExposure && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Eye size={16} className="text-accent-indigo" />
                  品牌曝光
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 rounded-lg bg-bg-elevated">
                    <div className="text-xs text-text-tertiary">评分</div>
                    <div className="text-sm font-semibold text-text-primary">{task.aiAnalysis.brandExposure.score ?? '--'}</div>
                  </div>
                  <div className="p-2 rounded-lg bg-bg-elevated">
                    <div className="text-xs text-text-tertiary">等级</div>
                    <div className="text-sm font-semibold text-text-primary">{task.aiAnalysis.brandExposure.level || '--'}</div>
                  </div>
                  <div className="p-2 rounded-lg bg-bg-elevated">
                    <div className="text-xs text-text-tertiary">相关时长</div>
                    <div className="text-sm font-semibold text-text-primary">{task.aiAnalysis.brandExposure.related_duration_seconds ?? '--'} 秒</div>
                  </div>
                </div>
                {task.aiAnalysis.brandExposure.analysis && (
                  <p className="text-sm text-text-secondary">{task.aiAnalysis.brandExposure.analysis}</p>
                )}
                {!!task.aiAnalysis.brandExposure.evidence?.length && (
                  <div className="space-y-1">
                    {task.aiAnalysis.brandExposure.evidence.map((item, idx) => (
                      <p key={idx} className="text-xs text-text-tertiary">- {item}</p>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* 底部决策栏 */}
      <Card className="sticky bottom-4 shadow-lg">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-text-secondary">
              {task.brandName && <span>{task.brandName} · </span>}
              {task.projectName}
              {task.platform && <span> · {getPlatformInfo(task.platform)?.name || task.platform}</span>}
            </div>
            <div className="flex gap-3">
              <Button variant="danger" onClick={() => setShowRejectModal(true)} disabled={submitting}>
                {submitting ? <Loader2 size={16} className="animate-spin mr-1" /> : null}
                驳回
              </Button>
              {!isOperatorMode && (
                <div className="flex flex-col items-center gap-1">
                  <Button variant="secondary" onClick={() => setShowForcePassModal(true)} disabled={submitting}>
                    {submitting ? <Loader2 size={16} className="animate-spin mr-1" /> : null}
                    通过并跳过终审
                  </Button>
                  <span className="text-[11px] text-text-tertiary">跳过品牌方终审，直接拍视频</span>
                </div>
              )}
              <Button variant="success" onClick={() => setShowApproveModal(true)} disabled={submitting}>
                {submitting ? <Loader2 size={16} className="animate-spin mr-1" /> : null}
                通过
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 通过确认弹窗 */}
      <ConfirmModal
        isOpen={showApproveModal}
        onClose={() => setShowApproveModal(false)}
        onConfirm={handleApprove}
        title="确认通过"
        message={isOperatorMode ? '确定通过此脚本审核吗？通过后将直接进入视频阶段。' : '确定要通过此脚本的审核吗？通过后将提交给品牌方进行终审。'}
        confirmText="确认通过"
      />

      {/* 驳回弹窗 */}
      <Modal isOpen={showRejectModal} onClose={() => setShowRejectModal(false)} title="驳回审核">
        <div className="space-y-4">
          <p className="text-text-secondary text-sm">请勾选问题或填写补充说明，已勾选的问题将自动打包发送给达人。</p>
          <div className="p-3 bg-bg-elevated rounded-lg">
            <p className="text-sm font-medium text-text-primary mb-2">已选问题 ({Object.values(checkedViolations).filter(Boolean).length})</p>
            {task.aiAnalysis.violations.filter(v => checkedViolations[v.id]).map(v => (
              <div key={v.id} className="text-sm text-text-secondary">* {getViolationTypeLabel(v.type)}: {v.content}</div>
            ))}
            {Object.values(checkedViolations).filter(Boolean).length === 0 && (
              <div className="text-sm text-text-tertiary">未选择任何问题</div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">补充说明</label>
            <textarea
              className="w-full h-24 p-3 border border-border-subtle rounded-lg resize-none bg-bg-elevated text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-indigo"
              placeholder="请详细说明驳回原因..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </div>
          <div className="flex gap-3 justify-end">
            <Button variant="ghost" onClick={() => setShowRejectModal(false)} disabled={submitting}>取消</Button>
            <Button variant="danger" onClick={handleReject} disabled={submitting}>
              {submitting ? <Loader2 size={16} className="animate-spin mr-1" /> : null}
              确认驳回
            </Button>
          </div>
        </div>
      </Modal>

      {/* 跳过品牌终审弹窗 */}
      <Modal isOpen={!isOperatorMode && showForcePassModal} onClose={() => setShowForcePassModal(false)} title="通过并跳过品牌终审">
        <div className="space-y-4">
          <div className="p-3 bg-accent-indigo/10 rounded-lg border border-accent-indigo/30">
            <p className="text-sm text-accent-indigo">
              <AlertTriangle size={14} className="inline mr-1" />
              脚本将直接进入视频拍摄阶段，品牌方仍可查看脚本和进度但无需审核
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">跳过终审原因（必填）</label>
            <textarea
              className="w-full h-24 p-3 border border-border-subtle rounded-lg resize-none bg-bg-elevated text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-indigo"
              placeholder="例如：紧急项目，脚本已与品牌方线下沟通确认"
              value={forcePassReason}
              onChange={(e) => setForcePassReason(e.target.value)}
            />
          </div>
          <div className="flex gap-3 justify-end">
            <Button variant="ghost" onClick={() => setShowForcePassModal(false)} disabled={submitting}>取消</Button>
            <Button onClick={handleForcePass} disabled={submitting}>
              {submitting ? <Loader2 size={16} className="animate-spin mr-1" /> : null}
              确认跳过终审
            </Button>
          </div>
        </div>
      </Modal>

      {/* 文件预览弹窗 */}
      <FilePreviewModal
        file={task.file.fileUrl ? task.file : null}
        isOpen={showFilePreview}
        onClose={() => setShowFilePreview(false)}
      />

      <Modal
        isOpen={showTextPreview}
        onClose={() => setShowTextPreview(false)}
        title={task.file.fileName || '原始脚本'}
        size="xl"
      >
        <div className="space-y-4">
          <div className="max-h-[560px] overflow-auto rounded-lg border border-border-subtle bg-bg-elevated p-4">
            <pre className="text-sm text-text-primary whitespace-pre-wrap break-words">
              {task.scriptTextContent || '暂无文本内容'}
            </pre>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowTextPreview(false)}>关闭</Button>
            <Button onClick={downloadTextScript}>
              <Download size={16} className="mr-1" />
              下载 .txt
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
