'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Shield, Ban, Building2, Search, X, Upload, Trash2, FileText, Eye, Loader2, CheckCircle, Clock, AlertTriangle, Edit3, Brain, Sparkles } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { api, extractErrorMessage, isTimeoutError } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
// upload via api.proxyUpload directly
import type {
  ForbiddenWordResponse,
  CompetitorResponse,
  WhitelistResponse,
  BrandPlatformRuleResponse,
  ParsedRulesData,
  LearnedRuleResponse,
  RuleDocumentParseResponse,
  ParsedForbiddenWord,
  ParsedWhitelistItem,
  ParsedCompetitor,
} from '@/types/rules'

// ===== 平台图标映射 =====

const platformDisplayMap: Record<string, { icon: string; color: string; name: string }> = {
  douyin: { icon: '🎵', color: 'bg-[#25F4EE]', name: '抖音' },
  xiaohongshu: { icon: '📕', color: 'bg-[#fe2c55]', name: '小红书' },
  bilibili: { icon: '📺', color: 'bg-[#00a1d6]', name: 'B站' },
  kuaishou: { icon: '⚡', color: 'bg-[#ff4906]', name: '快手' },
  weibo: { icon: '🔴', color: 'bg-[#e6162d]', name: '微博' },
  wechat: { icon: '📱', color: 'bg-[#07c160]', name: '微信视频号' },
}

function getPlatformDisplay(platform: string) {
  return platformDisplayMap[platform] || { icon: '📋', color: 'bg-gray-400', name: platform }
}

type IconComponent = typeof CheckCircle
const statusConfig: Record<string, { label: string; color: string; bg: string; icon: IconComponent }> = {
  active: { label: '生效中', color: 'text-accent-green', bg: 'bg-accent-green/15', icon: CheckCircle },
  draft: { label: '待确认', color: 'text-accent-amber', bg: 'bg-accent-amber/15', icon: Clock },
  inactive: { label: '已停用', color: 'text-text-tertiary', bg: 'bg-bg-elevated', icon: AlertTriangle },
}

const categoryOptions = [
  { value: '极限词', label: '极限词' },
  { value: '功效词', label: '功效词' },
  { value: '虚假宣称', label: '虚假宣称' },
  { value: '价格欺诈', label: '价格欺诈' },
  { value: '平台规则', label: '平台规则' },
  { value: '自定义', label: '自定义' },
]

// ===== Loading Skeleton 组件 =====

function CardSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-6 bg-bg-elevated rounded w-1/4" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="p-4 rounded-xl border border-border-subtle">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 bg-bg-elevated rounded-xl" />
              <div className="space-y-2 flex-1">
                <div className="h-4 bg-bg-elevated rounded w-1/2" />
                <div className="h-3 bg-bg-elevated rounded w-1/3" />
              </div>
            </div>
            <div className="h-3 bg-bg-elevated rounded w-2/3 mb-3" />
            <div className="h-3 bg-bg-elevated rounded w-1/2" />
          </div>
        ))}
      </div>
    </div>
  )
}

function WordsSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="flex gap-3">
        <div className="h-10 bg-bg-elevated rounded-xl flex-1 max-w-md" />
        <div className="h-10 bg-bg-elevated rounded-xl w-32" />
      </div>
      {[1, 2].map((group) => (
        <div key={group} className="space-y-2">
          <div className="h-4 bg-bg-elevated rounded w-20" />
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-8 bg-bg-elevated rounded-lg w-20" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function ListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="animate-pulse space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center justify-between p-4 rounded-xl border border-border-subtle">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-bg-elevated rounded-lg" />
            <div className="h-4 bg-bg-elevated rounded w-24" />
          </div>
          <div className="w-8 h-8 bg-bg-elevated rounded-lg" />
        </div>
      ))}
    </div>
  )
}

// ===== 主组件 =====

export default function RulesPage() {
  const toast = useToast()
  const { user } = useAuth()
  const isOperator = user?.role === 'operator'
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isOssUploading, setIsOssUploading] = useState(false)
  const [ossProgress, setOssProgress] = useState(0)

  // Tab 选择
  const [activeTab, setActiveTab] = useState<'platforms' | 'forbidden' | 'competitors' | 'whitelist' | 'learning'>('platforms')
  const [searchQuery, setSearchQuery] = useState('')

  // 数据状态
  const [forbiddenWords, setForbiddenWords] = useState<ForbiddenWordResponse[]>([])
  const [competitors, setCompetitors] = useState<CompetitorResponse[]>([])
  const [whitelist, setWhitelist] = useState<WhitelistResponse[]>([])
  const [platformRules, setPlatformRules] = useState<BrandPlatformRuleResponse[]>([])

  // 加载状态
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [parsing, setParsing] = useState(false)

  // 上传规则文档
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [uploadPlatform, setUploadPlatform] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)

  // 查看/编辑解析结果
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [selectedRule, setSelectedRule] = useState<BrandPlatformRuleResponse | null>(null)
  const [editingRules, setEditingRules] = useState<ParsedRulesData | null>(null)
  const [editingForbiddenInput, setEditingForbiddenInput] = useState('')

  // 添加违禁词
  const [showAddWordModal, setShowAddWordModal] = useState(false)
  const [newWord, setNewWord] = useState('')
  const [newCategory, setNewCategory] = useState('极限词')
  const [batchWords, setBatchWords] = useState('')

  // 添加竞品
  const [showAddCompetitorModal, setShowAddCompetitorModal] = useState(false)
  const [newCompetitor, setNewCompetitor] = useState('')

  // 添加白名单
  const [showAddWhitelistModal, setShowAddWhitelistModal] = useState(false)
  const [newWhitelistTerm, setNewWhitelistTerm] = useState('')
  const [newWhitelistReason, setNewWhitelistReason] = useState('')

  // 品牌学习档案
  const [learnedRules, setLearnedRules] = useState<LearnedRuleResponse[]>([])
  const [showAddLearningModal, setShowAddLearningModal] = useState(false)
  const [newLearningType, setNewLearningType] = useState('允许表达')
  const [newLearningPattern, setNewLearningPattern] = useState('')
  const [newLearningReason, setNewLearningReason] = useState('')

  // 规则文档上传（通用：违禁词/白名单/竞品）
  const [showDocUploadModal, setShowDocUploadModal] = useState(false)
  const [docUploadType, setDocUploadType] = useState<'forbidden_words' | 'whitelist' | 'competitors'>('forbidden_words')
  const [docUploadFile, setDocUploadFile] = useState<File | null>(null)
  const [docParsing, setDocParsing] = useState(false)
  const [docParseResult, setDocParseResult] = useState<RuleDocumentParseResponse | null>(null)
  const docFileInputRef = useRef<HTMLInputElement>(null)

  // ===== 数据加载 =====

  const loadForbiddenWords = useCallback(async () => {
    try {
      const res = await api.listForbiddenWords()
      setForbiddenWords(res.items)
    } catch (err) {
      toast.error('加载违禁词失败：' + (extractErrorMessage(err)))
    }
  }, [toast])

  const loadCompetitors = useCallback(async () => {
    try {
      const res = await api.listCompetitors()
      setCompetitors(res.items)
    } catch (err) {
      toast.error('加载竞品列表失败：' + (extractErrorMessage(err)))
    }
  }, [toast])

  const loadWhitelist = useCallback(async () => {
    try {
      const res = await api.listWhitelist()
      setWhitelist(res.items)
    } catch (err) {
      toast.error('加载白名单失败：' + (extractErrorMessage(err)))
    }
  }, [toast])

  const loadPlatformRules = useCallback(async () => {
    try {
      const res = await api.listBrandPlatformRules()
      setPlatformRules(res.items)
    } catch (err) {
      toast.error('加载平台规则失败：' + (extractErrorMessage(err)))
    }
  }, [toast])

  const loadLearnedRules = useCallback(async () => {
    try {
      const rules = await api.listBrandLearningRules()
      setLearnedRules(rules)
    } catch (err) {
      toast.error('加载学习档案失败：' + extractErrorMessage(err))
    }
  }, [toast])

  const loadAllData = useCallback(async () => {
    setLoading(true)
    const jobs = [loadForbiddenWords(), loadCompetitors(), loadWhitelist(), loadPlatformRules(), loadLearnedRules()]
    await Promise.all(jobs)
    setLoading(false)
  }, [loadForbiddenWords, loadCompetitors, loadWhitelist, loadPlatformRules, loadLearnedRules])

  useEffect(() => { loadAllData() }, [loadAllData])

  // ===== 过滤违禁词 =====

  const filteredWords = forbiddenWords.filter(w =>
    searchQuery === '' ||
    w.word.toLowerCase().includes(searchQuery.toLowerCase()) ||
    w.category.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // ===== 平台规则操作 =====

  const activeRulesCount = platformRules.filter(r => r.status === 'active').length

  const handleUploadAndParse = async () => {
    if (!uploadPlatform || !uploadFile) return
    setParsing(true)
    try {
      let documentUrl: string
      let documentName = uploadFile.name

      // 真实模式: 上传到 TOS (通过后端代理)
      setIsOssUploading(true)
      setOssProgress(0)
      try {
        const uploadResult = await api.proxyUpload(uploadFile, 'rules', (pct) => {
          setOssProgress(Math.min(95, Math.round(pct * 0.95)))
        })
        setOssProgress(100)
        setIsOssUploading(false)
        documentUrl = uploadResult.url
      } catch (uploadErr) {
        setIsOssUploading(false)
        const axiosErr = uploadErr as { response?: { data?: { detail?: string } } }
        const detail = axiosErr?.response?.data?.detail
        toast.error('文件上传失败：' + (detail || (uploadErr instanceof Error ? uploadErr.message : '未知错误')))
        setParsing(false)
        return
      }

      // 调用 AI 解析
      const parsed = await api.parsePlatformRule({
        document_url: documentUrl,
        document_name: documentName,
        platform: uploadPlatform,
        brand_id: user?.brand_id || user?.tenant_id || '',
      })

      await loadPlatformRules()
      setShowUploadModal(false)
      setUploadPlatform('')
      setUploadFile(null)
      toast.success('文档解析完成，请确认解析结果')

      // 打开详情编辑
      const newRule: BrandPlatformRuleResponse = {
        id: parsed.id,
        platform: parsed.platform,
        brand_id: parsed.brand_id,
        document_url: parsed.document_url,
        document_name: parsed.document_name,
        parsed_rules: parsed.parsed_rules,
        status: parsed.status,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      setSelectedRule(newRule)
      setEditingRules(parsed.parsed_rules)
      setShowDetailModal(true)
    } catch (err) {
      if (isTimeoutError(err)) {
        toast.error('AI 解析超时，后台可能仍在处理中。请稍后刷新页面查看结果。')
        await loadPlatformRules()
      } else {
        toast.error('AI 解析失败：' + (extractErrorMessage(err) || '请检查 AI 配置或重试'))
      }
    } finally {
      setParsing(false)
      setIsOssUploading(false)
    }
  }

  const handleConfirmRule = async () => {
    if (!selectedRule || !editingRules) return
    setSubmitting(true)
    try {
      await api.confirmPlatformRule(selectedRule.id, { parsed_rules: editingRules })
      await loadPlatformRules()
      toast.success('规则已确认生效')
      setShowDetailModal(false)
      setSelectedRule(null)
      setEditingRules(null)
    } catch (err) {
      toast.error('确认失败：' + (extractErrorMessage(err)))
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteRule = async (ruleId: string) => {
    setSubmitting(true)
    try {
      await api.deletePlatformRule(ruleId)
      await loadPlatformRules()
      toast.success('规则已删除')
    } catch (err) {
      toast.error('删除失败：' + (extractErrorMessage(err)))
    } finally {
      setSubmitting(false)
    }
  }

  const viewRuleDetail = (rule: BrandPlatformRuleResponse) => {
    setSelectedRule(rule)
    setEditingRules({ ...rule.parsed_rules })
    setShowDetailModal(true)
  }

  // ===== 编辑解析结果辅助 =====

  const addForbiddenWord = () => {
    if (!editingForbiddenInput.trim() || !editingRules) return
    setEditingRules({
      ...editingRules,
      forbidden_words: [...editingRules.forbidden_words, editingForbiddenInput.trim()],
    })
    setEditingForbiddenInput('')
  }

  const removeForbiddenWord = (index: number) => {
    if (!editingRules) return
    setEditingRules({
      ...editingRules,
      forbidden_words: editingRules.forbidden_words.filter((_, i) => i !== index),
    })
  }

  const removeContentReq = (index: number) => {
    if (!editingRules) return
    setEditingRules({
      ...editingRules,
      content_requirements: editingRules.content_requirements.filter((_, i) => i !== index),
    })
  }

  // ===== 违禁词操作 =====

  const handleAddWord = async () => {
    if (!newWord.trim()) return
    setSubmitting(true)
    try {
      await api.addForbiddenWord({ word: newWord.trim(), category: newCategory, severity: 'medium' })
      await loadForbiddenWords()
      toast.success('违禁词添加成功')
      setNewWord('')
      setShowAddWordModal(false)
    } catch (err) {
      toast.error('添加违禁词失败：' + (extractErrorMessage(err)))
    } finally {
      setSubmitting(false)
    }
  }

  const handleBatchAdd = async () => {
    const words = batchWords.split('\n').filter(w => w.trim())
    if (words.length === 0) return
    setSubmitting(true)
    try {
      for (const word of words) {
        await api.addForbiddenWord({ word: word.trim(), category: newCategory, severity: 'medium' })
      }
      await loadForbiddenWords()
      toast.success(`成功添加 ${words.length} 个违禁词`)
      setBatchWords('')
      setShowAddWordModal(false)
    } catch (err) {
      toast.error('批量添加违禁词失败：' + (extractErrorMessage(err)))
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteWord = async (id: string) => {
    setSubmitting(true)
    try {
      await api.deleteForbiddenWord(id)
      await loadForbiddenWords()
      toast.success('违禁词已删除')
    } catch (err) {
      toast.error('删除违禁词失败：' + (extractErrorMessage(err)))
    } finally {
      setSubmitting(false)
    }
  }

  // ===== 竞品操作 =====

  const handleAddCompetitor = async () => {
    if (!newCompetitor.trim()) return
    setSubmitting(true)
    try {
      await api.addCompetitor({ name: newCompetitor.trim(), brand_id: '', keywords: [newCompetitor.trim()] })
      await loadCompetitors()
      toast.success('竞品添加成功')
      setNewCompetitor('')
      setShowAddCompetitorModal(false)
    } catch (err) {
      toast.error('添加竞品失败：' + (extractErrorMessage(err)))
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteCompetitor = async (id: string) => {
    setSubmitting(true)
    try {
      await api.deleteCompetitor(id)
      await loadCompetitors()
      toast.success('竞品已删除')
    } catch (err) {
      toast.error('删除竞品失败：' + (extractErrorMessage(err)))
    } finally {
      setSubmitting(false)
    }
  }

  // ===== 白名单操作 =====

  const handleAddWhitelist = async () => {
    if (!newWhitelistTerm.trim()) return
    setSubmitting(true)
    try {
      await api.addToWhitelist({ term: newWhitelistTerm.trim(), reason: newWhitelistReason.trim(), brand_id: '' })
      await loadWhitelist()
      toast.success('白名单添加成功')
      setNewWhitelistTerm('')
      setNewWhitelistReason('')
      setShowAddWhitelistModal(false)
    } catch (err) {
      toast.error('添加白名单失败：' + (extractErrorMessage(err)))
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteWhitelist = async (id: string) => {
    setSubmitting(true)
    try {
      await api.deleteWhitelistItem(id)
      await loadWhitelist()
      toast.success('白名单已删除')
    } catch (err) {
      toast.error('删除白名单失败：' + (extractErrorMessage(err)))
    } finally {
      setSubmitting(false)
    }
  }

  // ===== 学习档案操作 =====

  const handleAddLearningRule = async () => {
    if (!newLearningPattern.trim() || !newLearningReason.trim()) return
    setSubmitting(true)
    try {
      await api.createBrandLearningRule({ type: newLearningType, pattern: newLearningPattern, reason: newLearningReason })
      await loadLearnedRules()
      toast.success('学习规则已添加')
      setNewLearningPattern('')
      setNewLearningReason('')
      setShowAddLearningModal(false)
    } catch (err) {
      toast.error('添加学习规则失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteLearningRule = async (id: string) => {
    setSubmitting(true)
    try {
      await api.deleteBrandLearningRule(id)
      await loadLearnedRules()
      toast.success('学习规则已删除')
    } catch (err) {
      toast.error('删除学习规则失败')
    } finally {
      setSubmitting(false)
    }
  }

  // ===== 规则文档上传解析 =====

  const handleDocUpload = async () => {
    if (!docUploadFile) return
    setDocParsing(true)
    try {
      let documentUrl: string
      const documentName = docUploadFile.name

      // 上传文件
      const uploadRes = await api.proxyUpload(docUploadFile, 'document')
      documentUrl = uploadRes.url

      // AI 解析
      const result = await api.parseRuleDocument({
        document_url: documentUrl,
        document_name: documentName,
        rule_type: docUploadType,
      })
      setDocParseResult(result)
    } catch (err) {
      if (isTimeoutError(err)) {
        toast.error('文档解析超时，请稍后重试或上传较小的文档。')
      } else {
        toast.error('文档解析失败：' + extractErrorMessage(err))
      }
    } finally {
      setDocParsing(false)
    }
  }

  const handleDocConfirm = async () => {
    if (!docParseResult) return
    setSubmitting(true)
    try {
      await api.confirmRuleDocument({
        rule_type: docUploadType,
        forbidden_words: docParseResult.forbidden_words,
        whitelist_items: docParseResult.whitelist_items,
        competitors: docParseResult.competitors,
      })
      // 刷新对应数据
      if (docUploadType === 'forbidden_words') await loadForbiddenWords()
      else if (docUploadType === 'whitelist') await loadWhitelist()
      else if (docUploadType === 'competitors') await loadCompetitors()
      toast.success(`已导入 ${docParseResult.total_parsed} 条规则`)
      setShowDocUploadModal(false)
      setDocParseResult(null)
      setDocUploadFile(null)
    } catch (err) {
      toast.error('确认导入失败')
    } finally {
      setSubmitting(false)
    }
  }

  const learningTypeLabels: Record<string, { label: string; color: string }> = {
    // 中文值（新）
    '允许表达': { label: '可接受表达', color: 'text-accent-green' },
    '调性偏好': { label: '调性偏好', color: 'text-accent-indigo' },
    '误判': { label: 'AI 误判', color: 'text-accent-amber' },
    '风格偏好': { label: '风格偏好', color: 'text-accent-coral' },
    '调性偏严': { label: '调性收紧', color: 'text-red-400' },
    '缺少要素': { label: '遗漏要求', color: 'text-orange-400' },
    '品牌不符': { label: '品牌不匹配', color: 'text-rose-400' },
    '质量不达标': { label: '质量标准', color: 'text-yellow-400' },
    // 英文值（兼容旧数据）
    allowed_expression: { label: '可接受表达', color: 'text-accent-green' },
    tone_preference: { label: '调性偏好', color: 'text-accent-indigo' },
    false_positive: { label: 'AI 误判', color: 'text-accent-amber' },
    style_preference: { label: '风格偏好', color: 'text-accent-coral' },
    stricter_tone: { label: '调性收紧', color: 'text-red-400' },
    missing_requirement: { label: '遗漏要求', color: 'text-orange-400' },
    brand_mismatch: { label: '品牌不匹配', color: 'text-rose-400' },
    quality_concern: { label: '质量标准', color: 'text-yellow-400' },
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">规则配置</h1>
        <p className="text-sm text-text-secondary mt-1">
          {isOperator
            ? '维护当前代运营工作空间的规则库、白名单、竞品和 AI 自主学习库'
            : '配置平台规则库和自定义审核规则，代理商可在此基础上调整风险等级'}
        </p>
      </div>

      {/* 标签页 */}
      <div className="flex gap-1 p-1 bg-bg-elevated rounded-xl w-fit">
        <button
          type="button"
          className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
            activeTab === 'platforms' ? 'bg-bg-card text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
          }`}
          onClick={() => setActiveTab('platforms')}
        >
          <FileText size={16} />
          平台规则库
          <span className="px-2 py-0.5 rounded-full bg-accent-indigo/15 text-accent-indigo text-xs">
            {activeRulesCount}
          </span>
        </button>
        <button
          type="button"
          className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
            activeTab === 'forbidden' ? 'bg-bg-card text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
          }`}
          onClick={() => setActiveTab('forbidden')}
        >
          <Ban size={16} />
          自定义违禁词
          <span className="px-2 py-0.5 rounded-full bg-accent-coral/15 text-accent-coral text-xs">
            {forbiddenWords.length}
          </span>
        </button>
        <button
          type="button"
          className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
            activeTab === 'competitors' ? 'bg-bg-card text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
          }`}
          onClick={() => setActiveTab('competitors')}
        >
          <Building2 size={16} />
          竞品列表
          <span className="px-2 py-0.5 rounded-full bg-accent-amber/15 text-accent-amber text-xs">
            {competitors.length}
          </span>
        </button>
        <button
          type="button"
          className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
            activeTab === 'whitelist' ? 'bg-bg-card text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
          }`}
          onClick={() => setActiveTab('whitelist')}
        >
          <Shield size={16} />
          白名单
          <span className="px-2 py-0.5 rounded-full bg-accent-green/15 text-accent-green text-xs">
            {whitelist.length}
          </span>
        </button>
        <button
          type="button"
          className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
            activeTab === 'learning' ? 'bg-bg-card text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
          }`}
          onClick={() => setActiveTab('learning')}
        >
          <Brain size={16} />
          学习档案
          <span className="px-2 py-0.5 rounded-full bg-accent-indigo/15 text-accent-indigo text-xs">
            {learnedRules.length}
          </span>
        </button>
      </div>

      {/* ==================== 平台规则库 ==================== */}
      {activeTab === 'platforms' && (
        <Card>
          <CardHeader>
            <CardTitle>平台规则库</CardTitle>
            <p className="text-sm text-text-tertiary mt-1">
              上传各平台的规则文档（PDF / Word / Excel），AI 自动解析提取合规规则，确认后应用于审核
            </p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <CardSkeleton />
            ) : (
              <div className="space-y-4">
                {/* 已有规则列表 */}
                {platformRules.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {platformRules.map((rule) => {
                      const display = getPlatformDisplay(rule.platform)
                      const status = statusConfig[rule.status] || statusConfig.draft
                      const StatusIcon = status.icon
                      return (
                        <div
                          key={rule.id}
                          className="p-4 rounded-xl border border-border-subtle bg-bg-card hover:border-accent-indigo/50 transition-all"
                        >
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-3">
                              <div className={`w-10 h-10 ${display.color} rounded-xl flex items-center justify-center text-xl`}>
                                {display.icon}
                              </div>
                              <div>
                                <h3 className="font-medium text-text-primary">{display.name}</h3>
                                <p className="text-xs text-text-tertiary truncate max-w-[140px]" title={rule.document_name}>
                                  {rule.document_name}
                                </p>
                              </div>
                            </div>
                            <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${status.bg} ${status.color}`}>
                              <StatusIcon size={12} />
                              {status.label}
                            </span>
                          </div>

                          <div className="flex items-center gap-3 text-xs text-text-tertiary mb-3">
                            <span>{rule.parsed_rules?.forbidden_words?.length || 0} 违禁词</span>
                            <span>{rule.parsed_rules?.content_requirements?.length || 0} 内容要求</span>
                            {rule.parsed_rules?.duration && (
                              <span>时长 {rule.parsed_rules.duration.min_seconds || '?'}s+</span>
                            )}
                          </div>

                          <div className="flex items-center justify-between pt-3 border-t border-border-subtle">
                            <span className="text-xs text-text-tertiary">
                              {new Date(rule.updated_at).toLocaleDateString('zh-CN')}
                            </span>
                            <div className="flex gap-1">
                              <button
                                type="button"
                                onClick={() => viewRuleDetail(rule)}
                                className="p-1.5 rounded-lg text-text-tertiary hover:text-accent-indigo hover:bg-accent-indigo/10 transition-colors"
                                title="编辑规则"
                              >
                                <Edit3 size={16} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteRule(rule.id)}
                                disabled={submitting}
                                className="p-1.5 rounded-lg text-text-tertiary hover:text-accent-coral hover:bg-accent-coral/10 transition-colors disabled:opacity-50"
                                title="删除"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })}

                    {/* 上传新规则按钮 */}
                    <button
                      type="button"
                      onClick={() => setShowUploadModal(true)}
                      className="p-4 rounded-xl border-2 border-dashed border-border-subtle hover:border-accent-indigo hover:bg-accent-indigo/5 transition-all flex flex-col items-center justify-center gap-2 text-text-tertiary hover:text-accent-indigo min-h-[180px]"
                    >
                      <Upload size={24} />
                      <span className="font-medium">上传规则文档</span>
                      <span className="text-xs">支持 PDF / Word / Excel</span>
                    </button>
                  </div>
                )}

                {/* 空状态 */}
                {platformRules.length === 0 && (
                  <div className="text-center py-12">
                    <FileText size={48} className="mx-auto text-text-tertiary mb-4 opacity-50" />
                    <h3 className="text-lg font-medium text-text-primary mb-2">暂无平台规则</h3>
                    <p className="text-sm text-text-tertiary mb-6">
                      上传平台规则文档，AI 将自动提取违禁词、内容要求等合规规则
                    </p>
                    <Button onClick={() => setShowUploadModal(true)}>
                      <Upload size={16} />
                      上传规则文档
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ==================== 自定义违禁词 ==================== */}
      {activeTab === 'forbidden' && (
        <Card>
          <CardHeader>
            <CardTitle>自定义违禁词</CardTitle>
            <p className="text-sm text-text-tertiary mt-1">在平台规则库基础上，添加品牌专属的违禁词规则</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <WordsSkeleton />
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <div className="relative flex-1 max-w-md">
                    <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                    <input
                      type="text"
                      placeholder="搜索违禁词或分类..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 border border-border-subtle rounded-xl bg-bg-elevated text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-indigo"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAddWordModal(true)}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed border-border-subtle hover:border-accent-coral hover:bg-accent-coral/5 transition-all text-text-tertiary hover:text-accent-coral"
                  >
                    <Plus size={18} />
                    <span className="font-medium">添加违禁词</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setDocUploadType('forbidden_words'); setShowDocUploadModal(true) }}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed border-border-subtle hover:border-accent-indigo hover:bg-accent-indigo/5 transition-all text-text-tertiary hover:text-accent-indigo"
                  >
                    <Upload size={18} />
                    <span className="font-medium">文档导入</span>
                  </button>
                </div>

                {(() => {
                  const grouped = filteredWords.reduce((acc, word) => {
                    if (!acc[word.category]) acc[word.category] = []
                    acc[word.category].push(word)
                    return acc
                  }, {} as Record<string, typeof filteredWords>)

                  return Object.entries(grouped).map(([category, words]) => (
                    <div key={category} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-text-secondary">{category}</span>
                        <span className="text-xs text-text-tertiary">({words.length})</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {words.map((word) => (
                          <div key={word.id} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-elevated border border-border-subtle group hover:border-accent-coral/50">
                            <span className="text-text-primary">{word.word}</span>
                            <button type="button" onClick={() => handleDeleteWord(word.id)} disabled={submitting} className="text-text-tertiary hover:text-accent-coral transition-colors disabled:opacity-50">
                              {submitting ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                })()}

                {filteredWords.length === 0 && (
                  <div className="text-center py-8 text-text-tertiary">
                    <Ban size={32} className="mx-auto mb-2 opacity-50" />
                    <p>暂无自定义违禁词</p>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* ==================== 竞品列表 ==================== */}
      {activeTab === 'competitors' && (
        <Card>
          <CardHeader>
            <CardTitle>竞品列表</CardTitle>
            <p className="text-sm text-text-tertiary mt-1">系统将在视频中检测以下竞品的 Logo 或品牌名称</p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <ListSkeleton count={3} />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {competitors.map((competitor) => (
                  <div key={competitor.id} className="p-4 rounded-xl bg-bg-elevated border border-border-subtle flex items-center justify-between group hover:border-accent-amber/50">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-accent-amber/15 rounded-lg flex items-center justify-center">
                        <Building2 size={20} className="text-accent-amber" />
                      </div>
                      <span className="font-medium text-text-primary">{competitor.name}</span>
                    </div>
                    <button type="button" onClick={() => handleDeleteCompetitor(competitor.id)} disabled={submitting} className="p-2 rounded-lg text-text-tertiary hover:text-accent-coral hover:bg-accent-coral/10 transition-colors disabled:opacity-50">
                      {submitting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => setShowAddCompetitorModal(true)} className="p-4 rounded-xl border-2 border-dashed border-border-subtle hover:border-accent-amber hover:bg-accent-amber/5 transition-all flex items-center justify-center gap-2 text-text-tertiary hover:text-accent-amber">
                  <Plus size={20} />
                  <span className="font-medium">添加竞品</span>
                </button>
                <button type="button" onClick={() => { setDocUploadType('competitors'); setShowDocUploadModal(true) }} className="p-4 rounded-xl border-2 border-dashed border-border-subtle hover:border-accent-indigo hover:bg-accent-indigo/5 transition-all flex items-center justify-center gap-2 text-text-tertiary hover:text-accent-indigo">
                  <Upload size={20} />
                  <span className="font-medium">文档导入</span>
                </button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ==================== 白名单 ==================== */}
      {activeTab === 'whitelist' && (
        <Card>
          <CardHeader>
            <CardTitle>白名单</CardTitle>
            <p className="text-sm text-text-tertiary mt-1">白名单中的词汇即使命中违禁词也不会触发告警</p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <ListSkeleton count={2} />
            ) : (
              <div className="space-y-3">
                {whitelist.map((item) => (
                  <div key={item.id} className="flex items-center justify-between p-4 rounded-xl bg-bg-elevated border border-border-subtle hover:border-accent-green/50">
                    <div>
                      <p className="font-medium text-text-primary">{item.term}</p>
                      <p className="text-sm text-text-tertiary mt-0.5">{item.reason}</p>
                    </div>
                    <button type="button" onClick={() => handleDeleteWhitelist(item.id)} disabled={submitting} className="p-2 rounded-lg text-text-tertiary hover:text-accent-coral hover:bg-accent-coral/10 transition-colors disabled:opacity-50">
                      {submitting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                    </button>
                  </div>
                ))}
                <div className="flex gap-3">
                  <button type="button" onClick={() => setShowAddWhitelistModal(true)} className="flex-1 p-4 rounded-xl border-2 border-dashed border-border-subtle hover:border-accent-green hover:bg-accent-green/5 transition-all flex items-center justify-center gap-2 text-text-tertiary hover:text-accent-green">
                    <Plus size={20} />
                    <span className="font-medium">添加白名单</span>
                  </button>
                  <button type="button" onClick={() => { setDocUploadType('whitelist'); setShowDocUploadModal(true) }} className="flex-1 p-4 rounded-xl border-2 border-dashed border-border-subtle hover:border-accent-indigo hover:bg-accent-indigo/5 transition-all flex items-center justify-center gap-2 text-text-tertiary hover:text-accent-indigo">
                    <Upload size={20} />
                    <span className="font-medium">文档导入</span>
                  </button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ==================== 学习档案 ==================== */}
      {activeTab === 'learning' && (
        <Card>
          <CardHeader>
            <CardTitle>AI 学习档案</CardTitle>
            <p className="text-sm text-text-tertiary mt-1">
              当审核员通过了 AI 标记有问题的内容时，系统自动学习并记录规则。您也可以手动添加规则来指导 AI 审核。
            </p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <ListSkeleton count={3} />
            ) : (
              <div className="space-y-3">
                {learnedRules.map((rule) => {
                  const typeInfo = learningTypeLabels[rule.type] || { label: rule.type, color: 'text-text-secondary' }
                  return (
                    <div key={rule.id} className="p-4 rounded-xl bg-bg-elevated border border-border-subtle hover:border-accent-indigo/50 transition-colors">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded ${typeInfo.color} bg-current/10`} style={{ backgroundColor: 'transparent' }}>
                              <span className={typeInfo.color}>{typeInfo.label}</span>
                            </span>
                            <span className="text-xs text-text-tertiary">
                              {rule.created_by === 'ai_learning' ? (
                                <span className="flex items-center gap-1"><Sparkles size={10} />AI 自动学习</span>
                              ) : rule.created_by === 'ai_soft_learning' ? (
                                <span className="flex items-center gap-1"><Sparkles size={10} />低分通过学习</span>
                              ) : '手动添加'}
                            </span>
                            {rule.source_task && (
                              <span className="text-xs text-text-tertiary">来源: {rule.source_task}</span>
                            )}
                          </div>
                          <p className="text-sm text-text-primary">{rule.pattern}</p>
                          <p className="text-xs text-text-secondary">{rule.reason}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteLearningRule(rule.id)}
                          disabled={submitting}
                          className="p-2 rounded-lg text-text-tertiary hover:text-accent-coral hover:bg-accent-coral/10 transition-colors shrink-0"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  )
                })}
                {learnedRules.length === 0 && (
                  <div className="text-center py-8 text-text-tertiary">
                    <Brain size={32} className="mx-auto mb-2 opacity-50" />
                    <p>暂无学习记录</p>
                    <p className="text-xs mt-1">当审核员覆盖 AI 判断通过内容时，系统会自动学习并生成规则</p>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setShowAddLearningModal(true)}
                  className="w-full p-4 rounded-xl border-2 border-dashed border-border-subtle hover:border-accent-indigo hover:bg-accent-indigo/5 transition-all flex items-center justify-center gap-2 text-text-tertiary hover:text-accent-indigo"
                >
                  <Plus size={20} />
                  <span className="font-medium">手动添加规则</span>
                </button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ==================== 上传规则文档弹窗 ==================== */}
      <Modal
        isOpen={showUploadModal}
        onClose={() => { if (!parsing) { setShowUploadModal(false); setUploadPlatform(''); setUploadFile(null) } }}
        title="上传平台规则文档"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">选择平台</label>
            <select
              value={uploadPlatform}
              onChange={(e) => setUploadPlatform(e.target.value)}
              disabled={parsing}
              className="w-full px-4 py-2.5 border border-border-subtle rounded-xl bg-bg-elevated text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-indigo disabled:opacity-50"
            >
              <option value="">请选择平台</option>
              <option value="douyin">抖音</option>
              <option value="xiaohongshu">小红书</option>
              <option value="bilibili">B站</option>
              <option value="kuaishou">快手</option>
              <option value="weibo">微博</option>
              <option value="wechat">微信视频号</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">上传规则文件</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.txt"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) setUploadFile(file)
              }}
            />
            <div
              onClick={() => !parsing && fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const file = e.dataTransfer.files?.[0]
                if (file) setUploadFile(file)
              }}
              className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
                uploadFile ? 'border-accent-green bg-accent-green/5' : 'border-border-subtle hover:border-accent-indigo'
              } ${parsing ? 'opacity-50 pointer-events-none' : ''}`}
            >
              {uploadFile ? (
                <div className="flex items-center justify-center gap-3">
                  <FileText size={24} className="text-accent-green" />
                  <div className="text-left">
                    <p className="text-sm font-medium text-text-primary">{uploadFile.name}</p>
                    <p className="text-xs text-text-tertiary">{(uploadFile.size / 1024).toFixed(1)} KB</p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setUploadFile(null) }}
                    className="p-1 rounded-lg text-text-tertiary hover:text-accent-coral"
                  >
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <>
                  <Upload size={32} className="mx-auto text-text-tertiary mb-3" />
                  <p className="text-sm text-text-primary mb-1">点击或拖拽上传文件</p>
                  <p className="text-xs text-text-tertiary">支持 PDF / Word / Excel / TXT 格式</p>
                </>
              )}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-accent-indigo/10 border border-accent-indigo/20">
            <h4 className="text-sm font-medium text-accent-indigo mb-2">AI 智能解析</h4>
            <ul className="text-xs text-text-secondary space-y-1">
              <li>AI 将自动从文档中提取违禁词、内容要求、时长规则等</li>
              <li>解析完成后可编辑调整，确认后即生效</li>
              <li>同一平台的新规则生效后，旧规则自动停用</li>
            </ul>
          </div>

          {parsing && (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-bg-elevated">
              <Loader2 size={20} className="animate-spin text-accent-indigo" />
              <div className="flex-1">
                <p className="text-sm font-medium text-text-primary">
                  {isOssUploading ? '正在上传文档...' : 'AI 正在解析规则...'}
                </p>
                <p className="text-xs text-text-tertiary mt-0.5">
                  {isOssUploading ? `上传进度 ${ossProgress}%` : '这可能需要几秒钟'}
                </p>
              </div>
            </div>
          )}

          <div className="flex gap-3 justify-end pt-2">
            <Button variant="ghost" onClick={() => { setShowUploadModal(false); setUploadPlatform(''); setUploadFile(null) }} disabled={parsing}>
              取消
            </Button>
            <Button onClick={handleUploadAndParse} disabled={!uploadPlatform || !uploadFile || parsing} loading={parsing}>
              上传并解析
            </Button>
          </div>
        </div>
      </Modal>

      {/* ==================== 规则详情/编辑弹窗 ==================== */}
      <Modal
        isOpen={showDetailModal}
        onClose={() => { setShowDetailModal(false); setSelectedRule(null); setEditingRules(null); setEditingForbiddenInput('') }}
        title={selectedRule ? `${getPlatformDisplay(selectedRule.platform).name} 平台规则` : '规则详情'}
        size="lg"
      >
        {selectedRule && editingRules && (
          <div className="space-y-5">
            {/* 头部信息 */}
            <div className="flex items-center gap-4 p-4 rounded-xl bg-bg-elevated">
              <div className={`w-12 h-12 ${getPlatformDisplay(selectedRule.platform).color} rounded-xl flex items-center justify-center text-2xl`}>
                {getPlatformDisplay(selectedRule.platform).icon}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold text-text-primary">{getPlatformDisplay(selectedRule.platform).name}</h3>
                <p className="text-xs text-text-tertiary truncate">{selectedRule.document_name}</p>
              </div>
              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${statusConfig[selectedRule.status]?.bg} ${statusConfig[selectedRule.status]?.color}`}>
                {statusConfig[selectedRule.status]?.label}
              </span>
            </div>

            {/* 违禁词 */}
            <div>
              <h4 className="text-sm font-medium text-text-primary mb-2">
                违禁词
                <span className="text-text-tertiary font-normal ml-1">({editingRules.forbidden_words.length})</span>
              </h4>
              <div className="flex flex-wrap gap-2 mb-2">
                {editingRules.forbidden_words.map((word, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-accent-coral/10 text-accent-coral text-sm border border-accent-coral/20">
                    {word}
                    <button type="button" onClick={() => removeForbiddenWord(i)} className="hover:text-accent-coral/70">
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={editingForbiddenInput}
                  onChange={(e) => setEditingForbiddenInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addForbiddenWord() } }}
                  placeholder="添加违禁词..."
                  className="flex-1 px-3 py-1.5 border border-border-subtle rounded-lg bg-bg-elevated text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent-indigo"
                />
                <Button size="sm" onClick={addForbiddenWord} disabled={!editingForbiddenInput.trim()}>
                  添加
                </Button>
              </div>
            </div>

            {/* 限制词 */}
            {editingRules.restricted_words.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-text-primary mb-2">限制词</h4>
                <div className="space-y-2">
                  {editingRules.restricted_words.map((rw, i) => (
                    <div key={i} className="p-3 rounded-lg bg-bg-elevated border border-border-subtle">
                      <p className="text-sm text-text-primary font-medium">{rw.word}</p>
                      <p className="text-xs text-text-tertiary mt-0.5">条件：{rw.condition}</p>
                      <p className="text-xs text-accent-indigo mt-0.5">建议：{rw.suggestion}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 时长要求 */}
            {editingRules.duration && (
              <div>
                <h4 className="text-sm font-medium text-text-primary mb-2">时长要求</h4>
                <div className="p-3 rounded-lg bg-bg-elevated border border-border-subtle text-sm text-text-secondary">
                  {editingRules.duration.min_seconds && <span>最短 {editingRules.duration.min_seconds} 秒</span>}
                  {editingRules.duration.min_seconds && editingRules.duration.max_seconds && <span> / </span>}
                  {editingRules.duration.max_seconds && <span>最长 {editingRules.duration.max_seconds} 秒</span>}
                </div>
              </div>
            )}

            {/* 内容要求 */}
            {editingRules.content_requirements.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-text-primary mb-2">内容要求</h4>
                <div className="space-y-1.5">
                  {editingRules.content_requirements.map((req, i) => (
                    <div key={i} className="flex items-center gap-2 p-2.5 rounded-lg bg-bg-elevated border border-border-subtle">
                      <CheckCircle size={14} className="text-accent-green flex-shrink-0" />
                      <span className="text-sm text-text-primary flex-1">{req}</span>
                      <button type="button" onClick={() => removeContentReq(i)} className="text-text-tertiary hover:text-accent-coral">
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 其他规则 */}
            {editingRules.other_rules.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-text-primary mb-2">其他规则</h4>
                <div className="space-y-2">
                  {editingRules.other_rules.map((or, i) => (
                    <div key={i} className="p-3 rounded-lg bg-bg-elevated border border-border-subtle">
                      <p className="text-sm font-medium text-text-primary">{or.rule}</p>
                      <p className="text-xs text-text-tertiary mt-0.5">{or.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex gap-3 justify-end pt-2 border-t border-border-subtle">
              <Button variant="ghost" onClick={() => { setShowDetailModal(false); setSelectedRule(null); setEditingRules(null) }}>
                取消
              </Button>
              {selectedRule.status === 'active' && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowDetailModal(false)
                    setShowUploadModal(true)
                    setUploadPlatform(selectedRule.platform)
                  }}
                >
                  <Upload size={16} />
                  重新上传
                </Button>
              )}
              <Button onClick={handleConfirmRule} disabled={submitting} loading={submitting}>
                <CheckCircle size={16} />
                {selectedRule.status === 'draft' ? '确认生效' : '保存修改'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ==================== 添加违禁词弹窗 ==================== */}
      <Modal
        isOpen={showAddWordModal}
        onClose={() => { setShowAddWordModal(false); setNewWord(''); setBatchWords('') }}
        title="添加违禁词"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">分类</label>
            <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)} className="w-full px-4 py-2.5 border border-border-subtle rounded-xl bg-bg-elevated text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-indigo">
              {categoryOptions.map(opt => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">单个添加</label>
            <div className="flex gap-2">
              <input type="text" value={newWord} onChange={(e) => setNewWord(e.target.value)} placeholder="输入违禁词" className="flex-1 px-4 py-2.5 border border-border-subtle rounded-xl bg-bg-elevated text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-indigo" />
              <Button onClick={handleAddWord} disabled={!newWord.trim() || submitting}>
                {submitting ? <Loader2 size={16} className="animate-spin" /> : '添加'}
              </Button>
            </div>
          </div>
          <div className="relative">
            <div className="absolute inset-x-0 top-1/2 border-t border-border-subtle" />
            <div className="relative flex justify-center">
              <span className="bg-bg-card px-3 text-sm text-text-tertiary">或</span>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              <Upload size={14} className="inline mr-1" />
              批量添加（每行一个）
            </label>
            <textarea value={batchWords} onChange={(e) => setBatchWords(e.target.value)} placeholder={'最好\n第一\n最佳\n...'} className="w-full h-32 px-4 py-3 border border-border-subtle rounded-xl bg-bg-elevated text-text-primary placeholder-text-tertiary resize-none focus:outline-none focus:ring-2 focus:ring-accent-indigo font-mono text-sm" />
            <div className="flex justify-between items-center mt-2">
              <span className="text-xs text-text-tertiary">{batchWords.split('\n').filter(w => w.trim()).length} 个词汇待添加</span>
              <Button onClick={handleBatchAdd} disabled={!batchWords.trim() || submitting}>
                {submitting ? (<span className="flex items-center gap-2"><Loader2 size={14} className="animate-spin" />添加中...</span>) : '批量添加'}
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* ==================== 添加竞品弹窗 ==================== */}
      <Modal isOpen={showAddCompetitorModal} onClose={() => { setShowAddCompetitorModal(false); setNewCompetitor('') }} title="添加竞品">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">竞品名称</label>
            <input type="text" value={newCompetitor} onChange={(e) => setNewCompetitor(e.target.value)} placeholder="输入竞品品牌名称" className="w-full px-4 py-2.5 border border-border-subtle rounded-xl bg-bg-elevated text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-indigo" />
          </div>
          <p className="text-sm text-text-tertiary">添加后，AI将在视频中自动检测该品牌的Logo或名称出现</p>
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="ghost" onClick={() => { setShowAddCompetitorModal(false); setNewCompetitor('') }}>取消</Button>
            <Button onClick={handleAddCompetitor} disabled={!newCompetitor.trim() || submitting}>
              {submitting ? (<span className="flex items-center gap-2"><Loader2 size={14} className="animate-spin" />添加中...</span>) : '添加'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ==================== 添加白名单弹窗 ==================== */}
      <Modal isOpen={showAddWhitelistModal} onClose={() => { setShowAddWhitelistModal(false); setNewWhitelistTerm(''); setNewWhitelistReason('') }} title="添加白名单">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">词汇</label>
            <input type="text" value={newWhitelistTerm} onChange={(e) => setNewWhitelistTerm(e.target.value)} placeholder="输入需要豁免的词汇" className="w-full px-4 py-2.5 border border-border-subtle rounded-xl bg-bg-elevated text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-indigo" />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">豁免原因</label>
            <input type="text" value={newWhitelistReason} onChange={(e) => setNewWhitelistReason(e.target.value)} placeholder="例如：品牌授权使用" className="w-full px-4 py-2.5 border border-border-subtle rounded-xl bg-bg-elevated text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-indigo" />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="ghost" onClick={() => { setShowAddWhitelistModal(false); setNewWhitelistTerm(''); setNewWhitelistReason('') }}>取消</Button>
            <Button onClick={handleAddWhitelist} disabled={!newWhitelistTerm.trim() || submitting}>
              {submitting ? (<span className="flex items-center gap-2"><Loader2 size={14} className="animate-spin" />添加中...</span>) : '添加'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ==================== 添加学习规则弹窗 ==================== */}
      <Modal isOpen={showAddLearningModal} onClose={() => { setShowAddLearningModal(false); setNewLearningPattern(''); setNewLearningReason('') }} title="手动添加学习规则">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">规则类型</label>
            <select value={newLearningType} onChange={(e) => setNewLearningType(e.target.value)} className="w-full px-4 py-2.5 border border-border-subtle rounded-xl bg-bg-elevated text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-indigo">
              <optgroup label="放宽规则">
                <option value="允许表达">可接受表达</option>
                <option value="调性偏好">调性偏好</option>
                <option value="误判">AI 误判纠正</option>
                <option value="风格偏好">风格偏好</option>
              </optgroup>
              <optgroup label="收紧规则">
                <option value="调性偏严">调性收紧</option>
                <option value="缺少要素">遗漏要求</option>
                <option value="品牌不符">品牌不匹配</option>
                <option value="质量不达标">质量标准</option>
              </optgroup>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">规则描述</label>
            <textarea value={newLearningPattern} onChange={(e) => setNewLearningPattern(e.target.value)} placeholder="描述在什么情况下不应标记（要可泛化）" className="w-full h-20 px-4 py-3 border border-border-subtle rounded-xl bg-bg-elevated text-text-primary resize-none focus:outline-none focus:ring-2 focus:ring-accent-indigo" />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">原因说明</label>
            <textarea value={newLearningReason} onChange={(e) => setNewLearningReason(e.target.value)} placeholder="从品牌定位和平台特性角度解释为什么不应标记" className="w-full h-20 px-4 py-3 border border-border-subtle rounded-xl bg-bg-elevated text-text-primary resize-none focus:outline-none focus:ring-2 focus:ring-accent-indigo" />
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="ghost" onClick={() => { setShowAddLearningModal(false); setNewLearningPattern(''); setNewLearningReason('') }}>取消</Button>
            <Button onClick={handleAddLearningRule} disabled={!newLearningPattern.trim() || !newLearningReason.trim() || submitting}>
              {submitting ? (<span className="flex items-center gap-2"><Loader2 size={14} className="animate-spin" />添加中...</span>) : '添加'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ==================== 通用规则文档导入弹窗 ==================== */}
      <Modal
        isOpen={showDocUploadModal}
        onClose={() => { if (!docParsing) { setShowDocUploadModal(false); setDocUploadFile(null); setDocParseResult(null) } }}
        title={`文档导入 — ${docUploadType === 'forbidden_words' ? '违禁词' : docUploadType === 'whitelist' ? '白名单' : '竞品'}`}
      >
        <div className="space-y-4">
          {!docParseResult ? (
            <>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">上传文档 (PDF / Word / Excel)</label>
                <input
                  ref={docFileInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.txt"
                  onChange={(e) => setDocUploadFile(e.target.files?.[0] || null)}
                  className="w-full text-sm text-text-secondary file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-medium file:bg-accent-indigo/15 file:text-accent-indigo hover:file:bg-accent-indigo/25"
                />
              </div>
              {docUploadFile && (
                <div className="p-3 bg-bg-elevated rounded-lg flex items-center gap-3">
                  <FileText size={20} className="text-accent-indigo" />
                  <div className="flex-1">
                    <p className="text-sm text-text-primary">{docUploadFile.name}</p>
                    <p className="text-xs text-text-tertiary">{(docUploadFile.size / 1024).toFixed(1)} KB</p>
                  </div>
                </div>
              )}
              <div className="flex gap-3 justify-end pt-2">
                <Button variant="ghost" onClick={() => { setShowDocUploadModal(false); setDocUploadFile(null) }}>取消</Button>
                <Button onClick={handleDocUpload} disabled={!docUploadFile || docParsing}>
                  {docParsing ? (<span className="flex items-center gap-2"><Loader2 size={14} className="animate-spin" />AI 解析中...</span>) : (<span className="flex items-center gap-2"><Sparkles size={14} />AI 解析</span>)}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="p-3 bg-accent-green/10 border border-accent-green/30 rounded-lg">
                <p className="text-sm text-accent-green font-medium">解析完成</p>
                <p className="text-xs text-text-secondary mt-1">
                  共解析 {docParseResult.total_parsed} 条规则
                  {docParseResult.duplicates_removed > 0 && `，已自动去重 ${docParseResult.duplicates_removed} 条`}
                </p>
              </div>
              <div className="max-h-64 overflow-y-auto space-y-2">
                {docParseResult.forbidden_words.map((w, i) => (
                  <div key={i} className="flex items-center justify-between p-2 bg-bg-elevated rounded-lg text-sm">
                    <span className="text-text-primary">{w.word}</span>
                    <span className="text-xs text-text-tertiary">{w.category}</span>
                  </div>
                ))}
                {docParseResult.whitelist_items.map((w, i) => (
                  <div key={i} className="flex items-center justify-between p-2 bg-bg-elevated rounded-lg text-sm">
                    <span className="text-text-primary">{w.term}</span>
                    <span className="text-xs text-text-tertiary">{w.reason}</span>
                  </div>
                ))}
                {docParseResult.competitors.map((c, i) => (
                  <div key={i} className="flex items-center justify-between p-2 bg-bg-elevated rounded-lg text-sm">
                    <span className="text-text-primary">{c.name}</span>
                    <span className="text-xs text-text-tertiary">{c.keywords.join(', ')}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <Button variant="ghost" onClick={() => { setDocParseResult(null); setDocUploadFile(null) }}>重新上传</Button>
                <Button onClick={handleDocConfirm} disabled={submitting}>
                  {submitting ? (<span className="flex items-center gap-2"><Loader2 size={14} className="animate-spin" />导入中...</span>) : (<span className="flex items-center gap-2"><CheckCircle size={14} />确认导入</span>)}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  )
}
