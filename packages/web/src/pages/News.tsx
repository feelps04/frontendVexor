import { useEffect, useState } from 'react'
import { apiGet, apiPost } from '../lib/api'

type Article = {
  id: string
  source: string
  external_id: string
  title: string
  url: string
  published_at: string
  summary: string | null
}

export default function NewsPage() {
  const [articles, setArticles] = useState<Article[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await apiGet<{ articles: Article[] }>('/api/v1/news')
      setArticles(data.articles)
    } catch (e: any) {
      setError(e?.message || 'Erro ao carregar notícias')
    } finally {
      setLoading(false)
    }
  }

  async function refresh() {
    setRefreshing(true)
    setError(null)
    try {
      await apiPost('/api/v1/news/refresh', {})
      await load()
    } catch (e: any) {
      setError(e?.message || 'Erro ao atualizar notícias')
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'grid', gap: 2 }}>
          <h1 style={{ margin: 0, fontSize: 18 }}>Notícias</h1>
          <div style={{ opacity: 0.75, fontSize: 12 }}>
            Cache SQL + refresh manual (requer `NEWS_API_KEY` no backend)
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} disabled={loading || refreshing}>
            Recarregar
          </button>
          <button onClick={refresh} disabled={loading || refreshing}>
            {refreshing ? 'Atualizando...' : 'Atualizar'}
          </button>
        </div>
      </div>

      {error ? <div style={{ color: '#ff8a8a' }}>{error}</div> : null}
      {loading ? <div style={{ opacity: 0.75 }}>Carregando...</div> : null}

      {!loading && articles.length === 0 ? (
        <div style={{ opacity: 0.75 }}>
          Sem notícias no cache. Clique em <strong>Atualizar</strong>.
        </div>
      ) : null}

      <div style={{ display: 'grid', gap: 10 }}>
        {articles.map((a) => (
          <a
            key={a.id}
            href={a.url}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'block',
              textDecoration: 'none',
              color: 'inherit',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 12,
              padding: 12,
              background: 'rgba(0,0,0,0.12)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
              <strong style={{ fontSize: 14, lineHeight: 1.3 }}>{a.title}</strong>
              <span style={{ opacity: 0.65, fontSize: 11, whiteSpace: 'nowrap' }}>
                {new Date(a.published_at).toLocaleString()}
              </span>
            </div>
            <div style={{ marginTop: 6, opacity: 0.75, fontSize: 12 }}>
              {a.summary || 'Sem resumo'}
            </div>
            <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ opacity: 0.6, fontSize: 11 }}>{a.source}</span>
              <span style={{ opacity: 0.6, fontSize: 11 }}>abrir</span>
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}
