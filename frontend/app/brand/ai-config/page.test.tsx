import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePathname } from 'next/navigation'
import AIConfigPage from './page'

const {
  mockGetAIConfig,
  mockUpdateAIConfig,
  mockExtractErrorMessage,
  mockToast,
  mockToastSuccess,
  mockToastError,
  mockToastWarning,
  mockToastInfo,
} = vi.hoisted(() => ({
  mockGetAIConfig: vi.fn(),
  mockUpdateAIConfig: vi.fn(),
  mockExtractErrorMessage: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
  mockToastWarning: vi.fn(),
  mockToastInfo: vi.fn(),
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

mockToast.success = mockToastSuccess
mockToast.error = mockToastError
mockToast.warning = mockToastWarning
mockToast.info = mockToastInfo

vi.mock('@/lib/api', () => ({
  api: {
    getAIConfig: mockGetAIConfig,
    getAIModels: vi.fn(),
    testAIConnection: vi.fn(),
    updateAIConfig: mockUpdateAIConfig,
  },
  extractErrorMessage: mockExtractErrorMessage,
}))

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => mockToast,
}))

const mockedUsePathname = vi.mocked(usePathname)

const configResponse = {
  provider: 'oneapi',
  base_url: 'https://ai.example.com/v1',
  api_key_masked: 'sk-****',
  models: {
    text: 'deepseek-chat',
    vision: 'gpt-4o',
    audio: 'whisper-1',
    xhs_split: 'gpt-4.1-mini',
    xhs_editor: 'gpt-4.1',
    xhs_verifier: 'gpt-4.1-mini',
  },
  parameters: {
    temperature: 0.1,
    max_tokens: 8192,
  },
  available_models: {
    text: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }],
    vision: [{ id: 'gpt-4o', name: 'GPT-4o' }],
    audio: [{ id: 'whisper-1', name: 'Whisper 1' }],
  },
  is_configured: true,
  last_test_at: null,
  last_test_result: null,
}

describe('AIConfigPage role visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAIConfig.mockResolvedValue(configResponse)
    mockUpdateAIConfig.mockResolvedValue(configResponse)
    mockExtractErrorMessage.mockReturnValue('mock error')
  })

  it('品牌方页面不显示小红书工作台专用模型', async () => {
    mockedUsePathname.mockReturnValue('/brand/ai-config')

    render(<AIConfigPage />)

    await screen.findByText('音频模型（口播 / 语调 / BGM）')

    expect(screen.queryByText('小红书工作台专用模型')).not.toBeInTheDocument()
    expect(screen.queryByText('XHS 主流程模型')).not.toBeInTheDocument()
  })

  it('代理商页面显示 XHS 主流程模型配置', async () => {
    mockedUsePathname.mockReturnValue('/agency/ai-config')

    render(<AIConfigPage />)

    await screen.findByText('XHS 主流程模型')

    expect(screen.getByText('XHS 切分模型')).toBeInTheDocument()
    expect(screen.getByText('XHS 改写模型')).toBeInTheDocument()
    expect(screen.getByText('XHS 复核模型')).toBeInTheDocument()
  })

  it('首次保存成功后立即显示已配置状态', async () => {
    mockedUsePathname.mockReturnValue('/brand/ai-config')
    mockGetAIConfig.mockRejectedValue(new Error('AI 服务未配置，请先完成配置'))
    mockUpdateAIConfig.mockResolvedValue({
      ...configResponse,
      is_configured: true,
    })
    mockExtractErrorMessage.mockImplementation((error: unknown) =>
      error instanceof Error ? error.message : String(error)
    )

    render(<AIConfigPage />)

    await screen.findByRole('button', { name: '保存配置' })
    expect(screen.queryByText('已配置')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))

    await waitFor(() => {
      expect(screen.getByText('已配置')).toBeInTheDocument()
    })
    expect(mockToastSuccess).toHaveBeenCalledWith('配置已保存')
  })
})
