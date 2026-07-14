import type { TaskResponse, TaskStage, TaskStatus } from '@/types/task'

export type StepStatus = 'pending' | 'current' | 'done' | 'error'

export interface StageSteps {
  submit: StepStatus
  ai: StepStatus
  agency: StepStatus
  brand: StepStatus
}

export interface TaskUIState {
  scriptStage: StageSteps
  videoStage: StageSteps
  currentPhase: 'script' | 'video' | 'completed'
  buttonText: string
  buttonType: 'primary' | 'warning' | 'success' | 'disabled'
  scriptColor: string
  videoColor: string
  statusLabel: string
  filterCategory: 'pending' | 'reviewing' | 'rejected' | 'completed'
}

const STAGE_ORDER: TaskStage[] = [
  'script_upload', 'script_ai_review', 'script_agency_review', 'script_brand_review',
  'video_upload', 'video_ai_review', 'video_agency_review', 'video_brand_review',
  'completed', 'rejected',
]

function statusToStep(status: TaskStatus | undefined | null): StepStatus {
  if (!status || status === 'pending') return 'pending'
  if (status === 'processing') return 'current'
  if (status === 'passed' || status === 'force_passed') return 'done'
  if (status === 'rejected') return 'error'
  return 'pending'
}

export function mapTaskToUI(task: TaskResponse): TaskUIState {
  const stage = task.stage
  const stageIndex = STAGE_ORDER.indexOf(stage)

  // 脚本阶段
  const scriptStage: StageSteps = {
    submit: stageIndex >= 0 ? 'done' : 'pending',
    ai: 'pending',
    agency: 'pending',
    brand: 'pending',
  }

  // 视频阶段
  const videoStage: StageSteps = {
    submit: 'pending',
    ai: 'pending',
    agency: 'pending',
    brand: 'pending',
  }

  // 根据 stage 设置脚本进度
  if (stage === 'script_upload') {
    // 区分"首次上传"和"驳回后重新上传"
    if (task.script_brand_status === 'rejected') {
      // 品牌方驳回：AI通过、代理商通过、品牌方驳回
      scriptStage.submit = 'current'
      scriptStage.ai = 'done'
      scriptStage.agency = 'done'
      scriptStage.brand = 'error'
    } else if (task.script_agency_status === 'rejected') {
      // 代理商驳回：AI通过、代理商驳回
      scriptStage.submit = 'current'
      scriptStage.ai = 'done'
      scriptStage.agency = 'error'
    } else if (task.script_ai_result?.ai_auto_rejected) {
      // AI 驳回
      scriptStage.submit = 'current'
      scriptStage.ai = 'error'
    } else {
      // 首次上传
      scriptStage.submit = 'current'
    }
  } else if (stage === 'script_ai_review') {
    scriptStage.submit = 'done'
    scriptStage.ai = 'current'
  } else if (stage === 'script_agency_review') {
    scriptStage.submit = 'done'
    scriptStage.ai = 'done'
    scriptStage.agency = statusToStep(task.script_agency_status)
    if (scriptStage.agency === 'pending') scriptStage.agency = 'current'
  } else if (stage === 'script_brand_review') {
    scriptStage.submit = 'done'
    scriptStage.ai = 'done'
    scriptStage.agency = 'done'
    scriptStage.brand = statusToStep(task.script_brand_status)
    if (scriptStage.brand === 'pending') scriptStage.brand = 'current'
  } else if (stage === 'rejected') {
    // 最终驳回：根据实际驳回位置显示脚本阶段进度
    if (task.video_brand_status === 'rejected' || task.video_agency_status === 'rejected' || task.video_ai_result?.ai_auto_rejected) {
      // 视频阶段被驳回 → 脚本全部已通过
      scriptStage.submit = 'done'
      scriptStage.ai = 'done'
      scriptStage.agency = 'done'
      scriptStage.brand = 'done'
    } else if (task.script_brand_status === 'rejected') {
      scriptStage.submit = 'done'
      scriptStage.ai = 'done'
      scriptStage.agency = 'done'
      scriptStage.brand = 'error'
    } else if (task.script_agency_status === 'rejected') {
      scriptStage.submit = 'done'
      scriptStage.ai = 'done'
      scriptStage.agency = 'error'
    } else if (task.script_ai_result?.ai_auto_rejected) {
      scriptStage.submit = 'done'
      scriptStage.ai = 'error'
    } else {
      scriptStage.submit = 'done'
    }
  } else if (stageIndex >= 4 && stage !== 'completed') {
    // 视频阶段（video_upload ~ video_brand_review）：脚本全部已通过
    scriptStage.submit = 'done'
    scriptStage.ai = 'done'
    scriptStage.agency = 'done'
    scriptStage.brand = 'done'
  } else if (stage === 'completed') {
    scriptStage.submit = 'done'
    scriptStage.ai = 'done'
    scriptStage.agency = 'done'
    scriptStage.brand = 'done'
  }

  // 根据 stage 设置视频进度
  if (stage === 'video_upload') {
    // 区分"首次上传"和"驳回后重新上传"
    if (task.video_brand_status === 'rejected') {
      // 品牌方驳回：AI通过、代理商通过、品牌方驳回
      videoStage.submit = 'current'
      videoStage.ai = 'done'
      videoStage.agency = 'done'
      videoStage.brand = 'error'
    } else if (task.video_agency_status === 'rejected') {
      // 代理商驳回：AI通过、代理商驳回
      videoStage.submit = 'current'
      videoStage.ai = 'done'
      videoStage.agency = 'error'
    } else if (task.video_ai_result?.ai_auto_rejected) {
      // AI 驳回
      videoStage.submit = 'current'
      videoStage.ai = 'error'
    } else {
      // 首次上传
      videoStage.submit = 'current'
    }
  } else if (stage === 'video_ai_review') {
    videoStage.submit = 'done'
    videoStage.ai = 'current'
  } else if (stage === 'video_agency_review') {
    videoStage.submit = 'done'
    videoStage.ai = 'done'
    videoStage.agency = statusToStep(task.video_agency_status)
    if (videoStage.agency === 'pending') videoStage.agency = 'current'
  } else if (stage === 'video_brand_review') {
    videoStage.submit = 'done'
    videoStage.ai = 'done'
    videoStage.agency = 'done'
    videoStage.brand = statusToStep(task.video_brand_status)
    if (videoStage.brand === 'pending') videoStage.brand = 'current'
  } else if (stage === 'completed') {
    videoStage.submit = 'done'
    videoStage.ai = 'done'
    videoStage.agency = 'done'
    videoStage.brand = 'done'
  } else if (stage === 'rejected') {
    // 最终驳回：根据实际驳回位置显示视频阶段进度
    if (task.video_brand_status === 'rejected') {
      videoStage.submit = 'done'
      videoStage.ai = 'done'
      videoStage.agency = 'done'
      videoStage.brand = 'error'
    } else if (task.video_agency_status === 'rejected') {
      videoStage.submit = 'done'
      videoStage.ai = 'done'
      videoStage.agency = 'error'
    } else if (task.video_ai_result?.ai_auto_rejected) {
      videoStage.submit = 'done'
      videoStage.ai = 'error'
    }
    // 脚本阶段被驳回时，视频阶段保持全 pending
  }

  // 当前阶段
  let currentPhase: 'script' | 'video' | 'completed' = 'script'
  if (stageIndex >= 4 && stageIndex < 8) currentPhase = 'video'
  if (stage === 'completed') currentPhase = 'completed'
  if (stage === 'rejected') {
    // 根据驳回位置确定当前阶段
    if (task.video_brand_status === 'rejected' || task.video_agency_status === 'rejected' || task.video_ai_result?.ai_auto_rejected) {
      currentPhase = 'video'
    } else {
      currentPhase = 'script'
    }
  }

  // 按钮文案和类型
  let buttonText = '查看详情'
  let buttonType: 'primary' | 'warning' | 'success' | 'disabled' = 'primary'

  if (stage === 'script_upload') {
    const isRejected = task.script_agency_status === 'rejected' || task.script_brand_status === 'rejected' || task.script_ai_result?.ai_auto_rejected
    buttonText = isRejected ? '重新上传' : '上传脚本'
    buttonType = isRejected ? 'warning' : 'primary'
  } else if (stage === 'video_upload') {
    const isRejected = task.video_agency_status === 'rejected' || task.video_brand_status === 'rejected' || task.video_ai_result?.ai_auto_rejected
    buttonText = isRejected ? '重新上传' : '上传视频'
    buttonType = isRejected ? 'warning' : 'primary'
  } else if (stage === 'completed') {
    buttonText = '已完成'
    buttonType = 'success'
  } else if (stage === 'rejected') {
    buttonText = '重新提交'
    buttonType = 'warning'
  } else if (stage.includes('review')) {
    buttonText = '审核中'
    buttonType = 'disabled'
  }

  // 颜色
  const scriptColor = scriptStage.ai === 'error' || scriptStage.agency === 'error' || scriptStage.brand === 'error'
    ? 'red' : scriptStage.brand === 'done' ? 'green' : 'blue'
  const videoColor = videoStage.ai === 'error' || videoStage.agency === 'error' || videoStage.brand === 'error'
    ? 'red' : videoStage.brand === 'done' ? 'green' : 'blue'

  // 状态标签
  let statusLabel = '进行中'
  if (stage === 'script_upload' || stage === 'video_upload') {
    // 区分首次上传和驳回后重新上传
    const isHumanRejected = task.script_agency_status === 'rejected' || task.script_brand_status === 'rejected' ||
      task.video_agency_status === 'rejected' || task.video_brand_status === 'rejected'
    const isAIRejected = (stage === 'script_upload' && task.script_ai_result?.ai_auto_rejected) ||
      (stage === 'video_upload' && task.video_ai_result?.ai_auto_rejected)
    statusLabel = isHumanRejected ? '已驳回' : isAIRejected ? 'AI 驳回' : '待上传'
  } else if (stage.includes('ai_review')) statusLabel = 'AI 审核中'
  else if (stage.includes('agency_review')) statusLabel = '代理商审核中'
  else if (stage.includes('brand_review')) statusLabel = '品牌方审核中'
  else if (stage === 'completed') statusLabel = '已完成'
  else if (stage === 'rejected') statusLabel = '已驳回'

  // 筛选分类
  let filterCategory: 'pending' | 'reviewing' | 'rejected' | 'completed' = 'reviewing'
  if (stage === 'script_upload' || stage === 'video_upload') filterCategory = 'pending'
  else if (stage === 'completed') filterCategory = 'completed'
  else if (stage === 'rejected') filterCategory = 'rejected'
  // 处理驳回后重新提交的情况
  if (task.script_agency_status === 'rejected' || task.script_brand_status === 'rejected' ||
      task.video_agency_status === 'rejected' || task.video_brand_status === 'rejected') {
    if (stage !== 'completed') filterCategory = 'rejected'
  }

  return {
    scriptStage,
    videoStage,
    currentPhase,
    buttonText,
    buttonType,
    scriptColor,
    videoColor,
    statusLabel,
    filterCategory,
  }
}
