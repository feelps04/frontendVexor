import { useEffect, useMemo, useRef, useState } from 'react'
import { apiGet, apiPost } from '../../lib/api'
import { getAuth } from '../../lib/auth'

type Stress = {
  level: 'calm' | 'warm' | 'hot' | 'panic'
  score: number
  ticksPerSecond: number
  baseline: number
  change: number | null
}

type Mover = {
  symbol: string
  ticks: number
  ticksPrev: number
  spike: number
  lastPrice?: number
}

type InitMsg = {
  type: 'init'
  ts: number
  lastPrices: Record<string, number>
}

type SnapshotMsg = {
  type: 'snapshot'
  ts: number
  stress: Stress
  movers: Mover[]
}

type TeamRes = { accountId: string; teamId: string | null }
type RankingRes = { items: Array<{ teamId: string; score: number }> }
type JoinRes = { ok: boolean; accountId: string; teamId: string }

export default function MarketStressPage() {
  const wsRef = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)
  const [stress, setStress] = useState<Stress | null>(null)
  const [movers, setMovers] = useState<Mover[]>([])
  const [lastPrices, setLastPrices] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)

  const accountId = useMemo(() => getAuth()?.accountId || 'acc-1', [])
  const [teamId, setTeamId] = useState<string | null>(null)
  const [teamInput, setTeamInput] = useState('')
  const [teamScore, setTeamScore] = useState<number | null>(null)
  const [ranking, setRanking] = useState<Array<{ teamId: string; score: number }>>([])
  const [teamError, setTeamError] = useState<string | null>(null)

  const wsUrl = useMemo(() => {
    const host = window.location.hostname
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const base = `${proto}://${host}:3000`
    return `${base}/ws/stocks?mode=feed`
  }, [])

  useEffect(() => {
    try {
      wsRef.current?.close()
    } catch {
      // ignore
    }

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      setError(null)
    }

    ws.onclose = () => {
      setConnected(false)
    }

    ws.onerror = () => {
      setError('Falha na conexão WebSocket')
    }

    ws.onmessage = (ev) => {
      let msg: any
      try {
        msg = JSON.parse(String(ev.data))
      } catch {
        return
      }

      if (!msg || typeof msg.type !== 'string') return

      if (msg.type === 'init') {
        const init = msg as InitMsg
        if (init && init.lastPrices && typeof init.lastPrices === 'object') {
          setLastPrices(init.lastPrices)
        }
        return
      }

      if (msg.type === 'snapshot') {
        const snap = msg as SnapshotMsg
        if (snap && snap.stress) setStress(snap.stress)
        if (Array.isArray(snap.movers)) setMovers(snap.movers)

        setLastPrices((prev) => {
          const next = { ...prev }
          for (const m of Array.isArray(snap.movers) ? snap.movers : []) {
            if (m && m.symbol && typeof m.lastPrice === 'number' && Number.isFinite(m.lastPrice) && m.lastPrice > 0) {
              next[String(m.symbol).toUpperCase()] = m.lastPrice
            }
          }
          return next
        })
        return
      }
    }

    return () => {
      try {
        ws.close()
      } catch {
        // ignore
      }
    }
  }, [wsUrl])

  useEffect(() => {
    let alive = true

    async function loadTeam() {
      try {
        setTeamError(null)
        const r = await apiGet<TeamRes>(`/api/v1/accounts/${encodeURIComponent(accountId)}/team`)
        if (!alive) return
        setTeamId(r.teamId)
      } catch (err) {
        if (!alive) return
        setTeamError(err instanceof Error ? err.message : String(err))
      }
    }

    void loadTeam()
    const t = setInterval(loadTeam, 5000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [accountId])

  useEffect(() => {
    let alive = true

    async function loadScoreAndRanking() {
      try {
        setTeamError(null)
        const r = await apiGet<RankingRes>(`/api/v1/teams/ranking?limit=10`)
        if (!alive) return
        setRanking(Array.isArray(r.items) ? r.items : [])

        if (teamId) {
          const s = await apiGet<{ teamId: string; score: number }>(`/api/v1/teams/${encodeURIComponent(teamId)}/score`)
          if (!alive) return
          setTeamScore(Number.isFinite(Number(s.score)) ? Number(s.score) : 0)
        } else {
          setTeamScore(null)
        }
      } catch (err) {
        if (!alive) return
        setTeamError(err instanceof Error ? err.message : String(err))
      }
    }

    void loadScoreAndRanking()
    const t = setInterval(loadScoreAndRanking, 2000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [teamId])

  async function joinTeam() {
    const tid = teamInput.trim()
    if (!tid) {
      setTeamError('Informe um teamId')
      return
    }
    try {
      setTeamError(null)
      const r = await apiPost<JoinRes>('/api/v1/teams/join', { accountId, teamId: tid })
      setTeamId(r.teamId)
      setTeamInput('')
    } catch (err) {
      setTeamError(err instanceof Error ? err.message : String(err))
    }
  }

  const banner = useMemo(() => {
    const lvl = stress?.level ?? 'calm'
    if (lvl === 'panic') return { title: 'ALERTA: PÂNICO NO MERCADO', subtitle: 'Volume agregado muito acima do normal. Evite operar por impulso.', cls: 'panic' }
    if (lvl === 'hot') return { title: 'Mercado Quente', subtitle: 'Fluxo acelerado. Redobre a cautela.', cls: 'hot' }
    if (lvl === 'warm') return { title: 'Mercado Ativo', subtitle: 'Fluxo acima da média. Fique atento.', cls: 'warm' }
    return { title: 'Mercado Calmo', subtitle: 'Fluxo dentro do esperado.', cls: 'calm' }
  }, [stress?.level])

  const stressText = useMemo(() => {
    if (!stress) return '—'
    const change = stress.change == null ? '—' : `${(stress.change * 100).toFixed(0)}%`
    return `score ${stress.score.toFixed(2)} | ticks/s ${stress.ticksPerSecond} | baseline ${stress.baseline.toFixed(1)} | Δ ${change}`
  }, [stress])

  return (
    <div className="market-stress-page">
      <div className={`stress-banner ${banner.cls}`}>
        <div className="banner-left">
          <div className="banner-title">{banner.title}</div>
          <div className="banner-subtitle">{banner.subtitle}</div>
        </div>
        <div className="banner-right">
          <div className="conn">{connected ? 'WS ONLINE' : 'WS OFFLINE'}</div>
          <div className="metrics">{stressText}</div>
          {error ? <div className="err">{error}</div> : null}
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <div className="card-header">
            <h3>Top Movers (por spike de ticks)</h3>
            <span className="hint">atualiza 1x/s</span>
          </div>

          <div className="table">
            <div className="row head">
              <div>Ativo</div>
              <div>Último</div>
              <div>Ticks</div>
              <div>Spike</div>
            </div>
            {movers.length === 0 ? (
              <div className="empty">Aguardando dados do Kafka...</div>
            ) : (
              movers.map((m) => {
                const sym = String(m.symbol || '').toUpperCase()
                const p = typeof m.lastPrice === 'number' && Number.isFinite(m.lastPrice) ? m.lastPrice : lastPrices[sym]
                const spike = Number.isFinite(m.spike) ? m.spike : null
                return (
                  <div key={sym} className="row">
                    <div className="sym">{sym}</div>
                    <div className="price">{p ? `R$ ${p.toFixed(2)}` : '—'}</div>
                    <div className="ticks">{m.ticks}</div>
                    <div className="spike">{spike == null ? '—' : spike === Infinity ? '∞' : `${spike.toFixed(2)}x`}</div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>Time & Pontos (Opção B)</h3>
          </div>
          <div className="copy">
            <div className="line"><b>Conta:</b> <code>{accountId}</code></div>
            <div className="line"><b>Time atual:</b> <code>{teamId ?? '—'}</code></div>
            <div className="line"><b>Score do time:</b> <code>{teamScore == null ? '—' : teamScore}</code></div>

            <div className="join">
              <input
                value={teamInput}
                onChange={(e) => setTeamInput(e.target.value)}
                placeholder="teamId (ex: time-azul)"
              />
              <button onClick={() => void joinTeam()}>Entrar</button>
            </div>

            {teamError ? <div className="teamErr">{teamError}</div> : null}

            <div className="line"><b>Regra:</b> abrir ordem em <code>hot</code>/<code>panic</code> perde pontos; em <code>calm</code>/<code>warm</code> ganha bônus.</div>
            <div className="line"><b>Ranking:</b></div>
            <div className="rank">
              {ranking.length === 0 ? (
                <div className="rankEmpty">—</div>
              ) : (
                ranking.map((r, i) => (
                  <div key={r.teamId} className={`rankRow ${teamId && r.teamId === teamId ? 'me' : ''}`}>
                    <div className="rk">#{i + 1}</div>
                    <div className="rt">{r.teamId}</div>
                    <div className="rs">{Number.isFinite(r.score) ? r.score : 0}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .market-stress-page {
          padding: 20px;
          max-width: 1200px;
          margin: 0 auto;
        }

        .stress-banner {
          display: flex;
          justify-content: space-between;
          gap: 20px;
          padding: 16px;
          border-radius: 12px;
          border: 1px solid rgba(48, 54, 61, 0.4);
          margin-bottom: 20px;
        }

        .stress-banner.calm {
          background: rgba(63, 185, 80, 0.08);
          border-color: rgba(63, 185, 80, 0.25);
        }

        .stress-banner.warm {
          background: rgba(88, 166, 255, 0.08);
          border-color: rgba(88, 166, 255, 0.25);
        }

        .stress-banner.hot {
          background: rgba(245, 158, 11, 0.10);
          border-color: rgba(245, 158, 11, 0.25);
        }

        .stress-banner.panic {
          background: rgba(248, 81, 73, 0.10);
          border-color: rgba(248, 81, 73, 0.25);
        }

        .banner-title {
          font-size: 16px;
          font-weight: 800;
          color: #e6edf3;
          margin-bottom: 6px;
        }

        .banner-subtitle {
          font-size: 13px;
          color: #8b949e;
        }

        .banner-right {
          text-align: right;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .conn {
          font-size: 12px;
          font-weight: 700;
          color: #e6edf3;
          opacity: 0.9;
        }

        .metrics {
          font-size: 12px;
          color: #8b949e;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        }

        .err {
          font-size: 12px;
          color: #f85149;
        }

        .grid {
          display: grid;
          grid-template-columns: 2fr 1fr;
          gap: 16px;
        }

        .card {
          background: rgba(48, 54, 61, 0.2);
          border-radius: 12px;
          padding: 16px;
          border: 1px solid rgba(48, 54, 61, 0.3);
        }

        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-bottom: 12px;
        }

        .card-header h3 {
          margin: 0;
          font-size: 14px;
          font-weight: 700;
          color: #e6edf3;
        }

        .hint {
          font-size: 11px;
          color: #8b949e;
        }

        .table {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .row {
          display: grid;
          grid-template-columns: 1fr 1fr 0.7fr 0.7fr;
          gap: 10px;
          padding: 10px 12px;
          border-radius: 10px;
          background: rgba(13, 17, 23, 0.35);
          border: 1px solid rgba(48, 54, 61, 0.35);
          font-size: 12px;
          color: #e6edf3;
        }

        .row.head {
          background: rgba(48, 54, 61, 0.35);
          font-weight: 700;
          color: #8b949e;
        }

        .sym {
          font-weight: 800;
          letter-spacing: 0.3px;
        }

        .price {
          color: #e6edf3;
        }

        .ticks, .spike {
          text-align: right;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        }

        .empty {
          padding: 14px 12px;
          color: #8b949e;
          font-size: 13px;
        }

        .copy {
          display: flex;
          flex-direction: column;
          gap: 10px;
          font-size: 13px;
          color: #8b949e;
          line-height: 1.4;
        }

        .copy code {
          color: #58a6ff;
        }

        .join {
          display: flex;
          gap: 8px;
          margin-top: 6px;
        }

        .join input {
          flex: 1;
          padding: 10px 12px;
          background: rgba(13, 17, 23, 0.6);
          border: 1px solid rgba(48, 54, 61, 0.6);
          border-radius: 10px;
          color: #e6edf3;
          font-size: 13px;
        }

        .join button {
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid rgba(88, 166, 255, 0.35);
          background: rgba(88, 166, 255, 0.15);
          color: #e6edf3;
          font-weight: 700;
          cursor: pointer;
        }

        .teamErr {
          color: #f85149;
          font-size: 12px;
        }

        .rank {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-top: 6px;
        }

        .rankRow {
          display: grid;
          grid-template-columns: 48px 1fr 72px;
          gap: 8px;
          padding: 8px 10px;
          border-radius: 10px;
          background: rgba(13, 17, 23, 0.35);
          border: 1px solid rgba(48, 54, 61, 0.35);
          font-size: 12px;
          color: #e6edf3;
        }

        .rankRow.me {
          border-color: rgba(63, 185, 80, 0.35);
          background: rgba(63, 185, 80, 0.08);
        }

        .rk {
          color: #8b949e;
          font-weight: 800;
        }

        .rt {
          font-weight: 800;
        }

        .rs {
          text-align: right;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-weight: 800;
        }

        @media (max-width: 900px) {
          .grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  )
}
