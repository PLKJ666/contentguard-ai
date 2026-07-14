'use client'

import { ResponsiveLayout } from '@/components/layout/ResponsiveLayout'
import ChangelogContent from '@/components/changelog/ChangelogContent'

export default function BrandChangelogPage() {
  return (
    <ResponsiveLayout role="brand">
      <ChangelogContent />
    </ResponsiveLayout>
  )
}
