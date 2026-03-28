import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

interface Asset {
  symbol: string
  name: string
  price: number
  change: number
  volume: string
}

export default function SectorAgroPage() {
  const { sectorId } = useParams()
  const [assets, setAssets] = useState<Asset[]>([
    { symbol: 'SOJA3', name: 'Boa Safra', price: 12.45, change: 2.3, volume: '1.2M' },
    { symbol: 'AGRO3', name: 'Brasil Agro', price: 28.90, change: -0.8, volume: '890K' },
    { symbol: 'SLCE3', name: 'SLC Agrícola', price: 45.20, change: 1.5, volume: '650K' },
    { symbol: 'CMIN3', name: 'CSN Mineração', price: 8.75, change: 3.2, volume: '2.1M' },
    { symbol: 'FERT3', name: 'Fertilizantes', price: 22.30, change: -1.2, volume: '430K' },
    { symbol: 'SMTO3', name: 'São Martinho', price: 18.60, change: 0.9, volume: '720K' },
  ])

  const sectorInfo = {
    name: 'Agronegócio',
    description: 'Empresas do setor agrícola e agroindustrial',
    marketCap: 'R$ 45.2 bi',
    trend: 'Alta',
    risk: 'Médio'
  }

  return (
    <div className="sector-agro-page">
      <div className="page-header">
        <Link to="/app/sectors" className="back-link">← SETORES</Link>
        <h1>🌾 SETOR AGRO</h1>
        <p className="subtitle">{sectorInfo.description}</p>
      </div>

      <div className="sector-stats">
        <div className="stat-card">
          <span className="stat-label">Valor de Mercado</span>
          <span className="stat-value">{sectorInfo.marketCap}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Tendência</span>
          <span className="stat-value trend-up">{sectorInfo.trend}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Risco</span>
          <span className="stat-value">{sectorInfo.risk}</span>
        </div>
      </div>

      <div className="assets-section">
        <h2>📊 Ativos do Setor</h2>
        <div className="assets-table">
          <div className="table-header">
            <span>Símbolo</span>
            <span>Nome</span>
            <span>Preço</span>
            <span>Var%</span>
            <span>Volume</span>
          </div>
          {assets.map(asset => (
            <div key={asset.symbol} className="table-row">
              <span className="symbol">{asset.symbol}</span>
              <span className="name">{asset.name}</span>
              <span className="price">R$ {asset.price.toFixed(2)}</span>
              <span className={`change ${asset.change >= 0 ? 'up' : 'down'}`}>
                {asset.change >= 0 ? '+' : ''}{asset.change.toFixed(1)}%
              </span>
              <span className="volume">{asset.volume}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="news-section">
        <h2>📰 Notícias do Setor</h2>
        <div className="news-list">
          <div className="news-item">
            <span className="news-date">17/03/2026</span>
            <span className="news-title">Safra de soja bate recorde no Brasil</span>
          </div>
          <div className="news-item">
            <span className="news-date">16/03/2026</span>
            <span className="news-title">Preços do milho em alta com demanda chinesa</span>
          </div>
          <div className="news-item">
            <span className="news-date">15/03/2026</span>
            <span className="news-title">Fertilizantes têm queda de 15% no preço internacional</span>
          </div>
        </div>
      </div>

      <style>{`
        .sector-agro-page { padding: 20px; max-width: 1000px; margin: 0 auto; }
        .page-header { text-align: center; margin-bottom: 30px; position: relative; }
        .page-header h1 { font-family: 'Orbitron', sans-serif; font-size: 24px; color: #00FFFF; margin: 10px 0; }
        .page-header .subtitle { color: rgba(255,255,255,0.5); font-size: 12px; }
        .back-link { color: rgba(255,255,255,0.5); text-decoration: none; font-size: 12px; position: absolute; left: 0; top: 0; }
        .back-link:hover { color: #00FFFF; }
        .sector-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 30px; }
        .stat-card { background: rgba(0,255,255,0.05); border: 1px solid rgba(0,255,255,0.2); border-radius: 12px; padding: 20px; text-align: center; }
        .stat-label { font-size: 10px; color: rgba(255,255,255,0.5); text-transform: uppercase; display: block; margin-bottom: 8px; }
        .stat-value { font-family: 'Orbitron', sans-serif; font-size: 18px; color: #fff; }
        .stat-value.trend-up { color: #00FF88; }
        .assets-section, .news-section { margin-bottom: 30px; }
        .assets-section h2, .news-section h2 { font-family: 'Orbitron', sans-serif; font-size: 14px; color: #00FFFF; margin-bottom: 16px; }
        .assets-table { background: rgba(0,255,255,0.02); border: 1px solid rgba(0,255,255,0.1); border-radius: 12px; overflow: hidden; }
        .table-header, .table-row { display: grid; grid-template-columns: 1fr 2fr 1fr 1fr 1fr; padding: 14px 20px; }
        .table-header { background: rgba(0,255,255,0.1); font-size: 10px; color: rgba(255,255,255,0.5); text-transform: uppercase; }
        .table-row { border-top: 1px solid rgba(255,255,255,0.05); font-size: 13px; }
        .table-row:hover { background: rgba(0,255,255,0.03); }
        .symbol { font-family: 'Orbitron', sans-serif; color: #00FFFF; }
        .name { color: rgba(255,255,255,0.8); }
        .price { font-family: 'JetBrains Mono', monospace; color: #fff; }
        .change { font-family: 'JetBrains Mono', monospace; }
        .change.up { color: #00FF88; }
        .change.down { color: #FF4444; }
        .volume { font-family: 'JetBrains Mono', monospace; color: rgba(255,255,255,0.6); }
        .news-list { display: flex; flex-direction: column; gap: 12px; }
        .news-item { background: rgba(0,255,255,0.03); border: 1px solid rgba(0,255,255,0.1); border-radius: 8px; padding: 14px 18px; display: flex; gap: 16px; }
        .news-date { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: rgba(255,255,255,0.4); min-width: 90px; }
        .news-title { font-size: 13px; color: rgba(255,255,255,0.8); }
        @media (max-width: 600px) {
          .sector-stats { grid-template-columns: 1fr; }
          .table-header, .table-row { grid-template-columns: 1fr 1fr 1fr; }
          .name, .volume { display: none; }
        }
      `}</style>
    </div>
  )
}
