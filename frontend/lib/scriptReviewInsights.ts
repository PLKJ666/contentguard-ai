export type InsightChecklistItem = {
  criterion: string
  detail: string
  result: string
}

export type ScriptReviewInsights = {
  audience: InsightChecklistItem[]
  tone: InsightChecklistItem[]
  contentStyle: InsightChecklistItem[]
  structure: InsightChecklistItem[]
  highlights: string[]
  suggestions: string[]
  briefSummary: string
  qualitySummary: string
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function asChecklist(value: unknown): InsightChecklistItem[] {
  const record = asRecord(value)
  const checklist = record?.checklist
  if (!Array.isArray(checklist)) return []
  return checklist.flatMap((item) => {
    const row = asRecord(item)
    if (!row) return []
    return [{
      criterion: typeof row.criterion === 'string' ? row.criterion : '',
      detail: typeof row.detail === 'string' ? row.detail : '',
      result: typeof row.result === 'string' ? row.result : '',
    }]
  })
}

export function extractScriptReviewInsights(
  chainOfThought: Record<string, unknown> | undefined
): ScriptReviewInsights {
  const creativeDirector = asRecord(chainOfThought?.creative_director)
  const briefMatch = asRecord(creativeDirector?.brief_match)
  const contentQuality = asRecord(creativeDirector?.content_quality)
  const reasoning = asRecord(contentQuality?.reasoning)

  return {
    audience: asChecklist(reasoning?.audience),
    tone: asChecklist(reasoning?.tone),
    contentStyle: asChecklist(reasoning?.content_style),
    structure: asChecklist(reasoning?.structure),
    highlights: asStringArray(contentQuality?.highlights),
    suggestions: asStringArray(contentQuality?.suggestions),
    briefSummary:
      typeof briefMatch?.summary === 'string'
        ? briefMatch.summary
        : typeof briefMatch?.overall_assessment === 'string'
          ? briefMatch.overall_assessment
          : '',
    qualitySummary:
      typeof contentQuality?.summary === 'string'
        ? contentQuality.summary
        : typeof contentQuality?.creative_assessment === 'string'
          ? contentQuality.creative_assessment
          : typeof contentQuality?.viral_assessment === 'string'
            ? contentQuality.viral_assessment
            : '',
  }
}
