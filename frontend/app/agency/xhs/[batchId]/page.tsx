'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, usePathname } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { SuccessTag, PendingTag, WarningTag, ErrorTag } from '@/components/ui/Tag'
import { api, extractErrorMessage } from '@/lib/api'
import { getXHSBatchDisplayMetrics } from '@/lib/xhsBatchMetrics'
import { getXHSCategoryLabel } from '@/lib/xhsCategories'
import { useSSE } from '@/contexts/SSEContext'
import type { XHSBatchItem, XHSBatchJob, XHSExportLog, XHSFeishuExportStatusResponse } from '@/types/xhs'
import { AlertTriangle, ArrowLeft, Copy, Download, Loader2, RefreshCw, RotateCcw, Send, Sparkles, Play } from 'lucide-react'

type DiffLine = {
  left: string
  right: string
  kind: 'same' | 'changed' | 'added' | 'removed'
}

const batchStatusLabels: Record<string, string> = {
  pending: '待开始',
  splitting: '切分中',
  queued: '排队中',
  running: '运行中',
  awaiting_decision: '待决策',
  needs_decision: '待你决定',
  partially_done: '部分完成',
  completed: '已完成',
  done: '已完成',
  failed: '失败',
  blocked: '已阻断',
  cancelled: '已取消',
  exporting: '导出中',
  exported: '已导出',
}

const runModeLabels: Record<string, string> = {
  trial: '试跑',
  full: '全量',
}

const inputTypeLabels: Record<string, string> = {
  text: '粘贴文本',
  file: '文档文件',
  feishu_link: '飞书链接',
}

const splitStrategyLabels: Record<string, string> = {
  rule: '规则切分',
  ai_assisted: '智能辅助切分',
  non_text_single_input: '单条输入，无需切分',
  empty: '无可切分内容',
  unknown: '未识别',
}

const exportTypeLabels: Record<string, string> = {
  all_md: '汇总文档',
  feishu: '飞书文档',
}

const safeRewriteReasonLabels: Record<string, string> = {
  max_rounds_exceeded: '多轮改写后仍未通过，系统改用安全版文案',
}

const parseSkippedReasonLabels: Record<string, string> = {
  unsupported_extension: '文件格式暂不支持解析',
  empty_extracted_text: '文件里没有提取到可用文字',
  insufficient_feishu_text: '飞书内容过少，无法自动解析',
}

function labelForStatus(status: string) {
  return batchStatusLabels[status] || status
}

function labelForRunMode(runMode: string) {
  return runModeLabels[runMode] || runMode
}

function labelForInputType(inputType: string) {
  return inputTypeLabels[inputType] || inputType
}

function labelForSplitStrategy(splitStrategy?: string | null) {
  if (!splitStrategy) return '未识别'
  return splitStrategyLabels[splitStrategy] || splitStrategy
}

function labelForExportType(type: string) {
  return exportTypeLabels[type] || type
}

function labelForSafeRewriteReason(reason?: string | null) {
  if (!reason) return ''
  return safeRewriteReasonLabels[reason] || reason
}

function labelForParseSkippedReason(reason?: string | null) {
  if (!reason) return '直接输入'
  return parseSkippedReasonLabels[reason] || reason
}

function resultLabel(item: XHSBatchItem) {
  if (item.decision_required) {
    return '候选改写稿（待你决定）'
  }
  if (item.verifier_pass === true) {
    return item.safe_rewrite_used ? '兜底终稿' : '终稿'
  }
  if (item.safe_rewrite_used) {
    return '最后兜底稿（未通过）'
  }
  return '最后改写稿（未通过）'
}

function resultDiffLabel(item: XHSBatchItem) {
  if (item.decision_required) {
    return '原文 / 候选改写稿差分'
  }
  if (item.verifier_pass === true) {
    return item.safe_rewrite_used ? '原文 / 兜底终稿差分' : '原文 / 终稿差分'
  }
  if (item.safe_rewrite_used) {
    return '原文 / 最后兜底稿差分'
  }
  return '原文 / 最后改写稿差分'
}

function copyResultLabel(item: XHSBatchItem) {
  if (item.decision_required) {
    return '复制候选改写稿'
  }
  if (item.verifier_pass === true) {
    return item.safe_rewrite_used ? '复制兜底终稿' : '复制终稿'
  }
  if (item.safe_rewrite_used) {
    return '复制最后兜底稿'
  }
  return '复制最后改写稿'
}

function statusTag(status: string) {
  const label = labelForStatus(status)
  if (['completed', 'done', 'exported'].includes(status)) return <SuccessTag size="sm">{label}</SuccessTag>
  if (['failed', 'blocked', 'cancelled'].includes(status)) return <ErrorTag size="sm">{label}</ErrorTag>
  if (['queued', 'running', 'exporting', 'splitting', 'awaiting_decision', 'needs_decision'].includes(status)) return <WarningTag size="sm">{label}</WarningTag>
  return <PendingTag size="sm">{label}</PendingTag>
}

function displayBatchStatus(batch: XHSBatchJob) {
  if (batch.decision_items > 0 && ['partially_done', 'done', 'completed'].includes(batch.status)) {
    return 'awaiting_decision'
  }
  return batch.status
}

function riskSummary(item: XHSBatchItem) {
  const verifier = item.verifier || {}
  const summary = typeof verifier.summary === 'string' ? verifier.summary : null
  const group = typeof verifier.group === 'string' ? verifier.group : null
  const severity = typeof verifier.severity === 'string' ? verifier.severity : null
  return [group, severity, summary].filter(Boolean).join(' · ')
}

function selectedDecisionOption(item: XHSBatchItem) {
  return item.decision_options.find((option) => option.id === item.selected_decision_option_id) || null
}

function splitLines(text: string | null | undefined) {
  return (text || '').split('\n').map((line) => line.trimEnd())
}

function buildDiffLines(source: string | null | undefined, target: string | null | undefined): DiffLine[] {
  const left = splitLines(source)
  const right = splitLines(target)
  const dp = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0))

  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      dp[i][j] = left[i] === right[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const lines: DiffLine[] = []
  let i = 0
  let j = 0

  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      lines.push({ left: left[i], right: right[j], kind: 'same' })
      i += 1
      j += 1
      continue
    }

    if (dp[i + 1][j] === dp[i][j + 1]) {
      lines.push({ left: left[i], right: right[j], kind: 'changed' })
      i += 1
      j += 1
      continue
    }

    if (dp[i + 1][j] > dp[i][j + 1]) {
      lines.push({ left: left[i], right: '', kind: 'removed' })
      i += 1
      continue
    }

    lines.push({ left: '', right: right[j], kind: 'added' })
    j += 1
  }

  while (i < left.length) {
    lines.push({ left: left[i], right: '', kind: 'removed' })
    i += 1
  }

  while (j < right.length) {
    lines.push({ left: '', right: right[j], kind: 'added' })
    j += 1
  }

  return lines
}

function diffCellClass(kind: DiffLine['kind'], side: 'left' | 'right') {
  if (kind === 'same') return 'bg-bg-card text-text-secondary'
  if (kind === 'changed') return 'bg-accent-amber/10 text-text-primary border-accent-amber/20'
  if (kind === 'removed') return side === 'left' ? 'bg-accent-coral/10 text-text-primary border-accent-coral/20' : 'bg-bg-card text-text-tertiary'
  return side === 'right' ? 'bg-accent-green/10 text-text-primary border-accent-green/20' : 'bg-bg-card text-text-tertiary'
}

export default function AgencyXHSBatchDetailPage() {
  const params = useParams<{ batchId: string }>()
  const pathname = usePathname() || ''
  const scopeRoot = pathname.startsWith('/operator') ? '/operator' : '/agency'
  const xhsBasePath = `${scopeRoot}/xhs`
  const batchId = params.batchId
  const { subscribe } = useSSE()
  const [batch, setBatch] = useState<XHSBatchJob | null>(null)
  const [items, setItems] = useState<XHSBatchItem[]>([])
  const [exports, setExports] = useState<XHSExportLog[]>([])
  const [feishuStatus, setFeishuStatus] = useState<XHSFeishuExportStatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [starting, setStarting] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [promoting, setPromoting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [decisionSubmittingId, setDecisionSubmittingId] = useState<string | null>(null)
  const [queryInput, setQueryInput] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [statusInput, setStatusInput] = useState('all')
  const [appliedStatus, setAppliedStatus] = useState('all')
  const [expandedDiffId, setExpandedDiffId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true)
    try {
      const [batchData, itemData, exportData, feishuData] = await Promise.all([
        api.getXHSBatch(batchId),
        api.listXHSBatchItems(batchId, {
          page: 1,
          page_size: 100,
          q: appliedQuery || undefined,
          status: appliedStatus === 'all' ? undefined : appliedStatus,
        }),
        api.listXHSBatchExports(batchId),
        api.getXHSBatchFeishuStatus(batchId).catch(() => null),
      ])
      setBatch(batchData)
      setItems(itemData.items)
      setExports(exportData)
      setFeishuStatus(feishuData)
      setError(null)
    } catch (err) {
      setError(extractErrorMessage(err))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [batchId, appliedQuery, appliedStatus])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    if (!batch) return
    if (!['queued', 'running', 'exporting'].includes(batch.status)) return
    const timer = window.setInterval(() => { loadData(true) }, 5000)
    return () => window.clearInterval(timer)
  }, [batch, loadData])

  useEffect(() => {
    const offProgress = subscribe('xhs_batch_progress', (data) => {
      if (String(data.batch_id) === batchId) loadData(true)
    })
    const offDone = subscribe('xhs_batch_completed', (data) => {
      if (String(data.batch_id) === batchId) loadData(true)
    })
    const offFailed = subscribe('xhs_batch_failed', (data) => {
      if (String(data.batch_id) === batchId) loadData(true)
    })
    const offStart = subscribe('xhs_batch_started', (data) => {
      if (String(data.batch_id) === batchId) loadData(true)
    })
    return () => {
      offProgress()
      offDone()
      offFailed()
      offStart()
    }
  }, [batchId, loadData, subscribe])

  const handleStart = useCallback(async () => {
    setStarting(true)
    try {
      await api.startXHSBatch(batchId)
      await loadData(true)
    } catch (err) {
      setError(extractErrorMessage(err))
    } finally {
      setStarting(false)
    }
  }, [batchId, loadData])

  const handleRetry = useCallback(async () => {
    setRetrying(true)
    try {
      await api.retryXHSBatch(batchId)
      await loadData(true)
    } catch (err) {
      setError(extractErrorMessage(err))
    } finally {
      setRetrying(false)
    }
  }, [batchId, loadData])

  const handlePromote = useCallback(async () => {
    setPromoting(true)
    try {
      const nextBatch = await api.promoteXHSBatch(batchId)
      window.location.href = `${xhsBasePath}/${nextBatch.id}`
    } catch (err) {
      setError(extractErrorMessage(err))
    } finally {
      setPromoting(false)
    }
  }, [batchId, xhsBasePath])

  const handleSubmitDecision = useCallback(async (itemId: string, optionId: string) => {
    setDecisionSubmittingId(`${itemId}:${optionId}`)
    try {
      await api.submitXHSBatchItemDecision(batchId, itemId, optionId)
      await loadData(true)
    } catch (err) {
      setError(extractErrorMessage(err))
    } finally {
      setDecisionSubmittingId(null)
    }
  }, [batchId, loadData])

  const handleExportMarkdown = useCallback(async () => {
    try {
      const blob = await api.exportXHSBatchAllMarkdown(batchId)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${batchId}_all.md`
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      URL.revokeObjectURL(url)
      await loadData(true)
    } catch (err) {
      setError(extractErrorMessage(err))
    }
  }, [batchId, loadData])

  const handleExportFeishu = useCallback(async () => {
    setExporting(true)
    try {
      await api.exportXHSBatchFeishu(batchId)
      await loadData(true)
    } catch (err) {
      setError(extractErrorMessage(err))
    } finally {
      setExporting(false)
    }
  }, [batchId, loadData])

  const batchMetrics = useMemo(() => {
    if (!batch) {
      return {
        plannedItems: 0,
        processedItems: 0,
        passedItems: 0,
        failedItems: 0,
        decisionItems: 0,
        runningItems: 0,
        waitingItems: 0,
        progress: 0,
      }
    }
    return getXHSBatchDisplayMetrics(batch)
  }, [batch])

  const handleApplyFilters = useCallback(() => {
    const nextQuery = queryInput.trim()
    const nextStatus = statusInput

    if (nextQuery === appliedQuery && nextStatus === appliedStatus) {
      void loadData()
      return
    }

    setAppliedQuery(nextQuery)
    setAppliedStatus(nextStatus)
  }, [appliedQuery, appliedStatus, loadData, queryInput, statusInput])

  if (loading && !batch) {
    return (
      <div className="py-24 flex items-center justify-center text-text-tertiary">
        <Loader2 size={18} className="animate-spin mr-2" />
        加载批次详情
      </div>
    )
  }

  if (!batch) return <div className="text-text-tertiary">批次不存在</div>

  return (
    <div className="space-y-6 min-h-0 pb-20 max-w-[1440px] mx-auto">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <Link href={xhsBasePath} className="inline-flex items-center gap-2 text-sm text-text-tertiary hover:text-text-primary">
            <ArrowLeft size={14} />
            返回批次列表
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-black tracking-tighter text-text-primary">{batch.id}</h1>
            {statusTag(displayBatchStatus(batch))}
          </div>
          <div className="text-sm text-text-tertiary">
            {getXHSCategoryLabel(batch.category_id)} · {labelForRunMode(batch.run_mode)} · {labelForInputType(batch.input_type)} · 计划 {batchMetrics.plannedItems} / 共 {batch.total_items}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" icon={RefreshCw} loading={refreshing} onClick={() => loadData()}>
            刷新
          </Button>
          <Button variant="secondary" icon={Play} loading={starting} onClick={handleStart} disabled={!['pending', 'failed'].includes(batch.status)}>
            启动
          </Button>
          <Button variant="secondary" icon={RotateCcw} loading={retrying} onClick={handleRetry} disabled={batch.failed_items === 0}>
            重试失败项
          </Button>
          <Button icon={Sparkles} loading={promoting} onClick={handlePromote} disabled={batch.run_mode !== 'trial'}>
            试跑转全量
          </Button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-2xl border border-accent-coral/20 bg-accent-coral/10 text-sm text-accent-coral">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-7 gap-4">
        {[
          ['处理进度', `${batchMetrics.progress}%`],
          ['已处理', `${batchMetrics.processedItems}/${batchMetrics.plannedItems}`],
          ['通过', String(batchMetrics.passedItems)],
          ['待决定', String(batchMetrics.decisionItems)],
          ['失败', String(batchMetrics.failedItems)],
          ['进行中', String(batchMetrics.runningItems)],
          ['兜底改写', String(batch.safe_rewrite_items)],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardContent className="py-5">
              <div className="text-xs uppercase tracking-[0.18em] text-text-tertiary">{label}</div>
              <div className="mt-2 text-2xl font-black text-text-primary tracking-tighter">{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="text-sm text-text-tertiary">
        已处理 = 通过 + 待决定 + 失败；待决定表示规则之间有冲突，需要你先选一个优先级，系统再继续生成终稿。
      </div>

      <Card>
        <CardHeader>
          <CardTitle>运行摘要</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="h-2 rounded-full bg-bg-elevated overflow-hidden">
            <div className="h-full bg-gradient-to-r from-accent-indigo to-accent-green" style={{ width: `${batchMetrics.progress}%` }} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 text-sm">
            <div>
              <div className="text-text-tertiary">切分策略</div>
              <div className="font-bold text-text-primary">{labelForSplitStrategy(batch.input_stats.split_strategy)}</div>
            </div>
            <div>
              <div className="text-text-tertiary">输入来源</div>
              <div className="font-bold text-text-primary break-all">{batch.input_stats.source_file_name || batch.input_stats.source_ref || '-'}</div>
            </div>
            <div>
              <div className="text-text-tertiary">解析状态</div>
              <div className="font-bold text-text-primary">
                {batch.input_stats.parsed_from_file ? '文件已解析' : batch.input_stats.parsed_from_feishu ? '飞书已解析' : labelForParseSkippedReason(batch.input_stats.parse_skipped_reason)}
              </div>
            </div>
            <div>
              <div className="text-text-tertiary">原始字符数</div>
              <div className="font-bold text-text-primary">{batch.input_stats.raw_chars}</div>
            </div>
            <div>
              <div className="text-text-tertiary">预计消耗</div>
              <div className="font-bold text-text-primary">{batch.estimated_tokens ?? 0}</div>
            </div>
          </div>
          <div className="rounded-2xl border border-border-subtle bg-bg-elevated/30 p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-text-tertiary">使用配置</div>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-text-tertiary">规则包</div>
                <div className="font-bold text-text-primary">{batch.rule_pack_version || '未指定'}</div>
              </div>
              <div>
                <div className="text-text-tertiary">品牌包</div>
                <div className="font-bold text-text-primary">{batch.brand_pack_version || '未指定'}</div>
              </div>
              <div>
                <div className="text-text-tertiary">简报包</div>
                <div className="font-bold text-text-primary break-all">{batch.brief_pack_id || '未指定'}</div>
              </div>
              <div>
                <div className="text-text-tertiary">风险包</div>
                <div className="font-bold text-text-primary">{batch.risk_pack_version || '未指定'}</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-8 space-y-4">
          <Card>
            <CardHeader className="flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <CardTitle>条目明细</CardTitle>
              <div className="flex flex-col md:flex-row gap-2 w-full md:w-auto">
                <input
                  value={queryInput}
                  onChange={(e) => setQueryInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleApplyFilters()
                    }
                  }}
                  placeholder="搜索标题或正文"
                  className="rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2 text-sm text-text-primary"
                />
                <select
                  value={statusInput}
                  onChange={(e) => setStatusInput(e.target.value)}
                  className="rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2 text-sm text-text-primary"
                >
                  <option value="all">全部状态</option>
                  <option value="completed">已完成</option>
                  <option value="needs_decision">待决定</option>
                  <option value="failed">失败</option>
                  <option value="pending">待开始</option>
                  <option value="running">运行中</option>
                </select>
                <Button variant="secondary" onClick={handleApplyFilters}>查询</Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {items.length === 0 ? (
                <div className="py-8 text-center text-text-tertiary">暂无条目</div>
              ) : items.map((item) => {
                const selectedOption = selectedDecisionOption(item)
                const diffLines = expandedDiffId === item.id
                  ? buildDiffLines(item.source_text, item.copy_ready_text || item.final_body)
                  : []

                return (
                <div key={item.id} className="rounded-2xl border border-border-subtle bg-bg-card px-4 py-4">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-black text-text-primary">#{item.index ?? item.item_id}</span>
                          {statusTag(item.decision_required ? 'needs_decision' : item.status)}
                          {item.safe_rewrite_used && <WarningTag size="sm">安全改写</WarningTag>}
                          {selectedOption && item.status !== 'needs_decision' && <PendingTag size="sm">按「{selectedOption.title}」生成</PendingTag>}
                      </div>
                      <div className="text-base font-bold text-text-primary">{item.title || item.source_title_guess || '未命名条目'}</div>
                    </div>
                    <div className="text-sm text-text-secondary md:text-right">
                      <div>第 {item.round} 轮</div>
                      <div>评分 {item.quality_score ?? '-'}</div>
                    </div>
                  </div>
                  {item.final_body && (
                    <div className="mt-3">
                      <div className="mb-2 text-xs uppercase tracking-[0.18em] text-text-tertiary">{resultLabel(item)}</div>
                      <p className="text-sm leading-6 text-text-secondary whitespace-pre-wrap">{item.final_body}</p>
                    </div>
                  )}
                  <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="rounded-2xl border border-border-subtle bg-bg-elevated/30 p-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-text-tertiary">原文</div>
                      <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-text-primary">
                        {item.source_text || '-'}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-border-subtle bg-bg-elevated/30 p-4 space-y-3">
                      <div>
                        <div className="text-xs uppercase tracking-[0.18em] text-text-tertiary">风险摘要</div>
                        <div className="mt-2 text-sm text-text-primary">
                          {riskSummary(item) || (item.verifier_pass === true ? '审核通过' : '暂无风险摘要')}
                        </div>
                      </div>
                      {item.safe_rewrite_reason && (
                        <div className="rounded-xl border border-accent-amber/20 bg-accent-amber/10 px-3 py-2 text-sm text-accent-amber">
                          安全改写：{labelForSafeRewriteReason(item.safe_rewrite_reason)}
                        </div>
                      )}
                      {item.decision_required && (
                        <div className="rounded-xl border border-accent-indigo/20 bg-accent-indigo/10 px-3 py-3 text-sm text-text-primary">
                          <div className="flex items-center gap-2 font-bold text-accent-indigo">
                            <AlertTriangle size={14} />
                            待你决定
                          </div>
                          <div className="mt-2 whitespace-pre-wrap text-text-primary">
                            {item.decision_summary || '这条规则之间有冲突，需要你先选一个优先级。'}
                          </div>
                          <div className="mt-3 space-y-3">
                            {item.decision_options.map((option) => {
                              const submitting = decisionSubmittingId === `${item.item_id}:${option.id}`
                              const isSelected = item.selected_decision_option_id === option.id
                              return (
                                <div key={`${item.id}-${option.id}`} className="rounded-xl border border-border-subtle bg-bg-card px-3 py-3">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <div className="font-bold text-text-primary">{option.title}</div>
                                    {option.recommended && <SuccessTag size="sm">推荐</SuccessTag>}
                                    {isSelected && <PendingTag size="sm">当前已选</PendingTag>}
                                  </div>
                                  <div className="mt-2 text-sm text-text-secondary">{option.summary}</div>
                                  {option.tradeoffs.length > 0 && (
                                    <div className="mt-2 space-y-1 text-xs text-text-tertiary">
                                      {option.tradeoffs.map((tradeoff) => (
                                        <div key={tradeoff}>- {tradeoff}</div>
                                      ))}
                                    </div>
                                  )}
                                  <div className="mt-3">
                                    <Button
                                      size="sm"
                                      loading={submitting}
                                      onClick={() => handleSubmitDecision(item.item_id, option.id)}
                                    >
                                      按这个方向继续生成
                                    </Button>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                      {item.rewrite_fail_reasons?.length ? (
                        <div className="rounded-xl border border-accent-coral/20 bg-accent-coral/10 px-3 py-3 text-sm text-accent-coral">
                          <div className="flex items-center gap-2 font-bold">
                            <AlertTriangle size={14} />
                            回炉原因
                          </div>
                          <div className="mt-2 whitespace-pre-wrap">{item.rewrite_fail_reasons.join('\n')}</div>
                        </div>
                      ) : null}
                      {item.decision_required && item.final_body && (
                        <div className="rounded-xl border border-border-subtle bg-bg-card px-3 py-3 text-sm text-text-secondary">
                          当前右侧展示的是候选改写稿，不是最终可交付稿。你选一个方向后，系统会继续生成终稿。
                        </div>
                      )}
                      {!item.decision_required && item.verifier_pass !== true && item.final_body && (
                        <div className="rounded-xl border border-border-subtle bg-bg-card px-3 py-3 text-sm text-text-secondary">
                          当前右侧展示的是系统最后一轮改写结果，还没通过审核，所以不能算可直接交付的终稿。
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setExpandedDiffId((prev) => (prev === item.id ? null : item.id))}
                    >
                      {expandedDiffId === item.id ? '收起差分' : '查看差分'}
                    </Button>
                  </div>
                  {expandedDiffId === item.id && (
                    <div className="mt-4 rounded-2xl border border-border-subtle bg-bg-elevated/20 p-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-text-tertiary">{resultDiffLabel(item)}</div>
                      <div className="mt-3 grid grid-cols-1 xl:grid-cols-2 gap-4">
                        <div>
                          <div className="mb-2 text-sm font-bold text-text-primary">原文</div>
                          <div className="space-y-2">
                            {diffLines.map((line, index) => (
                              <div
                                key={`left-${item.id}-${index}`}
                                className={`rounded-xl border px-3 py-2 text-sm whitespace-pre-wrap ${diffCellClass(line.kind, 'left')}`}
                              >
                                {line.left || ' '}
                              </div>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div className="mb-2 text-sm font-bold text-text-primary">{resultLabel(item)}</div>
                          <div className="space-y-2">
                            {diffLines.map((line, index) => (
                              <div
                                key={`right-${item.id}-${index}`}
                                className={`rounded-xl border px-3 py-2 text-sm whitespace-pre-wrap ${diffCellClass(line.kind, 'right')}`}
                              >
                                {line.right || ' '}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  {item.copy_ready_text && (
                    <div className="mt-3 flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={Copy}
                        onClick={() => navigator.clipboard.writeText(item.copy_ready_text || '')}
                      >
                        {copyResultLabel(item)}
                      </Button>
                    </div>
                  )}
                </div>
              )})}
            </CardContent>
          </Card>
        </div>

        <div className="xl:col-span-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>导出操作</CardTitle>
            </CardHeader>
          <CardContent className="space-y-3">
              <Button fullWidth icon={Download} onClick={handleExportMarkdown}>
                下载汇总文档
              </Button>
              <Button fullWidth variant="secondary" icon={Send} loading={exporting} onClick={handleExportFeishu}>
                导出到飞书
              </Button>
              {feishuStatus?.docs?.length ? (
                <div className="rounded-2xl border border-accent-green/20 bg-accent-green/10 p-3 space-y-2">
                  <div className="text-xs uppercase tracking-[0.18em] text-accent-green font-black">飞书文档</div>
                  {feishuStatus.docs.map((doc) => (
                    <a key={doc.doc_token} href={doc.doc_url} target="_blank" rel="noreferrer" className="block text-sm text-text-primary hover:underline">
                      {doc.doc_title}
                    </a>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>导出历史</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {exports.length === 0 ? (
                <div className="text-sm text-text-tertiary">暂无导出记录</div>
              ) : exports.map((log) => (
                <div key={log.id} className="rounded-xl border border-border-subtle px-3 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-bold text-text-primary text-sm">{labelForExportType(log.type)}</div>
                    {statusTag(log.status)}
                  </div>
                  <div className="mt-2 text-xs text-text-tertiary">{new Date(log.created_at).toLocaleString('zh-CN')}</div>
                  {log.error && <div className="mt-2 text-xs text-accent-coral">{log.error}</div>}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
