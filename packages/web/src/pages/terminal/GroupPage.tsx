import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { apiGet } from '../../lib/api'

type GroupSymbolsResponse = {
  group: string
  total: number
  symbols: string[]
}

type AssetItem = {
  symbol: string
  name: string
  price: number
  change: number
}

type TerminalContext = {
  selectedAsset: string
  setSelectedAsset: (symbol: string) => void
  assets: AssetItem[]
  accountId: string
}

type AISignal = {
  symbol: string
  action: 'BUY' | 'SELL' | 'HOLD'
  entry_price?: number
  exit_price?: number
  pnl?: number
  timestamp: string
  agents: string[]
  confidence: number
}

export function GroupPage() {
  const navigate = useNavigate()
  const params = useParams()
  const group = String(params.group || '').toUpperCase()
  const { selectedAsset, setSelectedAsset } = useOutletContext<TerminalContext>()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [total, setTotal] = useState<number>(0)
  const [symbols, setSymbols] = useState<string[]>([])
  const [limit, setLimit] = useState<number>(400)
  const [q, setQ] = useState<string>('')
  const [aiSignals, setAiSignals] = useState<Map<string, AISignal>>(new Map())

  useEffect(() => {
    setLimit(400)
    setQ('')
  }, [group])

  // Load AI signals for symbols
  useEffect(() => {
    let cancelled = false
    async function loadSignals() {
      if (symbols.length === 0) return
      try {
        const res = await apiGet<{ signals: AISignal[] }>(`/api/v1/ai/signals?symbols=${encodeURIComponent(symbols.slice(0, 100).join(','))}`)
        if (cancelled) return
        if (res?.signals) {
          const map = new Map<string, AISignal>()
          res.signals.forEach(s => map.set(s.symbol.toUpperCase(), s))
          setAiSignals(map)
        }
      } catch (e) {
        // Ignore signal errors
      }
    }
    void loadSignals()
    return () => { cancelled = true }
  }, [symbols])

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!group) {
        setSymbols([])
        setTotal(0)
        setLoading(false)
        return
      }
      setLoading(true)
      setError(null)
      try {
        const res = await apiGet<GroupSymbolsResponse>(
          `/api/v1/market/groups/${encodeURIComponent(group)}/symbols?limit=${encodeURIComponent(String(limit))}`
        )
        if (cancelled) return
        setSymbols(Array.isArray(res?.symbols) ? res.symbols : [])
        setTotal(Number(res?.total) || 0)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setSymbols([])
        setTotal(0)
      } finally {
        if (cancelled) return
        setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [group, limit])

  const filtered = useMemo(() => {
    const qq = String(q || '').trim().toUpperCase()
    if (!qq) return symbols
    return symbols.filter((s) => String(s || '').toUpperCase().includes(qq))
  }, [q, symbols])

  const canLoadMore = useMemo(() => {
    const t = Number(total) || 0
    if (t <= 0) return symbols.length > 0 && symbols.length >= limit
    return symbols.length < t
  }, [limit, symbols.length, total])

  return (
    <div style={{ display: 'grid', gap: 14, maxWidth: 1200 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link to="/app/groups" style={{ color: '#58a6ff', textDecoration: 'none' }}>
            ← Grupos
          </Link>
          <div>
            <div style={{ fontSize: 12, color: '#8b949e' }}>Coleção</div>
            <h2 style={{ margin: 0 }}>{group || '—'}</h2>
          </div>
        </div>

        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 12, color: '#8b949e' }}>Carregados</div>
          <div style={{ fontWeight: 900 }}>{symbols.length}{total ? ` / ${total}` : ''}</div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ color: '#8b949e', fontSize: 13 }}>
          Mostrando: <span style={{ color: '#e6edf3', fontWeight: 900 }}>{filtered.length}</span>
        </div>
        <button
          onClick={() => navigate('/app/trading')}
          disabled={!selectedAsset}
          style={{
            height: 36,
            padding: '0 12px',
            borderRadius: 10,
            border: '1px solid rgba(48, 54, 61, 0.5)',
            background: selectedAsset ? 'rgba(88, 166, 255, 0.12)' : 'rgba(48, 54, 61, 0.18)',
            color: selectedAsset ? '#58a6ff' : '#8b949e',
            fontWeight: 900,
            cursor: selectedAsset ? 'pointer' : 'not-allowed',
          }}
        >
          Abrir Trading
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 10, alignItems: 'end' }}>
        <div>
          <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 6 }}>Buscar ativo no grupo</div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ex: CYRE4"
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid rgba(48, 54, 61, 0.6)',
              background: 'rgba(13, 17, 23, 0.6)',
              color: '#e6edf3',
              fontSize: 13,
            }}
          />
        </div>

        <button
          onClick={() => setLimit((x) => Math.min(5000, x + 400))}
          disabled={!canLoadMore || loading}
          style={{
            height: 40,
            borderRadius: 10,
            border: '1px solid rgba(48, 54, 61, 0.5)',
            background: !canLoadMore || loading ? 'rgba(48, 54, 61, 0.18)' : 'rgba(88, 166, 255, 0.12)',
            color: !canLoadMore || loading ? '#8b949e' : '#58a6ff',
            fontWeight: 900,
            cursor: !canLoadMore || loading ? 'not-allowed' : 'pointer',
          }}
        >
          Carregar mais
        </button>
      </div>

      {loading ? <div style={{ color: '#8b949e' }}>Carregando símbolos...</div> : null}
      {error ? (
        <div style={{ padding: 12, borderRadius: 12, border: '1px solid rgba(248, 81, 73, 0.3)', background: 'rgba(248, 81, 73, 0.08)', color: '#f85149' }}>
          {error}
        </div>
      ) : null}

      <div style={{
        border: '1px solid rgba(48, 54, 61, 0.35)',
        borderRadius: 12,
        background: 'rgba(48, 54, 61, 0.12)',
        overflow: 'hidden',
      }}>
        <div style={{ padding: 12, borderBottom: '1px solid rgba(48, 54, 61, 0.35)', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ color: '#8b949e', fontSize: 13 }}>
            Clique em um ativo para abrir no Trading.
          </div>
          <div style={{ color: '#8b949e', fontSize: 13 }}>
            Selecionado: <span style={{ color: '#e6edf3', fontWeight: 900 }}>{selectedAsset || '—'}</span>
          </div>
        </div>

        <div style={{ maxHeight: '70vh', overflow: 'auto' }}>
          {filtered.map((s) => {
            const sym = String(s || '').toUpperCase()
            const active = sym === String(selectedAsset || '').toUpperCase()
            const signal = aiSignals.get(sym)
            return (
              <button
                key={sym}
                onClick={() => setSelectedAsset(sym)}
                onDoubleClick={() => {
                  setSelectedAsset(sym)
                  navigate('/app/trading')
                }}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 12px',
                  border: 'none',
                  borderBottom: '1px solid rgba(48, 54, 61, 0.22)',
                  background: active ? 'rgba(88, 166, 255, 0.08)' : 'transparent',
                  color: active ? '#58a6ff' : '#e6edf3',
                  cursor: 'pointer',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <span>{sym}</span>
                {signal ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {signal.action === 'BUY' && (
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: 4,
                        background: 'rgba(46, 160, 67, 0.15)',
                        border: '1px solid rgba(46, 160, 67, 0.4)',
                        color: '#3fb950',
                        fontSize: 10,
                        fontWeight: 700,
                      }}>
                        🟢 IA: COMPRAR
                        {signal.entry_price && <span style={{ marginLeft: 4, opacity: 0.8 }}>@ {signal.entry_price.toFixed(2)}</span>}
                      </span>
                    )}
                    {signal.action === 'SELL' && (
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: 4,
                        background: 'rgba(248, 81, 73, 0.15)',
                        border: '1px solid rgba(248, 81, 73, 0.4)',
                        color: '#f85149',
                        fontSize: 10,
                        fontWeight: 700,
                      }}>
                        🔴 IA: VENDER
                        {signal.exit_price && <span style={{ marginLeft: 4, opacity: 0.8 }}>@ {signal.exit_price.toFixed(2)}</span>}
                      </span>
                    )}
                    {signal.action === 'HOLD' && signal.pnl !== undefined && signal.pnl !== 0 && (
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: 4,
                        background: signal.pnl >= 0 ? 'rgba(46, 160, 67, 0.15)' : 'rgba(248, 81, 73, 0.15)',
                        border: signal.pnl >= 0 ? '1px solid rgba(46, 160, 67, 0.4)' : '1px solid rgba(248, 81, 73, 0.4)',
                        color: signal.pnl >= 0 ? '#3fb950' : '#f85149',
                        fontSize: 10,
                        fontWeight: 700,
                      }}>
                        {signal.pnl >= 0 ? '📈' : '📉'} Fechado: {signal.pnl >= 0 ? '+' : ''}{signal.pnl.toFixed(2)}
                      </span>
                    )}
                    {signal.confidence > 0 && (
                      <span style={{ fontSize: 9, color: '#8b949e' }}>
                        {signal.confidence.toFixed(0)}%
                      </span>
                    )}
                  </div>
                ) : null}
              </button>
            )
          })}

          {filtered.length === 0 && !loading ? (
            <div style={{ padding: 12, color: '#8b949e' }}>Nenhum ativo encontrado com esse filtro.</div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default GroupPage

