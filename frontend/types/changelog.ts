export interface ChangelogEntry {
  type: 'feat' | 'fix' | 'perf' | 'docs'
  message: string
  hash: string
  date: string // YYYY-MM-DD
}

export interface ChangelogVersion {
  id: string
  title: string // "2月10日 ~ 2月12日" 或 "v1.2.0"
  tag: string | null
  date: string
  entries: ChangelogEntry[]
}

export interface ChangelogData {
  generatedAt: string
  grouping: 'weekly' | 'tagged'
  versions: ChangelogVersion[]
}
