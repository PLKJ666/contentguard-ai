'use client'

import { useState, useEffect, useCallback } from 'react'
import { usePathname } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import {
  Bot,
  Eye,
  Mic,
  Settings,
  CheckCircle,
  XCircle,
  Loader2,
  Info,
  Shield,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import { api, extractErrorMessage } from '@/lib/api'
import type { AIProvider, AIConfigResponse, ConnectionTestResponse, ModelInfo } from '@/types/ai-config'

// AI 提供商选项
const providerOptions: { value: AIProvider | string; label: string }[] = [
  { value: 'oneapi', label: 'OneAPI / One-in-All 中转服务' },
  { value: 'anthropic', label: 'Anthropic Claude' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'qwen', label: '通义千问' },
  { value: 'doubao', label: '豆包' },
  { value: 'zhipu', label: '智谱' },
  { value: 'moonshot', label: 'Moonshot' },
]

// 预设可用模型列表
// 模型列表由后端动态提供（/ai-config/models 或 /ai-config 缓存）

type TestStatus = 'idle' | 'testing' | 'success' | 'failed'

function ConfigSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-32 bg-bg-elevated rounded-lg" />
      <div className="h-48 bg-bg-elevated rounded-lg" />
      <div className="h-32 bg-bg-elevated rounded-lg" />
    </div>
  )
}

export default function AIConfigPage() {
  const pathname = usePathname()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const isAgencyXhsConfig = pathname?.startsWith('/agency/')

  const [provider, setProvider] = useState<string>('oneapi')
  const [baseUrl, setBaseUrl] = useState('https://ai.example.com/v1')
  const [apiKey, setApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [isConfigured, setIsConfigured] = useState(false)

  const [llmModel, setLlmModel] = useState('__custom__')
  const [visionModel, setVisionModel] = useState('__custom__')
  const [asrModel, setAsrModel] = useState('__custom__')
  const [xhsSplitModel, setXhsSplitModel] = useState('__inherit__')
  const [xhsEditorModel, setXhsEditorModel] = useState('__inherit__')
  const [xhsVerifierModel, setXhsVerifierModel] = useState('__inherit__')

  const [temperature, setTemperature] = useState(0.1)
  const [maxTokens, setMaxTokens] = useState(8192)

  const [availableModels, setAvailableModels] = useState<Record<string, ModelInfo[]>>({ text: [], vision: [], audio: [] })
  const [fetchingModels, setFetchingModels] = useState(false)
  const [customLlmModel, setCustomLlmModel] = useState('')
  const [customVisionModel, setCustomVisionModel] = useState('')
  const [customAsrModel, setCustomAsrModel] = useState('')
  const [customXhsSplitModel, setCustomXhsSplitModel] = useState('')
  const [customXhsEditorModel, setCustomXhsEditorModel] = useState('')
  const [customXhsVerifierModel, setCustomXhsVerifierModel] = useState('')

  const [testResults, setTestResults] = useState<Record<string, { status: TestStatus; latency?: number; error?: string }>>({
    text: { status: 'idle' },
    vision: { status: 'idle' },
    audio: { status: 'idle' },
    xhs_split: { status: 'idle' },
    xhs_editor: { status: 'idle' },
    xhs_verifier: { status: 'idle' },
  })

  // 从 OneInAll 拉取真实可用模型列表
  const fetchModels = useCallback(async (providerVal: string, baseUrlVal: string, apiKeyVal: string) => {
    setFetchingModels(true)
    try {
      const result = await api.getAIModels({
        provider: providerVal as AIProvider,
        base_url: baseUrlVal,
        api_key: apiKeyVal || '***',
      })
      if (result.success && result.models) {
        setAvailableModels(result.models)
        return result.models
      }
    } catch {
      // 拉取失败保持当前列表（可能是空的）
    } finally {
      setFetchingModels(false)
    }
    return null
  }, [])

  const loadConfig = useCallback(async () => {
    try {
      const config = await api.getAIConfig()
      setProvider(config.provider)
      setBaseUrl(config.base_url)
      setApiKey('') // API key is masked, don't fill it
      setIsConfigured(config.is_configured)

      // 优先用后端缓存的 available_models
      let models: Record<string, ModelInfo[]> = { text: [], vision: [], audio: [] }
      if (config.available_models && Object.keys(config.available_models).length > 0) {
        // 后端缓存的可能是 plain object，需要确保格式正确
        const cached = config.available_models as Record<string, Array<{ id: string; name: string }>>
        models = {
          text: (cached.text || []).map(m => ({ id: m.id, name: m.name })),
          vision: (cached.vision || []).map(m => ({ id: m.id, name: m.name })),
          audio: (cached.audio || []).map(m => ({ id: m.id, name: m.name })),
        }
        setAvailableModels(models)
      }

      // 设置已选模型（如果不在可用列表中，设为自定义）
      if (config.models.text && models.text.length > 0 && !models.text.some(m => m.id === config.models.text)) {
        setLlmModel('__custom__')
        setCustomLlmModel(config.models.text)
      } else {
        setLlmModel(config.models.text || '__custom__')
        if (config.models.text && models.text.length === 0) setCustomLlmModel(config.models.text)
      }
      if (isAgencyXhsConfig) {
        applyOptionalModelState(config.models.vision, models.vision, setVisionModel, setCustomVisionModel)
      } else if (config.models.vision && models.vision.length > 0 && !models.vision.some(m => m.id === config.models.vision)) {
        setVisionModel('__custom__')
        setCustomVisionModel(config.models.vision)
      } else {
        setVisionModel(config.models.vision || '__custom__')
        if (config.models.vision && models.vision.length === 0) setCustomVisionModel(config.models.vision)
      }
      if (config.models.audio && models.audio.length > 0 && !models.audio.some(m => m.id === config.models.audio)) {
        setAsrModel('__custom__')
        setCustomAsrModel(config.models.audio)
      } else {
        setAsrModel(config.models.audio || '__custom__')
        if (config.models.audio && models.audio.length === 0) setCustomAsrModel(config.models.audio)
      }
      applyOptionalModelState(config.models.xhs_split, models.text, setXhsSplitModel, setCustomXhsSplitModel)
      applyOptionalModelState(config.models.xhs_editor, models.text, setXhsEditorModel, setCustomXhsEditorModel)
      applyOptionalModelState(config.models.xhs_verifier, models.text, setXhsVerifierModel, setCustomXhsVerifierModel)

      setTemperature(config.parameters.temperature)
      setMaxTokens(config.parameters.max_tokens)

      // 如果后端没有缓存模型列表，尝试实时拉取
      if (config.is_configured && (!config.available_models || Object.keys(config.available_models).length === 0)) {
        const fetched = await fetchModels(config.provider, config.base_url, '***')
        if (fetched) {
          // 重新判断已选模型是否在拉取到的列表中
          if (config.models.text && fetched.text?.some(m => m.id === config.models.text)) {
            setLlmModel(config.models.text)
            setCustomLlmModel('')
          }
          if (isAgencyXhsConfig) {
            applyOptionalModelState(config.models.vision, fetched.vision || [], setVisionModel, setCustomVisionModel)
          } else if (config.models.vision && fetched.vision?.some(m => m.id === config.models.vision)) {
            setVisionModel(config.models.vision)
            setCustomVisionModel('')
          }
          if (config.models.audio && fetched.audio?.some(m => m.id === config.models.audio)) {
            setAsrModel(config.models.audio)
            setCustomAsrModel('')
          }
          applyOptionalModelState(config.models.xhs_split, fetched.text || [], setXhsSplitModel, setCustomXhsSplitModel)
          applyOptionalModelState(config.models.xhs_editor, fetched.text || [], setXhsEditorModel, setCustomXhsEditorModel)
          applyOptionalModelState(config.models.xhs_verifier, fetched.text || [], setXhsVerifierModel, setCustomXhsVerifierModel)
        }
      }
    } catch (err: any) {
      const msg = extractErrorMessage(err)
      if (msg.includes('未配置')) {
        setIsConfigured(false)
      } else {
        console.error('Failed to load AI config:', err)
        toast.error('加载 AI 配置失败：' + msg)
      }
    } finally {
      setLoading(false)
    }
  }, [toast, fetchModels, isAgencyXhsConfig])

  useEffect(() => { loadConfig() }, [loadConfig])

  const resolveRequiredModel = (selected: string, custom: string) =>
    selected === '__custom__' ? custom.trim() : selected.trim()

  const resolveSelectedModel = (selected: string, custom: string) => {
    if (selected === '__inherit__') return undefined
    return selected === '__custom__' ? custom.trim() || undefined : selected.trim() || undefined
  }

  const resolveOptionalModel = (selected: string, custom: string) => {
    if (selected === '__inherit__') return undefined
    return selected === '__custom__' ? custom.trim() || undefined : selected.trim() || undefined
  }

  const applyOptionalModelState = (
    configuredModel: string | undefined,
    availableTextModels: ModelInfo[],
    setSelected: (value: string) => void,
    setCustom: (value: string) => void
  ) => {
    if (!configuredModel) {
      setSelected('__inherit__')
      setCustom('')
      return
    }

    if (availableTextModels.length > 0 && !availableTextModels.some((model) => model.id === configuredModel)) {
      setSelected('__custom__')
      setCustom(configuredModel)
      return
    }

    setSelected(configuredModel)
    setCustom(availableTextModels.length === 0 ? configuredModel : '')
  }

  const buildModelsPayload = () => {
    const textModel = resolveRequiredModel(llmModel, customLlmModel)
    const explicitVisionModel = resolveSelectedModel(visionModel, customVisionModel)
    const explicitAudioModel = resolveSelectedModel(asrModel, customAsrModel)
    const xhsSplit = resolveOptionalModel(xhsSplitModel, customXhsSplitModel)
    const xhsEditor = resolveOptionalModel(xhsEditorModel, customXhsEditorModel)
    const xhsVerifier = resolveOptionalModel(xhsVerifierModel, customXhsVerifierModel)
    const requiredVisionModel = resolveRequiredModel(visionModel, customVisionModel)
    const requiredAudioModel = resolveRequiredModel(asrModel, customAsrModel)

    return {
      text: textModel,
      ...(isAgencyXhsConfig
        ? (explicitVisionModel ? { vision: explicitVisionModel } : {})
        : { vision: explicitVisionModel || requiredVisionModel }),
      ...(!isAgencyXhsConfig ? { audio: explicitAudioModel || requiredAudioModel } : {}),
      ...(isAgencyXhsConfig && xhsSplit ? { xhs_split: xhsSplit } : {}),
      ...(isAgencyXhsConfig && xhsEditor ? { xhs_editor: xhsEditor } : {}),
      ...(isAgencyXhsConfig && xhsVerifier ? { xhs_verifier: xhsVerifier } : {}),
    }
  }

  const handleTestConnection = async () => {
    setTestResults({
      text: { status: 'testing' },
      vision: { status: 'testing' },
      audio: { status: 'testing' },
      xhs_split: { status: 'testing' },
      xhs_editor: { status: 'testing' },
      xhs_verifier: { status: 'testing' },
    })

    try {
      const result: ConnectionTestResponse = await api.testAIConnection({
        provider: provider as AIProvider,
        base_url: baseUrl,
        api_key: apiKey || '***', // use existing key if not changed
        models: buildModelsPayload(),
      })
      const newResults: Record<string, { status: TestStatus; latency?: number; error?: string }> = {}
      for (const [key, r] of Object.entries(result.results)) {
        newResults[key] = {
          status: r.success ? 'success' : 'failed',
          latency: r.latency_ms ?? undefined,
          error: r.error ?? undefined,
        }
      }
      setTestResults(prev => ({ ...prev, ...newResults }))
      if (result.success) {
        toast.success(result.message)
      } else {
        toast.error(result.message)
      }
    } catch (err) {
      const msg = extractErrorMessage(err)
      toast.error('连接测试失败：' + msg)
      setTestResults({
        text: { status: 'failed', error: msg },
        vision: { status: 'failed', error: msg },
        audio: { status: 'failed', error: msg },
        xhs_split: { status: 'failed', error: msg },
        xhs_editor: { status: 'failed', error: msg },
        xhs_verifier: { status: 'failed', error: msg },
      })
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const savedConfig = await api.updateAIConfig({
        provider: provider as AIProvider,
        base_url: baseUrl,
        api_key: apiKey || '***',
        models: buildModelsPayload(),
        parameters: { temperature, max_tokens: maxTokens },
      })
      setIsConfigured(savedConfig.is_configured)
      setApiKey('')
      toast.success('配置已保存')
    } catch (err) {
      toast.error('保存失败：' + extractErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const getTestStatusIcon = (key: string) => {
    const result = testResults[key]
    if (!result) return null
    switch (result.status) {
      case 'testing':
        return <Loader2 size={16} className="text-blue-500 animate-spin" />
      case 'success':
        return (
          <span className="flex items-center gap-1">
            <CheckCircle size={16} className="text-green-500" />
            {result.latency && <span className="text-xs text-text-tertiary">{result.latency}ms</span>}
          </span>
        )
      case 'failed':
        return (
          <span className="flex items-center gap-1">
            <XCircle size={16} className="text-red-500" />
            {result.error && <span className="text-xs text-accent-coral">{result.error}</span>}
          </span>
        )
      default:
        return null
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 max-w-4xl">
        <h1 className="text-2xl font-bold text-text-primary">AI 服务配置</h1>
        <ConfigSkeleton />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{isAgencyXhsConfig ? 'XHS AI 配置' : 'AI 服务配置'}</h1>
          <p className="text-sm text-text-secondary mt-1">
            {isAgencyXhsConfig
              ? '按当前代理商租户保存 XHS 工作台所需的 provider、API Key 和文本模型。'
              : '按当前登录租户保存 provider、API Key 和模型参数。'}
          </p>
        </div>
        {isConfigured && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent-green/15 border border-accent-green/30">
            <CheckCircle size={16} className="text-accent-green" />
            <span className="text-sm font-medium text-accent-green">已配置</span>
          </div>
        )}
      </div>

      {/* 配置作用域说明 */}
      <div className="p-4 bg-accent-indigo/10 rounded-lg border border-accent-indigo/30">
        <div className="flex items-start gap-3">
          <Info size={20} className="text-accent-indigo flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-accent-indigo font-medium">配置作用域说明</p>
            <p className="text-sm text-accent-indigo/80 mt-1">
              {isAgencyXhsConfig
                ? '当前页面只对当前代理商租户生效。XHS 主流程只依赖文本模型；如果 Brief 是图片型，再额外配置图片解析 Vision 即可。'
                : '当前页面的配置只对当前登录租户生效。代理商的小红书工作台应由代理商自行配置，不再依赖品牌方继承。'}
            </p>
          </div>
        </div>
      </div>

      {/* AI 提供商 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot size={18} className="text-blue-500" />
            AI 提供商
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">提供商选择</label>
            <select
              className="w-full px-3 py-2 border border-border-subtle rounded-lg bg-bg-elevated text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-indigo"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            >
              {providerOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <p className="text-xs text-text-tertiary mt-1">
              推荐使用 OneAPI 等中转服务商，方便切换不同 AI 模型
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 模型配置 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Settings size={18} className="text-purple-500" />
              模型配置
            </CardTitle>
            <Button
              variant="secondary"
              size="sm"
              disabled={fetchingModels}
              onClick={() => fetchModels(provider, baseUrl, apiKey || '***')}
            >
              {fetchingModels ? (
                <><Loader2 size={14} className="animate-spin" /> 拉取中...</>
              ) : (
                <><RefreshCw size={14} /> 刷新模型列表</>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 文字处理模型 */}
          <div className="p-4 bg-bg-elevated rounded-lg">
            <div className="flex items-center gap-2 mb-3">
              <Bot size={16} className="text-accent-indigo" />
              <span className="font-medium text-text-primary">
                {isAgencyXhsConfig ? '基础文本模型 (默认兜底)' : '文字处理模型 (LLM)'}
              </span>
              {getTestStatusIcon('text')}
            </div>
            <select
              className="w-full px-3 py-2 border border-border-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-indigo bg-bg-card text-text-primary"
              value={llmModel}
              onChange={(e) => { setLlmModel(e.target.value); if (e.target.value !== '__custom__') setCustomLlmModel('') }}
            >
              {(availableModels.text || []).map(model => (
                <option key={model.id} value={model.id}>{model.name} ({model.id})</option>
              ))}
              <option value="__custom__">自定义模型...</option>
            </select>
            {llmModel === '__custom__' && (
              <input
                type="text"
                className="w-full mt-2 px-3 py-2 border border-border-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-indigo bg-bg-card text-text-primary"
                value={customLlmModel}
                onChange={(e) => setCustomLlmModel(e.target.value)}
                placeholder="输入模型 ID，如 deepseek-chat"
              />
            )}
            {(availableModels.text || []).length === 0 && (
              <p className="text-xs text-accent-amber mt-2">未获取到模型列表，请先配置连接信息并点击&ldquo;刷新模型列表&rdquo;，或直接输入模型 ID</p>
            )}
            <p className="text-xs text-text-tertiary mt-2">
              {isAgencyXhsConfig
                ? 'XHS 批量拆分、文案改写、结果复核默认使用这个模型。'
                : '用于 Brief 解析、脚本语义审核、卖点匹配分析'}
            </p>
          </div>

          {isAgencyXhsConfig ? (
            <>
              <div className="rounded-xl border border-accent-indigo/20 bg-accent-indigo/5 p-4 space-y-4">
                <div className="flex items-start gap-3">
                  <Sparkles size={18} className="text-accent-indigo mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="font-medium text-text-primary">XHS 主流程模型</div>
                    <div className="mt-1 text-xs text-text-tertiary">
                      这 3 个就是代理商小红书工作台的主配置；如果不单独指定，会回退到上面的基础文本模型。
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-bg-elevated rounded-lg">
                  <div className="flex items-center gap-2 mb-3">
                    <Sparkles size={16} className="text-accent-indigo" />
                    <span className="font-medium text-text-primary">XHS 切分模型</span>
                    {getTestStatusIcon('xhs_split')}
                  </div>
                  <select
                    className="w-full px-3 py-2 border border-border-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-indigo bg-bg-card text-text-primary"
                    value={xhsSplitModel}
                    onChange={(e) => { setXhsSplitModel(e.target.value); if (e.target.value !== '__custom__') setCustomXhsSplitModel('') }}
                  >
                    <option value="__inherit__">跟随基础文本模型</option>
                    {(availableModels.text || []).map(model => (
                      <option key={`xhs-split-${model.id}`} value={model.id}>{model.name} ({model.id})</option>
                    ))}
                    <option value="__custom__">自定义模型...</option>
                  </select>
                  {xhsSplitModel === '__custom__' && (
                    <input
                      type="text"
                      className="w-full mt-2 px-3 py-2 border border-border-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-indigo bg-bg-card text-text-primary"
                      value={customXhsSplitModel}
                      onChange={(e) => setCustomXhsSplitModel(e.target.value)}
                      placeholder="输入模型 ID"
                    />
                  )}
                  <p className="text-xs text-text-tertiary mt-2">用于长文本拆分为多篇笔记。</p>
                </div>

                <div className="p-4 bg-bg-elevated rounded-lg">
                  <div className="flex items-center gap-2 mb-3">
                    <Bot size={16} className="text-accent-indigo" />
                    <span className="font-medium text-text-primary">XHS 改写模型</span>
                    {getTestStatusIcon('xhs_editor')}
                  </div>
                  <select
                    className="w-full px-3 py-2 border border-border-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-indigo bg-bg-card text-text-primary"
                    value={xhsEditorModel}
                    onChange={(e) => { setXhsEditorModel(e.target.value); if (e.target.value !== '__custom__') setCustomXhsEditorModel('') }}
                  >
                    <option value="__inherit__">跟随基础文本模型</option>
                    {(availableModels.text || []).map(model => (
                      <option key={`xhs-editor-${model.id}`} value={model.id}>{model.name} ({model.id})</option>
                    ))}
                    <option value="__custom__">自定义模型...</option>
                  </select>
                  {xhsEditorModel === '__custom__' && (
                    <input
                      type="text"
                      className="w-full mt-2 px-3 py-2 border border-border-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-indigo bg-bg-card text-text-primary"
                      value={customXhsEditorModel}
                      onChange={(e) => setCustomXhsEditorModel(e.target.value)}
                      placeholder="输入模型 ID"
                    />
                  )}
                  <p className="text-xs text-text-tertiary mt-2">用于把单篇草稿改写成合规终稿。</p>
                </div>

                <div className="p-4 bg-bg-elevated rounded-lg">
                  <div className="flex items-center gap-2 mb-3">
                    <Shield size={16} className="text-accent-green" />
                    <span className="font-medium text-text-primary">XHS 复核模型</span>
                    {getTestStatusIcon('xhs_verifier')}
                  </div>
                  <select
                    className="w-full px-3 py-2 border border-border-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-indigo bg-bg-card text-text-primary"
                    value={xhsVerifierModel}
                    onChange={(e) => { setXhsVerifierModel(e.target.value); if (e.target.value !== '__custom__') setCustomXhsVerifierModel('') }}
                  >
                    <option value="__inherit__">跟随基础文本模型</option>
                    {(availableModels.text || []).map(model => (
                      <option key={`xhs-verifier-${model.id}`} value={model.id}>{model.name} ({model.id})</option>
                    ))}
                    <option value="__custom__">自定义模型...</option>
                  </select>
                  {xhsVerifierModel === '__custom__' && (
                    <input
                      type="text"
                      className="w-full mt-2 px-3 py-2 border border-border-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-indigo bg-bg-card text-text-primary"
                      value={customXhsVerifierModel}
                      onChange={(e) => setCustomXhsVerifierModel(e.target.value)}
                      placeholder="输入模型 ID"
                    />
                  )}
                  <p className="text-xs text-text-tertiary mt-2">用于改写后风险复核。</p>
                </div>
              </div>

              <div className="p-4 bg-bg-elevated rounded-lg">
                <div className="flex items-center gap-2 mb-3">
                  <Eye size={16} className="text-accent-green" />
                  <span className="font-medium text-text-primary">图片 Brief 解析模型 (Vision，可选)</span>
                  {getTestStatusIcon('vision')}
                </div>
                <select
                  className="w-full px-3 py-2 border border-border-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-indigo bg-bg-card text-text-primary"
                  value={visionModel}
                  onChange={(e) => { setVisionModel(e.target.value); if (e.target.value !== '__custom__') setCustomVisionModel('') }}
                >
                  <option value="__inherit__">跟随基础文本模型</option>
                  {(availableModels.vision || []).map(model => (
                    <option key={model.id} value={model.id}>{model.name} ({model.id})</option>
                  ))}
                  <option value="__custom__">自定义模型...</option>
                </select>
                {visionModel === '__custom__' && (
                  <input
                    type="text"
                    className="w-full mt-2 px-3 py-2 border border-border-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-indigo bg-bg-card text-text-primary"
                    value={customVisionModel}
                    onChange={(e) => setCustomVisionModel(e.target.value)}
                    placeholder="输入模型 ID，如 gpt-4o"
                  />
                )}
                <p className="text-xs text-text-tertiary mt-2">仅用于图片型 Brief 的页面识别；如果你的 Brief 都是文本，可直接跟随基础文本模型。</p>
              </div>
            </>
          ) : (
            <>
              <div className="p-4 bg-bg-elevated rounded-lg">
                <div className="flex items-center gap-2 mb-3">
                  <Eye size={16} className="text-accent-green" />
                  <span className="font-medium text-text-primary">视觉理解模型 (Vision)</span>
                  {getTestStatusIcon('vision')}
                </div>
                <select
                  className="w-full px-3 py-2 border border-border-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-indigo bg-bg-card text-text-primary"
                  value={visionModel}
                  onChange={(e) => { setVisionModel(e.target.value); if (e.target.value !== '__custom__') setCustomVisionModel('') }}
                >
                  {(availableModels.vision || []).map(model => (
                    <option key={model.id} value={model.id}>{model.name} ({model.id})</option>
                  ))}
                  <option value="__custom__">自定义模型...</option>
                </select>
                {visionModel === '__custom__' && (
                  <input
                    type="text"
                    className="w-full mt-2 px-3 py-2 border border-border-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-indigo bg-bg-card text-text-primary"
                    value={customVisionModel}
                    onChange={(e) => setCustomVisionModel(e.target.value)}
                    placeholder="输入模型 ID，如 gpt-4o"
                  />
                )}
                <p className="text-xs text-text-tertiary mt-2">用于脚本文档中的图片审核（竞品 logo、违规画面识别）及视频帧分析</p>
              </div>

              <div className="p-4 bg-bg-elevated rounded-lg">
                <div className="flex items-center gap-2 mb-3">
                  <Mic size={16} className="text-orange-400" />
                  <span className="font-medium text-text-primary">音频模型（口播 / 语调 / BGM）</span>
                  {getTestStatusIcon('audio')}
                </div>
                <select
                  className="w-full px-3 py-2 border border-border-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-indigo bg-bg-card text-text-primary"
                  value={asrModel}
                  onChange={(e) => { setAsrModel(e.target.value); if (e.target.value !== '__custom__') setCustomAsrModel('') }}
                >
                  {(availableModels.audio || []).map(model => (
                    <option key={model.id} value={model.id}>{model.name} ({model.id})</option>
                  ))}
                  <option value="__custom__">自定义模型...</option>
                </select>
                {asrModel === '__custom__' && (
                  <input
                    type="text"
                    className="w-full mt-2 px-3 py-2 border border-border-subtle rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-indigo bg-bg-card text-text-primary"
                    value={customAsrModel}
                    onChange={(e) => setCustomAsrModel(e.target.value)}
                    placeholder="输入模型 ID，如 gemini-2.5-pro 或 gpt-4o"
                  />
                )}
                <p className="text-xs text-text-tertiary mt-2">这里只展示可同时完成口播转写和音频理解的模型，用于语调、情绪、BGM 和环境声分析。</p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* 连接配置 */}
      <Card>
        <CardHeader>
          <CardTitle>连接配置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">Base URL</label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-border-subtle rounded-lg bg-bg-elevated text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-indigo"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">API Key</label>
            <div className="flex gap-2">
              <input
                type={showApiKey ? 'text' : 'password'}
                className="flex-1 px-3 py-2 border border-border-subtle rounded-lg bg-bg-elevated text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-indigo"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={isConfigured ? '留空使用已保存的密钥' : 'sk-...'}
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowApiKey(!showApiKey)}
              >
                {showApiKey ? '隐藏' : '显示'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 生成参数 */}
      <Card>
        <CardHeader>
          <CardTitle>生成参数</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-text-primary">Temperature</label>
              <span className="text-sm text-text-secondary">{temperature}</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              className="w-full h-2 bg-bg-elevated rounded-lg appearance-none cursor-pointer accent-accent-indigo"
            />
            <div className="flex justify-between text-xs text-text-tertiary mt-1">
              <span>精确 (0)</span>
              <span>创意 (1)</span>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">Max Tokens</label>
            <input
              type="number"
              className="w-32 px-3 py-2 border border-border-subtle rounded-lg bg-bg-elevated text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-indigo"
              value={maxTokens}
              onChange={(e) => setMaxTokens(parseInt(e.target.value))}
              min="100"
              max="32000"
            />
          </div>
        </CardContent>
      </Card>

      {/* 安全说明 */}
      <div className="p-4 bg-bg-elevated rounded-lg border border-border-subtle">
        <div className="flex items-start gap-3">
          <Shield size={20} className="text-text-tertiary flex-shrink-0 mt-0.5" />
          <div className="text-sm text-text-secondary">
            <p className="font-medium text-text-primary mb-1">安全说明</p>
            <ul className="space-y-1 text-xs">
              <li>• API Key 使用 AES-256-GCM 加密存储</li>
              <li>• 所有 API 请求强制使用 HTTPS</li>
              <li>• 仅当前登录租户的管理端页面可查看/修改此配置</li>
              <li>• 配置变更将被记录</li>
            </ul>
          </div>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center justify-between pt-4 border-t border-border-subtle">
        <Button variant="secondary" onClick={handleTestConnection}>
          测试连接
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <><Loader2 size={16} className="animate-spin" /> 保存中...</> : '保存配置'}
        </Button>
      </div>
    </div>
  )
}
