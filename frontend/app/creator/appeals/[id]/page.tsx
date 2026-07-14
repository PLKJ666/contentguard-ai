'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft,
  MessageCircle,
  Clock,
  CheckCircle,
  XCircle,
  FileText,
  Image as ImageIcon,
  Send,
  AlertTriangle,
  Loader2
} from 'lucide-react'
import { ResponsiveLayout } from '@/components/layout/ResponsiveLayout'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { formatTaskDisplayTitle } from '@/lib/taskDisplay'
import { useToast } from '@/components/ui/Toast'
import type { TaskResponse } from '@/types/task'

// 申诉状态类型
type AppealStatus = 'pending' | 'processing' | 'approved' | 'rejected'

// 申诉详情数据类型
type AppealDetail = {
  id: string
  taskId: string
  taskTitle: string
  type: 'ai' | 'agency' | 'brand'
  reason: string
  content: string
  status: AppealStatus
  createdAt: string
  updatedAt?: string
  result?: string
  attachments?: { name: string; type: 'image' | 'document'; url: string }[]
  timeline?: { time: string; action: string; operator?: string }[]
  originalIssue?: { title: string; description: string }
}

// 将 TaskResponse 映射为 AppealDetail UI 类型
function mapTaskToAppealDetail(task: TaskResponse): AppealDetail {
  let type: 'ai' | 'agency' | 'brand' = 'ai'
  if (task.script_brand_status === 'rejected' || task.video_brand_status === 'rejected') {
    type = 'brand'
  } else if (task.script_agency_status === 'rejected' || task.video_agency_status === 'rejected') {
    type = 'agency'
  }

  let status: AppealStatus = 'pending'
  if (task.stage === 'completed') {
    status = 'approved'
  } else if (task.stage === 'rejected') {
    status = 'rejected'
  } else if (task.is_appeal) {
    status = 'processing'
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })
  }

  // Build original issue from review comments
  let originalIssue: { title: string; description: string } | undefined
  const rejectionComment =
    task.script_brand_comment ||
    task.script_agency_comment ||
    task.video_brand_comment ||
    task.video_agency_comment
  if (rejectionComment) {
    originalIssue = {
      title: '审核驳回',
      description: rejectionComment,
    }
  }

  // Build timeline from task dates
  const timeline: { time: string; action: string; operator?: string }[] = []
  if (task.created_at) {
    timeline.push({ time: formatDate(task.created_at), action: '任务创建' })
  }
  if (task.updated_at) {
    timeline.push({ time: formatDate(task.updated_at), action: '提交申诉' })
  }

  return {
    id: task.id,
    taskId: task.id,
    taskTitle: formatTaskDisplayTitle({
      taskName: task.name,
      projectName: task.project?.name,
      sequence: task.sequence,
    }),
    type,
    reason: task.appeal_reason || '申诉',
    content: task.appeal_reason || '',
    status,
    createdAt: task.created_at ? formatDate(task.created_at) : '',
    updatedAt: task.updated_at ? formatDate(task.updated_at) : undefined,
    originalIssue,
    timeline: timeline.length > 0 ? timeline : undefined,
  }
}

// 状态配置
const statusConfig: Record<AppealStatus, { label: string; color: string; bgColor: string; icon: React.ElementType }> = {
  pending: { label: '待处理', color: 'text-amber-500', bgColor: 'bg-amber-500/15', icon: Clock },
  processing: { label: '处理中', color: 'text-accent-indigo', bgColor: 'bg-accent-indigo/15', icon: MessageCircle },
  approved: { label: '已通过', color: 'text-accent-green', bgColor: 'bg-accent-green/15', icon: CheckCircle },
  rejected: { label: '已驳回', color: 'text-accent-coral', bgColor: 'bg-accent-coral/15', icon: XCircle },
}

// 类型配置
const typeConfig: Record<string, { label: string; color: string }> = {
  ai: { label: 'AI审核', color: 'text-accent-indigo' },
  agency: { label: '代理商审核', color: 'text-purple-400' },
  brand: { label: '品牌方审核', color: 'text-accent-blue' },
}

// 骨架屏组件
function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-6 h-full animate-pulse">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex flex-col gap-2">
          <div className="h-8 w-16 bg-bg-elevated rounded-lg" />
          <div className="h-6 w-32 bg-bg-elevated rounded" />
          <div className="h-4 w-48 bg-bg-elevated rounded" />
        </div>
        <div className="h-10 w-24 bg-bg-elevated rounded-xl" />
      </div>
      <div className="flex flex-col lg:flex-row gap-6 flex-1">
        <div className="flex-1 flex flex-col gap-5">
          <div className="bg-bg-card rounded-2xl p-6 card-shadow">
            <div className="h-5 w-32 bg-bg-elevated rounded mb-4" />
            <div className="h-20 bg-bg-elevated rounded-xl" />
          </div>
          <div className="bg-bg-card rounded-2xl p-6 card-shadow">
            <div className="h-5 w-24 bg-bg-elevated rounded mb-4" />
            <div className="h-4 w-full bg-bg-elevated rounded mb-2" />
            <div className="h-4 w-3/4 bg-bg-elevated rounded mb-4" />
            <div className="h-16 bg-bg-elevated rounded-xl" />
          </div>
        </div>
        <div className="lg:w-[320px]">
          <div className="bg-bg-card rounded-2xl p-6 card-shadow">
            <div className="h-5 w-24 bg-bg-elevated rounded mb-5" />
            <div className="flex flex-col gap-6">
              <div className="h-10 bg-bg-elevated rounded" />
              <div className="h-10 bg-bg-elevated rounded" />
              <div className="h-10 bg-bg-elevated rounded" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function AppealDetailPage() {
  const params = useParams()
  const router = useRouter()
  const toast = useToast()
  const appealId = params.id as string
  const [newComment, setNewComment] = useState('')
  const [appeal, setAppeal] = useState<AppealDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const loadAppealDetail = useCallback(async () => {
    try {
      setLoading(true)
      const task = await api.getTask(appealId)
      const mapped = mapTaskToAppealDetail(task)
      setAppeal(mapped)
    } catch (err) {
      console.error('加载申诉详情失败:', err)
      toast.error('加载申诉详情失败，请稍后重试')
      setAppeal(null)
    } finally {
      setLoading(false)
    }
  }, [appealId, toast])

  useEffect(() => {
    loadAppealDetail()
  }, [loadAppealDetail])

  const handleSendComment = async () => {
    if (!newComment.trim()) return

    try {
      setSubmitting(true)
      // Use submitAppeal to add supplementary info (re-appeal with updated reason)
      await api.submitAppeal(appealId, { reason: newComment.trim() })
      toast.success('补充说明已发送')
      setNewComment('')
      // Reload to reflect any changes
      loadAppealDetail()
    } catch (err) {
      console.error('发送补充说明失败:', err)
      toast.error('发送失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <ResponsiveLayout role="creator">
        <DetailSkeleton />
      </ResponsiveLayout>
    )
  }

  if (!appeal) {
    return (
      <ResponsiveLayout role="creator">
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center gap-4">
            <XCircle className="w-16 h-16 text-text-tertiary" />
            <p className="text-lg text-text-secondary">申诉记录不存在</p>
            <button
              type="button"
              onClick={() => router.back()}
              className="px-6 py-2.5 rounded-xl bg-accent-indigo text-white text-sm font-medium"
            >
              返回申诉列表
            </button>
          </div>
        </div>
      </ResponsiveLayout>
    )
  }

  const status = statusConfig[appeal.status]
  const type = typeConfig[appeal.type]
  const StatusIcon = status.icon

  return (
    <ResponsiveLayout role="creator">
      <div className="flex flex-col gap-6 h-full">
        {/* 顶部栏 */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => router.back()}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-elevated text-text-secondary text-sm hover:bg-bg-card transition-colors w-fit mb-2"
            >
              <ArrowLeft className="w-4 h-4" />
              返回
            </button>
            <h1 className="text-xl lg:text-[28px] font-bold text-text-primary">申诉详情</h1>
            <p className="text-sm lg:text-[15px] text-text-secondary">申诉编号: {appeal.id}</p>
          </div>
          <div className={cn('px-4 py-2 rounded-xl flex items-center gap-2', status.bgColor)}>
            <StatusIcon className={cn('w-5 h-5', status.color)} />
            <span className={cn('font-semibold', status.color)}>{status.label}</span>
          </div>
        </div>

        {/* 内容区 - 响应式布局 */}
        <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0 overflow-y-auto lg:overflow-hidden">
          {/* 左侧：申诉信息 */}
          <div className="flex-1 flex flex-col gap-5 lg:overflow-y-auto lg:pr-2">
            {/* 原始问题 */}
            {appeal.originalIssue && (
              <div className="bg-bg-card rounded-2xl p-4 lg:p-6 card-shadow">
                <h3 className="text-base lg:text-lg font-semibold text-text-primary mb-4">原始审核问题</h3>
                <div className="bg-accent-coral/10 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="w-5 h-5 text-accent-coral" />
                    <span className="font-semibold text-text-primary">{appeal.originalIssue.title}</span>
                  </div>
                  <p className="text-sm text-text-secondary">{appeal.originalIssue.description}</p>
                </div>
              </div>
            )}

            {/* 申诉内容 */}
            <div className="bg-bg-card rounded-2xl p-4 lg:p-6 card-shadow">
              <h3 className="text-base lg:text-lg font-semibold text-text-primary mb-4">申诉内容</h3>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-6">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-text-tertiary">关联任务:</span>
                    <span className="text-sm font-medium text-text-primary">{appeal.taskTitle}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-text-tertiary">申诉对象:</span>
                    <span className={cn('text-sm font-medium', type.color)}>{type.label}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-text-tertiary">申诉原因:</span>
                  <span className="text-sm font-medium text-text-primary">{appeal.reason}</span>
                </div>
                <div className="bg-bg-elevated rounded-xl p-4">
                  <p className="text-sm text-text-secondary leading-relaxed">{appeal.content}</p>
                </div>
              </div>
            </div>

            {/* 附件 */}
            {appeal.attachments && appeal.attachments.length > 0 && (
              <div className="bg-bg-card rounded-2xl p-4 lg:p-6 card-shadow">
                <h3 className="text-base lg:text-lg font-semibold text-text-primary mb-4">证明材料</h3>
                <div className="flex flex-wrap gap-3">
                  {appeal.attachments.map((attachment, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-3 px-4 py-3 bg-bg-elevated rounded-xl cursor-pointer hover:bg-bg-page transition-colors"
                    >
                      {attachment.type === 'image' ? (
                        <ImageIcon className="w-5 h-5 text-accent-indigo" />
                      ) : (
                        <FileText className="w-5 h-5 text-accent-indigo" />
                      )}
                      <span className="text-sm text-text-primary">{attachment.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 处理结果 */}
            {appeal.result && (
              <div className="bg-bg-card rounded-2xl p-4 lg:p-6 card-shadow">
                <h3 className="text-base lg:text-lg font-semibold text-text-primary mb-4">处理结果</h3>
                <div className={cn(
                  'rounded-xl p-4',
                  appeal.status === 'approved' ? 'bg-accent-green/10' : 'bg-accent-coral/10'
                )}>
                  <p className="text-sm text-text-secondary leading-relaxed">{appeal.result}</p>
                </div>
              </div>
            )}

            {/* 补充说明（处理中状态可用） */}
            {(appeal.status === 'pending' || appeal.status === 'processing') && (
              <div className="bg-bg-card rounded-2xl p-4 lg:p-6 card-shadow">
                <h3 className="text-base lg:text-lg font-semibold text-text-primary mb-4">补充说明</h3>
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    placeholder="输入补充说明..."
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    className="flex-1 px-4 py-3 bg-bg-elevated rounded-xl text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-indigo"
                    disabled={submitting}
                  />
                  <button
                    type="button"
                    onClick={handleSendComment}
                    disabled={submitting || !newComment.trim()}
                    className={cn(
                      'px-5 py-3 rounded-xl bg-accent-indigo text-white text-sm font-medium flex items-center gap-2',
                      (submitting || !newComment.trim()) && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    {submitting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                    {submitting ? '发送中...' : '发送'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 右侧：时间线 */}
          <div className="lg:w-[320px] lg:flex-shrink-0">
            <div className="bg-bg-card rounded-2xl p-4 lg:p-6 card-shadow lg:h-full">
              <h3 className="text-base lg:text-lg font-semibold text-text-primary mb-5">处理进度</h3>
              <div className="flex flex-col gap-0">
                {appeal.timeline?.map((item, index) => (
                  <div key={index} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className={cn(
                        'w-3 h-3 rounded-full',
                        index === (appeal.timeline?.length || 0) - 1 ? 'bg-accent-indigo' : 'bg-text-tertiary'
                      )} />
                      {index < (appeal.timeline?.length || 0) - 1 && (
                        <div className="w-0.5 h-16 bg-border-subtle" />
                      )}
                    </div>
                    <div className="flex flex-col gap-1 pb-6">
                      <span className="text-xs text-text-tertiary">{item.time}</span>
                      <span className="text-sm font-medium text-text-primary">{item.action}</span>
                      {item.operator && (
                        <span className="text-xs text-text-secondary">{item.operator}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </ResponsiveLayout>
  )
}
