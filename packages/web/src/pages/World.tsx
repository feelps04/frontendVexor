import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

interface Price {
  symbol: string
  price: number
  change: number
}

export default function WorldPage() {
  const [prices, setPrices] = useState<Record<string, Price>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchPrices() {
      try {
        const res = await fetch('/api/v1/prices/crypto')
        const data = await res.json()
        setPrices(data.prices || data)
      } catch (e) {
        console.error('Failed to fetch prices:', e)
      } finally {
        setLoading(false)
      }
    }
    fetchPrices()
    const interval = setInterval(fetchPrices, 5000)
    return () => clearInterval(interval)
  }, [])

  const cryptoSymbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT']

  return (
    <div className="world-page">
      <header className="world-header">
        <Link to="/app" className="back-link">← VOLTAR</Link>
        <h1>🌍 VEXOR WORLD</h1>
        <p className="subtitle">Mercado Global em Tempo Real</p>
      </header>

      <div className="world-content">
        <section className="prices-section">
          <h2>📈 Crypto 24/7</h2>
          {loading ? (
            <div className="loading">Carregando...</div>
          ) : (
            <div className="prices-grid">
              {cryptoSymbols.map(symbol => {
                const p = prices[symbol]
                if (!p) return null
                const isUp = (p.change || 0) >= 0
                return (
                  <div key={symbol} className="price-card">
                    <div className="symbol">{symbol.replace('USDT', '/USDT')}</div>
                    <div className="price">${p.price?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}</div>
                    <div className={`change ${isUp ? 'up' : 'down'}`}>
                      {isUp ? '▲' : '▼'} {Math.abs(p.change || 0).toFixed(2)}%
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <section className="map-section">
          <h2>🗺️ Mapa de Mercado</h2>
          <div className="map-placeholder">
            <div className="region americas">
              <span className="region-name">Américas</span>
              <span className="region-status active">● Ativo</span>
            </div>
            <div className="region europe">
              <span className="region-name">Europa</span>
              <span className="region-status active">● Ativo</span>
            </div>
            <div className="region asia">
              <span className="region-name">Ásia</span>
              <span className="region-status active">● Ativo</span>
            </div>
          </div>
        </section>
      </div>

      <style>{`
        .world-page { min-height: 100vh; background: #000; color: #fff; font-family: 'Space Grotesk', sans-serif; padding: 20px; }
        .world-header { text-align: center; margin-bottom: 40px; padding-top: 20px; }
        .world-header h1 { font-family: 'Orbitron', sans-serif; font-size: 32px; color: #00FFFF; margin: 10px 0; }
        .world-header .subtitle { color: rgba(255,255,255,0.5); font-size: 12px; letter-spacing: 0.2em; text-transform: uppercase; }
        .back-link { color: rgba(255,255,255,0.5); text-decoration: none; font-size: 12px; position: absolute; left: 20px; top: 20px; }
        .back-link:hover { color: #00FFFF; }
        .world-content { max-width: 1200px; margin: 0 auto; }
        .prices-section, .map-section { margin-bottom: 40px; }
        .prices-section h2, .map-section h2 { font-family: 'Orbitron', sans-serif; font-size: 18px; color: #00FFFF; margin-bottom: 20px; }
        .loading { text-align: center; color: rgba(255,255,255,0.5); padding: 40px; }
        .prices-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; }
        .price-card { background: rgba(0,255,255,0.05); border: 1px solid rgba(0,255,255,0.2); border-radius: 12px; padding: 20px; text-align: center; }
        .price-card .symbol { font-size: 12px; color: rgba(255,255,255,0.6); margin-bottom: 8px; }
        .price-card .price { font-family: 'JetBrains Mono', monospace; font-size: 20px; color: #fff; margin-bottom: 4px; }
        .price-card .change { font-size: 12px; }
        .price-card .change.up { color: #00FF88; }
        .price-card .change.down { color: #FF4444; }
        .map-placeholder { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; padding: 40px; background: rgba(0,255,255,0.02); border-radius: 16px; border: 1px solid rgba(0,255,255,0.1); }
        .region { padding: 30px; background: rgba(0,0,0,0.4); border-radius: 12px; text-align: center; }
        .region-name { display: block; font-size: 16px; color: #fff; margin-bottom: 10px; }
        .region-status { font-size: 11px; }
        .region-status.active { color: #00FF88; }
        @media (max-width: 768px) { .map-placeholder { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  )
}
