'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { SuccessTag, WarningTag, ErrorTag } from '@/components/ui/Tag'
import { ReviewSteps, getReviewSteps } from '@/components/ui/ReviewSteps'
import {
  ArrowLeft, Upload, FileText, CheckCircle, XCircle, AlertTriangle, Info,
  Clock, Loader2, RefreshCw, Eye, Download, File, Target, Ban,
  ChevronDown, ChevronUp, Sparkles, Shield, Zap
} from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { FileInfoCard, FilePreviewModal, type FileInfo } from '@/components/ui/FilePreview'
import { getViolationTypeLabel } from '@/lib/reviewLabels'
import { normalizeSoftWarnings, type SoftWarningLike } from '@/lib/reviewWarnings'
import { api, extractErrorMessage } from '@/lib/api'
import { useSSE } from '@/contexts/SSEContext'
import type { TaskResponse, AIReviewResult, ReviewDimensions, SellingPointMatchResult, ReviewConclusions, ChainOfThought, ReviewViolation, ContentVerdict, ViralPotential } from '@/types/task'
import type { BriefResponse } from '@/types/brief'

// ========== 工具函数 ==========
function getSellingPointPriority(sp: { priority?: string; required?: boolean }): 'core' | 'recommended' | 'reference' {
  if (sp.priority) return sp.priority as 'core' | 'recommended' | 'reference'
  if (sp.required === true) return 'core'
  if (sp.required === false) return 'recommended'
  return 'recommended'
}

// ========== 类型 ==========
type AgencyBriefFile = { id: string; name: string; size: string; uploadedAt: string; description?: string }

type ScriptTaskUI = {
  projectName: string
  brandName: string
  scriptStatus: string
  scriptFile: string | null
  aiAutoRejected?: boolean
  aiRejectReason?: string
  aiAvailable?: boolean
  aiResult: null | {
    score: number
    summary?: string
    dimensions?: ReviewDimensions
    conclusions?: ReviewConclusions
    chainOfThought?: ChainOfThought
    sellingPointMatches?: SellingPointMatchResult[]
    brandExposure?: AIReviewResult['brand_exposure']
    violations: Array<{ type: string; content: string; severity: string; suggestion: string; dimension?: string; fixable?: boolean }>
    softWarnings: Array<{ type: string; content: string; suggestion?: string }>
    rubricIssues: Array<{ dimension: string; note: string }>
    viralPotential?: ViralPotential
    viralReason?: string
    contentVerdict?: ContentVerdict
  }
  agencyReview: null | { result: 'approved' | 'rejected'; comment: string; reviewer: string; time: string }
  brandReview: null | { result: 'approved' | 'rejected'; comment: string; reviewer: string; time: string }
  scriptAgencyCorrected?: string | null
  scriptAgencyCorrectedFile?: FileInfo | null
}

type BriefUI = {
  files: AgencyBriefFile[]
  sellingPoints: { id: string; content: string; priority: 'core' | 'recommended' | 'reference' }[]
  blacklistWords: { id: string; word: string; reason: string }[]
}

// ========== 映射 ==========
function mapApiToScriptUI(task: TaskResponse): ScriptTaskUI {
  const stage = task.stage
  let status = 'pending_upload'
  const aiAutoRejected = task.script_ai_result?.ai_auto_rejected === true
  switch (stage) {
    case 'script_upload':
      status = aiAutoRejected ? 'ai_rejected' : 'pending_upload'
      break
    case 'script_ai_review': status = 'ai_reviewing'; break
    case 'script_agency_review': status = 'agent_reviewing'; break
    case 'script_brand_review': status = 'brand_reviewing'; break
    default:
      if (stage.startsWith('video_') || stage === 'completed') status = 'brand_passed'
      if (stage === 'rejected') {
        if (task.script_brand_status === 'rejected') status = 'brand_rejected'
        else if (task.script_agency_status === 'rejected') status = 'agent_rejected'
        else status = 'ai_result'
      }
  }

  const correctedFile = task.script_agency_corrected_file_url ? {
    id: `corrected-${task.id}`,
    fileName: task.script_agency_corrected_file_name || '代理商修正脚本',
    fileSize: '',
    fileType: task.script_agency_corrected_file_type || undefined,
    fileUrl: task.script_agency_corrected_file_url,
    uploadedAt: task.script_agency_reviewed_at || task.updated_at,
  } as FileInfo : null
  // 有 AI 结果且还在脚本审核阶段 → ai_result
  if (task.script_ai_result && stage === 'script_agency_review') status = 'agent_reviewing'

  // 提取违规项：优先从 conclusions 读取 (v2)，回退到顶层 (v1)
  const rawViolations = task.script_ai_result?.conclusions?.violations
    || task.script_ai_result?.violations
    || []

  // 提取卖点匹配：优先从 conclusions 读取 (v2)
  const rawSellingPointMatches = task.script_ai_result?.conclusions?.selling_point_matches
    || task.script_ai_result?.selling_point_matches
    || []

  // 提取维度评分：优先从 conclusions 构建 (v2)
  let dimensions = task.script_ai_result?.dimensions
  const conclusions = task.script_ai_result?.conclusions
  const legacyConclusions = conclusions as ({
    soft_warnings?: unknown[]
    summary?: string
  } & Record<string, unknown>) | undefined
  if (conclusions && !dimensions) {
    dimensions = {
      legal: { score: conclusions.legal.score, passed: conclusions.legal.passed, issue_count: conclusions.legal.issue_count },
      platform: { score: conclusions.platform.score, passed: conclusions.platform.passed, issue_count: conclusions.platform.issue_count },
      brand_safety: { score: conclusions.brand_safety.score, passed: conclusions.brand_safety.passed, issue_count: conclusions.brand_safety.issue_count },
      brief_match: { score: conclusions.brief_match.score, passed: conclusions.brief_match.passed, issue_count: conclusions.brief_match.issue_count },
      content_quality: { score: conclusions.content_quality.score, passed: conclusions.content_quality.passed, issue_count: conclusions.content_quality.issue_count },
    }
  }

  // 提取 soft_warnings
  const rawSoftWarnings = (task.script_ai_result?.soft_warnings
    || legacyConclusions?.soft_warnings
    || []) as SoftWarningLike[]

  // 提取 rubric_checks 中未通过的项（兼容 {dimension,passed} 和 {item,met} 两种格式）
  const rubricChecks = (task.script_ai_result?.chain_of_thought?.creative_director?.content_quality?.rubric_checks || []) as Array<{ item?: string; met?: boolean; dimension?: string; passed?: boolean; note?: string }>
  const rubricIssues = rubricChecks
    .filter(rc => rc.passed === false || rc.met === false)
    .map(rc => ({ dimension: rc.dimension || rc.item || '', note: rc.note || '' }))

  const aiResult = task.script_ai_result ? {
    score: task.script_ai_result.score,
    summary: task.script_ai_result.summary || conclusions?.overall_summary || legacyConclusions?.summary,
    dimensions,
    conclusions,
    chainOfThought: task.script_ai_result.chain_of_thought,
    sellingPointMatches: rawSellingPointMatches,
    brandExposure: task.script_ai_result.brand_exposure,
    violations: rawViolations.map((v: Record<string, unknown>) => ({
      type: v.type as string || '',
      content: v.content as string || '',
      severity: v.severity as string || 'medium',
      suggestion: v.suggestion as string || '',
      dimension: v.dimension as string | undefined,
      fixable: v.fixable as boolean | undefined,
    })),
    softWarnings: normalizeSoftWarnings(rawSoftWarnings).map(w => ({
      type: w.label,
      content: w.content,
      suggestion: w.suggestion,
    })),
    rubricIssues,
    viralPotential: conclusions?.content_quality?.viral_potential,
    viralReason: conclusions?.content_quality?.viral_reason,
    contentVerdict: conclusions?.content_quality?.overall_verdict,
  } : null

  const agencyReview = task.script_agency_status && task.script_agency_status !== 'pending' ? {
    result: (task.script_agency_status === 'passed' || task.script_agency_status === 'force_passed' ? 'approved' : 'rejected') as 'approved' | 'rejected',
    comment: task.script_agency_comment || '',
    reviewer: task.agency?.name || '代理商',
    time: task.script_agency_reviewed_at || task.updated_at,
  } : null

  const brandReview = task.script_brand_status && task.script_brand_status !== 'pending' ? {
    result: (task.script_brand_status === 'passed' || task.script_brand_status === 'force_passed' ? 'approved' : 'rejected') as 'approved' | 'rejected',
    comment: task.script_brand_comment || '',
    reviewer: '品牌方审核员',
    time: task.script_brand_reviewed_at || task.updated_at,
  } : null

  return {
    projectName: task.project?.name || task.name,
    brandName: task.project?.brand_name || '',
    scriptStatus: status,
    scriptFile: task.script_file_name || null,
    aiAutoRejected,
    aiAvailable: task.script_ai_result?.ai_available,
    aiRejectReason: task.script_ai_result?.ai_reject_reason,
    aiResult,
    agencyReview,
    brandReview,
    scriptAgencyCorrected: task.script_agency_corrected || null,
    scriptAgencyCorrectedFile: correctedFile,
  }
}

function mapBriefToUI(brief: BriefResponse): BriefUI {
  return {
    files: (brief.attachments || []).map((a, i) => ({
      id: a.id || `att-${i}`, name: a.name, size: a.size || '', uploadedAt: brief.updated_at || '',
    })),
    sellingPoints: (brief.selling_points || []).map((sp, i) => ({ id: `sp-${i}`, content: sp.content, priority: getSellingPointPriority(sp) })),
    blacklistWords: (brief.blacklist_words || []).map((bw, i) => ({ id: `bw-${i}`, word: bw.word, reason: bw.reason })),
  }
}

const DEFAULT_BRIEF: BriefUI = { files: [], sellingPoints: [], blacklistWords: [] }
const DEFAULT_TASK: ScriptTaskUI = {
  projectName: '',
  brandName: '',
  scriptStatus: 'pending_upload',
  scriptFile: null,
  aiResult: null,
  agencyReview: null,
  brandReview: null,
  scriptAgencyCorrected: null,
  scriptAgencyCorrectedFile: null,
}

// ========== UI 组件 ==========

function AgencyBriefSection({ toast, briefData }: { toast: ReturnType<typeof useToast>; briefData: BriefUI }) {
  const [isExpanded, setIsExpanded] = useState(true)
  const [previewFile, setPreviewFile] = useState<AgencyBriefFile | null>(null)
  const handleDownload = (file: AgencyBriefFile) => { toast.info(`下载文件: ${file.name}`) }
  const corePoints = briefData.sellingPoints.filter(sp => sp.priority === 'core')
  const recommendedPoints = briefData.sellingPoints.filter(sp => sp.priority === 'recommended')
  const referencePoints = briefData.sellingPoints.filter(sp => sp.priority === 'reference')

  return (
    <>
      <Card className="border-accent-indigo/30">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2"><File size={18} className="text-accent-indigo" />Brief 文档与要求</span>
            <button type="button" onClick={() => setIsExpanded(!isExpanded)} className="p-1 hover:bg-bg-elevated rounded">
              {isExpanded ? <ChevronUp size={18} className="text-text-tertiary" /> : <ChevronDown size={18} className="text-text-tertiary" />}
            </button>
          </CardTitle>
        </CardHeader>
        {isExpanded && (
          <CardContent className="space-y-4">
            <div>
              <h4 className="text-sm font-medium text-text-primary mb-2 flex items-center gap-2"><FileText size={14} className="text-accent-indigo" />参考文档</h4>
              <div className="space-y-2">
                {briefData.files.map((file) => (
                  <div key={file.id} className="flex items-center justify-between p-3 bg-bg-elevated rounded-lg">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded bg-accent-indigo/15 flex items-center justify-center flex-shrink-0"><FileText size={16} className="text-accent-indigo" /></div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-text-primary truncate">{file.name}</p>
                        <p className="text-xs text-text-tertiary">{file.size}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button variant="ghost" size="sm" onClick={() => setPreviewFile(file)}><Eye size={14} /></Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDownload(file)}><Download size={14} /></Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-sm font-medium text-text-primary mb-2 flex items-center gap-2"><Target size={14} className="text-accent-green" />卖点要求</h4>
              <div className="space-y-2">
                {corePoints.length > 0 && (
                  <div className="p-3 bg-accent-coral/10 rounded-lg border border-accent-coral/30">
                    <p className="text-xs text-accent-coral font-medium mb-2">核心卖点（建议优先提及）</p>
                    <div className="flex flex-wrap gap-2">{corePoints.map((sp) => (
                      <span key={sp.id} className="px-2 py-1 text-xs bg-accent-coral/20 text-accent-coral rounded">{sp.content}</span>
                    ))}</div>
                  </div>
                )}
                {recommendedPoints.length > 0 && (
                  <div className="p-3 bg-accent-amber/10 rounded-lg border border-accent-amber/30">
                    <p className="text-xs text-accent-amber font-medium mb-2">推荐卖点（建议提及）</p>
                    <div className="flex flex-wrap gap-2">{recommendedPoints.map((sp) => (
                      <span key={sp.id} className="px-2 py-1 text-xs bg-accent-amber/20 text-accent-amber rounded">{sp.content}</span>
                    ))}</div>
                  </div>
                )}
                {referencePoints.length > 0 && (
                  <div className="p-3 bg-bg-elevated rounded-lg">
                    <p className="text-xs text-text-tertiary font-medium mb-2">参考信息</p>
                    <div className="flex flex-wrap gap-2">{referencePoints.map((sp) => (
                      <span key={sp.id} className="px-2 py-1 text-xs bg-bg-page text-text-secondary rounded">{sp.content}</span>
                    ))}</div>
                  </div>
                )}
              </div>
            </div>
            <div>
              <h4 className="text-sm font-medium text-text-primary mb-2 flex items-center gap-2"><Ban size={14} className="text-accent-coral" />违禁词</h4>
              <div className="flex flex-wrap gap-2">{briefData.blacklistWords.map((bw) => (
                <span key={bw.id} className="px-2 py-1 text-xs bg-accent-coral/15 text-accent-coral rounded border border-accent-coral/30">「{bw.word}」</span>
              ))}</div>
            </div>
          </CardContent>
        )}
      </Card>
      <Modal isOpen={!!previewFile} onClose={() => setPreviewFile(null)} title={previewFile?.name || '文件预览'} size="lg">
        <div className="space-y-4">
          <div className="aspect-[4/3] bg-bg-elevated rounded-lg flex items-center justify-center">
            <div className="text-center"><FileText size={48} className="mx-auto text-accent-indigo mb-4" /><p className="text-text-secondary">文件预览区域</p></div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPreviewFile(null)}>关闭</Button>
            {previewFile && <Button onClick={() => handleDownload(previewFile)}><Download size={16} />下载文件</Button>}
          </div>
        </div>
      </Modal>
    </>
  )
}

type UploadMode = 'file' | 'text'

function UploadSection({ taskId, onUploaded }: { taskId: string; onUploaded: () => void }) {
  const [mode, setMode] = useState<UploadMode>('file')
  const [file, setFile] = useState<File | null>(null)
  const [textContent, setTextContent] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const toast = useToast()

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      setFile(selectedFile)
      setUploadError(null)
    }
  }

  const canSubmit = mode === 'file' ? !!file : textContent.trim().length >= 10

  const handleSubmit = async () => {
    if (!canSubmit) return
    setIsUploading(true)
    setProgress(0)
    setUploadError(null)
    try {
      if (mode === 'file' && file) {
        const result = await api.proxyUpload(file, 'script', (pct) => {
          setProgress(Math.min(90, Math.round(pct * 0.9)))
        })
        setProgress(95)
        await api.uploadTaskScript(taskId, { file_url: result.url, file_name: result.file_name })
        setProgress(100)
        toast.success('脚本已提交，等待 AI 审核')
        onUploaded()
      } else if (mode === 'text') {
        setProgress(50)
        await api.uploadTaskScript(taskId, { text_content: textContent.trim() })
        setProgress(100)
        toast.success('脚本已提交，等待 AI 审核')
        onUploaded()
      }
    } catch (err) {
      const msg = extractErrorMessage(err)
      setUploadError(msg)
      toast.error(msg)
    } finally {
      setIsUploading(false)
    }
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + 'B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB'
    return (bytes / (1024 * 1024)).toFixed(1) + 'MB'
  }

  const handleModeSwitch = (newMode: UploadMode) => {
    if (isUploading) return
    setMode(newMode)
    setUploadError(null)
  }

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Upload size={18} className="text-accent-indigo" />上传脚本</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {/* 模式切换 Tab */}
        <div className="flex bg-bg-elevated rounded-lg p-1">
          <button
            type="button"
            onClick={() => handleModeSwitch('file')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
              mode === 'file'
                ? 'bg-accent-indigo text-white'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <Upload size={14} />上传文件
          </button>
          <button
            type="button"
            onClick={() => handleModeSwitch('text')}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
              mode === 'text'
                ? 'bg-accent-indigo text-white'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <FileText size={14} />粘贴文字
          </button>
        </div>

        {/* 文件上传模式 */}
        {mode === 'file' && (
          <>
            {!file ? (
              <label className="border-2 border-dashed border-border-subtle rounded-lg p-8 text-center hover:border-accent-indigo/50 transition-colors cursor-pointer block">
                <Upload size={32} className="mx-auto text-text-tertiary mb-3" />
                <p className="text-text-secondary mb-1">点击上传脚本文件</p>
                <p className="text-xs text-text-tertiary">支持 Word、PDF、TXT、Excel 格式</p>
                <input type="file" accept=".doc,.docx,.pdf,.txt,.xls,.xlsx" onChange={handleFileChange} className="hidden" />
              </label>
            ) : (
              <div className="border border-border-subtle rounded-lg overflow-hidden">
                <div className="px-4 py-2.5 bg-bg-elevated border-b border-border-subtle">
                  <span className="text-xs font-medium text-text-secondary">已选文件</span>
                </div>
                <div className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {isUploading ? (
                      <Loader2 size={16} className="animate-spin text-accent-indigo flex-shrink-0" />
                    ) : uploadError ? (
                      <AlertTriangle size={16} className="text-accent-coral flex-shrink-0" />
                    ) : (
                      <CheckCircle size={16} className="text-accent-green flex-shrink-0" />
                    )}
                    <FileText size={14} className="text-accent-indigo flex-shrink-0" />
                    <span className="flex-1 text-sm text-text-primary truncate">{file.name}</span>
                    <span className="text-xs text-text-tertiary">{formatSize(file.size)}</span>
                    {!isUploading && (
                      <button type="button" onClick={() => { setFile(null); setUploadError(null) }} className="p-1 hover:bg-bg-elevated rounded">
                        <XCircle size={14} className="text-text-tertiary" />
                      </button>
                    )}
                  </div>
                  {isUploading && (
                    <div className="mt-2 ml-[30px] h-2 bg-bg-page rounded-full overflow-hidden">
                      <div className="h-full bg-accent-indigo rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
                    </div>
                  )}
                  {isUploading && (
                    <p className="mt-1 ml-[30px] text-xs text-text-tertiary">上传中 {progress}%</p>
                  )}
                  {uploadError && (
                    <p className="mt-1 ml-[30px] text-xs text-accent-coral">{uploadError}</p>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* 粘贴文字模式 */}
        {mode === 'text' && (
          <div className="space-y-2">
            <textarea
              value={textContent}
              onChange={(e) => { setTextContent(e.target.value); setUploadError(null) }}
              placeholder="请在此粘贴或输入脚本内容..."
              className="w-full min-h-[200px] p-4 bg-bg-elevated border border-border-subtle rounded-lg text-sm text-text-primary placeholder:text-text-tertiary resize-y focus:outline-none focus:border-accent-indigo/50 transition-colors"
              disabled={isUploading}
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-text-tertiary">
                {textContent.trim().length < 10 && textContent.trim().length > 0
                  ? <span className="text-accent-coral">至少需要 10 个字</span>
                  : '\u00A0'}
              </p>
              <p className="text-xs text-text-tertiary">{textContent.trim().length} 字</p>
            </div>
            {uploadError && (
              <p className="text-xs text-accent-coral">{uploadError}</p>
            )}
          </div>
        )}

        <Button onClick={handleSubmit} disabled={!canSubmit || isUploading} fullWidth>
          {isUploading ? (
            <><Loader2 size={16} className="animate-spin" />{mode === 'file' ? `上传中 ${progress}%` : '提交中...'}</>
          ) : '提交脚本'}
        </Button>
      </CardContent>
    </Card>
  )
}

function AIReviewingSection() {
  const [progress, setProgress] = useState(0)
  const [logs, setLogs] = useState<string[]>(['开始解析脚本文件...'])
  useEffect(() => {
    const timer = setInterval(() => { setProgress(prev => prev >= 100 ? (clearInterval(timer), 100) : prev + 10) }, 500)
    const t1 = setTimeout(() => setLogs(prev => [...prev, '正在提取文本内容...']), 1000)
    const t2 = setTimeout(() => setLogs(prev => [...prev, '正在进行违禁词检测...']), 2000)
    const t3 = setTimeout(() => setLogs(prev => [...prev, '正在分析卖点覆盖...']), 3000)
    return () => { clearInterval(timer); clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [])

  return (
    <Card>
      <CardContent className="py-8 text-center">
        <Loader2 size={48} className="mx-auto text-accent-indigo mb-4 animate-spin" />
        <h3 className="text-lg font-medium text-text-primary mb-2">AI 正在审核您的脚本</h3>
        <p className="text-text-secondary mb-4">请稍候，预计需要 1-2 分钟</p>
        <div className="w-full max-w-md mx-auto">
          <div className="h-2 bg-bg-elevated rounded-full overflow-hidden mb-2"><div className="h-full bg-accent-indigo transition-all" style={{ width: `${progress}%` }} /></div>
          <p className="text-sm text-text-tertiary">{progress}%</p>
        </div>
        <div className="mt-6 p-4 bg-bg-elevated rounded-lg text-left max-w-md mx-auto">
          <p className="text-xs text-text-tertiary mb-2">处理日志</p>
          {logs.map((log, idx) => <p key={idx} className="text-sm text-text-secondary">{log}</p>)}
        </div>
      </CardContent>
    </Card>
  )
}

function getDimensionLabel(key: string) {
  const labels: Record<string, string> = {
    legal: '法规合规', platform: '平台规则', brand_safety: '品牌安全', brief_match: 'Brief匹配', content_quality: '内容质量',
    '法规合规': '法规合规', '平台规则': '平台规则', '品牌安全': '品牌安全', 'Brief匹配': 'Brief匹配', '内容质量': '内容质量',
  }
  return labels[key] || key
}

function getVerdictLabel(verdict?: ContentVerdict) {
  const map: Record<string, { label: string; color: string }> = {
    excellent: { label: '优秀', color: 'text-accent-green' },
    good: { label: '良好', color: 'text-accent-green' },
    acceptable: { label: '合格', color: 'text-yellow-400' },
    needs_improvement: { label: '需改进', color: 'text-accent-amber' },
    needs_rework: { label: '需重做', color: 'text-accent-coral' },
  }
  return map[verdict || ''] || { label: '未知', color: 'text-text-tertiary' }
}

function getViralLabel(potential?: ViralPotential) {
  const map: Record<string, { label: string; color: string }> = {
    high: { label: '高爆款潜力', color: 'text-accent-green' },
    medium: { label: '中等潜力', color: 'text-accent-amber' },
    low: { label: '低爆款潜力', color: 'text-text-tertiary' },
  }
  return map[potential || ''] || { label: '', color: '' }
}

const rubricDimensionLabels: Record<string, string> = {
  tone: '品牌调性',
  audience: '目标受众',
  content_style: '内容风格',
  structure: '脚本结构',
}

// 从 chain_of_thought 提取维度评语
function getDimensionSummary(cot: ChainOfThought | undefined, key: string): string {
  if (!cot) return ''
  // 通用 helper: 从对象中取 summary 或兼容字段
  const getSummary = (obj: unknown): string => {
    if (!obj || typeof obj !== 'object') return ''
    const o = obj as Record<string, unknown>
    // 优先 summary (AI 实际返回)
    if (typeof o.summary === 'string') return o.summary
    // 兼容 risk_assessment / overall_assessment / creative_assessment (类型定义)
    if (typeof o.risk_assessment === 'string') return o.risk_assessment
    if (typeof o.overall_assessment === 'string') return o.overall_assessment
    if (typeof o.creative_assessment === 'string') return o.creative_assessment
    return ''
  }

  // 合规维度 (legal / platform / brand_safety)
  if (key === 'legal' || key === 'platform' || key === 'brand_safety') {
    return getSummary(cot.compliance_officer?.[key])
  }
  // Brief 匹配
  if (key === 'brief_match') {
    const bm = cot.creative_director?.brief_match
    const s = getSummary(bm)
    if (s) return s
    // 回退：从卖点数据生成摘要
    const sp = bm?.selling_points
    if (sp) {
      const matched = sp.filter(p => p.matched).length
      return `${matched}/${sp.length} 个卖点匹配`
    }
    return ''
  }
  // 内容质量
  if (key === 'content_quality') {
    const cq = cot.creative_director?.content_quality
    const s = getSummary(cq)
    if (s) return s
    // 回退：从 highlights 取第一条
    const raw = cq as unknown as Record<string, unknown> | undefined
    const highlights = raw?.highlights as string[] | undefined
    if (highlights?.length) return highlights[0]
    return ''
  }
  return ''
}

function AIResultSection({ task }: { task: ScriptTaskUI }) {
  const [showCoT, setShowCoT] = useState(false)
  if (!task.aiResult) return null
  const { dimensions, violations, sellingPointMatches, softWarnings, rubricIssues, summary, viralPotential, viralReason, contentVerdict, chainOfThought, brandExposure } = task.aiResult

  // 分离违规项
  const mustFix = violations.filter(v => !v.fixable || v.severity === 'high')
  const suggestions = violations.filter(v => v.fixable !== false && v.severity !== 'high')

  // 合规维度 vs 创意维度
  const complianceDims = ['legal', 'platform', 'brand_safety'] as const
  const creativeDims = ['brief_match', 'content_quality'] as const

  const verdictInfo = getVerdictLabel(contentVerdict)
  const viralInfo = getViralLabel(viralPotential)

  return (
    <div className="space-y-4">
      {/* 总览卡片 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2"><Shield size={18} className="text-accent-indigo" />AI 审核结果</span>
            <div className="flex items-center gap-3">
              {viralPotential && (
                <span className={`flex items-center gap-1 text-xs ${viralInfo.color}`}>
                  <Zap size={14} />{viralInfo.label}
                </span>
              )}
              <span className={`text-xl font-bold ${task.aiResult.score >= 85 ? 'text-accent-green' : task.aiResult.score >= 70 ? 'text-yellow-400' : 'text-accent-coral'}`}>{task.aiResult.score}分</span>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {summary && <p className="text-sm text-text-secondary">{summary}</p>}
          {contentVerdict && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-tertiary">内容评级:</span>
              <span className={`text-sm font-medium ${verdictInfo.color}`}>{verdictInfo.label}</span>
            </div>
          )}
          {viralReason && <p className="text-xs text-text-tertiary">{viralReason}</p>}
        </CardContent>
      </Card>

      {/* 合规审查 */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Shield size={16} className="text-accent-indigo" />合规审查</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {dimensions && (
            <div className="grid grid-cols-3 gap-3">
              {complianceDims.map(key => {
                const dim = dimensions[key]
                if (!dim) return null
                const dimSummary = getDimensionSummary(chainOfThought, key)
                return (
                  <div key={key} className={`p-3 rounded-lg border ${dim.passed ? 'bg-accent-green/5 border-accent-green/20' : 'bg-accent-coral/5 border-accent-coral/20'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-text-secondary">{getDimensionLabel(key)}</span>
                      {dim.passed ? <CheckCircle size={14} className="text-accent-green" /> : <XCircle size={14} className="text-accent-coral" />}
                    </div>
                    <span className={`text-lg font-bold ${dim.passed ? 'text-accent-green' : 'text-accent-coral'}`}>{dim.score}</span>
                    {dim.issue_count > 0 && <span className="text-xs text-text-tertiary ml-1">({dim.issue_count}项)</span>}
                    {dimSummary && <p className="text-xs text-text-tertiary mt-1.5 line-clamp-2">{dimSummary}</p>}
                  </div>
                )
              })}
            </div>
          )}
          {/* 必须修改的违规项 */}
          {mustFix.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-accent-coral mb-2 flex items-center gap-2"><XCircle size={14} />必须修改 ({mustFix.length})</h4>
              {mustFix.map((v, idx) => (
                <div key={idx} className="p-3 bg-accent-coral/10 rounded-lg border border-accent-coral/30 mb-2">
                  <div className="flex items-center gap-2 mb-1">
                    <ErrorTag>{getViolationTypeLabel(v.type)}</ErrorTag>
                    {v.dimension && <span className="text-xs text-text-tertiary">{getDimensionLabel(v.dimension)}</span>}
                  </div>
                  <p className="text-sm text-text-primary">「{v.content}」</p>
                  <p className="text-xs text-accent-indigo mt-1">{v.suggestion}</p>
                </div>
              ))}
            </div>
          )}
          {/* 建议优化的违规项 */}
          {suggestions.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-accent-amber mb-2 flex items-center gap-2"><AlertTriangle size={14} />建议优化 ({suggestions.length})</h4>
              {suggestions.map((v, idx) => (
                <div key={idx} className="p-3 bg-accent-amber/10 rounded-lg border border-accent-amber/30 mb-2">
                  <div className="flex items-center gap-2 mb-1">
                    <WarningTag>{getViolationTypeLabel(v.type)}</WarningTag>
                    {v.dimension && <span className="text-xs text-text-tertiary">{getDimensionLabel(v.dimension)}</span>}
                  </div>
                  <p className="text-sm text-text-primary">「{v.content}」</p>
                  <p className="text-xs text-accent-indigo mt-1">{v.suggestion}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 创意评估 */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Sparkles size={16} className="text-accent-amber" />创意评估</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {dimensions && (
            <div className="grid grid-cols-2 gap-3">
              {creativeDims.map(key => {
                const dim = dimensions[key]
                if (!dim) return null
                const dimSummary = getDimensionSummary(chainOfThought, key)
                return (
                  <div key={key} className={`p-3 rounded-lg border ${dim.passed ? 'bg-accent-green/5 border-accent-green/20' : 'bg-accent-amber/5 border-accent-amber/20'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-text-secondary">{getDimensionLabel(key)}</span>
                      {dim.passed ? <CheckCircle size={14} className="text-accent-green" /> : <AlertTriangle size={14} className="text-accent-amber" />}
                    </div>
                    <span className={`text-lg font-bold ${dim.passed ? 'text-accent-green' : 'text-accent-amber'}`}>{dim.score}</span>
                    {dim.issue_count > 0 && <span className="text-xs text-text-tertiary ml-1">({dim.issue_count}项)</span>}
                    {dimSummary && <p className="text-xs text-text-tertiary mt-1.5 line-clamp-2">{dimSummary}</p>}
                  </div>
                )
              })}
              {/* 爆款潜力 */}
              {viralPotential && (
                <div className={`p-3 rounded-lg border col-span-2 ${
                  viralPotential === 'high' ? 'bg-accent-green/5 border-accent-green/20' :
                  viralPotential === 'medium' ? 'bg-accent-amber/5 border-accent-amber/20' :
                  'bg-bg-elevated border-border-subtle'
                }`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-text-secondary">爆款潜力</span>
                    <span className={`flex items-center gap-1 text-xs font-medium ${viralInfo.color}`}>
                      <Zap size={14} />{viralInfo.label}
                    </span>
                  </div>
                  {viralReason && <p className="text-xs text-text-tertiary mt-1">{viralReason}</p>}
                </div>
              )}
            </div>
          )}
          {/* 内容质量问题 (rubric_checks 未通过项) */}
          {rubricIssues.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-accent-amber mb-2 flex items-center gap-2"><AlertTriangle size={14} />内容待改进 ({rubricIssues.length})</h4>
              <div className="space-y-2">
                {rubricIssues.map((issue, idx) => (
                  <div key={idx} className="p-3 bg-accent-amber/10 rounded-lg border border-accent-amber/30">
                    <span className="text-xs font-medium text-accent-amber">{rubricDimensionLabels[issue.dimension] || issue.dimension}</span>
                    <p className="text-sm text-text-primary mt-1">{issue.note}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* 优化建议 (soft_warnings) */}
          {softWarnings.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-accent-blue mb-2 flex items-center gap-2"><Info size={14} />优化建议 ({softWarnings.length})</h4>
              <div className="space-y-2">
                {softWarnings.map((w, idx) => (
                  <div key={idx} className="p-3 bg-accent-blue/10 rounded-lg border border-accent-blue/30">
                    <p className="text-sm text-text-primary">{w.content}</p>
                    {w.suggestion && <p className="text-xs text-accent-indigo mt-1">{w.suggestion}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* 卖点匹配 */}
          {sellingPointMatches && sellingPointMatches.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-text-primary mb-2 flex items-center gap-2"><Target size={14} className="text-accent-green" />卖点匹配</h4>
              <div className="space-y-2">
                {sellingPointMatches.map((sp, idx) => (
                  <div key={idx} className="flex items-start gap-2 p-2 rounded-lg bg-bg-elevated">
                    {sp.matched ? <CheckCircle size={16} className="text-accent-green flex-shrink-0 mt-0.5" /> : <XCircle size={16} className="text-accent-coral flex-shrink-0 mt-0.5" />}
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-text-primary">{sp.content}</span>
                        <span className={`px-1.5 py-0.5 text-xs rounded ${
                          sp.priority === 'core' ? 'bg-accent-coral/20 text-accent-coral' :
                          sp.priority === 'recommended' ? 'bg-accent-amber/20 text-accent-amber' :
                          'bg-bg-page text-text-tertiary'
                        }`}>{sp.priority === 'core' ? '核心' : sp.priority === 'recommended' ? '推荐' : '参考'}</span>
                      </div>
                      {sp.evidence && <p className="text-xs text-text-tertiary mt-0.5">{sp.evidence}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {brandExposure && (
            <div>
              <h4 className="text-sm font-medium text-text-primary mb-2 flex items-center gap-2"><Eye size={14} className="text-accent-indigo" />品牌曝光评估</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 rounded-lg bg-bg-elevated border border-border-subtle">
                  <div className="text-xs text-text-tertiary">曝光评分</div>
                  <div className="text-lg font-semibold text-text-primary mt-1">{brandExposure.score ?? '--'}</div>
                </div>
                <div className="p-3 rounded-lg bg-bg-elevated border border-border-subtle">
                  <div className="text-xs text-text-tertiary">曝光等级</div>
                  <div className="text-sm font-semibold text-text-primary mt-1">{brandExposure.level || '--'}</div>
                </div>
                <div className="p-3 rounded-lg bg-bg-elevated border border-border-subtle">
                  <div className="text-xs text-text-tertiary">相关时长</div>
                  <div className="text-sm font-semibold text-text-primary mt-1">{brandExposure.related_duration_seconds ?? '--'} 秒</div>
                </div>
              </div>
              {brandExposure.analysis && <p className="text-sm text-text-secondary mt-2">{brandExposure.analysis}</p>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* CoT 折叠展示 */}
      {chainOfThought && (
        <Card>
          <CardHeader>
            <CardTitle>
              <button className="flex items-center justify-between w-full cursor-pointer" onClick={() => setShowCoT(!showCoT)}>
                <span className="flex items-center gap-2 text-sm"><Eye size={14} className="text-text-tertiary" />AI 推理过程</span>
                {showCoT ? <ChevronUp size={16} className="text-text-tertiary" /> : <ChevronDown size={16} className="text-text-tertiary" />}
              </button>
            </CardTitle>
          </CardHeader>
          {showCoT && (
            <CardContent className="space-y-4">
              {/* 合规官推理 */}
              <div>
                <h4 className="text-xs font-medium text-accent-indigo mb-2">合规官分析</h4>
                {(['legal', 'platform', 'brand_safety'] as const).map(key => {
                  const reasoning = chainOfThought.compliance_officer[key]
                  if (!reasoning) return null
                  return (
                    <div key={key} className="p-2 bg-bg-elevated rounded-lg mb-2">
                      <p className="text-xs font-medium text-text-primary mb-1">{getDimensionLabel(key)} ({reasoning.score}分)</p>
                      <p className="text-xs text-text-secondary">{reasoning.risk_assessment}</p>
                      {reasoning.observations.length > 0 && (
                        <ul className="mt-1 space-y-0.5">
                          {reasoning.observations.map((obs, i) => (
                            <li key={i} className="text-xs text-text-tertiary">- {obs}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )
                })}
              </div>
              {/* 创意总监推理 */}
              <div>
                <h4 className="text-xs font-medium text-accent-amber mb-2">创意总监分析</h4>
                {chainOfThought.creative_director.brief_match && (
                  <div className="p-2 bg-bg-elevated rounded-lg mb-2">
                    <p className="text-xs font-medium text-text-primary mb-1">Brief 匹配 ({chainOfThought.creative_director.brief_match.score}分)</p>
                    <p className="text-xs text-text-secondary">{chainOfThought.creative_director.brief_match.overall_assessment}</p>
                  </div>
                )}
                {chainOfThought.creative_director.content_quality && (
                  <div className="p-2 bg-bg-elevated rounded-lg">
                    <p className="text-xs font-medium text-text-primary mb-1">内容质量 ({chainOfThought.creative_director.content_quality.score}分)</p>
                    <p className="text-xs text-text-secondary">{chainOfThought.creative_director.content_quality.creative_assessment}</p>
                    {chainOfThought.creative_director.content_quality.viral_assessment && (
                      <p className="text-xs text-text-tertiary mt-1">{chainOfThought.creative_director.content_quality.viral_assessment}</p>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  )
}

function CorrectedScriptSection({
  correctedScript,
  correctedFile,
}: {
  correctedScript: string
  correctedFile?: FileInfo | null
}) {
  const [copied, setCopied] = useState(false)
  const [showFilePreview, setShowFilePreview] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(correctedScript)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback
    }
  }

  const handleDownload = () => {
    const blob = new Blob([correctedScript], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = '代理商修正脚本.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Card className="border-accent-indigo/30">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <FileText size={18} className="text-accent-indigo" />代理商修正脚本
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleCopy}>
              {copied ? <><CheckCircle size={14} className="text-accent-green" />已复制</> : <><Eye size={14} />复制</>}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleDownload}>
              <Download size={14} />下载
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {correctedFile && (
          <div className="mb-4">
            <FileInfoCard file={correctedFile} onPreview={() => setShowFilePreview(true)} />
          </div>
        )}
        <div className="p-4 bg-bg-elevated rounded-lg border border-border-subtle">
          <pre className="text-sm text-text-primary whitespace-pre-wrap font-sans leading-relaxed">{correctedScript}</pre>
        </div>
        <p className="text-xs text-text-tertiary mt-2">以上为代理商在原脚本基础上的修正版本</p>
        <FilePreviewModal file={correctedFile || null} isOpen={showFilePreview} onClose={() => setShowFilePreview(false)} />
      </CardContent>
    </Card>
  )
}

function ReviewFeedbackSection({ review, type }: { review: { result: string; comment: string; reviewer: string; time: string }; type: 'agency' | 'brand' }) {
  const isApproved = review.result === 'approved'
  const title = type === 'agency' ? '代理商审核意见' : '品牌方终审意见'
  return (
    <Card className={isApproved ? 'border-accent-green/30' : 'border-accent-coral/30'}>
      <CardHeader><CardTitle className="flex items-center gap-2">
        {isApproved ? <CheckCircle size={18} className="text-accent-green" /> : <XCircle size={18} className="text-accent-coral" />}{title}
      </CardTitle></CardHeader>
      <CardContent>
        <div className="flex items-center gap-2 mb-2">
          <span className="font-medium text-text-primary">{review.reviewer}</span>
          {isApproved ? <SuccessTag>通过</SuccessTag> : <ErrorTag>驳回</ErrorTag>}
        </div>
        <p className="text-text-secondary whitespace-pre-wrap">{review.comment}</p>
        <p className="text-xs text-text-tertiary mt-2">{review.time}</p>
      </CardContent>
    </Card>
  )
}

function WaitingSection({ message }: { message: string }) {
  return (
    <Card><CardContent className="py-8 text-center">
      <Clock size={48} className="mx-auto text-accent-indigo mb-4" />
      <h3 className="text-lg font-medium text-text-primary mb-2">{message}</h3>
      <p className="text-text-secondary">请耐心等待，审核结果将通过消息通知您</p>
    </CardContent></Card>
  )
}

function SuccessSection({ onContinue }: { onContinue: () => void }) {
  return (
    <Card className="border-accent-green/30"><CardContent className="py-8 text-center">
      <CheckCircle size={48} className="mx-auto text-accent-green mb-4" />
      <h3 className="text-lg font-medium text-text-primary mb-2">脚本审核通过！</h3>
      <p className="text-text-secondary mb-6">您可以开始拍摄视频了</p>
      <Button onClick={onContinue}>上传视频</Button>
    </CardContent></Card>
  )
}

// ========== 主页面 ========== // v2: 支持粘贴文字

export default function CreatorScriptPage() {
  const router = useRouter()
  const params = useParams()
  const toast = useToast()
  const { subscribe } = useSSE()
  const taskId = params.id as string

  const [task, setTask] = useState<ScriptTaskUI>(DEFAULT_TASK)
  const [briefData, setBriefData] = useState<BriefUI>(DEFAULT_BRIEF)
  const [isLoading, setIsLoading] = useState(true)

  const loadTask = useCallback(async () => {
    try {
      const apiTask = await api.getTask(taskId)
      setTask(mapApiToScriptUI(apiTask))
      if (apiTask.project?.id) {
        try {
          const brief = await api.getBrief(apiTask.project.id)
          setBriefData(mapBriefToUI(brief))
        } catch { /* Brief may not exist */ }
      }
    } catch (err) {
      toast.error('加载任务失败')
    } finally {
      setIsLoading(false)
    }
  }, [taskId, toast])

  useEffect(() => { loadTask() }, [loadTask])

  useEffect(() => {
    const unsub1 = subscribe('task_updated', (data) => {
      if ((data as { task_id?: string }).task_id === taskId) loadTask()
    })
    const unsub2 = subscribe('review_completed', (data) => {
      if ((data as { task_id?: string }).task_id === taskId) loadTask()
    })
    return () => { unsub1(); unsub2() }
  }, [subscribe, taskId, loadTask])

  // AI 审核中时轮询（SSE 的后备方案）
  useEffect(() => {
    if (task.scriptStatus !== 'ai_reviewing') return
    const interval = setInterval(() => { loadTask() }, 5000)
    return () => clearInterval(interval)
  }, [task.scriptStatus, loadTask])

  const handleContinueToVideo = () => { router.push(`/creator/task/${params.id}/video`) }

  const getStatusDisplay = () => {
    const map: Record<string, string> = {
      pending_upload: '待上传脚本', ai_rejected: 'AI 审核未通过', ai_reviewing: 'AI 审核中', ai_result: 'AI 审核完成',
      agent_reviewing: '代理商审核中', agent_rejected: '代理商驳回',
      brand_reviewing: '品牌方终审中', brand_passed: '审核通过', brand_rejected: '品牌方驳回',
    }
    return map[task.scriptStatus] || '未知状态'
  }

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 text-accent-indigo animate-spin" /></div>
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-4">
        <button type="button" onClick={() => router.back()} className="p-2 hover:bg-bg-elevated rounded-full"><ArrowLeft size={20} className="text-text-primary" /></button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-text-primary">{task.projectName}</h1>
          <p className="text-sm text-text-secondary">脚本阶段 · {getStatusDisplay()}</p>
        </div>
      </div>

      <Card><CardContent className="py-4"><ReviewSteps steps={getReviewSteps(task.scriptStatus)} /></CardContent></Card>

      <AgencyBriefSection toast={toast} briefData={briefData} />

      {task.scriptStatus === 'pending_upload' && <UploadSection taskId={taskId} onUploaded={loadTask} />}
      {task.scriptStatus === 'ai_rejected' && (
        <>
          {task.aiAvailable === false ? (
            <Card className="border-accent-amber/30 bg-accent-amber/5">
              <CardContent className="py-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle size={20} className="text-accent-amber mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-text-primary font-medium">AI 审核服务暂时不可用</p>
                    <p className="text-sm text-text-secondary mt-1">请稍后重新上传脚本，或联系代理商处理</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-accent-coral/30 bg-accent-coral/5">
              <CardContent className="py-4">
                <div className="flex items-start gap-3">
                  <XCircle size={20} className="text-accent-coral mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-text-primary font-medium">脚本未通过审核，请联系代理商了解修改意见后重新上传</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
          <UploadSection taskId={taskId} onUploaded={loadTask} />
        </>
      )}
      {task.scriptStatus === 'ai_reviewing' && <AIReviewingSection />}
      {task.scriptStatus === 'ai_result' && <WaitingSection message="等待代理商审核" />}
      {task.scriptStatus === 'agent_reviewing' && <WaitingSection message="等待代理商审核" />}
      {task.scriptStatus === 'agent_rejected' && task.agencyReview && (
        <><ReviewFeedbackSection review={task.agencyReview} type="agency" />
        <div className="flex gap-3"><Button variant="secondary" onClick={loadTask} fullWidth><RefreshCw size={16} />重新上传</Button></div></>
      )}
      {task.scriptStatus === 'brand_reviewing' && (
        <>
          {task.scriptAgencyCorrected && <CorrectedScriptSection correctedScript={task.scriptAgencyCorrected} correctedFile={task.scriptAgencyCorrectedFile} />}
          {task.agencyReview && <ReviewFeedbackSection review={task.agencyReview} type="agency" />}
          <WaitingSection message="等待品牌方终审" />
        </>
      )}
      {task.scriptStatus === 'brand_passed' && (
        <>
          <SuccessSection onContinue={handleContinueToVideo} />
          {task.scriptAgencyCorrected && <CorrectedScriptSection correctedScript={task.scriptAgencyCorrected} correctedFile={task.scriptAgencyCorrectedFile} />}
          {task.brandReview && <ReviewFeedbackSection review={task.brandReview} type="brand" />}
          {task.agencyReview && <ReviewFeedbackSection review={task.agencyReview} type="agency" />}
        </>
      )}
      {task.scriptStatus === 'brand_rejected' && (
        <>
          {task.brandReview && <ReviewFeedbackSection review={task.brandReview} type="brand" />}
          {task.agencyReview && <ReviewFeedbackSection review={task.agencyReview} type="agency" />}
          {task.scriptAgencyCorrected && <CorrectedScriptSection correctedScript={task.scriptAgencyCorrected} correctedFile={task.scriptAgencyCorrectedFile} />}
          <div className="flex gap-3"><Button variant="secondary" onClick={loadTask} fullWidth><RefreshCw size={16} />重新上传</Button></div>
        </>
      )}
    </div>
  )
}
