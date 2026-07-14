'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Bot, Download, FileText, FolderKanban, RefreshCw, ScanText, Video } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { api, extractErrorMessage } from '@/lib/api'
import type { ProjectResponse } from '@/types/project'
import type { TaskResponse } from '@/types/task'
import { 下载二进制文件, 格式化时间, 获取代运营任务入口, 获取阶段名称 } from './_shared'

export default function OperatorDashboardPage() {
  const toast = useToast()
  const [projects, setProjects] = useState<ProjectResponse[]>([])
  const [tasks, setTasks] = useState<TaskResponse[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [projectRes, taskRes] = await Promise.all([
        api.listOperatorProjects(),
        api.listOperatorTasks(),
      ])
      setProjects(projectRes.items)
      setTasks(taskRes.items)
    } catch (err) {
      toast.error(`加载工作台失败：${extractErrorMessage(err)}`)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const stats = useMemo(() => {
    const scriptPending = tasks.filter((item) => item.stage === 'script_upload' || item.stage === 'script_agency_review').length
    const videoPending = tasks.filter((item) => item.stage === 'video_upload' || item.stage === 'video_agency_review').length
    const completed = tasks.filter((item) => item.stage === 'completed').length
    return [
      { label: '项目数', value: projects.length, icon: FolderKanban },
      { label: '脚本待处理', value: scriptPending, icon: FileText },
      { label: '视频待处理', value: videoPending, icon: Video },
      { label: '已完成任务', value: completed, icon: ScanText },
    ]
  }, [projects.length, tasks])

  const recentTasks = useMemo(
    () => [...tasks].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')).slice(0, 6),
    [tasks]
  )

  const handleExportAll = useCallback(async () => {
    try {
      const blob = await api.exportTasksCsv()
      下载二进制文件(blob, `代运营任务导出-${new Date().toISOString().slice(0, 10)}.csv`)
    } catch (err) {
      toast.error(`导出失败：${extractErrorMessage(err)}`)
    }
  }, [toast])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">代运营工作台</h1>
          <p className="mt-1 text-sm text-text-secondary">在一个工作台里完成项目、规则、脚本、视频、审核和导出。</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" icon={RefreshCw} onClick={() => void loadData()} disabled={loading}>
            刷新数据
          </Button>
          <Button variant="secondary" icon={Download} onClick={() => void handleExportAll()}>
            导出全部任务
          </Button>
          <Link href="/operator/rules">
            <Button variant="secondary" icon={FileText}>规则配置</Button>
          </Link>
          <Link href="/operator/ai-config">
            <Button icon={Bot}>AI 配置</Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stats.map((item) => {
          const Icon = item.icon
          return (
            <Card key={item.label}>
              <CardContent className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-text-secondary">{item.label}</div>
                  <div className="mt-2 text-3xl font-bold text-text-primary">{item.value}</div>
                </div>
                <div className="rounded-2xl bg-accent-indigo/10 p-3 text-accent-indigo">
                  <Icon size={22} />
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>最近任务</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <div className="text-sm text-text-tertiary">正在加载任务...</div>
            ) : recentTasks.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border-subtle p-6 text-center text-sm text-text-tertiary">
                暂无任务，先去创建项目和任务。
              </div>
            ) : (
              recentTasks.map((task) => (
                <Link
                  key={task.id}
                  href={获取代运营任务入口(task.id, task.stage)}
                  className="block rounded-xl border border-border-subtle bg-bg-elevated p-4 transition-colors hover:border-accent-indigo/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-text-primary">{task.name}</div>
                      <div className="mt-1 text-sm text-text-secondary">
                        {task.project.name} · {task.creator.name}
                      </div>
                    </div>
                    <span className="rounded-full bg-accent-indigo/10 px-2.5 py-1 text-xs text-accent-indigo">
                      {获取阶段名称(task.stage)}
                    </span>
                  </div>
                  <div className="mt-3 text-xs text-text-tertiary">最近更新时间：{格式化时间(task.updated_at)}</div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>快捷入口</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Link href="/operator/projects" className="block rounded-xl border border-border-subtle bg-bg-elevated p-4 hover:border-accent-indigo/40">
              <div className="font-medium text-text-primary">创建项目</div>
              <div className="mt-1 text-sm text-text-secondary">填写客户名、品牌名和项目备注，项目创建后再去任务管理页配置 Brief。</div>
            </Link>
            <Link href="/operator/tasks" className="block rounded-xl border border-border-subtle bg-bg-elevated p-4 hover:border-accent-indigo/40">
              <div className="font-medium text-text-primary">创建任务</div>
              <div className="mt-1 text-sm text-text-secondary">为任务填写达人名、平台和备注，直接进入执行流程。</div>
            </Link>
            <Link href="/operator/rules" className="block rounded-xl border border-border-subtle bg-bg-elevated p-4 hover:border-accent-indigo/40">
              <div className="font-medium text-text-primary">更新规则</div>
              <div className="mt-1 text-sm text-text-secondary">维护违禁词、白名单、竞品和平台规则，更新后立即用于当前工作空间。</div>
            </Link>
            <Link href="/operator/ai-config" className="block rounded-xl border border-border-subtle bg-bg-elevated p-4 hover:border-accent-indigo/40">
              <div className="font-medium text-text-primary">调整 AI 配置</div>
              <div className="mt-1 text-sm text-text-secondary">单独配置当前代运营账号的模型和参数。</div>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
