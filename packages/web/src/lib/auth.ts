import type { AuthResponse } from './api'

export type StoredAuth = {
  userId: string
  accountId: string
  accessToken: string
  email: string
}

const KEY = 'auth'

export function getAuth(): StoredAuth | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    return JSON.parse(raw) as StoredAuth
  } catch {
    return null
  }
}

export function setAuth(auth: StoredAuth | null): void {
  try {
    if (!auth) {
      localStorage.removeItem(KEY)
      return
    }
    localStorage.setItem(KEY, JSON.stringify(auth))
  } catch {
    // ignore
  }
}

export function toStoredAuth(email: string, r: AuthResponse): StoredAuth {
  // Support both formats: production (user.id, token) and local (userId, accessToken)
  const userId = r.user?.id || r.userId || ''
  const accessToken = r.token || r.accessToken || ''
  const accountId = r.user?.id || r.accountId || userId
  
  return { email, userId, accountId, accessToken }
}
