'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { ArrowLeft, Download, Play, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { SuccessTag, WarningTag, ErrorTag, PendingTag } from '@/components/ui/Tag'
import { api } from '@/lib/api'
import { formatTaskDisplayTitle } from '@/lib/taskDisplay'
import { getPlatformInfo } from '@/lib/platforms'
import { normalizeSoftWarnings } from '@/lib/reviewWarnings'
import type { TaskResponse, TaskStage } from '@/types/task'

function getPlatformLabel(platformId: string): string {
  return getPlatformInfo(platformId)?.name || platformId
}

// ==================== 本地视图模型 ====================
interface TaskViewModel {
  id: string
  videoTitle: string
  creatorName: string
  brandName: string
  platform: string
  status: string
  aiScore: number | null
  finalScore: number | null
  aiSummary: string
  submittedAt: string
  reviewedAt: string
  reviewerName: string
  reviewNotes: string
  videoUrl: string | null
  softWarnings: Array<{ id: string; content: string; suggestion: string }>
  timeline: Array<{ time: string; event: string; actor: string }>
}

// ==================== 辅助函数 ====================

function mapStageToStatus(stage: TaskStage, task: TaskResponse): string {
  if (stage === 'completed') return 'approved'
  if (stage === 'rejected') return 'rejected'

  // 驳回回退到上传阶段的情况
  if (stage === 'script_upload' || stage === 'video_upload') {
    const isRejected = task.script_agency_status === 'rejected' || task.script_brand_status === 'rejected' ||
      task.video_agency_status === 'rejected' || task.video_brand_status === 'rejected'
    if (isRejected) return 'rejected'
  }

  // 审核中状态
  if (stage.includes('review')) return 'pending_review'

  // 上传阶段（首次）
  if (stage === 'script_upload' || stage === 'video_upload') return 'pending_review'

  return 'pending_review'
}

function formatDateTime(isoStr: string | null | undefined): string {
  if (!isoStr) return '-'
  try {
    const d = new Date(isoStr)
    return d.toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return isoStr
  }
}

function isStageAfter(currentStage: TaskStage, targetStage: TaskStage): boolean {
  const order: TaskStage[] = [
    'script_upload', 'script_ai_review', 'script_agency_review', 'script_brand_review',
    'video_upload', 'video_ai_review', 'video_agency_review', 'video_brand_review',
    'completed', 'rejected',
  ]
  return order.indexOf(currentStage) > order.indexOf(targetStage)
}

function buildTimeline(task: TaskResponse): Array<{ time: string; event: string; actor: string }> {
  const timeline: Array<{ time: string; event: string; actor: string }> = []

  // 任务创建
  timeline.push({
    time: formatDateTime(task.created_at),
    event: '任务创建',
    actor: '系统',
  })

  // 脚本上传
  if (task.script_uploaded_at) {
    timeline.push({
      time: formatDateTime(task.script_uploaded_at),
      event: '达人提交脚本',
      actor: task.creator?.name || '达人',
    })
  }

  // 脚本 AI 审核（只在已过 AI 审核阶段时显示）
  if (task.script_ai_score != null && isStageAfter(task.stage, 'script_ai_review')) {
    timeline.push({
      time: formatDateTime(task.script_uploaded_at),
      event: `AI 脚本审核完成，得分 ${task.script_ai_score} 分`,
      actor: '系统',
    })
  }

  // 脚本代理商审核
  if (task.script_agency_status && task.script_agency_status !== 'pending') {
    const statusText = task.script_agency_status === 'passed' ? '通过' :
      task.script_agency_status === 'rejected' ? '驳回' : '强制通过'
    timeline.push({
      time: formatDateTime(task.updated_at),
      event: `代理商脚本审核${statusText}`,
      actor: task.agency?.name || '代理商',
    })
  }

  // 脚本品牌方审核
  if (task.script_brand_status && task.script_brand_status !== 'pending') {
    const statusText = task.script_brand_status === 'passed' ? '通过' :
      task.script_brand_status === 'rejected' ? '驳回' : '强制通过'
    timeline.push({
      time: formatDateTime(task.updated_at),
      event: `品牌方脚本审核${statusText}`,
      actor: '品牌方',
    })
  }

  // 视频上传
  if (task.video_uploaded_at) {
    timeline.push({
      time: formatDateTime(task.video_uploaded_at),
      event: '达人提交视频',
      actor: task.creator?.name || '达人',
    })
  }

  // 视频 AI 审核（只在已过视频 AI 审核阶段时显示）
  if (task.video_ai_score != null && isStageAfter(task.stage, 'video_ai_review')) {
    timeline.push({
      time: formatDateTime(task.video_uploaded_at),
      event: `AI 视频审核完成，得分 ${task.video_ai_score} 分`,
      actor: '系统',
    })
  }

  // 视频代理商审核
  if (task.video_agency_status && task.video_agency_status !== 'pending') {
    const statusText = task.video_agency_status === 'passed' ? '通过' :
      task.video_agency_status === 'rejected' ? '驳回' : '强制通过'
    timeline.push({
      time: formatDateTime(task.updated_at),
      event: `代理商视频审核${statusText}`,
      actor: task.agency?.name || '代理商',
    })
  }

  // 视频品牌方审核
  if (task.video_brand_status && task.video_brand_status !== 'pending') {
    const statusText = task.video_brand_status === 'passed' ? '通过' :
      task.video_brand_status === 'rejected' ? '驳回' : '强制通过'
    timeline.push({
      time: formatDateTime(task.updated_at),
      event: `品牌方视频审核${statusText}`,
      actor: '品牌方',
    })
  }

  // 申诉
  if (task.is_appeal && task.appeal_reason) {
    timeline.push({
      time: formatDateTime(task.updated_at),
      event: `达人发起申诉：${task.appeal_reason}`,
      actor: task.creator?.name || '达人',
    })
  }

  return timeline
}

function mapTaskResponseToViewModel(task: TaskResponse): TaskViewModel {
  const status = mapStageToStatus(task.stage, task)

  // 选择最新的 AI 评分（优先视频，其次脚本）
  // 如果当前 stage 在 upload 阶段，旧的 AI 数据可能是过期的（AI 审核失败回退），不展示
  const scriptAiValid = task.script_ai_score != null && isStageAfter(task.stage, 'script_ai_review')
  const videoAiValid = task.video_ai_score != null && isStageAfter(task.stage, 'video_ai_review')
  const aiScore = videoAiValid ? (task.video_ai_score ?? null) : scriptAiValid ? (task.script_ai_score ?? null) : null
  const aiResult = videoAiValid ? (task.video_ai_result ?? null) : scriptAiValid ? (task.script_ai_result ?? null) : null

  // 最终评分等于 AI 评分（人工审核不改分）
  const finalScore = aiScore

  // AI 摘要
  const aiSummary = aiResult?.summary || '暂无 AI 分析摘要'

  // 审核备注（优先视频代理商审核意见）
  const reviewNotes = task.video_agency_comment || task.script_agency_comment ||
    task.video_brand_comment || task.script_brand_comment || ''

  // 软警告
  const softWarnings = normalizeSoftWarnings(aiResult?.soft_warnings).map((w) => ({
    id: w.id,
    content: w.content,
    suggestion: w.suggestion,
  }))

  // 时间线
  const timeline = buildTimeline(task)

  return {
    id: task.id,
    videoTitle: formatTaskDisplayTitle({
      taskName: task.name,
      projectName: task.project?.name,
      sequence: task.sequence,
    }),
    creatorName: task.creator?.name || '未知达人',
    brandName: task.project?.brand_name || '未知品牌',
    platform: task.project?.platform ? getPlatformLabel(task.project.platform) : '未知平台',
    status,
    aiScore,
    finalScore,
    aiSummary,
    submittedAt: formatDateTime(task.video_uploaded_at || task.script_uploaded_at || task.created_at),
    reviewedAt: formatDateTime(task.updated_at),
    reviewerName: task.agency?.name || '-',
    reviewNotes,
    videoUrl: task.video_file_url || null,
    softWarnings,
    timeline,
  }
}

// ==================== 组件 ====================

function StatusBadge({ status }: { status: string }) {
  if (status === 'approved') return <SuccessTag>已通过</SuccessTag>
  if (status === 'rejected') return <ErrorTag>已驳回</ErrorTag>
  if (status === 'pending_review') return <WarningTag>待审核</WarningTag>
  return <PendingTag>处理中</PendingTag>
}

function TaskDetailSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 bg-bg-elevated rounded-full" />
        <div className="flex-1">
          <div className="h-6 w-48 bg-bg-elevated rounded" />
          <div className="h-4 w-64 bg-bg-elevated rounded mt-2" />
        </div>
        <div className="h-10 w-28 bg-bg-elevated rounded-lg" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="aspect-video bg-bg-elevated rounded-xl" />
          <div className="h-48 bg-bg-elevated rounded-xl" />
        </div>
        <div className="space-y-4">
          <div className="h-64 bg-bg-elevated rounded-xl" />
          <div className="h-48 bg-bg-elevated rounded-xl" />
        </div>
      </div>
    </div>
  )
}

export default function TaskDetailPage() {
  const router = useRouter()
  const params = useParams()
  const taskId = params.id as string

  const [task, setTask] = useState<TaskViewModel | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [videoBlobUrl, setVideoBlobUrl] = useState<string | null>(null)

  // 通过后端代理获取视频 blob URL
  useEffect(() => {
    if (!task?.videoUrl) return
    let cancelled = false
    api.getPreviewUrl(task.videoUrl)
      .then(url => { if (!cancelled) setVideoBlobUrl(url) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [task?.videoUrl])

  const loadData = useCallback(async () => {
    try {
      setError(null)
      const taskData = await api.getTask(taskId)
      setTask(mapTaskResponseToViewModel(taskData))
    } catch (err) {
      console.error('加载任务详情失败:', err)
      setError('加载任务详情失败')
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    loadData()
  }, [loadData])

  if (loading) {
    return <TaskDetailSkeleton />
  }

  if (!task || error) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-text-secondary mb-4">{error || '任务不存在或已被删除'}</p>
        <Button variant="secondary" onClick={() => router.back()}>返回</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 顶部导航 */}
      <div className="flex items-center gap-4">
        <button type="button" onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-full">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-gray-900">{task.videoTitle}</h1>
            <StatusBadge status={task.status} />
          </div>
          <p className="text-sm text-gray-500">{task.creatorName} · {task.brandName} · {task.platform}</p>
        </div>
        <Button variant="secondary" icon={Download}>导出报告</Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左侧：视频和基本信息 */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardContent className="p-0">
              <div className="aspect-video bg-gray-900 rounded-t-lg flex items-center justify-center">
                {task.videoUrl ? (
                  <video
                    src={videoBlobUrl || task.videoUrl}
                    controls
                    className="w-full h-full rounded-t-lg object-contain"
                  />
                ) : (
                  <button type="button" className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center hover:bg-white/30">
                    <Play size={32} className="text-white ml-1" />
                  </button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>审核结果</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <div className="text-sm text-gray-500">AI 评分</div>
                  <div className={`text-3xl font-bold ${task.aiScore != null && task.aiScore >= 80 ? 'text-green-600' : 'text-yellow-600'}`}>
                    {task.aiScore ?? '-'}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-500">最终评分</div>
                  <div className={`text-3xl font-bold ${task.finalScore != null && task.finalScore >= 80 ? 'text-green-600' : 'text-yellow-600'}`}>
                    {task.finalScore ?? '-'}
                  </div>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t">
                <div className="text-sm text-gray-500 mb-1">AI 分析摘要</div>
                <p className="text-gray-700">{task.aiSummary}</p>
              </div>
              {task.reviewNotes && (
                <div className="mt-4 pt-4 border-t">
                  <div className="text-sm text-gray-500 mb-1">审核备注</div>
                  <p className="text-gray-700">{task.reviewNotes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {task.softWarnings.length > 0 && (
            <Card>
              <CardHeader><CardTitle>优化建议</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {task.softWarnings.map((w) => (
                  <div key={w.id} className="p-3 bg-yellow-50 rounded-lg">
                    <p className="font-medium text-yellow-800">{w.content}</p>
                    <p className="text-sm text-yellow-600 mt-1">{w.suggestion}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* 右侧：详细信息和时间线 */}
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>任务信息</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-500">任务ID</span>
                <span className="text-gray-900 font-mono text-sm">{task.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">达人</span>
                <span className="text-gray-900">{task.creatorName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">品牌</span>
                <span className="text-gray-900">{task.brandName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">平台</span>
                <span className="text-gray-900">{task.platform}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">提交时间</span>
                <span className="text-gray-900 text-sm">{task.submittedAt}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">审核时间</span>
                <span className="text-gray-900 text-sm">{task.reviewedAt}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">审核员</span>
                <span className="text-gray-900">{task.reviewerName}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>处理时间线</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-4">
                {task.timeline.map((item, index) => (
                  <div key={index} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className="w-3 h-3 bg-blue-500 rounded-full" />
                      {index < task.timeline.length - 1 && <div className="w-0.5 h-full bg-gray-200 mt-1" />}
                    </div>
                    <div className="flex-1 pb-4">
                      <p className="text-sm font-medium text-gray-900">{item.event}</p>
                      <p className="text-xs text-gray-500 mt-1">{item.time} · {item.actor}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
