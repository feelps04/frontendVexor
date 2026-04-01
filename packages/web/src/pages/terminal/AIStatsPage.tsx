import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

interface AIStats {
  totalSignals: number
  winRate: number
  avgConfidence: number
  agentsActive: number
  lastUpdate: string
}

export default function AIStatsPage() {
  const [stats, setStats] = useState<AIStats>({
    totalSignals: 1247,
    winRate: 68.5,
    avgConfidence: 72.3,
    agentsActive: 5,
    lastUpdate: new Date().toISOString()
  })

  const agentStats = [
    { name: 'TREND', signals: 312, winRate: 71.2, specialty: 'Momentum/Breakout' },
    { name: 'MEAN-REV', signals: 289, winRate: 65.8, specialty: 'Mean Reversion' },
    { name: 'MACRO', signals: 198, winRate: 68.4, specialty: 'Intermarket' },
    { name: 'CRYPTO', signals: 423, winRate: 69.1, specialty: '24/7 Trading' },
    { name: 'PSYCH', signals: 25, winRate: 72.0, specialty: 'Anti-Tilt' },
  ]

  return (
    <div className="ai-stats-page">
      <div className="page-header">
        <Link to="/app" className="back-link">← VOLTAR</Link>
        <h1>🤖 AI STATS</h1>
        <p className="subtitle">Estatísticas do Sistema Multi-Agente</p>
      </div>

      <div className="stats-overview">
        <div className="stat-card">
          <div className="stat-value">{stats.totalSignals.toLocaleString()}</div>
          <div className="stat-label">Total de Sinais</div>
        </div>
        <div className="stat-card profit">
          <div className="stat-value">{stats.winRate.toFixed(1)}%</div>
          <div className="stat-label">Win Rate</div>
        </div>
        <div className="stat-card info">
          <div className="stat-value">{stats.avgConfidence.toFixed(1)}%</div>
          <div className="stat-label">Confiança Média</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.agentsActive}</div>
          <div className="stat-label">Agentes Ativos</div>
        </div>
      </div>

      <div className="agents-section">
        <h2>📊 Performance por Agente</h2>
        <div className="agents-table">
          <div className="table-header">
            <span>Agente</span>
            <span>Especialidade</span>
            <span>Sinais</span>
            <span>Win Rate</span>
          </div>
          {agentStats.map(agent => (
            <div key={agent.name} className="table-row">
              <span className="agent-name">{agent.name}</span>
              <span className="agent-specialty">{agent.specialty}</span>
              <span className="agent-signals">{agent.signals}</span>
              <span className={`agent-winrate ${agent.winRate >= 70 ? 'high' : agent.winRate >= 65 ? 'medium' : 'low'}`}>
                {agent.winRate.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="last-update">
        Última atualização: {new Date(stats.lastUpdate).toLocaleString('pt-BR')}
      </div>

      <style>{`
        .ai-stats-page { padding: 20px; max-width: 1000px; margin: 0 auto; }
        .page-header { text-align: center; margin-bottom: 40px; position: relative; }
        .page-header h1 { font-family: 'Orbitron', sans-serif; font-size: 24px; color: #00FFFF; margin: 10px 0; }
        .page-header .subtitle { color: rgba(255,255,255,0.5); font-size: 11px; letter-spacing: 0.15em; text-transform: uppercase; }
        .back-link { color: rgba(255,255,255,0.5); text-decoration: none; font-size: 12px; position: absolute; left: 0; top: 0; }
        .back-link:hover { color: #00FFFF; }
        .stats-overview { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; margin-bottom: 40px; }
        .stat-card { background: rgba(0,255,255,0.05); border: 1px solid rgba(0,255,255,0.2); border-radius: 12px; padding: 24px; text-align: center; }
        .stat-card.profit { border-color: rgba(0,255,136,0.3); background: rgba(0,255,136,0.05); }
        .stat-card.info { border-color: rgba(0,150,255,0.3); background: rgba(0,150,255,0.05); }
        .stat-value { font-family: 'Orbitron', sans-serif; font-size: 28px; color: #fff; margin-bottom: 8px; }
        .stat-card.profit .stat-value { color: #00FF88; }
        .stat-card.info .stat-value { color: #0096FF; }
        .stat-label { font-size: 10px; color: rgba(255,255,255,0.5); text-transform: uppercase; letter-spacing: 0.1em; }
        .agents-section { margin-bottom: 30px; }
        .agents-section h2 { font-family: 'Orbitron', sans-serif; font-size: 16px; color: #00FFFF; margin-bottom: 20px; }
        .agents-table { background: rgba(0,255,255,0.02); border: 1px solid rgba(0,255,255,0.1); border-radius: 12px; overflow: hidden; }
        .table-header, .table-row { display: grid; grid-template-columns: 1fr 1.5fr 1fr 1fr; padding: 16px 20px; }
        .table-header { background: rgba(0,255,255,0.1); font-size: 10px; color: rgba(255,255,255,0.5); text-transform: uppercase; letter-spacing: 0.1em; }
        .table-row { border-top: 1px solid rgba(255,255,255,0.05); font-size: 13px; }
        .table-row:hover { background: rgba(0,255,255,0.03); }
        .agent-name { font-family: 'Orbitron', sans-serif; color: #00FFFF; }
        .agent-specialty { color: rgba(255,255,255,0.6); }
        .agent-signals { font-family: 'JetBrains Mono', monospace; color: #fff; }
        .agent-winrate { font-family: 'JetBrains Mono', monospace; }
        .agent-winrate.high { color: #00FF88; }
        .agent-winrate.medium { color: #FFAA00; }
        .agent-winrate.low { color: #FF4444; }
        .last-update { text-align: center; font-size: 11px; color: rgba(255,255,255,0.4); margin-top: 30px; }
        @media (max-width: 600px) {
          .table-header, .table-row { grid-template-columns: 1fr 1fr; }
          .agent-specialty, .table-header span:nth-child(2) { display: none; }
        }
      `}</style>
    </div>
  )
}
