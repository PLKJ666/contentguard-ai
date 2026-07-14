import { LogtoNextConfig } from '@logto/next'

// Logto 配置是强环境绑定的：
// - 本地开发一套 Application / 回调地址
// - 测试或预发布一套 Application / 回调地址
// - 生产一套 Application / 回调地址
// 不要混用 App ID / App Secret / Redirect URI，否则最容易出现“本地能登、线上回调失败”。
const buildTimeLogtoEnv = {
  endpoint: process.env.LOGTO_ENDPOINT,
  appId: process.env.LOGTO_APP_ID,
  appSecret: process.env.LOGTO_APP_SECRET,
  cookieSecret: process.env.LOGTO_COOKIE_SECRET,
  apiResource: process.env.LOGTO_API_RESOURCE,
} as const

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] || fallback
  if (!value) {
    throw new Error(
      `[logto] Missing required env \`${name}\`. ` +
        `Each environment (local/staging/production) must use its own Logto Application, ` +
        `matching Redirect URIs, and its own LOGTO_* envs before build/start.`
    )
  }
  return value
}

function resolveConfiguredBaseUrl(): string {
  // 这里必须拿“当前环境真实对外访问地址”。
  // 它需要和当前环境对应 Logto Application 上配置的 Redirect URI / Post-logout URI 对齐。
  const baseUrl = process.env.LOGTO_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
  return baseUrl.replace(/\/$/, '')
}

export function getLogtoConfig(): LogtoNextConfig {
  const baseUrl = resolveConfiguredBaseUrl()

  return {
    endpoint: requireEnv('LOGTO_ENDPOINT', buildTimeLogtoEnv.endpoint),
    appId: requireEnv('LOGTO_APP_ID', buildTimeLogtoEnv.appId),
    appSecret: requireEnv('LOGTO_APP_SECRET', buildTimeLogtoEnv.appSecret),
    baseUrl,
    cookieSecure: baseUrl.startsWith('https'),
    cookieSecret: requireEnv('LOGTO_COOKIE_SECRET', buildTimeLogtoEnv.cookieSecret),
    resources: [requireEnv('LOGTO_API_RESOURCE', buildTimeLogtoEnv.apiResource)],
    scopes: ['openid', 'profile', 'email'],
  }
}
