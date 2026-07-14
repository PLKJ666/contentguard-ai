import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BrandSettingsPage from './page'

const mockSetTheme = vi.fn()
const mockLogout = vi.fn()

vi.mock('next-themes', () => ({
  useTheme: () => ({
    theme: 'light',
    setTheme: mockSetTheme,
  }),
}))

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}))

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    logout: mockLogout,
  }),
}))

describe('BrandSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders Logto-only account security copy without legacy password actions', () => {
    render(<BrandSettingsPage />)

    expect(screen.getByText('当前系统使用 Logto 统一认证')).toBeInTheDocument()
    expect(screen.getByText('密码与登录方式')).toBeInTheDocument()
    expect(screen.queryByText('启用双因素认证')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '确认修改' })).not.toBeInTheDocument()
  })
})
