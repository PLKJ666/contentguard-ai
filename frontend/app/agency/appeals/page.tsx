'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import {
  MessageSquare,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Search,
  Filter,
  ChevronRight,
  User,
  FileText,
  Video,
  Loader2
} from 'lucide-react'
import { getPlatformInfo } from '@/lib/platforms'
import { api } from '@/lib/api'
import { formatTaskDisplayTitle } from '@/lib/taskDisplay'
import type { TaskResponse } from '@/types/task'

// 申诉状态类型
type AppealStatus = 'pending' | 'processing' | 'approved' | 'rejected'

// 申诉类型
type AppealType = 'ai' | 'agency'

// 申诉数据类型
interface Appeal {
  id: string
  taskId: string
  taskTitle: string
  creatorId?: string
  creatorName: string
  platform: string
  type: AppealType
  contentType: 'script' | 'video'
  reason: string
  content: string
  status: AppealStatus
  createdAt: string
  updatedAt?: string
}

// 状态配置
const statusConfig: Record<AppealStatus, { label: string; color: string; bgColor: string; icon: React.ElementType }> = {
  pending: { label: '待处理', color: 'text-accent-amber', bgColor: 'bg-accent-amber/15', icon: Clock },
  processing: { label: '处理中', color: 'text-accent-indigo', bgColor: 'bg-accent-indigo/15', icon: MessageSquare },
  approved: { label: '已通过', color: 'text-accent-green', bgColor: 'bg-accent-green/15', icon: CheckCircle },
  rejected: { label: '已驳回', color: 'text-accent-coral', bgColor: 'bg-accent-coral/15', icon: XCircle },
}

// 类型配置
const typeConfig: Record<AppealType, { label: string; color: string }> = {
  ai: { label: 'AI审核申诉', color: 'text-accent-indigo' },
  agency: { label: '代理商审核申诉', color: 'text-purple-400' },
}

/**
 * Map a TaskResponse (with is_appeal === true) to the Appeal UI model.
 */
function mapTaskToAppeal(task: TaskResponse): Appeal {
  // Determine which stage the task was appealing from
  const isVideoStage = task.stage.startsWith('video')
  const contentType: 'script' | 'video' = isVideoStage ? 'video' : 'script'

  // Determine appeal type based on stage
  const type: AppealType = task.stage.includes('ai') ? 'ai' : 'agency'

  // Derive appeal status from the task stage
  let status: AppealStatus = 'pending'
  if (task.stage === 'completed') {
    status = 'approved'
  } else if (task.stage === 'rejected') {
    status = 'rejected'
  } else if (task.stage.includes('review')) {
    status = 'processing'
  }
  const creatorId = task.creator.id ?? undefined

  return {
    id: task.id,
    taskId: task.id,
    taskTitle: formatTaskDisplayTitle({
      taskName: task.name,
      projectName: task.project?.name,
      sequence: task.sequence,
    }),
    ...(creatorId ? { creatorId } : {}),
    creatorName: task.creator.name,
    platform: task.project?.platform || 'douyin',
    type,
    contentType,
    reason: task.appeal_reason || '申诉',
    content: task.appeal_reason || '',
    status,
    createdAt: task.updated_at ? new Date(task.updated_at).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(/\//g, '-') : '',
    updatedAt: task.stage === 'completed' || task.stage === 'rejected'
      ? new Date(task.updated_at).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(/\//g, '-')
      : undefined,
  }
}

function AppealCard({ appeal }: { appeal: Appeal }) {
  const status = statusConfig[appeal.status]
  const type = typeConfig[appeal.type]
  const StatusIcon = status.icon
  const platform = getPlatformInfo(appeal.platform)

  return (
    <Link href={`/agency/appeals/${appeal.id}`}>
      <div className="rounded-xl bg-bg-elevated hover:bg-bg-elevated/80 transition-colors cursor-pointer overflow-hidden">
        {/* 平台顶部条 */}
        {platform && (
          <div className={`px-4 py-1.5 ${platform.bgColor} border-b ${platform.borderColor} flex items-center gap-1.5`}>
            <span className="text-sm">{platform.icon}</span>
            <span className={`text-xs font-medium ${platform.textColor}`}>{platform.name}</span>
          </div>
        )}
        <div className="p-4">
          {/* 顶部：状态和类型 */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-lg ${status.bgColor} flex items-center justify-center`}>
                <StatusIcon size={16} className={status.color} />
              </div>
              <div>
                <span className="font-medium text-text-primary">{appeal.taskTitle}</span>
                <div className="flex items-center gap-2 text-xs text-text-tertiary">
                  <span className="flex items-center gap-1">
                    <User size={10} />
                    {appeal.creatorName}
                  </span>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    {appeal.contentType === 'script' ? <FileText size={10} /> : <Video size={10} />}
                    {appeal.contentType === 'script' ? '脚本' : '视频'}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${status.bgColor} ${status.color}`}>
                {status.label}
              </span>
              <ChevronRight size={16} className="text-text-tertiary" />
            </div>
          </div>

        {/* 申诉信息 */}
        <div className="space-y-2 mb-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-text-tertiary">申诉类型:</span>
            <span className={type.color}>{type.label}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-text-tertiary">申诉原因:</span>
            <span className="text-text-primary">{appeal.reason}</span>
          </div>
          <p className="text-sm text-text-secondary line-clamp-2">{appeal.content}</p>
        </div>

        {/* 底部时间 */}
        <div className="flex items-center justify-between text-xs text-text-tertiary pt-3 border-t border-border-subtle">
          <span>提交时间: {appeal.createdAt}</span>
          {appeal.updatedAt && <span>处理时间: {appeal.updatedAt}</span>}
        </div>
        </div>
      </div>
    </Link>
  )
}

export default function AgencyAppealsPage() {
  const [filter, setFilter] = useState<AppealStatus | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [appeals, setAppeals] = useState<Appeal[]>([])
  const [loading, setLoading] = useState(true)

  const fetchAppeals = useCallback(async () => {
    try {
      setLoading(true)
      // Fetch tasks and filter for those with is_appeal === true
      const response = await api.listTasks(1, 50)
      const appealTasks = response.items.filter((t) => t.is_appeal === true)
      setAppeals(appealTasks.map(mapTaskToAppeal))
    } catch (err) {
      console.error('Failed to fetch appeals:', err)
      setAppeals([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAppeals()
  }, [fetchAppeals])

  // 统计
  const pendingCount = appeals.filter(a => a.status === 'pending').length
  const processingCount = appeals.filter(a => a.status === 'processing').length

  // 筛选
  const filteredAppeals = appeals.filter(appeal => {
    const matchesSearch = searchQuery === '' ||
      appeal.taskTitle.toLowerCase().includes(searchQuery.toLowerCase()) ||
      appeal.creatorName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      appeal.reason.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesFilter = filter === 'all' || appeal.status === filter
    return matchesSearch && matchesFilter
  })

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">申诉处理</h1>
          <p className="text-sm text-text-secondary mt-1">处理达人提交的申诉请求</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="px-3 py-1.5 bg-accent-amber/20 text-accent-amber rounded-lg font-medium">
            {pendingCount} 待处理
          </span>
          <span className="px-3 py-1.5 bg-accent-indigo/20 text-accent-indigo rounded-lg font-medium">
            {processingCount} 处理中
          </span>
        </div>
      </div>

      {/* 搜索和筛选 */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            type="text"
            placeholder="搜索任务名称或达人..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-border-subtle rounded-xl bg-bg-elevated text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-indigo"
          />
        </div>
        <div className="flex items-center gap-1 p-1 bg-bg-elevated rounded-lg">
          {[
            { value: 'all', label: '全部' },
            { value: 'pending', label: '待处理' },
            { value: 'processing', label: '处理中' },
            { value: 'approved', label: '已通过' },
            { value: 'rejected', label: '已驳回' },
          ].map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setFilter(tab.value as AppealStatus | 'all')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                filter === tab.value ? 'bg-bg-card text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 申诉列表 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare size={18} className="text-accent-indigo" />
            申诉列表
            <span className="ml-auto text-sm font-normal text-text-secondary">
              共 {filteredAppeals.length} 条
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-text-tertiary">
              <Loader2 size={32} className="animate-spin mb-4" />
              <p>加载中...</p>
            </div>
          ) : filteredAppeals.length > 0 ? (
            filteredAppeals.map((appeal) => (
              <AppealCard key={appeal.id} appeal={appeal} />
            ))
          ) : (
            <div className="text-center py-12 text-text-tertiary">
              <MessageSquare size={48} className="mx-auto mb-4 opacity-50" />
              <p>{searchQuery || filter !== 'all' ? '没有找到匹配的申诉' : '暂无申诉记录'}</p>
              {(searchQuery || filter !== 'all') && (
                <button
                  type="button"
                  onClick={() => { setSearchQuery(''); setFilter('all'); }}
                  className="mt-3 text-sm text-accent-indigo hover:underline"
                >
                  清除筛选条件
                </button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
