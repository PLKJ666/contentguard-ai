'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import {
  ArrowLeft,
  History,
  CheckCircle,
  XCircle,
  Search,
  Filter,
  FileText,
  Video,
  User,
  Calendar,
  Download,
  Loader2
} from 'lucide-react'
import { api } from '@/lib/api'
import { formatTaskDisplayName } from '@/lib/taskDisplay'
import type { TaskResponse } from '@/types/task'

// 审核历史记录类型
interface ReviewHistoryItem {
  id: string
  taskId: string
  taskTitle: string
  creatorName: string
  contentType: 'script' | 'video'
  result: 'approved' | 'rejected'
  reason?: string
  reviewedAt: string
  projectName: string
}

/**
 * Map a completed TaskResponse to the ReviewHistoryItem UI model.
 */
function mapTaskToHistoryItem(task: TaskResponse): ReviewHistoryItem {
  // Determine content type based on the latest stage info
  // If the task reached video stages, it's a video review; otherwise script
  const hasVideoReview = task.video_agency_status !== null && task.video_agency_status !== undefined
  const contentType: 'script' | 'video' = hasVideoReview ? 'video' : 'script'

  // Determine result
  let result: 'approved' | 'rejected' = 'approved'
  let reason: string | undefined

  if (task.stage === 'rejected') {
    result = 'rejected'
    // Try to pick up the rejection reason
    if (hasVideoReview) {
      reason = task.video_agency_comment || task.video_brand_comment || undefined
    } else {
      reason = task.script_agency_comment || task.script_brand_comment || undefined
    }
  } else if (task.stage === 'completed') {
    result = 'approved'
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    }).replace(/\//g, '-')
  }

  return {
    id: task.id,
    taskId: task.id,
    taskTitle: formatTaskDisplayName({
      taskName: task.name,
      projectName: task.project?.name,
      sequence: task.sequence,
    }),
    creatorName: task.creator.name,
    contentType,
    result,
    reason,
    reviewedAt: formatDate(task.updated_at),
    projectName: task.project.name,
  }
}

export default function AgencyReviewHistoryPage() {
  const router = useRouter()
  const [searchQuery, setSearchQuery] = useState('')
  const [filterResult, setFilterResult] = useState<'all' | 'approved' | 'rejected'>('all')
  const [filterType, setFilterType] = useState<'all' | 'script' | 'video'>('all')
  const [historyData, setHistoryData] = useState<ReviewHistoryItem[]>([])
  const [loading, setLoading] = useState(true)

  const fetchHistory = useCallback(async () => {
    try {
      setLoading(true)
      const response = await api.listTasks(1, 50, 'completed')
      setHistoryData(response.items.map(mapTaskToHistoryItem))
    } catch (err) {
      console.error('Failed to fetch review history:', err)
      setHistoryData([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  // 筛选数据
  const filteredHistory = historyData.filter(item => {
    const matchesSearch = searchQuery === '' ||
      item.taskTitle.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.creatorName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.projectName.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesResult = filterResult === 'all' || item.result === filterResult
    const matchesType = filterType === 'all' || item.contentType === filterType
    return matchesSearch && matchesResult && matchesType
  })

  // 统计
  const approvedCount = historyData.filter(i => i.result === 'approved').length
  const rejectedCount = historyData.filter(i => i.result === 'rejected').length

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
            <h1 className="text-2xl font-bold text-text-primary">审核历史</h1>
            <p className="text-sm text-text-secondary mt-0.5">查看您的历史审核记录</p>
          </div>
        </div>
        <Button variant="secondary">
          <Download size={16} />
          导出记录
        </Button>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-bg-card card-shadow">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent-indigo/15 flex items-center justify-center">
              <History size={20} className="text-accent-indigo" />
            </div>
            <div>
              <p className="text-2xl font-bold text-text-primary">{historyData.length}</p>
              <p className="text-sm text-text-secondary">总审核数</p>
            </div>
          </div>
        </div>
        <div className="p-4 rounded-xl bg-bg-card card-shadow">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent-green/15 flex items-center justify-center">
              <CheckCircle size={20} className="text-accent-green" />
            </div>
            <div>
              <p className="text-2xl font-bold text-accent-green">{approvedCount}</p>
              <p className="text-sm text-text-secondary">已通过</p>
            </div>
          </div>
        </div>
        <div className="p-4 rounded-xl bg-bg-card card-shadow">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent-coral/15 flex items-center justify-center">
              <XCircle size={20} className="text-accent-coral" />
            </div>
            <div>
              <p className="text-2xl font-bold text-accent-coral">{rejectedCount}</p>
              <p className="text-sm text-text-secondary">已驳回</p>
            </div>
          </div>
        </div>
      </div>

      {/* 搜索和筛选 */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            type="text"
            placeholder="搜索任务、达人或项目..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-border-subtle rounded-xl bg-bg-elevated text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-indigo"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-tertiary">结果:</span>
          <div className="flex items-center gap-1 p-1 bg-bg-elevated rounded-lg">
            {[
              { value: 'all', label: '全部' },
              { value: 'approved', label: '通过' },
              { value: 'rejected', label: '驳回' },
            ].map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setFilterResult(tab.value as typeof filterResult)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  filterResult === tab.value ? 'bg-bg-card text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-tertiary">类型:</span>
          <div className="flex items-center gap-1 p-1 bg-bg-elevated rounded-lg">
            {[
              { value: 'all', label: '全部' },
              { value: 'script', label: '脚本' },
              { value: 'video', label: '视频' },
            ].map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setFilterType(tab.value as typeof filterType)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  filterType === tab.value ? 'bg-bg-card text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 历史列表 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History size={18} className="text-accent-indigo" />
            审核记录
            <span className="ml-auto text-sm font-normal text-text-secondary">
              共 {filteredHistory.length} 条
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-text-tertiary">
              <Loader2 size={32} className="animate-spin mb-4" />
              <p>加载中...</p>
            </div>
          ) : filteredHistory.length > 0 ? (
            filteredHistory.map((item) => (
              <div
                key={item.id}
                className="p-4 rounded-xl bg-bg-elevated hover:bg-bg-elevated/80 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        item.result === 'approved'
                          ? 'bg-accent-green/15 text-accent-green'
                          : 'bg-accent-coral/15 text-accent-coral'
                      }`}>
                        {item.result === 'approved' ? '已通过' : '已驳回'}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-text-tertiary">
                        {item.contentType === 'script' ? <FileText size={12} /> : <Video size={12} />}
                        {item.contentType === 'script' ? '脚本' : '视频'}
                      </span>
                    </div>
                    <h3 className="font-medium text-text-primary mb-1">{item.taskTitle}</h3>
                    <div className="flex items-center gap-4 text-sm text-text-secondary">
                      <span className="flex items-center gap-1">
                        <User size={14} />
                        {item.creatorName}
                      </span>
                      <span>{item.projectName}</span>
                    </div>
                    {item.reason && (
                      <p className="mt-2 text-sm text-accent-coral">驳回原因: {item.reason}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-1 text-sm text-text-tertiary">
                      <Calendar size={14} />
                      {item.reviewedAt}
                    </div>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-12 text-text-tertiary">
              <History size={48} className="mx-auto mb-4 opacity-50" />
              <p>没有找到匹配的审核记录</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
