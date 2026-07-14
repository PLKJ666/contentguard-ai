import { describe, it, expect } from 'vitest'
import { mapTaskToUI } from './taskStageMapper'
import type { TaskResponse, TaskStage, TaskStatus } from '@/types/task'

/**
 * Helper: create a minimal TaskResponse with sensible defaults.
 * Pass overrides for fields you care about.
 */
function mockTask(overrides: Partial<TaskResponse> = {}): TaskResponse {
  return {
    id: 'TK000001',
    name: '测试任务',
    sequence: 1,
    stage: 'script_upload' as TaskStage,
    project: { id: 'PJ000001', name: '测试项目' },
    agency: { id: 'AG000001', name: '测试代理商' },
    creator: { id: 'CR000001', name: '测试达人' },
    script_file_url: null,
    script_file_name: null,
    script_uploaded_at: null,
    script_ai_score: null,
    script_ai_result: null,
    script_agency_status: null,
    script_agency_comment: null,
    script_brand_status: null,
    script_brand_comment: null,
    video_file_url: null,
    video_file_name: null,
    video_duration: null,
    video_thumbnail_url: null,
    video_uploaded_at: null,
    video_ai_score: null,
    video_ai_result: null,
    video_agency_status: null,
    video_agency_comment: null,
    video_brand_status: null,
    video_brand_comment: null,
    appeal_count: 0,
    is_appeal: false,
    appeal_reason: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 1. script_upload stage
// ---------------------------------------------------------------------------
describe('mapTaskToUI — script_upload', () => {
  const task = mockTask({ stage: 'script_upload' })
  const ui = mapTaskToUI(task)

  it('scriptStage.submit should be "current"', () => {
    expect(ui.scriptStage.submit).toBe('current')
  })

  it('remaining script steps should be "pending"', () => {
    expect(ui.scriptStage.ai).toBe('pending')
    expect(ui.scriptStage.agency).toBe('pending')
    expect(ui.scriptStage.brand).toBe('pending')
  })

  it('all video steps should be "pending"', () => {
    expect(ui.videoStage.submit).toBe('pending')
    expect(ui.videoStage.ai).toBe('pending')
    expect(ui.videoStage.agency).toBe('pending')
    expect(ui.videoStage.brand).toBe('pending')
  })

  it('currentPhase should be "script"', () => {
    expect(ui.currentPhase).toBe('script')
  })

  it('buttonText should be "上传脚本"', () => {
    expect(ui.buttonText).toBe('上传脚本')
  })

  it('buttonType should be "primary"', () => {
    expect(ui.buttonType).toBe('primary')
  })

  it('statusLabel should be "待上传"', () => {
    expect(ui.statusLabel).toBe('待上传')
  })

  it('filterCategory should be "pending"', () => {
    expect(ui.filterCategory).toBe('pending')
  })

  it('scriptColor should be "blue" (no errors, brand not done)', () => {
    expect(ui.scriptColor).toBe('blue')
  })

  it('videoColor should be "blue"', () => {
    expect(ui.videoColor).toBe('blue')
  })
})

// ---------------------------------------------------------------------------
// 2. script_ai_review stage
// ---------------------------------------------------------------------------
describe('mapTaskToUI — script_ai_review', () => {
  it('ai step should be "current" when no result yet', () => {
    const task = mockTask({ stage: 'script_ai_review', script_ai_result: null })
    const ui = mapTaskToUI(task)
    expect(ui.scriptStage.submit).toBe('done')
    expect(ui.scriptStage.ai).toBe('current')
    expect(ui.scriptStage.agency).toBe('pending')
    expect(ui.scriptStage.brand).toBe('pending')
  })

  it('ai step should be "done" when result is present', () => {
    const task = mockTask({
      stage: 'script_ai_review',
      script_ai_result: { score: 85, violations: [], soft_warnings: [] },
    })
    const ui = mapTaskToUI(task)
    expect(ui.scriptStage.ai).toBe('done')
  })

  it('statusLabel should be "AI 审核中"', () => {
    const ui = mapTaskToUI(mockTask({ stage: 'script_ai_review' }))
    expect(ui.statusLabel).toBe('AI 审核中')
  })

  it('buttonText should be "审核中" and buttonType "disabled"', () => {
    const ui = mapTaskToUI(mockTask({ stage: 'script_ai_review' }))
    expect(ui.buttonText).toBe('审核中')
    expect(ui.buttonType).toBe('disabled')
  })

  it('filterCategory should be "reviewing"', () => {
    const ui = mapTaskToUI(mockTask({ stage: 'script_ai_review' }))
    expect(ui.filterCategory).toBe('reviewing')
  })

  it('currentPhase should be "script"', () => {
    const ui = mapTaskToUI(mockTask({ stage: 'script_ai_review' }))
    expect(ui.currentPhase).toBe('script')
  })
})

// ---------------------------------------------------------------------------
// 3. script_agency_review stage
// ---------------------------------------------------------------------------
describe('mapTaskToUI — script_agency_review', () => {
  it('agency step defaults to "current" when status is null/pending', () => {
    const task = mockTask({ stage: 'script_agency_review' })
    const ui = mapTaskToUI(task)
    expect(ui.scriptStage.submit).toBe('done')
    expect(ui.scriptStage.ai).toBe('done')
    expect(ui.scriptStage.agency).toBe('current')
    expect(ui.scriptStage.brand).toBe('pending')
  })

  it('agency step is "current" when status is "processing"', () => {
    const task = mockTask({ stage: 'script_agency_review', script_agency_status: 'processing' })
    const ui = mapTaskToUI(task)
    expect(ui.scriptStage.agency).toBe('current')
  })

  it('agency step is "done" when status is "passed"', () => {
    const task = mockTask({ stage: 'script_agency_review', script_agency_status: 'passed' })
    const ui = mapTaskToUI(task)
    expect(ui.scriptStage.agency).toBe('done')
  })

  it('agency step is "done" when status is "force_passed"', () => {
    const task = mockTask({ stage: 'script_agency_review', script_agency_status: 'force_passed' })
    const ui = mapTaskToUI(task)
    expect(ui.scriptStage.agency).toBe('done')
  })

  it('statusLabel should be "代理商审核中"', () => {
    const ui = mapTaskToUI(mockTask({ stage: 'script_agency_review' }))
    expect(ui.statusLabel).toBe('代理商审核中')
  })

  it('buttonText should be "审核中", buttonType "disabled"', () => {
    const ui = mapTaskToUI(mockTask({ stage: 'script_agency_review' }))
    expect(ui.buttonText).toBe('审核中')
    expect(ui.buttonType).toBe('disabled')
  })

  it('filterCategory should be "reviewing"', () => {
    const ui = mapTaskToUI(mockTask({ stage: 'script_agency_review' }))
    expect(ui.filterCategory).toBe('reviewing')
  })
})

// ---------------------------------------------------------------------------
// 4. script_brand_review stage
// ---------------------------------------------------------------------------
describe('mapTaskToUI — script_brand_review', () => {
  it('brand step defaults to "current" when status is null/pending', () => {
    const task = mockTask({ stage: 'script_brand_review' })
    const ui = mapTaskToUI(task)
    expect(ui.scriptStage.submit).toBe('done')
    expect(ui.scriptStage.ai).toBe('done')
    expect(ui.scriptStage.agency).toBe('done')
    expect(ui.scriptStage.brand).toBe('current')
  })

  it('brand step is "current" when status is "processing"', () => {
    const task = mockTask({ stage: 'script_brand_review', script_brand_status: 'processing' })
    const ui = mapTaskToUI(task)
    expect(ui.scriptStage.brand).toBe('current')
  })

  it('brand step is "done" when status is "passed"', () => {
    const task = mockTask({ stage: 'script_brand_review', script_brand_status: 'passed' })
    const ui = mapTaskToUI(task)
    expect(ui.scriptStage.brand).toBe('done')
  })

  it('statusLabel should be "品牌方审核中"', () => {
    const ui = mapTaskToUI(mockTask({ stage: 'script_brand_review' }))
    expect(ui.statusLabel).toBe('品牌方审核中')
  })

  it('buttonText should be "审核中", buttonType "disabled"', () => {
    const ui = mapTaskToUI(mockTask({ stage: 'script_brand_review' }))
    expect(ui.buttonText).toBe('审核中')
    expect(ui.buttonType).toBe('disabled')
  })

  it('filterCategory should be "reviewing"', () => {
    const ui = mapTaskToUI(mockTask({ stage: 'script_brand_review' }))
    expect(ui.filterCategory).toBe('reviewing')
  })
})

// ---------------------------------------------------------------------------
// 5. video_upload stage
// ---------------------------------------------------------------------------
describe('mapTaskToUI — video_upload', () => {
  const task = mockTask({ stage: 'video_upload' })
  const ui = mapTaskToUI(task)

  it('all script steps should be "done"', () => {
    expect(ui.scriptStage.submit).toBe('done')
    expect(ui.scriptStage.ai).toBe('done')
    expect(ui.scriptStage.agency).toBe('done')
    expect(ui.scriptStage.brand).toBe('done')
  })

  it('videoStage.submit should be "current"', () => {
    expect(ui.videoStage.submit).toBe('current')
  })

  it('remaining video steps should be "pending"', () => {
    expect(ui.videoStage.ai).toBe('pending')
    expect(ui.videoStage.agency).toBe('pending')
    expect(ui.videoStage.brand).toBe('pending')
  })

  it('currentPhase should be "video"', () => {
    expect(ui.currentPhase).toBe('video')
  })

  it('buttonText should be "上传视频"', () => {
    expect(ui.buttonText).toBe('上传视频')
  })

  it('buttonType should be "primary"', () => {
    expect(ui.buttonType).toBe('primary')
  })

  it('statusLabel should be "待上传"', () => {
    expect(ui.statusLabel).toBe('待上传')
  })

  it('filterCategory should be "pending"', () => {
    expect(ui.filterCategory).toBe('pending')
  })

  it('scriptColor should be "green" (brand done)', () => {
    expect(ui.scriptColor).toBe('green')
  })
})

// ---------------------------------------------------------------------------
// 6. video_ai_review stage
// ---------------------------------------------------------------------------
describe('mapTaskToUI — video_ai_review', () => {
  it('video ai step should be "current" when no result', () => {
    const task = mockTask({ stage: 'video_ai_review', video_ai_result: null })
    const ui = mapTaskToUI(task)
    expect(ui.videoStage.submit).toBe('done')
    expect(ui.videoStage.ai).toBe('current')
    expect(ui.videoStage.agency).toBe('pending')
    expect(ui.videoStage.brand).toBe('pending')
  })

  it('video ai step should be "done" when result is present', () => {
    const task = mockTask({
      stage: 'video_ai_review',
      video_ai_result: { score: 90, violations: [], soft_warnings: [] },
    })
    const ui = mapTaskToUI(task)
    expect(ui.videoStage.ai).toBe('done')
  })

  it('currentPhase should be "video"', () => {
    const ui = mapTaskToUI(mockTask({ stage: 'video_ai_review' }))
    expect(ui.currentPhase).toBe('video')
  })

  it('all script steps should be "done"', () => {
    const ui = mapTaskToUI(mockTask({ stage: 'video_ai_review' }))
    expect(ui.scriptStage.submit).toBe('done')
    expect(ui.scriptStage.ai).toBe('done')
    expect(ui.scriptStage.agency).toBe('done')
    expect(ui.scriptStage.brand).toBe('done')
  })

  it('statusLabel should be "AI 审核中"', () => {
    const ui = mapTaskToUI(mockTask({ stage: 'video_ai_review' }))
    expect(ui.statusLabel).toBe('AI 审核中')
  })

  it('buttonText should be "审核中", buttonType "disabled"', () => {
    const ui = mapTaskToUI(mockTask({ stage: 'video_ai_review' }))
    expect(ui.buttonText).toBe('审核中')
    expect(ui.buttonType).toBe('disabled')
  })

  it('filterCategory should be "reviewing"', () => {
    const ui = mapTaskToUI(mockTask({ stage: 'video_ai_review' }))
    expect(ui.filterCategory).toBe('reviewing')
  })
})

// ---------------------------------------------------------------------------
// 7. video_agency_review stage
// ---------------------------------------------------------------------------
describe('mapTaskToUI — video_agency_review', () => {
  it('video agency step defaults to "current" when status is null', () => {
    const task = mockTask({ stage: 'video_agency_review' })
    const ui = mapTaskToUI(task)
    expect(ui.videoStage.submit).toBe('done')
    expect(ui.videoStage.ai).toBe('done')
    expect(ui.videoStage.agency).toBe('current')
    expect(ui.videoStage.brand).toBe('pending')
  })

  it('video agency step is "current" when status is "processing"', () => {
    const task = mockTask({ stage: 'video_agency_review', video_agency_status: 'processing' })
    const ui = mapTaskToUI(task)
    expect(ui.videoStage.agency).toBe('current')
  })

  it('video agency step is "done" when status is "passed"', () => {
    const task = mockTask({ stage: 'video_agency_review', video_agency_status: 'passed' })
    const ui = mapTaskToUI(task)
    expect(ui.videoStage.agency).toBe('done')
  })

  it('currentPhase should be "video"', () => {
    const ui = mapTaskToUI(mockTask({ stage: 'video_agency_review' }))
    expect(ui.currentPhase).toBe('video')
  })

  it('statusLabel should be "代理商审核中"', () => {
    const ui = mapTaskToUI(mockTask({ stage: 'video_agency_review' }))
    expect(ui.statusLabel).toBe('代理商审核中')
  })

  it('buttonText should be "审核中", buttonType "disabled"', () => {
    const ui = mapTaskToUI(mockTask({ stage: 'video_agency_review' }))
    expect(ui.buttonText).toBe('审核中')
    expect(ui.buttonType).toBe('disabled')
  })

  it('filterCategory should be "reviewing"', () => {
    const ui = mapTaskToUI(mockTask({ stage: 'video_agency_review' }))
    expect(ui.filterCategory).toBe('reviewing')
  })
})

// ---------------------------------------------------------------------------
// 8. video_brand_review stage
// ---------------------------------------------------------------------------
describe('mapTaskToUI — video_brand_review', () => {
  it('video brand step defaults to "current" when status is null', () => {
    const task = mockTask({ stage: 'video_brand_review' })
    const ui = mapTaskToUI(task)
    expect(ui.videoStage.submit).toBe('done')
    expect(ui.videoStage.ai).toBe('done')
    expect(ui.videoStage.agency).toBe('done')
    expect(ui.videoStage.brand).toBe('current')
  })

  it('video brand step is "current" when status is "processing"', () => {
    const task = mockTask({ stage: 'video_brand_review', video_brand_status: 'processing' })
    const ui = mapTaskToUI(task)
    expect(ui.videoStage.brand).toBe('current')
  })

  it('video brand step is "done" when status is "passed"', () => {
    const task = mockTask({ stage: 'video_brand_review', video_brand_status: 'passed' })
    const ui = mapTaskToUI(task)
    expect(ui.videoStage.brand).toBe('done')
  })

  it('currentPhase should be "video"', () => {
    const ui = mapTaskToUI(mockTask({ stage: 'video_brand_review' }))
    expect(ui.currentPhase).toBe('video')
  })

  it('statusLabel should be "品牌方审核中"', () => {
    const ui = mapTaskToUI(mockTask({ stage: 'video_brand_review' }))
    expect(ui.statusLabel).toBe('品牌方审核中')
  })

  it('filterCategory should be "reviewing"', () => {
    const ui = mapTaskToUI(mockTask({ stage: 'video_brand_review' }))
    expect(ui.filterCategory).toBe('reviewing')
  })
})

// ---------------------------------------------------------------------------
// 9. completed stage
// ---------------------------------------------------------------------------
describe('mapTaskToUI — completed', () => {
  const task = mockTask({ stage: 'completed' })
  const ui = mapTaskToUI(task)

  it('all script steps should be "done"', () => {
    expect(ui.scriptStage.submit).toBe('done')
    expect(ui.scriptStage.ai).toBe('done')
    expect(ui.scriptStage.agency).toBe('done')
    expect(ui.scriptStage.brand).toBe('done')
  })

  it('all video steps should be "done"', () => {
    expect(ui.videoStage.submit).toBe('done')
    expect(ui.videoStage.ai).toBe('done')
    expect(ui.videoStage.agency).toBe('done')
    expect(ui.videoStage.brand).toBe('done')
  })

  it('currentPhase should be "completed"', () => {
    expect(ui.currentPhase).toBe('completed')
  })

  it('buttonText should be "已完成"', () => {
    expect(ui.buttonText).toBe('已完成')
  })

  it('buttonType should be "success"', () => {
    expect(ui.buttonType).toBe('success')
  })

  it('statusLabel should be "已完成"', () => {
    expect(ui.statusLabel).toBe('已完成')
  })

  it('filterCategory should be "completed"', () => {
    expect(ui.filterCategory).toBe('completed')
  })

  it('scriptColor should be "green"', () => {
    expect(ui.scriptColor).toBe('green')
  })

  it('videoColor should be "green"', () => {
    expect(ui.videoColor).toBe('green')
  })
})

// ---------------------------------------------------------------------------
// 10. rejected stage
// ---------------------------------------------------------------------------
describe('mapTaskToUI — rejected', () => {
  const task = mockTask({ stage: 'rejected', video_agency_status: 'rejected' })
  const ui = mapTaskToUI(task)

  it('buttonText should be "重新提交"', () => {
    expect(ui.buttonText).toBe('重新提交')
  })

  it('buttonType should be "warning"', () => {
    expect(ui.buttonType).toBe('warning')
  })

  it('statusLabel should be "已驳回"', () => {
    expect(ui.statusLabel).toBe('已驳回')
  })

  it('filterCategory should be "rejected"', () => {
    expect(ui.filterCategory).toBe('rejected')
  })

  it('all script steps should be "done" when the video stage was rejected', () => {
    expect(ui.scriptStage.submit).toBe('done')
    expect(ui.scriptStage.ai).toBe('done')
    expect(ui.scriptStage.agency).toBe('done')
    expect(ui.scriptStage.brand).toBe('done')
  })
})

// ---------------------------------------------------------------------------
// 11. Script agency rejected
// ---------------------------------------------------------------------------
describe('mapTaskToUI — script agency rejected', () => {
  it('scriptStage.agency should be "error" even during script_agency_review', () => {
    const task = mockTask({
      stage: 'script_agency_review',
      script_agency_status: 'rejected',
    })
    const ui = mapTaskToUI(task)
    expect(ui.scriptStage.agency).toBe('error')
  })

  it('scriptColor should be "red" when agency is error', () => {
    const task = mockTask({
      stage: 'script_agency_review',
      script_agency_status: 'rejected',
    })
    const ui = mapTaskToUI(task)
    expect(ui.scriptColor).toBe('red')
  })

  it('filterCategory should be "rejected" when agency rejected', () => {
    const task = mockTask({
      stage: 'script_agency_review',
      script_agency_status: 'rejected',
    })
    const ui = mapTaskToUI(task)
    expect(ui.filterCategory).toBe('rejected')
  })
})

// ---------------------------------------------------------------------------
// 12. Script brand rejected
// ---------------------------------------------------------------------------
describe('mapTaskToUI — script brand rejected', () => {
  it('scriptStage.brand should be "error"', () => {
    const task = mockTask({
      stage: 'script_brand_review',
      script_brand_status: 'rejected',
    })
    const ui = mapTaskToUI(task)
    expect(ui.scriptStage.brand).toBe('error')
  })

  it('scriptColor should be "red" when brand is error', () => {
    const task = mockTask({
      stage: 'script_brand_review',
      script_brand_status: 'rejected',
    })
    const ui = mapTaskToUI(task)
    expect(ui.scriptColor).toBe('red')
  })

  it('filterCategory should be "rejected"', () => {
    const task = mockTask({
      stage: 'script_brand_review',
      script_brand_status: 'rejected',
    })
    const ui = mapTaskToUI(task)
    expect(ui.filterCategory).toBe('rejected')
  })
})

// ---------------------------------------------------------------------------
// 13. Video agency rejected
// ---------------------------------------------------------------------------
describe('mapTaskToUI — video agency rejected', () => {
  it('videoStage.agency should be "error"', () => {
    const task = mockTask({
      stage: 'video_agency_review',
      video_agency_status: 'rejected',
    })
    const ui = mapTaskToUI(task)
    expect(ui.videoStage.agency).toBe('error')
  })

  it('videoColor should be "red" when video agency is error', () => {
    const task = mockTask({
      stage: 'video_agency_review',
      video_agency_status: 'rejected',
    })
    const ui = mapTaskToUI(task)
    expect(ui.videoColor).toBe('red')
  })

  it('filterCategory should be "rejected"', () => {
    const task = mockTask({
      stage: 'video_agency_review',
      video_agency_status: 'rejected',
    })
    const ui = mapTaskToUI(task)
    expect(ui.filterCategory).toBe('rejected')
  })
})

// ---------------------------------------------------------------------------
// 13b. Video brand rejected
// ---------------------------------------------------------------------------
describe('mapTaskToUI — video brand rejected', () => {
  it('videoStage.brand should be "error"', () => {
    const task = mockTask({
      stage: 'video_brand_review',
      video_brand_status: 'rejected',
    })
    const ui = mapTaskToUI(task)
    expect(ui.videoStage.brand).toBe('error')
  })

  it('videoColor should be "red"', () => {
    const task = mockTask({
      stage: 'video_brand_review',
      video_brand_status: 'rejected',
    })
    const ui = mapTaskToUI(task)
    expect(ui.videoColor).toBe('red')
  })

  it('filterCategory should be "rejected"', () => {
    const task = mockTask({
      stage: 'video_brand_review',
      video_brand_status: 'rejected',
    })
    const ui = mapTaskToUI(task)
    expect(ui.filterCategory).toBe('rejected')
  })
})

// ---------------------------------------------------------------------------
// 14. filterCategory across different stages
// ---------------------------------------------------------------------------
describe('mapTaskToUI — filterCategory for different stages', () => {
  const cases: Array<{ stage: TaskStage; expected: string; desc: string }> = [
    { stage: 'script_upload', expected: 'pending', desc: 'script_upload => pending' },
    { stage: 'video_upload', expected: 'pending', desc: 'video_upload => pending' },
    { stage: 'script_ai_review', expected: 'reviewing', desc: 'script_ai_review => reviewing' },
    { stage: 'script_agency_review', expected: 'reviewing', desc: 'script_agency_review => reviewing' },
    { stage: 'script_brand_review', expected: 'reviewing', desc: 'script_brand_review => reviewing' },
    { stage: 'video_ai_review', expected: 'reviewing', desc: 'video_ai_review => reviewing' },
    { stage: 'video_agency_review', expected: 'reviewing', desc: 'video_agency_review => reviewing' },
    { stage: 'video_brand_review', expected: 'reviewing', desc: 'video_brand_review => reviewing' },
    { stage: 'completed', expected: 'completed', desc: 'completed => completed' },
    { stage: 'rejected', expected: 'rejected', desc: 'rejected => rejected' },
  ]

  cases.forEach(({ stage, expected, desc }) => {
    it(desc, () => {
      const task = mockTask({ stage })
      const ui = mapTaskToUI(task)
      expect(ui.filterCategory).toBe(expected)
    })
  })
})

// ---------------------------------------------------------------------------
// 15. Rejection override: any rejected status forces filterCategory to rejected
// ---------------------------------------------------------------------------
describe('mapTaskToUI — rejection status overrides filterCategory', () => {
  it('video_brand_review with script_agency_status=rejected => filterCategory=rejected', () => {
    const task = mockTask({
      stage: 'video_brand_review',
      script_agency_status: 'rejected',
    })
    const ui = mapTaskToUI(task)
    expect(ui.filterCategory).toBe('rejected')
  })

  it('video_ai_review with video_agency_status=rejected => filterCategory=rejected', () => {
    const task = mockTask({
      stage: 'video_ai_review',
      video_agency_status: 'rejected',
    })
    const ui = mapTaskToUI(task)
    expect(ui.filterCategory).toBe('rejected')
  })

  it('completed stage ignores past rejections (filterCategory stays completed)', () => {
    // The source code: if (stage !== 'completed') filterCategory = 'rejected'
    const task = mockTask({
      stage: 'completed',
      script_agency_status: 'rejected',
    })
    const ui = mapTaskToUI(task)
    expect(ui.filterCategory).toBe('completed')
  })
})

// ---------------------------------------------------------------------------
// 16. statusToStep — internal mapping via statusToStep through mapTaskToUI
// ---------------------------------------------------------------------------
describe('mapTaskToUI — statusToStep mapping via agency/brand statuses', () => {
  it('force_passed maps to done', () => {
    const task = mockTask({
      stage: 'script_brand_review',
      script_brand_status: 'force_passed',
    })
    const ui = mapTaskToUI(task)
    expect(ui.scriptStage.brand).toBe('done')
  })

  it('processing maps to current', () => {
    const task = mockTask({
      stage: 'video_brand_review',
      video_brand_status: 'processing',
    })
    const ui = mapTaskToUI(task)
    expect(ui.videoStage.brand).toBe('current')
  })

  it('null status defaults to current (pending fallback to current)', () => {
    const task = mockTask({
      stage: 'video_agency_review',
      video_agency_status: null,
    })
    const ui = mapTaskToUI(task)
    expect(ui.videoStage.agency).toBe('current')
  })
})

// ---------------------------------------------------------------------------
// 17. Color logic
// ---------------------------------------------------------------------------
describe('mapTaskToUI — color logic', () => {
  it('scriptColor is "green" when script brand is done and no errors', () => {
    const task = mockTask({ stage: 'video_upload' })
    const ui = mapTaskToUI(task)
    expect(ui.scriptColor).toBe('green')
  })

  it('scriptColor is "blue" when script brand is not yet done and no errors', () => {
    const task = mockTask({ stage: 'script_ai_review' })
    const ui = mapTaskToUI(task)
    expect(ui.scriptColor).toBe('blue')
  })

  it('scriptColor is "red" when script agency has error', () => {
    const task = mockTask({
      stage: 'script_agency_review',
      script_agency_status: 'rejected',
    })
    const ui = mapTaskToUI(task)
    expect(ui.scriptColor).toBe('red')
  })

  it('scriptColor is "red" when script brand has error', () => {
    const task = mockTask({
      stage: 'script_brand_review',
      script_brand_status: 'rejected',
    })
    const ui = mapTaskToUI(task)
    expect(ui.scriptColor).toBe('red')
  })

  it('videoColor is "green" when completed', () => {
    const task = mockTask({ stage: 'completed' })
    const ui = mapTaskToUI(task)
    expect(ui.videoColor).toBe('green')
  })

  it('videoColor is "blue" when video is in progress with no errors', () => {
    const task = mockTask({ stage: 'video_ai_review' })
    const ui = mapTaskToUI(task)
    expect(ui.videoColor).toBe('blue')
  })

  it('videoColor is "red" when video brand has error', () => {
    const task = mockTask({
      stage: 'video_brand_review',
      video_brand_status: 'rejected',
    })
    const ui = mapTaskToUI(task)
    expect(ui.videoColor).toBe('red')
  })
})

// ---------------------------------------------------------------------------
// 18. Edge case: rejected stage with various rejection sources
// ---------------------------------------------------------------------------
describe('mapTaskToUI — rejected stage with rejection source details', () => {
  it('rejected stage with script_brand_status=rejected shows error on script brand', () => {
    const task = mockTask({
      stage: 'rejected',
      script_brand_status: 'rejected',
    })
    const ui = mapTaskToUI(task)
    expect(ui.scriptStage.brand).toBe('error')
    expect(ui.scriptColor).toBe('red')
  })

  it('rejected stage with video_agency_status=rejected shows error on video agency', () => {
    const task = mockTask({
      stage: 'rejected',
      video_agency_status: 'rejected',
    })
    const ui = mapTaskToUI(task)
    expect(ui.videoStage.agency).toBe('error')
    expect(ui.videoColor).toBe('red')
  })
})
