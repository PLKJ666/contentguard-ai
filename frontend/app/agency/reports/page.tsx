'use client'

import { useState, useEffect, useCallback } from 'react'
import { useToast } from '@/components/ui/Toast'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Download,
  Calendar,
  FileText,
  Video,
  Users,
  CheckCircle,
  XCircle,
  Clock,
  FileSpreadsheet,
  File,
  Check,
  Loader2
} from 'lucide-react'
import { getPlatformInfo } from '@/lib/platforms'
import { api } from '@/lib/api'
import type { AgencyDashboard } from '@/types/dashboard'
import type { TaskResponse, TaskStatus } from '@/types/task'

// 时间范围类型
type DateRange = 'week' | 'month' | 'quarter' | 'year'

// 时间范围标签
const dateRangeLabels: Record<DateRange, string> = {
  week: '本周',
  month: '本月',
  quarter: '本季度',
  year: '本年',
}

// ==================== 真实数据计算逻辑 ====================

interface ReportData {
  stats: {
    totalScripts: number
    totalVideos: number
    passRate: number
    avgReviewTime: number | null
    trend: { scripts: string; videos: string; passRate: string; reviewTime: string | null }
  }
  trendData: { label: string; submitted: number; passed: number; rejected: number }[]
  compareText: string
  projectStats: { name: string; platform: string; scripts: number; videos: number; passRate: number }[]
  creatorRanking: { name: string; passRate: number; total: number }[]
}

function getDateRange(range: DateRange): { start: Date; end: Date; prevStart: Date; prevEnd: Date } {
  const now = new Date()
  let start: Date, prevStart: Date, prevEnd: Date

  switch (range) {
    case 'week': {
      const day = now.getDay()
      const diff = day === 0 ? 6 : day - 1 // 周一为起始
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff)
      const duration = now.getTime() - start.getTime()
      prevStart = new Date(start.getTime() - 7 * 86400000)
      prevEnd = new Date(start.getTime() - 1)
      // 上周同等时间段
      prevEnd = new Date(prevStart.getTime() + duration)
      break
    }
    case 'month': {
      start = new Date(now.getFullYear(), now.getMonth(), 1)
      const dayOfMonth = now.getDate()
      prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      prevEnd = new Date(now.getFullYear(), now.getMonth() - 1, Math.min(dayOfMonth, new Date(now.getFullYear(), now.getMonth(), 0).getDate()))
      break
    }
    case 'quarter': {
      const qMonth = Math.floor(now.getMonth() / 3) * 3
      start = new Date(now.getFullYear(), qMonth, 1)
      prevStart = new Date(now.getFullYear(), qMonth - 3, 1)
      const elapsed = now.getTime() - start.getTime()
      prevEnd = new Date(prevStart.getTime() + elapsed)
      break
    }
    case 'year': {
      start = new Date(now.getFullYear(), 0, 1)
      prevStart = new Date(now.getFullYear() - 1, 0, 1)
      const elapsed2 = now.getTime() - start.getTime()
      prevEnd = new Date(prevStart.getTime() + elapsed2)
      break
    }
  }

  return { start, end: now, prevStart, prevEnd }
}

const compareTexts: Record<DateRange, string> = {
  week: '上周',
  month: '上月',
  quarter: '上季度',
  year: '去年',
}

const isPassed = (status: TaskStatus | null | undefined) =>
  status === 'passed' || status === 'force_passed'
const isRejected = (status: TaskStatus | null | undefined) =>
  status === 'rejected'
const hasStatus = (status: TaskStatus | null | undefined) =>
  status != null && status !== 'pending' && status !== 'processing'

function calcPassRate(tasks: TaskResponse[]): number {
  let passed = 0, total = 0
  for (const t of tasks) {
    if (hasStatus(t.script_agency_status)) {
      total++
      if (isPassed(t.script_agency_status)) passed++
    }
    if (hasStatus(t.video_agency_status)) {
      total++
      if (isPassed(t.video_agency_status)) passed++
    }
  }
  return total > 0 ? Math.round((passed / total) * 100) : 0
}

function formatTrend(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? '+100%' : '0%'
  const pct = Math.round(((current - previous) / previous) * 100)
  return pct >= 0 ? `+${pct}%` : `${pct}%`
}

function computeReportData(allTasks: TaskResponse[], range: DateRange): ReportData {
  const { start, end, prevStart, prevEnd } = getDateRange(range)

  const currentTasks = allTasks.filter(t => {
    const d = new Date(t.created_at)
    return d >= start && d <= end
  })
  const prevTasks = allTasks.filter(t => {
    const d = new Date(t.created_at)
    return d >= prevStart && d <= prevEnd
  })

  // 核心指标
  const totalScripts = currentTasks.filter(t => t.script_agency_status != null).length
  const totalVideos = currentTasks.filter(t => t.video_agency_status != null).length
  const passRate = calcPassRate(currentTasks)

  const prevScripts = prevTasks.filter(t => t.script_agency_status != null).length
  const prevVideos = prevTasks.filter(t => t.video_agency_status != null).length
  const prevPassRate = calcPassRate(prevTasks)

  // 趋势图分组
  const trendData = buildTrendData(currentTasks, range, start, end)

  // 项目统计
  const projectMap = new Map<string, { name: string; platform: string; scripts: number; videos: number; passed: number; total: number }>()
  for (const t of currentTasks) {
    const pid = t.project?.id
    if (!pid) continue
    if (!projectMap.has(pid)) {
      projectMap.set(pid, { name: t.project.name, platform: t.project.platform || '', scripts: 0, videos: 0, passed: 0, total: 0 })
    }
    const p = projectMap.get(pid)!
    if (t.script_agency_status != null) p.scripts++
    if (t.video_agency_status != null) p.videos++
    if (hasStatus(t.script_agency_status)) {
      p.total++
      if (isPassed(t.script_agency_status)) p.passed++
    }
    if (hasStatus(t.video_agency_status)) {
      p.total++
      if (isPassed(t.video_agency_status)) p.passed++
    }
  }
  const projectStats = Array.from(projectMap.values()).map(p => ({
    name: p.name,
    platform: p.platform,
    scripts: p.scripts,
    videos: p.videos,
    passRate: p.total > 0 ? Math.round((p.passed / p.total) * 100) : 0,
  }))

  // 达人排名
  const creatorMap = new Map<string, { name: string; passed: number; total: number }>()
  for (const t of currentTasks) {
    const cid = t.creator?.id
    if (!cid) continue
    if (!creatorMap.has(cid)) {
      creatorMap.set(cid, { name: t.creator.name, passed: 0, total: 0 })
    }
    const c = creatorMap.get(cid)!
    if (hasStatus(t.script_agency_status)) {
      c.total++
      if (isPassed(t.script_agency_status)) c.passed++
    }
    if (hasStatus(t.video_agency_status)) {
      c.total++
      if (isPassed(t.video_agency_status)) c.passed++
    }
  }
  const creatorRanking = Array.from(creatorMap.values())
    .map(c => ({ name: c.name, passRate: c.total > 0 ? Math.round((c.passed / c.total) * 100) : 0, total: c.total }))
    .sort((a, b) => b.passRate - a.passRate || b.total - a.total)
    .slice(0, 5)

  return {
    stats: {
      totalScripts,
      totalVideos,
      passRate,
      avgReviewTime: null,
      trend: {
        scripts: formatTrend(totalScripts, prevScripts),
        videos: formatTrend(totalVideos, prevVideos),
        passRate: formatTrend(passRate, prevPassRate),
        reviewTime: null,
      },
    },
    trendData,
    compareText: compareTexts[range],
    projectStats,
    creatorRanking,
  }
}

function buildTrendData(tasks: TaskResponse[], range: DateRange, start: Date, end: Date) {
  const buckets: { label: string; submitted: number; passed: number; rejected: number }[] = []

  if (range === 'week') {
    const dayLabels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
    for (let i = 0; i < 7; i++) {
      buckets.push({ label: dayLabels[i], submitted: 0, passed: 0, rejected: 0 })
    }
    for (const t of tasks) {
      const d = new Date(t.created_at)
      const day = d.getDay()
      const idx = day === 0 ? 6 : day - 1
      if (idx >= 0 && idx < 7) {
        buckets[idx].submitted++
        if (isPassed(t.script_agency_status) || isPassed(t.video_agency_status)) buckets[idx].passed++
        if (isRejected(t.script_agency_status) || isRejected(t.video_agency_status)) buckets[idx].rejected++
      }
    }
  } else if (range === 'month') {
    for (let i = 1; i <= 4; i++) {
      buckets.push({ label: `第${i}周`, submitted: 0, passed: 0, rejected: 0 })
    }
    for (const t of tasks) {
      const d = new Date(t.created_at)
      const weekIdx = Math.min(Math.floor((d.getDate() - 1) / 7), 3)
      buckets[weekIdx].submitted++
      if (isPassed(t.script_agency_status) || isPassed(t.video_agency_status)) buckets[weekIdx].passed++
      if (isRejected(t.script_agency_status) || isRejected(t.video_agency_status)) buckets[weekIdx].rejected++
    }
  } else {
    // quarter / year — 按月分组
    const startMonth = start.getMonth()
    const endMonth = end.getMonth() + (end.getFullYear() - start.getFullYear()) * 12
    const monthLabels = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']
    for (let m = startMonth; m <= endMonth; m++) {
      buckets.push({ label: monthLabels[m % 12], submitted: 0, passed: 0, rejected: 0 })
    }
    for (const t of tasks) {
      const d = new Date(t.created_at)
      const mIdx = d.getMonth() + (d.getFullYear() - start.getFullYear()) * 12 - startMonth
      if (mIdx >= 0 && mIdx < buckets.length) {
        buckets[mIdx].submitted++
        if (isPassed(t.script_agency_status) || isPassed(t.video_agency_status)) buckets[mIdx].passed++
        if (isRejected(t.script_agency_status) || isRejected(t.video_agency_status)) buckets[mIdx].rejected++
      }
    }
  }

  return buckets
}

// ==================== UI 组件 ====================

function StatCard({ title, value, unit, trend, compareText, icon: Icon, color }: {
  title: string
  value: number | string
  unit?: string
  trend?: string
  compareText: string
  icon: React.ElementType
  color: string
}) {
  const isPositive = trend?.startsWith('+') || (trend?.startsWith('-') && title.includes('时长'))

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-text-secondary">{title}</p>
            <div className="flex items-baseline gap-1 mt-1">
              <span className={`text-2xl font-bold ${color}`}>{value}</span>
              {unit && <span className="text-text-secondary">{unit}</span>}
            </div>
            {trend && (
              <div className={`flex items-center gap-1 mt-1 text-xs ${isPositive ? 'text-accent-green' : 'text-accent-coral'}`}>
                {isPositive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                {trend} vs {compareText}
              </div>
            )}
          </div>
          <div className={`w-10 h-10 rounded-lg ${color.replace('text-', 'bg-')}/20 flex items-center justify-center`}>
            <Icon size={20} className={color} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function AgencyReportsPage() {
  const [dateRange, setDateRange] = useState<DateRange>('week')
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportFormat, setExportFormat] = useState<'csv' | 'excel' | 'pdf'>('excel')
  const [isExporting, setIsExporting] = useState(false)
  const [exportSuccess, setExportSuccess] = useState(false)
  const [loading, setLoading] = useState(true)
  const [dashboardData, setDashboardData] = useState<AgencyDashboard | null>(null)
  const [allTasks, setAllTasks] = useState<TaskResponse[]>([])
  const toast = useToast()

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      const [dashboard, tasksRes] = await Promise.all([
        api.getAgencyDashboard(),
        api.listTasks(1, 500),
      ])
      setDashboardData(dashboard)
      setAllTasks(tasksRes.items)
    } catch (err) {
      console.error('Failed to fetch agency reports data:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const currentData: ReportData = computeReportData(allTasks, dateRange)

  // 导出报表
  const handleExport = async () => {
    setIsExporting(true)
    // 模拟导出过程
    await new Promise(resolve => setTimeout(resolve, 1500))

    // 生成文件名
    const dateStr = new Date().toISOString().split('T')[0]
    const fileName = `审核数据报表_${dateRangeLabels[dateRange]}_${dateStr}`

    // 模拟下载
    if (exportFormat === 'csv') {
      // 生成 CSV 内容
      const csvContent = generateCSV()
      downloadFile(csvContent, `${fileName}.csv`, 'text/csv')
    } else if (exportFormat === 'excel') {
      // 实际项目中会使用 xlsx 库
      toast.info(`Excel 文件「${fileName}.xlsx」已开始下载`)
    } else {
      toast.info(`PDF 文件「${fileName}.pdf」已开始下载`)
    }

    setIsExporting(false)
    setExportSuccess(true)
    setTimeout(() => {
      setShowExportModal(false)
      setExportSuccess(false)
    }, 1500)
  }

  // 生成 CSV 内容
  const generateCSV = () => {
    const headers = ['指标', '数值', '趋势']
    const rows = [
      ['脚本审核量', currentData.stats.totalScripts, currentData.stats.trend.scripts],
      ['视频审核量', currentData.stats.totalVideos, currentData.stats.trend.videos],
      ['通过率', `${currentData.stats.passRate}%`, currentData.stats.trend.passRate ?? ''],
      ['平均审核时长', currentData.stats.avgReviewTime != null ? `${currentData.stats.avgReviewTime}小时` : '—', currentData.stats.trend.reviewTime ?? ''],
      [],
      ['时间段', '提交数', '通过数', '驳回数'],
      ...currentData.trendData.map(d => [d.label, d.submitted, d.passed, d.rejected]),
      [],
      ['项目名称', '脚本数', '视频数', '通过率'],
      ...currentData.projectStats.map(p => [p.name, p.scripts, p.videos, `${p.passRate}%`]),
    ]

    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
  }

  // 下载文件
  const downloadFile = (content: string, fileName: string, mimeType: string) => {
    const blob = new Blob(['\ufeff' + content], { type: mimeType + ';charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-text-tertiary">
        <Loader2 size={32} className="animate-spin mb-4" />
        <p>加载中...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">数据报表</h1>
          <p className="text-sm text-text-secondary mt-1">查看审核数据统计和趋势分析</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-bg-elevated rounded-lg">
            {(['week', 'month', 'quarter', 'year'] as DateRange[]).map((range) => (
              <button
                key={range}
                type="button"
                onClick={() => setDateRange(range)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  dateRange === range ? 'bg-bg-card text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {dateRangeLabels[range]}
              </button>
            ))}
          </div>
          <Button onClick={() => setShowExportModal(true)}>
            <Download size={16} />
            导出报表
          </Button>
        </div>
      </div>

      {/* Dashboard summary banner */}
      {dashboardData && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-3 rounded-xl bg-accent-amber/10 border border-accent-amber/20">
            <p className="text-xs text-text-tertiary">待审核 (脚本/视频)</p>
            <p className="text-lg font-bold text-accent-amber mt-1">
              {dashboardData.pending_review.script} / {dashboardData.pending_review.video}
            </p>
          </div>
          <div className="p-3 rounded-xl bg-accent-coral/10 border border-accent-coral/20">
            <p className="text-xs text-text-tertiary">待处理申诉</p>
            <p className="text-lg font-bold text-accent-coral mt-1">{dashboardData.pending_appeal}</p>
          </div>
          <div className="p-3 rounded-xl bg-accent-indigo/10 border border-accent-indigo/20">
            <p className="text-xs text-text-tertiary">达人总数</p>
            <p className="text-lg font-bold text-accent-indigo mt-1">{dashboardData.total_creators}</p>
          </div>
          <div className="p-3 rounded-xl bg-accent-green/10 border border-accent-green/20">
            <p className="text-xs text-text-tertiary">任务总数</p>
            <p className="text-lg font-bold text-accent-green mt-1">{dashboardData.total_tasks}</p>
          </div>
        </div>
      )}

      {/* 核心指标 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          title="脚本审核量"
          value={currentData.stats.totalScripts}
          trend={currentData.stats.trend.scripts}
          compareText={currentData.compareText}
          icon={FileText}
          color="text-accent-indigo"
        />
        <StatCard
          title="视频审核量"
          value={currentData.stats.totalVideos}
          trend={currentData.stats.trend.videos}
          compareText={currentData.compareText}
          icon={Video}
          color="text-purple-400"
        />
        <StatCard
          title="通过率"
          value={currentData.stats.passRate}
          unit="%"
          trend={currentData.stats.trend.passRate}
          compareText={currentData.compareText}
          icon={CheckCircle}
          color="text-accent-green"
        />
        <StatCard
          title="平均审核时长"
          value={currentData.stats.avgReviewTime ?? '—'}
          unit={currentData.stats.avgReviewTime != null ? '小时' : undefined}
          trend={currentData.stats.trend.reviewTime ?? undefined}
          compareText={currentData.compareText}
          icon={Clock}
          color="text-orange-400"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 趋势图 */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 size={18} className="text-blue-500" />
              审核趋势 - {dateRangeLabels[dateRange]}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {currentData.trendData.map((item) => (
                <div key={item.label} className="flex items-center gap-4">
                  <div className="w-14 text-sm text-text-secondary font-medium">{item.label}</div>
                  <div className="flex-1">
                    <div className="flex h-6 rounded-full overflow-hidden bg-bg-elevated">
                      <div
                        className="bg-accent-green transition-all"
                        style={{ width: `${item.submitted > 0 ? (item.passed / item.submitted) * 100 : 0}%` }}
                      />
                      <div
                        className="bg-accent-coral transition-all"
                        style={{ width: `${item.submitted > 0 ? (item.rejected / item.submitted) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                  <div className="w-28 text-right text-sm">
                    <span className="text-accent-green font-medium">{item.passed}</span>
                    <span className="text-text-tertiary"> / </span>
                    <span className="text-text-secondary">{item.submitted}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-6 mt-4 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-accent-green rounded" />
                <span className="text-text-secondary">通过</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-accent-coral rounded" />
                <span className="text-text-secondary">驳回</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 达人排名 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users size={18} className="text-accent-indigo" />
              达人通过率排名
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {currentData.creatorRanking.length === 0 ? (
              <div className="text-center py-8 text-text-tertiary text-sm">暂无达人审核数据</div>
            ) : (
              currentData.creatorRanking.map((creator, index) => (
                <div key={creator.name} className="flex items-center gap-3 p-3 rounded-lg bg-bg-elevated">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${
                    index === 0 ? 'bg-yellow-500/20 text-yellow-400' :
                    index === 1 ? 'bg-gray-500/20 text-gray-400' :
                    index === 2 ? 'bg-orange-500/20 text-orange-400' : 'bg-bg-page text-text-tertiary'
                  }`}>
                    {index + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-text-primary truncate">{creator.name}</div>
                    <div className="text-xs text-text-tertiary">{creator.total} 条审核</div>
                  </div>
                  <div className={`font-bold ${creator.passRate >= 90 ? 'text-accent-green' : creator.passRate >= 80 ? 'text-accent-indigo' : 'text-orange-400'}`}>
                    {creator.passRate}%
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* 项目统计 */}
      <Card>
        <CardHeader>
          <CardTitle>项目统计</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-subtle text-left text-sm text-text-secondary">
                <th className="pb-3 font-medium">项目名称</th>
                <th className="pb-3 font-medium">平台</th>
                <th className="pb-3 font-medium text-center">脚本数</th>
                <th className="pb-3 font-medium text-center">视频数</th>
                <th className="pb-3 font-medium text-center">通过率</th>
                <th className="pb-3 font-medium">通过率分布</th>
              </tr>
            </thead>
            <tbody>
              {currentData.projectStats.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-text-tertiary text-sm">暂无项目统计数据</td>
                </tr>
              ) : (
                currentData.projectStats.map((project) => {
                  const platform = getPlatformInfo(project.platform)
                  return (
                    <tr key={project.name} className="border-b border-border-subtle last:border-0">
                      <td className="py-4 font-medium text-text-primary">{project.name}</td>
                      <td className="py-4">
                        {platform && (
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${platform.bgColor} ${platform.textColor} border ${platform.borderColor}`}>
                            <span>{platform.icon}</span>
                            {platform.name}
                          </span>
                        )}
                      </td>
                      <td className="py-4 text-center text-text-secondary">{project.scripts}</td>
                      <td className="py-4 text-center text-text-secondary">{project.videos}</td>
                      <td className="py-4 text-center">
                        <span className={`font-medium ${project.passRate >= 90 ? 'text-accent-green' : project.passRate >= 80 ? 'text-accent-indigo' : 'text-orange-400'}`}>
                          {project.passRate}%
                        </span>
                      </td>
                      <td className="py-4">
                        <div className="w-full h-2 bg-bg-elevated rounded-full overflow-hidden">
                          <div
                            className={`h-full ${project.passRate >= 90 ? 'bg-accent-green' : project.passRate >= 80 ? 'bg-accent-indigo' : 'bg-orange-400'}`}
                            style={{ width: `${project.passRate}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* 导出弹窗 */}
      <Modal isOpen={showExportModal} onClose={() => setShowExportModal(false)} title="导出报表">
        <div className="space-y-4">
          {exportSuccess ? (
            <div className="py-8 text-center">
              <div className="w-16 h-16 mx-auto rounded-full bg-accent-green/20 flex items-center justify-center mb-4">
                <Check size={32} className="text-accent-green" />
              </div>
              <p className="text-text-primary font-medium">导出成功！</p>
              <p className="text-sm text-text-secondary mt-1">文件已开始下载</p>
            </div>
          ) : (
            <>
              <p className="text-text-secondary text-sm">
                导出{dateRangeLabels[dateRange]}的审核数据报表，包含核心指标、趋势数据和项目统计。
              </p>

              <div>
                <label className="block text-sm font-medium text-text-primary mb-3">选择导出格式</label>
                <div className="space-y-2">
                  {[
                    { value: 'excel', label: 'Excel (.xlsx)', desc: '适合数据分析和图表制作', icon: FileSpreadsheet },
                    { value: 'csv', label: 'CSV (.csv)', desc: '通用格式，兼容性好', icon: File },
                    { value: 'pdf', label: 'PDF (.pdf)', desc: '适合打印和分享', icon: FileText },
                  ].map((format) => (
                    <label
                      key={format.value}
                      className={`flex items-center gap-4 p-4 rounded-xl border cursor-pointer transition-colors ${
                        exportFormat === format.value
                          ? 'border-accent-indigo bg-accent-indigo/10'
                          : 'border-border-subtle hover:border-accent-indigo/50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="format"
                        value={format.value}
                        checked={exportFormat === format.value}
                        onChange={(e) => setExportFormat(e.target.value as typeof exportFormat)}
                        className="w-4 h-4 text-accent-indigo"
                      />
                      <format.icon size={24} className="text-text-secondary" />
                      <div className="flex-1">
                        <p className="text-text-primary font-medium">{format.label}</p>
                        <p className="text-xs text-text-tertiary">{format.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 justify-end pt-2">
                <Button variant="ghost" onClick={() => setShowExportModal(false)}>
                  取消
                </Button>
                <Button onClick={handleExport} disabled={isExporting}>
                  {isExporting ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      导出中...
                    </>
                  ) : (
                    <>
                      <Download size={16} />
                      确认导出
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  )
}
