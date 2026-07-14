'use client'

import { useEffect } from 'react'
import { AlertTriangle, RefreshCw, Home } from 'lucide-react'

export default function CreatorError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Creator section error:', error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] gap-4">
      <div className="w-14 h-14 bg-accent-coral/15 rounded-2xl flex items-center justify-center">
        <AlertTriangle className="w-7 h-7 text-accent-coral" />
      </div>
      <h2 className="text-xl font-semibold text-text-primary">页面加载失败</h2>
      <p className="text-text-secondary text-sm max-w-sm text-center">
        {error.message || '发生未知错误，请重试'}
      </p>
      <div className="flex gap-3 mt-2">
        <button
          onClick={() => window.location.href = '/creator'}
          className="flex items-center gap-2 px-4 py-2.5 bg-bg-elevated text-text-secondary rounded-xl text-sm font-medium hover:bg-bg-card transition-colors border border-border-subtle"
        >
          <Home className="w-4 h-4" />
          回到首页
        </button>
        <button
          onClick={reset}
          className="flex items-center gap-2 px-4 py-2.5 bg-accent-indigo text-white rounded-xl text-sm font-medium hover:bg-accent-indigo/90 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          重试
        </button>
      </div>
    </div>
  )
}
