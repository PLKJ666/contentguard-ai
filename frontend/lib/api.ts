/**
 * API 客户端
 * Logto 会话认证
 */
import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios'
import { getSignInUrl } from '@/lib/signIn'
import type {
  VideoReviewRequest,
  VideoReviewResponse,
  ReviewProgressResponse,
  ReviewResultResponse,
  ScriptReviewRequest,
  ScriptReviewResponse,
} from '@/types/review'
import type {
  TaskResponse,
  TaskListResponse,
  TaskScriptUploadRequest,
  TaskVideoUploadRequest,
  TaskCreateRequest,
  TaskReviewRequest,
  TaskStage,
  ReviewCandidate,
  ReviewTaskListResponse,
  AppealRequest,
  CreatorGuidanceBoardRequest,
} from '@/types/task'
import type {
  ProjectResponse,
  ProjectListResponse,
  ProjectCreateRequest,
  ProjectUpdateRequest,
} from '@/types/project'
import type {
  OperatorProjectCreateRequest,
  OperatorProjectListResponse,
  OperatorTaskCreateRequest,
  OperatorTaskListResponse,
} from '@/types/operator'
import type {
  BriefResponse,
  BriefCreateRequest,
} from '@/types/brief'
import type {
  AgencyListResponse,
  CreatorListResponse,
  BrandListResponse,
} from '@/types/organization'
import type {
  CreatorDashboard,
  AgencyDashboard,
  BrandDashboard,
} from '@/types/dashboard'
import type {
  ForbiddenWordCreate,
  ForbiddenWordResponse,
  ForbiddenWordListResponse,
  WhitelistCreate,
  WhitelistResponse,
  WhitelistListResponse,
  CompetitorCreate,
  CompetitorResponse,
  CompetitorListResponse,
  PlatformRuleResponse,
  PlatformListResponse,
  RuleValidateRequest,
  RuleValidateResponse,
  PlatformRuleParseRequest,
  PlatformRuleParseResponse,
  PlatformRuleConfirmRequest,
  BrandPlatformRuleResponse,
  BrandPlatformRuleListResponse,
  LearnedRuleCreateRequest,
  LearnedRuleResponse,
} from '@/types/rules'
import type {
  AIConfigUpdate,
  AIConfigResponse,
  GetModelsRequest,
  ModelsListResponse,
  TestConnectionRequest,
  ConnectionTestResponse,
} from '@/types/ai-config'
import type {
  XHSBatchCreateRequest,
  XHSBatchEstimateResponse,
  XHSBatchItem,
  XHSBatchItemListResponse,
  XHSBatchJob,
  XHSBrandPack,
  XHSBriefPack,
  XHSBriefPackParseResponse,
  XHSDirection,
  XHSExportLog,
  XHSFeishuExportResponse,
  XHSFeishuExportStatusResponse,
  XHSProject,
  XHSProjectBriefParseResponse,
  XHSProjectBriefParseResult,
  XHSProjectVariant,
  XHSRulePack,
  XHSRiskPack,
  XHSVariantBriefParseResponse,
} from '@/types/xhs'

// 开发环境用空字符串（通过 next.config.js rewrites 代理到后端，绕过浏览器代理）
// 生产环境通过 NEXT_PUBLIC_API_BASE_URL 指定后端地址
// 兼容 NEXT_PUBLIC_API_BASE_URL=/api/v1，避免重复拼接
const API_BASE_URL_RAW = process.env.NEXT_PUBLIC_API_BASE_URL || ''
const API_BASE_URL = API_BASE_URL_RAW.replace(/\/+$/, '')
const API_BASE_PATH = API_BASE_URL.endsWith('/api/v1')
  ? API_BASE_URL
  : `${API_BASE_URL}/api/v1`
// 仅用于清理历史本地 JWT 残留，绝不能作为当前认证来源读取或写入。
const LEGACY_AUTH_STORAGE_KEY_ACCESS = 'contentguard_access_token'
const LEGACY_AUTH_STORAGE_KEY_REFRESH = 'contentguard_refresh_token'
// 当前仍使用的租户上下文缓存。它不参与认证，只用于前端记住当前租户选择。
const ACTIVE_TENANT_STORAGE_KEY = 'contentguard_tenant_id'

// Logto 模式下 token 存内存（不走 localStorage）
let _logtoAccessToken: string | null = null

// ==================== 类型定义 ====================

export type UserRole = 'brand' | 'agency' | 'creator' | 'operator'

export interface User {
  id: string
  email?: string
  phone?: string
  name: string
  avatar?: string
  role: UserRole
  is_verified: boolean
  brand_id?: string
  agency_id?: string
  creator_id?: string
  operator_id?: string
  tenant_id?: string
  tenant_name?: string
}

export interface UploadPolicyResponse {
  x_tos_algorithm: string
  x_tos_credential: string
  x_tos_date: string
  x_tos_signature: string
  policy: string
  host: string
  dir: string
  expire: number
  max_size_mb: number
}

export interface FileUploadedResponse {
  url: string
  file_key: string
  file_name: string
  file_size: number
  file_type: string
}

// ==================== 用户资料类型 ====================

export interface BrandProfileInfo {
  id: string
  name: string
  logo?: string
  description?: string
  contact_name?: string
  contact_phone?: string
  contact_email?: string
}

export interface AgencyProfileInfo {
  id: string
  name: string
  logo?: string
  description?: string
  contact_name?: string
  contact_phone?: string
  contact_email?: string
}

export interface CreatorProfileInfo {
  id: string
  name: string
  avatar?: string
  bio?: string
  douyin_account?: string
  xiaohongshu_account?: string
  bilibili_account?: string
}

export interface ProfileResponse {
  id: string
  email?: string
  phone?: string
  name: string
  avatar?: string
  role: string
  is_verified: boolean
  created_at?: string
  brand?: BrandProfileInfo
  agency?: AgencyProfileInfo
  creator?: CreatorProfileInfo
}

export interface ProfileUpdateRequest {
  name?: string
  avatar?: string
  phone?: string
  description?: string
  contact_name?: string
  contact_phone?: string
  contact_email?: string
  bio?: string
  douyin_account?: string
  xiaohongshu_account?: string
  bilibili_account?: string
}

// ==================== 通知设置类型 ====================

export interface NotificationSettingItem {
  id: string
  email: boolean
  push: boolean
  sms: boolean
}

export interface NotificationSettingsResponse {
  items: NotificationSettingItem[]
}

export interface NotificationSettingsUpdateRequest {
  items: NotificationSettingItem[]
}

// ==================== 代理商企业资料类型 ====================

export type VerifyStatus = 'unverified' | 'pending' | 'verified'

export interface AgencyCompanyProfileResponse {
  company_name?: string | null
  short_name?: string | null
  business_license?: string | null
  legal_person?: string | null
  registered_capital?: string | null
  establish_date?: string | null // YYYY-MM-DD
  business_scope?: string | null
  address?: string | null
  status?: string | null
  verify_status: VerifyStatus
  bank_name?: string | null
  bank_account_last4?: string | null
  contact_phone?: string | null
  contact_email?: string | null
}

export type AgencyCompanyProfileUpdateRequest = Partial<Omit<AgencyCompanyProfileResponse, 'verify_status'>> & {
  verify_status?: VerifyStatus
}

export interface AgencyCompanyVerifyRequest {
  method: 'bank' | 'legalPerson'
  code: string
}

export interface AgencyCompanyVerifyResponse {
  verify_status: VerifyStatus
  message: string
}

// ==================== 报表类型 ====================

export interface ReportDailyRow {
  id: string
  date: string // YYYY-MM-DD
  submitted: number
  passed: number
  failed: number
  avgScore: number
}

export interface ReportReviewRecord {
  id: string
  videoTitle: string
  creator: string
  platform: string
  score: number
  status: 'passed' | 'warning' | 'failed'
  reviewedAt: string // YYYY-MM-DD HH:mm
}

export interface ReportsResponse {
  reportData: ReportDailyRow[]
  reviewRecords: ReportReviewRecord[]
}

// ==================== 消息类型 ====================

export interface MessageItem {
  id: string
  type: string
  title: string
  content: string
  is_read: boolean
  related_task_id?: string
  related_project_id?: string
  sender_name?: string
  related_agency_id?: string
  related_brand_id?: string
  action_status?: string
  created_at?: string
}

export interface MessageListResponse {
  items: MessageItem[]
  total: number
  page: number
  page_size: number
}

// ==================== Logto 用户状态响应 ====================

export interface MeResponse {
  needs_onboarding: boolean
  logto_sub?: string
  email?: string
  name?: string
  id?: string
  phone?: string
  avatar?: string
  role?: UserRole
  is_verified?: boolean
  brand_id?: string
  agency_id?: string
  creator_id?: string
  operator_id?: string
  tenant_id?: string
  tenant_name?: string
}

// ==================== Token 管理 ====================

function getAccessToken(): string | null {
  return _logtoAccessToken
}

function clearTokens(): void {
  _logtoAccessToken = null
  if (typeof window === 'undefined') return
  localStorage.removeItem(LEGACY_AUTH_STORAGE_KEY_ACCESS)
  localStorage.removeItem(LEGACY_AUTH_STORAGE_KEY_REFRESH)
  localStorage.removeItem(ACTIVE_TENANT_STORAGE_KEY)
}

// ==================== 错误提取工具 ====================

/**
 * 从 API 错误中提取用户可读的错误信息
 * 优先使用后端返回的 detail 字段，回退到 axios 错误消息
 */
export function extractErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    // axios 错误：优先用后端返回的 detail
    const axiosErr = err as {
      response?: {
        data?: {
          detail?: string | { message?: string; conflicts?: Array<{ field?: string; message?: string }> }
          message?: string
        }
      }
      message?: string
      code?: string
    }
    const detail = axiosErr.response?.data?.detail
    if (typeof detail === 'string' && detail) return detail
    if (detail && typeof detail === 'object') {
      const message = typeof detail.message === 'string' ? detail.message : ''
      const conflictMessages = Array.isArray(detail.conflicts)
        ? detail.conflicts
            .map((conflict) => {
              if (!conflict || typeof conflict !== 'object') return ''
              return typeof conflict.message === 'string' ? conflict.message : ''
            })
            .filter(Boolean)
        : []
      if (message && conflictMessages.length > 0) {
        return `${message}：${conflictMessages.join('；')}`
      }
      if (message) return message
      if (conflictMessages.length > 0) return conflictMessages.join('；')
    }
    if (axiosErr.response?.data?.message) return axiosErr.response.data.message
    // 超时
    if (axiosErr.code === 'ECONNABORTED' || axiosErr.message?.includes('timeout')) {
      return '请求超时，请稍后重试'
    }
    // 网络错误
    if (axiosErr.message?.includes('Network Error')) {
      return '网络连接失败，请检查网络'
    }
    if (axiosErr.message?.includes('Failed to fetch')) {
      return '上传失败，请刷新页面后重试；如果文件来自微信、iCloud 或第三方位置，请先保存到本地“文件”再上传'
    }
    if (axiosErr.message) return axiosErr.message
  }
  if (err instanceof Error) {
    if (err.message.includes('Failed to fetch')) {
      return '上传失败，请刷新页面后重试；如果文件来自微信、iCloud 或第三方位置，请先保存到本地“文件”再上传'
    }
    return err.message
  }
  return '未知错误'
}

/**
 * 检查错误是否为超时错误
 */
export function isTimeoutError(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const axiosErr = err as { code?: string; message?: string; response?: { data?: { detail?: string } } }
    if (axiosErr.code === 'ECONNABORTED') return true
    const msg = axiosErr.response?.data?.detail || axiosErr.message || ''
    return msg.includes('timeout') || msg.includes('ECONNABORTED')
  }
  return false
}

function sanitizeReviewCandidate(candidate: ReviewCandidate): ReviewCandidate {
  return {
    id: String(candidate.id || ''),
    category: candidate.category,
    start_sec: Number.isFinite(candidate.start_sec) ? candidate.start_sec : 0,
    end_sec: Number.isFinite(candidate.end_sec) ? candidate.end_sec : 0,
    time_range: String(candidate.time_range || ''),
    priority: candidate.priority,
    problem: String(candidate.problem || ''),
    direct_fix: String(candidate.direct_fix || ''),
    where_to_change: String(candidate.where_to_change || ''),
    suggested_copy: candidate.suggested_copy ? String(candidate.suggested_copy) : undefined,
    bgm_action: candidate.bgm_action ? String(candidate.bgm_action) : undefined,
    evidence: candidate.evidence ? String(candidate.evidence) : undefined,
  }
}

function sanitizeCreatorGuidanceBoardRequest(data: CreatorGuidanceBoardRequest): CreatorGuidanceBoardRequest {
  const targetPage =
    typeof data.target_page === 'number' && Number.isInteger(data.target_page) && data.target_page >= 1
      ? data.target_page
      : undefined

  return {
    candidates: Array.isArray(data.candidates) ? data.candidates.map(sanitizeReviewCandidate) : [],
    layout_variant: data.layout_variant === 'landscape' ? 'landscape' : data.layout_variant === 'portrait' ? 'portrait' : undefined,
    style_variant: data.style_variant ? String(data.style_variant) : undefined,
    feedback_instruction: data.feedback_instruction ? String(data.feedback_instruction) : undefined,
    feedback_type: data.feedback_type,
    target_page: targetPage,
  }
}

// ==================== API 客户端 ====================

class ApiClient {
  private client: AxiosInstance
  private tenantId: string = 'default'
  private isRefreshing = false
  private refreshSubscribers: Array<{
    resolve: (token: string) => void
    reject: (error: unknown) => void
  }> = []

  constructor() {
    if (typeof window !== 'undefined') {
      const persistedTenantId = localStorage.getItem(ACTIVE_TENANT_STORAGE_KEY)?.trim()
      if (persistedTenantId) {
        this.tenantId = persistedTenantId
      }
    }

    this.client = axios.create({
      baseURL: API_BASE_PATH,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    })

    this.setupInterceptors()
  }

  private setupInterceptors() {
    // 请求拦截器：添加 Token 和租户 ID
    this.client.interceptors.request.use((config: InternalAxiosRequestConfig) => {
      const token = getAccessToken()
      if (token) {
        config.headers.Authorization = `Bearer ${token}`
      }
      config.headers['X-Tenant-ID'] = this.tenantId
      return config
    })

    // 响应拦截器：处理 401 错误
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean }

        // Logto access token 失效时，尝试通过同源 session 刷新一次。
        if (error.response?.status === 401 && !originalRequest._retry) {
          if (this.isRefreshing) {
            return new Promise((resolve, reject) => {
              this.refreshSubscribers.push({
                resolve: (token: string) => {
                  originalRequest.headers.Authorization = `Bearer ${token}`
                  resolve(this.client(originalRequest))
                },
                reject,
              })
            })
          }

          originalRequest._retry = true
          this.isRefreshing = true

          try {
            const newAccessToken = await this.refreshLogtoToken()
            if (!newAccessToken) {
              throw new Error('Logto session refresh failed')
            }

            this.refreshSubscribers.forEach(({ resolve }) => resolve(newAccessToken))
            this.refreshSubscribers = []

            originalRequest.headers.Authorization = `Bearer ${newAccessToken}`
            return this.client(originalRequest)
          } catch (refreshError) {
            this.refreshSubscribers.forEach(({ reject }) => reject(refreshError))
            this.refreshSubscribers = []
            clearTokens()
            if (typeof window !== 'undefined') {
              window.location.href = getSignInUrl()
            }
            return Promise.reject(refreshError)
          } finally {
            this.isRefreshing = false
          }
        }

        if (error.response?.status === 502) {
          return Promise.reject(new Error('服务正在重启或上游暂时不可用，请稍后重试'))
        }
        if (error.response?.status === 503) {
          return Promise.reject(new Error('服务暂时不可用，请稍后重试'))
        }
        if (error.response?.status === 504) {
          return Promise.reject(new Error('处理超时，请稍后重试'))
        }

        const message = (error.response?.data as { detail?: string })?.detail || error.message || '请求失败'
        return Promise.reject(new Error(message))
      }
    )
  }

  setTenantId(tenantId: string) {
    const normalizedTenantId = tenantId.trim() || 'default'
    this.tenantId = normalizedTenantId

    if (typeof window === 'undefined') return
    if (normalizedTenantId === 'default') {
      localStorage.removeItem(ACTIVE_TENANT_STORAGE_KEY)
      return
    }
    localStorage.setItem(ACTIVE_TENANT_STORAGE_KEY, normalizedTenantId)
  }

  getTenantId(): string {
    return this.tenantId
  }

  // ==================== Logto Token 管理 ====================

  /** 设置 Logto access token（内存存储） */
  setAccessToken(token: string) {
    _logtoAccessToken = token
  }

  /** 清除 Logto access token */
  clearAccessToken() {
    _logtoAccessToken = null
  }

  /** 获取当前 Logto access token（仅内存） */
  getToken(): string | null {
    return getAccessToken()
  }

  /** 通过 Logto session 刷新 access token */
  async refreshLogtoToken(): Promise<string | null> {
    try {
      const res = await fetch('/api/auth/token')
      if (!res.ok) return null
      const data = await res.json()
      if (data.access_token) {
        _logtoAccessToken = data.access_token
        return data.access_token
      }
      return null
    } catch {
      return null
    }
  }

  /** 获取当前用户信息（Logto 模式） */
  async getMe(): Promise<MeResponse> {
    const response = await this.client.get<MeResponse>('/auth/me')
    return response.data
  }

  /** Logto 新用户 Onboarding */
  async onboarding(data: {
    role: UserRole
    name: string
    company_name?: string
    platform?: string
    platform_account?: string
    operator_access_code?: string
  }): Promise<User & { tenant_id?: string; tenant_name?: string }> {
    const response = await this.client.post('/auth/onboarding', data)
    return response.data
  }

  /**
   * 退出登录
   */
  async logout(): Promise<void> {
    try {
      await this.client.post('/auth/logout')
    } finally {
      clearTokens()
    }
  }

  // ==================== 文件上传 ====================

  /**
   * 获取 TOS 上传凭证
   */
  async getUploadPolicy(fileType: string = 'general'): Promise<UploadPolicyResponse> {
    const response = await this.client.post<UploadPolicyResponse>('/upload/policy', {
      file_type: fileType,
    })
    return response.data
  }

  /**
   * 文件上传完成回调
   */
  async fileUploaded(fileKey: string, fileName: string, fileSize: number, fileType: string): Promise<FileUploadedResponse> {
    const response = await this.client.post<FileUploadedResponse>('/upload/complete', {
      file_key: fileKey,
      file_name: fileName,
      file_size: fileSize,
      file_type: fileType,
    })
    return response.data
  }

  /**
   * 后端代理上传（绕过浏览器直传 TOS 的 CORS/代理问题）
   */
  async proxyUpload(file: File, fileType: string = 'general', onProgress?: (pct: number) => void): Promise<FileUploadedResponse> {
    const tenantId = this.tenantId || 'default'
    const sameOriginMultipartParams = new URLSearchParams()
    const sameOriginBinaryParams = new URLSearchParams()
    if (tenantId) {
      sameOriginMultipartParams.set('tenant_id', tenantId)
      sameOriginBinaryParams.set('tenant_id', tenantId)
    }
    sameOriginBinaryParams.set('file_name', file.name)
    sameOriginBinaryParams.set('file_type', fileType)

    const sameOriginMultipartProxyUrl = sameOriginMultipartParams.toString()
      ? `/api/upload-proxy?${sameOriginMultipartParams.toString()}`
      : '/api/upload-proxy'
    const sameOriginBinaryProxyUrl = `/api/upload-proxy-binary?${sameOriginBinaryParams.toString()}`
    const backendBinaryUploadUrl = `${API_BASE_PATH}/upload/proxy-binary`
    const backendMultipartUploadUrl = `${API_BASE_PATH}/upload/proxy`

    const buildFormData = () => {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('file_type', fileType)
      return formData
    }
    const isSafariBrowser =
      typeof navigator !== 'undefined' &&
      /Safari/i.test(navigator.userAgent) &&
      !/Chrome|Chromium|CriOS|EdgiOS|FxiOS|Android/i.test(navigator.userAgent)
    // Safari 上传视频时，fetch(File) -> binary proxy 这条首跳更容易卡死在请求未完成状态。
    // 这里直接绕开 binary 路径，优先走 multipart/XHR。
    const shouldAvoidBinaryUpload = fileType === 'video' || isSafariBrowser
    const getUploadErrorStatus = (error: unknown): number | undefined => {
      const axiosError = error as AxiosError
      if (typeof axiosError?.response?.status === 'number') {
        return axiosError.response.status
      }
      const status = (error as { status?: unknown })?.status
      return typeof status === 'number' ? status : undefined
    }
    const isNetworkishUploadError = (error: unknown): boolean => {
      const axiosError = error as AxiosError
      const message = axiosError?.message || (error instanceof Error ? error.message : '')
      return (
        axiosError?.code === 'ECONNABORTED' ||
        message.includes('timeout') ||
        message.includes('Network Error') ||
        message.includes('Failed to fetch')
      )
    }
    const isRetryableUploadError = (error: unknown): boolean => {
      const status = getUploadErrorStatus(error)
      if (status === 401) return true
      if (typeof status === 'number') return status >= 500
      return isNetworkishUploadError(error)
    }
    const parseUploadResponse = async (response: Response): Promise<FileUploadedResponse> => {
      const raw = await response.text()
      let data: unknown = null
      try {
        data = raw ? JSON.parse(raw) : null
      } catch {
        data = null
      }

      if (!response.ok) {
        const detail =
          data && typeof data === 'object' && 'detail' in data && typeof data.detail === 'string'
            ? data.detail
            : raw || `上传失败（HTTP ${response.status}）`
        const error = new Error(detail) as Error & { status?: number }
        error.status = response.status
        throw error
      }

      return data as FileUploadedResponse
    }

    const uploadMultipartViaAxios = async (
      url: string,
      headers?: Record<string, string>
    ): Promise<FileUploadedResponse> => {
      const response = await axios.post<FileUploadedResponse>(url, buildFormData(), {
        timeout: 300000,
        withCredentials: url.startsWith('/'),
        headers,
        onUploadProgress: onProgress
          ? (e) => {
              if (e.total) onProgress(Math.round((e.loaded / e.total) * 100))
            }
          : undefined,
      })
      return response.data
    }

    const uploadBinaryViaFetch = async (
      url: string,
      headers?: Record<string, string>
    ): Promise<FileUploadedResponse> => {
      let response: Response
      try {
        response = await fetch(url, {
          method: 'POST',
          headers,
          body: file,
          credentials: url.startsWith('/') ? 'same-origin' : 'omit',
        })
      } catch {
        throw new Error('Network Error')
      }

      onProgress?.(85)
      return parseUploadResponse(response)
    }

    let directHeaders: Record<string, string> | null = null
    const getDirectHeaders = async (): Promise<Record<string, string>> => {
      if (directHeaders) return directHeaders
      const token = getAccessToken() || await this.refreshLogtoToken().catch(() => null)
      directHeaders = {}
      if (token) directHeaders.Authorization = `Bearer ${token}`
      if (tenantId) directHeaders['X-Tenant-ID'] = tenantId
      return directHeaders
    }

    if (!shouldAvoidBinaryUpload) {
      try {
        onProgress?.(10)
        return await uploadBinaryViaFetch(sameOriginBinaryProxyUrl)
      } catch (error) {
        if (getUploadErrorStatus(error) === 401) {
          const headers = await getDirectHeaders()
          if (headers.Authorization) {
            return uploadBinaryViaFetch(backendBinaryUploadUrl, {
              ...headers,
              'Content-Type': file.type || 'application/octet-stream',
              'X-Upload-File-Name': encodeURIComponent(file.name),
              'X-Upload-File-Type': fileType,
            })
          }
        }
        if (!isRetryableUploadError(error)) {
          throw error
        }
      }
    }

    try {
      return await uploadMultipartViaAxios(sameOriginMultipartProxyUrl)
    } catch (error) {
      if (getUploadErrorStatus(error) === 401) {
        const headers = await getDirectHeaders()
        if (headers.Authorization) {
          return uploadMultipartViaAxios(backendMultipartUploadUrl, headers)
        }
      }
      if (!isRetryableUploadError(error)) {
        throw error
      }
    }

    try {
      const headers = await getDirectHeaders()
      if (!headers.Authorization) {
        throw new Error('未登录或会话已失效，请重新登录后重试')
      }
      return await uploadMultipartViaAxios(backendMultipartUploadUrl, headers)
    } catch (error) {
      if (!isRetryableUploadError(error)) {
        throw error
      }
    }

    const headers = await getDirectHeaders()
    if (!headers.Authorization) {
      throw new Error('上传失败，请刷新页面后重试；如果文件来自微信、iCloud 或第三方位置，请先保存到本地“文件”再上传')
    }

    if (shouldAvoidBinaryUpload) {
      return uploadMultipartViaAxios(backendMultipartUploadUrl, headers)
    }

    return uploadBinaryViaFetch(backendBinaryUploadUrl, {
      ...headers,
      'Content-Type': file.type || 'application/octet-stream',
      'X-Upload-File-Name': encodeURIComponent(file.name),
      'X-Upload-File-Type': fileType,
    })
  }

  /**
   * 获取私有桶文件的预签名访问 URL
   */
  async getSignedUrl(url: string): Promise<string> {
    const response = await this.client.get<{ signed_url: string; expire_seconds: number }>(
      '/upload/sign-url',
      { params: { url } }
    )
    return response.data.signed_url
  }

  /**
   * 判断文件是否为视频/大文件类型
   */
  private _isLargeMediaFile(fileUrl: string): boolean {
    const ext = fileUrl.split(/[?#]/)[0].split('.').pop()?.toLowerCase() || ''
    return ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'm4v'].includes(ext)
  }

  /**
   * 获取流式代理 URL（用于 <video src="..."> 等需要 Range 请求的场景）
   *
   * 通过 query 参数携带 token，因为 <video> / <img> 标签无法设置 Authorization 头。
   * 后端 /upload/stream 支持 Range 请求，视频可拖动进度条。
   */
  getStreamUrl(fileUrl: string): string {
    const token = getAccessToken() || ''
    const baseURL = this.client.defaults.baseURL || ''
    return `${baseURL}/upload/stream?url=${encodeURIComponent(fileUrl)}&token=${encodeURIComponent(token)}`
  }

  /**
   * 获取文件预览 URL
   *
   * - 视频: 流式代理 URL（支持 Range 请求，视频可拖动进度条）
   * - 文档/图片: 后端代理 blob（确保正确 Content-Type）
   */
  async getPreviewUrl(fileUrl: string): Promise<string> {
    if (this._isLargeMediaFile(fileUrl)) {
      return this.getStreamUrl(fileUrl)
    }
    const response = await this.client.get('/upload/preview', {
      params: { url: fileUrl },
      responseType: 'blob',
    })
    return URL.createObjectURL(response.data)
  }

  /**
   * 下载文件
   *
   * - 视频: 流式代理 URL（大文件不加载到内存）
   * - 文档/图片: 后端代理 blob
   */
  async downloadFile(fileUrl: string, filename: string): Promise<void> {
    if (this._isLargeMediaFile(fileUrl)) {
      const streamUrl = this.getStreamUrl(fileUrl)
      const a = document.createElement('a')
      a.href = streamUrl
      a.download = filename
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      return
    }
    const response = await this.client.get('/upload/download', {
      params: { url: fileUrl },
      responseType: 'blob',
    })
    const blob = new Blob([response.data])
    const blobUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(blobUrl)
  }

  // ==================== 视频审核 ====================

  /**
   * 提交视频审核
   */
  async submitVideoReview(data: VideoReviewRequest): Promise<VideoReviewResponse> {
    const response = await this.client.post<VideoReviewResponse>('/videos/review', data)
    return response.data
  }

  /**
   * 查询审核进度
   */
  async getReviewProgress(reviewId: string): Promise<ReviewProgressResponse> {
    const response = await this.client.get<ReviewProgressResponse>(
      `/videos/review/${reviewId}/progress`
    )
    return response.data
  }

  /**
   * 查询审核结果
   */
  async getReviewResult(reviewId: string): Promise<ReviewResultResponse> {
    const response = await this.client.get<ReviewResultResponse>(
      `/videos/review/${reviewId}/result`
    )
    return response.data
  }

  // ==================== 审核任务 ====================

  /**
   * 创建任务（代理商操作）
   */
  async createTask(data: TaskCreateRequest): Promise<TaskResponse> {
    const response = await this.client.post<TaskResponse>('/tasks', data)
    return response.data
  }

  /**
   * 查询任务列表
   */
  async listTasks(page: number = 1, pageSize: number = 20, stage?: TaskStage, projectId?: string): Promise<TaskListResponse> {
    const response = await this.client.get<TaskListResponse>('/tasks', {
      params: { page, page_size: pageSize, stage, project_id: projectId },
    })
    return response.data
  }

  /**
   * 查询待审核任务列表
   */
  async listPendingReviews(page: number = 1, pageSize: number = 20): Promise<ReviewTaskListResponse> {
    const response = await this.client.get<ReviewTaskListResponse>('/tasks/pending', {
      params: { page, page_size: pageSize },
    })
    return response.data
  }

  /**
   * 查询任务详情
   */
  async getTask(taskId: string): Promise<TaskResponse> {
    const response = await this.client.get<TaskResponse>(`/tasks/${taskId}`)
    return response.data
  }

  /**
   * 上传/更新任务脚本
   */
  async uploadTaskScript(taskId: string, payload: TaskScriptUploadRequest): Promise<TaskResponse> {
    const response = await this.client.post<TaskResponse>(`/tasks/${taskId}/script`, payload)
    return response.data
  }

  /**
   * 上传/更新任务视频
   */
  async uploadTaskVideo(taskId: string, payload: TaskVideoUploadRequest): Promise<TaskResponse> {
    const response = await this.client.post<TaskResponse>(`/tasks/${taskId}/video`, payload)
    return response.data
  }

  /**
   * 审核脚本
   */
  async reviewScript(taskId: string, data: TaskReviewRequest): Promise<TaskResponse> {
    const response = await this.client.post<TaskResponse>(`/tasks/${taskId}/script/review`, data)
    return response.data
  }

  /**
   * 影子写手：AI 重写违规片段
   */
  async aiRewriteSegment(taskId: string, data: {
    full_script: string
    segment: string
    violation_content: string
    suggestion: string
    brand_context?: string
    violations?: Array<{id: string; violation_content: string; suggestion: string}>
  }): Promise<{ replacements: Array<{from: string; to: string}>; original: string; violation_ids?: string[] }> {
    const response = await this.client.post(`/tasks/${taskId}/script/ai-rewrite`, data, { timeout: 300000 })
    return response.data
  }

  /**
   * 对原始脚本文件做原地文字替换，返回修改后的文件 Blob 供下载
   */
  async applyFixesToFile(
    taskId: string,
    replacements: Array<{ from: string; to: string }>
  ): Promise<{ blob: Blob; replacementCount: number; modified: boolean }> {
    const response = await this.client.post(
      `/tasks/${taskId}/script/apply-fixes-to-file`,
      { replacements },
      { responseType: 'blob' }
    )
    const replacementCountHeader = response.headers?.['x-replacement-count']
    const modifiedHeader = response.headers?.['x-content-modified']
    const parsedCount = Number.parseInt(String(replacementCountHeader ?? '0'), 10)
    const replacementCount = Number.isNaN(parsedCount) ? 0 : parsedCount
    const modified = String(modifiedHeader ?? '').toLowerCase() === 'true' || replacementCount > 0
    return { blob: response.data as Blob, replacementCount, modified }
  }

  /**
   * 审核视频
   */
  async reviewVideo(taskId: string, data: TaskReviewRequest): Promise<TaskResponse> {
    const response = await this.client.post<TaskResponse>(`/tasks/${taskId}/video/review`, data)
    return response.data
  }

  async exportTasksCsv(params?: {
    project_id?: string
    task_id?: string
    start_date?: string
    end_date?: string
  }): Promise<Blob> {
    const response = await this.client.get('/export/tasks', {
      params,
      responseType: 'blob',
    })
    return response.data
  }

  /**
   * 生成达人修改图
   */
  async generateCreatorGuidanceBoard(taskId: string, data: CreatorGuidanceBoardRequest): Promise<TaskResponse> {
    const response = await this.client.post<TaskResponse>(
      `/tasks/${taskId}/video/guidance-board`,
      sanitizeCreatorGuidanceBoardRequest(data),
      { timeout: 300000 },
    )
    return response.data
  }

  /**
   * 导出达人修改图 ZIP
   */
  async exportCreatorGuidanceBoard(taskId: string): Promise<Blob> {
    const response = await this.client.get(`/tasks/${taskId}/video/guidance-board/export`, {
      responseType: 'blob',
    })
    return response.data
  }

  /**
   * 提交申诉（达人操作）
   */
  async submitAppeal(taskId: string, data: AppealRequest): Promise<TaskResponse> {
    const response = await this.client.post<TaskResponse>(`/tasks/${taskId}/appeal`, data)
    return response.data
  }

  /**
   * 增加申诉次数（代理商操作）
   */
  async increaseAppealCount(taskId: string): Promise<TaskResponse> {
    const response = await this.client.post<TaskResponse>(`/tasks/${taskId}/appeal-count`)
    return response.data
  }

  /**
   * 申请增加申诉次数（达人操作，发消息通知代理商）
   */
  async requestAppealCountIncrease(taskId: string): Promise<TaskResponse> {
    const response = await this.client.post<TaskResponse>(`/tasks/${taskId}/request-appeal-count`)
    return response.data
  }

  /**
   * 拒绝申诉次数申请（代理商操作）
   */
  async rejectAppealCount(taskId: string): Promise<TaskResponse> {
    const response = await this.client.post<TaskResponse>(`/tasks/${taskId}/reject-appeal-count`)
    return response.data
  }

  // ==================== 项目 ====================

  /**
   * 创建项目（品牌方操作）
   */
  async createProject(data: ProjectCreateRequest): Promise<ProjectResponse> {
    const response = await this.client.post<ProjectResponse>('/projects', data)
    return response.data
  }

  /**
   * 查询项目列表
   */
  async listProjects(page: number = 1, pageSize: number = 20, status?: string): Promise<ProjectListResponse> {
    const response = await this.client.get<ProjectListResponse>('/projects', {
      params: { page, page_size: pageSize, status },
    })
    return response.data
  }

  /**
   * 查询项目详情
   */
  async getProject(projectId: string): Promise<ProjectResponse> {
    const response = await this.client.get<ProjectResponse>(`/projects/${projectId}`)
    return response.data
  }

  /**
   * 更新项目
   */
  async updateProject(projectId: string, data: ProjectUpdateRequest): Promise<ProjectResponse> {
    const response = await this.client.put<ProjectResponse>(`/projects/${projectId}`, data)
    return response.data
  }

  /**
   * 分配代理商到项目
   */
  async assignAgencies(projectId: string, agencyIds: string[]): Promise<ProjectResponse> {
    const response = await this.client.post<ProjectResponse>(`/projects/${projectId}/agencies`, {
      agency_ids: agencyIds,
    })
    return response.data
  }

  /**
   * 从项目移除代理商
   */
  async removeAgencyFromProject(projectId: string, agencyId: string): Promise<ProjectResponse> {
    const response = await this.client.delete<ProjectResponse>(`/projects/${projectId}/agencies/${agencyId}`)
    return response.data
  }

  // ==================== 代运营 ====================

  async listOperatorProjects(): Promise<OperatorProjectListResponse> {
    const response = await this.client.get<OperatorProjectListResponse>('/operator/projects')
    return response.data
  }

  async createOperatorProject(data: OperatorProjectCreateRequest): Promise<ProjectResponse> {
    const response = await this.client.post<ProjectResponse>('/operator/projects', data)
    return response.data
  }

  async listOperatorTasks(): Promise<OperatorTaskListResponse> {
    const response = await this.client.get<OperatorTaskListResponse>('/operator/tasks')
    return response.data
  }

  async createOperatorTask(data: OperatorTaskCreateRequest): Promise<TaskResponse> {
    const response = await this.client.post<TaskResponse>('/operator/tasks', data)
    return response.data
  }

  async getOperatorTask(taskId: string): Promise<TaskResponse> {
    const response = await this.client.get<TaskResponse>(`/operator/tasks/${taskId}`)
    return response.data
  }

  async uploadOperatorTaskScript(taskId: string, payload: TaskScriptUploadRequest): Promise<TaskResponse> {
    const response = await this.client.post<TaskResponse>(`/operator/tasks/${taskId}/script`, payload)
    return response.data
  }

  async uploadOperatorTaskVideo(taskId: string, payload: TaskVideoUploadRequest): Promise<TaskResponse> {
    const response = await this.client.post<TaskResponse>(`/operator/tasks/${taskId}/video`, payload)
    return response.data
  }

  async reviewOperatorTask(taskId: string, data: TaskReviewRequest): Promise<TaskResponse> {
    const response = await this.client.post<TaskResponse>(`/operator/tasks/${taskId}/review`, data)
    return response.data
  }

  // ==================== Brief ====================

  /**
   * 获取项目 Brief
   */
  async getBrief(projectId: string): Promise<BriefResponse> {
    const response = await this.client.get<BriefResponse>(`/projects/${projectId}/brief`)
    return response.data
  }

  /**
   * 创建项目 Brief
   */
  async createBrief(projectId: string, data: BriefCreateRequest): Promise<BriefResponse> {
    const response = await this.client.post<BriefResponse>(`/projects/${projectId}/brief`, data)
    return response.data
  }

  /**
   * 更新项目 Brief
   */
  async updateBrief(projectId: string, data: BriefCreateRequest): Promise<BriefResponse> {
    const response = await this.client.put<BriefResponse>(`/projects/${projectId}/brief`, data)
    return response.data
  }

  /**
   * 代理商更新 Brief（agency_attachments + selling_points + blacklist_words）
   */
  async updateBriefByAgency(projectId: string, data: {
    agency_attachments?: Array<{ id?: string; name: string; url: string; size?: string }>
    product_name?: string
    selling_points?: Array<{ content: string; required?: boolean; priority?: 'core' | 'recommended' | 'reference' }>
    blacklist_words?: Array<{ word: string; reason: string }>
    brand_tone?: string
    other_requirements?: string
    min_selling_points?: number | null
    creative_rubric?: import('@/types/brief').CreativeRubric | null
  }): Promise<BriefResponse> {
    const response = await this.client.patch<BriefResponse>(`/projects/${projectId}/brief/agency-attachments`, data)
    return response.data
  }

  /**
   * AI 解析 Brief 文档
   *
   * 走 Next.js Route Handler 代理 (/api/brief-parse/[projectId])，
   * 因为 next.config.js rewrites 代理默认 30s 超时，AI 解析需要更久。
   */
  async parseBrief(projectId: string): Promise<{
    product_name: string
    target_audience: string
    content_requirements: string
    selling_points: Array<{ content: string; priority?: 'core' | 'recommended' | 'reference'; required?: boolean }>
    blacklist_words: Array<{ word: string; reason: string }>
    creative_rubric?: import('@/types/brief').CreativeRubric | null
  }> {
    const response = await axios.post(`/api/brief-parse/${projectId}`, null, {
      timeout: 300000,  // 5 分钟，文档下载 + 图片提取 + AI 解析较慢
      headers: {
        'X-Tenant-ID': this.tenantId,
        'Content-Type': 'application/json',
      },
    })
    return response.data
  }

  // ==================== 组织关系 ====================

  /**
   * 品牌方：查询代理商列表
   */
  async listBrandAgencies(): Promise<AgencyListResponse> {
    const response = await this.client.get<AgencyListResponse>('/organizations/brand/agencies')
    return response.data
  }

  /**
   * 品牌方：邀请代理商
   */
  async inviteAgency(agencyId: string): Promise<void> {
    await this.client.post('/organizations/brand/agencies', { agency_id: agencyId })
  }

  /**
   * 品牌方：移除代理商
   */
  async removeAgency(agencyId: string): Promise<void> {
    await this.client.delete(`/organizations/brand/agencies/${agencyId}`)
  }

  /**
   * 品牌方：更新代理商权限
   */
  async updateAgencyPermission(agencyId: string, forcePassEnabled: boolean): Promise<void> {
    await this.client.put(`/organizations/brand/agencies/${agencyId}/permission`, {
      force_pass_enabled: forcePassEnabled,
    })
  }

  /**
   * 代理商：查询达人列表
   */
  async listAgencyCreators(): Promise<CreatorListResponse> {
    const response = await this.client.get<CreatorListResponse>('/organizations/agency/creators')
    return response.data
  }

  /**
   * 代理商：邀请达人
   */
  async inviteCreator(creatorId: string): Promise<void> {
    await this.client.post('/organizations/agency/creators', { creator_id: creatorId })
  }

  /**
   * 代理商：移除达人
   */
  async removeCreator(creatorId: string): Promise<void> {
    await this.client.delete(`/organizations/agency/creators/${creatorId}`)
  }

  /**
   * 代理商：查询关联品牌方
   */
  async listAgencyBrands(): Promise<BrandListResponse> {
    const response = await this.client.get<BrandListResponse>('/organizations/agency/brands')
    return response.data
  }

  /**
   * 搜索代理商
   */
  async searchAgencies(keyword: string): Promise<AgencyListResponse> {
    const response = await this.client.get<AgencyListResponse>('/organizations/search/agencies', {
      params: { keyword },
    })
    return response.data
  }

  /**
   * 搜索达人
   */
  async searchCreators(keyword: string): Promise<CreatorListResponse> {
    const response = await this.client.get<CreatorListResponse>('/organizations/search/creators', {
      params: { keyword },
    })
    return response.data
  }

  // ==================== 工作台统计 ====================

  /**
   * 达人工作台数据
   */
  async getCreatorDashboard(): Promise<CreatorDashboard> {
    const response = await this.client.get<CreatorDashboard>('/dashboard/creator')
    return response.data
  }

  /**
   * 代理商工作台数据
   */
  async getAgencyDashboard(): Promise<AgencyDashboard> {
    const response = await this.client.get<AgencyDashboard>('/dashboard/agency')
    return response.data
  }

  /**
   * 品牌方工作台数据
   */
  async getBrandDashboard(): Promise<BrandDashboard> {
    const response = await this.client.get<BrandDashboard>('/dashboard/brand')
    return response.data
  }

  // ==================== XHS 批量改写 ====================

  async listXHSProjects(params?: { category_id?: string; status?: string }): Promise<XHSProject[]> {
    const response = await this.client.get<XHSProject[]>('/xhs/projects', { params })
    return response.data
  }

  async createXHSProject(data: {
    name: string
    category_id: string
    client_name?: string
    product_name?: string
    brief_file_ref?: string
    brief_file_name?: string
    brief_parse_result?: XHSProjectBriefParseResult
    project_brief?: string
    shared_requirements?: string
    remark?: string
    status?: 'active' | 'archived'
  }): Promise<XHSProject> {
    const response = await this.client.post<XHSProject>('/xhs/projects', data)
    return response.data
  }

  async updateXHSProject(projectId: string, data: {
    name?: string
    category_id?: string
    client_name?: string
    product_name?: string
    brief_file_ref?: string | null
    brief_file_name?: string | null
    brief_parse_result?: XHSProjectBriefParseResult | null
    project_brief?: string
    shared_requirements?: string
    remark?: string
    status?: 'active' | 'archived'
  }): Promise<XHSProject> {
    const response = await this.client.put<XHSProject>(`/xhs/projects/${projectId}`, data)
    return response.data
  }

  async parseXHSProjectBrief(data: {
    source_ref: string
    file_name: string
    file_url?: string
    category_id?: string
  }): Promise<XHSProjectBriefParseResponse> {
    const response = await axios.post('/api/xhs-project-brief-parse', data, {
      timeout: 300000,
      headers: {
        'X-Tenant-ID': this.tenantId,
        'Content-Type': 'application/json',
      },
    })
    return response.data
  }

  async parseXHSVariantBrief(data: {
    source_ref?: string
    file_name?: string
    file_url?: string
    raw_text?: string
    category_id?: string
  }): Promise<XHSVariantBriefParseResponse> {
    const response = await this.client.post<XHSVariantBriefParseResponse>('/xhs/variants/brief/parse', data, {
      timeout: 300000,
    })
    return response.data
  }

  async listXHSProjectVariants(projectId: string): Promise<XHSProjectVariant[]> {
    const response = await this.client.get<XHSProjectVariant[]>(`/xhs/projects/${projectId}/variants`)
    return response.data
  }

  async createXHSProjectVariant(projectId: string, data: {
    name: string
    selling_points?: string
    appearance_notes?: string
    notes?: string
    is_primary?: boolean
    sort_order?: number
  }): Promise<XHSProjectVariant> {
    const response = await this.client.post<XHSProjectVariant>(`/xhs/projects/${projectId}/variants`, data)
    return response.data
  }

  async updateXHSProjectVariant(variantId: string, data: {
    name?: string
    selling_points?: string
    appearance_notes?: string
    notes?: string
    is_primary?: boolean
    sort_order?: number
  }): Promise<XHSProjectVariant> {
    const response = await this.client.put<XHSProjectVariant>(`/xhs/variants/${variantId}`, data)
    return response.data
  }

  async listXHSDirections(projectId: string): Promise<XHSDirection[]> {
    const response = await this.client.get<XHSDirection[]>(`/xhs/projects/${projectId}/directions`)
    return response.data
  }

  async createXHSDirection(projectId: string, data: {
    name: string
    status?: 'draft' | 'active' | 'archived'
    main_variant_id?: string
    secondary_variant_ids?: string[]
    content_style?: string
    direction_brief?: string
    extra_requirements?: string
    notes?: string
    sort_order?: number
  }): Promise<XHSDirection> {
    const response = await this.client.post<XHSDirection>(`/xhs/projects/${projectId}/directions`, data)
    return response.data
  }

  async updateXHSDirection(directionId: string, data: {
    name?: string
    status?: 'draft' | 'active' | 'archived'
    main_variant_id?: string | null
    secondary_variant_ids?: string[]
    content_style?: string | null
    direction_brief?: string | null
    extra_requirements?: string | null
    notes?: string | null
    sort_order?: number
  }): Promise<XHSDirection> {
    const response = await this.client.put<XHSDirection>(`/xhs/directions/${directionId}`, data)
    return response.data
  }

  async createXHSBatch(data: XHSBatchCreateRequest): Promise<XHSBatchJob> {
    const response = await this.client.post<XHSBatchJob>('/xhs/batches', data, {
      // 批次创建时后端会同步做文本切分，长文案可能超过默认 30 秒。
      timeout: 300000,
    })
    return response.data
  }

  async estimateXHSBatch(data: XHSBatchCreateRequest): Promise<XHSBatchEstimateResponse> {
    const response = await this.client.post<XHSBatchEstimateResponse>('/xhs/batches/estimate', data, {
      // 预估前同样会执行切分逻辑，超时策略需要与创建批次一致。
      timeout: 300000,
    })
    return response.data
  }

  async listXHSBatches(params?: { status?: string; project_id?: string; direction_id?: string }): Promise<XHSBatchJob[]> {
    const response = await this.client.get<XHSBatchJob[]>('/xhs/batches', {
      params,
    })
    return response.data
  }

  async getXHSBatch(batchId: string): Promise<XHSBatchJob> {
    const response = await this.client.get<XHSBatchJob>(`/xhs/batches/${batchId}`)
    return response.data
  }

  async listXHSBatchItems(
    batchId: string,
    params?: { status?: string; q?: string; page?: number; page_size?: number }
  ): Promise<XHSBatchItemListResponse> {
    const response = await this.client.get<XHSBatchItemListResponse>(`/xhs/batches/${batchId}/items`, {
      params,
    })
    return response.data
  }

  async listXHSBatchExports(batchId: string, type?: string): Promise<XHSExportLog[]> {
    const response = await this.client.get<XHSExportLog[]>(`/xhs/batches/${batchId}/exports`, {
      params: { type },
    })
    return response.data
  }

  async startXHSBatch(batchId: string): Promise<XHSBatchJob> {
    const response = await this.client.post<XHSBatchJob>(`/xhs/batches/${batchId}/start`)
    return response.data
  }

  async promoteXHSBatch(batchId: string): Promise<XHSBatchJob> {
    const response = await this.client.post<XHSBatchJob>(`/xhs/batches/${batchId}/promote`)
    return response.data
  }

  async retryXHSBatch(batchId: string): Promise<XHSBatchJob> {
    const response = await this.client.post<XHSBatchJob>(`/xhs/batches/${batchId}/retry`)
    return response.data
  }

  async submitXHSBatchItemDecision(batchId: string, itemId: string, optionId: string): Promise<XHSBatchItem> {
    const response = await this.client.post<XHSBatchItem>(`/xhs/batches/${batchId}/items/${itemId}/decision`, {
      option_id: optionId,
    })
    return response.data
  }

  async exportXHSBatchAllMarkdown(batchId: string): Promise<Blob> {
    const response = await this.client.get<Blob>(`/xhs/batches/${batchId}/export/all.md`, {
      responseType: 'blob',
    })
    return response.data
  }

  async exportXHSBatchFeishu(
    batchId: string,
    payload?: { folder_token?: string; doc_title?: string }
  ): Promise<XHSFeishuExportResponse> {
    const response = await this.client.post<XHSFeishuExportResponse>(`/xhs/batches/${batchId}/export/feishu`, payload || {})
    return response.data
  }

  async getXHSBatchFeishuStatus(batchId: string): Promise<XHSFeishuExportStatusResponse> {
    const response = await this.client.get<XHSFeishuExportStatusResponse>(`/xhs/batches/${batchId}/export/feishu/status`)
    return response.data
  }

  async listXHSBrandPacks(params?: { category_id?: string; status?: string }): Promise<XHSBrandPack[]> {
    const response = await this.client.get<XHSBrandPack[]>('/xhs/config/brand-packs', { params })
    return response.data
  }

  async listXHSRulePacks(params?: { category_id?: string; status?: string }): Promise<XHSRulePack[]> {
    const response = await this.client.get<XHSRulePack[]>('/xhs/config/rule-packs', { params })
    return response.data
  }

  async createXHSRulePack(data: {
    name: string
    category_id: string
    version: string
    status?: string
    pack: Record<string, unknown>
  }): Promise<XHSRulePack> {
    const response = await this.client.post<XHSRulePack>('/xhs/config/rule-packs', data)
    return response.data
  }

  async publishXHSRulePack(packId: string): Promise<XHSRulePack> {
    const response = await this.client.post<XHSRulePack>(`/xhs/config/rule-packs/${packId}/publish`)
    return response.data
  }

  async updateXHSRulePack(packId: string, data: {
    name?: string
    version?: string
    status?: string
    pack?: Record<string, unknown>
  }): Promise<XHSRulePack> {
    const response = await this.client.put<XHSRulePack>(`/xhs/config/rule-packs/${packId}`, data)
    return response.data
  }

  async createXHSBrandPack(data: {
    brand_name: string
    category_id: string
    version: string
    status?: string
    is_default?: boolean
    pack: Record<string, unknown>
  }): Promise<XHSBrandPack> {
    const response = await this.client.post<XHSBrandPack>('/xhs/config/brand-packs', data)
    return response.data
  }

  async publishXHSBrandPack(packId: string): Promise<XHSBrandPack> {
    const response = await this.client.post<XHSBrandPack>(`/xhs/config/brand-packs/${packId}/publish`)
    return response.data
  }

  async updateXHSBrandPack(packId: string, data: {
    brand_name?: string
    version?: string
    status?: string
    is_default?: boolean
    pack?: Record<string, unknown>
  }): Promise<XHSBrandPack> {
    const response = await this.client.put<XHSBrandPack>(`/xhs/config/brand-packs/${packId}`, data)
    return response.data
  }

  async listXHSBriefPacks(params?: { category_id?: string; status?: string }): Promise<XHSBriefPack[]> {
    const response = await this.client.get<XHSBriefPack[]>('/xhs/config/brief-packs', { params })
    return response.data
  }

  async createXHSBriefPack(data: {
    brand_name: string
    category_id: string
    version: string
    status?: string
    source_type: 'upload' | 'feishu_link'
    source_ref?: string
    pack: Record<string, unknown>
  }): Promise<XHSBriefPack> {
    const response = await this.client.post<XHSBriefPack>('/xhs/config/brief-packs', data)
    return response.data
  }

  async publishXHSBriefPack(packId: string): Promise<XHSBriefPack> {
    const response = await this.client.post<XHSBriefPack>(`/xhs/config/brief-packs/${packId}/publish`)
    return response.data
  }

  async updateXHSBriefPack(packId: string, data: {
    brand_name?: string
    version?: string
    status?: string
    source_type?: 'upload' | 'feishu_link'
    source_ref?: string
    pack?: Record<string, unknown>
  }): Promise<XHSBriefPack> {
    const response = await this.client.put<XHSBriefPack>(`/xhs/config/brief-packs/${packId}`, data)
    return response.data
  }

  async parseXHSBriefPack(data: {
    source_type: 'upload' | 'feishu_link'
    source_text?: string
    source_ref?: string
    file_url?: string
    file_name?: string
  }): Promise<XHSBriefPackParseResponse> {
    const response = await this.client.post<XHSBriefPackParseResponse>('/xhs/config/brief-packs/parse', data, {
      timeout: 300000,
    })
    return response.data
  }

  async listXHSRiskPacks(params?: { category_id?: string; status?: string }): Promise<XHSRiskPack[]> {
    const response = await this.client.get<XHSRiskPack[]>('/xhs/config/risk-packs', { params })
    return response.data
  }

  async createXHSRiskPack(data: {
    name: string
    category_id: string
    version: string
    status?: string
    pack: Record<string, unknown>
  }): Promise<XHSRiskPack> {
    const response = await this.client.post<XHSRiskPack>('/xhs/config/risk-packs', data)
    return response.data
  }

  async publishXHSRiskPack(packId: string): Promise<XHSRiskPack> {
    const response = await this.client.post<XHSRiskPack>(`/xhs/config/risk-packs/${packId}/publish`)
    return response.data
  }

  async updateXHSRiskPack(packId: string, data: {
    name?: string
    version?: string
    status?: string
    pack?: Record<string, unknown>
  }): Promise<XHSRiskPack> {
    const response = await this.client.put<XHSRiskPack>(`/xhs/config/risk-packs/${packId}`, data)
    return response.data
  }

  // ==================== 脚本预审 ====================

  /**
   * 脚本预审（AI 审核）
   */
  async reviewScriptContent(data: ScriptReviewRequest): Promise<ScriptReviewResponse> {
    const response = await this.client.post<ScriptReviewResponse>('/scripts/review', data)
    return response.data
  }

  // ==================== 规则管理 ====================

  /**
   * 查询违禁词列表
   */
  async listForbiddenWords(category?: string): Promise<ForbiddenWordListResponse> {
    const response = await this.client.get<ForbiddenWordListResponse>('/rules/forbidden-words', {
      params: category ? { category } : undefined,
    })
    return response.data
  }

  /**
   * 添加违禁词
   */
  async addForbiddenWord(data: ForbiddenWordCreate): Promise<ForbiddenWordResponse> {
    const response = await this.client.post<ForbiddenWordResponse>('/rules/forbidden-words', data)
    return response.data
  }

  /**
   * 删除违禁词
   */
  async deleteForbiddenWord(wordId: string): Promise<void> {
    await this.client.delete(`/rules/forbidden-words/${wordId}`)
  }

  /**
   * 查询白名单
   */
  async listWhitelist(brandId?: string): Promise<WhitelistListResponse> {
    const response = await this.client.get<WhitelistListResponse>('/rules/whitelist', {
      params: brandId ? { brand_id: brandId } : undefined,
    })
    return response.data
  }

  /**
   * 添加白名单
   */
  async addToWhitelist(data: WhitelistCreate): Promise<WhitelistResponse> {
    const response = await this.client.post<WhitelistResponse>('/rules/whitelist', data)
    return response.data
  }

  /**
   * 删除白名单
   */
  async deleteWhitelistItem(id: string): Promise<void> {
    await this.client.delete(`/rules/whitelist/${id}`)
  }

  /**
   * 查询竞品列表
   */
  async listCompetitors(brandId?: string): Promise<CompetitorListResponse> {
    const response = await this.client.get<CompetitorListResponse>('/rules/competitors', {
      params: brandId ? { brand_id: brandId } : undefined,
    })
    return response.data
  }

  /**
   * 添加竞品
   */
  async addCompetitor(data: CompetitorCreate): Promise<CompetitorResponse> {
    const response = await this.client.post<CompetitorResponse>('/rules/competitors', data)
    return response.data
  }

  /**
   * 删除竞品
   */
  async deleteCompetitor(competitorId: string): Promise<void> {
    await this.client.delete(`/rules/competitors/${competitorId}`)
  }

  /**
   * 查询所有平台规则
   */
  async listPlatformRules(): Promise<PlatformListResponse> {
    const response = await this.client.get<PlatformListResponse>('/rules/platforms')
    return response.data
  }

  /**
   * 查询指定平台规则
   */
  async getPlatformRules(platform: string): Promise<PlatformRuleResponse> {
    const response = await this.client.get<PlatformRuleResponse>(`/rules/platforms/${platform}`)
    return response.data
  }

  /**
   * 规则冲突检测
   */
  async validateRules(data: RuleValidateRequest): Promise<RuleValidateResponse> {
    const response = await this.client.post<RuleValidateResponse>('/rules/validate', data)
    return response.data
  }

  /**
   * 上传文档并 AI 解析平台规则
   */
  async parsePlatformRule(data: PlatformRuleParseRequest): Promise<PlatformRuleParseResponse> {
    const response = await this.client.post<PlatformRuleParseResponse>('/rules/platform-rules/parse', data, {
      timeout: 300000,  // 5 分钟：后端需下载文件+提取图片+AI视觉模型处理，总耗时可能超过 3 分钟
    })
    return response.data
  }

  /**
   * 确认/编辑平台规则
   */
  async confirmPlatformRule(ruleId: string, data: PlatformRuleConfirmRequest): Promise<BrandPlatformRuleResponse> {
    const response = await this.client.put<BrandPlatformRuleResponse>(`/rules/platform-rules/${ruleId}/confirm`, data)
    return response.data
  }

  /**
   * 查询品牌方平台规则列表
   */
  async listBrandPlatformRules(params?: { brand_id?: string; platform?: string; status?: string }): Promise<BrandPlatformRuleListResponse> {
    const response = await this.client.get<BrandPlatformRuleListResponse>('/rules/platform-rules', { params })
    return response.data
  }

  /**
   * 删除平台规则
   */
  async deletePlatformRule(ruleId: string): Promise<void> {
    await this.client.delete(`/rules/platform-rules/${ruleId}`)
  }

  // ==================== 通用规则文档上传解析 ====================

  async parseRuleDocument(data: {
    document_url: string
    document_name: string
    rule_type: 'forbidden_words' | 'whitelist' | 'competitors'
    brand_id?: string
  }): Promise<any> {
    const response = await this.client.post('/rules/document-parse', data, {
      timeout: 300000,  // 5 分钟：同 parsePlatformRule
    })
    return response.data
  }

  async confirmRuleDocument(data: {
    rule_type: 'forbidden_words' | 'whitelist' | 'competitors'
    brand_id?: string
    forbidden_words?: any[]
    whitelist_items?: any[]
    competitors?: any[]
  }): Promise<{ added: number; skipped: number }> {
    const response = await this.client.post<{ added: number; skipped: number }>('/rules/document-confirm', data)
    return response.data
  }

  // ==================== 品牌学习档案 ====================

  async listBrandLearningRules(): Promise<LearnedRuleResponse[]> {
    const response = await this.client.get<LearnedRuleResponse[]>('/brand-learning/rules')
    return response.data
  }

  async createBrandLearningRule(data: LearnedRuleCreateRequest): Promise<LearnedRuleResponse> {
    const response = await this.client.post<LearnedRuleResponse>('/brand-learning/rules', data)
    return response.data
  }

  async deleteBrandLearningRule(ruleId: string): Promise<void> {
    await this.client.delete(`/brand-learning/rules/${ruleId}`)
  }

  // ==================== AI 配置 ====================

  /**
   * 获取 AI 配置
   */
  async getAIConfig(): Promise<AIConfigResponse> {
    const response = await this.client.get<AIConfigResponse>('/ai-config')
    return response.data
  }

  /**
   * 更新 AI 配置
   */
  async updateAIConfig(data: AIConfigUpdate): Promise<AIConfigResponse> {
    const response = await this.client.put<AIConfigResponse>('/ai-config', data)
    return response.data
  }

  /**
   * 获取可用模型列表
   */
  async getAIModels(data: GetModelsRequest): Promise<ModelsListResponse> {
    const response = await this.client.post<ModelsListResponse>('/ai-config/models', data, {
      timeout: 60000,
    })
    return response.data
  }

  /**
   * 测试 AI 连接
   */
  async testAIConnection(data: TestConnectionRequest): Promise<ConnectionTestResponse> {
    const response = await this.client.post<ConnectionTestResponse>('/ai-config/test', data, {
      timeout: 60000,
    })
    return response.data
  }

  // ==================== 用户资料 ====================

  /**
   * 获取当前用户资料
   */
  async getProfile(): Promise<ProfileResponse> {
    const response = await this.client.get<ProfileResponse>('/profile')
    return response.data
  }

  /**
   * 更新用户资料
   */
  async updateProfile(data: ProfileUpdateRequest): Promise<ProfileResponse> {
    const response = await this.client.put<ProfileResponse>('/profile', data)
    return response.data
  }

  /**
   * 获取代理商企业资料
   */
  async getAgencyCompanyProfile(): Promise<AgencyCompanyProfileResponse> {
    const response = await this.client.get<AgencyCompanyProfileResponse>('/profile/company')
    return response.data
  }

  /**
   * 更新代理商企业资料
   */
  async updateAgencyCompanyProfile(data: AgencyCompanyProfileUpdateRequest): Promise<AgencyCompanyProfileResponse> {
    const response = await this.client.put<AgencyCompanyProfileResponse>('/profile/company', data)
    return response.data
  }

  /**
   * 企业认证（状态流转）
   */
  async verifyAgencyCompanyProfile(data: AgencyCompanyVerifyRequest): Promise<AgencyCompanyVerifyResponse> {
    const response = await this.client.post<AgencyCompanyVerifyResponse>('/profile/company/verify', data)
    return response.data
  }

  /**
   * 获取通知设置
   */
  async getNotificationSettings(): Promise<NotificationSettingsResponse> {
    const response = await this.client.get<NotificationSettingsResponse>('/profile/notification-settings')
    return response.data
  }

  /**
   * 更新通知设置
   */
  async updateNotificationSettings(data: NotificationSettingsUpdateRequest): Promise<NotificationSettingsResponse> {
    const response = await this.client.put<NotificationSettingsResponse>('/profile/notification-settings', data)
    return response.data
  }

  // ==================== 消息/通知 ====================

  /**
   * 获取消息列表
   */
  async getMessages(params?: { page?: number; page_size?: number; is_read?: boolean; type?: string }): Promise<MessageListResponse> {
    const response = await this.client.get<MessageListResponse>('/messages', { params })
    return response.data
  }

  /**
   * 获取未读消息数
   */
  async getUnreadCount(): Promise<{ count: number }> {
    const response = await this.client.get<{ count: number }>('/messages/unread-count')
    return response.data
  }

  /**
   * 标记单条消息已读
   */
  async markMessageAsRead(messageId: string): Promise<void> {
    await this.client.put(`/messages/${messageId}/read`)
  }

  /**
   * 标记所有消息已读
   */
  async markAllMessagesAsRead(): Promise<void> {
    await this.client.put('/messages/read-all')
  }

  // ==================== 报表 ====================

  async getReports(params?: { period?: string; platform?: string }): Promise<ReportsResponse> {
    const response = await this.client.get<ReportsResponse>('/reports', { params })
    return response.data
  }

  /**
   * 达人：接受代理商邀请
   */
  async acceptInvite(messageId: string): Promise<void> {
    await this.client.post(`/organizations/creator/invites/${messageId}/accept`)
  }

  /**
   * 达人：拒绝/忽略代理商邀请
   */
  async rejectInvite(messageId: string): Promise<void> {
    await this.client.post(`/organizations/creator/invites/${messageId}/reject`)
  }

  /**
   * 代理商：接受品牌方邀请
   */
  async acceptBrandInvite(messageId: string): Promise<void> {
    await this.client.post(`/organizations/agency/brand-invites/${messageId}/accept`)
  }

  /**
   * 代理商：拒绝/忽略品牌方邀请
   */
  async rejectBrandInvite(messageId: string): Promise<void> {
    await this.client.post(`/organizations/agency/brand-invites/${messageId}/reject`)
  }

  // ==================== 健康检查 ====================

  /**
   * 健康检查
   */
  async healthCheck(): Promise<{ status: string; version: string }> {
    const response = await this.client.get('/health')
    return response.data
  }
}

// 单例导出
export const api = new ApiClient()

// 导出 Token 管理函数供其他模块使用
export { getAccessToken, clearTokens }

export default api
