'use client'

import { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react'
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react'

// Toast 类型
type ToastType = 'success' | 'error' | 'warning' | 'info'

// Toast 项
interface ToastItem {
  id: string
  type: ToastType
  message: string
  duration?: number
}

// Toast Context
interface ToastContextType {
  toast: {
    success: (message: string, duration?: number) => void
    error: (message: string, duration?: number) => void
    warning: (message: string, duration?: number) => void
    info: (message: string, duration?: number) => void
  }
}

const ToastContext = createContext<ToastContextType | null>(null)

// Toast 图标配置
const toastConfig = {
  success: {
    icon: CheckCircle,
    bgColor: 'bg-accent-green/15',
    borderColor: 'border-accent-green/30',
    iconColor: 'text-accent-green',
    textColor: 'text-accent-green',
  },
  error: {
    icon: XCircle,
    bgColor: 'bg-accent-coral/15',
    borderColor: 'border-accent-coral/30',
    iconColor: 'text-accent-coral',
    textColor: 'text-accent-coral',
  },
  warning: {
    icon: AlertTriangle,
    bgColor: 'bg-accent-amber/15',
    borderColor: 'border-accent-amber/30',
    iconColor: 'text-accent-amber',
    textColor: 'text-accent-amber',
  },
  info: {
    icon: Info,
    bgColor: 'bg-accent-indigo/15',
    borderColor: 'border-accent-indigo/30',
    iconColor: 'text-accent-indigo',
    textColor: 'text-accent-indigo',
  },
}

// 单个 Toast 组件
function ToastItem({ item, onClose }: { item: ToastItem; onClose: (id: string) => void }) {
  const config = toastConfig[item.type]
  const Icon = config.icon

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${config.bgColor} ${config.borderColor} shadow-lg animate-slide-in min-w-[280px] max-w-[400px]`}
    >
      <Icon size={20} className={config.iconColor} />
      <span className={`flex-1 text-sm font-medium ${config.textColor}`}>{item.message}</span>
      <button
        type="button"
        onClick={() => onClose(item.id)}
        className="p-1 rounded-lg hover:bg-white/10 transition-colors"
      >
        <X size={16} className="text-text-tertiary" />
      </button>
    </div>
  )
}

// Toast Provider
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const addToast = useCallback((type: ToastType, message: string, duration = 3000) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const newToast: ToastItem = { id, type, message, duration }

    setToasts((prev) => [...prev, newToast])

    // 自动移除
    if (duration > 0) {
      setTimeout(() => {
        removeToast(id)
      }, duration)
    }
  }, [removeToast])

  const success = useCallback((message: string, duration?: number) => {
    addToast('success', message, duration)
  }, [addToast])

  const error = useCallback((message: string, duration?: number) => {
    addToast('error', message, duration)
  }, [addToast])

  const warning = useCallback((message: string, duration?: number) => {
    addToast('warning', message, duration)
  }, [addToast])

  const info = useCallback((message: string, duration?: number) => {
    addToast('info', message, duration)
  }, [addToast])

  const toast = useMemo(() => ({
    success,
    error,
    warning,
    info,
  }), [success, error, warning, info])

  const value = useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Toast 容器 */}
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2">
        {toasts.map((item) => (
          <ToastItem key={item.id} item={item} onClose={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

// useToast Hook
export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context.toast
}

export default ToastProvider
