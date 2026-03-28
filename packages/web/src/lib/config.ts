// Configuração de URLs — stack local (sem VM): API :3000, Python :8765, LiveKit :7880
const isDev = import.meta.env.DEV

const LOCAL_API =
  (import.meta.env.VITE_PUBLIC_API_URL as string | undefined)?.replace(/\/$/, '') ||
  'http://127.0.0.1:3001'
const LOCAL_PYTHON =
  (import.meta.env.VITE_PUBLIC_PYTHON_URL as string | undefined)?.replace(/\/$/, '') ||
  'http://127.0.0.1:8765'
const LOCAL_WS_LIVEKIT =
  (import.meta.env.VITE_PUBLIC_LIVEKIT_WS as string | undefined)?.replace(/\/$/, '') ||
  'ws://127.0.0.1:7880'

export const API_BASE = isDev ? 'http://127.0.0.1:3001' : 'http://127.0.0.1:3001'
/** Prefer `pythonApiUrl()` no browser. */
export const PYTHON_API_BASE = LOCAL_PYTHON
export const LAMBDA_URL = isDev ? 'http://127.0.0.1:8081' : `${LOCAL_API}/lambda`
export const NEWS_URL = isDev ? 'http://127.0.0.1:8082' : `${LOCAL_API}/news`

export const WS_BASE = isDev ? 'ws://127.0.0.1:7880' : LOCAL_WS_LIVEKIT
export const WS_PYTHON = isDev ? 'ws://127.0.0.1:8765' : `ws://127.0.0.1:8765`
export const WS_UDP = isDev ? 'ws://127.0.0.1:9300' : `ws://127.0.0.1:9300`
export const WEBRTC_URL = isDev ? 'http://127.0.0.1' : 'http://127.0.0.1'
export const WEBRTC_PORT = isDev ? 10208 : 10208
