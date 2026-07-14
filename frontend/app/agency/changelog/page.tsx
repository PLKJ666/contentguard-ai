'use client'

import { ResponsiveLayout } from '@/components/layout/ResponsiveLayout'
import ChangelogContent from '@/components/changelog/ChangelogContent'

export default function AgencyChangelogPage() {
  return (
    <ResponsiveLayout role="agency">
      <ChangelogContent />
    </ResponsiveLayout>
  )
}
