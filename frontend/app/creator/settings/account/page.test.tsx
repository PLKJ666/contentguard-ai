import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AccountSettingsPage from './page'

const mockBack = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    back: mockBack,
  }),
}))

vi.mock('@/components/layout/ResponsiveLayout', () => ({
  ResponsiveLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

describe('CreatorAccountSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('explains that auth is managed by Logto', () => {
    render(<AccountSettingsPage />)

    expect(screen.getByText('当前系统使用 Logto 统一认证')).toBeInTheDocument()
    expect(screen.getByText('密码管理')).toBeInTheDocument()
    expect(screen.queryByText('当前密码')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '确认修改' })).not.toBeInTheDocument()
  })
})
