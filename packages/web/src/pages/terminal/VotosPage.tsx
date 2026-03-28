import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

interface Vote {
  id: string
  symbol: string
  direction: 'LONG' | 'SHORT'
  agents: { name: string; vote: 'YES' | 'NO'; confidence: number }[]
  consensus: number
  timestamp: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
}

export default function VotosPage() {
  const [votes, setVotes] = useState<Vote[]>([
    {
      id: '1',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      agents: [
        { name: 'TREND', vote: 'YES', confidence: 78 },
        { name: 'MEAN-REV', vote: 'NO', confidence: 45 },
        { name: 'MACRO', vote: 'YES', confidence: 82 },
        { name: 'CRYPTO', vote: 'YES', confidence: 91 },
        { name: 'PSYCH', vote: 'YES', confidence: 65 },
      ],
      consensus: 80,
      timestamp: new Date().toISOString(),
      status: 'APPROVED'
    },
    {
      id: '2',
      symbol: 'ETHUSDT',
      direction: 'SHORT',
      agents: [
        { name: 'TREND', vote: 'NO', confidence: 35 },
        { name: 'MEAN-REV', vote: 'YES', confidence: 72 },
        { name: 'MACRO', vote: 'NO', confidence: 40 },
        { name: 'CRYPTO', vote: 'NO', confidence: 55 },
        { name: 'PSYCH', vote: 'NO', confidence: 60 },
      ],
      consensus: 20,
      timestamp: new Date(Date.now() - 3600000).toISOString(),
      status: 'REJECTED'
    },
    {
      id: '3',
      symbol: 'SOLUSDT',
      direction: 'LONG',
      agents: [
        { name: 'TREND', vote: 'YES', confidence: 85 },
        { name: 'MEAN-REV', vote: 'YES', confidence: 68 },
        { name: 'MACRO', vote: 'YES', confidence: 70 },
        { name: 'CRYPTO', vote: 'YES', confidence: 88 },
        { name: 'PSYCH', vote: 'NO', confidence: 50 },
      ],
      consensus: 80,
      timestamp: new Date(Date.now() - 7200000).toISOString(),
      status: 'APPROVED'
    }
  ])

  return (
    <div className="votos-page">
      <div className="page-header">
        <Link to="/app" className="back-link">← VOLTAR</Link>
        <h1>🗳️ VOTOS</h1>
        <p className="subtitle">Sistema de Consenso Multi-Agente</p>
      </div>

      <div className="consensus-info">
        <p>Operações são executadas quando <strong>3/5 agentes (60%)</strong> concordam na direção.</p>
      </div>

      <div className="votes-list">
        {votes.map(vote => (
          <div key={vote.id} className={`vote-card ${vote.status.toLowerCase()}`}>
            <div className="vote-header">
              <span className="symbol">{vote.symbol.replace('USDT', '/USDT')}</span>
              <span className={`direction ${vote.direction.toLowerCase()}`}>{vote.direction}</span>
              <span className={`status ${vote.status.toLowerCase()}`}>{vote.status}</span>
            </div>
            
            <div className="agents-votes">
              {vote.agents.map(agent => (
                <div key={agent.name} className={`agent-vote ${agent.vote.toLowerCase()}`}>
                  <span className="agent-name">{agent.name}</span>
                  <span className="agent-vote-icon">{agent.vote === 'YES' ? '✓' : '✗'}</span>
                  <span className="agent-confidence">{agent.confidence}%</span>
                </div>
              ))}
            </div>

            <div className="vote-footer">
              <div className="consensus-bar">
                <div className="consensus-fill" style={{ width: `${vote.consensus}%` }}></div>
              </div>
              <span className="consensus-value">{vote.consensus}% consenso</span>
              <span className="timestamp">{new Date(vote.timestamp).toLocaleString('pt-BR')}</span>
            </div>
          </div>
        ))}
      </div>

      <style>{`
        .votos-page { padding: 20px; max-width: 800px; margin: 0 auto; }
        .page-header { text-align: center; margin-bottom: 30px; position: relative; }
        .page-header h1 { font-family: 'Orbitron', sans-serif; font-size: 24px; color: #00FFFF; margin: 10px 0; }
        .page-header .subtitle { color: rgba(255,255,255,0.5); font-size: 11px; letter-spacing: 0.15em; text-transform: uppercase; }
        .back-link { color: rgba(255,255,255,0.5); text-decoration: none; font-size: 12px; position: absolute; left: 0; top: 0; }
        .back-link:hover { color: #00FFFF; }
        .consensus-info { text-align: center; margin-bottom: 30px; padding: 16px; background: rgba(0,255,255,0.05); border: 1px solid rgba(0,255,255,0.2); border-radius: 8px; font-size: 13px; color: rgba(255,255,255,0.7); }
        .consensus-info strong { color: #00FFFF; }
        .votes-list { display: flex; flex-direction: column; gap: 20px; }
        .vote-card { background: rgba(0,255,255,0.03); border: 1px solid rgba(0,255,255,0.2); border-radius: 12px; padding: 20px; }
        .vote-card.approved { border-color: rgba(0,255,136,0.3); }
        .vote-card.rejected { border-color: rgba(255,68,68,0.3); }
        .vote-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
        .vote-header .symbol { font-family: 'Orbitron', sans-serif; font-size: 16px; color: #fff; }
        .vote-header .direction { font-family: 'JetBrains Mono', monospace; font-size: 12px; padding: 4px 12px; border-radius: 4px; }
        .vote-header .direction.long { background: rgba(0,255,136,0.2); color: #00FF88; }
        .vote-header .direction.short { background: rgba(255,68,68,0.2); color: #FF4444; }
        .vote-header .status { font-size: 10px; padding: 4px 10px; border-radius: 4px; text-transform: uppercase; }
        .vote-header .status.approved { background: rgba(0,255,136,0.2); color: #00FF88; }
        .vote-header .status.rejected { background: rgba(255,68,68,0.2); color: #FF4444; }
        .vote-header .status.pending { background: rgba(255,170,0,0.2); color: #FFAA00; }
        .agents-votes { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
        .agent-vote { display: flex; align-items: center; gap: 6px; padding: 8px 12px; background: rgba(0,0,0,0.3); border-radius: 6px; font-size: 11px; }
        .agent-vote.yes { border: 1px solid rgba(0,255,136,0.3); }
        .agent-vote.no { border: 1px solid rgba(255,68,68,0.3); }
        .agent-name { color: rgba(255,255,255,0.7); }
        .agent-vote-icon { font-weight: bold; }
        .agent-vote.yes .agent-vote-icon { color: #00FF88; }
        .agent-vote.no .agent-vote-icon { color: #FF4444; }
        .agent-confidence { font-family: 'JetBrains Mono', monospace; color: rgba(255,255,255,0.5); }
        .vote-footer { display: flex; align-items: center; gap: 12px; }
        .consensus-bar { flex: 1; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden; }
        .consensus-fill { height: 100%; background: linear-gradient(90deg, #00FFFF, #00FF88); transition: width 0.3s; }
        .consensus-value { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #00FFFF; min-width: 100px; }
        .timestamp { font-size: 10px; color: rgba(255,255,255,0.4); margin-left: auto; }
      `}</style>
    </div>
  )
}
