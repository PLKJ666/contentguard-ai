/**
 * 工作台统计类型定义
 * 与后端 Dashboard schemas 对齐
 */

export interface ReviewCount {
  script: number
  video: number
}

export interface CreatorDashboard {
  total_tasks: number
  pending_script: number
  pending_video: number
  in_review: number
  completed: number
  rejected: number
}

export interface AgencyDashboard {
  pending_review: ReviewCount
  pending_appeal: number
  today_passed: ReviewCount
  in_progress: ReviewCount
  total_creators: number
  total_tasks: number
}

export interface BrandDashboard {
  total_projects: number
  active_projects: number
  pending_review: ReviewCount
  total_agencies: number
  total_tasks: number
  completed_tasks: number
}
