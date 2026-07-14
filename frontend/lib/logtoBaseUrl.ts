type HeaderGetter = {
  get(name: string): string | null
}

export type LogtoRequestLike = {
  headers: HeaderGetter
  nextUrl: {
    protocol: string
  }
}

type ResolveLogtoBaseUrlOptions = {
  environment?: string
  nodeEnv?: string
  trustRequestHost?: boolean
}

function firstHeaderValue(value: string | null): string | null {
  if (!value) return null
  return value.split(',')[0]?.trim() || null
}

function normalizeUrl(url: string): string {
  return url.replace(/\/$/, '')
}

function safeParseUrl(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return false
  }

  const [first, second] = parts
  return (
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  )
}

function isLocalishHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized.endsWith('.local') ||
    isPrivateIpv4(normalized)
  )
}

function getHostHostname(host: string): string {
  try {
    return new URL(`http://${host}`).hostname
  } catch {
    return host.split(':')[0] || host
  }
}

function shouldTrustRequestHost(
  configuredUrl: URL | null,
  options: ResolveLogtoBaseUrlOptions = {},
): boolean {
  if (typeof options.trustRequestHost === 'boolean') {
    return options.trustRequestHost
  }

  const envOverride = process.env.LOGTO_TRUST_REQUEST_HOST?.toLowerCase()
  if (envOverride === 'true') return true
  if (envOverride === 'false') return false

  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? ''
  const environment = options.environment ?? process.env.ENVIRONMENT ?? ''
  const isProductionLike = nodeEnv === 'production' || environment === 'production'
  if (isProductionLike) return false

  return Boolean(configuredUrl && isLocalishHostname(configuredUrl.hostname))
}

export function resolveLogtoBaseUrl(
  request: LogtoRequestLike,
  configuredBaseUrl: string,
  options: ResolveLogtoBaseUrlOptions = {},
): string {
  const normalizedConfiguredBaseUrl = normalizeUrl(configuredBaseUrl)
  const configuredUrl = safeParseUrl(normalizedConfiguredBaseUrl)

  if (!shouldTrustRequestHost(configuredUrl, options)) {
    return normalizedConfiguredBaseUrl
  }

  const forwardedHost = firstHeaderValue(request.headers.get('x-forwarded-host'))
  const host = forwardedHost || firstHeaderValue(request.headers.get('host'))
  if (!host) {
    return normalizedConfiguredBaseUrl
  }

  const requestHostname = getHostHostname(host)
  if (!isLocalishHostname(requestHostname)) {
    return normalizedConfiguredBaseUrl
  }

  const forwardedProto = firstHeaderValue(request.headers.get('x-forwarded-proto'))
  const requestProtocol =
    forwardedProto ||
    request.nextUrl.protocol.replace(':', '') ||
    configuredUrl?.protocol.replace(':', '') ||
    'http'

  const protocol = requestProtocol === 'https' ? 'https' : 'http'
  return normalizeUrl(`${protocol}://${host}`)
}

