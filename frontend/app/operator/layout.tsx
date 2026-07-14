'use client'

import { AuthGuard } from '@/components/auth/AuthGuard'
import { ResponsiveLayout } from '@/components/layout/ResponsiveLayout'

export default function OperatorLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AuthGuard allowedRoles={['operator']}>
      <ResponsiveLayout role="operator">{children}</ResponsiveLayout>
    </AuthGuard>
  )
}
