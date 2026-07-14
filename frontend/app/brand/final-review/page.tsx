'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Check, X, CheckSquare, Video, Clock, Loader2, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getPlatformInfo } from '@/lib/platforms'
import { useToast } from '@/components/ui/Toast'
import { api } from '@/lib/api'
import { formatTaskDisplayTitle } from '@/lib/taskDisplay'
import type { TaskResponse } from '@/types/task'
import { getViolationTypeLabel } from '@/lib/reviewLabels'

// 审核流程进度组件
function ReviewProgressBar({ currentStep }: { currentStep: number }) {
  const steps = [
    { label: '已提交', step: 1 },
    { label: 'AI审核', step: 2 },
    { label: '代理商审核', step: 3 },
    { label: '品牌终审', step: 4 },
  ]

  return (
    <div className="flex items-center w-full">
      {steps.map((s, index) => {
        const isCompleted = s.step < currentStep
        const isCurrent = s.step === currentStep

        return (
          <div key={s.step} className="flex items-center flex-1">
            <div className="flex flex-col items-center gap-1">
              <div className={cn(
                'flex items-center justify-center rounded-[10px]',
                isCurrent ? 'w-6 h-6 bg-accent-indigo' :
                isCompleted ? 'w-5 h-5 bg-accent-green' :
                'w-5 h-5 bg-bg-elevated border border-border-subtle'
              )}>
                {isCompleted && <Check className="w-3 h-3 text-white" />}
                {isCurrent && <Clock className="w-3 h-3 text-white" />}
              </div>
              <span className={cn(
                'text-[10px]',
                isCurrent ? 'text-accent-indigo font-semibold' :
                isCompleted ? 'text-text-secondary' :
                'text-text-tertiary'
              )}>
                {s.label}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div className={cn(
                'h-0.5 flex-1 rounded',
                s.step < currentStep ? 'bg-accent-green' :
                s.step === currentStep ? 'bg-accent-indigo' :
                'bg-border-subtle'
              )} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function PageSkeleton() {
  return (
    <div className="flex flex-col gap-6 h-full min-h-0 animate-pulse">
      <div className="h-12 bg-bg-elevated rounded-lg w-1/3" />
      <div className="h-20 bg-bg-elevated rounded-2xl" />
      <div className="flex gap-6 flex-1 min-h-0">
        <div className="flex-1 h-96 bg-bg-elevated rounded-2xl" />
        <div className="w-[380px] h-96 bg-bg-elevated rounded-2xl" />
      </div>
    </div>
  )
}

export default function FinalReviewPage() {
  const router = useRouter()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [tasks, setTasks] = useState<TaskResponse[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [feedback, setFeedback] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [videoBlobUrl, setVideoBlobUrl] = useState<string | null>(null)

  const loadTasks = useCallback(async () => {
    try {
      // 加载品牌方待审任务（脚本 + 视频）
      const [scriptRes, videoRes] = await Promise.all([
        api.listTasks(1, 10, 'script_brand_review'),
        api.listTasks(1, 10, 'video_brand_review'),
      ])
      setTasks([...scriptRes.items, ...videoRes.items])
    } catch (err) {
      console.error('Failed to load review tasks:', err)
      toast.error('加载待审任务失败')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { loadTasks() }, [loadTasks])

  // 通过后端代理获取视频 blob URL
  useEffect(() => {
    const videoUrl = tasks[selectedIndex]?.video_file_url
    if (!videoUrl) { setVideoBlobUrl(null); return }
    let cancelled = false
    setVideoBlobUrl(null)
    api.getPreviewUrl(videoUrl)
      .then(url => { if (!cancelled) setVideoBlobUrl(url) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [tasks, selectedIndex])

  if (loading) return <PageSkeleton />

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-text-tertiary">
        <CheckSquare size={48} className="opacity-50" />
        <p className="text-lg">暂无待终审的内容</p>
        <button
          type="button"
          onClick={() => router.back()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-bg-elevated text-text-secondary text-sm font-medium"
        >
          <ArrowLeft className="w-4 h-4" />
          返回
        </button>
      </div>
    )
  }

  const selectedItem = tasks[selectedIndex]
  const isVideoReview = selectedItem.stage === 'video_brand_review'
  const aiResult = isVideoReview ? selectedItem.video_ai_result : selectedItem.script_ai_result
  const aiScore = isVideoReview ? selectedItem.video_ai_score : selectedItem.script_ai_score
  const agencyComment = isVideoReview ? selectedItem.video_agency_comment : selectedItem.script_agency_comment
  const agencyStatus = isVideoReview ? selectedItem.video_agency_status : selectedItem.script_agency_status

  const handleApprove = async () => {
    setIsSubmitting(true)
    try {
      const reviewFn = isVideoReview ? api.reviewVideo : api.reviewScript
      await reviewFn(selectedItem.id, { action: 'pass', comment: feedback || undefined })
      toast.success('已通过审核')
      setFeedback('')
      // 移除已审核任务
      const remaining = tasks.filter((_, i) => i !== selectedIndex)
      setTasks(remaining)
      if (selectedIndex >= remaining.length && remaining.length > 0) {
        setSelectedIndex(remaining.length - 1)
      }
    } catch (err) {
      toast.error('操作失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleReject = async () => {
    if (!feedback.trim()) {
      toast.error('请填写驳回原因')
      return
    }
    setIsSubmitting(true)
    try {
      const reviewFn = isVideoReview ? api.reviewVideo : api.reviewScript
      await reviewFn(selectedItem.id, { action: 'reject', comment: feedback })
      toast.success('已驳回')
      setFeedback('')
      const remaining = tasks.filter((_, i) => i !== selectedIndex)
      setTasks(remaining)
      if (selectedIndex >= remaining.length && remaining.length > 0) {
        setSelectedIndex(remaining.length - 1)
      }
    } catch (err) {
      toast.error('操作失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 h-full min-h-0">
      {/* 顶部栏 */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-text-primary">终审台</h1>
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-medium ${
              isVideoReview ? 'bg-purple-500/15 text-purple-400' : 'bg-accent-indigo/15 text-accent-indigo'
            }`}>
              {isVideoReview ? <Video size={14} /> : <FileText size={14} />}
              {isVideoReview ? '视频终审' : '脚本终审'}
            </span>
          </div>
          <p className="text-sm text-text-secondary">
            {formatTaskDisplayTitle({
              taskName: selectedItem.name,
              projectName: selectedItem.project?.name,
              sequence: selectedItem.sequence,
            })} · 达人: {selectedItem.creator.name}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-text-tertiary">
            {selectedIndex + 1} / {tasks.length} 待审
          </span>
          <button
            type="button"
            onClick={() => router.back()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-bg-elevated text-text-secondary text-sm font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            返回列表
          </button>
        </div>
      </div>

      {/* 审核流程进度 */}
      <div className="bg-bg-card rounded-2xl p-5 card-shadow">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-text-primary">审核流程</span>
          <span className="text-xs text-accent-indigo font-medium">当前：品牌终审</span>
        </div>
        <ReviewProgressBar currentStep={4} />
      </div>

      {/* 主内容区 - 两栏布局 */}
      <div className="flex gap-6 flex-1 min-h-0">
        {/* 左侧 - 预览 */}
        <div className="flex-1 flex flex-col gap-4">
          <div className="flex-1 bg-bg-card rounded-2xl card-shadow flex items-center justify-center">
            {isVideoReview ? (
              selectedItem.video_file_url ? (
                <video
                  className="w-full h-full rounded-2xl"
                  controls
                  src={videoBlobUrl || selectedItem.video_file_url}
                >
                  您的浏览器不支持视频播放
                </video>
              ) : (
                <div className="flex flex-col items-center gap-4">
                  <div className="w-20 h-20 rounded-full bg-bg-elevated flex items-center justify-center">
                    <Video className="w-10 h-10 text-text-tertiary" />
                  </div>
                  <p className="text-sm text-text-tertiary">视频文件不可用</p>
                </div>
              )
            ) : (
              <div className="flex flex-col items-center gap-4 p-8">
                <FileText className="w-16 h-16 text-accent-indigo/50" />
                <p className="text-text-secondary">{selectedItem.script_file_name || '脚本预览'}</p>
                <p className="text-xs text-text-tertiary">请在详情页查看完整脚本内容</p>
              </div>
            )}
          </div>
        </div>

        {/* 右侧 - 分析面板 */}
        <div className="w-[380px] flex flex-col gap-4 overflow-y-auto overflow-x-hidden">
          {/* 代理商初审意见 */}
          <div className="bg-bg-card rounded-2xl p-5 card-shadow">
            <div className="flex items-center justify-between mb-3">
              <span className="text-base font-semibold text-text-primary">代理商初审意见</span>
              <span className={cn(
                'px-3 py-1.5 rounded-lg text-[13px] font-semibold',
                agencyStatus === 'passed' || agencyStatus === 'force_passed'
                  ? 'bg-accent-green/15 text-accent-green'
                  : 'bg-accent-coral/15 text-accent-coral'
              )}>
                {agencyStatus === 'passed' || agencyStatus === 'force_passed' ? '已通过' : '需修改'}
              </span>
            </div>
            <div className="bg-bg-elevated rounded-[10px] p-3 flex flex-col gap-2">
              <span className="text-xs text-text-tertiary">
                审核人：{selectedItem.agency.name}
              </span>
              <p className="text-[13px] text-text-secondary">
                {agencyComment || '无评论'}
              </p>
            </div>
          </div>

          {/* AI 分析结果 */}
          <div className="bg-bg-card rounded-2xl p-5 card-shadow">
            <div className="flex items-center justify-between mb-4">
              <span className="text-base font-semibold text-text-primary">AI 分析结果</span>
              <span className={cn(
                'px-3 py-1.5 rounded-lg text-[13px] font-semibold',
                (aiScore || 0) >= 80 ? 'bg-accent-green/15 text-accent-green' : 'bg-accent-amber/15 text-accent-amber'
              )}>
                评分: {aiScore || '-'}
              </span>
            </div>
            <div className="flex flex-col gap-3">
              {aiResult?.violations && aiResult.violations.length > 0 ? (
                aiResult.violations.map((v, idx) => (
                  <div key={idx} className="bg-bg-elevated rounded-[10px] p-3 flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <CheckSquare className="w-4 h-4 text-accent-coral" />
                      <span className="text-sm font-semibold text-accent-coral">{getViolationTypeLabel(v.type)}</span>
                    </div>
                    <p className="text-[13px] text-text-secondary">{v.content}</p>
                    {v.suggestion && (
                      <p className="text-xs text-accent-indigo">{v.suggestion}</p>
                    )}
                  </div>
                ))
              ) : (
                <div className="bg-bg-elevated rounded-[10px] p-3 flex items-center gap-2">
                  <CheckSquare className="w-4 h-4 text-accent-green" />
                  <span className="text-sm font-semibold text-accent-green">合规检测通过</span>
                </div>
              )}
              {aiResult?.summary && (
                <p className="text-xs text-text-tertiary mt-1">{aiResult.summary}</p>
              )}
            </div>
          </div>

          {/* 终审决策 */}
          <div className="bg-bg-card rounded-2xl p-5 card-shadow">
            <h3 className="text-base font-semibold text-text-primary mb-4">终审决策</h3>

            {/* 决策按钮 */}
            <div className="flex gap-3 mb-4">
              <button
                type="button"
                onClick={handleApprove}
                disabled={isSubmitting}
                className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl bg-accent-green text-white font-semibold disabled:opacity-50"
              >
                {isSubmitting ? <Loader2 className="w-[18px] h-[18px] animate-spin" /> : <Check className="w-[18px] h-[18px]" />}
                通过
              </button>
              <button
                type="button"
                onClick={handleReject}
                disabled={isSubmitting}
                className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl bg-accent-coral text-white font-semibold disabled:opacity-50"
              >
                {isSubmitting ? <Loader2 className="w-[18px] h-[18px] animate-spin" /> : <X className="w-[18px] h-[18px]" />}
                驳回
              </button>
            </div>

            {/* 终审意见 */}
            <div className="flex flex-col gap-2">
              <label className="text-[13px] font-medium text-text-secondary">
                终审意见（驳回时必填）
              </label>
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="输入终审意见或修改建议..."
                className="w-full h-20 p-3.5 rounded-xl bg-bg-elevated border border-border-subtle text-sm text-text-primary placeholder-text-tertiary resize-none focus:outline-none focus:ring-2 focus:ring-accent-indigo"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
