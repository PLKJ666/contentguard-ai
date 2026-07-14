'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { SuccessTag, PendingTag, ErrorTag } from '@/components/ui/Tag'
import { useToast } from '@/components/ui/Toast'
import {
  ArrowLeft,
  Calendar,
  Users,
  FileText,

  Clock,
  CheckCircle,
  XCircle,
  ChevronRight,
  Plus,
  Settings,
  Search,
  Building2,
  MoreHorizontal,
  Trash2,
  Check,
  Pencil,
  Loader2
} from 'lucide-react'
import { getPlatformInfo } from '@/lib/platforms'
import { mapTaskToUI } from '@/lib/taskStageMapper'
import { api } from '@/lib/api'
import { formatTaskDisplayName } from '@/lib/taskDisplay'
import { useSSE } from '@/contexts/SSEContext'
import type { ProjectResponse } from '@/types/project'
import type { TaskResponse } from '@/types/task'
import type { AgencyDetail } from '@/types/organization'

// ==================== 组件 ====================

function StatCard({ title, value, icon: Icon, color }: { title: string; value: number | string; icon: React.ElementType; color: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-text-secondary">{title}</p>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
          </div>
          <div className={`w-10 h-10 rounded-lg ${color.replace('text-', 'bg-')}/20 flex items-center justify-center`}>
            <Icon size={20} className={color} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function TaskStatusTag({ task }: { task: TaskResponse }) {
  if (task.stage === 'completed') return <SuccessTag>已通过</SuccessTag>
  if (task.stage === 'rejected') return <ErrorTag>已驳回</ErrorTag>
  // 驳回回退到上传阶段
  if (task.stage === 'script_upload' || task.stage === 'video_upload') {
    const isRejected = task.script_agency_status === 'rejected' || task.script_brand_status === 'rejected' ||
      task.video_agency_status === 'rejected' || task.video_brand_status === 'rejected'
    if (isRejected) return <ErrorTag>已驳回</ErrorTag>
  }
  if (task.stage.includes('review')) return <PendingTag>审核中</PendingTag>
  return <PendingTag>进行中</PendingTag>
}

function DetailSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 bg-bg-elevated rounded-full" />
        <div className="space-y-2">
          <div className="h-7 w-48 bg-bg-elevated rounded" />
          <div className="h-4 w-64 bg-bg-elevated rounded" />
        </div>
      </div>
      <div className="h-20 bg-bg-elevated rounded-xl" />
      <div className="grid grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(i => <div key={i} className="h-20 bg-bg-elevated rounded-xl" />)}
      </div>
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 h-48 bg-bg-elevated rounded-xl" />
        <div className="h-48 bg-bg-elevated rounded-xl" />
      </div>
    </div>
  )
}

// ==================== 任务进度条 ====================

const SCRIPT_STEPS = [
  { key: 'script_upload', label: '上传' },
  { key: 'script_ai_review', label: 'AI' },
  { key: 'script_agency_review', label: '代理商' },
  { key: 'script_brand_review', label: '品牌' },
]

const VIDEO_STEPS = [
  { key: 'video_upload', label: '上传' },
  { key: 'video_ai_review', label: 'AI' },
  { key: 'video_agency_review', label: '代理商' },
  { key: 'video_brand_review', label: '品牌' },
]

function StepDot({ status }: { status: 'done' | 'current' | 'error' | 'pending' }) {
  const base = 'w-3 h-3 rounded-full border-2 flex-shrink-0'
  if (status === 'done') return <div className={`${base} bg-accent-green border-accent-green`} />
  if (status === 'current') return <div className={`${base} bg-accent-indigo border-accent-indigo animate-pulse`} />
  if (status === 'error') return <div className={`${base} bg-accent-coral border-accent-coral`} />
  return <div className={`${base} bg-transparent border-border-strong`} />
}

function StepLine({ status }: { status: 'done' | 'pending' | 'error' }) {
  if (status === 'done') return <div className="w-4 h-0.5 bg-accent-green mx-0.5" />
  if (status === 'error') return <div className="w-4 h-0.5 bg-accent-coral mx-0.5" />
  return <div className="w-4 h-0.5 bg-border-strong mx-0.5" />
}

function TaskProgressBar({ task }: { task: TaskResponse }) {
  const ui = mapTaskToUI(task)

  const scriptStatuses: Array<'done' | 'current' | 'error' | 'pending'> = [
    ui.scriptStage.submit, ui.scriptStage.ai, ui.scriptStage.agency, ui.scriptStage.brand,
  ]
  const videoStatuses: Array<'done' | 'current' | 'error' | 'pending'> = [
    ui.videoStage.submit, ui.videoStage.ai, ui.videoStage.agency, ui.videoStage.brand,
  ]

  const isCompleted = task.stage === 'completed'
  const isRejected = task.stage === 'rejected'

  return (
    <div className="flex items-center gap-1">
      {/* 脚本阶段 */}
      <div className="flex items-center gap-0">
        <span className="text-[10px] text-text-tertiary mr-1.5 w-6">脚本</span>
        {SCRIPT_STEPS.map((step, i) => (
          <div key={step.key} className="flex items-center">
            <div className="relative group">
              <StepDot status={scriptStatuses[i]} />
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 bg-bg-card border border-border-subtle rounded text-[10px] text-text-secondary whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10">
                {step.label}
              </div>
            </div>
            {i < SCRIPT_STEPS.length - 1 && (
              <StepLine status={scriptStatuses[i] === 'done' ? 'done' : scriptStatuses[i] === 'error' ? 'error' : 'pending'} />
            )}
          </div>
        ))}
      </div>

      {/* 分隔线 */}
      <div className="w-3 h-0.5 bg-border-subtle mx-0.5" />

      {/* 视频阶段 */}
      <div className="flex items-center gap-0">
        <span className="text-[10px] text-text-tertiary mr-1.5 w-6">视频</span>
        {VIDEO_STEPS.map((step, i) => (
          <div key={step.key} className="flex items-center">
            <div className="relative group">
              <StepDot status={videoStatuses[i]} />
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 bg-bg-card border border-border-subtle rounded text-[10px] text-text-secondary whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10">
                {step.label}
              </div>
            </div>
            {i < VIDEO_STEPS.length - 1 && (
              <StepLine status={videoStatuses[i] === 'done' ? 'done' : videoStatuses[i] === 'error' ? 'error' : 'pending'} />
            )}
          </div>
        ))}
      </div>

      {/* 完成标记 */}
      <div className="ml-1.5">
        {isCompleted ? (
          <CheckCircle size={14} className="text-accent-green" />
        ) : isRejected ? (
          <XCircle size={14} className="text-accent-coral" />
        ) : (
          <div className="w-3.5 h-3.5" />
        )}
      </div>
    </div>
  )
}

interface TaskGroup {
  agencyId: string
  agencyName: string
  creators: {
    creatorId?: string
    creatorName: string
    tasks: TaskResponse[]
  }[]
}

function groupTasksByAgencyCreator(tasks: TaskResponse[]): TaskGroup[] {
  const agencyMap = new Map<string, TaskGroup>()

  for (const task of tasks) {
    if (!agencyMap.has(task.agency.id)) {
      agencyMap.set(task.agency.id, {
        agencyId: task.agency.id,
        agencyName: task.agency.name,
        creators: [],
      })
    }
    const group = agencyMap.get(task.agency.id)!
    const creatorKey = task.creator.id || `display:${task.creator.name}`
    let creator = group.creators.find(c => c.creatorId === creatorKey)
    if (!creator) {
      creator = { creatorId: creatorKey, creatorName: task.creator.name, tasks: [] }
      group.creators.push(creator)
    }
    creator.tasks.push(task)
  }

  return Array.from(agencyMap.values())
}

export default function ProjectDetailPage() {
  const router = useRouter()
  const params = useParams()
  const toast = useToast()
  const projectId = params.id as string
  const { subscribe } = useSSE()

  const [project, setProject] = useState<ProjectResponse | null>(null)
  const [allTasks, setAllTasks] = useState<TaskResponse[]>([])
  const [managedAgencies, setManagedAgencies] = useState<AgencyDetail[]>([])
  const [loading, setLoading] = useState(true)

  // UI states
  const [showAddModal, setShowAddModal] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedAgencies, setSelectedAgencies] = useState<string[]>([])
  const [activeAgencyMenu, setActiveAgencyMenu] = useState<string | null>(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [agencyToDelete, setAgencyToDelete] = useState<{ id: string; name: string } | null>(null)
  const [showDeadlineModal, setShowDeadlineModal] = useState(false)
  const [newDeadline, setNewDeadline] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const loadData = useCallback(async () => {
    try {
      const [projectData, tasksData, agenciesData] = await Promise.all([
        api.getProject(projectId),
        api.listTasks(1, 100, undefined, projectId),
        api.listBrandAgencies(),
      ])
      setProject(projectData)
      setAllTasks(tasksData.items)
      setManagedAgencies(agenciesData.items)
    } catch (err) {
      console.error('Failed to load project:', err)
      toast.error('加载项目详情失败')
    } finally {
      setLoading(false)
    }
  }, [projectId, toast])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    const unsub = subscribe('task_updated', () => loadData())
    return unsub
  }, [subscribe, loadData])

  if (loading || !project) return <DetailSkeleton />

  const availableAgencies = managedAgencies.filter(
    agency => !project.agencies.some(a => a.id === agency.id)
  )

  const filteredAgencies = availableAgencies.filter(agency =>
    searchQuery === '' ||
    agency.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    agency.id.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const toggleSelectAgency = (agencyId: string) => {
    setSelectedAgencies(prev =>
      prev.includes(agencyId) ? prev.filter(id => id !== agencyId) : [...prev, agencyId]
    )
  }

  const handleAddAgencies = async () => {
    setSubmitting(true)
    try {
      await api.assignAgencies(projectId, selectedAgencies)
      const newAgencies = managedAgencies
        .filter(a => selectedAgencies.includes(a.id))
        .map(a => ({ id: a.id, name: a.name }))
      setProject({ ...project, agencies: [...project.agencies, ...newAgencies] })
      toast.success('代理商已添加')
    } catch (err) {
      console.error('Failed to add agencies:', err)
      toast.error('添加失败')
    } finally {
      setSubmitting(false)
      setShowAddModal(false)
      setSelectedAgencies([])
      setSearchQuery('')
    }
  }

  const handleRemoveAgency = async () => {
    if (!agencyToDelete) return
    setSubmitting(true)
    try {
      await api.removeAgencyFromProject(projectId, agencyToDelete.id)
      setProject({ ...project, agencies: project.agencies.filter(a => a.id !== agencyToDelete.id) })
      toast.success('代理商已移除')
    } catch (err) {
      console.error('Failed to remove agency:', err)
      toast.error('移除失败')
    } finally {
      setSubmitting(false)
      setShowDeleteModal(false)
      setAgencyToDelete(null)
    }
  }

  const handleSaveDeadline = async () => {
    if (!newDeadline) return
    setSubmitting(true)
    try {
      await api.updateProject(projectId, { deadline: newDeadline })
      setProject({ ...project, deadline: newDeadline })
      toast.success('截止日期已更新')
    } catch (err) {
      console.error('Failed to update deadline:', err)
      toast.error('更新失败')
    } finally {
      setSubmitting(false)
      setShowDeadlineModal(false)
    }
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
            <h1 className="text-2xl font-bold text-text-primary">{project.name}</h1>
          </div>
          {project.description && (
            <p className="text-sm text-text-secondary">{project.description}</p>
          )}
        </div>
        <SuccessTag>{project.status === 'active' ? '进行中' : project.status === 'completed' ? '已完成' : '已归档'}</SuccessTag>
      </div>

      {/* 项目信息 */}
      <div className="flex items-center gap-6 text-sm text-text-secondary">
        <span className="flex items-center gap-2">
          <Calendar size={16} />
          截止日期: {project.deadline ? new Date(project.deadline).toLocaleDateString('zh-CN') : '未设置'}
          <button
            type="button"
            onClick={() => { setNewDeadline(project.deadline || ''); setShowDeadlineModal(true) }}
            className="p-1 rounded hover:bg-bg-elevated transition-colors"
          >
            <Pencil size={14} className="text-text-tertiary hover:text-accent-indigo" />
          </button>
        </span>
        <span className="flex items-center gap-2">
          <Clock size={16} />
          创建时间: {new Date(project.created_at).toLocaleDateString('zh-CN')}
        </span>
      </div>

      {/* Brief和规则配置 */}
      <Link href={`/brand/projects/${projectId}/config`}>
        <Card className="hover:border-accent-indigo transition-colors cursor-pointer">
          <CardContent className="py-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-accent-indigo/15 flex items-center justify-center">
                  <Settings size={24} className="text-accent-indigo" />
                </div>
                <div>
                  <p className="font-semibold text-text-primary">Brief和规则配置</p>
                  <p className="text-sm text-text-secondary">配置项目Brief、审核规则、AI检测项等</p>
                </div>
              </div>
              <ChevronRight size={20} className="text-text-tertiary" />
            </div>
          </CardContent>
        </Card>
      </Link>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard title="总任务数" value={project.task_count} icon={FileText} color="text-accent-green" />
        <StatCard title="参与代理商" value={project.agencies.length} icon={Users} color="text-purple-400" />
        <StatCard title="状态" value={project.status === 'active' ? '进行中' : '已完成'} icon={CheckCircle} color="text-accent-indigo" />
        <StatCard title="最近更新" value={new Date(project.updated_at).toLocaleDateString('zh-CN')} icon={Clock} color="text-orange-400" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 任务进度 */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>任务进度</span>
              <Link href="/brand/review">
                <Button variant="ghost" size="sm">
                  审核列表 <ChevronRight size={16} />
                </Button>
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {allTasks.length > 0 ? (
              <div className="space-y-4">
                {/* 图例 */}
                <div className="flex items-center gap-4 text-[10px] text-text-tertiary pb-2 border-b border-border-subtle">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-accent-green inline-block" /> 已完成</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-accent-indigo inline-block" /> 进行中</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full border border-border-strong inline-block" /> 待处理</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-accent-coral inline-block" /> 已驳回</span>
                </div>

                {groupTasksByAgencyCreator(allTasks).map((group) => (
                  <div key={group.agencyId} className="space-y-2">
                    {/* 代理商标题 */}
                    <div className="flex items-center gap-2">
                      <Building2 size={14} className="text-accent-indigo" />
                      <span className="text-sm font-medium text-text-primary">{group.agencyName}</span>
                      <span className="text-xs text-text-tertiary">
                        ({group.creators.reduce((sum, c) => sum + c.tasks.length, 0)} 个任务)
                      </span>
                    </div>

                    {/* 达人列表 */}
                    <div className="ml-4 space-y-1">
                      {group.creators.map((creator) => (
                        <div key={creator.creatorId} className="space-y-1">
                          {/* 达人名称 */}
                          <div className="flex items-center gap-1.5">
                            <div className="w-5 h-5 rounded-full bg-accent-green/15 flex items-center justify-center">
                              <Users size={10} className="text-accent-green" />
                            </div>
                            <span className="text-xs font-medium text-text-secondary">{creator.creatorName}</span>
                          </div>

                          {/* 任务进度条 */}
                          <div className="ml-6 space-y-1.5">
                            {creator.tasks.map((task) => (
                              <div key={task.id} className="flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-bg-elevated group/task">
                                <span className="text-xs text-text-primary min-w-[80px] truncate font-medium">
                                  {formatTaskDisplayName({
                                    taskName: task.name,
                                    projectName: task.project?.name,
                                    sequence: task.sequence,
                                  })}
                                </span>
                                <TaskProgressBar task={task} />
                                <span className="text-[10px] text-text-tertiary ml-auto hidden group-hover/task:block">
                                  <TaskStatusTag task={task} />
                                </span>
                                <Link href={task.stage.includes('video') ? `/brand/review/video/${task.id}` : `/brand/review/script/${task.id}`}>
                                  <button type="button" className="text-xs text-accent-indigo hover:text-accent-indigo/80 opacity-0 group-hover/task:opacity-100 transition-opacity">
                                    {task.stage.includes('brand_review') ? '审核' : '查看'}
                                  </button>
                                </Link>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-text-tertiary text-sm">暂无任务</div>
            )}
          </CardContent>
        </Card>

        {/* 代理商列表 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users size={16} />
              参与代理商
              <span className="text-sm font-normal text-text-tertiary">({project.agencies.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {project.agencies.map((agency) => (
              <div key={agency.id} className="flex items-center justify-between p-3 rounded-lg bg-bg-elevated">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-accent-indigo/15 flex items-center justify-center">
                    <Building2 size={18} className="text-accent-indigo" />
                  </div>
                  <div>
                    <p className="font-medium text-text-primary text-sm">{agency.name}</p>
                    <p className="text-xs text-text-tertiary">{agency.id}</p>
                  </div>
                </div>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setActiveAgencyMenu(activeAgencyMenu === agency.id ? null : agency.id)}
                    className="p-1.5 rounded hover:bg-bg-page transition-colors"
                  >
                    <MoreHorizontal size={16} className="text-text-tertiary" />
                  </button>
                  {activeAgencyMenu === agency.id && (
                    <div className="absolute right-0 top-8 z-10 w-32 py-1 bg-bg-card rounded-lg shadow-lg border border-border-subtle">
                      <button
                        type="button"
                        onClick={() => {
                          setAgencyToDelete(agency)
                          setShowDeleteModal(true)
                          setActiveAgencyMenu(null)
                        }}
                        className="w-full px-3 py-2 text-left text-sm text-accent-coral hover:bg-bg-elevated flex items-center gap-2"
                      >
                        <Trash2 size={14} />
                        移除
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="w-full p-3 rounded-lg border-2 border-dashed border-border-subtle hover:border-accent-indigo hover:bg-accent-indigo/5 transition-all flex items-center justify-center gap-2 text-text-tertiary hover:text-accent-indigo"
            >
              <Plus size={18} />
              <span className="text-sm font-medium">添加代理商</span>
            </button>
          </CardContent>
        </Card>
      </div>

      {/* 添加代理商弹窗 */}
      <Modal
        isOpen={showAddModal}
        onClose={() => { setShowAddModal(false); setSearchQuery(''); setSelectedAgencies([]) }}
        title="添加代理商"
        size="lg"
      >
        <div className="space-y-4">
          <div className="relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索代理商名称或ID..."
              className="pl-10"
            />
          </div>

          <div className="max-h-80 overflow-y-auto space-y-2">
            {filteredAgencies.length > 0 ? (
              filteredAgencies.map((agency) => {
                const isSelected = selectedAgencies.includes(agency.id)
                return (
                  <button
                    key={agency.id}
                    type="button"
                    onClick={() => toggleSelectAgency(agency.id)}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left ${
                      isSelected ? 'border-accent-indigo bg-accent-indigo/5' : 'border-transparent bg-bg-elevated hover:bg-bg-page'
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      isSelected ? 'bg-accent-indigo' : 'bg-accent-indigo/15'
                    }`}>
                      {isSelected ? <Check size={20} className="text-white" /> : <Building2 size={20} className="text-accent-indigo" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-text-primary">{agency.name}</p>
                        <span className="text-xs text-text-tertiary font-mono">{agency.id}</span>
                      </div>
                      {agency.contact_name && (
                        <p className="text-sm text-text-secondary truncate">{agency.contact_name}</p>
                      )}
                    </div>
                  </button>
                )
              })
            ) : (
              <div className="text-center py-8 text-text-tertiary">
                {availableAgencies.length === 0 ? (
                  <><Users size={32} className="mx-auto mb-2 opacity-50" /><p>所有代理商都已添加到此项目</p></>
                ) : (
                  <><Search size={32} className="mx-auto mb-2 opacity-50" /><p>未找到匹配的代理商</p></>
                )}
              </div>
            )}
          </div>

          {selectedAgencies.length > 0 && (
            <div className="flex items-center justify-between pt-3 border-t border-border-subtle">
              <span className="text-sm text-text-secondary">
                已选择 <span className="text-accent-indigo font-medium">{selectedAgencies.length}</span> 个代理商
              </span>
              <Button variant="primary" onClick={handleAddAgencies} disabled={submitting}>
                {submitting && <Loader2 size={16} className="animate-spin" />}
                确认添加
              </Button>
            </div>
          )}
        </div>
      </Modal>

      {/* 删除确认弹窗 */}
      <Modal isOpen={showDeleteModal} onClose={() => { setShowDeleteModal(false); setAgencyToDelete(null) }} title="移除代理商">
        <div className="space-y-4">
          <p className="text-text-secondary">
            确定要将 <span className="text-text-primary font-medium">{agencyToDelete?.name}</span> 从此项目中移除吗？
          </p>
          <p className="text-sm text-accent-coral">移除后，该代理商下的达人将无法继续参与此项目的任务。</p>
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => { setShowDeleteModal(false); setAgencyToDelete(null) }}>取消</Button>
            <Button variant="primary" className="flex-1 bg-accent-coral hover:bg-accent-coral/80" onClick={handleRemoveAgency} disabled={submitting}>
              {submitting && <Loader2 size={16} className="animate-spin" />}
              确认移除
            </Button>
          </div>
        </div>
      </Modal>

      {/* 编辑截止日期弹窗 */}
      <Modal isOpen={showDeadlineModal} onClose={() => setShowDeadlineModal(false)} title="修改截止日期">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">新截止日期</label>
            <div className="relative">
              <Calendar size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary" />
              <input
                type="date"
                value={newDeadline}
                onChange={(e) => setNewDeadline(e.target.value)}
                className="w-full pl-12 pr-4 py-3 border border-border-subtle rounded-lg bg-bg-elevated text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-indigo"
              />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <Button variant="secondary" className="flex-1" onClick={() => setShowDeadlineModal(false)}>取消</Button>
            <Button variant="primary" className="flex-1" onClick={handleSaveDeadline} disabled={!newDeadline || submitting}>
              {submitting && <Loader2 size={16} className="animate-spin" />}
              保存
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
