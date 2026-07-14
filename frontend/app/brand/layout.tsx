'use client'

import { DesktopLayout } from '@/components/layout/DesktopLayout'
import { AuthGuard } from '@/components/auth/AuthGuard'

export default function BrandLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AuthGuard allowedRoles={['brand']}>
      <DesktopLayout role="brand">
        {children}
      </DesktopLayout>
    </AuthGuard>
  )
}
