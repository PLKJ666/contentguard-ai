'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { ShieldCheck, ArrowRight, Sparkles, Zap, Shield } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { getSignInUrl } from '@/lib/signIn'
export default function HomePage() {
  const router = useRouter()
  const { user, isAuthenticated, isLoading } = useAuth()

  useEffect(() => {
    if (!isLoading && isAuthenticated && user) {
      switch (user.role) {
        case 'creator': router.push('/creator'); break
        case 'agency': router.push('/agency'); break
        case 'brand': router.push('/brand'); break
        case 'operator': router.push('/operator'); break
      }
    }
  }, [isLoading, isAuthenticated, user, router])

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#050505]">
        <div className="w-10 h-10 border-2 border-accent-indigo border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="relative min-h-screen bg-[#050505] flex flex-col items-center justify-center overflow-hidden px-6">
      
      {/* 极简纯净背景 - 消除灰噗噗的感觉 */}
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,#12141d_0%,#050505_100%)]" />
        
        {/* 只有极少数、极高对比度的光点，增加通透感 */}
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-accent-indigo/20 rounded-full blur-[120px] mix-blend-screen" />
        <div className="absolute bottom-[-10%] right-[0%] w-[40%] h-[40%] bg-accent-blue/10 rounded-full blur-[100px] mix-blend-screen" />
      </div>

      <div className="relative z-10 w-full max-w-5xl flex flex-col items-center text-center">
        
        {/* 顶部微章 - 锐利边框 */}
        <div className="animate-fade-up" style={{ animationDelay: '0.1s' }}>
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/[0.03] border border-white/10 mb-12">
            <Sparkles className="w-3.5 h-3.5 text-accent-indigo" />
            <span className="text-[10px] font-black uppercase tracking-[0.4em] text-white/80">Premium Compliance AI</span>
          </div>
        </div>

        {/* 主标题 - 极致清晰白 */}
        <div className="space-y-8 animate-fade-up" style={{ animationDelay: '0.2s' }}>
          <h1 className="text-7xl md:text-9xl font-black tracking-tight text-white leading-none">
            ContentGuard <span className="text-white/20">AI</span>
          </h1>
          <p className="text-lg md:text-xl font-medium text-zinc-400 max-w-xl mx-auto leading-relaxed tracking-wide">
            极致清晰的智能合规。让每一帧营销内容，<br className="hidden md:block" />
            都在毫秒级解析中焕发真实价值。
          </p>
        </div>

        {/* 核心卡片 - 高对比度、锐利边缘 (不再使用大面积模糊) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-20 w-full max-w-4xl animate-fade-up" style={{ animationDelay: '0.3s' }}>
          {[
            { icon: Zap, label: '极速解析', desc: '业界领先的视频扫描技术' },
            { icon: Shield, label: '硬性风控', desc: '全自动化风险识别与预警' },
            { icon: Sparkles, label: '品牌学习', desc: '深度学习特定品牌审美标准' }
          ].map((item, idx) => (
            <div key={idx} className="relative p-8 rounded-3xl bg-white/[0.02] border border-white/[0.08] hover:border-white/20 hover:bg-white/[0.04] transition-all duration-300 group text-left">
              <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center mb-6 border border-white/5">
                <item.icon className="w-5 h-5 text-white" />
              </div>
              <div className="font-bold text-white text-lg mb-2">{item.label}</div>
              <div className="text-sm text-zinc-500 leading-snug">{item.desc}</div>
            </div>
          ))}
        </div>

        {/* 登录入口 - 极致对比度 */}
        <div className="mt-20 animate-fade-up" style={{ animationDelay: '0.4s' }}>
          <button
            onClick={() => { window.location.href = getSignInUrl() }}
            className="group relative flex items-center gap-3 px-12 py-5 rounded-2xl bg-white text-black font-black text-lg transition-all hover:scale-[1.02] active:scale-95 shadow-[0_0_60px_-15px_rgba(255,255,255,0.3)]"
          >
            开启智能审核
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </button>
          
          <div className="mt-8 flex items-center justify-center gap-8 text-[9px] font-black uppercase tracking-[0.3em] text-zinc-600">
            <span className="text-white/40">Enterprise Grade</span>
            <div className="w-1 h-1 bg-zinc-800 rounded-full" />
            <span className="text-white/40">Secured Privacy</span>
            <div className="w-1 h-1 bg-zinc-800 rounded-full" />
            <span className="text-white/40">99.9% Uptime</span>
          </div>
        </div>

      </div>

      {/* 底部信息 */}
      <div className="absolute bottom-10 left-10 text-[9px] font-mono text-zinc-800 uppercase tracking-widest font-bold">
        CONTENTGUARD AI // PORTFOLIO_BUILD_2026
      </div>
    </div>
  )
}
