import { NextRequest, NextResponse } from 'next/server'
import { resolveProxyAuthorization, resolveProxyTenantId } from '@/lib/server-proxy-auth'

const BACKEND_URL =
  process.env.API_REWRITE_TARGET ||
  process.env.API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  'http://localhost:8000'

function limitMessage(value: string, fallback: string) {
  const normalized = value.trim()
  if (!normalized) return fallback
  return normalized.slice(0, 160)
}

function normalizeForwardedValue(value: string | null) {
  return value?.split(',')[0]?.trim() || ''
}

function resolvePublicBaseUrl(req: NextRequest) {
  const configuredBaseUrl = process.env.NEXT_PUBLIC_BASE_URL?.trim()
  if (configuredBaseUrl) {
    return configuredBaseUrl.replace(/\/+$/, '')
  }

  const host =
    normalizeForwardedValue(req.headers.get('x-forwarded-host')) ||
    normalizeForwardedValue(req.headers.get('host')) ||
    req.nextUrl.host
  const proto =
    normalizeForwardedValue(req.headers.get('x-forwarded-proto')) ||
    req.nextUrl.protocol.replace(/:$/, '') ||
    'http'

  return `${proto}://${host}`.replace(/\/+$/, '')
}

function buildRedirectUrl(
  req: NextRequest,
  taskId: string,
  status: 'success' | 'error',
  message: string,
) {
  const url = new URL(`/creator/task/${encodeURIComponent(taskId)}`, `${resolvePublicBaseUrl(req)}/`)
  url.searchParams.set('upload_status', status)
  url.searchParams.set('upload_kind', 'video')
  url.searchParams.set('upload_message', limitMessage(message, status === 'success' ? '视频已上传' : '上传失败'))
  url.searchParams.set('upload_ts', String(Date.now()))
  return url
}

function prefersJson(req: NextRequest) {
  const requestedMode = req.nextUrl.searchParams.get('response')?.trim()
  if (requestedMode === 'json') return true
  return req.headers.get('accept')?.includes('application/json') ?? false
}

function buildJsonResponse(
  status: 'success' | 'error',
  message: string,
  redirectUrl?: string,
  httpStatus = status === 'success' ? 200 : 400,
) {
  return NextResponse.json(
    {
      status,
      message: limitMessage(message, status === 'success' ? '视频已上传' : '上传失败'),
      redirect_url: redirectUrl || '',
    },
    { status: httpStatus },
  )
}

function buildFallbackPageUrl(req: NextRequest, taskId?: string) {
  const referer = req.headers.get('referer')
  if (referer) {
    try {
      const refererUrl = new URL(referer)
      const currentBaseUrl = new URL(resolvePublicBaseUrl(req))
      if (refererUrl.origin === currentBaseUrl.origin) {
        return refererUrl
      }
    } catch {
      // ignore malformed referer and fall back to known pages
    }
  }

  const pathname = taskId
    ? `/creator/task/${encodeURIComponent(taskId)}`
    : '/creator'
  return new URL(pathname, `${resolvePublicBaseUrl(req)}/`)
}

function redirectToTaskPage(
  req: NextRequest,
  taskId: string,
  status: 'success' | 'error',
  message: string,
) {
  if (prefersJson(req)) {
    return buildJsonResponse(status, message, buildRedirectUrl(req, taskId, status, message).toString())
  }
  return NextResponse.redirect(buildRedirectUrl(req, taskId, status, message), 303)
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const raw = await response.text()
  if (!raw) return null

  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function extractResponseDetail(data: unknown, fallback: string) {
  if (typeof data === 'string' && data.trim()) {
    return limitMessage(data, fallback)
  }

  if (data && typeof data === 'object' && 'detail' in data && typeof data.detail === 'string') {
    return limitMessage(data.detail, fallback)
  }

  return fallback
}

type UploadedVideoResult = {
  url?: string
  file_name?: string
  file_size?: number
  file_type?: string
  thumbnail_url?: string
  duration?: number
}

async function submitUploadedVideo(
  req: NextRequest,
  authorization: string,
  taskId: string,
  tenantId: string,
  result: UploadedVideoResult,
  fallbackFileName: string,
) {
  if (!result.url) {
    return redirectToTaskPage(req, taskId, 'error', '上传返回缺少文件地址，请重试')
  }

  let submitResp: Response
  try {
    submitResp = await fetch(`${BACKEND_URL}/api/v1/tasks/${encodeURIComponent(taskId)}/video`, {
      method: 'POST',
      headers: {
        'Authorization': authorization,
        'Content-Type': 'application/json',
        ...(tenantId ? { 'X-Tenant-ID': tenantId } : {}),
      },
      body: JSON.stringify({
        file_url: result.url,
        file_name: result.file_name || fallbackFileName,
        duration: typeof result.duration === 'number' ? result.duration : undefined,
        thumbnail_url: result.thumbnail_url,
      }),
      signal: AbortSignal.timeout(180_000),
    })
  } catch (error) {
    console.error('Native task video submit failed:', error)
    return redirectToTaskPage(req, taskId, 'error', '视频已上传，但提交任务失败，请重试')
  }

  const submitData = await parseJsonResponse(submitResp)
  console.info('task-video-upload-form: task submit responded', {
    taskId,
    status: submitResp.status,
    ok: submitResp.ok,
  })
  if (!submitResp.ok) {
    return redirectToTaskPage(
      req,
      taskId,
      'error',
      extractResponseDetail(submitData, `任务提交失败（HTTP ${submitResp.status}）`),
    )
  }

  return redirectToTaskPage(req, taskId, 'success', '视频已上传，正在启动 AI 审核')
}

async function handleStreamedMultipartUpload(
  req: NextRequest,
  authorization: string,
  taskId: string,
  tenantId: string,
  contentType: string,
) {
  if (!req.body) {
    return redirectToTaskPage(req, taskId, 'error', '请选择要上传的视频文件')
  }

  let uploadResp: Response
  try {
    uploadResp = await fetch(`${BACKEND_URL}/api/v1/upload/proxy`, {
      method: 'POST',
      headers: {
        'Authorization': authorization,
        ...(tenantId ? { 'X-Tenant-ID': tenantId } : {}),
        'Content-Type': contentType,
      },
      body: req.body,
      duplex: 'half',
      signal: AbortSignal.timeout(600_000),
    } as RequestInit & { duplex: 'half' })
  } catch (error) {
    console.error('Native task video upload failed:', error)
    return redirectToTaskPage(req, taskId, 'error', '视频上传失败，请检查网络后重试')
  }

  const uploadData = await parseJsonResponse(uploadResp)
  console.info('task-video-upload-form: upload proxy responded', {
    taskId,
    status: uploadResp.status,
    ok: uploadResp.ok,
    mode: 'stream',
  })
  if (!uploadResp.ok) {
    return redirectToTaskPage(
      req,
      taskId,
      'error',
      extractResponseDetail(uploadData, `视频上传失败（HTTP ${uploadResp.status}）`),
    )
  }

  if (!uploadData || typeof uploadData !== 'object') {
    return redirectToTaskPage(req, taskId, 'error', '上传返回格式异常，请重试')
  }

  return submitUploadedVideo(req, authorization, taskId, tenantId, uploadData as UploadedVideoResult, '已上传视频')
}

async function handleLegacyMultipartUpload(
  req: NextRequest,
  authorization: string,
  incoming: FormData,
  taskId: string,
  tenantId: string,
) {
  const file = incoming.get('file')
  if (!(file instanceof File)) {
    return redirectToTaskPage(req, taskId, 'error', '请选择要上传的视频文件')
  }

  console.info('task-video-upload-form: form parsed', {
    taskId,
    tenantId,
    hasFile: true,
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type,
    mode: 'legacy',
  })

  const uploadForm = new FormData()
  uploadForm.append('file', file, file.name)
  uploadForm.append('file_type', 'video')

  let uploadResp: Response
  try {
    uploadResp = await fetch(`${BACKEND_URL}/api/v1/upload/proxy`, {
      method: 'POST',
      headers: {
        'Authorization': authorization,
        ...(tenantId ? { 'X-Tenant-ID': tenantId } : {}),
      },
      body: uploadForm,
      signal: AbortSignal.timeout(600_000),
    })
  } catch (error) {
    console.error('Native task video upload failed:', error)
    return redirectToTaskPage(req, taskId, 'error', '视频上传失败，请检查网络后重试')
  }

  const uploadData = await parseJsonResponse(uploadResp)
  console.info('task-video-upload-form: upload proxy responded', {
    taskId,
    status: uploadResp.status,
    ok: uploadResp.ok,
    mode: 'legacy',
  })
  if (!uploadResp.ok) {
    return redirectToTaskPage(
      req,
      taskId,
      'error',
      extractResponseDetail(uploadData, `视频上传失败（HTTP ${uploadResp.status}）`),
    )
  }

  if (!uploadData || typeof uploadData !== 'object') {
    return redirectToTaskPage(req, taskId, 'error', '上传返回格式异常，请重试')
  }

  return submitUploadedVideo(req, authorization, taskId, tenantId, uploadData as UploadedVideoResult, file.name)
}

export async function POST(req: NextRequest) {
  console.info('task-video-upload-form: request started', {
    contentLength: req.headers.get('content-length'),
    contentType: req.headers.get('content-type'),
    userAgent: req.headers.get('user-agent'),
  })

  const queryTaskId = req.nextUrl.searchParams.get('task_id')?.trim() || ''
  const queryTenantId = req.nextUrl.searchParams.get('tenant_id')?.trim() || ''
  const contentType = req.headers.get('content-type') || ''
  const taskId = queryTaskId
  const tenantId = queryTenantId || resolveProxyTenantId(req) || ''

  if (!taskId) {
    const incoming = await req.formData()
    const legacyTaskId = String(incoming.get('task_id') || '').trim()
    const legacyTenantId = String(incoming.get('tenant_id') || '').trim() || resolveProxyTenantId(req) || ''
    if (!legacyTaskId) {
      if (prefersJson(req)) {
        return buildJsonResponse('error', '缺少任务 ID', '', 400)
      }
      return new NextResponse('缺少任务 ID', { status: 400 })
    }

    const authorization = await resolveProxyAuthorization(req)
    if (!authorization) {
      return redirectToTaskPage(req, legacyTaskId, 'error', '登录已失效，请重新登录后重试')
    }

    return handleLegacyMultipartUpload(req, authorization, incoming, legacyTaskId, legacyTenantId)
  }

  const authorization = await resolveProxyAuthorization(req)
  if (!authorization) {
    return redirectToTaskPage(req, taskId, 'error', '登录已失效，请重新登录后重试')
  }

  return handleStreamedMultipartUpload(req, authorization, taskId, tenantId, contentType)
}

export async function GET(req: NextRequest) {
  const taskId = req.nextUrl.searchParams.get('task_id')?.trim() || ''
  const url = buildFallbackPageUrl(req, taskId)
  if (taskId) {
    url.searchParams.set('upload_status', 'error')
    url.searchParams.set('upload_kind', 'video')
    url.searchParams.set('upload_message', '页面跳转异常，请重新选择视频后再提交')
    url.searchParams.set('upload_ts', String(Date.now()))
  }
  return NextResponse.redirect(url, 303)
}

export const maxDuration = 600
export const runtime = 'nodejs'
