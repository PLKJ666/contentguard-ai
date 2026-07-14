import type { ProjectResponse } from './project'
import type { TaskResponse } from './task'

export interface OperatorProjectCreateRequest {
  name: string
  description?: string
  platform?: string
  client_display_name?: string
  brand_display_name?: string
  project_remark?: string
}

export interface OperatorProjectListResponse {
  items: ProjectResponse[]
  total: number
}

export interface OperatorTaskCreateRequest {
  project_id: string
  name?: string
  creator_display_name: string
  creator_platform?: string
  creator_remark?: string
}

export interface OperatorTaskListResponse {
  items: TaskResponse[]
  total: number
}
