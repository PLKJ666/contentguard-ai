import { describe, expect, it } from 'vitest'

import { getVideoSellingPointCoverage } from './videoSellingPointCoverage'

describe('getVideoSellingPointCoverage', () => {
  it('prefers explicit selling_point_coverage when present', () => {
    const result = getVideoSellingPointCoverage({
      score: 90,
      selling_point_coverage: [
        {
          content: '好喝',
          conveyed: true,
          evidence: '开场直接说好喝',
          timestamp: '12.5',
        },
      ],
      selling_point_matches: [
        {
          content: '不应回退到旧字段',
          matched: false,
          evidence: 'unused',
          priority: 'core',
        },
      ],
    })

    expect(result).toEqual([
      {
        point: '好喝',
        covered: true,
        timestamp: 12.5,
        note: '开场直接说好喝',
      },
    ])
  })

  it('falls back to selling_point_matches when coverage is empty', () => {
    const result = getVideoSellingPointCoverage({
      score: 80,
      selling_point_coverage: [],
      selling_point_matches: [
        {
          content: '三位一体的浓',
          matched: false,
          evidence: '视频中未提及',
          priority: 'core',
        },
      ],
    })

    expect(result).toEqual([
      {
        point: '三位一体的浓',
        covered: false,
        timestamp: 0,
        note: '视频中未提及',
      },
    ])
  })

  it('filters invalid blank entries', () => {
    const result = getVideoSellingPointCoverage({
      score: 70,
      selling_point_coverage: [
        {
          content: '   ',
          conveyed: true,
          evidence: '',
        },
      ],
      selling_point_matches: [
        {
          content: '早餐组合',
          matched: false,
          evidence: '视频中未提及',
          priority: 'recommended',
        },
      ],
    })

    expect(result).toEqual([
      {
        point: '早餐组合',
        covered: false,
        timestamp: 0,
        note: '视频中未提及',
      },
    ])
  })
})
