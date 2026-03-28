import { Routes, Route, Link } from 'react-router-dom'

function MarketplaceHome() {
  return (
    <div className="marketplace-home">
      <h2>🏪 MARKETPLACE</h2>
      <p className="subtitle">Explore estratégias, bots e ferramentas</p>
      <div className="categories">
        <Link to="strategies" className="category-card">
          <span className="icon">📊</span>
          <span className="name">Estratégias</span>
          <span className="count">12 disponíveis</span>
        </Link>
        <Link to="bots" className="category-card">
          <span className="icon">🤖</span>
          <span className="name">Bots</span>
          <span className="count">8 disponíveis</span>
        </Link>
        <Link to="indicators" className="category-card">
          <span className="icon">📈</span>
          <span className="name">Indicadores</span>
          <span className="count">15 disponíveis</span>
        </Link>
        <Link to="signals" className="category-card">
          <span className="icon">🎯</span>
          <span className="name">Sinais</span>
          <span className="count">5 provedores</span>
        </Link>
      </div>
      <style>{`
        .marketplace-home { padding: 40px 20px; max-width: 1000px; margin: 0 auto; }
        .marketplace-home h2 { font-family: 'Orbitron', sans-serif; font-size: 24px; color: #00FFFF; text-align: center; margin-bottom: 10px; }
        .marketplace-home .subtitle { text-align: center; color: rgba(255,255,255,0.5); font-size: 12px; margin-bottom: 40px; }
        .categories { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; }
        .category-card { background: rgba(0,255,255,0.05); border: 1px solid rgba(0,255,255,0.2); border-radius: 16px; padding: 30px; text-align: center; text-decoration: none; transition: all 0.2s; }
        .category-card:hover { background: rgba(0,255,255,0.1); border-color: rgba(0,255,255,0.4); transform: translateY(-4px); }
        .category-card .icon { font-size: 40px; display: block; margin-bottom: 15px; }
        .category-card .name { font-family: 'Orbitron', sans-serif; font-size: 14px; color: #fff; display: block; margin-bottom: 5px; }
        .category-card .count { font-size: 11px; color: rgba(255,255,255,0.5); }
      `}</style>
    </div>
  )
}

function StrategiesPage() {
  const strategies = [
    { id: 1, name: 'NEXUS MT5', author: 'VEXOR Labs', rating: 4.8, price: 'Gratuito', desc: 'Sistema multi-agente com consenso 3/5' },
    { id: 2, name: 'Trend Follower Pro', author: 'TraderX', rating: 4.5, price: 'R$ 99/mês', desc: 'Seguidor de tendência adaptativo' },
    { id: 3, name: 'Mean Reversion Master', author: 'QuantBrasil', rating: 4.3, price: 'R$ 149/mês', desc: 'Reversão à média com Bollinger' },
  ]
  return (
    <div className="strategies-page">
      <Link to="/marketplace" className="back-link">← Voltar</Link>
      <h2>📊 ESTRATÉGIAS</h2>
      <div className="strategies-list">
        {strategies.map(s => (
          <div key={s.id} className="strategy-card">
            <div className="strategy-header">
              <span className="name">{s.name}</span>
              <span className="price">{s.price}</span>
            </div>
            <p className="desc">{s.desc}</p>
            <div className="meta">
              <span className="author">por {s.author}</span>
              <span className="rating">⭐ {s.rating}</span>
            </div>
          </div>
        ))}
      </div>
      <style>{`
        .strategies-page { padding: 40px 20px; max-width: 800px; margin: 0 auto; }
        .strategies-page h2 { font-family: 'Orbitron', sans-serif; font-size: 24px; color: #00FFFF; margin-bottom: 30px; }
        .back-link { color: rgba(255,255,255,0.5); text-decoration: none; font-size: 12px; }
        .back-link:hover { color: #00FFFF; }
        .strategies-list { display: flex; flex-direction: column; gap: 16px; }
        .strategy-card { background: rgba(0,255,255,0.05); border: 1px solid rgba(0,255,255,0.2); border-radius: 12px; padding: 20px; }
        .strategy-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
        .strategy-header .name { font-family: 'Orbitron', sans-serif; font-size: 16px; color: #fff; }
        .strategy-header .price { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #00FFFF; }
        .strategy-card .desc { font-size: 13px; color: rgba(255,255,255,0.6); margin: 0 0 10px 0; }
        .strategy-card .meta { display: flex; justify-content: space-between; font-size: 11px; color: rgba(255,255,255,0.4); }
      `}</style>
    </div>
  )
}

function BotsPage() {
  return (
    <div className="bots-page">
      <Link to="/marketplace" className="back-link">← Voltar</Link>
      <h2>🤖 BOTS</h2>
      <p className="coming-soon">Em breve...</p>
      <style>{`
        .bots-page { padding: 40px 20px; text-align: center; }
        .bots-page h2 { font-family: 'Orbitron', sans-serif; font-size: 24px; color: #00FFFF; margin-bottom: 20px; }
        .back-link { color: rgba(255,255,255,0.5); text-decoration: none; font-size: 12px; display: block; margin-bottom: 20px; }
        .coming-soon { color: rgba(255,255,255,0.5); }
      `}</style>
    </div>
  )
}

export default function MarketplacePage() {
  return (
    <div className="marketplace-page">
      <header className="marketplace-header">
        <Link to="/app" className="back-link">← VOLTAR</Link>
        <h1>🏪 MARKETPLACE VEXOR</h1>
      </header>
      <Routes>
        <Route index element={<MarketplaceHome />} />
        <Route path="strategies" element={<StrategiesPage />} />
        <Route path="bots" element={<BotsPage />} />
        <Route path="indicators" element={<BotsPage />} />
        <Route path="signals" element={<BotsPage />} />
      </Routes>
      <style>{`
        .marketplace-page { min-height: 100vh; background: #000; color: #fff; font-family: 'Space Grotesk', sans-serif; padding: 20px; }
        .marketplace-header { text-align: center; margin-bottom: 20px; padding-top: 20px; position: relative; }
        .marketplace-header h1 { font-family: 'Orbitron', sans-serif; font-size: 24px; color: #00FFFF; margin: 10px 0; }
        .marketplace-header .back-link { color: rgba(255,255,255,0.5); text-decoration: none; font-size: 12px; position: absolute; left: 0; top: 20px; }
        .marketplace-header .back-link:hover { color: #00FFFF; }
      `}</style>
    </div>
  )
}
