/**
 * Origem HTTP para a API Fastify no browser.
 * - Local: '' → proxy Vite (dev/preview) para :3000.
 * - vexorflow.com / *.vercel.app: '' → mesmo host (/api/v1/*) com proxy serverless na Vercel (sem CORS no browser).
 * - Não defines VITE_API_ORIGIN=https://api.vexorflow.com na Vercel — isso força CORS e quebra o login.
 * - VITE_PUBLIC_API_URL: fallback para outros hosts (defeito local: http://127.0.0.1:3000).
 */
const defaultApiBase =
  (import.meta.env.VITE_PUBLIC_API_URL as string | undefined)?.replace(/\/$/, '') ||
  'http://127.0.0.1:3001'

function isLocalBrowserHost(): boolean {
  if (typeof window === 'undefined') return false
  const h = window.location.hostname
  return h === 'localhost' || h === '127.0.0.1'
}

export function getApiOrigin(): string {
  const forced = (import.meta.env.VITE_API_ORIGIN as string | undefined)?.trim().replace(/\/$/, '')
  if (typeof window === 'undefined') {
    return forced || defaultApiBase
  }
  if (forced) return forced

  if (isLocalBrowserHost()) return ''

  const h = window.location.hostname
  const onVexorHost =
    h === 'vexorflow.com' ||
    h === 'www.vexorflow.com' ||
    (h.length > 14 && h.endsWith('.vexorflow.com'))
  const onVercelPreview = h.endsWith('.vercel.app')

  if (onVexorHost || onVercelPreview) return ''

  return defaultApiBase
}

const defaultPythonBase =
  (import.meta.env.VITE_PUBLIC_PYTHON_URL as string | undefined)?.replace(/\/$/, '') ||
  'http://127.0.0.1:8765'

/** Python OHLCV: local via Vite; vexorflow.com / Vercel via /python-api (rewrite na Vercel). */
export function pythonApiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  if (typeof window === 'undefined') {
    return `${defaultPythonBase}${p}`
  }
  if (isLocalBrowserHost()) {
    return `/python-api${p}`
  }
  const h = window.location.hostname
  const proxiedPython =
    h === 'vexorflow.com' ||
    h === 'www.vexorflow.com' ||
    (h.length > 14 && h.endsWith('.vexorflow.com')) ||
    h.endsWith('.vercel.app')
  if (proxiedPython) {
    return `/python-api${p}`
  }
  return `${defaultPythonBase}${p}`
}
