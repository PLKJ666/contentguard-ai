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
  const incoming = await req.formData()
  const file = incoming.get('file')
  const fileType = String(incoming.get('file_type') || 'general')

  if (!(file instanceof File)) {
    return NextResponse.json({ detail: '未检测到上传文件' }, { status: 400 })
  }

  const outgoing = new FormData()
  outgoing.append('file', file, file.name)
  outgoing.append('file_type', fileType)

  let backendResp: Response
  try {
    backendResp = await fetch(`${BACKEND_URL}/api/v1/upload/proxy`, {
      method: 'POST',
      headers: {
        'Authorization': authorization,
        ...(tenantId ? { 'X-Tenant-ID': tenantId } : {}),
      },
      body: outgoing,
      signal: AbortSignal.timeout(300_000),
    })
  } catch (error) {
    return NextResponse.json(
      { detail: `上传代理请求失败：${String(error)}` },
      { status: 502 }
    )
  }

  const raw = await backendResp.text()
  try {
    return NextResponse.json(JSON.parse(raw), { status: backendResp.status })
  } catch {
    return NextResponse.json(
      { detail: raw || `上传失败（HTTP ${backendResp.status}）` },
      { status: backendResp.status }
    )
  }
}

export const maxDuration = 300
