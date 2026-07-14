const LEGACY_AUTO_TASK_NAME_PATTERN = /^宣传任务\((\d+)\)$/
const INVISIBLE_CHARS_REGEX = /[\u200B-\u200D\uFEFF]/g

function cleanText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(INVISIBLE_CHARS_REGEX, '').trim()
}

function normalizeSequence(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }

  return null
}

type TaskNameParts = {
  taskName?: unknown
  projectName?: unknown
  sequence?: unknown
}

export function formatTaskDisplayName({ taskName, projectName, sequence }: TaskNameParts): string {
  const normalizedTaskName = cleanText(taskName)
  const normalizedProjectName = cleanText(projectName)
  const normalizedSequence = normalizeSequence(sequence)
  const legacyMatch = normalizedTaskName.match(LEGACY_AUTO_TASK_NAME_PATTERN)
  const legacySequence = legacyMatch ? Number.parseInt(legacyMatch[1], 10) : null
  const resolvedSequence = legacySequence ?? normalizedSequence

  if (resolvedSequence && normalizedProjectName && (!normalizedTaskName || legacyMatch)) {
    return `${normalizedProjectName} 任务${resolvedSequence}`
  }

  if (normalizedTaskName) return normalizedTaskName
  if (normalizedProjectName && resolvedSequence) return `${normalizedProjectName} 任务${resolvedSequence}`
  if (normalizedProjectName) return normalizedProjectName
  return '未命名任务'
}

export function formatTaskDisplayTitle({ taskName, projectName, sequence }: TaskNameParts): string {
  const normalizedProjectName = cleanText(projectName)
  const displayName = formatTaskDisplayName({ taskName, projectName, sequence })

  if (!normalizedProjectName) return displayName
  if (displayName === normalizedProjectName) return displayName
  if (displayName.startsWith(`${normalizedProjectName} 任务`)) return displayName

  return `${normalizedProjectName} · ${displayName}`
}

export function formatLegacyTaskNameInMessageContent(content: unknown): string {
  if (typeof content !== 'string') return ''

  return content
    .replace(
      /您有新的任务「宣传任务\((\d+)\)」，来自项目「([^」]+)」/g,
      (_match, sequence, projectName) => `您有新的任务「${projectName} 任务${sequence}」，来自项目「${projectName}」`
    )
    .replace(
      /加入项目「([^」]+)」，任务：宣传任务\((\d+)\)/g,
      (_match, projectName, sequence) => `加入项目「${projectName}」，任务：${projectName} 任务${sequence}`
    )
}
