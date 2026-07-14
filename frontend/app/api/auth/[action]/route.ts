import { NextRequest, NextResponse } from 'next/server'
import { Prompt } from '@logto/node'
import LogtoClient from '@logto/next/server-actions'
import { getLogtoConfig } from '@/lib/logto'
import { resolveLogtoBaseUrl } from '@/lib/logtoBaseUrl'

function firstHeaderValue(value: string | null): string | null {
  if (!value) return null
  return value.split(',')[0]?.trim() || null
}

function resolvePrompt(request: NextRequest): Prompt | undefined {
  const prompt = request.nextUrl.searchParams.get('prompt')
  return prompt === 'login' ? Prompt.Login : undefined
}

export async function GET(
  request: NextRequest,
  { params }: { params: { action: string } }
) {
  try {
    const { action } = params
    const logtoConfig = getLogtoConfig()
    const baseUrl = resolveLogtoBaseUrl(request, logtoConfig.baseUrl)
    const client = new LogtoClient({
      ...logtoConfig,
      baseUrl,
      cookieSecure: baseUrl.startsWith('https://'),
    })

    switch (action) {
      case 'sign-in': {
        const { url } = await client.handleSignIn({
          redirectUri: `${baseUrl}/api/auth/callback`,
          prompt: resolvePrompt(request),
        })
        return NextResponse.redirect(url, { status: 307 })
      }

      case 'sign-up': {
        const { url } = await client.handleSignIn({
          redirectUri: `${baseUrl}/api/auth/callback`,
          interactionMode: 'signUp',
        })
        return NextResponse.redirect(url, { status: 307 })
      }

      case 'callback': {
        try {
          const callbackRequestUrl = new URL(request.url)
          const normalizedCallbackUrl = new URL(
            `${callbackRequestUrl.pathname}${callbackRequestUrl.search}`,
            `${baseUrl}/`,
          )
          const redirectTo = await client.handleSignInCallback(normalizedCallbackUrl.toString())
          return NextResponse.redirect(new URL(redirectTo || '/auth/post-login', baseUrl), { status: 303 })
        } catch (error) {
          const url = new URL(request.url)
          const errorParam = url.searchParams.get('error')
          const errorDesc = url.searchParams.get('error_description')
          console.error('Logto callback error:', {
            error: String(error),
            errorParam,
            errorDesc,
            callbackUrl: request.url,
            normalizedCallbackUrl: (() => {
              try {
                const callbackRequestUrl = new URL(request.url)
                return new URL(
                  `${callbackRequestUrl.pathname}${callbackRequestUrl.search}`,
                  `${baseUrl}/`,
                ).toString()
              } catch {
                return null
              }
            })(),
          })
          const message = errorDesc || errorParam || String(error)
          return new Response(
            `<html><body style="background:#0B0B0E;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh">
              <div style="text-align:center;max-width:500px">
                <h2>登录回调失败</h2>
                <p style="color:#E85A4F">${message}</p>
                <a href="/login" style="color:#6366F1">返回登录</a>
              </div>
            </body></html>`,
            { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          )
        }
      }

      case 'sign-out': {
        const url = await client.handleSignOut(`${baseUrl}`)
        return NextResponse.redirect(url, { status: 307 })
      }

      default:
        return new Response('Not Found', { status: 404 })
    }
  } catch (error) {
    console.error('Logto auth route error:', {
      error: String(error),
      requestUrl: request.url,
      host: firstHeaderValue(request.headers.get('host')),
      forwardedHost: firstHeaderValue(request.headers.get('x-forwarded-host')),
      forwardedProto: firstHeaderValue(request.headers.get('x-forwarded-proto')),
    })
    return new Response(
      `<html><body style="background:#0B0B0E;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh">
        <div style="text-align:center;max-width:560px">
          <h2>登录初始化失败</h2>
          <p style="color:#E85A4F">${String(error)}</p>
          <a href="/login" style="color:#6366F1">返回登录</a>
        </div>
      </body></html>`,
      { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  }
}
