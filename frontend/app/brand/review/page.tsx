'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { SuccessTag, PendingTag, WarningTag, ErrorTag } from '@/components/ui/Tag'
import { useToast } from '@/components/ui/Toast'
import {
  FileText,
  Video,
  Search,
  Filter,
  Clock,
  User,
  Building,
  ChevronRight,
  AlertTriangle,
  Download,
  Eye,
  File,
  MessageSquareWarning,
  Loader2,
} from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { getPlatformInfo } from '@/lib/platforms'
import { api, extractErrorMessage } from '@/lib/api'
import { formatTaskDisplayTitle } from '@/lib/taskDisplay'
import type { TaskResponse } from '@/types/task'

// ==================== 类型定义 ====================

interface UITask {
  id: string
  title: string
  fileName: string
  fileSize: string
  creatorName: string
  agencyName: string
  projectName: string
  platform: string
  aiScore: number
  submittedAt: string
  hasHighRisk: boolean
  agencyApproved: boolean
  isAppeal: boolean
  appealReason?: string
  duration?: string
}

// ==================== 映射函数 ====================

/**
 * 将后端 TaskResponse 映射为 UI 任务格式
 */
function mapTaskToUI(task: TaskResponse, type: 'script' | 'video'): UITask {
  const isScript = type === 'script'

  // AI 评分：脚本用 script_ai_score，视频用 video_ai_score
  const aiScore = isScript
    ? (task.script_ai_score ?? 0)
    : (task.video_ai_score ?? 0)

  // AI 审核结果中检测是否有高风险（severity === 'high'）
  const aiResult = isScript ? task.script_ai_result : task.video_ai_result
  const hasHighRisk = aiResult?.violations?.some(v => v.severity === 'high') ?? false

  // 代理商审核状态
  const agencyStatus = isScript ? task.script_agency_status : task.video_agency_status
  const agencyApproved = agencyStatus === 'passed' || agencyStatus === 'force_passed'

  // 文件名
  const fileName = isScript
    ? (task.script_file_name ?? '未上传脚本')
    : (task.video_file_name ?? '未上传视频')

  // 视频时长：后端返回秒数，转为 mm:ss 格式
  let duration: string | undefined
  if (!isScript && task.video_duration) {
    const minutes = Math.floor(task.video_duration / 60)
    const seconds = task.video_duration % 60
    duration = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  // 格式化提交时间
  const submittedAt = formatDateTime(task.updated_at)

  // 平台信息：从项目获取
  const platform = task.project.platform || ''

  return {
    id: task.id,
    title: formatTaskDisplayTitle({
      taskName: task.name,
      projectName: task.project?.name,
      sequence: task.sequence,
    }),
    fileName,
    fileSize: isScript ? '--' : '--',
    creatorName: task.creator.name,
    agencyName: task.agency.name,
    projectName: task.project.name,
    platform,
    aiScore,
    submittedAt,
    hasHighRisk,
    agencyApproved,
    isAppeal: task.is_appeal,
    appealReason: task.appeal_reason ?? undefined,
    duration,
  }
}

/**
 * 格式化日期时间为 YYYY-MM-DD HH:mm
 */
function formatDateTime(isoString: string): string {
  try {
    const d = new Date(isoString)
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const hours = String(d.getHours()).padStart(2, '0')
    const minutes = String(d.getMinutes()).padStart(2, '0')
    return `${year}-${month}-${day} ${hours}:${minutes}`
  } catch {
    return isoString
  }
}

// ==================== 子组件 ====================

function ScoreTag({ score }: { score: number }) {
  if (score >= 85) return <SuccessTag>{score}分</SuccessTag>
  if (score >= 70) return <WarningTag>{score}分</WarningTag>
  return <ErrorTag>{score}分</ErrorTag>
}

function TaskCard({
  task,
  type,
  onPreview
}: {
  task: UITask
  type: 'script' | 'video'
  onPreview: (task: UITask, type: 'script' | 'video') => void
}) {
  const toast = useToast()
  const href = type === 'script' ? `/brand/review/script/${task.id}` : `/brand/review/video/${task.id}`
  const platform = getPlatformInfo(task.platform)

  const handlePreview = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onPreview(task, type)
  }

  const handleDownload = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    toast.info(`下载文件: ${task.fileName}`)
  }

  return (
    <Link href={href}>
      <div className="rounded-lg border border-border-subtle hover:border-accent-indigo/50 hover:bg-accent-indigo/5 transition-all cursor-pointer overflow-hidden">
        {/* 平台顶部条 */}
        {platform && (
          <div className={`px-4 py-1.5 ${platform.bgColor} border-b ${platform.borderColor} flex items-center gap-1.5`}>
            <span className="text-sm">{platform.icon}</span>
            <span className={`text-xs font-medium ${platform.textColor}`}>{platform.name}</span>
            {/* 申诉标识 */}
            {task.isAppeal && (
              <span className="ml-auto flex items-center gap-1 px-2 py-0.5 text-xs bg-accent-amber/30 text-accent-amber rounded-full font-medium">
                <MessageSquareWarning size={12} />
                申诉
              </span>
            )}
          </div>
        )}
        <div className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h4 className="font-medium text-text-primary truncate">{task.title}</h4>
                {task.hasHighRisk && (
                  <span className="flex items-center gap-1 px-2 py-0.5 text-xs bg-accent-coral/20 text-accent-coral rounded">
                    <AlertTriangle size={12} />
                    高风险
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 mt-1 text-sm text-text-secondary">
                <span className="flex items-center gap-1">
                  <User size={12} />
                  {task.creatorName}
                </span>
                <span className="flex items-center gap-1">
                  <Building size={12} />
                  {task.agencyName}
                </span>
              </div>
            </div>
            <ScoreTag score={task.aiScore} />
          </div>

          {/* 申诉理由 */}
          {task.isAppeal && task.appealReason && (
            <div className="mb-3 p-2.5 rounded-lg bg-accent-amber/10 border border-accent-amber/30">
              <p className="text-xs text-accent-amber font-medium mb-1">申诉理由</p>
              <p className="text-sm text-text-secondary">{task.appealReason}</p>
            </div>
          )}

          {/* 文件信息 */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-bg-page mb-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${type === 'script' ? 'bg-accent-indigo/15' : 'bg-purple-500/15'}`}>
              {type === 'script' ? (
                <File size={20} className="text-accent-indigo" />
              ) : (
                <Video size={20} className="text-purple-400" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary truncate">{task.fileName}</p>
              <p className="text-xs text-text-tertiary">
                {task.fileSize}
                {task.duration && ` · ${task.duration}`}
              </p>
            </div>
            <button
              type="button"
              onClick={handlePreview}
              className="p-2 rounded-lg hover:bg-bg-elevated transition-colors"
              title={type === 'script' ? '预览脚本' : '预览视频'}
            >
              <Eye size={18} className="text-text-secondary" />
            </button>
            <button
              type="button"
              onClick={handleDownload}
              className="p-2 rounded-lg hover:bg-bg-elevated transition-colors"
              title="下载文件"
            >
              <Download size={18} className="text-text-secondary" />
            </button>
          </div>

          <div className="flex items-center justify-between text-xs text-text-tertiary">
            <span>{task.projectName}</span>
            <span className="flex items-center gap-1">
              <Clock size={12} />
              {task.submittedAt}
            </span>
          </div>
        </div>
      </div>
    </Link>
  )
}

function TaskListSkeleton({ count = 2 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border-subtle overflow-hidden animate-pulse">
          <div className="px-4 py-1.5 bg-bg-elevated border-b border-border-subtle">
            <div className="h-4 w-20 bg-bg-page rounded" />
          </div>
          <div className="p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div className="flex-1 space-y-2">
                <div className="h-5 w-48 bg-bg-page rounded" />
                <div className="flex gap-4">
                  <div className="h-4 w-24 bg-bg-page rounded" />
                  <div className="h-4 w-24 bg-bg-page rounded" />
                </div>
              </div>
              <div className="h-6 w-14 bg-bg-page rounded" />
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-bg-page">
              <div className="w-10 h-10 rounded-lg bg-bg-elevated" />
              <div className="flex-1 space-y-1">
                <div className="h-4 w-40 bg-bg-elevated rounded" />
                <div className="h-3 w-20 bg-bg-elevated rounded" />
              </div>
            </div>
            <div className="flex justify-between">
              <div className="h-3 w-28 bg-bg-page rounded" />
              <div className="h-3 w-32 bg-bg-page rounded" />
            </div>
          </div>
        </div>
      ))}
    </>
  )
}

// ==================== 主页面 ====================

export default function BrandReviewListPage() {
  const toast = useToast()
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'all' | 'script' | 'video'>('all')
  const [previewTask, setPreviewTask] = useState<{ task: UITask; type: 'script' | 'video' } | null>(null)

  // API 数据状态
  const [scriptTasks, setScriptTasks] = useState<UITask[]>([])
  const [videoTasks, setVideoTasks] = useState<UITask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 从 API 加载数据
  const fetchTasks = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const [scriptRes, videoRes] = await Promise.all([
        api.listTasks(1, 20, 'script_brand_review'),
        api.listTasks(1, 20, 'video_brand_review'),
      ])

      setScriptTasks(scriptRes.items.map(t => mapTaskToUI(t, 'script')))
      setVideoTasks(videoRes.items.map(t => mapTaskToUI(t, 'video')))
    } catch (err) {
      const message = extractErrorMessage(err)
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

  // 搜索过滤
  const filteredScripts = scriptTasks.filter(task =>
    task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    task.creatorName.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const filteredVideos = videoTasks.filter(task =>
    task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    task.creatorName.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // 计算申诉数量
  const appealScriptCount = scriptTasks.filter(t => t.isAppeal).length
  const appealVideoCount = videoTasks.filter(t => t.isAppeal).length

  const handlePreview = (task: UITask, type: 'script' | 'video') => {
    setPreviewTask({ task, type })
  }

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">终审台</h1>
          <p className="text-sm text-text-secondary mt-1">审核代理商提交的脚本和视频</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          {loading ? (
            <span className="flex items-center gap-2 text-text-tertiary">
              <Loader2 size={14} className="animate-spin" />
              加载中...
            </span>
          ) : (
            <>
              <span className="text-text-secondary">待审核：</span>
              <span className="px-2 py-1 bg-accent-indigo/20 text-accent-indigo rounded font-medium">
                {scriptTasks.length} 脚本
              </span>
              <span className="px-2 py-1 bg-purple-500/20 text-purple-400 rounded font-medium">
                {videoTasks.length} 视频
              </span>
              {(appealScriptCount + appealVideoCount) > 0 && (
                <span className="px-2 py-1 bg-accent-amber/20 text-accent-amber rounded font-medium flex items-center gap-1">
                  <MessageSquareWarning size={14} />
                  {appealScriptCount + appealVideoCount} 申诉
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {/* 搜索和筛选 */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            type="text"
            placeholder="搜索任务名称或达人..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-border-subtle rounded-lg bg-bg-elevated text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-indigo"
          />
        </div>
        <div className="flex items-center gap-1 p-1 bg-bg-elevated rounded-lg">
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'all' ? 'bg-bg-card text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            全部
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('script')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'script' ? 'bg-bg-card text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            脚本
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('video')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'video' ? 'bg-bg-card text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            视频
          </button>
        </div>
      </div>

      {/* 加载错误提示 */}
      {error && (
        <div className="p-4 rounded-lg bg-accent-coral/10 border border-accent-coral/30 text-accent-coral text-sm flex items-center justify-between">
          <span>加载失败: {error}</span>
          <Button variant="secondary" size="sm" onClick={fetchTasks}>
            重试
          </Button>
        </div>
      )}

      {/* 任务列表 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 脚本待审列表 */}
        {(activeTab === 'all' || activeTab === 'script') && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText size={18} className="text-accent-indigo" />
                脚本终审
                <span className="ml-auto text-sm font-normal text-text-secondary">
                  {loading ? '...' : `${filteredScripts.length} 条待审`}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {loading ? (
                <TaskListSkeleton count={2} />
              ) : filteredScripts.length > 0 ? (
                filteredScripts.map((task) => (
                  <TaskCard key={task.id} task={task} type="script" onPreview={handlePreview} />
                ))
              ) : (
                <div className="text-center py-8 text-text-tertiary">
                  <FileText size={32} className="mx-auto mb-2 opacity-50" />
                  <p>暂无待审脚本</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* 视频待审列表 */}
        {(activeTab === 'all' || activeTab === 'video') && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Video size={18} className="text-purple-400" />
                视频终审
                <span className="ml-auto text-sm font-normal text-text-secondary">
                  {loading ? '...' : `${filteredVideos.length} 条待审`}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {loading ? (
                <TaskListSkeleton count={3} />
              ) : filteredVideos.length > 0 ? (
                filteredVideos.map((task) => (
                  <TaskCard key={task.id} task={task} type="video" onPreview={handlePreview} />
                ))
              ) : (
                <div className="text-center py-8 text-text-tertiary">
                  <Video size={32} className="mx-auto mb-2 opacity-50" />
                  <p>暂无待审视频</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* 预览弹窗 */}
      <Modal
        isOpen={!!previewTask}
        onClose={() => setPreviewTask(null)}
        title={previewTask?.task.fileName || '文件预览'}
        size="lg"
      >
        <div className="space-y-4">
          {/* 申诉理由 */}
          {previewTask?.task.isAppeal && previewTask?.task.appealReason && (
            <div className="p-3 rounded-lg bg-accent-amber/10 border border-accent-amber/30">
              <p className="text-xs text-accent-amber font-medium mb-1 flex items-center gap-1">
                <MessageSquareWarning size={12} />
                申诉理由
              </p>
              <p className="text-sm text-text-secondary">{previewTask.task.appealReason}</p>
            </div>
          )}

          {/* 预览区域 */}
          {previewTask?.type === 'video' ? (
            <div className="aspect-video bg-bg-elevated rounded-lg flex items-center justify-center">
              <div className="text-center">
                <Video className="w-12 h-12 mx-auto text-purple-400 mb-4" />
                <p className="text-text-secondary">视频播放区域</p>
                <p className="text-xs text-text-tertiary mt-1">实际开发中将嵌入视频播放器</p>
              </div>
            </div>
          ) : (
            <div className="aspect-[4/3] bg-bg-elevated rounded-lg flex items-center justify-center">
              <div className="text-center">
                <FileText className="w-12 h-12 mx-auto text-accent-indigo mb-4" />
                <p className="text-text-secondary">脚本预览区域</p>
                <p className="text-xs text-text-tertiary mt-1">实际开发中将嵌入文档预览组件</p>
              </div>
            </div>
          )}

          {/* 文件信息和操作 */}
          <div className="flex justify-between items-center">
            <div className="text-sm text-text-secondary">
              <span>{previewTask?.task.fileName}</span>
              <span className="mx-2">·</span>
              <span>{previewTask?.task.fileSize}</span>
              {previewTask?.type === 'video' && previewTask?.task.duration && (
                <>
                  <span className="mx-2">·</span>
                  <span>{previewTask.task.duration}</span>
                </>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setPreviewTask(null)}>
                关闭
              </Button>
              <Button onClick={() => toast.info(`下载文件: ${previewTask?.task.fileName}`)}>
                <Download size={16} />
                下载
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}
