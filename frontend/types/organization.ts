/**
 * 组织关系类型定义
 * 与后端 Organization schemas 对齐
 */

export interface BrandSummary {
  id: string
  name: string
  logo?: string | null
  contact_name?: string | null
}

export interface AgencyDetail {
  id: string
  name: string
  logo?: string | null
  contact_name?: string | null
  force_pass_enabled: boolean
}

export interface CreatorDetail {
  id: string
  name: string
  avatar?: string | null
  douyin_account?: string | null
  xiaohongshu_account?: string | null
  bilibili_account?: string | null
}

export interface BrandListResponse {
  items: BrandSummary[]
  total: number
}

export interface AgencyListResponse {
  items: AgencyDetail[]
  total: number
}

export interface CreatorListResponse {
  items: CreatorDetail[]
  total: number
}
