'use client'

import type { Ref } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import type { CreatorCardContent, CreatorVisualBrief, ReviewCandidate } from '@/types/task'
import { ArrowRight, CheckCircle2, Clapperboard, Mic, Music4, Sparkles } from 'lucide-react'

type CandidatePickerProps = {
  candidates: ReviewCandidate[]
  selectedIds: string[]
  onToggle: (candidateId: string) => void
  onChange: (candidateId: string, patch: Partial<ReviewCandidate>) => void
  onGenerate: () => void
  generating?: boolean
}

const CATEGORY_META: Record<ReviewCandidate['category'], { label: string; icon: typeof Mic }> = {
  voice: { label: '口播修改', icon: Mic },
  bgm: { label: 'BGM 修改', icon: Music4 },
  content: { label: '内容补强', icon: Clapperboard },
}

const PRIORITY_LABEL: Record<ReviewCandidate['priority'], string> = {
  high: '优先',
  medium: '建议',
  low: '补充',
}

const BOARD_SECTION_META = {
  voice: {
    title: '口播修改',
    icon: Mic,
    shellClass: 'border-[#D3EADF] bg-[linear-gradient(180deg,rgba(248,255,251,0.96),rgba(239,248,244,0.96))]',
    badgeClass: 'bg-[#E4F5EC] text-[#2F6C57]',
    dotClass: 'bg-[#78BEA2]',
    emptyText: '本次没有需要单独调整的口播问题。',
    exampleLabel: '建议改成',
  },
  bgm: {
    title: 'BGM 修改',
    icon: Music4,
    shellClass: 'border-[#F0DEC6] bg-[linear-gradient(180deg,rgba(255,251,244,0.98),rgba(255,246,234,0.96))]',
    badgeClass: 'bg-[#FCEBCF] text-[#8A5A1E]',
    dotClass: 'bg-[#F0B46A]',
    emptyText: '本次没有需要单独强调的音乐调整。',
    exampleLabel: '操作建议',
  },
  content: {
    title: '内容补强',
    icon: Clapperboard,
    shellClass: 'border-[#F1D5CF] bg-[linear-gradient(180deg,rgba(255,249,248,0.98),rgba(255,241,239,0.96))]',
    badgeClass: 'bg-[#FBE1DD] text-[#9C5147]',
    dotClass: 'bg-[#E59A8D]',
    emptyText: '本次没有需要单独补强的内容信息。',
    exampleLabel: '参考表达',
  },
} as const

export function CreatorGuidanceCandidatePicker({
  candidates,
  selectedIds,
  onToggle,
  onChange,
  onGenerate,
  generating = false,
}: CandidatePickerProps) {
  const grouped = {
    voice: candidates.filter((item) => item.category === 'voice'),
    bgm: candidates.filter((item) => item.category === 'bgm'),
    content: candidates.filter((item) => item.category === 'content'),
  }

  return (
    <Card className="border-border-subtle text-left">
      <CardHeader className="bg-accent-indigo/5 px-6 py-4 border-none">
        <div className="w-full space-y-2">
          <CardTitle className="text-[14px] font-black tracking-widest uppercase flex items-center gap-3 text-accent-indigo">
            <Sparkles size={18} />
            达人修改图候选项
          </CardTitle>
          <p className="text-sm leading-relaxed text-text-secondary">
            先勾选要发给达人的问题，再把文案顺手改成你想发出去的口吻。最终会合并成一张修改图。
          </p>
          <div className="inline-flex rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-text-secondary">
            已选 {selectedIds.length} 条
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-6 pt-4 space-y-5">
        {(['voice', 'bgm', 'content'] as const).map((key) => {
          const meta = CATEGORY_META[key]
          const Icon = meta.icon
          const items = grouped[key]
          return (
            <section key={key} className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-bold text-text-primary">
                <Icon size={16} className="text-accent-indigo" />
                {meta.label}
                <span className="text-xs font-medium text-text-tertiary">({items.length})</span>
              </div>
              {items.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border-subtle p-3 text-xs text-text-tertiary">
                  当前没有可用建议
                </div>
              ) : (
                items.map((candidate) => {
                  const checked = selectedIds.includes(candidate.id)
                  return (
                    <div
                      key={candidate.id}
                      className={`rounded-2xl border p-4 transition-all ${
                        checked
                          ? 'border-accent-indigo/35 bg-accent-indigo/5'
                          : 'border-border-subtle bg-bg-elevated/60'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => onToggle(candidate.id)}
                          className="mt-1 h-4 w-4 rounded border-border-strong accent-accent-indigo"
                        />
                        <div className="flex-1 space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="rounded-full bg-bg-card px-2.5 py-1 text-[11px] font-bold text-text-primary">
                                {candidate.time_range}
                              </span>
                              <span className="rounded-full bg-bg-card px-2.5 py-1 text-[11px] font-bold text-text-tertiary">
                                {PRIORITY_LABEL[candidate.priority]}
                              </span>
                            </div>
                            {checked ? <CheckCircle2 size={16} className="text-accent-indigo" /> : null}
                          </div>

                          <FieldBlock
                            label="问题"
                            value={candidate.problem}
                            onChange={(value) => onChange(candidate.id, { problem: value })}
                          />
                          <FieldBlock
                            label="直接改法"
                            value={candidate.direct_fix}
                            onChange={(value) => onChange(candidate.id, { direct_fix: value })}
                          />

                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <ReadonlyBlock label="修改位置" value={candidate.where_to_change} />
                            {candidate.category === 'bgm' ? (
                              <FieldBlock
                                label="音乐动作"
                                value={candidate.bgm_action || ''}
                                onChange={(value) => onChange(candidate.id, { bgm_action: value })}
                                rows={2}
                              />
                            ) : (
                              <FieldBlock
                                label="参考补充"
                                value={candidate.suggested_copy || ''}
                                onChange={(value) => onChange(candidate.id, { suggested_copy: value })}
                                rows={2}
                              />
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </section>
          )
        })}

        <Button
          variant="primary"
          fullWidth
          onClick={() => onGenerate()}
          loading={generating}
          disabled={selectedIds.length === 0}
        >
          生成合并版修改图
        </Button>
      </CardContent>
    </Card>
  )
}

type BoardProps = {
  content?: CreatorCardContent | null
  visualBrief?: CreatorVisualBrief | null
  containerRef?: Ref<HTMLDivElement>
  mode?: 'preview' | 'export'
}

export function CreatorGuidanceBoardPreview({
  content,
  visualBrief,
  containerRef,
  mode = 'preview',
}: BoardProps) {
  if (!content && !visualBrief) {
    return (
      <Card className="border-border-subtle text-left">
        <CardHeader className="bg-accent-green/5 px-6 py-4 border-none">
          <CardTitle className="text-[14px] font-black tracking-widest uppercase flex items-center gap-3 text-accent-green">
            <Sparkles size={18} />
            达人修改图成稿
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 pt-4">
          <div className="rounded-2xl border border-dashed border-border-subtle p-5 text-sm leading-relaxed text-text-tertiary">
            选择需要发送的修改项后，就会在这里生成一份适合直接发达人的修改图预览。
          </div>
        </CardContent>
      </Card>
    )
  }

  const isExportMode = mode === 'export'
  const title = visualBrief?.meta?.page_title || content?.title || '达人修改图'
  const summary = content?.summary || visualBrief?.current_video_context?.current_video_summary || '按时间顺序修改，确保达人一眼就能看懂怎么改。'
  const priorities = content?.priorities || []
  const pageSize = Math.max(1, visualBrief?.page_plan?.max_main_blocks_per_page || 2)
  const timelineBlocks = Array.isArray(visualBrief?.timeline_blocks) ? visualBrief.timeline_blocks : []
  const visualPages = timelineBlocks.length > 0
    ? Array.from({ length: Math.ceil(timelineBlocks.length / pageSize) }, (_, index) => timelineBlocks.slice(index * pageSize, (index + 1) * pageSize))
    : [[]]
  const structuredItemCount = timelineBlocks.length || ['voice', 'bgm', 'content'].reduce((sum, key) => {
    return sum + (content?.sections?.[key as 'voice' | 'bgm' | 'content']?.length || 0)
  }, 0)
  const totalPages = visualPages.length
  const mustKeepTerms = visualBrief?.reference_context?.must_keep_terms || []
  const sellingPoints = visualBrief?.reference_context?.key_selling_points || []
  const previewText = {
    primary: 'text-[#182026]',
    secondary: 'text-[#53606C]',
    tertiary: 'text-[#7B8792]',
    label: 'text-[#6A7681]',
  }

  return (
    <Card className="border-border-subtle text-left">
      <CardHeader className="bg-accent-green/5 px-6 py-4 border-none">
        <CardTitle className="text-[14px] font-black tracking-widest uppercase flex items-center gap-3 text-accent-green">
          <Sparkles size={18} />
          达人修改图成稿
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6 pt-4">
        <div
          ref={containerRef}
          className={cn(
            'guidance-board-print-root space-y-6',
            isExportMode ? 'guidance-board-export-root w-[1400px]' : 'w-full',
          )}
        >
          {visualPages.map((pageBlocks, pageIndex) => (
            <section
              key={`guidance-page-${pageIndex + 1}`}
              className={cn(
                'relative overflow-hidden rounded-[34px] border border-[#E4E2DA] bg-[radial-gradient(circle_at_top_left,rgba(171,221,215,0.34),transparent_26%),radial-gradient(circle_at_top_right,rgba(255,214,163,0.38),transparent_26%),linear-gradient(135deg,#F7F8F2_0%,#EEF7F9_45%,#FFF5EB_100%)] shadow-[0_18px_45px_rgba(80,92,104,0.12)]',
                isExportMode ? 'px-10 py-9' : 'px-5 py-5 sm:px-7 sm:py-7',
              )}
            >
              <div className="pointer-events-none absolute -left-10 top-2 h-28 w-28 rounded-full bg-[#A7D8CA]/45 blur-3xl" />
              <div className="pointer-events-none absolute right-0 top-0 h-36 w-36 rounded-full bg-[#FFD8AA]/40 blur-3xl" />
              <div className="pointer-events-none absolute bottom-0 right-6 h-24 w-24 rounded-full bg-[#F4C7BD]/35 blur-3xl" />

              <div className="relative">
                <div className="mb-6 flex flex-col gap-4 text-center">
                  <div className={cn(
                    'inline-flex self-center rounded-full border border-white/70 bg-white/78 px-4 py-1.5 text-[11px] font-black uppercase tracking-[0.28em] shadow-[inset_0_0_0_1px_rgba(115,133,146,0.08)]',
                    previewText.tertiary,
                  )}>
                    达人执行图 {totalPages > 1 ? `· 第 ${pageIndex + 1} / ${totalPages} 页` : ''}
                  </div>
                  <h3 className="text-[clamp(32px,4vw,56px)] font-black tracking-[-0.05em] text-[#131313]">
                    {title}
                  </h3>
                  <p className={cn('mx-auto max-w-4xl text-sm leading-7 md:text-[15px]', previewText.secondary)}>
                    {summary}
                  </p>
                </div>

                <div className="mb-5 flex flex-wrap items-center justify-center gap-3">
                  {pageBlocks.map((block, index) => (
                    <div
                      key={`${block.block_id}-chip`}
                      className={cn(
                        'rounded-full px-4 py-2 text-sm font-black shadow-[0_10px_20px_rgba(90,103,116,0.08)]',
                        index % 2 === 0 ? 'bg-[#C8EDF7] text-[#194C59]' : 'bg-[#FFD0A8] text-[#73411D]'
                      )}
                    >
                      {block.time_range}
                    </div>
                  ))}
                </div>

                <div className={cn('mb-5 flex flex-wrap items-center justify-center gap-2 text-xs font-semibold', previewText.secondary)}>
                  <span className="rounded-full bg-white/70 px-3 py-1.5 shadow-[inset_0_0_0_1px_rgba(115,133,146,0.08)]">
                    本轮修改量 {structuredItemCount}
                  </span>
                  {(priorities.length ? priorities : mustKeepTerms.slice(0, 3)).slice(0, 3).map((item, index) => (
                    <span key={`${item}-${index}`} className="rounded-full bg-white/70 px-3 py-1.5 shadow-[inset_0_0_0_1px_rgba(115,133,146,0.08)]">
                      {item}
                    </span>
                  ))}
                </div>

                <div className={cn('grid gap-5', pageBlocks.length > 1 ? 'xl:grid-cols-2' : 'grid-cols-1')}>
                  {pageBlocks.map((block, index) => (
                    <article
                      key={block.block_id}
                      className="rounded-[30px] border border-[#E8E3D7] bg-white/84 p-5 shadow-[0_16px_28px_rgba(95,108,120,0.08)] backdrop-blur-sm"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="rounded-full bg-[#F6F7F3] px-3.5 py-1.5 text-[12px] font-black text-[#53606C] shadow-[inset_0_0_0_1px_rgba(115,133,146,0.08)]">
                          {block.time_range}
                        </span>
                        <span className={cn('text-[11px] font-black uppercase tracking-[0.18em]', previewText.tertiary)}>
                          第 {pageIndex * pageSize + index + 1} 段
                        </span>
                      </div>

                      <div
                        className={cn(
                          'mt-3 rounded-[22px] px-5 py-3 text-center text-[clamp(22px,2.4vw,34px)] font-black tracking-[-0.03em] text-[#181818] shadow-[inset_0_-2px_0_rgba(255,255,255,0.3)]',
                          index % 2 === 0
                            ? 'bg-[linear-gradient(180deg,#9EDAF0,#7CC6E2)]'
                            : 'bg-[linear-gradient(180deg,#FFC992,#F5A45D)]'
                        )}
                      >
                        {block.segment_title}
                      </div>

                      <div className="mt-4 space-y-4">
                        <BoardInfoPanel
                          label="当前问题"
                          value={block.current_problem}
                          tone="neutral"
                        />
                        <BoardInfoPanel
                          label="直接改法"
                          value={block.content_task}
                          tone="accent"
                        />

                        <div className="grid gap-3 md:grid-cols-2">
                          <BoardInfoPanel
                            label="口播方向"
                            value={block.voice_direction || '按当前表达自然收口，重点句放慢一拍。'}
                            tone="soft"
                          />
                          <BoardInfoPanel
                            label="BGM / 节奏"
                            value={block.bgm_direction || '保持陪衬，不要压住人声重点。'}
                            tone="soft"
                          />
                        </div>

                        {block.emotion?.length ? (
                          <div className="rounded-[22px] bg-[#F9FBFF] px-4 py-3 shadow-[inset_0_0_0_1px_rgba(115,133,146,0.08)]">
                            <div className={cn('text-[11px] font-black uppercase tracking-[0.2em]', previewText.label)}>情绪 / 表达</div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {block.emotion.map((item, emotionIndex) => (
                                <span key={`${item}-${emotionIndex}`} className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-[#182026] shadow-[inset_0_0_0_1px_rgba(115,133,146,0.08)]">
                                  {item}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
                          <div className="rounded-[22px] bg-[#FFFBF5] px-4 py-3 shadow-[inset_0_0_0_1px_rgba(115,133,146,0.08)]">
                            <div className={cn('text-[11px] font-black uppercase tracking-[0.2em]', previewText.label)}>必须保留卖点</div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {(block.must_keep_selling_points?.length ? block.must_keep_selling_points : sellingPoints.slice(0, 3)).slice(0, 3).map((item, sellingIndex) => (
                                <span key={`${item}-${sellingIndex}`} className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-[#182026] shadow-[inset_0_0_0_1px_rgba(115,133,146,0.08)]">
                                  {item}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div className="rounded-[22px] bg-[#F7FBF8] px-4 py-3 shadow-[inset_0_0_0_1px_rgba(115,133,146,0.08)]">
                            <div className={cn('text-[11px] font-black uppercase tracking-[0.2em]', previewText.label)}>画面锚点</div>
                            <div className="mt-2 text-sm font-semibold leading-6 text-[#182026]">
                              {block.visual_anchor}
                            </div>
                          </div>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>

                {(visualBrief?.transition_blocks?.length || priorities.length) ? (
                  <div className="mt-5 rounded-[24px] bg-white/72 px-5 py-4 shadow-[inset_0_0_0_1px_rgba(115,133,146,0.08)]">
                    <div className="flex items-center gap-2 text-sm font-black text-[#182026]">
                      <ArrowRight size={16} className="text-[#7AA6B7]" />
                      收口提醒
                    </div>
                    <div className={cn('mt-2 space-y-1.5 text-sm leading-6', previewText.secondary)}>
                      {(visualBrief?.transition_blocks?.map((item) => item.instruction) || priorities).slice(0, 3).map((item, index) => (
                        <p key={`${item}-${index}`}>{item}</p>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </section>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function BoardInfoPanel({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'neutral' | 'accent' | 'soft'
}) {
  const toneClass = {
    neutral: 'bg-[#FBFCF8]',
    accent: 'bg-[#FFF7EC]',
    soft: 'bg-[#F8FBFE]',
  }[tone]

  return (
    <div className={cn('rounded-[22px] px-4 py-3 shadow-[inset_0_0_0_1px_rgba(115,133,146,0.08)]', toneClass)}>
      <div className="text-[11px] font-black uppercase tracking-[0.2em] text-[#6A7681]">{label}</div>
      <p className="mt-1.5 break-words text-sm leading-6 text-[#182026] [word-break:break-word]">{value}</p>
    </div>
  )
}

function FieldBlock({
  label,
  value,
  onChange,
  rows = 3,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  rows?: number
}) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-bold uppercase tracking-widest text-text-tertiary">{label}</div>
      <textarea
        value={value}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-xl border border-border-subtle bg-bg-card px-3 py-2 text-sm leading-relaxed text-text-primary outline-none focus:border-accent-indigo/40 focus:ring-2 focus:ring-accent-indigo/15"
      />
    </label>
  )
}

function ReadonlyBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-1 text-xs font-bold uppercase tracking-widest text-text-tertiary">{label}</div>
      <div className="min-h-[72px] rounded-xl border border-border-subtle bg-bg-card px-3 py-2 text-sm leading-relaxed text-text-primary">
        {value || '未填写'}
      </div>
    </div>
  )
}
