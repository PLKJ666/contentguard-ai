import { NextRequest } from 'next/server'
import { getAccessToken, getLogtoContext } from '@logto/next/server-actions'
import { getLogtoConfig } from '@/lib/logto'
import { resolveLogtoBaseUrl } from '@/lib/logtoBaseUrl'

function firstHeaderValue(value: string | null): string | null {
  if (!value) return null
  return value.split(',')[0]?.trim() || null
}

export async function GET(request: NextRequest) {
  try {
    const logtoConfig = getLogtoConfig()
    const baseUrl = resolveLogtoBaseUrl(request, logtoConfig.baseUrl)
    const config = {
      ...logtoConfig,
      baseUrl,
      cookieSecure: baseUrl.startsWith('https://'),
    }

    const context = await getLogtoContext(config)
    if (!context.isAuthenticated) {
      return Response.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const resource = config.resources?.[0]
    const accessToken = resource ? await getAccessToken(config, resource) : undefined

    if (!accessToken) {
      return Response.json({ error: 'Not authenticated' }, { status: 401 })
    }

    return Response.json({
      access_token: accessToken,
    })
  } catch (error) {
    console.error('Logto token route error:', {
      error: String(error),
      requestUrl: request.url,
      host: firstHeaderValue(request.headers.get('host')),
      forwardedHost: firstHeaderValue(request.headers.get('x-forwarded-host')),
      forwardedProto: firstHeaderValue(request.headers.get('x-forwarded-proto')),
    })
    return Response.json({
      error: 'Auth route initialization failed',
      detail: String(error),
    }, { status: 500 })
  }
}
