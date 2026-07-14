'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { getSignInUrl } from '@/lib/signIn'

export default function LoginPage() {
  const router = useRouter()
  const { isAuthenticated, isLoading, user } = useAuth()

  useEffect(() => {
    if (isLoading) return

    if (isAuthenticated && user) {
      router.replace(`/${user.role}`)
      return
    }

    if (typeof window !== 'undefined') {
      window.location.href = getSignInUrl()
    }
  }, [isAuthenticated, isLoading, router, user])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-bg-page flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-10 h-10 border-2 border-accent-indigo border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-text-secondary">正在检查登录状态...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg-page flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="w-10 h-10 border-2 border-accent-indigo border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-text-secondary">正在跳转统一登录...</p>
        <p className="text-xs text-text-tertiary">
          新账号登录后会自动进入角色选择与资料填写
        </p>
      </div>
    </div>
  )
}
