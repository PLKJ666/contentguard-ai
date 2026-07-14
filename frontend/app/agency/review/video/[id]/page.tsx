'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useParams, usePathname } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { AudioRecognitionResult } from '@/components/ui/AudioRecognitionResult'
import { CreatorGuidanceBoardPreview, CreatorGuidanceCandidatePicker } from '@/components/ui/CreatorGuidanceBoard'
import { Modal, ConfirmModal } from '@/components/ui/Modal'
import { SuccessTag, WarningTag, ErrorTag } from '@/components/ui/Tag'
import { ReviewSteps, getAgencyReviewSteps } from '@/components/ui/ReviewSteps'
import { getViolationTypeLabel, buildRejectComment, canReject } from '@/lib/reviewLabels'
import { formatTaskDisplayTitle } from '@/lib/taskDisplay'
import {
  ArrowLeft,
  Play,
  Pause,
  Shield,
  Radio,
  User,
  Clock,
  CheckCircle,
  XCircle,
  Download,
  ExternalLink,
  MessageSquareWarning,
  Loader2,
  Sparkles,
  MessageSquarePlus,
  Star,
  AlertTriangle,
  FileCheck2,
  Bot
} from 'lucide-react'
import { FileInfoCard, FilePreviewModal, type FileInfo } from '@/components/ui/FilePreview'
import { api, extractErrorMessage } from '@/lib/api'
import { exportNodeAsPng } from '@/lib/exportNodeAsPng'
import { normalizeSoftWarnings } from '@/lib/reviewWarnings'
import { getVideoSellingPointCoverage } from '@/lib/videoSellingPointCoverage'
import { cn } from '@/lib/utils'
import type {
  CreatorCardContent,
  CreatorImageGeneration,
  CreatorVisualBrief,
  ReviewCandidate,
  TaskResponse,
} from '@/types/task'

type GuidanceFeedbackType = 'layout' | 'style' | 'tone' | 'content_density' | 'other'

const FEEDBACK_TYPE_OPTIONS: Array<{
  value: GuidanceFeedbackType
  label: string
  hint: string
}> = [
  { value: 'layout', label: '版式', hint: '改横竖版、时间轴位置、信息区块结构' },
  { value: 'style', label: '风格', hint: '改插图气质、漫画感、品牌感' },
  { value: 'tone', label: '语气', hint: '改说人话程度、语气软硬、达人感受' },
  { value: 'content_density', label: '信息密度', hint: '改多一点还是更精简' },
  { value: 'other', label: '其他', hint: '不属于上面几类的补充要求' },
]

const FEEDBACK_TYPE_LABELS: Record<GuidanceFeedbackType, string> = {
  layout: '版式',
  style: '风格',
  tone: '语气',
  content_density: '信息密度',
  other: '其他',
}

function getFeedbackPlaceholder(feedbackType: GuidanceFeedbackType): string {
  switch (feedbackType) {
    case 'layout':
      return '例如：时间轴再明显一点，改成横版，左右两段更像分镜。'
    case 'style':
      return '例如：插图再像漫画分镜一点，减少后台感，产品锚点更突出。'
    case 'tone':
      return '例如：不要像在教达人，改成更像编导在提修改意见。'
    case 'content_density':
      return '例如：每页信息再少一点，每段只保留最关键的两句。'
    default:
      return '例如：第二页再轻一点，产品图换成更明确的包装展示。'
  }
}

function buildCreatorGuidanceExportName(
  taskTitle: string,
  creatorName: string,
  iterationNo?: number | null,
  extension?: string
): string {
  const parts = [taskTitle, creatorName, '达人修改图'].filter(Boolean)
  if (iterationNo && iterationNo > 0) {
    parts.push(`第${iterationNo}轮`)
  }
  const baseName = parts.join('-')
  return extension ? `${baseName}.${extension}` : baseName
}

function buildCreatorGuidancePrintHtml(params: {
  title: string
  pages: Array<{ page_index: number; image_url: string; page_summary?: string }>
}): string {
  const pageMarkup = params.pages.map((page) => `
    <section class="sheet">
      <header class="sheet-header">
        <div class="sheet-title">第 ${page.page_index} 页</div>
        <div class="sheet-summary">${page.page_summary || '达人修改图'}</div>
      </header>
      <img class="sheet-image" src="${page.image_url}" alt="达人修改图第 ${page.page_index} 页" />
    </section>
  `).join('')

  return `<!doctype html>
  <html lang="zh-CN">
    <head>
      <meta charset="utf-8" />
      <title>${params.title}</title>
      <style>
        @page { size: A4 portrait; margin: 10mm; }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          background: #f6f2ea;
          color: #1f2937;
        }
        .sheet {
          break-after: page;
          page-break-after: always;
          padding: 12px 0 0;
        }
        .sheet:last-child {
          break-after: auto;
          page-break-after: auto;
        }
        .sheet-header {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 12px;
          margin-bottom: 12px;
          font-size: 12px;
          color: #6b7280;
        }
        .sheet-title {
          font-size: 16px;
          font-weight: 700;
          color: #111827;
        }
        .sheet-summary {
          text-align: right;
        }
        .sheet-image {
          width: 100%;
          display: block;
          border-radius: 18px;
          border: 1px solid #e5e7eb;
          box-shadow: 0 8px 30px rgba(15, 23, 42, 0.08);
        }
      </style>
    </head>
    <body>${pageMarkup}</body>
  </html>`
}

function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function formatExposureDuration(seconds?: number | null): string {
  if (seconds == null || Number.isNaN(seconds)) return '--'
  return `${seconds.toFixed(seconds >= 10 ? 0 : 1)} 秒`
}

function guessVideoMimeType(fileName?: string | null): string {
  if (!fileName) return 'video/mp4'
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  const mimeMap: Record<string, string> = {
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    avi: 'video/x-msvideo',
    mkv: 'video/x-matroska',
  }
  return mimeMap[ext] || 'video/mp4'
}

function mapTaskToViewModel(task: TaskResponse) {
  const normalizedWarnings = normalizeSoftWarnings(task.video_ai_result?.soft_warnings)
  const violations = (task.video_ai_result?.violations || []).map((v, idx) => ({
    id: `v${idx + 1}`,
    type: v.type,
    content: v.content,
    timestamp: v.timestamp ?? 0,
    suggestion: v.suggestion,
  }))
  return {
    id: task.id,
    title: formatTaskDisplayTitle({
      taskName: task.name,
      projectName: task.project?.name,
      sequence: task.sequence,
    }),
    creatorName: task.creator?.name || '未知达人',
    submittedAt: task.video_uploaded_at || task.created_at,
    duration: task.video_duration ?? 0,
    aiScore: task.video_ai_score ?? 0,
    status: task.stage,
    file: {
      id: `file-${task.id}`,
      fileName: task.video_file_name || '未知文件',
      fileSize: '',
      fileType: guessVideoMimeType(task.video_file_name),
      fileUrl: task.video_file_url || '',
      uploadedAt: task.video_uploaded_at || task.created_at,
      thumbnail: task.video_thumbnail_url || '',
      duration: task.video_duration ? formatTimestamp(task.video_duration) : undefined,
    } as FileInfo,
    isAppeal: task.is_appeal,
    appealReason: task.appeal_reason || '',
    hardViolations: violations,
    sentimentWarnings: normalizedWarnings.map((w, idx) => ({
      id: `s${idx + 1}`,
      type: w.label,
      timestamp: w.timestamp,
      content: w.content,
    })),
    sellingPointsCovered: getVideoSellingPointCoverage(task.video_ai_result),
    aiSummary: task.video_ai_result?.summary || '',
    speechTranscript: task.video_ai_result?.speech_transcript || null,
    audioTrackAnalysis: task.video_ai_result?.audio_track_analysis || null,
    reviewCandidates: task.video_ai_result?.review_candidates || [],
    selectedCandidateIds: task.video_ai_result?.creator_guidance_selected_candidate_ids || [],
    creatorCardContent: task.video_ai_result?.creator_card_content || null,
    creatorVisualBrief: task.video_ai_result?.creator_visual_brief || null,
    creatorImageGeneration: task.video_ai_result?.creator_image_generation || null,
    brandExposure: task.video_ai_result?.brand_exposure || null,
    deliveryQuality: task.video_ai_result?.delivery_quality,
    newContentAnalysis: (task.video_ai_result?.new_content_analysis || []).map(nc => ({
      content: nc.content || '',
      compliant: nc.compliant ?? true,
      enhances: nc.enhances ?? false,
      note: nc.note || '',
    })),
    scriptMatch: task.video_ai_result?.script_match || null,
  }
}

type VideoTaskViewModel = ReturnType<typeof mapTaskToViewModel>

const DEFAULT_TASK: VideoTaskViewModel = {
  id: '',
  title: '',
  creatorName: '',
  submittedAt: '',
  duration: 0,
  aiScore: 0,
  status: 'video_agency_review',
  file: {
    id: '',
    fileName: '',
    fileSize: '',
    fileType: 'video/mp4',
    fileUrl: '',
    uploadedAt: '',
    thumbnail: '',
    duration: undefined,
  } as FileInfo,
  isAppeal: false,
  appealReason: '',
  hardViolations: [],
  sentimentWarnings: [],
  sellingPointsCovered: [],
  aiSummary: '',
  speechTranscript: null,
  audioTrackAnalysis: null,
  reviewCandidates: [],
  selectedCandidateIds: [],
  creatorCardContent: null,
  creatorVisualBrief: null,
  creatorImageGeneration: null,
  brandExposure: null,
  deliveryQuality: undefined,
  newContentAnalysis: [],
  scriptMatch: null,
}

export default function AgencyVideoReviewPage() {
  const router = useRouter()
  const pathname = usePathname() || ''
  const toast = useToast()
  const params = useParams()
  const taskId = params.id as string
  const isOperatorMode = pathname.startsWith('/operator/')
  const reviewListPath = pathname.startsWith('/operator/') ? '/operator/tasks' : '/agency/review'

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [checkedViolations, setCheckedViolations] = useState<Record<string, boolean>>({})
  const [showApproveModal, setShowApproveModal] = useState(false)
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [videoBlobUrl, setVideoBlobUrl] = useState<string | null>(null)
  const [task, setTask] = useState<VideoTaskViewModel>(DEFAULT_TASK)
  const [reviewCandidates, setReviewCandidates] = useState<ReviewCandidate[]>([])
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([])
  const [guidanceGenerating, setGuidanceGenerating] = useState(false)
  const [pngExporting, setPngExporting] = useState(false)
  const [imageExporting, setImageExporting] = useState(false)
  const [layoutVariant, setLayoutVariant] = useState<'portrait' | 'landscape'>('portrait')
  const [styleVariant, setStyleVariant] = useState('editorial_comic_guidance')
  const [feedbackType, setFeedbackType] = useState<GuidanceFeedbackType>('other')
  const [feedbackInstruction, setFeedbackInstruction] = useState('')
  const guidanceBoardPreviewRef = useRef<HTMLDivElement | null>(null)
  const guidanceBoardExportRef = useRef<HTMLDivElement | null>(null)

  const loadTask = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.getTask(taskId)
      const mappedTask = mapTaskToViewModel(data)
      setTask(mappedTask)
      setReviewCandidates(mappedTask.reviewCandidates || [])
      const availableCandidateIds = new Set((mappedTask.reviewCandidates || []).map((item) => item.id))
      const persistedSelectedIds = (mappedTask.selectedCandidateIds || []).filter((id) => availableCandidateIds.has(id))
      setSelectedCandidateIds(
        persistedSelectedIds.length
          ? persistedSelectedIds
          : (mappedTask.reviewCandidates || []).map((item) => item.id)
      )
    } catch (err: any) {
      toast.error(extractErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [taskId, toast])

  useEffect(() => { loadTask() }, [loadTask])

  useEffect(() => {
    if (!task?.file?.fileUrl) return
    api.getPreviewUrl(task.file.fileUrl).then(setVideoBlobUrl).catch(() => {})
  }, [task?.file?.fileUrl])

  useEffect(() => {
    const generation = task.creatorImageGeneration as CreatorImageGeneration | null | undefined
    if (!generation) return
    setLayoutVariant(generation.layout_variant || 'portrait')
    setStyleVariant(generation.style_variant || 'editorial_comic_guidance')
    const latestFeedback = generation.feedback_history?.[generation.feedback_history.length - 1]
    setFeedbackType((latestFeedback?.feedback_type as GuidanceFeedbackType) || 'other')
  }, [task.creatorImageGeneration])

  const handleToggleCandidate = (candidateId: string) => {
    setSelectedCandidateIds((prev) => (
      prev.includes(candidateId)
        ? prev.filter((item) => item !== candidateId)
        : [...prev, candidateId]
    ))
  }

  const handleCandidateChange = (candidateId: string, patch: Partial<ReviewCandidate>) => {
    setReviewCandidates((prev) => prev.map((item) => (
      item.id === candidateId
        ? { ...item, ...patch }
        : item
    )))
  }

  const handleGenerateGuidanceBoard = async (targetPage?: number) => {
    const selectedCandidates = reviewCandidates.filter((item) => selectedCandidateIds.includes(item.id))
    if (selectedCandidates.length === 0) {
      toast.error('请先选择至少一条修改建议')
      return
    }

    setGuidanceGenerating(true)
    try {
      const updatedTask = await api.generateCreatorGuidanceBoard(taskId, {
        candidates: selectedCandidates,
        layout_variant: layoutVariant,
        style_variant: styleVariant,
        feedback_instruction: feedbackInstruction.trim() || undefined,
        feedback_type: feedbackType,
        target_page: targetPage,
      })
      const mappedTask = mapTaskToViewModel(updatedTask)
      setTask((prev) => ({
        ...prev,
        ...mappedTask,
        reviewCandidates,
        creatorCardContent: mappedTask.creatorCardContent,
        creatorVisualBrief: mappedTask.creatorVisualBrief,
        creatorImageGeneration: mappedTask.creatorImageGeneration,
      }))
      setSelectedCandidateIds(selectedCandidates.map((item) => item.id))
      setFeedbackInstruction('')
      toast.success(targetPage ? `第 ${targetPage} 页已重刷` : '达人修改图已生成')
    } catch (err: any) {
      toast.error(extractErrorMessage(err))
    } finally {
      setGuidanceGenerating(false)
    }
  }

  const handleExportGuidanceBoard = () => {
    if (!task.creatorCardContent) {
      toast.error('请先生成达人修改图，再导出')
      return
    }
    window.print()
  }

  const handleExportGuidanceBoardPng = async () => {
    if (!task.creatorCardContent || !guidanceBoardExportRef.current) {
      toast.error('请先生成达人修改图，再导出')
      return
    }

    setPngExporting(true)
    try {
      await exportNodeAsPng(guidanceBoardExportRef.current, `${task.title} 达人修改图`)
      toast.success('PNG 已导出')
    } catch (err: any) {
      toast.error(err?.message || 'PNG 导出失败')
    } finally {
      setPngExporting(false)
    }
  }

  const handleDownloadGeneratedImagePage = async (
    page: NonNullable<CreatorImageGeneration['generated_pages']>[number],
    options?: { silent?: boolean }
  ) => {
    if (!page.image_url) {
      toast.error('当前页还没有可下载的图片')
      return
    }

    try {
      const ext = page.image_url.includes('.webp') ? 'webp' : page.image_url.includes('.jpg') || page.image_url.includes('.jpeg') ? 'jpg' : 'png'
      const fileName = `${buildCreatorGuidanceExportName(
        task.title,
        task.creatorName,
        creatorImageGeneration?.iteration_no,
      )}-第${page.page_index}页.${ext}`
      await api.downloadFile(page.image_url, fileName)
      if (!options?.silent) {
        toast.success(`第 ${page.page_index} 页已开始下载`)
      }
    } catch (err: any) {
      toast.error(extractErrorMessage(err) || '图片下载失败')
    }
  }

  const handleExportGeneratedImages = async () => {
    if (!creatorImageGeneration?.generated_pages?.length) {
      toast.error('请先生成 AI 图片，再导出')
      return
    }

    setImageExporting(true)
    try {
      const blob = await api.exportCreatorGuidanceBoard(taskId)
      const downloadUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = downloadUrl
      anchor.download = buildCreatorGuidanceExportName(
        task.title,
        task.creatorName,
        creatorImageGeneration?.iteration_no,
        'zip'
      )
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      URL.revokeObjectURL(downloadUrl)
      toast.success('达人修改图 ZIP 已导出')
    } catch (err: any) {
      toast.error(extractErrorMessage(err) || 'ZIP 导出失败')
    } finally {
      setImageExporting(false)
    }
  }

  const handleExportGeneratedImagesPdf = () => {
    const pages = creatorImageGeneration?.generated_pages || []
    if (!pages.length) {
      toast.error('请先生成 AI 图片，再导出')
      return
    }

    const printWindow = window.open('', '_blank', 'noopener,noreferrer')
    if (!printWindow) {
      toast.error('当前浏览器拦截了打印窗口，请允许弹窗后重试')
      return
    }

    const title = buildCreatorGuidanceExportName(
      task.title,
      task.creatorName,
      creatorImageGeneration?.iteration_no
    )
    printWindow.document.open()
    printWindow.document.write(
      buildCreatorGuidancePrintHtml({
        title,
        pages: pages.map((page) => ({
          page_index: page.page_index,
          image_url: page.image_url,
          page_summary: page.page_summary,
        })),
      })
    )
    printWindow.document.close()
    printWindow.focus()
    window.setTimeout(() => {
      printWindow.print()
    }, 300)
  }

  const handleApprove = async () => {
    setSubmitting(true)
    try {
      await api.reviewVideo(taskId, { action: 'pass' })
      toast.success(isOperatorMode ? '视频审核已通过，任务完成' : '已提交终审')
      router.push(reviewListPath)
    } catch (err: any) { toast.error(extractErrorMessage(err)) }
    finally { setSubmitting(false) }
  }

  const handleReject = async () => {
    if (!canReject(checkedViolations, rejectReason)) { toast.error('请勾选问题或填写理由'); return }
    const comment = buildRejectComment(checkedViolations, task.hardViolations, rejectReason)
    setSubmitting(true)
    try {
      await api.reviewVideo(taskId, { action: 'reject', comment })
      toast.success('已驳回')
      router.push(reviewListPath)
    } catch (err: any) { toast.error(extractErrorMessage(err)) }
    finally { setSubmitting(false) }
  }

  const timelineMarkers = [
    ...task.hardViolations.map((v: any) => ({ time: v.timestamp, type: 'hard' as const })),
    ...task.sentimentWarnings.map((w: any) => ({ time: w.timestamp, type: 'soft' as const })),
  ].sort((a, b) => a.time - b.time)
  const creatorVisualBrief = task.creatorVisualBrief as CreatorVisualBrief | null
  const creatorImageGeneration = task.creatorImageGeneration as CreatorImageGeneration | null
  const structuredGuidanceReady = Boolean(task.creatorCardContent || creatorVisualBrief)
  const structuredGuidancePageCount = Math.max(creatorVisualBrief?.page_plan?.page_count || 0, structuredGuidanceReady ? 1 : 0)

  if (loading) return <div className="p-8 animate-pulse text-text-tertiary">同步视频数据中...</div>

  return (
    <div className="max-w-[1600px] mx-auto pb-32">
      <style jsx global>{`
        @media print {
          @page {
            size: A4 landscape;
            margin: 10mm;
          }

          body * {
            visibility: hidden !important;
          }

          .guidance-board-export-root,
          .guidance-board-export-root * {
            visibility: visible !important;
          }

          .guidance-board-export-root {
            position: fixed !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            max-width: none !important;
            margin: 0 !important;
            box-shadow: none !important;
            border: 0 !important;
            print-color-adjust: exact !important;
            -webkit-print-color-adjust: exact !important;
          }
        }
      `}</style>
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-5">
          <button type="button" onClick={() => router.back()} className="p-2.5 bg-bg-card border border-border-subtle hover:bg-bg-elevated rounded-xl shadow-sm transition-all text-text-primary"><ArrowLeft size={18} /></button>
          <div className="text-left">
            <h1 className="text-2xl font-bold text-text-primary tracking-tight">{task.title}</h1>
            <div className="flex items-center gap-4 mt-1 text-sm text-text-secondary">
              <span className="flex items-center gap-1.5"><User size={14} />{task.creatorName}</span>
              <span className="flex items-center gap-1.5"><Clock size={14} />{task.submittedAt}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            icon={Download}
            className="bg-bg-card border-border-subtle"
            onClick={structuredGuidancePageCount > 1 ? handleExportGuidanceBoard : handleExportGuidanceBoardPng}
            disabled={!structuredGuidanceReady}
            loading={structuredGuidancePageCount > 1 ? false : pngExporting}
          >
            {structuredGuidancePageCount > 1 ? '导出 PDF' : '导出 PNG'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={Download}
            className="bg-bg-card border-border-subtle"
            onClick={structuredGuidancePageCount > 1 ? handleExportGuidanceBoardPng : handleExportGuidanceBoard}
            disabled={!structuredGuidanceReady}
            loading={structuredGuidancePageCount > 1 ? pngExporting : false}
          >
            {structuredGuidancePageCount > 1 ? '导出 PNG 长图' : '导出 PDF / 打印'}
          </Button>
        </div>
      </div>

      {task.isAppeal && (
        <div className="p-5 rounded-2xl bg-accent-amber/5 border border-accent-amber/20 mb-8 backdrop-blur-sm relative overflow-hidden text-left">
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-accent-amber" />
          <p className="text-sm text-accent-amber font-bold mb-1 flex items-center gap-2"><MessageSquareWarning size={16} /> 达人申诉理由</p>
          <p className="text-text-primary/80 text-sm italic">&quot;{task.appealReason}&quot;</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-7 space-y-6">
          <FileInfoCard file={task.file} onPreview={() => {}} />
          <Card className="overflow-hidden border border-border-subtle bg-black/40 backdrop-blur-md shadow-xl">
            <CardContent className="p-0">
              <div className="aspect-video bg-black flex items-center justify-center relative">
                <video className="w-full h-full" controls poster={task.file.thumbnail}><source src={videoBlobUrl || task.file.fileUrl} /></video>
              </div>
              <div className="p-6 bg-bg-card border-t border-border-subtle">
                <div className="flex items-center justify-between mb-4"><h3 className="text-[12px] font-black text-text-tertiary uppercase tracking-widest flex items-center gap-2"><Bot size={14} className="text-accent-indigo" /> AI 智能打点</h3></div>
                <div className="relative h-2 bg-bg-page rounded-full mb-2">
                  {timelineMarkers.map((marker, idx) => (
                    <div key={idx} className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-bg-card z-10 ${marker.type === 'hard' ? 'bg-accent-coral' : 'bg-orange-500'}`} style={{ left: `${(marker.time / (task.duration || 1)) * 100}%` }} />
                  ))}
                </div>
                <div className="flex justify-between text-[10px] font-mono text-text-tertiary"><span>0:00</span><span>{formatTimestamp(task.duration)}</span></div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-bg-card border border-border-subtle">
            <CardContent className="py-5 px-6 text-left">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2"><div className="w-8 h-8 rounded-lg bg-accent-indigo/10 flex items-center justify-center text-accent-indigo"><Sparkles size={16} /></div><span className="font-bold text-text-primary text-lg">AI 综合诊断</span></div>
                <span className={`text-2xl font-black ${task.aiScore >= 80 ? 'text-accent-green' : 'text-accent-amber'}`}>{task.aiScore}<span className="text-sm font-normal opacity-40 ml-1">/ 100</span></span>
              </div>
              <p className="text-text-secondary text-sm leading-relaxed border-l-2 border-accent-indigo/30 pl-4">{task.aiSummary || '视频评估完成，请在右侧查看详细合规报告。'}</p>
            </CardContent>
          </Card>

          <AudioRecognitionResult
            audioTrackAnalysis={task.audioTrackAnalysis}
            transcript={task.speechTranscript}
          />

          {!isOperatorMode && task.brandExposure && (
            <Card className="bg-bg-card border border-border-subtle">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Star size={18} className="text-accent-indigo" />
                  品牌曝光分析
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-left">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3 rounded-lg bg-bg-elevated">
                    <div className="text-xs text-text-tertiary mb-1">品牌出镜时长</div>
                    <div className="text-sm font-semibold text-text-primary">{formatExposureDuration(task.brandExposure.visible_duration_seconds)}</div>
                  </div>
                  <div className="p-3 rounded-lg bg-bg-elevated">
                    <div className="text-xs text-text-tertiary mb-1">品牌提及时长</div>
                    <div className="text-sm font-semibold text-text-primary">{formatExposureDuration(task.brandExposure.mention_duration_seconds)}</div>
                  </div>
                  <div className="p-3 rounded-lg bg-bg-elevated">
                    <div className="text-xs text-text-tertiary mb-1">品牌相关时长</div>
                    <div className="text-sm font-semibold text-text-primary">{formatExposureDuration(task.brandExposure.related_duration_seconds)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-text-tertiary">曝光评分</span>
                  <span className="font-semibold text-text-primary">{task.brandExposure.score ?? '--'}</span>
                  <span className="text-text-tertiary">等级</span>
                  <span className="font-semibold text-text-primary">{task.brandExposure.level || '--'}</span>
                </div>
                {task.brandExposure.analysis && <p className="text-sm text-text-secondary leading-relaxed">{task.brandExposure.analysis}</p>}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="lg:col-span-5 sticky top-8 space-y-6 max-h-[calc(100vh-140px)] overflow-y-auto pr-2 custom-scrollbar pb-10">
          <Card className="border-l-4 border-l-accent-coral border-border-subtle text-left">
            <CardHeader className="bg-accent-coral/5 px-6 py-4 border-none rounded-t-2xl"><CardTitle className="text-[14px] font-black tracking-widest uppercase flex items-center gap-3 text-accent-coral"><Shield size={18} /> 严重违规项 ({task.hardViolations.length})</CardTitle></CardHeader>
            <CardContent className="space-y-4 p-6 pt-4">
              {task.hardViolations.map((v: any) => (
                <div key={v.id} className={cn("p-4 rounded-xl border transition-all text-left", checkedViolations[v.id] ? 'bg-bg-elevated border-border-subtle grayscale-[0.5]' : 'bg-bg-card border-border-subtle hover:border-accent-coral/20')}>
                  <div className="flex items-start gap-3">
                    <input type="checkbox" checked={checkedViolations[v.id] || false} onChange={() => setCheckedViolations(prev => ({ ...prev, [v.id]: !prev[v.id] }))} className="w-5 h-5 rounded border-border-strong accent-accent-indigo mt-1" />
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2"><ErrorTag size="sm">{getViolationTypeLabel(v.type)}</ErrorTag><span className="text-[10px] font-mono font-bold text-accent-indigo">{formatTimestamp(v.timestamp)}</span></div>
                      <p className="text-[14px] font-semibold text-text-primary">{v.content}</p>
                      <p className="text-[12px] text-accent-indigo italic">💡 建议：{v.suggestion}</p>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {!isOperatorMode && (
          <Card className="border-border-subtle text-left">
            <CardHeader className="bg-accent-green/5 px-6 py-4 border-none"><CardTitle className="text-[14px] font-black tracking-widest uppercase text-accent-green flex items-center gap-3"><CheckCircle size={18} /> 卖点覆盖率</CardTitle></CardHeader>
            <CardContent className="p-6 pt-4 space-y-2.5">
              {task.sellingPointsCovered.length === 0 ? (
                <p className="text-sm text-text-tertiary text-center py-4">暂无卖点覆盖数据</p>
              ) : (
                task.sellingPointsCovered.map((sp: any, idx: number) => (
                  <div key={idx} className={cn("flex items-center justify-between p-3.5 rounded-xl border border-border-subtle", sp.covered ? "bg-accent-green/5 border-accent-green/20" : "bg-bg-elevated/50 opacity-60")}>
                    <div className="flex items-start gap-3">
                      {sp.covered ? <CheckCircle size={16} className="text-accent-green mt-0.5" /> : <XCircle size={16} className="text-text-tertiary mt-0.5" />}
                      <div>
                        <div className="text-sm font-bold text-text-primary">{sp.point}</div>
                        {sp.note ? <div className="text-xs text-text-tertiary mt-1">{sp.note}</div> : null}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
          )}

          <CreatorGuidanceCandidatePicker
            candidates={reviewCandidates}
            selectedIds={selectedCandidateIds}
            onToggle={handleToggleCandidate}
            onChange={handleCandidateChange}
            onGenerate={handleGenerateGuidanceBoard}
            generating={guidanceGenerating}
          />

          <Card className="border-border-subtle text-left">
            <CardHeader className="bg-accent-indigo/5 px-6 py-4 border-none">
              <CardTitle className="text-[14px] font-black tracking-widest uppercase flex items-center gap-3 text-accent-indigo">
                <MessageSquarePlus size={18} />
                生图偏好与迭代
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 pt-4 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <div className="mb-1 text-xs font-bold uppercase tracking-widest text-text-tertiary">版式方向</div>
                  <select
                    value={layoutVariant}
                    onChange={(event) => setLayoutVariant(event.target.value as 'portrait' | 'landscape')}
                    className="w-full rounded-xl border border-border-subtle bg-bg-card px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-indigo/40 focus:ring-2 focus:ring-accent-indigo/15"
                  >
                    <option value="portrait">竖版 4:5</option>
                    <option value="landscape">横版 16:9</option>
                  </select>
                </label>
                <label className="block">
                  <div className="mb-1 text-xs font-bold uppercase tracking-widest text-text-tertiary">插图风格</div>
                  <select
                    value={styleVariant}
                    onChange={(event) => setStyleVariant(event.target.value)}
                    className="w-full rounded-xl border border-border-subtle bg-bg-card px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-indigo/40 focus:ring-2 focus:ring-accent-indigo/15"
                  >
                    <option value="editorial_comic_guidance">漫画编辑感</option>
                    <option value="premium_brand_story">品牌提案感</option>
                    <option value="light_diagram_guidance">图解说明感</option>
                  </select>
                </label>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-bold uppercase tracking-widest text-text-tertiary">反馈维度</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {FEEDBACK_TYPE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setFeedbackType(option.value)}
                      className={cn(
                        'rounded-xl border px-3 py-3 text-left transition-all',
                        feedbackType === option.value
                          ? 'border-accent-indigo bg-accent-indigo/8 shadow-sm'
                          : 'border-border-subtle bg-bg-card hover:border-accent-indigo/30'
                      )}
                    >
                      <div className="text-sm font-semibold text-text-primary">{option.label}</div>
                      <div className="mt-1 text-xs leading-5 text-text-secondary">{option.hint}</div>
                    </button>
                  ))}
                </div>
              </div>

              <label className="block">
                <div className="mb-1 text-xs font-bold uppercase tracking-widest text-text-tertiary">本轮反馈</div>
                <textarea
                  value={feedbackInstruction}
                  onChange={(event) => setFeedbackInstruction(event.target.value)}
                  rows={3}
                  placeholder={getFeedbackPlaceholder(feedbackType)}
                  className="w-full rounded-xl border border-border-subtle bg-bg-card px-3 py-2 text-sm leading-relaxed text-text-primary outline-none focus:border-accent-indigo/40 focus:ring-2 focus:ring-accent-indigo/15"
                />
              </label>

              <div className="rounded-xl border border-border-subtle bg-bg-elevated/60 px-4 py-3 text-xs leading-6 text-text-secondary">
                上面的偏好会和候选项一起提交给后端，生成新的 `creator_visual_brief`、迭代记录和 AI 图片页。需要局部调整时，可以直接重刷单页。
              </div>
            </CardContent>
          </Card>

          <Card className="border-border-subtle text-left">
            <CardHeader className="bg-accent-green/5 px-6 py-4 border-none">
              <CardTitle className="text-[14px] font-black tracking-widest uppercase flex items-center gap-3 text-accent-green">
                <FileCheck2 size={18} />
                生图准备数据
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 pt-4 space-y-4">
              {creatorVisualBrief ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl bg-bg-elevated/60 p-4">
                      <div className="text-xs font-black uppercase tracking-widest text-text-tertiary">当前状态</div>
                      <div className="mt-2 text-sm font-semibold text-text-primary">
                        {creatorImageGeneration?.status || 'draft'}
                      </div>
                      <div className="mt-1 text-xs text-text-secondary">
                        第 {creatorImageGeneration?.iteration_no || 1} 轮 · {creatorImageGeneration?.layout_variant === 'landscape' ? '横版' : '竖版'}
                      </div>
                    </div>
                    <div className="rounded-xl bg-bg-elevated/60 p-4">
                      <div className="text-xs font-black uppercase tracking-widest text-text-tertiary">分页计划</div>
                      <div className="mt-2 text-sm font-semibold text-text-primary">
                        {creatorVisualBrief.page_plan.page_count} 页 · 每页 {creatorVisualBrief.page_plan.max_main_blocks_per_page} 个主时间段
                      </div>
                      <div className="mt-1 text-xs text-text-secondary">
                        比例 {creatorVisualBrief.page_plan.ratio} · 风格 {creatorImageGeneration?.style_variant || styleVariant}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border-subtle bg-bg-card px-4 py-3">
                    <div className="text-xs font-black uppercase tracking-widest text-text-tertiary">主标题</div>
                    <div className="mt-2 text-sm font-semibold text-text-primary">
                      {creatorVisualBrief.meta.page_title}
                    </div>
                    <div className="mt-1 text-xs text-text-secondary">
                      {creatorVisualBrief.current_video_context.current_video_summary}
                    </div>
                  </div>

                  <div className="rounded-xl border border-border-subtle bg-bg-card px-4 py-3">
                    <div className="text-xs font-black uppercase tracking-widest text-text-tertiary">必须保留信息</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(creatorVisualBrief.reference_context.must_keep_terms || []).slice(0, 6).map((item) => (
                        <span key={item} className="rounded-full bg-accent-indigo/10 px-3 py-1 text-xs font-semibold text-accent-indigo">
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="text-xs font-black uppercase tracking-widest text-text-tertiary">时间段修改块</div>
                    {creatorVisualBrief.timeline_blocks.slice(0, 4).map((block) => (
                      <div key={block.block_id} className="rounded-xl border border-border-subtle bg-bg-card px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-text-primary">{block.segment_title}</div>
                          <span className="rounded-full bg-bg-elevated px-2.5 py-1 text-[11px] font-bold text-text-secondary">
                            {block.time_range}
                          </span>
                        </div>
                        <div className="mt-2 text-sm leading-6 text-text-secondary">问题：{block.current_problem}</div>
                        <div className="mt-1 text-sm leading-6 text-text-primary">改法：{block.content_task}</div>
                      </div>
                    ))}
                  </div>

                  {creatorImageGeneration?.feedback_history?.length ? (
                    <div className="rounded-xl border border-border-subtle bg-bg-card px-4 py-3">
                      <div className="text-xs font-black uppercase tracking-widest text-text-tertiary">最近反馈</div>
                      <div className="mt-2 space-y-2">
                        {creatorImageGeneration.feedback_history.slice(-2).reverse().map((item, index) => (
                          <div key={`${item.iteration_no}-${index}`} className="text-sm leading-6 text-text-secondary">
                            第 {item.iteration_no} 轮 · {FEEDBACK_TYPE_LABELS[(item.feedback_type as GuidanceFeedbackType) || 'other']}：{item.instruction}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="rounded-2xl border border-dashed border-border-subtle p-5 text-sm leading-relaxed text-text-tertiary">
                  生成达人修改图后，会在这里展示 `creator_visual_brief`、分页计划和迭代状态，作为后续 AI 生图的输入基础。
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border-subtle text-left">
            <CardHeader className="bg-accent-green/5 px-6 py-4 border-none">
              <CardTitle className="text-[14px] font-black tracking-widest uppercase flex items-center gap-3 text-accent-green">
                <Sparkles size={18} />
                模型试画记录
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 pt-4">
              <div className="mb-4 rounded-xl border border-accent-amber/20 bg-accent-amber/5 px-4 py-3 text-sm leading-6 text-accent-amber">
                这些图只保留给内部看模型试跑效果，不是最终发给达人的成稿。对外请以下面的固定排版成稿为准。
              </div>
              {creatorImageGeneration?.generated_pages?.length ? (
                <details className="group rounded-2xl border border-border-subtle bg-bg-card">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3">
                    <div>
                      <div className="text-sm font-semibold text-text-primary">展开内部试画记录</div>
                      <div className="mt-1 text-xs text-text-secondary">
                        共 {creatorImageGeneration.generated_pages.length} 页，默认收起，避免干扰成稿查看。
                      </div>
                    </div>
                    <div className="text-xs font-semibold text-text-tertiary transition-transform group-open:rotate-180">
                      ∨
                    </div>
                  </summary>
                  <div className="space-y-4 border-t border-border-subtle px-4 py-4">
                    {creatorImageGeneration.generated_pages.map((page) => (
                      <div key={page.page_index} className="rounded-2xl border border-border-subtle bg-bg-elevated/50 p-4">
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-text-primary">
                              第 {page.page_index} 页
                            </div>
                            <div className="mt-1 text-xs leading-5 text-text-secondary">
                              {page.page_summary || 'AI 生图结果'}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={guidanceGenerating}
                              onClick={() => handleGenerateGuidanceBoard(page.page_index)}
                              className="border border-border-subtle"
                            >
                              重刷这页
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={imageExporting}
                              onClick={() => handleDownloadGeneratedImagePage(page)}
                              className="border border-border-subtle"
                            >
                              下载本页
                            </Button>
                          </div>
                        </div>
                        <div className="overflow-hidden rounded-2xl border border-border-subtle bg-bg-card">
                          <img
                            src={page.image_url}
                            alt={`达人修改图第 ${page.page_index} 页`}
                            className="block h-auto max-h-[540px] w-full object-contain"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              ) : (
                <div className="rounded-2xl border border-dashed border-border-subtle p-5 text-sm leading-relaxed text-text-tertiary">
                  这里保留模型试画记录，只作为参考。最终发给达人的成稿，请以下面的固定排版“达人修改图成稿”为准。
                </div>
              )}
              {creatorImageGeneration?.fallback_reason ? (
                <div className="mt-4 rounded-xl border border-accent-coral/20 bg-accent-coral/5 px-4 py-3 text-sm leading-6 text-accent-coral">
                  生图回退原因：{creatorImageGeneration.fallback_reason}
                </div>
              ) : null}
            </CardContent>
          </Card>

        </div>
      </div>

      <div className="mt-8">
        <CreatorGuidanceBoardPreview
          content={task.creatorCardContent as CreatorCardContent | null}
          visualBrief={creatorVisualBrief}
          containerRef={guidanceBoardPreviewRef}
        />
      </div>

      {structuredGuidanceReady ? (
        <div className="pointer-events-none fixed -left-[9999px] top-0" aria-hidden="true">
          <CreatorGuidanceBoardPreview
            content={task.creatorCardContent as CreatorCardContent | null}
            visualBrief={creatorVisualBrief}
            containerRef={guidanceBoardExportRef}
            mode="export"
          />
        </div>
      ) : null}

      <div className="fixed bottom-8 left-[calc(260px+2rem)] right-8 z-modal flex justify-center animate-slide-up">
        <div className="max-w-4xl w-full bg-bg-card/90 backdrop-blur-2xl border border-border-subtle rounded-2xl shadow-elevated p-4 px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6 text-left">
              <div className="flex flex-col"><span className="text-[10px] font-black text-text-tertiary uppercase tracking-widest">检查进度</span><span className="text-sm font-bold text-text-primary">{Object.values(checkedViolations).filter(Boolean).length} / {task.hardViolations.length}</span></div>
              <div className="h-8 w-px bg-border-subtle" /><div className="flex flex-col"><span className="text-[10px] font-black text-text-tertiary uppercase tracking-widest">当前状态</span><span className="text-sm font-bold text-accent-indigo font-bold">等待裁决</span></div>
            </div>
            <div className="flex gap-4">
              <Button variant="ghost" size="lg" onClick={() => setShowRejectModal(true)} disabled={submitting} className="hover:text-accent-coral px-8 border border-border-subtle hover:border-accent-coral/30">驳回</Button>
              <Button variant="primary" size="lg" onClick={() => setShowApproveModal(true)} disabled={submitting} className="shadow-indigo px-10 font-black">{isOperatorMode ? '通过' : '通过审核'}</Button>
            </div>
          </div>
        </div>
      </div>

      <ConfirmModal isOpen={showApproveModal} onClose={() => setShowApproveModal(false)} onConfirm={handleApprove} title="确认通过" message={isOperatorMode ? '确定通过此视频审核吗？通过后任务将直接完成。' : '确定通过此审核吗？'} confirmText="确认通过" />
      <Modal isOpen={showRejectModal} onClose={() => setShowRejectModal(false)} title="驳回审核">
        <div className="space-y-4 text-left">
          <textarea className="w-full h-24 p-3 bg-bg-elevated border border-border-subtle rounded-lg text-sm text-text-primary focus:ring-2 focus:ring-accent-indigo outline-none" placeholder="补充驳回原因..." value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
          <div className="flex justify-end gap-3"><Button variant="ghost" onClick={() => setShowRejectModal(false)}>取消</Button><Button variant="danger" onClick={handleReject} disabled={submitting}>确认驳回</Button></div>
        </div>
      </Modal>
      <FilePreviewModal file={task.file} isOpen={false} onClose={() => {}} />
    </div>
  )
}
