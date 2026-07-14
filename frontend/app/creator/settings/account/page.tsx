'use client'

import { useRouter } from 'next/navigation'
import { ArrowLeft, KeyRound, Monitor, ShieldCheck, Smartphone } from 'lucide-react'
import { ResponsiveLayout } from '@/components/layout/ResponsiveLayout'

const authManagedItems = [
  {
    icon: KeyRound,
    title: '密码管理',
    description: '密码由 Logto 统一管理，站内不再提供修改密码入口。',
  },
  {
    icon: ShieldCheck,
    title: '两步验证',
    description: '两步验证、安全策略和风险控制均由统一认证侧处理。',
  },
  {
    icon: Monitor,
    title: '登录设备与会话',
    description: '设备下线、会话回收等操作不再在当前应用内维护。',
  },
  {
    icon: Smartphone,
    title: '手机号与验证能力',
    description: '手机号绑定和验证码相关配置请在 Logto 侧更新。',
  },
]

export default function AccountSettingsPage() {
  const router = useRouter()

  return (
    <ResponsiveLayout role="creator">
      <div className="flex flex-col gap-6 h-full">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => router.back()}
            className="w-10 h-10 rounded-xl bg-bg-elevated flex items-center justify-center hover:bg-bg-elevated/80 transition-colors"
          >
            <ArrowLeft size={20} className="text-text-secondary" />
          </button>
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl lg:text-[28px] font-bold text-text-primary">账户设置</h1>
            <p className="text-sm lg:text-[15px] text-text-secondary">统一认证与账号安全说明</p>
          </div>
        </div>

        <div className="flex flex-col gap-5 flex-1 min-h-0 overflow-y-auto lg:max-w-2xl">
          <div className="rounded-3xl border border-accent-green/20 bg-accent-green/10 p-5">
            <div className="flex items-center gap-3">
              <ShieldCheck size={20} className="text-accent-green" />
              <p className="text-base font-semibold text-text-primary">当前系统使用 Logto 统一认证</p>
            </div>
            <p className="text-sm text-text-secondary mt-3 leading-6">
              站内原有的密码修改、两步验证和设备管理入口已经停用。应用现在只读取 Logto 会话与访问令牌，避免本地认证状态与统一认证状态不一致。
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <h2 className="text-base font-semibold text-text-primary px-1">认证管理范围</h2>
            <div className="bg-bg-card rounded-2xl card-shadow overflow-hidden">
              {authManagedItems.map((item, index) => {
                const Icon = item.icon
                return (
                  <div
                    key={item.title}
                    className={`px-5 py-5 ${index < authManagedItems.length - 1 ? 'border-b border-border-subtle' : ''}`}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-bg-elevated">
                        <Icon size={20} className="text-text-secondary" />
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-[15px] font-medium text-text-primary">{item.title}</span>
                        <span className="text-[13px] leading-6 text-text-tertiary">{item.description}</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </ResponsiveLayout>
  )
}
