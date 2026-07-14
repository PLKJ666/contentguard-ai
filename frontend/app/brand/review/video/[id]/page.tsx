'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { AudioRecognitionResult } from '@/components/ui/AudioRecognitionResult'
import { Modal, ConfirmModal } from '@/components/ui/Modal'
import { SuccessTag, WarningTag, ErrorTag } from '@/components/ui/Tag'
import { ReviewSteps, getBrandReviewSteps } from '@/components/ui/ReviewSteps'
import { getViolationTypeLabel, buildRejectComment, canReject } from '@/lib/reviewLabels'
import {
  ArrowLeft,
  Play,
  Pause,
  AlertTriangle,
  Shield,
  Radio,
  User,
  Building,
  Clock,
  CheckCircle,
  XCircle,
  MessageSquare,
  ExternalLink,
  MessageSquareWarning,
  Loader2,
  Sparkles,
  MessageSquarePlus,
  Star,
  FileCheck2,
} from 'lucide-react'
import { FileInfoCard, FilePreviewModal, type FileInfo } from '@/components/ui/FilePreview'
import { api, extractErrorMessage } from '@/lib/api'
import { formatTaskDisplayTitle } from '@/lib/taskDisplay'
import { normalizeSoftWarnings } from '@/lib/reviewWarnings'
import { getVideoSellingPointCoverage } from '@/lib/videoSellingPointCoverage'
import type { TaskResponse } from '@/types/task'

// ==================== 本地视图数据类型 ====================

interface VideoTaskView {
  id: string
  title: string
  creatorName: string
  agencyName: string
  projectName: string
  submittedAt: string
  duration: number
  aiScore: number
  status: string
  file: FileInfo
  isAppeal: boolean
  appealReason: string
  agencyReview: {
    reviewer: string
    result: string
    comment: string
    reviewedAt?: string
  }
  hardViolations: Array<{
    id: string
    type: string
    content: string
    timestamp: number
    source: string
    riskLevel: string
    aiConfidence: number
    suggestion: string
  }>
  sentimentWarnings: Array<{
    id: string
    type: string
    timestamp: number
    content: string
    riskLevel: string
  }>
  sellingPointsCovered: Array<{
    point: string
    covered: boolean
    timestamp: number
    note?: string
  }>
  aiSummary?: string
  speechTranscript?: string | null
  deliveryQuality?: { score?: number; engagement?: string; purchase_intent?: string; platform_fit?: string; overall?: string }
  audioTrackAnalysis?: NonNullable<TaskResponse['video_ai_result']>['audio_track_analysis'] | null
  brandExposure?: NonNullable<TaskResponse['video_ai_result']>['brand_exposure'] | null
  newContentAnalysis: Array<{ content: string; compliant: boolean; enhances: boolean; note: string }>
  scriptMatch?: {
    overall_score: number
    overall_assessment: string
    suggestion_for_reviewer?: string
    segments: Array<{ script_segment: string; segment_label: string; status: 'matched' | 'adapted' | 'missing' | 'reordered'; video_evidence?: string; note?: string }>
    structure_preserved: boolean
    missing_segments: string[]
    key_deviations: string[]
  } | null
}

// ==================== 工具函数 ====================

function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function formatDurationString(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

function formatExposureDuration(seconds?: number | null): string {
  if (seconds == null || Number.isNaN(seconds)) return '--'
  return `${seconds.toFixed(seconds >= 10 ? 0 : 1)} 秒`
}

function severityToRiskLevel(severity: string): string {
  if (severity === 'high' || severity === 'critical') return 'high'
  if (severity === 'medium') return 'medium'
  return 'low'
}

/** 将后端 TaskResponse 映射为本地视图数据 */
function mapTaskToView(task: TaskResponse): VideoTaskView {
  const aiResult = task.video_ai_result
  const normalizedWarnings = normalizeSoftWarnings(aiResult?.soft_warnings)

  const hardViolations = (aiResult?.violations || []).map((v, idx) => ({
    id: `v${idx}`,
    type: v.type,
    content: v.content,
    timestamp: v.timestamp ?? 0,
    source: v.source ?? 'unknown',
    riskLevel: severityToRiskLevel(v.severity),
    aiConfidence: 0.9,
    suggestion: v.suggestion,
  }))

  const sentimentWarnings = normalizedWarnings.map((w, idx) => ({
    id: `s${idx}`,
    type: w.label,
    timestamp: w.timestamp,
    content: w.content,
    riskLevel: 'low',
  }))

  const duration = task.video_duration || 0

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
    submittedAt: task.video_uploaded_at || task.created_at,
    duration,
    aiScore: task.video_ai_score || 0,
    status: task.stage,
    file: {
      id: task.id,
      fileName: task.video_file_name || '视频文件',
      fileSize: '',
      fileType: 'video/mp4',
      fileUrl: task.video_file_url || '',
      uploadedAt: task.video_uploaded_at || task.created_at,
      duration: formatDurationString(duration),
      thumbnail: task.video_thumbnail_url || undefined,
    },
    isAppeal: task.is_appeal,
    appealReason: task.appeal_reason || '',
    agencyReview: {
      reviewer: task.agency.name,
      result: task.video_agency_status === 'passed' || task.video_agency_status === 'force_passed' ? 'approved' : (task.video_agency_status || 'pending'),
      comment: task.video_agency_comment || '',
      reviewedAt: task.video_agency_reviewed_at || '',
    },
    hardViolations,
    sentimentWarnings,
    sellingPointsCovered: getVideoSellingPointCoverage(task.video_ai_result),
    aiSummary: aiResult?.summary,
    speechTranscript: aiResult?.speech_transcript || null,
    deliveryQuality: task.video_ai_result?.delivery_quality,
    audioTrackAnalysis: aiResult?.audio_track_analysis || null,
    brandExposure: aiResult?.brand_exposure || null,
    newContentAnalysis: (task.video_ai_result?.new_content_analysis || []).map(nc => ({
      content: nc.content || '',
      compliant: nc.compliant ?? true,
      enhances: nc.enhances ?? false,
      note: nc.note || '',
    })),
    scriptMatch: task.video_ai_result?.script_match || null,
  }
}

// ==================== 子组件 ====================

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

function RiskLevelTag({ level }: { level: string }) {
  if (level === 'high') return <ErrorTag>高风险</ErrorTag>
  if (level === 'medium') return <WarningTag>中风险</WarningTag>
  return <SuccessTag>低风险</SuccessTag>
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      {/* 顶部导航骨架 */}
      <div className="flex items-center gap-4">
        <div className="w-9 h-9 bg-bg-elevated rounded-full" />
        <div className="flex-1 space-y-2">
          <div className="h-6 w-48 bg-bg-elevated rounded" />
          <div className="h-4 w-72 bg-bg-elevated rounded" />
        </div>
      </div>
      {/* 流程进度骨架 */}
      <div className="h-20 bg-bg-elevated rounded-xl" />
      {/* 主体骨架 */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 space-y-4">
          <div className="h-16 bg-bg-elevated rounded-xl" />
          <div className="aspect-video bg-bg-elevated rounded-xl" />
          <div className="h-32 bg-bg-elevated rounded-xl" />
          <div className="h-24 bg-bg-elevated rounded-xl" />
        </div>
        <div className="lg:col-span-2 space-y-4">
          <div className="h-48 bg-bg-elevated rounded-xl" />
          <div className="h-32 bg-bg-elevated rounded-xl" />
          <div className="h-40 bg-bg-elevated rounded-xl" />
        </div>
      </div>
    </div>
  )
}

// ==================== 主页面 ====================

export default function BrandVideoReviewPage() {
  const router = useRouter()
  const params = useParams()
  const toast = useToast()
  const taskId = params.id as string

  const [task, setTask] = useState<VideoTaskView | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [showApproveModal, setShowApproveModal] = useState(false)
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [checkedViolations, setCheckedViolations] = useState<Record<string, boolean>>({})
  const [showFilePreview, setShowFilePreview] = useState(false)
  const [videoError, setVideoError] = useState(false)
  const [videoBlobUrl, setVideoBlobUrl] = useState<string | null>(null)

  // 通过后端代理获取视频 blob URL
  useEffect(() => {
    if (!task?.file?.fileUrl) return
    let cancelled = false
    api.getPreviewUrl(task.file.fileUrl)
      .then(url => { if (!cancelled) setVideoBlobUrl(url) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [task?.file?.fileUrl])

  // 加载任务数据
  const loadTask = useCallback(async () => {
    if (!taskId) return

    try {
      setLoading(true)
      const response = await api.getTask(taskId)
      setTask(mapTaskToView(response))
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

  // 通过审核
  const handleApprove = async () => {
    if (submitting) return
    setSubmitting(true)

    try {
      await api.reviewVideo(taskId, { action: 'pass', comment: '' })
      setShowApproveModal(false)
      toast.success('审核通过！')
      router.push('/brand/review')
    } catch (err) {
      const message = extractErrorMessage(err)
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  // 驳回审核
  const handleReject = async () => {
    if (!canReject(checkedViolations, rejectReason)) {
      toast.error('请勾选问题或填写驳回原因')
      return
    }
    if (submitting) return
    setSubmitting(true)
    const comment = buildRejectComment(checkedViolations, task!.hardViolations, rejectReason)

    try {
      await api.reviewVideo(taskId, { action: 'reject', comment })
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

  // 加载中状态
  if (loading || !task) {
    return <LoadingSkeleton />
  }

  // 计算问题时间点用于进度条展示
  const timelineMarkers = [
    ...task.hardViolations.map(v => ({ time: v.timestamp, type: 'hard' as const })),
    ...task.sentimentWarnings.filter(w => w.timestamp > 0).map(w => ({ time: w.timestamp, type: 'soft' as const })),
    ...task.sellingPointsCovered.filter(s => s.covered && s.timestamp > 0).map(s => ({ time: s.timestamp, type: 'selling' as const })),
  ].sort((a, b) => a.time - b.time)

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

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* 左侧：视频播放器 (3/5) */}
        <div className="lg:col-span-3 space-y-4">
          {/* 文件信息卡片 */}
          <FileInfoCard
            file={task.file}
            onPreview={() => setShowFilePreview(true)}
          />

          <Card>
            <CardContent className="p-0">
              {/* 真实视频播放器 */}
              <div className="aspect-video bg-gray-900 rounded-t-lg overflow-hidden relative">
                {videoError ? (
                  <div className="w-full h-full flex items-center justify-center">
                    <div className="text-center">
                      <Play size={48} className="mx-auto text-white/50 mb-3" />
                      <p className="text-white/70 mb-3">视频加载失败</p>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={async () => {
                          try {
                            const url = videoBlobUrl || await api.getPreviewUrl(task.file.fileUrl)
                            window.open(url, '_blank')
                          } catch {
                            window.open(task.file.fileUrl, '_blank')
                          }
                        }}
                      >
                        <ExternalLink size={14} />
                        在新标签页打开
                      </Button>
                    </div>
                  </div>
                ) : (
                  <video
                    className="w-full h-full"
                    controls
                    poster={task.file.thumbnail}
                    onError={() => setVideoError(true)}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                  >
                    <source src={videoBlobUrl || task.file.fileUrl} type={task.file.fileType} />
                    您的浏览器不支持视频播放
                  </video>
                )}
              </div>
              {/* 智能进度条 */}
              {task.duration > 0 && (
                <div className="p-4 border-t border-border-subtle">
                  <div className="text-sm font-medium text-text-primary mb-3">智能进度条（点击跳转）</div>
                  <div className="relative h-3 bg-bg-elevated rounded-full">
                    {/* 时间标记点 */}
                    {timelineMarkers.map((marker, idx) => (
                      <button
                        key={idx}
                        type="button"
                        className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-bg-card shadow-md cursor-pointer transition-transform hover:scale-125 ${
                          marker.type === 'hard' ? 'bg-accent-coral' : marker.type === 'soft' ? 'bg-orange-500' : 'bg-accent-green'
                        }`}
                        style={{ left: `${(marker.time / task.duration) * 100}%` }}
                        title={`${formatTimestamp(marker.time)} - ${marker.type === 'hard' ? '硬性问题' : marker.type === 'soft' ? '舆情提示' : '卖点覆盖'}`}
                      />
                    ))}
                  </div>
                  <div className="flex justify-between text-xs text-text-tertiary mt-1">
                    <span>0:00</span>
                    <span>{formatTimestamp(task.duration)}</span>
                  </div>
                  <div className="flex gap-4 mt-3 text-xs text-text-secondary">
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-3 bg-accent-coral rounded-full" />
                      硬性问题
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-3 bg-orange-500 rounded-full" />
                      舆情提示
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-3 h-3 bg-accent-green rounded-full" />
                      卖点覆盖
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 代理商初审意见 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare size={18} className="text-blue-500" />
                代理商初审意见
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-start gap-4">
                <div className={`p-2 rounded-full ${task.agencyReview.result === 'approved' ? 'bg-accent-green/20' : 'bg-accent-coral/20'}`}>
                  {task.agencyReview.result === 'approved' ? (
                    <CheckCircle size={20} className="text-accent-green" />
                  ) : (
                    <XCircle size={20} className="text-accent-coral" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-text-primary">{task.agencyReview.reviewer}</span>
                    {task.agencyReview.result === 'approved' ? (
                      <SuccessTag>建议通过</SuccessTag>
                    ) : (
                      <ErrorTag>建议驳回</ErrorTag>
                    )}
                  </div>
                  <p className="text-text-secondary text-sm">{task.agencyReview.comment || '暂无评论'}</p>
                  {task.agencyReview.reviewedAt && (
                    <p className="text-xs text-text-tertiary mt-2">{task.agencyReview.reviewedAt}</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* AI 分析总结 */}
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-text-primary">AI 分析总结</span>
                <span className={`text-xl font-bold ${task.aiScore >= 80 ? 'text-accent-green' : 'text-yellow-400'}`}>
                  {task.aiScore}分
                </span>
              </div>
              <p className="text-text-secondary text-sm">
                {task.aiSummary || `视频整体合规，发现${task.hardViolations.length}处硬性问题和${task.sentimentWarnings.length}处舆情提示，代理商已确认处理。`}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* 右侧：AI 检查单 (2/5) */}
        <div className="lg:col-span-2 space-y-4">
          {/* 高危违规 */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Shield size={16} className="text-red-500" />
                高危违规 ({task.hardViolations.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {task.hardViolations.length === 0 && (
                <p className="text-sm text-text-tertiary py-2">未发现高危违规问题</p>
              )}
              {task.hardViolations.map((v) => (
                <div key={v.id} className={`p-3 rounded-lg border ${checkedViolations[v.id] ? 'bg-bg-elevated border-border-subtle' : 'bg-accent-coral/10 border-accent-coral/30'}`}>
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={checkedViolations[v.id] || false}
                      onChange={() => setCheckedViolations((prev) => ({ ...prev, [v.id]: !prev[v.id] }))}
                      className="mt-1 accent-accent-indigo"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <ErrorTag>{getViolationTypeLabel(v.type)}</ErrorTag>
                        {v.timestamp > 0 && (
                          <span className="text-xs text-text-tertiary">{formatTimestamp(v.timestamp)}</span>
                        )}
                      </div>
                      <p className="text-sm font-medium text-text-primary">{v.content}</p>
                      <p className="text-xs text-accent-indigo mt-1">{v.suggestion}</p>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* 舆情雷达 */}
          {task.sentimentWarnings.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Radio size={16} className="text-orange-500" />
                  舆情雷达（仅提示）
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {task.sentimentWarnings.map((w) => (
                  <div key={w.id} className="p-3 bg-orange-500/10 rounded-lg border border-orange-500/30">
                    <div className="flex items-center gap-2 mb-1">
                      <WarningTag>{getViolationTypeLabel(w.type)}</WarningTag>
                      {w.timestamp > 0 && (
                        <span className="text-xs text-text-tertiary">{formatTimestamp(w.timestamp)}</span>
                      )}
                    </div>
                    <p className="text-sm text-orange-400">{w.content}</p>
                    <p className="text-xs text-text-tertiary mt-1">软性风险仅作提示，不强制拦截</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* 卖点覆盖 */}
          {task.sellingPointsCovered.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <CheckCircle size={16} className="text-accent-green" />
                  卖点覆盖
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {task.sellingPointsCovered.map((sp, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-bg-elevated">
                    <div className="flex items-center gap-2">
                      {sp.covered ? (
                        <CheckCircle size={16} className="text-accent-green" />
                      ) : (
                        <XCircle size={16} className="text-accent-coral" />
                      )}
                      <span className="text-sm text-text-primary">{sp.point}</span>
                    </div>
                    {sp.covered && sp.timestamp > 0 && (
                      <span className="text-xs text-text-tertiary">{formatTimestamp(sp.timestamp)}</span>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* 口播质量评估 */}
          <AudioRecognitionResult
            audioTrackAnalysis={task.audioTrackAnalysis}
            transcript={task.speechTranscript}
          />

          {task.deliveryQuality && task.deliveryQuality.overall && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Sparkles size={16} className="text-accent-indigo" />口播质量评估</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {task.deliveryQuality.score != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-text-secondary">口播评分</span>
                    <span className={`text-lg font-bold ${task.deliveryQuality.score >= 80 ? 'text-accent-green' : task.deliveryQuality.score >= 60 ? 'text-accent-amber' : 'text-accent-coral'}`}>{task.deliveryQuality.score}</span>
                  </div>
                )}
                <p className="text-sm text-text-primary">{task.deliveryQuality.overall}</p>
                <div className="grid grid-cols-1 gap-2">
                  {task.deliveryQuality.engagement && (
                    <div className="p-2 bg-bg-elevated rounded-lg">
                      <span className="text-xs text-text-tertiary">感染力</span>
                      <p className="text-sm text-text-primary mt-0.5">{task.deliveryQuality.engagement}</p>
                    </div>
                  )}
                  {task.deliveryQuality.purchase_intent && (
                    <div className="p-2 bg-bg-elevated rounded-lg">
                      <span className="text-xs text-text-tertiary">购买欲</span>
                      <p className="text-sm text-text-primary mt-0.5">{task.deliveryQuality.purchase_intent}</p>
                    </div>
                  )}
                  {task.deliveryQuality.platform_fit && (
                    <div className="p-2 bg-bg-elevated rounded-lg">
                      <span className="text-xs text-text-tertiary">平台适配</span>
                      <p className="text-sm text-text-primary mt-0.5">{task.deliveryQuality.platform_fit}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {task.brandExposure && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><FileCheck2 size={16} className="text-accent-indigo" />品牌曝光分析</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 gap-2">
                  <div className="p-2 bg-bg-elevated rounded-lg flex items-center justify-between">
                    <span className="text-xs text-text-tertiary">品牌出镜时长</span>
                    <span className="text-sm font-semibold text-text-primary">{formatExposureDuration(task.brandExposure.visible_duration_seconds)}</span>
                  </div>
                  <div className="p-2 bg-bg-elevated rounded-lg flex items-center justify-between">
                    <span className="text-xs text-text-tertiary">品牌提及时长</span>
                    <span className="text-sm font-semibold text-text-primary">{formatExposureDuration(task.brandExposure.mention_duration_seconds)}</span>
                  </div>
                  <div className="p-2 bg-bg-elevated rounded-lg flex items-center justify-between">
                    <span className="text-xs text-text-tertiary">品牌相关时长</span>
                    <span className="text-sm font-semibold text-text-primary">{formatExposureDuration(task.brandExposure.related_duration_seconds)}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-secondary">曝光评分</span>
                  <span className="text-lg font-bold text-text-primary">{task.brandExposure.score ?? '--'}</span>
                </div>
                {task.brandExposure.analysis && <p className="text-sm text-text-primary">{task.brandExposure.analysis}</p>}
              </CardContent>
            </Card>
          )}

          {/* 新增内容分析 */}
          {task.newContentAnalysis.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><MessageSquarePlus size={16} className="text-purple-400" />新增内容分析 ({task.newContentAnalysis.length})</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {task.newContentAnalysis.map((nc, idx) => (
                  <div key={idx} className={`p-3 rounded-lg border ${!nc.compliant ? 'bg-accent-coral/10 border-accent-coral/30' : nc.enhances ? 'bg-accent-green/5 border-accent-green/20' : 'bg-bg-elevated border-border-subtle'}`}>
                    <div className="flex items-center gap-2 mb-1">
                      {!nc.compliant ? <XCircle size={14} className="text-accent-coral" /> : nc.enhances ? <Star size={14} className="text-accent-green" /> : <AlertTriangle size={14} className="text-text-tertiary" />}
                      <span className={`text-xs ${!nc.compliant ? 'text-accent-coral' : nc.enhances ? 'text-accent-green' : 'text-text-tertiary'}`}>
                        {!nc.compliant ? '有合规风险' : nc.enhances ? '增彩内容' : '中性内容'}
                      </span>
                    </div>
                    <p className="text-sm text-text-primary">「{nc.content}」</p>
                    {nc.note && <p className="text-xs text-text-secondary mt-1">{nc.note}</p>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* 脚本匹配度 */}
          {task.scriptMatch && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="flex items-center gap-2">
                    <FileCheck2 size={16} className="text-sky-400" />
                    脚本匹配度
                  </span>
                  <span className={`text-lg font-bold ${task.scriptMatch.overall_score >= 90 ? 'text-accent-green' : task.scriptMatch.overall_score >= 70 ? 'text-accent-amber' : task.scriptMatch.overall_score >= 50 ? 'text-orange-400' : 'text-accent-coral'}`}>
                    {task.scriptMatch.overall_score}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-text-primary">{task.scriptMatch.overall_assessment}</p>
                {task.scriptMatch.suggestion_for_reviewer && (
                  <div className="p-2.5 bg-sky-500/10 border border-sky-500/20 rounded-lg">
                    <p className="text-xs text-sky-400 font-medium mb-0.5">审核员建议</p>
                    <p className="text-sm text-text-secondary">{task.scriptMatch.suggestion_for_reviewer}</p>
                  </div>
                )}
                {task.scriptMatch.segments.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs text-text-tertiary font-medium">段落明细</p>
                    {task.scriptMatch.segments.map((seg, idx) => (
                      <div key={idx} className={`p-2.5 rounded-lg border ${seg.status === 'matched' ? 'bg-accent-green/5 border-accent-green/20' : seg.status === 'adapted' ? 'bg-accent-amber/5 border-accent-amber/20' : seg.status === 'missing' ? 'bg-accent-coral/5 border-accent-coral/20' : 'bg-purple-500/5 border-purple-500/20'}`}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${seg.status === 'matched' ? 'bg-accent-green/20 text-accent-green' : seg.status === 'adapted' ? 'bg-accent-amber/20 text-accent-amber' : seg.status === 'missing' ? 'bg-accent-coral/20 text-accent-coral' : 'bg-purple-500/20 text-purple-400'}`}>
                            {seg.status === 'matched' ? '匹配' : seg.status === 'adapted' ? '改编' : seg.status === 'missing' ? '缺失' : '乱序'}
                          </span>
                          <span className="text-xs text-text-tertiary">{seg.segment_label}</span>
                        </div>
                        <p className="text-sm text-text-secondary">「{seg.script_segment}」</p>
                        {seg.video_evidence && <p className="text-xs text-text-tertiary mt-1">视频: {seg.video_evidence}</p>}
                        {seg.note && <p className="text-xs text-text-tertiary mt-0.5">{seg.note}</p>}
                      </div>
                    ))}
                  </div>
                )}
                {(task.scriptMatch.missing_segments.length > 0 || task.scriptMatch.key_deviations.length > 0) && (
                  <div className="pt-2 border-t border-border-subtle space-y-2">
                    {task.scriptMatch.missing_segments.length > 0 && (
                      <div>
                        <p className="text-xs text-accent-coral font-medium mb-1">遗漏段落</p>
                        <div className="flex flex-wrap gap-1">
                          {task.scriptMatch.missing_segments.map((ms, idx) => (
                            <span key={idx} className="text-xs px-2 py-0.5 bg-accent-coral/10 text-accent-coral rounded">{ms}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {task.scriptMatch.key_deviations.length > 0 && (
                      <div>
                        <p className="text-xs text-accent-amber font-medium mb-1">主要偏离</p>
                        {task.scriptMatch.key_deviations.map((kd, idx) => (
                          <p key={idx} className="text-xs text-text-secondary">· {kd}</p>
                        ))}
                      </div>
                    )}
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
              已检查 {Object.values(checkedViolations).filter(Boolean).length}/{task.hardViolations.length} 个问题
            </div>
            <div className="flex gap-3">
              <Button variant="danger" onClick={() => setShowRejectModal(true)} disabled={submitting}>
                {submitting ? <Loader2 size={16} className="animate-spin mr-1" /> : null}
                驳回
              </Button>
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
        message="确定要通过此视频的审核吗？通过后达人将收到通知。"
        confirmText={submitting ? '提交中...' : '确认通过'}
      />

      {/* 驳回弹窗 */}
      <Modal isOpen={showRejectModal} onClose={() => setShowRejectModal(false)} title="驳回审核">
        <div className="space-y-4">
          <p className="text-text-secondary text-sm">请填写驳回原因，已勾选的问题将自动打包发送给达人。</p>
          <div className="p-3 bg-bg-elevated rounded-lg">
            <p className="text-sm font-medium text-text-primary mb-2">已选问题 ({Object.values(checkedViolations).filter(Boolean).length})</p>
            {task.hardViolations.filter(v => checkedViolations[v.id]).map(v => (
              <div key={v.id} className="text-sm text-text-secondary">- {getViolationTypeLabel(v.type)}: {v.content}</div>
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
