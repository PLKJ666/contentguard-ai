'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, FileText, Trash2, Edit, Search, Eye, Loader2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { SuccessTag, PendingTag } from '@/components/ui/Tag'
import { useToast } from '@/components/ui/Toast'
import { api } from '@/lib/api'
import type { ProjectResponse } from '@/types/project'
import type { BriefResponse } from '@/types/brief'

// Brief + Project 联合视图
interface BriefItem {
  projectId: string
  projectName: string
  projectStatus: string
  brief: BriefResponse | null
  updatedAt: string
}

function getBriefSummary(brief: BriefResponse): string {
  const parts = [
    brief.product_name?.trim() ? `产品: ${brief.product_name.trim()}` : '',
    brief.brand_tone?.trim() ? `调性: ${brief.brand_tone.trim()}` : '',
    (brief.selling_points?.length ?? 0) > 0 ? `${brief.selling_points!.length} 个卖点` : '',
  ].filter(Boolean)

  return parts.join(' · ')
}

function BriefSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-pulse">
      {[1, 2, 3].map(i => (
        <div key={i} className="h-64 bg-bg-elevated rounded-xl" />
      ))}
    </div>
  )
}

export default function BriefsPage() {
  const toast = useToast()
  const [briefItems, setBriefItems] = useState<BriefItem[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  // 查看详情
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [selectedItem, setSelectedItem] = useState<BriefItem | null>(null)

  const loadData = useCallback(async () => {
    try {
      const projectRes = await api.listProjects(1, 100)
      const items: BriefItem[] = []

      // 并行获取每个项目的 Brief
      const briefPromises = projectRes.items.map(async (project: ProjectResponse) => {
        try {
          const brief = await api.getBrief(project.id)
          return {
            projectId: project.id,
            projectName: project.name,
            projectStatus: project.status,
            brief,
            updatedAt: brief.updated_at || project.updated_at,
          }
        } catch {
          // Brief 不存在返回 null
          return {
            projectId: project.id,
            projectName: project.name,
            projectStatus: project.status,
            brief: null,
            updatedAt: project.updated_at,
          }
        }
      })

      const results = await Promise.all(briefPromises)
      setBriefItems(results)
    } catch (err) {
      console.error('Failed to load briefs:', err)
      toast.error('加载 Brief 列表失败')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { loadData() }, [loadData])

  const filteredItems = briefItems.filter((item) =>
    item.projectName.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // 查看 Brief 详情
  const viewBriefDetail = (item: BriefItem) => {
    setSelectedItem(item)
    setShowDetailModal(true)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Brief 管理</h1>
          <p className="text-sm text-text-secondary mt-1">查看各项目的 Brief 配置情况，在项目设置中编辑 Brief</p>
        </div>
      </div>

      {/* 搜索 */}
      <div className="relative max-w-md">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
        <input
          type="text"
          placeholder="搜索项目名称..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 border border-border-subtle rounded-xl bg-bg-elevated text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-indigo"
        />
      </div>

      {/* Brief 列表 */}
      {loading ? (
        <BriefSkeleton />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredItems.map((item) => (
            <Card key={item.projectId} className="hover:shadow-md transition-shadow border border-border-subtle">
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="p-2 bg-accent-indigo/15 rounded-lg">
                    <FileText size={24} className="text-accent-indigo" />
                  </div>
                  {item.brief ? (
                    <SuccessTag>已配置</SuccessTag>
                  ) : (
                    <PendingTag>未配置</PendingTag>
                  )}
                </div>

                <h3 className="font-semibold text-text-primary mb-1">{item.projectName}</h3>
                <p className="text-sm text-text-tertiary mb-3">
                  {item.brief ? (
                    getBriefSummary(item.brief)
                  ) : (
                    '该项目尚未配置 Brief'
                  )}
                </p>

                {item.brief && (
                  <div className="flex gap-4 text-sm text-text-tertiary mb-4">
                    <span>{item.brief.selling_points?.length || 0} 个卖点</span>
                    <span>{item.brief.blacklist_words?.length || 0} 个违禁词</span>
                    {item.brief.min_duration && item.brief.max_duration && (
                      <span>{item.brief.min_duration}-{item.brief.max_duration}秒</span>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between pt-3 border-t border-border-subtle">
                  <span className="text-xs text-text-tertiary">
                    更新于 {item.updatedAt?.split('T')[0] || '-'}
                  </span>
                  <div className="flex gap-1">
                    {item.brief && (
                      <button
                        type="button"
                        onClick={() => viewBriefDetail(item)}
                        className="p-1.5 hover:bg-bg-elevated rounded-lg transition-colors"
                        title="查看详情"
                      >
                        <Eye size={16} className="text-text-tertiary hover:text-accent-indigo" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        window.location.href = `/brand/projects/${item.projectId}/config`
                      }}
                      className="p-1.5 hover:bg-bg-elevated rounded-lg transition-colors"
                      title="编辑 Brief"
                    >
                      <Edit size={16} className="text-text-tertiary hover:text-accent-indigo" />
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {filteredItems.length === 0 && !loading && (
            <div className="col-span-3 text-center py-12 text-text-tertiary">
              <FileText size={48} className="mx-auto mb-4 opacity-50" />
              <p>没有找到匹配的项目</p>
            </div>
          )}
        </div>
      )}

      {/* Brief 详情弹窗 */}
      <Modal
        isOpen={showDetailModal}
        onClose={() => {
          setShowDetailModal(false)
          setSelectedItem(null)
        }}
        title={selectedItem?.projectName ? `Brief - ${selectedItem.projectName}` : 'Brief 详情'}
        size="lg"
      >
        {selectedItem?.brief && (
          <div className="space-y-5">
            <div className="flex items-center gap-4 p-4 rounded-xl bg-bg-elevated">
              <div className="p-3 bg-accent-indigo/15 rounded-xl">
                <FileText size={28} className="text-accent-indigo" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-text-primary">{selectedItem.projectName}</h3>
                {(selectedItem.brief.product_name || selectedItem.brief.brand_tone) && (
                  <p className="text-sm text-text-tertiary mt-0.5">
                    {[
                      selectedItem.brief.product_name?.trim()
                        ? `产品: ${selectedItem.brief.product_name.trim()}`
                        : '',
                      selectedItem.brief.brand_tone?.trim()
                        ? `品牌调性: ${selectedItem.brief.brand_tone.trim()}`
                        : '',
                    ].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
              <SuccessTag>已配置</SuccessTag>
            </div>

            {/* 卖点列表 */}
            {(selectedItem.brief.selling_points?.length ?? 0) > 0 && (
              <div>
                <h4 className="text-sm font-medium text-text-primary mb-3">卖点要求</h4>
                <div className="space-y-2">
                  {selectedItem.brief.selling_points!.map((sp, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 rounded-lg bg-bg-elevated">
                      <span className="text-sm text-text-primary">{sp.content}</span>
                      {sp.required && (
                        <span className="text-xs px-2 py-0.5 bg-accent-coral/15 text-accent-coral rounded">必须</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 违禁词 */}
            {(selectedItem.brief.blacklist_words?.length ?? 0) > 0 && (
              <div>
                <h4 className="text-sm font-medium text-text-primary mb-3">违禁词</h4>
                <div className="flex flex-wrap gap-2">
                  {selectedItem.brief.blacklist_words!.map((bw, idx) => (
                    <span key={idx} className="px-3 py-1.5 rounded-lg bg-accent-coral/10 text-accent-coral text-sm">
                      {bw.word}
                      {bw.reason && <span className="text-xs text-text-tertiary ml-1">({bw.reason})</span>}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 时长要求 */}
            {(selectedItem.brief.min_duration || selectedItem.brief.max_duration) && (
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-accent-indigo/10 border border-accent-indigo/20 text-center">
                  <p className="text-2xl font-bold text-accent-indigo">{selectedItem.brief.min_duration || '-'}秒</p>
                  <p className="text-sm text-text-secondary mt-1">最短时长</p>
                </div>
                <div className="p-4 rounded-xl bg-accent-green/10 border border-accent-green/20 text-center">
                  <p className="text-2xl font-bold text-accent-green">{selectedItem.brief.max_duration || '-'}秒</p>
                  <p className="text-sm text-text-secondary mt-1">最长时长</p>
                </div>
              </div>
            )}

            {/* 其他要求 */}
            {selectedItem.brief.other_requirements && (
              <div>
                <h4 className="text-sm font-medium text-text-primary mb-2">其他要求</h4>
                <p className="text-sm text-text-secondary p-3 rounded-lg bg-bg-elevated">
                  {selectedItem.brief.other_requirements}
                </p>
              </div>
            )}

            {/* 时间信息 */}
            <div className="flex items-center justify-between p-4 rounded-xl bg-bg-elevated text-sm">
              <div>
                <span className="text-text-tertiary">创建时间：</span>
                <span className="text-text-primary">{selectedItem.brief.created_at?.split('T')[0]}</span>
              </div>
              <div>
                <span className="text-text-tertiary">最后更新：</span>
                <span className="text-text-primary">{selectedItem.brief.updated_at?.split('T')[0]}</span>
              </div>
            </div>

            <div className="flex gap-3 justify-end pt-4 border-t border-border-subtle">
              <Button variant="ghost" onClick={() => setShowDetailModal(false)}>
                关闭
              </Button>
              <Button onClick={() => {
                setShowDetailModal(false)
                window.location.href = `/brand/projects/${selectedItem.projectId}/config`
              }}>
                编辑 Brief
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
