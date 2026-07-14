'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  CircleUser,
  Settings,
  BellRing,
  History,
  MessageCircleQuestion,
  PlusCircle,
  ChevronRight,
  LogOut,
  Copy,
  Check,
  Sun,
  Moon,
  Monitor
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { ResponsiveLayout } from '@/components/layout/ResponsiveLayout'
import { cn, copyToClipboard } from '@/lib/utils'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { api } from '@/lib/api'
import type { CreatorDashboard } from '@/types/dashboard'

// 菜单项数据
const menuItems = [
  {
    id: 'personal',
    icon: CircleUser,
    iconColor: 'text-accent-indigo',
    bgColor: 'bg-accent-indigo',
    title: '个人信息',
    subtitle: '头像、昵称、绑定账号',
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
    iconColor: 'text-accent-blue',
    bgColor: 'bg-accent-blue',
    title: '消息设置',
    subtitle: '通知开关、提醒偏好',
  },
  {
    id: 'history',
    icon: History,
    iconColor: 'text-accent-coral',
    bgColor: 'bg-accent-coral',
    title: '历史记录',
    subtitle: '已完成和过期的任务',
  },
  {
    id: 'help',
    icon: MessageCircleQuestion,
    iconColor: 'text-text-secondary',
    bgColor: 'bg-bg-elevated',
    title: '帮助与反馈',
    subtitle: '常见问题、联系客服',
  },
  {
    id: 'appeal',
    icon: PlusCircle,
    iconColor: 'text-accent-indigo',
    bgColor: 'bg-accent-indigo',
    title: '申诉次数',
    subtitle: '查看各任务申诉次数 · 申请增加',
  },
]

// 用户卡片组件
function UserCard() {
  const toast = useToast()
  const { user } = useAuth()
  const [copied, setCopied] = useState(false)
  const [stats, setStats] = useState({ completed: 0, inProgress: 0, totalTasks: 0 })

  useEffect(() => {
    const loadStats = async () => {
      try {
        const dashboard = await api.getCreatorDashboard()
        setStats({
          completed: dashboard.completed,
          inProgress: dashboard.pending_script + dashboard.pending_video + dashboard.in_review,
          totalTasks: dashboard.total_tasks,
        })
      } catch {
        // 静默失败，保持默认值
      }
    }
    loadStats()
  }, [])

  const displayName = user?.name || '用户'
  const displayInitial = user?.name?.[0] || '?'
  const displayCreatorId = user?.creator_id || '--'
  const displayRole = user?.is_verified ? '达人 · 已认证' : '达人'
  const passRate = stats.totalTasks > 0 ? Math.round((stats.completed / stats.totalTasks) * 100) : 0

  // 复制达人ID
  const handleCopyId = async () => {
    try {
      await copyToClipboard(displayCreatorId)
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
        {/* 用户信息 */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xl font-semibold text-text-primary">{displayName}</span>
          <span className="text-sm text-text-secondary">{displayRole}</span>
          {/* 达人ID */}
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-text-tertiary">达人ID:</span>
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-bg-elevated">
              <span className="text-xs font-mono font-medium text-accent-indigo">{displayCreatorId}</span>
              <button
                type="button"
                onClick={handleCopyId}
                className="p-0.5 hover:bg-bg-card rounded transition-colors"
                title={copied ? '已复制' : '复制达人ID'}
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

      {/* 统计数据 */}
      <div className="flex items-center justify-around pt-4 border-t border-border-subtle">
        <div className="flex flex-col items-center gap-1">
          <span className="text-2xl font-bold text-text-primary">{stats.completed}</span>
          <span className="text-xs text-text-secondary">完成任务</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <span className="text-2xl font-bold text-accent-green">{passRate}%</span>
          <span className="text-xs text-text-secondary">通过率</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <span className="text-2xl font-bold text-accent-indigo">{stats.inProgress}</span>
          <span className="text-xs text-text-secondary">进行中</span>
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

export default function CreatorProfilePage() {
  const router = useRouter()
  const { logout } = useAuth()

  // 菜单项点击处理
  const handleMenuClick = (menuId: string) => {
    const routes: Record<string, string> = {
      personal: '/creator/profile/edit',
      account: '/creator/settings/account',
      notification: '/creator/settings/notification',
      history: '/creator/history',
      help: '/creator/help',
      appeal: '/creator/appeal-quota',
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
    <ResponsiveLayout role="creator">
      <div className="flex flex-col gap-6 h-full">
        {/* 顶部栏 */}
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl lg:text-[28px] font-bold text-text-primary">个人中心</h1>
          <p className="text-sm lg:text-[15px] text-text-secondary">管理您的账户信息和偏好设置</p>
        </div>

        {/* 内容区 - 响应式布局 */}
        <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0 overflow-y-auto lg:overflow-visible">
          {/* 用户卡片 */}
          <div className="lg:w-[360px] lg:flex-shrink-0">
            <UserCard />
          </div>

          {/* 菜单和退出 */}
          <div className="flex-1 flex flex-col gap-5 lg:overflow-y-auto lg:pr-2">
            <MenuCard onMenuClick={handleMenuClick} />
            <ThemeCard />
            <LogoutCard onLogout={handleLogout} />
          </div>
        </div>
      </div>
    </ResponsiveLayout>
  )
}
