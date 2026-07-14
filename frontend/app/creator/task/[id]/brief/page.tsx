'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'
import {
  ArrowLeft,
  FileText,
  Download,
  Eye,
  Target,
  Ban,
  File,
  Building2,
  Calendar,
  Clock,
  ChevronRight,
  Loader2
} from 'lucide-react'
import { ResponsiveLayout } from '@/components/layout/ResponsiveLayout'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { api, extractErrorMessage } from '@/lib/api'
import { formatTaskDisplayName } from '@/lib/taskDisplay'
import type { BriefResponse } from '@/types/brief'
import type { TaskResponse } from '@/types/task'

// 代理商Brief文档类型
type AgencyBriefFile = {
  id: string
  name: string
  size: string
  uploadedAt: string
  description?: string
  url?: string
}

// 页面视图模型
type BriefViewModel = {
  taskName: string
  agencyName: string
  brandName: string
  deadline: string
  createdAt: string
  files: AgencyBriefFile[]
  sellingPoints: { id: string; content: string; required: boolean }[]
  blacklistWords: { id: string; word: string; reason: string }[]
  contentRequirements: string[]
}

function buildViewModelFromAPI(task: TaskResponse, brief: BriefResponse): BriefViewModel {
  // 优先显示代理商上传的文档，没有则降级到品牌方附件
  const agencyAtts = brief.agency_attachments ?? []
  const brandAtts = brief.attachments ?? []
  const sourceAtts = agencyAtts.length > 0 ? agencyAtts : brandAtts
  const files: AgencyBriefFile[] = sourceAtts.map((att, idx) => ({
    id: att.id || `att-${idx}`,
    name: att.name,
    size: att.size || '',
    uploadedAt: brief.updated_at?.split('T')[0] || '',
    description: undefined,
    url: att.url,
  }))

  // Map selling points
  const sellingPoints = (brief.selling_points ?? []).map((sp, idx) => ({
    id: `sp-${idx}`,
    content: sp.content,
    required: sp.required ?? (sp.priority === 'core'),
  }))

  // Map blacklist words
  const blacklistWords = (brief.blacklist_words ?? []).map((bw, idx) => ({
    id: `bw-${idx}`,
    word: bw.word,
    reason: bw.reason,
  }))

  // Build content requirements
  const contentRequirements: string[] = []
  if (brief.min_duration != null || brief.max_duration != null) {
    const minStr = brief.min_duration != null ? `${brief.min_duration}` : '?'
    const maxStr = brief.max_duration != null ? `${brief.max_duration}` : '?'
    contentRequirements.push(`视频时长：${minStr}-${maxStr}秒`)
  }
  if (brief.other_requirements) {
    contentRequirements.push(brief.other_requirements)
  }

  return {
    taskName: formatTaskDisplayName({
      taskName: task.name,
      projectName: task.project?.name,
      sequence: task.sequence,
    }),
    agencyName: task.agency.name,
    brandName: task.project.brand_name || task.project.name,
    deadline: '', // backend task has no deadline field yet
    createdAt: task.created_at.split('T')[0],
    files,
    sellingPoints,
    blacklistWords,
    contentRequirements,
  }
}

// 骨架屏
function BriefSkeleton() {
  return (
    <div className="flex flex-col gap-6 h-full animate-pulse">
      {/* 顶部导航骨架 */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-2">
          <div className="h-8 w-16 bg-bg-elevated rounded-lg" />
          <div className="h-7 w-48 bg-bg-elevated rounded" />
          <div className="h-4 w-36 bg-bg-elevated rounded" />
        </div>
        <div className="h-10 w-28 bg-bg-elevated rounded-xl" />
      </div>

      {/* 任务信息骨架 */}
      <div className="bg-bg-card rounded-2xl p-5 card-shadow">
        <div className="h-5 w-24 bg-bg-elevated rounded mb-4" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-bg-elevated" />
              <div className="flex flex-col gap-1">
                <div className="h-3 w-12 bg-bg-elevated rounded" />
                <div className="h-4 w-20 bg-bg-elevated rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 内容区域骨架 */}
      <div className="flex-1 space-y-6">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-bg-card rounded-2xl p-5 card-shadow">
            <div className="h-5 w-32 bg-bg-elevated rounded mb-4" />
            <div className="space-y-2">
              <div className="h-4 w-full bg-bg-elevated rounded" />
              <div className="h-4 w-3/4 bg-bg-elevated rounded" />
              <div className="h-4 w-1/2 bg-bg-elevated rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function TaskBriefPage() {
  const router = useRouter()
  const params = useParams()
  const toast = useToast()
  const taskId = params.id as string
  const [previewFile, setPreviewFile] = useState<AgencyBriefFile | null>(null)
  const [loading, setLoading] = useState(true)
  const [viewModel, setViewModel] = useState<BriefViewModel | null>(null)

  const loadBriefData = useCallback(async () => {
    try {
      setLoading(true)
      // First get the task to find its project ID
      const task = await api.getTask(taskId)
      // Then get the brief for that project
      const brief = await api.getBrief(task.project.id)
      setViewModel(buildViewModelFromAPI(task, brief))
    } catch (err) {
      const message = extractErrorMessage(err)
      toast.error(message)
      console.error('加载Brief失败:', err)
      // Fallback: still show task info if brief load fails
    } finally {
      setLoading(false)
    }
  }, [taskId, toast])

  useEffect(() => {
    loadBriefData()
  }, [loadBriefData])

  const handleDownload = async (file: AgencyBriefFile) => {
    if (!file.url) {
      toast.info('暂无可下载链接')
      return
    }
    try {
      await api.downloadFile(file.url, file.name)
    } catch {
      toast.error('下载失败')
    }
  }

  const handleDownloadAll = () => {
    if (!viewModel) return
    viewModel.files.forEach(f => handleDownload(f))
  }

  if (loading || !viewModel) {
    return (
      <ResponsiveLayout role="creator">
        <BriefSkeleton />
      </ResponsiveLayout>
    )
  }

  const requiredPoints = viewModel.sellingPoints.filter(sp => sp.required)
  const optionalPoints = viewModel.sellingPoints.filter(sp => !sp.required)

  return (
    <ResponsiveLayout role="creator">
      <div className="flex flex-col gap-6 h-full">
        {/* 顶部导航 */}
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3 mb-1">
              <button
                type="button"
                onClick={() => router.back()}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-elevated text-text-secondary text-sm hover:bg-bg-card transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                返回
              </button>
            </div>
            <h1 className="text-xl lg:text-[28px] font-bold text-text-primary">{viewModel.taskName}</h1>
            <p className="text-sm lg:text-[15px] text-text-secondary">查看任务要求和Brief文档</p>
          </div>
          <Button onClick={() => router.push(`/creator/task/${params.id}`)}>
            开始任务
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>

        {/* 任务基本信息 */}
        <div className="bg-bg-card rounded-2xl p-5 card-shadow">
          <h3 className="text-base font-semibold text-text-primary mb-4">任务信息</h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-500/15 flex items-center justify-center">
                <Building2 className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <p className="text-xs text-text-tertiary">代理商</p>
                <p className="text-sm font-medium text-text-primary">{viewModel.agencyName}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent-indigo/15 flex items-center justify-center">
                <Building2 className="w-5 h-5 text-accent-indigo" />
              </div>
              <div>
                <p className="text-xs text-text-tertiary">品牌方</p>
                <p className="text-sm font-medium text-text-primary">{viewModel.brandName}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent-green/15 flex items-center justify-center">
                <Calendar className="w-5 h-5 text-accent-green" />
              </div>
              <div>
                <p className="text-xs text-text-tertiary">分配时间</p>
                <p className="text-sm font-medium text-text-primary">{viewModel.createdAt}</p>
              </div>
            </div>
            {viewModel.deadline && (
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-accent-coral/15 flex items-center justify-center">
                  <Clock className="w-5 h-5 text-accent-coral" />
                </div>
                <div>
                  <p className="text-xs text-text-tertiary">截止日期</p>
                  <p className="text-sm font-medium text-text-primary">{viewModel.deadline}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 主要内容区域 - 可滚动 */}
        <div className="flex-1 overflow-y-auto space-y-6">
          {/* Brief文档列表 */}
          {viewModel.files.length > 0 && (
            <div className="bg-bg-card rounded-2xl p-5 card-shadow">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <File className="w-5 h-5 text-accent-indigo" />
                  <h3 className="text-base font-semibold text-text-primary">Brief 文档</h3>
                  <span className="text-sm text-text-tertiary">({viewModel.files.length}个文件)</span>
                </div>
                <Button variant="secondary" size="sm" onClick={handleDownloadAll}>
                  <Download className="w-4 h-4" />
                  下载全部
                </Button>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {viewModel.files.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center justify-between p-4 bg-bg-elevated rounded-xl hover:bg-bg-page transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-11 h-11 rounded-xl bg-accent-indigo/15 flex items-center justify-center flex-shrink-0">
                        <FileText className="w-5 h-5 text-accent-indigo" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-text-primary truncate">{file.name}</p>
                        <p className="text-xs text-text-tertiary">{file.size}</p>
                        {file.description && (
                          <p className="text-xs text-text-secondary mt-0.5 truncate">{file.description}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                      <button
                        type="button"
                        onClick={() => setPreviewFile(file)}
                        className="p-2.5 hover:bg-bg-card rounded-lg transition-colors"
                      >
                        <Eye className="w-4 h-4 text-text-secondary" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownload(file)}
                        className="p-2.5 hover:bg-bg-card rounded-lg transition-colors"
                      >
                        <Download className="w-4 h-4 text-text-secondary" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 内容要求 */}
          {viewModel.contentRequirements.length > 0 && (
            <div className="bg-bg-card rounded-2xl p-5 card-shadow">
              <div className="flex items-center gap-2 mb-4">
                <FileText className="w-5 h-5 text-accent-amber" />
                <h3 className="text-base font-semibold text-text-primary">内容要求</h3>
              </div>
              <ul className="space-y-2">
                {viewModel.contentRequirements.map((req, index) => (
                  <li key={index} className="flex items-start gap-2 text-sm text-text-secondary">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent-amber mt-2 flex-shrink-0" />
                    {req}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 卖点要求 */}
          {viewModel.sellingPoints.length > 0 && (
            <div className="bg-bg-card rounded-2xl p-5 card-shadow">
              <div className="flex items-center gap-2 mb-4">
                <Target className="w-5 h-5 text-accent-green" />
                <h3 className="text-base font-semibold text-text-primary">卖点要求</h3>
              </div>
              <div className="space-y-3">
                {requiredPoints.length > 0 && (
                  <div className="p-4 bg-accent-coral/10 rounded-xl border border-accent-coral/30">
                    <p className="text-xs text-accent-coral font-semibold mb-2">必选卖点（必须在内容中提及）</p>
                    <div className="flex flex-wrap gap-2">
                      {requiredPoints.map((sp) => (
                        <span key={sp.id} className="px-3 py-1.5 text-sm bg-accent-coral/20 text-accent-coral rounded-lg font-medium">
                          {sp.content}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {optionalPoints.length > 0 && (
                  <div className="p-4 bg-bg-elevated rounded-xl">
                    <p className="text-xs text-text-tertiary font-semibold mb-2">可选卖点（建议提及）</p>
                    <div className="flex flex-wrap gap-2">
                      {optionalPoints.map((sp) => (
                        <span key={sp.id} className="px-3 py-1.5 text-sm bg-bg-page text-text-secondary rounded-lg">
                          {sp.content}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 违禁词 */}
          {viewModel.blacklistWords.length > 0 && (
            <div className="bg-bg-card rounded-2xl p-5 card-shadow">
              <div className="flex items-center gap-2 mb-4">
                <Ban className="w-5 h-5 text-accent-coral" />
                <h3 className="text-base font-semibold text-text-primary">违禁词（请勿在内容中使用）</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {viewModel.blacklistWords.map((bw) => (
                  <span
                    key={bw.id}
                    className="px-3 py-1.5 text-sm bg-accent-coral/15 text-accent-coral rounded-lg border border-accent-coral/30"
                  >
                    「{bw.word}」<span className="text-xs opacity-75 ml-1">{bw.reason}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 底部操作按钮 */}
          <div className="flex justify-center py-4">
            <Button size="lg" onClick={() => router.push(`/creator/task/${params.id}`)}>
              我已了解，开始任务
              <ChevronRight className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </div>

      {/* 文件预览弹窗 */}
      <Modal
        isOpen={!!previewFile}
        onClose={() => setPreviewFile(null)}
        title={previewFile?.name || '文件预览'}
        size="lg"
      >
        <div className="space-y-4">
          <div className="aspect-[4/3] bg-bg-elevated rounded-lg flex items-center justify-center">
            <div className="text-center">
              <FileText className="w-12 h-12 mx-auto text-accent-indigo mb-4" />
              <p className="text-text-secondary">文件预览区域</p>
              <p className="text-xs text-text-tertiary mt-1">实际开发中将嵌入文件预览组件</p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPreviewFile(null)}>
              关闭
            </Button>
            {previewFile && (
              <Button onClick={() => handleDownload(previewFile)}>
                <Download className="w-4 h-4" />
                下载文件
              </Button>
            )}
          </div>
        </div>
      </Modal>
    </ResponsiveLayout>
  )
}
