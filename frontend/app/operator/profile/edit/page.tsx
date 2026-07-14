'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Check, Copy, UserCircle2 } from 'lucide-react'
import { AvatarUpload } from '@/components/ui/AvatarUpload'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { api } from '@/lib/api'
import { copyToClipboard } from '@/lib/utils'

const emptyForm = {
  avatarUrl: '',
  name: '',
  email: '',
  phone: '',
}

export default function OperatorProfileEditPage() {
  const router = useRouter()
  const toast = useToast()
  const { user } = useAuth()
  const [formData, setFormData] = useState(emptyForm)
  const [isSaving, setIsSaving] = useState(false)
  const [copiedField, setCopiedField] = useState<'operator' | 'workspace' | null>(null)

  const operatorId = user?.operator_id || '--'
  const workspaceId = user?.tenant_id || '--'
  const workspaceName = user?.tenant_name || '未命名工作空间'

  const loadData = useCallback(async () => {
    try {
      const profile = await api.getProfile()
      setFormData({
        avatarUrl: profile.avatar || '',
        name: profile.name || '',
        email: profile.email || '',
        phone: profile.phone || '',
      })
    } catch {
      setFormData({
        avatarUrl: user?.avatar || '',
        name: user?.name || '',
        email: user?.email || '',
        phone: user?.phone || '',
      })
    }
  }, [user])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const handleCopy = useCallback(async (field: 'operator' | 'workspace', value: string) => {
    if (!value || value === '--') {
      toast.error('暂无可复制内容')
      return
    }
    try {
      await copyToClipboard(value)
      setCopiedField(field)
      window.setTimeout(() => {
        setCopiedField((current) => (current === field ? null : current))
      }, 2000)
    } catch {
      toast.error('复制失败，请重试')
    }
  }, [toast])

  const handleAvatarUploaded = useCallback(async (url: string) => {
    setFormData((prev) => ({ ...prev, avatarUrl: url }))
    try {
      await api.updateProfile({ avatar: url })
      toast.success('头像已更新')
    } catch {
      toast.error('头像保存失败')
    }
  }, [toast])

  const handleSave = useCallback(async () => {
    if (!formData.name.trim()) {
      toast.error('请输入昵称')
      return
    }

    setIsSaving(true)
    try {
      await api.updateProfile({
        name: formData.name.trim(),
      })
      toast.success('个人信息已保存')
      router.push('/operator/profile')
    } catch (err: any) {
      toast.error(err.message || '保存失败')
    } finally {
      setIsSaving(false)
    }
  }, [formData.name, router, toast])

  const fallbackText = useMemo(() => formData.name?.[0] || user?.name?.[0] || '代', [formData.name, user?.name])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => router.back()}
            className="p-2 rounded-lg hover:bg-bg-elevated transition-colors"
          >
            <ArrowLeft size={20} className="text-text-secondary" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-text-primary">编辑个人信息</h1>
            <p className="text-sm text-text-secondary mt-0.5">更新代运营账号的昵称和头像</p>
          </div>
        </div>
        <Button variant="primary" onClick={handleSave} disabled={isSaving}>
          {isSaving ? '保存中...' : '保存'}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>头像</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center">
            <AvatarUpload
              avatarUrl={formData.avatarUrl || undefined}
              fallbackText={fallbackText}
              sizeClass="w-32 h-32"
              textClass="text-5xl"
              onUploaded={handleAvatarUploaded}
            />
            <p className="text-sm text-text-tertiary mt-4">点击相机图标更换头像</p>
            <p className="text-xs text-text-tertiary mt-1">支持 JPG、PNG，最大 5MB</p>
          </CardContent>
        </Card>

        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserCircle2 size={18} className="text-accent-indigo" />
                基本信息
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div>
                <label className="text-sm text-text-secondary mb-1.5 block">昵称</label>
                <Input
                  value={formData.name}
                  onChange={(event) => setFormData((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="请输入昵称"
                />
              </div>

              <div>
                <label className="text-sm text-text-secondary mb-1.5 block">邮箱</label>
                <div className="px-4 py-2.5 rounded-xl bg-bg-elevated border border-border-subtle">
                  <span className="text-text-primary break-all">{formData.email || '未绑定邮箱'}</span>
                </div>
                <p className="text-xs text-text-tertiary mt-1">邮箱由统一认证系统管理，不在此处修改</p>
              </div>

              <div>
                <label className="text-sm text-text-secondary mb-1.5 block">手机号</label>
                <div className="px-4 py-2.5 rounded-xl bg-bg-elevated border border-border-subtle">
                  <span className="text-text-primary">{formData.phone || '未绑定手机号'}</span>
                </div>
                <p className="text-xs text-text-tertiary mt-1">手机号为登录凭证，不在此处修改</p>
              </div>

              <div>
                <label className="text-sm text-text-secondary mb-1.5 block">Operator ID</label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 px-4 py-2.5 rounded-xl bg-bg-elevated border border-border-subtle">
                    <span className="font-mono font-medium text-accent-indigo">{operatorId}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCopy('operator', operatorId)}
                    className="px-4 py-2.5 rounded-xl bg-bg-elevated border border-border-subtle hover:bg-bg-page transition-colors flex items-center gap-2"
                  >
                    {copiedField === 'operator' ? (
                      <>
                        <Check size={16} className="text-accent-green" />
                        <span className="text-accent-green text-sm">已复制</span>
                      </>
                    ) : (
                      <>
                        <Copy size={16} className="text-text-secondary" />
                        <span className="text-text-secondary text-sm">复制</span>
                      </>
                    )}
                  </button>
                </div>
                <p className="text-xs text-text-tertiary mt-1">Operator ID 为系统生成的唯一标识，不可修改</p>
              </div>

              <div>
                <label className="text-sm text-text-secondary mb-1.5 block">Workspace</label>
                <div className="space-y-2">
                  <div className="px-4 py-2.5 rounded-xl bg-bg-elevated border border-border-subtle">
                    <span className="text-text-primary">{workspaceName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 px-4 py-2.5 rounded-xl bg-bg-elevated border border-border-subtle">
                      <span className="font-mono font-medium text-accent-indigo">{workspaceId}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleCopy('workspace', workspaceId)}
                      className="px-4 py-2.5 rounded-xl bg-bg-elevated border border-border-subtle hover:bg-bg-page transition-colors flex items-center gap-2"
                    >
                      {copiedField === 'workspace' ? (
                        <>
                          <Check size={16} className="text-accent-green" />
                          <span className="text-accent-green text-sm">已复制</span>
                        </>
                      ) : (
                        <>
                          <Copy size={16} className="text-text-secondary" />
                          <span className="text-text-secondary text-sm">复制</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
                <p className="text-xs text-text-tertiary mt-1">工作空间信息当前只读，作为代运营业务隔离边界</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
