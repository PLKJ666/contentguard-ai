'use client'

import { AuthGuard } from '@/components/auth/AuthGuard'

export default function CreatorLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <AuthGuard allowedRoles={['creator']}>{children}</AuthGuard>
}
