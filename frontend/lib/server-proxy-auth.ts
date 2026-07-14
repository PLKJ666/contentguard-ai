import { getAccessToken as getLogtoAccessToken } from '@logto/next/server-actions'
import type { NextRequest } from 'next/server'
import { getLogtoConfig } from '@/lib/logto'

function normalizeHeaderValue(value: string | null): string | null {
  const normalized = value?.trim()
  return normalized || null
}

export function resolveProxyTenantId(request: NextRequest): string | null {
  return (
    normalizeHeaderValue(request.nextUrl.searchParams.get('tenant_id')) ||
    normalizeHeaderValue(request.headers.get('x-tenant-id'))
  )
}

export async function resolveProxyAuthorization(request: NextRequest): Promise<string | null> {
  const forwardedAuthorization = normalizeHeaderValue(request.headers.get('authorization'))
  if (forwardedAuthorization) {
    return forwardedAuthorization
  }

  try {
    const logtoConfig = getLogtoConfig()
    const resource = logtoConfig.resources?.[0]
    const accessToken = await getLogtoAccessToken(logtoConfig, resource)
    return accessToken ? `Bearer ${accessToken}` : null
  } catch (error) {
    console.error('Failed to resolve proxy authorization from session:', String(error))
    return null
  }
}
