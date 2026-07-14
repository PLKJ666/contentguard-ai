/**
 * 项目相关类型定义
 * 与后端 ProjectResponse 对齐
 */

export interface AgencySummary {
  id: string
  name: string
  logo?: string | null
}

export interface ProjectResponse {
  id: string
  name: string
  description?: string | null
  platform?: string | null
  brand_id?: string | null
  brand_name?: string | null
  client_display_name?: string | null
  brand_display_name?: string | null
  project_remark?: string | null
  status: string
  start_date?: string | null
  deadline?: string | null
  agencies: AgencySummary[]
  task_count: number
  created_at: string
  updated_at: string
}

export interface ProjectListResponse {
  items: ProjectResponse[]
  total: number
  page: number
  page_size: number
}

export interface ProjectCreateRequest {
  name: string
  description?: string
  platform?: string
  start_date?: string
  deadline?: string
  agency_ids?: string[]
  client_display_name?: string
  brand_display_name?: string
  project_remark?: string
}

export interface ProjectUpdateRequest {
  name?: string
  description?: string
  platform?: string
  start_date?: string
  deadline?: string
  status?: 'active' | 'completed' | 'archived'
  client_display_name?: string
  brand_display_name?: string
  project_remark?: string
}
