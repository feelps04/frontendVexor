import { useState, useEffect, useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import { apiGet } from '../../lib/api'

interface PortfolioContext {
  accountId: string
}

type BalanceRes = {
  accountId: string
  balance: number
}

type BalanceSeriesRes = {
  accountId: string
  points: Array<{ time: number; balanceBrl: number }>
}

export default function PortfolioPage() {
  const { accountId } = useOutletContext<PortfolioContext>()
  const [balance, setBalance] = useState<number | null>(null)
  const [series, setSeries] = useState<Array<{ time: number; balanceBrl: number }>>([])
  const [loading, setLoading] = useState(true)
  const [selectedTimeframe, setSelectedTimeframe] = useState('1d')
  const [error, setError] = useState<string | null>(null)

  // Load portfolio data
  useEffect(() => {
    async function loadPortfolio() {
      try {
        setError(null)
        if (!accountId) throw new Error('accountId não encontrado')

        const bal = await apiGet<BalanceRes>(`/api/v1/accounts/${encodeURIComponent(accountId)}/balance`)
        setBalance(Number(bal.balance))

        const s = await apiGet<BalanceSeriesRes>(
          `/api/v1/accounts/${encodeURIComponent(accountId)}/balance-series`
        )
        setSeries(Array.isArray(s.points) ? s.points : [])
      } catch (err) {
        console.error('Failed to load portfolio:', err)
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    }
    
    loadPortfolio()
    const interval = setInterval(loadPortfolio, 30000)
    return () => clearInterval(interval)
  }, [accountId])

  const balanceBr = useMemo(() => {
    if (balance == null) return '—'
    return balance.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }, [balance])

  if (loading) {
    return (
      <div className="portfolio-page">
        <div className="loading-state">Carregando portfolio...</div>
      </div>
    )
  }

  return (
    <div className="portfolio-page">
      {/* Header */}
      <div className="portfolio-header">
        <h1>Minha Carteira</h1>
        <div className="timeframe-selector">
          {['1d', '1w', '1m', '3m', '1y', 'all'].map(tf => (
            <button
              key={tf}
              className={`timeframe-btn ${selectedTimeframe === tf ? 'active' : ''}`}
              onClick={() => setSelectedTimeframe(tf)}
            >
              {tf === 'all' ? 'Tudo' : tf.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="stats-cards">
        <div className="stat-card large">
          <span className="stat-label">Saldo (BRL)</span>
          <span className="stat-value">R$ {balanceBr}</span>
          {error ? <span className="stat-change negative">{error}</span> : null}
        </div>
        <div className="stat-card">
          <span className="stat-label">Conta</span>
          <span className="stat-value">{accountId || '—'}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Pontos (saldo)</span>
          <span className="stat-value">{series.length}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Posições</span>
          <span className="stat-value">0</span>
        </div>
      </div>

      {/* Balance History */}
      <div className="positions-section">
        <div className="section-header">
          <h2>Histórico de Saldo</h2>
          <div className="section-actions">
            <button className="btn-action">⬇️ Exportar</button>
            <button className="btn-action">📊 Gráfico</button>
          </div>
        </div>

        <div className="positions-table">
          <div className="table-header">
            <span>Data/Hora</span>
            <span>Saldo (BRL)</span>
          </div>

          {series.length === 0 ? (
            <div className="empty-state">
              <p>Nenhum ponto de saldo encontrado</p>
              <span>Use depósitos/saques para gerar histórico</span>
            </div>
          ) : (
            series
              .slice(-25)
              .reverse()
              .map((p) => (
                <div key={p.time} className="table-row">
                  <span>{new Date(p.time * 1000).toLocaleString('pt-BR')}</span>
                  <span>R$ {Number(p.balanceBrl).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              ))
          )}
        </div>
      </div>

      {/* Allocation Section */}
      <div className="allocation-section">
        <div className="allocation-card">
          <h3>Posições</h3>
          <div style={{ padding: 12, color: '#8b949e', fontSize: 14 }}>
            Este backend ainda não expõe um endpoint de posições/portfolio (ativos e quantidades) como no MetaTrader.
            Por enquanto, esta tela mostra apenas saldo real e histórico de saldo.
          </div>
        </div>
      </div>

      <style>{`
        .portfolio-page {
          padding: 20px;
          max-width: 1400px;
          margin: 0 auto;
        }

        .loading-state {
          text-align: center;
          padding: 60px 20px;
          color: #8b949e;
          font-size: 16px;
        }

        .portfolio-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
        }

        .portfolio-header h1 {
          margin: 0;
          font-size: 24px;
          font-weight: 700;
          color: #e6edf3;
        }

        .timeframe-selector {
          display: flex;
          gap: 8px;
          background: rgba(48, 54, 61, 0.3);
          padding: 4px;
          border-radius: 8px;
        }

        .timeframe-btn {
          padding: 8px 16px;
          background: none;
          border: none;
          color: #8b949e;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          border-radius: 6px;
          transition: all 0.2s;
        }

        .timeframe-btn.active {
          background: rgba(88, 166, 255, 0.2);
          color: #58a6ff;
        }

        .timeframe-btn:not(.active):hover {
          color: #e6edf3;
        }

        .stats-cards {
          display: grid;
          grid-template-columns: 2fr 1fr 1fr 1fr;
          gap: 16px;
          margin-bottom: 24px;
        }

        .stat-card {
          background: rgba(48, 54, 61, 0.2);
          border-radius: 12px;
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .stat-card.large {
          background: linear-gradient(135deg, rgba(88, 166, 255, 0.1) 0%, rgba(35, 134, 54, 0.1) 100%);
          border: 1px solid rgba(88, 166, 255, 0.2);
        }

        .stat-label {
          font-size: 12px;
          color: #8b949e;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .stat-value {
          font-size: 24px;
          font-weight: 700;
          color: #e6edf3;
        }

        .stat-value.positive {
          color: #3fb950;
        }

        .stat-value.negative {
          color: #f85149;
        }

        .stat-change {
          font-size: 14px;
          font-weight: 500;
          padding: 4px 8px;
          border-radius: 4px;
          width: fit-content;
        }

        .stat-change.positive {
          color: #3fb950;
          background: rgba(63, 185, 80, 0.15);
        }

        .stat-change.negative {
          color: #f85149;
          background: rgba(248, 81, 73, 0.15);
        }

        .positions-section {
          background: rgba(48, 54, 61, 0.2);
          border-radius: 12px;
          padding: 20px;
          margin-bottom: 24px;
        }

        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }

        .section-header h2 {
          margin: 0;
          font-size: 18px;
          font-weight: 600;
          color: #e6edf3;
        }

        .section-actions {
          display: flex;
          gap: 8px;
        }

        .btn-action {
          padding: 8px 16px;
          background: rgba(48, 54, 61, 0.4);
          border: none;
          border-radius: 6px;
          color: #e6edf3;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-action:hover {
          background: rgba(48, 54, 61, 0.6);
        }

        .positions-table {
          overflow-x: auto;
        }

        .table-header {
          display: grid;
          grid-template-columns: 1.5fr 0.8fr 1fr 1fr 1fr 1fr 0.8fr 1fr;
          gap: 12px;
          padding: 12px 16px;
          background: rgba(48, 54, 61, 0.4);
          border-radius: 8px;
          font-size: 11px;
          font-weight: 600;
          color: #8b949e;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .table-row {
          display: grid;
          grid-template-columns: 1.5fr 0.8fr 1fr 1fr 1fr 1fr 0.8fr 1fr;
          gap: 12px;
          padding: 16px;
          border-bottom: 1px solid rgba(48, 54, 61, 0.3);
          font-size: 14px;
          color: #e6edf3;
          align-items: center;
        }

        .table-row:last-child {
          border-bottom: none;
        }

        .asset-cell {
          display: flex;
          flex-direction: column;
        }

        .asset-symbol {
          font-weight: 600;
          color: #e6edf3;
        }

        .quantity-cell, .price-cell, .value-cell {
          font-family: monospace;
        }

        .pnl-cell {
          font-family: monospace;
          font-weight: 600;
        }

        .pnl-cell.positive {
          color: #3fb950;
        }

        .pnl-cell.negative {
          color: #f85149;
        }

        .actions-cell {
          display: flex;
          gap: 8px;
        }

        .btn-trade-sm {
          width: 32px;
          height: 32px;
          border: none;
          border-radius: 6px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-trade-sm.buy {
          background: rgba(63, 185, 80, 0.2);
          color: #3fb950;
        }

        .btn-trade-sm.buy:hover {
          background: rgba(63, 185, 80, 0.3);
        }

        .btn-trade-sm.sell {
          background: rgba(248, 81, 73, 0.2);
          color: #f85149;
        }

        .btn-trade-sm.sell:hover {
          background: rgba(248, 81, 73, 0.3);
        }

        .empty-state {
          text-align: center;
          padding: 60px 20px;
        }

        .empty-state p {
          margin: 0 0 8px 0;
          font-size: 16px;
          color: #e6edf3;
        }

        .empty-state span {
          font-size: 14px;
          color: #8b949e;
        }

        .allocation-section {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
        }

        .allocation-card {
          background: rgba(48, 54, 61, 0.2);
          border-radius: 12px;
          padding: 20px;
        }

        .allocation-card h3 {
          margin: 0 0 20px 0;
          font-size: 16px;
          font-weight: 600;
          color: #e6edf3;
        }

        .allocation-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .allocation-item {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .allocation-info {
          width: 80px;
          display: flex;
          flex-direction: column;
        }

        .allocation-asset {
          font-weight: 600;
          color: #e6edf3;
          font-size: 13px;
        }

        .allocation-percent {
          font-size: 12px;
          color: #58a6ff;
        }

        .allocation-bar {
          flex: 1;
          height: 8px;
          background: rgba(48, 54, 61, 0.4);
          border-radius: 4px;
          overflow: hidden;
        }

        .allocation-fill {
          height: 100%;
          background: linear-gradient(90deg, #58a6ff 0%, #238636 100%);
          border-radius: 4px;
          transition: width 0.3s ease;
        }

        .allocation-value {
          width: 80px;
          text-align: right;
          font-family: monospace;
          font-size: 13px;
          color: #e6edf3;
        }

        .performance-metrics {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .metric {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 16px;
          background: rgba(48, 54, 61, 0.3);
          border-radius: 8px;
        }

        .metric-label {
          font-size: 12px;
          color: #8b949e;
        }

        .metric-value {
          font-size: 18px;
          font-weight: 600;
          color: #e6edf3;
        }

        .metric-value.positive {
          color: #3fb950;
        }

        .metric-value.negative {
          color: #f85149;
        }

        .metric-sub {
          font-size: 13px;
          color: #8b949e;
        }

        @media (max-width: 768px) {
          .stats-cards {
            grid-template-columns: 1fr;
          }
          
          .allocation-section {
            grid-template-columns: 1fr;
          }
          
          .table-header,
          .table-row {
            grid-template-columns: 1.5fr 0.8fr 1fr 1fr;
          }
          
          .table-header > *:nth-child(5),
          .table-header > *:nth-child(6),
          .table-header > *:nth-child(7),
          .table-row > *:nth-child(5),
          .table-row > *:nth-child(6),
          .table-row > *:nth-child(7) {
            display: none;
          }
        }
      `}</style>
    </div>
  )
}
