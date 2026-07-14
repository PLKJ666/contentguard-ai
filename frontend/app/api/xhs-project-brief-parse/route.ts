import { NextRequest, NextResponse } from 'next/server'
import { resolveProxyAuthorization, resolveProxyTenantId } from '@/lib/server-proxy-auth'

const BACKEND_URL =
  process.env.API_REWRITE_TARGET ||
  process.env.API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  'http://localhost:8000'

export async function POST(req: NextRequest) {
  const authorization = await resolveProxyAuthorization(req)
  if (!authorization) {
    return NextResponse.json({ detail: '未登录或会话已失效，请重新登录后重试' }, { status: 401 })
  }

  const tenantId = resolveProxyTenantId(req)
  const body = await req.text()

  let backendResp: Response
  try {
    backendResp = await fetch(`${BACKEND_URL}/api/v1/xhs/projects/brief/parse`, {
      method: 'POST',
      headers: {
        'Authorization': authorization,
        ...(tenantId ? { 'X-Tenant-ID': tenantId } : {}),
        'Content-Type': 'application/json',
      },
      body,
      signal: AbortSignal.timeout(300_000),
    })
  } catch (error) {
    return NextResponse.json(
      { detail: `小红书 Brief 解析代理请求失败：${String(error)}` },
      { status: 502 }
    )
  }

  const data = await backendResp.json()
  return NextResponse.json(data, { status: backendResp.status })
}

export const maxDuration = 300
