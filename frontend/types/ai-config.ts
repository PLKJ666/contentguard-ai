/**
 * AI 配置类型定义
 * 与后端 schemas/ai_config.py 对齐
 */

export type AIProvider =
  | 'oneapi'
  | 'openrouter'
  | 'anthropic'
  | 'openai'
  | 'deepseek'
  | 'qwen'
  | 'doubao'
  | 'zhipu'
  | 'moonshot'

export interface AIModelsConfig {
  text: string
  vision?: string
  audio?: string
  xhs_split?: string
  xhs_editor?: string
  xhs_verifier?: string
}

export interface AIParametersConfig {
  temperature: number
  max_tokens: number
}

// ===== 请求 =====

export interface AIConfigUpdate {
  provider: AIProvider
  base_url: string
  api_key: string
  models: AIModelsConfig
  parameters: AIParametersConfig
}

export interface GetModelsRequest {
  provider: AIProvider
  base_url: string
  api_key: string
}

export interface TestConnectionRequest {
  provider: AIProvider
  base_url: string
  api_key: string
  models: AIModelsConfig
}

// ===== 响应 =====

export interface AIConfigResponse {
  provider: string
  base_url: string
  api_key_masked: string
  models: AIModelsConfig
  parameters: AIParametersConfig
  available_models: Record<string, ModelInfo[]>
  is_configured: boolean
  last_test_at?: string | null
  last_test_result?: Record<string, unknown> | null
}

export interface ModelInfo {
  id: string
  name: string
}

export interface ModelsListResponse {
  success: boolean
  models: Record<string, ModelInfo[]>
  error?: string | null
}

export interface ModelTestResult {
  success: boolean
  latency_ms?: number | null
  error?: string | null
  model: string
}

export interface ConnectionTestResponse {
  success: boolean
  results: Record<string, ModelTestResult>
  message: string
}
