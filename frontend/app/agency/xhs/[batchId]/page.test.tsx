import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { XHSBatchItem, XHSBatchJob, XHSBatchItemListResponse } from '@/types/xhs'
import AgencyXHSBatchDetailPage from './page'

const {
  mockUseParams,
  mockGetXHSBatch,
  mockListXHSBatchItems,
  mockListXHSBatchExports,
  mockGetXHSBatchFeishuStatus,
  mockStartXHSBatch,
  mockRetryXHSBatch,
  mockPromoteXHSBatch,
  mockSubmitXHSBatchItemDecision,
  mockExportXHSBatchAllMarkdown,
  mockExportXHSBatchFeishu,
  mockExtractErrorMessage,
  mockSubscribe,
} = vi.hoisted(() => ({
  mockUseParams: vi.fn(),
  mockGetXHSBatch: vi.fn(),
  mockListXHSBatchItems: vi.fn(),
  mockListXHSBatchExports: vi.fn(),
  mockGetXHSBatchFeishuStatus: vi.fn(),
  mockStartXHSBatch: vi.fn(),
  mockRetryXHSBatch: vi.fn(),
  mockPromoteXHSBatch: vi.fn(),
  mockSubmitXHSBatchItemDecision: vi.fn(),
  mockExportXHSBatchAllMarkdown: vi.fn(),
  mockExportXHSBatchFeishu: vi.fn(),
  mockExtractErrorMessage: vi.fn(),
  mockSubscribe: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/agency/xhs/batch-123'),
  useParams: mockUseParams,
}))

vi.mock('@/lib/api', () => ({
  api: {
    getXHSBatch: mockGetXHSBatch,
    listXHSBatchItems: mockListXHSBatchItems,
    listXHSBatchExports: mockListXHSBatchExports,
    getXHSBatchFeishuStatus: mockGetXHSBatchFeishuStatus,
    startXHSBatch: mockStartXHSBatch,
    retryXHSBatch: mockRetryXHSBatch,
    promoteXHSBatch: mockPromoteXHSBatch,
    submitXHSBatchItemDecision: mockSubmitXHSBatchItemDecision,
    exportXHSBatchAllMarkdown: mockExportXHSBatchAllMarkdown,
    exportXHSBatchFeishu: mockExportXHSBatchFeishu,
  },
  extractErrorMessage: mockExtractErrorMessage,
}))

vi.mock('@/contexts/SSEContext', () => ({
  useSSE: () => ({
    subscribe: mockSubscribe,
  }),
}))

function createBatch(overrides: Partial<XHSBatchJob> = {}): XHSBatchJob {
  return {
    id: 'batch-123',
    status: 'done',
    category_id: 'beauty',
    direction_id: 'direction-1',
    direction_name: '护肤方向',
    project_id: 'project-1',
    project_name: '新品上新',
    rule_pack_version: 'rule-v1',
    risk_pack_version: 'risk-v1',
    brand_pack_version: 'brand-v1',
    brief_pack_id: 'brief-1',
    run_mode: 'trial',
    trial_sample_count: 3,
    input_type: 'text',
    estimated_tokens: 1024,
    estimated_cost: '0.50',
    actual_tokens: 512,
    actual_cost: '0.20',
    system_blocked: false,
    system_block_reason: null,
    total_items: 4,
    done_items: 4,
    running_items: 0,
    failed_items: 0,
    decision_items: 1,
    safe_rewrite_items: 0,
    export_all_md_status: null,
    export_all_md_url: null,
    export_feishu_status: null,
    export_feishu_doc_title: null,
    export_feishu_error: null,
    created_at: '2026-04-07T10:00:00Z',
    updated_at: '2026-04-07T10:05:00Z',
    ...overrides,
    input_stats: {
      raw_chars: 240,
      split_count: 4,
      planned_items: 4,
      split_strategy: 'rule',
      source_ref: null,
      source_file_name: null,
      parsed_from_file: false,
      parsed_from_feishu: false,
      parse_skipped_reason: null,
      ...overrides.input_stats,
    },
    export: {
      all_md_status: null,
      all_md_url: null,
      feishu_status: null,
      feishu_doc_title: null,
      feishu_error: null,
      ...overrides.export,
    },
  }
}

function createItem(overrides: Partial<XHSBatchItem> = {}): XHSBatchItem {
  return {
    id: 'row-1',
    batch_id: 'batch-123',
    item_id: 'item-1',
    index: 1,
    status: 'failed',
    round: 2,
    title: '面霜改写稿',
    source_text: '原始文案第一段',
    source_title_guess: '面霜草稿',
    final_title: '新版标题',
    final_body: '这是候选改写稿',
    final_hashtags: ['#护肤'],
    copy_ready_text: '这是候选改写稿',
    quality_score: 78,
    verifier_pass: false,
    verifier_confidence: 0.74,
    verifier: {
      group: '功效表述',
      severity: 'medium',
      summary: '功效表达和品牌包要求冲突，需要人工选择优先级。',
    },
    rewrite_fail_reasons: [],
    decision_required: true,
    decision_summary: '规则包强调谨慎表达，但品牌包要求保留卖点，需要你决定优先级。',
    recommended_decision_option_id: 'safety-first',
    selected_decision_option_id: null,
    safe_rewrite_used: false,
    safe_rewrite_reason: null,
    duration_ms: 1800,
    ...overrides,
    decision_options: overrides.decision_options ?? [
      {
        id: 'safety-first',
        title: '优先保守表达',
        summary: '弱化功效承诺，确保风险最低。',
        tradeoffs: ['卖点会更克制'],
        recommended: true,
      },
      {
        id: 'selling-first',
        title: '优先保留卖点',
        summary: '保留原来的卖点强度，但后续需要继续打磨。',
        tradeoffs: ['风险会更高一些'],
        recommended: false,
      },
    ],
  }
}

function createItemResponse(items: XHSBatchItem[]): XHSBatchItemListResponse {
  return {
    items,
    page: 1,
    page_size: 100,
    total: items.length,
  }
}

function withExactText(text: string) {
  const normalized = text.replace(/\s+/g, '')
  return (_content: string, element: Element | null) => element?.textContent?.replace(/\s+/g, '') === normalized
}

describe('AgencyXHSBatchDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockUseParams.mockReturnValue({ batchId: 'batch-123' })
    mockListXHSBatchExports.mockResolvedValue([])
    mockGetXHSBatchFeishuStatus.mockRejectedValue(new Error('not configured'))
    mockStartXHSBatch.mockResolvedValue(createBatch())
    mockRetryXHSBatch.mockResolvedValue(createBatch())
    mockPromoteXHSBatch.mockResolvedValue(createBatch({ run_mode: 'full' }))
    mockSubmitXHSBatchItemDecision.mockResolvedValue(createItem({ decision_required: false, status: 'running' }))
    mockExportXHSBatchAllMarkdown.mockResolvedValue(new Blob(['markdown']))
    mockExportXHSBatchFeishu.mockResolvedValue({ status: 'running', message: 'queued' })
    mockExtractErrorMessage.mockReturnValue('mock error')
    mockSubscribe.mockReturnValue(vi.fn())
  })

  it('shows awaiting decision status for completed batches with decision items', async () => {
    mockGetXHSBatch.mockResolvedValue(
      createBatch({
        status: 'done',
        total_items: 4,
        done_items: 4,
        failed_items: 0,
        decision_items: 1,
      }),
    )
    mockListXHSBatchItems.mockResolvedValue(createItemResponse([]))

    render(<AgencyXHSBatchDetailPage />)

    await screen.findByText('运行摘要')

    expect(screen.getByText('待决策')).toBeInTheDocument()
    expect(screen.getAllByText(withExactText('待决定1')).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '重试失败项' })).toBeDisabled()
  })

  it('renders decision-only failed items as manual decisions and submits the selected option', async () => {
    const batch = createBatch({
      status: 'done',
      total_items: 1,
      done_items: 1,
      failed_items: 0,
      decision_items: 1,
      input_stats: {
        raw_chars: 120,
        split_count: 1,
        planned_items: 1,
      },
    })
    const item = createItem()

    mockGetXHSBatch.mockResolvedValue(batch)
    mockListXHSBatchItems.mockResolvedValue(createItemResponse([item]))

    render(<AgencyXHSBatchDetailPage />)

    await screen.findByText('候选改写稿（待你决定）')

    expect(screen.getByText('规则包强调谨慎表达，但品牌包要求保留卖点，需要你决定优先级。')).toBeInTheDocument()
    expect(screen.getByText('当前右侧展示的是候选改写稿，不是最终可交付稿。你选一个方向后，系统会继续生成终稿。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试失败项' })).toBeDisabled()

    fireEvent.click(screen.getAllByRole('button', { name: '按这个方向继续生成' })[0])

    await waitFor(() => {
      expect(mockSubmitXHSBatchItemDecision).toHaveBeenCalledWith('batch-123', 'item-1', 'safety-first')
    })
    await waitFor(() => {
      expect(mockGetXHSBatch).toHaveBeenCalledTimes(2)
      expect(mockListXHSBatchItems).toHaveBeenCalledTimes(2)
    })
  })
})
