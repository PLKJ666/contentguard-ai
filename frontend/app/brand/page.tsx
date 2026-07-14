'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { SuccessTag, PendingTag, WarningTag } from '@/components/ui/Tag'
import { Modal } from '@/components/ui/Modal'
import {
  Search,
  Plus,
  Filter,
  FileText,
  ChevronRight,
  Calendar,
  Pencil,
  Sparkles,
  Zap,
  ShieldCheck,
  Target,
  ArrowUpRight
} from 'lucide-react'
import { api } from '@/lib/api'
import { useSSE } from '@/contexts/SSEContext'
import { useToast } from '@/components/ui/Toast'
import { getPlatformInfo } from '@/lib/platforms'
import { cn } from '@/lib/utils'
import type { ProjectResponse } from '@/types/project'

function ProjectCard({ project, index }: { project: ProjectResponse; index: number }) {
  const platformInfo = project.platform ? getPlatformInfo(project.platform) : null

  return (
    <Link href={`/brand/projects/${project.id}`} className="block group">
      <div 
        className="relative overflow-hidden rounded-[24px] bg-bg-card border border-border-subtle p-6 transition-all duration-500 hover:border-accent-indigo hover:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.1)] animate-fade-up"
        style={{ animationDelay: `${0.1 * index}s` }}
      >
        <div className="absolute -right-4 -top-4 w-24 h-24 bg-accent-indigo/[0.03] rounded-full blur-2xl group-hover:bg-accent-indigo/10 transition-colors"></div>
        
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className={cn(
              "w-12 h-12 rounded-2xl flex items-center justify-center text-xl shadow-sm border border-border-subtle",
              platformInfo?.bgColor || 'bg-bg-elevated'
            )}>
              {platformInfo?.icon || <Target size={20} className="text-accent-indigo" />}
            </div>
            <div className="text-left">
              <h3 className="text-[17px] font-black text-text-primary group-hover:text-accent-indigo transition-colors tracking-tight">{project.name}</h3>
              <p className="text-[11px] font-bold text-text-tertiary uppercase tracking-widest">{platformInfo?.name || '标准平台'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
             <span className="text-[10px] font-black px-2 py-1 bg-accent-indigo/5 border border-accent-indigo/20 rounded-full text-accent-indigo">
               {project.status === 'active' ? '进行中' : '已完成'}
             </span>
             <ArrowUpRight size={16} className="text-text-tertiary group-hover:text-text-primary transition-colors" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="p-3 rounded-2xl bg-bg-page border border-border-subtle text-left">
            <div className="text-[10px] font-bold text-text-tertiary uppercase mb-1 tracking-tighter">总任务数</div>
            <div className="text-xl font-black text-text-primary">{project.task_count}</div>
          </div>
          <div className="p-3 rounded-2xl bg-bg-page border border-border-subtle text-left">
            <div className="text-[10px] font-bold text-text-tertiary uppercase mb-1 tracking-tighter">进度状态</div>
            <div className="text-xs font-bold text-accent-green uppercase">正常推进</div>
          </div>
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-border-subtle">
          <div className="flex items-center gap-2 text-[11px] font-mono text-text-secondary uppercase font-bold">
            <Calendar size={12} className="text-accent-indigo" />
            截止日期 {project.deadline}
          </div>
          <div className="w-8 h-8 rounded-full bg-bg-elevated border border-border-subtle flex items-center justify-center text-text-tertiary group-hover:bg-accent-indigo group-hover:text-white group-hover:border-accent-indigo transition-all">
            <ChevronRight size={14} />
          </div>
        </div>
      </div>
    </Link>
  )
}

export default function BrandDashboardPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [projects, setProjects] = useState<ProjectResponse[]>([])
  const [loading, setLoading] = useState(true)
  const toast = useToast()

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.listProjects(1, 20)
      setProjects(data.items)
    } catch (err) {
      toast.error('数据同步失败')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { loadData() }, [loadData])

  return (
    <div className="max-w-[1400px] mx-auto space-y-8 pb-24">
      
      <div className="flex items-end justify-between px-2">
        <div className="space-y-1 text-left">
          <h1 className="text-3xl font-black text-text-primary tracking-tighter">项目看板</h1>
          <p className="text-sm text-text-tertiary font-medium uppercase tracking-[0.2em]">项目组合管理</p>
        </div>
        <div className="hidden md:flex items-center gap-2 px-4 py-2 bg-bg-card border border-border-subtle rounded-full text-[11px] font-bold text-text-secondary shadow-sm">
          <div className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse"></div>
          AI 智能同步已就绪
        </div>
      </div>

      <div className="flex flex-col md:flex-row items-center justify-between gap-6 px-2">
        <div className="relative w-full md:w-96 group">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-text-tertiary group-focus-within:text-accent-indigo transition-colors" />
          <input 
            type="text"
            placeholder="搜索项目名称..."
            className="w-full pl-12 pr-4 py-4 bg-bg-card border border-border-subtle rounded-2xl text-sm font-bold text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-indigo/50 transition-all shadow-sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-4 w-full md:w-auto">
          <Button variant="secondary" size="lg" className="bg-bg-card border-border-subtle hover:bg-bg-elevated rounded-2xl flex-1 md:flex-none">
            <Filter size={18} className="mr-2" /> 智能筛选
          </Button>
          <Link href="/brand/projects/create" className="flex-1 md:flex-none">
            <Button variant="primary" size="lg" className="w-full shadow-indigo rounded-2xl px-8 font-black">
              <Plus size={18} className="mr-2" /> 发起新项目
            </Button>
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {[1,2,3].map(i => <div key={i} className="h-64 rounded-3xl bg-bg-card animate-pulse border border-border-subtle" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 px-1">
          {projects.map((p, idx) => <ProjectCard key={p.id} project={p} index={idx} />)}
        </div>
      )}

      {projects.length === 0 && !loading && (
        <div className="text-center py-20 opacity-40">
          <Target size={48} className="mx-auto mb-4" />
          <p className="font-black uppercase tracking-[0.2em]">暂无正在进行的项目</p>
        </div>
      )}
    </div>
  )
}
