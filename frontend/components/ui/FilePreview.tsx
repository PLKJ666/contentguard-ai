'use client'

import { useState, useEffect } from 'react'
import {
  FileText,
  Video,
  Image as ImageIcon,
  File,
  Download,
  ExternalLink,
  Play,
  Pause,
  Maximize2,
  X,
  AlertCircle
} from 'lucide-react'
import { Button } from './Button'
import { Modal } from './Modal'
import { api } from '@/lib/api'

// 文件信息类型
export interface FileInfo {
  id: string
  fileName: string
  fileSize: string
  fileType?: string     // MIME type: "video/mp4", "application/pdf", etc.
  fileUrl: string
  uploadedAt?: string
  duration?: string     // 视频时长 "02:15"
  thumbnail?: string    // 视频缩略图
}

function normalizeFileMeta(file: FileInfo) {
  return {
    fileName: file.fileName || '',
    mimeType: (file.fileType || 'application/octet-stream').toLowerCase(),
  }
}

// 根据文件名或MIME类型判断文件类别
export function getFileCategory(file: FileInfo): 'video' | 'image' | 'pdf' | 'document' | 'spreadsheet' | 'other' {
  const { fileName, mimeType } = normalizeFileMeta(file)

  // 视频
  if (mimeType.startsWith('video/') || /\.(mp4|mov|webm|avi|mkv)$/.test(fileName)) {
    return 'video'
  }
  // 图片
  if (mimeType.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|svg)$/.test(fileName)) {
    return 'image'
  }
  // PDF
  if (mimeType === 'application/pdf' || fileName.endsWith('.pdf')) {
    return 'pdf'
  }
  // Word 文档
  if (
    mimeType.includes('word') ||
    mimeType.includes('document') ||
    /\.(doc|docx|txt|rtf)$/.test(fileName)
  ) {
    return 'document'
  }
  // Excel 表格
  if (
    mimeType.includes('sheet') ||
    mimeType.includes('excel') ||
    /\.(xls|xlsx|csv)$/.test(fileName)
  ) {
    return 'spreadsheet'
  }

  return 'other'
}

// 获取文件图标
function getFileIcon(category: ReturnType<typeof getFileCategory>) {
  switch (category) {
    case 'video':
      return <Video className="w-6 h-6 text-purple-400" />
    case 'image':
      return <ImageIcon className="w-6 h-6 text-accent-green" />
    case 'pdf':
      return <FileText className="w-6 h-6 text-red-400" />
    case 'document':
      return <FileText className="w-6 h-6 text-accent-indigo" />
    case 'spreadsheet':
      return <FileText className="w-6 h-6 text-green-500" />
    default:
      return <File className="w-6 h-6 text-text-secondary" />
  }
}

// 文件信息卡片组件
export function FileInfoCard({
  file,
  onPreview,
  onDownload,
  showPreviewButton = true
}: {
  file: FileInfo
  onPreview?: () => void
  onDownload?: () => void
  showPreviewButton?: boolean
}) {
  const category = getFileCategory(file)
  const hasFileUrl = !!file.fileUrl

  const handleDownload = async () => {
    if (!hasFileUrl) return
    if (onDownload) {
      onDownload()
    } else {
      try {
        await api.downloadFile(file.fileUrl, file.fileName)
      } catch {
        // 回退到直接链接下载
        const link = document.createElement('a')
        link.href = file.fileUrl
        link.download = file.fileName
        link.click()
      }
    }
  }

  const handleOpenInNewTab = async () => {
    if (!hasFileUrl) return
    try {
      const url = await api.getPreviewUrl(file.fileUrl)
      window.open(url, '_blank')
    } catch {
      window.open(file.fileUrl, '_blank')
    }
  }

  return (
    <div className="flex items-center gap-3 p-4 rounded-xl bg-bg-elevated">
      <div className="w-12 h-12 rounded-xl bg-bg-page flex items-center justify-center flex-shrink-0">
        {getFileIcon(category)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary truncate">{file.fileName}</p>
        <p className="text-xs text-text-tertiary">
          {file.fileSize}
          {file.duration && ` · ${file.duration}`}
          {file.uploadedAt && ` · ${file.uploadedAt}`}
        </p>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {showPreviewButton && onPreview && (
          <button
            type="button"
            onClick={onPreview}
            disabled={!hasFileUrl}
            className="p-2.5 rounded-lg hover:bg-bg-page transition-colors"
            title="预览"
          >
            <Maximize2 size={18} className="text-text-secondary" />
          </button>
        )}
        <button
          type="button"
          onClick={handleOpenInNewTab}
          disabled={!hasFileUrl}
          className="p-2.5 rounded-lg hover:bg-bg-page transition-colors"
          title="在新标签页打开"
        >
          <ExternalLink size={18} className="text-text-secondary" />
        </button>
        <button
          type="button"
          onClick={handleDownload}
          disabled={!hasFileUrl}
          className="p-2.5 rounded-lg hover:bg-bg-page transition-colors"
          title="下载"
        >
          <Download size={18} className="text-text-secondary" />
        </button>
      </div>
    </div>
  )
}

// 视频播放器组件
export function VideoPlayer({
  file,
  className = '',
  showControls = true
}: {
  file: FileInfo
  className?: string
  showControls?: boolean
}) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [error, setError] = useState(false)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // 通过后端代理获取视频 blob URL
  useEffect(() => {
    let cancelled = false
    api.getPreviewUrl(file.fileUrl)
      .then(url => {
        if (!cancelled) {
          setBlobUrl(url)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          // 回退：直接用原始 URL 尝试
          setBlobUrl(file.fileUrl)
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [file.fileUrl])

  const handleOpenInNewTab = async () => {
    try {
      const url = blobUrl || await api.getPreviewUrl(file.fileUrl)
      window.open(url, '_blank')
    } catch {
      window.open(file.fileUrl, '_blank')
    }
  }

  if (error) {
    return (
      <div className={`aspect-video bg-bg-elevated rounded-xl flex items-center justify-center ${className}`}>
        <div className="text-center">
          <AlertCircle className="w-12 h-12 mx-auto text-accent-coral mb-3" />
          <p className="text-text-secondary">视频加载失败</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={handleOpenInNewTab}>
            <ExternalLink size={14} />
            在新标签页打开
          </Button>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className={`aspect-video bg-black rounded-xl flex items-center justify-center ${className}`}>
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-white/20 border-t-white/80 rounded-full animate-spin mx-auto mb-2" />
          <p className="text-white/50 text-sm">加载视频中...</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`relative rounded-xl overflow-hidden bg-black ${className}`}>
      <video
        className="w-full h-full"
        controls={showControls}
        poster={file.thumbnail}
        onError={() => setError(true)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      >
        <source src={blobUrl || file.fileUrl} type={file.fileType} />
        您的浏览器不支持视频播放
      </video>
    </div>
  )
}

// 图片查看器组件
export function ImageViewer({
  file,
  className = ''
}: {
  file: FileInfo
  className?: string
}) {
  const [error, setError] = useState(false)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api.getPreviewUrl(file.fileUrl)
      .then(url => { if (!cancelled) setBlobUrl(url) })
      .catch(() => { if (!cancelled) setBlobUrl(file.fileUrl) })
    return () => { cancelled = true }
  }, [file.fileUrl])

  const handleOpenInNewTab = async () => {
    try {
      const url = blobUrl || await api.getPreviewUrl(file.fileUrl)
      window.open(url, '_blank')
    } catch {
      window.open(file.fileUrl, '_blank')
    }
  }

  if (error) {
    return (
      <div className={`aspect-video bg-bg-elevated rounded-xl flex items-center justify-center ${className}`}>
        <div className="text-center">
          <AlertCircle className="w-12 h-12 mx-auto text-accent-coral mb-3" />
          <p className="text-text-secondary">图片加载失败</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={handleOpenInNewTab}>
            <ExternalLink size={14} />
            在新标签页打开
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className={`bg-bg-elevated rounded-xl overflow-hidden flex items-center justify-center ${className}`}>
      <img
        src={blobUrl || file.fileUrl}
        alt={file.fileName}
        className="max-w-full max-h-full object-contain"
        onError={() => setError(true)}
      />
    </div>
  )
}

// PDF 查看器组件
export function PDFViewer({
  file,
  className = ''
}: {
  file: FileInfo
  className?: string
}) {
  const [error, setError] = useState(false)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api.getPreviewUrl(file.fileUrl)
      .then(url => { if (!cancelled) setBlobUrl(url) })
      .catch(() => { if (!cancelled) setBlobUrl(file.fileUrl) })
    return () => { cancelled = true }
  }, [file.fileUrl])

  const handleOpenInNewTab = async () => {
    try {
      const url = blobUrl || await api.getPreviewUrl(file.fileUrl)
      window.open(url, '_blank')
    } catch {
      window.open(file.fileUrl, '_blank')
    }
  }

  if (error) {
    return (
      <div className={`aspect-[4/3] bg-bg-elevated rounded-xl flex items-center justify-center ${className}`}>
        <div className="text-center">
          <AlertCircle className="w-12 h-12 mx-auto text-accent-coral mb-3" />
          <p className="text-text-secondary">PDF 加载失败</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={handleOpenInNewTab}>
            <ExternalLink size={14} />
            在新标签页打开
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className={`rounded-xl overflow-hidden ${className}`}>
      <iframe
        src={blobUrl || ''}
        className="w-full h-full min-h-[500px] border-0"
        title={file.fileName}
        onError={() => setError(true)}
      />
    </div>
  )
}

// 文档预览占位组件（Word/Excel 等不支持内嵌预览的格式）
export function DocumentPlaceholder({
  file,
  className = ''
}: {
  file: FileInfo
  className?: string
}) {
  const category = getFileCategory(file)
  const hasFileUrl = !!file.fileUrl

  return (
    <div className={`aspect-[4/3] bg-bg-elevated rounded-xl flex items-center justify-center ${className}`}>
      <div className="text-center p-6">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-bg-page flex items-center justify-center">
          {getFileIcon(category)}
        </div>
        <p className="text-text-primary font-medium mb-1">{file.fileName}</p>
        <p className="text-sm text-text-tertiary mb-4">{file.fileSize}</p>
        <p className="text-sm text-text-secondary mb-4">
          该文件格式暂不支持在线预览
        </p>
        <div className="flex gap-2 justify-center">
          <Button variant="secondary" onClick={async () => {
            if (!hasFileUrl) return
            try {
              const blobUrl = await api.getPreviewUrl(file.fileUrl)
              window.open(blobUrl, '_blank')
            } catch {
              window.open(file.fileUrl, '_blank')
            }
          }} disabled={!hasFileUrl}>
            <ExternalLink size={16} />
            在新标签页打开
          </Button>
          <Button onClick={async () => {
            if (!hasFileUrl) return
            try {
              await api.downloadFile(file.fileUrl, file.fileName)
            } catch {
              const link = document.createElement('a')
              link.href = file.fileUrl
              link.download = file.fileName
              link.click()
            }
          }} disabled={!hasFileUrl}>
            <Download size={16} />
            下载文件
          </Button>
        </div>
      </div>
    </div>
  )
}

// 统一的文件预览组件 - 根据文件类型自动选择预览方式
export function FilePreview({
  file,
  className = ''
}: {
  file: FileInfo
  className?: string
}) {
  const category = getFileCategory(file)

  switch (category) {
    case 'video':
      return <VideoPlayer file={file} className={className} />
    case 'image':
      return <ImageViewer file={file} className={className} />
    case 'pdf':
      return <PDFViewer file={file} className={className} />
    default:
      return <DocumentPlaceholder file={file} className={className} />
  }
}

// 文件预览弹窗组件
export function FilePreviewModal({
  file,
  isOpen,
  onClose
}: {
  file: FileInfo | null
  isOpen: boolean
  onClose: () => void
}) {
  if (!file) return null

  const category = getFileCategory(file)
  const hasFileUrl = !!file.fileUrl

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={file.fileName}
      size="xl"
    >
      <div className="space-y-4">
        {/* 预览区域 */}
        <div className="min-h-[400px]">
          <FilePreview file={file} className="h-full" />
        </div>

        {/* 底部信息和操作 */}
        <div className="flex items-center justify-between pt-4 border-t border-border-subtle">
          <div className="text-sm text-text-secondary">
            <span>{file.fileSize}</span>
            {file.duration && (
              <>
                <span className="mx-2">·</span>
                <span>{file.duration}</span>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={async () => {
              if (!hasFileUrl) return
              try {
                const blobUrl = await api.getPreviewUrl(file.fileUrl)
                window.open(blobUrl, '_blank')
              } catch {
                window.open(file.fileUrl, '_blank')
              }
            }} disabled={!hasFileUrl}>
              <ExternalLink size={16} />
              新标签页打开
            </Button>
            <Button onClick={async () => {
              if (!hasFileUrl) return
              try {
                await api.downloadFile(file.fileUrl, file.fileName)
              } catch {
                const link = document.createElement('a')
                link.href = file.fileUrl
                link.download = file.fileName
                link.click()
              }
            }} disabled={!hasFileUrl}>
              <Download size={16} />
              下载
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

export default FilePreview
