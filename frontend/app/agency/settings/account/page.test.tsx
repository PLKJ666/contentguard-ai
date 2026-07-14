import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AgencyAccountSettingsPage from './page'

const mockBack = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    back: mockBack,
  }),
}))

describe('AgencyAccountSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows Logto managed auth guidance instead of password controls', () => {
    render(<AgencyAccountSettingsPage />)

    expect(screen.getByText('账号认证已切换为 Logto')).toBeInTheDocument()
    expect(screen.getByText('密码与登录方式')).toBeInTheDocument()
    expect(screen.queryByText('当前密码')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '确认修改' })).not.toBeInTheDocument()
  })
})
