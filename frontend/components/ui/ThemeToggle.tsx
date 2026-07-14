'use client'

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { Sun, Moon, Monitor } from 'lucide-react'
import { cn } from '@/lib/utils'

const themes = [
  { value: 'light', icon: Sun, label: '浅色' },
  { value: 'dark', icon: Moon, label: '深色' },
  { value: 'system', icon: Monitor, label: '系统' },
] as const

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  if (!mounted) {
    return (
      <div className={cn('flex items-center gap-1 p-1 rounded-lg bg-bg-elevated', className)}>
        {themes.map((t) => (
          <div key={t.value} className="w-8 h-8 rounded-md" />
        ))}
      </div>
    )
  }

  return (
    <div className={cn('flex items-center gap-1 p-1 rounded-lg bg-bg-elevated', className)}>
      {themes.map((t) => {
        const Icon = t.icon
        const active = theme === t.value
        return (
          <button
            key={t.value}
            type="button"
            onClick={() => setTheme(t.value)}
            className={cn(
              'flex items-center justify-center w-8 h-8 rounded-md transition-colors',
              active
                ? 'bg-accent-indigo text-white'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-card'
            )}
            title={t.label}
          >
            <Icon size={16} />
          </button>
        )
      })}
    </div>
  )
}
