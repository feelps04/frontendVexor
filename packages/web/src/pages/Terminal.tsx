import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { apiGet } from '../lib/api'
import { getAuth } from '../lib/auth'
import { Link, NavLink, useNavigate, Outlet, useMatch } from 'react-router-dom'
import { useGeckos, FeedMessage } from '../hooks/useGeckos'
import { pythonApiUrl } from '../lib/browserApiOrigin'

// Types
type AssetItem = {
  symbol: string
  name: string
  price: number
  change: number
  sparkline: number[]
}

type AssetSource = {
  bySource: Map<string, number>
}

type SymbolCheckItem = {
  requested: string
  symbol: string
  status: 'ok' | 'no_data' | 'redis_not_configured'
  priceBRL?: number
  message?: string
}

type SectorItem = {
  sectorId: string
  sectorName: string
  symbols: number
  description: string
  active: boolean
  source: string
  protocol: string
  frequency: string
  recommendation: string
}

type SectorsResponse = {
  sectors: SectorItem[]
}

type SectorSymbolsResponse = {
  sectorId: string
  total: number
  symbols: Array<{ exchange: string; symbol: string; fullSymbol: string; description: string; type: string }>
}

type ChatMessage = {
  id: string
  user: string
  avatar: string
  message: string
  time: string
  online?: boolean
}

// VEXOR_CHAT Widget Component
function VexorChatWidget({ accountId }: { accountId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: '1', user: 'VEXOR_CORE', avatar: 'V', message: 'Análise de sentimentos completa: O setor de TECNOLOGIA apresenta padrões de acumulação institucional.\n\nSTATUS: PRONTO PARA EXECUÇÃO', time: '14:25:01', online: true },
    { id: '2', user: 'SQUAD_TRADERS', avatar: 'S', message: 'Entrada detectada no ativo PETR4. Volume acima da média.', time: '14:24:32', online: true },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  
  // Generate Atlas name from accountId
  const atlasName = useMemo(() => {
    const prefix = accountId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase() || 'ATLAS'
    const names = ['NEXUS', 'ORION', 'ATLAS', 'CIPHER', 'QUANTUM', 'VECTOR', 'PRISM', 'NOVA', 'ZENITH', 'APEX']
    const num = parseInt(accountId.slice(-4), 16) % names.length
    return `${names[num]}_${prefix}`
  }, [accountId])
  
  const handleSend = async () => {
    if (!input.trim()) return
    const newMsg: ChatMessage = {
      id: Date.now().toString(),
      user: atlasName,
      avatar: atlasName[0],
      message: input,
      time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      online: true
    }
    setMessages(prev => [...prev, newMsg])
    setInput('')
    
    // Simulate AI response
    setLoading(true)
    setTimeout(() => {
      const aiResponse: ChatMessage = {
        id: (Date.now() + 1).toString(),
        user: 'VEXOR_CORE',
        avatar: 'V',
        message: 'Comando recebido. Processando análise...',
        time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        online: true
      }
      setMessages(prev => [...prev, aiResponse])
      setLoading(false)
    }, 1500)
  }
  
  return (
    <div className="vexor-chat-widget">
      <div className="chat-header">
        <span className="chat-title">VEXOR_CHAT</span>
        <span className="chat-encrypted">ENCRYPTED</span>
      </div>
      
      <div className="chat-channels">
        <div className="channel active">
          <span className="channel-icon">👥</span>
          <span className="channel-name">SQUAD_TRADERS</span>
        </div>
        <div className="channel">
          <span className="channel-icon">🤖</span>
          <span className="channel-name">VEXOR_CORE</span>
          <span className="channel-badge">AI</span>
        </div>
      </div>
      
      <div className="chat-messages">
        {messages.map(msg => (
          <div key={msg.id} className={`chat-message ${msg.user === atlasName ? 'own' : ''}`}>
            <div className="msg-avatar" style={{ background: msg.user === 'VEXOR_CORE' ? 'linear-gradient(135deg, #667eea, #764ba2)' : 'linear-gradient(135deg, #0095f6, #00c6ff)' }}>
              {msg.avatar}
            </div>
            <div className="msg-content">
              <div className="msg-header">
                <span className="msg-user">{msg.user}</span>
                {msg.user === 'VEXOR_CORE' && <span className="ai-badge">AI</span>}
                <span className="msg-time">{msg.time}</span>
              </div>
              <div className="msg-text">{msg.message}</div>
            </div>
          </div>
        ))}
        {loading && (
          <div className="chat-message">
            <div className="msg-avatar" style={{ background: 'linear-gradient(135deg, #667eea, #764ba2)' }}>V</div>
            <div className="msg-content">
              <div className="msg-typing">digitando...</div>
            </div>
          </div>
        )}
      </div>
      
      <div className="chat-input-area">
        <input
          type="text"
          className="chat-input"
          placeholder="ESTABELECER COMANDO..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyPress={e => e.key === 'Enter' && handleSend()}
        />
        <button className="chat-send" onClick={handleSend}>➤</button>
      </div>
      
      <style>{`
        .vexor-chat-widget {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: rgba(13, 17, 23, 0.95);
        }
        
        .chat-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px;
          border-bottom: 1px solid rgba(48, 54, 61, 0.6);
        }
        
        .chat-title {
          font-weight: 700;
          font-size: 14px;
          color: #00ffc8;
          letter-spacing: 1px;
        }
        
        .chat-encrypted {
          font-size: 10px;
          color: #3fb950;
          background: rgba(63, 185, 80, 0.1);
          padding: 4px 8px;
          border-radius: 4px;
          border: 1px solid rgba(63, 185, 80, 0.3);
        }
        
        .chat-channels {
          display: flex;
          gap: 8px;
          padding: 12px;
          border-bottom: 1px solid rgba(48, 54, 61, 0.4);
        }
        
        .channel {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 12px;
          background: rgba(48, 54, 61, 0.3);
          border-radius: 20px;
          cursor: pointer;
          font-size: 12px;
          color: #8b949e;
          transition: all 0.2s;
        }
        
        .channel:hover, .channel.active {
          background: rgba(88, 166, 255, 0.2);
          color: #e6edf3;
        }
        
        .channel-badge {
          background: linear-gradient(135deg, #667eea, #764ba2);
          color: white;
          font-size: 9px;
          padding: 2px 6px;
          border-radius: 4px;
          font-weight: 600;
        }
        
        .chat-messages {
          flex: 1;
          overflow-y: auto;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        
        .chat-message {
          display: flex;
          gap: 10px;
        }
        
        .chat-message.own {
          flex-direction: row-reverse;
        }
        
        .msg-avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 600;
          font-size: 14px;
          color: white;
          flex-shrink: 0;
        }
        
        .msg-content {
          flex: 1;
          max-width: 85%;
        }
        
        .msg-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 4px;
        }
        
        .msg-user {
          font-weight: 600;
          font-size: 13px;
          color: #e6edf3;
        }
        
        .ai-badge {
          background: linear-gradient(135deg, #667eea, #764ba2);
          color: white;
          font-size: 9px;
          padding: 2px 6px;
          border-radius: 4px;
          font-weight: 600;
        }
        
        .msg-time {
          font-size: 10px;
          color: #6e7681;
        }
        
        .msg-text {
          font-size: 13px;
          color: #c9d1d9;
          line-height: 1.5;
          white-space: pre-wrap;
          background: rgba(48, 54, 61, 0.3);
          padding: 10px 14px;
          border-radius: 16px;
          border-top-left-radius: 4px;
        }
        
        .chat-message.own .msg-text {
          background: rgba(88, 166, 255, 0.2);
          border-top-left-radius: 16px;
          border-top-right-radius: 4px;
        }
        
        .msg-typing {
          font-size: 12px;
          color: #6e7681;
          font-style: italic;
        }
        
        .chat-input-area {
          display: flex;
          gap: 8px;
          padding: 12px;
          border-top: 1px solid rgba(48, 54, 61, 0.6);
        }
        
        .chat-input {
          flex: 1;
          background: rgba(48, 54, 61, 0.3);
          border: 1px solid rgba(48, 54, 61, 0.6);
          border-radius: 20px;
          padding: 10px 16px;
          color: #e6edf3;
          font-size: 13px;
          outline: none;
          transition: all 0.2s;
        }
        
        .chat-input:focus {
          border-color: rgba(88, 166, 255, 0.5);
          box-shadow: 0 0 20px rgba(88, 166, 255, 0.2);
        }
        
        .chat-input::placeholder {
          color: #6e7681;
        }
        
        .chat-send {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: linear-gradient(135deg, #0095f6, #00c6ff);
          border: none;
          color: white;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: transform 0.2s;
        }
        
        .chat-send:hover {
          transform: scale(1.1);
        }
      `}</style>
    </div>
  )
}

// Sparkline Component
function Sparkline({ data, positive }: { data: number[]; positive: boolean }) {
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  
  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * 60
    const y = 20 - ((val - min) / range) * 20
    return `${x},${y}`
  }).join(' ')

  return (
    <svg className="sparkline" viewBox="0 0 60 20">
      <polyline
        fill="none"
        stroke={positive ? '#3fb950' : '#f85149'}
        strokeWidth="2"
        points={points}
      />
    </svg>
  )
}

// Main Layout Component
export default function TerminalLayout() {
  const auth = getAuth()
  const navigate = useNavigate()
  const MAX_WS_SYMBOLS = 50000
  const MAX_GROUP_SYMBOLS = 1500
  const effectRunCountRef = useRef(0)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [selectedAsset, setSelectedAsset] = useState('VALE3')
  const [assets, setAssets] = useState<AssetItem[]>([])
  const [loadingAssets, setLoadingAssets] = useState(true)
  const [feedStale, setFeedStale] = useState<boolean>(false)
  const [feedAgeMs, setFeedAgeMs] = useState<number | null>(null)

  const [sectors, setSectors] = useState<SectorItem[]>([])
  const [loadingSectors, setLoadingSectors] = useState(true)
  const [selectedSectorId, setSelectedSectorId] = useState<string>('__ALL__')

  const lastClientTickAtRef = useRef<number>(0)

  const wsRef = useRef<WebSocket | null>(null)
  const pendingSymbolsRef = useRef<string>('')
  const pricesRef = useRef<Map<string, number>>(new Map())
  const sourcesRef = useRef<Map<string, AssetSource>>(new Map())
  const prevPricesRef = useRef<Map<string, number>>(new Map())
  const flashRef = useRef<Map<string, 'up' | 'down'>>(new Map())
  const [flashKey, setFlashKey] = useState(0)
  const dirtySymbolsRef = useRef<Set<string>>(new Set())

  const lastPricesCacheDirtyRef = useRef<Set<string>>(new Set())
  const lastPricesCacheTimerRef = useRef<number | null>(null)
  const LAST_PRICES_CACHE_KEY = 'terminal:lastPrices:v1'

  const flashMap = useMemo(() => new Map(flashRef.current), [flashKey])

  const accountId = useMemo(() => auth?.accountId || 'acc-1', [auth])
  
  // Generate Atlas name from accountId
  const atlasName = useMemo(() => {
    const prefix = accountId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase() || 'ATLAS'
    const names = ['NEXUS', 'ORION', 'ATLAS', 'CIPHER', 'QUANTUM', 'VECTOR', 'PRISM', 'NOVA', 'ZENITH', 'APEX']
    const num = parseInt(accountId.slice(-4), 16) % names.length
    return `${names[num]}_${prefix}`
  }, [accountId])

  // Auth check
  useEffect(() => {
    if (!auth?.accessToken) {
      navigate('/login')
    }
  }, [auth, navigate])

  useEffect(() => {
    let cancelled = false
    async function loadSectors() {
      setLoadingSectors(true)
      try {
        // Fetch from Python API via proxy
        const res = await fetch(pythonApiUrl('/sectors'))
        const data = await res.json()
        const list = Array.isArray(data?.sectors) ? data.sectors.map((s: any) => ({
          sectorId: s.sector_id,
          sectorName: s.sector_name,
          symbols: s.count || 0,
          description: '',
          active: true,
          source: s.exchanges?.[0] || '',
          protocol: '',
          frequency: '',
          recommendation: ''
        })) : []
        if (cancelled) return
        setSectors(list)
        setSelectedSectorId((prev) => {
          const cur = String(prev || '').trim()
          if (cur) return cur
          const first = list[0]?.sectorId
          return first ? String(first) : '__ALL__'
        })
      } catch {
        if (cancelled) return
        setSectors([])
      } finally {
        if (cancelled) return
        setLoadingSectors(false)
      }
    }
    void loadSectors()
    return () => {
      cancelled = true
    }
  }, [])

  // Load asset universe once from backend
  useEffect(() => {
    let cancelled = false
    async function loadAssets() {
      try {
        let symbols: string[] = []

        const sectorId = String(selectedSectorId || '').trim()
        if (sectorId === '__ALL__') {
          // Fetch all symbols from Python API via proxy
          const res = await fetch(pythonApiUrl('/symbols'))
          const data = await res.json()
          const allSymbols = Array.isArray(data?.symbols) ? data.symbols.map((s: any) => s.symbol || s) : []
          symbols = allSymbols.map((s: string) => String(s || '').trim().toUpperCase()).filter(Boolean)
        } else if (sectorId) {
          // Fetch symbols for specific sector from Python API via proxy
          const res = await fetch(pythonApiUrl(`/sectors/${encodeURIComponent(sectorId)}/symbols`))
          const data = await res.json()
          const list = Array.isArray(data?.symbols) ? data.symbols : []
          symbols = list
            .map((x: any) => String(x?.symbol || '').trim().toUpperCase())
            .filter(Boolean)
        }
        
        const assetItems: AssetItem[] = symbols.map((symbol) => ({
          symbol,
          name: getAssetName(symbol),
          price: 0,
          change: 0,
          sparkline: [0, 0, 0, 0, 0],
        }))
        
        setAssets(assetItems)

        const readLastPricesCache = (): Record<string, { price?: unknown; ts?: unknown }> => {
          try {
            const raw = window.localStorage.getItem(LAST_PRICES_CACHE_KEY)
            if (!raw) return {}
            const parsed = JSON.parse(raw) as unknown
            if (!parsed || typeof parsed !== 'object') return {}
            return parsed as Record<string, { price?: unknown; ts?: unknown }>
          } catch {
            return {}
          }
        }

        const flushLastPricesCache = () => {
          try {
            const dirty = lastPricesCacheDirtyRef.current
            if (dirty.size === 0) return
            const cache = readLastPricesCache()
            for (const sym of Array.from(dirty)) {
              const price = pricesRef.current.get(sym)
              if (price == null || !Number.isFinite(price) || price <= 0) continue
              cache[sym] = { price, ts: Date.now() }
            }
            dirty.clear()
            window.localStorage.setItem(LAST_PRICES_CACHE_KEY, JSON.stringify(cache))
          } catch {
            // ignore
          }
        }

        const scheduleLastPricesCacheFlush = () => {
          if (lastPricesCacheTimerRef.current != null) return
          lastPricesCacheTimerRef.current = window.setTimeout(() => {
            lastPricesCacheTimerRef.current = null
            flushLastPricesCache()
          }, 600)
        }

        const applyPrice = (symRaw: string, priceRaw: unknown) => {
          const sym = String(symRaw || '').toUpperCase()
          const price = Number(priceRaw)
          if (!sym || !Number.isFinite(price) || price <= 0) return
          pricesRef.current.set(sym, price)
          dirtySymbolsRef.current.add(sym)
          lastPricesCacheDirtyRef.current.add(sym)
          scheduleLastPricesCacheFlush()
        }

        try {
          const cache = readLastPricesCache()
          for (const s of symbols) {
            const sym = String(s || '').toUpperCase()
            const cached = cache[sym]
            if (!cached) continue
            applyPrice(sym, cached.price)
          }
        } catch {
          // ignore
        }

        try {
          const checkSymbols = symbols.slice(0, 200)
          const q = await apiGet<{ items: SymbolCheckItem[] }>(
            `/api/v1/market/symbols/check?symbols=${encodeURIComponent(checkSymbols.join(','))}`
          )
          const items = Array.isArray(q?.items) ? q.items : []
          if (cancelled) return
          for (const it of items) {
            if (!it || it.status !== 'ok') continue
            applyPrice(String(it.symbol || it.requested || ''), it.priceBRL)
          }
        } catch {
          // ignore (batch check is best-effort)
        }

        setFlashKey((x) => x + 1)
        if (assetItems.length > 0) {
          setSelectedAsset((prev) => {
            const stillExists = assetItems.some((a) => a.symbol === prev)
            return stillExists ? prev : assetItems[0].symbol
          })
        }
      } catch (err) {
        console.error('Failed to load assets:', err)
        // No fictitious fallback: keep list empty if backend is unavailable.
        setAssets([])
      } finally {
        setLoadingAssets(false)
      }
    }
    
    void loadAssets()
    return () => {
      cancelled = true
    }
  }, [selectedSectorId])

  const watchSymbols = useMemo(() => {
    const base = ['VALE3', 'PETR4', 'USDB11', 'BTCBRL']
    const s = new Set(base)
    if (selectedAsset) s.add(selectedAsset)
    return Array.from(s)
  }, [selectedAsset])

  const watchSymbolsKey = useMemo(() => watchSymbols.join(','), [watchSymbols])

  const subscribedSymbols = useMemo(() => {
    const watchList = watchSymbolsKey
      .split(',')
      .map((x) => String(x || '').trim().toUpperCase())
      .filter(Boolean)
    const assetList = assets
      .map((a) => String(a?.symbol || '').trim().toUpperCase())
      .filter(Boolean)
    const s = new Set([...watchList, ...assetList])
    return Array.from(s).slice(0, MAX_WS_SYMBOLS)
  }, [assets, watchSymbolsKey])

  // Geckos.io real-time connection (replaces WebSocket)
  const handleGeckosMessage = useCallback((msg: FeedMessage) => {
    if (msg.type === 'tick' && msg.symbol) {
      const sym = msg.symbol.toUpperCase()
      const price = Number((msg as any).ask) || Number((msg as any).priceBRL) || Number((msg as any).bid)
      if (Number.isFinite(price) && price > 0) {
        pricesRef.current.set(sym, price)
        dirtySymbolsRef.current.add(sym)
        lastClientTickAtRef.current = Date.now()
        setFeedStale(false)
        setFeedAgeMs(0)
      }
    } else if (msg.type === 'ticks' && msg.items) {
      for (const [sym, tick] of Object.entries(msg.items)) {
        const price = Number((tick as any).ask) || Number((tick as any).priceBRL) || Number((tick as any).bid)
        if (Number.isFinite(price) && price > 0) {
          pricesRef.current.set(sym.toUpperCase(), price)
          dirtySymbolsRef.current.add(sym.toUpperCase())
        }
      }
      lastClientTickAtRef.current = Date.now()
      setFeedStale(false)
      setFeedAgeMs(0)
    }
  }, [])

  const { connected: geckosConnected } = useGeckos({
    port: 10208,
    symbols: subscribedSymbols,
    onMessage: handleGeckosMessage,
    onConnect: () => {
      console.log('[Geckos] Connected to real-time feed')
      setFeedStale(false)
    },
    onDisconnect: () => {
      console.log('[Geckos] Disconnected from real-time feed')
      setFeedStale(true)
    },
    enabled: true
  })

  useEffect(() => {
    const STALE_AFTER_MS = 15_000
    const t = window.setInterval(() => {
      const last = lastClientTickAtRef.current
      if (!(Number.isFinite(last) && last > 0)) return
      const age = Math.max(0, Date.now() - last)
      setFeedAgeMs(age)
      setFeedStale(age > STALE_AFTER_MS)
    }, 1000)
    return () => window.clearInterval(t)
  }, [])

  // WebSocket subscription disabled - using Geckos.io instead
  const wsCreatedRef = useRef(false);
  
  useEffect(() => {
    // WebSocket disabled - Geckos.io is now the primary real-time feed
    wsCreatedRef.current = true;
  }, [])

  // Enviar símbolos quando mudar (via Geckos)

  // HFT paint loop: only update UI when some symbol changed (dirty set)
  useEffect(() => {
    let raf = 0
    let stopped = false

    const frame = () => {
      if (stopped) return
      const dirty = dirtySymbolsRef.current
      if (dirty.size > 0) {
        const dirtyNow = new Set(dirty)
        dirty.clear()

        setAssets((prev) =>
          prev.map((a) => {
            if (!dirtyNow.has(a.symbol)) return a
            const p = pricesRef.current.get(a.symbol)
            if (p == null || !Number.isFinite(p) || p <= 0) return a
            const prevP = prevPricesRef.current.get(a.symbol)
            const change = prevP && prevP > 0 ? ((p - prevP) / prevP) * 100 : a.change
            const nextChange = Number.isFinite(change) ? change : a.change
            if (a.price === p && a.change === nextChange) return a
            return {
              ...a,
              price: p,
              change: nextChange,
              sparkline: generateSparkline(nextChange),
            }
          })
        )
      }

      raf = window.requestAnimationFrame(frame)
    }

    raf = window.requestAnimationFrame(frame)
    return () => {
      stopped = true
      if (raf) window.cancelAnimationFrame(raf)
    }
  }, [])

  function getAssetName(symbol: string): string {
    const names: Record<string, string> = {
      'VALE': 'Vale',
      'VALE3': 'Vale ON',
      'PETR4': 'Petrobras',
      'USDB11': 'USD/BRL',
      'BTCBRL': 'Bitcoin',
      'TSLA': 'Tesla',
      'GOOGL': 'Google',
    }
    return names[symbol] || symbol
  }

  function generateSparkline(change: number): number[] {
    const base = 100
    const trend = change >= 0 ? 1 : -1
    return [
      base,
      base + trend * Math.random() * 2,
      base + trend * Math.random() * 4,
      base + trend * Math.random() * 3,
      base + trend * Math.abs(change)
    ]
  }

  const watchlist = assets.filter(a => ['VALE3', 'PETR4', 'USDB11'].includes(a.symbol))

  return (
    <div className="terminal-container">
      {/* Header */}
      <header className="terminal-header">
        <div className="header-left">
          <button 
            className="menu-toggle"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            ☰
          </button>
          <h1 className="logo">Dashboard</h1>
        </div>
        <nav className="header-nav">
          <NavLink to="/app" className="nav-link" end>
            Dashboard
          </NavLink>
          <Link to="sectors" className="nav-link">
            Setores
          </Link>
          <Link to="carteira" className="nav-link">
            Carteira
          </Link>
          <Link to="contracts" className="nav-link">
            Contracts
          </Link>
          <Link to="social" className="nav-link">
            Social
          </Link>
        </nav>
        <div className="header-right">
          <select
            value={selectedSectorId}
            onChange={(e) => setSelectedSectorId(String(e.target.value || ''))}
            disabled={loadingSectors || sectors.length === 0}
            style={{
              height: 34,
              maxWidth: 340,
              padding: '0 10px',
              borderRadius: 10,
              border: '1px solid rgba(48, 54, 61, 0.6)',
              background: 'rgba(13, 17, 23, 0.6)',
              color: '#e6edf3',
              fontSize: 12,
              cursor: 'pointer',
            }}
            title={loadingSectors ? 'Carregando setores...' : ''}
            size={1}
          >
            <option value="__ALL__">TODOS (tempo real)</option>
            {sectors.filter((s, i, arr) => arr.findIndex(x => x.sectorId === s.sectorId) === i).map((s) => (
              <option key={s.sectorId} value={s.sectorId}>
                {s.sectorId} - {s.sectorName} ({s.symbols})
              </option>
            ))}
          </select>
          <span className={`feed-badge ${feedStale ? 'stale' : 'live'}`}
            title={feedAgeMs != null ? `Último tick há ${Math.round(feedAgeMs / 1000)}s` : 'Sem ticks recentes'}>
            {feedStale ? 'STALE' : 'LIVE'}
          </span>
          <span className="account-info">
            <span className="atlas-avatar">{atlasName[0]}</span>
            <span className="atlas-name">{atlasName}</span>
          </span>
          <Link to="/logout" className="logout-btn">Sair</Link>
        </div>
      </header>

      {/* Main Layout */}
      <div className="terminal-layout" style={{ flex: 1, overflow: 'auto' }}>
        {/* Center - Main Content Only (full width) */}
        <main className="main-content" style={{ flex: 1, height: '100%' }}>
          <Outlet context={{ selectedAsset, setSelectedAsset, assets, accountId }} />
        </main>
        
        {/* Right Sidebar - VEXOR_CHAT (hidden on social page) */}
        {!useMatch('/app/social') && (
          <aside className="sidebar-right">
            <VexorChatWidget accountId={accountId} />
          </aside>
        )}
      </div>

      {/* Styles - Design System 3D */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        
        /* Animações globais */
        @keyframes float {
          0%, 100% { transform: translateY(0px) rotateX(0deg); }
          50% { transform: translateY(-10px) rotateX(2deg); }
        }
        
        @keyframes pulse-glow {
          0%, 100% { box-shadow: 0 0 20px rgba(88, 166, 255, 0.3); }
          50% { box-shadow: 0 0 40px rgba(88, 166, 255, 0.6); }
        }
        
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        
        @keyframes rotate-3d {
          0% { transform: perspective(1000px) rotateY(0deg); }
          100% { transform: perspective(1000px) rotateY(360deg); }
        }
        
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        
        @keyframes bounce-in {
          0% { transform: scale(0.3); opacity: 0; }
          50% { transform: scale(1.05); }
          70% { transform: scale(0.9); }
          100% { transform: scale(1); opacity: 1; }
        }
        
        .terminal-container {
          display: flex;
          flex-direction: column;
          height: 100vh;
          background: linear-gradient(135deg, #0d1117 0%, #161b22 50%, #0d1117 100%);
          color: #e6edf3;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          perspective: 1000px;
          animation: fade-in 0.5s ease-out;
        }

        .terminal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 20px;
          background: rgba(13, 17, 23, 0.95);
          border-bottom: 1px solid rgba(48, 54, 61, 0.6);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          box-shadow: 
            0 4px 30px rgba(0, 0, 0, 0.3),
            0 1px 0 rgba(255, 255, 255, 0.05) inset,
            0 -1px 0 rgba(0, 0, 0, 0.2) inset;
          transform-style: preserve-3d;
          animation: slide-up 0.6s ease-out;
        }

        .header-left {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .menu-toggle {
          background: linear-gradient(145deg, rgba(48, 54, 61, 0.6), rgba(13, 17, 23, 0.8));
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #8b949e;
          font-size: 18px;
          cursor: pointer;
          padding: 10px;
          border-radius: 12px;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 
            0 4px 15px rgba(0, 0, 0, 0.2),
            0 2px 4px rgba(0, 0, 0, 0.1),
            inset 0 1px 0 rgba(255, 255, 255, 0.1);
          transform-style: preserve-3d;
        }

        .menu-toggle:hover {
          background: linear-gradient(145deg, rgba(88, 166, 255, 0.2), rgba(35, 134, 54, 0.2));
          color: #e6edf3;
          transform: translateY(-2px) rotateX(5deg);
          box-shadow: 
            0 8px 25px rgba(88, 166, 255, 0.3),
            0 4px 10px rgba(0, 0, 0, 0.2);
        }

        .logo {
          font-size: 24px;
          font-weight: 700;
          background: linear-gradient(135deg, #58a6ff 0%, #238636 50%, #f0883e 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          text-shadow: 0 0 30px rgba(88, 166, 255, 0.5);
          animation: pulse-glow 3s ease-in-out infinite;
          letter-spacing: -0.5px;
        }

        .header-nav {
          display: flex;
          gap: 8px;
        }

        .nav-link {
          color: #8b949e;
          text-decoration: none;
          padding: 10px 18px;
          border-radius: 12px;
          font-size: 13px;
          font-weight: 500;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          background: linear-gradient(145deg, rgba(48, 54, 61, 0.3), rgba(13, 17, 23, 0.5));
          border: 1px solid transparent;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
          transform-style: preserve-3d;
          position: relative;
          overflow: hidden;
        }

        .nav-link::before {
          content: '';
          position: absolute;
          top: 0;
          left: -100%;
          width: 100%;
          height: 100%;
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent);
          transition: left 0.5s;
        }

        .nav-link:hover::before {
          left: 100%;
        }

        .nav-link:hover {
          color: #e6edf3;
          background: linear-gradient(145deg, rgba(88, 166, 255, 0.15), rgba(35, 134, 54, 0.15));
          border-color: rgba(88, 166, 255, 0.3);
          transform: translateY(-3px) rotateX(5deg);
          box-shadow: 
            0 10px 30px rgba(88, 166, 255, 0.2),
            0 5px 15px rgba(0, 0, 0, 0.1);
        }

        .nav-link.active {
          color: #58a6ff;
          background: linear-gradient(145deg, rgba(88, 166, 255, 0.2), rgba(88, 166, 255, 0.1));
          border-color: rgba(88, 166, 255, 0.4);
          box-shadow: 
            0 0 20px rgba(88, 166, 255, 0.3),
            inset 0 1px 0 rgba(255, 255, 255, 0.1);
          animation: pulse-glow 2s ease-in-out infinite;
        }

        .header-right {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .feed-badge {
          padding: 6px 14px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.8px;
          border: 1px solid rgba(240, 246, 252, 0.18);
          user-select: none;
          transition: all 0.3s ease;
          transform-style: preserve-3d;
        }

        .feed-badge.live {
          background: linear-gradient(145deg, rgba(63, 185, 80, 0.2), rgba(63, 185, 80, 0.1));
          border-color: rgba(63, 185, 80, 0.4);
          color: #3fb950;
          box-shadow: 
            0 0 20px rgba(63, 185, 80, 0.3),
            inset 0 1px 0 rgba(255, 255, 255, 0.1);
          animation: pulse-glow 2s ease-in-out infinite;
        }

        .feed-badge.stale {
          background: linear-gradient(145deg, rgba(248, 81, 73, 0.2), rgba(248, 81, 73, 0.1));
          border-color: rgba(248, 81, 73, 0.4);
          color: #f85149;
          box-shadow: 0 0 15px rgba(248, 81, 73, 0.2);
        }

        .account-info {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 13px;
          color: #8b949e;
          background: linear-gradient(145deg, rgba(48, 54, 61, 0.5), rgba(13, 17, 23, 0.7));
          padding: 8px 16px;
          border-radius: 20px;
          border: 1px solid rgba(255, 255, 255, 0.05);
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
          transition: all 0.3s ease;
        }

        .atlas-avatar {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: linear-gradient(135deg, #0095f6, #00c6ff);
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 600;
          font-size: 12px;
          color: white;
        }

        .atlas-name {
          font-weight: 600;
          color: #e6edf3;
        }

        .account-info:hover {
          background: linear-gradient(145deg, rgba(88, 166, 255, 0.1), rgba(35, 134, 54, 0.1));
          border-color: rgba(88, 166, 255, 0.2);
          transform: translateY(-2px);
        }

        .logout-btn {
          color: #f85149;
          text-decoration: none;
          font-size: 13px;
          padding: 10px 18px;
          border-radius: 12px;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          background: linear-gradient(145deg, rgba(248, 81, 73, 0.1), rgba(248, 81, 73, 0.05));
          border: 1px solid rgba(248, 81, 73, 0.2);
          box-shadow: 0 2px 10px rgba(248, 81, 73, 0.1);
        }

        .logout-btn:hover {
          background: linear-gradient(145deg, rgba(248, 81, 73, 0.2), rgba(248, 81, 73, 0.1));
          border-color: rgba(248, 81, 73, 0.4);
          transform: translateY(-2px) rotateX(5deg);
          box-shadow: 0 8px 25px rgba(248, 81, 73, 0.2);
        }

        .terminal-layout {
          display: flex;
          flex: 1;
          overflow: hidden;
          perspective: 1000px;
        }

        .sidebar-left {
          width: 280px;
          background: rgba(13, 17, 23, 0.8);
          border-right: 1px solid rgba(48, 54, 61, 0.4);
          overflow-y: auto;
          transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 5px 0 30px rgba(0, 0, 0, 0.3);
          transform-style: preserve-3d;
        }

        .sidebar-left.collapsed {
          width: 60px;
          transform: rotateY(-5deg);
        }

        .main-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          padding: 20px;
          overflow-y: auto;
          animation: fade-in 0.8s ease-out;
        }

        .sidebar-right {
          width: 320px;
          background: rgba(13, 17, 23, 0.8);
          border-left: 1px solid rgba(48, 54, 61, 0.4);
          overflow-y: auto;
          box-shadow: -5px 0 30px rgba(0, 0, 0, 0.3);
          transform-style: preserve-3d;
        }
        
        /* Select dropdown 3D */
        select {
          appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2358a6ff' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 12px center;
          padding-right: 36px !important;
        }
        
        select:hover {
          border-color: rgba(88, 166, 255, 0.5) !important;
          box-shadow: 0 0 20px rgba(88, 166, 255, 0.2);
        }
        
        select:focus {
          outline: none;
          border-color: rgba(88, 166, 255, 0.6) !important;
          box-shadow: 0 0 25px rgba(88, 166, 255, 0.3);
        }
      `}</style>
    </div>
  )
}

// Dashboard Sidebar Component
function DashboardSidebar({ 
  assets, 
  watchlist,
  selectedAsset, 
  onSelectAsset,
  loading,
  flashMap,
  flashKey,
  getSourcesForSymbol,
}: { 
  assets: AssetItem[]
  watchlist: AssetItem[]
  selectedAsset: string
  onSelectAsset: (symbol: string) => void
  loading: boolean
  flashMap: Map<string, 'up' | 'down'>
  flashKey: number
  getSourcesForSymbol: (symbol: string) => AssetSource | undefined
}) {
  if (loading) {
    return (
      <div className="dashboard-panel">
        <div className="loading-state">Carregando...</div>
      </div>
    )
  }

  return (
    <div className="dashboard-panel" data-flash={flashKey}>
      <div className="dashboard-section">
        <h3 className="section-title">Watchlist</h3>
        <div className="asset-list">
          {watchlist.map(asset => (
            <div 
              key={asset.symbol}
              className={`asset-item ${selectedAsset === asset.symbol ? 'selected' : ''} ${flashMap.get(asset.symbol) === 'up' ? 'flash-up' : flashMap.get(asset.symbol) === 'down' ? 'flash-down' : ''}`}
              onClick={() => onSelectAsset(asset.symbol)}
            >
              <div className="asset-info">
                <span className="asset-symbol">{asset.symbol}</span>
                <div className="asset-name">
                  {asset.name}
                  {(() => {
                    const meta = getSourcesForSymbol(asset.symbol)
                    const srcs = meta ? Array.from(meta.bySource.entries()).sort((a, b) => b[1] - a[1]).map(([s]) => s) : []
                    if (srcs.length === 0) return null
                    return (
                      <span style={{ opacity: 0.65, marginLeft: 8, fontSize: 12 }}>
                        {srcs.slice(0, 3).join(' / ')}
                      </span>
                    )
                  })()}
                </div>
              </div>
              <div className="asset-price">
                <span className="price-value">
                  {asset.price > 100 ? `$${asset.price.toFixed(2)}` : `$${asset.price.toFixed(4)}`}
                </span>
                <span className={`price-change ${asset.change >= 0 ? 'positive' : 'negative'}`}>
                  {asset.change >= 0 ? '+' : ''}{asset.change.toFixed(2)}%
                </span>
              </div>
              <Sparkline data={asset.sparkline} positive={asset.change >= 0} />
            </div>
          ))}
        </div>
      </div>

      <div className="dashboard-section">
        <h3 className="section-title">Mercado</h3>
        <div className="asset-list">
          {assets.map(asset => (
            <div 
              key={asset.symbol}
              className={`asset-item ${selectedAsset === asset.symbol ? 'selected' : ''} ${flashMap.get(asset.symbol) === 'up' ? 'flash-up' : flashMap.get(asset.symbol) === 'down' ? 'flash-down' : ''}`}
              onClick={() => onSelectAsset(asset.symbol)}
            >
              <div className="asset-info">
                <span className="asset-symbol">{asset.symbol}</span>
                <div className="asset-name">
                  {asset.name}
                  {(() => {
                    const meta = getSourcesForSymbol(asset.symbol)
                    const srcs = meta ? Array.from(meta.bySource.entries()).sort((a, b) => b[1] - a[1]).map(([s]) => s) : []
                    if (srcs.length === 0) return null
                    return (
                      <span style={{ opacity: 0.65, marginLeft: 8, fontSize: 12 }}>
                        {srcs.slice(0, 3).join(' / ')}
                      </span>
                    )
                  })()}
                </div>
              </div>
              <div className="asset-price">
                <span className="price-value">
                  {asset.price > 100 ? `$${asset.price.toFixed(2)}` : `$${asset.price.toFixed(4)}`}
                </span>
                <span className={`price-change ${asset.change >= 0 ? 'positive' : 'negative'}`}>
                  {asset.change >= 0 ? '+' : ''}{asset.change.toFixed(2)}%
                </span>
              </div>
              <Sparkline data={asset.sparkline} positive={asset.change >= 0} />
            </div>
          ))}
        </div>
      </div>

      <style>{`
        .dashboard-panel {
          padding: 16px;
        }

        .loading-state {
          text-align: center;
          padding: 40px 20px;
          color: #8b949e;
          font-size: 14px;
        }

        .dashboard-section {
          margin-bottom: 24px;
        }

        .section-title {
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          color: #8b949e;
          letter-spacing: 0.5px;
          margin-bottom: 12px;
          padding-left: 8px;
        }

        .asset-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .asset-item {
          display: flex;
          flex-direction: column;
          padding: 12px;
          background: rgba(48, 54, 61, 0.2);
          border-radius: 10px;
          cursor: pointer;
          transition: all 0.2s;
          border: 1px solid transparent;
        }

        .asset-item.flash-up {
          border-color: rgba(63, 185, 80, 0.7);
          box-shadow: 0 0 0 1px rgba(63, 185, 80, 0.25);
        }

        .asset-item.flash-down {
          border-color: rgba(248, 81, 73, 0.7);
          box-shadow: 0 0 0 1px rgba(248, 81, 73, 0.25);
        }

        .asset-item:hover {
          background: rgba(48, 54, 61, 0.4);
          border-color: rgba(88, 166, 255, 0.3);
        }

        .asset-item.selected {
          background: rgba(88, 166, 255, 0.1);
          border-color: rgba(88, 166, 255, 0.5);
        }

        .asset-info {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 6px;
        }

        .asset-symbol {
          font-weight: 600;
          font-size: 13px;
          color: #e6edf3;
        }

        .asset-name {
          font-size: 11px;
          color: #8b949e;
        }

        .asset-price {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }

        .price-value {
          font-size: 14px;
          font-weight: 600;
          color: #e6edf3;
        }

        .price-change {
          font-size: 11px;
          font-weight: 500;
          padding: 2px 6px;
          border-radius: 4px;
        }

        .price-change.positive {
          color: #3fb950;
          background: rgba(63, 185, 80, 0.15);
        }

        .price-change.negative {
          color: #f85149;
          background: rgba(248, 81, 73, 0.15);
        }

        .sparkline {
          width: 60px;
          height: 20px;
        }
      `}</style>
    </div>
  )
}

// Messages Panel Component
function MessagesPanel() {
  const [messages] = useState<ChatMessage[]>([
    { id: '1', user: 'Rodrigo Santos', avatar: 'RS', message: 'Oi, tudo bem?', time: '10:30', online: true },
    { id: '2', user: 'Mariana Lopes', avatar: 'ML', message: 'Vamos investir em VALE3?', time: '10:25', online: false },
    { id: '3', user: 'Carlos Eduardo', avatar: 'CE', message: 'O dólar está em queda', time: '10:15', online: true },
    { id: '4', user: 'Ana Paula', avatar: 'AP', message: 'Análise técnica disponível', time: '09:50', online: true },
  ])
  const [selectedChat, setSelectedChat] = useState<string | null>(null)

  return (
    <div className="messages-panel">
      <div className="messages-header">
        <h3>Mensagens Diretas</h3>
      </div>
      
      <div className="messages-list">
        {messages.map(msg => (
          <div 
            key={msg.id} 
            className={`message-item ${selectedChat === msg.id ? 'selected' : ''}`}
            onClick={() => setSelectedChat(msg.id)}
          >
            <div className="message-avatar">
              {msg.avatar}
              {msg.online && <span className="online-indicator" />}
            </div>
            <div className="message-preview">
              <span className="message-user">{msg.user}</span>
              <span className="message-text">{msg.message}</span>
              <span className="message-time">{msg.time}</span>
            </div>
          </div>
        ))}
      </div>

      {selectedChat && (
        <div className="chat-window">
          <div className="chat-header">
            <span>Conversa com {messages.find(m => m.id === selectedChat)?.user}</span>
            <button onClick={() => setSelectedChat(null)}>✕</button>
          </div>
          <div className="chat-messages">
            <div className="chat-bubble received">
              <p>Olá! Como posso ajudar?</p>
            </div>
            <div className="chat-bubble sent">
              <p>Quero saber sobre VALE3</p>
            </div>
          </div>
          <div className="chat-input">
            <input type="text" placeholder="Digite sua mensagem..." />
            <button>Enviar</button>
          </div>
        </div>
      )}

      <style>{`
        .messages-panel {
          height: 100%;
          display: flex;
          flex-direction: column;
          position: relative;
        }

        .messages-header {
          padding: 16px;
          border-bottom: 1px solid rgba(48, 54, 61, 0.4);
        }

        .messages-header h3 {
          margin: 0;
          font-size: 14px;
          font-weight: 600;
          color: #e6edf3;
        }

        .messages-list {
          flex: 1;
          overflow-y: auto;
        }

        .message-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          cursor: pointer;
          transition: background 0.2s;
        }

        .message-item:hover {
          background: rgba(48, 54, 61, 0.3);
        }

        .message-item.selected {
          background: rgba(88, 166, 255, 0.1);
        }

        .message-avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: linear-gradient(135deg, #58a6ff 0%, #238636 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 600;
          color: white;
          position: relative;
          flex-shrink: 0;
        }

        .online-indicator {
          position: absolute;
          bottom: 0;
          right: 0;
          width: 10px;
          height: 10px;
          background: #3fb950;
          border-radius: 50%;
          border: 2px solid #0d1117;
        }

        .message-preview {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }

        .message-user {
          font-size: 13px;
          font-weight: 600;
          color: #e6edf3;
        }

        .message-text {
          font-size: 12px;
          color: #8b949e;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .message-time {
          font-size: 11px;
          color: #6e7681;
        }

        .chat-window {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 300px;
          background: rgba(13, 17, 23, 0.98);
          border-top: 1px solid rgba(48, 54, 61, 0.6);
          display: flex;
          flex-direction: column;
        }

        .chat-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          border-bottom: 1px solid rgba(48, 54, 61, 0.4);
        }

        .chat-header span {
          font-size: 13px;
          font-weight: 600;
          color: #e6edf3;
        }

        .chat-header button {
          background: none;
          border: none;
          color: #8b949e;
          cursor: pointer;
          font-size: 16px;
        }

        .chat-messages {
          flex: 1;
          padding: 16px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .chat-bubble {
          max-width: 80%;
          padding: 12px 16px;
          border-radius: 16px;
          font-size: 13px;
        }

        .chat-bubble.received {
          background: rgba(48, 54, 61, 0.6);
          color: #e6edf3;
          align-self: flex-start;
          border-bottom-left-radius: 4px;
        }

        .chat-bubble.sent {
          background: linear-gradient(135deg, #58a6ff 0%, #238636 100%);
          color: white;
          align-self: flex-end;
          border-bottom-right-radius: 4px;
        }

        .chat-input {
          display: flex;
          gap: 8px;
          padding: 12px 16px;
          border-top: 1px solid rgba(48, 54, 61, 0.4);
        }

        .chat-input input {
          flex: 1;
          padding: 10px 14px;
          background: rgba(48, 54, 61, 0.4);
          border: 1px solid rgba(48, 54, 61, 0.6);
          border-radius: 20px;
          color: #e6edf3;
          font-size: 13px;
        }

        .chat-input button {
          padding: 10px 20px;
          background: linear-gradient(135deg, #58a6ff 0%, #238636 100%);
          border: none;
          border-radius: 20px;
          color: white;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }
      `}</style>
    </div>
  )
}
