import { describe, expect, it } from 'vitest'
import { resolveLogtoBaseUrl, type LogtoRequestLike } from './logtoBaseUrl'

function createRequest({
  host,
  forwardedHost,
  forwardedProto,
  protocol = 'http:',
}: {
  host?: string
  forwardedHost?: string
  forwardedProto?: string
  protocol?: string
}): LogtoRequestLike {
  const headers = new Headers()
  if (host) headers.set('host', host)
  if (forwardedHost) headers.set('x-forwarded-host', forwardedHost)
  if (forwardedProto) headers.set('x-forwarded-proto', forwardedProto)

  return {
    headers,
    nextUrl: { protocol },
  }
}

describe('resolveLogtoBaseUrl', () => {
  it('keeps the configured production base URL even when request host is different', () => {
    const request = createRequest({
      host: 'evil.example.com',
      forwardedHost: 'evil.example.com',
      forwardedProto: 'https',
      protocol: 'https:',
    })

    expect(resolveLogtoBaseUrl(request, 'https://contentguard.example.com', {
      nodeEnv: 'production',
      environment: 'production',
    })).toBe('https://contentguard.example.com')
  })

  it('allows localhost development requests to use the current local host', () => {
    const request = createRequest({
      host: 'dev.contentguard.local:3000',
      protocol: 'http:',
    })

    expect(resolveLogtoBaseUrl(request, 'http://localhost:3000', {
      nodeEnv: 'development',
      environment: 'development',
    })).toBe('http://dev.contentguard.local:3000')
  })

  it('uses forwarded local host in development when available', () => {
    const request = createRequest({
      host: 'localhost:3000',
      forwardedHost: 'dev.contentguard.local:3000',
      forwardedProto: 'http',
      protocol: 'http:',
    })

    expect(resolveLogtoBaseUrl(request, 'http://localhost:3000', {
      nodeEnv: 'development',
      environment: 'development',
    })).toBe('http://dev.contentguard.local:3000')
  })

  it('refuses non-local request hosts even in development', () => {
    const request = createRequest({
      host: 'example.com',
      forwardedProto: 'https',
      protocol: 'https:',
    })

    expect(resolveLogtoBaseUrl(request, 'http://localhost:3000', {
      nodeEnv: 'development',
      environment: 'development',
    })).toBe('http://localhost:3000')
  })
})
