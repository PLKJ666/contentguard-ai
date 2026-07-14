/**
 * AuthContext Unit Tests
 *
 * Tests the AuthProvider and useAuth hook.
 * Covers: initial state, Logto session check, logout, switchRole, setUserDirect.
 */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Use vi.hoisted to create mock functions before vi.mock hoisting
// ---------------------------------------------------------------------------

const { mockSetAccessToken, mockGetMe, mockClearTokens, mockSetTenantId } = vi.hoisted(() => ({
  mockSetAccessToken: vi.fn(),
  mockGetMe: vi.fn(),
  mockClearTokens: vi.fn(),
  mockSetTenantId: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: {
    setAccessToken: mockSetAccessToken,
    getMe: mockGetMe,
    setTenantId: mockSetTenantId,
  },
  clearTokens: mockClearTokens,
  extractErrorMessage: vi.fn((e: Error) => e.message),
}))

// ---------------------------------------------------------------------------
// Import AuthContext after mocks are set up
// ---------------------------------------------------------------------------
import { AuthProvider, useAuth } from './AuthContext'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockLocalStorage() {
  const store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      Object.keys(store).forEach((k) => delete store[k])
    }),
    get length() {
      return Object.keys(store).length
    },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
  }
}

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuthContext', () => {
  let storage: ReturnType<typeof mockLocalStorage>
  beforeEach(() => {
    storage = mockLocalStorage()
    Object.defineProperty(window, 'localStorage', { value: storage, writable: true })
    vi.clearAllMocks()
    // Mock fetch for /api/auth/token
    global.fetch = vi.fn()
  })

  afterEach(() => {
    storage.clear()
    vi.restoreAllMocks()
  })

  // ---- Initial state ----

  describe('initial state', () => {
    it('starts with user as null when no Logto session', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 401,
      })

      const { result } = renderHook(() => useAuth(), { wrapper })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.user).toBeNull()
      expect(result.current.isAuthenticated).toBe(false)
    })

    it('sets user from Logto session on mount', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'logto-at-123' }),
      })

      mockGetMe.mockResolvedValueOnce({
        needs_onboarding: false,
        id: 'u1',
        email: 'test@example.com',
        name: 'Test User',
        role: 'brand',
        is_verified: true,
        tenant_id: 'BR000001',
        tenant_name: 'Test Brand',
      })

      const { result } = renderHook(() => useAuth(), { wrapper })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(mockSetAccessToken).toHaveBeenCalledWith('logto-at-123')
      expect(result.current.user).not.toBeNull()
      expect(result.current.user?.name).toBe('Test User')
      expect(result.current.user?.role).toBe('brand')
      expect(result.current.isAuthenticated).toBe(true)
      expect(mockSetTenantId).toHaveBeenCalledWith('BR000001')
    })

    it('stays null when user needs onboarding', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'logto-at-new' }),
      })

      mockGetMe.mockResolvedValueOnce({
        needs_onboarding: true,
        logto_sub: 'sub-123',
        email: 'new@example.com',
      })

      const { result } = renderHook(() => useAuth(), { wrapper })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.user).toBeNull()
      expect(result.current.isAuthenticated).toBe(false)
    })
  })

  // ---- Logout ----

  describe('logout', () => {
    it('clears user state, tokens, and redirects to sign-out', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'logto-at' }),
      })

      mockGetMe.mockResolvedValueOnce({
        needs_onboarding: false,
        id: 'u1',
        email: 'test@example.com',
        name: 'Test',
        role: 'brand',
        is_verified: true,
      })

      // Mock window.location.href setter
      const hrefSetter = vi.fn()
      Object.defineProperty(window, 'location', {
        value: { ...window.location, href: '' },
        writable: true,
      })
      Object.defineProperty(window.location, 'href', {
        set: hrefSetter,
        get: () => '',
      })

      const { result } = renderHook(() => useAuth(), { wrapper })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
        expect(result.current.user).not.toBeNull()
      })

      act(() => {
        result.current.logout()
      })

      expect(result.current.user).toBeNull()
      expect(result.current.isAuthenticated).toBe(false)
      expect(mockClearTokens).toHaveBeenCalled()
      expect(storage.removeItem).toHaveBeenCalledWith('contentguard_user')
      expect(hrefSetter).toHaveBeenCalledWith('/api/auth/sign-out')
    })
  })

  // ---- switchRole ----

  describe('switchRole', () => {
    it('updates the user role and persists to localStorage', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'logto-at' }),
      })

      mockGetMe.mockResolvedValueOnce({
        needs_onboarding: false,
        id: 'u1',
        email: 'multi@test.com',
        name: 'Multi Role',
        role: 'brand',
        is_verified: true,
      })

      const { result } = renderHook(() => useAuth(), { wrapper })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
        expect(result.current.user).not.toBeNull()
      })

      expect(result.current.user?.role).toBe('brand')

      act(() => {
        result.current.switchRole('agency')
      })

      expect(result.current.user?.role).toBe('agency')
      const storedCalls = storage.setItem.mock.calls.filter(
        ([key]: [string, string]) => key === 'contentguard_user'
      )
      const lastStored = JSON.parse(storedCalls[storedCalls.length - 1][1])
      expect(lastStored.role).toBe('agency')
    })

    it('does nothing when no user is logged in', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 401,
      })

      const { result } = renderHook(() => useAuth(), { wrapper })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      act(() => {
        result.current.switchRole('creator')
      })

      expect(result.current.user).toBeNull()
    })
  })

  // ---- setUserDirect ----

  describe('setUserDirect', () => {
    it('sets user directly and persists to localStorage', async () => {
      ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 401,
      })

      const { result } = renderHook(() => useAuth(), { wrapper })

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      const userData = {
        id: 'u2',
        email: 'direct@test.com',
        name: 'Direct User',
        role: 'creator' as const,
        is_verified: true,
        tenant_id: 'BR000002',
        tenant_name: 'Brand 2',
      }

      act(() => {
        result.current.setUserDirect(userData)
      })

      expect(result.current.user).toEqual(userData)
      expect(result.current.isAuthenticated).toBe(true)
      expect(mockSetTenantId).toHaveBeenCalledWith('BR000002')
      expect(storage.setItem).toHaveBeenCalledWith(
        'contentguard_user',
        expect.stringContaining('Direct User')
      )
    })
  })

  // ---- useAuth outside provider ----

  describe('useAuth outside AuthProvider', () => {
    it('throws an error when used outside AuthProvider', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      expect(() => {
        renderHook(() => useAuth())
      }).toThrow('useAuth must be used within an AuthProvider')

      consoleSpy.mockRestore()
    })
  })
})
