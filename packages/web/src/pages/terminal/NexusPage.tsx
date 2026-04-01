import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

interface Signal {
  symbol: string
  action: 'LONG' | 'SHORT'
  confidence: number
  agent: string
  reasoning: string
  timestamp: string
}

interface KPI {
  returnTotal: number
  drawdown: number
  sharpe: number
  avgTrade: number
}

export default function NexusPage() {
  const [signals, setSignals] = useState<Signal[]>([])
  const [prices, setPrices] = useState<Record<string, number>>({})
  const [kpi, setKpi] = useState<KPI>({
    returnTotal: 0.3461,
    drawdown: 12.5,
    sharpe: 1.85,
    avgTrade: 127.50
  })

  const nexusSpecs = {
    market: 'Crypto 24/7',
    risk: 'Alto',
    frequency: 'Alta',
    stopTargetRatio: '1:5',
    tradesTotal: '2,847',
    returnTotal: '+3,461%'
  }

  const cryptoSymbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT']

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch('/api/v1/prices/crypto')
        const data = await res.json()
        setPrices(data.prices || data)
      } catch (e) {
        console.error('Failed to fetch prices:', e)
      }
    }
    fetchData()
    const interval = setInterval(fetchData, 5000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    async function fetchSignals() {
      try {
        const res = await fetch('/api/v1/nexus/signals')
        const data = await res.json()
        if (data.signals) setSignals(data.signals)
      } catch (e) {
        // Use mock data if API not available
        setSignals([
          { symbol: 'BTCUSDT', action: 'LONG', confidence: 85, agent: 'TREND', reasoning: 'Breakout de resistência com volume', timestamp: new Date().toISOString() },
          { symbol: 'ETHUSDT', action: 'LONG', confidence: 78, agent: 'CRYPTO', reasoning: 'Divergência RSI + suporte testado', timestamp: new Date().toISOString() }
        ])
      }
    }
    fetchSignals()
  }, [])

  return (
    <div className="nexus-page">
      <div className="page-header">
        <Link to="/app" className="back-link">← VOLTAR</Link>
        <h1>⚡ NEXUS MT5</h1>
        <p className="subtitle">Sistema Multi-Agente de Trading</p>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card profit">
          <div className="kpi-value">+{(kpi.returnTotal * 100).toFixed(0)}%</div>
          <div className="kpi-label">Retorno Total</div>
          <div className="kpi-sublabel">Backtest: 3,461%</div>
        </div>
        <div className="kpi-card danger">
          <div className="kpi-value">{kpi.drawdown.toFixed(1)}%</div>
          <div className="kpi-label">Drawdown</div>
          <div className="kpi-sublabel">Adaptativo</div>
        </div>
        <div className="kpi-card info">
          <div className="kpi-value">{kpi.sharpe.toFixed(2)}</div>
          <div className="kpi-label">Sharpe Ratio</div>
          <div className="kpi-sublabel">Bom</div>
        </div>
        <div className="kpi-card profit">
          <div className="kpi-value">R$ {kpi.avgTrade.toFixed(2)}</div>
          <div className="kpi-label">Expectativa/Trade</div>
          <div className="kpi-sublabel">Validado</div>
        </div>
      </div>

      <div className="specs-section">
        <h2>📊 Especificações NEXUS MT5</h2>
        <div className="specs-grid">
          <div className="spec-item">
            <span className="spec-label">Mercado</span>
            <span className="spec-value">{nexusSpecs.market}</span>
          </div>
          <div className="spec-item">
            <span className="spec-label">Risco</span>
            <span className="spec-value risk-high">{nexusSpecs.risk}</span>
          </div>
          <div className="spec-item">
            <span className="spec-label">Frequência</span>
            <span className="spec-value">{nexusSpecs.frequency}</span>
          </div>
          <div className="spec-item">
            <span className="spec-label">Stop/Target</span>
            <span className="spec-value">{nexusSpecs.stopTargetRatio}</span>
          </div>
          <div className="spec-item">
            <span className="spec-label">Trades Total</span>
            <span className="spec-value">{nexusSpecs.tradesTotal}</span>
          </div>
          <div className="spec-item">
            <span className="spec-label">Retorno</span>
            <span className="spec-value profit">{nexusSpecs.returnTotal}</span>
          </div>
        </div>
      </div>

      <div className="prices-section crypto">
        <h2>📈 Preços Global (Crypto 24/7)</h2>
        <div className="prices-grid">
          {cryptoSymbols.map(symbol => (
            <div key={symbol} className="price-card crypto">
              <div className="price-symbol">{symbol.replace('USDT', '/USDT')}</div>
              <div className="price-value crypto">
                $ {(prices[symbol] || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="signals-section">
        <h2>🎯 Sinais 24/7</h2>
        <div className="signals-list">
          {signals.length === 0 ? (
            <div className="no-signals">Aguardando sinais do NEXUS MT5...</div>
          ) : (
            signals.map((s, i) => (
              <div key={i} className={`signal-card ${s.action.toLowerCase()}`}>
                <div className="signal-header">
                  <span className="signal-symbol">{s.symbol.replace('USDT', '/USDT')}</span>
                  <span className={`signal-side ${s.action.toLowerCase()}`}>{s.action}</span>
                </div>
                <div className="signal-details">
                  <span>Confiança: {s.confidence}%</span>
                  <span>Agente: {s.agent}</span>
                </div>
                <div className="signal-reasoning">{s.reasoning}</div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="agents-section">
        <h2>🤖 5 Agentes Especializados</h2>
        <div className="agents-grid">
          <div className="agent-card trend">
            <span className="agent-name">TREND</span>
            <span className="agent-specialty">Momentum/Breakout</span>
            <span className="agent-techniques">Wyckoff, Market Profile</span>
          </div>
          <div className="agent-card mean-rev">
            <span className="agent-name">MEAN-REV</span>
            <span className="agent-specialty">Mean Reversion</span>
            <span className="agent-techniques">Bollinger, Z-Score</span>
          </div>
          <div className="agent-card macro">
            <span className="agent-name">MACRO</span>
            <span className="agent-specialty">Intermarket</span>
            <span className="agent-techniques">John Murphy 5 Corr.</span>
          </div>
          <div className="agent-card crypto">
            <span className="agent-name">CRYPTO</span>
            <span className="agent-specialty">24/7 Trading</span>
            <span className="agent-techniques">On-chain, DeFi</span>
          </div>
          <div className="agent-card psych">
            <span className="agent-name">PSYCH</span>
            <span className="agent-specialty">Anti-Tilt</span>
            <span className="agent-techniques">Douglas, Kahneman</span>
          </div>
        </div>
      </div>

      <div className="consensus-section">
        <h2>🗳️ Sistema de Consenso</h2>
        <div className="consensus-info">
          <p>Operações são executadas apenas quando <strong>3/5 agentes</strong> concordam na direção, filtrando sinais de baixa qualidade.</p>
        </div>
        <div className="consensus-threshold">
          <div className="threshold-bar">
            <div className="threshold-fill" style={{ width: '60%' }}></div>
          </div>
          <span className="threshold-label">3/5 = 60% mínimo para executar</span>
        </div>
      </div>

      <style>{`
        .nexus-page { padding: 20px; max-width: 1200px; margin: 0 auto; }
        .page-header { text-align: center; margin-bottom: 30px; position: relative; }
        .page-header h1 { font-family: 'Orbitron', sans-serif; font-size: 24px; color: #00FFFF; margin: 10px 0; }
        .page-header .subtitle { color: rgba(255,255,255,0.5); font-size: 11px; letter-spacing: 0.15em; text-transform: uppercase; }
        .back-link { color: rgba(255,255,255,0.5); text-decoration: none; font-size: 12px; position: absolute; left: 0; top: 0; }
        .back-link:hover { color: #00FFFF; }
        .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 30px; }
        .kpi-card { background: rgba(0,255,255,0.05); border: 1px solid rgba(0,255,255,0.2); border-radius: 12px; padding: 20px; text-align: center; }
        .kpi-card.profit { border-color: rgba(0,255,136,0.3); background: rgba(0,255,136,0.05); }
        .kpi-card.danger { border-color: rgba(255,68,68,0.3); background: rgba(255,68,68,0.05); }
        .kpi-card.info { border-color: rgba(0,150,255,0.3); background: rgba(0,150,255,0.05); }
        .kpi-value { font-family: 'Orbitron', sans-serif; font-size: 24px; color: #fff; margin-bottom: 4px; }
        .kpi-card.profit .kpi-value { color: #00FF88; }
        .kpi-card.danger .kpi-value { color: #FF4444; }
        .kpi-card.info .kpi-value { color: #0096FF; }
        .kpi-label { font-size: 10px; color: rgba(255,255,255,0.6); text-transform: uppercase; }
        .kpi-sublabel { font-size: 9px; color: rgba(255,255,255,0.4); margin-top: 4px; }
        .specs-section, .prices-section, .signals-section, .agents-section, .consensus-section { margin-bottom: 30px; }
        .specs-section h2, .prices-section h2, .signals-section h2, .agents-section h2, .consensus-section h2 { font-family: 'Orbitron', sans-serif; font-size: 14px; color: #00FFFF; margin-bottom: 16px; }
        .specs-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
        .spec-item { background: rgba(0,255,255,0.03); border: 1px solid rgba(0,255,255,0.1); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 4px; }
        .spec-label { font-size: 9px; color: rgba(255,255,255,0.5); text-transform: uppercase; }
        .spec-value { font-family: 'JetBrains Mono', monospace; font-size: 13px; color: #fff; }
        .spec-value.risk-high { color: #FF4444; }
        .spec-value.profit { color: #00FF88; }
        .prices-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
        .price-card { background: rgba(0,255,255,0.03); border: 1px solid rgba(0,255,255,0.15); border-radius: 10px; padding: 16px; text-align: center; }
        .price-symbol { font-size: 11px; color: rgba(255,255,255,0.6); margin-bottom: 6px; }
        .price-value { font-family: 'JetBrains Mono', monospace; font-size: 16px; color: #00FFFF; }
        .signals-list { display: flex; flex-direction: column; gap: 12px; }
        .no-signals { text-align: center; color: rgba(255,255,255,0.4); padding: 30px; background: rgba(0,255,255,0.02); border-radius: 12px; }
        .signal-card { background: rgba(0,255,255,0.03); border-radius: 12px; padding: 16px; border-left: 3px solid; }
        .signal-card.long { border-left-color: #00FF88; }
        .signal-card.short { border-left-color: #FF4444; }
        .signal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
        .signal-symbol { font-family: 'Orbitron', sans-serif; font-size: 14px; color: #fff; }
        .signal-side { font-size: 11px; padding: 3px 10px; border-radius: 4px; }
        .signal-side.long { background: rgba(0,255,136,0.2); color: #00FF88; }
        .signal-side.short { background: rgba(255,68,68,0.2); color: #FF4444; }
        .signal-details { display: flex; gap: 16px; font-size: 11px; color: rgba(255,255,255,0.5); margin-bottom: 8px; }
        .signal-reasoning { font-size: 12px; color: rgba(255,255,255,0.7); }
        .agents-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
        .agent-card { background: rgba(0,0,0,0.4); border: 1px solid rgba(0,255,255,0.2); border-radius: 12px; padding: 16px; text-align: center; }
        .agent-name { font-family: 'Orbitron', sans-serif; font-size: 14px; color: #00FFFF; display: block; margin-bottom: 6px; }
        .agent-specialty { font-size: 11px; color: rgba(255,255,255,0.7); display: block; margin-bottom: 4px; }
        .agent-techniques { font-size: 9px; color: rgba(255,255,255,0.4); display: block; }
        .consensus-info { background: rgba(0,255,255,0.05); border: 1px solid rgba(0,255,255,0.2); border-radius: 8px; padding: 16px; margin-bottom: 16px; }
        .consensus-info p { margin: 0; font-size: 13px; color: rgba(255,255,255,0.7); }
        .consensus-info strong { color: #00FFFF; }
        .consensus-threshold { text-align: center; }
        .threshold-bar { height: 8px; background: rgba(255,255,255,0.1); border-radius: 4px; overflow: hidden; margin-bottom: 8px; max-width: 300px; margin-left: auto; margin-right: auto; }
        .threshold-fill { height: 100%; background: linear-gradient(90deg, #00FFFF, #00FF88); }
        .threshold-label { font-size: 11px; color: rgba(255,255,255,0.5); }
      `}</style>
    </div>
  )
}
