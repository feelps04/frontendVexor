import { getApiOrigin } from './browserApiOrigin'
import { supabase } from './appwrite'

export type AuthResponse = {
  success: boolean
  user: {
    id: string
    email: string
    name: string
    role: string
  }
  token: string
  // Legacy support for local development
  userId?: string
  accountId?: string
  accessToken?: string
}

function normalizePath(path: string): string {
  if (!path) return '/'
  return path.startsWith('/') ? path : `/${path}`
}

function isJwtExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()
  } catch {
    return false
  }
}

async function getAccessToken(): Promise<string | null> {
  try {
    const raw = localStorage.getItem('auth')
    if (!raw) return null
    const parsed = JSON.parse(raw) as { accessToken?: string }
    const stored = parsed?.accessToken || null

    // If token is expired, ask Supabase for a fresh one
    if (stored && isJwtExpired(stored)) {
      const { data } = await supabase.auth.getSession()
      if (data.session?.access_token) {
        parsed.accessToken = data.session.access_token
        localStorage.setItem('auth', JSON.stringify(parsed))
        return data.session.access_token
      }
    }

    return stored
  } catch {
    return null
  }
}

async function withAuthHeaders(headers?: HeadersInit): Promise<HeadersInit> {
  const token = await getAccessToken()
  if (!token) return headers ?? {}
  return {
    ...(headers ?? {}),
    Authorization: `Bearer ${token}`,
  }
}

function withTimeout(init?: RequestInit, timeoutMs = 8000): { init: RequestInit; cleanup: () => void } {
  const controller = new AbortController()
  const t = window.setTimeout(() => controller.abort(), timeoutMs)
  return {
    init: {
      ...(init ?? {}),
      signal: controller.signal,
    },
    cleanup: () => window.clearTimeout(t),
  }
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  const wt = withTimeout(init)
  const res = await fetch(getApiOrigin() + normalizePath(path), {
    method: 'GET',
    headers: await withAuthHeaders(init?.headers),
    credentials: 'include',
    ...wt.init,
  })
  wt.cleanup()

  const raw = await res.text().catch(() => '')
  let data: any = null
  if (raw) {
    try {
      data = JSON.parse(raw) as any
    } catch {
      data = null
    }
  }
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || `HTTP ${res.status}`
    const snippet = raw && typeof raw === 'string' ? raw.slice(0, 500) : ''
    throw new Error(snippet ? `${msg}: ${snippet}` : msg)
  }
  return (data ?? (raw as any)) as T
}

export async function apiPost<T>(path: string, body: unknown, init?: RequestInit): Promise<T> {
  const wt = withTimeout(init)
  let res: Response
  try {
    res = await fetch(getApiOrigin() + normalizePath(path), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...await withAuthHeaders(init?.headers),
      ...(init?.headers ?? {}),
    },
    body: JSON.stringify(body),
    credentials: 'include',
    ...wt.init,
    })
  } catch (err: any) {
    wt.cleanup()
    if (err?.name === 'AbortError') {
      throw new Error('timeout')
    }
    throw err
  }
  wt.cleanup()

  const raw = await res.text().catch(() => '')
  let data: any = null
  if (raw) {
    try {
      data = JSON.parse(raw) as any
    } catch {
      data = null
    }
  }
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || `HTTP ${res.status}`
    const snippet = raw && typeof raw === 'string' ? raw.slice(0, 500) : ''
    throw new Error(snippet ? `${msg}: ${snippet}` : msg)
  }
  return (data ?? (raw as any)) as T
}
