'use client'

import { StatusBar } from '../navigation/StatusBar'
import { BottomNav } from '../navigation/BottomNav'

interface MobileLayoutProps {
  children: React.ReactNode
  role?: 'creator' | 'agency' | 'brand'
  showStatusBar?: boolean
  showBottomNav?: boolean
  className?: string
}

export function MobileLayout({
  children,
  role = 'creator',
  showStatusBar = true,
  showBottomNav = true,
  className = '',
}: MobileLayoutProps) {
  return (
    <div className={`h-screen bg-bg-page flex flex-col overflow-hidden ${className}`}>
      {showStatusBar && <StatusBar />}
      <main className={`flex-1 overflow-y-auto overflow-x-hidden ${showBottomNav ? 'pb-[80px]' : ''}`}>
        <div className="min-h-full">
          {children}
        </div>
      </main>
      {showBottomNav && <BottomNav role={role} />}
    </div>
  )
}

export default MobileLayout
