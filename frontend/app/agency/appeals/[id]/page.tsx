'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import {
  ArrowLeft,
  MessageSquare,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  User,
  FileText,
  Video,
  Download,
  File,
  Send,
  Image as ImageIcon,
  Loader2
} from 'lucide-react'
import { api } from '@/lib/api'
import { formatTaskDisplayName } from '@/lib/taskDisplay'
import type { TaskResponse } from '@/types/task'

// 申诉状态类型
type AppealStatus = 'pending' | 'processing' | 'approved' | 'rejected'

// 申诉详情类型
interface AppealDetail {
  id: string
  taskId: string
  taskTitle: string
  creatorId?: string
  creatorName: string
  creatorAvatar: string
  type: 'ai' | 'agency'
  contentType: 'script' | 'video'
  reason: string
  content: string
  status: AppealStatus
  createdAt: string
  appealCount: number
  attachments: { id: string; name: string; size: string; type: string }[]
  originalIssue: {
    type: string
    title: string
    description: string
    location: string
  }
  taskInfo: {
    projectName: string
    scriptFileName: string
    scriptFileSize: string
  }
}

// Derive a UI-compatible appeal detail from a TaskResponse
function mapTaskToAppealDetail(task: TaskResponse) {
  const isVideoStage = task.stage.startsWith('video')
  const contentType: 'script' | 'video' = isVideoStage ? 'video' : 'script'
  const type: 'ai' | 'agency' = task.stage.includes('ai') ? 'ai' : 'agency'

  let status: AppealStatus = 'pending'
  if (task.stage === 'completed') {
    status = 'approved'
  } else if (task.stage === 'rejected') {
    status = 'rejected'
  } else if (task.stage.includes('review')) {
    status = 'processing'
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    }).replace(/\//g, '-')
  }

  // Extract original issue from AI results if available
  const aiResult = isVideoStage ? task.video_ai_result : task.script_ai_result
  const agencyComment = isVideoStage ? task.video_agency_comment : task.script_agency_comment
  const originalIssueTitle = aiResult?.violations?.[0]?.type || agencyComment || '审核问题'
  const originalIssueDesc = aiResult?.violations?.[0]?.content || agencyComment || ''
  const originalIssueLocation = aiResult?.violations?.[0]?.source || ''
  const creatorId = task.creator.id ?? undefined

  return {
    id: task.id,
    taskId: task.id,
    taskTitle: formatTaskDisplayName({
      taskName: task.name,
      projectName: task.project?.name,
      sequence: task.sequence,
    }),
    ...(creatorId ? { creatorId } : {}),
    creatorName: task.creator.name,
    creatorAvatar: task.creator.name.charAt(0),
    type,
    contentType,
    reason: task.appeal_reason || '申诉',
    content: task.appeal_reason || '',
    status,
    createdAt: formatDate(task.updated_at),
    appealCount: task.appeal_count,
    attachments: [] as { id: string; name: string; size: string; type: string }[],
    originalIssue: {
      type: type === 'ai' ? 'ai' : 'agency',
      title: originalIssueTitle,
      description: originalIssueDesc,
      location: originalIssueLocation,
    },
    taskInfo: {
      projectName: task.project?.name || '未命名项目',
      scriptFileName: isVideoStage
        ? (task.video_file_name || '视频文件')
        : (task.script_file_name || '脚本文件'),
      scriptFileSize: '-',
    },
  }
}

// 状态配置
const statusConfig: Record<AppealStatus, { label: string; color: string; bgColor: string; icon: React.ElementType }> = {
  pending: { label: '待处理', color: 'text-accent-amber', bgColor: 'bg-accent-amber/15', icon: Clock },
  processing: { label: '处理中', color: 'text-accent-indigo', bgColor: 'bg-accent-indigo/15', icon: MessageSquare },
  approved: { label: '已通过', color: 'text-accent-green', bgColor: 'bg-accent-green/15', icon: CheckCircle },
  rejected: { label: '已驳回', color: 'text-accent-coral', bgColor: 'bg-accent-coral/15', icon: XCircle },
}

export default function AgencyAppealDetailPage() {
  const router = useRouter()
  const toast = useToast()
  const params = useParams()
  const taskId = params.id as string

  const [appeal, setAppeal] = useState<AppealDetail | null>(null)
  const [replyContent, setReplyContent] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)

  const fetchAppeal = useCallback(async () => {
    try {
      setLoading(true)
      const task = await api.getTask(taskId)
      setAppeal(mapTaskToAppealDetail(task))
    } catch (err) {
      console.error('Failed to fetch appeal detail:', err)
      toast.error('加载申诉详情失败')
      setAppeal(null)
    } finally {
      setLoading(false)
    }
  }, [taskId, toast])

  useEffect(() => {
    fetchAppeal()
  }, [fetchAppeal])

  const handleApprove = async () => {
    if (!appeal) return
    if (!replyContent.trim()) {
      toast.error('请填写处理意见')
      return
    }
    setIsSubmitting(true)

    try {
      // Determine if this is script or video review based on the appeal's content type
      const isVideo = appeal.contentType === 'video'
      if (isVideo) {
        await api.reviewVideo(taskId, { action: 'pass', comment: replyContent })
      } else {
        await api.reviewScript(taskId, { action: 'pass', comment: replyContent })
      }
      toast.success('申诉已通过')
      router.push('/agency/appeals')
    } catch (err) {
      console.error('Failed to approve appeal:', err)
      toast.error('操作失败，请重试')
      setIsSubmitting(false)
    }
  }

  const handleReject = async () => {
    if (!appeal) return
    if (!replyContent.trim()) {
      toast.error('请填写驳回原因')
      return
    }
    setIsSubmitting(true)

    try {
      const isVideo = appeal.contentType === 'video'
      if (isVideo) {
        await api.reviewVideo(taskId, { action: 'reject', comment: replyContent })
      } else {
        await api.reviewScript(taskId, { action: 'reject', comment: replyContent })
      }
      toast.success('申诉已驳回')
      router.push('/agency/appeals')
    } catch (err) {
      console.error('Failed to reject appeal:', err)
      toast.error('操作失败，请重试')
      setIsSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-text-tertiary">
        <Loader2 size={32} className="animate-spin mb-4" />
        <p>加载中...</p>
      </div>
    )
  }

  if (!appeal) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-text-tertiary">
        <p className="mb-4">申诉不存在或已被删除</p>
        <Button variant="secondary" onClick={() => router.back()}>返回</Button>
      </div>
    )
  }

  const status = statusConfig[appeal.status]
  const StatusIcon = status.icon

  return (
    <div className="space-y-6">
      {/* 顶部导航 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => router.back()}
            className="p-2 rounded-lg hover:bg-bg-elevated transition-colors"
          >
            <ArrowLeft size={20} className="text-text-secondary" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-text-primary">申诉处理</h1>
            <p className="text-sm text-text-secondary mt-0.5">申诉编号: {appeal.id}</p>
          </div>
        </div>
        <div className={`flex items-center gap-2 px-4 py-2 rounded-xl ${status.bgColor}`}>
          <StatusIcon size={18} className={status.color} />
          <span className={`font-medium ${status.color}`}>{status.label}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左侧：申诉详情 */}
        <div className="lg:col-span-2 space-y-6">
          {/* 申诉人信息 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User size={18} className="text-accent-indigo" />
                申诉人信息
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-accent-indigo to-purple-500 flex items-center justify-center text-white font-bold text-lg">
                  {appeal.creatorAvatar}
                </div>
                <div>
                  <p className="font-medium text-text-primary">{appeal.creatorName}</p>
                  <p className="text-sm text-text-secondary">达人ID: {appeal.creatorId}</p>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-border-subtle grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-text-tertiary">任务名称</span>
                  <p className="text-text-primary mt-1">{appeal.taskTitle}</p>
                </div>
                <div>
                  <span className="text-text-tertiary">所属项目</span>
                  <p className="text-text-primary mt-1">{appeal.taskInfo.projectName}</p>
                </div>
                <div>
                  <span className="text-text-tertiary">内容类型</span>
                  <p className="text-text-primary mt-1 flex items-center gap-1">
                    {appeal.contentType === 'script' ? <FileText size={14} /> : <Video size={14} />}
                    {appeal.contentType === 'script' ? '脚本' : '视频'}
                  </p>
                </div>
                <div>
                  <span className="text-text-tertiary">提交时间</span>
                  <p className="text-text-primary mt-1">{appeal.createdAt}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 原审核问题 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle size={18} className="text-accent-coral" />
                原审核问题
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="p-4 rounded-xl bg-accent-coral/10 border border-accent-coral/20">
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2 py-0.5 text-xs rounded bg-accent-coral/20 text-accent-coral">
                    {appeal.originalIssue.type === 'ai' ? 'AI检测' : '人工审核'}
                  </span>
                  <span className="font-medium text-text-primary">{appeal.originalIssue.title}</span>
                </div>
                <p className="text-sm text-text-secondary">{appeal.originalIssue.description}</p>
                {appeal.originalIssue.location && (
                  <p className="text-xs text-text-tertiary mt-2">位置: {appeal.originalIssue.location}</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* 申诉内容 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare size={18} className="text-accent-indigo" />
                申诉内容
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <span className="text-sm text-text-tertiary">申诉原因</span>
                  <p className="text-text-primary mt-1 font-medium">{appeal.reason}</p>
                </div>
                <div>
                  <span className="text-sm text-text-tertiary">详细说明</span>
                  <p className="text-text-primary mt-1 leading-relaxed">{appeal.content}</p>
                </div>
                <div>
                  <span className="text-sm text-text-tertiary">申诉次数</span>
                  <p className="text-text-primary mt-1">{appeal.appealCount} 次</p>
                </div>

                {/* 附件 */}
                {appeal.attachments.length > 0 && (
                  <div>
                    <span className="text-sm text-text-tertiary">附件材料</span>
                    <div className="mt-2 space-y-2">
                      {appeal.attachments.map((att) => (
                        <div
                          key={att.id}
                          className="flex items-center gap-3 p-3 rounded-lg bg-bg-elevated"
                        >
                          <div className="w-10 h-10 rounded-lg bg-accent-indigo/15 flex items-center justify-center">
                            {att.type === 'image' ? (
                              <ImageIcon size={20} className="text-accent-indigo" />
                            ) : (
                              <File size={20} className="text-accent-indigo" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-text-primary truncate">{att.name}</p>
                            <p className="text-xs text-text-tertiary">{att.size}</p>
                          </div>
                          <button
                            type="button"
                            className="p-2 rounded-lg hover:bg-bg-page transition-colors"
                            title="下载"
                          >
                            <Download size={16} className="text-text-secondary" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 右侧：处理面板 */}
        <div className="space-y-6">
          {/* 相关文件 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText size={18} className="text-accent-indigo" />
                相关文件
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-bg-elevated">
                <div className="w-10 h-10 rounded-lg bg-accent-indigo/15 flex items-center justify-center">
                  <File size={20} className="text-accent-indigo" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">
                    {appeal.taskInfo.scriptFileName}
                  </p>
                  <p className="text-xs text-text-tertiary">{appeal.taskInfo.scriptFileSize}</p>
                </div>
                <button
                  type="button"
                  className="p-2 rounded-lg hover:bg-bg-page transition-colors"
                  title="下载"
                >
                  <Download size={16} className="text-text-secondary" />
                </button>
              </div>
            </CardContent>
          </Card>

          {/* 处理决策 */}
          {appeal.status === 'pending' || appeal.status === 'processing' ? (
            <Card>
              <CardHeader>
                <CardTitle>处理决策</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm text-text-secondary mb-2 block">处理意见</label>
                  <textarea
                    value={replyContent}
                    onChange={(e) => setReplyContent(e.target.value)}
                    placeholder="请输入处理意见或驳回原因..."
                    className="w-full h-32 p-3 rounded-xl bg-bg-elevated border border-border-subtle text-text-primary placeholder-text-tertiary resize-none focus:outline-none focus:ring-2 focus:ring-accent-indigo"
                  />
                </div>
                <div className="flex gap-3">
                  <Button
                    variant="primary"
                    className="flex-1 bg-accent-green hover:bg-accent-green/80"
                    onClick={handleApprove}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                    通过申诉
                  </Button>
                  <Button
                    variant="secondary"
                    className="flex-1 border-accent-coral text-accent-coral hover:bg-accent-coral/10"
                    onClick={handleReject}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <XCircle size={16} />}
                    驳回申诉
                  </Button>
                </div>
                <p className="text-xs text-text-tertiary text-center">
                  通过申诉将撤销原审核问题，驳回将维持原审核结果
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>处理结果</CardTitle>
              </CardHeader>
              <CardContent>
                <div className={`p-4 rounded-xl ${status.bgColor}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <StatusIcon size={18} className={status.color} />
                    <span className={`font-medium ${status.color}`}>
                      {appeal.status === 'approved' ? '申诉已通过' : '申诉已驳回'}
                    </span>
                  </div>
                  <p className="text-sm text-text-secondary">
                    {appeal.status === 'approved'
                      ? '经核实，达人申诉理由成立，已撤销原审核问题。'
                      : '经核实，原审核问题有效，申诉不成立。'}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
