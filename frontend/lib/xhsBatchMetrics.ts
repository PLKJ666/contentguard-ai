import type { XHSBatchJob } from '@/types/xhs'

export type XHSBatchDisplayMetrics = {
  plannedItems: number
  processedItems: number
  passedItems: number
  failedItems: number
  decisionItems: number
  runningItems: number
  waitingItems: number
  progress: number
}

export function getXHSBatchDisplayMetrics(
  batch: Pick<XHSBatchJob, 'total_items' | 'done_items' | 'running_items' | 'failed_items' | 'decision_items' | 'input_stats'>
): XHSBatchDisplayMetrics {
  const plannedItems = Math.max(0, Math.min(batch.input_stats.planned_items ?? batch.total_items, batch.total_items))
  const processedItems = Math.max(0, Math.min(batch.done_items, plannedItems))
  const failedItems = Math.max(0, Math.min(batch.failed_items, processedItems))
  const decisionItems = Math.max(0, Math.min(batch.decision_items, processedItems - failedItems))
  const passedItems = Math.max(0, processedItems - failedItems - decisionItems)
  const runningItems = Math.max(0, Math.min(batch.running_items, plannedItems - processedItems))
  const waitingItems = Math.max(0, plannedItems - processedItems - runningItems)
  const progress = plannedItems > 0 ? Math.round((processedItems / plannedItems) * 100) : 0

  return {
    plannedItems,
    processedItems,
    passedItems,
    failedItems,
    decisionItems,
    runningItems,
    waitingItems,
    progress,
  }
}
