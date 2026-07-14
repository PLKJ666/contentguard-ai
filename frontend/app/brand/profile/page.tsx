'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  CircleUser,
  Settings,
  BellRing,
  MessageCircleQuestion,
  ChevronRight,
  LogOut,
  Copy,
  Check,
  Building2,
  Users,
  FolderKanban,
  FileCheck
} from 'lucide-react'
import { cn, copyToClipboard } from '@/lib/utils'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { api } from '@/lib/api'

// 菜单项数据
const menuItems = [
  {
    id: 'personal',
    icon: CircleUser,
    iconColor: 'text-accent-indigo',
    bgColor: 'bg-accent-indigo',
    title: '个人信息',
    subtitle: '头像、姓名、联系方式',
  },
  {
    id: 'company',
    icon: Building2,
    iconColor: 'text-accent-blue',
    bgColor: 'bg-accent-blue',
    title: '公司信息',
    subtitle: '品牌名称、公司简介',
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
    id: 'help',
    icon: MessageCircleQuestion,
    iconColor: 'text-text-secondary',
    bgColor: 'bg-bg-elevated',
    title: '帮助与反馈',
    subtitle: '常见问题、联系客服',
  },
]

// 品牌卡片组件
function BrandCard() {
  const toast = useToast()
  const { user } = useAuth()
  const [copied, setCopied] = useState(false)
  const [stats, setStats] = useState({ projects: 0, tasks: 0, agencies: 0, passRate: 0 })

  useEffect(() => {
    const loadStats = async () => {
      try {
        const dashboard = await api.getBrandDashboard()
        setStats({
          projects: dashboard.total_projects,
          tasks: dashboard.total_tasks,
          agencies: dashboard.total_agencies,
          passRate: dashboard.total_tasks > 0
            ? Math.round((dashboard.completed_tasks / dashboard.total_tasks) * 100)
            : 0,
        })
      } catch {
        // 静默失败
      }
    }
    loadStats()
  }, [])

  const displayName = user?.name || '品牌方'
  const displayInitial = user?.name?.[0] || '?'
  const displayBrandId = user?.brand_id || '--'
  const displayRole = user?.is_verified ? '品牌方 · 已认证' : '品牌方'
  const displayCompany = user?.tenant_name || '--'

  const handleCopyId = async () => {
    try {
      await copyToClipboard(displayBrandId)
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
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center"
          style={{
            background: 'linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)',
          }}
        >
          <span className="text-[32px] font-bold text-white">{displayInitial}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xl font-semibold text-text-primary">{displayName}</span>
          <span className="text-sm text-text-secondary">{displayRole}</span>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-text-tertiary">品牌ID:</span>
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-bg-elevated">
              <span className="text-xs font-mono font-medium text-accent-indigo">{displayBrandId}</span>
              <button
                type="button"
                onClick={handleCopyId}
                className="p-0.5 hover:bg-bg-card rounded transition-colors"
                title={copied ? '已复制' : '复制品牌ID'}
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
            <FolderKanban size={14} className="text-accent-indigo" />
            <span className="text-xl font-bold text-text-primary">{stats.projects}</span>
          </div>
          <span className="text-xs text-text-secondary">项目数</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <div className="flex items-center gap-1">
            <FileCheck size={14} className="text-accent-blue" />
            <span className="text-xl font-bold text-text-primary">{stats.tasks}</span>
          </div>
          <span className="text-xs text-text-secondary">任务数</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <div className="flex items-center gap-1">
            <Users size={14} className="text-accent-green" />
            <span className="text-xl font-bold text-text-primary">{stats.agencies}</span>
          </div>
          <span className="text-xs text-text-secondary">代理商</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <span className="text-xl font-bold text-accent-amber">{stats.passRate}%</span>
          <span className="text-xs text-text-secondary">通过率</span>
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
      <ChevronRight size={20} className="text-text-tertiary" />
    </button>
  )
}

// 菜单卡片
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

// 退出卡片
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

export default function BrandProfilePage() {
  const router = useRouter()
  const { logout } = useAuth()

  const handleMenuClick = (menuId: string) => {
    const routes: Record<string, string> = {
      personal: '/brand/profile/edit',
      company: '/brand/profile/edit',
      account: '/brand/settings',
      notification: '/brand/settings',
      help: '/brand/help',
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
        <p className="text-sm text-text-secondary">管理品牌方账户信息和偏好设置</p>
      </div>

      {/* 内容区 */}
      <div className="flex flex-col lg:flex-row gap-6">
        <div className="lg:w-[400px] lg:flex-shrink-0">
          <BrandCard />
        </div>
        <div className="flex-1 flex flex-col gap-5">
          <MenuCard onMenuClick={handleMenuClick} />
          <LogoutCard onLogout={handleLogout} />
        </div>
      </div>
    </div>
  )
}
