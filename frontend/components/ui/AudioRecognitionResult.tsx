'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Mic, Radio, Volume2 } from 'lucide-react'
import type { AIReviewResult } from '@/types/task'

type AudioTrackAnalysis = AIReviewResult['audio_track_analysis']

type AudioRecognitionResultProps = {
  audioTrackAnalysis?: AudioTrackAnalysis | null
  transcript?: string | null
  title?: string
}

function looksLikeTranscriptSummary(text?: string | null): boolean {
  const normalized = String(text || '').replace(/\s+/g, '')
  if (!normalized) return false
  const markers = [
    '达人口播',
    '视频口播',
    '口播了',
    '整体按脚本执行',
    '转写缺失',
    '后半段转写',
    '前半段转写',
    '主要讲述',
    '主要介绍',
  ]
  return markers.some((marker) => normalized.includes(marker))
}

export function AudioRecognitionResult({
  audioTrackAnalysis,
  transcript,
  title = '音频识别结果',
}: AudioRecognitionResultProps) {
  const [expanded, setExpanded] = useState(false)

  const analysisTranscript = (audioTrackAnalysis?.transcript || '').trim()
  const rawTranscript = (transcript || '').trim()
  const recognizedTranscript = (
    rawTranscript && (looksLikeTranscriptSummary(analysisTranscript) || rawTranscript.length > analysisTranscript.length)
      ? rawTranscript
      : analysisTranscript || rawTranscript
  ).trim()
  const toneSummary = (audioTrackAnalysis?.tone_summary || '').trim()
  const creatorGuidance = audioTrackAnalysis?.creator_guidance
  const deliverySignals = audioTrackAnalysis?.delivery_signals
  const bgm = audioTrackAnalysis?.bgm
  const environment = audioTrackAnalysis?.environment
  const audioIssues = audioTrackAnalysis?.violations || []
  const guidanceSummary = (creatorGuidance?.summary || '').trim()
  const guidanceMustFix = creatorGuidance?.must_fix || []
  const voiceoverPlan = creatorGuidance?.voiceover_plan || []
  const bgmPlan = creatorGuidance?.bgm_plan || []

  const hasTranscript = recognizedTranscript.length > 0
  const hasGuidance = Boolean(
    guidanceSummary
    || guidanceMustFix.length > 0
    || voiceoverPlan.length > 0
    || bgmPlan.length > 0
  )
  const hasDelivery = Boolean(
    toneSummary
    || deliverySignals?.summary
    || deliverySignals?.tone
    || deliverySignals?.emotion
    || deliverySignals?.energy_level
    || deliverySignals?.pacing
    || deliverySignals?.persuasiveness
    || deliverySignals?.brand_fit
  )
  const hasBgm = Boolean(
    bgm?.present
    || bgm?.summary
    || bgm?.style
    || bgm?.intensity
    || bgm?.fit
    || environment?.summary
    || (environment?.noise_types && environment.noise_types.length > 0)
    || environment?.has_noise
    || environment?.clarity_score != null
  )

  if (!hasTranscript && !hasGuidance && !hasDelivery && !hasBgm) {
    return null
  }

  const transcriptPreview = recognizedTranscript.slice(0, 280)
  const needsExpand = recognizedTranscript.length > 280

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Volume2 size={16} className="text-accent-indigo" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasGuidance && (
          <div className="rounded-lg border border-accent-indigo/20 bg-accent-indigo/5 p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-text-primary">
              <Volume2 size={14} className="text-accent-indigo" />
              达人执行建议
            </div>
            {guidanceSummary && (
              <p className="text-sm leading-relaxed text-text-primary">{guidanceSummary}</p>
            )}
            {guidanceMustFix.length > 0 && (
              <div className="mt-3 space-y-2">
                <div className="text-xs font-medium text-text-secondary">先改这几项</div>
                {guidanceMustFix.map((item, index) => (
                  <div key={`${item}-${index}`} className="rounded-lg bg-bg-card p-2 text-sm text-text-primary">
                    {index + 1}. {item}
                  </div>
                ))}
              </div>
            )}
            {voiceoverPlan.length > 0 && (
              <div className="mt-3 space-y-2">
                <div className="text-xs font-medium text-text-secondary">配音修改单</div>
                {voiceoverPlan.map((item, index) => (
                  <div key={`${item.segment || 'voice'}-${index}`} className="rounded-lg bg-bg-card p-3">
                    <div className="text-sm font-medium text-text-primary">
                      {item.segment || `第 ${index + 1} 段`}
                    </div>
                    {item.goal && <p className="mt-1 text-xs text-text-secondary">目标：{item.goal}</p>}
                    <p className="mt-1 text-sm text-text-primary">{item.instruction || '按当前内容优化语气与停顿。'}</p>
                    {(item.emotion || item.pacing) && (
                      <p className="mt-1 text-xs text-text-secondary">
                        {[item.emotion ? `情绪：${item.emotion}` : '', item.pacing ? `节奏：${item.pacing}` : '']
                          .filter(Boolean)
                          .join(' / ')}
                      </p>
                    )}
                    {item.emphasis_words && item.emphasis_words.length > 0 && (
                      <p className="mt-1 text-xs text-accent-indigo">
                        重点词：{item.emphasis_words.join('、')}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
            {bgmPlan.length > 0 && (
              <div className="mt-3 space-y-2">
                <div className="text-xs font-medium text-text-secondary">BGM 修改单</div>
                {bgmPlan.map((item, index) => (
                  <div key={`${item.segment || 'bgm'}-${index}`} className="rounded-lg bg-bg-card p-3">
                    <div className="text-sm font-medium text-text-primary">
                      {item.segment || `第 ${index + 1} 段`}
                    </div>
                    <p className="mt-1 text-sm text-text-primary">{item.instruction || '按当前情绪调整 BGM。'}</p>
                    <p className="mt-1 text-xs text-text-secondary">
                      {[item.style ? `风格：${item.style}` : '', item.action ? `动作：${item.action}` : '', item.cue_point ? `卡点：${item.cue_point}` : '']
                        .filter(Boolean)
                        .join(' / ')}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {hasTranscript && (
          <div className="rounded-lg border border-border-subtle bg-bg-elevated p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-text-primary">
              <Mic size={14} className="text-accent-indigo" />
              口播内容识别
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">
              {expanded ? recognizedTranscript : transcriptPreview}
              {!expanded && needsExpand ? '...' : ''}
            </p>
            {needsExpand && (
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                className="mt-2 text-xs text-accent-indigo hover:underline"
              >
                {expanded ? '收起' : '展开全文'}
              </button>
            )}
          </div>
        )}

        {hasDelivery && (
          <div className="rounded-lg border border-border-subtle bg-bg-elevated p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-text-primary">
              <Radio size={14} className="text-accent-amber" />
              语音语调识别
            </div>
            {toneSummary && (
              <p className="mb-3 text-sm leading-relaxed text-text-primary">{toneSummary}</p>
            )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {deliverySignals?.tone && (
                <InfoBlock label="语气风格" value={deliverySignals.tone} />
              )}
              {deliverySignals?.emotion && (
                <InfoBlock label="情绪状态" value={deliverySignals.emotion} />
              )}
              {deliverySignals?.energy_level && (
                <InfoBlock label="能量感" value={deliverySignals.energy_level} />
              )}
              {deliverySignals?.pacing && (
                <InfoBlock label="节奏" value={deliverySignals.pacing} />
              )}
              {deliverySignals?.persuasiveness && (
                <InfoBlock label="感染力/说服力" value={deliverySignals.persuasiveness} />
              )}
              {deliverySignals?.brand_fit && (
                <InfoBlock label="品牌匹配度" value={deliverySignals.brand_fit} />
              )}
            </div>
            {deliverySignals?.summary && (
              <p className="mt-3 text-sm leading-relaxed text-text-secondary">{deliverySignals.summary}</p>
            )}
          </div>
        )}

        {hasBgm && (
          <div className="rounded-lg border border-border-subtle bg-bg-elevated p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-text-primary">
              <Volume2 size={14} className="text-accent-green" />
              BGM / 环境声识别
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <InfoBlock
                label="BGM"
                value={
                  bgm?.present
                    ? [bgm.style, bgm.intensity].filter(Boolean).join(' / ') || '已识别到背景音乐'
                    : '未识别到明显 BGM'
                }
              />
              {bgm?.fit && <InfoBlock label="BGM 匹配度" value={bgm.fit} />}
              {environment?.clarity_score != null && (
                <InfoBlock label="清晰度" value={`${environment.clarity_score} / 100`} />
              )}
              {environment?.noise_types && environment.noise_types.length > 0 && (
                <InfoBlock label="噪音类型" value={environment.noise_types.join('、')} />
              )}
              {bgm?.lyrics_risk != null && (
                <InfoBlock label="歌词抢信息风险" value={bgm.lyrics_risk ? '有' : '无'} />
              )}
              {environment?.has_noise != null && (
                <InfoBlock label="环境噪音" value={environment.has_noise ? '有明显噪音' : '未识别到明显噪音'} />
              )}
            </div>
            {bgm?.summary && (
              <p className="mt-3 text-sm leading-relaxed text-text-secondary">{bgm.summary}</p>
            )}
            {environment?.summary && (
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">{environment.summary}</p>
            )}
          </div>
        )}

        {audioIssues.length > 0 && (
          <div className="rounded-lg border border-accent-coral/20 bg-accent-coral/5 p-3">
            <div className="mb-2 text-sm font-medium text-text-primary">音轨问题提示</div>
            <div className="space-y-2">
              {audioIssues.map((issue, index) => (
                <div key={`${issue.type}-${index}`} className="rounded-lg bg-bg-card p-2">
                  <div className="text-xs text-accent-coral">{issue.type}</div>
                  <div className="mt-1 text-sm text-text-primary">{issue.content}</div>
                  {issue.suggestion && (
                    <div className="mt-1 text-xs text-text-secondary">{issue.suggestion}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-bg-card p-2">
      <div className="text-xs text-text-tertiary">{label}</div>
      <div className="mt-0.5 text-sm text-text-primary">{value}</div>
    </div>
  )
}
