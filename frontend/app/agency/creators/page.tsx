'use client'

import { useState, useEffect, useCallback } from 'react'
import { useToast } from '@/components/ui/Toast'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { SuccessTag, PendingTag, WarningTag } from '@/components/ui/Tag'
import { formatTaskDisplayName } from '@/lib/taskDisplay'
import {
  Search,
  Plus,
  Users,
  TrendingUp,
  TrendingDown,
  Copy,
  CheckCircle,
  Clock,
  MoreVertical,
  FileText,
  Video,
  ChevronDown,
  ChevronRight,
  PlusCircle,
  UserPlus,
  AlertCircle,
  MessageSquareText,
  Trash2,
  FolderPlus,
  X,
  Loader2
} from 'lucide-react'
import { getPlatformInfo } from '@/lib/platforms'
import { copyToClipboard } from '@/lib/utils'
import { api, extractErrorMessage } from '@/lib/api'
import type { CreatorDetail } from '@/types/organization'
import type { TaskResponse } from '@/types/task'

// 任务进度阶段
type TaskStage = 'script_pending' | 'script_ai_review' | 'script_agency_review' | 'script_brand_review' |
  'script_rejected' | 'video_pending' | 'video_ai_review' | 'video_agency_review' | 'video_brand_review' |
  'video_rejected' | 'completed'

// 任务阶段配置
const stageConfig: Record<TaskStage, { label: string; color: string; bgColor: string }> = {
  script_pending: { label: '待提交脚本', color: 'text-text-tertiary', bgColor: 'bg-bg-elevated' },
  script_ai_review: { label: '脚本AI审核中', color: 'text-accent-indigo', bgColor: 'bg-accent-indigo/15' },
  script_agency_review: { label: '脚本代理商审核', color: 'text-purple-400', bgColor: 'bg-purple-500/15' },
  script_brand_review: { label: '脚本品牌方终审', color: 'text-accent-blue', bgColor: 'bg-accent-blue/15' },
  script_rejected: { label: '脚本已驳回', color: 'text-accent-coral', bgColor: 'bg-accent-coral/15' },
  video_pending: { label: '待提交视频', color: 'text-accent-amber', bgColor: 'bg-accent-amber/15' },
  video_ai_review: { label: '视频AI审核中', color: 'text-accent-indigo', bgColor: 'bg-accent-indigo/15' },
  video_agency_review: { label: '视频代理商审核', color: 'text-purple-400', bgColor: 'bg-purple-500/15' },
  video_brand_review: { label: '视频品牌方终审', color: 'text-accent-blue', bgColor: 'bg-accent-blue/15' },
  video_rejected: { label: '视频已驳回', color: 'text-accent-coral', bgColor: 'bg-accent-coral/15' },
  completed: { label: '已完成', color: 'text-accent-green', bgColor: 'bg-accent-green/15' },
}

// 后端 TaskStage 到本地 TaskStage 的映射
function mapBackendStage(backendStage: string, task?: TaskResponse): TaskStage {
  // 处理驳回回退到上传阶段的情况
  if (backendStage === 'script_upload' && task) {
    if (task.script_agency_status === 'rejected' || task.script_brand_status === 'rejected') {
      return 'script_rejected'
    }
  }
  if (backendStage === 'video_upload' && task) {
    if (task.video_agency_status === 'rejected' || task.video_brand_status === 'rejected') {
      return 'video_rejected'
    }
  }
  // 最终驳回：根据驳回位置区分脚本/视频
  if (backendStage === 'rejected' && task) {
    if (task.video_brand_status === 'rejected' || task.video_agency_status === 'rejected') {
      return 'video_rejected'
    }
    return 'script_rejected'
  }

  const mapping: Record<string, TaskStage> = {
    'script_upload': 'script_pending',
    'script_ai_review': 'script_ai_review',
    'script_agency_review': 'script_agency_review',
    'script_brand_review': 'script_brand_review',
    'video_upload': 'video_pending',
    'video_ai_review': 'video_ai_review',
    'video_agency_review': 'video_agency_review',
    'video_brand_review': 'video_brand_review',
    'completed': 'completed',
    'rejected': 'script_rejected',
  }
  return mapping[backendStage] || 'script_pending'
}

// 任务类型
interface CreatorTask {
  id: string
  name: string
  projectName: string
  platform: string
  stage: TaskStage
  appealRemaining: number
  appealUsed: number
}

// 达人类型
interface Creator {
  id: string
  creatorId: string // 达人ID（用于邀请和显示）
  name: string
  avatar: string
  status: 'active' | 'pending' | 'paused'
  projectCount: number
  scriptCount: { total: number; passed: number }
  videoCount: { total: number; passed: number }
  passRate: number
  trend: 'up' | 'down' | 'stable'
  joinedAt: string
  tasks: CreatorTask[]
  remark?: string // 备注
}

function StatusTag({ status }: { status: string }) {
  if (status === 'active') return <SuccessTag>已激活</SuccessTag>
  if (status === 'pending') return <PendingTag>待接受</PendingTag>
  return <WarningTag>已暂停</WarningTag>
}

function StageTag({ stage }: { stage: TaskStage }) {
  const config = stageConfig[stage]
  return (
    <span className={`px-2 py-1 rounded-md text-xs font-medium ${config.bgColor} ${config.color}`}>
      {config.label}
    </span>
  )
}

export default function AgencyCreatorsPage() {
  const toast = useToast()
  const [searchQuery, setSearchQuery] = useState('')
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteCreatorId, setInviteCreatorId] = useState('')
  const [inviteResult, setInviteResult] = useState<{ success: boolean; message: string } | null>(null)
  const [expandedCreators, setExpandedCreators] = useState<string[]>([])
  const [creators, setCreators] = useState<Creator[]>([])
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // 加载状态
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // 项目列表（API 模式用于分配弹窗）
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([])

  // 任务数据（API 模式按达人ID分组）
  const [creatorTasksMap, setCreatorTasksMap] = useState<Record<string, CreatorTask[]>>({})

  // 操作菜单状态
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)

  // 备注弹窗状态
  const [remarkModal, setRemarkModal] = useState<{ open: boolean; creator: Creator | null }>({ open: false, creator: null })
  const [remarkText, setRemarkText] = useState('')

  // 删除确认弹窗状态
  const [deleteModal, setDeleteModal] = useState<{ open: boolean; creator: Creator | null }>({ open: false, creator: null })

  // 分配项目弹窗状态
  const [assignModal, setAssignModal] = useState<{ open: boolean; creator: Creator | null }>({ open: false, creator: null })
  const [selectedProject, setSelectedProject] = useState('')

  // API 模式下将 CreatorDetail 转换为 Creator 类型
  const mapCreatorDetailToCreator = useCallback((detail: CreatorDetail, tasks: CreatorTask[]): Creator => {
    return {
      id: detail.id,
      creatorId: detail.id,
      name: detail.name,
      avatar: detail.avatar || detail.name.charAt(0),
      status: 'active',
      projectCount: 0,
      scriptCount: { total: 0, passed: 0 },
      videoCount: { total: 0, passed: 0 },
      passRate: 0,
      trend: 'stable',
      joinedAt: '-',
      tasks,
    }
  }, [])

  // 将后端 TaskResponse 转为本地 CreatorTask
  const mapTaskResponseToCreatorTask = useCallback((task: TaskResponse): CreatorTask => {
    return {
      id: task.id,
      name: formatTaskDisplayName({
        taskName: task.name,
        projectName: task.project?.name,
        sequence: task.sequence,
      }),
      projectName: task.project?.name || '-',
      platform: task.project?.platform || 'douyin',
      stage: mapBackendStage(task.stage, task),
      appealRemaining: task.appeal_count,
      appealUsed: task.is_appeal ? 1 : 0,
    }
  }, [])

  // 加载数据（API 模式）
  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      // 并行加载达人列表、任务列表、项目列表
      const [creatorsRes, tasksRes, projectsRes] = await Promise.all([
        api.listAgencyCreators(),
        api.listTasks(1, 100),
        api.listProjects(1, 100),
      ])

      // 构建项目列表
      setProjects(projectsRes.items.map(p => ({ id: p.id, name: p.name })))

      // 按达人ID分组任务
      const tasksMap: Record<string, CreatorTask[]> = {}
      for (const task of tasksRes.items) {
        const cid = task.creator?.id
        if (cid) {
          if (!tasksMap[cid]) tasksMap[cid] = []
          tasksMap[cid].push(mapTaskResponseToCreatorTask(task))
        }
      }
      setCreatorTasksMap(tasksMap)

      // 构建达人列表
      const mappedCreators = creatorsRes.items.map(detail =>
        mapCreatorDetailToCreator(detail, tasksMap[detail.id] || [])
      )
      setCreators(mappedCreators)
    } catch (err) {
      const message = extractErrorMessage(err)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [mapCreatorDetailToCreator, mapTaskResponseToCreatorTask, toast])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const filteredCreators = creators.filter(creator =>
    creator.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    creator.creatorId.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // 统计数据
  const totalCreators = creators.length
  const activeCreators = creators.length

  // 切换展开状态
  const toggleExpand = (creatorId: string) => {
    setExpandedCreators(prev =>
      prev.includes(creatorId)
        ? prev.filter(id => id !== creatorId)
        : [...prev, creatorId]
    )
  }

  // 复制达人ID
  const handleCopyCreatorId = async (creatorId: string) => {
    await copyToClipboard(creatorId)
    setCopiedId(creatorId)
    setTimeout(() => setCopiedId(null), 2000)
  }

  // 增加申诉次数
  const handleAddAppealQuota = async (creatorId: string, taskId: string) => {
    setSubmitting(true)
    try {
      await api.increaseAppealCount(taskId)
      // 更新本地状态
      setCreators(prev => prev.map(creator => {
        if (creator.id === creatorId) {
          return {
            ...creator,
            tasks: creator.tasks.map(task => {
              if (task.id === taskId) {
                return { ...task, appealRemaining: task.appealRemaining + 1 }
              }
              return task
            }),
          }
        }
        return creator
      }))
      toast.success('已增加 1 次申诉机会')
    } catch (err) {
      const message = extractErrorMessage(err)
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  // 邀请达人
  const handleInvite = async () => {
    if (!inviteCreatorId.trim()) {
      setInviteResult({ success: false, message: '请输入达人ID' })
      return
    }

    // API 模式
    setSubmitting(true)
    try {
      await api.inviteCreator(inviteCreatorId.trim())
      setInviteResult({ success: true, message: `已向达人 ${inviteCreatorId.trim()} 发送邀请，等待对方在消息中心确认` })
      toast.success('邀请已发送')
    } catch (err) {
      const message = extractErrorMessage(err)
      setInviteResult({ success: false, message })
    } finally {
      setSubmitting(false)
    }
  }

  const handleCloseInviteModal = () => {
    setShowInviteModal(false)
    setInviteCreatorId('')
    setInviteResult(null)
  }

  // 打开备注弹窗
  const handleOpenRemark = (creator: Creator) => {
    setRemarkText(creator.remark || '')
    setRemarkModal({ open: true, creator })
    setOpenMenuId(null)
  }

  // 保存备注
  const handleSaveRemark = () => {
    if (remarkModal.creator) {
      setCreators(prev => prev.map(c =>
        c.id === remarkModal.creator!.id ? { ...c, remark: remarkText } : c
      ))
    }
    setRemarkModal({ open: false, creator: null })
    setRemarkText('')
  }

  // 打开删除确认
  const handleOpenDelete = (creator: Creator) => {
    setDeleteModal({ open: true, creator })
    setOpenMenuId(null)
  }

  // 确认删除
  const handleConfirmDelete = async () => {
    if (!deleteModal.creator) return

    // API 模式
    setSubmitting(true)
    try {
      await api.removeCreator(deleteModal.creator.id)
      setCreators(prev => prev.filter(c => c.id !== deleteModal.creator!.id))
      toast.success(`已移除达人「${deleteModal.creator.name}」`)
      setDeleteModal({ open: false, creator: null })
    } catch (err) {
      const message = extractErrorMessage(err)
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  // 打开分配项目弹窗
  const handleOpenAssign = (creator: Creator) => {
    setSelectedProject('')
    setAssignModal({ open: true, creator })
    setOpenMenuId(null)
  }

  // 确认分配项目（创建任务）
  const handleConfirmAssign = async () => {
    if (!assignModal.creator || !selectedProject) return

    const project = projects.find(p => p.id === selectedProject)

    setSubmitting(true)
    try {
      await api.createTask({
        project_id: selectedProject,
        creator_id: assignModal.creator.creatorId,
      })
      toast.success(`已将达人「${assignModal.creator.name}」分配到项目「${project?.name}」`)
      setAssignModal({ open: false, creator: null })
      setSelectedProject('')
      await fetchData() // 刷新列表
    } catch (err) {
      const message = extractErrorMessage(err)
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  // 骨架屏
  if (loading) {
    return (
      <div className="space-y-6 min-h-0">
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">达人管理</h1>
            <p className="text-sm text-text-secondary mt-1">管理合作达人，查看任务进度和申诉次数</p>
          </div>
          <Button disabled>
            <Plus size={16} />
            邀请达人
          </Button>
        </div>

        {/* 统计卡片骨架 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Card key={i}>
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-2">
                    <div className="h-4 w-16 bg-bg-elevated rounded animate-pulse" />
                    <div className="h-8 w-10 bg-bg-elevated rounded animate-pulse" />
                  </div>
                  <div className="w-10 h-10 rounded-lg bg-bg-elevated animate-pulse" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* 搜索骨架 */}
        <div className="h-11 w-full max-w-md bg-bg-elevated rounded-xl animate-pulse" />

        {/* 表格骨架 */}
        <Card>
          <CardContent className="p-0">
            <div className="flex items-center justify-center py-20">
              <Loader2 size={32} className="animate-spin text-accent-indigo" />
              <span className="ml-3 text-text-secondary">加载达人数据...</span>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  const projectList = projects

  return (
    <div className="space-y-6 min-h-0">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">达人管理</h1>
          <p className="text-sm text-text-secondary mt-1">管理合作达人，查看任务进度和申诉次数</p>
        </div>
        <Button onClick={() => setShowInviteModal(true)}>
          <Plus size={16} />
          邀请达人
        </Button>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-secondary">总达人数</p>
                <p className="text-2xl font-bold text-text-primary">{totalCreators}</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-accent-indigo/20 flex items-center justify-center">
                <Users size={20} className="text-accent-indigo" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-secondary">已激活</p>
                <p className="text-2xl font-bold text-accent-green">{activeCreators}</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-accent-green/20 flex items-center justify-center">
                <CheckCircle size={20} className="text-accent-green" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-secondary">总脚本数</p>
                <p className="text-2xl font-bold text-text-primary">-</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                <FileText size={20} className="text-purple-400" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-secondary">总视频数</p>
                <p className="text-2xl font-bold text-text-primary">-</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
                <Video size={20} className="text-orange-400" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 搜索 */}
      <div className="relative max-w-md">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
        <input
          type="text"
          placeholder="搜索达人名称或达人ID..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 border border-border-subtle rounded-xl bg-bg-elevated text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-indigo"
        />
      </div>

      {/* 达人列表 */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="border-b border-border-subtle text-left text-sm text-text-secondary bg-bg-elevated">
                <th className="px-6 py-4 font-medium">达人</th>
                <th className="px-6 py-4 font-medium">达人ID</th>
                <th className="px-6 py-4 font-medium">状态</th>
                <th className="px-6 py-4 font-medium">脚本</th>
                <th className="px-6 py-4 font-medium">视频</th>
                <th className="px-6 py-4 font-medium">通过率</th>
                <th className="px-6 py-4 font-medium">加入时间</th>
                <th className="px-6 py-4 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredCreators.map((creator) => {
                const isExpanded = expandedCreators.includes(creator.id)
                const hasActiveTasks = creator.tasks.length > 0

                return (
                  <>
                    <tr key={creator.id} className="border-b border-border-subtle hover:bg-bg-elevated/50">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          {/* 展开按钮 */}
                          {hasActiveTasks ? (
                            <button
                              type="button"
                              onClick={() => toggleExpand(creator.id)}
                              className="w-6 h-6 rounded flex items-center justify-center hover:bg-bg-elevated"
                            >
                              {isExpanded ? (
                                <ChevronDown size={16} className="text-text-secondary" />
                              ) : (
                                <ChevronRight size={16} className="text-text-secondary" />
                              )}
                            </button>
                          ) : (
                            <div className="w-6" />
                          )}
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-accent-indigo to-purple-500 flex items-center justify-center">
                            <span className="text-white font-medium">{creator.avatar}</span>
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-text-primary">{creator.name}</span>
                              {creator.remark && (
                                <span className="px-2 py-0.5 text-xs rounded bg-accent-amber/15 text-accent-amber" title={creator.remark}>
                                  有备注
                                </span>
                              )}
                            </div>
                            {creator.remark && (
                              <p className="text-xs text-text-tertiary mt-0.5 line-clamp-1">{creator.remark}</p>
                            )}
                            {hasActiveTasks && (
                              <button
                                type="button"
                                onClick={() => toggleExpand(creator.id)}
                                className="text-xs text-accent-indigo hover:underline flex items-center gap-1 mt-0.5"
                              >
                                {isExpanded ? (
                                  <>
                                    <ChevronDown size={12} />
                                    收起任务进度
                                  </>
                                ) : (
                                  <>
                                    <ChevronRight size={12} />
                                    查看 {creator.tasks.length} 个任务进度
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <code className="px-2 py-1 rounded bg-bg-elevated text-sm font-mono text-accent-indigo">
                            {creator.creatorId}
                          </code>
                          <button
                            type="button"
                            onClick={() => handleCopyCreatorId(creator.creatorId)}
                            className="p-1 rounded hover:bg-bg-elevated transition-colors"
                            title="复制达人ID"
                          >
                            {copiedId === creator.creatorId ? (
                              <CheckCircle size={14} className="text-accent-green" />
                            ) : (
                              <Copy size={14} className="text-text-tertiary" />
                            )}
                          </button>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <SuccessTag>已关联</SuccessTag>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-text-tertiary">-</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-text-tertiary">-</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-text-tertiary">-</span>
                      </td>
                      <td className="px-6 py-4 text-sm text-text-tertiary">{creator.joinedAt}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleOpenAssign(creator)}
                            className="px-3 py-1.5 text-xs font-medium text-accent-indigo bg-accent-indigo/10 hover:bg-accent-indigo/20 rounded-lg transition-colors flex items-center gap-1.5"
                          >
                            <FolderPlus size={13} />
                            分配项目
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenDelete(creator)}
                            className="p-1.5 text-text-tertiary hover:text-accent-coral hover:bg-accent-coral/10 rounded-lg transition-colors"
                            title="移除达人"
                          >
                            <Trash2 size={14} />
                          </button>
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() => setOpenMenuId(openMenuId === creator.id ? null : creator.id)}
                              className="p-1.5 text-text-tertiary hover:text-text-primary hover:bg-bg-elevated rounded-lg transition-colors"
                              title="更多操作"
                            >
                              <MoreVertical size={14} />
                            </button>
                            {openMenuId === creator.id && (
                              <div className="absolute right-0 top-full mt-1 w-36 bg-bg-card rounded-xl shadow-lg border border-border-subtle z-10 overflow-hidden">
                                <button
                                  type="button"
                                  onClick={() => handleOpenRemark(creator)}
                                  className="w-full px-4 py-2.5 text-left text-sm text-text-primary hover:bg-bg-elevated flex items-center gap-2"
                                >
                                  <MessageSquareText size={14} className="text-text-secondary" />
                                  {creator.remark ? '编辑备注' : '添加备注'}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                    {/* 展开的任务列表 */}
                    {isExpanded && hasActiveTasks && (
                      <tr key={`${creator.id}-tasks`} className="bg-bg-elevated/30">
                        <td colSpan={8} className="px-6 py-4">
                          <div className="ml-9 pl-6 border-l-2 border-accent-indigo/30">
                            <div className="text-sm font-medium text-text-secondary mb-3">进行中的任务</div>
                            <div className="space-y-2">
                              {creator.tasks.map(task => {
                                const taskPlatform = getPlatformInfo(task.platform)
                                return (
                                  <div key={task.id} className="bg-bg-card rounded-xl overflow-hidden">
                                    {/* 平台顶部条 */}
                                    {taskPlatform && (
                                      <div className={`px-4 py-1.5 ${taskPlatform.bgColor} border-b ${taskPlatform.borderColor} flex items-center gap-1.5`}>
                                        <span className="text-sm">{taskPlatform.icon}</span>
                                        <span className={`text-xs font-medium ${taskPlatform.textColor}`}>{taskPlatform.name}</span>
                                      </div>
                                    )}
                                    <div className="flex items-center justify-between p-4">
                                      <div className="flex items-center gap-4">
                                        <div>
                                          <div className="font-medium text-text-primary">{task.name}</div>
                                          <div className="text-xs text-text-tertiary mt-0.5">项目: {task.projectName}</div>
                                        </div>
                                        <StageTag stage={task.stage} />
                                      </div>
                                      <div className="flex items-center gap-4">
                                        <div className="flex items-center gap-3 text-sm">
                                          <span className="text-text-tertiary">申诉次数:</span>
                                          <span className="text-accent-indigo font-medium">{task.appealRemaining}</span>
                                          <span className="text-text-tertiary">/</span>
                                          <span className="text-text-tertiary">已用 {task.appealUsed}</span>
                                        </div>
                                        <Button
                                          variant="secondary"
                                          size="sm"
                                          disabled={submitting}
                                          onClick={() => handleAddAppealQuota(creator.id, task.id)}
                                        >
                                          {submitting ? (
                                            <Loader2 size={14} className="animate-spin" />
                                          ) : (
                                            <PlusCircle size={14} />
                                          )}
                                          +1 次
                                        </Button>
                                      </div>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>

          {filteredCreators.length === 0 && (
            <div className="text-center py-12 text-text-tertiary">
              <Users size={48} className="mx-auto mb-4 opacity-50" />
              <p>没有找到匹配的达人</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 邀请达人弹窗 */}
      <Modal isOpen={showInviteModal} onClose={handleCloseInviteModal} title="邀请达人">
        <div className="space-y-4">
          <p className="text-text-secondary text-sm">
            输入达人ID邀请合作。达人ID可在达人的个人中心查看。
          </p>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">达人ID</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={inviteCreatorId}
                onChange={(e) => {
                  setInviteCreatorId(e.target.value.toUpperCase())
                  setInviteResult(null)
                }}
                placeholder="例如: CR123456"
                className="flex-1 px-4 py-2.5 border border-border-subtle rounded-xl bg-bg-elevated text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent-indigo"
              />
              <Button variant="secondary" onClick={handleInvite} disabled={submitting}>
                {submitting ? <Loader2 size={16} className="animate-spin" /> : null}
                查找
              </Button>
            </div>
            <p className="text-xs text-text-tertiary mt-2">达人ID格式：CR + 6位数字</p>
          </div>

          {inviteResult && (
            <div className={`p-4 rounded-xl flex items-start gap-3 ${
              inviteResult.success ? 'bg-accent-green/10 border border-accent-green/20' : 'bg-accent-coral/10 border border-accent-coral/20'
            }`}>
              {inviteResult.success ? (
                <CheckCircle size={18} className="text-accent-green flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle size={18} className="text-accent-coral flex-shrink-0 mt-0.5" />
              )}
              <span className={`text-sm ${inviteResult.success ? 'text-accent-green' : 'text-accent-coral'}`}>
                {inviteResult.message}
              </span>
            </div>
          )}

          <div className="flex gap-3 justify-end pt-4">
            <Button variant="ghost" onClick={handleCloseInviteModal}>
              取消
            </Button>
            <Button
              onClick={() => {
                if (inviteResult?.success) {
                  handleCloseInviteModal()
                  fetchData() // 刷新达人列表
                }
              }}
              disabled={!inviteResult?.success}
            >
              <UserPlus size={16} />
              发送邀请
            </Button>
          </div>
        </div>
      </Modal>

      {/* 备注弹窗 */}
      <Modal
        isOpen={remarkModal.open}
        onClose={() => { setRemarkModal({ open: false, creator: null }); setRemarkText(''); }}
        title={`${remarkModal.creator?.remark ? '编辑' : '添加'}备注 - ${remarkModal.creator?.name}`}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">备注内容</label>
            <textarea
              value={remarkText}
              onChange={(e) => setRemarkText(e.target.value)}
              placeholder="输入备注信息，如达人特点、合作注意事项等..."
              className="w-full h-32 px-4 py-3 border border-border-subtle rounded-xl bg-bg-elevated text-text-primary placeholder-text-tertiary resize-none focus:outline-none focus:ring-2 focus:ring-accent-indigo"
            />
          </div>
          <div className="flex gap-3 justify-end">
            <Button variant="ghost" onClick={() => { setRemarkModal({ open: false, creator: null }); setRemarkText(''); }}>
              取消
            </Button>
            <Button onClick={handleSaveRemark}>
              <CheckCircle size={16} />
              保存
            </Button>
          </div>
        </div>
      </Modal>

      {/* 删除确认弹窗 */}
      <Modal
        isOpen={deleteModal.open}
        onClose={() => setDeleteModal({ open: false, creator: null })}
        title="确认移除达人"
      >
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-accent-coral/10 border border-accent-coral/20">
            <div className="flex items-start gap-3">
              <AlertCircle size={20} className="text-accent-coral flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-text-primary font-medium">确定要移除达人「{deleteModal.creator?.name}」吗？</p>
                <p className="text-sm text-text-secondary mt-1">
                  移除后该达人将无法继续参与您的项目，但不会删除历史数据。
                </p>
              </div>
            </div>
          </div>
          <div className="flex gap-3 justify-end">
            <Button variant="ghost" onClick={() => setDeleteModal({ open: false, creator: null })}>
              取消
            </Button>
            <Button
              variant="secondary"
              className="border-accent-coral text-accent-coral hover:bg-accent-coral/10"
              onClick={handleConfirmDelete}
              disabled={submitting}
            >
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
              确认移除
            </Button>
          </div>
        </div>
      </Modal>

      {/* 分配项目弹窗 */}
      <Modal
        isOpen={assignModal.open}
        onClose={() => { setAssignModal({ open: false, creator: null }); setSelectedProject(''); }}
        title={`分配达人到项目 - ${assignModal.creator?.name}`}
      >
        <div className="space-y-4">
          <p className="text-text-secondary text-sm">
            选择要将达人分配到的项目，达人将收到项目邀请通知。
          </p>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">选择项目</label>
            <div className="space-y-2">
              {projectList.map((project) => (
                <label
                  key={project.id}
                  className={`flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-colors ${
                    selectedProject === project.id
                      ? 'border-accent-indigo bg-accent-indigo/10'
                      : 'border-border-subtle hover:border-accent-indigo/50'
                  }`}
                >
                  <input
                    type="radio"
                    name="project"
                    value={project.id}
                    checked={selectedProject === project.id}
                    onChange={(e) => setSelectedProject(e.target.value)}
                    className="w-4 h-4 text-accent-indigo"
                  />
                  <span className="text-text-primary">{project.name}</span>
                </label>
              ))}
              {projectList.length === 0 && (
                <p className="text-text-tertiary text-sm text-center py-4">暂无可分配的项目</p>
              )}
            </div>
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="ghost" onClick={() => { setAssignModal({ open: false, creator: null }); setSelectedProject(''); }}>
              取消
            </Button>
            <Button onClick={handleConfirmAssign} disabled={!selectedProject || submitting}>
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <FolderPlus size={16} />}
              确认分配
            </Button>
          </div>
        </div>
      </Modal>

      {/* 点击其他地方关闭菜单 */}
      {openMenuId && (
        <div
          className="fixed inset-0 z-0"
          onClick={() => setOpenMenuId(null)}
        />
      )}
    </div>
  )
}
