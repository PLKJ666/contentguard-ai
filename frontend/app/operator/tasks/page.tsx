'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  Ban,
  CheckCircle,
  Clock,
  Download,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Target,
  Upload,
  X,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { api, extractErrorMessage } from '@/lib/api'
import {
  buildOperatorBriefAttachments,
  mergeParsedRequirements,
} from '@/lib/operatorBrief'
import type {
  BlacklistWord,
  BriefCreateRequest,
  BriefResponse,
  CreativeRubric,
  SellingPoint,
} from '@/types/brief'
import type { ProjectResponse } from '@/types/project'
import type { TaskResponse } from '@/types/task'
import { 下载二进制文件, 平台名称映射, 平台选项, 格式化时间, 获取代运营任务入口, 获取阶段名称 } from '../_shared'

type 卖点优先级 = 'core' | 'recommended' | 'reference'

type 可编辑卖点 = {
  id: string
  content: string
  priority: 卖点优先级
}

type 可编辑违禁词 = {
  id: string
  word: string
  reason: string
}

interface BriefFormState {
  product_name: string
  brand_tone: string
  target_audience: string
  content_requirements: string
  selling_points: 可编辑卖点[]
  blacklist_words: 可编辑违禁词[]
  creative_rubric: CreativeRubric | null
  min_selling_points: number | null
  file: File | null
}

const 空Brief表单: BriefFormState = {
  product_name: '',
  brand_tone: '',
  target_audience: '',
  content_requirements: '',
  selling_points: [],
  blacklist_words: [],
  creative_rubric: null,
  min_selling_points: null,
  file: null,
}

function 生成临时ID(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

function 解析其他要求(value?: string | null): { targetAudience: string; contentRequirements: string } {
  const text = value?.trim() || ''
  if (!text) {
    return { targetAudience: '', contentRequirements: '' }
  }

  let targetAudience = ''
  const contentLines: string[] = []

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith('目标人群：')) {
      targetAudience = line.replace(/^目标人群：/, '').trim()
      continue
    }
    if (line.startsWith('内容要求：')) {
      contentLines.push(line.replace(/^内容要求：/, '').trim())
      continue
    }
    contentLines.push(line)
  }

  return {
    targetAudience,
    contentRequirements: contentLines.filter(Boolean).join('\n'),
  }
}

function 卖点转编辑态(points?: SellingPoint[] | null): 可编辑卖点[] {
  return (points || [])
    .map((item, index) => {
      const content = item.content?.trim()
      if (!content) return null
      const priority = item.priority || (item.required ? 'core' : 'recommended')
      const normalizedPriority: 卖点优先级 =
        priority === 'core' || priority === 'recommended' || priority === 'reference'
          ? priority
          : 'recommended'
      return {
        id: `sp-${index}-${content}`,
        content,
        priority: normalizedPriority,
      }
    })
    .filter((item): item is 可编辑卖点 => Boolean(item))
}

function 违禁词转编辑态(words?: BlacklistWord[] | null): 可编辑违禁词[] {
  return (words || [])
    .map((item, index) => {
      const word = item.word?.trim()
      if (!word) return null
      return {
        id: `bw-${index}-${word}`,
        word,
        reason: item.reason?.trim() || '项目要求',
      }
    })
    .filter((item): item is 可编辑违禁词 => Boolean(item))
}

function brief转表单(brief?: BriefResponse | null): BriefFormState {
  if (!brief) {
    return 空Brief表单
  }

  const { targetAudience, contentRequirements } = 解析其他要求(brief.other_requirements)

  return {
    product_name: brief.product_name || '',
    brand_tone: brief.brand_tone || '',
    target_audience: targetAudience,
    content_requirements: contentRequirements,
    selling_points: 卖点转编辑态(brief.selling_points),
    blacklist_words: 违禁词转编辑态(brief.blacklist_words),
    creative_rubric: brief.creative_rubric || null,
    min_selling_points: brief.min_selling_points ?? null,
    file: null,
  }
}

function 优先级样式(priority: 卖点优先级): string {
  if (priority === 'core') return 'bg-accent-coral/20 text-accent-coral'
  if (priority === 'recommended') return 'bg-accent-amber/20 text-accent-amber'
  return 'bg-bg-page text-text-tertiary'
}

function 优先级文案(priority: 卖点优先级): string {
  if (priority === 'core') return '核心'
  if (priority === 'recommended') return '推荐'
  return '参考'
}

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

export default function OperatorTasksPage() {
  const toast = useToast()
  const searchParams = useSearchParams()
  const queryProjectId = searchParams.get('project_id') || ''

  const [projects, setProjects] = useState<ProjectResponse[]>([])
  const [tasks, setTasks] = useState<TaskResponse[]>([])
  const [briefMap, setBriefMap] = useState<Record<string, BriefResponse | null>>({})
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [briefSaving, setBriefSaving] = useState(false)
  const [briefParsing, setBriefParsing] = useState(false)
  const [form, setForm] = useState({
    project_id: queryProjectId,
    name: '',
    creator_display_name: '',
    creator_platform: '',
    creator_remark: '',
  })
  const [briefForm, setBriefForm] = useState<BriefFormState>(空Brief表单)
  const [newSellingPoint, setNewSellingPoint] = useState('')
  const [newBlacklistWord, setNewBlacklistWord] = useState('')

  useEffect(() => {
    setForm((prev) => ({ ...prev, project_id: queryProjectId || prev.project_id }))
  }, [queryProjectId])

  const selectedProject = useMemo(
    () => projects.find((item) => item.id === form.project_id) || null,
    [form.project_id, projects]
  )

  const selectedProjectBrief = useMemo(
    () => (form.project_id ? briefMap[form.project_id] ?? null : null),
    [briefMap, form.project_id]
  )

  useEffect(() => {
    if (!form.project_id) {
      setBriefForm(空Brief表单)
      return
    }
    setBriefForm(brief转表单(selectedProjectBrief))
  }, [form.project_id, selectedProjectBrief])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [projectRes, taskRes] = await Promise.all([
        api.listOperatorProjects(),
        api.listOperatorTasks(),
      ])

      setProjects(projectRes.items)
      setTasks(taskRes.items)

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
      toast.error(`加载任务失败：${extractErrorMessage(err)}`)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const filteredTasks = useMemo(() => {
    if (!form.project_id) return tasks
    return tasks.filter((item) => item.project.id === form.project_id)
  }, [form.project_id, tasks])

  const 当前Brief文件名 =
    briefForm.file?.name
    || selectedProjectBrief?.agency_attachments?.[0]?.name
    || selectedProjectBrief?.file_name
    || '尚未上传文件'

  const 当前Brief配置日期 = selectedProjectBrief?.updated_at
    ? selectedProjectBrief.updated_at.split('T')[0]
    : '-'

  const 已配置Brief = 项目Brief已有效配置(selectedProjectBrief)

  const 保存项目Brief = useCallback(async (args: {
    projectId: string
    values: BriefFormState
    existingBrief: BriefResponse | null
    uploadPendingFile: boolean
    requireDocument: boolean
  }) => {
    const { projectId, values, existingBrief, uploadPendingFile, requireDocument } = args

    let fileUrl = existingBrief?.file_url?.trim() || undefined
    let fileName = existingBrief?.file_name?.trim() || undefined

    if (uploadPendingFile && values.file) {
      const uploaded = await api.proxyUpload(values.file, 'document')
      fileUrl = uploaded.url
      fileName = values.file.name
    }

    const agencyAttachments = buildOperatorBriefAttachments({
      fileUrl,
      fileName,
      existingAttachments: existingBrief?.agency_attachments,
    })

    if (requireDocument && (!agencyAttachments || agencyAttachments.length === 0)) {
      throw new Error('请先上传项目 Brief 文件')
    }

    const mergedRequirements = mergeParsedRequirements(
      values.target_audience,
      values.content_requirements,
    ).trim()

    const payload: BriefCreateRequest = {
      file_url: fileUrl || null,
      file_name: fileName || null,
      product_name: values.product_name.trim() || null,
      brand_tone: values.brand_tone.trim() || null,
      other_requirements: mergedRequirements || null,
      selling_points: values.selling_points.reduce<SellingPoint[]>((items, item) => {
        const content = item.content.trim()
        if (!content) return items
        items.push({ content, priority: item.priority })
        return items
      }, []),
      blacklist_words: values.blacklist_words.reduce<BlacklistWord[]>((items, item) => {
        const word = item.word.trim()
        if (!word) return items
        items.push({ word, reason: item.reason.trim() || '项目要求' })
        return items
      }, []),
      min_selling_points: values.min_selling_points,
      creative_rubric: values.creative_rubric,
      agency_attachments: agencyAttachments || [],
    }

    const saved = existingBrief
      ? await api.updateBrief(projectId, payload)
      : await api.createBrief(projectId, payload)

    setBriefMap((prev) => ({ ...prev, [projectId]: saved }))
    return saved
  }, [])

  const handleSaveBrief = useCallback(async () => {
    if (!form.project_id) {
      toast.error('请先选择项目')
      return
    }

    setBriefSaving(true)
    try {
      const saved = await 保存项目Brief({
        projectId: form.project_id,
        values: briefForm,
        existingBrief: selectedProjectBrief,
        uploadPendingFile: true,
        requireDocument: false,
      })
      setBriefForm(brief转表单(saved))
      toast.success('项目 Brief 已保存')
    } catch (err) {
      toast.error(`保存失败：${err instanceof Error ? err.message : extractErrorMessage(err)}`)
    } finally {
      setBriefSaving(false)
    }
  }, [briefForm, form.project_id, selectedProjectBrief, toast, 保存项目Brief])

  const handleParseBrief = useCallback(async () => {
    if (!form.project_id) {
      toast.error('请先选择项目')
      return
    }

    setBriefParsing(true)
    try {
      const persisted = await 保存项目Brief({
        projectId: form.project_id,
        values: briefForm,
        existingBrief: selectedProjectBrief,
        uploadPendingFile: true,
        requireDocument: true,
      })

      const parsed = await api.parseBrief(form.project_id)
      const nextValues: BriefFormState = {
        ...brief转表单(persisted),
        product_name: parsed.product_name || persisted.product_name || '',
        brand_tone: persisted.brand_tone || '',
        target_audience: parsed.target_audience || '',
        content_requirements: parsed.content_requirements || '',
        selling_points: 卖点转编辑态(parsed.selling_points),
        blacklist_words: 违禁词转编辑态(parsed.blacklist_words),
        creative_rubric: parsed.creative_rubric || persisted.creative_rubric || null,
        min_selling_points: persisted.min_selling_points ?? null,
        file: null,
      }

      const saved = await 保存项目Brief({
        projectId: form.project_id,
        values: nextValues,
        existingBrief: persisted,
        uploadPendingFile: false,
        requireDocument: true,
      })

      setBriefForm(brief转表单(saved))
      toast.success('AI 解析完成，项目 Brief 已更新')
    } catch (err) {
      toast.error(`AI 解析失败：${err instanceof Error ? err.message : extractErrorMessage(err)}`)
    } finally {
      setBriefParsing(false)
    }
  }, [briefForm, form.project_id, selectedProjectBrief, toast, 保存项目Brief])

  const cyclePriority = useCallback((id: string) => {
    setBriefForm((prev) => ({
      ...prev,
      selling_points: prev.selling_points.map((item) => {
        if (item.id !== id) return item
        const nextPriority: 卖点优先级 =
          item.priority === 'core'
            ? 'recommended'
            : item.priority === 'recommended'
              ? 'reference'
              : 'core'
        return { ...item, priority: nextPriority }
      }),
    }))
  }, [])

  const addSellingPoint = useCallback(() => {
    const content = newSellingPoint.trim()
    if (!content) return
    setBriefForm((prev) => ({
      ...prev,
      selling_points: [
        ...prev.selling_points,
        { id: 生成临时ID('sp'), content, priority: 'recommended' },
      ],
    }))
    setNewSellingPoint('')
  }, [newSellingPoint])

  const removeSellingPoint = useCallback((id: string) => {
    setBriefForm((prev) => ({
      ...prev,
      selling_points: prev.selling_points.filter((item) => item.id !== id),
    }))
  }, [])

  const addBlacklistWord = useCallback(() => {
    const word = newBlacklistWord.trim()
    if (!word) return
    setBriefForm((prev) => ({
      ...prev,
      blacklist_words: [
        ...prev.blacklist_words,
        { id: 生成临时ID('bw'), word, reason: '项目要求' },
      ],
    }))
    setNewBlacklistWord('')
  }, [newBlacklistWord])

  const removeBlacklistWord = useCallback((id: string) => {
    setBriefForm((prev) => ({
      ...prev,
      blacklist_words: prev.blacklist_words.filter((item) => item.id !== id),
    }))
  }, [])

  const handleCreateTask = useCallback(async () => {
    if (!form.project_id) {
      toast.error('请先选择项目')
      return
    }
    if (!已配置Brief) {
      toast.error('请先上传并保存有效的项目 Brief')
      return
    }
    if (!form.creator_display_name.trim()) {
      toast.error('请先填写达人名')
      return
    }

    setCreating(true)
    try {
      await api.createOperatorTask({
        project_id: form.project_id,
        name: form.name.trim() || undefined,
        creator_display_name: form.creator_display_name.trim(),
        creator_platform: form.creator_platform || undefined,
        creator_remark: form.creator_remark.trim() || undefined,
      })
      toast.success('任务已创建')
      setForm((prev) => ({
        ...prev,
        name: '',
        creator_display_name: '',
        creator_platform: '',
        creator_remark: '',
      }))
      await loadData()
    } catch (err) {
      toast.error(`创建失败：${extractErrorMessage(err)}`)
    } finally {
      setCreating(false)
    }
  }, [form, loadData, toast, 已配置Brief])

  const handleExport = useCallback(async () => {
    try {
      const blob = await api.exportTasksCsv({
        project_id: form.project_id || undefined,
      })
      const fileName = form.project_id
        ? `${projects.find((item) => item.id === form.project_id)?.name || '当前项目'}-任务导出.csv`
        : '全部任务导出.csv'
      下载二进制文件(blob, fileName)
    } catch (err) {
      toast.error(`导出失败：${extractErrorMessage(err)}`)
    }
  }, [form.project_id, projects, toast])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">任务管理</h1>
          <p className="mt-1 text-sm text-text-secondary">这里直接查看任务。项目 Brief 统一在项目管理里维护，需要补充时再过去处理。</p>
        </div>
        <div className="flex flex-col gap-3 lg:items-end">
          <div className="flex w-full flex-col gap-3 sm:flex-row lg:w-auto">
            <div className="min-w-[220px]">
              <label className="mb-1.5 block text-xs text-text-secondary">项目筛选</label>
              <select
                value={form.project_id}
                onChange={(event) => setForm((prev) => ({ ...prev, project_id: event.target.value }))}
                className="w-full rounded-btn border border-border-subtle bg-bg-elevated px-4 py-2.5 text-text-primary"
              >
                <option value="">全部项目</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href={form.project_id ? `/operator/projects?project_id=${form.project_id}` : '/operator/projects'}>
                <Button variant="secondary">
                  去项目管理
                </Button>
              </Link>
              <Button variant="secondary" icon={RefreshCw} onClick={() => void loadData()} disabled={loading}>
                刷新
              </Button>
              <Button variant="secondary" icon={Download} onClick={() => void handleExport()}>
                导出当前列表
              </Button>
            </div>
          </div>
          {selectedProject ? (
            <div className="text-xs text-text-tertiary">
              当前项目：{selectedProject.name}
              {' · '}
              {已配置Brief ? 'Brief 已配置' : 'Brief 待配置'}
              {' · '}
              平台：{selectedProject.platform ? 平台名称映射[selectedProject.platform] || selectedProject.platform : '未限定'}
              {selectedProjectBrief?.updated_at ? ` · 最近更新：${当前Brief配置日期}` : ''}
            </div>
          ) : (
            <div className="text-xs text-text-tertiary">
              当前展示全部任务；创建任务前选择具体项目即可。
            </div>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>任务列表</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="text-sm text-text-tertiary">正在加载任务...</div>
          ) : filteredTasks.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-subtle p-8 text-center text-sm text-text-tertiary">
              当前条件下没有任务。
            </div>
          ) : (
            filteredTasks.map((task) => (
              <Link
                key={task.id}
                href={获取代运营任务入口(task.id, task.stage)}
                className="block rounded-2xl border border-border-subtle bg-bg-elevated p-5 transition-colors hover:border-accent-indigo/40"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-semibold text-text-primary">{task.name}</h3>
                      <span className="rounded-full bg-accent-indigo/10 px-2.5 py-1 text-xs text-accent-indigo">
                        {获取阶段名称(task.stage)}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-4 text-sm text-text-secondary">
                      <span>项目：{task.project.name}</span>
                      <span>达人：{task.creator.name}</span>
                      <span>平台：{task.creator.platform ? 平台名称映射[task.creator.platform] || task.creator.platform : '未填写'}</span>
                    </div>
                    {task.creator.remark ? (
                      <div className="mt-2 text-sm text-text-tertiary">备注：{task.creator.remark}</div>
                    ) : null}
                    <div className="mt-3 text-xs text-text-tertiary">
                      更新时间：{格式化时间(task.updated_at)}
                    </div>
                  </div>
                  <div className="text-xs text-text-tertiary">
                    序号：第 {task.sequence} 个
                  </div>
                </div>
              </Link>
            ))
          )}
        </CardContent>
      </Card>

      {selectedProject ? (
        <>
          {!已配置Brief ? (
            <div className="rounded-xl border border-accent-amber/30 bg-accent-amber/10 p-4 text-sm text-accent-amber">
              当前项目还没有有效 Brief。请先去项目管理页补全 Brief，再回来创建任务。
            </div>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>1. 新建任务</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="lg:col-span-2 rounded-xl border border-border-subtle bg-bg-elevated p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-text-primary">当前项目：{selectedProject.name}</span>
                  <span className={`rounded-full px-2.5 py-1 text-xs ${已配置Brief ? 'bg-accent-green/10 text-accent-green' : 'bg-accent-amber/10 text-accent-amber'}`}>
                    {已配置Brief ? '可创建任务' : '请先上传并保存有效 Brief'}
                  </span>
                </div>
              </div>

              <Input
                label="任务名"
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="可不填，系统会自动生成"
              />
              <Input
                label="达人名"
                value={form.creator_display_name}
                onChange={(event) => setForm((prev) => ({ ...prev, creator_display_name: event.target.value }))}
                placeholder="仅用于内部区分和导出"
              />
              <div>
                <label className="mb-1.5 block text-xs text-text-secondary">平台</label>
                <select
                  value={form.creator_platform}
                  onChange={(event) => setForm((prev) => ({ ...prev, creator_platform: event.target.value }))}
                  className="w-full rounded-btn border border-border-subtle bg-bg-elevated px-4 py-2.5 text-text-primary"
                >
                  <option value="">暂不设置</option>
                  {平台选项.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </div>
              <div className="lg:col-span-2">
                <label className="mb-1.5 block text-xs text-text-secondary">任务备注</label>
                <textarea
                  value={form.creator_remark}
                  onChange={(event) => setForm((prev) => ({ ...prev, creator_remark: event.target.value }))}
                  placeholder="例如：这个名字仅用于自己区分，不创建实际达人账号"
                  className="min-h-24 w-full rounded-btn border border-border-subtle bg-bg-elevated px-4 py-3 text-sm text-text-primary"
                />
              </div>
              <div className="lg:col-span-2">
                <Button
                  icon={Plus}
                  onClick={() => void handleCreateTask()}
                  loading={creating}
                  disabled={!已配置Brief}
                >
                  创建任务
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardContent className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-medium text-text-primary">新建任务前先选项目</div>
              <div className="mt-1 text-sm text-text-tertiary">项目 Brief 在项目管理里维护；选中项目后这里再展开可填写表单。</div>
            </div>
            <Link href="/operator/projects">
              <Button variant="secondary">去项目管理</Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
