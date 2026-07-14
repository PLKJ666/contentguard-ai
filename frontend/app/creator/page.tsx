'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Video,
  Search,
  SlidersHorizontal,
  ChevronDown,
  Upload,
  Bot,
  Users,
  Building2,
  Check,
  X,
  Loader2,
  ArrowRight,
  Sparkles,
  Calendar
} from 'lucide-react'
import { ResponsiveLayout } from '@/components/layout/ResponsiveLayout'
import { cn } from '@/lib/utils'
import { getPlatformInfo } from '@/lib/platforms'
import { api } from '@/lib/api'
import { formatTaskDisplayName } from '@/lib/taskDisplay'
import { mapTaskToUI, type StepStatus, type StageSteps } from '@/lib/taskStageMapper'
import type { TaskResponse } from '@/types/task'

type Task = {
  id: string
  title: string
  description: string
  projectName: string
  brandName?: string
  updatedAtText: string
  platform: string
  scriptStage: StageSteps
  videoStage: StageSteps
  buttonText: string
  buttonType: 'upload' | 'view' | 'fix'
  scriptColor: string
  videoColor: string
  filterCategory: 'pending' | 'reviewing' | 'rejected' | 'completed'
}

const TASK_ID_PATTERN = /^TK[0-9A-Za-z-]+$/i
const INVISIBLE_CHARS_REGEX = /[\u200B-\u200D\uFEFF]/g

function cleanText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(INVISIBLE_CHARS_REGEX, '').trim()
}

function pickTaskId(rawTask: Record<string, unknown>): string {
  const taskId = cleanText(rawTask.task_id)
  const relatedTaskId = cleanText(rawTask.related_task_id)
  const id = cleanText(rawTask.id)
  const candidates = [taskId, relatedTaskId, id].filter(Boolean)
  const matched = candidates.find((candidate) => TASK_ID_PATTERN.test(candidate))
  return matched || candidates[0] || ''
}

function mapApiTaskToCreatorTask(task: TaskResponse): Task {
  const rawTask = task as TaskResponse & Record<string, unknown>
  const project = (rawTask.project as unknown as Record<string, unknown>) || {}
  const projectName = cleanText(project.name) || cleanText(project.project_name) || cleanText(rawTask.project_name) || '未命名项目'
  const brandName = cleanText(project.brand_name) || cleanText(rawTask.brand_name) || undefined
  const taskName = formatTaskDisplayName({
    taskName: cleanText(rawTask.name) || cleanText(rawTask.task_name) || cleanText(rawTask.task_title) || cleanText(rawTask.title),
    projectName,
    sequence: rawTask.sequence,
  })
  const platform = cleanText(project.platform) || cleanText(rawTask.platform) || 'douyin'
  const rawId = pickTaskId(rawTask)
  const ui = mapTaskToUI(task)
  const isScriptUpload = task.stage === 'script_upload'
  const isVideoUpload = task.stage === 'video_upload'
  const isUploadStage = isScriptUpload || isVideoUpload
  const isRejected = ui.filterCategory === 'rejected'
  const updatedAt = task.updated_at
    ? new Date(task.updated_at).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
    : '--'

  return {
    id: rawId,
    title: taskName,
    description: `${projectName}${brandName ? ` · ${brandName}` : ''} · 更新于 ${updatedAt}`,
    projectName,
    brandName,
    updatedAtText: updatedAt,
    platform,
    scriptStage: ui.scriptStage,
    videoStage: ui.videoStage,
    buttonText: isUploadStage ? (isScriptUpload ? '上传脚本' : '上传视频') : (isRejected ? '查看修改' : '查看详情'),
    buttonType: isUploadStage ? 'upload' : (isRejected ? 'fix' : 'view'),
    scriptColor: ui.scriptColor,
    videoColor: ui.videoColor,
    filterCategory: ui.filterCategory,
  }
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === 'done') return <div className="w-5 h-5 rounded-full bg-accent-green flex items-center justify-center"><Check size={10} className="text-white" /></div>
  if (status === 'current') return <div className="w-5 h-5 rounded-full bg-accent-indigo flex items-center justify-center shadow-lg animate-pulse"><Loader2 size={10} className="text-white animate-spin" /></div>
  if (status === 'error') return <div className="w-5 h-5 rounded-full bg-accent-coral flex items-center justify-center"><X size={10} className="text-white" /></div>
  return <div className="w-5 h-5 rounded-full bg-bg-page border border-border-subtle" />
}

function CompactProgress({ stage }: { stage: StageSteps }) {
  return (
    <div className="flex items-center gap-1.5">
      <StepIcon status={stage.submit} />
      <div className={cn("h-px w-4", stage.submit === 'done' ? 'bg-accent-green' : 'bg-border-subtle')} />
      <StepIcon status={stage.ai} />
      <div className={cn("h-px w-4", stage.ai === 'done' ? 'bg-accent-green' : 'bg-border-subtle')} />
      <StepIcon status={stage.agency} />
      <div className={cn("h-px w-4", stage.agency === 'done' ? 'bg-accent-green' : 'bg-border-subtle')} />
      <StepIcon status={stage.brand} />
    </div>
  )
}

function TaskCard({ task, index, onClick }: { task: Task; index: number; onClick: () => void }) {
  const platform = getPlatformInfo(task.platform)

  return (
    <div 
      className="group relative overflow-hidden rounded-[28px] bg-bg-card border border-border-subtle p-6 transition-all duration-500 hover:border-accent-indigo hover:shadow-xl animate-fade-up cursor-pointer"
      style={{ animationDelay: `${index * 0.1}s` }}
      onClick={onClick}
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10 text-left">
        <div className="flex items-center gap-5">
          <div className={cn("w-16 h-16 rounded-3xl flex items-center justify-center text-2xl shadow-inner border border-border-subtle", platform?.bgColor || 'bg-bg-elevated')}>
            {platform?.icon || <Video size={24} className="text-accent-indigo" />}
          </div>
          <div className="space-y-1">
            <h3
              className="text-lg font-black text-text-primary group-hover:text-accent-indigo transition-colors"
              style={{ color: 'rgb(var(--text-primary, 255 255 255))' }}
            >
              {task.title}
            </h3>
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
              <span
                className="inline-flex items-center rounded-md px-2 py-0.5 bg-bg-elevated border border-border-subtle"
                style={{ color: 'rgb(var(--text-primary, 255 255 255))' }}
              >
                项目：{task.projectName}
              </span>
              {task.brandName && (
                <span
                  className="inline-flex items-center rounded-md px-2 py-0.5 bg-bg-elevated border border-border-subtle"
                  style={{ color: 'rgb(var(--text-primary, 255 255 255))' }}
                >
                  品牌：{task.brandName}
                </span>
              )}
              <span
                className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 bg-bg-elevated border border-border-subtle"
                style={{ color: 'rgb(var(--text-secondary, 203 213 225))' }}
              >
                <Calendar size={12} /> 更新 {task.updatedAtText}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-8">
          <div className="space-y-2">
            <div className="text-[10px] font-black text-text-tertiary uppercase tracking-widest">脚本进度</div>
            <CompactProgress stage={task.scriptStage} />
          </div>
          <div className="space-y-2">
            <div className="text-[10px] font-black text-text-tertiary uppercase tracking-widest">视频进度</div>
            <CompactProgress stage={task.videoStage} />
          </div>
          <button className={cn(
            "px-6 py-3 rounded-2xl text-sm font-black transition-all active:scale-95 flex items-center gap-2",
            task.buttonType === 'upload' ? 'bg-accent-indigo text-white shadow-indigo' : 'bg-bg-elevated border border-border-subtle text-text-primary hover:bg-bg-page'
          )}>
            {task.buttonText}
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}

export default function CreatorTasksPage() {
  const router = useRouter()
  const [tasks, setTasks] = useState<Task[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const loadData = useCallback(async () => {
    setIsLoading(true)
    try {
      const response = await api.listTasks(1, 50)
      setTasks(
        response.items
          .map(mapApiTaskToCreatorTask)
          .filter((t) => Boolean(t.id))
      )
    } catch (err) { console.error(err) }
    finally { setIsLoading(false) }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  return (
    <ResponsiveLayout role="creator">
      <div className="max-w-[1200px] mx-auto space-y-10 pb-20">
        
        {/* Welcome Header - 彻底修复白天模式不可见问题 */}
        <div className="relative p-10 rounded-[32px] overflow-hidden bg-bg-card border border-border-subtle shadow-xl text-left">
          <div className="absolute -right-10 -bottom-10 w-64 h-64 bg-accent-indigo/[0.05] rounded-full blur-[80px]" />
          <div className="relative z-10 space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent-green/10 border border-accent-green/20 text-accent-green text-[10px] font-black uppercase tracking-widest mb-2">
              <Sparkles size={12} /> 达人创作中心
            </div>
            <h1 className="text-4xl font-black text-text-primary tracking-tighter">创作工作台</h1>
            <p className="text-text-secondary font-medium text-lg italic">让每一帧灵感，都在合规中焕发价值。</p>
          </div>
        </div>

        {/* Task List */}
        <div className="space-y-6">
          <div className="flex items-center justify-between px-2">
            <h2 className="text-xl font-bold text-text-primary tracking-tight">进行中任务 ({tasks.length})</h2>
            <div className="text-xs font-black text-accent-indigo uppercase tracking-widest">
              按时间排序
            </div>
          </div>

          <div className="space-y-4">
            {isLoading ? (
              [1,2,3].map(i => <div key={i} className="h-24 rounded-[28px] bg-bg-card border border-border-subtle animate-pulse" />)
            ) : (
              tasks.map((t, idx) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  index={idx}
                  onClick={() => { if (t.id) router.push(`/creator/task/${encodeURIComponent(t.id)}`) }}
                />
              ))
            )}
          </div>
        </div>

      </div>
    </ResponsiveLayout>
  )
}
