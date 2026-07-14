'use client'

import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react'
import { api, clearTokens, User, UserRole } from '@/lib/api'
import { markForceFreshSignIn } from '@/lib/signIn'

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
}

interface AuthContextType extends AuthState {
  logout: () => void
  switchRole: (role: UserRole) => void
  /** 设置用户（供 post-login / onboarding 页使用） */
  setUserDirect: (user: User) => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const USER_STORAGE_KEY = 'contentguard_user'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // 初始化：检查 Logto session → 获取用户信息
  useEffect(() => {
    if (typeof window === 'undefined') return

    ;(async () => {
      try {
        const tokenRes = await fetch('/api/auth/token')
        if (!tokenRes.ok) {
          setIsLoading(false)
          return
        }

        const tokenData = await tokenRes.json()
        if (tokenData.access_token) {
          api.setAccessToken(tokenData.access_token)

          try {
            const me = await api.getMe()
            if (!me.needs_onboarding && me.id && me.role) {
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
              if (userData.tenant_id) {
                api.setTenantId(userData.tenant_id)
              }
              setUser(userData)
              localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(userData))
            }
          } catch {
            // /auth/me 失败，不做处理
          }
        }
      } catch {
        // fetch 失败，忽略
      } finally {
        setIsLoading(false)
      }
    })()
  }, [])

  const logout = useCallback(() => {
    // 先跳转再清状态，避免 AuthGuard 检测到未认证抢先 push('/login')
    clearTokens()
    markForceFreshSignIn()
    setUser(null)
    localStorage.removeItem(USER_STORAGE_KEY)
    window.location.href = '/api/auth/sign-out'
  }, [])

  const switchRole = useCallback((role: UserRole) => {
    if (user) {
      const updated = { ...user, role }
      setUser(updated)
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(updated))
    }
  }, [user])

  const setUserDirect = useCallback((userData: User) => {
    if (userData.tenant_id) {
      api.setTenantId(userData.tenant_id)
    }
    setUser(userData)
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(userData))
  }, [])

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        logout,
        switchRole,
        setUserDirect,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
