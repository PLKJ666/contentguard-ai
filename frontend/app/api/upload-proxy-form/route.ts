import { NextRequest, NextResponse } from 'next/server'
import { resolveProxyAuthorization, resolveProxyTenantId } from '@/lib/server-proxy-auth'

const BACKEND_URL =
  process.env.API_REWRITE_TARGET ||
  process.env.API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  'http://localhost:8000'

const MESSAGE_SOURCE = 'contentguard-native-upload'

function buildIframeResponse(payload: Record<string, unknown>) {
  const serialized = JSON.stringify(payload).replace(/</g, '\\u003c')

  return new NextResponse(
    `<!doctype html><html><body><script>(function(){var payload=${serialized};try{if(window.parent&&window.parent!==window){window.parent.postMessage(payload,window.location.origin)}}catch(e){}document.body.textContent=payload.ok?'upload-complete':'upload-failed'})();</script></body></html>`,
    {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    },
  )
}

export async function POST(req: NextRequest) {
  const requestId =
    String(req.nextUrl.searchParams.get('client_request_id') || req.headers.get('x-client-request-id') || '').trim()
  const fail = (detail: string, status = 500) =>
    buildIframeResponse({
      source: MESSAGE_SOURCE,
      requestId,
      ok: false,
      error: detail,
      status,
    })

  const authorization = await resolveProxyAuthorization(req)
  if (!authorization) {
    return fail('未登录或会话已失效，请重新登录后重试', 401)
  }

  const tenantId = resolveProxyTenantId(req)
  const contentType = req.headers.get('content-type') || ''
  if (!req.body || !contentType) {
    return fail('未检测到上传文件', 400)
  }

  let backendResp: Response
  try {
    backendResp = await fetch(`${BACKEND_URL}/api/v1/upload/proxy`, {
      method: 'POST',
      headers: {
        'Authorization': authorization,
        ...(tenantId ? { 'X-Tenant-ID': tenantId } : {}),
        'Content-Type': contentType,
      },
      body: req.body,
      duplex: 'half',
      signal: AbortSignal.timeout(300_000),
    } as RequestInit & { duplex: 'half' })
  } catch (error) {
    return fail(`上传代理请求失败：${String(error)}`, 502)
  }

  const raw = await backendResp.text()
  let data: unknown = null
  try {
    data = raw ? JSON.parse(raw) : null
  } catch {
    data = null
  }

  if (!backendResp.ok) {
    const detail =
      data && typeof data === 'object' && 'detail' in data && typeof data.detail === 'string'
        ? data.detail
        : raw || `上传失败（HTTP ${backendResp.status}）`
    return fail(detail, backendResp.status)
  }

  if (!data || typeof data !== 'object') {
    return fail('上传返回格式异常，请重试', 502)
  }

  return buildIframeResponse({
    source: MESSAGE_SOURCE,
    requestId,
    ok: true,
    result: data,
    status: backendResp.status,
  })
}

export const maxDuration = 300
export const runtime = 'nodejs'
