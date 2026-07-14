'use client'

import { useEffect } from 'react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Application error:', error)
  }, [error])

  return (
    <div className="min-h-screen bg-bg-page flex items-center justify-center">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 bg-accent-coral/15 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8 text-accent-coral" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </div>
        <h2 className="text-2xl font-semibold text-text-primary mb-2">
          出错了
        </h2>
        <p className="text-text-secondary mb-8">
          应用遇到了一个错误，请尝试刷新页面
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={() => window.location.href = '/'}
            className="px-6 py-3 bg-bg-elevated text-text-secondary rounded-xl font-medium hover:bg-bg-card transition-colors border border-border-subtle"
          >
            返回首页
          </button>
          <button
            onClick={reset}
            className="px-6 py-3 bg-accent-indigo text-white rounded-xl font-medium hover:bg-accent-indigo/90 transition-colors"
          >
            重试
          </button>
        </div>
      </div>
    </div>
  )
}
