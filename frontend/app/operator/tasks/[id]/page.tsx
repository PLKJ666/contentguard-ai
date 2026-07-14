'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  Ban,
  CheckCircle,
  Clock,
  Download,
  FileDown,
  FileText,
  Plus,
  RefreshCw,
  Sparkles,
  Target,
  Upload,
  Video,
  X,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { api, extractErrorMessage } from '@/lib/api'
import {
  buildOperatorBriefAttachments,
  mergeParsedRequirements,
} from '@/lib/operatorBrief'
import type {
  BlacklistWord,
  BriefResponse,
  CreativeRubric,
  SellingPoint,
} from '@/types/brief'
import type { TaskResponse } from '@/types/task'
import { 下载二进制文件, 是否为AI处理中, 平台名称映射, 格式化时间, 获取代运营任务入口, 获取阶段名称 } from '../../_shared'

function 读取总结(result: any): string {
  return result?.conclusions?.overall_summary || result?.summary || '暂无总结'
}

function 读取违规(result: any): Array<{ content?: string; suggestion?: string; severity?: string }> {
  return result?.conclusions?.violations || result?.violations || []
}

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

type Brief编辑态 = {
  product_name: string
  brand_tone: string
  target_audience: string
  content_requirements: string
  selling_points: 可编辑卖点[]
  blacklist_words: 可编辑违禁词[]
  creative_rubric: CreativeRubric | null
  file: File | null
}

const 空Brief编辑态: Brief编辑态 = {
  product_name: '',
  brand_tone: '',
  target_audience: '',
  content_requirements: '',
  selling_points: [],
  blacklist_words: [],
  creative_rubric: null,
  file: null,
}

const 代运营脚本文件接受类型 = '.doc,.docx,.pdf,.txt,.xls,.xlsx'
const 代运营脚本文件说明 = '支持 Word、PDF、TXT、Excel 格式'

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

function Brief转编辑态(brief?: BriefResponse | null): Brief编辑态 {
  if (!brief) return 空Brief编辑态

  const { targetAudience, contentRequirements } = 解析其他要求(brief.other_requirements)

  return {
    product_name: brief.product_name || '',
    brand_tone: brief.brand_tone || '',
    target_audience: targetAudience,
    content_requirements: contentRequirements,
    selling_points: 卖点转编辑态(brief.selling_points),
    blacklist_words: 违禁词转编辑态(brief.blacklist_words),
    creative_rubric: brief.creative_rubric || null,
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

export default function OperatorTaskDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const toast = useToast()
  const taskId = String(params.id || '')
  const videoFileInputRef = useRef<HTMLInputElement | null>(null)

  const [task, setTask] = useState<TaskResponse | null>(null)
  const [brief, setBrief] = useState<BriefResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploadingScript, setUploadingScript] = useState(false)
  const [uploadingVideo, setUploadingVideo] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [briefSaving, setBriefSaving] = useState(false)
  const [briefParsing, setBriefParsing] = useState(false)
  const [scriptText, setScriptText] = useState('')
  const [scriptFile, setScriptFile] = useState<File | null>(null)
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [reviewComment, setReviewComment] = useState('')
  const [correctedScript, setCorrectedScript] = useState('')
  const [briefEditor, setBriefEditor] = useState<Brief编辑态>(空Brief编辑态)
  const [newSellingPoint, setNewSellingPoint] = useState('')
  const [newBlacklistWord, setNewBlacklistWord] = useState('')

  const loadTask = useCallback(async (showLoading = true) => {
    if (!taskId) return
    if (showLoading) setLoading(true)
    try {
      const taskData = await api.getOperatorTask(taskId)
      setTask(taskData)
      setCorrectedScript(taskData.script_agency_corrected || taskData.script_text_content || '')

      try {
        const briefData = await api.getBrief(taskData.project.id)
        setBrief(briefData)
        setBriefEditor(Brief转编辑态(briefData))
      } catch {
        setBrief(null)
        setBriefEditor(空Brief编辑态)
      }
    } catch (err) {
      toast.error(`加载任务失败：${extractErrorMessage(err)}`)
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [taskId, toast])

  useEffect(() => {
    void loadTask()
  }, [loadTask])

  useEffect(() => {
    if (!task || !是否为AI处理中(task.stage)) return
    const timer = window.setInterval(() => {
      void loadTask(false)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [loadTask, task])

  useEffect(() => {
    if (!task) return
    if (task.stage === 'script_agency_review' || task.stage === 'video_agency_review') {
      router.replace(获取代运营任务入口(task.id, task.stage))
    }
  }, [router, task])

  const scriptViolations = useMemo(() => 读取违规(task?.script_ai_result), [task?.script_ai_result])
  const videoViolations = useMemo(() => 读取违规(task?.video_ai_result), [task?.video_ai_result])
  const 显示Brief配置 = false
  const 当前Brief文件名 = briefEditor.file?.name || brief?.agency_attachments?.[0]?.name || brief?.file_name || '尚未上传文件'
  const 当前Brief配置日期 = brief?.updated_at ? brief.updated_at.split('T')[0] : '-'

  const 保存Brief配置 = useCallback(async (args: {
    values: Brief编辑态
    uploadPendingFile: boolean
    requireDocument: boolean
  }) => {
    if (!task) {
      throw new Error('任务不存在')
    }

    const { values, uploadPendingFile, requireDocument } = args

    let fileUrl = brief?.file_url?.trim() || undefined
    let fileName = brief?.file_name?.trim() || undefined

    if (uploadPendingFile && values.file) {
      const uploaded = await api.proxyUpload(values.file, 'document')
      fileUrl = uploaded.url
      fileName = values.file.name
    }

    const agencyAttachments = buildOperatorBriefAttachments({
      fileUrl,
      fileName,
      existingAttachments: brief?.agency_attachments,
    })

    if (requireDocument && (!agencyAttachments || agencyAttachments.length === 0)) {
      throw new Error('请先上传项目 Brief 文件')
    }

    const mergedRequirements = mergeParsedRequirements(
      values.target_audience,
      values.content_requirements,
    ).trim()

    const payload = {
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
      creative_rubric: values.creative_rubric,
      agency_attachments: agencyAttachments || [],
    }

    const saved = brief
      ? await api.updateBrief(task.project.id, payload)
      : await api.createBrief(task.project.id, payload)

    setBrief(saved)
    setBriefEditor(Brief转编辑态(saved))
    return saved
  }, [brief, task])

  const handleSaveBrief = useCallback(async () => {
    setBriefSaving(true)
    try {
      await 保存Brief配置({
        values: briefEditor,
        uploadPendingFile: true,
        requireDocument: false,
      })
      toast.success('项目 Brief 已保存')
    } catch (err) {
      toast.error(`保存 Brief 失败：${err instanceof Error ? err.message : extractErrorMessage(err)}`)
    } finally {
      setBriefSaving(false)
    }
  }, [briefEditor, toast, 保存Brief配置])

  const handleParseBrief = useCallback(async () => {
    if (!task) return

    setBriefParsing(true)
    try {
      const persisted = await 保存Brief配置({
        values: briefEditor,
        uploadPendingFile: true,
        requireDocument: true,
      })

      const parsed = await api.parseBrief(task.project.id)
      const nextValues: Brief编辑态 = {
        ...Brief转编辑态(persisted),
        product_name: parsed.product_name || persisted.product_name || '',
        brand_tone: persisted.brand_tone || '',
        target_audience: parsed.target_audience || '',
        content_requirements: parsed.content_requirements || '',
        selling_points: 卖点转编辑态(parsed.selling_points),
        blacklist_words: 违禁词转编辑态(parsed.blacklist_words),
        creative_rubric: parsed.creative_rubric || persisted.creative_rubric || null,
        file: null,
      }

      await 保存Brief配置({
        values: nextValues,
        uploadPendingFile: false,
        requireDocument: true,
      })
      toast.success('AI 解析完成，Brief 配置已更新')
    } catch (err) {
      toast.error(`AI 解析失败：${err instanceof Error ? err.message : extractErrorMessage(err)}`)
    } finally {
      setBriefParsing(false)
    }
  }, [briefEditor, task, toast, 保存Brief配置])

  const cyclePriority = useCallback((id: string) => {
    setBriefEditor((prev) => ({
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
    setBriefEditor((prev) => ({
      ...prev,
      selling_points: [
        ...prev.selling_points,
        { id: 生成临时ID('sp'), content, priority: 'recommended' },
      ],
    }))
    setNewSellingPoint('')
  }, [newSellingPoint])

  const removeSellingPoint = useCallback((id: string) => {
    setBriefEditor((prev) => ({
      ...prev,
      selling_points: prev.selling_points.filter((item) => item.id !== id),
    }))
  }, [])

  const addBlacklistWord = useCallback(() => {
    const word = newBlacklistWord.trim()
    if (!word) return
    setBriefEditor((prev) => ({
      ...prev,
      blacklist_words: [
        ...prev.blacklist_words,
        { id: 生成临时ID('bw'), word, reason: '项目要求' },
      ],
    }))
    setNewBlacklistWord('')
  }, [newBlacklistWord])

  const removeBlacklistWord = useCallback((id: string) => {
    setBriefEditor((prev) => ({
      ...prev,
      blacklist_words: prev.blacklist_words.filter((item) => item.id !== id),
    }))
  }, [])

  const handleScriptUpload = useCallback(async () => {
    if (!task) return
    if (!scriptFile && !scriptText.trim()) {
      toast.error('请上传脚本文件或直接粘贴脚本文字')
      return
    }

    setUploadingScript(true)
    try {
      if (scriptFile) {
        const uploaded = await api.proxyUpload(scriptFile, 'script')
        const updated = await api.uploadOperatorTaskScript(task.id, {
          file_url: uploaded.url,
          file_name: scriptFile.name,
        })
        setTask(updated)
      } else {
        const updated = await api.uploadOperatorTaskScript(task.id, {
          text_content: scriptText.trim(),
        })
        setTask(updated)
      }
      setScriptFile(null)
      toast.success('脚本已提交，系统开始 AI 审核')
      await loadTask(false)
    } catch (err) {
      toast.error(`上传脚本失败：${extractErrorMessage(err)}`)
    } finally {
      setUploadingScript(false)
    }
  }, [loadTask, scriptFile, scriptText, task, toast])

  const handleVideoUpload = useCallback(async () => {
    if (!task) return
    const selectedVideoFile = videoFileInputRef.current?.files?.[0] || videoFile
    if (!selectedVideoFile) {
      toast.error('请先选择视频文件')
      return
    }

    setUploadingVideo(true)
    try {
      const uploaded = await api.proxyUpload(selectedVideoFile, 'video')
      const updated = await api.uploadOperatorTaskVideo(task.id, {
        file_url: uploaded.url,
        file_name: uploaded.file_name || selectedVideoFile.name,
      })
      setTask(updated)
      setVideoFile(null)
      if (videoFileInputRef.current) {
        videoFileInputRef.current.value = ''
      }
      toast.success('视频已提交，系统开始 AI 审核')
      await loadTask(false)
    } catch (err) {
      toast.error(`上传视频失败：${extractErrorMessage(err)}`)
    } finally {
      setUploadingVideo(false)
    }
  }, [loadTask, task, toast, videoFile])

  const handleReview = useCallback(async (action: 'pass' | 'reject') => {
    if (!task) return
    setReviewing(true)
    try {
      const updated = await api.reviewOperatorTask(task.id, {
        action,
        comment: reviewComment.trim() || undefined,
        corrected_script: correctedScript.trim() || undefined,
      })
      setTask(updated)
      toast.success('处理完成')
      await loadTask(false)
    } catch (err) {
      toast.error(`处理失败：${extractErrorMessage(err)}`)
    } finally {
      setReviewing(false)
    }
  }, [correctedScript, loadTask, reviewComment, task, toast])

  const handleExport = useCallback(async () => {
    if (!task) return
    setExporting(true)
    try {
      const blob = await api.exportTasksCsv({ task_id: task.id })
      下载二进制文件(blob, `${task.name}-导出.csv`)
    } catch (err) {
      toast.error(`导出失败：${extractErrorMessage(err)}`)
    } finally {
      setExporting(false)
    }
  }, [task, toast])

  if (loading || !task) {
    return <div className="text-sm text-text-tertiary">正在加载任务详情...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{task.name}</h1>
          <div className="mt-2 flex flex-wrap gap-4 text-sm text-text-secondary">
            <span>项目：{task.project.name}</span>
            <span>达人：{task.creator.name}</span>
            <span>平台：{task.creator.platform ? 平台名称映射[task.creator.platform] || task.creator.platform : '未填写'}</span>
          </div>
          <div className="mt-2 text-sm text-text-secondary">当前阶段：{获取阶段名称(task.stage)}</div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" icon={RefreshCw} onClick={() => void loadTask()} disabled={loading}>
            刷新
          </Button>
          <Button variant="secondary" icon={Download} onClick={() => void handleExport()} loading={exporting}>
            导出当前任务
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>任务信息</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm text-text-secondary">客户名：{task.project.client_display_name || '未填写'}</div>
            <div className="text-sm text-text-secondary">品牌名：{task.project.brand_display_name || task.project.brand_name || '未填写'}</div>
            <div className="text-sm text-text-secondary">项目备注：{task.project.project_remark || '未填写'}</div>
            <div className="text-sm text-text-secondary">达人备注：{task.creator.remark || '未填写'}</div>
            <div className="text-xs text-text-tertiary">创建时间：{格式化时间(task.created_at)}</div>
            <div className="text-xs text-text-tertiary">更新时间：{格式化时间(task.updated_at)}</div>
          </CardContent>
        </Card>
      </div>

      {显示Brief配置 ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Sparkles size={18} className="text-accent-indigo" />
                  AI 解析结果
                </span>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={Sparkles}
                    onClick={() => void handleParseBrief()}
                    loading={briefParsing}
                    disabled={briefSaving}
                  >
                    {brief ? '重新解析' : '开始解析'}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void handleSaveBrief()}
                    loading={briefSaving}
                    disabled={briefParsing}
                  >
                    保存配置
                  </Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border border-border-subtle bg-bg-elevated p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-xs text-text-tertiary">当前 Brief 文件</p>
                    <p className="mt-1 text-sm font-medium text-text-primary">{当前Brief文件名}</p>
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-btn border border-border-strong/50 bg-bg-page px-3 py-2 text-xs text-text-secondary hover:text-text-primary">
                    <Upload size={14} />
                    上传新文件
                    <input
                      type="file"
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.txt"
                      onChange={(event) => {
                        setBriefEditor((prev) => ({
                          ...prev,
                          file: event.target.files?.[0] || null,
                        }))
                      }}
                      className="hidden"
                    />
                  </label>
                </div>
                {briefEditor.file ? (
                  <p className="mt-2 text-xs text-accent-indigo">待上传：{briefEditor.file.name}</p>
                ) : null}
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-xl bg-bg-elevated p-4">
                  <p className="text-xs text-text-tertiary mb-1">产品名称</p>
                  <input
                    value={briefEditor.product_name}
                    onChange={(event) => setBriefEditor((prev) => ({ ...prev, product_name: event.target.value }))}
                    placeholder="AI 解析后自动回填"
                    className="w-full bg-transparent text-sm font-medium text-text-primary outline-none"
                  />
                </div>
                <div className="rounded-xl bg-bg-elevated p-4">
                  <p className="text-xs text-text-tertiary mb-1">目标人群</p>
                  <input
                    value={briefEditor.target_audience}
                    onChange={(event) => setBriefEditor((prev) => ({ ...prev, target_audience: event.target.value }))}
                    placeholder="例如：6-12 岁小学生及家长"
                    className="w-full bg-transparent text-sm font-medium text-text-primary outline-none"
                  />
                </div>
                <div className="rounded-xl bg-bg-elevated p-4 md:col-span-2">
                  <p className="text-xs text-text-tertiary mb-1">内容要求</p>
                  <textarea
                    value={briefEditor.content_requirements}
                    onChange={(event) => setBriefEditor((prev) => ({ ...prev, content_requirements: event.target.value }))}
                    placeholder="AI 解析或手动补充内容要求"
                    className="min-h-24 w-full resize-none bg-transparent text-sm text-text-primary outline-none"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target size={18} className="text-accent-green" />
                卖点配置
                <span className="ml-2 text-sm font-normal text-text-secondary">
                  {briefEditor.selling_points.length} 个卖点
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {briefEditor.selling_points.map((item) => (
                <div key={item.id} className="flex items-center gap-3 rounded-xl bg-bg-elevated p-3">
                  <button
                    type="button"
                    onClick={() => cyclePriority(item.id)}
                    className={`rounded px-2 py-1 text-xs ${优先级样式(item.priority)}`}
                  >
                    {优先级文案(item.priority)}
                  </button>
                  <input
                    value={item.content}
                    onChange={(event) => {
                      const content = event.target.value
                      setBriefEditor((prev) => ({
                        ...prev,
                        selling_points: prev.selling_points.map((current) =>
                          current.id === item.id ? { ...current, content } : current
                        ),
                      }))
                    }}
                    className="flex-1 bg-transparent text-sm text-text-primary outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => removeSellingPoint(item.id)}
                    className="rounded p-1 hover:bg-bg-page"
                  >
                    <X size={16} className="text-text-tertiary" />
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newSellingPoint}
                  onChange={(event) => setNewSellingPoint(event.target.value)}
                  placeholder="添加新卖点..."
                  onKeyDown={(event) => event.key === 'Enter' && addSellingPoint()}
                  className="flex-1 rounded-btn border border-border-subtle bg-bg-elevated px-3 py-2 text-sm text-text-primary outline-none"
                />
                <Button variant="secondary" onClick={addSellingPoint} icon={Plus}>
                  添加
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Ban size={18} className="text-accent-coral" />
                违禁词配置
                <span className="ml-2 text-sm font-normal text-text-secondary">
                  {briefEditor.blacklist_words.length} 个
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {briefEditor.blacklist_words.map((item) => (
                <div key={item.id} className="flex items-center justify-between rounded-xl border border-accent-coral/30 bg-accent-coral/10 p-3">
                  <div className="min-w-0">
                    <span className="font-medium text-accent-coral">「{item.word}」</span>
                    <span className="ml-2 text-xs text-text-tertiary">{item.reason}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeBlacklistWord(item.id)}
                    className="rounded p-1 hover:bg-accent-coral/20"
                  >
                    <X size={14} className="text-text-tertiary" />
                  </button>
                </div>
              ))}
              <div className="flex gap-2 pt-1">
                <input
                  type="text"
                  value={newBlacklistWord}
                  onChange={(event) => setNewBlacklistWord(event.target.value)}
                  placeholder="添加违禁词..."
                  onKeyDown={(event) => event.key === 'Enter' && addBlacklistWord()}
                  className="flex-1 rounded-btn border border-border-subtle bg-bg-elevated px-3 py-2 text-sm text-text-primary outline-none"
                />
                <Button variant="secondary" size="sm" onClick={addBlacklistWord} icon={Plus} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock size={18} className="text-text-tertiary" />
                配置状态
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-text-secondary">状态</span>
                <span className="rounded-full bg-accent-green/10 px-3 py-1 text-xs text-accent-green">
                  已配置
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-text-secondary">配置时间</span>
                <span className="text-text-primary">{当前Brief配置日期}</span>
              </div>
            </CardContent>
          </Card>

          <div className="rounded-xl border border-accent-green/30 bg-accent-green/10 p-4">
            <div className="flex items-start gap-3">
              <CheckCircle size={20} className="mt-0.5 shrink-0 text-accent-green" />
              <div>
                <p className="text-sm font-medium text-accent-green">配置说明</p>
                <ul className="mt-1 space-y-1 text-xs text-accent-green/80">
                  <li>• 核心卖点建议优先在内容中体现</li>
                  <li>• 推荐卖点建议提及</li>
                  <li>• 违禁词会触发 AI 审核警告</li>
                  <li>• 此配置将展示给达人查看</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>当前处理内容</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-text-secondary">
            <div>这里按当前阶段直接处理任务，不再展示 Brief、卖点要求或违禁词配置。</div>
            <div>收到脚本就上传脚本，收到视频就上传视频；进入审核阶段会自动跳到对应工作台。</div>
          </CardContent>
        </Card>
      )}

      {(task.stage === 'script_upload' || task.stage === 'rejected') && (
        <Card>
          <CardHeader>
            <CardTitle>上传脚本</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs text-text-secondary">直接粘贴脚本文字</label>
              <textarea
                value={scriptText}
                onChange={(event) => setScriptText(event.target.value)}
                placeholder="可直接粘贴脚本文案；如果上传文件，这里可以留空。"
                className="min-h-40 w-full rounded-btn border border-border-subtle bg-bg-elevated px-4 py-3 text-sm text-text-primary"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs text-text-secondary">或上传脚本文件</label>
              <input
                type="file"
                accept={代运营脚本文件接受类型}
                onChange={(event) => setScriptFile(event.target.files?.[0] || null)}
                className="block w-full text-sm text-text-secondary file:mr-4 file:rounded-xl file:border-0 file:bg-accent-indigo/15 file:px-4 file:py-2 file:text-sm file:font-medium file:text-accent-indigo"
              />
              <p className="mt-2 text-xs text-text-tertiary">{代运营脚本文件说明}</p>
            </div>
            <Button icon={Upload} onClick={() => void handleScriptUpload()} loading={uploadingScript}>
              提交脚本
            </Button>
          </CardContent>
        </Card>
      )}

      {是否为AI处理中(task.stage) && (
        <Card>
          <CardHeader>
            <CardTitle>AI 审核处理中</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="text-sm text-text-secondary">系统正在执行 AI 审核，页面会自动刷新最新状态。</div>
            <div className="text-xs text-text-tertiary">当前阶段：{获取阶段名称(task.stage)}</div>
          </CardContent>
        </Card>
      )}

      {task.stage === 'script_agency_review' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-3">
              <span>脚本审核</span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => router.push(`/operator/review/script/${encodeURIComponent(task.id)}`)}
              >
                进入完整审核台
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl bg-bg-elevated p-4">
              <div className="text-sm text-text-secondary">AI 评分</div>
              <div className="mt-1 text-3xl font-bold text-text-primary">{task.script_ai_score ?? '--'}</div>
              <div className="mt-2 text-sm text-text-secondary">{读取总结(task.script_ai_result)}</div>
            </div>
            {task.script_text_content ? (
              <div>
                <div className="mb-1.5 text-xs text-text-secondary">原始脚本</div>
                <textarea
                  value={task.script_text_content}
                  readOnly
                  className="min-h-32 w-full rounded-btn border border-border-subtle bg-bg-elevated px-4 py-3 text-sm text-text-primary"
                />
              </div>
            ) : null}
            {scriptViolations.length > 0 ? (
              <div className="space-y-2">
                <div className="text-xs text-text-secondary">主要问题</div>
                {scriptViolations.slice(0, 8).map((item, index) => (
                  <div key={`${item.content}-${index}`} className="rounded-xl border border-border-subtle bg-bg-elevated p-3 text-sm">
                    <div className="font-medium text-text-primary">{item.content || '未命名问题'}</div>
                    <div className="mt-1 text-text-secondary">{item.suggestion || '请根据审核意见调整'}</div>
                  </div>
                ))}
              </div>
            ) : null}
            <div>
              <div className="mb-1.5 text-xs text-text-secondary">修订脚本</div>
              <textarea
                value={correctedScript}
                onChange={(event) => setCorrectedScript(event.target.value)}
                placeholder="如果需要，可直接在这里整理修订后的脚本。"
                className="min-h-40 w-full rounded-btn border border-border-subtle bg-bg-elevated px-4 py-3 text-sm text-text-primary"
              />
            </div>
            <div>
              <div className="mb-1.5 text-xs text-text-secondary">处理说明</div>
              <textarea
                value={reviewComment}
                onChange={(event) => setReviewComment(event.target.value)}
                placeholder="填写这次审核的处理说明"
                className="min-h-24 w-full rounded-btn border border-border-subtle bg-bg-elevated px-4 py-3 text-sm text-text-primary"
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <Button variant="success" onClick={() => void handleReview('pass')} loading={reviewing}>
                通过并进入视频阶段
              </Button>
              <Button variant="danger" onClick={() => void handleReview('reject')} loading={reviewing}>
                打回脚本
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {task.stage === 'video_upload' && (
        <Card>
          <CardHeader>
            <CardTitle>上传视频</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {task.script_agency_corrected || task.script_text_content ? (
              <div className="rounded-xl bg-bg-elevated p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-text-primary">
                  <FileText size={16} />
                  当前脚本
                </div>
                <div className="whitespace-pre-wrap text-sm text-text-secondary">
                  {task.script_agency_corrected || task.script_text_content}
                </div>
              </div>
            ) : null}
            <div>
              <label className="mb-1.5 block text-xs text-text-secondary">选择视频文件</label>
              <input
                ref={videoFileInputRef}
                type="file"
                accept="video/*"
                onChange={(event) => setVideoFile(event.target.files?.[0] || null)}
                className="block w-full text-sm text-text-secondary file:mr-4 file:rounded-xl file:border-0 file:bg-accent-indigo/15 file:px-4 file:py-2 file:text-sm file:font-medium file:text-accent-indigo"
              />
            </div>
            <Button icon={Video} onClick={() => void handleVideoUpload()} loading={uploadingVideo}>
              提交视频
            </Button>
          </CardContent>
        </Card>
      )}

      {task.stage === 'video_agency_review' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-3">
              <span>视频审核</span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => router.push(`/operator/review/video/${encodeURIComponent(task.id)}`)}
              >
                进入完整审核台
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl bg-bg-elevated p-4">
              <div className="text-sm text-text-secondary">AI 评分</div>
              <div className="mt-1 text-3xl font-bold text-text-primary">{task.video_ai_score ?? '--'}</div>
              <div className="mt-2 text-sm text-text-secondary">{读取总结(task.video_ai_result)}</div>
            </div>
            {task.video_file_url ? (
              <div className="flex flex-wrap gap-3">
                <Button variant="secondary" icon={FileDown} onClick={() => void api.downloadFile(task.video_file_url!, task.video_file_name || `${task.name}.mp4`)}>
                  下载原视频
                </Button>
              </div>
            ) : null}
            {videoViolations.length > 0 ? (
              <div className="space-y-2">
                <div className="text-xs text-text-secondary">主要问题</div>
                {videoViolations.slice(0, 8).map((item, index) => (
                  <div key={`${item.content}-${index}`} className="rounded-xl border border-border-subtle bg-bg-elevated p-3 text-sm">
                    <div className="font-medium text-text-primary">{item.content || '未命名问题'}</div>
                    <div className="mt-1 text-text-secondary">{item.suggestion || '请根据审核意见调整'}</div>
                  </div>
                ))}
              </div>
            ) : null}
            <div>
              <div className="mb-1.5 text-xs text-text-secondary">处理说明</div>
              <textarea
                value={reviewComment}
                onChange={(event) => setReviewComment(event.target.value)}
                placeholder="填写这次视频审核的处理说明"
                className="min-h-24 w-full rounded-btn border border-border-subtle bg-bg-elevated px-4 py-3 text-sm text-text-primary"
              />
            </div>
            <div className="flex flex-wrap gap-3">
              <Button variant="success" onClick={() => void handleReview('pass')} loading={reviewing}>
                通过并完成任务
              </Button>
              <Button variant="danger" onClick={() => void handleReview('reject')} loading={reviewing}>
                打回视频
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {(task.stage === 'completed' || task.stage === 'rejected') && (
        <Card>
          <CardHeader>
            <CardTitle>{task.stage === 'completed' ? '任务已完成' : '任务已驳回'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm text-text-secondary">
              {task.stage === 'completed'
                ? '当前任务已完成，您可以直接导出结果，或把截图、文件发给达人或客户。'
                : '当前任务已被打回，可重新上传脚本或视频继续处理。'}
            </div>
            <div className="flex flex-wrap gap-3">
              <Button variant="secondary" icon={Download} onClick={() => void handleExport()} loading={exporting}>
                导出当前任务
              </Button>
              {task.script_file_url ? (
                <Button variant="secondary" icon={FileDown} onClick={() => void api.downloadFile(task.script_file_url!, task.script_file_name || `${task.name}-脚本`)}>
                  下载脚本文件
                </Button>
              ) : null}
              {task.video_file_url ? (
                <Button variant="secondary" icon={FileDown} onClick={() => void api.downloadFile(task.video_file_url!, task.video_file_name || `${task.name}.mp4`)}>
                  下载视频文件
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
