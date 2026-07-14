'use client'

import { useEffect } from 'react'

export default function RegisterPage() {
  useEffect(() => {
    // 直接跳 Logto 注册页
    window.location.href = '/api/auth/sign-up'
  }, [])

  return (
    <div className="min-h-screen bg-bg-page flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="w-10 h-10 border-2 border-accent-indigo border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-text-secondary">正在跳转注册...</p>
      </div>
    </div>
  )
}
