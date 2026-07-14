/**
 * 获取私有桶文件的可访问 URL
 *
 * TOS 桶策略不支持预签名 URL（Query String Auth），
 * 所有文件统一走后端流式代理 /upload/stream。
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '@/lib/api'

export function useSignedUrl(originalUrl: string | undefined | null) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const fetchSignedUrl = useCallback(async () => {
    if (!originalUrl) {
      setSignedUrl(null)
      return
    }

    // 非 TOS URL（如外部链接）直接返回
    if (!originalUrl.includes('tos-cn-') && !originalUrl.includes('volces.com') && !originalUrl.startsWith('uploads/')) {
      setSignedUrl(originalUrl)
      return
    }

    // TOS 文件统一走流式代理
    setLoading(true)
    try {
      const url = api.getStreamUrl(originalUrl)
      if (mountedRef.current) {
        setSignedUrl(url)
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false)
      }
    }
  }, [originalUrl])

  useEffect(() => {
    fetchSignedUrl()
  }, [fetchSignedUrl])

  return { signedUrl, loading, refresh: fetchSignedUrl }
}

/**
 * 批量获取可访问 URL 的工具函数
 */
export async function getSignedUrls(urls: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>()

  urls.forEach(url => {
    if (!url.includes('tos-cn-') && !url.includes('volces.com') && !url.startsWith('uploads/')) {
      result.set(url, url)
      return
    }

    result.set(url, api.getStreamUrl(url))
  })

  return result
}
