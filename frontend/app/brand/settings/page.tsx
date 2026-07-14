'use client'

import { useState, useEffect } from 'react'
import { useTheme } from 'next-themes'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import {
  Bell,
  Shield,
  Download,
  Smartphone,
  Globe,
  Moon,
  Sun,
  Check,
  LogOut,
  Monitor,
  AlertCircle,
  Clock,
  FileText,
  BarChart3,
  Users,
  CheckCircle,
  KeyRound
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

export default function BrandSettingsPage() {
  const toast = useToast()
  const { logout } = useAuth()
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  const [notifications, setNotifications] = useState({
    email: true,
    push: true,
    reviewComplete: true,
    newSubmission: true,
    riskAlert: true,
  })

  // 退出登录弹窗
  const [showLogoutModal, setShowLogoutModal] = useState(false)

  // 数据导出弹窗
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportType, setExportType] = useState<string>('')
  const [exportRange, setExportRange] = useState('month')
  const [isExporting, setIsExporting] = useState(false)

  // 模拟导出历史
  const exportHistory = [
    { id: 'e-1', type: '审核记录', range: '2026年1月', status: 'completed', createdAt: '2026-02-01 10:30', size: '2.3MB' },
    { id: 'e-2', type: '统计报告', range: '2025年Q4', status: 'completed', createdAt: '2026-01-15 14:20', size: '1.1MB' },
  ]

  const handleSave = () => {
    toast.success('设置已保存')
  }

  const handleLogout = () => {
    logout()
  }

  const handleExport = async () => {
    setIsExporting(true)
    // 模拟导出过程
    await new Promise(resolve => setTimeout(resolve, 2000))
    setIsExporting(false)
    setShowExportModal(false)
    toast.info('导出任务已创建，完成后将通知您下载')
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">系统设置</h1>
          <p className="text-sm text-text-secondary mt-1">管理账户和系统偏好设置</p>
        </div>
        <Button
          variant="secondary"
          className="bg-accent-coral/15 text-accent-coral border-accent-coral hover:bg-accent-coral hover:text-white"
          onClick={() => setShowLogoutModal(true)}
        >
          <LogOut size={16} />
          退出登录
        </Button>
      </div>

      {/* 通知设置 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell size={18} className="text-accent-indigo" />
            通知设置
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between py-3 border-b border-border-subtle">
            <div>
              <p className="font-medium text-text-primary">邮件通知</p>
              <p className="text-sm text-text-secondary">接收重要事件的邮件提醒</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={notifications.email}
                onChange={(e) => setNotifications({ ...notifications, email: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-bg-elevated peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-accent-indigo rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent-indigo"></div>
            </label>
          </div>

          <div className="flex items-center justify-between py-3 border-b border-border-subtle">
            <div>
              <p className="font-medium text-text-primary">推送通知</p>
              <p className="text-sm text-text-secondary">浏览器推送通知</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={notifications.push}
                onChange={(e) => setNotifications({ ...notifications, push: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-bg-elevated peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-accent-indigo rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent-indigo"></div>
            </label>
          </div>

          <div className="pt-2">
            <p className="text-sm font-medium text-text-primary mb-3">通知类型</p>
            <div className="space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifications.reviewComplete}
                  onChange={(e) => setNotifications({ ...notifications, reviewComplete: e.target.checked })}
                  className="w-4 h-4 accent-accent-indigo"
                />
                <span className="text-text-secondary">审核完成通知</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifications.newSubmission}
                  onChange={(e) => setNotifications({ ...notifications, newSubmission: e.target.checked })}
                  className="w-4 h-4 accent-accent-indigo"
                />
                <span className="text-text-secondary">新提交通知</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifications.riskAlert}
                  onChange={(e) => setNotifications({ ...notifications, riskAlert: e.target.checked })}
                  className="w-4 h-4 accent-accent-indigo"
                />
                <span className="text-text-secondary">风险预警通知</span>
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 外观设置 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe size={18} className="text-purple-400" />
            外观设置
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-text-secondary mb-4">选择界面主题</p>
          <div className="flex gap-3">
            {[
              { value: 'light', icon: Sun, label: '浅色', iconClass: 'text-yellow-400' },
              { value: 'dark', icon: Moon, label: '深色', iconClass: 'text-accent-indigo' },
              { value: 'system', icon: Globe, label: '跟随系统', iconClass: 'text-text-secondary' },
            ].map((opt) => {
              const Icon = opt.icon
              const active = mounted && theme === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setTheme(opt.value)}
                  className={`flex items-center gap-2 px-4 py-3 rounded-lg border-2 transition-colors ${
                    active ? 'border-accent-indigo bg-accent-indigo/10' : 'border-border-subtle hover:border-accent-indigo/50'
                  }`}
                >
                  <Icon size={20} className={opt.iconClass} />
                  <span className="text-text-primary">{opt.label}</span>
                  {active && <Check size={16} className="text-accent-indigo ml-2" />}
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* 账户安全 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield size={18} className="text-accent-green" />
            账户安全
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-2xl border border-accent-green/20 bg-accent-green/10 p-4">
            <p className="text-sm font-medium text-text-primary">当前系统使用 Logto 统一认证</p>
            <p className="text-sm text-text-secondary mt-2 leading-6">
              站内不再单独维护密码、两步验证、绑定手机或设备会话管理，避免应用内状态与统一认证状态不一致。
            </p>
          </div>

          <div className="space-y-3">
            {[
              {
                icon: KeyRound,
                title: '密码与登录方式',
                description: '品牌方账号密码和登录方式请在 Logto 侧管理。',
              },
              {
                icon: Smartphone,
                title: '两步验证与手机号',
                description: '手机验证码、两步验证和绑定手机号能力由统一认证侧处理。',
              },
              {
                icon: Monitor,
                title: '登录设备与会话',
                description: '如需查看或下线其他登录设备，请在统一认证侧进行会话管理。',
              },
            ].map((item) => {
              const Icon = item.icon
              return (
                <div key={item.title} className="flex items-start gap-3 rounded-xl bg-bg-elevated p-4">
                  <Icon size={18} className="text-text-secondary mt-0.5" />
                  <div>
                    <p className="font-medium text-text-primary">{item.title}</p>
                    <p className="text-sm text-text-secondary mt-1 leading-6">{item.description}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* 数据导出 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download size={18} className="text-orange-400" />
            数据导出
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <p className="text-sm text-text-secondary mb-4">导出您的审核数据和报告</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <button
                type="button"
                onClick={() => { setExportType('review'); setShowExportModal(true); }}
                className="p-4 rounded-xl border border-border-subtle hover:border-accent-indigo/50 transition-colors text-left"
              >
                <FileText size={24} className="text-accent-indigo mb-2" />
                <p className="font-medium text-text-primary">审核记录</p>
                <p className="text-xs text-text-tertiary mt-1">脚本和视频审核</p>
              </button>
              <button
                type="button"
                onClick={() => { setExportType('stats'); setShowExportModal(true); }}
                className="p-4 rounded-xl border border-border-subtle hover:border-accent-indigo/50 transition-colors text-left"
              >
                <BarChart3 size={24} className="text-accent-green mb-2" />
                <p className="font-medium text-text-primary">统计报告</p>
                <p className="text-xs text-text-tertiary mt-1">数据统计分析</p>
              </button>
              <button
                type="button"
                onClick={() => { setExportType('agency'); setShowExportModal(true); }}
                className="p-4 rounded-xl border border-border-subtle hover:border-accent-indigo/50 transition-colors text-left"
              >
                <Users size={24} className="text-purple-400 mb-2" />
                <p className="font-medium text-text-primary">代理商数据</p>
                <p className="text-xs text-text-tertiary mt-1">合作代理商信息</p>
              </button>
              <button
                type="button"
                onClick={() => { setExportType('all'); setShowExportModal(true); }}
                className="p-4 rounded-xl border border-border-subtle hover:border-accent-indigo/50 transition-colors text-left"
              >
                <Download size={24} className="text-orange-400 mb-2" />
                <p className="font-medium text-text-primary">全部数据</p>
                <p className="text-xs text-text-tertiary mt-1">导出所有数据</p>
              </button>
            </div>
          </div>

          {/* 导出历史 */}
          <div>
            <p className="text-sm font-medium text-text-primary mb-3">导出历史</p>
            {exportHistory.length > 0 ? (
              <div className="space-y-2">
                {exportHistory.map(item => (
                  <div key={item.id} className="flex items-center justify-between p-3 rounded-xl bg-bg-elevated">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-accent-green/15 flex items-center justify-center">
                        <CheckCircle size={20} className="text-accent-green" />
                      </div>
                      <div>
                        <p className="font-medium text-text-primary">{item.type} - {item.range}</p>
                        <p className="text-xs text-text-tertiary">{item.createdAt} · {item.size}</p>
                      </div>
                    </div>
                    <Button variant="secondary" size="sm">
                      <Download size={14} />
                      下载
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-text-tertiary">
                <Download size={32} className="mx-auto mb-2 opacity-50" />
                <p>暂无导出记录</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 保存按钮 */}
      <div className="flex justify-end pt-4">
        <Button onClick={handleSave}>
          保存设置
        </Button>
      </div>

      {/* 退出登录确认弹窗 */}
      <Modal
        isOpen={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        title="确认退出登录"
      >
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-accent-coral/10 border border-accent-coral/20">
            <div className="flex items-start gap-3">
              <AlertCircle size={20} className="text-accent-coral flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-text-primary font-medium">确定要退出登录吗？</p>
                <p className="text-sm text-text-secondary mt-1">
                  退出后需要重新登录才能访问系统
                </p>
              </div>
            </div>
          </div>
          <div className="flex gap-3 justify-end">
            <Button variant="ghost" onClick={() => setShowLogoutModal(false)}>
              取消
            </Button>
            <Button
              variant="secondary"
              className="border-accent-coral text-accent-coral hover:bg-accent-coral/10"
              onClick={handleLogout}
            >
              <LogOut size={16} />
              确认退出
            </Button>
          </div>
        </div>
      </Modal>

      {/* 数据导出弹窗 */}
      <Modal
        isOpen={showExportModal}
        onClose={() => { setShowExportModal(false); setExportType(''); }}
        title="导出数据"
      >
        <div className="space-y-4">
          <div className="p-3 rounded-xl bg-bg-elevated">
            <p className="text-sm text-text-secondary">导出类型</p>
            <p className="font-medium text-text-primary">
              {exportType === 'review' && '审核记录'}
              {exportType === 'stats' && '统计报告'}
              {exportType === 'agency' && '代理商数据'}
              {exportType === 'all' && '全部数据'}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">选择时间范围</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'week', label: '最近一周' },
                { value: 'month', label: '最近一月' },
                { value: 'quarter', label: '最近三月' },
                { value: 'year', label: '最近一年' },
              ].map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setExportRange(option.value)}
                  className={`p-3 rounded-xl border-2 text-sm font-medium transition-colors ${
                    exportRange === option.value
                      ? 'border-accent-indigo bg-accent-indigo/10 text-accent-indigo'
                      : 'border-border-subtle text-text-secondary hover:border-accent-indigo/50'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">导出格式</label>
            <div className="flex gap-2">
              <span className="px-3 py-2 rounded-lg bg-accent-indigo/15 text-accent-indigo text-sm font-medium">Excel (.xlsx)</span>
              <span className="px-3 py-2 rounded-lg bg-bg-elevated text-text-tertiary text-sm">CSV</span>
              <span className="px-3 py-2 rounded-lg bg-bg-elevated text-text-tertiary text-sm">PDF</span>
            </div>
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <Button variant="ghost" onClick={() => { setShowExportModal(false); setExportType(''); }}>
              取消
            </Button>
            <Button onClick={handleExport} disabled={isExporting}>
              {isExporting ? (
                <>
                  <Clock size={16} className="animate-spin" />
                  导出中...
                </>
              ) : (
                <>
                  <Download size={16} />
                  开始导出
                </>
              )}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
