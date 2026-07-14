import type {
  BlacklistWord,
  BriefAttachment,
  CreativeRubric,
  SellingPoint,
} from '@/types/brief'

export interface OperatorBriefFormValues {
  product_name: string
  brand_tone: string
  other_requirements: string
  selling_points_text: string
  blacklist_words_text: string
  creative_rubric: CreativeRubric | null
}

export interface OperatorBriefParseResult {
  product_name: string
  target_audience: string
  content_requirements: string
  selling_points: SellingPoint[]
  blacklist_words: BlacklistWord[]
  creative_rubric?: CreativeRubric | null
}

const BLACKLIST_REASON_SEPARATORS = ['｜', '|', '：', ':'] as const

export function sellingPointsToText(points?: SellingPoint[] | null): string {
  return (points || [])
    .map((item) => item.content?.trim())
    .filter(Boolean)
    .join('\n')
}

export function blacklistWordsToText(words?: BlacklistWord[] | null): string {
  return (words || [])
    .map((item) => {
      const word = item.word?.trim()
      const reason = item.reason?.trim()
      if (!word) return ''
      return reason ? `${word}｜${reason}` : word
    })
    .filter(Boolean)
    .join('\n')
}

export function parseSellingPointsText(text: string): SellingPoint[] {
  return text
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((content) => ({ content, priority: 'core' as const }))
}

export function parseBlacklistWordsText(text: string): BlacklistWord[] {
  return text
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = BLACKLIST_REASON_SEPARATORS.find((token) => line.includes(token))
      if (!separator) {
        return { word: line, reason: '项目要求' }
      }

      const [wordPart, ...reasonParts] = line.split(separator)
      const word = wordPart.trim()
      const reason = reasonParts.join(separator).trim()

      return {
        word,
        reason: reason || '项目要求',
      }
    })
    .filter((item) => Boolean(item.word))
}

export function mergeParsedRequirements(targetAudience: string, contentRequirements: string): string {
  const sections = [
    targetAudience.trim() ? `目标人群：${targetAudience.trim()}` : '',
    contentRequirements.trim() ? `内容要求：${contentRequirements.trim()}` : '',
  ].filter(Boolean)

  return sections.join('\n')
}

export function buildOperatorBriefAttachments(args: {
  fileUrl?: string | null
  fileName?: string | null
  existingAttachments?: BriefAttachment[] | null
}): BriefAttachment[] | undefined {
  const { fileUrl, fileName, existingAttachments } = args
  const normalizedUrl = fileUrl?.trim()
  const normalizedName = fileName?.trim()

  if (!normalizedUrl || !normalizedName) {
    return existingAttachments?.length ? existingAttachments : undefined
  }

  const matched = existingAttachments?.find(
    (item) => item.url === normalizedUrl && item.name === normalizedName
  )

  return [
    {
      id: matched?.id || 'operator-brief-file',
      name: normalizedName,
      url: normalizedUrl,
      ...(matched?.size ? { size: matched.size } : {}),
    },
  ]
}

export function applyParsedBriefToForm(
  form: OperatorBriefFormValues,
  parsed: OperatorBriefParseResult
): OperatorBriefFormValues {
  const mergedRequirements = mergeParsedRequirements(
    parsed.target_audience,
    parsed.content_requirements
  )

  return {
    ...form,
    product_name: parsed.product_name || form.product_name,
    other_requirements: mergedRequirements || form.other_requirements,
    selling_points_text: parsed.selling_points.length
      ? sellingPointsToText(parsed.selling_points)
      : form.selling_points_text,
    blacklist_words_text: parsed.blacklist_words.length
      ? blacklistWordsToText(parsed.blacklist_words)
      : form.blacklist_words_text,
    creative_rubric: parsed.creative_rubric || form.creative_rubric,
  }
}
