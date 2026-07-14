'use client'

import { useState, useCallback } from 'react'
import { api, extractErrorMessage } from '@/lib/api'

interface UploadResult {
  url: string
  file_key: string
  file_name: string
  file_size: number
}

interface UseOSSUploadReturn {
  upload: (file: File) => Promise<UploadResult>
  isUploading: boolean
  progress: number
  error: string | null
  reset: () => void
}

export function useOSSUpload(fileType: string = 'general'): UseOSSUploadReturn {
  const [isUploading, setIsUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const reset = useCallback(() => {
    setIsUploading(false)
    setProgress(0)
    setError(null)
  }, [])

  const upload = useCallback(async (file: File): Promise<UploadResult> => {
    setIsUploading(true)
    setProgress(0)
    setError(null)

    try {
      // 后端代理上传：文件 → 后端 → TOS，避免浏览器 CORS/代理问题
      setProgress(5)
      const result = await api.proxyUpload(file, fileType, (pct) => {
        setProgress(5 + Math.round(pct * 0.9))
      })

      setProgress(100)
      setIsUploading(false)
      return {
        url: result.url,
        file_key: result.file_key,
        file_name: result.file_name,
        file_size: result.file_size,
      }
    } catch (err) {
      const message = extractErrorMessage(err)
      setError(message)
      setIsUploading(false)
      throw err
    }
  }, [fileType])

  return { upload, isUploading, progress, error, reset }
}
