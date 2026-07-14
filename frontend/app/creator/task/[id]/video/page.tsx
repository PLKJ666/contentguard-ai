'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { AudioRecognitionResult } from '@/components/ui/AudioRecognitionResult'
import { SuccessTag, WarningTag, ErrorTag } from '@/components/ui/Tag'
import { ReviewSteps, getReviewSteps } from '@/components/ui/ReviewSteps'
import { getViolationTypeLabel } from '@/lib/reviewLabels'
import {
  ArrowLeft, Upload, Video, CheckCircle, XCircle, AlertTriangle, Sparkles, MessageSquarePlus,
  Clock, Loader2, RefreshCw, Play, Radio, Shield, Mic, FileText, ArrowRight, Zap, Star, FileCheck2
} from 'lucide-react'
import { api, extractErrorMessage } from '@/lib/api'
import { normalizeSoftWarnings } from '@/lib/reviewWarnings'
import { getVideoSellingPointCoverage } from '@/lib/videoSellingPointCoverage'
import { useSSE } from '@/contexts/SSEContext'
import type { TaskResponse } from '@/types/task'

// ========== 类型 ==========
type SpeechViolation = {
  type: string
  content: string
  severity: string
  suggestion: string
  script_text?: string
  actual_text?: string
}

type VideoTaskUI = {
  projectName: string
  brandName: string
  videoStatus: string
  videoFile: string | null
  aiAutoRejected?: boolean
  aiRejectReason?: string
  aiResult: null | {
    score: number
    hardViolations: Array<{ type: string; content: string; timestamp: number; suggestion: string }>
    sentimentWarnings: Array<{ type: string; content: string; timestamp: number }>
    sellingPointsCovered: Array<{ point: string; covered: boolean; timestamp?: number; note?: string }>
    brandExposure?: NonNullable<TaskResponse['video_ai_result']>['brand_exposure'] | null
    speechTranscript?: string | null
    asrAvailable?: boolean
    textSource?: 'asr' | 'ocr' | 'none'
    audioTrackAnalysis?: NonNullable<TaskResponse['video_ai_result']>['audio_track_analysis'] | null
    speechViolations: SpeechViolation[]
    typoViolations: Array<{ content: string; suggestion: string }>
    deliveryQuality?: { score?: number; engagement?: string; purchase_intent?: string; platform_fit?: string; overall?: string }
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
  agencyReview: null | { result: 'approved' | 'rejected'; comment: string; reviewer: string; time: string }
  brandReview: null | { result: 'approved' | 'rejected'; comment: string; reviewer: string; time: string }
}

// ========== 映射 ==========
function mapApiToVideoUI(task: TaskResponse): VideoTaskUI {
  const stage = task.stage
  let status = 'pending_upload'
  const aiAutoRejected = task.video_ai_result?.ai_auto_rejected === true
  switch (stage) {
    case 'video_upload': status = aiAutoRejected ? 'ai_rejected' : 'pending_upload'; break
    case 'video_ai_review': status = 'ai_reviewing'; break
    case 'video_agency_review': status = 'agent_reviewing'; break
    case 'video_brand_review': status = 'brand_reviewing'; break
    case 'completed': status = 'brand_passed'; break
    default:
      if (stage.startsWith('script_')) status = 'pending_upload' // 还没到视频阶段
      if (stage === 'rejected') {
        if (task.video_brand_status === 'rejected') status = 'brand_rejected'
        else if (task.video_agency_status === 'rejected') status = 'agent_rejected'
        else status = 'ai_result'
      }
  }

  const allViolations = task.video_ai_result?.violations || []
  const normalizedWarnings = normalizeSoftWarnings(task.video_ai_result?.soft_warnings)
  const aiResult = task.video_ai_result ? {
    score: task.video_ai_result.score,
    hardViolations: allViolations
      .filter(v => (v.severity === 'error' || v.severity === 'high' || v.severity === '高') && v.type !== 'verbal_error' && v.type !== '口误' && v.type !== 'subtitle_error' && v.type !== '字幕错误' && v.type !== 'typo')
      .map(v => ({ type: v.type, content: v.content, timestamp: v.timestamp || 0, suggestion: v.suggestion })),
    sentimentWarnings: normalizedWarnings
      .map(w => ({ type: w.label, content: w.content, timestamp: w.timestamp })),
    sellingPointsCovered: getVideoSellingPointCoverage(task.video_ai_result),
    brandExposure: task.video_ai_result.brand_exposure || null,
    speechTranscript: task.video_ai_result.speech_transcript,
    asrAvailable: task.video_ai_result.asr_available,
    textSource: (task.video_ai_result.text_source as 'asr' | 'ocr' | 'none') || (task.video_ai_result.asr_available ? 'asr' : 'none'),
    audioTrackAnalysis: task.video_ai_result.audio_track_analysis || null,
    speechViolations: allViolations
      .filter(v => v.type === 'verbal_error' || v.type === '口误' || v.type === 'subtitle_error' || v.type === '字幕错误')
      .map(v => ({ type: v.type, content: v.content, severity: v.severity, suggestion: v.suggestion, script_text: v.script_text, actual_text: v.actual_text })),
    typoViolations: allViolations
      .filter(v => v.type === 'typo')
      .map(v => ({ content: v.content, suggestion: v.suggestion })),
    deliveryQuality: task.video_ai_result.delivery_quality,
    newContentAnalysis: (task.video_ai_result.new_content_analysis || []).map(nc => ({
      content: nc.content || '',
      compliant: nc.compliant ?? true,
      enhances: nc.enhances ?? false,
      note: nc.note || '',
    })),
    scriptMatch: task.video_ai_result.script_match || null,
  } : null

const agencyReview = task.video_agency_status && task.video_agency_status !== 'pending' ? {
    result: (task.video_agency_status === 'passed' || task.video_agency_status === 'force_passed' ? 'approved' : 'rejected') as 'approved' | 'rejected',
    comment: task.video_agency_comment || '',
    reviewer: task.agency?.name || '代理商',
    time: task.video_agency_reviewed_at || task.updated_at,
  } : null

  const brandReview = task.video_brand_status && task.video_brand_status !== 'pending' ? {
    result: (task.video_brand_status === 'passed' || task.video_brand_status === 'force_passed' ? 'approved' : 'rejected') as 'approved' | 'rejected',
    comment: task.video_brand_comment || '',
    reviewer: '品牌方审核员',
    time: task.video_brand_reviewed_at || task.updated_at,
  } : null

  return {
    projectName: task.project?.name || task.name,
    brandName: task.project?.brand_name || '',
    videoStatus: status,
    videoFile: task.video_file_name || null,
    aiAutoRejected,
    aiRejectReason: task.video_ai_result?.ai_reject_reason,
    aiResult,
    agencyReview,
    brandReview,
  }
}

const DEFAULT_TASK: VideoTaskUI = {
  projectName: '',
  brandName: '',
  videoStatus: 'pending_upload',
  videoFile: null,
  aiResult: null,
  agencyReview: null,
  brandReview: null,
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

// ========== UI 组件 ==========

function UploadSection({ taskId, onUploaded }: { taskId: string; onUploaded: () => Promise<void> | void }) {
  const [file, setFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isSafariMode, setIsSafariMode] = useState(false)
  const tenantId = api.getTenantId()
  const toast = useToast()

  useEffect(() => {
    if (typeof navigator === 'undefined') return
    const ua = navigator.userAgent
    setIsSafariMode(/Safari/i.test(ua) && !/Chrome|Chromium|CriOS|EdgiOS|FxiOS|Android/i.test(ua))
  }, [])

  useEffect(() => {
    if (!isSafariMode || typeof window === 'undefined') return
    const targetUrl = new URL(`/native-upload/task/${encodeURIComponent(taskId)}`, window.location.origin)
    if (tenantId && tenantId !== 'default') {
      targetUrl.searchParams.set('tenant_id', tenantId)
    }
    if (window.location.pathname !== targetUrl.pathname || window.location.search !== targetUrl.search) {
      window.location.replace(targetUrl.toString())
    }
  }, [isSafariMode, taskId, tenantId])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      setFile(selectedFile)
      setUploadError(null)
    }
  }

  const handleUpload = async () => {
    if (!file) return
    setIsUploading(true)
    setProgress(0)
    setUploadError(null)
    try {
      const result = await api.proxyUpload(file, 'video', (pct) => {
        setProgress(Math.min(90, Math.round(pct * 0.9)))
      })
      setProgress(95)
      await api.uploadTaskVideo(taskId, { file_url: result.url, file_name: result.file_name })
      setProgress(100)
      toast.success('视频已上传，正在启动 AI 审核')
      await Promise.resolve(onUploaded())
    } catch (err) {
      const msg = extractErrorMessage(err)
      setUploadError(msg)
      toast.error(msg)
    } finally {
      setIsUploading(false)
    }
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + 'B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB'
    return (bytes / (1024 * 1024)).toFixed(1) + 'MB'
  }

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Upload size={18} className="text-purple-400" />上传视频</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {isSafariMode ? (
          <div className="border border-border-subtle rounded-lg p-4 text-sm text-text-secondary">
            正在跳转到 Safari 原生上传页...
          </div>
        ) : !file ? (
          <label className="border-2 border-dashed border-border-subtle rounded-lg p-8 text-center hover:border-accent-indigo/50 transition-colors cursor-pointer block">
            <Upload size={32} className="mx-auto text-text-tertiary mb-3" />
            <p className="text-text-secondary mb-1">点击上传视频文件</p>
            <p className="text-xs text-text-tertiary">支持 MP4、MOV、AVI 格式，最大 500MB</p>
            <input type="file" accept="video/*" onChange={handleFileChange} className="hidden" />
          </label>
        ) : (
          <div className="border border-border-subtle rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 bg-bg-elevated border-b border-border-subtle">
              <span className="text-xs font-medium text-text-secondary">已选文件</span>
            </div>
            <div className="px-4 py-3">
              <div className="flex items-center gap-3">
                {isUploading ? (
                  <Loader2 size={16} className="animate-spin text-purple-400 flex-shrink-0" />
                ) : uploadError ? (
                  <AlertTriangle size={16} className="text-accent-coral flex-shrink-0" />
                ) : (
                  <CheckCircle size={16} className="text-accent-green flex-shrink-0" />
                )}
                <Video size={14} className="text-purple-400 flex-shrink-0" />
                <span className="flex-1 text-sm text-text-primary truncate">{file.name}</span>
                <span className="text-xs text-text-tertiary">{formatSize(file.size)}</span>
                {!isUploading && (
                  <button type="button" onClick={() => { setFile(null); setUploadError(null) }} className="p-1 hover:bg-bg-elevated rounded">
                    <XCircle size={14} className="text-text-tertiary" />
                  </button>
                )}
              </div>
              {isUploading && (
                <div className="mt-2 ml-[30px] h-2 bg-bg-page rounded-full overflow-hidden">
                  <div className="h-full bg-purple-400 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
                </div>
              )}
              {isUploading && (
                <p className="mt-1 ml-[30px] text-xs text-text-tertiary">上传中 {progress}%</p>
              )}
              {uploadError && (
                <p className="mt-1 ml-[30px] text-xs text-accent-coral">{uploadError}</p>
              )}
            </div>
          </div>
        )}
        {!isSafariMode ? (
          <Button onClick={handleUpload} disabled={!file || isUploading} fullWidth>
            {isUploading ? (
              <><Loader2 size={16} className="animate-spin" />上传中 {progress}%</>
            ) : '提交视频'}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}

function AIReviewingSection() {
  const [progress, setProgress] = useState(0)
  const [currentStep, setCurrentStep] = useState('正在解析视频...')
  useEffect(() => {
    const steps = ['正在解析视频...', '正在提取音频转文字...', '正在分析画面内容...', '正在检测违禁内容...', '正在分析卖点覆盖...', '正在生成审核报告...']
    let stepIndex = 0
    const timer = setInterval(() => { setProgress(prev => prev >= 100 ? (clearInterval(timer), 100) : prev + 5) }, 300)
    const stepTimer = setInterval(() => { stepIndex = (stepIndex + 1) % steps.length; setCurrentStep(steps[stepIndex]) }, 1500)
    return () => { clearInterval(timer); clearInterval(stepTimer) }
  }, [])

  return (
    <Card><CardContent className="py-8 text-center">
      <Loader2 size={48} className="mx-auto text-purple-400 mb-4 animate-spin" />
      <h3 className="text-lg font-medium text-text-primary mb-2">AI 正在审核您的视频</h3>
      <p className="text-text-secondary mb-4">请稍候，视频审核可能需要 3-5 分钟</p>
      <div className="w-full max-w-md mx-auto">
        <div className="h-2 bg-bg-elevated rounded-full overflow-hidden mb-2"><div className="h-full bg-purple-400 transition-all" style={{ width: `${progress}%` }} /></div>
        <p className="text-sm text-text-tertiary">{progress}%</p>
      </div>
      <div className="mt-4 p-3 bg-bg-elevated rounded-lg max-w-md mx-auto"><p className="text-sm text-text-secondary">{currentStep}</p></div>
    </CardContent></Card>
  )
}

function AIResultSection({ task }: { task: VideoTaskUI }) {
  if (!task.aiResult) return null
  return (
    <div className="space-y-4">
      <Card><CardContent className="py-4">
        <div className="flex items-center justify-between">
          <span className="text-text-secondary">AI 综合评分</span>
          <span className={`text-3xl font-bold ${task.aiResult.score >= 85 ? 'text-accent-green' : task.aiResult.score >= 70 ? 'text-yellow-400' : 'text-accent-coral'}`}>{task.aiResult.score}</span>
        </div>
      </CardContent></Card>

      <AudioRecognitionResult
        audioTrackAnalysis={task.aiResult.audioTrackAnalysis}
        transcript={task.aiResult.speechTranscript}
      />

      {task.aiResult.hardViolations.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Shield size={16} className="text-red-500" />高危违规 ({task.aiResult.hardViolations.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {task.aiResult.hardViolations.map((v, idx) => (
              <div key={idx} className="p-3 bg-accent-coral/10 rounded-lg border border-accent-coral/30">
                <div className="flex items-center gap-2 mb-1"><ErrorTag>{getViolationTypeLabel(v.type)}</ErrorTag><span className="text-xs text-text-tertiary">{formatTimestamp(v.timestamp)}</span></div>
                <p className="text-sm text-text-primary">「{v.content}」</p>
                <p className="text-xs text-accent-indigo mt-1">{v.suggestion}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {task.aiResult.sentimentWarnings.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Radio size={16} className="text-orange-500" />舆情雷达</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {task.aiResult.sentimentWarnings.map((w, idx) => (
              <div key={idx} className="p-3 bg-orange-500/10 rounded-lg border border-orange-500/30">
                <div className="flex items-center gap-2 mb-1"><WarningTag>{getViolationTypeLabel(w.type)}</WarningTag><span className="text-xs text-text-tertiary">{formatTimestamp(w.timestamp)}</span></div>
                <p className="text-sm text-orange-400">{w.content}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {task.aiResult.sellingPointsCovered.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><CheckCircle size={16} className="text-accent-green" />卖点覆盖</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {task.aiResult.sellingPointsCovered.map((sp, idx) => (
              <div key={idx} className="flex items-center justify-between p-2 rounded-lg bg-bg-elevated">
                <div className="flex items-center gap-2">
                  {sp.covered ? <CheckCircle size={16} className="text-accent-green" /> : <XCircle size={16} className="text-accent-coral" />}
                  <span className="text-sm text-text-primary">{sp.point}</span>
                </div>
                {sp.covered && sp.timestamp && <span className="text-xs text-text-tertiary">{formatTimestamp(sp.timestamp)}</span>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* 口误 / 语音对比 */}
      {task.aiResult.speechViolations.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Mic size={16} className="text-amber-400" />语音对比问题 ({task.aiResult.speechViolations.length})</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {task.aiResult.speechViolations.map((sv, idx) => (
              <div key={idx} className="p-3 bg-amber-500/10 rounded-lg border border-amber-500/30">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${(sv.type === 'verbal_error' || sv.type === '口误') ? 'bg-amber-500/20 text-amber-400' : 'bg-purple-500/20 text-purple-400'}`}>
                    {(sv.type === 'verbal_error' || sv.type === '口误') ? '口误' : '字幕错误'}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${(sv.severity === 'high' || sv.severity === '高') ? 'bg-red-500/20 text-red-400' : (sv.severity === 'medium' || sv.severity === '中') ? 'bg-amber-500/20 text-amber-400' : 'bg-gray-500/20 text-gray-400'}`}>
                    {(sv.severity === 'high' || sv.severity === '高') ? '严重' : (sv.severity === 'medium' || sv.severity === '中') ? '中等' : '轻微'}
                  </span>
                </div>
                {sv.script_text && sv.actual_text && (
                  <div className="flex items-center gap-2 mb-2 text-sm">
                    <div className="flex-1 p-2 bg-bg-elevated rounded">
                      <span className="text-xs text-text-tertiary block mb-0.5">脚本原文</span>
                      <span className="text-text-primary">{sv.script_text}</span>
                    </div>
                    <ArrowRight size={14} className="text-text-tertiary flex-shrink-0" />
                    <div className="flex-1 p-2 bg-accent-coral/10 rounded">
                      <span className="text-xs text-text-tertiary block mb-0.5">实际语音</span>
                      <span className="text-accent-coral">{sv.actual_text}</span>
                    </div>
                  </div>
                )}
                <p className="text-sm text-text-secondary">{sv.content}</p>
                <p className="text-xs text-accent-indigo mt-1">{sv.suggestion}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* 错别字 */}
      {task.aiResult.typoViolations.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><FileText size={16} className="text-yellow-400" />错别字 / 语病 ({task.aiResult.typoViolations.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {task.aiResult.typoViolations.map((tv, idx) => (
              <div key={idx} className="p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/30">
                <p className="text-sm text-text-primary">「{tv.content}」</p>
                <p className="text-xs text-accent-indigo mt-1">{tv.suggestion}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* 口播质量评估 */}
      {task.aiResult.deliveryQuality && task.aiResult.deliveryQuality.overall && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Sparkles size={16} className="text-accent-indigo" />口播质量评估</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {task.aiResult.deliveryQuality.score != null && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">口播评分</span>
                <span className={`text-lg font-bold ${task.aiResult.deliveryQuality.score >= 80 ? 'text-accent-green' : task.aiResult.deliveryQuality.score >= 60 ? 'text-accent-amber' : 'text-accent-coral'}`}>{task.aiResult.deliveryQuality.score}</span>
              </div>
            )}
            <p className="text-sm text-text-primary">{task.aiResult.deliveryQuality.overall}</p>
            <div className="grid grid-cols-1 gap-2">
              {task.aiResult.deliveryQuality.engagement && (
                <div className="p-2 bg-bg-elevated rounded-lg">
                  <span className="text-xs text-text-tertiary">感染力</span>
                  <p className="text-sm text-text-primary mt-0.5">{task.aiResult.deliveryQuality.engagement}</p>
                </div>
              )}
              {task.aiResult.deliveryQuality.purchase_intent && (
                <div className="p-2 bg-bg-elevated rounded-lg">
                  <span className="text-xs text-text-tertiary">购买欲</span>
                  <p className="text-sm text-text-primary mt-0.5">{task.aiResult.deliveryQuality.purchase_intent}</p>
                </div>
              )}
              {task.aiResult.deliveryQuality.platform_fit && (
                <div className="p-2 bg-bg-elevated rounded-lg">
                  <span className="text-xs text-text-tertiary">平台适配</span>
                  <p className="text-sm text-text-primary mt-0.5">{task.aiResult.deliveryQuality.platform_fit}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {task.aiResult.brandExposure && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><FileCheck2 size={16} className="text-accent-indigo" />品牌曝光分析</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 gap-2">
              <div className="p-2 bg-bg-elevated rounded-lg flex items-center justify-between">
                <span className="text-xs text-text-tertiary">品牌出镜时长</span>
                <span className="text-sm font-semibold text-text-primary">{formatExposureDuration(task.aiResult.brandExposure.visible_duration_seconds)}</span>
              </div>
              <div className="p-2 bg-bg-elevated rounded-lg flex items-center justify-between">
                <span className="text-xs text-text-tertiary">品牌提及时长</span>
                <span className="text-sm font-semibold text-text-primary">{formatExposureDuration(task.aiResult.brandExposure.mention_duration_seconds)}</span>
              </div>
              <div className="p-2 bg-bg-elevated rounded-lg flex items-center justify-between">
                <span className="text-xs text-text-tertiary">品牌相关时长</span>
                <span className="text-sm font-semibold text-text-primary">{formatExposureDuration(task.aiResult.brandExposure.related_duration_seconds)}</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">曝光评分</span>
              <span className="text-lg font-bold text-text-primary">{task.aiResult.brandExposure.score ?? '--'}</span>
            </div>
            {task.aiResult.brandExposure.analysis && <p className="text-sm text-text-primary">{task.aiResult.brandExposure.analysis}</p>}
          </CardContent>
        </Card>
      )}

      {/* 新增内容分析 */}
      {task.aiResult.newContentAnalysis.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><MessageSquarePlus size={16} className="text-purple-400" />新增内容分析 ({task.aiResult.newContentAnalysis.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {task.aiResult.newContentAnalysis.map((nc, idx) => (
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
      {task.aiResult.scriptMatch && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2">
                <FileCheck2 size={16} className="text-sky-400" />
                脚本匹配度
              </span>
              <span className={`text-lg font-bold ${task.aiResult.scriptMatch.overall_score >= 90 ? 'text-accent-green' : task.aiResult.scriptMatch.overall_score >= 70 ? 'text-accent-amber' : task.aiResult.scriptMatch.overall_score >= 50 ? 'text-orange-400' : 'text-accent-coral'}`}>
                {task.aiResult.scriptMatch.overall_score}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-text-primary">{task.aiResult.scriptMatch.overall_assessment}</p>
            {task.aiResult.scriptMatch.suggestion_for_reviewer && (
              <div className="p-2.5 bg-sky-500/10 border border-sky-500/20 rounded-lg">
                <p className="text-xs text-sky-400 font-medium mb-0.5">审核员建议</p>
                <p className="text-sm text-text-secondary">{task.aiResult.scriptMatch.suggestion_for_reviewer}</p>
              </div>
            )}
            {task.aiResult.scriptMatch.segments.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-text-tertiary font-medium">段落明细</p>
                {task.aiResult.scriptMatch.segments.map((seg, idx) => (
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
            {(task.aiResult.scriptMatch.missing_segments.length > 0 || task.aiResult.scriptMatch.key_deviations.length > 0) && (
              <div className="pt-2 border-t border-border-subtle space-y-2">
                {task.aiResult.scriptMatch.missing_segments.length > 0 && (
                  <div>
                    <p className="text-xs text-accent-coral font-medium mb-1">遗漏段落</p>
                    <div className="flex flex-wrap gap-1">
                      {task.aiResult.scriptMatch.missing_segments.map((ms, idx) => (
                        <span key={idx} className="text-xs px-2 py-0.5 bg-accent-coral/10 text-accent-coral rounded">{ms}</span>
                      ))}
                    </div>
                  </div>
                )}
                {task.aiResult.scriptMatch.key_deviations.length > 0 && (
                  <div>
                    <p className="text-xs text-accent-amber font-medium mb-1">主要偏离</p>
                    {task.aiResult.scriptMatch.key_deviations.map((kd, idx) => (
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
  )
}

function ReviewFeedbackSection({ review, type }: { review: { result: string; comment: string; reviewer: string; time: string }; type: 'agency' | 'brand' }) {
  const isApproved = review.result === 'approved'
  const title = type === 'agency' ? '代理商审核意见' : '品牌方终审意见'
  return (
    <Card className={isApproved ? 'border-accent-green/30' : 'border-accent-coral/30'}>
      <CardHeader><CardTitle className="flex items-center gap-2">
        {isApproved ? <CheckCircle size={18} className="text-accent-green" /> : <XCircle size={18} className="text-accent-coral" />}{title}
      </CardTitle></CardHeader>
      <CardContent>
        <div className="flex items-center gap-2 mb-2">
          <span className="font-medium text-text-primary">{review.reviewer}</span>
          {isApproved ? <SuccessTag>通过</SuccessTag> : <ErrorTag>驳回</ErrorTag>}
        </div>
        <p className="text-text-secondary whitespace-pre-wrap">{review.comment}</p>
        <p className="text-xs text-text-tertiary mt-2">{review.time}</p>
      </CardContent>
    </Card>
  )
}

function WaitingSection({ message }: { message: string }) {
  return <Card><CardContent className="py-8 text-center"><Clock size={48} className="mx-auto text-accent-indigo mb-4" /><h3 className="text-lg font-medium text-text-primary mb-2">{message}</h3><p className="text-text-secondary">请耐心等待，审核结果将通过消息通知您</p></CardContent></Card>
}

function SuccessSection() {
  return (
    <Card className="border-accent-green/30"><CardContent className="py-8 text-center">
      <CheckCircle size={64} className="mx-auto text-accent-green mb-4" />
      <h3 className="text-xl font-bold text-text-primary mb-2">视频审核通过！</h3>
      <p className="text-text-secondary mb-6">恭喜您，视频已通过所有审核，可以发布了</p>
      <div className="flex justify-center gap-3">
        <Button variant="secondary"><Play size={16} />预览视频</Button>
        <Button>分享链接</Button>
      </div>
    </CardContent></Card>
  )
}

// ========== 主页面 ==========

export default function CreatorVideoPage() {
  const router = useRouter()
  const params = useParams()
  const toast = useToast()
  const { subscribe } = useSSE()
  const taskId = params.id as string
  const taskOverviewPath = `/creator/task/${encodeURIComponent(taskId)}`

  const [task, setTask] = useState<VideoTaskUI>(DEFAULT_TASK)
  const [isLoading, setIsLoading] = useState(true)

  const loadTask = useCallback(async () => {
    try {
      const apiTask = await api.getTask(taskId)
      setTask(mapApiToVideoUI(apiTask))
    } catch { toast.error('加载任务失败') }
    finally { setIsLoading(false) }
  }, [taskId, toast])

  useEffect(() => { loadTask() }, [loadTask])

  useEffect(() => {
    const unsub1 = subscribe('task_updated', (data) => { if ((data as { task_id?: string }).task_id === taskId) loadTask() })
    const unsub2 = subscribe('review_completed', (data) => { if ((data as { task_id?: string }).task_id === taskId) loadTask() })
    return () => { unsub1(); unsub2() }
  }, [subscribe, taskId, loadTask])

  // AI 审核中时轮询（SSE 的后备方案）
  useEffect(() => {
    if (task.videoStatus !== 'ai_reviewing') return
    const interval = setInterval(() => { loadTask() }, 5000)
    return () => clearInterval(interval)
  }, [task.videoStatus, loadTask])

  const getStatusDisplay = () => {
    const map: Record<string, string> = {
      pending_upload: '待上传视频', ai_rejected: 'AI 审核未通过', ai_reviewing: 'AI 审核中', ai_result: 'AI 审核完成',
      agent_reviewing: '代理商审核中', agent_rejected: '代理商驳回',
      brand_reviewing: '品牌方终审中', brand_passed: '审核通过', brand_rejected: '品牌方驳回',
    }
    return map[task.videoStatus] || '未知状态'
  }

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 text-accent-indigo animate-spin" /></div>
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-4">
        <button type="button" onClick={() => router.push(taskOverviewPath)} className="p-2 hover:bg-bg-elevated rounded-full"><ArrowLeft size={20} className="text-text-primary" /></button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-text-primary">{task.projectName}</h1>
          <p className="text-sm text-text-secondary">视频阶段 · {getStatusDisplay()}</p>
        </div>
      </div>

      <Card><CardContent className="py-4"><ReviewSteps steps={getReviewSteps(task.videoStatus)} /></CardContent></Card>

      {task.videoStatus === 'pending_upload' && <UploadSection taskId={taskId} onUploaded={loadTask} />}
      {task.videoStatus === 'ai_rejected' && (
        <>
          <Card className="border-accent-coral/30 bg-accent-coral/5">
            <CardContent className="py-4">
              <div className="flex items-start gap-3">
                <XCircle size={20} className="text-accent-coral mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-text-primary font-medium">视频 AI 审核未通过，请修改后重新上传</p>
                  {task.aiRejectReason && <p className="text-sm text-text-secondary mt-1">{task.aiRejectReason}</p>}
                </div>
              </div>
            </CardContent>
          </Card>
          <AIResultSection task={task} />
          <UploadSection taskId={taskId} onUploaded={loadTask} />
        </>
      )}
      {task.videoStatus === 'ai_reviewing' && <AIReviewingSection />}
      {task.videoStatus === 'ai_result' && <><AIResultSection task={task} /><WaitingSection message="等待代理商审核" /></>}
      {task.videoStatus === 'agent_reviewing' && <><AIResultSection task={task} /><WaitingSection message="等待代理商审核" /></>}
      {task.videoStatus === 'agent_rejected' && task.agencyReview && (
        <><ReviewFeedbackSection review={task.agencyReview} type="agency" /><AIResultSection task={task} />
        <div className="flex gap-3"><Button variant="secondary" onClick={loadTask} fullWidth><RefreshCw size={16} />重新上传</Button></div></>
      )}
      {task.videoStatus === 'brand_reviewing' && task.agencyReview && (
        <><ReviewFeedbackSection review={task.agencyReview} type="agency" /><AIResultSection task={task} /><WaitingSection message="等待品牌方终审" /></>
      )}
      {task.videoStatus === 'brand_passed' && task.agencyReview && task.brandReview && (
        <><SuccessSection /><ReviewFeedbackSection review={task.brandReview} type="brand" />
        <ReviewFeedbackSection review={task.agencyReview} type="agency" /><AIResultSection task={task} /></>
      )}
      {task.videoStatus === 'brand_rejected' && task.agencyReview && task.brandReview && (
        <><ReviewFeedbackSection review={task.brandReview} type="brand" /><ReviewFeedbackSection review={task.agencyReview} type="agency" />
        <AIResultSection task={task} /><div className="flex gap-3"><Button variant="secondary" onClick={loadTask} fullWidth><RefreshCw size={16} />重新上传</Button></div></>
      )}
    </div>
  )
}
