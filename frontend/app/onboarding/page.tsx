'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { api, extractErrorMessage } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import type { User, UserRole } from '@/lib/api'
import { AlertCircle, Building2, User as UserIcon } from 'lucide-react'

const baseRoleOptions: { value: UserRole; label: string; desc: string; icon: string }[] = [
  { value: 'brand', label: '品牌方', desc: '创建项目、管理代理商、配置审核规则', icon: '🏢' },
  { value: 'agency', label: '代理商', desc: '管理达人、分配任务、审核内容', icon: '🤝' },
  { value: 'creator', label: '达人', desc: '上传脚本和视频、查看审核结果', icon: '🎬' },
]

const operatorRoleOption = {
  value: 'operator' as const,
  label: '代运营',
  desc: '独立管理项目、任务、规则、AI 配置与导出',
  icon: '🧠',
}

const platformOptions = [
  { value: 'douyin', label: '抖音' },
  { value: 'xiaohongshu', label: '小红书' },
  { value: 'bilibili', label: 'B站' },
]

export default function OnboardingPage() {
  const router = useRouter()
  const { setUserDirect } = useAuth()
  const [step, setStep] = useState<'role' | 'info'>('role')
  const [role, setRole] = useState<UserRole | null>(null)
  const [name, setName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [platform, setPlatform] = useState('douyin')
  const [platformAccount, setPlatformAccount] = useState('')
  const [operatorAccessCode, setOperatorAccessCode] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  // The server validates the configured code. The client only reveals the role once input exists.
  const operatorUnlocked = operatorAccessCode.trim().length > 0
  const roleOptions = operatorUnlocked ? [...baseRoleOptions, operatorRoleOption] : baseRoleOptions

  // 确保有 Logto token
  useEffect(() => {
    ;(async () => {
      if (!api.getToken()) {
        const tokenRes = await fetch('/api/auth/token')
        if (!tokenRes.ok) {
          router.push('/login')
          return
        }
        const data = await tokenRes.json()
        if (data.access_token) {
          api.setAccessToken(data.access_token)
        } else {
          router.push('/login')
        }
      }
    })()
  }, [router])

  useEffect(() => {
    if (!operatorUnlocked && role === 'operator') {
      setRole(null)
      setStep('role')
    }
  }, [operatorUnlocked, role])

  const handleSubmit = async () => {
    if (!role) return
    setError('')

    if (!name.trim()) {
      setError('请输入姓名')
      return
    }
    if ((role === 'brand' || role === 'agency') && !companyName.trim()) {
      setError('请输入公司名称')
      return
    }
    if (role === 'creator' && !platformAccount.trim()) {
      setError('请输入平台账号')
      return
    }
    if (role === 'operator' && !operatorUnlocked) {
      setError('请输入正确的代运营开通码')
      return
    }

    setIsLoading(true)

    try {
      const response = await api.onboarding({
        role,
        name: name.trim(),
        ...(role === 'brand' || role === 'agency' ? { company_name: companyName.trim() } : {}),
        ...(role === 'creator' ? { platform, platform_account: platformAccount.trim() } : {}),
        ...(role === 'operator' ? { operator_access_code: operatorAccessCode.trim() } : {}),
      })

      // 设置用户信息
      const userData: User = {
        id: response.id,
        email: response.email,
        phone: response.phone,
        name: response.name,
        avatar: response.avatar,
        role: response.role as UserRole,
        is_verified: response.is_verified,
        brand_id: response.brand_id,
        agency_id: response.agency_id,
        creator_id: response.creator_id,
        operator_id: response.operator_id,
        tenant_id: response.tenant_id,
        tenant_name: response.tenant_name,
      }
      setUserDirect(userData)
      router.push(`/${role}`)
    } catch (err) {
      setError(extractErrorMessage(err))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg-page flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-md space-y-8">
        {/* Logo */}
        <div className="text-center space-y-2">
          <img src="/logo.svg" alt="ContentGuard AI" className="w-16 h-16 object-contain mx-auto" />
          <h1 className="text-2xl font-bold text-text-primary">欢迎加入 ContentGuard AI</h1>
          <p className="text-text-secondary">请完善您的信息以开始使用</p>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 bg-accent-coral/10 text-accent-coral rounded-lg text-sm">
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        {/* Step 1: 选择角色 */}
        {step === 'role' && (
          <div className="space-y-4">
            <label className="block text-sm font-medium text-text-primary">选择您的身份</label>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-text-primary">代运营开通码</label>
              <input
                type="password"
                placeholder="如需开通代运营身份，请输入开通码"
                value={operatorAccessCode}
                onChange={(e) => setOperatorAccessCode(e.target.value)}
                className="w-full px-4 py-3.5 bg-bg-elevated border border-border-subtle rounded-xl text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-indigo focus:border-transparent transition-all"
              />
              <p className="text-xs text-text-tertiary">
                输入正确开通码后，将显示“代运营”身份入口。
              </p>
            </div>
            <div className="space-y-3">
              {roleOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setRole(opt.value)}
                  className={`w-full p-4 rounded-xl border text-left transition-all ${
                    role === opt.value
                      ? 'border-accent-indigo bg-accent-indigo/10'
                      : 'border-border-subtle bg-bg-card hover:bg-bg-elevated'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{opt.icon}</span>
                    <div>
                      <div className={`font-medium ${role === opt.value ? 'text-accent-indigo' : 'text-text-primary'}`}>
                        {opt.label}
                      </div>
                      <div className="text-sm text-text-secondary">{opt.desc}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            <button
              onClick={() => role && setStep('info')}
              disabled={!role}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-accent-indigo to-[#4F46E5] text-white font-semibold text-base shadow-[0px_8px_24px_-4px_rgba(99,102,241,0.4)] hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              下一步
            </button>
          </div>
        )}

        {/* Step 2: 填写信息 */}
        {step === 'info' && role && (
          <div className="space-y-5">
            <button
              onClick={() => setStep('role')}
              className="text-sm text-text-secondary hover:text-text-primary transition-colors"
            >
              ← 返回选择角色
            </button>

            {/* 姓名 */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-text-primary">姓名</label>
              <div className="relative">
                <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-text-tertiary" />
                <input
                  type="text"
                  placeholder="请输入姓名"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full pl-12 pr-4 py-3.5 bg-bg-elevated border border-border-subtle rounded-xl text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-indigo focus:border-transparent transition-all"
                />
              </div>
            </div>

            {/* 品牌方/代理商: 公司名称 */}
            {(role === 'brand' || role === 'agency') && (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-text-primary">公司名称</label>
                <div className="relative">
                  <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-text-tertiary" />
                  <input
                    type="text"
                    placeholder={role === 'brand' ? '请输入品牌/公司名称' : '请输入代理商公司名称'}
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    className="w-full pl-12 pr-4 py-3.5 bg-bg-elevated border border-border-subtle rounded-xl text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-indigo focus:border-transparent transition-all"
                  />
                </div>
              </div>
            )}

            {/* 达人: 平台 + 账号 */}
            {role === 'creator' && (
              <>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-text-primary">主要平台</label>
                  <div className="grid grid-cols-3 gap-2">
                    {platformOptions.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setPlatform(opt.value)}
                        className={`p-2.5 rounded-xl border text-center transition-all text-sm ${
                          platform === opt.value
                            ? 'border-accent-indigo bg-accent-indigo/10 text-accent-indigo font-medium'
                            : 'border-border-subtle bg-bg-card text-text-secondary hover:bg-bg-elevated'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-text-primary">平台账号</label>
                  <input
                    type="text"
                    placeholder="请输入平台账号"
                    value={platformAccount}
                    onChange={(e) => setPlatformAccount(e.target.value)}
                    className="w-full px-4 py-3.5 bg-bg-elevated border border-border-subtle rounded-xl text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-indigo focus:border-transparent transition-all"
                  />
                </div>
              </>
            )}

            <button
              onClick={handleSubmit}
              disabled={isLoading}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-accent-indigo to-[#4F46E5] text-white font-semibold text-base shadow-[0px_8px_24px_-4px_rgba(99,102,241,0.4)] hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {isLoading ? '提交中...' : '完成注册'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
