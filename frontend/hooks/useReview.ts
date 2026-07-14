'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { api } from '@/lib/api'
import type {
  VideoReviewRequest,
  ReviewTask,
  ReviewTaskStatus,
} from '@/types/review'

interface UseReviewOptions {
  pollingInterval?: number
  onComplete?: (result: ReviewTask) => void
  onError?: (error: Error) => void
}

/**
 * 视频审核 Hook
 */
export function useReview(options: UseReviewOptions = {}) {
  const { pollingInterval = 2000, onComplete, onError } = options

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isPolling, setIsPolling] = useState(false)
  const [task, setTask] = useState<ReviewTask | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  /**
   * 提交审核
   */
  const submitReview = useCallback(async (data: VideoReviewRequest) => {
    setIsSubmitting(true)
    setError(null)

    try {
      const response = await api.submitVideoReview(data)
      setTask({
        review_id: response.review_id,
        status: response.status,
        created_at: new Date().toISOString(),
      })
      return response.review_id
    } catch (err) {
      const error = err instanceof Error ? err : new Error('提交失败')
      setError(error)
      onError?.(error)
      throw error
    } finally {
      setIsSubmitting(false)
    }
  }, [onError])

  /**
   * 查询进度
   */
  const fetchProgress = useCallback(async (reviewId: string) => {
    try {
      const progress = await api.getReviewProgress(reviewId)
      setTask((prev) => ({
        ...prev,
        review_id: progress.review_id,
        status: progress.status,
        progress: progress.progress,
        current_step: progress.current_step,
        created_at: prev?.created_at || new Date().toISOString(),
      }))
      return progress
    } catch (err) {
      const error = err instanceof Error ? err : new Error('查询失败')
      setError(error)
      throw error
    }
  }, [])

  /**
   * 查询结果
   */
  const fetchResult = useCallback(async (reviewId: string) => {
    try {
      const result = await api.getReviewResult(reviewId)
      const updatedTask: ReviewTask = {
        review_id: result.review_id,
        status: result.status,
        score: result.score,
        summary: result.summary,
        violations: result.violations,
        soft_warnings: result.soft_warnings,
        brand_exposure: result.brand_exposure ?? null,
        created_at: task?.created_at || new Date().toISOString(),
        completed_at: new Date().toISOString(),
      }
      setTask(updatedTask)
      return updatedTask
    } catch (err) {
      const error = err instanceof Error ? err : new Error('查询失败')
      setError(error)
      throw error
    }
  }, [task?.created_at])

  /**
   * 清除轮询定时器
   */
  const clearPollingInterval = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  /**
   * 开始轮询进度
   */
  const startPolling = useCallback((reviewId: string) => {
    // 清除之前的轮询（如果有）
    clearPollingInterval()
    setIsPolling(true)

    const poll = async () => {
      try {
        const progress = await fetchProgress(reviewId)

        if (progress.status === 'completed') {
          clearPollingInterval()
          setIsPolling(false)
          const result = await fetchResult(reviewId)
          onComplete?.(result)
        } else if (progress.status === 'failed') {
          clearPollingInterval()
          setIsPolling(false)
          const error = new Error('审核失败')
          setError(error)
          onError?.(error)
        }
      } catch {
        // 继续轮询，忽略单次错误
      }
    }

    intervalRef.current = setInterval(poll, pollingInterval)
    poll() // 立即执行一次

    return () => {
      clearPollingInterval()
      setIsPolling(false)
    }
  }, [fetchProgress, fetchResult, pollingInterval, onComplete, onError, clearPollingInterval])

  /**
   * 停止轮询
   */
  const stopPolling = useCallback(() => {
    clearPollingInterval()
    setIsPolling(false)
  }, [clearPollingInterval])

  // 组件卸载时清除定时器，防止内存泄漏
  useEffect(() => {
    return () => {
      clearPollingInterval()
    }
  }, [clearPollingInterval])

  /**
   * 重置状态
   */
  const reset = useCallback(() => {
    setTask(null)
    setError(null)
    setIsSubmitting(false)
    setIsPolling(false)
  }, [])

  return {
    task,
    error,
    isSubmitting,
    isPolling,
    submitReview,
    fetchProgress,
    fetchResult,
    startPolling,
    stopPolling,
    reset,
  }
}

/**
 * 审核结果 Hook (单次查询)
 */
export function useReviewResult(reviewId: string | null) {
  const [task, setTask] = useState<ReviewTask | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!reviewId) return

    const fetchResult = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const result = await api.getReviewResult(reviewId)
        setTask({
          review_id: result.review_id,
          status: result.status,
          score: result.score,
          summary: result.summary,
          violations: result.violations,
          soft_warnings: result.soft_warnings,
          brand_exposure: result.brand_exposure ?? null,
          created_at: new Date().toISOString(),
        })
      } catch (err) {
        setError(err instanceof Error ? err : new Error('查询失败'))
      } finally {
        setIsLoading(false)
      }
    }

    fetchResult()
  }, [reviewId])

  return { task, isLoading, error }
}
