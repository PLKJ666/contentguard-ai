'use client'

import { useRef, useState } from 'react'
import { Camera, Loader2 } from 'lucide-react'
import { useOSSUpload } from '@/hooks/useOSSUpload'
import { useToast } from '@/components/ui/Toast'

interface AvatarUploadProps {
  /** 当前头像 URL，无则显示 fallback */
  avatarUrl?: string
  /** 无头像时显示的首字 */
  fallbackText?: string
  /** 头像尺寸 className，如 "w-32 h-32" */
  sizeClass?: string
  /** 首字文字大小 className */
  textClass?: string
  /** 上传成功回调，返回文件 URL */
  onUploaded: (url: string) => void
}

export function AvatarUpload({
  avatarUrl,
  fallbackText = '?',
  sizeClass = 'w-24 h-24',
  textClass = 'text-[40px]',
  onUploaded,
}: AvatarUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const toast = useToast()
  const { upload, isUploading, progress } = useOSSUpload('avatar')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const displayUrl = previewUrl || avatarUrl

  const handleClick = () => {
    if (!isUploading) {
      inputRef.current?.click()
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // 校验文件类型
    if (!file.type.startsWith('image/')) {
      toast.error('请选择图片文件')
      return
    }

    // 校验文件大小 (5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('图片大小不能超过 5MB')
      return
    }

    // 本地预览
    const localUrl = URL.createObjectURL(file)
    setPreviewUrl(localUrl)

    try {
      const result = await upload(file)
      onUploaded(result.url)
      toast.success('头像上传成功')
    } catch {
      setPreviewUrl(null)
      toast.error('头像上传失败，请重试')
    }

    // 重置 input 以允许重复选择同一文件
    e.target.value = ''
  }

  return (
    <div className="relative inline-block">
      {/* 头像 */}
      <div
        className={`${sizeClass} rounded-full flex items-center justify-center overflow-hidden`}
        style={
          displayUrl
            ? undefined
            : { background: 'linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)' }
        }
      >
        {displayUrl ? (
          <img
            src={displayUrl}
            alt="头像"
            className="w-full h-full object-cover"
          />
        ) : (
          <span className={`${textClass} font-bold text-white`}>
            {fallbackText}
          </span>
        )}

        {/* 上传中遮罩 */}
        {isUploading && (
          <div className="absolute inset-0 rounded-full bg-black/50 flex flex-col items-center justify-center">
            <Loader2 size={24} className="text-white animate-spin" />
            <span className="text-xs text-white mt-1">{progress}%</span>
          </div>
        )}
      </div>

      {/* 相机按钮 */}
      <button
        type="button"
        onClick={handleClick}
        disabled={isUploading}
        className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-accent-indigo flex items-center justify-center shadow-lg hover:bg-accent-indigo/90 transition-colors disabled:opacity-50"
      >
        <Camera size={16} className="text-white" />
      </button>

      {/* 隐藏的文件输入 */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  )
}
