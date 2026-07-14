'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { useToast } from '@/components/ui/Toast'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import {
  ArrowLeft,
  BellRing,
  MessageSquare,
  Mail,
  Smartphone,
  FileText,
  Users,
  AlertTriangle
} from 'lucide-react'

// 通知设置类型
interface NotificationSetting {
  id: string
  icon: React.ElementType
  iconColor: string
  title: string
  description: string
  email: boolean
  push: boolean
  sms: boolean
}

// 通知设置数据
const initialSettings: NotificationSetting[] = [
  {
    id: 'review',
    icon: FileText,
    iconColor: 'text-accent-indigo',
    title: '审核任务通知',
    description: '有新任务待审核时通知',
    email: true,
    push: true,
    sms: false,
  },
  {
    id: 'appeal',
    icon: MessageSquare,
    iconColor: 'text-accent-amber',
    title: '申诉通知',
    description: '达人提交申诉时通知',
    email: true,
    push: true,
    sms: true,
  },
  {
    id: 'creator',
    icon: Users,
    iconColor: 'text-accent-green',
    title: '达人动态',
    description: '达人提交内容、完成任务时通知',
    email: false,
    push: true,
    sms: false,
  },
  {
    id: 'urgent',
    icon: AlertTriangle,
    iconColor: 'text-accent-coral',
    title: '紧急通知',
    description: '任务即将超时、品牌方催促等',
    email: true,
    push: true,
    sms: true,
  },
  {
    id: 'system',
    icon: BellRing,
    iconColor: 'text-accent-blue',
    title: '系统通知',
    description: '系统更新、维护公告等',
    email: true,
    push: false,
    sms: false,
  },
]

// 开关组件
function Toggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors ${
        checked ? 'bg-accent-indigo' : 'bg-bg-elevated'
      }`}
    >
      <span
        className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
          checked ? 'left-6' : 'left-1'
        }`}
      />
    </button>
  )
}

export default function AgencyNotificationSettingsPage() {
  const router = useRouter()
  const toast = useToast()
  const [settings, setSettings] = useState(initialSettings)
  const [isSaving, setIsSaving] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  // load preferences from backend
  useEffect(() => {
    ;(async () => {
      try {
        const res = await api.getNotificationSettings()
        const map = new Map(res.items.map(i => [i.id, i]))
        setSettings(prev =>
          prev.map(s => {
            const saved = map.get(s.id)
            if (!saved) return s
            return { ...s, email: saved.email, push: saved.push, sms: saved.sms }
          })
        )
      } catch {
        // keep defaults
      } finally {
        setIsLoading(false)
      }
    })()
  }, [])

  const updateSetting = (id: string, field: 'email' | 'push' | 'sms', value: boolean) => {
    setSettings(prev =>
      prev.map(s =>
        s.id === id ? { ...s, [field]: value } : s
      )
    )
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await api.updateNotificationSettings({
        items: settings.map(s => ({ id: s.id, email: s.email, push: s.push, sms: s.sms })),
      })
      toast.success('通知设置已保存')
    } catch {
      toast.error('保存失败，请稍后重试')
    }
    setIsSaving(false)
  }

  return (
    <div className="space-y-6">
      {/* 顶部导航 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => router.back()}
            className="p-2 rounded-lg hover:bg-bg-elevated transition-colors"
          >
            <ArrowLeft size={20} className="text-text-secondary" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-text-primary">消息设置</h1>
            <p className="text-sm text-text-secondary mt-0.5">管理您的通知偏好</p>
          </div>
        </div>
        <Button variant="primary" onClick={handleSave} disabled={isSaving}>
          {isSaving ? '保存中...' : '保存设置'}
        </Button>
      </div>

      {/* 通知渠道说明 */}
      <div className="flex gap-6 p-4 rounded-xl bg-bg-elevated">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-accent-indigo/15 flex items-center justify-center">
            <BellRing size={16} className="text-accent-indigo" />
          </div>
          <span className="text-sm text-text-secondary">App推送</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-accent-blue/15 flex items-center justify-center">
            <Mail size={16} className="text-accent-blue" />
          </div>
          <span className="text-sm text-text-secondary">邮件通知</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-accent-green/15 flex items-center justify-center">
            <Smartphone size={16} className="text-accent-green" />
          </div>
          <span className="text-sm text-text-secondary">短信通知</span>
        </div>
      </div>

      {/* 通知设置列表 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BellRing size={18} className="text-accent-indigo" />
            通知类型设置
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {/* 表头 */}
          <div className="flex items-center py-3 px-4 text-sm text-text-tertiary border-b border-border-subtle">
            <div className="flex-1">通知类型</div>
            <div className="w-20 text-center">App推送</div>
            <div className="w-20 text-center">邮件</div>
            <div className="w-20 text-center">短信</div>
          </div>

          {/* 设置项 */}
          {settings.map((setting) => {
            const Icon = setting.icon
            return (
              <div
                key={setting.id}
                className="flex items-center py-4 px-4 hover:bg-bg-elevated/50 rounded-lg transition-colors"
              >
                <div className="flex-1 flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg bg-opacity-15 flex items-center justify-center`}
                    style={{ backgroundColor: `${setting.iconColor.replace('text-', '')}15` }}
                  >
                    <Icon size={20} className={setting.iconColor} />
                  </div>
                  <div>
                    <p className="font-medium text-text-primary">{setting.title}</p>
                    <p className="text-sm text-text-tertiary">{setting.description}</p>
                  </div>
                </div>
                <div className="w-20 flex justify-center">
                  <Toggle
                    checked={setting.push}
                    onChange={(v) => updateSetting(setting.id, 'push', v)}
                  />
                </div>
                <div className="w-20 flex justify-center">
                  <Toggle
                    checked={setting.email}
                    onChange={(v) => updateSetting(setting.id, 'email', v)}
                  />
                </div>
                <div className="w-20 flex justify-center">
                  <Toggle
                    checked={setting.sms}
                    onChange={(v) => updateSetting(setting.id, 'sms', v)}
                  />
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* 免打扰设置 */}
      <Card>
        <CardHeader>
          <CardTitle>免打扰设置</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-4 rounded-xl bg-bg-elevated">
            <div>
              <p className="font-medium text-text-primary">夜间免打扰</p>
              <p className="text-sm text-text-tertiary">22:00 - 08:00 期间不发送推送通知</p>
            </div>
            <Toggle checked={true} onChange={() => {}} />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
