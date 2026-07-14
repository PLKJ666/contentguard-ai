'use client'

import { useRouter } from 'next/navigation'
import { ArrowLeft, KeyRound, Mail, Shield, Smartphone } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'

const managedItems = [
  {
    icon: KeyRound,
    title: '密码与登录方式',
    description: '当前系统使用 Logto 统一认证，站内不再提供修改密码或本地登录入口。',
  },
  {
    icon: Shield,
    title: '两步验证与登录会话',
    description: '两步验证、设备下线和其他安全策略均由 Logto 侧统一管理。',
  },
  {
    icon: Mail,
    title: '邮箱绑定',
    description: '账户邮箱以统一认证侧资料为准，本页不再单独维护绑定状态。',
  },
  {
    icon: Smartphone,
    title: '手机绑定',
    description: '如需调整手机号或验证码能力，请在统一认证配置中处理。',
  },
]

export default function AgencyAccountSettingsPage() {
  const router = useRouter()

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => router.back()}
          className="p-2 rounded-lg hover:bg-bg-elevated transition-colors"
        >
          <ArrowLeft size={20} className="text-text-secondary" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-text-primary">账户设置</h1>
          <p className="text-sm text-text-secondary mt-0.5">统一认证与账号安全说明</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield size={18} className="text-accent-green" />
              统一认证
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border border-accent-green/20 bg-accent-green/10 p-4">
              <p className="text-sm font-medium text-text-primary">账号认证已切换为 Logto</p>
              <p className="text-sm text-text-secondary mt-2 leading-6">
                当前应用只消费 Logto 会话和访问令牌，不再维护站内密码、刷新令牌或本地两步验证设置。
              </p>
            </div>

            <div className="space-y-3">
              {managedItems.slice(0, 2).map((item) => {
                const Icon = item.icon
                return (
                  <div key={item.title} className="rounded-xl bg-bg-elevated p-4">
                    <div className="flex items-center gap-3">
                      <Icon size={18} className="text-text-secondary" />
                      <p className="font-medium text-text-primary">{item.title}</p>
                    </div>
                    <p className="text-sm text-text-secondary mt-2 leading-6">{item.description}</p>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail size={18} className="text-accent-indigo" />
              资料同步说明
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {managedItems.slice(2).map((item) => {
              const Icon = item.icon
              return (
                <div key={item.title} className="rounded-xl bg-bg-elevated p-4">
                  <div className="flex items-center gap-3">
                    <Icon size={18} className="text-text-secondary" />
                    <p className="font-medium text-text-primary">{item.title}</p>
                  </div>
                  <p className="text-sm text-text-secondary mt-2 leading-6">{item.description}</p>
                </div>
              )
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
