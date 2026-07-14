'use client'

import { useState, useEffect, useCallback } from 'react'
import { Download, Calendar, Filter } from 'lucide-react'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { SuccessTag, WarningTag, ErrorTag } from '@/components/ui/Tag'

const periodOptions = [
  { value: '7d', label: '最近 7 天' },
  { value: '30d', label: '最近 30 天' },
  { value: '90d', label: '最近 90 天' },
]

const platformOptions = [
  { value: 'all', label: '全部平台' },
  { value: 'douyin', label: '抖音' },
  { value: 'xiaohongshu', label: '小红书' },
  { value: 'bilibili', label: 'B站' },
]

export default function ReportsPage() {
  const [period, setPeriod] = useState('7d')
  const [platform, setPlatform] = useState('all')
  const [reportData, setReportData] = useState<Array<{ id: string; date: string; submitted: number; passed: number; failed: number; avgScore: number }>>([])
  const [reviewRecords, setReviewRecords] = useState<Array<{ id: string; videoTitle: string; creator: string; platform: string; score: number; status: 'passed' | 'warning' | 'failed'; reviewedAt: string }>>([])
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.getReports({ period, platform })
      setReportData(data.reportData || [])
      setReviewRecords(data.reviewRecords || [])
    } catch (e) {
      console.error(e)
      setReportData([])
      setReviewRecords([])
    } finally {
      setLoading(false)
    }
  }, [period, platform])

  useEffect(() => {
    loadData()
  }, [loadData])

  // 计算汇总数据
  const summary = reportData.reduce(
    (acc, day) => ({
      totalSubmitted: acc.totalSubmitted + day.submitted,
      totalPassed: acc.totalPassed + day.passed,
      totalFailed: acc.totalFailed + day.failed,
    }),
    { totalSubmitted: 0, totalPassed: 0, totalFailed: 0 }
  )
  const passRate = summary.totalSubmitted > 0 ? Math.round((summary.totalPassed / summary.totalSubmitted) * 100) : 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">审核报表</h1>
        <Button icon={Download} variant="secondary">导出报表</Button>
      </div>

      {/* 筛选器 */}
      <div className="flex gap-4">
        <div className="w-40">
          <Select
            options={periodOptions}
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          />
        </div>
        <div className="w-40">
          <Select
            options={platformOptions}
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
          />
        </div>
      </div>

      {/* 汇总卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="py-4">
            <div className="text-sm text-gray-500">提交总数</div>
            <div className="text-3xl font-bold text-gray-900">{summary.totalSubmitted}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-sm text-gray-500">通过数</div>
            <div className="text-3xl font-bold text-green-600">{summary.totalPassed}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-sm text-gray-500">驳回数</div>
            <div className="text-3xl font-bold text-red-600">{summary.totalFailed}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="text-sm text-gray-500">通过率</div>
            <div className="text-3xl font-bold text-blue-600">{passRate}%</div>
          </CardContent>
        </Card>
      </div>

      {/* 每日数据表格 */}
      <Card>
        <CardHeader>
          <CardTitle>每日统计</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm text-gray-500">
                  <th className="pb-3 font-medium">日期</th>
                  <th className="pb-3 font-medium">提交数</th>
                  <th className="pb-3 font-medium">通过数</th>
                  <th className="pb-3 font-medium">驳回数</th>
                  <th className="pb-3 font-medium">通过率</th>
                  <th className="pb-3 font-medium">平均分</th>
                </tr>
              </thead>
              <tbody>
                {reportData.map((row) => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="py-3 font-medium text-gray-900">{row.date}</td>
                    <td className="py-3 text-gray-600">{row.submitted}</td>
                    <td className="py-3 text-green-600">{row.passed}</td>
                    <td className="py-3 text-red-600">{row.failed}</td>
                    <td className="py-3 text-gray-600">
                      {Math.round((row.passed / row.submitted) * 100)}%
                    </td>
                    <td className="py-3">
                      <span className={`font-medium ${row.avgScore >= 80 ? 'text-green-600' : 'text-yellow-600'}`}>
                        {row.avgScore}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* 详细审核记录 */}
      <Card>
        <CardHeader>
          <CardTitle>审核记录</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm text-gray-500">
                  <th className="pb-3 font-medium">视频标题</th>
                  <th className="pb-3 font-medium">达人</th>
                  <th className="pb-3 font-medium">平台</th>
                  <th className="pb-3 font-medium">合规分</th>
                  <th className="pb-3 font-medium">状态</th>
                  <th className="pb-3 font-medium">审核时间</th>
                </tr>
              </thead>
              <tbody>
                {reviewRecords.map((record) => (
                  <tr key={record.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="py-3 font-medium text-gray-900">{record.videoTitle}</td>
                    <td className="py-3 text-gray-600">{record.creator}</td>
                    <td className="py-3 text-gray-600">{record.platform}</td>
                    <td className="py-3">
                      <span className={`font-medium ${
                        record.score >= 80 ? 'text-green-600' : record.score >= 60 ? 'text-yellow-600' : 'text-red-600'
                      }`}>
                        {record.score}
                      </span>
                    </td>
                    <td className="py-3">
                      {record.status === 'passed' && <SuccessTag>通过</SuccessTag>}
                      {record.status === 'warning' && <WarningTag>待改进</WarningTag>}
                      {record.status === 'failed' && <ErrorTag>驳回</ErrorTag>}
                    </td>
                    <td className="py-3 text-sm text-gray-500">{record.reviewedAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
