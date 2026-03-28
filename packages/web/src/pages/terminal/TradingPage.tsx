import { useEffect, useRef, useState, useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import TradingViewWidget from '../../components/TradingViewWidget'
import { apiPost } from '../../lib/api'

// ── Binance WebSocket para ticks de crypto ────────────────────────────────────
const BINANCE_WS = 'wss://stream.binance.com:9443/ws'

function toBinanceStream(symbol: string): string | null {
  const s = symbol.toUpperCase().replace(/USD$/, 'USDT').replace(/\..*$/, '')
  const cryptoBases = ['BTC','ETH','SOL','BNB','XRP','ADA','DOGE','DOT','LTC','AVAX',
    'MATIC','LINK','UNI','ATOM','APT','ARB','NEAR','BCH','TRX','ALGO']
  if (cryptoBases.some(b => s.startsWith(b))) {
    const pair = s.endsWith('USDT') ? s : s + 'USDT'
    return `${pair.toLowerCase()}@ticker`
  }
  return null
}

interface AssetItem { symbol: string; name: string; price: number; change: number }
interface TradingContext { selectedAsset: string; assets: AssetItem[]; accountId: string }

export default function TradingPage() {
  const { selectedAsset, accountId } = useOutletContext<TradingContext>()

  const [interval, setInterval] = useState('15')
  const [quote, setQuote] = useState<number | null>(null)
  const [change24h, setChange24h] = useState<number | null>(null)
  const [amount, setAmount] = useState('')
  const [orderType, setOrderType] = useState<'buy' | 'sell'>('buy')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  // Conectar Binance WS para crypto
  useEffect(() => {
    wsRef.current?.close()
    wsRef.current = null

    const stream = toBinanceStream(selectedAsset)
    if (!stream) return

    const ws = new WebSocket(`${BINANCE_WS}/${stream}`)
    wsRef.current = ws

    ws.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data)
        if (d.c) setQuote(parseFloat(d.c))
        if (d.P) setChange24h(parseFloat(d.P))
      } catch { /* ignore */ }
    }

    return () => { ws.close() }
  }, [selectedAsset])

  const isCrypto = toBinanceStream(selectedAsset) !== null
  const canTrade = !selectedAsset.includes('USD') || isCrypto

  const total = useMemo(() => {
    if (!quote || !amount) return null
    const qty = parseFloat(amount.replace(',', '.'))
    if (!isFinite(qty) || qty <= 0) return null
    return qty * quote
  }, [amount, quote])

  function genKey() {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`
  }

  async function submitOrder(e: React.FormEvent) {
    e.preventDefault()
    if (!canTrade) return
    setSubmitting(true); setError(null)
    try {
      if (!accountId) throw new Error('accountId não encontrado')
      const qty = parseFloat(amount.replace(',', '.'))
      if (!isFinite(qty) || qty <= 0) throw new Error('Quantidade inválida')
      const res = await apiPost<any>('/api/v1/orders/stock', {
        accountId, symbol: selectedAsset, quantity: qty, idempotencyKey: genKey(),
      })
      alert(`Ordem enviada. Status: ${String(res?.status ?? 'PENDING')}`)
      setAmount('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="trading-page">
      {/* Header */}
      <div className="trading-header">
        <div className="asset-info">
          <h1>{selectedAsset}</h1>
          <span className="asset-subtitle">TradingView · Binance</span>
        </div>
        <div className="price-display">
          <span className="current-price">
            {quote ? `$${quote.toFixed(quote > 100 ? 2 : 4)}` : '—'}
          </span>
          {change24h !== null && (
            <span className={`price-change ${change24h >= 0 ? 'positive' : 'negative'}`}>
              {change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}%
            </span>
          )}
        </div>
      </div>

      {error && (
        <div style={{ marginBottom: 16, padding: 12, borderRadius: 10,
          border: '1px solid rgba(248,81,73,0.3)', background: 'rgba(248,81,73,0.08)', color: '#f85149' }}>
          {error}
        </div>
      )}

      {/* Controles de intervalo */}
      <div className="chart-controls">
        <div className="time-controls" style={{ display: 'flex', gap: 6 }}>
          {['1','5','15','60','D','W'].map(tf => (
            <button key={tf}
              onClick={() => setInterval(tf)}
              style={{
                padding: '4px 10px',
                background: interval === tf ? 'rgba(0,255,200,0.15)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${interval === tf ? 'rgba(0,255,200,0.4)' : 'rgba(255,255,255,0.1)'}`,
                borderRadius: 4, color: interval === tf ? '#00ffc8' : '#8b949e',
                cursor: 'pointer', fontSize: 11,
              }}>
              {tf === 'D' ? '1D' : tf === 'W' ? '1W' : `${tf}m`}
            </button>
          ))}
        </div>
      </div>

      {/* Gráfico TradingView */}
      <div className="chart-container" style={{ marginBottom: 24 }}>
        <TradingViewWidget
          symbol={selectedAsset}
          interval={interval}
          height={450}
          hideSideToolbar={false}
          allowSymbolChange={false}
        />
      </div>

      {/* Painel de ordem */}
      {canTrade && (
        <form onSubmit={submitOrder} style={{
          background: 'rgba(22,27,34,0.8)', border: '1px solid rgba(48,54,61,0.6)',
          borderRadius: 12, padding: 20, maxWidth: 400,
        }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {(['buy','sell'] as const).map(side => (
              <button key={side} type="button" onClick={() => setOrderType(side)}
                style={{
                  flex: 1, padding: '10px 0', borderRadius: 8, cursor: 'pointer',
                  fontWeight: 600, fontSize: 14, border: 'none',
                  background: orderType === side
                    ? side === 'buy' ? '#3fb950' : '#f85149'
                    : 'rgba(255,255,255,0.06)',
                  color: orderType === side ? '#fff' : '#8b949e',
                }}>
                {side === 'buy' ? 'Comprar' : 'Vender'}
              </button>
            ))}
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: '#8b949e', display: 'block', marginBottom: 4 }}>
              Quantidade
            </label>
            <input
              type="number" step="any" value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 8,
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                color: '#e6edf3', fontSize: 14, boxSizing: 'border-box',
              }} />
          </div>

          {total !== null && (
            <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 12 }}>
              Total estimado: <strong style={{ color: '#e6edf3' }}>${total.toFixed(2)}</strong>
            </div>
          )}

          <button type="submit" disabled={submitting || !amount}
            style={{
              width: '100%', padding: '12px 0', borderRadius: 8, cursor: 'pointer',
              fontWeight: 700, fontSize: 14, border: 'none',
              background: orderType === 'buy'
                ? 'linear-gradient(135deg,#3fb950,#2ea043)'
                : 'linear-gradient(135deg,#f85149,#da3633)',
              color: '#fff', opacity: submitting || !amount ? 0.5 : 1,
            }}>
            {submitting ? 'Enviando...' : orderType === 'buy' ? `Comprar ${selectedAsset}` : `Vender ${selectedAsset}`}
          </button>
        </form>
      )}
    </div>
  )
}
