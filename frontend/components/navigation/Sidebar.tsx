'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  ListTodo,
  User,
  LayoutDashboard,
  Scan,
  BarChart3,
  Settings,
  FileText,
  Users,
  Bell,
  FolderKanban,
  PlusCircle,
  ClipboardCheck,
  Bot,
  MessageSquare,
  Sparkles,
  ScrollText
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { ThemeToggle } from '@/components/ui/ThemeToggle'

interface NavItem {
  icon: React.ElementType
  label: string
  href: string
  badge?: 'dot' | 'warning' | number // 支持红点、警告或数字徽章
}

// 达人端导航项
const creatorNavItems: NavItem[] = [
  { icon: ListTodo, label: '我的任务', href: '/creator' },
  { icon: Bell, label: '消息中心', href: '/creator/messages' },
  { icon: User, label: '个人中心', href: '/creator/profile' },
  { icon: ScrollText, label: '更新日志', href: '/creator/changelog' },
]

// 代理商端导航项
const agencyNavItems: NavItem[] = [
  { icon: LayoutDashboard, label: '工作台', href: '/agency' },
  { icon: Scan, label: '审核台', href: '/agency/review' },
  { icon: Sparkles, label: '小红书改写', href: '/agency/xhs' },
  { icon: Bot, label: 'AI 配置', href: '/agency/ai-config' },
  { icon: MessageSquare, label: '申诉处理', href: '/agency/appeals' },
  { icon: FileText, label: '任务配置', href: '/agency/briefs' },
  { icon: Users, label: '达人管理', href: '/agency/creators' },
  { icon: BarChart3, label: '数据报表', href: '/agency/reports' },
  { icon: Bell, label: '消息中心', href: '/agency/messages' },
  { icon: User, label: '个人中心', href: '/agency/profile' },
  { icon: ScrollText, label: '更新日志', href: '/agency/changelog' },
]

const operatorNavItems: NavItem[] = [
  { icon: LayoutDashboard, label: '工作台', href: '/operator' },
  { icon: FileText, label: '规则配置', href: '/operator/rules' },
  { icon: FolderKanban, label: '项目管理', href: '/operator/projects' },
  { icon: Users, label: '任务管理', href: '/operator/tasks' },
  { icon: Sparkles, label: '小红书改写', href: '/operator/xhs' },
  { icon: Bot, label: 'AI 配置', href: '/operator/ai-config' },
  { icon: User, label: '个人中心', href: '/operator/profile' },
  { icon: ScrollText, label: '更新日志', href: '/operator/changelog' },
]

// 品牌方端导航项
const brandNavItems: NavItem[] = [
  { icon: FolderKanban, label: '项目看板', href: '/brand' },
  { icon: PlusCircle, label: '创建项目', href: '/brand/projects/create' },
  { icon: ClipboardCheck, label: '终审台', href: '/brand/review' },
  { icon: Bell, label: '消息中心', href: '/brand/messages' },
  { icon: Users, label: '代理商管理', href: '/brand/agencies' },
  { icon: FileText, label: '规则配置', href: '/brand/rules' },
  { icon: Bot, label: 'AI 配置', href: '/brand/ai-config' },
  { icon: User, label: '个人中心', href: '/brand/profile' },
  { icon: Settings, label: '系统设置', href: '/brand/settings' },
  { icon: ScrollText, label: '更新日志', href: '/brand/changelog' },
]

interface SidebarProps {
  role?: 'creator' | 'agency' | 'brand' | 'operator'
  aiServiceError?: boolean // AI 服务是否异常
}

export function Sidebar({ role = 'creator', aiServiceError = false }: SidebarProps) {
  const pathname = usePathname() || ''
  const [unreadCount, setUnreadCount] = useState(0)

  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await api.getUnreadCount()
      setUnreadCount(res.count)
    } catch {
      // 忽略错误（未登录等）
    }
  }, [])

  useEffect(() => {
    fetchUnreadCount()
    const timer = setInterval(fetchUnreadCount, 30000) // 每 30 秒轮询
    return () => clearInterval(timer)
  }, [fetchUnreadCount])

  // 消息中心路径
  const messagesHref = `/${role}/messages`

  // 根据 aiServiceError 和 unreadCount 动态设置徽章
  const applyBadges = (items: NavItem[]): NavItem[] => {
    return items.map(item => {
      if ((item.href === '/brand/ai-config' || item.href === '/agency/ai-config' || item.href === '/operator/ai-config') && aiServiceError) {
        return { ...item, badge: 'warning' as const }
      }
      if (item.href === messagesHref && unreadCount > 0) {
        return { ...item, badge: 'dot' as const }
      }
      return item
    })
  }

  const baseItems = role === 'creator'
    ? creatorNavItems
    : role === 'agency'
      ? agencyNavItems
      : role === 'operator'
        ? operatorNavItems
      : brandNavItems

  const navItems = applyBadges(baseItems)

  const isActive = (href: string) => {
    if (href === `/${role}`) {
      return pathname === href || pathname === `/${role}/`
    }
    return pathname.startsWith(href)
  }

  return (
    <aside className="fixed left-0 top-0 bottom-0 z-sidebar w-[260px] bg-bg-card/80 backdrop-blur-xl border-r border-border-subtle/30 flex flex-col shadow-[1px_0_0_rgba(255,255,255,0.02)]">
      {/* Logo 区域 */}
      <div className="flex items-center gap-3 px-7 py-8">
        <div className="relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-accent-indigo to-accent-coral rounded-full opacity-20 group-hover:opacity-40 transition duration-500 blur"></div>
          <img src="/logo.svg" alt="ContentGuard AI" className="relative w-10 h-10 object-contain flex-shrink-0" />
        </div>
        <div className="flex flex-col">
          <span className="text-xl font-bold text-text-primary tracking-tight leading-tight">ContentGuard</span>
          <span className="text-[10px] font-semibold tracking-[0.3em] text-text-tertiary uppercase opacity-60">COMPLIANCE AI</span>
        </div>
      </div>

      {/* 导航列表 */}
      <nav className="flex-1 px-4 py-2 overflow-y-auto custom-scrollbar">
        <div className="flex flex-col gap-1.5">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = isActive(item.href)

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'relative group flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-300 ease-in-out overflow-hidden',
                  active
                    ? 'bg-accent-indigo/10 text-text-primary'
                    : 'text-text-secondary hover:bg-bg-elevated/40 hover:text-text-primary'
                )}
              >
                {/* Active Indicator Bar */}
                {active && (
                  <div className="absolute left-0 top-1/4 bottom-1/4 w-[3px] bg-accent-indigo rounded-r-full shadow-[0_0_8px_rgba(99,102,241,0.5)]" />
                )}
                
                <div className="relative z-10">
                  <Icon className={cn(
                    "w-5 h-5 transition-transform duration-300",
                    active ? "text-accent-indigo scale-110" : "group-hover:scale-110"
                  )} />
                  {/* 警告徽章 */}
                  {item.badge === 'warning' && (
                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-accent-coral rounded-full border-2 border-bg-card animate-pulse shadow-[0_0_8px_rgba(232,90,79,0.5)]" />
                  )}
                  {/* 红点徽章 */}
                  {item.badge === 'dot' && (
                    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-accent-coral rounded-full shadow-[0_0_4px_rgba(232,90,79,0.3)]" />
                  )}
                </div>
                
                <span className={cn(
                  "text-[14px] flex-1 z-10 tracking-wide transition-all duration-300",
                  active ? "font-semibold translate-x-1" : "font-medium"
                )}>
                  {item.label}
                </span>
                
                {/* 数字徽章 */}
                {typeof item.badge === 'number' && item.badge > 0 && (
                  <span className="relative z-10 px-1.5 py-0.5 text-[10px] bg-accent-coral text-white rounded-full min-w-[18px] text-center font-bold shadow-sm">
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      </nav>

      {/* 主题切换 */}
      <div className="px-6 py-5 border-t border-border-subtle/30 bg-bg-card/40 backdrop-blur-md">
        <ThemeToggle className="w-full justify-between" />
      </div>
    </aside>
  )
}

export default Sidebar
