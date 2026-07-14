'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import {
  ArrowLeft,
  FileText,
  Shield,
  Plus,
  Trash2,
  AlertTriangle,
  AlertCircle,
  CheckCircle,
  Bot,
  Users,
  Save,
  Upload,
  ChevronDown,
  ChevronUp,
  Loader2,
  Search,
  RotateCcw
} from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { api, extractErrorMessage } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import type { RuleConflict } from '@/types/rules'
import type { BriefResponse, BriefCreateRequest, SellingPoint, BlacklistWord, BriefAttachment } from '@/types/brief'

// 单个文件的上传状态
interface UploadFileItem {
  id: string
  name: string
  size: string
  status: 'uploading' | 'success' | 'error'
  progress: number
  url?: string
  error?: string
  file?: File
}

const defaultRules = {
  aiReview: {
    enabled: true,
    strictness: 'medium',
    checkItems: [
      { id: 'forbidden_words', name: '违禁词检测', enabled: true },
      { id: 'competitor', name: '竞品提及检测', enabled: true },
      { id: 'brand_tone', name: '品牌调性检测', enabled: true },
      { id: 'duration', name: '视频时长检测', enabled: true },
      { id: 'music', name: '背景音乐检测', enabled: false },
    ],
  },
  manualReview: {
    scriptRequired: true,
    videoRequired: true,
    agencyCanApprove: true,
    brandFinalReview: true,
  },
  appealRules: {
    maxAppeals: 3,
    appealDeadline: 48,
  },
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + 'MB'
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + 'GB'
}

// 严格程度选项
const strictnessOptions = [
  { value: 'low', label: '宽松', description: '仅检测明显违规内容' },
  { value: 'medium', label: '标准', description: '平衡检测，推荐使用' },
  { value: 'high', label: '严格', description: '严格检测，可能有较多误判' },
]

function ConfigSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center gap-4">
        <div className="h-10 w-10 bg-bg-elevated rounded-lg" />
        <div className="space-y-2">
          <div className="h-7 w-48 bg-bg-elevated rounded" />
          <div className="h-4 w-32 bg-bg-elevated rounded" />
        </div>
      </div>
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="h-16 bg-bg-elevated rounded-xl" />
      ))}
    </div>
  )
}

export default function ProjectConfigPage() {
  const router = useRouter()
  const params = useParams()
  const toast = useToast()
  const { user } = useAuth()
  const projectId = params.id as string

  // 附件上传跟踪
  const [uploadingFiles, setUploadingFiles] = useState<UploadFileItem[]>([])

  // Brief state
  const [briefExists, setBriefExists] = useState(false)
  const [loading, setLoading] = useState(true)
  const [projectName, setProjectName] = useState('')

  // Brief form fields
  const [brandTone, setBrandTone] = useState('')
  const [otherRequirements, setOtherRequirements] = useState('')
  const [minDuration, setMinDuration] = useState<number | undefined>()
  const [maxDuration, setMaxDuration] = useState<number | undefined>()
  const [sellingPoints, setSellingPoints] = useState<SellingPoint[]>([])
  const [blacklistWords, setBlacklistWords] = useState<BlacklistWord[]>([])
  const [competitors, setCompetitors] = useState<string[]>([])
  const [attachments, setAttachments] = useState<BriefAttachment[]>([])

  // Rules state (local only — no per-project backend API yet)
  const [rules, setRules] = useState(defaultRules)

  const [isSaving, setIsSaving] = useState(false)
  const [activeSection, setActiveSection] = useState<string | null>('brief')

  // 规则冲突检测
  const [isCheckingConflicts, setIsCheckingConflicts] = useState(false)
  const [showConflictModal, setShowConflictModal] = useState(false)
  const [conflicts, setConflicts] = useState<RuleConflict[]>([])
  const [showPlatformSelect, setShowPlatformSelect] = useState(false)

  const platformDropdownRef = useRef<HTMLDivElement>(null)

  const platformOptions = [
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

  const handleCheckConflicts = async (platform: string) => {
    setShowPlatformSelect(false)
    setIsCheckingConflicts(true)

    try {
      const brandId = user?.brand_id || ''
      const briefRules: Record<string, unknown> = {
        selling_points: sellingPoints.map(sp => sp.content),
        min_duration: minDuration,
        max_duration: maxDuration,
      }
      const result = await api.validateRules({
        brand_id: brandId,
        platform,
        brief_rules: briefRules,
      })
      setConflicts(result.conflicts)
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

  // Input fields
  const [newSellingPoint, setNewSellingPoint] = useState('')
  const [newBlacklistWord, setNewBlacklistWord] = useState('')
  const [newBlacklistReason, setNewBlacklistReason] = useState('')
  const [newCompetitor, setNewCompetitor] = useState('')

  const populateBrief = (data: BriefResponse) => {
    setProjectName(data.project_name || '')
    setBrandTone(data.brand_tone || '')
    setOtherRequirements(data.other_requirements || '')
    setMinDuration(data.min_duration ?? undefined)
    setMaxDuration(data.max_duration ?? undefined)
    setSellingPoints(data.selling_points || [])
    setBlacklistWords(data.blacklist_words || [])
    setCompetitors(data.competitors || [])
    setAttachments(data.attachments || [])
  }

  const loadBrief = useCallback(async () => {
    try {
      const data = await api.getBrief(projectId)
      populateBrief(data)
      setBriefExists(true)
    } catch (err: any) {
      if (err?.response?.status === 404) {
        setBriefExists(false)
      } else {
        console.error('Failed to load brief:', err)
        toast.error('加载Brief失败')
      }
    } finally {
      setLoading(false)
    }
  }, [projectId, toast])

  useEffect(() => {
    loadBrief()
  }, [loadBrief])

  const handleSaveBrief = async () => {
    setIsSaving(true)
    try {
      const briefData: BriefCreateRequest = {
        selling_points: sellingPoints,
        blacklist_words: blacklistWords,
        competitors,
        brand_tone: brandTone || undefined,
        min_duration: minDuration,
        max_duration: maxDuration,
        other_requirements: otherRequirements || undefined,
        attachments,
      }

      if (briefExists) {
        await api.updateBrief(projectId, briefData)
      } else {
        await api.createBrief(projectId, briefData)
        setBriefExists(true)
      }

      toast.success('Brief配置已保存')
    } catch (err) {
      console.error('Failed to save brief:', err)
      toast.error('保存失败，请重试')
    } finally {
      setIsSaving(false)
    }
  }

  // Selling points
  const addSellingPoint = () => {
    if (newSellingPoint.trim()) {
      setSellingPoints([...sellingPoints, { content: newSellingPoint.trim(), required: false }])
      setNewSellingPoint('')
    }
  }

  const removeSellingPoint = (index: number) => {
    setSellingPoints(sellingPoints.filter((_, i) => i !== index))
  }

  const toggleSellingPointRequired = (index: number) => {
    setSellingPoints(sellingPoints.map((sp, i) =>
      i === index ? { ...sp, required: !sp.required } : sp
    ))
  }

  // Blacklist words
  const addBlacklistWord = () => {
    if (newBlacklistWord.trim()) {
      setBlacklistWords([...blacklistWords, { word: newBlacklistWord.trim(), reason: newBlacklistReason.trim() || '品牌规范' }])
      setNewBlacklistWord('')
      setNewBlacklistReason('')
    }
  }

  const removeBlacklistWord = (index: number) => {
    setBlacklistWords(blacklistWords.filter((_, i) => i !== index))
  }

  // Competitors
  const addCompetitorItem = () => {
    if (newCompetitor.trim() && !competitors.includes(newCompetitor.trim())) {
      setCompetitors([...competitors, newCompetitor.trim()])
      setNewCompetitor('')
    }
  }

  const removeCompetitor = (name: string) => {
    setCompetitors(competitors.filter(c => c !== name))
  }

  // 上传单个附件（独立跟踪进度）
  const uploadSingleAttachment = async (file: File, fileId: string) => {
    try {
      const result = await api.proxyUpload(file, 'general', (pct) => {
        setUploadingFiles(prev => prev.map(f => f.id === fileId
          ? { ...f, progress: Math.min(95, Math.round(pct * 0.95)) }
          : f
        ))
      })
      const att: BriefAttachment = { id: fileId, name: file.name, url: result.url, size: formatFileSize(file.size) }
      setAttachments(prev => [...prev, att])
      setUploadingFiles(prev => prev.filter(f => f.id !== fileId))
    } catch (err) {
      const msg = extractErrorMessage(err)
      setUploadingFiles(prev => prev.map(f => f.id === fileId
        ? { ...f, status: 'error', error: msg }
        : f
      ))
    }
  }

  const handleAttachmentUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    const fileList = Array.from(files)
    e.target.value = ''
    const newItems: UploadFileItem[] = fileList.map(file => ({
      id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name,
      size: formatFileSize(file.size),
      status: 'uploading' as const,
      progress: 0,
      file,
    }))
    setUploadingFiles(prev => [...prev, ...newItems])
    newItems.forEach(item => uploadSingleAttachment(item.file!, item.id))
  }

  const retryAttachmentUpload = (fileId: string) => {
    const item = uploadingFiles.find(f => f.id === fileId)
    if (!item?.file) return
    setUploadingFiles(prev => prev.map(f => f.id === fileId
      ? { ...f, status: 'uploading', progress: 0, error: undefined }
      : f
    ))
    uploadSingleAttachment(item.file, fileId)
  }

  const removeUploadingFile = (id: string) => {
    setUploadingFiles(prev => prev.filter(f => f.id !== id))
  }

  const removeAttachment = (id: string) => {
    setAttachments(attachments.filter(a => a.id !== id))
  }

  // AI check item toggles (local state only)
  const toggleAiCheckItem = (itemId: string) => {
    setRules({
      ...rules,
      aiReview: {
        ...rules.aiReview,
        checkItems: rules.aiReview.checkItems.map(item =>
          item.id === itemId ? { ...item, enabled: !item.enabled } : item
        ),
      },
    })
  }

  const SectionHeader = ({ title, icon: Icon, section }: { title: string; icon: React.ElementType; section: string }) => (
    <button
      type="button"
      onClick={() => setActiveSection(activeSection === section ? null : section)}
      className="w-full flex items-center justify-between p-4 hover:bg-bg-elevated/50 rounded-xl transition-colors"
    >
      <span className="flex items-center gap-2 font-semibold text-text-primary">
        <Icon size={18} className="text-accent-indigo" />
        {title}
      </span>
      {activeSection === section ? (
        <ChevronUp size={18} className="text-text-tertiary" />
      ) : (
        <ChevronDown size={18} className="text-text-tertiary" />
      )}
    </button>
  )

  if (loading) return <ConfigSkeleton />

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
            <h1 className="text-2xl font-bold text-text-primary">Brief和规则配置</h1>
            <p className="text-sm text-text-secondary mt-0.5">
              {projectName || `项目 ${projectId}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
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
                {platformOptions.map((opt) => (
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
          <Button variant="primary" onClick={handleSaveBrief} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                保存中...
              </>
            ) : (
              <>
                <Save size={16} />
                保存配置
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Brief配置 */}
      <Card>
        <SectionHeader title="Brief配置" icon={FileText} section="brief" />
        {activeSection === 'brief' && (
          <CardContent className="space-y-6 pt-0">
            {/* 品牌调性 + 视频时长 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-text-secondary mb-1.5 block">品牌调性</label>
                <Input
                  value={brandTone}
                  onChange={(e) => setBrandTone(e.target.value)}
                  placeholder="例如：年轻、活力、清新"
                />
              </div>
              <div>
                <label className="text-sm text-text-secondary mb-1.5 block">视频时长限制（秒）</label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    value={minDuration ?? ''}
                    onChange={(e) => setMinDuration(e.target.value ? parseInt(e.target.value) : undefined)}
                    placeholder="最短"
                  />
                  <span className="text-text-tertiary">~</span>
                  <Input
                    type="number"
                    min={0}
                    value={maxDuration ?? ''}
                    onChange={(e) => setMaxDuration(e.target.value ? parseInt(e.target.value) : undefined)}
                    placeholder="最长"
                  />
                </div>
              </div>
            </div>

            {/* 其他要求 */}
            <div>
              <label className="text-sm text-text-secondary mb-1.5 block">其他要求</label>
              <textarea
                value={otherRequirements}
                onChange={(e) => setOtherRequirements(e.target.value)}
                placeholder="简要描述项目要求..."
                className="w-full h-24 p-3 rounded-xl bg-bg-elevated border border-border-subtle text-text-primary resize-none focus:outline-none focus:ring-2 focus:ring-accent-indigo"
              />
            </div>

            {/* 卖点 / 创作要求 */}
            <div>
              <label className="text-sm text-text-secondary mb-2 block">卖点 / 创作要求</label>
              <div className="space-y-2">
                {sellingPoints.map((sp, index) => (
                  <div key={index} className="flex items-center gap-2 p-3 rounded-lg bg-bg-elevated">
                    <button
                      type="button"
                      onClick={() => toggleSellingPointRequired(index)}
                      title={sp.required ? '必选卖点（点击切换）' : '可选卖点（点击切换）'}
                    >
                      <CheckCircle size={16} className={sp.required ? 'text-accent-green' : 'text-text-tertiary'} />
                    </button>
                    <span className="flex-1 text-text-primary">{sp.content}</span>
                    {sp.required && <span className="text-xs text-accent-green">必选</span>}
                    <button
                      type="button"
                      onClick={() => removeSellingPoint(index)}
                      className="p-1 rounded hover:bg-bg-page text-text-tertiary hover:text-accent-coral transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Input
                    value={newSellingPoint}
                    onChange={(e) => setNewSellingPoint(e.target.value)}
                    placeholder="添加卖点或创作要求"
                    onKeyDown={(e) => e.key === 'Enter' && addSellingPoint()}
                  />
                  <Button variant="secondary" onClick={addSellingPoint}>
                    <Plus size={16} />
                  </Button>
                </div>
              </div>
            </div>

            {/* 禁止词 */}
            <div>
              <label className="text-sm text-text-secondary mb-2 block flex items-center gap-2">
                <AlertTriangle size={14} className="text-accent-coral" />
                禁止词列表
              </label>
              <div className="space-y-2 mb-3">
                {blacklistWords.map((bw, index) => (
                  <div key={index} className="flex items-center gap-2 p-3 rounded-lg bg-bg-elevated">
                    <span className="text-accent-coral font-medium">{bw.word}</span>
                    {bw.reason && <span className="text-xs text-text-tertiary">— {bw.reason}</span>}
                    <div className="flex-1" />
                    <button
                      type="button"
                      onClick={() => removeBlacklistWord(index)}
                      className="p-1 rounded hover:bg-bg-page text-text-tertiary hover:text-accent-coral transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  value={newBlacklistWord}
                  onChange={(e) => setNewBlacklistWord(e.target.value)}
                  placeholder="禁止词"
                  onKeyDown={(e) => e.key === 'Enter' && addBlacklistWord()}
                />
                <Input
                  value={newBlacklistReason}
                  onChange={(e) => setNewBlacklistReason(e.target.value)}
                  placeholder="原因（可选）"
                  onKeyDown={(e) => e.key === 'Enter' && addBlacklistWord()}
                />
                <Button variant="secondary" onClick={addBlacklistWord}>
                  <Plus size={16} />
                </Button>
              </div>
            </div>

            {/* 竞品品牌 */}
            <div>
              <label className="text-sm text-text-secondary mb-2 block">竞品品牌</label>
              <div className="flex flex-wrap gap-2 mb-3">
                {competitors.map((name) => (
                  <span
                    key={name}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-accent-coral/15 text-accent-coral text-sm"
                  >
                    {name}
                    <button
                      type="button"
                      onClick={() => removeCompetitor(name)}
                      className="hover:text-accent-coral/70 transition-colors"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  value={newCompetitor}
                  onChange={(e) => setNewCompetitor(e.target.value)}
                  placeholder="添加竞品品牌名称"
                  onKeyDown={(e) => e.key === 'Enter' && addCompetitorItem()}
                />
                <Button variant="secondary" onClick={addCompetitorItem}>
                  <Plus size={16} />
                </Button>
              </div>
            </div>

            {/* 参考资料 */}
            <div>
              <label className="text-sm text-text-secondary mb-2 block">参考资料</label>

              <label className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-dashed border-border-subtle bg-bg-elevated text-text-primary hover:border-accent-indigo/50 hover:bg-bg-page transition-colors cursor-pointer w-full text-sm mb-3">
                <Upload size={16} className="text-accent-indigo" />
                点击上传参考资料（可多选）
                <input
                  type="file"
                  multiple
                  onChange={handleAttachmentUpload}
                  className="hidden"
                />
              </label>

              {/* 文件列表 */}
              <div className="border border-border-subtle rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 bg-bg-elevated border-b border-border-subtle">
                  <span className="text-xs font-medium text-text-secondary flex items-center gap-1.5">
                    <FileText size={12} className="text-accent-indigo" />
                    附件列表
                  </span>
                  <span className="text-xs text-text-tertiary">
                    {attachments.length + uploadingFiles.filter(f => f.status === 'uploading').length} 个文件
                    {uploadingFiles.some(f => f.status === 'uploading') && (
                      <span className="text-accent-indigo ml-1">· 上传中</span>
                    )}
                  </span>
                </div>

                {attachments.length === 0 && uploadingFiles.length === 0 ? (
                  <div className="px-4 py-5 text-center">
                    <p className="text-xs text-text-tertiary">暂无附件</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border-subtle">
                    {/* 已完成的文件 */}
                    {attachments.map((att) => (
                      <div key={att.id} className="flex items-center gap-3 px-4 py-2.5">
                        <CheckCircle size={14} className="text-accent-green flex-shrink-0" />
                        <FileText size={14} className="text-text-tertiary flex-shrink-0" />
                        <span className="flex-1 text-sm text-text-primary truncate">{att.name}</span>
                        {att.size && <span className="text-xs text-text-tertiary">{att.size}</span>}
                        <button
                          type="button"
                          onClick={() => removeAttachment(att.id)}
                          className="p-1 rounded hover:bg-bg-elevated text-text-tertiary hover:text-accent-coral transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}

                    {/* 上传中/失败的文件 */}
                    {uploadingFiles.map((file) => (
                      <div key={file.id} className="px-4 py-2.5">
                        <div className="flex items-center gap-3">
                          {file.status === 'uploading' && (
                            <Loader2 size={14} className="animate-spin text-accent-indigo flex-shrink-0" />
                          )}
                          {file.status === 'error' && (
                            <AlertCircle size={14} className="text-accent-coral flex-shrink-0" />
                          )}
                          <FileText size={14} className="text-text-tertiary flex-shrink-0" />
                          <span className={`flex-1 text-sm truncate ${
                            file.status === 'error' ? 'text-accent-coral' : 'text-text-primary'
                          }`}>{file.name}</span>
                          <span className="text-xs text-text-tertiary whitespace-nowrap min-w-[40px] text-right">
                            {file.status === 'uploading' ? `${file.progress}%` : file.size}
                          </span>
                          {file.status === 'error' && (
                            <button type="button" onClick={() => retryAttachmentUpload(file.id)}
                              className="p-1 rounded hover:bg-bg-elevated text-accent-indigo transition-colors" title="重试">
                              <RotateCcw size={14} />
                            </button>
                          )}
                          {file.status !== 'uploading' && (
                            <button type="button" onClick={() => removeUploadingFile(file.id)}
                              className="p-1 rounded hover:bg-bg-elevated text-text-tertiary hover:text-accent-coral transition-colors" title="删除">
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                        {file.status === 'uploading' && (
                          <div className="mt-1.5 ml-[28px] h-2 bg-bg-page rounded-full overflow-hidden">
                            <div className="h-full bg-accent-indigo rounded-full transition-all duration-300"
                              style={{ width: `${file.progress}%` }} />
                          </div>
                        )}
                        {file.status === 'error' && file.error && (
                          <p className="mt-1 ml-[28px] text-xs text-accent-coral">{file.error}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* AI审核规则 */}
      <Card>
        <SectionHeader title="AI审核规则" icon={Bot} section="ai" />
        {activeSection === 'ai' && (
          <CardContent className="space-y-6 pt-0">
            {/* AI审核开关 */}
            <div className="flex items-center justify-between p-4 rounded-xl bg-bg-elevated">
              <div>
                <p className="font-medium text-text-primary">启用AI自动审核</p>
                <p className="text-sm text-text-secondary">开启后，内容将先经过AI预审</p>
              </div>
              <button
                type="button"
                onClick={() => setRules({ ...rules, aiReview: { ...rules.aiReview, enabled: !rules.aiReview.enabled } })}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  rules.aiReview.enabled ? 'bg-accent-indigo' : 'bg-bg-page'
                }`}
              >
                <span
                  className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                    rules.aiReview.enabled ? 'left-7' : 'left-1'
                  }`}
                />
              </button>
            </div>

            {rules.aiReview.enabled && (
              <>
                {/* 严格程度 */}
                <div>
                  <label className="text-sm text-text-secondary mb-2 block">审核严格程度</label>
                  <div className="grid grid-cols-3 gap-3">
                    {strictnessOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setRules({ ...rules, aiReview: { ...rules.aiReview, strictness: option.value } })}
                        className={`p-4 rounded-xl border-2 text-left transition-all ${
                          rules.aiReview.strictness === option.value
                            ? 'border-accent-indigo bg-accent-indigo/10'
                            : 'border-border-subtle hover:border-border-subtle/80'
                        }`}
                      >
                        <p className={`font-medium ${rules.aiReview.strictness === option.value ? 'text-accent-indigo' : 'text-text-primary'}`}>
                          {option.label}
                        </p>
                        <p className="text-xs text-text-tertiary mt-1">{option.description}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 检测项目 */}
                <div>
                  <label className="text-sm text-text-secondary mb-2 block">检测项目</label>
                  <div className="space-y-2">
                    {rules.aiReview.checkItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between p-3 rounded-lg bg-bg-elevated"
                      >
                        <span className="text-text-primary">{item.name}</span>
                        <button
                          type="button"
                          onClick={() => toggleAiCheckItem(item.id)}
                          className={`relative w-10 h-5 rounded-full transition-colors ${
                            item.enabled ? 'bg-accent-green' : 'bg-bg-page'
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                              item.enabled ? 'left-5' : 'left-0.5'
                            }`}
                          />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        )}
      </Card>

      {/* 人工审核规则 */}
      <Card>
        <SectionHeader title="人工审核规则" icon={Users} section="manual" />
        {activeSection === 'manual' && (
          <CardContent className="space-y-4 pt-0">
            <div className="flex items-center justify-between p-4 rounded-xl bg-bg-elevated">
              <div>
                <p className="font-medium text-text-primary">脚本需要人工审核</p>
                <p className="text-sm text-text-secondary">脚本提交后需要代理商/品牌方审核</p>
              </div>
              <button
                type="button"
                onClick={() => setRules({ ...rules, manualReview: { ...rules.manualReview, scriptRequired: !rules.manualReview.scriptRequired } })}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  rules.manualReview.scriptRequired ? 'bg-accent-indigo' : 'bg-bg-page'
                }`}
              >
                <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  rules.manualReview.scriptRequired ? 'left-7' : 'left-1'
                }`} />
              </button>
            </div>

            <div className="flex items-center justify-between p-4 rounded-xl bg-bg-elevated">
              <div>
                <p className="font-medium text-text-primary">视频需要人工审核</p>
                <p className="text-sm text-text-secondary">视频提交后需要代理商/品牌方审核</p>
              </div>
              <button
                type="button"
                onClick={() => setRules({ ...rules, manualReview: { ...rules.manualReview, videoRequired: !rules.manualReview.videoRequired } })}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  rules.manualReview.videoRequired ? 'bg-accent-indigo' : 'bg-bg-page'
                }`}
              >
                <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  rules.manualReview.videoRequired ? 'left-7' : 'left-1'
                }`} />
              </button>
            </div>

            <div className="flex items-center justify-between p-4 rounded-xl bg-bg-elevated">
              <div>
                <p className="font-medium text-text-primary">代理商终审权限</p>
                <p className="text-sm text-text-secondary">允许代理商直接通过/驳回内容，无需品牌方审核</p>
              </div>
              <button
                type="button"
                onClick={() => setRules({ ...rules, manualReview: { ...rules.manualReview, agencyCanApprove: !rules.manualReview.agencyCanApprove } })}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  rules.manualReview.agencyCanApprove ? 'bg-accent-indigo' : 'bg-bg-page'
                }`}
              >
                <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  rules.manualReview.agencyCanApprove ? 'left-7' : 'left-1'
                }`} />
              </button>
            </div>

            <div className="flex items-center justify-between p-4 rounded-xl bg-bg-elevated">
              <div>
                <p className="font-medium text-text-primary">品牌方终审</p>
                <p className="text-sm text-text-secondary">所有内容最终需要品牌方确认</p>
              </div>
              <button
                type="button"
                onClick={() => setRules({ ...rules, manualReview: { ...rules.manualReview, brandFinalReview: !rules.manualReview.brandFinalReview } })}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  rules.manualReview.brandFinalReview ? 'bg-accent-indigo' : 'bg-bg-page'
                }`}
              >
                <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  rules.manualReview.brandFinalReview ? 'left-7' : 'left-1'
                }`} />
              </button>
            </div>
          </CardContent>
        )}
      </Card>

      {/* 申诉规则 */}
      <Card>
        <SectionHeader title="申诉规则" icon={Shield} section="appeal" />
        {activeSection === 'appeal' && (
          <CardContent className="space-y-4 pt-0">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-text-secondary mb-1.5 block">最大申诉次数</label>
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={rules.appealRules.maxAppeals}
                  onChange={(e) => setRules({
                    ...rules,
                    appealRules: { ...rules.appealRules, maxAppeals: parseInt(e.target.value) || 1 }
                  })}
                />
                <p className="text-xs text-text-tertiary mt-1">达人对同一内容最多可申诉的次数</p>
              </div>
              <div>
                <label className="text-sm text-text-secondary mb-1.5 block">申诉处理时限（小时）</label>
                <Input
                  type="number"
                  min={1}
                  max={168}
                  value={rules.appealRules.appealDeadline}
                  onChange={(e) => setRules({
                    ...rules,
                    appealRules: { ...rules.appealRules, appealDeadline: parseInt(e.target.value) || 24 }
                  })}
                />
                <p className="text-xs text-text-tertiary mt-1">代理商需要在此时间内处理申诉</p>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* 规则冲突检测结果弹窗 */}
      <Modal
        isOpen={showConflictModal}
        onClose={() => setShowConflictModal(false)}
        title="规则冲突检测结果"
        size="lg"
      >
        <div className="space-y-4">
          {conflicts.length === 0 ? (
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
                  发现 {conflicts.length} 处规则冲突，建议在发布前修改
                </p>
              </div>
              {conflicts.map((conflict, index) => (
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
