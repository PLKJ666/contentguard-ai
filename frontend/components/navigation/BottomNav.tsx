'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ClipboardList, Bell, User, Scan, ListTodo, LayoutDashboard, Settings, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

interface NavItem {
  icon: React.ElementType
  label: string
  href: string
}

// 达人端导航项
const creatorNavItems: NavItem[] = [
  { icon: ClipboardList, label: '任务', href: '/creator' },
  { icon: Bell, label: '消息', href: '/creator/messages' },
  { icon: User, label: '我的', href: '/creator/profile' },
]

// 代理商端导航项
const agencyNavItems: NavItem[] = [
  { icon: LayoutDashboard, label: '工作台', href: '/agency' },
  { icon: ListTodo, label: '任务', href: '/agency/tasks' },
  { icon: Scan, label: '审核', href: '/agency/review' },
  { icon: Bell, label: '消息', href: '/agency/messages' },
  { icon: User, label: '我的', href: '/agency/profile' },
]

const operatorNavItems: NavItem[] = [
  { icon: LayoutDashboard, label: '工作台', href: '/operator' },
  { icon: ListTodo, label: '项目', href: '/operator/projects' },
  { icon: Scan, label: '任务', href: '/operator/tasks' },
  { icon: Sparkles, label: '改写', href: '/operator/xhs' },
  { icon: Settings, label: '配置', href: '/operator/rules' },
  { icon: User, label: '我的', href: '/operator/profile' },
]

// 品牌方端导航项
const brandNavItems: NavItem[] = [
  { icon: LayoutDashboard, label: '看板', href: '/brand' },
  { icon: Settings, label: '配置', href: '/brand/rules' },
  { icon: Bell, label: '消息', href: '/brand/messages' },
  { icon: User, label: '我的', href: '/brand/profile' },
]

interface BottomNavProps {
  role?: 'creator' | 'agency' | 'brand' | 'operator'
}

export function BottomNav({ role = 'creator' }: BottomNavProps) {
  const pathname = usePathname() || ''

  const navItems = role === 'creator'
    ? creatorNavItems
    : role === 'agency'
      ? agencyNavItems
      : role === 'operator'
        ? operatorNavItems
      : brandNavItems

  const isActive = (href: string) => {
    if (href === `/${role}`) {
      return pathname === href || pathname === `/${role}/`
    }
    return pathname.startsWith(href)
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-bottom-nav bottom-nav-gradient h-[95px] flex flex-col justify-end px-[21px] pb-[21px] pt-3">
      <div className="flex items-center justify-around bg-bg-elevated rounded-[31px] h-[62px] p-1 nav-shadow border border-border-subtle">
        {navItems.map((item) => {
          const Icon = item.icon
          const active = isActive(item.href)

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center justify-center gap-1 w-14 h-full',
                active ? 'text-text-primary' : 'text-text-secondary'
              )}
            >
              <Icon className={cn('w-6 h-6', active && 'text-text-primary')} strokeWidth={active ? 2 : 1.5} />
              <span className={cn(
                'text-[10px]',
                active ? 'font-semibold' : 'font-medium'
              )}>
                {item.label}
              </span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

export default BottomNav
