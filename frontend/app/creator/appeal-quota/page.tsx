'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  AlertCircle,
  CheckCircle,
  Clock,
  XCircle,
  Send,
  Info,
  Loader2
} from 'lucide-react'
import { ResponsiveLayout } from '@/components/layout/ResponsiveLayout'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { formatTaskDisplayTitle } from '@/lib/taskDisplay'
import { useToast } from '@/components/ui/Toast'
import type { TaskResponse } from '@/types/task'

// 申请状态类型
type RequestStatus = 'none' | 'pending' | 'approved' | 'rejected'

// 任务申诉次数数据
interface TaskAppealQuota {
  id: string
  taskName: string
  agencyName: string
  remaining: number
  used: number
  requestStatus: RequestStatus
  requestTime?: string
}

// 将 TaskResponse 映射为 TaskAppealQuota
function mapTaskToQuota(task: TaskResponse): TaskAppealQuota {
  // appeal_count 是后端记录的"剩余申诉次数"（初始值1，每次申诉-1，增加时+N）
  const remaining = task.appeal_count

  return {
    id: task.id,
    taskName: formatTaskDisplayTitle({
      taskName: task.name,
      projectName: task.project?.name,
      sequence: task.sequence,
    }),
    agencyName: task.agency?.name || '未知代理商',
    remaining,
    used: Math.max(0, 1 - task.appeal_count), // 初始1次，已使用 = 1 - 剩余（最小0）
    requestStatus: (task.appeal_request_status as RequestStatus) || 'none',
  }
}

// 状态标签组件
function StatusBadge({ status }: { status: RequestStatus }) {
  const config = {
    none: { label: '', icon: null, className: '' },
    pending: {
      label: '申请中',
      icon: Clock,
      className: 'bg-accent-amber/15 text-accent-amber',
    },
    approved: {
      label: '已同意',
      icon: CheckCircle,
      className: 'bg-accent-green/15 text-accent-green',
    },
    rejected: {
      label: '已拒绝',
      icon: XCircle,
      className: 'bg-accent-coral/15 text-accent-coral',
    },
  }

  const { label, icon: Icon, className } = config[status]

  if (status === 'none') return null

  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', className)}>
      {Icon && <Icon size={12} />}
      {label}
    </span>
  )
}

// 骨架屏组件
function QuotaSkeleton() {
  return (
    <div className="bg-bg-card rounded-xl p-5 card-shadow flex flex-col gap-4 animate-pulse">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <div className="h-4 w-32 bg-bg-elevated rounded" />
          <div className="h-3 w-20 bg-bg-elevated rounded" />
        </div>
        <div className="h-5 w-14 bg-bg-elevated rounded-full" />
      </div>
      <div className="flex items-center gap-6">
        <div className="flex flex-col gap-1">
          <div className="h-7 w-8 bg-bg-elevated rounded" />
          <div className="h-3 w-14 bg-bg-elevated rounded" />
        </div>
        <div className="flex flex-col gap-1">
          <div className="h-7 w-8 bg-bg-elevated rounded" />
          <div className="h-3 w-14 bg-bg-elevated rounded" />
        </div>
      </div>
      <div className="pt-3 border-t border-border-subtle">
        <div className="h-8 w-24 bg-bg-elevated rounded" />
      </div>
    </div>
  )
}

// 任务卡片组件
function TaskQuotaCard({
  task,
  onRequestIncrease,
  requesting,
}: {
  task: TaskAppealQuota
  onRequestIncrease: (taskId: string) => void
  requesting: boolean
}) {
  const canRequest = task.requestStatus === 'none' || task.requestStatus === 'rejected'

  return (
    <div className="bg-bg-card rounded-xl p-5 card-shadow flex flex-col gap-4">
      {/* 任务信息 */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          <h3 className="text-[15px] font-medium text-text-primary truncate">{task.taskName}</h3>
          <p className="text-[13px] text-text-tertiary">{task.agencyName}</p>
        </div>
        <StatusBadge status={task.requestStatus} />
      </div>

      {/* 申诉次数 */}
      <div className="flex items-center gap-6">
        <div className="flex flex-col gap-0.5">
          <span className="text-2xl font-bold text-accent-indigo">{task.remaining}</span>
          <span className="text-xs text-text-tertiary">剩余次数</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-2xl font-bold text-text-secondary">{task.used}</span>
          <span className="text-xs text-text-tertiary">已使用</span>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center justify-between pt-3 border-t border-border-subtle">
        {task.requestTime && (
          <span className="text-xs text-text-tertiary">
            {task.requestStatus === 'pending' ? '申请时间：' : '处理时间：'}
            {task.requestTime}
          </span>
        )}
        {!task.requestTime && <span />}

        {canRequest ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onRequestIncrease(task.id)}
            disabled={requesting}
            className="gap-1.5"
          >
            {requesting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {requesting ? '申请中...' : '申请增加'}
          </Button>
        ) : task.requestStatus === 'pending' ? (
          <span className="text-xs text-accent-amber">等待代理商处理...</span>
        ) : null}
      </div>
    </div>
  )
}

export default function AppealQuotaPage() {
  const router = useRouter()
  const toast = useToast()
  const [tasks, setTasks] = useState<TaskAppealQuota[]>([])
  const [loading, setLoading] = useState(true)
  const [requestingTaskId, setRequestingTaskId] = useState<string | null>(null)

  const loadQuotas = useCallback(async () => {
    try {
      setLoading(true)
      const response = await api.listTasks(1, 100)
      const mapped = response.items.map(mapTaskToQuota)
      setTasks(mapped)
    } catch (err) {
      console.error('加载申诉次数失败:', err)
      toast.error('加载申诉次数信息失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    loadQuotas()
  }, [loadQuotas])

  // 申请增加申诉次数
  const handleRequestIncrease = async (taskId: string) => {
    try {
      setRequestingTaskId(taskId)
      await api.requestAppealCountIncrease(taskId)
      toast.success('申请已发送，等待代理商处理')
      // Update local state optimistically
      setTasks(prev =>
        prev.map(task =>
          task.id === taskId
            ? {
                ...task,
                requestStatus: 'pending' as RequestStatus,
                requestTime: new Date().toLocaleString('zh-CN', {
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                }),
              }
            : task
        )
      )
    } catch (err: any) {
      console.error('申请增加申诉次数失败:', err)
      const msg = err?.message || '申请失败，请稍后重试'
      toast.error(msg)
    } finally {
      setRequestingTaskId(null)
    }
  }

  // 统计数据
  const totalRemaining = tasks.reduce((sum, t) => sum + t.remaining, 0)
  const totalUsed = tasks.reduce((sum, t) => sum + t.used, 0)
  const pendingRequests = tasks.filter(t => t.requestStatus === 'pending').length

  return (
    <ResponsiveLayout role="creator">
      <div className="flex flex-col gap-6 h-full">
        {/* 顶部栏 */}
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => router.back()}
            className="w-10 h-10 rounded-xl bg-bg-elevated flex items-center justify-center hover:bg-bg-elevated/80 transition-colors"
          >
            <ArrowLeft size={20} className="text-text-secondary" />
          </button>
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl lg:text-[28px] font-bold text-text-primary">申诉次数</h1>
            <p className="text-sm lg:text-[15px] text-text-secondary">
              查看各任务的申诉次数，可向代理商申请增加
            </p>
          </div>
        </div>

        {/* 统计卡片 */}
        {loading ? (
          <div className="grid grid-cols-3 gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-bg-card rounded-xl p-4 card-shadow flex flex-col items-center gap-1 animate-pulse">
                <div className="h-7 w-8 bg-bg-elevated rounded" />
                <div className="h-3 w-14 bg-bg-elevated rounded" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-bg-card rounded-xl p-4 card-shadow flex flex-col items-center gap-1">
              <span className="text-2xl font-bold text-accent-indigo">{totalRemaining}</span>
              <span className="text-xs text-text-tertiary">总剩余次数</span>
            </div>
            <div className="bg-bg-card rounded-xl p-4 card-shadow flex flex-col items-center gap-1">
              <span className="text-2xl font-bold text-text-secondary">{totalUsed}</span>
              <span className="text-xs text-text-tertiary">总已使用</span>
            </div>
            <div className="bg-bg-card rounded-xl p-4 card-shadow flex flex-col items-center gap-1">
              <span className="text-2xl font-bold text-accent-amber">{pendingRequests}</span>
              <span className="text-xs text-text-tertiary">待处理申请</span>
            </div>
          </div>
        )}

        {/* 规则说明 */}
        <div className="bg-accent-indigo/10 rounded-xl p-4 flex gap-3">
          <Info size={20} className="text-accent-indigo flex-shrink-0 mt-0.5" />
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-text-primary">申诉次数规则</span>
            <span className="text-[13px] text-text-secondary leading-relaxed">
              每个任务初始有 1 次申诉机会，不同任务独立计算。如需更多次数，可点击&ldquo;申请增加&rdquo;向代理商发送请求，无需填写理由。代理商可增加的次数无上限。
            </span>
          </div>
        </div>

        {/* 任务列表 */}
        <div className="flex flex-col gap-4 flex-1 min-h-0 overflow-y-auto pb-4">
          <h2 className="text-base font-semibold text-text-primary sticky top-0 bg-bg-page py-2 -mt-2">
            任务申诉次数 {!loading && `(${tasks.length})`}
          </h2>
          {loading ? (
            <>
              <QuotaSkeleton />
              <QuotaSkeleton />
              <QuotaSkeleton />
            </>
          ) : tasks.length > 0 ? (
            tasks.map(task => (
              <TaskQuotaCard
                key={task.id}
                task={task}
                onRequestIncrease={handleRequestIncrease}
                requesting={requestingTaskId === task.id}
              />
            ))
          ) : (
            <div className="flex flex-col items-center justify-center py-16">
              <AlertCircle className="w-12 h-12 text-text-tertiary/50 mb-4" />
              <p className="text-text-secondary text-center">暂无任务数据</p>
            </div>
          )}
        </div>
      </div>
    </ResponsiveLayout>
  )
}
