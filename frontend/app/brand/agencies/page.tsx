'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { SuccessTag, PendingTag } from '@/components/ui/Tag'
import { useToast } from '@/components/ui/Toast'
import {
  Search,
  Plus,
  Users,
  Copy,
  CheckCircle,
  MoreVertical,
  Building2,
  AlertCircle,
  UserPlus,
  Trash2,
  FolderPlus,
  Loader2,
} from 'lucide-react'
import { copyToClipboard } from '@/lib/utils'
import { api, extractErrorMessage } from '@/lib/api'
import type { AgencyDetail } from '@/types/organization'
import type { ProjectResponse } from '@/types/project'

function StatusTag({ forcePass }: { forcePass: boolean }) {
  if (forcePass) return <SuccessTag>可强制通过</SuccessTag>
  return <PendingTag>标准权限</PendingTag>
}

function AgencySkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-20 bg-bg-elevated rounded-lg mb-2" />
      <div className="h-20 bg-bg-elevated rounded-lg mb-2" />
      <div className="h-20 bg-bg-elevated rounded-lg" />
    </div>
  )
}

export default function AgenciesManagePage() {
  const toast = useToast()
  const [searchQuery, setSearchQuery] = useState('')
  const [agencies, setAgencies] = useState<AgencyDetail[]>([])
  const [projects, setProjects] = useState<ProjectResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // 邀请代理商弹窗
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteAgencyId, setInviteAgencyId] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteResult, setInviteResult] = useState<{ success: boolean; message: string } | null>(null)

  // 操作菜单状态
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const menuRef = useRef<HTMLDivElement>(null)

  const handleToggleMenu = (agencyId: string, e: React.MouseEvent<HTMLButtonElement>) => {
    if (openMenuId === agencyId) {
      setOpenMenuId(null)
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    setMenuPos({ top: rect.bottom + 4, left: rect.right - 160 }) // 160 = menu width
    setOpenMenuId(agencyId)
  }

  // 点击外部关闭菜单
  useEffect(() => {
    if (!openMenuId) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [openMenuId])

  // 删除确认弹窗状态
  const [deleteModal, setDeleteModal] = useState<{ open: boolean; agency: AgencyDetail | null }>({ open: false, agency: null })
  const [deleting, setDeleting] = useState(false)

  // 分配项目弹窗状态
  const [assignModal, setAssignModal] = useState<{ open: boolean; agency: AgencyDetail | null }>({ open: false, agency: null })
  const [selectedProjects, setSelectedProjects] = useState<string[]>([])
  const [assigning, setAssigning] = useState(false)

  const loadData = useCallback(async () => {
    try {
      const [agencyRes, projectRes] = await Promise.all([
        api.listBrandAgencies(),
        api.listProjects(1, 100),
      ])
      setAgencies(agencyRes.items)
      setProjects(projectRes.items)
    } catch (err) {
      console.error('Failed to load data:', err)
      toast.error('加载数据失败：' + extractErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { loadData() }, [loadData])

  const filteredAgencies = agencies.filter(agency =>
    agency.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    agency.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (agency.contact_name || '').toLowerCase().includes(searchQuery.toLowerCase())
  )

  // 复制代理商ID
  const handleCopyAgencyId = async (agencyId: string) => {
    await copyToClipboard(agencyId)
    setCopiedId(agencyId)
    setTimeout(() => setCopiedId(null), 2000)
  }

  // 邀请代理商
  const handleInvite = async () => {
    if (!inviteAgencyId.trim()) {
      setInviteResult({ success: false, message: '请输入代理商ID' })
      return
    }

    const idPattern = /^AG\d{6}$/
    if (!idPattern.test(inviteAgencyId.toUpperCase())) {
      setInviteResult({ success: false, message: '代理商ID格式错误，应为AG+6位数字' })
      return
    }

    if (agencies.some(a => a.id === inviteAgencyId.toUpperCase())) {
      setInviteResult({ success: false, message: '该代理商已在您的列表中' })
      return
    }

    setInviting(true)
    try {
      await api.inviteAgency(inviteAgencyId.toUpperCase())
      setInviteResult({ success: true, message: `已向代理商 ${inviteAgencyId.toUpperCase()} 发送邀请，等待对方在消息中心确认` })
    } catch (err) {
      setInviteResult({ success: false, message: extractErrorMessage(err) })
    } finally {
      setInviting(false)
    }
  }

  const handleCloseInviteModal = () => {
    setShowInviteModal(false)
    setInviteAgencyId('')
    setInviteResult(null)
  }

  const handleConfirmInvite = async () => {
    if (inviteResult?.success) {
      handleCloseInviteModal()
      await loadData()
    }
  }

  // 打开删除确认
  const handleOpenDelete = (agency: AgencyDetail) => {
    setDeleteModal({ open: true, agency })
    setOpenMenuId(null)
  }

  // 确认删除
  const handleConfirmDelete = async () => {
    if (!deleteModal.agency) return
    setDeleting(true)
    try {
      await api.removeAgency(deleteModal.agency.id)
      await loadData()
      toast.success('已移除代理商')
    } catch (err) {
      toast.error('移除失败：' + extractErrorMessage(err))
    } finally {
      setDeleting(false)
      setDeleteModal({ open: false, agency: null })
    }
  }

  // 打开分配项目弹窗
  const handleOpenAssign = (agency: AgencyDetail) => {
    setSelectedProjects([])
    setAssignModal({ open: true, agency })
    setOpenMenuId(null)
  }

  // 切换项目选择
  const toggleProjectSelection = (projectId: string) => {
    setSelectedProjects(prev =>
      prev.includes(projectId) ? prev.filter(id => id !== projectId) : [...prev, projectId]
    )
  }

  // 确认分配项目
  const handleConfirmAssign = async () => {
    if (!assignModal.agency || selectedProjects.length === 0) return
    setAssigning(true)
    try {
      for (const projectId of selectedProjects) {
        await api.assignAgencies(projectId, [assignModal.agency.id])
      }
      const projectNames = projects
        .filter(p => selectedProjects.includes(p.id))
        .map(p => p.name)
        .join('、')
      toast.success(`已将代理商「${assignModal.agency.name}」分配到项目「${projectNames}」`)
    } catch (err) {
      toast.error('分配失败：' + extractErrorMessage(err))
    } finally {
      setAssigning(false)
      setAssignModal({ open: false, agency: null })
      setSelectedProjects([])
    }
  }

  return (
    <div className="space-y-6 min-h-0">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">代理商管理</h1>
          <p className="text-sm text-text-secondary mt-1">管理合作代理商，查看代理商绩效数据</p>
        </div>
        <Button onClick={() => setShowInviteModal(true)}>
          <Plus size={16} />
          邀请代理商
        </Button>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-secondary">总代理商</p>
                <p className="text-2xl font-bold text-text-primary">{agencies.length}</p>
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
                <p className="text-sm text-text-secondary">可强制通过</p>
                <p className="text-2xl font-bold text-accent-green">{agencies.filter(a => a.force_pass_enabled).length}</p>
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
                <p className="text-sm text-text-secondary">关联项目</p>
                <p className="text-2xl font-bold text-text-primary">{projects.length}</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                <Building2 size={20} className="text-purple-400" />
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
          placeholder="搜索代理商名称、ID..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 border border-border-subtle rounded-xl bg-bg-elevated text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-indigo"
        />
      </div>

      {/* 代理商列表 */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="p-6"><AgencySkeleton /></div>
          ) : (
            <table className="w-full min-w-[700px]">
              <thead>
                <tr className="border-b border-border-subtle text-left text-sm text-text-secondary bg-bg-elevated">
                  <th className="px-6 py-4 font-medium">代理商</th>
                  <th className="px-6 py-4 font-medium">代理商ID</th>
                  <th className="px-6 py-4 font-medium">联系人</th>
                  <th className="px-6 py-4 font-medium">权限</th>
                  <th className="px-6 py-4 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredAgencies.map((agency) => (
                  <tr key={agency.id} className="border-b border-border-subtle last:border-0 hover:bg-bg-elevated/50">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-accent-indigo/15 flex items-center justify-center">
                          <Building2 size={20} className="text-accent-indigo" />
                        </div>
                        <span className="font-medium text-text-primary">{agency.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <code className="px-2 py-1 rounded bg-bg-elevated text-sm font-mono text-accent-indigo">
                          {agency.id}
                        </code>
                        <button
                          type="button"
                          onClick={() => handleCopyAgencyId(agency.id)}
                          className="p-1 rounded hover:bg-bg-elevated transition-colors"
                          title="复制代理商ID"
                        >
                          {copiedId === agency.id ? (
                            <CheckCircle size={14} className="text-accent-green" />
                          ) : (
                            <Copy size={14} className="text-text-tertiary" />
                          )}
                        </button>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-text-secondary text-sm">
                      {agency.contact_name || '-'}
                    </td>
                    <td className="px-6 py-4">
                      <StatusTag forcePass={agency.force_pass_enabled} />
                    </td>
                    <td className="px-6 py-4">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => handleToggleMenu(agency.id, e)}
                      >
                        <MoreVertical size={16} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {!loading && filteredAgencies.length === 0 && (
            <div className="text-center py-12 text-text-tertiary">
              <Building2 size={48} className="mx-auto mb-4 opacity-50" />
              <p>没有找到匹配的代理商</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 操作菜单（fixed 定位，不受 overflow 裁剪） */}
      {openMenuId && (
        <div
          ref={menuRef}
          className="fixed w-40 bg-bg-card rounded-xl shadow-lg border border-border-subtle z-50 overflow-hidden"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          <button
            type="button"
            onClick={() => {
              const agency = agencies.find(a => a.id === openMenuId)
              if (agency) handleOpenAssign(agency)
            }}
            className="w-full px-4 py-2.5 text-left text-sm text-text-primary hover:bg-bg-elevated flex items-center gap-2"
          >
            <FolderPlus size={14} className="text-text-secondary" />
            分配到项目
          </button>
          <button
            type="button"
            onClick={() => {
              const agency = agencies.find(a => a.id === openMenuId)
              if (agency) handleOpenDelete(agency)
            }}
            className="w-full px-4 py-2.5 text-left text-sm text-accent-coral hover:bg-accent-coral/10 flex items-center gap-2"
          >
            <Trash2 size={14} />
            移除代理商
          </button>
        </div>
      )}

      {/* 邀请代理商弹窗 */}
      <Modal isOpen={showInviteModal} onClose={handleCloseInviteModal} title="邀请代理商">
        <div className="space-y-4">
          <p className="text-text-secondary text-sm">
            输入代理商ID邀请合作。代理商ID可在代理商的个人中心查看。
          </p>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">代理商ID</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={inviteAgencyId}
                onChange={(e) => {
                  setInviteAgencyId(e.target.value.toUpperCase())
                  setInviteResult(null)
                }}
                placeholder="例如: AG789012"
                className="flex-1 px-4 py-2.5 border border-border-subtle rounded-xl bg-bg-elevated text-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-accent-indigo"
              />
              <Button variant="secondary" onClick={handleInvite} disabled={inviting}>
                {inviting ? <Loader2 size={16} className="animate-spin" /> : '查找'}
              </Button>
            </div>
            <p className="text-xs text-text-tertiary mt-2">代理商ID格式：AG + 6位数字</p>
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
            <Button onClick={handleConfirmInvite} disabled={!inviteResult?.success}>
              <UserPlus size={16} />
              确认邀请
            </Button>
          </div>
        </div>
      </Modal>

      {/* 删除确认弹窗 */}
      <Modal
        isOpen={deleteModal.open}
        onClose={() => setDeleteModal({ open: false, agency: null })}
        title="确认移除代理商"
      >
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-accent-coral/10 border border-accent-coral/20">
            <div className="flex items-start gap-3">
              <AlertCircle size={20} className="text-accent-coral flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-text-primary font-medium">确定要移除代理商「{deleteModal.agency?.name}」吗？</p>
                <p className="text-sm text-text-secondary mt-1">
                  移除后该代理商将无法继续参与您的项目，该代理商下的达人也将受到影响。
                </p>
              </div>
            </div>
          </div>
          <div className="flex gap-3 justify-end">
            <Button variant="ghost" onClick={() => setDeleteModal({ open: false, agency: null })}>
              取消
            </Button>
            <Button
              variant="secondary"
              className="border-accent-coral text-accent-coral hover:bg-accent-coral/10"
              onClick={handleConfirmDelete}
              disabled={deleting}
            >
              {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
              确认移除
            </Button>
          </div>
        </div>
      </Modal>

      {/* 分配项目弹窗 */}
      <Modal
        isOpen={assignModal.open}
        onClose={() => { setAssignModal({ open: false, agency: null }); setSelectedProjects([]); }}
        title={`分配代理商到项目 - ${assignModal.agency?.name}`}
      >
        <div className="space-y-4">
          <p className="text-text-secondary text-sm">
            选择要将代理商分配到的项目，可多选。
          </p>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">选择项目</label>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {projects.map((project) => {
                const isSelected = selectedProjects.includes(project.id)
                return (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => toggleProjectSelection(project.id)}
                    className={`w-full flex items-center gap-3 p-4 rounded-xl border-2 text-left transition-colors ${
                      isSelected
                        ? 'border-accent-indigo bg-accent-indigo/10'
                        : 'border-border-subtle hover:border-accent-indigo/50'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                      isSelected ? 'border-accent-indigo bg-accent-indigo' : 'border-border-subtle'
                    }`}>
                      {isSelected && <CheckCircle size={12} className="text-white" />}
                    </div>
                    <span className="text-text-primary">{project.name}</span>
                  </button>
                )
              })}
            </div>
          </div>
          {selectedProjects.length > 0 && (
            <p className="text-sm text-text-secondary">
              已选择 <span className="text-accent-indigo font-medium">{selectedProjects.length}</span> 个项目
            </p>
          )}
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="ghost" onClick={() => { setAssignModal({ open: false, agency: null }); setSelectedProjects([]); }}>
              取消
            </Button>
            <Button onClick={handleConfirmAssign} disabled={selectedProjects.length === 0 || assigning}>
              {assigning ? <Loader2 size={16} className="animate-spin" /> : <FolderPlus size={16} />}
              确认分配
            </Button>
          </div>
        </div>
      </Modal>

    </div>
  )
}
