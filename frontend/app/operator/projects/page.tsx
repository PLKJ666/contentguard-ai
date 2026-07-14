'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Download, FolderKanban, Plus, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { api, extractErrorMessage } from '@/lib/api'
import type { BriefResponse } from '@/types/brief'
import type { ProjectResponse } from '@/types/project'
import { 下载二进制文件, 平台名称映射, 平台选项, 格式化时间 } from '../_shared'

function 项目Brief已有效配置(brief?: BriefResponse | null): boolean {
  if (!brief) return false

  const hasDocument = Boolean(
    (brief.file_url && brief.file_name)
    || (brief.agency_attachments && brief.agency_attachments.length > 0)
  )
  const hasStructuredContent = Boolean(
    brief.product_name?.trim()
    || brief.selling_points?.length
    || brief.blacklist_words?.length
    || brief.other_requirements?.trim()
  )
  return hasDocument && hasStructuredContent
}

export default function OperatorProjectsPage() {
  const toast = useToast()
  const [projects, setProjects] = useState<ProjectResponse[]>([])
  const [briefMap, setBriefMap] = useState<Record<string, BriefResponse | null>>({})
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  const [form, setForm] = useState({
    name: '',
    description: '',
    platform: '',
    client_display_name: '',
    brand_display_name: '',
    project_remark: '',
  })

  const loadProjects = useCallback(async () => {
    setLoading(true)
    try {
      const projectRes = await api.listOperatorProjects()
      setProjects(projectRes.items)

      const briefEntries = await Promise.all(
        projectRes.items.map(async (project) => {
          try {
            const brief = await api.getBrief(project.id)
            return [project.id, brief] as const
          } catch {
            return [project.id, null] as const
          }
        })
      )
      setBriefMap(Object.fromEntries(briefEntries))
    } catch (err) {
      toast.error(`加载项目失败：${extractErrorMessage(err)}`)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  const totalTaskCount = useMemo(
    () => projects.reduce((sum, item) => sum + (item.task_count || 0), 0),
    [projects]
  )

  const handleCreateProject = useCallback(async () => {
    if (!form.name.trim()) {
      toast.error('请先填写项目名称')
      return
    }

    setCreating(true)
    try {
      await api.createOperatorProject({
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        platform: form.platform || undefined,
        client_display_name: form.client_display_name.trim() || undefined,
        brand_display_name: form.brand_display_name.trim() || undefined,
        project_remark: form.project_remark.trim() || undefined,
      })
      toast.success('项目已创建')
      setForm({
        name: '',
        description: '',
        platform: '',
        client_display_name: '',
        brand_display_name: '',
        project_remark: '',
      })
      await loadProjects()
    } catch (err) {
      toast.error(`创建失败：${extractErrorMessage(err)}`)
    } finally {
      setCreating(false)
    }
  }, [form, loadProjects, toast])

  const handleExportProject = useCallback(async (projectId: string, projectName: string) => {
    try {
      const blob = await api.exportTasksCsv({ project_id: projectId })
      下载二进制文件(blob, `${projectName}-任务导出.csv`)
    } catch (err) {
      toast.error(`导出失败：${extractErrorMessage(err)}`)
    }
  }, [toast])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">项目管理</h1>
          <p className="mt-1 text-sm text-text-secondary">创建内部代运营项目，维护客户名、品牌名与项目备注；项目 Brief 统一在任务管理页配置。</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" icon={RefreshCw} onClick={() => void loadProjects()} disabled={loading}>
            刷新
          </Button>
          <Button variant="secondary" icon={Download} onClick={() => void api.exportTasksCsv().then((blob) => 下载二进制文件(blob, '全部项目任务导出.csv')).catch((err) => toast.error(`导出失败：${extractErrorMessage(err)}`))}>
            导出全部任务
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardContent>
            <div className="text-sm text-text-secondary">项目总数</div>
            <div className="mt-2 text-3xl font-bold text-text-primary">{projects.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="text-sm text-text-secondary">任务总数</div>
            <div className="mt-2 text-3xl font-bold text-text-primary">{totalTaskCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <div className="text-sm text-text-secondary">已配置需求简报</div>
            <div className="mt-2 text-3xl font-bold text-text-primary">
              {Object.values(briefMap).filter((brief) => 项目Brief已有效配置(brief)).length}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>新建项目</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Input
            label="项目名称"
            value={form.name}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            placeholder="例如：四月抖音内容代运营"
          />
          <div>
            <label className="mb-1.5 block text-xs text-text-secondary">投放平台</label>
            <select
              value={form.platform}
              onChange={(event) => setForm((prev) => ({ ...prev, platform: event.target.value }))}
              className="w-full rounded-btn border border-border-subtle bg-bg-elevated px-4 py-2.5 text-text-primary"
            >
              <option value="">暂不设置</option>
              {平台选项.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </div>
          <Input
            label="客户名"
            value={form.client_display_name}
            onChange={(event) => setForm((prev) => ({ ...prev, client_display_name: event.target.value }))}
            placeholder="仅用于内部区分和导出"
          />
          <Input
            label="品牌名"
            value={form.brand_display_name}
            onChange={(event) => setForm((prev) => ({ ...prev, brand_display_name: event.target.value }))}
            placeholder="仅用于内部区分和导出"
          />
          <div className="lg:col-span-2">
            <label className="mb-1.5 block text-xs text-text-secondary">项目说明</label>
            <textarea
              value={form.description}
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
              placeholder="补充项目背景、交付方式或注意事项"
              className="min-h-24 w-full rounded-btn border border-border-subtle bg-bg-elevated px-4 py-3 text-sm text-text-primary"
            />
          </div>
          <div className="lg:col-span-2">
            <label className="mb-1.5 block text-xs text-text-secondary">项目备注</label>
            <textarea
              value={form.project_remark}
              onChange={(event) => setForm((prev) => ({ ...prev, project_remark: event.target.value }))}
              placeholder="例如：审核结果直接截图给客户，不走站内通知"
              className="min-h-24 w-full rounded-btn border border-border-subtle bg-bg-elevated px-4 py-3 text-sm text-text-primary"
            />
          </div>
          <div className="lg:col-span-2">
            <Button icon={Plus} onClick={() => void handleCreateProject()} loading={creating}>
              创建项目
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>项目列表</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="text-sm text-text-tertiary">正在加载项目...</div>
          ) : projects.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-subtle p-8 text-center text-sm text-text-tertiary">
              还没有项目，先创建一个项目再继续配置任务。
            </div>
          ) : (
            projects.map((project) => {
              const brief = briefMap[project.id]
              const briefConfigured = 项目Brief已有效配置(brief)
              return (
                <div key={project.id} className="rounded-2xl border border-border-subtle bg-bg-elevated p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold text-text-primary">{project.name}</h3>
                        <span className="rounded-full bg-accent-indigo/10 px-2.5 py-1 text-xs text-accent-indigo">
                          {project.platform ? 平台名称映射[project.platform] || project.platform : '未限定平台'}
                        </span>
                        <span className={`rounded-full px-2.5 py-1 text-xs ${briefConfigured ? 'bg-accent-green/10 text-accent-green' : 'bg-accent-amber/10 text-accent-amber'}`}>
                          {briefConfigured ? 'Brief 已配置' : 'Brief 待配置'}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-4 text-sm text-text-secondary">
                        <span>客户名：{project.client_display_name || '未填写'}</span>
                        <span>品牌名：{project.brand_display_name || project.brand_name || '未填写'}</span>
                        <span>任务数：{project.task_count}</span>
                      </div>
                      {project.description ? <div className="mt-3 text-sm text-text-secondary">{project.description}</div> : null}
                      {project.project_remark ? (
                        <div className="mt-2 text-sm text-text-tertiary">备注：{project.project_remark}</div>
                      ) : null}
                      <div className="mt-3 text-xs text-text-tertiary">更新时间：{格式化时间(project.updated_at)}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/operator/tasks?project_id=${encodeURIComponent(project.id)}`}>
                        <Button variant="secondary" icon={FolderKanban}>配置 Brief / 查看任务</Button>
                      </Link>
                      <Button variant="secondary" icon={Download} onClick={() => void handleExportProject(project.id, project.name)}>
                        导出任务
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </CardContent>
      </Card>
    </div>
  )
}
