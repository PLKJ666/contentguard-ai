'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { UserRole } from '@/types/auth'

interface AuthGuardProps {
  children: React.ReactNode
  allowedRoles?: UserRole[]
}

export function AuthGuard({ children, allowedRoles }: AuthGuardProps) {
  const router = useRouter()
  const { user, isAuthenticated, isLoading } = useAuth()

  useEffect(() => {
    if (!isLoading) {
      if (!isAuthenticated) {
        router.push('/login')
        return
      }

      if (allowedRoles && user && !allowedRoles.includes(user.role)) {
        // 重定向到用户对应的默认页面
        switch (user.role) {
          case 'creator':
            router.push('/creator')
            break
          case 'agency':
            router.push('/agency')
            break
          case 'brand':
            router.push('/brand')
            break
          case 'operator':
            router.push('/operator')
            break
          default:
            router.push('/login')
        }
      }
    }
  }, [isLoading, isAuthenticated, user, allowedRoles, router])

  // 加载中
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    )
  }

  // 未认证
  if (!isAuthenticated) {
    return null
  }

  // 角色不匹配
  if (allowedRoles && user && !allowedRoles.includes(user.role)) {
    return null
  }

  return <>{children}</>
}
