'use client'

const FORCE_FRESH_SIGN_IN_KEY = 'contentguard_force_fresh_sign_in'

export function markForceFreshSignIn(): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(FORCE_FRESH_SIGN_IN_KEY, '1')
}

export function getSignUpUrl(): string {
  return '/api/auth/sign-up'
}

export function getSignInUrl(): string {
  if (typeof window === 'undefined') {
    return '/api/auth/sign-in'
  }

  const shouldForceFreshSignIn =
    window.localStorage.getItem(FORCE_FRESH_SIGN_IN_KEY) === '1'

  if (shouldForceFreshSignIn) {
    window.localStorage.removeItem(FORCE_FRESH_SIGN_IN_KEY)
    return '/api/auth/sign-in?prompt=login'
  }

  return '/api/auth/sign-in'
}
