'use client'

import { createContext, useContext, useEffect, useRef, useCallback, ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { api } from '@/lib/api'

type SSEEventType =
  | 'task_updated'
  | 'review_progress'
  | 'review_completed'
  | 'new_task'
  | 'review_decision'
  | 'xhs_batch_started'
  | 'xhs_batch_progress'
  | 'xhs_batch_completed'
  | 'xhs_batch_failed'
type SSEHandler = (data: Record<string, unknown>) => void

interface SSEContextType {
  subscribe: (eventType: SSEEventType, handler: SSEHandler) => () => void
}

const SSEContext = createContext<SSEContextType | undefined>(undefined)

const API_BASE_URL_RAW = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000'
const API_BASE_URL = API_BASE_URL_RAW.replace(/\/+$/, '')
const API_BASE_PATH = API_BASE_URL.endsWith('/api/v1')
  ? API_BASE_URL
  : `${API_BASE_URL}/api/v1`

export function SSEProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth()
  const listenersRef = useRef<Map<SSEEventType, Set<SSEHandler>>>(new Map())
  const abortRef = useRef<AbortController | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dispatch = useCallback((eventType: SSEEventType, data: Record<string, unknown>) => {
    const handlers = listenersRef.current.get(eventType)
    if (handlers) {
      handlers.forEach(handler => handler(data))
    }
  }, [])

  const connect = useCallback(async () => {
    if (!isAuthenticated) return

    // 清除旧连接
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const token = api.getToken()
      if (!token) return

      const response = await fetch(`${API_BASE_PATH}/sse/events`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'text/event-stream',
        },
        signal: controller.signal,
      })

      if (!response.ok || !response.body) return

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        let currentEvent = ''
        let currentData = ''

        for (const line of lines) {
          if (line.startsWith('event:')) {
            currentEvent = line.slice(6).trim()
          } else if (line.startsWith('data:')) {
            currentData = line.slice(5).trim()
          } else if (line === '' && currentEvent && currentData) {
            try {
              const parsed = JSON.parse(currentData)
              dispatch(currentEvent as SSEEventType, parsed)
            } catch {
              // 忽略解析错误
            }
            currentEvent = ''
            currentData = ''
          }
        }
      }
      // 流正常结束（服务器关闭连接），5秒后重连
      if (!controller.signal.aborted) {
        reconnectTimerRef.current = setTimeout(connect, 5000)
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      // 5秒后重连
      reconnectTimerRef.current = setTimeout(connect, 5000)
    }
  }, [isAuthenticated, dispatch])

  useEffect(() => {
    connect()
    return () => {
      abortRef.current?.abort()
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
    }
  }, [connect])

  const subscribe = useCallback((eventType: SSEEventType, handler: SSEHandler): (() => void) => {
    if (!listenersRef.current.has(eventType)) {
      listenersRef.current.set(eventType, new Set())
    }
    listenersRef.current.get(eventType)!.add(handler)

    return () => {
      listenersRef.current.get(eventType)?.delete(handler)
    }
  }, [])

  return (
    <SSEContext.Provider value={{ subscribe }}>
      {children}
    </SSEContext.Provider>
  )
}

export function useSSE() {
  const context = useContext(SSEContext)
  if (!context) {
    throw new Error('useSSE must be used within SSEProvider')
  }
  return context
}
