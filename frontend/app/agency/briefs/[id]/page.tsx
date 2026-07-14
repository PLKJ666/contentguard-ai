'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { SuccessTag } from '@/components/ui/Tag'
import {
  ArrowLeft,
  FileText,
  Download,
  Eye,
  Target,
  Ban,
  AlertTriangle,
  Sparkles,
  FileDown,
  CheckCircle,
  Clock,
  Building2,
  Info,
  Plus,
  X,
  Save,
  Upload,
  Trash2,
  File,
  Loader2,
  Search,
  AlertCircle,
  RotateCcw,
  Users,
  UserPlus
} from 'lucide-react'
import { getPlatformInfo } from '@/lib/platforms'
import { api, extractErrorMessage, isTimeoutError } from '@/lib/api'
import { formatTaskDisplayName } from '@/lib/taskDisplay'
import { mergeParsedRequirements } from '@/lib/operatorBrief'
import { useAuth } from '@/contexts/AuthContext'
import type { RuleConflict, ParsedRulesData } from '@/types/rules'

// 单个文件上传状态
interface UploadingFileItem {
  id: string
  name: string
  size: string
  status: 'uploading' | 'error'
  progress: number
  error?: string
  file?: File
}
import type { BriefResponse, BriefAttachment, CreativeRubric, RubricDimension } from '@/types/brief'
import type { ProjectResponse } from '@/types/project'
import type { TaskResponse } from '@/types/task'
import type { CreatorDetail } from '@/types/organization'
import { mapTaskToUI } from '@/lib/taskStageMapper'

// 文件类型
type BriefFile = {
  id: string
  name: string
  type: 'brief' | 'rule' | 'reference'
  size: string
  uploadedAt: string
  url?: string
}

// 代理商上传的Brief文档（可编辑）
type AgencyFile = {
  id: string
  name: string
  size: string
  uploadedAt: string
  description?: string
  url?: string
}

// ==================== 视图类型 ====================
interface BrandBriefView {
  id: string
  projectName: string
  brandName: string
  platform: string
  files: BriefFile[]
  brandRules: {
    restrictions: string
    competitors: string[]
  }
}

type AgencyConfigView = {
  status: 'pending' | 'configured'
  configuredAt: string
  agencyFiles: AgencyFile[]
  aiParsedContent: { productName: string; targetAudience: string; contentRequirements: string }
  sellingPoints: Array<{
    id: string
    content: string
    priority: 'core' | 'recommended' | 'reference'
  }>
  blacklistWords: Array<{
    id: string
    word: string
    reason: string
  }>
}

const initialBrandBrief: BrandBriefView = {
  id: '',
  projectName: '',
  brandName: '',
  platform: 'douyin',
  files: [],
  brandRules: { restrictions: '', competitors: [] },
}

const initialAgencyConfig: AgencyConfigView = {
  status: 'pending',
  configuredAt: '',
  agencyFiles: [],
  aiParsedContent: {
    productName: '待解析',
    targetAudience: '待解析',
    contentRequirements: '待解析',
  },
  sellingPoints: [],
  blacklistWords: [],
}

// 平台规则类型
interface PlatformRuleCategory {
  category: string
  items: string[]
}

// 将后端 ParsedRulesData 转为 UI 展示格式
function parsedRulesToCategories(parsed: ParsedRulesData): PlatformRuleCategory[] {
  const categories: PlatformRuleCategory[] = []
  if (parsed.forbidden_words?.length) {
    categories.push({ category: '违禁词', items: parsed.forbidden_words })
  }
  if (parsed.restricted_words?.length) {
    categories.push({ category: '限制用语', items: parsed.restricted_words.map(w => w.word) })
  }
  if (parsed.content_requirements?.length) {
    categories.push({ category: '内容要求', items: parsed.content_requirements })
  }
  if (parsed.other_rules?.length) {
    categories.push({ category: '其他规则', items: parsed.other_rules.map(r => r.rule) })
  }
  return categories
}

// ==================== 工具函数 ====================

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + 'MB'
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + 'GB'
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

function 清理解析占位值(value: string): string {
  const normalized = value.trim()
  return normalized === '待解析' ? '' : normalized
}

// ==================== 组件 ====================

function BriefDetailSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 bg-bg-elevated rounded-full" />
        <div className="flex-1">
          <div className="h-6 w-48 bg-bg-elevated rounded" />
          <div className="h-4 w-32 bg-bg-elevated rounded mt-2" />
        </div>
        <div className="h-10 w-24 bg-bg-elevated rounded-lg" />
        <div className="h-10 w-24 bg-bg-elevated rounded-lg" />
      </div>
      <div className="h-20 bg-bg-elevated rounded-lg" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 h-48 bg-bg-elevated rounded-xl" />
        <div className="h-48 bg-bg-elevated rounded-xl" />
      </div>
      <div className="h-20 bg-bg-elevated rounded-lg" />
      <div className="h-48 bg-bg-elevated rounded-xl" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="h-40 bg-bg-elevated rounded-xl" />
          <div className="h-48 bg-bg-elevated rounded-xl" />
        </div>
        <div className="h-64 bg-bg-elevated rounded-xl" />
      </div>
    </div>
  )
}

export default function BriefConfigPage() {
  const router = useRouter()
  const params = useParams()
  const toast = useToast()
  const { user } = useAuth()
  const projectId = params.id as string
  const agencyFileInputRef = useRef<HTMLInputElement>(null)

  // 上传中的文件跟踪
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFileItem[]>([])

  // 加载状态
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // 品牌方 Brief（只读）
  const [brandBrief, setBrandBrief] = useState<BrandBriefView>(initialBrandBrief)
  const [brandId, setBrandId] = useState<string>('')

  // 代理商配置（可编辑）
  const [agencyConfig, setAgencyConfig] = useState<AgencyConfigView>(initialAgencyConfig)
  const [newSellingPoint, setNewSellingPoint] = useState('')
  const [newBlacklistWord, setNewBlacklistWord] = useState('')
  const [minSellingPoints, setMinSellingPoints] = useState<number | null>(null)

  // Creative Rubric
  const [creativeRubric, setCreativeRubric] = useState<CreativeRubric | null>(null)
  const [rubricExpanded, setRubricExpanded] = useState(false)

  // 弹窗状态
  const [showFilesModal, setShowFilesModal] = useState(false)
  const [showAgencyFilesModal, setShowAgencyFilesModal] = useState(false)
  const [previewFile, setPreviewFile] = useState<BriefFile | null>(null)
  const [previewAgencyFile, setPreviewAgencyFile] = useState<AgencyFile | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isAIParsing, setIsAIParsing] = useState(false)
  const isUploading = uploadingFiles.some(f => f.status === 'uploading')

  // 动态平台规则
  const [dynamicPlatformRules, setDynamicPlatformRules] = useState<PlatformRuleCategory[]>([])
  const [platformRuleName, setPlatformRuleName] = useState('')

  // 任务管理
  const [projectTasks, setProjectTasks] = useState<TaskResponse[]>([])
  const [availableCreators, setAvailableCreators] = useState<CreatorDetail[]>([])
  const [showCreatorModal, setShowCreatorModal] = useState(false)
  const [creatingTask, setCreatingTask] = useState(false)

  // 规则冲突检测
  const [isCheckingConflicts, setIsCheckingConflicts] = useState(false)
  const [showConflictModal, setShowConflictModal] = useState(false)
  const [ruleConflicts, setRuleConflicts] = useState<RuleConflict[]>([])
  const [showPlatformSelect, setShowPlatformSelect] = useState(false)

  const platformDropdownRef = useRef<HTMLDivElement>(null)

  const platformSelectOptions = [
    { value: 'douyin', label: '抖音' },
    { value: 'xiaohongshu', label: '小红书' },
    { value: 'bilibili', label: 'B站' },
  ]

  // 点击外部关闭平台选择下拉
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (platformDropdownRef.current && !platformDropdownRef.current.contains(e.target as Node)) {
        setShowPlatformSelect(false)
      }
    }
    if (showPlatformSelect) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showPlatformSelect])

  const handleCreateTask = async (creatorId: string) => {
    setCreatingTask(true)
    try {
      await api.createTask({ project_id: projectId, creator_id: creatorId })
      const tasksResp = await api.listTasks(1, 100, undefined, projectId)
      setProjectTasks(tasksResp.items)
      toast.success('任务创建成功')
      setShowCreatorModal(false)
    } catch {
      toast.error('创建任务失败')
    } finally {
      setCreatingTask(false)
    }
  }

  const handleCheckConflicts = async (platform: string) => {
    setShowPlatformSelect(false)
    setIsCheckingConflicts(true)

    try {
      if (!brandId) {
        toast.error('缺少品牌信息，无法进行规则冲突检测')
        return
      }
      const briefRules: Record<string, unknown> = {
        selling_points: agencyConfig.sellingPoints.map(sp => sp.content),
      }
      const result = await api.validateRules({
        brand_id: brandId,
        platform,
        brief_rules: briefRules,
      })
      setRuleConflicts(result.conflicts)
      if (result.conflicts.length > 0) {
        setShowConflictModal(true)
      } else {
        toast.success('未发现规则冲突')
      }
    } catch (err) {
      console.error('规则冲突检测失败:', err)
      toast.error('规则冲突检测失败')
    } finally {
      setIsCheckingConflicts(false)
    }
  }

  // 加载数据
  const loadData = useCallback(async () => {
    try {
      // 1. 获取项目信息
      const project = await api.getProject(projectId)
      setBrandId(project.brand_id || '')

      // 2. 获取 Brief
      let brief: BriefResponse | null = null
      try {
        brief = await api.getBrief(projectId)
      } catch {
        // Brief 不存在，保持空状态
      }

      // 映射到品牌方 Brief 视图
      const briefFiles: BriefFile[] = brief?.attachments?.map((att, i) => ({
        id: att.id || `att-${i}`,
        name: att.name,
        type: 'brief' as const,
        size: att.size || '未知',
        uploadedAt: brief!.created_at.split('T')[0],
        url: att.url,
      })) || []

      if (brief?.file_name) {
        briefFiles.unshift({
          id: 'main-file',
          name: brief.file_name,
          type: 'brief' as const,
          size: '未知',
          uploadedAt: brief.created_at.split('T')[0],
          url: brief.file_url || undefined,
        })
      }

      setBrandBrief({
        id: brief?.id || `no-brief-${projectId}`,
        projectName: project.name,
        brandName: project.brand_name || '未知品牌',
        platform: project.platform || 'douyin',
        files: briefFiles,
        brandRules: {
          restrictions: brief?.other_requirements || '暂无限制条件',
          competitors: brief?.competitors || [],
        },
      })

      // 映射到代理商配置视图
      const hasBrief = !!(brief?.product_name || brief?.selling_points?.length || brief?.blacklist_words?.length || brief?.other_requirements)

      // 加载最少卖点数配置
      if (brief?.min_selling_points != null) {
        setMinSellingPoints(brief.min_selling_points)
      }

      // 加载 Creative Rubric
      if (brief?.creative_rubric) {
        setCreativeRubric(brief.creative_rubric)
      }

      setAgencyConfig({
        status: hasBrief ? 'configured' : 'pending',
        configuredAt: hasBrief ? (brief!.updated_at.split('T')[0]) : '',
        agencyFiles: (brief?.agency_attachments || []).map((att: any) => ({
          id: att.id || `af-${Math.random().toString(36).slice(2, 6)}`,
          name: att.name,
          size: att.size || '未知',
          uploadedAt: brief!.updated_at?.split('T')[0] || '',
          url: att.url,
        })),
        aiParsedContent: (() => {
          const parsedRequirements = 解析其他要求(brief?.other_requirements)
          const legacyToneParts = (brief?.brand_tone || '').split('\n').map((part) => part.trim()).filter(Boolean)
          const productName = brief?.product_name || legacyToneParts[0] || ''
          const targetAudience = parsedRequirements.targetAudience || legacyToneParts[1] || ''
          const contentRequirements = parsedRequirements.contentRequirements || brief?.other_requirements || ''
          return {
            productName: productName || '待解析',
            targetAudience: targetAudience || '待解析',
            contentRequirements: contentRequirements
              || (brief?.min_duration && brief?.max_duration
                ? `视频时长 ${brief.min_duration}-${brief.max_duration} 秒`
                : '待解析'),
          }
        })(),
        sellingPoints: (brief?.selling_points || []).map((sp, i) => ({
          id: `sp-${i}`,
          content: sp.content,
          priority: (sp.priority || (sp.required ? 'core' : 'recommended')) as 'core' | 'recommended' | 'reference',
        })),
        blacklistWords: (brief?.blacklist_words || []).map((bw, i) => ({
          id: `bw-${i}`,
          word: bw.word,
          reason: bw.reason,
        })),
      })

      // 3. 获取平台规则
      const platformKey = project.platform || 'douyin'
      const platformInfo = getPlatformInfo(platformKey)
      setPlatformRuleName(platformInfo?.name || platformKey)
      try {
        const rulesResp = await api.listBrandPlatformRules({ platform: platformKey, status: 'active', brand_id: project.brand_id || undefined })
        if (rulesResp.items.length > 0) {
          const categories = parsedRulesToCategories(rulesResp.items[0].parsed_rules)
          if (categories.length > 0) {
            setDynamicPlatformRules(categories)
          }
        }
      } catch (e) {
        console.warn('获取平台规则失败:', e)
      }

      // 4. 获取项目任务列表
      try {
        const tasksResp = await api.listTasks(1, 100, undefined, projectId)
        setProjectTasks(tasksResp.items)
      } catch (e) {
        console.warn('获取项目任务列表失败:', e)
      }

      // 5. 获取可选达人列表
      try {
        const creatorsResp = await api.listAgencyCreators()
        setAvailableCreators(creatorsResp.items)
      } catch (e) {
        console.warn('获取达人列表失败:', e)
      }
    } catch (err) {
      console.error('加载 Brief 详情失败:', err)
      toast.error('加载 Brief 详情失败')
    } finally {
      setLoading(false)
    }
  }, [projectId, toast])

  useEffect(() => {
    loadData()
  }, [loadData])

  const platform = getPlatformInfo(brandBrief.platform)

  // 下载文件
  const handleDownload = async (file: BriefFile) => {
    if (!file.url) {
      toast.error('文件缺少下载地址')
      return
    }
    try {
      await api.downloadFile(file.url, file.name)
    } catch {
      toast.error('下载失败')
    }
  }

  // 预览文件
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const handlePreview = async (file: BriefFile) => {
    setPreviewFile(file)
    setPreviewUrl(null)
    if (!file.url) return
    setPreviewLoading(true)
    try {
      const blobUrl = await api.getPreviewUrl(file.url)
      setPreviewUrl(blobUrl)
    } catch {
      toast.error('获取预览链接失败')
    } finally {
      setPreviewLoading(false)
    }
  }

  // 导出平台规则文档
  const handleExportRules = async () => {
    setIsExporting(true)
    await new Promise(resolve => setTimeout(resolve, 1500))
    setIsExporting(false)
    toast.success('平台规则文档已导出！')
  }

  // AI 解析
  const handleAIParse = async () => {
    setIsAIParsing(true)

    try {
      const result = await api.parseBrief(projectId)

      // 更新 AI 解析结果
      setAgencyConfig(prev => ({
        ...prev,
        aiParsedContent: {
          productName: result.product_name || prev.aiParsedContent.productName,
          targetAudience: result.target_audience || prev.aiParsedContent.targetAudience,
          contentRequirements: result.content_requirements || prev.aiParsedContent.contentRequirements,
        },
        // 如果 AI 解析出了卖点且当前没有卖点，则自动填充
        sellingPoints: result.selling_points?.length
          ? result.selling_points.map((sp, i) => ({
            id: `sp-ai-${i}`,
            content: sp.content,
            priority: ((sp as any).priority || (sp.required ? 'core' : 'recommended')) as 'core' | 'recommended' | 'reference',
          }))
          : prev.sellingPoints,
        // 如果 AI 解析出了违禁词且当前没有违禁词，则自动填充
        blacklistWords: result.blacklist_words?.length
          ? result.blacklist_words.map((bw, i) => ({
            id: `bw-ai-${i}`,
            word: bw.word,
            reason: bw.reason,
          }))
          : prev.blacklistWords,
      }))

      // AI 解析成功后自动保存到后端
      try {
        await api.updateBriefByAgency(projectId, {
          product_name: result.product_name || undefined,
          other_requirements: mergeParsedRequirements(
            result.target_audience || '',
            result.content_requirements || ''
          ) || undefined,
          selling_points: result.selling_points?.length
            ? result.selling_points.map(sp => ({ content: sp.content, priority: (sp as any).priority || (sp.required ? 'core' : 'recommended') })) as any
            : undefined,
          blacklist_words: result.blacklist_words?.length
            ? result.blacklist_words.map(bw => ({ word: bw.word, reason: bw.reason }))
            : undefined,
        })
      } catch (e) {
        console.warn('保存 AI 解析结果失败:', e)
      }

      toast.success('AI 解析完成！')
    } catch (err) {
      if (isTimeoutError(err)) {
        toast.error('AI 解析超时，后台可能仍在处理中。请稍后重试。')
      } else {
        toast.error('AI 解析失败：' + (extractErrorMessage(err) || '请检查 AI 配置或重试'))
      }
    } finally {
      setIsAIParsing(false)
    }
  }

  // 保存配置
  const handleSave = async () => {
    setIsSaving(true)
    try {
      // 代理商通过专用 PATCH 端点保存
      await api.updateBriefByAgency(projectId, {
        product_name: 清理解析占位值(agencyConfig.aiParsedContent.productName) || undefined,
        other_requirements: mergeParsedRequirements(
          清理解析占位值(agencyConfig.aiParsedContent.targetAudience),
          清理解析占位值(agencyConfig.aiParsedContent.contentRequirements),
        ) || undefined,
        selling_points: agencyConfig.sellingPoints.map(sp => ({
          content: sp.content,
          priority: sp.priority,
        })) as any,
        blacklist_words: agencyConfig.blacklistWords.map(bw => ({
          word: bw.word,
          reason: bw.reason,
        })),
        agency_attachments: agencyConfig.agencyFiles.map(f => ({
          id: f.id,
          name: f.name,
          url: f.url || '',
          size: f.size,
        })),
        min_selling_points: minSellingPoints,
        creative_rubric: creativeRubric,
      } as any)
      toast.success('配置已保存！')
    } catch (err) {
      console.error('保存 Brief 失败:', err)
      toast.error('保存配置失败')
    } finally {
      setIsSaving(false)
    }
  }

  // 卖点操作
  const addSellingPoint = () => {
    if (!newSellingPoint.trim()) return
    setAgencyConfig(prev => ({
      ...prev,
      sellingPoints: [...prev.sellingPoints, { id: `sp${Date.now()}`, content: newSellingPoint, priority: 'recommended' as const }]
    }))
    setNewSellingPoint('')
  }

  const removeSellingPoint = (id: string) => {
    setAgencyConfig(prev => ({
      ...prev,
      sellingPoints: prev.sellingPoints.filter(sp => sp.id !== id)
    }))
  }

  const cyclePriority = (id: string) => {
    const order: Array<'core' | 'recommended' | 'reference'> = ['core', 'recommended', 'reference']
    setAgencyConfig(prev => ({
      ...prev,
      sellingPoints: prev.sellingPoints.map(sp => {
        if (sp.id !== id) return sp
        const idx = order.indexOf(sp.priority)
        return { ...sp, priority: order[(idx + 1) % order.length] }
      })
    }))
  }

  // 违禁词操作
  const addBlacklistWord = () => {
    if (!newBlacklistWord.trim()) return
    setAgencyConfig(prev => ({
      ...prev,
      blacklistWords: [...prev.blacklistWords, { id: `bw${Date.now()}`, word: newBlacklistWord, reason: '自定义' }]
    }))
    setNewBlacklistWord('')
  }

  const removeBlacklistWord = (id: string) => {
    setAgencyConfig(prev => ({
      ...prev,
      blacklistWords: prev.blacklistWords.filter(bw => bw.id !== id)
    }))
  }

  // 自动保存代理商附件到后端（防止刷新丢失）
  const autoSaveAgencyFiles = useCallback(async (files: AgencyFile[]) => {
    try {
      await api.updateBriefByAgency(projectId, {
        agency_attachments: files.map(f => ({
          id: f.id, name: f.name, url: f.url || '', size: f.size,
        })),
      })
    } catch (e) {
      console.warn('自动保存代理商附件失败:', e)
    }
  }, [projectId])

  // 上传单个代理商文件
  const uploadSingleAgencyFile = async (file: File, fileId: string) => {
    try {
      const result = await api.proxyUpload(file, 'general', (pct) => {
        setUploadingFiles(prev => prev.map(f => f.id === fileId
          ? { ...f, progress: Math.min(95, Math.round(pct * 0.95)) }
          : f
        ))
      })
      const newFile: AgencyFile = {
        id: fileId, name: file.name, size: formatFileSize(file.size),
        uploadedAt: new Date().toISOString().split('T')[0], url: result.url,
      }
      setAgencyConfig(prev => {
        const updated = [...prev.agencyFiles, newFile]
        // 文件上传成功后自动保存到后端
        autoSaveAgencyFiles(updated)
        return { ...prev, agencyFiles: updated }
      })
      setUploadingFiles(prev => prev.filter(f => f.id !== fileId))
    } catch (err) {
      const msg = extractErrorMessage(err)
      setUploadingFiles(prev => prev.map(f => f.id === fileId
        ? { ...f, status: 'error', error: msg }
        : f
      ))
    }
  }

  const retryAgencyFileUpload = (fileId: string) => {
    const item = uploadingFiles.find(f => f.id === fileId)
    if (!item?.file) return
    setUploadingFiles(prev => prev.map(f => f.id === fileId
      ? { ...f, status: 'uploading', progress: 0, error: undefined }
      : f
    ))
    uploadSingleAgencyFile(item.file, fileId)
  }

  const removeUploadingFile = (id: string) => {
    setUploadingFiles(prev => prev.filter(f => f.id !== id))
  }

  // 代理商文档操作
  const handleUploadAgencyFile = (e?: React.ChangeEvent<HTMLInputElement>) => {
    if (!e) {
      agencyFileInputRef.current?.click()
      return
    }

    const files = e.target.files
    if (!files || files.length === 0) return

    const fileList = Array.from(files)
    e.target.value = ''
    const newItems: UploadingFileItem[] = fileList.map(file => ({
      id: `af-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name,
      size: formatFileSize(file.size),
      status: 'uploading' as const,
      progress: 0,
      file,
    }))
    setUploadingFiles(prev => [...prev, ...newItems])
    newItems.forEach(item => uploadSingleAgencyFile(item.file!, item.id))
  }

  const removeAgencyFile = (id: string) => {
    setAgencyConfig(prev => {
      const updated = prev.agencyFiles.filter(f => f.id !== id)
      // 删除后也自动保存
      autoSaveAgencyFiles(updated)
      return { ...prev, agencyFiles: updated }
    })
  }

  const [previewAgencyUrl, setPreviewAgencyUrl] = useState<string | null>(null)
  const [previewAgencyLoading, setPreviewAgencyLoading] = useState(false)
  const handlePreviewAgencyFile = async (file: AgencyFile) => {
    setPreviewAgencyFile(file)
    setPreviewAgencyUrl(null)
    if (!file.url) return
    setPreviewAgencyLoading(true)
    try {
      const blobUrl = await api.getPreviewUrl(file.url)
      setPreviewAgencyUrl(blobUrl)
    } catch {
      toast.error('获取预览链接失败')
    } finally {
      setPreviewAgencyLoading(false)
    }
  }

  const handleDownloadAgencyFile = async (file: AgencyFile) => {
    if (!file.url) {
      toast.error('文件缺少下载地址')
      return
    }
    try {
      await api.downloadFile(file.url, file.name)
    } catch {
      toast.error('下载失败')
    }
  }

  if (loading) {
    return <BriefDetailSkeleton />
  }

  return (
    <div className="space-y-6">
      {/* 顶部导航 */}
      <div className="flex items-center gap-4">
        <button type="button" onClick={() => router.back()} className="p-2 hover:bg-bg-elevated rounded-full">
          <ArrowLeft size={20} className="text-text-primary" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-text-primary">{brandBrief.projectName}</h1>
            {platform && (
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${platform.bgColor} ${platform.textColor} border ${platform.borderColor}`}>
                <span>{platform.icon}</span>
                {platform.name}
              </span>
            )}
          </div>
          <p className="text-sm text-text-secondary flex items-center gap-2 mt-1">
            <Building2 size={14} />
            {brandBrief.brandName}
          </p>
        </div>
        <div className="relative" ref={platformDropdownRef}>
          <Button
            variant="secondary"
            onClick={() => setShowPlatformSelect(!showPlatformSelect)}
            disabled={isCheckingConflicts}
          >
            {isCheckingConflicts ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                检测中...
              </>
            ) : (
              <>
                <Search size={16} />
                检查规则冲突
              </>
            )}
          </Button>
          {showPlatformSelect && (
            <div className="absolute right-0 top-full mt-2 w-40 bg-bg-card border border-border-subtle rounded-xl shadow-lg z-50 overflow-hidden">
              {platformSelectOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleCheckConflicts(opt.value)}
                  className="w-full px-4 py-2.5 text-left text-sm text-text-primary hover:bg-bg-elevated transition-colors"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <Button variant="secondary" onClick={handleExportRules} disabled={isExporting}>
          <FileDown size={16} />
          {isExporting ? '导出中...' : '导出规则'}
        </Button>
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          {isSaving ? '保存中...' : '保存配置'}
        </Button>
      </div>

      {/* ===== 第一部分：品牌方 Brief（只读）===== */}
      <div className="p-4 bg-purple-500/10 rounded-lg border border-purple-500/30">
        <div className="flex items-start gap-3">
          <Building2 size={20} className="text-purple-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-purple-400 font-medium">品牌方 Brief（只读）</p>
            <p className="text-sm text-purple-400/80 mt-1">
              以下是品牌方上传的 Brief 文件和规则，仅供参考，不可编辑。
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 品牌方文件 */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <FileText size={18} className="text-purple-400" />
                品牌方 Brief 文件
                <span className="text-sm font-normal text-text-secondary">
                  {brandBrief.files.length} 个文件
                </span>
              </span>
              <Button variant="secondary" size="sm" onClick={() => setShowFilesModal(true)}>
                <Eye size={14} />
                查看全部
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {brandBrief.files.slice(0, 2).map((file) => (
              <div key={file.id} className="flex items-center justify-between p-4 bg-bg-elevated rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-purple-500/15 flex items-center justify-center">
                    <FileText size={20} className="text-purple-400" />
                  </div>
                  <div>
                    <p className="font-medium text-text-primary text-sm">{file.name}</p>
                    <p className="text-xs text-text-secondary">{file.size} · {file.uploadedAt}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => handlePreview(file)}>
                    <Eye size={14} />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDownload(file)}>
                    <Download size={14} />
                  </Button>
                </div>
              </div>
            ))}
            {brandBrief.files.length > 2 && (
              <button
                type="button"
                onClick={() => setShowFilesModal(true)}
                className="w-full p-3 text-sm text-purple-400 hover:bg-purple-500/5 rounded-lg transition-colors"
              >
                查看全部 {brandBrief.files.length} 个文件 →
              </button>
            )}
            {brandBrief.files.length === 0 && (
              <div className="py-8 text-center">
                <FileText size={32} className="mx-auto text-text-tertiary mb-2" />
                <p className="text-sm text-text-secondary">暂无 Brief 文件</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 品牌方规则（只读） */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle size={18} className="text-orange-400" />
              品牌方限制
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-xs text-text-tertiary mb-2">限制条件</p>
              <p className="text-sm text-text-primary">{brandBrief.brandRules.restrictions}</p>
            </div>
            <div>
              <p className="text-xs text-text-tertiary mb-2">竞品黑名单</p>
              <div className="flex flex-wrap gap-2">
                {brandBrief.brandRules.competitors.map((c, i) => (
                  <span key={i} className="px-2 py-1 text-xs bg-orange-500/15 text-orange-400 rounded border border-orange-500/30">
                    {c}
                  </span>
                ))}
                {brandBrief.brandRules.competitors.length === 0 && (
                  <span className="text-sm text-text-tertiary">暂无竞品</span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ===== 任务管理区块 ===== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users size={18} className="text-accent-green" />
            项目任务
            <span className="text-sm font-normal text-text-secondary">
              {projectTasks.length} 个任务
            </span>
          </CardTitle>
          <Button size="sm" onClick={() => setShowCreatorModal(true)}>
            <UserPlus size={14} />
            分配达人
          </Button>
        </CardHeader>
        <CardContent>
          {projectTasks.length > 0 ? (
            <div className="space-y-3">
              {projectTasks.map((task) => {
                const uiState = mapTaskToUI(task)
                return (
                  <div key={task.id} className="flex items-center justify-between p-4 bg-bg-elevated rounded-lg">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-accent-indigo/15 flex items-center justify-center">
                        <span className="text-sm font-bold text-accent-indigo">
                          {task.creator.name.charAt(0)}
                        </span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-text-primary text-sm">
                            {formatTaskDisplayName({
                              taskName: task.name,
                              projectName: task.project?.name,
                              sequence: task.sequence,
                            })}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-text-secondary">
                          <span>达人: {task.creator.name}</span>
                          <span>创建: {task.created_at.split('T')[0]}</span>
                        </div>
                      </div>
                    </div>
                    <span className={`px-2.5 py-1 text-xs font-medium rounded-lg ${
                      uiState.statusLabel === '已完成' ? 'bg-accent-green/15 text-accent-green' :
                      uiState.statusLabel === '已驳回' ? 'bg-accent-coral/15 text-accent-coral' :
                      uiState.statusLabel === '待上传' ? 'bg-yellow-500/15 text-yellow-400' :
                      'bg-accent-indigo/15 text-accent-indigo'
                    }`}>
                      {uiState.statusLabel}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="py-12 text-center">
              <Users size={40} className="mx-auto text-text-tertiary mb-3" />
              <p className="text-text-secondary">暂无任务</p>
              <p className="text-sm text-text-tertiary mt-1">点击「分配达人」创建任务</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 达人选择弹窗 */}
      <Modal
        isOpen={showCreatorModal}
        onClose={() => setShowCreatorModal(false)}
        title="选择达人"
        size="md"
      >
        <div className="space-y-2">
          <p className="text-sm text-text-secondary mb-4">
            选择一位达人为其创建任务。同一达人可多次选择（用于拍摄多个视频）。
          </p>
          {availableCreators.length > 0 ? (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {availableCreators.map((creator) => {
                const taskCount = projectTasks.filter(t => t.creator.id === creator.id).length
                return (
                  <button
                    key={creator.id}
                    type="button"
                    onClick={() => handleCreateTask(creator.id)}
                    disabled={creatingTask}
                    className="w-full flex items-center justify-between p-4 bg-bg-elevated rounded-lg hover:bg-bg-elevated/80 transition-colors disabled:opacity-50"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-accent-indigo/15 flex items-center justify-center">
                        <span className="text-sm font-bold text-accent-indigo">
                          {creator.name.charAt(0)}
                        </span>
                      </div>
                      <div className="text-left">
                        <p className="font-medium text-text-primary text-sm">{creator.name}</p>
                        <p className="text-xs text-text-tertiary">
                          {[creator.douyin_account && '抖音', creator.xiaohongshu_account && '小红书', creator.bilibili_account && 'B站'].filter(Boolean).join(' · ') || '暂无平台账号'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {taskCount > 0 && (
                        <span className="text-xs text-text-tertiary">已有 {taskCount} 个任务</span>
                      )}
                      {creatingTask ? (
                        <Loader2 size={16} className="animate-spin text-accent-indigo" />
                      ) : (
                        <Plus size={16} className="text-text-tertiary" />
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="py-8 text-center">
              <Users size={40} className="mx-auto text-text-tertiary mb-3" />
              <p className="text-text-secondary">暂无可选达人</p>
              <p className="text-sm text-text-tertiary mt-1">请先在「达人管理」中添加达人</p>
            </div>
          )}
        </div>
      </Modal>

      {/* ===== 第二部分：代理商配置（可编辑）===== */}
      <div className="p-4 bg-accent-indigo/10 rounded-lg border border-accent-indigo/30">
        <div className="flex items-start gap-3">
          <Sparkles size={20} className="text-accent-indigo flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-accent-indigo font-medium">代理商配置（可编辑）</p>
            <p className="text-sm text-accent-indigo/80 mt-1">
              以下配置由代理商编辑，将展示给达人查看。
            </p>
          </div>
        </div>
      </div>

      {/* 代理商Brief文档管理 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <File size={18} className="text-accent-indigo" />
              代理商 Brief 文档
              <span className="text-sm font-normal text-text-secondary">
                {agencyConfig.agencyFiles.length} 个文件（达人可见）
              </span>
            </span>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => setShowAgencyFilesModal(true)}>
                <Eye size={14} />
                管理文档
              </Button>
              <Button size="sm" onClick={() => handleUploadAgencyFile()} disabled={isUploading}>
                <Upload size={14} />
                {isUploading ? '上传中...' : '上传文档'}
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {agencyConfig.agencyFiles.map((file) => (
              <div key={file.id} className="p-4 bg-accent-indigo/5 rounded-lg border border-accent-indigo/20 hover:border-accent-indigo/40 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-accent-indigo/15 flex items-center justify-center flex-shrink-0">
                    <FileText size={20} className="text-accent-indigo" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-text-primary text-sm truncate">{file.name}</p>
                    <p className="text-xs text-text-tertiary mt-0.5">{file.size} · {file.uploadedAt}</p>
                    {file.description && (
                      <p className="text-xs text-text-secondary mt-1 line-clamp-2">{file.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border-subtle">
                  <Button variant="ghost" size="sm" onClick={() => handlePreviewAgencyFile(file)} className="flex-1">
                    <Eye size={14} />
                    预览
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDownloadAgencyFile(file)} className="flex-1">
                    <Download size={14} />
                    下载
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => removeAgencyFile(file.id)} className="text-accent-coral hover:text-accent-coral">
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            ))}
            {/* 上传中/失败的文件 */}
            {uploadingFiles.map((file) => (
              <div key={file.id} className="p-4 rounded-lg border border-accent-indigo/20 bg-accent-indigo/5">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-accent-indigo/15 flex items-center justify-center flex-shrink-0">
                    {file.status === 'uploading'
                      ? <Loader2 size={20} className="animate-spin text-accent-indigo" />
                      : <AlertCircle size={20} className="text-accent-coral" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`font-medium text-sm truncate ${file.status === 'error' ? 'text-accent-coral' : 'text-text-primary'}`}>
                      {file.name}
                    </p>
                    <p className="text-xs text-text-tertiary mt-0.5">
                      {file.status === 'uploading' ? `${file.progress}% · ${file.size}` : file.size}
                    </p>
                    {file.status === 'uploading' && (
                      <div className="mt-2 h-1.5 bg-bg-page rounded-full overflow-hidden">
                        <div className="h-full bg-accent-indigo rounded-full transition-all duration-300"
                          style={{ width: `${file.progress}%` }} />
                      </div>
                    )}
                    {file.status === 'error' && file.error && (
                      <p className="mt-1 text-xs text-accent-coral">{file.error}</p>
                    )}
                  </div>
                </div>
                {file.status === 'error' && (
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border-subtle">
                    <Button variant="ghost" size="sm" onClick={() => retryAgencyFileUpload(file.id)} className="flex-1">
                      <RotateCcw size={14} /> 重试
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => removeUploadingFile(file.id)} className="text-accent-coral hover:text-accent-coral">
                      <Trash2 size={14} /> 删除
                    </Button>
                  </div>
                )}
              </div>
            ))}

            {/* 上传占位卡片 */}
            <button
              type="button"
              onClick={() => handleUploadAgencyFile()}
              className="p-4 rounded-lg border-2 border-dashed border-border-subtle hover:border-accent-indigo/50 transition-colors flex flex-col items-center justify-center gap-2 min-h-[140px]"
            >
              <div className="w-10 h-10 rounded-full bg-bg-elevated flex items-center justify-center">
                <Plus size={20} className="text-text-tertiary" />
              </div>
              <span className="text-sm text-text-secondary">上传新文档</span>
            </button>
          </div>
          <div className="mt-4 p-3 bg-accent-indigo/10 rounded-lg border border-accent-indigo/20">
            <p className="text-xs text-accent-indigo flex items-center gap-2">
              <Info size={14} />
              以上文档将展示给达人查看，请确保内容准确完整。
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左侧：AI解析 + 卖点配置 */}
        <div className="lg:col-span-2 space-y-6">
          {/* AI 解析结果 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Sparkles size={18} className="text-purple-400" />
                  AI 解析结果
                </span>
                <Button variant="secondary" size="sm" onClick={handleAIParse} disabled={isAIParsing}>
                  <Sparkles size={14} />
                  {isAIParsing ? '解析中...' : '重新解析'}
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-bg-elevated rounded-lg">
                  <p className="text-xs text-text-tertiary mb-1">产品名称</p>
                  <p className="text-text-primary font-medium">{agencyConfig.aiParsedContent.productName}</p>
                </div>
                <div className="p-3 bg-bg-elevated rounded-lg">
                  <p className="text-xs text-text-tertiary mb-1">目标人群</p>
                  <p className="text-text-primary font-medium">{agencyConfig.aiParsedContent.targetAudience}</p>
                </div>
                <div className="p-3 bg-bg-elevated rounded-lg col-span-2">
                  <p className="text-xs text-text-tertiary mb-1">内容要求</p>
                  <p className="text-text-primary">{agencyConfig.aiParsedContent.contentRequirements}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 卖点配置（可编辑） */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target size={18} className="text-accent-green" />
                卖点配置
                <span className="text-sm font-normal text-text-secondary ml-2">
                  {agencyConfig.sellingPoints.length} 个卖点
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {agencyConfig.sellingPoints.map((sp) => (
                <div key={sp.id} className="flex items-center gap-3 p-3 bg-bg-elevated rounded-lg">
                  <button
                    type="button"
                    onClick={() => cyclePriority(sp.id)}
                    className={`px-2 py-1 text-xs rounded ${
                      sp.priority === 'core' ? 'bg-accent-coral/20 text-accent-coral' :
                      sp.priority === 'recommended' ? 'bg-accent-amber/20 text-accent-amber' :
                      'bg-bg-page text-text-tertiary'
                    }`}
                  >
                    {sp.priority === 'core' ? '核心' : sp.priority === 'recommended' ? '推荐' : '参考'}
                  </button>
                  <span className="flex-1 text-text-primary">{sp.content}</span>
                  <button
                    type="button"
                    onClick={() => removeSellingPoint(sp.id)}
                    className="p-1 hover:bg-bg-page rounded"
                  >
                    <X size={16} className="text-text-tertiary" />
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newSellingPoint}
                  onChange={(e) => setNewSellingPoint(e.target.value)}
                  placeholder="添加新卖点..."
                  className="flex-1 px-3 py-2 border border-border-subtle rounded-lg bg-bg-elevated text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-indigo"
                  onKeyDown={(e) => e.key === 'Enter' && addSellingPoint()}
                />
                <Button variant="secondary" onClick={addSellingPoint}>
                  <Plus size={16} />
                  添加
                </Button>
              </div>
              {/* 最少卖点数配置 */}
              <div className="p-3 bg-bg-elevated rounded-lg border border-border-subtle">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-text-primary">最少体现卖点数</p>
                    <p className="text-xs text-text-tertiary mt-0.5">
                      AI 审核时按此数量计算覆盖率评分，不设置则默认要求覆盖全部核心+推荐卖点
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setMinSellingPoints(prev => prev === null ? Math.max(1, agencyConfig.sellingPoints.filter(sp => sp.priority !== 'reference').length) : prev > 1 ? prev - 1 : prev)}
                      className="w-8 h-8 rounded-lg bg-bg-page border border-border-subtle flex items-center justify-center hover:bg-bg-card transition-colors text-text-secondary"
                    >
                      -
                    </button>
                    <span className="w-10 text-center text-sm font-medium text-text-primary">
                      {minSellingPoints ?? '-'}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const max = agencyConfig.sellingPoints.filter(sp => sp.priority !== 'reference').length
                        setMinSellingPoints(prev => prev === null ? 1 : prev < max ? prev + 1 : prev)
                      }}
                      className="w-8 h-8 rounded-lg bg-bg-page border border-border-subtle flex items-center justify-center hover:bg-bg-card transition-colors text-text-secondary"
                    >
                      +
                    </button>
                    {minSellingPoints !== null && (
                      <button
                        type="button"
                        onClick={() => setMinSellingPoints(null)}
                        className="text-xs text-text-tertiary hover:text-text-secondary ml-1"
                      >
                        重置
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Creative Rubric (内容创作标准) */}
          {creativeRubric && (
            <Card>
              <CardHeader>
                <CardTitle>
                  <button className="flex items-center justify-between w-full cursor-pointer" onClick={() => setRubricExpanded(!rubricExpanded)}>
                    <span className="flex items-center gap-2">
                      <Sparkles size={18} className="text-accent-indigo" />
                      内容创作标准
                      <span className="text-xs font-normal text-text-tertiary ml-1">AI 自动生成</span>
                    </span>
                    {rubricExpanded ? <X size={16} className="text-text-tertiary" /> : <Eye size={16} className="text-text-tertiary" />}
                  </button>
                </CardTitle>
              </CardHeader>
              {rubricExpanded && (
                <CardContent className="space-y-4">
                  {(['tone', 'audience', 'content_style', 'structure'] as const).map(dimKey => {
                    const dim = creativeRubric[dimKey]
                    if (!dim) return null
                    const labelMap = { tone: '语言调性', audience: '目标受众', content_style: '内容风格', structure: '结构要求' }
                    return (
                      <div key={dimKey} className="p-3 bg-bg-elevated rounded-lg space-y-2">
                        <p className="text-sm font-medium text-text-primary">{labelMap[dimKey]}：{dim.name}</p>
                        {dim.do_items.length > 0 && (
                          <div>
                            <p className="text-xs text-accent-green mb-1">推荐做法</p>
                            <div className="space-y-1">
                              {dim.do_items.map((item, i) => (
                                <div key={i} className="flex items-center gap-2 group">
                                  <CheckCircle size={12} className="text-accent-green shrink-0" />
                                  <input
                                    type="text"
                                    value={item}
                                    onChange={(e) => {
                                      const updated = { ...creativeRubric }
                                      const updatedDim = { ...updated[dimKey]! }
                                      updatedDim.do_items = [...updatedDim.do_items]
                                      updatedDim.do_items[i] = e.target.value
                                      updated[dimKey] = updatedDim
                                      setCreativeRubric(updated)
                                    }}
                                    className="flex-1 text-xs text-text-primary bg-transparent border-b border-transparent hover:border-border-subtle focus:border-accent-indigo focus:outline-none py-0.5"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const updated = { ...creativeRubric }
                                      const updatedDim = { ...updated[dimKey]! }
                                      updatedDim.do_items = updatedDim.do_items.filter((_, idx) => idx !== i)
                                      updated[dimKey] = updatedDim
                                      setCreativeRubric(updated)
                                    }}
                                    className="opacity-0 group-hover:opacity-100 p-0.5"
                                  >
                                    <X size={12} className="text-text-tertiary" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {dim.dont_items.length > 0 && (
                          <div>
                            <p className="text-xs text-accent-coral mb-1">避免做法</p>
                            <div className="space-y-1">
                              {dim.dont_items.map((item, i) => (
                                <div key={i} className="flex items-center gap-2 group">
                                  <Ban size={12} className="text-accent-coral shrink-0" />
                                  <input
                                    type="text"
                                    value={item}
                                    onChange={(e) => {
                                      const updated = { ...creativeRubric }
                                      const updatedDim = { ...updated[dimKey]! }
                                      updatedDim.dont_items = [...updatedDim.dont_items]
                                      updatedDim.dont_items[i] = e.target.value
                                      updated[dimKey] = updatedDim
                                      setCreativeRubric(updated)
                                    }}
                                    className="flex-1 text-xs text-text-primary bg-transparent border-b border-transparent hover:border-border-subtle focus:border-accent-indigo focus:outline-none py-0.5"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const updated = { ...creativeRubric }
                                      const updatedDim = { ...updated[dimKey]! }
                                      updatedDim.dont_items = updatedDim.dont_items.filter((_, idx) => idx !== i)
                                      updated[dimKey] = updatedDim
                                      setCreativeRubric(updated)
                                    }}
                                    className="opacity-0 group-hover:opacity-100 p-0.5"
                                  >
                                    <X size={12} className="text-text-tertiary" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </CardContent>
              )}
            </Card>
          )}

          {/* 平台规则 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <AlertTriangle size={18} className="text-accent-amber" />
                  {platformRuleName || platform?.name || ''}平台规则
                </span>
                <Button variant="secondary" size="sm" onClick={handleExportRules} disabled={isExporting}>
                  <FileDown size={14} />
                  导出
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {dynamicPlatformRules.length > 0 ? (
                dynamicPlatformRules.map((rule, index) => (
                  <div key={index}>
                    <p className="text-sm font-medium text-text-primary mb-2">{rule.category}</p>
                    <div className="flex flex-wrap gap-2">
                      {rule.items.map((item, i) => (
                        <span key={i} className="px-2 py-1 text-xs bg-accent-amber/15 text-accent-amber rounded border border-accent-amber/30">
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-8 text-center">
                  <AlertTriangle size={32} className="mx-auto text-text-tertiary mb-2" />
                  <p className="text-sm text-text-secondary">品牌方尚未上传平台规则</p>
                  <p className="text-xs text-text-tertiary mt-1">请联系品牌方在「规则配置」中上传对应平台规则文档</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 右侧：违禁词配置 */}
        <div className="space-y-6">
          {/* 违禁词配置（可编辑） */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Ban size={18} className="text-accent-coral" />
                违禁词配置
                <span className="text-sm font-normal text-text-secondary ml-2">
                  {agencyConfig.blacklistWords.length} 个
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {agencyConfig.blacklistWords.map((bw) => (
                <div key={bw.id} className="flex items-center justify-between p-3 bg-accent-coral/10 rounded-lg border border-accent-coral/30">
                  <div>
                    <span className="font-medium text-accent-coral">{'\u300C'}{bw.word}{'\u300D'}</span>
                    <span className="text-xs text-text-tertiary ml-2">{bw.reason}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeBlacklistWord(bw.id)}
                    className="p-1 hover:bg-accent-coral/20 rounded"
                  >
                    <X size={14} className="text-text-tertiary" />
                  </button>
                </div>
              ))}
              <div className="flex gap-2 mt-3">
                <input
                  type="text"
                  value={newBlacklistWord}
                  onChange={(e) => setNewBlacklistWord(e.target.value)}
                  placeholder="添加违禁词..."
                  className="flex-1 px-3 py-2 border border-border-subtle rounded-lg bg-bg-elevated text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-indigo"
                  onKeyDown={(e) => e.key === 'Enter' && addBlacklistWord()}
                />
                <Button variant="secondary" size="sm" onClick={addBlacklistWord}>
                  <Plus size={14} />
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* 配置信息 */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock size={18} className="text-text-tertiary" />
                配置状态
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-text-secondary">状态</span>
                <SuccessTag>已配置</SuccessTag>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">配置时间</span>
                <span className="text-text-primary">{agencyConfig.configuredAt || '-'}</span>
              </div>
            </CardContent>
          </Card>

          {/* 配置提示 */}
          <div className="p-4 bg-accent-green/10 rounded-lg border border-accent-green/30">
            <div className="flex items-start gap-3">
              <CheckCircle size={20} className="text-accent-green flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-accent-green font-medium">配置说明</p>
                <ul className="text-xs text-accent-green/80 mt-1 space-y-1">
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

      {/* 文件列表弹窗 */}
      <Modal
        isOpen={showFilesModal}
        onClose={() => setShowFilesModal(false)}
        title="品牌方 Brief 文件"
        size="lg"
      >
        <div className="space-y-3">
          {brandBrief.files.map((file) => (
            <div key={file.id} className="flex items-center justify-between p-4 bg-bg-elevated rounded-lg">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-purple-500/15 flex items-center justify-center">
                  <FileText size={24} className="text-purple-400" />
                </div>
                <div>
                  <p className="font-medium text-text-primary">{file.name}</p>
                  <p className="text-sm text-text-secondary">{file.size} · 上传于 {file.uploadedAt}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => handlePreview(file)}>
                  <Eye size={14} />
                  预览
                </Button>
                <Button variant="secondary" size="sm" onClick={() => handleDownload(file)}>
                  <Download size={14} />
                  下载
                </Button>
              </div>
            </div>
          ))}
          {brandBrief.files.length === 0 && (
            <div className="py-12 text-center">
              <FileText size={48} className="mx-auto text-text-tertiary mb-4" />
              <p className="text-text-secondary">暂无文件</p>
            </div>
          )}
        </div>
      </Modal>

      {/* 文件预览弹窗（品牌方） */}
      <Modal
        isOpen={!!previewFile}
        onClose={() => { setPreviewFile(null); if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(null) } }}
        title={previewFile?.name || '文件预览'}
        size="lg"
      >
        <div className="space-y-4">
          <div className="bg-bg-elevated rounded-lg overflow-hidden" style={{ minHeight: '400px' }}>
            {previewLoading ? (
              <div className="flex items-center justify-center h-[400px]">
                <Loader2 className="animate-spin text-accent-indigo" size={32} />
                <span className="ml-2 text-text-secondary">加载预览中...</span>
              </div>
            ) : previewUrl && previewFile?.name.toLowerCase().endsWith('.pdf') ? (
              <iframe
                src={previewUrl}
                className="w-full border-0 rounded-lg"
                style={{ height: '500px' }}
                title={previewFile?.name}
              />
            ) : previewUrl && /\.(jpg|jpeg|png|gif|webp)$/i.test(previewFile?.name || '') ? (
              <div className="flex items-center justify-center p-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewUrl} alt={previewFile?.name} className="max-w-full max-h-[500px] object-contain rounded" />
              </div>
            ) : previewUrl ? (
              <div className="flex flex-col items-center justify-center h-[400px] text-center">
                <FileText size={48} className="text-text-tertiary mb-4" />
                <p className="text-text-secondary mb-1">该文件类型不支持在线预览</p>
                <p className="text-xs text-text-tertiary">请下载后使用本地应用打开</p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-[400px] text-center">
                <FileText size={48} className="text-text-tertiary mb-4" />
                <p className="text-text-secondary">暂无预览链接</p>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setPreviewFile(null); if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(null) } }}>
              关闭
            </Button>
            {previewFile && (
              <Button onClick={() => handleDownload(previewFile)}>
                <Download size={16} />
                下载文件
              </Button>
            )}
          </div>
        </div>
      </Modal>

      {/* 代理商文档管理弹窗 */}
      <Modal
        isOpen={showAgencyFilesModal}
        onClose={() => setShowAgencyFilesModal(false)}
        title="管理代理商 Brief 文档"
        size="lg"
      >
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-text-secondary">
              以下文档将展示给达人查看，可以添加、删除或预览文档
            </p>
            <Button size="sm" onClick={() => handleUploadAgencyFile()} disabled={isUploading}>
              <Upload size={14} />
              {isUploading ? '上传中...' : '上传文档'}
            </Button>
          </div>
          <div className="space-y-3">
            {agencyConfig.agencyFiles.map((file) => (
              <div key={file.id} className="flex items-center justify-between p-4 bg-bg-elevated rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-lg bg-accent-indigo/15 flex items-center justify-center">
                    <FileText size={24} className="text-accent-indigo" />
                  </div>
                  <div>
                    <p className="font-medium text-text-primary">{file.name}</p>
                    <p className="text-sm text-text-secondary">{file.size} · 上传于 {file.uploadedAt}</p>
                    {file.description && (
                      <p className="text-xs text-text-tertiary mt-1">{file.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => handlePreviewAgencyFile(file)}>
                    <Eye size={14} />
                    预览
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => handleDownloadAgencyFile(file)}>
                    <Download size={14} />
                    下载
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => removeAgencyFile(file.id)} className="text-accent-coral hover:text-accent-coral">
                    <Trash2 size={14} />
                    删除
                  </Button>
                </div>
              </div>
            ))}
            {agencyConfig.agencyFiles.length === 0 && (
              <div className="py-12 text-center">
                <File size={48} className="mx-auto text-text-tertiary mb-4" />
                <p className="text-text-secondary">暂无文档</p>
                <p className="text-sm text-text-tertiary mt-1">点击上方按钮上传文档</p>
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* 代理商文档预览弹窗 */}
      <Modal
        isOpen={!!previewAgencyFile}
        onClose={() => { setPreviewAgencyFile(null); if (previewAgencyUrl) { URL.revokeObjectURL(previewAgencyUrl); setPreviewAgencyUrl(null) } }}
        title={previewAgencyFile?.name || '文件预览'}
        size="lg"
      >
        <div className="space-y-4">
          <div className="bg-bg-elevated rounded-lg overflow-hidden" style={{ minHeight: '400px' }}>
            {previewAgencyLoading ? (
              <div className="flex items-center justify-center h-[400px]">
                <Loader2 className="animate-spin text-accent-indigo" size={32} />
                <span className="ml-2 text-text-secondary">加载预览中...</span>
              </div>
            ) : previewAgencyUrl && previewAgencyFile?.name.toLowerCase().endsWith('.pdf') ? (
              <iframe
                src={previewAgencyUrl}
                className="w-full border-0 rounded-lg"
                style={{ height: '500px' }}
                title={previewAgencyFile?.name}
              />
            ) : previewAgencyUrl && /\.(jpg|jpeg|png|gif|webp)$/i.test(previewAgencyFile?.name || '') ? (
              <div className="flex items-center justify-center p-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewAgencyUrl} alt={previewAgencyFile?.name} className="max-w-full max-h-[500px] object-contain rounded" />
              </div>
            ) : previewAgencyUrl ? (
              <div className="flex flex-col items-center justify-center h-[400px] text-center">
                <FileText size={48} className="text-text-tertiary mb-4" />
                <p className="text-text-secondary mb-1">该文件类型不支持在线预览</p>
                <p className="text-xs text-text-tertiary">请下载后使用本地应用打开</p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-[400px] text-center">
                <FileText size={48} className="text-text-tertiary mb-4" />
                <p className="text-text-secondary">暂无预览链接</p>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setPreviewAgencyFile(null); if (previewAgencyUrl) { URL.revokeObjectURL(previewAgencyUrl); setPreviewAgencyUrl(null) } }}>
              关闭
            </Button>
            {previewAgencyFile && (
              <Button onClick={() => handleDownloadAgencyFile(previewAgencyFile)}>
                <Download size={16} />
                下载文件
              </Button>
            )}
          </div>
        </div>
      </Modal>

      {/* 隐藏的文件上传 input */}
      <input
        ref={agencyFileInputRef}
        type="file"
        multiple
        onChange={handleUploadAgencyFile}
        className="hidden"
      />

      {/* 规则冲突检测结果弹窗 */}
      <Modal
        isOpen={showConflictModal}
        onClose={() => setShowConflictModal(false)}
        title="规则冲突检测结果"
        size="lg"
      >
        <div className="space-y-4">
          {ruleConflicts.length === 0 ? (
            <div className="py-8 text-center">
              <CheckCircle size={48} className="mx-auto text-accent-green mb-3" />
              <p className="text-text-primary font-medium">未发现冲突</p>
              <p className="text-sm text-text-secondary mt-1">Brief 内容与平台规则兼容</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 p-3 bg-accent-amber/10 rounded-lg border border-accent-amber/30">
                <AlertTriangle size={16} className="text-accent-amber flex-shrink-0" />
                <p className="text-sm text-accent-amber">
                  发现 {ruleConflicts.length} 处规则冲突，建议在发布前修改
                </p>
              </div>
              {ruleConflicts.map((conflict, index) => (
                <div key={index} className="p-4 bg-bg-elevated rounded-xl border border-border-subtle space-y-2">
                  <div className="flex items-start gap-2">
                    <span className="text-xs font-medium text-accent-amber bg-accent-amber/15 px-2 py-0.5 rounded">Brief</span>
                    <span className="text-sm text-text-primary">{conflict.brief_rule}</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-xs font-medium text-accent-coral bg-accent-coral/15 px-2 py-0.5 rounded">平台</span>
                    <span className="text-sm text-text-primary">{conflict.platform_rule}</span>
                  </div>
                  <div className="flex items-start gap-2 pt-1 border-t border-border-subtle">
                    <span className="text-xs font-medium text-accent-indigo bg-accent-indigo/15 px-2 py-0.5 rounded">建议</span>
                    <span className="text-sm text-text-secondary">{conflict.suggestion}</span>
                  </div>
                </div>
              ))}
            </>
          )}
          <div className="flex justify-end pt-2">
            <Button variant="secondary" onClick={() => setShowConflictModal(false)}>
              关闭
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
