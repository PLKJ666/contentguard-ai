'use client'

import { useState, useEffect } from 'react'
import { Menu, X } from 'lucide-react'
import { Sidebar } from '../navigation/Sidebar'
import { cn } from '@/lib/utils'

interface ResponsiveLayoutProps {
  children: React.ReactNode
  role?: 'creator' | 'agency' | 'brand' | 'operator'
  className?: string
}

export function ResponsiveLayout({
  children,
  role = 'creator',
  className = '',
}: ResponsiveLayoutProps) {
  const [isMobile, setIsMobile] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 1024
      setIsMobile(mobile)
      // 大屏幕自动关闭抽屉
      if (!mobile) {
        setSidebarOpen(false)
      }
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // 点击遮罩关闭侧边栏
  const closeSidebar = () => setSidebarOpen(false)

  return (
    <div className={cn('h-screen bg-bg-page overflow-hidden', className)}>
      {/* 移动端：汉堡菜单按钮 */}
      {isMobile && !sidebarOpen && (
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="fixed top-4 left-4 z-50 w-10 h-10 rounded-xl bg-bg-card flex items-center justify-center card-shadow"
        >
          <Menu className="w-5 h-5 text-text-primary" />
        </button>
      )}

      {/* 移动端：遮罩层 */}
      {isMobile && sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 transition-opacity"
          onClick={closeSidebar}
        />
      )}

      {/* 侧边栏 */}
      <div
        className={cn(
          'fixed left-0 top-0 bottom-0 z-sidebar transition-transform duration-300',
          isMobile
            ? sidebarOpen
              ? 'translate-x-0'
              : '-translate-x-full'
            : 'translate-x-0'
        )}
      >
        <Sidebar role={role} />
        {/* 移动端：关闭按钮 */}
        {isMobile && sidebarOpen && (
          <button
            type="button"
            onClick={closeSidebar}
            className="absolute top-4 right-4 w-8 h-8 rounded-lg bg-bg-elevated flex items-center justify-center"
          >
            <X className="w-4 h-4 text-text-secondary" />
          </button>
        )}
      </div>

      {/* 主内容区 */}
      <main
        className={cn(
          'h-full overflow-y-auto overflow-x-hidden transition-all duration-300',
          isMobile ? 'ml-0 pt-16 px-4 pb-6' : 'ml-[260px] p-8'
        )}
      >
        <div className="min-h-full">
          {children}
        </div>
      </main>
    </div>
  )
}

export default ResponsiveLayout
