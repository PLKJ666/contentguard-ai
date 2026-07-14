import { describe, expect, it } from 'vitest'

import { extractScriptReviewInsights } from './scriptReviewInsights'

describe('extractScriptReviewInsights', () => {
  it('extracts creative director insight groups from chain_of_thought', () => {
    const result = extractScriptReviewInsights({
      creative_director: {
        brief_match: {
          summary: 'Brief 匹配度较高',
        },
        content_quality: {
          summary: '内容质量较强，表达自然',
          reasoning: {
            audience: {
              checklist: [
                { criterion: '目标人群一致', detail: '内容受众与品牌目标人群重合。', result: 'pass' },
              ],
            },
            tone: {
              checklist: [
                { criterion: '表达自然', detail: '没有说教感，不会引起反感。', result: 'pass' },
              ],
            },
            content_style: {
              checklist: [
                { criterion: '风格贴合', detail: '整体偏轻松分享，贴合平台内容生态。', result: 'pass' },
              ],
            },
            structure: {
              checklist: [
                { criterion: '开头有钩子', detail: '开场用痛点切入，能快速抓住注意力。', result: 'pass' },
              ],
            },
          },
          highlights: ['开头抓人', '卖点融入自然'],
          suggestions: ['补充价格信息'],
        },
      },
    })

    expect(result.briefSummary).toBe('Brief 匹配度较高')
    expect(result.qualitySummary).toBe('内容质量较强，表达自然')
    expect(result.audience).toHaveLength(1)
    expect(result.tone[0]?.detail).toContain('不会引起反感')
    expect(result.contentStyle[0]?.criterion).toBe('风格贴合')
    expect(result.structure[0]?.detail).toContain('痛点切入')
    expect(result.highlights).toEqual(['开头抓人', '卖点融入自然'])
    expect(result.suggestions).toEqual(['补充价格信息'])
  })

  it('returns empty groups for invalid payloads', () => {
    const result = extractScriptReviewInsights(undefined)

    expect(result.audience).toEqual([])
    expect(result.tone).toEqual([])
    expect(result.contentStyle).toEqual([])
    expect(result.structure).toEqual([])
    expect(result.highlights).toEqual([])
    expect(result.suggestions).toEqual([])
    expect(result.briefSummary).toBe('')
    expect(result.qualitySummary).toBe('')
  })
})
