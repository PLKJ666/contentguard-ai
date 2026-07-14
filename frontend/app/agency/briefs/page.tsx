'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { SuccessTag, PendingTag, WarningTag } from '@/components/ui/Tag'
import {
  FileText,
  Search,
  Filter,
  Clock,
  CheckCircle,
  AlertTriangle,
  ChevronRight,
  Settings,
  Loader2
} from 'lucide-react'
import { getPlatformInfo } from '@/lib/platforms'
import { api } from '@/lib/api'
import type { ProjectResponse } from '@/types/project'
import type { BriefResponse, SellingPoint, BlacklistWord } from '@/types/brief'

// ==================== 本地视图模型 ====================
interface BriefItem {
  id: string
  projectId: string
  projectName: string
  brandName: string
  platform: string
  status: 'configured' | 'pending'
  uploadedAt: string
  configuredAt: string | null
  creatorCount: number
  sellingPoints: number
  blacklistWords: number
}

function StatusTag({ status }: { status: string }) {
  if (status === 'configured') return <SuccessTag>已配置</SuccessTag>
  if (status === 'pending') return <WarningTag>待配置</WarningTag>
  return <PendingTag>处理中</PendingTag>
}

function BriefsSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div>
          <div className="h-8 w-40 bg-bg-elevated rounded" />
          <div className="h-4 w-56 bg-bg-elevated rounded mt-2" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-8 w-20 bg-bg-elevated rounded-lg" />
          <div className="h-8 w-20 bg-bg-elevated rounded-lg" />
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="h-10 w-80 bg-bg-elevated rounded-lg" />
        <div className="h-10 w-60 bg-bg-elevated rounded-lg" />
      </div>
      <div className="grid grid-cols-1 gap-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-28 bg-bg-elevated rounded-xl" />
        ))}
      </div>
    </div>
  )
}

export default function AgencyBriefsPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [briefs, setBriefs] = useState<BriefItem[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    try {
      // 1. 获取所有项目
      const projectsData = await api.listProjects(1, 100)
      const projects = projectsData.items

      // 2. 对每个项目获取 Brief（并行请求）
      const briefResults = await Promise.allSettled(
        projects.map(async (project): Promise<BriefItem> => {
          try {
            const brief = await api.getBrief(project.id)
            const hasBrief = !!(
              brief.product_name?.trim()
              || brief.selling_points?.length
              || brief.blacklist_words?.length
              || brief.other_requirements?.trim()
              || brief.brand_tone?.trim()
            )
            return {
              id: brief.id,
              projectId: project.id,
              projectName: project.name,
              brandName: project.brand_name || '未知品牌',
              platform: project.platform || 'douyin',
              status: hasBrief ? 'configured' : 'pending',
              uploadedAt: project.created_at.split('T')[0],
              configuredAt: hasBrief ? brief.updated_at.split('T')[0] : null,
              creatorCount: project.task_count || 0,
              sellingPoints: brief.selling_points?.length || 0,
              blacklistWords: brief.blacklist_words?.length || 0,
            }
          } catch {
            // Brief 不存在，标记为待配置
            return {
              id: `no-brief-${project.id}`,
              projectId: project.id,
              projectName: project.name,
              brandName: project.brand_name || '未知品牌',
              platform: project.platform || 'douyin',
              status: 'pending',
              uploadedAt: project.created_at.split('T')[0],
              configuredAt: null,
              creatorCount: project.task_count || 0,
              sellingPoints: 0,
              blacklistWords: 0,
            }
          }
        })
      )

      const items: BriefItem[] = briefResults
        .filter((r): r is PromiseFulfilledResult<BriefItem> => r.status === 'fulfilled')
        .map(r => r.value)

      setBriefs(items)
    } catch (err) {
      console.error('加载 Brief 列表失败:', err)
      setBriefs([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  if (loading) {
    return <BriefsSkeleton />
  }

  const filteredBriefs = briefs.filter(brief => {
    const matchesSearch = brief.projectName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      brief.brandName.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesStatus = statusFilter === 'all' || brief.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const pendingCount = briefs.filter(b => b.status === 'pending').length
  const configuredCount = briefs.filter(b => b.status === 'configured').length

  return (
    <div className="space-y-6 min-h-0">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">任务配置</h1>
          <p className="text-sm text-text-secondary mt-1">配置项目 Brief，分配达人任务</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="px-3 py-1.5 bg-yellow-500/20 text-yellow-400 rounded-lg font-medium">
            {pendingCount} 待配置
          </span>
          <span className="px-3 py-1.5 bg-accent-green/20 text-accent-green rounded-lg font-medium">
            {configuredCount} 已配置
          </span>
        </div>
      </div>

      {/* 搜索和筛选 */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            type="text"
            placeholder="搜索项目名称或品牌..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-border-subtle rounded-lg bg-bg-elevated text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-indigo"
          />
        </div>
        <div className="flex items-center gap-1 p-1 bg-bg-elevated rounded-lg">
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              statusFilter === 'all' ? 'bg-bg-card text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            全部
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('pending')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              statusFilter === 'pending' ? 'bg-bg-card text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            待配置
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('configured')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              statusFilter === 'configured' ? 'bg-bg-card text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            已配置
          </button>
        </div>
      </div>

      {/* Brief 列表 */}
      <div className="grid grid-cols-1 gap-4">
        {filteredBriefs.map((brief) => {
          const platform = getPlatformInfo(brief.platform)
          return (
            <Link key={brief.id} href={`/agency/briefs/${brief.projectId}`}>
              <Card className="hover:border-accent-indigo/50 transition-colors cursor-pointer overflow-hidden">
                {/* 平台顶部条 */}
                {platform && (
                  <div className={`px-6 py-2 ${platform.bgColor} border-b ${platform.borderColor} flex items-center gap-2`}>
                    <span className="text-base">{platform.icon}</span>
                    <span className={`text-sm font-medium ${platform.textColor}`}>{platform.name}</span>
                  </div>
                )}
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                        brief.status === 'configured' ? 'bg-accent-green/20' : 'bg-yellow-500/20'
                      }`}>
                        {brief.status === 'configured' ? (
                          <CheckCircle size={24} className="text-accent-green" />
                        ) : (
                          <AlertTriangle size={24} className="text-yellow-400" />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-text-primary">{brief.projectName}</h3>
                          <StatusTag status={brief.status} />
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-sm text-text-secondary">
                          <span>{brief.brandName}</span>
                          <span className="flex items-center gap-1">
                            <Clock size={12} />
                            上传于 {brief.uploadedAt}
                          </span>
                        </div>
                      </div>
                    </div>

                  <div className="flex items-center gap-8">
                    {brief.status === 'configured' && (
                      <div className="flex items-center gap-6 text-sm">
                        <div className="text-center">
                          <div className="text-lg font-bold text-text-primary">{brief.sellingPoints}</div>
                          <div className="text-text-tertiary">卖点</div>
                        </div>
                        <div className="text-center">
                          <div className="text-lg font-bold text-text-primary">{brief.blacklistWords}</div>
                          <div className="text-text-tertiary">违禁词</div>
                        </div>
                        <div className="text-center">
                          <div className="text-lg font-bold text-text-primary">{brief.creatorCount}</div>
                          <div className="text-text-tertiary">达人</div>
                        </div>
                      </div>
                    )}
                    <Button variant={brief.status === 'pending' ? 'primary' : 'secondary'} size="sm">
                      {brief.status === 'pending' ? (
                        <>
                          <Settings size={14} />
                          去配置
                        </>
                      ) : (
                        <>
                          查看详情
                          <ChevronRight size={14} />
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
          )
        })}
      </div>

      {filteredBriefs.length === 0 && (
        <div className="text-center py-16">
          <FileText size={48} className="mx-auto text-text-tertiary opacity-50 mb-4" />
          <p className="text-text-secondary">暂无匹配的 Brief</p>
        </div>
      )}
    </div>
  )
}
