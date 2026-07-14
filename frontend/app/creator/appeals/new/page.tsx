'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft,
  Upload,
  X,
  FileText,
  Image as ImageIcon,
  AlertTriangle,
  CheckCircle,
  Loader2
} from 'lucide-react'
import { ResponsiveLayout } from '@/components/layout/ResponsiveLayout'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { formatTaskDisplayTitle } from '@/lib/taskDisplay'
import { useToast } from '@/components/ui/Toast'
import type { TaskResponse } from '@/types/task'

// 申诉原因选项
const appealReasons = [
  { id: 'misjudge', label: '误判', description: 'AI或审核员误判了内容' },
  { id: 'unclear', label: '标准不清晰', description: '审核标准不明确或有歧义' },
  { id: 'evidence', label: '有证据支持', description: '有证据证明内容符合要求' },
  { id: 'context', label: '上下文理解', description: '审核未考虑完整上下文' },
  { id: 'other', label: '其他原因', description: '其他需要说明的情况' },
]

// Mock 任务信息类型
type TaskInfo = {
  title: string
  issue: string
  issueDesc: string
  type: string
  appealRemaining: number
  agencyName: string
}

// 任务信息（模拟从URL参数获取）
const getTaskInfo = (taskId: string): TaskInfo => {
  const tasks: Record<string, TaskInfo> = {
    'task-003': {
      title: 'ZZ饮品夏日',
      issue: '检测到竞品提及',
      issueDesc: '脚本第3段提及了竞品「百事可乐」，可能造成品牌冲突风险。',
      type: 'ai',
      appealRemaining: 1,
      agencyName: '星辰传媒',
    },
    'task-010': {
      title: 'GG智能手表',
      issue: '品牌调性不符',
      issueDesc: '脚本整体风格偏向娱乐化，与品牌科技专业形象不匹配。',
      type: 'agency',
      appealRemaining: 0,
      agencyName: '星辰传媒',
    },
    'task-011': {
      title: 'HH美妆代言',
      issue: '创意不够新颖',
      issueDesc: '脚本采用的是常见的口播形式，缺乏创新点和记忆点。',
      type: 'brand',
      appealRemaining: 1,
      agencyName: '晨曦文化',
    },
    'task-013': {
      title: 'JJ旅行vlog',
      issue: '背景音乐版权问题',
      issueDesc: '视频中使用的背景音乐存在版权风险。',
      type: 'agency',
      appealRemaining: 2,
      agencyName: '晨曦文化',
    },
    'task-015': {
      title: 'LL厨房电器',
      issue: '使用场景不真实',
      issueDesc: '视频中的厨房场景过于整洁，缺乏真实感。',
      type: 'brand',
      appealRemaining: 0,
      agencyName: '星辰传媒',
    },
  }
  return tasks[taskId] || { title: '未知任务', issue: '未知问题', issueDesc: '', type: 'ai', appealRemaining: 0, agencyName: '未知代理商' }
}

// 将 TaskResponse 映射为 TaskInfo
function mapTaskResponseToInfo(task: TaskResponse): TaskInfo {
  let type = 'ai'
  let issue = '审核驳回'
  let issueDesc = ''

  if (task.script_brand_status === 'rejected' || task.video_brand_status === 'rejected') {
    type = 'brand'
    issue = task.script_brand_comment || task.video_brand_comment || '品牌方审核驳回'
    issueDesc = task.script_brand_comment || task.video_brand_comment || ''
  } else if (task.script_agency_status === 'rejected' || task.video_agency_status === 'rejected') {
    type = 'agency'
    issue = task.script_agency_comment || task.video_agency_comment || '代理商审核驳回'
    issueDesc = task.script_agency_comment || task.video_agency_comment || ''
  } else {
    // AI rejection or default
    const aiResult = task.script_ai_result || task.video_ai_result
    const violations = aiResult?.conclusions?.violations || aiResult?.violations || []
    if (aiResult && violations.length > 0) {
      issue = (violations[0] as Record<string, unknown>).content as string || 'AI审核不通过'
      issueDesc = aiResult.summary || violations.map((v: Record<string, unknown>) => v.content as string).join('; ')
    }
  }

  // appeal_count 是后端记录的"剩余申诉次数"（初始值1，每次申诉-1）
  const appealRemaining = task.appeal_count

  return {
    title: formatTaskDisplayTitle({
      taskName: task.name,
      projectName: task.project?.name,
      sequence: task.sequence,
    }),
    issue,
    issueDesc,
    type,
    appealRemaining,
    agencyName: task.agency?.name || '未知代理商',
  }
}

// 表单骨架屏
function FormSkeleton() {
  return (
    <div className="flex flex-col gap-6 h-full animate-pulse">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex flex-col gap-2">
          <div className="h-8 w-16 bg-bg-elevated rounded-lg" />
          <div className="h-6 w-24 bg-bg-elevated rounded" />
          <div className="h-4 w-64 bg-bg-elevated rounded" />
        </div>
        <div className="h-10 w-48 bg-bg-elevated rounded-xl" />
      </div>
      <div className="flex flex-col lg:flex-row gap-6 flex-1">
        <div className="flex-1 flex flex-col gap-5">
          <div className="bg-bg-card rounded-2xl p-6 card-shadow">
            <div className="h-5 w-24 bg-bg-elevated rounded mb-4" />
            <div className="h-20 bg-bg-elevated rounded-xl" />
          </div>
          <div className="bg-bg-card rounded-2xl p-6 card-shadow">
            <div className="h-5 w-24 bg-bg-elevated rounded mb-4" />
            <div className="grid grid-cols-2 gap-3">
              <div className="h-16 bg-bg-elevated rounded-xl" />
              <div className="h-16 bg-bg-elevated rounded-xl" />
              <div className="h-16 bg-bg-elevated rounded-xl" />
              <div className="h-16 bg-bg-elevated rounded-xl" />
            </div>
          </div>
          <div className="bg-bg-card rounded-2xl p-6 card-shadow">
            <div className="h-5 w-24 bg-bg-elevated rounded mb-4" />
            <div className="h-32 bg-bg-elevated rounded-xl" />
          </div>
        </div>
        <div className="lg:w-[320px]">
          <div className="bg-bg-card rounded-2xl p-6 card-shadow">
            <div className="h-5 w-24 bg-bg-elevated rounded mb-5" />
            <div className="flex flex-col gap-4">
              <div className="h-4 w-full bg-bg-elevated rounded" />
              <div className="h-4 w-full bg-bg-elevated rounded" />
              <div className="h-4 w-full bg-bg-elevated rounded" />
            </div>
            <div className="h-12 bg-bg-elevated rounded-xl mt-6" />
          </div>
        </div>
      </div>
    </div>
  )
}

export default function NewAppealPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()
  const taskId = searchParams.get('taskId') || ''

  const [taskInfo, setTaskInfo] = useState<TaskInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedReason, setSelectedReason] = useState<string>('')
  const [content, setContent] = useState('')
  const [attachments, setAttachments] = useState<{ name: string; type: 'image' | 'document' }[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [isRequestingQuota, setIsRequestingQuota] = useState(false)
  const [quotaRequested, setQuotaRequested] = useState(false)

  // Load task info
  const loadTaskInfo = useCallback(async () => {
    if (!taskId) {
      toast.error('缺少任务ID参数')
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      const task = await api.getTask(taskId)
      const info = mapTaskResponseToInfo(task)
      setTaskInfo(info)
    } catch (err) {
      console.error('加载任务信息失败:', err)
      toast.error('加载任务信息失败，请稍后重试')
      // Fallback to a default
      setTaskInfo({ title: '未知任务', issue: '未知问题', issueDesc: '', type: 'ai', appealRemaining: 0, agencyName: '未知代理商' })
    } finally {
      setLoading(false)
    }
  }, [taskId, toast])

  useEffect(() => {
    loadTaskInfo()
  }, [loadTaskInfo])

  const hasAppealQuota = taskInfo ? taskInfo.appealRemaining > 0 : false

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files) {
      const newAttachments = Array.from(files).map(file => ({
        name: file.name,
        type: file.type.startsWith('image/') ? 'image' as const : 'document' as const,
      }))
      setAttachments([...attachments, ...newAttachments])
    }
  }

  const removeAttachment = (index: number) => {
    setAttachments(attachments.filter((_, i) => i !== index))
  }

  const handleSubmit = async () => {
    if (!selectedReason || !content.trim()) return

    try {
      setIsSubmitting(true)
      const reasonLabel = appealReasons.find(r => r.id === selectedReason)?.label || selectedReason
      const appealReason = `[${reasonLabel}] ${content.trim()}`
      await api.submitAppeal(taskId, { reason: appealReason })
      toast.success('申诉提交成功')
      setIsSubmitted(true)
      setTimeout(() => {
        router.push('/creator/appeals')
      }, 2000)
    } catch (err) {
      console.error('提交申诉失败:', err)
      toast.error('提交申诉失败，请稍后重试')
    } finally {
      setIsSubmitting(false)
    }
  }

  const canSubmit = selectedReason && content.trim().length >= 20 && hasAppealQuota

  // 申请增加申诉次数
  const handleRequestQuota = async () => {
    try {
      setIsRequestingQuota(true)
      await api.requestAppealCountIncrease(taskId)
      toast.success('申请已发送，等待代理商处理')
      setQuotaRequested(true)
      // Reload task info to get updated appeal count
      loadTaskInfo()
    } catch (err) {
      console.error('申请增加申诉次数失败:', err)
      toast.error('申请失败，请稍后重试')
    } finally {
      setIsRequestingQuota(false)
    }
  }

  // 加载中骨架屏
  if (loading) {
    return (
      <ResponsiveLayout role="creator">
        <FormSkeleton />
      </ResponsiveLayout>
    )
  }

  // 提交成功界面
  if (isSubmitted) {
    return (
      <ResponsiveLayout role="creator">
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center gap-6 max-w-md text-center">
            <div className="w-20 h-20 rounded-full bg-accent-green/15 flex items-center justify-center">
              <CheckCircle className="w-10 h-10 text-accent-green" />
            </div>
            <div className="flex flex-col gap-2">
              <h2 className="text-2xl font-bold text-text-primary">申诉提交成功</h2>
              <p className="text-text-secondary">
                您的申诉已提交，我们将在 1-3 个工作日内处理完成。处理结果将通过消息中心通知您。
              </p>
            </div>
            <p className="text-sm text-text-tertiary">正在跳转到申诉列表...</p>
          </div>
        </div>
      </ResponsiveLayout>
    )
  }

  // Use fallback if taskInfo is somehow null after loading
  const info = taskInfo || { title: '未知任务', issue: '未知问题', issueDesc: '', type: 'ai', appealRemaining: 0, agencyName: '未知代理商' }

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
            <h1 className="text-xl lg:text-[28px] font-bold text-text-primary">发起申诉</h1>
            <p className="text-sm lg:text-[15px] text-text-secondary">对审核结果有异议？提交申诉让我们重新审核</p>
          </div>
          <div className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-xl',
            hasAppealQuota ? 'bg-accent-indigo/15' : 'bg-accent-coral/15'
          )}>
            <AlertTriangle className={cn('w-5 h-5', hasAppealQuota ? 'text-accent-indigo' : 'text-accent-coral')} />
            <span className={cn('text-sm font-medium', hasAppealQuota ? 'text-accent-indigo' : 'text-accent-coral')}>
              本任务剩余 {info.appealRemaining} 次申诉机会
            </span>
          </div>
        </div>

        {/* 内容区 - 响应式布局 */}
        <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0 overflow-y-auto lg:overflow-hidden">
          {/* 左侧：申诉表单 */}
          <div className="flex-1 flex flex-col gap-5 lg:overflow-y-auto lg:pr-2">
            {/* 关联任务 */}
            <div className="bg-bg-card rounded-2xl p-4 lg:p-6 card-shadow">
              <h3 className="text-base lg:text-lg font-semibold text-text-primary mb-4">关联任务</h3>
              <div className="bg-bg-elevated rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-base font-semibold text-text-primary">{info.title}</span>
                  <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-accent-coral/15 text-accent-coral">
                    {info.type === 'ai' ? 'AI审核' : info.type === 'agency' ? '代理商审核' : '品牌方审核'}
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-accent-coral flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="text-sm font-medium text-text-primary">{info.issue}</span>
                    <p className="text-xs text-text-secondary mt-1">{info.issueDesc}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* 申诉次数不足提示 */}
            {!hasAppealQuota && (
              <div className="bg-accent-coral/10 border border-accent-coral/30 rounded-2xl p-4 lg:p-6">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-accent-coral flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <h3 className="text-base font-semibold text-accent-coral mb-2">申诉次数不足</h3>
                    <p className="text-sm text-text-secondary mb-4">
                      本任务的申诉次数已用完，无法提交新的申诉。您可以向代理商「{info.agencyName}」申请增加申诉次数。
                    </p>
                    {quotaRequested ? (
                      <div className="flex items-center gap-2 text-accent-green">
                        <CheckCircle className="w-4 h-4" />
                        <span className="text-sm font-medium">申请已发送，等待代理商处理</span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={handleRequestQuota}
                        disabled={isRequestingQuota}
                        className="px-4 py-2 bg-accent-coral text-white rounded-lg text-sm font-medium hover:bg-accent-coral/90 transition-colors disabled:opacity-50 flex items-center gap-2"
                      >
                        {isRequestingQuota && <Loader2 className="w-4 h-4 animate-spin" />}
                        {isRequestingQuota ? '申请中...' : '申请增加申诉次数'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 申诉原因 */}
            <div className={cn('bg-bg-card rounded-2xl p-4 lg:p-6 card-shadow', !hasAppealQuota && 'opacity-50 pointer-events-none')}>
              <h3 className="text-base lg:text-lg font-semibold text-text-primary mb-4">申诉原因 <span className="text-accent-coral">*</span></h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {appealReasons.map((reason) => (
                  <div
                    key={reason.id}
                    onClick={() => setSelectedReason(reason.id)}
                    className={cn(
                      'p-4 rounded-xl border-2 cursor-pointer transition-all',
                      selectedReason === reason.id
                        ? 'border-accent-indigo bg-accent-indigo/5'
                        : 'border-border-subtle hover:border-text-tertiary'
                    )}
                  >
                    <span className="text-sm font-semibold text-text-primary">{reason.label}</span>
                    <p className="text-xs text-text-tertiary mt-1">{reason.description}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* 申诉说明 */}
            <div className={cn('bg-bg-card rounded-2xl p-4 lg:p-6 card-shadow', !hasAppealQuota && 'opacity-50 pointer-events-none')}>
              <h3 className="text-base lg:text-lg font-semibold text-text-primary mb-4">
                申诉说明 <span className="text-accent-coral">*</span>
                <span className="text-xs text-text-tertiary font-normal ml-2">至少20字</span>
              </h3>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="请详细描述您的申诉理由，包括为什么您认为审核结果不合理..."
                className="w-full h-32 lg:h-40 p-4 bg-bg-elevated rounded-xl text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-indigo resize-none"
              />
              <div className="flex justify-end mt-2">
                <span className={cn(
                  'text-xs',
                  content.length >= 20 ? 'text-text-tertiary' : 'text-accent-coral'
                )}>
                  {content.length}/20 字
                </span>
              </div>
            </div>

            {/* 证明材料 */}
            <div className={cn('bg-bg-card rounded-2xl p-4 lg:p-6 card-shadow', !hasAppealQuota && 'opacity-50 pointer-events-none')}>
              <h3 className="text-base lg:text-lg font-semibold text-text-primary mb-4">
                证明材料 <span className="text-xs text-text-tertiary font-normal">（可选）</span>
              </h3>
              <div className="flex flex-wrap gap-3">
                {attachments.map((file, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 px-3 py-2 bg-bg-elevated rounded-lg"
                  >
                    {file.type === 'image' ? (
                      <ImageIcon className="w-4 h-4 text-accent-indigo" />
                    ) : (
                      <FileText className="w-4 h-4 text-accent-indigo" />
                    )}
                    <span className="text-sm text-text-primary max-w-[150px] truncate">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(index)}
                      className="w-5 h-5 rounded-full bg-bg-page flex items-center justify-center hover:bg-accent-coral/15"
                    >
                      <X className="w-3 h-3 text-text-tertiary" />
                    </button>
                  </div>
                ))}
                <label className="flex items-center gap-2 px-4 py-2 bg-bg-elevated rounded-lg cursor-pointer hover:bg-bg-page transition-colors">
                  <Upload className="w-4 h-4 text-accent-indigo" />
                  <span className="text-sm text-accent-indigo">上传文件</span>
                  <input
                    type="file"
                    multiple
                    accept="image/*,.pdf,.doc,.docx"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>
              <p className="text-xs text-text-tertiary mt-3">支持图片、PDF、Word 文档，单个文件不超过 10MB</p>
            </div>

            {/* 移动端提交按钮 */}
            <div className="lg:hidden">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit || isSubmitting}
                className={cn(
                  'w-full py-4 rounded-xl text-base font-semibold flex items-center justify-center gap-2',
                  canSubmit && !isSubmitting
                    ? 'bg-accent-indigo text-white'
                    : 'bg-bg-elevated text-text-tertiary'
                )}
              >
                {isSubmitting && <Loader2 className="w-5 h-5 animate-spin" />}
                {isSubmitting ? '提交中...' : '提交申诉'}
              </button>
            </div>
          </div>

          {/* 右侧：提交信息（仅桌面端显示） */}
          <div className="hidden lg:block lg:w-[320px] lg:flex-shrink-0">
            <div className="bg-bg-card rounded-2xl p-6 card-shadow sticky top-0">
              <h3 className="text-lg font-semibold text-text-primary mb-5">提交确认</h3>

              <div className="flex flex-col gap-4 mb-6">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-tertiary">关联任务</span>
                  <span className="text-sm text-text-primary">{info.title}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-tertiary">申诉原因</span>
                  <span className="text-sm text-text-primary">
                    {appealReasons.find(r => r.id === selectedReason)?.label || '未选择'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-tertiary">说明字数</span>
                  <span className={cn(
                    'text-sm',
                    content.length >= 20 ? 'text-accent-green' : 'text-text-tertiary'
                  )}>
                    {content.length} 字
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-tertiary">附件数量</span>
                  <span className="text-sm text-text-primary">{attachments.length} 个</span>
                </div>
              </div>

              <div className="bg-amber-500/10 rounded-xl p-4 mb-6">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-text-secondary">
                    提交后将消耗 1 次申诉机会。请确保信息准确，恶意申诉可能影响您的账号信誉。
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit || isSubmitting}
                className={cn(
                  'w-full py-4 rounded-xl text-base font-semibold transition-colors flex items-center justify-center gap-2',
                  canSubmit && !isSubmitting
                    ? 'bg-accent-indigo text-white hover:bg-accent-indigo/90'
                    : 'bg-bg-elevated text-text-tertiary cursor-not-allowed'
                )}
              >
                {isSubmitting && <Loader2 className="w-5 h-5 animate-spin" />}
                {isSubmitting ? '提交中...' : '提交申诉'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </ResponsiveLayout>
  )
}
