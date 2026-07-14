'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  Clock,
  Video,
  Filter,
  ChevronRight,
  Loader2
} from 'lucide-react'
import { ResponsiveLayout } from '@/components/layout/ResponsiveLayout'
import { cn } from '@/lib/utils'
import { api, extractErrorMessage } from '@/lib/api'
import { formatTaskDisplayName } from '@/lib/taskDisplay'
import { useToast } from '@/components/ui/Toast'
import type { TaskResponse } from '@/types/task'

// 历史任务状态类型
type HistoryStatus = 'completed' | 'expired' | 'cancelled'

// 历史任务数据类型
type HistoryTask = {
  id: string
  title: string
  description: string
  status: HistoryStatus
  completedAt?: string
  expiredAt?: string
  platform: string
}

function mapTaskResponseToHistory(task: TaskResponse): HistoryTask {
  return {
    id: task.id,
    title: formatTaskDisplayName({
      taskName: task.name,
      projectName: task.project?.name,
      sequence: task.sequence,
    }),
    description: task.project.name,
    status: task.stage === 'completed' ? 'completed' : 'completed',
    completedAt: task.updated_at?.split('T')[0],
    platform: task.project.platform || '',
  }
}

// 状态配置
const statusConfig: Record<HistoryStatus, { label: string; color: string; bgColor: string; icon: React.ElementType }> = {
  completed: { label: '已完成', color: 'text-accent-green', bgColor: 'bg-accent-green/15', icon: CheckCircle },
  expired: { label: '已过期', color: 'text-text-tertiary', bgColor: 'bg-bg-elevated', icon: Clock },
  cancelled: { label: '已取消', color: 'text-accent-coral', bgColor: 'bg-accent-coral/15', icon: XCircle },
}

// 骨架屏
function HistorySkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="bg-bg-card rounded-2xl p-5 card-shadow animate-pulse">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-16 h-12 rounded-lg bg-bg-elevated" />
              <div className="flex flex-col gap-2">
                <div className="h-4 w-40 bg-bg-elevated rounded" />
                <div className="h-3 w-28 bg-bg-elevated rounded" />
                <div className="h-3 w-20 bg-bg-elevated rounded" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-8 w-20 bg-bg-elevated rounded-lg" />
              <div className="w-5 h-5 bg-bg-elevated rounded" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// 历史任务卡片
function HistoryCard({ task, onClick }: { task: HistoryTask; onClick: () => void }) {
  const status = statusConfig[task.status]
  const StatusIcon = status.icon

  return (
    <div
      className="bg-bg-card rounded-2xl p-5 card-shadow cursor-pointer hover:bg-bg-elevated/30 transition-colors"
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-16 h-12 rounded-lg bg-bg-elevated flex items-center justify-center flex-shrink-0">
            <Video className="w-5 h-5 text-text-tertiary" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-base font-semibold text-text-primary">{task.title}</span>
            <span className="text-sm text-text-secondary">{task.description}</span>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-xs text-text-tertiary">{task.platform}</span>
              <span className="text-xs text-text-tertiary">
                {task.completedAt || task.expiredAt}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className={cn('px-3 py-1.5 rounded-lg flex items-center gap-1.5', status.bgColor)}>
            <StatusIcon className={cn('w-4 h-4', status.color)} />
            <span className={cn('text-sm font-medium', status.color)}>{status.label}</span>
          </div>
          <ChevronRight className="w-5 h-5 text-text-tertiary" />
        </div>
      </div>
    </div>
  )
}

export default function CreatorHistoryPage() {
  const router = useRouter()
  const toast = useToast()
  const [filter, setFilter] = useState<HistoryStatus | 'all'>('all')
  const [loading, setLoading] = useState(true)
  const [historyTasks, setHistoryTasks] = useState<HistoryTask[]>([])

  const loadHistory = useCallback(async () => {
    try {
      setLoading(true)
      const response = await api.listTasks(1, 50, 'completed')
      const mapped = response.items.map(mapTaskResponseToHistory)
      setHistoryTasks(mapped)
    } catch (err) {
      const message = extractErrorMessage(err)
      toast.error(message)
      console.error('加载历史记录失败:', err)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  const filteredHistory = filter === 'all' ? historyTasks : historyTasks.filter(t => t.status === filter)

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
            <h1 className="text-xl lg:text-[28px] font-bold text-text-primary">历史记录</h1>
            <p className="text-sm lg:text-[15px] text-text-secondary">查看已完成和过期的任务</p>
          </div>
          <div className="flex items-center gap-2 px-4 py-2.5 bg-bg-card rounded-xl border border-border-subtle">
            <Filter className="w-[18px] h-[18px] text-text-secondary" />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as HistoryStatus | 'all')}
              className="bg-transparent text-sm text-text-primary focus:outline-none"
            >
              <option value="all">全部状态</option>
              <option value="completed">已完成</option>
              <option value="expired">已过期</option>
              <option value="cancelled">已取消</option>
            </select>
          </div>
        </div>

        {/* 统计信息 */}
        <div className="flex items-center gap-6 bg-bg-card rounded-2xl p-5 card-shadow">
          <div className="flex flex-col items-center gap-1 flex-1">
            <span className="text-2xl font-bold text-accent-green">
              {historyTasks.filter(t => t.status === 'completed').length}
            </span>
            <span className="text-xs text-text-tertiary">已完成</span>
          </div>
          <div className="w-px h-10 bg-border-subtle" />
          <div className="flex flex-col items-center gap-1 flex-1">
            <span className="text-2xl font-bold text-text-tertiary">
              {historyTasks.filter(t => t.status === 'expired').length}
            </span>
            <span className="text-xs text-text-tertiary">已过期</span>
          </div>
          <div className="w-px h-10 bg-border-subtle" />
          <div className="flex flex-col items-center gap-1 flex-1">
            <span className="text-2xl font-bold text-accent-coral">
              {historyTasks.filter(t => t.status === 'cancelled').length}
            </span>
            <span className="text-xs text-text-tertiary">已取消</span>
          </div>
        </div>

        {/* 任务列表 */}
        <div className="flex flex-col gap-4 flex-1 overflow-y-auto pr-2">
          {loading ? (
            <HistorySkeleton />
          ) : filteredHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Clock className="w-12 h-12 text-text-tertiary mb-4" />
              <p className="text-text-secondary">暂无历史记录</p>
              <p className="text-sm text-text-tertiary mt-1">完成的任务将显示在这里</p>
            </div>
          ) : (
            filteredHistory.map((task) => (
              <HistoryCard
                key={task.id}
                task={task}
                onClick={() => router.push(`/creator/task/${task.id}`)}
              />
            ))
          )}
        </div>
      </div>
    </ResponsiveLayout>
  )
}
