import { normalizeCoverageTimestamp } from './reviewWarnings'
import type { AIReviewResult } from '@/types/task'

export type VideoSellingPointCoverageItem = {
  point: string
  covered: boolean
  timestamp: number
  note: string
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function readString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return ''
}

function readBoolean(record: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'boolean') return value
  }
  return undefined
}

function normalizeItem(entry: unknown): VideoSellingPointCoverageItem | null {
  const record = asRecord(entry)
  if (!record) return null

  const point = readString(record, ['content', 'selling_point', 'point', 'name', 'title'])
  if (!point) return null

  return {
    point,
    covered: readBoolean(record, ['conveyed', 'matched', 'covered']) ?? false,
    timestamp: normalizeCoverageTimestamp(record.timestamp ?? record.time ?? record.start_time ?? null),
    note: readString(record, ['evidence', 'note', 'reason', 'analysis']),
  }
}

function normalizeItems(entries: unknown[] | undefined): VideoSellingPointCoverageItem[] {
  if (!Array.isArray(entries)) return []
  return entries.flatMap((entry) => {
    const item = normalizeItem(entry)
    return item ? [item] : []
  })
}

export function getVideoSellingPointCoverage(
  aiResult: AIReviewResult | null | undefined
): VideoSellingPointCoverageItem[] {
  const coverageItems = normalizeItems(aiResult?.selling_point_coverage)
  if (coverageItems.length > 0) return coverageItems
  return normalizeItems(aiResult?.selling_point_matches)
}
