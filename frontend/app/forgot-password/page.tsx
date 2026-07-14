'use client'

import { ArrowLeft, ShieldCheck } from 'lucide-react'
import Link from 'next/link'

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-screen bg-bg-page flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-8">
        <Link
          href="/login"
          className="inline-flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          返回登录
        </Link>

        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-accent-indigo to-[#4F46E5] flex items-center justify-center shadow-[0px_8px_24px_-4px_rgba(99,102,241,0.4)]">
            <ShieldCheck className="w-7 h-7 text-white" />
          </div>
          <div>
            <span className="text-2xl font-bold text-text-primary">统一认证帮助</span>
            <p className="text-sm text-text-secondary">密码与安全设置由 Logto 统一管理</p>
          </div>
        </div>

        <div className="p-4 bg-bg-card border border-border-subtle rounded-xl">
          <p className="text-sm text-text-secondary leading-relaxed">
            请返回统一登录页处理登录、注册或密码重置。如果当前租户未开放自助重置能力，请联系管理员在统一认证侧协助处理。
          </p>
        </div>

        <Link
          href="/login"
          className="block w-full py-3.5 rounded-xl bg-gradient-to-r from-accent-indigo to-[#4F46E5] text-white font-semibold text-base text-center shadow-[0px_8px_24px_-4px_rgba(99,102,241,0.4)] hover:opacity-90 transition-opacity"
        >
          前往统一登录
        </Link>
      </div>
    </div>
  )
}
