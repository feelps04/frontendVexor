import { getApiOrigin } from './browserApiOrigin'

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

function getAccessToken(): string | null {
  try {
    const raw = localStorage.getItem('auth')
    if (!raw) return null
    const parsed = JSON.parse(raw) as { accessToken?: string }
    return parsed?.accessToken || null
  } catch {
    return null
  }
}

function withAuthHeaders(headers?: HeadersInit): HeadersInit {
  const token = getAccessToken()
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
    headers: withAuthHeaders(init?.headers),
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
      ...withAuthHeaders(init?.headers),
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
