'use client'

import { ResponsiveLayout } from '@/components/layout/ResponsiveLayout'
import ChangelogContent from '@/components/changelog/ChangelogContent'

export default function CreatorChangelogPage() {
  return (
    <ResponsiveLayout role="creator">
      <ChangelogContent />
    </ResponsiveLayout>
  )
}
