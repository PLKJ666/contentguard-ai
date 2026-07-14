import { NextRequest, NextResponse } from 'next/server'
import { resolveProxyAuthorization, resolveProxyTenantId } from '@/lib/server-proxy-auth'

const BACKEND_URL =
  process.env.API_REWRITE_TARGET ||
  process.env.API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  'http://localhost:8000'

function decodeUploadValue(value: string | null): string | null {
  if (!value) return null
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function encodeHeaderSafeValue(value: string): string {
  return encodeURIComponent(value)
}

export async function POST(req: NextRequest) {
  const authorization = await resolveProxyAuthorization(req)
  if (!authorization) {
    return NextResponse.json({ detail: '未登录或会话已失效，请重新登录后重试' }, { status: 401 })
  }

  const fileName =
    decodeUploadValue(req.nextUrl.searchParams.get('file_name')) ||
    decodeUploadValue(req.headers.get('x-upload-file-name'))
  const fileType =
    decodeUploadValue(req.nextUrl.searchParams.get('file_type')) ||
    decodeUploadValue(req.headers.get('x-upload-file-type')) ||
    'general'
  const tenantId = resolveProxyTenantId(req)

  if (!fileName) {
    return NextResponse.json({ detail: '缺少上传文件名' }, { status: 400 })
  }

  if (!req.body) {
    return NextResponse.json({ detail: '上传文件为空' }, { status: 400 })
  }

  let backendResp: Response
  try {
    backendResp = await fetch(`${BACKEND_URL}/api/v1/upload/proxy-binary`, {
      method: 'POST',
      headers: {
        'Authorization': authorization,
        ...(tenantId ? { 'X-Tenant-ID': tenantId } : {}),
        'Content-Type': req.headers.get('content-type') || 'application/octet-stream',
        // Forward an ASCII-safe header value. The backend already decodes it.
        'X-Upload-File-Name': encodeHeaderSafeValue(fileName),
        'X-Upload-File-Type': fileType,
      },
      body: req.body,
      duplex: 'half',
      signal: AbortSignal.timeout(300_000),
    } as RequestInit & { duplex: 'half' })
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
export const runtime = 'nodejs'
