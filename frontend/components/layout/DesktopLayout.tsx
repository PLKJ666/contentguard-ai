'use client'

import { Sidebar } from '../navigation/Sidebar'

interface DesktopLayoutProps {
  children: React.ReactNode
  role?: 'creator' | 'agency' | 'brand' | 'operator'
  className?: string
  aiServiceError?: boolean // AI 服务异常状态（仅品牌方使用）
}

export function DesktopLayout({
  children,
  role = 'creator',
  className = '',
  aiServiceError = false,
}: DesktopLayoutProps) {
  return (
    <div className={`h-screen bg-bg-page flex overflow-hidden ${className}`}>
      <Sidebar role={role} aiServiceError={role === 'brand' ? aiServiceError : false} />
      <main className="flex-1 ml-[260px] p-8 overflow-y-auto overflow-x-hidden">
        <div className="min-h-full">
          {children}
        </div>
      </main>
    </div>
  )
}

export default DesktopLayout
