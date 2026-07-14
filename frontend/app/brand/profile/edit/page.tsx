'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { AvatarUpload } from '@/components/ui/AvatarUpload'
import { copyToClipboard } from '@/lib/utils'
import {
  ArrowLeft,
  CircleUser,
  Copy,
  Check
} from 'lucide-react'

const emptyFormData = {
  avatarUrl: '',
  name: '',
  brandId: '--',
  phone: '',
  companyName: '',
  position: '',
  contactEmail: '',
}

export default function BrandProfileEditPage() {
  const router = useRouter()
  const toast = useToast()
  const [formData, setFormData] = useState(emptyFormData)
  const [isSaving, setIsSaving] = useState(false)
  const [copied, setCopied] = useState(false)

  const loadData = useCallback(async () => {
    try {
      const profile = await api.getProfile()
      setFormData({
        avatarUrl: profile.avatar || '',
        name: profile.name || '',
        brandId: profile.brand?.id || '--',
        phone: profile.phone || '',
        companyName: profile.brand?.name || '',
        position: profile.brand?.contact_name || '',
        contactEmail: profile.brand?.contact_email || '',
      })
    } catch {}
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const handleCopyId = async () => {
    try {
      await copyToClipboard(formData.brandId)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('复制失败，请重试')
    }
  }

  const handleAvatarUploaded = async (url: string) => {
    setFormData(prev => ({ ...prev, avatarUrl: url }))
    try {
      await api.updateProfile({ avatar: url })
    } catch {
      toast.error('头像保存失败')
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await api.updateProfile({
        name: formData.name,
        phone: formData.phone,
        contact_name: formData.position,
        contact_email: formData.contactEmail,
      })
      toast.success('个人信息已保存')
      router.back()
    } catch (err: any) {
      toast.error(err.message || '保存失败')
    } finally {
      setIsSaving(false)
    }
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
            <h1 className="text-2xl font-bold text-text-primary">个人信息</h1>
            <p className="text-sm text-text-secondary mt-0.5">编辑您的个人资料</p>
          </div>
        </div>
        <Button variant="primary" onClick={handleSave} disabled={isSaving}>
          {isSaving ? '保存中...' : '保存'}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左侧：头像 */}
        <Card>
          <CardHeader>
            <CardTitle>头像</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center">
            <AvatarUpload
              avatarUrl={formData.avatarUrl || undefined}
              fallbackText={formData.name?.[0] || '?'}
              sizeClass="w-32 h-32"
              textClass="text-5xl"
              onUploaded={handleAvatarUploaded}
            />
            <p className="text-sm text-text-tertiary mt-4">点击相机图标更换头像</p>
            <p className="text-xs text-text-tertiary mt-1">支持 JPG、PNG，最大 5MB</p>
          </CardContent>
        </Card>

        {/* 右侧：基本信息 */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CircleUser size={18} className="text-accent-indigo" />
                基本信息
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* 品牌ID（只读） */}
              <div>
                <label className="text-sm text-text-secondary mb-1.5 block">品牌ID</label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 px-4 py-2.5 rounded-xl bg-bg-elevated border border-border-subtle">
                    <span className="font-mono font-medium text-accent-indigo">{formData.brandId}</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyId}
                    className="px-4 py-2.5 rounded-xl bg-bg-elevated border border-border-subtle hover:bg-bg-page transition-colors flex items-center gap-2"
                  >
                    {copied ? (
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
                <p className="text-xs text-text-tertiary mt-1">品牌ID不可修改</p>
              </div>

              {/* 姓名 */}
              <div>
                <label className="text-sm text-text-secondary mb-1.5 block">姓名</label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="请输入姓名"
                />
              </div>

              {/* 公司名称 */}
              <div>
                <label className="text-sm text-text-secondary mb-1.5 block">公司名称</label>
                <Input
                  value={formData.companyName}
                  onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                  placeholder="请输入公司名称"
                />
              </div>

              {/* 职位和联系邮箱 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-text-secondary mb-1.5 block">职位</label>
                  <Input
                    value={formData.position}
                    onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                    placeholder="请输入职位"
                  />
                </div>
                <div>
                  <label className="text-sm text-text-secondary mb-1.5 block">联系邮箱</label>
                  <Input
                    value={formData.contactEmail}
                    onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })}
                    placeholder="请输入联系邮箱"
                  />
                </div>
              </div>

              {/* 手机号（只读） */}
              <div>
                <label className="text-sm text-text-secondary mb-1.5 block">手机号</label>
                <div className="px-4 py-2.5 rounded-xl bg-bg-elevated border border-border-subtle">
                  <span className="text-text-primary">{formData.phone}</span>
                </div>
                <p className="text-xs text-text-tertiary mt-1">手机号为登录凭证，不可修改</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
