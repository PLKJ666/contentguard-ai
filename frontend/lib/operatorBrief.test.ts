import { describe, expect, it } from 'vitest'

import {
  applyParsedBriefToForm,
  blacklistWordsToText,
  buildOperatorBriefAttachments,
  parseBlacklistWordsText,
} from './operatorBrief'

describe('operatorBrief helpers', () => {
  it('buildOperatorBriefAttachments falls back to existing attachments when file meta is missing', () => {
    const existing = [{ id: 'att-1', name: 'brief.pdf', url: 'https://example.com/brief.pdf', size: '1MB' }]

    expect(buildOperatorBriefAttachments({ existingAttachments: existing })).toEqual(existing)
  })

  it('parseBlacklistWordsText supports multiple separators and default reasons', () => {
    expect(parseBlacklistWordsText('禁用词一\n禁用词二｜夸大宣传\n禁用词三:平台限制')).toEqual([
      { word: '禁用词一', reason: '项目要求' },
      { word: '禁用词二', reason: '夸大宣传' },
      { word: '禁用词三', reason: '平台限制' },
    ])
  })

  it('applyParsedBriefToForm fills parsed fields and keeps manual brand tone', () => {
    const next = applyParsedBriefToForm(
      {
        product_name: '',
        brand_tone: '理性、克制、专业',
        other_requirements: '',
        selling_points_text: '',
        blacklist_words_text: '',
        creative_rubric: null,
      },
      {
        product_name: '轻享黑咖啡',
        target_audience: '久坐办公室人群',
        content_requirements: '重点强调冷水速溶和低糖配方',
        selling_points: [{ content: '冷水也能快速冲开', priority: 'core' }],
        blacklist_words: [{ word: '治疗', reason: '医疗化表述' }],
        creative_rubric: {
          tone: {
            name: '语气',
            do_items: ['像朋友安利一样自然'],
            dont_items: ['不要绝对化承诺'],
          },
        },
      }
    )

    expect(next).toEqual({
      product_name: '轻享黑咖啡',
      brand_tone: '理性、克制、专业',
      other_requirements: '目标人群：久坐办公室人群\n内容要求：重点强调冷水速溶和低糖配方',
      selling_points_text: '冷水也能快速冲开',
      blacklist_words_text: blacklistWordsToText([{ word: '治疗', reason: '医疗化表述' }]),
      creative_rubric: {
        tone: {
          name: '语气',
          do_items: ['像朋友安利一样自然'],
          dont_items: ['不要绝对化承诺'],
        },
      },
    })
  })
})
