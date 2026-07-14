'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Bot,
  Check,
  Copy,
  FileText,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Monitor,
  Moon,
  PencilLine,
  Settings,
  Sun,
  UserCircle2,
  Users,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { cn, copyToClipboard } from '@/lib/utils'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { api } from '@/lib/api'

const menuItems = [
  {
    id: 'profile-edit',
    icon: PencilLine,
    iconColor: 'text-accent-indigo',
    bgColor: 'bg-accent-indigo',
    title: '编辑个人信息',
    subtitle: '修改昵称和头像',
    href: '/operator/profile/edit',
  },
  {
    id: 'dashboard',
    icon: LayoutDashboard,
    iconColor: 'text-accent-blue',
    bgColor: 'bg-accent-blue',
    title: '返回工作台',
    subtitle: '查看最近任务和工作概览',
    href: '/operator',
  },
  {
    id: 'projects',
    icon: FolderKanban,
    iconColor: 'text-accent-green',
    bgColor: 'bg-accent-green',
    title: '项目管理',
    subtitle: '创建项目并维护客户、品牌信息',
    href: '/operator/projects',
  },
  {
    id: 'tasks',
    icon: Users,
    iconColor: 'text-accent-amber',
    bgColor: 'bg-accent-amber',
    title: '任务管理',
    subtitle: '配置 Brief、创建任务、推进执行流程',
    href: '/operator/tasks',
  },
  {
    id: 'rules',
    icon: FileText,
    iconColor: 'text-accent-coral',
    bgColor: 'bg-accent-coral',
    title: '规则配置',
    subtitle: '维护当前工作空间的规则和学习内容',
    href: '/operator/rules',
  },
  {
    id: 'ai-config',
    icon: Bot,
    iconColor: 'text-text-secondary',
    bgColor: 'bg-bg-elevated',
    title: 'AI 配置',
    subtitle: '调整模型、Base URL 和参数设置',
    href: '/operator/ai-config',
  },
] as const

function OperatorCard() {
  const toast = useToast()
  const { user } = useAuth()
  const [copiedField, setCopiedField] = useState<'operator' | 'workspace' | null>(null)
  const [stats, setStats] = useState({ projects: 0, tasks: 0, completed: 0 })

  useEffect(() => {
    const loadStats = async () => {
      try {
        const [projectRes, taskRes] = await Promise.all([
          api.listOperatorProjects(),
          api.listOperatorTasks(),
        ])
        setStats({
          projects: projectRes.total,
          tasks: taskRes.total,
          completed: taskRes.items.filter((item) => item.stage === 'completed').length,
        })
      } catch {
        // 静默失败，个人中心不阻塞主流程
      }
    }

    void loadStats()
  }, [])

  const handleCopy = useCallback(async (field: 'operator' | 'workspace', value: string) => {
    if (!value || value === '--') {
      toast.error('暂无可复制内容')
      return
    }
    try {
      await copyToClipboard(value)
      setCopiedField(field)
      window.setTimeout(() => setCopiedField((current) => (current === field ? null : current)), 2000)
    } catch {
      toast.error('复制失败，请重试')
    }
  }, [toast])

  const displayName = user?.name || '代运营'
  const displayInitial = user?.name?.[0] || '代'
  const displayOperatorId = user?.operator_id || '--'
  const displayWorkspaceId = user?.tenant_id || '--'
  const displayWorkspaceName = user?.tenant_name || '未命名工作空间'
  const displayEmail = user?.email || '未绑定邮箱'

  return (
    <div className="bg-bg-card rounded-2xl p-6 card-shadow flex flex-col gap-5">
      <div className="flex items-center gap-5">
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)' }}
        >
          <span className="text-[32px] font-bold text-white">{displayInitial}</span>
        </div>
        <div className="flex flex-col gap-1.5 min-w-0">
          <span className="text-xl font-semibold text-text-primary truncate">{displayName}</span>
          <span className="text-sm text-text-secondary">代运营 · 独立工作空间操作者</span>
          <span className="text-xs text-text-tertiary break-all">{displayEmail}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-elevated">
        <UserCircle2 size={16} className="text-text-tertiary" />
        <span className="text-sm text-text-secondary truncate">{displayWorkspaceName}</span>
      </div>

      <div className="space-y-3 rounded-xl bg-bg-elevated p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs text-text-tertiary">Operator ID</div>
            <div className="mt-1 text-sm font-mono text-text-primary break-all">{displayOperatorId}</div>
          </div>
          <button
            type="button"
            onClick={() => void handleCopy('operator', displayOperatorId)}
            className="rounded-md p-2 hover:bg-bg-card transition-colors"
            title="复制 Operator ID"
          >
            {copiedField === 'operator' ? <Check size={14} className="text-accent-green" /> : <Copy size={14} className="text-text-tertiary" />}
          </button>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs text-text-tertiary">Workspace ID</div>
            <div className="mt-1 text-sm font-mono text-text-primary break-all">{displayWorkspaceId}</div>
          </div>
          <button
            type="button"
            onClick={() => void handleCopy('workspace', displayWorkspaceId)}
            className="rounded-md p-2 hover:bg-bg-card transition-colors"
            title="复制 Workspace ID"
          >
            {copiedField === 'workspace' ? <Check size={14} className="text-accent-green" /> : <Copy size={14} className="text-text-tertiary" />}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 pt-4 border-t border-border-subtle">
        <div className="flex flex-col items-center gap-1">
          <span className="text-xl font-bold text-text-primary">{stats.projects}</span>
          <span className="text-xs text-text-secondary">项目数</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <span className="text-xl font-bold text-accent-indigo">{stats.tasks}</span>
          <span className="text-xs text-text-secondary">任务数</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <span className="text-xl font-bold text-accent-green">{stats.completed}</span>
          <span className="text-xs text-text-secondary">已完成</span>
        </div>
      </div>
    </div>
  )
}

function MenuCard({ onMenuClick }: { onMenuClick: (href: string) => void }) {
  return (
    <div className="bg-bg-card rounded-2xl p-6 card-shadow flex flex-col">
      {menuItems.map((item, index) => {
        const Icon = item.icon
        const isPlainBg = item.bgColor === 'bg-bg-elevated'

        return (
          <div key={item.id}>
            <button
              type="button"
              onClick={() => onMenuClick(item.href)}
              className="flex items-center justify-between py-4 w-full text-left hover:bg-bg-elevated/30 transition-colors rounded-lg px-2 -mx-2"
            >
              <div className="flex items-center gap-4">
                <div
                  className={cn(
                    'w-10 h-10 rounded-[10px] flex items-center justify-center',
                    isPlainBg ? item.bgColor : `${item.bgColor}/15`
                  )}
                >
                  <Icon size={20} className={item.iconColor} />
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[15px] font-medium text-text-primary">{item.title}</span>
                  <span className="text-[13px] text-text-tertiary">{item.subtitle}</span>
                </div>
              </div>
              <Settings size={18} className="text-text-tertiary" />
            </button>
            {index < menuItems.length - 1 ? <div className="h-px bg-border-subtle" /> : null}
          </div>
        )
      })}
    </div>
  )
}

function ThemeCard() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const options = [
    { value: 'light', icon: Sun, label: '浅色' },
    { value: 'dark', icon: Moon, label: '深色' },
    { value: 'system', icon: Monitor, label: '系统' },
  ] as const

  return (
    <div className="bg-bg-card rounded-2xl p-6 card-shadow">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[10px] bg-purple-500/15 flex items-center justify-center">
            <Sun size={20} className="text-purple-400" />
          </div>
          <div>
            <span className="text-[15px] font-medium text-text-primary">外观模式</span>
            <p className="text-[13px] text-text-tertiary">切换当前工作台的主题显示</p>
          </div>
        </div>
        <div className="flex items-center gap-1 p-1 rounded-lg bg-bg-elevated">
          {options.map((opt) => {
            const Icon = opt.icon
            const active = mounted && theme === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setTheme(opt.value)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors',
                  active ? 'bg-accent-indigo text-white' : 'text-text-secondary hover:text-text-primary'
                )}
              >
                <Icon size={14} />
                <span className="hidden sm:inline">{opt.label}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function LogoutCard({ onLogout }: { onLogout: () => void }) {
  return (
    <div className="bg-bg-card rounded-2xl p-6 card-shadow">
      <button
        type="button"
        onClick={onLogout}
        className="w-full flex items-center justify-center gap-2 py-4 rounded-xl border-[1.5px] border-accent-coral text-accent-coral font-medium hover:bg-accent-coral/10 transition-colors"
      >
        <LogOut size={20} />
        <span>退出登录</span>
      </button>
    </div>
  )
}

export default function OperatorProfilePage() {
  const router = useRouter()
  const { logout } = useAuth()

  const handleMenuClick = useCallback((href: string) => {
    router.push(href)
  }, [router])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-text-primary">个人中心</h1>
        <p className="text-sm text-text-secondary">查看代运营身份信息、工作空间信息和常用操作入口</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="lg:w-[400px] lg:flex-shrink-0">
          <OperatorCard />
        </div>
        <div className="flex-1 flex flex-col gap-5">
          <MenuCard onMenuClick={handleMenuClick} />
          <ThemeCard />
          <LogoutCard onLogout={logout} />
        </div>
      </div>
    </div>
  )
}
