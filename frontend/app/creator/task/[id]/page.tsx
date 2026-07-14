'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'
import {
  Upload, Check, X, Folder, Bell, MessageCircle,
  XCircle, CheckCircle, Loader2, Scan, ArrowLeft,
  Bot, Users, Building2, Clock, FileText, Video,
  ChevronRight, AlertTriangle, Download, Eye, Target, Ban,
  ChevronDown, ChevronUp, File
} from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { ResponsiveLayout } from '@/components/layout/ResponsiveLayout'
import { cn } from '@/lib/utils'
import { api, extractErrorMessage } from '@/lib/api'
import { useSSE } from '@/contexts/SSEContext'
import type { TaskResponse, AIReviewResult, ReviewDimensions, SellingPointMatchResult } from '@/types/task'
import { formatTaskDisplayName } from '@/lib/taskDisplay'
import { getViolationTypeLabel } from '@/lib/reviewLabels'

// 前端 UI 使用的任务阶段类型
type TaskPhase = 'script' | 'video'
type TaskStage =
  | 'upload'
  | 'ai_reviewing'
  | 'ai_result'
  | 'agency_reviewing'
  | 'agency_rejected'
  | 'brand_reviewing'
  | 'brand_approved'
  | 'brand_rejected'

type Issue = {
  title: string
  description: string
  timestamp?: string
  severity?: 'error' | 'warning'
}

type ReviewLog = {
  time: string
  message: string
  status: 'done' | 'loading' | 'pending'
}

type TaskData = {
  id: string
  title: string
  subtitle: string
  phase: TaskPhase
  stage: TaskStage
  progress?: number
  issues?: Issue[]
  reviewLogs?: ReviewLog[]
  rejectionReason?: string
  submittedAt?: string
  scriptContent?: string
  aiResult?: {
    score: number
    dimensions?: ReviewDimensions
    sellingPointMatches?: SellingPointMatchResult[]
    violations: Array<{ type: string; content: string; suggestion: string; dimension?: string }>
  }
  agencyReview?: { result: 'approved' | 'rejected'; comment: string; reviewer: string; time: string }
  brandReview?: { result: 'approved' | 'rejected'; comment: string; reviewer: string; time: string }
}

type AgencyBriefFile = {
  id: string
  name: string
  size: string
  uploadedAt: string
  description?: string
}

type BriefData = {
  files: AgencyBriefFile[]
  sellingPoints: { id: string; content: string; priority: 'core' | 'recommended' | 'reference' }[]
  blacklistWords: { id: string; word: string; reason: string }[]
}

const DEFAULT_BRIEF_DATA: BriefData = {
  files: [],
  sellingPoints: [],
  blacklistWords: [],
}

const TASK_ID_PATTERN = /^TK[0-9A-Za-z-]+$/i
const INVISIBLE_CHARS_REGEX = /[\u200B-\u200D\uFEFF]/g

function cleanText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(INVISIBLE_CHARS_REGEX, '').trim()
}

function pickTaskId(rawTask: Record<string, unknown>): string {
  const taskId = cleanText(rawTask.task_id)
  const relatedTaskId = cleanText(rawTask.related_task_id)
  const id = cleanText(rawTask.id)
  const candidates = [taskId, relatedTaskId, id].filter(Boolean)
  const matched = candidates.find((candidate) => TASK_ID_PATTERN.test(candidate))
  return matched || candidates[0] || ''
}

function normalizeTaskId(raw: string | string[] | undefined): string {
  const id = Array.isArray(raw) ? raw[0] : raw
  if (!id) return ''
  try {
    return cleanText(decodeURIComponent(id))
  } catch {
    return cleanText(String(id))
  }
}

// 将后端 TaskResponse 映射为前端 UI 的 TaskData
function mapApiTaskToTaskData(task: TaskResponse): TaskData {
  const rawTask = task as TaskResponse & Record<string, unknown>
  const project = (rawTask.project as unknown as Record<string, unknown>) || {}
  const projectName = cleanText(project.name) || cleanText(project.project_name) || cleanText(rawTask.project_name) || '未命名项目'
  const brandName = cleanText(project.brand_name) || cleanText(rawTask.brand_name)
  const taskName = formatTaskDisplayName({
    taskName: cleanText(rawTask.name) || cleanText(rawTask.task_name) || cleanText(rawTask.task_title) || cleanText(rawTask.title),
    projectName,
    sequence: rawTask.sequence,
  })
  const stage = task.stage
  let phase: TaskPhase = 'script'
  let uiStage: TaskStage = 'upload'
  let issues: Issue[] = []
  let rejectionReason: string | undefined
  let submittedAt: string | undefined

  // 判断阶段
  if (stage.startsWith('video_') || stage === 'completed') {
    phase = 'video'
  }

  // 映射阶段
  switch (stage) {
    case 'script_upload':
      // 优先级：代理商/品牌方驳回 > AI 打回 > 正常上传
      if (task.script_brand_status === 'rejected') {
        uiStage = 'brand_rejected'
        rejectionReason = task.script_brand_comment || undefined
      } else if (task.script_agency_status === 'rejected') {
        uiStage = 'agency_rejected'
        rejectionReason = task.script_agency_comment || undefined
      } else if (task.script_ai_result?.ai_auto_rejected) {
        uiStage = 'ai_result'
        rejectionReason = task.script_ai_result.ai_reject_reason || undefined
      } else {
        uiStage = 'upload'
      }
      break
    case 'script_ai_review': uiStage = 'ai_reviewing'; break
    case 'script_agency_review': uiStage = 'agency_reviewing'; submittedAt = task.script_uploaded_at || undefined; break
    case 'script_brand_review': uiStage = 'brand_reviewing'; submittedAt = task.script_uploaded_at || undefined; break
    case 'video_upload':
      phase = 'video'
      if (task.video_brand_status === 'rejected') {
        uiStage = 'brand_rejected'
        rejectionReason = task.video_brand_comment || undefined
      } else if (task.video_agency_status === 'rejected') {
        uiStage = 'agency_rejected'
        rejectionReason = task.video_agency_comment || undefined
      } else if (task.video_ai_result?.ai_auto_rejected) {
        uiStage = 'ai_result'
        rejectionReason = task.video_ai_result.ai_reject_reason || undefined
      } else {
        uiStage = 'upload'
      }
      break
    case 'video_ai_review': uiStage = 'ai_reviewing'; phase = 'video'; break
    case 'video_agency_review': uiStage = 'agency_reviewing'; phase = 'video'; submittedAt = task.video_uploaded_at || undefined; break
    case 'video_brand_review': uiStage = 'brand_reviewing'; phase = 'video'; submittedAt = task.video_uploaded_at || undefined; break
    case 'completed': uiStage = 'brand_approved'; phase = 'video'; submittedAt = task.video_uploaded_at || undefined; break
    case 'rejected': {
      // 判断是哪个阶段被驳回
      if (task.video_brand_status === 'rejected') {
        phase = 'video'; uiStage = 'brand_rejected'
        rejectionReason = task.video_brand_comment || undefined
      } else if (task.video_agency_status === 'rejected') {
        phase = 'video'; uiStage = 'agency_rejected'
        rejectionReason = task.video_agency_comment || undefined
      } else if (task.script_brand_status === 'rejected') {
        phase = 'script'; uiStage = 'brand_rejected'
        rejectionReason = task.script_brand_comment || undefined
      } else if (task.script_agency_status === 'rejected') {
        phase = 'script'; uiStage = 'agency_rejected'
        rejectionReason = task.script_agency_comment || undefined
      } else {
        uiStage = 'ai_result'
      }
      break
    }
  }


  // 提取 AI 审核结果中的 issues（兼容 v1/v2）
  const aiResult = phase === 'script' ? task.script_ai_result : task.video_ai_result
  const conclusions = aiResult?.conclusions
  const rawViolations = conclusions?.violations || aiResult?.violations || []
  if (rawViolations.length > 0) {
    const dimLabels: Record<string, string> = { legal: '法规合规', platform: '平台规则', brand_safety: '品牌安全', brief_match: 'Brief 匹配', content_quality: '内容质量' }
    issues = rawViolations.map((v: Record<string, unknown>) => ({
      title: v.dimension ? `[${dimLabels[v.dimension as string] || v.dimension}] ${getViolationTypeLabel(v.type as string)}` : getViolationTypeLabel(v.type as string),
      description: `${v.content}${v.suggestion ? ` — ${v.suggestion}` : ''}`,
      timestamp: v.timestamp ? `${v.timestamp}s` : undefined,
      severity: v.severity === 'high' ? 'error' as const : 'warning' as const,
    }))
  }

  const subtitle = brandName ? `${projectName} · ${brandName}` : projectName

  // 提取维度评分（兼容 v1/v2）
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

  // AI 审核结果（完整，含维度）
  const rawSellingPointMatches = conclusions?.selling_point_matches || aiResult?.selling_point_matches || []
  const aiResultData = aiResult ? {
    score: aiResult.score,
    dimensions,
    sellingPointMatches: rawSellingPointMatches,
    violations: rawViolations.map((v: Record<string, unknown>) => ({ type: v.type as string, content: v.content as string, suggestion: v.suggestion as string, dimension: v.dimension as string | undefined })),
  } : undefined

  // 代理商审核反馈
  const agencyStatus = phase === 'script' ? task.script_agency_status : task.video_agency_status
  const agencyComment = phase === 'script' ? task.script_agency_comment : task.video_agency_comment
  const agencyReview = agencyStatus && agencyStatus !== 'pending' ? {
    result: (agencyStatus === 'passed' || agencyStatus === 'force_passed' ? 'approved' : 'rejected') as 'approved' | 'rejected',
    comment: agencyComment || '',
    reviewer: task.agency?.name || '代理商',
    time: phase === 'script'
      ? (task.script_agency_reviewed_at || task.updated_at)
      : (task.video_agency_reviewed_at || task.updated_at),
  } : undefined

  // 品牌方审核反馈
  const brandStatus = phase === 'script' ? task.script_brand_status : task.video_brand_status
  const brandComment = phase === 'script' ? task.script_brand_comment : task.video_brand_comment
  const brandReview = brandStatus && brandStatus !== 'pending' ? {
    result: (brandStatus === 'passed' || brandStatus === 'force_passed' ? 'approved' : 'rejected') as 'approved' | 'rejected',
    comment: brandComment || '',
    reviewer: '品牌方审核员',
    time: phase === 'script'
      ? (task.script_brand_reviewed_at || task.updated_at)
      : (task.video_brand_reviewed_at || task.updated_at),
  } : undefined

  return {
    id: pickTaskId(rawTask) || task.id,
    title: taskName,
    subtitle,
    phase,
    stage: uiStage,
    issues: issues.length > 0 ? issues : undefined,
    rejectionReason,
    submittedAt,
    aiResult: aiResultData,
    agencyReview,
    brandReview,
  }
}

// ========== UI 组件 ==========

function StepIcon({ status, icon }: { status: 'done' | 'current' | 'error' | 'pending'; icon: 'upload' | 'bot' | 'users' | 'building' }) {
  const IconMap = { upload: Upload, bot: Bot, users: Users, building: Building2 }
  const Icon = IconMap[icon]
  const getStyle = () => {
    switch (status) {
      case 'done': return 'bg-accent-green'
      case 'current': return 'bg-accent-indigo'
      case 'error': return 'bg-accent-coral'
      default: return 'bg-bg-elevated border-[1.5px] border-border-subtle'
    }
  }
  const iconColor = status === 'pending' ? 'text-text-tertiary' : 'text-white'
  return (
    <div className={cn('w-8 h-8 rounded-full flex items-center justify-center', getStyle())}>
      {status === 'done' && <Check size={16} className={iconColor} />}
      {status === 'current' && <Loader2 size={16} className={cn(iconColor, 'animate-spin')} />}
      {status === 'error' && <X size={16} className={iconColor} />}
      {status === 'pending' && <Icon size={16} className={iconColor} />}
    </div>
  )
}

function ReviewProgressBar({ task }: { task: TaskData }) {
  const { stage } = task
  const getStepStatus = (stepIndex: number): 'done' | 'current' | 'error' | 'pending' => {
    const stageMap: Record<TaskStage, number> = {
      'upload': 0, 'ai_reviewing': 1, 'ai_result': 1,
      'agency_reviewing': 2, 'agency_rejected': 2,
      'brand_reviewing': 3, 'brand_approved': 4, 'brand_rejected': 3,
    }
    const currentStepIndex = stageMap[stage]
    const isError = stage === 'ai_result' || stage === 'agency_rejected' || stage === 'brand_rejected'
    if (stepIndex < currentStepIndex) return 'done'
    if (stepIndex === currentStepIndex) {
      if (isError) return 'error'
      if (stage === 'brand_approved') return 'done'
      return 'current'
    }
    return 'pending'
  }

  const steps = [
    { label: '已提交', icon: 'upload' as const },
    { label: 'AI审核', icon: 'bot' as const },
    { label: '代理商', icon: 'users' as const },
    { label: '品牌方', icon: 'building' as const },
  ]

  return (
    <div className="bg-bg-card rounded-2xl p-6 card-shadow">
      <h3 className="text-lg font-semibold text-text-primary mb-5">
        {task.phase === 'script' ? '脚本审核流程' : '视频审核流程'}
      </h3>
      <div className="flex items-center">
        {steps.map((step, index) => {
          const status = getStepStatus(index)
          return (
            <div key={step.label} className="flex items-center flex-1">
              <div className="flex flex-col items-center gap-2 w-20">
                <StepIcon status={status} icon={step.icon} />
                <span className={cn(
                  'text-xs',
                  status === 'done' ? 'text-text-secondary' :
                  status === 'error' ? 'text-accent-coral font-semibold' :
                  status === 'current' ? 'text-accent-indigo font-semibold' :
                  'text-text-tertiary'
                )}>{step.label}</span>
              </div>
              {index < steps.length - 1 && (
                <div className={cn('h-0.5 flex-1', getStepStatus(index) === 'done' ? 'bg-accent-green' : 'bg-border-subtle')} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Brief 组件
function AgencyBriefSection({ toast, briefData }: {
  toast: ReturnType<typeof useToast>
  briefData: BriefData
}) {
  const [isExpanded, setIsExpanded] = useState(true)
  const [previewFile, setPreviewFile] = useState<AgencyBriefFile | null>(null)

  const handleDownload = (file: AgencyBriefFile) => { toast.info(`下载文件: ${file.name}`) }

  const corePoints = briefData.sellingPoints.filter(sp => sp.priority === 'core')
  const recommendedPoints = briefData.sellingPoints.filter(sp => sp.priority === 'recommended')
  const referencePoints = briefData.sellingPoints.filter(sp => sp.priority === 'reference')

  return (
    <>
      <div className="bg-bg-card rounded-2xl card-shadow border border-accent-indigo/30">
        <div className="flex items-center justify-between p-4 border-b border-border-subtle">
          <div className="flex items-center gap-2">
            <File className="w-5 h-5 text-accent-indigo" />
            <span className="text-base font-semibold text-text-primary">Brief 文档与要求</span>
          </div>
          <button type="button" onClick={() => setIsExpanded(!isExpanded)} className="p-1.5 hover:bg-bg-elevated rounded-lg transition-colors">
            {isExpanded ? <ChevronUp className="w-5 h-5 text-text-tertiary" /> : <ChevronDown className="w-5 h-5 text-text-tertiary" />}
          </button>
        </div>

        {isExpanded && (
          <div className="p-4 space-y-4">
            <div>
              <h4 className="text-sm font-medium text-text-primary mb-2 flex items-center gap-2">
                <FileText className="w-4 h-4 text-accent-indigo" /> 参考文档
              </h4>
              <div className="space-y-2">
                {briefData.files.map((file) => (
                  <div key={file.id} className="flex items-center justify-between p-3 bg-bg-elevated rounded-xl">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-accent-indigo/15 flex items-center justify-center flex-shrink-0">
                        <FileText className="w-4 h-4 text-accent-indigo" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-text-primary truncate">{file.name}</p>
                        <p className="text-xs text-text-tertiary">{file.size}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button type="button" onClick={() => setPreviewFile(file)} className="p-2 hover:bg-bg-page rounded-lg transition-colors">
                        <Eye className="w-4 h-4 text-text-secondary" />
                      </button>
                      <button type="button" onClick={() => handleDownload(file)} className="p-2 hover:bg-bg-page rounded-lg transition-colors">
                        <Download className="w-4 h-4 text-text-secondary" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h4 className="text-sm font-medium text-text-primary mb-2 flex items-center gap-2">
                <Target className="w-4 h-4 text-accent-green" /> 卖点要求
              </h4>
              <div className="space-y-2">
                {corePoints.length > 0 && (
                  <div className="p-3 bg-accent-coral/10 rounded-xl border border-accent-coral/30">
                    <p className="text-xs text-accent-coral font-medium mb-2">核心卖点（建议优先提及）</p>
                    <div className="flex flex-wrap gap-2">
                      {corePoints.map((sp) => (
                        <span key={sp.id} className="px-2 py-1 text-xs bg-accent-coral/20 text-accent-coral rounded-lg">{sp.content}</span>
                      ))}
                    </div>
                  </div>
                )}
                {recommendedPoints.length > 0 && (
                  <div className="p-3 bg-accent-amber/10 rounded-xl border border-accent-amber/30">
                    <p className="text-xs text-accent-amber font-medium mb-2">推荐卖点（建议提及）</p>
                    <div className="flex flex-wrap gap-2">
                      {recommendedPoints.map((sp) => (
                        <span key={sp.id} className="px-2 py-1 text-xs bg-accent-amber/20 text-accent-amber rounded-lg">{sp.content}</span>
                      ))}
                    </div>
                  </div>
                )}
                {referencePoints.length > 0 && (
                  <div className="p-3 bg-bg-elevated rounded-xl">
                    <p className="text-xs text-text-tertiary font-medium mb-2">参考信息</p>
                    <div className="flex flex-wrap gap-2">
                      {referencePoints.map((sp) => (
                        <span key={sp.id} className="px-2 py-1 text-xs bg-bg-page text-text-secondary rounded-lg">{sp.content}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div>
              <h4 className="text-sm font-medium text-text-primary mb-2 flex items-center gap-2">
                <Ban className="w-4 h-4 text-accent-coral" /> 违禁词（请勿使用）
              </h4>
              <div className="flex flex-wrap gap-2">
                {briefData.blacklistWords.map((bw) => (
                  <span key={bw.id} className="px-2 py-1 text-xs bg-accent-coral/15 text-accent-coral rounded-lg border border-accent-coral/30">
                    「{bw.word}」
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <Modal isOpen={!!previewFile} onClose={() => setPreviewFile(null)} title={previewFile?.name || '文件预览'} size="lg">
        <div className="space-y-4">
          <div className="aspect-[4/3] bg-bg-elevated rounded-lg flex items-center justify-center">
            <div className="text-center">
              <FileText className="w-12 h-12 mx-auto text-accent-indigo mb-4" />
              <p className="text-text-secondary">文件预览区域</p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPreviewFile(null)}>关闭</Button>
            {previewFile && <Button onClick={() => handleDownload(previewFile)}><Download className="w-4 h-4" />下载文件</Button>}
          </div>
        </div>
      </Modal>
    </>
  )
}

function FileUploadSection({ taskId, phase, onUploaded }: { taskId: string; phase: 'script' | 'video'; onUploaded: () => void }) {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [mode, setMode] = useState<'file' | 'text'>('file')
  const [textContent, setTextContent] = useState('')
  const [isSafariMode, setIsSafariMode] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const videoFormRef = useRef<HTMLFormElement | null>(null)
  const fileInputIdRef = useRef(`task-upload-file-${taskId}-${Math.random().toString(36).slice(2, 8)}`)
  const toast = useToast()
  const isScript = phase === 'script'
  const tenantId = api.getTenantId()

  const isSafariBrowser = () => {
    if (typeof navigator === 'undefined') return false
    const ua = navigator.userAgent
    return /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|EdgiOS|FxiOS|Android/i.test(ua)
  }

  useEffect(() => {
    if (!isScript) {
      setIsSafariMode(isSafariBrowser())
    }
  }, [isScript])

  const resetSelectedFile = useCallback(() => {
    setFile(null)
    setUploadError(null)
    setIsUploading(false)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      setFile(selectedFile)
      setUploadError(null)
      setIsUploading(false)
    }
  }

  const handleSubmit = async () => {
    if (!isScript && mode === 'file') return
    if (mode === 'file' && !file) return
    if (mode === 'text' && textContent.trim().length < 10) { toast.error('脚本内容至少 10 个字'); return }
    setIsUploading(true); setProgress(0); setUploadError(null)
    try {
      if (mode === 'text') {
        await api.uploadTaskScript(taskId, { text_content: textContent.trim() })
        toast.success('脚本已提交，等待 AI 审核')
        await Promise.resolve(onUploaded())
      } else {
        const result = await api.proxyUpload(file!, 'script', (pct) => {
          setProgress(Math.min(90, Math.round(pct * 0.9)))
        })
        setProgress(95)
        await api.uploadTaskScript(taskId, { file_url: result.url, file_name: result.file_name })
        setProgress(100)
        toast.success('脚本已提交，等待 AI 审核')
        await Promise.resolve(onUploaded())
      }
    } catch (err) {
      const msg = extractErrorMessage(err)
      setUploadError(msg); toast.error(msg)
    } finally { setIsUploading(false) }
  }

  const handleModeSwitch = (newMode: 'file' | 'text') => {
    if (isUploading) return
    setMode(newMode); setUploadError(null)
  }

  const handleVideoSubmitClick = useCallback(async () => {
    const selectedFile = fileInputRef.current?.files?.[0] || file
    if (!selectedFile) {
      setUploadError('请选择要上传的视频文件')
      toast.error('请选择要上传的视频文件')
      return
    }

    setIsUploading(true)
    setProgress(0)
    setUploadError(null)
    try {
      const uploaded = await api.proxyUpload(selectedFile, 'video', (pct) => {
        setProgress(Math.max(1, Math.min(95, Math.round(pct * 0.95))))
      })
      setProgress(97)
      await api.uploadTaskVideo(taskId, {
        file_url: uploaded.url,
        file_name: uploaded.file_name || selectedFile.name,
      })
      setProgress(100)
      toast.success('视频已上传，正在启动 AI 审核')
      await Promise.resolve(onUploaded())
    } catch (err) {
      const message = extractErrorMessage(err)
      setUploadError(message)
      toast.error(message)
    } finally {
      setIsUploading(false)
    }
  }, [file, onUploaded, taskId, toast])

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + 'B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB'
    return (bytes / (1024 * 1024)).toFixed(1) + 'MB'
  }

  const acceptTypes = isScript ? '.doc,.docx,.pdf,.txt,.xls,.xlsx' : '.mp4,.mov,.avi,.mkv'
  const acceptHint = isScript ? '支持 Word、PDF、TXT、Excel 格式' : '支持 MP4/MOV 格式，≤ 100MB'
  const canSubmit = mode === 'file' ? !!file && !isUploading : textContent.trim().length >= 10 && !isUploading

  return (
    <div className="bg-bg-card rounded-2xl card-shadow">
      <div className="flex items-center gap-2 p-4 border-b border-border-subtle">
        <Upload className="w-5 h-5 text-accent-indigo" />
        <span className="text-base font-semibold text-text-primary">{isScript ? '上传脚本' : '上传视频'}</span>
        <span className="ml-auto px-2.5 py-1 rounded-full text-xs font-semibold bg-accent-indigo/15 text-accent-indigo">待提交</span>
      </div>
      <div className="p-4 space-y-4">
        {/* 脚本模式切换（视频只能上传文件） */}
        {isScript && (
          <div className="flex gap-1 p-1 bg-bg-elevated rounded-lg">
            <button type="button" onClick={() => handleModeSwitch('file')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${mode === 'file' ? 'bg-accent-indigo text-white' : 'text-text-secondary hover:text-text-primary'}`}>
              <Upload size={14} />上传文件
            </button>
            <button type="button" onClick={() => handleModeSwitch('text')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${mode === 'text' ? 'bg-accent-indigo text-white' : 'text-text-secondary hover:text-text-primary'}`}>
              <FileText size={14} />粘贴文字
            </button>
          </div>
        )}

        {mode === 'file' ? (
          isScript ? (
            <form
              method="post"
              encType="multipart/form-data"
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                void handleSubmit()
              }}
            >
              <input
                ref={fileInputRef}
                id={fileInputIdRef.current}
                name="file"
                type="file"
                accept={acceptTypes}
                onChange={handleFileChange}
                className="hidden"
                disabled={isUploading}
              />
              {!file ? (
                <label htmlFor={fileInputIdRef.current} className="border-2 border-dashed border-border-subtle rounded-xl p-8 text-center hover:border-accent-indigo/50 transition-colors cursor-pointer block">
                  <Upload className="w-8 h-8 mx-auto text-text-tertiary mb-3" />
                  <p className="text-text-secondary mb-1">点击选择脚本文件</p>
                  <p className="text-xs text-text-tertiary">{acceptHint}</p>
                </label>
              ) : (
                <div className="border border-border-subtle rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 bg-bg-elevated border-b border-border-subtle">
                    <span className="text-xs font-medium text-text-secondary">已选文件</span>
                  </div>
                  <div className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {isUploading ? (
                        <Loader2 className="w-4 h-4 animate-spin text-accent-indigo flex-shrink-0" />
                      ) : uploadError ? (
                        <AlertTriangle className="w-4 h-4 text-accent-coral flex-shrink-0" />
                      ) : (
                        <CheckCircle className="w-4 h-4 text-accent-green flex-shrink-0" />
                      )}
                      <FileText className="w-4 h-4 text-accent-indigo flex-shrink-0" />
                      <span className="flex-1 text-sm text-text-primary truncate">{file.name}</span>
                      <span className="text-xs text-text-tertiary">{formatSize(file.size)}</span>
                      {!isUploading && (
                        <button type="button" onClick={resetSelectedFile} className="p-1 hover:bg-bg-elevated rounded">
                          <XCircle className="w-4 h-4 text-text-tertiary" />
                        </button>
                      )}
                    </div>
                    {isUploading && (
                      <>
                        <div className="mt-2 ml-[30px] h-2 bg-bg-page rounded-full overflow-hidden">
                          <div className="h-full bg-accent-indigo rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
                        </div>
                        <p className="mt-1 ml-[30px] text-xs text-text-tertiary">上传中 {progress}%</p>
                      </>
                    )}
                    {uploadError && <p className="mt-1 ml-[30px] text-xs text-accent-coral">{uploadError}</p>}
                  </div>
                </div>
              )}
              <button
                type="submit"
                disabled={!canSubmit}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-accent-indigo to-[#4F46E5] text-white font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    上传中 {progress}%
                  </>
                ) : (
                  <>
                    <Upload className="w-5 h-5" />
                    提交脚本
                  </>
                )}
              </button>
            </form>
          ) : isSafariMode ? (
            <div className="space-y-4">
              <div className="border border-border-subtle rounded-xl p-4 space-y-2">
                <div className="text-sm font-medium text-text-primary">Safari 上传说明</div>
                <p className="text-sm text-text-secondary">
                  当前任务详情页的视频上传在 Safari 下兼容性不稳定，已切换到专用上传页处理。
                </p>
                <p className="text-xs text-text-tertiary">{acceptHint}</p>
              </div>
              <button
                type="button"
                onClick={() => router.push(
                  tenantId && tenantId !== 'default'
                    ? `/native-upload/task/${encodeURIComponent(taskId)}?tenant_id=${encodeURIComponent(tenantId)}`
                    : `/native-upload/task/${encodeURIComponent(taskId)}`
                )}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-accent-indigo to-[#4F46E5] text-white font-semibold hover:opacity-90 transition-opacity"
              >
                <Upload className="w-5 h-5" />
                前往专用上传页
              </button>
            </div>
          ) : (
            <form
              ref={videoFormRef}
              method="post"
              action={
                tenantId
                  ? `/api/task-video-upload-form?task_id=${encodeURIComponent(taskId)}&tenant_id=${encodeURIComponent(tenantId)}`
                  : `/api/task-video-upload-form?task_id=${encodeURIComponent(taskId)}`
              }
              encType="multipart/form-data"
              className="space-y-4"
            >
              <input type="hidden" name="task_id" value={taskId} />
              {tenantId ? <input type="hidden" name="tenant_id" value={tenantId} /> : null}
              <input type="hidden" name="file_type" value="video" />
              <input
                ref={fileInputRef}
                id={fileInputIdRef.current}
                name="file"
                type="file"
                accept={acceptTypes}
                onChange={handleFileChange}
                className="hidden"
              />
              {!file ? (
                <label htmlFor={fileInputIdRef.current} className="border-2 border-dashed border-border-subtle rounded-xl p-8 text-center hover:border-accent-indigo/50 transition-colors cursor-pointer block">
                  <Upload className="w-8 h-8 mx-auto text-text-tertiary mb-3" />
                  <p className="text-text-secondary mb-1">点击选择视频文件</p>
                  <p className="text-xs text-text-tertiary">{acceptHint}</p>
                </label>
              ) : (
                <div className="border border-border-subtle rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 bg-bg-elevated border-b border-border-subtle">
                    <span className="text-xs font-medium text-text-secondary">已选文件</span>
                  </div>
                  <div className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <CheckCircle className="w-4 h-4 text-accent-green flex-shrink-0" />
                      <FileText className="w-4 h-4 text-accent-indigo flex-shrink-0" />
                      <span className="flex-1 text-sm text-text-primary truncate">{file.name}</span>
                      <span className="text-xs text-text-tertiary">{formatSize(file.size)}</span>
                      {!isUploading && (
                        <button type="button" onClick={resetSelectedFile} className="p-1 hover:bg-bg-elevated rounded">
                          <XCircle className="w-4 h-4 text-text-tertiary" />
                        </button>
                      )}
                    </div>
                    {isUploading ? (
                      <>
                        <div className="mt-2 ml-[30px] h-2 bg-bg-page rounded-full overflow-hidden">
                          <div className="h-full bg-accent-indigo rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
                        </div>
                        <p className="mt-1 ml-[30px] text-xs text-text-tertiary">上传中 {progress}%</p>
                      </>
                    ) : (
                      <p className="mt-2 ml-[30px] text-xs text-text-tertiary">点击提交后开始上传，请保持当前页面打开</p>
                    )}
                    {uploadError && <p className="mt-1 ml-[30px] text-xs text-accent-coral">{uploadError}</p>}
                  </div>
                </div>
              )}
              <button
                type="button"
                onClick={handleVideoSubmitClick}
                disabled={!file || isUploading}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-accent-indigo to-[#4F46E5] text-white font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    上传中 {progress}%
                  </>
                ) : (
                  <>
                    <Upload className="w-5 h-5" />
                    提交视频
                  </>
                )}
              </button>
            </form>
          )
        ) : (
          /* 粘贴文字模式 */
          <>
            <div className="space-y-2">
              <textarea
                value={textContent}
                onChange={e => setTextContent(e.target.value)}
                placeholder="在此粘贴或输入脚本文字内容..."
                className="w-full min-h-[200px] p-4 bg-bg-elevated border border-border-subtle rounded-xl text-text-primary text-sm placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-indigo/50 resize-y"
                disabled={isUploading}
              />
              <div className="flex justify-between text-xs text-text-tertiary">
                <span>{textContent.trim().length < 10 ? `至少输入 10 个字（还差 ${10 - textContent.trim().length} 字）` : '可以提交'}</span>
                <span>{textContent.length} 字</span>
              </div>
              {uploadError && <p className="text-xs text-accent-coral">{uploadError}</p>}
            </div>

            <button
              type="button"
              onClick={() => { void handleSubmit() }}
              disabled={!canSubmit}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-accent-indigo to-[#4F46E5] text-white font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  上传中 {progress}%
                </>
              ) : (
                <>
                  <Upload className="w-5 h-5" />
                  提交脚本
                </>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function getDimensionLabel(key: string) {
  const labels: Record<string, string> = {
    legal: '法规合规', platform: '平台规则', brand_safety: '品牌安全', brief_match: 'Brief匹配', content_quality: '内容质量',
    '法规合规': '法规合规', '平台规则': '平台规则', '品牌安全': '品牌安全', 'Brief匹配': 'Brief匹配', '内容质量': '内容质量',
  }
  return labels[key] || key
}

function AIResultDetailSection({ task }: { task: TaskData }) {
  if (!task.aiResult) return null
  const { dimensions, sellingPointMatches, violations } = task.aiResult

  return (
    <div className="bg-bg-card rounded-2xl card-shadow">
      <div className="flex items-center justify-between p-4 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-accent-indigo" />
          <span className="text-base font-semibold text-text-primary">AI 审核结果</span>
        </div>
        <span className={cn('text-xl font-bold', task.aiResult.score >= 85 ? 'text-accent-green' : task.aiResult.score >= 70 ? 'text-yellow-400' : 'text-accent-coral')}>
          {task.aiResult.score}分
        </span>
      </div>
      <div className="p-4 space-y-4">
        {dimensions && (
          <div className="grid grid-cols-2 gap-3">
            {(['legal', 'platform', 'brand_safety', 'brief_match', 'content_quality'] as const).map(key => {
              const dim = dimensions[key]
              if (!dim) return null
              return (
                <div key={key} className={cn('p-3 rounded-xl border', dim.passed ? 'bg-accent-green/5 border-accent-green/20' : 'bg-accent-coral/5 border-accent-coral/20')}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-text-secondary">{getDimensionLabel(key)}</span>
                    {dim.passed ? <CheckCircle className="w-4 h-4 text-accent-green" /> : <XCircle className="w-4 h-4 text-accent-coral" />}
                  </div>
                  <span className={cn('text-lg font-bold', dim.passed ? (dim.score >= 85 ? 'text-accent-green' : 'text-yellow-400') : 'text-accent-coral')}>{dim.score}</span>
                  {dim.issue_count > 0 && <span className="text-xs text-text-tertiary ml-1">({dim.issue_count} 项问题)</span>}
                </div>
              )
            })}
          </div>
        )}
        {violations.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-text-primary mb-2 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-accent-coral" /> 违规检测 ({violations.length})
            </h4>
            <div className="space-y-2">
              {violations.map((v, idx) => (
                <div key={idx} className="p-3 bg-accent-coral/10 rounded-xl border border-accent-coral/30">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 rounded text-xs font-semibold bg-accent-coral/15 text-accent-coral">{getViolationTypeLabel(v.type)}</span>
                    {v.dimension && <span className="text-xs text-text-tertiary">{getDimensionLabel(v.dimension)}</span>}
                  </div>
                  <p className="text-sm text-text-primary">「{v.content}」</p>
                  <p className="text-xs text-accent-indigo mt-1">{v.suggestion}</p>
                </div>
              ))}
            </div>
          </div>
        )}
        {/* 卖点匹配列表 */}
        {sellingPointMatches && sellingPointMatches.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-text-primary mb-2 flex items-center gap-2">
              <Target className="w-4 h-4 text-accent-green" /> 卖点匹配详情
            </h4>
            <div className="space-y-2">
              {sellingPointMatches.map((sp, idx) => (
                <div key={idx} className="flex items-start gap-2 p-2.5 rounded-xl bg-bg-elevated">
                  {sp.matched ? <CheckCircle className="w-4 h-4 text-accent-green flex-shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 text-accent-coral flex-shrink-0 mt-0.5" />}
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-text-primary">{sp.content}</span>
                      <span className={cn('px-1.5 py-0.5 text-xs rounded',
                        sp.priority === 'core' ? 'bg-accent-coral/20 text-accent-coral' :
                        sp.priority === 'recommended' ? 'bg-accent-amber/20 text-accent-amber' :
                        'bg-bg-page text-text-tertiary'
                      )}>{sp.priority === 'core' ? '核心' : sp.priority === 'recommended' ? '推荐' : '参考'}</span>
                    </div>
                    {sp.evidence && <p className="text-xs text-text-tertiary mt-0.5">{sp.evidence}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ReviewFeedbackCard({ review, type }: { review: { result: string; comment: string; reviewer: string; time: string }; type: 'agency' | 'brand' }) {
  const isApproved = review.result === 'approved'
  const title = type === 'agency' ? '代理商审核意见' : '品牌方终审意见'
  return (
    <div className={cn('bg-bg-card rounded-2xl card-shadow border', isApproved ? 'border-accent-green/30' : 'border-accent-coral/30')}>
      <div className="flex items-center gap-2 p-4 border-b border-border-subtle">
        {isApproved ? <CheckCircle className="w-5 h-5 text-accent-green" /> : <XCircle className="w-5 h-5 text-accent-coral" />}
        <span className="text-base font-semibold text-text-primary">{title}</span>
      </div>
      <div className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="font-medium text-text-primary">{review.reviewer}</span>
          <span className={cn('px-2 py-0.5 rounded text-xs font-semibold', isApproved ? 'bg-accent-green/15 text-accent-green' : 'bg-accent-coral/15 text-accent-coral')}>
            {isApproved ? '通过' : '驳回'}
          </span>
        </div>
        {review.comment && <p className="text-sm text-text-secondary whitespace-pre-wrap">{review.comment}</p>}
        <p className="text-xs text-text-tertiary mt-2">{review.time}</p>
      </div>
    </div>
  )
}

function UploadView({ task, toast, briefData, onUploaded }: { task: TaskData; toast: ReturnType<typeof useToast>; briefData: BriefData; onUploaded: () => Promise<void> | void }) {
  const isScript = task.phase === 'script'

  return (
    <div className="flex flex-col gap-6 h-full">
      {isScript && <AgencyBriefSection toast={toast} briefData={briefData} />}
      <FileUploadSection taskId={task.id} phase={task.phase} onUploaded={onUploaded} />
    </div>
  )
}

function AIReviewingView({ task }: { task: TaskData }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="bg-bg-card rounded-2xl p-10 card-shadow flex flex-col items-center gap-8 w-full max-w-md">
        <div className="flex items-center gap-2 px-4 py-2 bg-bg-elevated rounded-lg">
          <Folder className="w-3.5 h-3.5 text-text-tertiary" />
          <span className="text-xs font-medium text-text-tertiary">
            {task.phase === 'script' ? '脚本内容审核' : '视频内容审核'} · 智能分析中
          </span>
        </div>
        <div className="relative w-[180px] h-[180px] flex items-center justify-center">
          <div className="absolute inset-0 rounded-full bg-gradient-radial from-accent-indigo/50 via-accent-indigo/20 to-transparent animate-pulse" />
          <div className="w-[72px] h-[72px] rounded-full bg-gradient-to-br from-accent-indigo to-[#4F46E5] flex items-center justify-center shadow-[0_0_24px_rgba(99,102,241,0.5)]">
            <Scan className="w-8 h-8 text-white animate-pulse" />
          </div>
        </div>
        <div className="flex flex-col items-center gap-2 w-full">
          <h2 className="text-[22px] font-semibold text-text-primary">
            AI 正在审核您的{task.phase === 'script' ? '脚本' : '视频'}
          </h2>
          <p className="text-sm text-text-secondary">预计还需 2-3 分钟，可先离开页面</p>
          <div className="flex items-center gap-3 w-full pt-3">
            <div className="flex-1 h-2 bg-bg-elevated rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-accent-indigo to-[#4F46E5] rounded-full transition-all duration-300" style={{ width: `${task.progress || 0}%` }} />
            </div>
            <span className="text-sm font-semibold text-accent-indigo">{task.progress || 0}%</span>
          </div>
        </div>
        {task.reviewLogs && task.reviewLogs.length > 0 && (
          <div className="w-full bg-bg-elevated rounded-xl p-5 flex flex-col gap-2.5">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-accent-green" />
              <span className="text-xs font-medium text-text-secondary">处理日志</span>
            </div>
            <div className="flex flex-col gap-2">
              {task.reviewLogs.map((log, index) => (
                <div key={index} className="flex items-center gap-2 text-xs">
                  <span className="text-text-tertiary font-mono">{log.time}</span>
                  <span className={cn(log.status === 'done' ? 'text-text-secondary' : log.status === 'loading' ? 'text-accent-indigo' : 'text-text-tertiary')}>
                    {log.message}
                  </span>
                  {log.status === 'loading' && <Loader2 className="w-3 h-3 text-accent-indigo animate-spin" />}
                </div>
              ))}
            </div>
          </div>
        )}
        <button type="button" className="flex items-center gap-2 px-6 py-3 rounded-xl bg-bg-page border border-border-subtle text-text-secondary text-[13px] font-medium">
          <Bell className="w-4 h-4" /> 完成后通过微信通知我
        </button>
      </div>
    </div>
  )
}

function RejectionView({ task, onAppeal, onReupload }: { task: TaskData; onAppeal: () => void; onReupload: () => void }) {
  const getTitle = () => {
    switch (task.stage) {
      case 'ai_result': return 'AI 审核结果'
      case 'agency_rejected': return '代理商审核驳回'
      case 'brand_rejected': return '品牌方审核驳回'
      default: return '审核结果'
    }
  }
  const getStatusText = () => {
    switch (task.stage) {
      case 'ai_result': return 'AI 检测到问题，请修改后重新上传'
      case 'agency_rejected': return '代理商审核驳回，请根据意见修改'
      case 'brand_rejected': return '品牌方审核驳回，请根据意见修改'
      default: return '需要修改'
    }
  }

  return (
    <div className="flex flex-col gap-6 h-full">
      <ReviewProgressBar task={task} />
      <div className="bg-bg-card rounded-2xl p-6 card-shadow">
        <div className="flex items-center gap-3 pb-5 border-b border-border-subtle">
          <div className="w-12 h-12 rounded-xl bg-accent-coral/15 flex items-center justify-center">
            <XCircle className="w-6 h-6 text-accent-coral" />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-lg font-semibold text-text-primary">{getTitle()}</span>
            <span className="text-sm text-accent-coral font-medium">{getStatusText()}</span>
          </div>
        </div>
        {task.rejectionReason && (
          <div className="py-4 border-b border-border-subtle">
            <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">{task.rejectionReason}</p>
          </div>
        )}
        <div className="flex items-center justify-between pt-4">
          {task.stage === 'ai_result' ? (
            <button type="button" onClick={onAppeal} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-bg-elevated border border-border-subtle text-text-secondary text-sm font-medium hover:bg-bg-page transition-colors">
              <MessageCircle className="w-[18px] h-[18px]" /> 申诉
            </button>
          ) : <div />}
          <button type="button" onClick={onReupload} className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-accent-green text-white text-sm font-semibold hover:bg-accent-green/90 transition-colors">
            <Upload className="w-[18px] h-[18px]" /> 重新上传
          </button>
        </div>
      </div>
      {task.stage === 'agency_rejected' && task.agencyReview && <ReviewFeedbackCard review={task.agencyReview} type="agency" />}
      {task.stage === 'brand_rejected' && task.brandReview && <ReviewFeedbackCard review={task.brandReview} type="brand" />}
      {task.stage === 'brand_rejected' && task.agencyReview && <ReviewFeedbackCard review={task.agencyReview} type="agency" />}
      <AIResultDetailSection task={task} />
    </div>
  )
}

function WaitingReviewView({ task }: { task: TaskData }) {
  const isAgency = task.stage === 'agency_reviewing'
  const title = isAgency ? '等待代理商审核' : '等待品牌方终审'
  const description = isAgency ? '您的内容已进入代理商审核环节，请耐心等待' : '您的内容已进入品牌方终审环节，这是最后一步'

  return (
    <div className="flex flex-col gap-6 h-full">
      <ReviewProgressBar task={task} />
      <div className="bg-bg-card rounded-2xl p-6 card-shadow">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-12 h-12 rounded-xl bg-accent-indigo/15 flex items-center justify-center">
            <Clock className="w-6 h-6 text-accent-indigo" />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-lg font-semibold text-text-primary">{title}</span>
            <span className="text-sm text-text-secondary">{description}</span>
          </div>
        </div>
        <div className="bg-bg-elevated rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-tertiary">提交时间</span>
            <span className="text-sm text-text-primary">{task.submittedAt || '刚刚'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-tertiary">AI审核</span>
            <span className="text-sm text-accent-green font-medium">已通过</span>
          </div>
          {isAgency && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-tertiary">代理商审核</span>
              <span className="text-sm text-accent-indigo font-medium">审核中...</span>
            </div>
          )}
          {!isAgency && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-tertiary">代理商审核</span>
                <span className="text-sm text-accent-green font-medium">已通过</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-tertiary">品牌方终审</span>
                <span className="text-sm text-accent-indigo font-medium">审核中...</span>
              </div>
            </>
          )}
        </div>
      </div>
      {!isAgency && task.agencyReview && <ReviewFeedbackCard review={task.agencyReview} type="agency" />}
      <AIResultDetailSection task={task} />
    </div>
  )
}

function ApprovedView({ task }: { task: TaskData }) {
  const isVideoPhase = task.phase === 'video'
  return (
    <div className="flex flex-col gap-6 h-full">
      <ReviewProgressBar task={task} />
      <div className="bg-bg-card rounded-2xl p-6 card-shadow">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-12 h-12 rounded-xl bg-accent-green/15 flex items-center justify-center">
            <CheckCircle className="w-6 h-6 text-accent-green" />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-lg font-semibold text-text-primary">{isVideoPhase ? '全部审核通过' : '脚本审核通过'}</span>
            <span className="text-sm text-text-secondary">{isVideoPhase ? '可以安排发布了' : '请在 7 天内上传视频'}</span>
          </div>
        </div>
        <div className="bg-accent-green/10 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-accent-green flex-shrink-0 mt-0.5" />
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-text-primary">{isVideoPhase ? '恭喜完成！' : '下一步'}</span>
              <span className="text-[13px] text-text-secondary">
                {isVideoPhase ? '您的视频已通过全部审核流程，可以在平台发布了。' : '脚本已通过审核，请在 7 天内上传对应视频。'}
              </span>
            </div>
          </div>
        </div>
      </div>
      {task.brandReview && <ReviewFeedbackCard review={task.brandReview} type="brand" />}
      {task.agencyReview && <ReviewFeedbackCard review={task.agencyReview} type="agency" />}
      <AIResultDetailSection task={task} />
      {!isVideoPhase && (
        <div className="flex justify-center pt-4">
          <button type="button" className="flex items-center gap-2 px-12 py-4 rounded-xl bg-accent-green text-white text-base font-semibold">
            <Video className="w-5 h-5" /> 上传视频 <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      )}
    </div>
  )
}

// ========== 主页面 ==========

export default function TaskDetailPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()
  const { subscribe } = useSSE()
  const taskId = normalizeTaskId(params.id)
  const handledUploadResultRef = useRef('')

  const [taskData, setTaskData] = useState<TaskData | null>(null)
  const [briefData, setBriefData] = useState<BriefData>(DEFAULT_BRIEF_DATA)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showReupload, setShowReupload] = useState(false)
  const creatorHomePath = '/creator'

  const resolveTaskIdFromList = useCallback(async (currentId: string): Promise<string> => {
    if (!currentId) return ''
    try {
      const response = await api.listTasks(1, 100)
      for (const item of response.items) {
        const rawItem = item as TaskResponse & Record<string, unknown>
        const itemId = cleanText(rawItem.id)
        const itemTaskId = cleanText(rawItem.task_id)
        const itemRelatedTaskId = cleanText(rawItem.related_task_id)
        const normalized = pickTaskId(rawItem)
        if (currentId === itemId || currentId === itemTaskId || currentId === itemRelatedTaskId) {
          if (normalized && normalized !== currentId) return normalized
        }
      }
    } catch {
      // 兜底流程失败时，继续使用原始错误提示
    }
    return ''
  }, [])

  const loadTask = useCallback(async () => {
    if (!taskId) {
      setError('任务 ID 无效')
      setIsLoading(false)
      return
    }

    setError(null)

    try {
      const task = await api.getTask(taskId)
      setTaskData(mapApiTaskToTaskData(task))

      // 加载 Brief
      if (task.project?.id) {
        try {
          const brief = await api.getBrief(task.project.id)
          setBriefData({
            files: (brief.attachments || []).map((a, i) => ({
              id: a.id || `att-${i}`,
              name: a.name,
              size: a.size || '',
              uploadedAt: brief.updated_at || '',
            })),
            sellingPoints: (brief.selling_points || []).map((sp, i) => ({
              id: `sp-${i}`,
              content: sp.content,
              priority: (sp.priority || (sp.required ? 'core' : 'recommended')) as 'core' | 'recommended' | 'reference',
            })),
            blacklistWords: (brief.blacklist_words || []).map((bw, i) => ({
              id: `bw-${i}`,
              word: bw.word,
              reason: bw.reason,
            })),
          })
        } catch {
          // Brief 可能不存在，不影响任务展示
        }
      }
    } catch (err) {
      const message = extractErrorMessage(err)
      const notFoundLike = message.includes('任务不存在') || message.includes('404')
      if (notFoundLike) {
        const resolvedTaskId = await resolveTaskIdFromList(taskId)
        if (resolvedTaskId) {
          router.replace(`/creator/task/${encodeURIComponent(resolvedTaskId)}`)
          return
        }
      }
      setError(`${message}（任务ID: ${taskId}）`)
    } finally {
      setIsLoading(false)
    }
  }, [taskId, resolveTaskIdFromList, router])

  useEffect(() => {
    loadTask()
  }, [loadTask])

  useEffect(() => {
    const status = searchParams.get('upload_status')
    const kind = searchParams.get('upload_kind')
    if (!status || kind !== 'video') return

    const message = searchParams.get('upload_message') || ''
    const key = `${status}:${kind}:${searchParams.get('upload_ts') || ''}:${message}`
    if (handledUploadResultRef.current === key) return
    handledUploadResultRef.current = key

    if (status === 'success') {
      toast.success(message || '视频已上传，正在启动 AI 审核')
    } else {
      toast.error(message || '视频上传失败，请重试')
    }

    if (typeof window !== 'undefined') {
      const cleanUrl = new URL(window.location.href)
      cleanUrl.searchParams.delete('upload_status')
      cleanUrl.searchParams.delete('upload_kind')
      cleanUrl.searchParams.delete('upload_message')
      cleanUrl.searchParams.delete('upload_ts')
      window.history.replaceState({}, '', cleanUrl.toString())
    }
  }, [searchParams, toast])

  // SSE 实时更新
  useEffect(() => {
    const unsub1 = subscribe('task_updated', (data) => {
      if (normalizeTaskId((data as { task_id?: string }).task_id) === taskId) loadTask()
    })
    const unsub2 = subscribe('review_completed', (data) => {
      if (normalizeTaskId((data as { task_id?: string }).task_id) === taskId) loadTask()
    })
    return () => { unsub1(); unsub2() }
  }, [subscribe, taskId, loadTask])

  // AI 审核中时轮询（SSE 后备方案）
  useEffect(() => {
    if (!taskData || (taskData.stage !== 'ai_reviewing')) return
    const interval = setInterval(() => { loadTask() }, 5000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskData?.stage, loadTask])

  if (isLoading) {
    return (
      <ResponsiveLayout role="creator">
        <div className="flex items-center justify-center h-full">
          <Loader2 className="w-8 h-8 text-accent-indigo animate-spin" />
        </div>
      </ResponsiveLayout>
    )
  }

  if (error || !taskData) {
    return (
      <ResponsiveLayout role="creator">
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center gap-4">
            <XCircle className="w-16 h-16 text-text-tertiary" />
            <p className="text-lg text-text-secondary">{error || '任务不存在'}</p>
            <button type="button" onClick={() => router.push(creatorHomePath)} className="px-6 py-2.5 rounded-xl bg-accent-indigo text-white text-sm font-medium">
              返回任务列表
            </button>
          </div>
        </div>
      </ResponsiveLayout>
    )
  }

  const handleAppeal = () => {
    router.push(`/creator/appeals/new?taskId=${encodeURIComponent(taskId)}`)
  }

  const renderContent = () => {
    // 驳回状态下选择重新上传时，显示上传界面
    if (showReupload && (taskData.stage === 'ai_result' || taskData.stage === 'agency_rejected' || taskData.stage === 'brand_rejected')) {
      return (
        <div className="flex flex-col gap-6 h-full">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setShowReupload(false)} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-elevated text-text-secondary text-sm hover:bg-bg-card transition-colors">
              <ArrowLeft className="w-4 h-4" /> 返回审核详情
            </button>
          </div>
          {taskData.phase === 'script' && <AgencyBriefSection toast={toast} briefData={briefData} />}
          <FileUploadSection taskId={taskData.id} phase={taskData.phase} onUploaded={() => { setShowReupload(false); loadTask() }} />
        </div>
      )
    }

    switch (taskData.stage) {
      case 'upload': return <UploadView task={taskData} toast={toast} briefData={briefData} onUploaded={loadTask} />
      case 'ai_reviewing': return <AIReviewingView task={taskData} />
      case 'ai_result':
      case 'agency_rejected':
      case 'brand_rejected': return <RejectionView task={taskData} onAppeal={handleAppeal} onReupload={() => setShowReupload(true)} />
      case 'agency_reviewing':
      case 'brand_reviewing': return <WaitingReviewView task={taskData} />
      case 'brand_approved': return <ApprovedView task={taskData} />
      default: return <div>未知状态</div>
    }
  }

  const getPageTitle = () => {
    switch (taskData.stage) {
      case 'upload': return taskData.phase === 'script' ? '上传脚本' : '上传视频'
      case 'ai_reviewing': return 'AI 智能审核'
      case 'ai_result': return 'AI 审核结果'
      case 'agency_reviewing': return '等待代理商审核'
      case 'agency_rejected': return '代理商审核驳回'
      case 'brand_reviewing': return '等待品牌方终审'
      case 'brand_approved': return '审核通过'
      case 'brand_rejected': return '品牌方审核驳回'
      default: return '任务详情'
    }
  }

  return (
    <ResponsiveLayout role="creator">
      <div className="flex flex-col gap-6 h-full">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3 mb-1">
              <button type="button" onClick={() => router.push(creatorHomePath)} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-elevated text-text-secondary text-sm hover:bg-bg-card transition-colors">
                <ArrowLeft className="w-4 h-4" /> 返回
              </button>
            </div>
            <h1 className="text-xl lg:text-[28px] font-bold text-text-primary">{taskData.title}</h1>
            <p className="text-sm lg:text-[15px] text-text-secondary">{taskData.subtitle}</p>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {renderContent()}
        </div>
      </div>
    </ResponsiveLayout>
  )
}
