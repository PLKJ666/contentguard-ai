import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

function isSafari(userAgent: string) {
  return /Safari/i.test(userAgent) && !/Chrome|Chromium|CriOS|EdgiOS|FxiOS|Android/i.test(userAgent)
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (!pathname.endsWith('/video')) {
    return NextResponse.next()
  }

  const userAgent = request.headers.get('user-agent') || ''
  if (!isSafari(userAgent)) {
    return NextResponse.next()
  }

  const targetUrl = request.nextUrl.clone()
  targetUrl.pathname = pathname.replace(/^\/creator\/task\/([^/]+)\/video$/, '/native-upload/task/$1')
  return NextResponse.redirect(targetUrl, 307)
}

export const config = {
  matcher: ['/creator/task/:id/video'],
}
