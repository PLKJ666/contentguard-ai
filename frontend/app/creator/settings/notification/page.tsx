'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Mail,
  Bell,
  MessageSquare,
  Clock,
  AlertTriangle,
} from 'lucide-react'
import { ResponsiveLayout } from '@/components/layout/ResponsiveLayout'
import { cn } from '@/lib/utils'

// 开关组件
function Toggle({
  enabled,
  onChange,
}: {
  enabled: boolean
  onChange: (enabled: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className={cn(
        'w-12 h-7 rounded-full p-0.5 transition-colors',
        enabled ? 'bg-accent-indigo' : 'bg-bg-elevated'
      )}
    >
      <div
        className={cn(
          'w-6 h-6 rounded-full bg-white shadow-sm transition-transform',
          enabled ? 'translate-x-5' : 'translate-x-0'
        )}
      />
    </button>
  )
}

// 设置项组件
function NotificationSettingItem({
  icon: Icon,
  iconColor,
  title,
  description,
  enabled,
  onChange,
  isLast = false,
}: {
  icon: React.ElementType
  iconColor: string
  title: string
  description: string
  enabled: boolean
  onChange: (enabled: boolean) => void
  isLast?: boolean
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between py-5 px-5',
        !isLast && 'border-b border-border-subtle'
      )}
    >
      <div className="flex items-center gap-4">
        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', `${iconColor}/15`)}>
          <Icon size={20} className={iconColor} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[15px] font-medium text-text-primary">{title}</span>
          <span className="text-[13px] text-text-tertiary">{description}</span>
        </div>
      </div>
      <Toggle enabled={enabled} onChange={onChange} />
    </div>
  )
}

// 时段选择组件
function TimeRangeSelector({
  startTime,
  endTime,
  onChange,
  disabled,
}: {
  startTime: string
  endTime: string
  onChange: (start: string, end: string) => void
  disabled: boolean
}) {
  return (
    <div className={cn('flex items-center gap-3', disabled && 'opacity-50')}>
      <select
        value={startTime}
        onChange={(e) => onChange(e.target.value, endTime)}
        disabled={disabled}
        className="px-3 py-2 rounded-lg bg-bg-elevated border border-border-default text-text-primary text-sm focus:outline-none focus:border-accent-indigo"
      >
        {Array.from({ length: 24 }, (_, i) => (
          <option key={i} value={`${i.toString().padStart(2, '0')}:00`}>
            {i.toString().padStart(2, '0')}:00
          </option>
        ))}
      </select>
      <span className="text-text-tertiary">至</span>
      <select
        value={endTime}
        onChange={(e) => onChange(startTime, e.target.value)}
        disabled={disabled}
        className="px-3 py-2 rounded-lg bg-bg-elevated border border-border-default text-text-primary text-sm focus:outline-none focus:border-accent-indigo"
      >
        {Array.from({ length: 24 }, (_, i) => (
          <option key={i} value={`${i.toString().padStart(2, '0')}:00`}>
            {i.toString().padStart(2, '0')}:00
          </option>
        ))}
      </select>
    </div>
  )
}

export default function NotificationSettingsPage() {
  const router = useRouter()

  // 通知设置状态
  const [settings, setSettings] = useState({
    emailNotification: true,
    pushNotification: true,
    smsNotification: false,
    reviewResult: true,
    taskReminder: true,
    urgentAlert: true,
    quietMode: false,
    quietStart: '22:00',
    quietEnd: '08:00',
  })

  const handleToggle = (key: keyof typeof settings) => {
    setSettings(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const handleTimeChange = (start: string, end: string) => {
    setSettings(prev => ({ ...prev, quietStart: start, quietEnd: end }))
  }

  return (
    <ResponsiveLayout role="creator">
      <div className="flex flex-col gap-6 h-full">
        {/* 顶部栏 */}
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => router.back()}
            className="w-10 h-10 rounded-xl bg-bg-elevated flex items-center justify-center hover:bg-bg-elevated/80 transition-colors"
          >
            <ArrowLeft size={20} className="text-text-secondary" />
          </button>
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl lg:text-[28px] font-bold text-text-primary">消息设置</h1>
            <p className="text-sm lg:text-[15px] text-text-secondary">自定义通知方式和提醒偏好</p>
          </div>
        </div>

        {/* 内容区 */}
        <div className="flex flex-col gap-5 flex-1 min-h-0 overflow-y-auto lg:max-w-2xl">
          {/* 通知渠道 */}
          <div className="flex flex-col gap-3">
            <h2 className="text-base font-semibold text-text-primary px-1">通知渠道</h2>
            <div className="bg-bg-card rounded-2xl card-shadow overflow-hidden">
              <NotificationSettingItem
                icon={Mail}
                iconColor="text-accent-indigo"
                title="邮件通知"
                description="接收审核结果和系统通知的邮件提醒"
                enabled={settings.emailNotification}
                onChange={() => handleToggle('emailNotification')}
              />
              <NotificationSettingItem
                icon={Bell}
                iconColor="text-accent-blue"
                title="推送通知"
                description="接收移动端实时推送消息"
                enabled={settings.pushNotification}
                onChange={() => handleToggle('pushNotification')}
              />
              <NotificationSettingItem
                icon={MessageSquare}
                iconColor="text-accent-green"
                title="短信通知"
                description="接收重要消息的短信提醒"
                enabled={settings.smsNotification}
                onChange={() => handleToggle('smsNotification')}
                isLast
              />
            </div>
          </div>

          {/* 通知类型 */}
          <div className="flex flex-col gap-3">
            <h2 className="text-base font-semibold text-text-primary px-1">通知类型</h2>
            <div className="bg-bg-card rounded-2xl card-shadow overflow-hidden">
              <NotificationSettingItem
                icon={Bell}
                iconColor="text-accent-indigo"
                title="审核结果通知"
                description="视频审核通过或驳回时收到通知"
                enabled={settings.reviewResult}
                onChange={() => handleToggle('reviewResult')}
              />
              <NotificationSettingItem
                icon={Clock}
                iconColor="text-accent-coral"
                title="任务提醒"
                description="任务截止日期临近时收到提醒"
                enabled={settings.taskReminder}
                onChange={() => handleToggle('taskReminder')}
              />
              <NotificationSettingItem
                icon={AlertTriangle}
                iconColor="text-status-error"
                title="紧急通知"
                description="紧急事项和系统公告即时推送"
                enabled={settings.urgentAlert}
                onChange={() => handleToggle('urgentAlert')}
                isLast
              />
            </div>
          </div>

          {/* 免打扰模式 */}
          <div className="flex flex-col gap-3">
            <h2 className="text-base font-semibold text-text-primary px-1">免打扰模式</h2>
            <div className="bg-bg-card rounded-2xl card-shadow p-5 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1">
                  <span className="text-[15px] font-medium text-text-primary">开启免打扰</span>
                  <span className="text-[13px] text-text-tertiary">在指定时段内静音所有通知</span>
                </div>
                <Toggle enabled={settings.quietMode} onChange={() => handleToggle('quietMode')} />
              </div>

              {/* 时间段选择 */}
              <div
                className={cn(
                  'flex flex-col lg:flex-row lg:items-center gap-3 pt-3 border-t border-border-subtle',
                  !settings.quietMode && 'opacity-50'
                )}
              >
                <span className="text-sm text-text-secondary whitespace-nowrap">免打扰时段</span>
                <TimeRangeSelector
                  startTime={settings.quietStart}
                  endTime={settings.quietEnd}
                  onChange={handleTimeChange}
                  disabled={!settings.quietMode}
                />
              </div>
            </div>
          </div>

          {/* 提示卡片 */}
          <div className="bg-accent-indigo/10 rounded-2xl p-5 flex gap-4">
            <div className="w-10 h-10 rounded-xl bg-accent-indigo/15 flex items-center justify-center flex-shrink-0">
              <Bell size={20} className="text-accent-indigo" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[15px] font-medium text-text-primary">关于通知</span>
              <span className="text-[13px] text-text-secondary leading-relaxed">
                建议保持审核结果和紧急通知开启，以便及时了解任务进度和重要信息。您可以随时调整通知偏好。
              </span>
            </div>
          </div>
        </div>
      </div>
    </ResponsiveLayout>
  )
}
