'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import {
  AlertTriangle,
  Clock,
  CheckCircle,
  ChevronRight,
  FileVideo,
  MessageSquare,
  Sparkles,
  User
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { formatTaskDisplayTitle } from '@/lib/taskDisplay'
import { useSSE } from '@/contexts/SSEContext'
import type { AgencyDashboard as AgencyDashboardType } from '@/types/dashboard'
import type { TaskResponse } from '@/types/task'

function UrgentLevelIcon({ level }: { level: string }) {
  if (level === 'high') return <AlertTriangle size={16} />
  if (level === 'medium') return <MessageSquare size={16} />
  return <CheckCircle size={16} />
}

function getTaskTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const hours = Math.floor(diff / 3600000)
  if (hours < 1) return `${Math.floor(diff / 60000)}分钟前`
  if (hours < 24) return `${hours}小时前`
  return `${Math.floor(hours / 24)}天前`
}

export default function AgencyDashboard() {
  const [stats, setStats] = useState<AgencyDashboardType | null>(null)
  const [pendingTasks, setPendingTasks] = useState<TaskResponse[]>([])
  const [loading, setLoading] = useState(true)
  const { subscribe } = useSSE()

  const loadData = useCallback(async () => {
    try {
      const [dashboardData, scriptTasks, videoTasks] = await Promise.all([
        api.getAgencyDashboard(),
        api.listTasks(1, 5, 'script_agency_review'),
        api.listTasks(1, 5, 'video_agency_review'),
      ])
      setStats(dashboardData)
      const merged = [...scriptTasks.items, ...videoTasks.items]
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        .slice(0, 5)
      setPendingTasks(merged)
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  if (loading || !stats) return <div className="p-8 animate-pulse text-text-tertiary">同步情报中...</div>

  const urgentTodos = pendingTasks.slice(0, 3).map(task => ({
    id: task.id,
    title: formatTaskDisplayTitle({
      taskName: task.name,
      projectName: task.project?.name,
      sequence: task.sequence,
    }),
    description: `${task.creator.name} · ${task.stage.includes('video') ? '视频' : '脚本'}`,
    time: getTaskTimeAgo(task.updated_at),
    level: (task.video_ai_score || task.script_ai_score || 100) < 60 ? 'high' : 'medium',
  }))

  return (
    <div className="space-y-10 min-h-0 pb-20 max-w-[1400px] mx-auto animate-fade-in">
      <div className="relative flex items-end justify-between px-2">
        <div className="space-y-1 text-left">
          <h1 className="text-3xl font-black text-text-primary tracking-tighter">工作台概览</h1>
          <p className="text-sm text-text-tertiary font-medium uppercase tracking-[0.2em]">代理商指挥中心</p>
        </div>
        <div className="hidden md:flex items-center gap-2 px-4 py-2 bg-bg-card border border-border-subtle rounded-full text-xs text-text-secondary shadow-sm">
          <div className="w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse"></div>
          数据实时同步中
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: '待审核项', value: stats.pending_review.script + stats.pending_review.video, sub: `脚本 ${stats.pending_review.script} · 视频 ${stats.pending_review.video}`, icon: Clock, color: 'text-accent-coral', bg: 'bg-accent-coral/10' },
          { label: '待处理申诉', value: stats.pending_appeal, sub: '达人申诉项', icon: MessageSquare, color: 'text-orange-400', bg: 'bg-orange-400/10' },
          { label: '今日已通过', value: stats.today_passed.script + stats.today_passed.video, sub: '审核效率稳定', icon: CheckCircle, color: 'text-accent-green', bg: 'bg-accent-green/10' },
          { label: '进行中任务', value: stats.in_progress.script + stats.in_progress.video, sub: '全流程监控', icon: FileVideo, color: 'text-accent-indigo', bg: 'bg-accent-indigo/10' },
        ].map((item, idx) => (
          <Card key={idx} className="group relative overflow-hidden border-border-subtle hover:border-accent-indigo transition-all duration-500 shadow-sm">
            <CardContent className="py-6">
              <div className="flex items-start justify-between">
                <div className="space-y-2 text-left">
                  <div className="text-[12px] font-black text-text-tertiary uppercase tracking-widest">{item.label}</div>
                  <div className={cn("text-4xl font-black tracking-tighter", item.color)}>{item.value}</div>
                  <div className="text-[11px] text-text-tertiary font-medium bg-bg-page px-2 py-0.5 rounded-full inline-block border border-border-subtle">{item.sub}</div>
                </div>
                <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110 duration-500", item.bg)}>
                  <item.icon size={24} className={item.color} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-4 space-y-6">
          <div className="flex items-center gap-2 px-1">
            <div className="w-1.5 h-5 bg-accent-coral rounded-full"></div>
            <h2 className="text-lg font-bold text-text-primary tracking-tight">紧急待办</h2>
          </div>
          <div className="space-y-3">
            {urgentTodos.map((todo) => (
              <Link key={todo.id} href={`/agency/review/${todo.id}`} className="group block p-4 rounded-2xl bg-bg-card border border-border-subtle hover:border-accent-indigo transition-all shadow-sm">
                <div className="flex items-start gap-4 text-left">
                  <div className={cn("mt-1 p-2 rounded-xl", todo.level === 'high' ? 'bg-accent-coral/10 text-accent-coral' : 'bg-accent-amber/10 text-accent-amber')}><UrgentLevelIcon level={todo.level} /></div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-text-primary text-[15px] truncate">{todo.title}</div>
                    <div className="text-xs text-text-tertiary mt-1">{todo.description}</div>
                    <div className="flex items-center gap-1.5 mt-3 text-[10px] font-mono font-bold text-text-tertiary/60 uppercase"><Clock size={10} /> {todo.time}</div>
                  </div>
                  <ChevronRight size={16} className="text-text-tertiary/40 mt-1" />
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="lg:col-span-8 space-y-6">
          <Link href="/agency/xhs" className="group block rounded-3xl border border-accent-indigo/20 bg-gradient-to-br from-accent-indigo/10 via-bg-card to-accent-green/10 p-6 shadow-sm hover:border-accent-indigo/40 transition-all">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 text-left">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.28em] text-accent-indigo">
                  <Sparkles size={12} />
                  XHS Batch
                </div>
                <div className="text-2xl font-black tracking-tighter text-text-primary">小红书批量改写工作台</div>
                <div className="text-sm text-text-secondary">试运行、全量改写、导出 all.md / 飞书文档都已经接通。</div>
              </div>
              <div className="inline-flex items-center gap-2 text-sm font-bold text-accent-indigo">
                进入工作台
                <ChevronRight size={16} />
              </div>
            </div>
          </Link>

          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-5 bg-accent-indigo rounded-full"></div>
              <h2 className="text-lg font-bold text-text-primary tracking-tight">最近提交</h2>
            </div>
            <Link href="/agency/review" className="text-xs font-black text-accent-indigo uppercase tracking-widest hover:underline font-bold">查看全部</Link>
          </div>
          <div className="space-y-2">
            {pendingTasks.map((task) => {
              const isVideo = task.stage.includes('video')
              const aiScore = isVideo ? task.video_ai_score : task.script_ai_score
              return (
                <div key={task.id} className="group flex flex-col sm:flex-row items-center gap-4 p-4 rounded-2xl bg-bg-card border border-border-subtle hover:border-accent-indigo transition-all shadow-sm text-left w-full">
                  <div className="flex-1 min-w-0 w-full">
                    <div className="flex items-center gap-3 mb-1.5">
                      <span className={cn("px-2 py-0.5 text-[10px] font-black uppercase rounded-md tracking-tighter shadow-sm", isVideo ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' : 'bg-accent-indigo/10 text-accent-indigo border border-accent-indigo/20')}>{isVideo ? '视频' : '脚本'}</span>
                      <span className="font-bold text-text-primary text-[15px] truncate">
                        {formatTaskDisplayTitle({
                          taskName: task.name,
                          projectName: task.project?.name,
                          sequence: task.sequence,
                        })}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-[12px] text-text-tertiary font-medium">
                      <span className="flex items-center gap-1.5"><User size={12} className="opacity-60" /> {task.creator.name}</span>
                      <span className="flex items-center gap-1.5 opacity-60"><Clock size={12} /> {new Date(task.created_at).toLocaleDateString('zh-CN')}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-8 w-full sm:w-auto justify-between sm:justify-end border-t sm:border-t-0 border-border-subtle/10 pt-3 sm:pt-0">
                    <div className="flex flex-col items-end">
                      <div className="text-[10px] font-black text-text-tertiary uppercase tracking-widest opacity-40">AI 评分</div>
                      <div className={cn("text-lg font-black tracking-tighter", aiScore != null ? aiScore >= 80 ? 'text-accent-green' : aiScore >= 60 ? 'text-accent-amber' : 'text-accent-coral' : 'text-text-tertiary')}>{aiScore != null ? `${aiScore}%` : '暂无'}</div>
                    </div>
                    <Link href={`/agency/review/${task.id}`}><Button size="md" className="shadow-indigo min-w-[100px] font-black tracking-tight rounded-xl">审核</Button></Link>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
