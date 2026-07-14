import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ForgotPasswordPage from './page'

describe('ForgotPasswordPage', () => {
  it('renders Logto-managed password reset guidance', () => {
    render(<ForgotPasswordPage />)

    expect(screen.getByText('统一认证帮助')).toBeInTheDocument()
    expect(screen.getByText('密码与安全设置由 Logto 统一管理')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '前往统一登录' })).toHaveAttribute('href', '/login')
    expect(screen.queryByText('请联系管理员重置密码')).not.toBeInTheDocument()
  })
})
