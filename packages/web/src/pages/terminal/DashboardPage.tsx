import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { pythonApiUrl } from "../../lib/browserApiOrigin";
import { 
  Terminal, ShieldAlert, TrendingUp, TrendingDown, 
  MessageSquare, Users, Award, Zap, 
  Globe, Clock, ChevronRight, Activity, 
  Hexagon, Server, Wallet, BarChart3, PieChart
} from "lucide-react";

// Setores reais do arquivo sectors.csv (53 setores)
const SECTOR_IMAGES: Record<string, string> = {
  'agro': '/fotos/Agronegócio, Construção e Educação.jpg',
  'construcao': '/fotos/Agronegócio, Construção e Educação.jpg',
  'educacao': '/fotos/Agronegócio, Construção e Educação.jpg',
  'energia': '/fotos/Energia e Financeiro Bancos Fintechs Seguros.jpg',
  'financeiro': '/fotos/Energia e Financeiro Bancos Fintechs Seguros.jpg',
  'global': '/fotos/Mercado Global NYSENASDAQ.jpg',
  'mineracao': '/fotos/Mineração,Siderurgia,Papel,QuímicaePetróleo.jpg',
  'papel': '/fotos/Mineração,Siderurgia,Papel,QuímicaePetróleo.jpg',
  'petroleo': '/fotos/Mineração,Siderurgia,Papel,QuímicaePetróleo.jpg',
  'saude': '/fotos/Saúde, Saneamento, Tecnologia, Telecom e Transportes (2).jpg',
  'saneamento': '/fotos/Saúde, Saneamento, Tecnologia, Telecom e Transportes (2).jpg',
  'tecnologia': '/fotos/Saúde, Saneamento, Tecnologia, Telecom e Transportes (2).jpg',
  'telecom': '/fotos/Saúde, Saneamento, Tecnologia, Telecom e Transportes (2).jpg',
  'transporte': '/fotos/Saúde, Saneamento, Tecnologia, Telecom e Transportes (2).jpg',
  'varejo': '/fotos/Consumo, Varejo e Commodities Milho Boi Café.jpg',
  'commodities': '/fotos/Consumo, Varejo e Commodities Milho Boi Café.jpg',
  'fii': '/fotos/Imobiliário Logístico Shopping.jpg',
  'moedas': '/fotos/Moedas e Renda Fixa.jpg',
  'renda': '/fotos/Moedas e Renda Fixa.jpg',
};

const NEWS_SECTORS = [
  { id: 1, name: "Ações - Agronegócio e Alimentos", symbols: 31, trend: "bull", alert: null, details: "Setor de alimentos e agronegócio com foco em exportações de soja, milho e proteínas.", image: 'agro' },
  { id: 2, name: "Ações - Construção Civil e Imóveis", symbols: 32, trend: "bear", alert: null, details: "Mercado imobiliário com pressão nos lançamentos e vendas.", image: 'construcao' },
  { id: 3, name: "Ações - Educação", symbols: 5, trend: "bull", alert: null, details: "Empresas de educação básica e superior em expansão digital.", image: 'educacao' },
  { id: 4, name: "Ações - Energia Elétrica", symbols: 49, trend: "bull", alert: "Renováveis", details: "Setor elétrico com forte expansão de energia solar e eólica.", image: 'energia' },
  { id: 5, name: "Ações - Financeiro - Bancos", symbols: 34, trend: "bull", alert: null, details: "Grandes bancos com resultados sólidos e margens estáveis.", image: 'financeiro' },
  { id: 6, name: "Ações - Financeiro - Fintechs", symbols: 13, trend: "bull", alert: "PIX", details: "Fintechs em crescimento com novos produtos de crédito.", image: 'financeiro' },
  { id: 7, name: "Ações - Financeiro - Seguros", symbols: 5, trend: "bear", alert: null, details: "Seguradoras com sinistralidade elevada.", image: 'financeiro' },
  { id: 8, name: "Ações - Mercado Global (NYSE/NASDAQ)", symbols: 49, trend: "bull", alert: "Tech", details: "Ações americanas com foco em tecnologia e IA.", image: 'global' },
  { id: 9, name: "Ações - Mineração e Siderurgia", symbols: 22, trend: "bull", alert: "Ferro", details: "Mineradoras com preços de commodities em alta.", image: 'mineracao' },
  { id: 10, name: "Ações - Outros Setores Brasil", symbols: 34, trend: "neutral", alert: null, details: "Diversos setores com performance mista.", image: 'global' },
  { id: 11, name: "Ações - Papel e Celulose", symbols: 7, trend: "bull", alert: null, details: "Exportações de celulose em expansão.", image: 'papel' },
  { id: 12, name: "Ações - Petroquímica e Química", symbols: 6, trend: "bear", alert: null, details: "Pressão nos preços de insumos petroquímicos.", image: 'petroleo' },
  { id: 13, name: "Ações - Petróleo e Gás", symbols: 18, trend: "bull", alert: "Petróleo", details: "Preço do barril em alta favorece produtoras.", image: 'petroleo' },
  { id: 14, name: "Ações - Saneamento", symbols: 11, trend: "bull", alert: null, details: "Investimentos em infraestrutura de água.", image: 'saneamento' },
  { id: 15, name: "Ações - Saúde e Farmácia", symbols: 29, trend: "bull", alert: null, details: "Laboratórios e hospitais em expansão.", image: 'saude' },
  { id: 16, name: "Ações - Tecnologia", symbols: 54, trend: "bull", alert: "IA Boom", details: "Setor de tecnologia com forte interesse em IA e cloud.", image: 'tecnologia' },
  { id: 17, name: "Ações - Telecomunicações", symbols: 11, trend: "bear", alert: null, details: "Concorrência intensa e margens pressionadas.", image: 'telecom' },
  { id: 18, name: "Ações - Transporte e Logística", symbols: 20, trend: "bull", alert: null, details: "Logística de e-commerce em expansão.", image: 'transporte' },
  { id: 19, name: "Ações - Varejo e Consumo", symbols: 33, trend: "bull", alert: null, details: "Varejo omnichannel com forte presença digital.", image: 'varejo' },
  { id: 20, name: "BDR - Ações Internacionais", symbols: 116, trend: "bull", alert: null, details: "Recibos de depósito de empresas estrangeiras.", image: 'global' },
  { id: 21, name: "Commodities - Agronegócio", symbols: 21, trend: "bull", alert: null, details: "Contratos futuros de commodities agrícolas.", image: 'commodities' },
  { id: 22, name: "Commodities - Café (BMF)", symbols: 7, trend: "bull", alert: null, details: "Café arábica e robusta em alta.", image: 'commodities' },
  { id: 23, name: "Commodities - Energia e Petróleo", symbols: 14, trend: "bull", alert: null, details: "Petróleo, gás natural e derivados.", image: 'commodities' },
  { id: 24, name: "Commodities - Etanol (BMF)", symbols: 2, trend: "bull", alert: null, details: "Etanol hidratado e anidro.", image: 'commodities' },
  { id: 25, name: "Commodities - Metais Preciosos", symbols: 9, trend: "bull", alert: "Ouro", details: "Ouro, prata e platina como ativos refúgio.", image: 'commodities' },
  { id: 26, name: "Commodities - Ouro (BMF)", symbols: 2, trend: "bull", alert: "Alta Ouro", details: "Contratos futuros de ouro em alta.", image: 'commodities' },
  { id: 27, name: "Cripto - ETFs e Fundos", symbols: 16, trend: "bull", alert: "Bitcoin", details: "ETFs de Bitcoin e Ethereum aprovados.", image: 'tecnologia' },
  { id: 28, name: "Cripto - Futuros (BMF)", symbols: 20, trend: "bull", alert: null, details: "Contratos futuros de criptomoedas.", image: 'tecnologia' },
  { id: 29, name: "Cripto - Spot", symbols: 41, trend: "bull", alert: "Altcoins", details: "Mercado spot de criptomoedas em expansão.", image: 'tecnologia' },
  { id: 30, name: "FII - CRI e Papel", symbols: 37, trend: "neutral", alert: null, details: "Certificados de recebíveis imobiliários.", image: 'fii' },
  { id: 31, name: "FII - Diversificado", symbols: 155, trend: "bull", alert: null, details: "Fundos imobiliários diversificados.", image: 'fii' },
  { id: 32, name: "FII - Fundo de Fundos", symbols: 6, trend: "neutral", alert: null, details: "FOFs com exposição a múltiplos FIIs.", image: 'fii' },
  { id: 33, name: "FII - Lajes Corporativas", symbols: 19, trend: "bear", alert: null, details: "Shoppings e lajes corporativas em recuperação.", image: 'fii' },
  { id: 34, name: "FII - Logístico e Industrial", symbols: 19, trend: "bull", alert: null, details: "Galpões logísticos com alta demanda.", image: 'fii' },
  { id: 35, name: "FII - Saúde e Hospitais", symbols: 5, trend: "bull", alert: null, details: "Imóveis de saúde com contratos longos.", image: 'fii' },
  { id: 36, name: "Moedas - Divisas Spot", symbols: 31, trend: "neutral", alert: null, details: "USD/BRL e outras divisas.", image: 'moedas' },
  { id: 37, name: "Moedas - ETF Câmbio", symbols: 4, trend: "neutral", alert: null, details: "ETFs indexados ao dólar.", image: 'moedas' },
  { id: 38, name: "Moedas - Futuros Câmbio", symbols: 22, trend: "neutral", alert: null, details: "Contratos futuros de dólar.", image: 'moedas' },
  { id: 39, name: "Moedas - Pares Cambiais", symbols: 24, trend: "neutral", alert: null, details: "Pares de moedas para trading.", image: 'moedas' },
  { id: 40, name: "Renda Fixa - Brasil", symbols: 16, trend: "bull", alert: null, details: "Títulos públicos e privados.", image: 'renda' },
  { id: 41, name: "Renda Fixa - Cupom Cambial", symbols: 58, trend: "bull", alert: null, details: "Híbridos com exposição cambial.", image: 'renda' },
  { id: 42, name: "Renda Fixa - Cupom IPCA/IGP-M", symbols: 48, trend: "bull", alert: null, details: "Títulos indexados à inflação.", image: 'renda' },
  { id: 43, name: "Renda Fixa - ETFs", symbols: 14, trend: "bull", alert: null, details: "ETFs de renda fixa.", image: 'renda' },
  { id: 44, name: "Renda Fixa - Futuros Juros", symbols: 56, trend: "bull", alert: null, details: "DI e outros futuros de juros.", image: 'renda' },
  { id: 45, name: "Renda Fixa - Spreads DI", symbols: 53, trend: "neutral", alert: null, details: "Estratégias de spread de juros.", image: 'renda' },
  { id: 46, name: "Renda Fixa - Swaps", symbols: 26, trend: "neutral", alert: null, details: "Derivativos de troca de taxas.", image: 'renda' },
  { id: 47, name: "Renda Fixa - Tesouro Direto", symbols: 44, trend: "bull", alert: null, details: "Títulos públicos federais.", image: 'renda' },
  { id: 48, name: "Taxas de Referência", symbols: 16, trend: "neutral", alert: null, details: "CDI, Selic e outras referências.", image: 'renda' },
  { id: 49, name: "Taxas de Referência - BOVESPA", symbols: 434, trend: "neutral", alert: null, details: "Taxas de empréstimo de ativos.", image: 'renda' },
  { id: 50, name: "Índices - ETFs", symbols: 54, trend: "bull", alert: null, details: "ETFs que replicam índices.", image: 'global' },
  { id: 51, name: "Índices - Futuros (BMF)", symbols: 21, trend: "bull", alert: null, details: "Futuros de IBOV, S&P e outros.", image: 'global' },
  { id: 52, name: "Índices - Globais e Brasileiros", symbols: 28, trend: "bull", alert: null, details: "Índices de mercado nacionais e internacionais.", image: 'global' },
];

const LEADERBOARD_INDIVIDUAL = [
  { rank: 1, name: "GHOST_TRADER", score: "94.2", tier: "DIAMOND", strategy: "HFT Arbitrage", winRate: "82%" },
  { rank: 2, name: "QUANT_ALPHA", score: "91.8", tier: "DIAMOND", strategy: "Neural Networks", winRate: "78%" },
  { rank: 3, name: "NULL_POINTER", score: "88.5", tier: "PLATINUM", strategy: "Macro Global", winRate: "71%" },
  { rank: 4, name: "CYBER_BULL", score: "87.1", tier: "PLATINUM", strategy: "Trend Following", winRate: "65%" },
  { rank: 5, name: "VALKYRIE", score: "85.9", tier: "GOLD", strategy: "Mean Reversion", winRate: "69%" },
];

const LEADERBOARD_TEAMS = [
  { rank: 1, name: "QUANTUM_LEAGUE", score: "96.8", members: 12 },
  { rank: 2, name: "ALPHA_SYNDICATE", score: "93.4", members: 8 },
  { rank: 3, name: "CIPHER_COLLECTIVE", score: "89.2", members: 15 },
  { rank: 4, name: "NEURAL_NETWORKS", score: "87.6", members: 6 },
  { rank: 5, name: "DARK_POOL", score: "84.3", members: 10 },
];

type SectorFromAPI = {
  sector_id: string;
  sector_name: string;
  count: number;
  exchanges: string[];
};

// CSS Styles
const css = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #000; color: #fff; font-family: 'Space Grotesk', sans-serif; }
  
  .glass-panel {
    background: linear-gradient(135deg, rgba(0, 20, 30, 0.95) 0%, rgba(0, 10, 20, 0.98) 100%);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(0, 255, 200, 0.15);
    border-radius: 4px;
  }
  
  .text-cyan { color: #00ffc8; }
  .text-gold { color: #ffc800; }
  .text-green { color: #4ade80; }
  .text-red { color: #f87171; }
  .text-muted { color: #64748b; }
  .text-white { color: #ffffff; }
  
  .bg-cyan { background-color: #00ffc8; }
  .bg-gold { background-color: #ffc800; }
  .bg-dark { background-color: rgba(0, 0, 0, 0.6); }
  .bg-panel { background: rgba(0, 20, 30, 0.8); }
  
  .border-cyan { border-color: rgba(0, 255, 200, 0.3); }
  .border-gold { border-color: rgba(255, 200, 0, 0.3); }
  
  .glow-cyan { box-shadow: 0 0 20px rgba(0, 255, 200, 0.3); }
  .glow-gold { box-shadow: 0 0 20px rgba(255, 200, 0, 0.3); }
  .text-glow-cyan { text-shadow: 0 0 10px rgba(0, 255, 200, 0.5); }
  
  .mono { font-family: 'JetBrains Mono', monospace; }
  .font-bold { font-weight: 700; }
  
  .no-scrollbar::-webkit-scrollbar { display: none; }
  .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
  
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
  @keyframes ping { 75%, 100% { transform: scale(2); opacity: 0; } }
  .animate-pulse { animation: pulse 2s infinite; }
  .animate-ping { animation: ping 1s infinite; }
  
  @media (min-width: 1024px) {
    .lg\\:col-left { display: flex !important; }
    .lg\\:col-right { display: flex !important; }
    .main-grid { grid-template-columns: 1fr 2fr 1fr !important; }
  }
`;

export default function Dashboard() {
  const navigate = useNavigate();
  const [chatTab, setChatTab] = useState<'whisper' | 'team'>('whisper');
  const [leaderboardTab, setLeaderboardTab] = useState<'solo' | 'team'>('solo');
  const [selectedSector, setSelectedSector] = useState<number | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [apiSectors, setApiSectors] = useState<SectorFromAPI[]>([]);

  // Fetch sectors from Python API
  useEffect(() => {
    fetch(pythonApiUrl('/sectors'))
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data?.sectors)) {
          setApiSectors(data.sectors);
        }
      })
      .catch(() => {});
  }, []);

  // Extrai palavra-chave do nome do setor (ex: "Ações - Agronegócio e Alimentos" -> "AGRO")
  const getSectorKeyword = (name: string): string => {
    const parts = name.split(' - ');
    const lastPart = parts[parts.length - 1] || name;
    // Pega a primeira palavra significativa
    const words = lastPart.split(' ').filter(w => w.length > 2 && !['com', 'para', 'outros', 'e', 'de'].includes(w.toLowerCase()));
    const keyword = words[0] || lastPart.split(' ')[0] || 'SETOR';
    return keyword.toUpperCase().substring(0, 6);
  };

  // Use API sectors if available, otherwise fallback to hardcoded
  const displaySectors = apiSectors.length > 0 
    ? apiSectors.map((s) => ({
        id: s.sector_id,
        name: s.sector_name,
        keyword: getSectorKeyword(s.sector_name),
        symbols: s.count,
        trend: 'bull' as const,
        alert: null,
        details: '',
        image: 'global'
      }))
    : NEWS_SECTORS;

  return (
    <>
      <style>{css}</style>
      {/* Hero Background */}
      <div style={{
        position: 'fixed',
        inset: 0,
        zIndex: -1,
        opacity: 0.15,
        backgroundImage: `url(/fotos/O%20Coração%20da%20Plataforma.jpg)`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        filter: 'blur(2px)',
      }} />
      <div style={{
        minHeight: '100vh',
        height: '100vh',
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        color: '#fff',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <header className="glass-panel" style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '24px',
          padding: '12px 24px',
          borderLeft: '4px solid #00ffc8',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Hexagon size={20} className="text-cyan" />
              <span className="font-bold" style={{ fontSize: '18px', letterSpacing: '0.1em' }}>
                VEXOR<span className="text-cyan text-glow-cyan">.TERMINAL</span>
              </span>
            </div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '4px 16px',
              background: 'rgba(0, 255, 200, 0.1)',
              borderRadius: '999px',
              border: '1px solid rgba(0, 255, 200, 0.3)',
            }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#00ffc8' }} className="animate-pulse" />
              <span className="mono text-cyan" style={{ fontSize: '10px', letterSpacing: '0.1em' }}>GUARDIAN SECURE</span>
            </div>
          </div>
          
          <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: '24px', fontSize: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Server size={16} className="text-cyan" />
              <span>NYS: <span className="text-green">OPEN</span></span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Clock size={16} className="text-cyan" />
              <span>14:23:45 UTC</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingLeft: '16px', borderLeft: '1px solid rgba(255,255,255,0.1)' }}>
              <div style={{ textAlign: 'right' }}>
                <div className="font-bold">OPERADOR_01</div>
                <div className="text-gold" style={{ fontSize: '9px', letterSpacing: '0.1em' }}>NÍVEL: GLADIADOR</div>
              </div>
              <div style={{
                width: 32,
                height: 32,
                borderRadius: 4,
                background: 'rgba(255, 200, 0, 0.2)',
                border: '1px solid rgba(255, 200, 0, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }} className="text-gold font-bold">O1</div>
            </div>
          </div>
        </header>

        {/* Main Grid */}
        <main className="main-grid" style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: '1fr',
          gap: '16px',
          minHeight: 0,
        }}>
          {/* LEFT COLUMN */}
          <div className="lg:col-left glass-panel" style={{
            display: 'none',
            flexDirection: 'column',
            overflow: 'hidden',
          }}>
            <div style={{
              padding: '16px',
              borderBottom: '1px solid rgba(255,255,255,0.05)',
              background: 'rgba(0,0,0,0.4)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Globe size={16} className="text-cyan" />
                <h2 className="mono font-bold" style={{ fontSize: '12px', letterSpacing: '0.2em' }}>SETÓRES_MERCADO</h2>
              </div>
              <span className="mono text-muted" style={{ fontSize: '10px' }}>{displaySectors.length} SETORES</span>
            </div>
            
            <div className="no-scrollbar" style={{ flex: 1, overflow: 'auto', padding: '8px' }}>
              {displaySectors.filter((s, i, arr) => arr.findIndex(x => x.id === s.id) === i).map((sector) => (
                <div key={sector.id} style={{ marginBottom: '8px' }}>
                  <motion.div
                    whileHover={{ scale: 1.02 }}
                    onClick={() => navigate(`/app/sector/${sector.id}`)}
                    style={{
                      padding: '12px',
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.05)',
                      borderRadius: 4,
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <div className="mono text-muted" style={{ fontSize: '10px', marginBottom: '4px' }}>
                        {(sector as any).keyword || sector.id}
                      </div>
                      <div className="font-bold" style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {sector.name}
                        {sector.alert && (
                          <span style={{
                            padding: '2px 6px',
                            background: sector.trend === 'bear' ? 'rgba(248, 113, 113, 0.2)' : 'rgba(255, 200, 0, 0.2)',
                            color: sector.trend === 'bear' ? '#f87171' : '#ffc800',
                            fontSize: '8px',
                            borderRadius: 2,
                            border: `1px solid ${sector.trend === 'bear' ? 'rgba(248, 113, 113, 0.3)' : 'rgba(255, 200, 0, 0.3)'}`,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}>
                            {sector.trend === 'bear' ? '⚠️' : '⚡'}
                            {sector.alert}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="mono" style={{
                      fontSize: '12px',
                      color: sector.trend === 'bull' ? '#4ade80' : sector.trend === 'bear' ? '#f87171' : '#64748b',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}>
                      {sector.symbols} ativos
                      {sector.trend === 'bull' ? <TrendingUp size={12} /> : sector.trend === 'bear' ? <TrendingDown size={12} /> : null}
                    </div>
                  </motion.div>
                </div>
              ))}
            </div>
          </div>

          {/* MIDDLE COLUMN */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minHeight: 0 }}>
            {/* Stats Row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', height: 96 }}>
              {[
                { label: "SALDO TOTAL", val: "$124,502", icon: Wallet, color: "#00ffc8", bg: null },
                { label: "LUCRO 24H", val: "+$3,420", icon: TrendingUp, color: "#4ade80", bg: null },
                { label: "RISCO ATUAL", val: "MÍNIMO", icon: ShieldAlert, color: "#ffc800", bg: "/fotos/O%20Escudo%20Anti-Compulsão.jpg" },
              ].map((stat, i) => (
                <div key={i} className="glass-panel" style={{
                  padding: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  position: 'relative',
                  cursor: 'pointer',
                  overflow: 'hidden',
                }}>
                  {stat.bg && (
                    <div style={{
                      position: 'absolute',
                      inset: 0,
                      opacity: 0.15,
                      backgroundImage: `url(${stat.bg})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }} />
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <stat.icon size={12} style={{ color: stat.color }} />
                    <span className="mono text-muted" style={{ fontSize: '9px', letterSpacing: '0.1em' }}>{stat.label}</span>
                  </div>
                  <div className="font-bold" style={{ fontSize: '18px' }}>{stat.val}</div>
                </div>
              ))}
            </div>

            {/* Chat Area */}
            <div className="glass-panel" style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              position: 'relative',
            }}>
              {/* Tabs */}
              <div style={{
                display: 'flex',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                background: 'rgba(0,0,0,0.6)',
              }}>
                <button
                  onClick={() => setChatTab('whisper')}
                  style={{
                    flex: 1,
                    padding: '16px',
                    background: chatTab === 'whisper' ? 'rgba(0, 255, 200, 0.05)' : 'transparent',
                    border: 'none',
                    borderBottom: `2px solid ${chatTab === 'whisper' ? '#00ffc8' : 'transparent'}`,
                    color: chatTab === 'whisper' ? '#00ffc8' : '#64748b',
                    cursor: 'pointer',
                    fontSize: '12px',
                    letterSpacing: '0.1em',
                  }} className="mono"
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                    <MessageSquare size={16} />
                    VEXOR_CHAT
                  </div>
                </button>
                <button
                  onClick={() => setChatTab('team')}
                  style={{
                    flex: 1,
                    padding: '16px',
                    background: chatTab === 'team' ? 'rgba(255, 200, 0, 0.05)' : 'transparent',
                    border: 'none',
                    borderBottom: `2px solid ${chatTab === 'team' ? '#ffc800' : 'transparent'}`,
                    color: chatTab === 'team' ? '#ffc800' : '#64748b',
                    cursor: 'pointer',
                    fontSize: '12px',
                    letterSpacing: '0.1em',
                  }} className="mono"
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                    <Users size={16} />
                    SQUAD_TRADERS
                  </div>
                </button>
              </div>

              {/* Messages */}
              <div className="no-scrollbar" style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                  <div style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    border: '1px solid rgba(0, 255, 200, 0.3)',
                    background: 'rgba(0, 255, 200, 0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }} className="glow-cyan">
                    <Terminal size={20} className="text-cyan" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '8px' }}>
                      <span className="font-bold" style={{ fontSize: '14px', letterSpacing: '0.1em' }}>VEXOR_CORE</span>
                      <span className="mono" style={{
                        fontSize: '9px',
                        color: '#00ffc8',
                        background: 'rgba(0, 255, 200, 0.05)',
                        padding: '2px 8px',
                        border: '1px solid rgba(0, 255, 200, 0.2)',
                        borderRadius: 2,
                      }}>ENCRYPTED</span>
                      <span className="mono text-muted" style={{ fontSize: '9px' }}>14:25:01</span>
                    </div>
                    <div style={{
                      padding: '16px',
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '0 12px 0 12px',
                      borderLeft: '4px solid rgba(0, 255, 200, 0.5)',
                      lineHeight: 1.6,
                    }}>
                      Analise de sentimentos completa: O setor de <span className="text-cyan font-bold">TECNOLOGIA</span> apresenta padrões de acumulação institucional.
                      <br /><br />
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: '#00ffc8',
                        }} className="animate-ping" />
                        <span className="mono font-bold" style={{ fontSize: '10px', color: 'rgba(0, 255, 200, 0.8)', letterSpacing: '0.1em' }}>
                          STATUS: PRONTO PARA EXECUÇÃO_
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Input */}
              <div style={{
                padding: '16px',
                borderTop: '1px solid rgba(255,255,255,0.05)',
                background: 'rgba(0,0,0,0.6)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <button style={{
                    width: 40,
                    height: 40,
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 4,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}>
                    <Terminal size={16} className="text-muted" />
                  </button>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <input
                      type="text"
                      placeholder="ESTABELECER COMANDO..."
                      style={{
                        width: '100%',
                        background: '#000',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 4,
                        padding: '10px 48px 10px 16px',
                        color: '#fff',
                        fontSize: '14px',
                        outline: 'none',
                      }} className="mono"
                    />
                    <button style={{
                      position: 'absolute',
                      right: 8,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: '#00ffc8',
                      cursor: 'pointer',
                    }}>
                      <ChevronRight size={20} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN */}
          <div className="lg:col-right" style={{
            display: 'none',
            flexDirection: 'column',
            gap: '16px',
            minHeight: 0,
          }}>
            {/* Market Overview */}
            <div className="glass-panel" style={{ padding: '16px', height: 192 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <BarChart3 size={16} className="text-gold" />
                  <span className="mono font-bold" style={{ fontSize: '12px', letterSpacing: '0.1em' }}>VISÃO_GERAL</span>
                </div>
                <Activity size={12} className="text-cyan animate-pulse" />
              </div>
              
              <div style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }} className="mono">
                  <span className="text-muted">Liquidez</span>
                  <span>ALTA (85%)</span>
                </div>
                <div style={{ height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 2, marginTop: 4, overflow: 'hidden' }}>
                  <div style={{ width: '85%', height: '100%', background: '#00ffc8' }} />
                </div>
              </div>
              
              <div style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }} className="mono">
                  <span className="text-muted">Volatilidade</span>
                  <span className="text-gold">ESTÁVEL (42%)</span>
                </div>
                <div style={{ height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 2, marginTop: 4, overflow: 'hidden' }}>
                  <div style={{ width: '42%', height: '100%', background: '#ffc800' }} />
                </div>
              </div>
              
              <button
                onClick={() => setShowAnalytics(!showAnalytics)}
                className="mono font-bold"
                style={{
                  width: '100%',
                  padding: '8px',
                  background: showAnalytics ? '#00ffc8' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${showAnalytics ? '#00ffc8' : 'rgba(255,255,255,0.1)'}`,
                  borderRadius: 4,
                  color: showAnalytics ? '#000' : '#fff',
                  cursor: 'pointer',
                  fontSize: '9px',
                  letterSpacing: '0.2em',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  <Zap size={12} />
                  {showAnalytics ? 'ANALÍTICA ATIVA' : 'ABRIR ANALYTICS 3D'}
                </div>
              </button>
            </div>

            {/* Leaderboard */}
            <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
              {/* Background por modo */}
              <div style={{
                position: 'absolute',
                inset: 0,
                opacity: 0.08,
                backgroundImage: leaderboardTab === 'solo' 
                  ? `url(/fotos/Modo%20Individual%20(Gladiador%20Tech).jpg)` 
                  : `url(/fotos/Modo%20TimeClã%20Escudo%20de%20Aliança.jpg)`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                transition: 'opacity 0.3s',
              }} />
              <div style={{
                padding: '16px',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                background: 'rgba(0,0,0,0.4)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                position: 'relative',
                zIndex: 1,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Award size={16} className="text-gold" />
                  <h2 className="mono font-bold" style={{ fontSize: '12px', letterSpacing: '0.2em' }}>ARENA_GLOBAL</h2>
                </div>
                <PieChart size={12} className="text-muted" />
              </div>
              
              <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <button
                  onClick={() => setLeaderboardTab('solo')}
                  className="mono"
                  style={{
                    flex: 1,
                    padding: '12px',
                    background: leaderboardTab === 'solo' ? 'rgba(255,255,255,0.1)' : 'transparent',
                    border: 'none',
                    color: leaderboardTab === 'solo' ? '#fff' : '#64748b',
                    cursor: 'pointer',
                    fontSize: '10px',
                    letterSpacing: '0.1em',
                  }}
                >
                  DUELOS
                </button>
                <button
                  onClick={() => setLeaderboardTab('team')}
                  className="mono"
                  style={{
                    flex: 1,
                    padding: '12px',
                    background: leaderboardTab === 'team' ? 'rgba(255, 200, 0, 0.2)' : 'transparent',
                    border: 'none',
                    borderLeft: '1px solid rgba(255,255,255,0.05)',
                    color: leaderboardTab === 'team' ? '#ffc800' : '#64748b',
                    cursor: 'pointer',
                    fontSize: '10px',
                    letterSpacing: '0.1em',
                  }}
                >
                  LIGAS
                </button>
              </div>
              
              <div className="no-scrollbar" style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
                {(leaderboardTab === 'solo' ? LEADERBOARD_INDIVIDUAL : LEADERBOARD_TEAMS).map((item: any) => (
                  <motion.div
                    key={item.rank}
                    onClick={() => setSelectedPlayer(selectedPlayer === item.name ? null : item.name)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '12px',
                      marginBottom: '8px',
                      background: item.rank === 1 ? 'rgba(255, 200, 0, 0.1)' : 'rgba(255,255,255,0.05)',
                      border: `1px solid ${item.rank === 1 ? 'rgba(255, 200, 0, 0.3)' : 'rgba(255,255,255,0.05)'}`,
                      borderRadius: 4,
                      cursor: 'pointer',
                    }} className={item.rank === 1 ? 'glow-gold' : ''}
                  >
                    <div className="font-bold" style={{
                      width: 24,
                      textAlign: 'center',
                      color: item.rank === 1 ? '#ffc800' : '#64748b',
                    }}>
                      {item.rank}
                    </div>
                    <div style={{ flex: 1, padding: '0 12px' }}>
                      <div className="font-bold" style={{ fontSize: '14px', letterSpacing: '0.05em' }}>{item.name}</div>
                      <div className="mono text-muted" style={{ fontSize: '9px' }}>
                        {item.tier || `${item.members} MEMBROS`}
                      </div>
                    </div>
                    <div className="mono font-bold" style={{ fontSize: '12px' }}>{item.score}</div>
                  </motion.div>
                ))}
              </div>
              
              {/* Profile */}
              <div style={{
                padding: '16px',
                background: 'rgba(0, 255, 200, 0.05)',
                borderTop: '1px solid rgba(0, 255, 200, 0.2)',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}>
                <div style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  border: '2px solid #00ffc8',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: '#000',
                  fontSize: '12px',
                }} className="glow-cyan text-cyan font-bold">
                  O1
                </div>
                <div style={{ flex: 1 }}>
                  <div className="font-bold" style={{ fontSize: '12px' }}>OPERADOR_01</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ width: '72%', height: '100%', background: '#00ffc8' }} />
                    </div>
                    <span className="mono font-bold text-cyan" style={{ fontSize: '9px' }}>LV.42</span>
                  </div>
                </div>
                <ChevronRight size={16} className="text-muted" />
              </div>
            </div>
          </div>
        </main>

        {/* Analytics Overlay */}
        <AnimatePresence>
          {showAnalytics && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="glass-panel"
              style={{
                position: 'fixed',
                inset: '40px',
                zIndex: 50,
                border: '1px solid rgba(0, 255, 200, 0.3)',
                borderRadius: 8,
                display: 'flex',
                flexDirection: 'column',
                padding: 4,
              }}
            >
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: 4,
                background: 'linear-gradient(90deg, transparent, #00ffc8, transparent)',
              }} className="animate-pulse" />
              
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '16px',
                borderBottom: '1px solid rgba(0, 255, 200, 0.2)',
                background: 'rgba(0, 255, 200, 0.05)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{
                    width: 32,
                    height: 32,
                    borderRadius: 4,
                    background: 'rgba(0, 255, 200, 0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <Zap size={16} className="text-cyan" />
                  </div>
                  <h3 className="font-bold" style={{ letterSpacing: '0.3em' }}>VEXOR_ANALYTICS_3D</h3>
                </div>
                <button
                  onClick={() => setShowAnalytics(false)}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    border: '1px solid rgba(255,255,255,0.2)',
                    background: 'none',
                    color: '#fff',
                    cursor: 'pointer',
                  }}
                >
                  <ChevronRight size={16} style={{ transform: 'rotate(90deg)' }} />
                </button>
              </div>
              
              <div style={{
                flex: 1,
                background: 'rgba(0,0,0,0.8)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <div style={{ textAlign: 'center' }}>
                  <Activity size={64} className="text-cyan animate-pulse" style={{ margin: '0 auto 24px' }} />
                  <div className="font-bold text-cyan text-glow-cyan" style={{ fontSize: '24px', letterSpacing: '0.5em' }}>
                    MODO VISUAL ATIVO
                  </div>
                  <div className="mono text-muted" style={{ fontSize: '12px', letterSpacing: '0.1em', marginTop: '8px' }}>
                    Processando redes neurais de mercado...
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
