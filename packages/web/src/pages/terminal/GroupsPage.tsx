import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useOutletContext } from 'react-router-dom'
import { apiGet } from '../../lib/api'

type GroupItem = { group: string; symbols: number }

type GroupsResponse = {
  file: string
  mtimeMs: number
  groups: GroupItem[]
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

export default function GroupsPage() {
  const navigate = useNavigate()
  const params = useParams()
  const groupFromRoute = String(params.group || '').toUpperCase()
  const { selectedAsset, setSelectedAsset, assets } = useOutletContext<TerminalContext>()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<GroupItem[]>([])
  const [q, setQ] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await apiGet<GroupsResponse>('/api/v1/market/groups')
        if (cancelled) return
        setItems(Array.isArray(res?.groups) ? res.groups : [])
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setItems([])
      } finally {
        if (cancelled) return
        setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const filteredGroups = useMemo(() => {
    const qq = String(q || '').trim().toUpperCase()
    if (!qq) return items
    return items.filter((g) => String(g.group || '').toUpperCase().includes(qq))
  }, [items, q])

  const selectedGroup = useMemo(() => {
    const byRoute = groupFromRoute
    if (byRoute) return byRoute
    const first = filteredGroups[0]?.group
    return first ? String(first).toUpperCase() : ''
  }, [filteredGroups, groupFromRoute])

  useEffect(() => {
    if (!groupFromRoute && selectedGroup) {
      navigate(`/app/groups/${encodeURIComponent(selectedGroup)}`, { replace: true })
    }
  }, [groupFromRoute, navigate, selectedGroup])

  const groupMeta = useMemo(() => items.find((x) => String(x.group).toUpperCase() === selectedGroup) ?? null, [items, selectedGroup])

  return (
    <div style={{ padding: 20, maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ margin: 0 }}>Grupos</h1>
          <div style={{ color: '#8b949e', fontSize: 13 }}>
            Navegue por categoria e carregue somente o grupo atual.
          </div>
        </div>
        <Link to="/app" style={{ color: '#58a6ff', textDecoration: 'none' }}>
          Dashboard
        </Link>
      </div>

      {loading ? <div style={{ color: '#8b949e' }}>Carregando...</div> : null}
      {error ? (
        <div style={{ marginBottom: 16, padding: 12, borderRadius: 10, border: '1px solid rgba(248, 81, 73, 0.3)', background: 'rgba(248, 81, 73, 0.08)', color: '#f85149' }}>
          {error}
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16, alignItems: 'start' }}>
        <div style={{ border: '1px solid rgba(48, 54, 61, 0.35)', borderRadius: 12, background: 'rgba(48, 54, 61, 0.12)', overflow: 'hidden' }}>
          <div style={{ padding: 12, borderBottom: '1px solid rgba(48, 54, 61, 0.35)' }}>
            <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 8 }}>Buscar grupo</div>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Ex: BOVESPA"
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

          <div style={{ maxHeight: '70vh', overflow: 'auto' }}>
            {filteredGroups.map((g) => {
              const isActive = String(g.group).toUpperCase() === selectedGroup
              return (
                <Link
                  key={g.group}
                  to={`/app/groups/${encodeURIComponent(g.group)}`}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 12px',
                    textDecoration: 'none',
                    color: isActive ? '#58a6ff' : '#e6edf3',
                    background: isActive ? 'rgba(88, 166, 255, 0.08)' : 'transparent',
                    borderBottom: '1px solid rgba(48, 54, 61, 0.22)',
                  }}
                >
                  <span style={{ fontWeight: 800 }}>{g.group}</span>
                  <span style={{ color: '#8b949e', fontSize: 12 }}>{g.symbols}</span>
                </Link>
              )
            })}
          </div>
        </div>

        <div style={{ border: '1px solid rgba(48, 54, 61, 0.35)', borderRadius: 12, background: 'rgba(48, 54, 61, 0.12)', overflow: 'hidden' }}>
          <div style={{ padding: 12, borderBottom: '1px solid rgba(48, 54, 61, 0.35)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: '#8b949e' }}>Grupo selecionado</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: '#e6edf3' }}>{selectedGroup || '—'}</div>
            </div>
            <div style={{ color: '#8b949e', fontSize: 12 }}>
              {groupMeta ? `${groupMeta.symbols} símbolos` : '—'}
            </div>
          </div>

          <div style={{ padding: 12 }}>
            <div style={{ color: '#8b949e', fontSize: 13, marginBottom: 12 }}>
              Lista limitada e com atualização em tempo real.
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
              {assets.map((a) => (
                <button
                  key={a.symbol}
                  onClick={() => setSelectedAsset(a.symbol)}
                  style={{
                    textAlign: 'left',
                    borderRadius: 12,
                    padding: 12,
                    border: a.symbol === selectedAsset ? '1px solid rgba(88, 166, 255, 0.6)' : '1px solid rgba(48, 54, 61, 0.35)',
                    background: a.symbol === selectedAsset ? 'rgba(88, 166, 255, 0.08)' : 'rgba(48, 54, 61, 0.2)',
                    color: '#e6edf3',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ fontWeight: 900 }}>{a.symbol}</div>
                    <div style={{ fontWeight: 800 }}>{Number.isFinite(a.price) && a.price > 0 ? a.price.toFixed(2) : '—'}</div>
                  </div>
                  <div style={{ color: '#8b949e', fontSize: 12, marginTop: 4 }}>{a.name}</div>
                </button>
              ))}
            </div>

            {assets.length === 0 && !loading && !error ? (
              <div style={{ marginTop: 12, color: '#8b949e' }}>Nenhum símbolo carregado para este grupo.</div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
