import { NextRequest, NextResponse } from 'next/server'
import { resolveProxyAuthorization, resolveProxyTenantId } from '@/lib/server-proxy-auth'

/**
 * Brief AI 解析代理路由
 *
 * Next.js rewrites 代理默认超时 30 秒，不够 AI 解析用。
 * 这个 Route Handler 手动代理到后端，支持 5 分钟超时。
 */

const BACKEND_URL = process.env.API_REWRITE_TARGET || process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const authorization = await resolveProxyAuthorization(req)
  if (!authorization) {
    return NextResponse.json({ detail: '未登录或会话已失效，请重新登录后重试' }, { status: 401 })
  }
  const tenantId = resolveProxyTenantId(req)

  let backendResp: Response
  try {
    backendResp = await fetch(
      `${BACKEND_URL}/api/v1/projects/${projectId}/brief/parse`,
      {
        method: 'POST',
        headers: {
          'Authorization': authorization,
          ...(tenantId ? { 'X-Tenant-ID': tenantId } : {}),
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(300_000), // 5 分钟
      }
    )
  } catch (error) {
    return NextResponse.json(
      { detail: `Brief 解析代理请求失败：${String(error)}` },
      { status: 502 }
    )
  }

  const data = await backendResp.json()
  return NextResponse.json(data, { status: backendResp.status })
}

// Next.js Route Segment Config: 最大执行时长 5 分钟
export const maxDuration = 300
