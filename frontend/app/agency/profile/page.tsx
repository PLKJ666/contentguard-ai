'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  CircleUser,
  Settings,
  BellRing,
  History,
  MessageCircleQuestion,
  ChevronRight,
  LogOut,
  Copy,
  Check,
  Building2,
  Users,
  FileCheck,
  Sun,
  Moon,
  Monitor
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { cn, copyToClipboard } from '@/lib/utils'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { api } from '@/lib/api'
import type { AgencyDashboard } from '@/types/dashboard'

// 菜单项数据
const menuItems = [
  {
    id: 'company',
    icon: Building2,
    iconColor: 'text-accent-indigo',
    bgColor: 'bg-accent-indigo',
    title: '公司信息',
    subtitle: '公司名称、营业执照、联系方式',
  },
  {
    id: 'personal',
    icon: CircleUser,
    iconColor: 'text-accent-blue',
    bgColor: 'bg-accent-blue',
    title: '个人信息',
    subtitle: '头像、昵称、负责人信息',
  },
  {
    id: 'account',
    icon: Settings,
    iconColor: 'text-accent-green',
    bgColor: 'bg-accent-green',
    title: '账户设置',
    subtitle: '统一认证、账号安全',
  },
  {
    id: 'notification',
    icon: BellRing,
    iconColor: 'text-accent-amber',
    bgColor: 'bg-accent-amber',
    title: '消息设置',
    subtitle: '通知开关、提醒偏好',
  },
  {
    id: 'history',
    icon: History,
    iconColor: 'text-accent-coral',
    bgColor: 'bg-accent-coral',
    title: '审核历史',
    subtitle: '查看历史审核记录',
  },
  {
    id: 'help',
    icon: MessageCircleQuestion,
    iconColor: 'text-text-secondary',
    bgColor: 'bg-bg-elevated',
    title: '帮助与反馈',
    subtitle: '常见问题、联系客服',
  },
]

// 代理商卡片组件
function AgencyCard() {
  const toast = useToast()
  const { user } = useAuth()
  const [copied, setCopied] = useState(false)
  const [stats, setStats] = useState({ creators: 0, totalTasks: 0, passRate: 0, pendingReview: 0 })

  useEffect(() => {
    const loadStats = async () => {
      try {
        const dashboard = await api.getAgencyDashboard()
        const totalPassed = dashboard.today_passed.script + dashboard.today_passed.video
        const totalPending = dashboard.pending_review.script + dashboard.pending_review.video
        setStats({
          creators: dashboard.total_creators,
          totalTasks: dashboard.total_tasks,
          passRate: dashboard.total_tasks > 0 ? Math.round((totalPassed / Math.max(totalPassed + totalPending, 1)) * 100) : 0,
          pendingReview: totalPending,
        })
      } catch {
        // 静默失败
      }
    }
    loadStats()
  }, [])

  const displayName = user?.name || '代理商'
  const displayInitial = user?.name?.[0] || '?'
  const displayAgencyId = user?.agency_id || '--'
  const displayRole = user?.is_verified ? '认证代理商' : '代理商'
  const displayCompany = user?.tenant_name || '--'

  // 复制代理商ID
  const handleCopyId = async () => {
    try {
      await copyToClipboard(displayAgencyId)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('复制失败，请重试')
    }
  }

  return (
    <div className="bg-bg-card rounded-2xl p-6 card-shadow flex flex-col gap-5">
      {/* 头像和信息 */}
      <div className="flex items-center gap-5">
        {/* 头像 */}
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center"
          style={{
            background: 'linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)',
          }}
        >
          <span className="text-[32px] font-bold text-white">{displayInitial}</span>
        </div>
        {/* 代理商信息 */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xl font-semibold text-text-primary">{displayName}</span>
          <span className="text-sm text-text-secondary">{displayRole}</span>
          {/* 代理商ID */}
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-text-tertiary">代理商ID:</span>
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-bg-elevated">
              <span className="text-xs font-mono font-medium text-accent-indigo">{displayAgencyId}</span>
              <button
                type="button"
                onClick={handleCopyId}
                className="p-0.5 hover:bg-bg-card rounded transition-colors"
                title={copied ? '已复制' : '复制代理商ID'}
              >
                {copied ? (
                  <Check size={12} className="text-accent-green" />
                ) : (
                  <Copy size={12} className="text-text-tertiary hover:text-text-secondary" />
                )}
              </button>
            </div>
            {copied && (
              <span className="text-xs text-accent-green animate-fade-in">已复制</span>
            )}
          </div>
        </div>
      </div>

      {/* 公司名称 */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-elevated">
        <Building2 size={16} className="text-text-tertiary" />
        <span className="text-sm text-text-secondary">{displayCompany}</span>
      </div>

      {/* 统计数据 */}
      <div className="grid grid-cols-4 gap-4 pt-4 border-t border-border-subtle">
        <div className="flex flex-col items-center gap-1">
          <div className="flex items-center gap-1">
            <Users size={14} className="text-accent-indigo" />
            <span className="text-xl font-bold text-text-primary">{stats.creators}</span>
          </div>
          <span className="text-xs text-text-secondary">管理达人</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <div className="flex items-center gap-1">
            <FileCheck size={14} className="text-accent-blue" />
            <span className="text-xl font-bold text-text-primary">{stats.totalTasks}</span>
          </div>
          <span className="text-xs text-text-secondary">总任务数</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <span className="text-xl font-bold text-accent-green">{stats.passRate}%</span>
          <span className="text-xs text-text-secondary">通过率</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <span className="text-xl font-bold text-accent-amber">{stats.pendingReview}</span>
          <span className="text-xs text-text-secondary">待审核</span>
        </div>
      </div>
    </div>
  )
}

// 菜单项组件
function MenuItem({ item, onClick }: { item: typeof menuItems[0]; onClick: () => void }) {
  const Icon = item.icon
  const isPlainBg = item.bgColor === 'bg-bg-elevated'

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-between py-4 w-full text-left hover:bg-bg-elevated/30 transition-colors rounded-lg px-2 -mx-2"
    >
      <div className="flex items-center gap-4">
        {/* 图标背景 */}
        <div
          className={cn(
            'w-10 h-10 rounded-[10px] flex items-center justify-center',
            isPlainBg ? item.bgColor : `${item.bgColor}/15`
          )}
        >
          <Icon size={20} className={item.iconColor} />
        </div>
        {/* 文字 */}
        <div className="flex flex-col gap-0.5">
          <span className="text-[15px] font-medium text-text-primary">{item.title}</span>
          <span className="text-[13px] text-text-tertiary">{item.subtitle}</span>
        </div>
      </div>
      <ChevronRight size={20} className="text-text-tertiary" />
    </button>
  )
}

// 菜单卡片组件
function MenuCard({ onMenuClick }: { onMenuClick: (id: string) => void }) {
  return (
    <div className="bg-bg-card rounded-2xl p-6 card-shadow flex flex-col">
      {menuItems.map((item, index) => (
        <div key={item.id}>
          <MenuItem item={item} onClick={() => onMenuClick(item.id)} />
          {index < menuItems.length - 1 && (
            <div className="h-px bg-border-subtle" />
          )}
        </div>
      ))}
    </div>
  )
}

// 外观模式卡片
function ThemeCard() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

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
            <p className="text-[13px] text-text-tertiary">切换深色或浅色主题</p>
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
                  active
                    ? 'bg-accent-indigo text-white'
                    : 'text-text-secondary hover:text-text-primary'
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

// 退出卡片组件
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

export default function AgencyProfilePage() {
  const router = useRouter()
  const { logout } = useAuth()

  // 菜单项点击处理
  const handleMenuClick = (menuId: string) => {
    const routes: Record<string, string> = {
      company: '/agency/profile/company',
      personal: '/agency/profile/edit',
      account: '/agency/settings/account',
      notification: '/agency/settings/notification',
      history: '/agency/review/history',
      help: '/agency/help',
    }
    const route = routes[menuId]
    if (route) {
      router.push(route)
    }
  }

  // 退出登录（logout() 内部会跳转 /api/auth/sign-out，不要再 router.push）
  const handleLogout = () => {
    logout()
  }

  return (
    <div className="space-y-6">
      {/* 顶部栏 */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-text-primary">个人中心</h1>
        <p className="text-sm text-text-secondary">管理代理商账户信息和偏好设置</p>
      </div>

      {/* 内容区 - 响应式布局 */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* 代理商卡片 */}
        <div className="lg:w-[400px] lg:flex-shrink-0">
          <AgencyCard />
        </div>

        {/* 菜单和退出 */}
        <div className="flex-1 flex flex-col gap-5">
          <MenuCard onMenuClick={handleMenuClick} />
          <ThemeCard />
          <LogoutCard onLogout={handleLogout} />
        </div>
      </div>
    </div>
  )
}
