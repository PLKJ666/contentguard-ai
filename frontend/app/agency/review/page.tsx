'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useToast } from '@/components/ui/Toast'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { SuccessTag, PendingTag, WarningTag, ErrorTag } from '@/components/ui/Tag'
import {
  FileText,
  Video,
  Search,
  Clock,
  Eye,
  File,
  Download,
  MessageSquareWarning,
  Loader2
} from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { getPlatformInfo } from '@/lib/platforms'
import { api, extractErrorMessage } from '@/lib/api'
import { formatTaskDisplayTitle } from '@/lib/taskDisplay'
import { useSSE } from '@/contexts/SSEContext'
import type { TaskResponse } from '@/types/task'
import { FilePreview, type FileInfo } from '@/components/ui/FilePreview'

function platformLabel(id?: string | null): string {
  if (!id) return ''
  return getPlatformInfo(id)?.name || id
}

// ==================== 工具函数 ====================

function getRiskLevel(task: TaskResponse, type: 'script' | 'video'): 'low' | 'medium' | 'high' {
  const score = type === 'script' ? task.script_ai_score : task.video_ai_score
  if (score == null) return 'low'
  if (score >= 85) return 'low'
  if (score >= 70) return 'medium'
  return 'high'
}

const riskLevelConfig = {
  low: { label: 'AI通过', color: 'bg-accent-green', textColor: 'text-accent-green' },
  medium: { label: '风险:中', color: 'bg-accent-amber', textColor: 'text-accent-amber' },
  high: { label: '风险:高', color: 'bg-accent-coral', textColor: 'text-accent-coral' },
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

function guessMimeType(fileName?: string | null): string {
  if (!fileName) return 'application/octet-stream'
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  const mimeMap: Record<string, string> = {
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    avi: 'video/x-msvideo',
    mkv: 'video/x-matroska',
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
    txt: 'text/plain',
  }
  return mimeMap[ext] || 'application/octet-stream'
}

function ScoreTag({ score }: { score: number }) {
  if (score >= 85) return <SuccessTag>{score}分</SuccessTag>
  if (score >= 70) return <WarningTag>{score}分</WarningTag>
  return <ErrorTag>{score}分</ErrorTag>
}

// ==================== 卡片组件 ====================

function ScriptTaskCard({
  task,
  onPreview,
  onDownload,
}: {
  task: TaskResponse
  onPreview: (task: TaskResponse) => void
  onDownload: (task: TaskResponse) => void
}) {
  const riskLevel = getRiskLevel(task, 'script')
  const riskConfig = riskLevelConfig[riskLevel]

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation()
    onDownload(task)
  }

  const handlePreview = (e: React.MouseEvent) => {
    e.stopPropagation()
    onPreview(task)
  }

  return (
    <div className="rounded-xl bg-bg-elevated overflow-hidden">
      {/* 顶部条 */}
      <div className="px-4 py-1.5 bg-accent-indigo/10 border-b border-accent-indigo/20 flex items-center gap-1.5">
        <span className="text-xs font-medium text-accent-indigo">{task.project.brand_name || ''}</span>
        {task.project.platform && (
          <span className="text-xs text-text-tertiary">· {platformLabel(task.project.platform)}</span>
        )}
        {task.is_appeal && (
          <span className="ml-auto flex items-center gap-1 px-2 py-0.5 text-xs bg-accent-amber/30 text-accent-amber rounded-full font-medium">
            <MessageSquareWarning size={12} />
            申诉
          </span>
        )}
      </div>
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${riskConfig.color}`} />
            <span className="font-medium text-text-primary truncate">
              {formatTaskDisplayTitle({
                taskName: task.name,
                projectName: task.project?.name,
                sequence: task.sequence,
              })}
            </span>
          </div>
          <span className={`text-xs flex-shrink-0 ${riskConfig.textColor}`}>{riskConfig.label}</span>
        </div>
        <p className="text-xs text-text-secondary mb-3">达人：{task.creator.name}</p>

        {task.is_appeal && task.appeal_reason && (
          <div className="mb-3 p-2.5 rounded-lg bg-accent-amber/10 border border-accent-amber/30">
            <p className="text-xs text-accent-amber font-medium mb-1">申诉理由</p>
            <p className="text-sm text-text-secondary">{task.appeal_reason}</p>
          </div>
        )}

        <div className="flex items-center gap-3 p-3 rounded-lg bg-bg-page mb-3">
          <div className="w-10 h-10 rounded-lg bg-accent-indigo/15 flex items-center justify-center">
            <File size={20} className="text-accent-indigo" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-text-primary truncate">{task.script_file_name || '脚本文件'}</p>
          </div>
          <button type="button" onClick={handlePreview} className="p-2 rounded-lg hover:bg-bg-elevated transition-colors" title="预览文件">
            <Eye size={18} className="text-text-secondary" />
          </button>
          <button type="button" onClick={handleDownload} className="p-2 rounded-lg hover:bg-bg-elevated transition-colors" title="下载文件">
            <Download size={18} className="text-text-secondary" />
          </button>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-text-tertiary flex items-center gap-1">
            <Clock size={12} />
            {new Date(task.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
          </span>
          <Link href={`/agency/review/script/${task.id}`}>
            <Button size="sm" className={`${
              riskLevel === 'high' ? 'bg-accent-coral hover:bg-accent-coral/80' :
              riskLevel === 'medium' ? 'bg-accent-amber hover:bg-accent-amber/80' :
              'bg-accent-green hover:bg-accent-green/80'
            } text-white`}>
              {task.is_appeal ? '审核申诉' : '审核'}
            </Button>
          </Link>
        </div>
      </div>
    </div>
  )
}

function VideoTaskCard({
  task,
  onPreview,
  onDownload,
}: {
  task: TaskResponse
  onPreview: (task: TaskResponse) => void
  onDownload: (task: TaskResponse) => void
}) {
  const riskLevel = getRiskLevel(task, 'video')
  const riskConfig = riskLevelConfig[riskLevel]

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation()
    onDownload(task)
  }

  const handlePreview = (e: React.MouseEvent) => {
    e.stopPropagation()
    onPreview(task)
  }

  return (
    <div className="rounded-xl bg-bg-elevated overflow-hidden">
      <div className="px-4 py-1.5 bg-purple-500/10 border-b border-purple-500/20 flex items-center gap-1.5">
        <span className="text-xs font-medium text-purple-400">{task.project.brand_name || ''}</span>
        {task.project.platform && (
          <span className="text-xs text-text-tertiary">· {platformLabel(task.project.platform)}</span>
        )}
        {task.is_appeal && (
          <span className="ml-auto flex items-center gap-1 px-2 py-0.5 text-xs bg-accent-amber/30 text-accent-amber rounded-full font-medium">
            <MessageSquareWarning size={12} />
            申诉
          </span>
        )}
      </div>
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${riskConfig.color}`} />
            <span className="font-medium text-text-primary truncate">
              {formatTaskDisplayTitle({
                taskName: task.name,
                projectName: task.project?.name,
                sequence: task.sequence,
              })}
            </span>
          </div>
          <span className={`text-xs flex-shrink-0 ${riskConfig.textColor}`}>{riskConfig.label}</span>
        </div>
        <p className="text-xs text-text-secondary mb-3">达人：{task.creator.name}</p>

        {task.is_appeal && task.appeal_reason && (
          <div className="mb-3 p-2.5 rounded-lg bg-accent-amber/10 border border-accent-amber/30">
            <p className="text-xs text-accent-amber font-medium mb-1">申诉理由</p>
            <p className="text-sm text-text-secondary">{task.appeal_reason}</p>
          </div>
        )}

        <div className="flex items-center gap-3 p-3 rounded-lg bg-bg-page mb-3">
          <div className="w-10 h-10 rounded-lg bg-purple-500/15 flex items-center justify-center">
            <Video size={20} className="text-purple-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-text-primary truncate">{task.video_file_name || '视频文件'}</p>
            {task.video_duration && (
              <p className="text-xs text-text-tertiary">{formatDuration(task.video_duration)}</p>
            )}
          </div>
          <button type="button" onClick={handlePreview} className="p-2 rounded-lg hover:bg-bg-elevated transition-colors" title="预览视频">
            <Eye size={18} className="text-text-secondary" />
          </button>
          <button type="button" onClick={handleDownload} className="p-2 rounded-lg hover:bg-bg-elevated transition-colors" title="下载文件">
            <Download size={18} className="text-text-secondary" />
          </button>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-text-tertiary flex items-center gap-1">
            <Clock size={12} />
            {new Date(task.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
          </span>
          <Link href={`/agency/review/video/${task.id}`}>
            <Button size="sm" className={`${
              riskLevel === 'high' ? 'bg-accent-coral hover:bg-accent-coral/80' :
              riskLevel === 'medium' ? 'bg-accent-amber hover:bg-accent-amber/80' :
              'bg-accent-green hover:bg-accent-green/80'
            } text-white`}>
              {task.is_appeal ? '审核申诉' : '审核'}
            </Button>
          </Link>
        </div>
      </div>
    </div>
  )
}

// ==================== 骨架屏 ====================

function ReviewListSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-8 w-24 bg-bg-elevated rounded" />
        <div className="flex gap-2">
          <div className="h-8 w-20 bg-bg-elevated rounded" />
          <div className="h-8 w-20 bg-bg-elevated rounded" />
        </div>
      </div>
      <div className="h-10 w-full max-w-md bg-bg-elevated rounded-lg" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[1, 2].map(i => (
          <div key={i} className="space-y-3">
            <div className="h-8 w-32 bg-bg-elevated rounded" />
            {[1, 2, 3].map(j => (
              <div key={j} className="h-40 bg-bg-elevated rounded-xl" />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// ==================== 主页面 ====================

export default function AgencyReviewListPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'all' | 'script' | 'video'>('all')
  const [previewTask, setPreviewTask] = useState<TaskResponse | null>(null)
  const [previewType, setPreviewType] = useState<'script' | 'video'>('script')
  const [scriptTasks, setScriptTasks] = useState<TaskResponse[]>([])
  const [videoTasks, setVideoTasks] = useState<TaskResponse[]>([])
  const [loading, setLoading] = useState(true)
  const toast = useToast()
  const { subscribe } = useSSE()

  const loadData = useCallback(async () => {
    try {
      const [scriptData, videoData] = await Promise.all([
        api.listTasks(1, 50, 'script_agency_review'),
        api.listTasks(1, 50, 'video_agency_review'),
      ])
      setScriptTasks(scriptData.items)
      setVideoTasks(videoData.items)
    } catch (err) {
      console.error('Failed to load review tasks:', err)
      toast.error('加载审核任务失败')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    const unsub1 = subscribe('task_updated', () => loadData())
    const unsub2 = subscribe('new_task', () => loadData())
    return () => { unsub1(); unsub2() }
  }, [subscribe, loadData])

  if (loading) return <ReviewListSkeleton />

  const filteredScripts = scriptTasks.filter(task =>
    formatTaskDisplayTitle({
      taskName: task.name,
      projectName: task.project?.name,
      sequence: task.sequence,
    }).toLowerCase().includes(searchQuery.toLowerCase()) ||
    task.creator.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const filteredVideos = videoTasks.filter(task =>
    formatTaskDisplayTitle({
      taskName: task.name,
      projectName: task.project?.name,
      sequence: task.sequence,
    }).toLowerCase().includes(searchQuery.toLowerCase()) ||
    task.creator.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const appealScriptCount = scriptTasks.filter(t => t.is_appeal).length
  const appealVideoCount = videoTasks.filter(t => t.is_appeal).length

  const handleScriptPreview = (task: TaskResponse) => {
    setPreviewTask(task)
    setPreviewType('script')
  }

  const handleVideoPreview = (task: TaskResponse) => {
    setPreviewTask(task)
    setPreviewType('video')
  }

  const downloadTextAsFile = (text: string, fileName: string) => {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleScriptDownload = async (task: TaskResponse) => {
    const scriptFileUrl = task.script_file_url || ''
    const scriptFileName = task.script_file_name || `${formatTaskDisplayTitle({
      taskName: task.name,
      projectName: task.project?.name,
      sequence: task.sequence,
    })}_脚本.txt`
    const scriptText = task.script_text_content?.trim() || ''

    if (scriptFileUrl) {
      try {
        await api.downloadFile(scriptFileUrl, scriptFileName)
      } catch (err: unknown) {
        toast.error(extractErrorMessage(err))
      }
      return
    }

    if (scriptText) {
      const normalizedName = /\.[^.]+$/.test(scriptFileName) ? scriptFileName : `${scriptFileName}.txt`
      downloadTextAsFile(scriptText, normalizedName)
      return
    }

    toast.error('当前任务没有可下载的脚本内容')
  }

  const handleVideoDownload = async (task: TaskResponse) => {
    const videoFileUrl = task.video_file_url || ''
    const videoFileName = task.video_file_name || `${formatTaskDisplayTitle({
      taskName: task.name,
      projectName: task.project?.name,
      sequence: task.sequence,
    })}_视频`
    if (!videoFileUrl) {
      toast.error('当前任务没有可下载的视频文件')
      return
    }
    try {
      await api.downloadFile(videoFileUrl, videoFileName)
    } catch (err: unknown) {
      toast.error(extractErrorMessage(err))
    }
  }

  const previewFile: FileInfo | null = (() => {
    if (!previewTask) return null
    if (previewType === 'script') {
      if (!previewTask.script_file_url) return null
      return {
        id: `preview-script-${previewTask.id}`,
        fileName: previewTask.script_file_name || '脚本文件',
        fileSize: '',
        fileType: guessMimeType(previewTask.script_file_name),
        fileUrl: previewTask.script_file_url,
      }
    }
    if (!previewTask.video_file_url) return null
    return {
      id: `preview-video-${previewTask.id}`,
      fileName: previewTask.video_file_name || '视频文件',
      fileSize: '',
      fileType: guessMimeType(previewTask.video_file_name),
      fileUrl: previewTask.video_file_url,
      duration: previewTask.video_duration ? formatDuration(previewTask.video_duration) : undefined,
    }
  })()

  const isPreviewScriptText = previewType === 'script' && !previewTask?.script_file_url

  return (
    <div className="space-y-6 min-h-0">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">审核台</h1>
          <p className="text-sm text-text-secondary mt-1">审核达人提交的脚本和视频</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
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

      {/* 任务列表 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {(activeTab === 'all' || activeTab === 'script') && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText size={18} className="text-accent-indigo" />
                脚本审核
                <span className="ml-auto text-sm font-normal text-accent-indigo">
                  {filteredScripts.length} 条待审核
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {filteredScripts.length > 0 ? (
                filteredScripts.map((task) => (
                  <ScriptTaskCard
                    key={task.id}
                    task={task}
                    onPreview={handleScriptPreview}
                    onDownload={handleScriptDownload}
                  />
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

        {(activeTab === 'all' || activeTab === 'video') && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Video size={18} className="text-purple-400" />
                视频审核
                <span className="ml-auto text-sm font-normal text-accent-indigo">
                  {filteredVideos.length} 条待审核
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {filteredVideos.length > 0 ? (
                filteredVideos.map((task) => (
                  <VideoTaskCard
                    key={task.id}
                    task={task}
                    onPreview={handleVideoPreview}
                    onDownload={handleVideoDownload}
                  />
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
        title={previewType === 'script' ? (previewTask?.script_file_name || '脚本预览') : (previewTask?.video_file_name || '视频预览')}
        size="lg"
      >
        <div className="space-y-4">
          {previewTask?.is_appeal && previewTask?.appeal_reason && (
            <div className="p-3 rounded-lg bg-accent-amber/10 border border-accent-amber/30">
              <p className="text-xs text-accent-amber font-medium mb-1 flex items-center gap-1">
                <MessageSquareWarning size={12} />
                申诉理由
              </p>
              <p className="text-sm text-text-secondary">{previewTask.appeal_reason}</p>
            </div>
          )}

          {isPreviewScriptText ? (
            <div className="rounded-lg bg-bg-elevated border border-border-subtle p-4 max-h-[560px] overflow-auto">
              <pre className="text-sm text-text-primary whitespace-pre-wrap break-words">
                {previewTask?.script_text_content || '暂无脚本文本内容'}
              </pre>
            </div>
          ) : previewFile ? (
            <div className={previewType === 'video' ? 'aspect-video' : 'min-h-[420px]'}>
              <FilePreview file={previewFile} className="h-full" />
            </div>
          ) : (
            <div className="aspect-[4/3] bg-bg-elevated rounded-lg flex items-center justify-center">
              <div className="text-center">
                <FileText className="w-12 h-12 mx-auto text-text-tertiary mb-4" />
                <p className="text-text-secondary">当前任务暂无可预览文件</p>
              </div>
            </div>
          )}

          <div className="flex justify-between items-center">
            <div className="text-sm text-text-secondary">
              <span>{previewType === 'script' ? previewTask?.script_file_name : previewTask?.video_file_name}</span>
              {previewType === 'video' && previewTask?.video_duration && (
                <>
                  <span className="mx-2">·</span>
                  <span>{formatDuration(previewTask.video_duration)}</span>
                </>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setPreviewTask(null)}>
                关闭
              </Button>
              <Button
                onClick={() => {
                  if (!previewTask) return
                  if (previewType === 'script') {
                    void handleScriptDownload(previewTask)
                  } else {
                    void handleVideoDownload(previewTask)
                  }
                }}
              >
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
