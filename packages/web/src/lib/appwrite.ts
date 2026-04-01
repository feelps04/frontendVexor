import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://pbecklboewiowuoclmln.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBiZWNrbGJvZXdpb3d1b2NsbWxuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3NDYxMjQsImV4cCI6MjA5MDMyMjEyNH0.hh-8rXRiwgrFb2b3oDJnCxC8hxJ5gjmeHa8WAPdgc-k'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Keep localStorage auth token in sync with Supabase's automatic session refresh.
// Without this, access_tokens expire after 1 hour and all API calls return 401.
supabase.auth.onAuthStateChange((event, session) => {
  if (!session) return
  try {
    const raw = localStorage.getItem('auth')
    if (!raw) return
    const stored = JSON.parse(raw)
    stored.accessToken = session.access_token
    localStorage.setItem('auth', JSON.stringify(stored))
  } catch {
    // ignore
  }
})

export async function loginAppwrite(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return { session: data.session, user: data.user }
}

export async function registerAppwrite(email: string, password: string, name: string) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name } },
  })
  if (error) {
    if (error.message?.toLowerCase().includes('already registered')) {
      return await loginAppwrite(email, password)
    }
    throw error
  }
  // If email confirmation is required, session may be null — fallback to login
  if (!data.session) {
    return await loginAppwrite(email, password)
  }
  return { session: data.session, user: data.user }
}

export async function logoutAppwrite() {
  await supabase.auth.signOut()
}

export async function getCurrentUser() {
  const { data } = await supabase.auth.getUser()
  return data.user ?? null
}
