'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import type { User } from '@/lib/api'

export default function PostLoginPage() {
  const router = useRouter()
  const { setUserDirect } = useAuth()
  const [error, setError] = useState('')

  useEffect(() => {
    ;(async () => {
      try {
        // 1. 从 Logto session 获取 access token
        const tokenRes = await fetch('/api/auth/token')
        if (!tokenRes.ok) {
          setError('获取 Token 失败，请重新登录')
          setTimeout(() => router.push('/login'), 2000)
          return
        }

        const tokenData = await tokenRes.json()
        if (!tokenData.access_token) {
          setError('Token 无效，请重新登录')
          setTimeout(() => router.push('/login'), 2000)
          return
        }

        api.setAccessToken(tokenData.access_token)

        // 2. 调 /auth/me 检查用户状态
        const me = await api.getMe()

        if (me.needs_onboarding) {
          // 新用户 → onboarding
          router.push('/onboarding')
          return
        }

        // 已注册用户 → 设置用户信息 → 跳转 dashboard
        if (me.id && me.role) {
          const userData: User = {
            id: me.id,
            email: me.email,
            phone: me.phone,
            name: me.name || '',
            avatar: me.avatar,
            role: me.role,
            is_verified: me.is_verified ?? true,
            brand_id: me.brand_id,
            agency_id: me.agency_id,
            creator_id: me.creator_id,
            operator_id: me.operator_id,
            tenant_id: me.tenant_id,
            tenant_name: me.tenant_name,
          }
          setUserDirect(userData)
          router.push(`/${me.role}`)
        }
      } catch (err) {
        console.error('Post-login error:', err)
        setError('登录处理失败，请重试')
        setTimeout(() => router.push('/login'), 2000)
      }
    })()
  }, [router, setUserDirect])

  return (
    <div className="min-h-screen bg-bg-page flex flex-col items-center justify-center">
      {error ? (
        <div className="text-center space-y-3">
          <p className="text-accent-coral">{error}</p>
          <p className="text-sm text-text-tertiary">正在跳转...</p>
        </div>
      ) : (
        <div className="text-center space-y-4">
          <div className="w-10 h-10 border-2 border-accent-indigo border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-text-secondary">正在处理登录...</p>
        </div>
      )}
    </div>
  )
}
