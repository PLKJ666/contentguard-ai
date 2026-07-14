'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowLeft, Bot, CheckCircle2, FileUp, Layers3, Loader2, RefreshCw, ShieldAlert, Sparkles, UploadCloud } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { XHSCategorySelectField } from '@/components/xhs/CategorySelectField'
import { PendingTag, SuccessTag, WarningTag } from '@/components/ui/Tag'
import { useToast } from '@/components/ui/Toast'
import { api, extractErrorMessage } from '@/lib/api'
import { getXHSCategoryLabel } from '@/lib/xhsCategories'
import type {
  XHSBrandPack,
  XHSBrandPackPayload,
  XHSBriefPack,
  XHSBriefPackParseResponse,
  XHSBriefPackPayload,
  XHSConfigConflict,
  XHSPackStatus,
  XHSRulePack,
  XHSRulePackPayload,
  XHSRiskPack,
  XHSRiskPackPayload,
  XHSSourceType,
} from '@/types/xhs'

type ConfigTab = 'rule' | 'brand' | 'brief' | 'risk'

const tabs: Array<{ id: ConfigTab; label: string; hint: string }> = [
  { id: 'rule', label: '规则包', hint: '当前复用规则中心，批次页填写规则版本' },
  { id: 'brand', label: '品牌包', hint: '品牌事实、SKU 与事实图谱' },
  { id: 'brief', label: '需求包', hint: '从需求文档文本或附件提炼创作信息' },
  { id: 'risk', label: '风险包', hint: '风险线索、替代表达与置信度' },
]

const packStatusOptions: Array<{ value: '' | XHSPackStatus; label: string }> = [
  { value: '', label: '全部状态' },
  { value: 'draft', label: '草稿' },
  { value: 'active', label: '生效中' },
  { value: 'archived', label: '已归档' },
]

const sourceTypeLabels: Record<XHSSourceType, string> = {
  upload: '上传文件',
  feishu_link: '飞书链接',
}

const defaultBrandPack: XHSBrandPackPayload = {
  brand_facts: [],
  products: [],
  fact_graph: { nodes: [], relations: [] },
  optional_blocks: [],
}

const defaultRulePack: XHSRulePackPayload = {
  banned_terms: [],
  risk_patterns: [],
  replace_map: {},
  format_rules: {
    allow_markdown: false,
    max_chars_per_note: 1000,
    forbidden_symbols: ['---', '# '],
    hashtag: {
      max_count: 8,
      banned_terms_in_tags: [],
    },
  },
  structure_rules: {
    preferred_sections: ['title', 'pain_point', 'product_facts', 'experience', 'hashtags'],
    section_isolation: true,
  },
}

const defaultBriefPack: XHSBriefPackPayload = {
  brand_facts: {},
  sku_facts: [],
  selling_point_priority: [],
  recommended_phrasings: [],
  forbidden_phrasings: [],
  uncertain_fields: [],
}

const defaultRiskPack: XHSRiskPackPayload = {
  risk_clues: [],
  replace_hints: [],
  confidence_level: null,
}

function prettyJson(value: unknown) {
  return JSON.stringify(value, null, 2)
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).replace(/\//g, '-')
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T
}

function toRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>
}

function statusTag(status: XHSPackStatus) {
  if (status === 'active') return <SuccessTag size="sm">生效中</SuccessTag>
  if (status === 'archived') return <WarningTag size="sm">已归档</WarningTag>
  return <PendingTag size="sm">草稿</PendingTag>
}

function ConflictList({ conflicts }: { conflicts: XHSConfigConflict[] }) {
  if (conflicts.length === 0) {
    return (
      <div className="rounded-2xl border border-accent-green/20 bg-accent-green/10 px-4 py-3 text-sm text-accent-green">
        校验通过，未发现冲突。
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {conflicts.map((conflict, index) => (
        <div
          key={`${conflict.field}-${index}`}
          className={`rounded-2xl border px-4 py-3 text-sm ${
            conflict.severity === 'warning'
              ? 'border-accent-amber/20 bg-accent-amber/10 text-accent-amber'
              : 'border-accent-coral/20 bg-accent-coral/10 text-accent-coral'
          }`}
        >
          <div className="font-bold">{conflict.field}</div>
          <div className="mt-1">{conflict.message}</div>
        </div>
      ))}
    </div>
  )
}

export default function AgencyXHSConfigPage() {
  const pathname = usePathname() || ''
  const scopeRoot = pathname.startsWith('/operator') ? '/operator' : '/agency'
  const xhsBasePath = `${scopeRoot}/xhs`
  const aiConfigPath = `${scopeRoot}/ai-config`
  const rulesPath = `${scopeRoot}/rules`
  const toast = useToast()
  const [activeTab, setActiveTab] = useState<ConfigTab>('rule')
  const [categoryFilter, setCategoryFilter] = useState('beauty')
  const [statusFilter, setStatusFilter] = useState<'' | XHSPackStatus>('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [publishingId, setPublishingId] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [parsingBrief, setParsingBrief] = useState(false)
  const [uploadingBriefFile, setUploadingBriefFile] = useState(false)

  const [rulePacks, setRulePacks] = useState<XHSRulePack[]>([])
  const [brandPacks, setBrandPacks] = useState<XHSBrandPack[]>([])
  const [briefPacks, setBriefPacks] = useState<XHSBriefPack[]>([])
  const [riskPacks, setRiskPacks] = useState<XHSRiskPack[]>([])

  const [ruleForm, setRuleForm] = useState({
    name: '',
    category_id: 'beauty',
    version: 'v1',
    packJson: prettyJson(defaultRulePack),
  })
  const [brandForm, setBrandForm] = useState({
    brand_name: '',
    category_id: 'beauty',
    version: 'v1',
    is_default: false,
    packJson: prettyJson(defaultBrandPack),
  })
  const [briefForm, setBriefForm] = useState({
    brand_name: '',
    category_id: 'beauty',
    version: 'v1',
    source_type: 'upload' as XHSSourceType,
    source_ref: '',
    packJson: prettyJson(defaultBriefPack),
  })
  const [riskForm, setRiskForm] = useState({
    name: '',
    category_id: 'beauty',
    version: 'v1',
    packJson: prettyJson(defaultRiskPack),
  })
  const [briefParseInput, setBriefParseInput] = useState({
    source_type: 'upload' as XHSSourceType,
    source_ref: '',
    source_text: '',
    uploadedFileName: '',
  })
  const [briefParseResult, setBriefParseResult] = useState<XHSBriefPackParseResponse | null>(null)

  const activeItems = useMemo(() => {
    if (activeTab === 'rule') return rulePacks
    if (activeTab === 'brand') return brandPacks
    if (activeTab === 'brief') return briefPacks
    return riskPacks
  }, [activeTab, rulePacks, brandPacks, briefPacks, riskPacks])

  const loadCurrentTab = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true)
    else setRefreshing(true)

    try {
      const params = {
        category_id: categoryFilter || undefined,
        status: statusFilter || undefined,
      }
      if (activeTab === 'rule') {
        setRulePacks(await api.listXHSRulePacks(params))
      } else if (activeTab === 'brand') {
        setBrandPacks(await api.listXHSBrandPacks(params))
      } else if (activeTab === 'brief') {
        setBriefPacks(await api.listXHSBriefPacks(params))
      } else {
        setRiskPacks(await api.listXHSRiskPacks(params))
      }
    } catch (err) {
      toast.error(`加载配置失败：${extractErrorMessage(err)}`)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [activeTab, categoryFilter, statusFilter, toast])

  useEffect(() => {
    void loadCurrentTab(true)
  }, [loadCurrentTab])

  const openCreateModal = useCallback(() => {
    setEditingId(null)
    if (activeTab === 'rule') {
      setRuleForm({
        name: '',
        category_id: categoryFilter || 'beauty',
        version: 'v1',
        packJson: prettyJson(defaultRulePack),
      })
    } else if (activeTab === 'brand') {
      setBrandForm({
        brand_name: '',
        category_id: categoryFilter || 'beauty',
        version: 'v1',
        is_default: false,
        packJson: prettyJson(defaultBrandPack),
      })
    } else if (activeTab === 'brief') {
      setBriefForm({
        brand_name: '',
        category_id: categoryFilter || 'beauty',
        version: 'v1',
        source_type: 'upload',
        source_ref: '',
        packJson: prettyJson(defaultBriefPack),
      })
      setBriefParseInput({
        source_type: 'upload',
        source_ref: '',
        source_text: '',
        uploadedFileName: '',
      })
      setBriefParseResult(null)
    } else {
      setRiskForm({
        name: '',
        category_id: categoryFilter || 'beauty',
        version: 'v1',
        packJson: prettyJson(defaultRiskPack),
      })
    }
    setShowCreateModal(true)
  }, [activeTab, categoryFilter])

  const openEditModal = useCallback((item: XHSRulePack | XHSBrandPack | XHSBriefPack | XHSRiskPack) => {
    setEditingId(item.id)
    if ('is_default' in item) {
      setActiveTab('brand')
      setBrandForm({
        brand_name: item.brand_name,
        category_id: item.category_id,
        version: item.version,
        is_default: item.is_default,
        packJson: prettyJson(item.pack),
      })
    } else if ('source_type' in item) {
      setActiveTab('brief')
      setBriefForm({
        brand_name: item.brand_name,
        category_id: item.category_id,
        version: item.version,
        source_type: item.source_type,
        source_ref: item.source_ref || '',
        packJson: prettyJson(item.pack),
      })
      setBriefParseInput({
        source_type: item.source_type,
        source_ref: item.source_ref || '',
        source_text: '',
        uploadedFileName: '',
      })
      setBriefParseResult(null)
    } else if ('risk_clues' in (item as XHSRiskPack).pack) {
      setActiveTab('risk')
      setRiskForm({
        name: item.name,
        category_id: item.category_id,
        version: item.version,
        packJson: prettyJson(item.pack),
      })
    } else {
      setActiveTab('rule')
      setRuleForm({
        name: item.name,
        category_id: item.category_id,
        version: item.version,
        packJson: prettyJson(item.pack),
      })
    }
    setShowCreateModal(true)
  }, [])

  const handlePublish = useCallback(async (id: string) => {
    setPublishingId(id)
    try {
      if (activeTab === 'rule') {
        await api.publishXHSRulePack(id)
      } else if (activeTab === 'brand') {
        await api.publishXHSBrandPack(id)
      } else if (activeTab === 'brief') {
        await api.publishXHSBriefPack(id)
      } else {
        await api.publishXHSRiskPack(id)
      }
      toast.success('已发布为生效版本')
      await loadCurrentTab()
    } catch (err) {
      toast.error(`发布失败：${extractErrorMessage(err)}`)
    } finally {
      setPublishingId(null)
    }
  }, [activeTab, loadCurrentTab, toast])

  const handleCreateRulePack = useCallback(async () => {
    setCreating(true)
    try {
      const payload = {
        name: ruleForm.name.trim(),
        category_id: ruleForm.category_id.trim(),
        version: ruleForm.version.trim(),
        pack: toRecord(parseJson<XHSRulePackPayload>(ruleForm.packJson)),
      }
      if (editingId) {
        await api.updateXHSRulePack(editingId, payload)
        toast.success('规则包已更新')
      } else {
        await api.createXHSRulePack(payload)
        toast.success('规则包已创建')
      }
      setShowCreateModal(false)
      setEditingId(null)
      await loadCurrentTab()
    } catch (err) {
      toast.error(`创建失败：${extractErrorMessage(err)}`)
    } finally {
      setCreating(false)
    }
  }, [editingId, loadCurrentTab, ruleForm, toast])

  const handleCreateBrandPack = useCallback(async () => {
    setCreating(true)
    try {
      const payload = {
        brand_name: brandForm.brand_name.trim(),
        category_id: brandForm.category_id.trim(),
        version: brandForm.version.trim(),
        is_default: brandForm.is_default,
        pack: toRecord(parseJson<XHSBrandPackPayload>(brandForm.packJson)),
      }
      if (editingId) {
        await api.updateXHSBrandPack(editingId, payload)
        toast.success('品牌包已更新')
      } else {
        await api.createXHSBrandPack(payload)
        toast.success('品牌包已创建')
      }
      setShowCreateModal(false)
      setEditingId(null)
      await loadCurrentTab()
    } catch (err) {
      toast.error(`创建失败：${extractErrorMessage(err)}`)
    } finally {
      setCreating(false)
    }
  }, [brandForm, editingId, loadCurrentTab, toast])

  const handleParseBrief = useCallback(async (file?: File) => {
    setParsingBrief(true)
    try {
      let payload: {
        source_type: XHSSourceType
        source_ref?: string
        source_text?: string
        file_url?: string
        file_name?: string
      } = {
        source_type: briefParseInput.source_type,
        source_ref: briefParseInput.source_ref || undefined,
        source_text: briefParseInput.source_text.trim() || undefined,
      }

      if (file) {
        setUploadingBriefFile(true)
        const uploaded = await api.proxyUpload(file, 'script')
        setBriefParseInput((prev) => ({
          ...prev,
          source_type: 'upload',
          source_ref: uploaded.file_key,
          uploadedFileName: uploaded.file_name,
        }))
        payload = {
          source_type: 'upload',
          source_ref: uploaded.file_key,
          file_url: uploaded.url,
          file_name: uploaded.file_name,
        }
      }

      const result = await api.parseXHSBriefPack(payload)
      setBriefParseResult(result)
      setBriefForm((prev) => ({
        ...prev,
        source_type: result.source_type,
        source_ref: result.source_ref || payload.source_ref || '',
        packJson: prettyJson(result.pack),
      }))
      toast.success('需求文档已解析，可继续编辑后保存')
    } catch (err) {
      toast.error(`解析失败：${extractErrorMessage(err)}`)
    } finally {
      setParsingBrief(false)
      setUploadingBriefFile(false)
    }
  }, [briefParseInput, toast])

  const handleCreateBriefPack = useCallback(async () => {
    setCreating(true)
    try {
      const payload = {
        brand_name: briefForm.brand_name.trim(),
        category_id: briefForm.category_id.trim(),
        version: briefForm.version.trim(),
        source_type: briefForm.source_type,
        source_ref: briefForm.source_ref.trim() || undefined,
        pack: toRecord(parseJson<XHSBriefPackPayload>(briefForm.packJson)),
      }
      if (editingId) {
        await api.updateXHSBriefPack(editingId, payload)
        toast.success('需求包已更新')
      } else {
        await api.createXHSBriefPack(payload)
        toast.success('需求包已创建')
      }
      setShowCreateModal(false)
      setEditingId(null)
      await loadCurrentTab()
    } catch (err) {
      toast.error(`创建失败：${extractErrorMessage(err)}`)
    } finally {
      setCreating(false)
    }
  }, [briefForm, editingId, loadCurrentTab, toast])

  const handleCreateRiskPack = useCallback(async () => {
    setCreating(true)
    try {
      const payload = {
        name: riskForm.name.trim(),
        category_id: riskForm.category_id.trim(),
        version: riskForm.version.trim(),
        pack: toRecord(parseJson<XHSRiskPackPayload>(riskForm.packJson)),
      }
      if (editingId) {
        await api.updateXHSRiskPack(editingId, payload)
        toast.success('风险包已更新')
      } else {
        await api.createXHSRiskPack(payload)
        toast.success('风险包已创建')
      }
      setShowCreateModal(false)
      setEditingId(null)
      await loadCurrentTab()
    } catch (err) {
      toast.error(`创建失败：${extractErrorMessage(err)}`)
    } finally {
      setCreating(false)
    }
  }, [editingId, loadCurrentTab, riskForm, toast])

  return (
    <div className="space-y-8 min-h-0 pb-20 max-w-[1480px] mx-auto">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <Link href={xhsBasePath} className="inline-flex items-center gap-2 text-sm text-text-tertiary hover:text-text-primary">
            <ArrowLeft size={15} />
            返回批量改写
          </Link>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent-indigo/10 text-accent-indigo text-xs font-black uppercase tracking-[0.24em]">
            <Layers3 size={12} />
            配置中心
          </div>
          <h1 className="text-3xl font-black tracking-tighter text-text-primary">小红书配置资产</h1>
          <p className="text-sm text-text-tertiary">统一管理规则包、品牌包、需求包、风险包，为批量任务提供可发布、可追踪的稳定输入。</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" icon={Bot} onClick={() => { window.location.href = aiConfigPath }}>
            AI 配置
          </Button>
          <Button variant="secondary" icon={RefreshCw} loading={refreshing} onClick={() => void loadCurrentTab()}>
            刷新列表
          </Button>
          <Button icon={Sparkles} onClick={openCreateModal}>新建 {tabs.find((item) => item.id === activeTab)?.label}</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-3 space-y-4">
          <Card className="border-border-subtle/70">
            <CardHeader>
              <CardTitle>配置类型</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {tabs.map((tab) => {
                const isActive = tab.id === activeTab
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full rounded-2xl border px-4 py-4 text-left transition-all ${
                      isActive ? 'border-accent-indigo bg-accent-indigo/10' : 'border-border-subtle bg-bg-card hover:border-accent-indigo/40'
                    }`}
                  >
                    <div className="font-black text-text-primary">{tab.label}</div>
                    <div className="mt-1 text-xs leading-5 text-text-tertiary">{tab.hint}</div>
                  </button>
                )
              })}
            </CardContent>
          </Card>

          <Card className="border-border-subtle/70">
            <CardHeader>
              <CardTitle>筛选</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <XHSCategorySelectField
                label="品类"
                value={categoryFilter}
                onChange={setCategoryFilter}
                allowEmpty
                emptyLabel="全部品类"
                customPlaceholder="请输入其它品类，例如：线下服务"
              />
              <label className="block space-y-2 text-sm">
                <span className="font-medium text-text-primary">状态</span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as '' | XHSPackStatus)}
                  className="w-full rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2.5 text-text-primary"
                >
                  {packStatusOptions.map((option) => (
                    <option key={option.label} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </CardContent>
          </Card>
        </div>

        <div className="xl:col-span-9 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              ['当前类型数量', String(activeItems.length)],
              ['生效中', String(activeItems.filter((item) => item.status === 'active').length)],
              ['草稿', String(activeItems.filter((item) => item.status === 'draft').length)],
            ].map(([label, value]) => (
              <Card key={label} className="border-border-subtle/70">
                <CardContent className="py-5">
                  <div className="text-xs uppercase tracking-[0.18em] text-text-tertiary">{label}</div>
                  <div className="mt-2 text-3xl font-black tracking-tighter text-text-primary">{value}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="border-border-subtle/70">
            <CardHeader>
              <CardTitle>{tabs.find((item) => item.id === activeTab)?.label} 列表</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {activeTab === 'rule' && (
                <div className="rounded-2xl border border-accent-indigo/20 bg-accent-indigo/10 p-5">
                  <div className="text-sm font-bold text-text-primary">规则包用于沉淀“小红书品类合规规则”</div>
                  <div className="mt-2 text-sm leading-6 text-text-secondary">
                    这里维护版本化的禁用表达、风险正则、替换建议和格式/结构约束。通用违禁词和平台规则仍可去规则中心辅助维护。
                  </div>
                  <div className="mt-4">
                    <Link href={rulesPath}>
                      <Button variant="secondary">打开规则中心</Button>
                    </Link>
                  </div>
                </div>
              )}
              {loading ? (
                <div className="py-10 flex items-center justify-center text-text-tertiary">
                  <Loader2 size={18} className="animate-spin mr-2" />
                  加载中
                </div>
              ) : activeItems.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border-subtle px-6 py-10 text-center text-text-tertiary">
                  当前筛选下还没有配置，先建一版。
                </div>
              ) : (
                activeItems.map((item) => {
                  const title = activeTab === 'brand'
                    ? (item as XHSBrandPack).brand_name
                    : activeTab === 'brief'
                      ? (item as XHSBriefPack).brand_name
                      : (item as XHSRulePack | XHSRiskPack).name
                  const secondary = activeTab === 'rule'
                    ? '合规规则'
                    : activeTab === 'brand'
                      ? ((item as XHSBrandPack).is_default ? '默认品牌包' : '品牌资产')
                      : activeTab === 'brief'
                        ? sourceTypeLabels[(item as XHSBriefPack).source_type] || (item as XHSBriefPack).source_type
                        : '风险控制'
                  return (
                    <div key={item.id} className="rounded-2xl border border-border-subtle bg-bg-card p-5">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-3 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-lg font-black text-text-primary">{title}</div>
                            {statusTag(item.status)}
                          </div>
                          <div className="text-sm text-text-secondary break-all">{item.id}</div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-text-tertiary">
                            <div>品类：{getXHSCategoryLabel(item.category_id)}</div>
                            <div>版本：{item.version}</div>
                            <div>补充：{secondary}</div>
                            <div>更新时间：{formatDateTime(item.updated_at)}</div>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-3">
                          <Button
                            variant="secondary"
                            onClick={() => navigator.clipboard.writeText(prettyJson(item.pack))}
                          >
                            复制 JSON
                          </Button>
                          <Button variant="secondary" onClick={() => openEditModal(item)}>
                            编辑
                          </Button>
                          {item.status !== 'active' && (
                            <Button
                              icon={CheckCircle2}
                              loading={publishingId === item.id}
                              onClick={() => void handlePublish(item.id)}
                            >
                              发布
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Modal
        isOpen={showCreateModal}
        onClose={() => {
          setShowCreateModal(false)
          setEditingId(null)
        }}
        size="xl"
        title={`${editingId ? '编辑' : '新建'} ${tabs.find((item) => item.id === activeTab)?.label}`}
        footer={(
          <>
            <Button variant="secondary" onClick={() => {
              setShowCreateModal(false)
              setEditingId(null)
            }}>取消</Button>
            {activeTab === 'rule' && <Button loading={creating} onClick={() => void handleCreateRulePack()}>{editingId ? '更新规则包' : '保存规则包'}</Button>}
            {activeTab === 'brand' && <Button loading={creating} onClick={() => void handleCreateBrandPack()}>{editingId ? '更新品牌包' : '保存品牌包'}</Button>}
            {activeTab === 'brief' && <Button loading={creating} onClick={() => void handleCreateBriefPack()}>{editingId ? '更新需求包' : '保存需求包'}</Button>}
            {activeTab === 'risk' && <Button loading={creating} onClick={() => void handleCreateRiskPack()}>{editingId ? '更新风险包' : '保存风险包'}</Button>}
          </>
        )}
      >
        {activeTab === 'rule' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="space-y-2 text-sm">
                <span className="font-medium text-text-primary">名称</span>
                <input
                  value={ruleForm.name}
                  onChange={(e) => setRuleForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2.5 text-text-primary"
                />
              </label>
              <XHSCategorySelectField
                label="品类"
                value={ruleForm.category_id}
                onChange={(value) => setRuleForm((prev) => ({ ...prev, category_id: value }))}
                customPlaceholder="请输入其它品类"
              />
              <label className="space-y-2 text-sm">
                <span className="font-medium text-text-primary">版本</span>
                <input
                  value={ruleForm.version}
                  onChange={(e) => setRuleForm((prev) => ({ ...prev, version: e.target.value }))}
                  className="w-full rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2.5 text-text-primary"
                />
              </label>
            </div>
            <label className="block space-y-2 text-sm">
              <span className="font-medium text-text-primary">配置 JSON</span>
              <textarea
                value={ruleForm.packJson}
                onChange={(e) => setRuleForm((prev) => ({ ...prev, packJson: e.target.value }))}
                rows={18}
                className="w-full rounded-2xl border border-border-subtle bg-bg-elevated px-3 py-3 font-mono text-xs text-text-primary"
              />
            </label>
          </div>
        )}

        {activeTab === 'brand' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="space-y-2 text-sm">
                <span className="font-medium text-text-primary">品牌名</span>
                <input
                  value={brandForm.brand_name}
                  onChange={(e) => setBrandForm((prev) => ({ ...prev, brand_name: e.target.value }))}
                  className="w-full rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2.5 text-text-primary"
                />
              </label>
              <XHSCategorySelectField
                label="品类"
                value={brandForm.category_id}
                onChange={(value) => setBrandForm((prev) => ({ ...prev, category_id: value }))}
                customPlaceholder="请输入其它品类"
              />
              <label className="space-y-2 text-sm">
                <span className="font-medium text-text-primary">版本</span>
                <input
                  value={brandForm.version}
                  onChange={(e) => setBrandForm((prev) => ({ ...prev, version: e.target.value }))}
                  className="w-full rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2.5 text-text-primary"
                />
              </label>
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-text-primary">
              <input
                type="checkbox"
                checked={brandForm.is_default}
                onChange={(e) => setBrandForm((prev) => ({ ...prev, is_default: e.target.checked }))}
                className="rounded border-border-subtle"
              />
              设为默认品牌包
            </label>
            <label className="block space-y-2 text-sm">
              <span className="font-medium text-text-primary">配置 JSON</span>
              <textarea
                value={brandForm.packJson}
                onChange={(e) => setBrandForm((prev) => ({ ...prev, packJson: e.target.value }))}
                rows={18}
                className="w-full rounded-2xl border border-border-subtle bg-bg-elevated px-3 py-3 font-mono text-xs text-text-primary"
              />
            </label>
          </div>
        )}

        {activeTab === 'brief' && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-border-subtle bg-bg-elevated/30 p-4 space-y-4">
              <div className="flex items-center gap-2 text-sm font-black text-text-primary">
                <FileUp size={16} className="text-accent-indigo" />
                先解析需求文档
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-text-primary">来源类型</span>
                  <select
                    value={briefParseInput.source_type}
                    onChange={(e) => {
                      const value = e.target.value as XHSSourceType
                      setBriefParseInput((prev) => ({ ...prev, source_type: value }))
                      setBriefForm((prev) => ({ ...prev, source_type: value }))
                    }}
                    className="w-full rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2.5 text-text-primary"
                  >
                    <option value="upload">上传文件</option>
                    <option value="feishu_link">飞书链接</option>
                  </select>
                </label>
                <label className="space-y-2 text-sm">
                  <span className="font-medium text-text-primary">来源引用</span>
                  <input
                    value={briefParseInput.source_ref}
                    onChange={(e) => {
                      setBriefParseInput((prev) => ({ ...prev, source_ref: e.target.value }))
                      setBriefForm((prev) => ({ ...prev, source_ref: e.target.value }))
                    }}
                    placeholder="文件 file_key 或飞书链接"
                    className="w-full rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2.5 text-text-primary"
                  />
                </label>
              </div>
              <label className="block space-y-2 text-sm">
                <span className="font-medium text-text-primary">源文本</span>
                <textarea
                  value={briefParseInput.source_text}
                  onChange={(e) => setBriefParseInput((prev) => ({ ...prev, source_text: e.target.value }))}
                  rows={8}
                  placeholder="可直接粘贴需求文档正文；如果上传文件，下方会调用代理上传后再解析。"
                  className="w-full rounded-2xl border border-border-subtle bg-bg-elevated px-3 py-3 text-sm text-text-primary"
                />
              </label>
              <div className="flex flex-wrap gap-3">
                <Button variant="secondary" loading={parsingBrief} onClick={() => void handleParseBrief()}>
                  解析当前文本
                </Button>
                <label className="inline-flex">
                  <input
                    type="file"
                    accept=".txt,.doc,.docx,.pdf,.xls,.xlsx"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) void handleParseBrief(file)
                      e.currentTarget.value = ''
                    }}
                  />
                  <span className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium ${uploadingBriefFile ? 'bg-bg-card text-text-tertiary' : 'bg-accent-indigo text-white cursor-pointer'}`}>
                    {uploadingBriefFile ? <Loader2 size={15} className="animate-spin" /> : <UploadCloud size={15} />}
                    {uploadingBriefFile ? '上传中' : '上传文件并解析'}
                  </span>
                </label>
              </div>
              {briefParseInput.uploadedFileName && (
                <div className="text-xs text-text-tertiary">
                  已上传：{briefParseInput.uploadedFileName}
                </div>
              )}
              {briefParseResult && (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-accent-indigo/20 bg-accent-indigo/10 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-accent-indigo font-black">提取文本预览</div>
                    <div className="mt-2 whitespace-pre-wrap text-sm text-text-primary max-h-48 overflow-y-auto">
                      {briefParseResult.extracted_text}
                    </div>
                  </div>
                  <ConflictList conflicts={briefParseResult.validation.conflicts} />
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <label className="space-y-2 text-sm">
                <span className="font-medium text-text-primary">品牌名</span>
                <input
                  value={briefForm.brand_name}
                  onChange={(e) => setBriefForm((prev) => ({ ...prev, brand_name: e.target.value }))}
                  className="w-full rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2.5 text-text-primary"
                />
              </label>
              <XHSCategorySelectField
                label="品类"
                value={briefForm.category_id}
                onChange={(value) => setBriefForm((prev) => ({ ...prev, category_id: value }))}
                customPlaceholder="请输入其它品类"
              />
              <label className="space-y-2 text-sm">
                <span className="font-medium text-text-primary">版本</span>
                <input
                  value={briefForm.version}
                  onChange={(e) => setBriefForm((prev) => ({ ...prev, version: e.target.value }))}
                  className="w-full rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2.5 text-text-primary"
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-medium text-text-primary">来源类型</span>
                <select
                  value={briefForm.source_type}
                  onChange={(e) => setBriefForm((prev) => ({ ...prev, source_type: e.target.value as XHSSourceType }))}
                  className="w-full rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2.5 text-text-primary"
                >
                  <option value="upload">上传文件</option>
                  <option value="feishu_link">飞书链接</option>
                </select>
              </label>
            </div>

            <label className="block space-y-2 text-sm">
              <span className="font-medium text-text-primary">来源引用</span>
              <input
                value={briefForm.source_ref}
                onChange={(e) => setBriefForm((prev) => ({ ...prev, source_ref: e.target.value }))}
                className="w-full rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2.5 text-text-primary"
              />
            </label>

            <label className="block space-y-2 text-sm">
              <span className="font-medium text-text-primary">配置 JSON</span>
              <textarea
                value={briefForm.packJson}
                onChange={(e) => setBriefForm((prev) => ({ ...prev, packJson: e.target.value }))}
                rows={18}
                className="w-full rounded-2xl border border-border-subtle bg-bg-elevated px-3 py-3 font-mono text-xs text-text-primary"
              />
            </label>
          </div>
        )}

        {activeTab === 'risk' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="space-y-2 text-sm">
                <span className="font-medium text-text-primary">名称</span>
                <input
                  value={riskForm.name}
                  onChange={(e) => setRiskForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2.5 text-text-primary"
                />
              </label>
              <XHSCategorySelectField
                label="品类"
                value={riskForm.category_id}
                onChange={(value) => setRiskForm((prev) => ({ ...prev, category_id: value }))}
                customPlaceholder="请输入其它品类"
              />
              <label className="space-y-2 text-sm">
                <span className="font-medium text-text-primary">版本</span>
                <input
                  value={riskForm.version}
                  onChange={(e) => setRiskForm((prev) => ({ ...prev, version: e.target.value }))}
                  className="w-full rounded-xl border border-border-subtle bg-bg-elevated px-3 py-2.5 text-text-primary"
                />
              </label>
            </div>
            <div className="rounded-2xl border border-accent-amber/20 bg-accent-amber/10 p-4 text-sm text-accent-amber">
              <div className="flex items-center gap-2 font-bold">
                <ShieldAlert size={16} />
                风险包建议先维护高频风险线索与替代表达，便于后续安全改写兜底。
              </div>
            </div>
            <label className="block space-y-2 text-sm">
              <span className="font-medium text-text-primary">配置 JSON</span>
              <textarea
                value={riskForm.packJson}
                onChange={(e) => setRiskForm((prev) => ({ ...prev, packJson: e.target.value }))}
                rows={18}
                className="w-full rounded-2xl border border-border-subtle bg-bg-elevated px-3 py-3 font-mono text-xs text-text-primary"
              />
            </label>
          </div>
        )}
      </Modal>
    </div>
  )
}
