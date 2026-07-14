'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { api } from '@/lib/api'
import { Loader2 } from 'lucide-react'

/**
 * Redirect page: detects task type (script/video) and redirects
 * to the appropriate review detail page.
 */
export default function ReviewRedirectPage() {
  const router = useRouter()
  const params = useParams()
  const taskId = params.id as string
  const [error, setError] = useState('')

  useEffect(() => {
    async function redirect() {
      try {
        const task = await api.getTask(taskId)
        const isVideo = task.stage.includes('video')
        const path = isVideo
          ? `/agency/review/video/${taskId}`
          : `/agency/review/script/${taskId}`
        router.replace(path)
      } catch {
        setError('加载任务失败，请返回重试')
      }
    }
    redirect()
  }, [taskId, router])

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <p className="text-text-secondary">{error}</p>
        <button
          type="button"
          onClick={() => router.back()}
          className="text-accent-indigo hover:underline"
        >
          返回
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <Loader2 size={32} className="animate-spin text-accent-indigo" />
    </div>
  )
}
