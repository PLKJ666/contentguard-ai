'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Bot,
  Boxes,
  ClipboardList,
  FileText,
  FlaskConical,
  Hash,
  Layers3,
  Link2,
  Loader2,
  RefreshCw,
  Settings2,
  Sparkles,
  UploadCloud,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { XHSCategorySelectField } from '@/components/xhs/CategorySelectField'
import { ErrorTag, PendingTag, SuccessTag, WarningTag } from '@/components/ui/Tag'
import { api, extractErrorMessage } from '@/lib/api'
import { getXHSBatchDisplayMetrics } from '@/lib/xhsBatchMetrics'
import { getXHSCategoryLabel } from '@/lib/xhsCategories'
import type {
  XHSBatchCreateRequest,
  XHSBatchEstimateResponse,
  XHSBatchJob,
  XHSBatchStatus,
  XHSBrandPack,
  XHSBriefPack,
  XHSDirection,
  XHSDirectionStatus,
  XHSInputType,
  XHSProject,
  XHSProjectBriefParseResult,
  XHSProjectVariant,
  XHSRiskPack,
  XHSRulePack,
  XHSVariantBriefParseResult,
} from '@/types/xhs'

const batchStatusLabels: Record<XHSBatchStatus, string> = {
  pending: '待开始',
  splitting: '切分中',
  queued: '排队中',
  running: '运行中',
  awaiting_decision: '待决策',
  needs_decision: '待决策',
  partially_done: '部分完成',
  done: '已完成',
  exporting: '导出中',
  exported: '已导出',
  completed: '已完成',
  failed: '失败',
  blocked: '已阻断',
  cancelled: '已取消',
}

const directionStatusLabels: Record<XHSDirectionStatus, string> = {
  draft: '草稿',
  active: '启用中',
  archived: '已归档',
}

const runModeLabels: Record<'trial' | 'full', string> = {
  trial: '试跑',
  full: '全量',
}

const inputTypeLabels: Record<XHSInputType, string> = {
  text: '粘贴文本',
  file: '文档文件',
  feishu_link: '飞书链接',
}

const inputTypeOptions: Array<{ value: XHSInputType; label: string; hint: string }> = [
  { value: 'text', label: '粘贴文本', hint: '直接粘贴多篇草稿，适合先试跑。' },
  { value: 'file', label: '文档文件', hint: '上传文档后自动回填文件引用。' },
  { value: 'feishu_link', label: '飞书链接', hint: '把飞书文档链接直接交给系统切分。' },
]

type WorkspaceTab = 'overview' | 'variants' | 'directions' | 'batches'

const workspaceTabs: Array<{ id: WorkspaceTab; label: string; hint: string }> = [
  { id: 'overview', label: '项目总览', hint: '看整项目摘要、共用要求和 AI 提炼重点。' },
  { id: 'variants', label: '产品版本', hint: '拆金标、银标等版本，并补充各自卖点。' },
  { id: 'directions', label: '方向单', hint: '把不同宣传方向、口吻和限制拆开管理。' },
  { id: 'batches', label: '发起批次', hint: '挂方向单、选配置、估算成本并运行。' },
]

const initialBatchForm: XHSBatchCreateRequest = {
  category_id: 'beauty',
  run_mode: 'trial',
  trial_sample_count: 3,
  input_type: 'text',
  input_text: '',
  tag_policy: { max_count: 8 },
  export_options: { all_md: true },
}

const initialProjectForm = {
  name: '',
  category_id: 'beauty',
  client_name: '',
  product_name: '',
  brief_file_ref: '',
  brief_file_name: '',
  brief_parse_result: undefined as XHSProjectBriefParseResult | undefined,
  project_brief: '',
  shared_requirements: '',
  remark: '',
}

const initialVariantForm = {
  name: '',
  selling_points: '',
  appearance_notes: '',
  notes: '',
  is_primary: false,
  brief_file_ref: '',
  brief_file_name: '',
  brief_text: '',
  brief_parse_result: undefined as XHSVariantBriefParseResult | undefined,
}

const initialDirectionForm = {
  name: '',
  status: 'active' as XHSDirectionStatus,
  main_variant_id: '',
  secondary_variant_ids: [] as string[],
  content_style: '',
  direction_brief: '',
  extra_requirements: '',
  notes: '',
}

function batchStatusTag(status: XHSBatchStatus) {
  if (['completed', 'done', 'exported'].includes(status)) return <SuccessTag size="sm">{batchStatusLabels[status]}</SuccessTag>
  if (['failed', 'blocked', 'cancelled'].includes(status)) return <ErrorTag size="sm">{batchStatusLabels[status]}</ErrorTag>
  if (['queued', 'running', 'exporting', 'splitting', 'partially_done', 'awaiting_decision', 'needs_decision'].includes(status)) {
    return <WarningTag size="sm">{batchStatusLabels[status]}</WarningTag>
  }
  return <PendingTag size="sm">{batchStatusLabels[status]}</PendingTag>
}

function displayBatchStatus(batch: XHSBatchJob): XHSBatchStatus {
  if (batch.decision_items > 0 && ['partially_done', 'done', 'completed'].includes(batch.status)) {
    return 'awaiting_decision'
  }
  return batch.status
}

function directionStatusTag(status: XHSDirectionStatus) {
  if (status === 'active') return <SuccessTag size="sm">{directionStatusLabels[status]}</SuccessTag>
  if (status === 'archived') return <WarningTag size="sm">{directionStatusLabels[status]}</WarningTag>
  return <PendingTag size="sm">{directionStatusLabels[status]}</PendingTag>
}

function formatDateTime(value: string) {
  return new Date(value)
    .toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
    .replace(/\//g, '-')
}

export default function AgencyXHSPage() {
  const pathname = usePathname() || ''
  const scopeRoot = pathname.startsWith('/operator') ? '/operator' : '/agency'
  const xhsBasePath = `${scopeRoot}/xhs`
  const xhsConfigPath = `${xhsBasePath}/config`
  const aiConfigPath = `${scopeRoot}/ai-config`
  const [projects, setProjects] = useState<XHSProject[]>([])
  const [variants, setVariants] = useState<XHSProjectVariant[]>([])
  const [directions, setDirections] = useState<XHSDirection[]>([])
  const [batches, setBatches] = useState<XHSBatchJob[]>([])
  const [rulePacks, setRulePacks] = useState<XHSRulePack[]>([])
  const [brandPacks, setBrandPacks] = useState<XHSBrandPack[]>([])
  const [briefPacks, setBriefPacks] = useState<XHSBriefPack[]>([])
  const [riskPacks, setRiskPacks] = useState<XHSRiskPack[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [selectedDirectionId, setSelectedDirectionId] = useState<string | null>(null)
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<WorkspaceTab>('overview')
  const [projectComposerOpen, setProjectComposerOpen] = useState(false)
  const [projectForm, setProjectForm] = useState(initialProjectForm)
  const [variantForm, setVariantForm] = useState(initialVariantForm)
  const [directionForm, setDirectionForm] = useState(initialDirectionForm)
  const [batchForm, setBatchForm] = useState<XHSBatchCreateRequest>(initialBatchForm)
  const [estimate, setEstimate] = useState<XHSBatchEstimateResponse | null>(null)
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null)
  const [loadingProjects, setLoadingProjects] = useState(true)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [loadingBatches, setLoadingBatches] = useState(false)
  const [loadingConfigs, setLoadingConfigs] = useState(false)
  const [creatingProject, setCreatingProject] = useState(false)
  const [creatingVariant, setCreatingVariant] = useState(false)
  const [creatingDirection, setCreatingDirection] = useState(false)
  const [estimating, setEstimating] = useState(false)
  const [submittingBatch, setSubmittingBatch] = useState(false)
  const [projectBriefUploading, setProjectBriefUploading] = useState(false)
  const [projectBriefParsing, setProjectBriefParsing] = useState(false)
  const [projectBriefExtractedText, setProjectBriefExtractedText] = useState('')
  const [variantBriefUploading, setVariantBriefUploading] = useState(false)
  const [variantBriefParsing, setVariantBriefParsing] = useState(false)
  const [variantBriefExtractedText, setVariantBriefExtractedText] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedProject = useMemo(
    () => projects.find((item) => item.id === selectedProjectId) || null,
    [projects, selectedProjectId],
  )

  const selectedDirection = useMemo(
    () => directions.find((item) => item.id === selectedDirectionId) || null,
    [directions, selectedDirectionId],
  )

  const currentInputPlaceholder = useMemo(() => {
    if (batchForm.input_type === 'file') return '填写上传后的 file_key，或完整文件 URL'
    if (batchForm.input_type === 'feishu_link') return '粘贴飞书文档链接'
    return '每篇笔记用空行分隔，或直接粘贴一整份长文让系统自动切分'
  }, [batchForm.input_type])

  const stats = useMemo(() => {
    return {
      projectCount: projects.length,
      directionCount: directions.length,
      batchCount: batches.length,
      runningCount: batches.filter((item) => ['queued', 'running', 'exporting', 'splitting'].includes(item.status)).length,
    }
  }, [projects.length, directions.length, batches])

  const canCreateProject = Boolean(
    projectForm.name.trim() &&
    projectForm.brief_file_ref &&
    projectForm.brief_file_name &&
    projectForm.brief_parse_result,
  )

  const canParseVariantBrief = Boolean(
    variantForm.brief_file_ref ||
    variantForm.brief_text.trim(),
  )

  const loadProjects = useCallback(async () => {
    setLoadingProjects(true)
    setError(null)
    try {
      const data = await api.listXHSProjects()
      setProjects(data)
      setSelectedProjectId((prev) => {
        if (prev && data.some((item) => item.id === prev)) return prev
        return data[0]?.id || null
      })
    } catch (err) {
      setError(extractErrorMessage(err))
    } finally {
      setLoadingProjects(false)
    }
  }, [])

  const loadProjectDetails = useCallback(async (projectId: string) => {
    setLoadingDetails(true)
    setError(null)
    try {
      const [variantData, directionData] = await Promise.all([
        api.listXHSProjectVariants(projectId),
        api.listXHSDirections(projectId),
      ])
      setVariants(variantData)
      setDirections(directionData)
      setSelectedDirectionId((prev) => {
        if (prev && directionData.some((item) => item.id === prev)) return prev
        return null
      })
    } catch (err) {
      setError(extractErrorMessage(err))
    } finally {
      setLoadingDetails(false)
    }
  }, [])

  const loadBatches = useCallback(async () => {
    setLoadingBatches(true)
    setError(null)
    try {
      const data = await api.listXHSBatches({
        project_id: selectedProjectId || undefined,
        direction_id: selectedDirectionId || undefined,
      })
      setBatches(data)
    } catch (err) {
      setError(extractErrorMessage(err))
    } finally {
      setLoadingBatches(false)
    }
  }, [selectedDirectionId, selectedProjectId])

  const loadConfigOptions = useCallback(async () => {
    if (!batchForm.category_id) return

    setLoadingConfigs(true)
    setError(null)
    try {
      const params = {
        category_id: batchForm.category_id,
        status: 'active',
      }
      const [ruleData, brandData, briefData, riskData] = await Promise.all([
        api.listXHSRulePacks(params),
        api.listXHSBrandPacks(params),
        api.listXHSBriefPacks(params),
        api.listXHSRiskPacks(params),
      ])
      setRulePacks(ruleData)
      setBrandPacks(brandData)
      setBriefPacks(briefData)
      setRiskPacks(riskData)
    } catch (err) {
      setError(extractErrorMessage(err))
    } finally {
      setLoadingConfigs(false)
    }
  }, [batchForm.category_id])

  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  useEffect(() => {
    if (!selectedProjectId) {
      setVariants([])
      setDirections([])
      setSelectedDirectionId(null)
      return
    }
    void loadProjectDetails(selectedProjectId)
  }, [loadProjectDetails, selectedProjectId])

  useEffect(() => {
    setVariantForm(initialVariantForm)
    setVariantBriefExtractedText('')
    setDirectionForm(initialDirectionForm)
    setEstimate(null)
  }, [selectedProjectId])

  useEffect(() => {
    if (!loadingProjects && projects.length === 0) {
      setProjectComposerOpen(true)
    }
  }, [loadingProjects, projects.length])

  useEffect(() => {
    void loadBatches()
  }, [loadBatches])

  useEffect(() => {
    void loadConfigOptions()
  }, [loadConfigOptions])

  useEffect(() => {
    if (!selectedProject) return
    setBatchForm((prev) => ({
      ...prev,
      category_id: selectedProject.category_id,
    }))
  }, [selectedProject])

  useEffect(() => {
    setBatchForm((prev) => ({
      ...prev,
      direction_id: selectedDirectionId || undefined,
    }))
  }, [selectedDirectionId])

  useEffect(() => {
    setBatchForm((prev) => {
      const next = { ...prev }
      if (prev.rule_pack_version && !rulePacks.some((pack) => pack.version === prev.rule_pack_version)) {
        next.rule_pack_version = undefined
      }
      if (prev.brand_pack_version && !brandPacks.some((pack) => pack.version === prev.brand_pack_version)) {
        next.brand_pack_version = undefined
      }
      if (prev.brief_pack_id && !briefPacks.some((pack) => pack.id === prev.brief_pack_id)) {
        next.brief_pack_id = undefined
      }
      if (prev.risk_pack_version && !riskPacks.some((pack) => pack.version === prev.risk_pack_version)) {
        next.risk_pack_version = undefined
      }
      return next
    })
  }, [brandPacks, briefPacks, riskPacks, rulePacks])

  const clearProjectBriefFile = useCallback(() => {
    setProjectBriefExtractedText('')
    setProjectForm((prev) => ({
      ...prev,
      product_name: '',
      brief_file_ref: '',
      brief_file_name: '',
      brief_parse_result: undefined,
      project_brief: '',
      shared_requirements: '',
    }))
  }, [])

  const clearVariantBrief = useCallback(() => {
    setVariantBriefExtractedText('')
    setVariantForm((prev) => ({
      ...prev,
      brief_file_ref: '',
      brief_file_name: '',
      brief_text: '',
      brief_parse_result: undefined,
    }))
  }, [])

  const handleParseProjectBrief = useCallback(async (params?: { source_ref?: string; file_name?: string; file_url?: string }) => {
    const sourceRef = params?.source_ref || projectForm.brief_file_ref
    const fileName = params?.file_name || projectForm.brief_file_name

    if (!sourceRef || !fileName) {
      setError('请先上传整项目 Brief 文件。')
      return
    }

    setProjectBriefParsing(true)
    setError(null)
    try {
      const parsed = await api.parseXHSProjectBrief({
        source_ref: sourceRef,
        file_name: fileName,
        file_url: params?.file_url,
        category_id: projectForm.category_id,
      })
      setProjectBriefExtractedText(parsed.extracted_text)
      setProjectForm((prev) => ({
        ...prev,
        brief_file_ref: parsed.source_ref,
        brief_file_name: parsed.file_name,
        brief_parse_result: parsed.brief_parse_result,
        product_name: parsed.brief_parse_result.product_name || prev.product_name,
        project_brief: parsed.brief_parse_result.project_brief || prev.project_brief,
        shared_requirements: parsed.brief_parse_result.shared_requirements || prev.shared_requirements,
      }))
    } catch (err) {
      setError(extractErrorMessage(err))
    } finally {
      setProjectBriefParsing(false)
    }
  }, [projectForm.brief_file_name, projectForm.brief_file_ref, projectForm.category_id])

  const handleProjectBriefUpload = useCallback(async (file: File) => {
    setProjectBriefUploading(true)
    setError(null)
    try {
      const uploaded = await api.proxyUpload(file, 'script')
      setProjectForm((prev) => ({
        ...prev,
        brief_file_ref: uploaded.file_key,
        brief_file_name: uploaded.file_name,
        brief_parse_result: undefined,
      }))
      await handleParseProjectBrief({
        source_ref: uploaded.file_key,
        file_name: uploaded.file_name,
        file_url: uploaded.url,
      })
    } catch (err) {
      setError(extractErrorMessage(err))
    } finally {
      setProjectBriefUploading(false)
    }
  }, [handleParseProjectBrief])

  const handleParseVariantBrief = useCallback(async (params?: { source_ref?: string; file_name?: string; file_url?: string; raw_text?: string }) => {
    const sourceRef = params?.source_ref || variantForm.brief_file_ref
    const fileName = params?.file_name || variantForm.brief_file_name
    const rawText = typeof params?.raw_text === 'string' ? params.raw_text : variantForm.brief_text
    const normalizedRawText = rawText.trim()

    if (!sourceRef && !normalizedRawText) {
      setError('请先上传版本 Brief 文件，或直接粘贴版本说明。')
      return
    }

    setVariantBriefParsing(true)
    setError(null)
    try {
      const parsed = await api.parseXHSVariantBrief({
        source_ref: sourceRef || undefined,
        file_name: fileName || undefined,
        file_url: params?.file_url,
        raw_text: normalizedRawText || undefined,
        category_id: selectedProject?.category_id || projectForm.category_id,
      })
      setVariantBriefExtractedText(parsed.extracted_text)
      setVariantForm((prev) => ({
        ...prev,
        brief_file_ref: parsed.source_ref || sourceRef || '',
        brief_file_name: parsed.file_name || fileName || '',
        brief_text: parsed.extracted_text || normalizedRawText,
        brief_parse_result: parsed.brief_parse_result,
        name: parsed.brief_parse_result.name || prev.name,
        selling_points: parsed.brief_parse_result.selling_points.length > 0
          ? parsed.brief_parse_result.selling_points.join('\n')
          : prev.selling_points,
        appearance_notes: parsed.brief_parse_result.appearance_notes || prev.appearance_notes,
        notes: parsed.brief_parse_result.notes || prev.notes,
      }))
    } catch (err) {
      setError(extractErrorMessage(err))
    } finally {
      setVariantBriefParsing(false)
    }
  }, [projectForm.category_id, selectedProject?.category_id, variantForm.brief_file_name, variantForm.brief_file_ref, variantForm.brief_text])

  const handleVariantBriefUpload = useCallback(async (file: File) => {
    setVariantBriefUploading(true)
    setError(null)
    try {
      const uploaded = await api.proxyUpload(file, 'script')
      setVariantForm((prev) => ({
        ...prev,
        brief_file_ref: uploaded.file_key,
        brief_file_name: uploaded.file_name,
        brief_parse_result: undefined,
      }))
      await handleParseVariantBrief({
        source_ref: uploaded.file_key,
        file_name: uploaded.file_name,
        file_url: uploaded.url,
        raw_text: '',
      })
    } catch (err) {
      setError(extractErrorMessage(err))
    } finally {
      setVariantBriefUploading(false)
    }
  }, [handleParseVariantBrief])

  const handleCreateProject = useCallback(async () => {
    if (!canCreateProject) {
      setError('请先上传整项目 Brief，并让系统完成解析后再创建大项目。')
      return
    }

    setCreatingProject(true)
    setError(null)
    try {
      const project = await api.createXHSProject({
        ...projectForm,
      })
      setProjects((prev) => [project, ...prev])
      setSelectedProjectId(project.id)
      setActiveWorkspaceTab('overview')
      setProjectComposerOpen(false)
      setProjectForm(initialProjectForm)
      setProjectBriefExtractedText('')
    } catch (err) {
      setError(extractErrorMessage(err))
    } finally {
      setCreatingProject(false)
    }
  }, [canCreateProject, projectForm])

  const handleCreateVariant = useCallback(async () => {
    if (!selectedProjectId) {
      setError('请先选择一个大项目，再新增产品版本。')
      return
    }

    setCreatingVariant(true)
    setError(null)
    try {
      const variant = await api.createXHSProjectVariant(selectedProjectId, {
        name: variantForm.name.trim(),
        selling_points: variantForm.selling_points.trim() || undefined,
        appearance_notes: variantForm.appearance_notes.trim() || undefined,
        notes: variantForm.notes.trim() || undefined,
        is_primary: variantForm.is_primary,
      })
      setVariants((prev) => [...prev, variant].sort((a, b) => a.sort_order - b.sort_order))
      setVariantForm(initialVariantForm)
      setVariantBriefExtractedText('')
      await loadProjects()
    } catch (err) {
      setError(extractErrorMessage(err))
    } finally {
      setCreatingVariant(false)
    }
  }, [loadProjects, selectedProjectId, variantForm])

  const handleCreateDirection = useCallback(async () => {
    if (!selectedProjectId) {
      setError('请先选择一个大项目，再新增方向单。')
      return
    }

    setCreatingDirection(true)
    setError(null)
    try {
      const direction = await api.createXHSDirection(selectedProjectId, {
        ...directionForm,
        main_variant_id: directionForm.main_variant_id || undefined,
      })
      setDirections((prev) => [...prev, direction].sort((a, b) => a.sort_order - b.sort_order))
      setSelectedDirectionId(direction.id)
      setDirectionForm(initialDirectionForm)
      await loadProjects()
    } catch (err) {
      setError(extractErrorMessage(err))
    } finally {
      setCreatingDirection(false)
    }
  }, [directionForm, loadProjects, selectedProjectId])

  const handleEstimate = useCallback(async () => {
    if (!selectedProject) {
      setError('请先创建或选择一个大项目。')
      return
    }

    setEstimating(true)
    setError(null)
    try {
      const data = await api.estimateXHSBatch(batchForm)
      setEstimate(data)
    } catch (err) {
      setError(extractErrorMessage(err))
    } finally {
      setEstimating(false)
    }
  }, [batchForm, selectedProject])

  const handleCreateBatch = useCallback(async () => {
    if (!selectedProject) {
      setError('请先创建或选择一个大项目。')
      return
    }

    setSubmittingBatch(true)
    setError(null)
    try {
      const batch = await api.createXHSBatch(batchForm)
      if (batchForm.run_mode === 'full') {
        await api.startXHSBatch(batch.id)
      }
      window.location.href = `${xhsBasePath}/${batch.id}`
    } catch (err) {
      setError(extractErrorMessage(err))
    } finally {
      setSubmittingBatch(false)
    }
  }, [batchForm, selectedProject, xhsBasePath])

  const handleFileUpload = useCallback(async (file: File) => {
    setUploading(true)
    setError(null)
    try {
      const uploaded = await api.proxyUpload(file, 'script')
      setBatchForm((prev) => ({
        ...prev,
        input_type: 'file',
        file_id: uploaded.file_key,
        input_text: undefined,
        feishu_url: undefined,
      }))
      setUploadedFileName(uploaded.file_name)
    } catch (err) {
      setError(extractErrorMessage(err))
    } finally {
      setUploading(false)
    }
  }, [])

  return (
    <div className="space-y-8 min-h-0 pb-20 max-w-[1480px] mx-auto">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent-indigo/10 text-accent-indigo text-xs font-black tracking-[0.24em]">
            <Sparkles size={12} />
            小红书项目改写
          </div>
          <h1 className="text-3xl font-black tracking-tighter text-text-primary">先建大项目，再拆方向单</h1>
          <p className="text-sm text-text-tertiary">围绕同一份 Brief 建一个大项目，再拆产品版本和方向单，最后从方向单发起试跑或全量批次。</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" icon={Bot} onClick={() => { window.location.href = aiConfigPath }}>
            AI 配置
          </Button>
          <Button variant="secondary" icon={Settings2} onClick={() => { window.location.href = xhsConfigPath }}>
            配置资产
          </Button>
          <Button variant="secondary" icon={RefreshCw} onClick={() => {
            void loadProjects()
            void loadBatches()
          }}>
            刷新
          </Button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-2xl border border-accent-coral/20 bg-accent-coral/10 text-sm text-accent-coral">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          ['大项目', String(stats.projectCount)],
          ['方向单', String(stats.directionCount)],
          ['当前批次', String(stats.batchCount)],
          ['运行中', String(stats.runningCount)],
        ].map(([label, value]) => (
          <Card key={label} className="border-border-subtle/70">
            <CardContent className="py-5">
              <div className="text-xs uppercase tracking-[0.18em] text-text-tertiary">{label}</div>
              <div className="mt-2 text-3xl font-black tracking-tighter text-text-primary">{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-3 space-y-6">
          <Card className="border-border-subtle/70">
            <CardHeader className="flex-row items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2">
                <Layers3 size={18} className="text-accent-indigo" />
                新建大项目
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setProjectComposerOpen((prev) => !prev)}
              >
                {projectComposerOpen ? '收起' : '展开'}
              </Button>
            </CardHeader>
            {projectComposerOpen && (
            <CardContent className="space-y-4">
              <label className="space-y-2 text-sm block">
                <span className="font-medium text-text-primary">项目名</span>
                <input
                  value={projectForm.name}
                  onChange={(e) => setProjectForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2 text-text-primary"
                  placeholder="例如：AKK 春季总代项目"
                />
              </label>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-text-primary">客户/品牌</span>
                  <input
                    value={projectForm.client_name}
                    onChange={(e) => setProjectForm((prev) => ({ ...prev, client_name: e.target.value }))}
                    className="w-full rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2 text-text-primary"
                    placeholder="例如：AKK"
                  />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-text-primary">产品 / 系列</span>
                  <input
                    value={projectForm.product_name}
                    onChange={(e) => setProjectForm((prev) => ({ ...prev, product_name: e.target.value }))}
                    className="w-full rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2 text-text-primary"
                    placeholder="例如：双标系列"
                  />
                </label>
              </div>

              <XHSCategorySelectField
                label="品类"
                value={projectForm.category_id}
                onChange={(value) => setProjectForm((prev) => ({ ...prev, category_id: value }))}
                customPlaceholder="请输入其它品类，例如：线下服务"
              />

              <div className="rounded-2xl border border-border-subtle bg-bg-elevated/20 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-text-primary">整项目 Brief 文件</div>
                    <div className="mt-1 text-xs text-text-tertiary">
                      先上传文件，系统会自动提炼项目背景、共用要求和后续拆方向单要参考的重点。
                    </div>
                  </div>
                  {projectForm.brief_parse_result ? (
                    <SuccessTag size="sm">已解析</SuccessTag>
                  ) : projectBriefParsing ? (
                    <WarningTag size="sm">解析中</WarningTag>
                  ) : (
                    <PendingTag size="sm">待上传</PendingTag>
                  )}
                </div>

                <div className="flex flex-wrap gap-3">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border-subtle bg-bg-card px-4 py-2 text-sm text-text-primary hover:border-accent-indigo/50">
                    {projectBriefUploading ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />}
                    {projectForm.brief_file_name ? '重新上传 Brief' : '上传 Brief 文件'}
                    <input
                      type="file"
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.txt"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        if (file) {
                          void handleProjectBriefUpload(file)
                        }
                        event.currentTarget.value = ''
                      }}
                    />
                  </label>

                  <Button
                    variant="secondary"
                    icon={Sparkles}
                    loading={projectBriefParsing}
                    disabled={!projectForm.brief_file_ref || projectBriefUploading}
                    onClick={() => {
                      void handleParseProjectBrief()
                    }}
                  >
                    {projectForm.brief_parse_result ? '重新解析' : '开始解析'}
                  </Button>

                  {projectForm.brief_file_ref && (
                    <button
                      type="button"
                      onClick={clearProjectBriefFile}
                      className="inline-flex items-center gap-2 rounded-xl border border-border-subtle bg-bg-card px-4 py-2 text-sm text-text-tertiary hover:text-text-primary"
                    >
                      <X size={16} />
                      清空
                    </button>
                  )}
                </div>

                {projectForm.brief_file_name && (
                  <div className="rounded-xl bg-bg-card px-3 py-2 text-sm text-text-primary">
                    已上传：{projectForm.brief_file_name}
                  </div>
                )}

                {projectBriefExtractedText && (
                  <details className="rounded-xl border border-border-subtle bg-bg-card px-3 py-3 text-sm text-text-secondary">
                    <summary className="cursor-pointer font-medium text-text-primary">查看提取出来的原文片段</summary>
                    <div className="mt-3 whitespace-pre-wrap text-xs leading-6 text-text-tertiary">{projectBriefExtractedText}</div>
                  </details>
                )}
              </div>

              <label className="space-y-2 text-sm block">
                <span className="font-medium text-text-primary">整项目摘要（AI 已回填，可修改）</span>
                <textarea
                  rows={4}
                  value={projectForm.project_brief}
                  onChange={(e) => setProjectForm((prev) => ({ ...prev, project_brief: e.target.value }))}
                  className="w-full rounded-2xl border border-border-subtle bg-bg-elevated px-3 py-3 text-sm text-text-primary"
                  placeholder="上传并解析后，这里会自动回填整项目摘要。"
                />
              </label>

              <label className="space-y-2 text-sm block">
                <span className="font-medium text-text-primary">全项目共用要求（AI 已回填，可修改）</span>
                <textarea
                  rows={4}
                  value={projectForm.shared_requirements}
                  onChange={(e) => setProjectForm((prev) => ({ ...prev, shared_requirements: e.target.value }))}
                  className="w-full rounded-2xl border border-border-subtle bg-bg-elevated px-3 py-3 text-sm text-text-primary"
                  placeholder="上传并解析后，这里会自动回填全项目共用要求。"
                />
              </label>

              {projectForm.brief_parse_result && (
                <div className="space-y-3">
                  <div className="rounded-2xl border border-border-subtle bg-bg-elevated/20 p-4">
                    <div className="text-sm font-medium text-text-primary">AI 抓到的重点</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {projectForm.brief_parse_result.key_points.length === 0 ? (
                        <div className="text-sm text-text-tertiary">这份 Brief 里暂时没有抓到明确重点。</div>
                      ) : projectForm.brief_parse_result.key_points.map((point) => (
                        <div key={point} className="rounded-full bg-accent-indigo/10 px-3 py-1.5 text-xs font-medium text-text-primary">
                          {point}
                        </div>
                      ))}
                    </div>
                  </div>

                  {(projectForm.brief_parse_result.variant_suggestions.length > 0 || projectForm.brief_parse_result.direction_suggestions.length > 0) && (
                    <div className="grid grid-cols-1 gap-3">
                      {projectForm.brief_parse_result.variant_suggestions.length > 0 && (
                        <div className="rounded-2xl border border-border-subtle bg-bg-elevated/20 p-4">
                          <div className="text-sm font-medium text-text-primary">识别到的产品版本建议</div>
                          <div className="mt-3 space-y-3">
                            {projectForm.brief_parse_result.variant_suggestions.map((variant) => (
                              <div key={variant.name} className="rounded-xl border border-border-subtle bg-bg-card p-3">
                                <div className="font-medium text-text-primary">{variant.name}</div>
                                {variant.selling_points.length > 0 && (
                                  <div className="mt-2 text-sm text-text-primary">{variant.selling_points.join(' / ')}</div>
                                )}
                                {variant.appearance_notes && <div className="mt-1 text-xs text-text-tertiary">外观：{variant.appearance_notes}</div>}
                                {variant.notes && <div className="mt-1 text-xs text-text-tertiary">备注：{variant.notes}</div>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {projectForm.brief_parse_result.direction_suggestions.length > 0 && (
                        <div className="rounded-2xl border border-border-subtle bg-bg-elevated/20 p-4">
                          <div className="text-sm font-medium text-text-primary">识别到的方向灵感</div>
                          <div className="mt-3 space-y-3">
                            {projectForm.brief_parse_result.direction_suggestions.map((direction) => (
                              <div key={direction.name} className="rounded-xl border border-border-subtle bg-bg-card p-3">
                                <div className="font-medium text-text-primary">{direction.name}</div>
                                <div className="mt-2 text-xs text-text-tertiary">
                                  {direction.main_variant_name || '未识别主推版本'}
                                  {direction.secondary_variant_names.length > 0 ? ` · 搭带 ${direction.secondary_variant_names.join(' / ')}` : ''}
                                  {direction.content_style ? ` · ${direction.content_style}` : ''}
                                </div>
                                {direction.direction_brief && <div className="mt-2 text-sm text-text-primary">{direction.direction_brief}</div>}
                                {direction.extra_requirements.length > 0 && (
                                  <div className="mt-2 text-xs text-text-tertiary">额外提醒：{direction.extra_requirements.join('；')}</div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <label className="space-y-2 text-sm block">
                <span className="font-medium text-text-primary">备注</span>
                <textarea
                  rows={3}
                  value={projectForm.remark}
                  onChange={(e) => setProjectForm((prev) => ({ ...prev, remark: e.target.value }))}
                  className="w-full rounded-2xl border border-border-subtle bg-bg-elevated px-3 py-3 text-sm text-text-primary"
                  placeholder="可写排期、版本说明、补充提醒。"
                />
              </label>

              <Button
                onClick={handleCreateProject}
                loading={creatingProject}
                icon={Sparkles}
                disabled={!canCreateProject || projectBriefUploading || projectBriefParsing}
                fullWidth
              >
                创建大项目
              </Button>
              {!canCreateProject && (
                <div className="text-xs text-text-tertiary">
                  先上传并解析整项目 Brief，系统把重点回填出来后，再创建大项目。
                </div>
              )}
            </CardContent>
            )}
          </Card>

          <Card className="border-border-subtle/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Boxes size={18} className="text-accent-indigo" />
                大项目列表
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {loadingProjects ? (
                <div className="py-10 flex items-center justify-center text-text-tertiary">
                  <Loader2 size={18} className="animate-spin mr-2" />
                  加载中
                </div>
              ) : projects.length === 0 ? (
                <div className="py-8 text-center text-text-tertiary">还没有大项目，先新建一个。</div>
              ) : projects.map((project) => {
                const active = project.id === selectedProjectId
                return (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => setSelectedProjectId(project.id)}
                    className={`w-full rounded-2xl border px-4 py-4 text-left transition-all ${
                      active
                        ? 'border-accent-indigo bg-accent-indigo/10'
                        : 'border-border-subtle bg-bg-card hover:border-accent-indigo/40'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-black text-text-primary truncate">{project.name}</div>
                        <div className="mt-1 text-xs text-text-tertiary">
                          {project.client_name || '未填客户'} · {project.product_name || '未填产品'}
                        </div>
                        {project.brief_file_name && (
                          <div className="mt-1 truncate text-[11px] text-text-tertiary">
                            Brief：{project.brief_file_name}
                          </div>
                        )}
                      </div>
                      {project.status === 'active' ? <SuccessTag size="sm">进行中</SuccessTag> : <WarningTag size="sm">已归档</WarningTag>}
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-text-tertiary">
                      <div>版本 {project.variant_count}</div>
                      <div>方向 {project.direction_count}</div>
                      <div>批次 {project.batch_count}</div>
                    </div>
                  </button>
                )
              })}
            </CardContent>
          </Card>
        </div>

        <div className="xl:col-span-9 space-y-6">
          <Card className="border-border-subtle/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardList size={18} className="text-accent-indigo" />
                当前工作区
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!selectedProject ? (
                <div className="rounded-2xl border border-border-subtle bg-bg-elevated/20 px-4 py-5 text-sm text-text-tertiary">
                  先在左侧选择一个大项目，再继续拆产品版本、方向单或发起批次。
                </div>
              ) : (
                <div className="rounded-2xl border border-accent-indigo/20 bg-accent-indigo/10 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <div className="text-xs uppercase tracking-[0.18em] text-accent-indigo font-black">当前选中</div>
                      <div className="mt-2 text-xl font-black tracking-tight text-text-primary">{selectedProject.name}</div>
                      <div className="mt-1 text-sm text-text-tertiary">
                        {selectedProject.client_name || '未填客户'} · {selectedProject.product_name || '未填产品'} · {getXHSCategoryLabel(selectedProject.category_id)}
                      </div>
                    </div>
                    <div className="text-sm text-text-tertiary">
                      {selectedDirection ? `已选方向单：${selectedDirection.name}` : '当前未挂方向单'}
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                {workspaceTabs.map((tab) => {
                  const active = tab.id === activeWorkspaceTab
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveWorkspaceTab(tab.id)}
                      className={`rounded-2xl border px-4 py-4 text-left transition-all ${
                        active
                          ? 'border-accent-indigo bg-accent-indigo/10'
                          : 'border-border-subtle bg-bg-card hover:border-accent-indigo/40'
                      }`}
                    >
                      <div className="font-black text-text-primary">{tab.label}</div>
                      <div className="mt-1 text-xs leading-5 text-text-tertiary">{tab.hint}</div>
                    </button>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          {activeWorkspaceTab === 'overview' && (
          <Card className="border-border-subtle/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardList size={18} className="text-accent-indigo" />
                当前项目
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!selectedProject ? (
                <div className="py-8 text-center text-text-tertiary">请选择左侧项目。</div>
              ) : (
                <div className="space-y-5">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="text-2xl font-black tracking-tight text-text-primary">{selectedProject.name}</div>
                      <div className="mt-2 text-sm text-text-tertiary">
                        {selectedProject.client_name || '未填客户'} · {selectedProject.product_name || '未填产品'} · 品类 {getXHSCategoryLabel(selectedProject.category_id)}
                      </div>
                      {selectedProject.brief_file_name && (
                        <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-accent-indigo/10 px-3 py-1 text-xs text-text-primary">
                          <FileText size={12} />
                          {selectedProject.brief_file_name}
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-text-tertiary">最近更新：{formatDateTime(selectedProject.updated_at)}</div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div className="rounded-2xl border border-border-subtle bg-bg-elevated/30 p-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-text-tertiary">整项目摘要</div>
                      <div className="mt-2 text-sm text-text-primary whitespace-pre-wrap">{selectedProject.project_brief || '未填写'}</div>
                    </div>
                    <div className="rounded-2xl border border-border-subtle bg-bg-elevated/30 p-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-text-tertiary">共用要求</div>
                      <div className="mt-2 text-sm text-text-primary whitespace-pre-wrap">{selectedProject.shared_requirements || '未填写'}</div>
                    </div>
                    <div className="rounded-2xl border border-border-subtle bg-bg-elevated/30 p-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-text-tertiary">备注</div>
                      <div className="mt-2 text-sm text-text-primary whitespace-pre-wrap">{selectedProject.remark || '未填写'}</div>
                    </div>
                  </div>

                  {selectedProject.brief_parse_result && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                      <div className="rounded-2xl border border-border-subtle bg-bg-elevated/30 p-4 lg:col-span-3">
                        <div className="text-xs uppercase tracking-[0.18em] text-text-tertiary">AI 抓到的重点</div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {selectedProject.brief_parse_result.key_points.length === 0 ? (
                            <div className="text-sm text-text-tertiary">暂无解析重点。</div>
                          ) : selectedProject.brief_parse_result.key_points.map((point) => (
                            <div key={point} className="rounded-full bg-accent-indigo/10 px-3 py-1.5 text-xs font-medium text-text-primary">
                              {point}
                            </div>
                          ))}
                        </div>
                      </div>

                      {selectedProject.brief_parse_result.variant_suggestions.length > 0 && (
                        <div className="rounded-2xl border border-border-subtle bg-bg-elevated/30 p-4">
                          <div className="text-xs uppercase tracking-[0.18em] text-text-tertiary">产品版本建议</div>
                          <div className="mt-3 space-y-3">
                            {selectedProject.brief_parse_result.variant_suggestions.map((variant) => (
                              <div key={variant.name} className="rounded-xl border border-border-subtle bg-bg-card p-3">
                                <div className="font-medium text-text-primary">{variant.name}</div>
                                {variant.selling_points.length > 0 && <div className="mt-2 text-sm text-text-primary">{variant.selling_points.join(' / ')}</div>}
                                {variant.appearance_notes && <div className="mt-1 text-xs text-text-tertiary">外观：{variant.appearance_notes}</div>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {selectedProject.brief_parse_result.direction_suggestions.length > 0 && (
                        <div className="rounded-2xl border border-border-subtle bg-bg-elevated/30 p-4 lg:col-span-2">
                          <div className="text-xs uppercase tracking-[0.18em] text-text-tertiary">方向灵感</div>
                          <div className="mt-3 space-y-3">
                            {selectedProject.brief_parse_result.direction_suggestions.map((direction) => (
                              <div key={direction.name} className="rounded-xl border border-border-subtle bg-bg-card p-3">
                                <div className="font-medium text-text-primary">{direction.name}</div>
                                <div className="mt-2 text-xs text-text-tertiary">
                                  {direction.main_variant_name || '未识别主推版本'}
                                  {direction.secondary_variant_names.length > 0 ? ` · 搭带 ${direction.secondary_variant_names.join(' / ')}` : ''}
                                  {direction.content_style ? ` · ${direction.content_style}` : ''}
                                </div>
                                {direction.direction_brief && <div className="mt-2 text-sm text-text-primary">{direction.direction_brief}</div>}
                                {direction.extra_requirements.length > 0 && (
                                  <div className="mt-2 text-xs text-text-tertiary">额外提醒：{direction.extra_requirements.join('；')}</div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
          )}

          {activeWorkspaceTab === 'variants' && (
            <Card className="border-border-subtle/70">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Boxes size={18} className="text-accent-indigo" />
                  产品版本
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-2xl border border-border-subtle bg-bg-elevated/20 p-4 space-y-3">
                  <div className="rounded-2xl border border-border-subtle bg-bg-card/70 p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium text-text-primary">版本 Brief</div>
                        <div className="mt-1 text-xs text-text-tertiary">可上传这个版本自己的说明文件，也可以直接粘贴文字后解析。</div>
                      </div>
                      {variantForm.brief_parse_result ? (
                        <SuccessTag size="sm">已解析</SuccessTag>
                      ) : variantBriefParsing ? (
                        <WarningTag size="sm">解析中</WarningTag>
                      ) : (
                        <PendingTag size="sm">待解析</PendingTag>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        icon={UploadCloud}
                        loading={variantBriefUploading}
                        disabled={!selectedProjectId}
                        onClick={() => {
                          document.getElementById('variant-brief-upload-input')?.click()
                        }}
                      >
                        {variantForm.brief_file_name ? '重新上传版本 Brief' : '上传版本 Brief'}
                      </Button>
                      <input
                        id="variant-brief-upload-input"
                        type="file"
                        accept=".pdf,.doc,.docx,.xls,.xlsx,.txt"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0]
                          if (file) {
                            void handleVariantBriefUpload(file)
                          }
                          event.target.value = ''
                        }}
                      />
                      <Button
                        variant="secondary"
                        icon={Bot}
                        loading={variantBriefParsing}
                        disabled={!selectedProjectId || !canParseVariantBrief || variantBriefUploading}
                        onClick={() => {
                          void handleParseVariantBrief()
                        }}
                      >
                        {variantForm.brief_parse_result ? '重新解析' : '开始解析'}
                      </Button>
                      {(variantForm.brief_file_ref || variantForm.brief_text) && (
                        <Button
                          variant="ghost"
                          icon={X}
                          disabled={variantBriefUploading || variantBriefParsing}
                          onClick={clearVariantBrief}
                        >
                          清空 Brief
                        </Button>
                      )}
                    </div>

                    {variantForm.brief_file_name && (
                      <div className="rounded-xl border border-border-subtle bg-bg-elevated/50 px-3 py-2 text-xs text-text-tertiary">
                        已上传：{variantForm.brief_file_name}
                      </div>
                    )}

                    <label className="space-y-2 text-sm block">
                      <span className="font-medium text-text-primary">版本 Brief 原文</span>
                      <textarea
                        rows={5}
                        value={variantForm.brief_text}
                        onChange={(e) => setVariantForm((prev) => ({ ...prev, brief_text: e.target.value }))}
                        className="w-full rounded-2xl border border-border-subtle bg-bg-elevated px-3 py-3 text-sm text-text-primary"
                        placeholder="把这个版本的单独卖点、包装差异、限制话术、适用场景等粘贴进来。上传文件后，识别出的文字也会自动回填到这里。"
                      />
                    </label>

                    {variantBriefExtractedText && (
                      <div className="rounded-xl border border-border-subtle bg-bg-elevated/50 px-3 py-2 text-xs text-text-tertiary">
                        系统最近一次已识别并回填 {variantBriefExtractedText.length} 个字，你可以直接在上面的原文框继续改。
                      </div>
                    )}

                    {variantForm.brief_parse_result && (
                      <div className="rounded-2xl border border-border-subtle bg-bg-elevated/40 p-4 space-y-3">
                        <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
                          <FileText size={16} className="text-accent-indigo" />
                          系统刚帮你整理出的版本重点
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="rounded-xl border border-border-subtle bg-bg-card p-3">
                            <div className="text-xs uppercase tracking-[0.18em] text-text-tertiary">版本名建议</div>
                            <div className="mt-2 text-sm text-text-primary">{variantForm.brief_parse_result.name || '未识别'}</div>
                          </div>
                          <div className="rounded-xl border border-border-subtle bg-bg-card p-3">
                            <div className="text-xs uppercase tracking-[0.18em] text-text-tertiary">外观差异</div>
                            <div className="mt-2 text-sm text-text-primary whitespace-pre-wrap">{variantForm.brief_parse_result.appearance_notes || '未识别'}</div>
                          </div>
                          <div className="rounded-xl border border-border-subtle bg-bg-card p-3 md:col-span-2">
                            <div className="text-xs uppercase tracking-[0.18em] text-text-tertiary">功效卖点</div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {variantForm.brief_parse_result.selling_points.length === 0 ? (
                                <span className="text-sm text-text-tertiary">未识别</span>
                              ) : variantForm.brief_parse_result.selling_points.map((point) => (
                                <span key={point} className="rounded-full bg-accent-indigo/10 px-3 py-1 text-xs text-accent-indigo">
                                  {point}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div className="rounded-xl border border-border-subtle bg-bg-card p-3 md:col-span-2">
                            <div className="text-xs uppercase tracking-[0.18em] text-text-tertiary">补充提醒</div>
                            <div className="mt-2 text-sm text-text-primary whitespace-pre-wrap">{variantForm.brief_parse_result.notes || '未识别'}</div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <label className="space-y-2 text-sm block">
                    <span className="font-medium text-text-primary">版本名</span>
                    <input
                      value={variantForm.name}
                      onChange={(e) => setVariantForm((prev) => ({ ...prev, name: e.target.value }))}
                      className="w-full rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2 text-text-primary"
                      placeholder="例如：金标 / 银标"
                    />
                  </label>
                  <label className="space-y-2 text-sm block">
                    <span className="font-medium text-text-primary">功效卖点</span>
                    <textarea
                      rows={3}
                      value={variantForm.selling_points}
                      onChange={(e) => setVariantForm((prev) => ({ ...prev, selling_points: e.target.value }))}
                      className="w-full rounded-2xl border border-border-subtle bg-bg-elevated px-3 py-3 text-sm text-text-primary"
                      placeholder="写这个版本主打什么。"
                    />
                  </label>
                  <label className="space-y-2 text-sm block">
                    <span className="font-medium text-text-primary">外观差异</span>
                    <textarea
                      rows={2}
                      value={variantForm.appearance_notes}
                      onChange={(e) => setVariantForm((prev) => ({ ...prev, appearance_notes: e.target.value }))}
                      className="w-full rounded-2xl border border-border-subtle bg-bg-elevated px-3 py-3 text-sm text-text-primary"
                      placeholder="写包装、颜色、外观区别。"
                    />
                  </label>
                  <label className="space-y-2 text-sm block">
                    <span className="font-medium text-text-primary">备注</span>
                    <textarea
                      rows={2}
                      value={variantForm.notes}
                      onChange={(e) => setVariantForm((prev) => ({ ...prev, notes: e.target.value }))}
                      className="w-full rounded-2xl border border-border-subtle bg-bg-elevated px-3 py-3 text-sm text-text-primary"
                      placeholder="写适合的用法或提醒。"
                    />
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-text-primary">
                    <input
                      type="checkbox"
                      checked={variantForm.is_primary}
                      onChange={(e) => setVariantForm((prev) => ({ ...prev, is_primary: e.target.checked }))}
                      className="h-4 w-4 rounded border-border-subtle"
                    />
                    设为主版本
                  </label>
                  <Button onClick={handleCreateVariant} loading={creatingVariant} disabled={!selectedProjectId} fullWidth>
                    新增产品版本
                  </Button>
                </div>

                {loadingDetails ? (
                  <div className="py-8 flex items-center justify-center text-text-tertiary">
                    <Loader2 size={18} className="animate-spin mr-2" />
                    加载中
                  </div>
                ) : variants.length === 0 ? (
                  <div className="py-6 text-center text-text-tertiary">这个项目还没有产品版本。</div>
                ) : variants.map((variant) => (
                  <div key={variant.id} className="rounded-2xl border border-border-subtle bg-bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-black text-text-primary">{variant.name}</div>
                        <div className="mt-1 text-xs text-text-tertiary">创建于 {formatDateTime(variant.created_at)}</div>
                      </div>
                      {variant.is_primary ? <SuccessTag size="sm">主版本</SuccessTag> : <PendingTag size="sm">普通版本</PendingTag>}
                    </div>
                    <div className="mt-3 space-y-2 text-sm text-text-primary">
                      <div className="whitespace-pre-wrap">{variant.selling_points || '未写卖点'}</div>
                      {variant.appearance_notes && <div className="text-text-tertiary">外观：{variant.appearance_notes}</div>}
                      {variant.notes && <div className="text-text-tertiary">备注：{variant.notes}</div>}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {activeWorkspaceTab === 'directions' && (
            <Card className="border-border-subtle/70">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ClipboardList size={18} className="text-accent-indigo" />
                  方向单
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-2xl border border-border-subtle bg-bg-elevated/20 p-4 space-y-3">
                  <label className="space-y-2 text-sm block">
                    <span className="font-medium text-text-primary">方向单名</span>
                    <input
                      value={directionForm.name}
                      onChange={(e) => setDirectionForm((prev) => ({ ...prev, name: e.target.value }))}
                      className="w-full rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2 text-text-primary"
                      placeholder="例如：帕梅拉金带银非报备"
                    />
                  </label>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="space-y-2 text-sm">
                      <span className="font-medium text-text-primary">主推版本</span>
                      <select
                        value={directionForm.main_variant_id}
                        onChange={(e) => {
                          const nextMainVariantId = e.target.value
                          setDirectionForm((prev) => ({
                            ...prev,
                            main_variant_id: nextMainVariantId,
                            secondary_variant_ids: prev.secondary_variant_ids.filter((item) => item !== nextMainVariantId),
                          }))
                        }}
                        className="w-full rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2 text-text-primary"
                      >
                        <option value="">不指定</option>
                        {variants.map((variant) => (
                          <option key={variant.id} value={variant.id}>{variant.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-2 text-sm">
                      <span className="font-medium text-text-primary">表达方式</span>
                      <input
                        value={directionForm.content_style}
                        onChange={(e) => setDirectionForm((prev) => ({ ...prev, content_style: e.target.value }))}
                        className="w-full rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2 text-text-primary"
                        placeholder="例如：非报备 / 报备"
                      />
                    </label>
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm font-medium text-text-primary">搭带版本</div>
                    <div className="flex flex-wrap gap-2">
                      {variants.length === 0 ? (
                        <div className="text-sm text-text-tertiary">先创建产品版本后再勾选。</div>
                      ) : variants.map((variant) => {
                        const checked = directionForm.secondary_variant_ids.includes(variant.id)
                        const disabled = variant.id === directionForm.main_variant_id
                        return (
                          <label
                            key={variant.id}
                            className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                              checked ? 'border-accent-indigo bg-accent-indigo/10 text-text-primary' : 'border-border-subtle bg-bg-card text-text-secondary'
                            } ${disabled ? 'opacity-40' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={disabled}
                              onChange={(e) => {
                                setDirectionForm((prev) => ({
                                  ...prev,
                                  secondary_variant_ids: e.target.checked
                                    ? [...prev.secondary_variant_ids, variant.id]
                                    : prev.secondary_variant_ids.filter((item) => item !== variant.id),
                                }))
                              }}
                              className="h-4 w-4 rounded border-border-subtle"
                            />
                            {variant.name}
                          </label>
                        )
                      })}
                    </div>
                  </div>

                  <label className="space-y-2 text-sm block">
                    <span className="font-medium text-text-primary">方向说明</span>
                    <textarea
                      rows={3}
                      value={directionForm.direction_brief}
                      onChange={(e) => setDirectionForm((prev) => ({ ...prev, direction_brief: e.target.value }))}
                      className="w-full rounded-2xl border border-border-subtle bg-bg-elevated px-3 py-3 text-sm text-text-primary"
                      placeholder="写这一行要怎么讲、重点讲什么、顺带带什么。"
                    />
                  </label>
                  <label className="space-y-2 text-sm block">
                    <span className="font-medium text-text-primary">额外限制</span>
                    <textarea
                      rows={2}
                      value={directionForm.extra_requirements}
                      onChange={(e) => setDirectionForm((prev) => ({ ...prev, extra_requirements: e.target.value }))}
                      className="w-full rounded-2xl border border-border-subtle bg-bg-elevated px-3 py-3 text-sm text-text-primary"
                      placeholder="例如：更口语化、更短、不能出现某些说法。"
                    />
                  </label>
                  <Button onClick={handleCreateDirection} loading={creatingDirection} disabled={!selectedProjectId} fullWidth>
                    新增方向单
                  </Button>
                </div>

                {loadingDetails ? (
                  <div className="py-8 flex items-center justify-center text-text-tertiary">
                    <Loader2 size={18} className="animate-spin mr-2" />
                    加载中
                  </div>
                ) : directions.length === 0 ? (
                  <div className="py-6 text-center text-text-tertiary">这个项目还没有方向单。</div>
                ) : directions.map((direction) => {
                  const active = direction.id === selectedDirectionId
                  return (
                    <button
                      key={direction.id}
                      type="button"
                      onClick={() => setSelectedDirectionId(active ? null : direction.id)}
                      className={`w-full rounded-2xl border p-4 text-left transition-all ${
                        active
                          ? 'border-accent-indigo bg-accent-indigo/10'
                          : 'border-border-subtle bg-bg-card hover:border-accent-indigo/40'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-black text-text-primary truncate">{direction.name}</div>
                          <div className="mt-1 text-xs text-text-tertiary">
                            主推 {direction.main_variant_name || '未指定'}{direction.content_style ? ` · ${direction.content_style}` : ''}
                          </div>
                        </div>
                        {directionStatusTag(direction.status)}
                      </div>
                      <div className="mt-3 text-sm text-text-primary whitespace-pre-wrap">{direction.direction_brief || '未写方向说明'}</div>
                      {direction.extra_requirements && (
                        <div className="mt-2 text-xs text-text-tertiary whitespace-pre-wrap">限制：{direction.extra_requirements}</div>
                      )}
                      <div className="mt-3 text-xs text-text-tertiary">
                        批次 {direction.batch_count}{direction.latest_batch_status ? ` · 最近状态 ${batchStatusLabels[direction.latest_batch_status]}` : ''}
                      </div>
                    </button>
                  )
                })}
              </CardContent>
            </Card>
          )}

          {activeWorkspaceTab === 'batches' && (
          <>
          <Card className="border-border-subtle/70">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FlaskConical size={18} className="text-accent-indigo" />
                发起批次
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {!selectedProject ? (
                <div className="py-6 text-center text-text-tertiary">请先创建或选择一个大项目。</div>
              ) : (
                <>
                  <div className="rounded-2xl border border-accent-indigo/20 bg-accent-indigo/10 p-4">
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="text-xs uppercase tracking-[0.18em] text-accent-indigo font-black">当前挂靠</div>
                        <div className="mt-2 font-bold text-text-primary">
                          {selectedProject.name}
                          {selectedDirection ? ` / ${selectedDirection.name}` : ' / 未指定方向单'}
                        </div>
                      </div>
                      {selectedDirection && (
                        <Button variant="ghost" onClick={() => setSelectedDirectionId(null)}>
                          清空方向单
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <XHSCategorySelectField
                      label="品类"
                      value={batchForm.category_id}
                      onChange={(value) => setBatchForm((prev) => ({ ...prev, category_id: value }))}
                      customPlaceholder="请输入其它品类，例如：线下服务"
                    />
                    <label className="space-y-2 text-sm">
                      <span className="font-medium text-text-primary">运行模式</span>
                      <select
                        value={batchForm.run_mode}
                        onChange={(e) => setBatchForm((prev) => ({ ...prev, run_mode: e.target.value as 'trial' | 'full' }))}
                        className="w-full rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2 text-text-primary"
                      >
                        <option value="trial">试跑</option>
                        <option value="full">全量</option>
                      </select>
                    </label>
                    <label className="space-y-2 text-sm">
                      <span className="font-medium text-text-primary">方向单</span>
                      <select
                        value={selectedDirectionId || ''}
                        onChange={(e) => setSelectedDirectionId(e.target.value || null)}
                        className="w-full rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2 text-text-primary"
                      >
                        <option value="">不挂方向单</option>
                        {directions.map((direction) => (
                          <option key={direction.id} value={direction.id}>{direction.name}</option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {batchForm.run_mode === 'trial' && (
                    <label className="space-y-2 text-sm block">
                      <span className="font-medium text-text-primary">试跑样本数</span>
                      <input
                        type="number"
                        min={1}
                        value={batchForm.trial_sample_count || 3}
                        onChange={(e) => setBatchForm((prev) => ({ ...prev, trial_sample_count: Number(e.target.value || 1) }))}
                        className="w-full rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2 text-text-primary"
                      />
                    </label>
                  )}

                  <div className="rounded-2xl border border-border-subtle bg-bg-elevated/30 p-4 space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-medium text-text-primary">配置资产</div>
                        <div className="mt-1 text-xs text-text-tertiary">按当前品类拉取已启用版本。</div>
                      </div>
                      {loadingConfigs && (
                        <div className="inline-flex items-center gap-2 text-xs text-text-tertiary">
                          <Loader2 size={14} className="animate-spin" />
                          加载中
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <label className="space-y-2 text-sm">
                        <span className="font-medium text-text-primary">规则包版本</span>
                        <select
                          value={batchForm.rule_pack_version || ''}
                          onChange={(e) => setBatchForm((prev) => ({ ...prev, rule_pack_version: e.target.value || undefined }))}
                          className="w-full rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2 text-text-primary"
                        >
                          <option value="">不指定</option>
                          {rulePacks.map((pack) => (
                            <option key={pack.id} value={pack.version}>{pack.name} / {pack.version}</option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-2 text-sm">
                        <span className="font-medium text-text-primary">品牌素材版本</span>
                        <select
                          value={batchForm.brand_pack_version || ''}
                          onChange={(e) => setBatchForm((prev) => ({ ...prev, brand_pack_version: e.target.value || undefined }))}
                          className="w-full rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2 text-text-primary"
                        >
                          <option value="">不指定</option>
                          {brandPacks.map((pack) => (
                            <option key={pack.id} value={pack.version}>{pack.brand_name} / {pack.version}</option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-2 text-sm">
                        <span className="font-medium text-text-primary">提炼包版本</span>
                        <select
                          value={batchForm.brief_pack_id || ''}
                          onChange={(e) => setBatchForm((prev) => ({ ...prev, brief_pack_id: e.target.value || undefined }))}
                          className="w-full rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2 text-text-primary"
                        >
                          <option value="">不指定</option>
                          {briefPacks.map((pack) => (
                            <option key={pack.id} value={pack.id}>{pack.brand_name} / {pack.version}</option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-2 text-sm">
                        <span className="font-medium text-text-primary">风险经验版本</span>
                        <select
                          value={batchForm.risk_pack_version || ''}
                          onChange={(e) => setBatchForm((prev) => ({ ...prev, risk_pack_version: e.target.value || undefined }))}
                          className="w-full rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2 text-text-primary"
                        >
                          <option value="">不指定</option>
                          {riskPacks.map((pack) => (
                            <option key={pack.id} value={pack.version}>{pack.name} / {pack.version}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {inputTypeOptions.map((option) => {
                      const active = batchForm.input_type === option.value
                      const Icon = option.value === 'text' ? FileText : option.value === 'file' ? UploadCloud : Link2
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setBatchForm((prev) => ({ ...prev, input_type: option.value }))}
                          className={`rounded-2xl border p-4 text-left transition-all ${
                            active ? 'border-accent-indigo bg-accent-indigo/10' : 'border-border-subtle bg-bg-card hover:border-accent-indigo/40'
                          }`}
                        >
                          <div className="flex items-center gap-2 text-text-primary font-bold">
                            <Icon size={16} className={active ? 'text-accent-indigo' : 'text-text-tertiary'} />
                            {option.label}
                          </div>
                          <div className="mt-2 text-xs text-text-tertiary leading-5">{option.hint}</div>
                        </button>
                      )
                    })}
                  </div>

                  {batchForm.input_type === 'text' && (
                    <label className="space-y-2 text-sm block">
                      <span className="font-medium text-text-primary">原始文本</span>
                      <textarea
                        value={batchForm.input_text || ''}
                        onChange={(e) => setBatchForm((prev) => ({ ...prev, input_text: e.target.value, file_id: undefined, feishu_url: undefined }))}
                        placeholder={currentInputPlaceholder}
                        rows={10}
                        className="w-full rounded-2xl border border-border-subtle bg-bg-elevated px-3 py-3 text-sm text-text-primary"
                      />
                    </label>
                  )}

                  {batchForm.input_type === 'file' && (
                    <div className="space-y-3">
                      <div className="rounded-2xl border border-dashed border-border-subtle bg-bg-elevated/40 p-4">
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div>
                            <div className="font-medium text-text-primary">上传文档</div>
                            <div className="mt-1 text-xs text-text-tertiary">支持 txt / docx / pdf / xlsx。</div>
                          </div>
                          <label className="inline-flex">
                            <input
                              type="file"
                              accept=".txt,.doc,.docx,.pdf,.xls,.xlsx"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0]
                                if (file) void handleFileUpload(file)
                                e.currentTarget.value = ''
                              }}
                            />
                            <span className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium ${
                              uploading ? 'bg-bg-card text-text-tertiary' : 'bg-accent-indigo text-white cursor-pointer'
                            }`}>
                              {uploading ? <Loader2 size={15} className="animate-spin" /> : <UploadCloud size={15} />}
                              {uploading ? '上传中' : '选择文件'}
                            </span>
                          </label>
                        </div>
                      </div>

                      {(batchForm.file_id || uploadedFileName) && (
                        <div className="rounded-2xl border border-accent-green/20 bg-accent-green/10 p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className="text-xs uppercase tracking-[0.18em] text-accent-green font-black">当前文件</div>
                              <div className="mt-2 font-medium text-text-primary truncate">{uploadedFileName || '已填写文件引用'}</div>
                              <div className="mt-1 text-xs text-text-tertiary break-all">{batchForm.file_id}</div>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setBatchForm((prev) => ({ ...prev, file_id: undefined }))
                                setUploadedFileName(null)
                              }}
                              className="text-text-tertiary hover:text-text-primary"
                            >
                              <X size={16} />
                            </button>
                          </div>
                        </div>
                      )}

                      <label className="space-y-2 text-sm block">
                        <span className="font-medium text-text-primary">或手动填写文件引用</span>
                        <input
                          value={batchForm.file_id || ''}
                          onChange={(e) => {
                            setBatchForm((prev) => ({ ...prev, file_id: e.target.value, input_text: undefined, feishu_url: undefined }))
                            setUploadedFileName(null)
                          }}
                          placeholder={currentInputPlaceholder}
                          className="w-full rounded-2xl border border-border-subtle bg-bg-elevated px-3 py-2.5 text-text-primary"
                        />
                      </label>
                    </div>
                  )}

                  {batchForm.input_type === 'feishu_link' && (
                    <label className="space-y-2 text-sm block">
                      <span className="font-medium text-text-primary">飞书链接</span>
                      <input
                        value={batchForm.feishu_url || ''}
                        onChange={(e) => setBatchForm((prev) => ({ ...prev, feishu_url: e.target.value, input_text: undefined, file_id: undefined }))}
                        placeholder={currentInputPlaceholder}
                        className="w-full rounded-2xl border border-border-subtle bg-bg-elevated px-3 py-2.5 text-text-primary"
                      />
                    </label>
                  )}

                  <div className="flex flex-wrap items-center gap-3">
                    <Button variant="secondary" onClick={handleEstimate} loading={estimating} icon={Hash}>
                      预估成本
                    </Button>
                    <Button onClick={handleCreateBatch} loading={submittingBatch} icon={Sparkles}>
                      创建批次
                    </Button>
                  </div>

                  {estimate && (
                    <div className="rounded-2xl border border-accent-green/20 bg-accent-green/10 p-4">
                      <div className="text-xs uppercase tracking-[0.2em] text-accent-green font-black">估算快照</div>
                      <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <div className="text-text-tertiary">预计处理篇数</div>
                          <div className="text-xl font-black text-text-primary">{estimate.estimated_items}</div>
                        </div>
                        <div>
                          <div className="text-text-tertiary">切分总篇数</div>
                          <div className="text-xl font-black text-text-primary">{estimate.total_split_items}</div>
                        </div>
                        <div>
                          <div className="text-text-tertiary">预计 Tokens</div>
                          <div className="text-xl font-black text-text-primary">{estimate.estimated_tokens}</div>
                        </div>
                        <div>
                          <div className="text-text-tertiary">预计成本</div>
                          <div className="text-xl font-black text-text-primary">{estimate.estimated_cost}</div>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card className="border-border-subtle/70">
            <CardHeader>
              <CardTitle>批次列表</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {loadingBatches ? (
                <div className="py-10 flex items-center justify-center text-text-tertiary">
                  <Loader2 size={18} className="animate-spin mr-2" />
                  加载中
                </div>
              ) : batches.length === 0 ? (
                <div className="py-10 text-center text-text-tertiary">当前筛选下还没有批次。</div>
              ) : batches.map((batch) => {
                const metrics = getXHSBatchDisplayMetrics(batch)
                return (
                  <Link key={batch.id} href={`${xhsBasePath}/${batch.id}`} className="block">
                    <div className="rounded-2xl border border-border-subtle bg-bg-card px-4 py-4 transition-all hover:border-accent-indigo/40 hover:shadow-sm">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-black text-text-primary">{batch.id}</span>
                            {batchStatusTag(displayBatchStatus(batch))}
                          </div>
                          <div className="text-xs text-text-tertiary">
                            {(batch.project_name || '未挂项目')} · {(batch.direction_name || '未挂方向单')} · {runModeLabels[batch.run_mode]} · {inputTypeLabels[batch.input_type]}
                          </div>
                        </div>
                        <div className="text-sm text-text-secondary md:text-right">
                          <div>已处理 {metrics.processedItems}/{metrics.plannedItems}</div>
                          <div>通过 {metrics.passedItems} · 待决定 {metrics.decisionItems} · 失败 {metrics.failedItems} · 进行中 {metrics.runningItems}</div>
                          {batch.safe_rewrite_items > 0 && <div>兜底改写 {batch.safe_rewrite_items}</div>}
                        </div>
                      </div>
                      <div className="mt-3">
                        <div className="h-2 rounded-full bg-bg-elevated overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-accent-indigo to-accent-green" style={{ width: `${metrics.progress}%` }} />
                        </div>
                      </div>
                    </div>
                  </Link>
                )
              })}
            </CardContent>
          </Card>
          </>
          )}
        </div>
      </div>
    </div>
  )
}
