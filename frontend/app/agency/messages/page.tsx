'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { SuccessTag, WarningTag, ErrorTag, PendingTag } from '@/components/ui/Tag'
import {
  Bell,
  CheckCircle,
  XCircle,
  AlertTriangle,
  FileText,
  Video,
  Users,
  Clock,
  Check,
  MoreVertical,
  PlusCircle,
  UserCheck,
  UserX,
  Bot,
  Settings,
  CalendarClock,
  Building2,
  Eye
} from 'lucide-react'
import { getPlatformInfo } from '@/lib/platforms'
import { cn } from '@/lib/utils'
import { formatLegacyTaskNameInMessageContent } from '@/lib/taskDisplay'

// 消息类型
type MessageType =
  | 'appeal_quota_request'  // 达人申请增加申诉次数
  | 'task_submitted'        // 达人提交了脚本/视频
  | 'review_complete'       // 品牌终审通过
  | 'review_rejected'       // 品牌终审驳回
  | 'new_project'           // 被品牌邀请参与项目
  | 'warning'               // 风险预警
  | 'creator_accept'        // 达人接受签约邀请
  | 'creator_reject'        // 达人拒绝签约邀请
  | 'ai_review_complete'    // AI审核完成，待代理商审核
  | 'brand_config_updated'  // 品牌方更新了配置
  | 'task_deadline'         // 任务截止提醒
  | 'brand_brief_updated'   // 品牌方更新了Brief
  | 'system_notice'         // 系统通知
  | 'new_task'              // 新任务
  | 'pass'                  // 审核通过
  | 'reject'                // 审核驳回
  | 'force_pass'            // 强制通过
  | 'approve'               // 审核批准
  | 'brand_invite'          // 品牌方邀请加入

interface Message {
  id: string
  type: MessageType
  title: string
  content: string
  time: string
  read: boolean
  icon: typeof Bell
  iconColor: string
  bgColor: string
  platform?: string
  taskId?: string
  projectId?: string
  creatorName?: string
  hasAction?: boolean
  actionType?: 'review' | 'view' | 'config'
  // 品牌方邀请专用字段
  brandId?: string
  actionStatus?: string | null
  hasActions?: boolean
  // 申诉次数请求专用字段
  appealRequest?: {
    creatorName: string
    taskName: string
    taskId: string
    status: 'pending' | 'approved' | 'rejected'
  }
}

export default function AgencyMessagesPage() {
  const router = useRouter()
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'unread' | 'pending'>('all')
  const [confirmModal, setConfirmModal] = useState<{ show: boolean; messageId: string; action: 'accept' | 'reject'; brandName: string }>({ show: false, messageId: '', action: 'accept', brandName: '' })
  const [actionLoading, setActionLoading] = useState(false)

  const loadData = useCallback(async () => {
    try {
      const res = await api.getMessages({ page: 1, page_size: 50 })
      const typeIconMap: Record<string, { icon: typeof Bell; iconColor: string; bgColor: string }> = {
        new_task: { icon: FileText, iconColor: 'text-accent-indigo', bgColor: 'bg-accent-indigo/20' },
        pass: { icon: CheckCircle, iconColor: 'text-accent-green', bgColor: 'bg-accent-green/20' },
        approve: { icon: CheckCircle, iconColor: 'text-accent-green', bgColor: 'bg-accent-green/20' },
        reject: { icon: XCircle, iconColor: 'text-accent-coral', bgColor: 'bg-accent-coral/20' },
        force_pass: { icon: CheckCircle, iconColor: 'text-accent-amber', bgColor: 'bg-accent-amber/20' },
        brand_invite: { icon: Building2, iconColor: 'text-purple-400', bgColor: 'bg-purple-500/20' },
        appeal_quota_request: { icon: PlusCircle, iconColor: 'text-accent-amber', bgColor: 'bg-accent-amber/20' },
        system_notice: { icon: Bell, iconColor: 'text-text-secondary', bgColor: 'bg-bg-elevated' },
      }
      const defaultIcon = { icon: Bell, iconColor: 'text-text-secondary', bgColor: 'bg-bg-elevated' }
      const mapped: Message[] = res.items.map(item => {
        const iconCfg = typeIconMap[item.type] || defaultIcon
        return {
          id: item.id,
          type: (item.type || 'system_notice') as MessageType,
          title: item.title,
          content: formatLegacyTaskNameInMessageContent(item.content),
          time: item.created_at ? new Date(item.created_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '',
          read: item.is_read,
          icon: iconCfg.icon,
          iconColor: iconCfg.iconColor,
          bgColor: iconCfg.bgColor,
          taskId: item.related_task_id || undefined,
          projectId: item.related_project_id || undefined,
          brandId: item.related_brand_id || undefined,
          actionStatus: item.action_status || undefined,
          hasActions: item.type === 'brand_invite' && item.action_status === 'pending',
          appealRequest: item.type === 'appeal_quota_request' ? {
            creatorName: item.sender_name || '达人',
            taskName: item.content,
            taskId: item.related_task_id || '',
            status: (item.action_status as 'pending' | 'approved' | 'rejected') || 'pending',
          } : undefined,
        }
      })
      setMessages(mapped)
    } catch {
      setMessages([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const unreadCount = messages.filter(m => !m.read).length
  const pendingAppealRequests = messages.filter(m => m.appealRequest?.status === 'pending').length
  const pendingReviewCount = messages.filter(m =>
    !m.read && (m.type === 'task_submitted' || m.type === 'ai_review_complete')
  ).length

  const getFilteredMessages = () => {
    switch (filter) {
      case 'unread':
        return messages.filter(m => !m.read)
      case 'pending':
        return messages.filter(m =>
          m.type === 'task_submitted' || m.type === 'ai_review_complete' || m.type === 'appeal_quota_request'
        )
      default:
        return messages
    }
  }

  const filteredMessages = getFilteredMessages()

  const markAsRead = async (id: string) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, read: true } : m))
    try { await api.markMessageAsRead(id) } catch {}
  }

  const markAllAsRead = async () => {
    setMessages(prev => prev.map(m => ({ ...m, read: true })))
    try { await api.markAllMessagesAsRead() } catch {}
  }

  // 处理申诉次数请求
  const handleAppealRequest = async (messageId: string, action: 'approve' | 'reject') => {
    const message = messages.find(m => m.id === messageId)
    if (!message?.appealRequest) return

    try {
      if (action === 'approve' && message.appealRequest.taskId) {
        await api.increaseAppealCount(message.appealRequest.taskId)
      } else if (action === 'reject' && message.appealRequest.taskId) {
        await api.rejectAppealCount(message.appealRequest.taskId)
      }
      await api.markMessageAsRead(messageId)
    } catch {
      // 操作失败时不更新 UI
      return
    }

    setMessages(prev => prev.map(m => {
      if (m.id === messageId && m.appealRequest) {
        return {
          ...m,
          read: true,
          appealRequest: {
            ...m.appealRequest,
            status: action === 'approve' ? 'approved' : 'rejected',
          },
        }
      }
      return m
    }))
  }

  // 品牌方邀请操作
  const handleBrandInviteAction = (messageId: string, action: 'accept' | 'reject', brandName: string) => {
    setConfirmModal({ show: true, messageId, action, brandName })
  }

  const handleConfirmBrandAction = async () => {
    const { messageId, action } = confirmModal
    setActionLoading(true)
    try {
      if (action === 'accept') {
        await api.acceptBrandInvite(messageId)
      } else {
        await api.rejectBrandInvite(messageId)
      }
      setMessages(prev => prev.map(m =>
        m.id === messageId
          ? { ...m, hasActions: false, actionStatus: action === 'accept' ? 'accepted' : 'rejected', read: true }
          : m
      ))
    } catch {
      // 操作失败
    } finally {
      setActionLoading(false)
      setConfirmModal({ show: false, messageId: '', action: 'accept', brandName: '' })
    }
  }

  // 处理消息点击
  const handleMessageClick = (message: Message) => {
    if (message.type === 'appeal_quota_request') return // 申诉请求不跳转
    if (message.type === 'brand_invite') return // 品牌方邀请不跳转
    if (message.type === 'system_notice') return // 系统通知不跳转
    markAsRead(message.id)

    // 根据消息类型决定跳转
    switch (message.type) {
      case 'creator_accept':
      case 'creator_reject':
        // 达人签约相关 -> 达人管理
        router.push('/agency/creators')
        break
      case 'warning':
        // 风险预警 -> 达人管理
        router.push('/agency/creators')
        break
      case 'brand_config_updated':
        // 品牌规则更新 -> Brief配置
        router.push('/agency/briefs')
        break
      case 'task_deadline':
        // 任务截止提醒 -> 任务列表
        if (message.projectId) {
          router.push(`/agency/briefs/${message.projectId}`)
        } else {
          router.push('/agency/review')
        }
        break
      default:
        // 默认逻辑
        if (message.taskId) {
          router.push(`/agency/review/${message.taskId}`)
        } else if (message.projectId) {
          router.push(`/agency/briefs/${message.projectId}`)
        }
    }
  }

  // 处理操作按钮点击
  const handleAction = (message: Message, e: React.MouseEvent) => {
    e.stopPropagation()
    markAsRead(message.id)

    switch (message.actionType) {
      case 'review':
        if (message.taskId) {
          router.push(`/agency/review/${message.taskId}`)
        } else {
          router.push('/agency/review')
        }
        break
      case 'view':
        if (message.projectId) {
          router.push(`/agency/briefs/${message.projectId}`)
        } else if (message.type === 'task_deadline') {
          router.push('/agency/review')
        } else {
          router.push('/agency/creators')
        }
        break
      case 'config':
        if (message.projectId) {
          router.push(`/agency/briefs/${message.projectId}`)
        } else {
          router.push('/agency/briefs')
        }
        break
    }
  }

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-text-primary">消息中心</h1>
          {unreadCount > 0 && (
            <span className="px-2 py-1 bg-accent-coral/20 text-accent-coral text-sm font-medium rounded-lg">
              {unreadCount} 条未读
            </span>
          )}
        </div>
        <Button variant="secondary" onClick={markAllAsRead} disabled={unreadCount === 0}>
          <Check size={16} />
          全部已读
        </Button>
      </div>

      {/* 筛选 */}
      <div className="flex items-center gap-1 p-1 bg-bg-elevated rounded-lg w-fit">
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={cn(
            'px-4 py-2 rounded-md text-sm font-medium transition-colors',
            filter === 'all' ? 'bg-bg-card text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
          )}
        >
          全部消息
        </button>
        <button
          type="button"
          onClick={() => setFilter('unread')}
          className={cn(
            'px-4 py-2 rounded-md text-sm font-medium transition-colors',
            filter === 'unread' ? 'bg-bg-card text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
          )}
        >
          未读 ({unreadCount})
        </button>
        <button
          type="button"
          onClick={() => setFilter('pending')}
          className={cn(
            'px-4 py-2 rounded-md text-sm font-medium transition-colors',
            filter === 'pending' ? 'bg-bg-card text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
          )}
        >
          待处理
        </button>
      </div>

      {/* 消息列表 */}
      <div className="space-y-3">
        {filteredMessages.map((message) => {
          const Icon = message.icon
          const isAppealRequest = message.type === 'appeal_quota_request'
          const isBrandInvite = message.type === 'brand_invite'
          const appealStatus = message.appealRequest?.status
          const platform = message.platform ? getPlatformInfo(message.platform) : null

          return (
            <Card
              key={message.id}
              className={cn(
                'transition-all overflow-hidden',
                !isAppealRequest && !isBrandInvite && 'cursor-pointer hover:border-accent-indigo/50',
                !message.read && 'border-l-4 border-l-accent-indigo'
              )}
              onClick={() => handleMessageClick(message)}
            >
              {/* 平台顶部条 */}
              {platform && (
                <div className={cn('px-4 py-1.5 border-b flex items-center gap-1.5', platform.bgColor, platform.borderColor)}>
                  <span className="text-sm">{platform.icon}</span>
                  <span className={cn('text-xs font-medium', platform.textColor)}>{platform.name}</span>
                </div>
              )}
              <CardContent className="py-4">
                <div className="flex items-start gap-4">
                  <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0', message.bgColor)}>
                    <Icon size={20} className={message.iconColor} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className={cn('font-medium', !message.read ? 'text-text-primary' : 'text-text-secondary')}>
                        {message.title}
                      </h3>
                      {!message.read && (
                        <span className="w-2 h-2 bg-accent-coral rounded-full" />
                      )}
                      {/* 申诉请求状态标签 */}
                      {isAppealRequest && appealStatus === 'approved' && (
                        <span className="px-2 py-0.5 bg-accent-green/15 text-accent-green text-xs font-medium rounded-full">
                          已同意
                        </span>
                      )}
                      {isAppealRequest && appealStatus === 'rejected' && (
                        <span className="px-2 py-0.5 bg-accent-coral/15 text-accent-coral text-xs font-medium rounded-full">
                          已拒绝
                        </span>
                      )}
                      {/* 品牌邀请状态标签 */}
                      {isBrandInvite && message.actionStatus === 'accepted' && (
                        <span className="px-2 py-0.5 bg-accent-green/15 text-accent-green text-xs font-medium rounded-full">
                          已接受
                        </span>
                      )}
                      {isBrandInvite && message.actionStatus === 'rejected' && (
                        <span className="px-2 py-0.5 bg-text-tertiary/15 text-text-secondary text-xs font-medium rounded-full">
                          已忽略
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-text-secondary mt-1">{message.content}</p>
                    <div className="flex items-center justify-between mt-2">
                      <p className="text-xs text-text-tertiary flex items-center gap-1">
                        <Clock size={12} />
                        {message.time}
                      </p>

                      {/* 操作按钮 */}
                      {message.hasAction && !isAppealRequest && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={(e) => handleAction(message, e)}
                        >
                          <Eye size={14} />
                          {message.actionType === 'review' ? '去审核' : message.actionType === 'config' ? '去配置' : '查看'}
                        </Button>
                      )}
                    </div>

                    {/* 申诉次数请求操作按钮 */}
                    {isAppealRequest && appealStatus === 'pending' && (
                      <div className="flex items-center gap-2 mt-3">
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleAppealRequest(message.id, 'approve')
                          }}
                        >
                          <CheckCircle size={14} />
                          同意 (+1次)
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleAppealRequest(message.id, 'reject')
                          }}
                        >
                          <XCircle size={14} />
                          拒绝
                        </Button>
                      </div>
                    )}

                    {/* 品牌方邀请操作按钮 */}
                    {isBrandInvite && message.hasActions && (
                      <div className="flex items-center gap-2 mt-3">
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleBrandInviteAction(message.id, 'accept', message.creatorName || message.content)
                          }}
                        >
                          <CheckCircle size={14} />
                          接受邀请
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleBrandInviteAction(message.id, 'reject', message.creatorName || message.content)
                          }}
                        >
                          <XCircle size={14} />
                          暂时忽略
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {filteredMessages.length === 0 && (
        <div className="text-center py-16">
          <Bell size={48} className="mx-auto text-text-tertiary opacity-50 mb-4" />
          <p className="text-text-secondary">
            {filter === 'unread' ? '没有未读消息' : '暂无消息'}
          </p>
        </div>
      )}

      {/* 品牌方邀请确认弹窗 */}
      {confirmModal.show && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setConfirmModal({ show: false, messageId: '', action: 'accept', brandName: '' })}>
          <div className="bg-bg-card rounded-xl p-6 max-w-md w-full mx-4 border border-border-subtle" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-text-primary mb-2">
              {confirmModal.action === 'accept' ? '确认接受邀请' : '确认忽略邀请'}
            </h3>
            <p className="text-sm text-text-secondary mb-6">
              {confirmModal.action === 'accept'
                ? '接受后将成为该品牌方的合作代理商，可参与其推广项目'
                : '忽略后该邀请将被关闭，品牌方可再次发送邀请'}
            </p>
            <div className="flex justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => setConfirmModal({ show: false, messageId: '', action: 'accept', brandName: '' })}
                disabled={actionLoading}
              >
                取消
              </Button>
              <Button
                variant={confirmModal.action === 'accept' ? 'primary' : 'secondary'}
                onClick={handleConfirmBrandAction}
                disabled={actionLoading}
              >
                {actionLoading ? '处理中...' : confirmModal.action === 'accept' ? '确认接受' : '确认忽略'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
