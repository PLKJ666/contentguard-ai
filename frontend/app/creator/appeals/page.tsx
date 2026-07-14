'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  MessageCircle,
  Clock,
  CheckCircle,
  XCircle,
  ChevronRight,
  AlertTriangle,
  Filter,
  Search,
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

// 申诉数据类型
type Appeal = {
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
}

// 将 TaskResponse 映射为 Appeal UI 类型
function mapTaskToAppeal(task: TaskResponse): Appeal {
  // 判断申诉类型：根据当前阶段判断被驳回的审核类型
  let type: 'ai' | 'agency' | 'brand' = 'ai'
  if (task.script_brand_status === 'rejected' || task.video_brand_status === 'rejected') {
    type = 'brand'
  } else if (task.script_agency_status === 'rejected' || task.video_agency_status === 'rejected') {
    type = 'agency'
  }

  // 判断申诉状态：根据任务阶段和当前状态推断
  let status: AppealStatus = 'pending'
  if (task.stage === 'completed') {
    status = 'approved'
  } else if (task.stage === 'rejected') {
    status = 'rejected'
  } else if (task.is_appeal) {
    status = 'processing'
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
    createdAt: task.updated_at ? new Date(task.updated_at).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    }) : '',
    updatedAt: task.updated_at ? new Date(task.updated_at).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    }) : undefined,
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
function AppealSkeleton() {
  return (
    <div className="bg-bg-card rounded-2xl p-5 card-shadow animate-pulse">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-bg-elevated" />
          <div className="flex flex-col gap-1.5">
            <div className="h-4 w-28 bg-bg-elevated rounded" />
            <div className="h-3 w-36 bg-bg-elevated rounded" />
          </div>
        </div>
        <div className="h-6 w-16 bg-bg-elevated rounded-full" />
      </div>
      <div className="flex flex-col gap-3">
        <div className="h-3 w-40 bg-bg-elevated rounded" />
        <div className="h-3 w-32 bg-bg-elevated rounded" />
        <div className="h-4 w-full bg-bg-elevated rounded" />
      </div>
      <div className="flex items-center justify-between mt-4 pt-4 border-t border-border-subtle">
        <div className="h-3 w-32 bg-bg-elevated rounded" />
      </div>
    </div>
  )
}

// 申诉卡片组件
function AppealCard({ appeal, onClick }: { appeal: Appeal; onClick: () => void }) {
  const status = statusConfig[appeal.status]
  const type = typeConfig[appeal.type]
  const StatusIcon = status.icon

  return (
    <div
      className="bg-bg-card rounded-2xl p-5 card-shadow cursor-pointer hover:bg-bg-elevated/30 transition-colors"
      onClick={onClick}
    >
      {/* 头部 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', status.bgColor)}>
            <StatusIcon className={cn('w-5 h-5', status.color)} />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-base font-semibold text-text-primary">{appeal.taskTitle}</span>
            <span className="text-xs text-text-tertiary">申诉编号: {appeal.id}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn('px-2.5 py-1 rounded-full text-xs font-medium', status.bgColor, status.color)}>
            {status.label}
          </span>
          <ChevronRight className="w-5 h-5 text-text-tertiary" />
        </div>
      </div>

      {/* 内容 */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-4 text-sm">
          <span className="text-text-tertiary">申诉对象:</span>
          <span className={cn('font-medium', type.color)}>{type.label}</span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-text-tertiary">申诉原因:</span>
          <span className="text-text-primary">{appeal.reason}</span>
        </div>
        <p className="text-sm text-text-secondary line-clamp-2">{appeal.content}</p>
      </div>

      {/* 底部时间 */}
      <div className="flex items-center justify-between mt-4 pt-4 border-t border-border-subtle">
        <span className="text-xs text-text-tertiary">提交时间: {appeal.createdAt}</span>
        {appeal.updatedAt && (
          <span className="text-xs text-text-tertiary">更新时间: {appeal.updatedAt}</span>
        )}
      </div>
    </div>
  )
}

// 申诉次数入口卡片
function AppealQuotaEntryCard({ onClick }: { onClick: () => void }) {
  return (
    <div
      className="bg-bg-card rounded-2xl p-5 card-shadow cursor-pointer hover:bg-bg-elevated/30 transition-colors"
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent-indigo/15 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-accent-indigo" />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-base font-semibold text-text-primary">申诉次数管理</span>
            <span className="text-sm text-text-secondary">查看各任务的申诉次数，向代理商申请增加</span>
          </div>
        </div>
        <ChevronRight className="w-5 h-5 text-text-tertiary" />
      </div>
    </div>
  )
}

export default function CreatorAppealsPage() {
  const router = useRouter()
  const toast = useToast()
  const [filter, setFilter] = useState<AppealStatus | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [appeals, setAppeals] = useState<Appeal[]>([])
  const [loading, setLoading] = useState(true)

  const loadAppeals = useCallback(async () => {
    try {
      setLoading(true)
      const response = await api.listTasks(1, 50)
      // Filter for tasks that have appeals (is_appeal === true or have appeal_reason)
      const appealTasks = response.items.filter(
        (task) => task.is_appeal || task.appeal_reason || task.appeal_count > 0
      )
      const mapped = appealTasks.map(mapTaskToAppeal)
      setAppeals(mapped)
    } catch (err) {
      console.error('加载申诉列表失败:', err)
      toast.error('加载申诉列表失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    loadAppeals()
  }, [loadAppeals])

  // 搜索和筛选
  const filteredAppeals = appeals.filter(appeal => {
    const matchesSearch = searchQuery === '' ||
      appeal.taskTitle.toLowerCase().includes(searchQuery.toLowerCase()) ||
      appeal.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      appeal.reason.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesFilter = filter === 'all' || appeal.status === filter
    return matchesSearch && matchesFilter
  })

  const handleAppealClick = (appealId: string) => {
    router.push(`/creator/appeals/${appealId}`)
  }

  // 跳转到申诉次数管理页面
  const handleGoToQuotaPage = () => {
    router.push('/creator/appeal-quota')
  }

  return (
    <ResponsiveLayout role="creator">
      <div className="flex flex-col gap-6 h-full">
        {/* 顶部栏 */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl lg:text-[28px] font-bold text-text-primary">申诉中心</h1>
            <p className="text-sm lg:text-[15px] text-text-secondary">管理您的申诉记录和申诉额度</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-4 py-2.5 bg-bg-card rounded-xl border border-border-subtle">
              <Search className="w-[18px] h-[18px] text-text-secondary" />
              <input
                type="text"
                placeholder="搜索申诉..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-transparent text-sm text-text-primary placeholder-text-tertiary focus:outline-none w-32"
              />
            </div>
            <div className="flex items-center gap-2 px-4 py-2.5 bg-bg-card rounded-xl border border-border-subtle">
              <Filter className="w-[18px] h-[18px] text-text-secondary" />
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as AppealStatus | 'all')}
                className="bg-transparent text-sm text-text-primary focus:outline-none"
              >
                <option value="all">全部状态</option>
                <option value="pending">待处理</option>
                <option value="processing">处理中</option>
                <option value="approved">已通过</option>
                <option value="rejected">已驳回</option>
              </select>
            </div>
          </div>
        </div>

        {/* 申诉次数管理入口 */}
        <AppealQuotaEntryCard onClick={handleGoToQuotaPage} />

        {/* 申诉列表 */}
        <div className="flex flex-col gap-4 flex-1 overflow-y-auto pr-2">
          <h2 className="text-lg font-semibold text-text-primary">
            申诉记录 {!loading && `(${filteredAppeals.length})`}
          </h2>
          {loading ? (
            <>
              <AppealSkeleton />
              <AppealSkeleton />
              <AppealSkeleton />
            </>
          ) : filteredAppeals.length > 0 ? (
            filteredAppeals.map((appeal) => (
              <AppealCard
                key={appeal.id}
                appeal={appeal}
                onClick={() => handleAppealClick(appeal.id)}
              />
            ))
          ) : (
            <div className="flex flex-col items-center justify-center py-16">
              <MessageCircle className="w-12 h-12 text-text-tertiary/50 mb-4" />
              <p className="text-text-secondary text-center">
                {searchQuery || filter !== 'all'
                  ? '没有找到匹配的申诉记录'
                  : '暂无申诉记录'}
              </p>
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
        </div>
      </div>
    </ResponsiveLayout>
  )
}
