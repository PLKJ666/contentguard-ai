'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Check, Copy } from 'lucide-react'
import { ResponsiveLayout } from '@/components/layout/ResponsiveLayout'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { cn, copyToClipboard } from '@/lib/utils'
import { useToast } from '@/components/ui/Toast'
import { api } from '@/lib/api'
import { AvatarUpload } from '@/components/ui/AvatarUpload'

export default function ProfileEditPage() {
  const router = useRouter()
  const toast = useToast()
  const [isSaving, setIsSaving] = useState(false)
  const [idCopied, setIdCopied] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    avatarUrl: '',
    douyinAccount: '',
    xiaohongshuAccount: '',
    bilibiliAccount: '',
    bio: '',
  })
  const [creatorId, setCreatorId] = useState('')

  const loadData = useCallback(async () => {
    try {
      const profile = await api.getProfile()
      setFormData({
        name: profile.name || '',
        phone: profile.phone || '',
        avatarUrl: profile.avatar || '',
        douyinAccount: profile.creator?.douyin_account || '',
        xiaohongshuAccount: profile.creator?.xiaohongshu_account || '',
        bilibiliAccount: profile.creator?.bilibili_account || '',
        bio: profile.creator?.bio || '',
      })
      if (profile.creator?.id) setCreatorId(profile.creator.id)
    } catch {}
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // 复制达人ID
  const handleCopyId = async () => {
    try {
      await copyToClipboard(creatorId)
      setIdCopied(true)
      setTimeout(() => setIdCopied(false), 2000)
    } catch {
      toast.error('复制失败，请重试')
    }
  }

  const handleAvatarUploaded = async (url: string) => {
    setFormData(prev => ({ ...prev, avatarUrl: url }))
    try {
      await api.updateProfile({ avatar: url })
    } catch {
      // toast 已由 AvatarUpload 组件处理
    }
  }

  // 处理输入变化
  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  // 保存
  const handleSave = async () => {
    setIsSaving(true)
    try {
      await api.updateProfile({
        name: formData.name,
        bio: formData.bio,
        douyin_account: formData.douyinAccount,
        xiaohongshu_account: formData.xiaohongshuAccount,
        bilibili_account: formData.bilibiliAccount,
      })
    } catch (err: any) {
      toast.error(err.message || '保存失败')
      setIsSaving(false)
      return
    }
    setIsSaving(false)
    router.back()
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
            <h1 className="text-2xl lg:text-[28px] font-bold text-text-primary">编辑个人信息</h1>
            <p className="text-sm lg:text-[15px] text-text-secondary">更新您的头像和基本资料</p>
          </div>
        </div>

        {/* 内容区 */}
        <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0 overflow-y-auto lg:overflow-visible">
          {/* 头像编辑卡片 */}
          <div className="lg:w-[360px] lg:flex-shrink-0">
            <div className="bg-bg-card rounded-2xl p-6 card-shadow flex flex-col items-center gap-5">
              {/* 头像 */}
              <AvatarUpload
                avatarUrl={formData.avatarUrl || undefined}
                fallbackText={formData.name?.[0] || '?'}
                onUploaded={handleAvatarUploaded}
              />
              <p className="text-sm text-text-secondary">点击更换头像</p>

              {/* 提示 */}
              <div className="w-full p-4 rounded-xl bg-bg-elevated">
                <p className="text-[13px] text-text-tertiary leading-relaxed">
                  支持 JPG、PNG 格式，文件大小不超过 5MB，建议使用正方形图片以获得最佳显示效果。
                </p>
              </div>
            </div>
          </div>

          {/* 表单卡片 */}
          <div className="flex-1 flex flex-col gap-5">
            <div className="bg-bg-card rounded-2xl p-6 card-shadow flex flex-col gap-5">
              {/* 达人ID（只读） */}
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-text-primary">达人ID</label>
                <div className="flex gap-3">
                  <div className="flex-1 px-4 py-3 rounded-xl border border-border-default bg-bg-elevated/50 flex items-center justify-between">
                    <span className="font-mono font-medium text-accent-indigo">{creatorId}</span>
                    <button
                      type="button"
                      onClick={handleCopyId}
                      className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-bg-elevated transition-colors"
                    >
                      {idCopied ? (
                        <>
                          <Check size={14} className="text-accent-green" />
                          <span className="text-xs text-accent-green">已复制</span>
                        </>
                      ) : (
                        <>
                          <Copy size={14} className="text-text-tertiary" />
                          <span className="text-xs text-text-tertiary">复制</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
                <p className="text-xs text-text-tertiary">系统自动生成的唯一标识，供代理商邀请时使用</p>
              </div>

              {/* 昵称 */}
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-text-primary">昵称</label>
                <Input
                  value={formData.name}
                  onChange={(e) => handleInputChange('name', e.target.value)}
                  placeholder="请输入昵称"
                />
              </div>

              {/* 手机号（只读，登录凭证） */}
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-text-primary">手机号</label>
                <div className="px-4 py-3 rounded-xl border border-border-default bg-bg-elevated/50">
                  <span className="text-text-primary">{formData.phone}</span>
                </div>
                <p className="text-xs text-text-tertiary">手机号为登录凭证，不可修改</p>
              </div>

              {/* 平台账号 */}
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-text-primary">抖音账号</label>
                <Input
                  value={formData.douyinAccount}
                  onChange={(e) => handleInputChange('douyinAccount', e.target.value)}
                  placeholder="请输入抖音账号"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-text-primary">小红书账号</label>
                <Input
                  value={formData.xiaohongshuAccount}
                  onChange={(e) => handleInputChange('xiaohongshuAccount', e.target.value)}
                  placeholder="请输入小红书账号"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-text-primary">B站账号</label>
                <Input
                  value={formData.bilibiliAccount}
                  onChange={(e) => handleInputChange('bilibiliAccount', e.target.value)}
                  placeholder="请输入B站账号"
                />
              </div>

              {/* 个人简介 */}
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-text-primary">个人简介</label>
                <textarea
                  value={formData.bio}
                  onChange={(e) => handleInputChange('bio', e.target.value)}
                  placeholder="介绍一下自己吧..."
                  rows={3}
                  className={cn(
                    'w-full px-4 py-3 rounded-xl border border-border-default',
                    'bg-bg-elevated text-text-primary text-[15px]',
                    'placeholder:text-text-tertiary',
                    'focus:outline-none focus:border-accent-indigo focus:ring-2 focus:ring-accent-indigo/20',
                    'transition-all resize-none'
                  )}
                />
                <p className="text-xs text-text-tertiary text-right">{formData.bio.length}/100</p>
              </div>
            </div>

            {/* 保存按钮 */}
            <div className="flex justify-end gap-3">
              <Button variant="secondary" size="lg" onClick={() => router.back()}>
                取消
              </Button>
              <Button
                variant="primary"
                size="lg"
                onClick={handleSave}
                disabled={isSaving}
                className="min-w-[120px]"
              >
                {isSaving ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    保存中...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Check size={18} />
                    保存修改
                  </span>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </ResponsiveLayout>
  )
}
