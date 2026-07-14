import Link from 'next/link'
import { Sparkles, Wrench, ArrowRight } from 'lucide-react'
import type { ChangelogData, ChangelogEntry } from '@/types/changelog'
import changelogData from '@/data/changelog.json'

function EntryIcon({ type }: { type: ChangelogEntry['type'] }) {
  if (type === 'feat') {
    return <Sparkles className="w-3.5 h-3.5 text-accent-green flex-shrink-0" />
  }
  return <Wrench className="w-3.5 h-3.5 text-accent-indigo flex-shrink-0" />
}

export default function RecentUpdates({ limit = 3 }: { limit?: number }) {
  const data = changelogData as ChangelogData
  const allEntries = data.versions.flatMap((v) => v.entries)
  const recent = allEntries.slice(0, limit)

  if (recent.length === 0) return null

  const latestVersion = data.versions[0]
  const versionLabel = latestVersion?.tag || ''

  return (
    <div className="pt-6 border-t border-border-subtle">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-secondary">最近更新</span>
          {versionLabel && (
            <span className="px-1.5 py-0.5 rounded bg-accent-indigo/10 text-accent-indigo text-xs font-medium">
              {versionLabel}
            </span>
          )}
        </div>
        <Link
          href="/changelog"
          className="text-xs text-accent-indigo hover:underline inline-flex items-center gap-1"
        >
          查看全部
          <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
      <ul className="space-y-2">
        {recent.map((entry) => (
          <li key={entry.hash} className="flex items-center gap-2 text-sm text-text-secondary">
            <EntryIcon type={entry.type} />
            <span className="truncate">{entry.message}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
