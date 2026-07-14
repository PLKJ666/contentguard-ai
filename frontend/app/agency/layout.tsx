'use client'

import { DesktopLayout } from '@/components/layout/DesktopLayout'
import { AuthGuard } from '@/components/auth/AuthGuard'

export default function AgencyLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AuthGuard allowedRoles={['agency']}>
      <DesktopLayout role="agency">
        {children}
      </DesktopLayout>
    </AuthGuard>
  )
}
