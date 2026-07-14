/**
 * 认证相关类型定义
 * 注意：这些类型应与 @/lib/api 中的类型保持一致
 */

export type UserRole = 'creator' | 'agency' | 'brand' | 'operator'

export interface User {
  id: string
  email?: string
  phone?: string
  name: string
  avatar?: string
  role: UserRole
  is_verified: boolean
  brand_id?: string
  agency_id?: string
  creator_id?: string
  operator_id?: string
  tenant_id?: string
  tenant_name?: string
}

export interface LoginCredentials {
  email?: string
  phone?: string
  password: string
}

export interface RegisterData {
  email?: string
  phone?: string
  password: string
  name: string
  role: UserRole
}

export interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
}

export interface AuthContextType extends AuthState {
  login: (credentials: LoginCredentials) => Promise<{ success: boolean; error?: string }>
  register: (data: RegisterData) => Promise<{ success: boolean; error?: string }>
  logout: () => void
  switchRole: (role: UserRole) => void
}
