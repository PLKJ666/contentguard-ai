'use client'

import { Signal, Wifi, BatteryFull } from 'lucide-react'

interface StatusBarProps {
  time?: string
  className?: string
}

export function StatusBar({ time = '9:41', className = '' }: StatusBarProps) {
  return (
    <div className={`flex items-center justify-between h-[44px] px-6 w-full ${className}`}>
      <span className="text-text-primary font-semibold text-[17px]" style={{ fontFamily: 'Inter' }}>
        {time}
      </span>
      <div className="flex items-center gap-1.5">
        <Signal className="w-[18px] h-[18px] text-text-primary" />
        <Wifi className="w-[18px] h-[18px] text-text-primary" />
        <BatteryFull className="w-6 h-[18px] text-text-primary" />
      </div>
    </div>
  )
}

export default StatusBar
