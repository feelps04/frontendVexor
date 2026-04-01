import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiGet } from '../../lib/api'

type SectorItem = {
  sectorId: string
  sectorName: string
  symbols: number
  exchanges: string[]
  types: string[]
}

type SectorsResponse = {
  sectors: SectorItem[]
}

const CATEGORY_CONFIG: Record<string, { bg: string; border: string; accent: string; icon: string }> = {
  'Ações': { bg: 'rgba(0, 229, 160, 0.06)', border: 'rgba(0, 229, 160, 0.2)', accent: '#00e5a0', icon: '📈' },
  'BDR': { bg: 'rgba(77, 159, 255, 0.06)', border: 'rgba(77, 159, 255, 0.2)', accent: '#4d9fff', icon: '🌍' },
  'Commodities': { bg: 'rgba(255, 165, 0, 0.06)', border: 'rgba(255, 165, 0, 0.2)', accent: '#ffa500', icon: '🪙' },
  'Cripto': { bg: 'rgba(255, 107, 107, 0.06)', border: 'rgba(255, 107, 107, 0.2)', accent: '#ff6b6b', icon: '₿' },
  'FII': { bg: 'rgba(147, 112, 219, 0.06)', border: 'rgba(147, 112, 219, 0.2)', accent: '#9370db', icon: '🏢' },
  'Moedas': { bg: 'rgba(64, 224, 208, 0.06)', border: 'rgba(64, 224, 208, 0.2)', accent: '#40e0d0', icon: '💱' },
  'Renda Fixa': { bg: 'rgba(255, 215, 0, 0.06)', border: 'rgba(255, 215, 0, 0.2)', accent: '#ffd700', icon: '📊' },
  'Taxas': { bg: 'rgba(192, 192, 192, 0.06)', border: 'rgba(192, 192, 192, 0.2)', accent: '#c0c0c0', icon: '📉' },
  'Índices': { bg: 'rgba(255, 99, 71, 0.06)', border: 'rgba(255, 99, 71, 0.2)', accent: '#ff6347', icon: '📈' },
  'Outros': { bg: 'rgba(139, 148, 158, 0.06)', border: 'rgba(139, 148, 158, 0.2)', accent: '#8b949e', icon: '📁' },
}

function getCategory(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('ações') || n.includes('ação')) return 'Ações'
  if (n.includes('bdr')) return 'BDR'
  if (n.includes('commodities') || n.includes('commodity')) return 'Commodities'
  if (n.includes('cripto') || n.includes('crypto')) return 'Cripto'
  if (n.includes('fii')) return 'FII'
  if (n.includes('moedas')) return 'Moedas'
  if (n.includes('renda fixa')) return 'Renda Fixa'
  if (n.includes('taxas')) return 'Taxas'
  if (n.includes('índices')) return 'Índices'
  return 'Outros'
}

export default function SectorsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sectors, setSectors] = useState<SectorItem[]>([])
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [pageSize, setPageSize] = useState(24)
  const [page, setPage] = useState(0)
  const [quotes, setQuotes] = useState<Record<string, any>>({})

  async function loadSectors() {
    setLoading(true)
    setError(null)
    try {
      const data = await apiGet<SectorsResponse>('/api/v1/market/sectors?activeOnly=true')
      const list = (data.sectors || []).map((s: any) => ({
        sectorId: s.sectorId,
        sectorName: s.sectorName,
        symbols: s.symbols || 0,
        exchanges: s.exchanges || [],
        types: s.types || []
      }))
      setSectors(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  // Função para carregar cotações de todos os setores visíveis
  async function loadQuotes() {
    try {
      const data = await apiGet<any>('/api/v1/market/sectors/quotes?limit=1')
      if (data && data.sectors) {
        const quotesMap: Record<string, any> = {}
        data.sectors.forEach((s: any) => {
          if (s.items && s.items.length > 0) {
            quotesMap[s.sectorId] = s.items[0]
          }
        })
        setQuotes(quotesMap)
      }
    } catch (e) {
      console.error('Erro ao carregar cotações:', e)
    }
  }

  useEffect(() => {
    loadSectors()
    loadQuotes()
    // Atualização em tempo real a cada 2 segundos
    const interval = setInterval(loadQuotes, 2000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    setPage(0)
  }, [search, selectedCategory, pageSize])

  const filtered = useMemo(() => {
    let result = sectors
    if (search) {
      const q = search.toUpperCase()
      result = result.filter(s => 
        s.sectorId.toUpperCase().includes(q) || 
        s.sectorName.toUpperCase().includes(q)
      )
    }
    if (selectedCategory) {
      result = result.filter(s => getCategory(s.sectorName) === selectedCategory)
    }
    return result
  }, [sectors, search, selectedCategory])

  const totalPages = useMemo(() => Math.ceil(filtered.length / pageSize), [filtered, pageSize])
  
  const pagedSectors = useMemo(() => {
    const start = page * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, page, pageSize])

  const grouped = useMemo(() => {
    const groups: Record<string, SectorItem[]> = {}
    for (const s of pagedSectors) {
      const cat = getCategory(s.sectorName)
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(s)
    }
    return groups
  }, [pagedSectors])

  const totalAssets = useMemo(() => sectors.reduce((sum, s) => sum + s.symbols, 0), [sectors])
  const maxSymbols = useMemo(() => Math.max(...sectors.map(s => s.symbols), 1), [sectors])

  const categories = useMemo(() => {
    const cats = new Set(sectors.map(s => getCategory(s.sectorName)))
    return Array.from(cats)
  }, [sectors])

  return (
    <div style={{ 
      height: '100vh', 
      display: 'flex', 
      flexDirection: 'column',
      background: '#0d1117',
      overflow: 'hidden'
    }}>
      {/* Header Fixo */}
      <div style={{ 
        padding: '20px 24px', 
        borderBottom: '1px solid rgba(48, 54, 61, 0.6)',
        background: 'rgba(13, 17, 23, 0.95)',
        backdropFilter: 'blur(10px)',
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, maxWidth: 1600, margin: '0 auto' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: '#e6edf3', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 28 }}>📊</span>
              SETORES DO MERCADO
            </h1>
            <p style={{ margin: '8px 0 0', color: '#8b949e', fontSize: 14 }}>
              <span style={{ color: '#00e5a0', fontWeight: 600 }}>{sectors.length}</span> setores • 
              <span style={{ color: '#00e5a0', fontWeight: 600 }}> {totalAssets.toLocaleString('pt-BR')}</span> ativos totais
            </p>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <Link to="/app" style={{ 
              padding: '10px 20px', 
              background: 'rgba(48, 54, 61, 0.3)', 
              borderRadius: 10, 
              color: '#8b949e', 
              textDecoration: 'none',
              fontSize: 14,
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}>
              ← Dashboard
            </Link>
            <button onClick={() => loadSectors()} style={{
              padding: '10px 20px',
              background: 'rgba(0, 229, 160, 0.12)',
              border: '1px solid rgba(0, 229, 160, 0.25)',
              borderRadius: 10,
              color: '#00e5a0',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 600
            }}>
              ↻ Atualizar
            </button>
          </div>
        </div>

        {/* Search & Filters */}
        <div style={{ display: 'flex', gap: 12, maxWidth: 1600, margin: '0 auto', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="🔍 Buscar setor..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              flex: 1,
              minWidth: 200,
              maxWidth: 300,
              padding: '10px 14px',
              background: 'rgba(22, 27, 34, 0.8)',
              border: '1px solid rgba(48, 54, 61, 0.6)',
              borderRadius: 8,
              color: '#e6edf3',
              fontSize: 14
            }}
          />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 2 }}>
            <button
              onClick={() => setSelectedCategory(null)}
              style={{
                padding: '8px 14px',
                background: selectedCategory === null ? 'rgba(0, 229, 160, 0.15)' : 'rgba(48, 54, 61, 0.3)',
                border: selectedCategory === null ? '1px solid rgba(0, 229, 160, 0.3)' : '1px solid rgba(48, 54, 61, 0.4)',
                borderRadius: 6,
                color: selectedCategory === null ? '#00e5a0' : '#8b949e',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 500
              }}
            >
              Todos ({sectors.length})
            </button>
            {categories.map(cat => {
              const config = CATEGORY_CONFIG[cat] || CATEGORY_CONFIG['Outros']
              const count = sectors.filter(s => getCategory(s.sectorName) === cat).length
              return (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  style={{
                    padding: '8px 14px',
                    background: selectedCategory === cat ? config.bg : 'rgba(48, 54, 61, 0.3)',
                    border: selectedCategory === cat ? `1px solid ${config.border}` : '1px solid rgba(48, 54, 61, 0.4)',
                    borderRadius: 6,
                    color: selectedCategory === cat ? config.accent : '#8b949e',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: 500
                  }}
                >
                  {config.icon} {cat} ({count})
                </button>
              )
            })}
          </div>

          {/* Pagination Controls in Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(22, 27, 34, 0.5)', padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(48, 54, 61, 0.4)' }}>
            <select 
              value={pageSize} 
              onChange={e => setPageSize(Number(e.target.value))}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#8b949e',
                fontSize: 12,
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value={12}>12 por vez</option>
              <option value={24}>24 por vez</option>
              <option value={48}>48 por vez</option>
              <option value={96}>96 por vez</option>
            </select>
            
            <div style={{ width: 1, height: 16, background: 'rgba(48, 54, 61, 0.6)' }} />

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button 
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                style={{
                  background: 'none',
                  border: 'none',
                  color: page === 0 ? '#484f58' : '#00e5a0',
                  cursor: page === 0 ? 'default' : 'pointer',
                  fontSize: 18,
                  padding: '0 4px',
                  display: 'flex',
                  alignItems: 'center'
                }}
              >
                ◀
              </button>
              <span style={{ fontSize: 12, color: '#e6edf3', minWidth: 60, textAlign: 'center' }}>
                {page + 1} / {Math.max(1, totalPages)}
              </span>
              <button 
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                style={{
                  background: 'none',
                  border: 'none',
                  color: page >= totalPages - 1 ? '#484f58' : '#00e5a0',
                  cursor: page >= totalPages - 1 ? 'default' : 'pointer',
                  fontSize: 18,
                  padding: '0 4px',
                  display: 'flex',
                  alignItems: 'center'
                }}
              >
                ▶
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Conteúdo com Scroll */}
      <div style={{ 
        flex: 1, 
        overflow: 'auto',
        padding: '24px',
        scrollBehavior: 'smooth'
      }}>
        <div style={{ maxWidth: 1600, margin: '0 auto' }}>
          {error && (
            <div style={{ padding: 16, background: 'rgba(248, 81, 73, 0.08)', border: '1px solid rgba(248, 81, 73, 0.3)', borderRadius: 10, color: '#f85149', marginBottom: 24 }}>
              {error}
            </div>
          )}

          {loading ? (
            <div style={{ textAlign: 'center', padding: 60, color: '#8b949e' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>⏳</div>
              Carregando setores...
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
              {Object.entries(grouped).map(([category, items]) => {
                const config = CATEGORY_CONFIG[category] || CATEGORY_CONFIG['Outros']
                const categoryTotal = items.reduce((sum, s) => sum + s.symbols, 0)
                
                return (
                  <div key={category}>
                    {/* Category Header */}
                    <div style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: 10, 
                      marginBottom: 12,
                      padding: '12px 16px',
                      background: config.bg,
                      border: `1px solid ${config.border}`,
                      borderRadius: 10
                    }}>
                      <span style={{ fontSize: 24 }}>{config.icon}</span>
                      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: config.accent }}>
                        {category}
                      </h2>
                      <span style={{ 
                        color: '#8b949e', 
                        fontSize: 13,
                        background: 'rgba(48, 54, 61, 0.4)',
                        padding: '4px 10px',
                        borderRadius: 6
                      }}>
                        {items.length} setores • {categoryTotal.toLocaleString('pt-BR')} ativos
                      </span>
                    </div>

                    {/* Sector Cards Grid */}
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                      gap: 10
                    }}>
                      {items.sort((a, b) => b.symbols - a.symbols).map(sector => {
                        const fillPct = (sector.symbols / maxSymbols) * 100
                        return (
                          <Link
                            key={sector.sectorId}
                            to={`/app/sector/${sector.sectorId}`}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              padding: 14,
                              background: 'rgba(22, 27, 34, 0.6)',
                              border: `1px solid rgba(48, 54, 61, 0.5)`,
                              borderRadius: 10,
                              textDecoration: 'none',
                              transition: 'all 0.2s',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = config.bg
                              e.currentTarget.style.borderColor = config.border
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'rgba(22, 27, 34, 0.6)'
                              e.currentTarget.style.borderColor = 'rgba(48, 54, 61, 0.5)'
                            }}
                          >
                            {/* Top row: ID + Count */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                              <span style={{ 
                                fontSize: 11, 
                                color: '#6e7681', 
                                fontFamily: 'monospace',
                                background: 'rgba(48, 54, 61, 0.5)',
                                padding: '3px 8px',
                                borderRadius: 4,
                                fontWeight: 600
                              }}>
                                {sector.sectorId}
                              </span>
                              <span style={{
                                fontSize: 20,
                                fontWeight: 700,
                                color: config.accent
                              }}>
                                {sector.symbols}
                              </span>
                            </div>
                            
                            {/* Name */}
                            <div style={{ 
                              fontSize: 13, 
                              fontWeight: 600, 
                              color: '#e6edf3',
                              lineHeight: 1.4,
                              marginBottom: 10,
                              minHeight: 36
                            }}>
                              {sector.sectorName}
                            </div>

                            {/* Real-time Quote */}
                            {quotes[sector.sectorId] && (
                              <div style={{
                                marginBottom: 10,
                                padding: '6px 10px',
                                background: 'rgba(0, 229, 160, 0.08)',
                                borderRadius: 6,
                                border: '1px solid rgba(0, 229, 160, 0.15)',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center'
                              }}>
                                <span style={{ fontSize: 11, color: '#8b949e', fontWeight: 500 }}>
                                  {quotes[sector.sectorId].symbol}
                                </span>
                                <span style={{ fontSize: 13, fontWeight: 700, color: '#00e5a0', fontFamily: 'monospace' }}>
                                  R$ {Number(quotes[sector.sectorId].priceBRL || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                              </div>
                            )}
                            
                            {/* Progress bar */}
                            <div style={{ 
                              height: 4, 
                              background: 'rgba(48, 54, 61, 0.4)', 
                              borderRadius: 2,
                              marginBottom: 10,
                              overflow: 'hidden'
                            }}>
                              <div style={{ 
                                height: '100%', 
                                width: `${fillPct}%`, 
                                background: config.accent,
                                borderRadius: 2,
                                transition: 'width 0.3s'
                              }} />
                            </div>
                            
                            {/* Exchanges */}
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                              {sector.exchanges.slice(0, 3).map(ex => (
                                <span key={ex} style={{
                                  fontSize: 10,
                                  padding: '2px 6px',
                                  background: 'rgba(48, 54, 61, 0.5)',
                                  borderRadius: 4,
                                  color: '#8b949e'
                                }}>
                                  {ex}
                                </span>
                              ))}
                              {sector.exchanges.length > 3 && (
                                <span style={{ fontSize: 10, color: '#6e7681' }}>
                                  +{sector.exchanges.length - 3}
                                </span>
                              )}
                            </div>
                          </Link>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {filtered.length === 0 && !loading && (
            <div style={{ textAlign: 'center', padding: 60, color: '#8b949e' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
              Nenhum setor encontrado para "{search}"
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
