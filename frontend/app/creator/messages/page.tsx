'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import {
  UserPlus,
  ClipboardList,
  CheckCircle,
  PenLine,
  ScanSearch,
  Building2,
  XCircle,
  BadgeCheck,
  Video,
  MessageCircle,
  CalendarClock,
  FileText,
  Bell,
  Eye,
  Clock
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ResponsiveLayout } from '@/components/layout/ResponsiveLayout'
import { cn } from '@/lib/utils'
import { formatLegacyTaskNameInMessageContent } from '@/lib/taskDisplay'

// 消息类型
type MessageType =
  | 'invite'        // 代理商邀请
  | 'new_task'      // 新任务分配
  | 'pass'          // 审核通过
  | 'need_fix'      // 需要修改
  | 'ai_complete'   // AI审核完成
  | 'agency_pass'   // 代理商审核通过
  | 'agency_reject' // 代理商审核驳回
  | 'brand_pass'    // 品牌方审核通过
  | 'brand_reject'  // 品牌方审核驳回
  | 'script_corrected' // 代理商已提交修正稿
  | 'video_ai'      // 视频AI审核完成
  | 'appeal'                  // 申诉结果（通用）
  | 'appeal_success'          // 申诉成功（违规被撤销）
  | 'appeal_failed'           // 申诉失败（维持原判）
  | 'appeal_quota_approved'   // 申请增加申诉次数成功
  | 'appeal_quota_rejected'   // 申请增加申诉次数失败
  | 'video_agency_reject'     // 视频代理商驳回
  | 'video_brand_reject'      // 视频品牌方驳回
  | 'task_deadline'           // 任务截止提醒
  | 'brief_updated'           // Brief更新通知
  | 'system_notice'           // 系统通知
  | 'reject'                  // 审核驳回
  | 'force_pass'              // 强制通过
  | 'approve'                 // 审核批准

type Message = {
  id: string
  type: MessageType
  title: string
  content: string
  time: string
  read: boolean
  taskId?: string
  hasActions?: boolean // 是否有操作按钮（邀请类型）
  agencyId?: string // 关联代理商 ID
  actionStatus?: string | null // pending/accepted/rejected
  agencyName?: string // 代理商名称（新任务类型）
  taskName?: string // 任务名称（新任务类型）
}

// 消息配置
const messageConfig: Record<MessageType, {
  icon: React.ElementType
  iconColor: string
  bgColor: string
}> = {
  invite: { icon: UserPlus, iconColor: 'text-purple-400', bgColor: 'bg-purple-500/20' },
  new_task: { icon: ClipboardList, iconColor: 'text-accent-indigo', bgColor: 'bg-accent-indigo/20' },
  pass: { icon: CheckCircle, iconColor: 'text-accent-green', bgColor: 'bg-accent-green/20' },
  need_fix: { icon: PenLine, iconColor: 'text-accent-coral', bgColor: 'bg-accent-coral/20' },
  ai_complete: { icon: ScanSearch, iconColor: 'text-accent-indigo', bgColor: 'bg-accent-indigo/20' },
  agency_pass: { icon: Building2, iconColor: 'text-accent-green', bgColor: 'bg-accent-green/20' },
  agency_reject: { icon: XCircle, iconColor: 'text-accent-coral', bgColor: 'bg-accent-coral/20' },
  brand_pass: { icon: BadgeCheck, iconColor: 'text-accent-green', bgColor: 'bg-accent-green/20' },
  brand_reject: { icon: XCircle, iconColor: 'text-accent-coral', bgColor: 'bg-accent-coral/20' },
  script_corrected: { icon: FileText, iconColor: 'text-accent-indigo', bgColor: 'bg-accent-indigo/20' },
  video_ai: { icon: Video, iconColor: 'text-accent-indigo', bgColor: 'bg-accent-indigo/20' },
  appeal: { icon: MessageCircle, iconColor: 'text-accent-blue', bgColor: 'bg-accent-blue/20' },
  appeal_success: { icon: CheckCircle, iconColor: 'text-accent-green', bgColor: 'bg-accent-green/20' },
  appeal_failed: { icon: XCircle, iconColor: 'text-accent-coral', bgColor: 'bg-accent-coral/20' },
  appeal_quota_approved: { icon: CheckCircle, iconColor: 'text-accent-green', bgColor: 'bg-accent-green/20' },
  appeal_quota_rejected: { icon: XCircle, iconColor: 'text-accent-coral', bgColor: 'bg-accent-coral/20' },
  video_agency_reject: { icon: XCircle, iconColor: 'text-accent-coral', bgColor: 'bg-accent-coral/20' },
  video_brand_reject: { icon: XCircle, iconColor: 'text-accent-coral', bgColor: 'bg-accent-coral/20' },
  task_deadline: { icon: CalendarClock, iconColor: 'text-orange-400', bgColor: 'bg-orange-500/20' },
  brief_updated: { icon: FileText, iconColor: 'text-accent-indigo', bgColor: 'bg-accent-indigo/20' },
  system_notice: { icon: Bell, iconColor: 'text-text-secondary', bgColor: 'bg-bg-elevated' },
  reject: { icon: XCircle, iconColor: 'text-accent-coral', bgColor: 'bg-accent-coral/20' },
  force_pass: { icon: CheckCircle, iconColor: 'text-accent-amber', bgColor: 'bg-accent-amber/20' },
  approve: { icon: CheckCircle, iconColor: 'text-accent-green', bgColor: 'bg-accent-green/20' },
}

// 消息卡片组件
function MessageCard({
  message,
  onRead,
  onNavigate,
  onViewBrief,
  onAcceptInvite,
  onIgnoreInvite,
}: {
  message: Message
  onRead: () => void
  onNavigate: () => void
  onViewBrief?: () => void
  onAcceptInvite?: () => void
  onIgnoreInvite?: () => void
}) {
  const config = messageConfig[message.type] || messageConfig.system_notice
  const Icon = config.icon

  return (
    <div
      className={cn(
        'rounded-xl p-4 flex gap-4 transition-colors',
        message.read
          ? 'bg-transparent border border-bg-elevated'
          : 'bg-bg-elevated',
        // 新任务和邀请类型不整体点击跳转
        message.type !== 'new_task' && message.type !== 'invite' && message.taskId ? 'cursor-pointer' : ''
      )}
      onClick={() => {
        if (message.type !== 'new_task' && message.type !== 'invite') {
          onRead()
          if (message.taskId) onNavigate()
        }
      }}
    >
      {/* 图标 */}
      <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0', config.bgColor)}>
        <Icon size={24} className={config.iconColor} />
      </div>

      {/* 内容 */}
      <div className="flex-1 flex flex-col gap-2">
        {/* 头部 */}
        <div className="flex items-center justify-between">
          <span className="text-[15px] font-semibold text-text-primary">{message.title}</span>
          <span className="text-xs text-text-secondary">{message.time}</span>
        </div>

        {/* 描述 */}
        <p className="text-sm text-text-secondary leading-relaxed">{message.content}</p>

        {/* 新任务类型的操作按钮 */}
        {message.type === 'new_task' && message.taskId && (
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              className="px-4 py-2 rounded-md bg-accent-indigo text-white text-sm font-medium hover:bg-accent-indigo/90 transition-colors"
              onClick={(e) => {
                e.stopPropagation()
                onRead()
                onViewBrief?.()
              }}
            >
              查看任务要求
            </button>
            <button
              type="button"
              className="px-4 py-2 rounded-md border border-border-subtle text-text-secondary text-sm font-medium hover:bg-bg-elevated transition-colors"
              onClick={(e) => {
                e.stopPropagation()
                onRead()
                onNavigate()
              }}
            >
              开始任务
            </button>
          </div>
        )}

        {/* 邀请类型的操作按钮 */}
        {message.hasActions && (
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              className="px-4 py-2 rounded-md bg-accent-indigo text-white text-sm font-medium hover:bg-accent-indigo/90 transition-colors"
              onClick={(e) => {
                e.stopPropagation()
                onAcceptInvite?.()
              }}
            >
              接受邀请
            </button>
            <button
              type="button"
              className="px-4 py-2 rounded-md border border-border-subtle text-text-secondary text-sm font-medium hover:bg-bg-elevated transition-colors"
              onClick={(e) => {
                e.stopPropagation()
                onIgnoreInvite?.()
              }}
            >
              暂时忽略
            </button>
          </div>
        )}

        {/* 已处理邀请的状态标签 */}
        {message.type === 'invite' && !message.hasActions && message.actionStatus === 'accepted' && (
          <div className="flex items-center gap-2 pt-2">
            <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-accent-green/15 text-accent-green text-sm font-medium">
              <CheckCircle size={14} />
              已接受
            </span>
          </div>
        )}
        {message.type === 'invite' && !message.hasActions && message.actionStatus === 'rejected' && (
          <div className="flex items-center gap-2 pt-2">
            <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-bg-elevated text-text-secondary text-sm font-medium">
              已忽略
            </span>
          </div>
        )}
      </div>

      {/* 未读标记 */}
      {!message.read && (
        <div className="w-2.5 h-2.5 rounded-full bg-accent-indigo flex-shrink-0 mt-1" />
      )}
    </div>
  )
}

// 邀请确认弹窗
function InviteConfirmModal({
  isOpen,
  type,
  agencyName,
  onClose,
  onConfirm,
}: {
  isOpen: boolean
  type: 'accept' | 'ignore'
  agencyName: string
  onClose: () => void
  onConfirm: () => void
}) {
  if (!isOpen) return null

  const isAccept = type === 'accept'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-bg-card rounded-2xl p-6 w-full max-w-md mx-4 card-shadow">
        <h3 className="text-xl font-bold text-text-primary mb-2">
          {isAccept ? '确认接受邀请' : '确认忽略邀请'}
        </h3>
        <p className="text-sm text-text-secondary mb-6">
          {isAccept
            ? `您确定要接受「${agencyName}」的签约邀请吗？接受后您将成为该代理商的签约达人，可以接收推广任务。`
            : `您确定要忽略「${agencyName}」的邀请吗？忽略后代理商可重新发送邀请。`}
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 rounded-xl bg-bg-elevated text-text-primary text-sm font-medium"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={cn(
              'flex-1 py-3 rounded-xl text-sm font-semibold',
              isAccept ? 'bg-accent-indigo text-white' : 'bg-accent-coral text-white'
            )}
          >
            {isAccept ? '确认接受' : '确认忽略'}
          </button>
        </div>
      </div>
    </div>
  )
}

// 成功提示弹窗
function SuccessModal({
  isOpen,
  message,
  onClose,
}: {
  isOpen: boolean
  message: string
  onClose: () => void
}) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-bg-card rounded-2xl p-8 w-full max-w-sm mx-4 card-shadow flex flex-col items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-accent-green/15 flex items-center justify-center">
          <CheckCircle className="w-8 h-8 text-accent-green" />
        </div>
        <p className="text-base font-semibold text-text-primary text-center">{message}</p>
        <button
          type="button"
          onClick={onClose}
          className="px-8 py-2.5 rounded-xl bg-accent-indigo text-white text-sm font-medium"
        >
          我知道了
        </button>
      </div>
    </div>
  )
}

export default function CreatorMessagesPage() {
  const router = useRouter()
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean; type: 'accept' | 'ignore'; messageId: string }>({
    isOpen: false,
    type: 'accept',
    messageId: '',
  })
  const [successModal, setSuccessModal] = useState<{ isOpen: boolean; message: string }>({
    isOpen: false,
    message: '',
  })

  const loadData = useCallback(async () => {
    try {
      const res = await api.getMessages({ page: 1, page_size: 50 })
      const mapped: Message[] = res.items.map(item => ({
        id: item.id,
        type: (item.type || 'system_notice') as MessageType,
        title: item.title,
        content: formatLegacyTaskNameInMessageContent(item.content),
        time: item.created_at ? new Date(item.created_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '',
        read: item.is_read,
        taskId: item.related_task_id || undefined,
        agencyId: item.related_agency_id || undefined,
        actionStatus: item.action_status || undefined,
        hasActions: item.type === 'invite' && item.action_status === 'pending',
      }))
      setMessages(mapped)
    } catch {
      setMessages([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const markAsRead = async (id: string) => {
    setMessages(prev => prev.map(msg =>
      msg.id === id ? { ...msg, read: true } : msg
    ))
    try { await api.markMessageAsRead(id) } catch {}
  }

  const markAllAsRead = async () => {
    setMessages(prev => prev.map(msg => ({ ...msg, read: true })))
    try { await api.markAllMessagesAsRead() } catch {}
  }

  // 根据消息类型跳转到对应页面
  const navigateByMessage = (message: Message) => {
    // 标记已读
    markAsRead(message.id)

    // 根据消息类型决定跳转目标
    switch (message.type) {
      case 'invite':
        // 邀请消息不跳转，在卡片内有操作按钮
        break
      case 'new_task':
        // 新任务 -> 跳转到Brief查看页
        if (message.taskId) router.push(`/creator/task/${message.taskId}/brief`)
        break
      case 'task_deadline':
        // 任务截止提醒 -> 跳转到任务详情
        if (message.taskId) router.push(`/creator/task/${message.taskId}`)
        break
      case 'brief_updated':
        // Brief更新 -> 跳转到Brief查看页
        if (message.taskId) router.push(`/creator/task/${message.taskId}/brief`)
        break
      case 'pass':
        // 审核通过 -> 跳转到任务详情
        if (message.taskId) router.push(`/creator/task/${message.taskId}`)
        break
      case 'need_fix':
        // 需要修改 -> 跳转到任务详情（查看问题）
        if (message.taskId) router.push(`/creator/task/${message.taskId}`)
        break
      case 'ai_complete':
        // AI审核完成 -> 跳转到任务详情
        if (message.taskId) router.push(`/creator/task/${message.taskId}`)
        break
      case 'agency_pass':
        // 代理商审核通过 -> 跳转到任务详情
        if (message.taskId) router.push(`/creator/task/${message.taskId}`)
        break
      case 'agency_reject':
        // 代理商审核驳回 -> 跳转到任务详情（查看驳回原因）
        if (message.taskId) router.push(`/creator/task/${message.taskId}`)
        break
      case 'brand_pass':
        // 品牌方审核通过 -> 跳转到任务详情
        if (message.taskId) router.push(`/creator/task/${message.taskId}`)
        break
      case 'brand_reject':
        // 品牌方审核驳回 -> 跳转到任务详情
        if (message.taskId) router.push(`/creator/task/${message.taskId}`)
        break
      case 'script_corrected':
        // 修正稿已生成 -> 直接跳转到脚本页
        if (message.taskId) router.push(`/creator/task/${message.taskId}/script`)
        break
      case 'video_ai':
        // 视频AI审核完成 -> 跳转到任务详情
        if (message.taskId) router.push(`/creator/task/${message.taskId}`)
        break
      case 'appeal':
        // 申诉结果 -> 跳转到申诉中心
        router.push('/creator/appeals')
        break
      case 'appeal_success':
      case 'appeal_failed':
        // 申诉成功/失败 -> 跳转到任务详情
        if (message.taskId) router.push(`/creator/task/${message.taskId}`)
        else router.push('/creator/appeals')
        break
      case 'appeal_quota_approved':
      case 'appeal_quota_rejected':
        // 申诉次数申请结果 -> 跳转到任务详情
        if (message.taskId) router.push(`/creator/task/${message.taskId}`)
        else router.push('/creator/appeal-quota')
        break
      case 'video_agency_reject':
        // 视频代理商驳回 -> 跳转到任务详情
        if (message.taskId) router.push(`/creator/task/${message.taskId}`)
        break
      case 'video_brand_reject':
        // 视频品牌方驳回 -> 跳转到任务详情
        if (message.taskId) router.push(`/creator/task/${message.taskId}`)
        break
      default:
        if (message.taskId) router.push(`/creator/task/${message.taskId}`)
    }
  }

  const handleAcceptInvite = (messageId: string) => {
    setConfirmModal({ isOpen: true, type: 'accept', messageId })
  }

  const handleIgnoreInvite = (messageId: string) => {
    setConfirmModal({ isOpen: true, type: 'ignore', messageId })
  }

  const handleConfirmAction = async () => {
    const { type, messageId } = confirmModal
    setConfirmModal({ ...confirmModal, isOpen: false })

    try {
      if (type === 'accept') {
        await api.acceptInvite(messageId)
      } else {
        await api.rejectInvite(messageId)
      }
    } catch (err: any) {
      setSuccessModal({
        isOpen: true,
        message: err?.message || '操作失败，请稍后重试',
      })
      return
    }

    // 更新消息状态
    const newStatus = type === 'accept' ? 'accepted' : 'rejected'
    setMessages(prev => prev.map(msg =>
      msg.id === messageId ? { ...msg, hasActions: false, read: true, actionStatus: newStatus } : msg
    ))

    // 显示成功提示
    setSuccessModal({
      isOpen: true,
      message: type === 'accept'
        ? '已成功接受邀请！您现在可以接收该代理商分配的推广任务了。'
        : '已忽略该邀请。如需重新查看，请联系代理商。',
    })
  }

  // 获取当前确认弹窗的代理商名称
  const getAgencyName = () => {
    const message = messages.find(m => m.id === confirmModal.messageId)
    if (message?.content.includes('「')) {
      const match = message.content.match(/「([^」]+)」/)
      return match ? match[1] : '该代理商'
    }
    return '该代理商'
  }

  return (
    <ResponsiveLayout role="creator">
      <div className="flex flex-col gap-6 h-full">
        {/* 顶部栏 */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl lg:text-[24px] font-bold text-text-primary">消息中心</h1>
            <p className="text-sm text-text-secondary">查看任务通知、审核结果和申诉反馈</p>
          </div>
          <button
            type="button"
            className="px-4 py-2.5 rounded-lg bg-bg-elevated text-text-primary text-sm"
            onClick={markAllAsRead}
          >
            全部标为已读
          </button>
        </div>

        {/* 消息列表 - 可滚动 */}
        <div className="bg-bg-card rounded-2xl p-4 lg:p-6 flex-1 overflow-hidden">
          <div className="flex flex-col gap-4 h-full overflow-y-auto pr-2">
            {messages.map((message) => (
              <MessageCard
                key={message.id}
                message={message}
                onRead={() => markAsRead(message.id)}
                onNavigate={() => navigateByMessage(message)}
                onViewBrief={() => {
                  if (message.taskId) router.push(`/creator/task/${message.taskId}/brief`)
                }}
                onAcceptInvite={() => handleAcceptInvite(message.id)}
                onIgnoreInvite={() => handleIgnoreInvite(message.id)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* 确认弹窗 */}
      <InviteConfirmModal
        isOpen={confirmModal.isOpen}
        type={confirmModal.type}
        agencyName={getAgencyName()}
        onClose={() => setConfirmModal({ ...confirmModal, isOpen: false })}
        onConfirm={handleConfirmAction}
      />

      {/* 成功提示弹窗 */}
      <SuccessModal
        isOpen={successModal.isOpen}
        message={successModal.message}
        onClose={() => setSuccessModal({ ...successModal, isOpen: false })}
      />
    </ResponsiveLayout>
  )
}
