import changelogData from '@/data/changelog.json'
import type { ChangelogData } from '@/types/changelog'

const data = changelogData as ChangelogData

export const buildVersion = encodeURIComponent(data.generatedAt || 'static')
