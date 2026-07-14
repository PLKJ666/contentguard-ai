'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
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
  Building2,
  FolderPlus,
  Settings,
  MessageCircle,
  CalendarClock,
  Megaphone,
  FileCheck,
  UserCheck,
  Eye
} from 'lucide-react'
import { getPlatformInfo } from '@/lib/platforms'
import { cn } from '@/lib/utils'
import { formatLegacyTaskNameInMessageContent } from '@/lib/taskDisplay'

// 消息类型
type MessageType =
  | 'agency_review_pass'   // 代理商审核通过，待品牌终审
  | 'script_pending'       // 新脚本待终审
  | 'video_pending'        // 新视频待终审
  | 'project_created'      // 项目创建成功
  | 'agency_accept'        // 代理商接受项目邀请
  | 'creators_assigned'    // 代理商配置达人到项目
  | 'content_published'    // 内容已发布
  | 'rule_updated'         // 规则更新生效
  | 'review_timeout'       // 审核超时提醒
  | 'creator_appeal'       // 达人发起申诉
  | 'brief_config_updated' // 代理商更新了Brief配置
  | 'batch_review_done'    // 批量审核完成
  | 'system_notice'        // 系统通知
  | 'new_task'             // 新任务分配
  | 'pass'                 // 审核通过
  | 'reject'               // 审核驳回
  | 'approve'              // 审核批准

type Message = {
  id: string
  type: MessageType
  title: string
  content: string
  time: string
  read: boolean
  platform?: string
  projectId?: string
  taskId?: string
  agencyName?: string
  hasAction?: boolean
  actionType?: 'review' | 'view'
}

// 消息配置
const messageConfig: Record<MessageType, {
  icon: React.ElementType
  iconColor: string
  bgColor: string
}> = {
  agency_review_pass: { icon: FileCheck, iconColor: 'text-accent-indigo', bgColor: 'bg-accent-indigo/20' },
  script_pending: { icon: FileText, iconColor: 'text-accent-indigo', bgColor: 'bg-accent-indigo/20' },
  video_pending: { icon: Video, iconColor: 'text-purple-400', bgColor: 'bg-purple-500/20' },
  project_created: { icon: FolderPlus, iconColor: 'text-accent-green', bgColor: 'bg-accent-green/20' },
  agency_accept: { icon: UserCheck, iconColor: 'text-accent-green', bgColor: 'bg-accent-green/20' },
  creators_assigned: { icon: Users, iconColor: 'text-accent-indigo', bgColor: 'bg-accent-indigo/20' },
  content_published: { icon: Megaphone, iconColor: 'text-accent-green', bgColor: 'bg-accent-green/20' },
  rule_updated: { icon: Settings, iconColor: 'text-accent-amber', bgColor: 'bg-accent-amber/20' },
  review_timeout: { icon: CalendarClock, iconColor: 'text-orange-400', bgColor: 'bg-orange-500/20' },
  creator_appeal: { icon: MessageCircle, iconColor: 'text-accent-amber', bgColor: 'bg-accent-amber/20' },
  brief_config_updated: { icon: FileText, iconColor: 'text-accent-indigo', bgColor: 'bg-accent-indigo/20' },
  batch_review_done: { icon: CheckCircle, iconColor: 'text-accent-green', bgColor: 'bg-accent-green/20' },
  system_notice: { icon: Bell, iconColor: 'text-text-secondary', bgColor: 'bg-bg-elevated' },
  new_task: { icon: FileText, iconColor: 'text-accent-indigo', bgColor: 'bg-accent-indigo/20' },
  pass: { icon: CheckCircle, iconColor: 'text-accent-green', bgColor: 'bg-accent-green/20' },
  reject: { icon: XCircle, iconColor: 'text-accent-coral', bgColor: 'bg-accent-coral/20' },
  approve: { icon: CheckCircle, iconColor: 'text-accent-green', bgColor: 'bg-accent-green/20' },
}

export default function BrandMessagesPage() {
  const router = useRouter()
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'unread' | 'pending'>('all')

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
        projectId: item.related_project_id || undefined,
      }))
      setMessages(mapped)
    } catch {
      setMessages([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const unreadCount = messages.filter(m => !m.read).length
  const pendingReviewCount = messages.filter(m =>
    !m.read && (m.type === 'agency_review_pass' || m.type === 'script_pending' || m.type === 'video_pending')
  ).length

  const getFilteredMessages = () => {
    switch (filter) {
      case 'unread':
        return messages.filter(m => !m.read)
      case 'pending':
        return messages.filter(m =>
          m.type === 'agency_review_pass' || m.type === 'script_pending' || m.type === 'video_pending' || m.type === 'review_timeout'
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

  const handleMessageClick = (message: Message) => {
    if (message.type === 'system_notice') return // 系统通知不跳转
    markAsRead(message.id)

    // 根据消息类型跳转
    switch (message.type) {
      case 'script_pending':
        if (message.taskId) router.push(`/brand/review/script/${message.taskId}`)
        else router.push('/brand/review')
        break
      case 'video_pending':
        if (message.taskId) router.push(`/brand/review/video/${message.taskId}`)
        else router.push('/brand/review')
        break
      case 'creator_appeal':
        // 达人申诉 -> 终审台
        router.push('/brand/review')
        break
      case 'rule_updated':
        // 规则更新 -> 规则配置
        router.push('/brand/rules')
        break
      case 'batch_review_done':
        // 批量审核完成 -> 终审台
        router.push('/brand/review')
        break
      case 'agency_review_pass':
      case 'review_timeout':
        // 待终审内容 -> 终审台
        router.push('/brand/review')
        break
      default:
        if (message.projectId) {
          router.push(`/brand/projects/${message.projectId}`)
        }
    }
  }

  const handleAction = (message: Message, e: React.MouseEvent) => {
    e.stopPropagation()
    markAsRead(message.id)

    if (message.actionType === 'review') {
      if (message.taskId) {
        if (message.type === 'script_pending') {
          router.push(`/brand/review/script/${message.taskId}`)
        } else {
          router.push(`/brand/review/video/${message.taskId}`)
        }
      } else {
        router.push('/brand/review')
      }
    } else if (message.actionType === 'view') {
      if (message.projectId) {
        router.push(`/brand/projects/${message.projectId}`)
      } else if (message.type === 'rule_updated') {
        router.push('/brand/rules')
      }
    }
  }

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-text-primary">消息中心</h1>
          {unreadCount > 0 && (
            <span className="px-2.5 py-1 bg-accent-coral/20 text-accent-coral text-sm font-medium rounded-lg">
              {unreadCount} 条未读
            </span>
          )}
          {pendingReviewCount > 0 && (
            <span className="px-2.5 py-1 bg-accent-indigo/20 text-accent-indigo text-sm font-medium rounded-lg">
              {pendingReviewCount} 条待审
            </span>
          )}
        </div>
        <Button variant="secondary" onClick={markAllAsRead} disabled={unreadCount === 0}>
          <Check size={16} />
          全部已读
        </Button>
      </div>

      {/* 筛选标签 */}
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
          const config = messageConfig[message.type] || messageConfig.system_notice
          const Icon = config.icon
          const platform = message.platform ? getPlatformInfo(message.platform) : null

          return (
            <Card
              key={message.id}
              className={cn(
                'transition-all overflow-hidden cursor-pointer hover:border-accent-indigo/50',
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
                  {/* 图标 */}
                  <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0', config.bgColor)}>
                    <Icon size={20} className={config.iconColor} />
                  </div>

                  {/* 内容 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className={cn('font-medium', !message.read ? 'text-text-primary' : 'text-text-secondary')}>
                        {message.title}
                      </h3>
                      {!message.read && (
                        <span className="w-2 h-2 bg-accent-coral rounded-full" />
                      )}
                    </div>
                    <p className="text-sm text-text-secondary mt-1">{message.content}</p>
                    <div className="flex items-center justify-between mt-2">
                      <p className="text-xs text-text-tertiary flex items-center gap-1">
                        <Clock size={12} />
                        {message.time}
                      </p>

                      {/* 操作按钮 */}
                      {message.hasAction && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={(e) => handleAction(message, e)}
                        >
                          {message.actionType === 'review' ? (
                            <>
                              <Eye size={14} />
                              去审核
                            </>
                          ) : (
                            <>
                              <Eye size={14} />
                              查看
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* 空状态 */}
      {filteredMessages.length === 0 && (
        <div className="text-center py-16">
          <Bell size={48} className="mx-auto text-text-tertiary opacity-50 mb-4" />
          <p className="text-text-secondary">
            {filter === 'unread' ? '没有未读消息' : filter === 'pending' ? '没有待处理消息' : '暂无消息'}
          </p>
        </div>
      )}
    </div>
  )
}
