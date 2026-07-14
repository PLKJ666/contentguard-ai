import { describe, expect, it } from 'vitest'
import { getXHSBatchDisplayMetrics } from './xhsBatchMetrics'

describe('getXHSBatchDisplayMetrics', () => {
  it('separates decision items from failed items within the planned range', () => {
    const metrics = getXHSBatchDisplayMetrics({
      total_items: 10,
      done_items: 8,
      running_items: 4,
      failed_items: 2,
      decision_items: 3,
      input_stats: {
        raw_chars: 1200,
        split_count: 8,
        planned_items: 6,
      },
    })

    expect(metrics).toEqual({
      plannedItems: 6,
      processedItems: 6,
      passedItems: 1,
      failedItems: 2,
      decisionItems: 3,
      runningItems: 0,
      waitingItems: 0,
      progress: 100,
    })
  })

  it('clamps inconsistent counts to non-negative values', () => {
    const metrics = getXHSBatchDisplayMetrics({
      total_items: 5,
      done_items: 4,
      running_items: 3,
      failed_items: 9,
      decision_items: 7,
      input_stats: {
        raw_chars: 0,
        split_count: 0,
        planned_items: -2,
      },
    })

    expect(metrics).toEqual({
      plannedItems: 0,
      processedItems: 0,
      passedItems: 0,
      failedItems: 0,
      decisionItems: 0,
      runningItems: 0,
      waitingItems: 0,
      progress: 0,
    })
  })
})
