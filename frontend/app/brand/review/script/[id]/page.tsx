'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal, ConfirmModal } from '@/components/ui/Modal'
import { SuccessTag, WarningTag, ErrorTag, PendingTag } from '@/components/ui/Tag'
import { ReviewSteps, getBrandReviewSteps } from '@/components/ui/ReviewSteps'
import { getViolationTypeLabel, buildRejectComment, canReject } from '@/lib/reviewLabels'
import { useToast } from '@/components/ui/Toast'
import { api, extractErrorMessage } from '@/lib/api'
import { formatTaskDisplayTitle } from '@/lib/taskDisplay'
import { normalizeSoftWarnings, type SoftWarningLike } from '@/lib/reviewWarnings'
import { extractScriptReviewInsights } from '@/lib/scriptReviewInsights'
import {
  ArrowLeft,
  FileText,
  CheckCircle,
  XCircle,
  AlertTriangle,
  User,
  Building,
  Clock,
  Eye,
  Download,
  Shield,
  MessageSquare,
  MessageSquareWarning,
  Loader2,
} from 'lucide-react'
import { FilePreview, FileInfoCard, FilePreviewModal, type FileInfo } from '@/components/ui/FilePreview'
import type { TaskResponse } from '@/types/task'

// 从 TaskResponse 映射出页面所需的数据结构
function mapTaskToView(task: TaskResponse) {
  const aiResult = task.script_ai_result
  const conclusions = aiResult?.conclusions
  const legacyConclusions = conclusions as ({
    soft_warnings?: unknown[]
  } & Record<string, unknown>) | undefined

  // 提取违规项：优先 conclusions (v2)，回退顶层 (v1)
  const rawViolations = conclusions?.violations || aiResult?.violations || []
  const violations = rawViolations.map((v: Record<string, unknown>, idx: number) => ({
    id: `v-${idx}`,
    type: (v.type as string) || '',
    content: (v.content as string) || '',
    suggestion: (v.suggestion as string) || '',
    severity: (v.severity as string) || 'medium',
    dimension: v.dimension as string | undefined,
    fixable: v.fixable as boolean | undefined,
  }))

  // 提取软性提醒
  const rawSoftWarnings = (aiResult?.soft_warnings || legacyConclusions?.soft_warnings || []) as SoftWarningLike[]
  const softWarnings = normalizeSoftWarnings(rawSoftWarnings).map((w) => ({
    id: w.id,
    type: w.label,
    content: w.content,
    suggestion: w.suggestion,
  }))

  // 提取卖点匹配
  const rawSellingPointMatches = conclusions?.selling_point_matches || aiResult?.selling_point_matches || []

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

  const fileExtension = task.script_file_name?.split('.').pop()?.toLowerCase() || ''
  const mimeTypeMap: Record<string, string> = {
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',
    pdf: 'application/pdf',
    txt: 'text/plain',
    rtf: 'application/rtf',
  }

  const agencyResult = task.script_agency_status || 'pending'
  const agencyResultLabel = agencyResult === 'passed' ? '建议通过' : agencyResult === 'rejected' ? '建议驳回' : '待审核'

  // 根据后端 stage 映射品牌方视角的审核状态
  let brandViewStatus: string = task.stage
  const stage = task.stage
  if (stage === 'script_brand_review') {
    brandViewStatus = 'brand_reviewing'
  } else if (stage === 'video_upload' || stage === 'video_ai_review' || stage === 'video_agency_review' || stage === 'video_brand_review' || stage === 'completed') {
    brandViewStatus = 'passed'
  } else if (stage === 'script_upload' || stage === 'script_ai_review') {
    // 如果有过品牌方终审阶段的记录（即 script_ai_score 存在 + 曾到过品牌审核），说明是品牌方驳回后退回
    // 简单判断：如果有 AI 分数且 stage 回到了 script_upload，说明是驳回了
    if (task.script_ai_score && task.script_ai_score > 0) {
      brandViewStatus = 'rejected'
    }
  }

  return {
    id: task.id,
    title: formatTaskDisplayTitle({
      taskName: task.name,
      projectName: task.project?.name,
      sequence: task.sequence,
    }),
    creatorName: task.creator.name,
    agencyName: task.agency.name,
    projectName: task.project.name,
    submittedAt: task.script_uploaded_at || task.created_at,
    aiScore: task.script_ai_score || 0,
    status: brandViewStatus,
    file: {
      id: task.id,
      fileName: task.script_file_name || '未上传文件',
      fileSize: '',
      fileType: mimeTypeMap[fileExtension] || 'application/octet-stream',
      fileUrl: task.script_file_url || '',
      uploadedAt: task.script_uploaded_at || undefined,
    } as FileInfo,
    isAppeal: task.is_appeal,
    appealReason: task.appeal_reason || '',
    scriptAgencyCorrected: task.script_agency_corrected || null,
    agencyReview: {
      reviewer: task.agency.name,
      result: agencyResult,
      resultLabel: agencyResultLabel,
      comment: task.script_agency_comment || '',
      reviewedAt: task.script_agency_reviewed_at || '',
    },
    aiAnalysis: {
      violations,
      softWarnings,
      dimensions,
      brandExposure: aiResult?.brand_exposure,
      sellingPointMatches: rawSellingPointMatches,
      sellingPoints: [] as Array<{ point: string; covered: boolean }>,
      viralPotential: conclusions?.content_quality?.viral_potential,
      viralReason: conclusions?.content_quality?.viral_reason,
      contentVerdict: conclusions?.content_quality?.overall_verdict,
      chainOfThought: aiResult?.chain_of_thought,
    },
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

function BrandCorrectedScriptCard({ correctedScript }: { correctedScript: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(correctedScript)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* fallback */ }
  }

  const handleDownload = () => {
    const blob = new Blob([correctedScript], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = '代理商修正脚本.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Card className="border-accent-indigo/30">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <FileText size={18} className="text-accent-indigo" />
            代理商修正脚本
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1 px-2 py-1 text-xs text-text-secondary hover:text-text-primary rounded transition-colors"
            >
              {copied ? <><CheckCircle size={12} className="text-accent-green" />已复制</> : <><Eye size={12} />复制</>}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="flex items-center gap-1 px-2 py-1 text-xs text-text-secondary hover:text-text-primary rounded transition-colors"
            >
              <Download size={12} />下载
            </button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="p-4 bg-bg-elevated rounded-lg border border-border-subtle max-h-60 overflow-y-auto">
          <pre className="text-sm text-text-primary whitespace-pre-wrap font-sans leading-relaxed">{correctedScript}</pre>
        </div>
        <p className="text-xs text-text-tertiary mt-2">代理商已对原脚本进行修正，请以此版本作为终审参考</p>
      </CardContent>
    </Card>
  )
}

function ReviewProgressBar({ taskStatus }: { taskStatus: string }) {
  const steps = getBrandReviewSteps(taskStatus)
  const currentStep = steps.find(s => s.status === 'current')

  return (
    <Card className="mb-6">
      <CardContent className="py-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-text-primary">审核流程</span>
          <span className="text-sm text-accent-indigo font-medium">
            当前：{currentStep?.label || '品牌方终审'}
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
          <div className="h-4 bg-bg-elevated rounded w-1/2" />
        </div>
      </div>
      <div className="h-16 bg-bg-elevated rounded-xl" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="h-20 bg-bg-elevated rounded-xl" />
          <div className="h-64 bg-bg-elevated rounded-xl" />
          <div className="h-32 bg-bg-elevated rounded-xl" />
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

export default function BrandScriptReviewPage() {
  const router = useRouter()
  const params = useParams()
  const toast = useToast()
  const taskId = params.id as string

  const [showApproveModal, setShowApproveModal] = useState(false)
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [checkedViolations, setCheckedViolations] = useState<Record<string, boolean>>({})
  const [viewMode, setViewMode] = useState<'file' | 'parsed'>('file')
  const [showFilePreview, setShowFilePreview] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [taskData, setTaskData] = useState<ReturnType<typeof mapTaskToView> | null>(null)

  // 加载任务数据
  const loadTask = useCallback(async () => {
    try {
      setLoading(true)
      const response = await api.getTask(taskId)
      setTaskData(mapTaskToView(response))
    } catch (err) {
      const message = extractErrorMessage(err)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [taskId, toast])

  useEffect(() => {
    loadTask()
  }, [loadTask])

  const task = taskData
  const creativeInsights = extractScriptReviewInsights(task?.aiAnalysis.chainOfThought as Record<string, unknown> | undefined)
  const hasCreativeInsights = (
    creativeInsights.audience.length > 0 ||
    creativeInsights.tone.length > 0 ||
    creativeInsights.contentStyle.length > 0 ||
    creativeInsights.structure.length > 0 ||
    creativeInsights.highlights.length > 0 ||
    creativeInsights.suggestions.length > 0 ||
    Boolean(creativeInsights.qualitySummary) ||
    Boolean(creativeInsights.briefSummary)
  )


  const handleApprove = async () => {
    try {
      setSubmitting(true)
      await api.reviewScript(taskId, { action: 'pass', comment: '' })
      setShowApproveModal(false)
      toast.success('审核通过')
      router.push('/brand/review')
    } catch (err) {
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
    const comment = buildRejectComment(checkedViolations, task!.aiAnalysis.violations, rejectReason)

    try {
      setSubmitting(true)
      await api.reviewScript(taskId, { action: 'reject', comment })
      setShowRejectModal(false)
      toast.success('已驳回')
      router.push('/brand/review')
    } catch (err) {
      const message = extractErrorMessage(err)
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  // 加载中
  if (loading) {
    return <LoadingSkeleton />
  }

  // 数据未加载到
  if (!task) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-text-secondary mb-4">任务数据加载失败</p>
        <Button variant="secondary" onClick={() => router.back()}>返回</Button>
      </div>
    )
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
            <span className="flex items-center gap-1">
              <User size={14} />
              {task.creatorName}
            </span>
            <span className="flex items-center gap-1">
              <Building size={14} />
              {task.agencyName}
            </span>
            <span className="flex items-center gap-1">
              <Clock size={14} />
              {task.submittedAt}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
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
          </div>
        </div>
      </div>

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
      <ReviewProgressBar taskStatus={task.status} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左侧：脚本内容 */}
        <div className="lg:col-span-2 space-y-4">
          {/* 文件信息卡片 */}
          {task.file.fileUrl && (
            <FileInfoCard
              file={task.file}
              onPreview={() => setShowFilePreview(true)}
            />
          )}

          {viewMode === 'file' ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText size={18} className="text-accent-indigo" />
                  文件预览
                </CardTitle>
              </CardHeader>
              <CardContent>
                {task.file.fileUrl ? (
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
                  AI 解析内容
                  <span className="text-xs font-normal text-text-tertiary ml-2">（AI 自动提取的结构化内容）</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-center py-8">
                  <FileText size={32} className="mx-auto text-text-tertiary mb-3" />
                  <p className="text-sm text-text-tertiary">当前版本暂不支持脚本结构化解析预览，请切换到「原文件」查看</p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* 代理商修正脚本 */}
          {task.scriptAgencyCorrected && (
            <BrandCorrectedScriptCard correctedScript={task.scriptAgencyCorrected} />
          )}

          {/* 代理商初审意见 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare size={18} className="text-blue-500" />
                代理商初审意见
              </CardTitle>
            </CardHeader>
            <CardContent>
              {task.agencyReview.comment ? (
                <div className="flex items-start gap-4">
                  <div className={`p-2 rounded-full ${task.agencyReview.result === 'passed' || task.agencyReview.result === 'force_passed' ? 'bg-accent-green/20' : 'bg-accent-coral/20'}`}>
                    {task.agencyReview.result === 'passed' || task.agencyReview.result === 'force_passed' ? (
                      <CheckCircle size={20} className="text-accent-green" />
                    ) : (
                      <XCircle size={20} className="text-accent-coral" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-text-primary">{task.agencyReview.reviewer}</span>
                      {(task.agencyReview.result === 'passed' || task.agencyReview.result === 'force_passed') ? (
                        <SuccessTag>{task.agencyReview.resultLabel}</SuccessTag>
                      ) : task.agencyReview.result === 'rejected' ? (
                        <ErrorTag>{task.agencyReview.resultLabel}</ErrorTag>
                      ) : (
                        <PendingTag>{task.agencyReview.resultLabel}</PendingTag>
                      )}
                    </div>
                    <p className="text-text-secondary text-sm">{task.agencyReview.comment}</p>
                    {task.agencyReview.reviewedAt && (
                      <p className="text-xs text-text-tertiary mt-2">{task.agencyReview.reviewedAt}</p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-text-tertiary text-center py-4">暂无代理商审核意见</p>
              )}
            </CardContent>
          </Card>
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

          {/* 软性提醒 */}
          {task.aiAnalysis.softWarnings && task.aiAnalysis.softWarnings.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Shield size={16} className="text-accent-indigo" />
                  软性提醒 ({task.aiAnalysis.softWarnings.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {task.aiAnalysis.softWarnings.map((w) => (
                  <div key={w.id} className="p-3 bg-accent-indigo/10 rounded-lg border border-accent-indigo/30">
                    <div className="flex items-center gap-2 mb-1">
                      <PendingTag>{getViolationTypeLabel(w.type)}</PendingTag>
                    </div>
                    <p className="text-sm text-text-primary">{w.content}</p>
                    <p className="text-xs text-accent-indigo mt-1">{w.suggestion}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* 卖点匹配 */}
          {(task.aiAnalysis.sellingPointMatches?.length > 0 || task.aiAnalysis.sellingPoints.length > 0) && (
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
                  task.aiAnalysis.sellingPoints.map((sp, idx) => (
                    <div key={idx} className="flex items-center gap-2 p-2 rounded-lg bg-bg-elevated">
                      {sp.covered ? <CheckCircle size={16} className="text-accent-green" /> : <XCircle size={16} className="text-accent-coral" />}
                      <span className="text-sm text-text-primary">{sp.point}</span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          )}

          {task.aiAnalysis.brandExposure && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Eye size={16} className="text-accent-indigo" />
                  品牌曝光评估
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
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* 底部决策栏 - 仅品牌方终审阶段显示操作按钮 */}
      <Card className="sticky bottom-4 shadow-lg">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-text-secondary">
              项目：{task.projectName}
            </div>
            {task.status === 'brand_reviewing' ? (
              <div className="flex gap-3">
                <Button variant="danger" onClick={() => setShowRejectModal(true)} disabled={submitting}>
                  {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
                  驳回
                </Button>
                <Button variant="success" onClick={() => setShowApproveModal(true)} disabled={submitting}>
                  {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
                  通过
                </Button>
              </div>
            ) : task.status === 'rejected' ? (
              <span className="text-sm text-accent-coral font-medium">已驳回</span>
            ) : task.status === 'passed' ? (
              <span className="text-sm text-accent-green font-medium">已通过</span>
            ) : (
              <span className="text-sm text-text-tertiary">非终审阶段</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 通过确认弹窗 */}
      <ConfirmModal
        isOpen={showApproveModal}
        onClose={() => setShowApproveModal(false)}
        onConfirm={handleApprove}
        title="确认通过"
        message="确定要通过此脚本的审核吗？通过后达人将收到通知，可以开始拍摄视频。"
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

      {/* 文件预览弹窗 */}
      <FilePreviewModal
        file={task.file}
        isOpen={showFilePreview}
        onClose={() => setShowFilePreview(false)}
      />
    </div>
  )
}
