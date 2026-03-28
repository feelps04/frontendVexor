import { useEffect, useState, useMemo, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  TrendingUp, TrendingDown, ChevronLeft, BarChart3, 
  Activity, Wallet, Clock, ArrowUpCircle, ArrowDownCircle,
  X, Check, AlertTriangle, Zap
} from 'lucide-react';
import { apiGet } from '../../lib/api';
import { pythonApiUrl } from '../../lib/browserApiOrigin';
import { useWebTransport, useWebSocketFallback, FeedMessage } from '../../hooks/useWebTransport';
import { useGeckos } from '../../hooks/useGeckos';
import { RealtimeChart } from '../../components/RealtimeChart';

// Mapeamento de imagens por setor
const SECTOR_IMAGES: Record<string, string> = {
  'sector_001': '/fotos/Agronegócio, Construção e Educação.jpg',
  'sector_002': '/fotos/Agronegócio, Construção e Educação.jpg',
  'sector_003': '/fotos/Agronegócio, Construção e Educação.jpg',
  'sector_004': '/fotos/Energia e Financeiro Bancos Fintechs Seguros.jpg',
  'sector_005': '/fotos/Energia e Financeiro Bancos Fintechs Seguros.jpg',
  'sector_006': '/fotos/Energia e Financeiro Bancos Fintechs Seguros.jpg',
  'sector_007': '/fotos/Energia e Financeiro Bancos Fintechs Seguros.jpg',
  'sector_008': '/fotos/Mercado Global NYSENASDAQ.jpg',
  'sector_009': '/fotos/Mineração,Siderurgia,Papel,QuímicaePetróleo.jpg',
  'sector_010': '/fotos/Mercado Global NYSENASDAQ.jpg',
  'sector_011': '/fotos/Mineração,Siderurgia,Papel,QuímicaePetróleo.jpg',
  'sector_012': '/fotos/Mineração,Siderurgia,Papel,QuímicaePetróleo.jpg',
  'sector_013': '/fotos/Mineração,Siderurgia,Papel,QuímicaePetróleo.jpg',
  'sector_014': '/fotos/Saúde, Saneamento, Tecnologia, Telecom e Transportes (2).jpg',
  'sector_015': '/fotos/Saúde, Saneamento, Tecnologia, Telecom e Transportes (2).jpg',
  'sector_016': '/fotos/Saúde, Saneamento, Tecnologia, Telecom e Transportes (2).jpg',
  'sector_017': '/fotos/Saúde, Saneamento, Tecnologia, Telecom e Transportes (2).jpg',
  'sector_018': '/fotos/Saúde, Saneamento, Tecnologia, Telecom e Transportes (2).jpg',
  'sector_019': '/fotos/Consumo, Varejo e Commodities Milho Boi Café.jpg',
  'sector_020': '/fotos/Mercado Global NYSENASDAQ.jpg',
  'sector_021': '/fotos/Consumo, Varejo e Commodities Milho Boi Café.jpg',
  'sector_022': '/fotos/Consumo, Varejo e Commodities Milho Boi Café.jpg',
  'sector_023': '/fotos/Consumo, Varejo e Commodities Milho Boi Café.jpg',
  'sector_024': '/fotos/Consumo, Varejo e Commodities Milho Boi Café.jpg',
  'sector_025': '/fotos/Consumo, Varejo e Commodities Milho Boi Café.jpg',
  'sector_026': '/fotos/Consumo, Varejo e Commodities Milho Boi Café.jpg',
  'sector_027': '/fotos/Saúde, Saneamento, Tecnologia, Telecom e Transportes (2).jpg',
  'sector_028': '/fotos/Saúde, Saneamento, Tecnologia, Telecom e Transportes (2).jpg',
  'sector_029': '/fotos/Saúde, Saneamento, Tecnologia, Telecom e Transportes (2).jpg',
  'sector_030': '/fotos/Imobiliário Logístico Shopping.jpg',
  'sector_031': '/fotos/Imobiliário Logístico Shopping.jpg',
  'sector_032': '/fotos/Imobiliário Logístico Shopping.jpg',
  'sector_033': '/fotos/Imobiliário Logístico Shopping.jpg',
  'sector_034': '/fotos/Imobiliário Logístico Shopping.jpg',
  'sector_035': '/fotos/Imobiliário Logístico Shopping.jpg',
  'sector_036': '/fotos/Moedas e Renda Fixa.jpg',
  'sector_037': '/fotos/Moedas e Renda Fixa.jpg',
  'sector_038': '/fotos/Moedas e Renda Fixa.jpg',
  'sector_039': '/fotos/Moedas e Renda Fixa.jpg',
  'sector_040': '/fotos/Moedas e Renda Fixa.jpg',
  'sector_041': '/fotos/Moedas e Renda Fixa.jpg',
  'sector_042': '/fotos/Moedas e Renda Fixa.jpg',
  'sector_043': '/fotos/Moedas e Renda Fixa.jpg',
  'sector_044': '/fotos/Moedas e Renda Fixa.jpg',
  'sector_045': '/fotos/Moedas e Renda Fixa.jpg',
  'sector_046': '/fotos/Moedas e Renda Fixa.jpg',
  'sector_047': '/fotos/Moedas e Renda Fixa.jpg',
  'sector_048': '/fotos/Moedas e Renda Fixa.jpg',
  'sector_049': '/fotos/Moedas e Renda Fixa.jpg',
  'sector_050': '/fotos/Mercado Global NYSENASDAQ.jpg',
  'sector_051': '/fotos/Mercado Global NYSENASDAQ.jpg',
  'sector_052': '/fotos/Mercado Global NYSENASDAQ.jpg',
};

type SymbolData = {
  sectorId: string;
  sectorName: string;
  exchange: string;
  symbol: string;
  description: string;
  type: string;
  fullSymbol: string;
};

type QuoteData = {
  symbol: string;
  exchange: string;
  priceBRL?: number;
  bid?: number;
  ask?: number;
  spread?: number;
  spreadPct?: number;
  updatedAt?: number;
  source?: string;
  status: 'ok' | 'no_data';
  message?: string;
};

type Trade = {
  id: string;
  symbol: string;
  type: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  total: number;
  timestamp: number;
  sectorId: string;
};

type Position = {
  symbol: string;
  quantity: number;
  avgPrice: number;
  currentPrice?: number;
  pnl?: number;
};

// Gera dados simulados de candles
function generateCandles(currentPrice: number) {
  const candles = [];
  let price = currentPrice * 0.95;
  for (let i = 0; i < 50; i++) {
    const change = (Math.random() - 0.48) * 0.02 * price;
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) + Math.random() * 0.005 * price;
    const low = Math.min(open, close) - Math.random() * 0.005 * price;
    candles.push({ open, high, low, close, time: Date.now() - (50 - i) * 60000 });
    price = close;
  }
  return candles;
}

export default function SectorDetailPage() {
  const { sectorId } = useParams<{ sectorId: string }>();
  const navigate = useNavigate();
  
  const [symbols, setSymbols] = useState<SymbolData[]>([]);
  const [quotes, setQuotes] = useState<Map<string, QuoteData>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [feedStale, setFeedStale] = useState(false);
  const lastTickTimeRef = useRef<number | null>(null);
  
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [tradeModal, setTradeModal] = useState<'BUY' | 'SELL' | null>(null);
  const [tradeQuantity, setTradeQuantity] = useState(1);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [positions, setPositions] = useState<Map<string, Position>>(new Map());
  const [currentTick, setCurrentTick] = useState<{ symbol: string; bid?: number; ask?: number; last?: number; volume?: number; time?: number } | null>(null);
  const [lastCandlePrices, setLastCandlePrices] = useState<Map<string, number>>(new Map());
  
  // Geckos.io para ticks em tempo real (baixa latência)
  const handleGeckosMessage = (msg: any) => {
    if (!msg || typeof msg !== 'object') return;
    
    if (msg.type === 'feed_status') {
      setFeedStale(msg.stale === true);
      if (msg.ageMs != null) {
        lastTickTimeRef.current = Date.now() - msg.ageMs;
      }
      return;
    }
    
    if (msg.type === 'init' && msg.lastPrices) {
      for (const [sym, data] of Object.entries(msg.lastPrices as Record<string, any>)) {
        const priceData = typeof data === 'number' 
          ? { priceBRL: data, bid: null, ask: null, spread: null, spreadPct: null }
          : data;
        const displayPrice = priceData.ask || priceData.priceBRL;
        if (displayPrice && Number.isFinite(displayPrice)) {
          setQuotes(prev => {
            const newMap = new Map(prev);
            newMap.set(sym, {
              symbol: sym,
              exchange: 'BOVESPA',
              priceBRL: displayPrice,
              bid: priceData.bid,
              ask: priceData.ask,
              spread: priceData.spread,
              spreadPct: priceData.spreadPct,
              updatedAt: Date.now(),
              source: 'cache',
              status: 'ok',
            });
            return newMap;
          });
        }
      }
      return;
    }
    
    if (msg.type === 'tick' || msg.type === 'ticks' || msg.type === 'prices') {
      const items = msg.type === 'ticks' || msg.type === 'prices' ? msg.items : [msg];
      for (const item of items) {
        const displayPrice = item.ask || item.priceBRL;
        if (item.symbol && displayPrice && Number.isFinite(displayPrice)) {
          setQuotes(prev => {
            const newMap = new Map(prev);
            newMap.set(item.symbol, {
              symbol: item.symbol,
              exchange: item.exchange || 'BOVESPA',
              priceBRL: displayPrice,
              bid: item.bid,
              ask: item.ask,
              spread: item.spread,
              spreadPct: item.spreadPct,
              updatedAt: Date.now(),
              source: item.source,
              status: 'ok',
            });
            return newMap;
          });
          lastTickTimeRef.current = Date.now();
          setFeedStale(false);
          
          // Atualizar tick atual para o gráfico
          if (selectedSymbol && item.symbol.toUpperCase().startsWith(selectedSymbol.toUpperCase())) {
            setCurrentTick({
              symbol: item.symbol,
              bid: item.bid,
              ask: item.ask,
              last: item.last || displayPrice,
              volume: item.volume,
              time: item.time || Math.floor(Date.now() / 1000)
            });
          }
        }
      }
    }
  };
  
  const { connected: geckosConnected } = useGeckos({
    symbols: symbols.map(s => s.symbol).filter(Boolean),
    onMessage: handleGeckosMessage,
    onConnect: () => {
      setWsConnected(true);
      setFeedStale(false);
    },
    onDisconnect: () => {
      setWsConnected(false);
    },
    enabled: symbols.length > 0
  });
  
  // Carregar símbolos do setor via Python API proxy
  useEffect(() => {
    async function loadSymbols() {
      if (!sectorId) return;
      setLoading(true);
      setError(null);
      try {
        // Usar Python API via API_BASE para obter símbolos do setor
        const res = await fetch(pythonApiUrl(`/sectors/${encodeURIComponent(sectorId)}/symbols`));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        
        if (data && Array.isArray(data.symbols)) {
          const sectorSymbols: SymbolData[] = data.symbols.map((s: any) => ({
            sectorId: sectorId,
            sectorName: data.sector_name || `SETOR ${sectorId}`,
            exchange: s.exchange || 'BOVESPA',
            symbol: s.symbol,
            description: s.description || s.name || '',
            type: s.type || '',
            fullSymbol: s.full_symbol || `${s.exchange || 'BOVESPA'}\\${s.symbol}`,
          }));
          
          setSymbols(sectorSymbols);
          if (sectorSymbols.length > 0) {
            setSelectedSymbol(sectorSymbols[0].symbol);
          }
        } else {
          setError('Nenhum ativo encontrado para este setor');
        }
      } catch (e) {
        setError('Erro ao carregar símbolos via API');
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    
    void loadSymbols();
  }, [sectorId]);
  
  // Buscar últimos preços dos candles quando não há tempo real
  useEffect(() => {
    if (symbols.length === 0 || wsConnected) return;
    
    const fetchLastCandlePrices = async () => {
      const newPrices = new Map<string, number>();
      
      // Buscar último preço de cada símbolo (apenas 1 candle)
      for (const s of symbols.slice(0, 20)) { // Limitar a 20 para performance
        try {
          const market = s.symbol.endsWith('.US') ? 'usa' : 'brazil';
          const broker = market === 'usa' ? 'pepperstone' : 'mt5';
          const res = await fetch(pythonApiUrl('/ohlcv'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbol: s.symbol, timeframe: 'M5', count: 1, broker })
          });
          if (res.ok) {
            const data = await res.json();
            if (data?.data?.[0]?.close) {
              newPrices.set(s.symbol, data.data[0].close);
            }
          }
        } catch (e) {
          // Ignorar erros individuais
        }
      }
      
      if (newPrices.size > 0) {
        setLastCandlePrices(newPrices);
      }
    };
    
    // Buscar imediatamente e depois a cada 30 segundos
    void fetchLastCandlePrices();
    const interval = setInterval(fetchLastCandlePrices, 30000);
    return () => clearInterval(interval);
  }, [symbols, wsConnected]);
  
  // Monitorar feed stale
  useEffect(() => {
    const staleTimer = setInterval(() => {
      if (lastTickTimeRef.current && Date.now() - lastTickTimeRef.current > 15000) {
        setFeedStale(true);
      }
    }, 5000);
    return () => clearInterval(staleTimer);
  }, []);
  
  // Polling HTTP da API Node como fallback e para garantir tempo real em todos os ativos
  useEffect(() => {
    if (symbols.length === 0 || !sectorId) return;
    
    const pollNodeQuotes = async () => {
      try {
        const data = await apiGet<{ sectorId: string; total: number; items: any[] }>(`/api/v1/market/sectors/${sectorId}/quotes`);
        
        if (data && Array.isArray(data.items)) {
          setQuotes(prev => {
            const newMap = new Map(prev);
            data.items.forEach(item => {
              if (item.status === 'ok') {
                newMap.set(item.symbol, {
                  symbol: item.symbol,
                  exchange: item.exchange,
                  priceBRL: item.priceBRL,
                  updatedAt: item.updatedAt || Date.now(),
                  source: item.source || 'node-api',
                  status: 'ok',
                });
              }
            });
            return newMap;
          });
          lastTickTimeRef.current = Date.now();
          setFeedStale(false);
        }
      } catch (err) {
        console.warn('Node API poll error:', err);
      }
    };
    
    // Poll imediatamente e depois a cada 2 segundos
    void pollNodeQuotes();
    const interval = setInterval(pollNodeQuotes, 2000);
    return () => clearInterval(interval);
  }, [symbols, sectorId]);
  
  // Carregar trades e posições do localStorage
  useEffect(() => {
    const savedTrades = localStorage.getItem(`trades_${sectorId}`);
    if (savedTrades) {
      setTrades(JSON.parse(savedTrades));
    }
    
    const savedPositions = localStorage.getItem(`positions_${sectorId}`);
    if (savedPositions) {
      setPositions(new Map(JSON.parse(savedPositions)));
    }
  }, [sectorId]);
  
  // Salvar trades no localStorage
  const saveTrade = (trade: Trade) => {
    const newTrades = [trade, ...trades];
    setTrades(newTrades);
    localStorage.setItem(`trades_${sectorId}`, JSON.stringify(newTrades));
    
    // Atualizar posição
    const currentPos = positions.get(trade.symbol) || { symbol: trade.symbol, quantity: 0, avgPrice: 0 };
    const newPositions = new Map(positions);
    
    if (trade.type === 'BUY') {
      const newQty = currentPos.quantity + trade.quantity;
      const newAvg = ((currentPos.avgPrice * currentPos.quantity) + (trade.price * trade.quantity)) / newQty;
      newPositions.set(trade.symbol, { ...currentPos, quantity: newQty, avgPrice: newAvg });
    } else {
      const newQty = currentPos.quantity - trade.quantity;
      if (newQty <= 0) {
        newPositions.delete(trade.symbol);
      } else {
        newPositions.set(trade.symbol, { ...currentPos, quantity: newQty });
      }
    }
    
    setPositions(newPositions);
    localStorage.setItem(`positions_${sectorId}`, JSON.stringify(Array.from(newPositions.entries())));
  };
  
  const currentQuote = selectedSymbol ? quotes.get(selectedSymbol) : null;
  const currentPrice = currentQuote?.priceBRL;
  const candlePrice = selectedSymbol ? lastCandlePrices.get(selectedSymbol) : null;
  const hasRealPrice = currentPrice != null && Number.isFinite(currentPrice) && currentPrice > 0;
  const displayPrice: number | null = hasRealPrice ? currentPrice! : (candlePrice ?? null);
  const candles = useMemo(() => displayPrice ? generateCandles(displayPrice) : [], [displayPrice, selectedSymbol]);
  
  const currentPosition = selectedSymbol ? positions.get(selectedSymbol) : null;
  
  const executeTrade = () => {
    if (!selectedSymbol || !tradeModal) return;
    if (currentPrice == null || !Number.isFinite(currentPrice) || currentPrice <= 0) return;
    
    const trade: Trade = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      symbol: selectedSymbol,
      type: tradeModal,
      quantity: tradeQuantity,
      price: currentPrice,
      total: tradeQuantity * currentPrice,
      timestamp: Date.now(),
      sectorId: sectorId || '',
    };
    
    saveTrade(trade);
    setTradeModal(null);
    setTradeQuantity(1);
  };
  
  const sectorImage = sectorId ? SECTOR_IMAGES[sectorId] : null;
  
  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#000',
      color: '#fff',
      position: 'relative',
    }}>
      {/* Background Image */}
      {sectorImage && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 0,
          opacity: 0.1,
          backgroundImage: `url(${sectorImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }} />
      )}
      
      {/* Content */}
      <div style={{ position: 'relative', zIndex: 1, padding: '16px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
          <button
            onClick={() => navigate('/app')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 16px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 4,
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            <ChevronLeft size={16} />
            Voltar
          </button>
          
          <div style={{ flex: 1 }}>
            <h1 className="font-bold" style={{ fontSize: '24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              {symbols[0]?.sectorName || `SETOR ${sectorId}`}
              <span className="mono text-cyan" style={{ fontSize: '14px', color: '#00ffc8' }}>
                {symbols.length} ativos
              </span>
            </h1>
          </div>
          
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '4px 16px',
            background: !wsConnected ? 'rgba(239, 68, 68, 0.1)' : feedStale ? 'rgba(251, 191, 36, 0.1)' : 'rgba(0, 255, 200, 0.1)',
            borderRadius: '999px',
            border: `1px solid ${!wsConnected ? 'rgba(239, 68, 68, 0.3)' : feedStale ? 'rgba(251, 191, 36, 0.3)' : 'rgba(0, 255, 200, 0.3)'}`,
          }}>
            <Activity size={14} style={{ color: !wsConnected ? '#ef4444' : feedStale ? '#fbbf24' : '#00ffc8' }} />
            <span className="mono" style={{ fontSize: '10px', color: !wsConnected ? '#ef4444' : feedStale ? '#fbbf24' : '#00ffc8' }}>
              {!wsConnected ? 'DESCONECTADO' : feedStale ? 'STALE' : 'LIVE'}
            </span>
          </div>
        </div>
        
        {error && (
          <div style={{ padding: '12px', background: 'rgba(248, 113, 113, 0.1)', border: '1px solid rgba(248, 113, 113, 0.3)', borderRadius: 4, marginBottom: '16px', color: '#f87171' }}>
            {error}
          </div>
        )}
        
        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr 300px', gap: '16px', minHeight: 'calc(100vh - 120px)' }}>
          {/* Left: Symbol List */}
          <div style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 8,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}>
            <div style={{
              padding: '12px 16px',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              background: 'rgba(0,0,0,0.3)',
            }}>
              <span className="mono font-bold" style={{ fontSize: '12px', letterSpacing: '0.1em' }}>ATIVOS</span>
            </div>
            
            <div style={{ flex: 1, overflow: 'auto', maxHeight: '70vh' }}>
              {loading ? (
                <div style={{ padding: '16px', textAlign: 'center', color: '#64748b' }}>Carregando...</div>
              ) : (
                symbols.map((s) => {
                  const quote = quotes.get(s.symbol);
                  const pos = positions.get(s.symbol);
                  const isSelected = selectedSymbol === s.symbol;
                  const candlePrice = lastCandlePrices.get(s.symbol);
                  const displayPrice = quote?.priceBRL || candlePrice;
                  
                  return (
                    <div
                      key={s.symbol}
                      onClick={() => setSelectedSymbol(s.symbol)}
                      style={{
                        padding: '12px 16px',
                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                        cursor: 'pointer',
                        background: isSelected ? 'rgba(0, 255, 200, 0.08)' : 'transparent',
                        borderLeft: `3px solid ${isSelected ? '#00ffc8' : 'transparent'}`,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div className="font-bold" style={{ fontSize: '14px' }}>{s.symbol}</div>
                          <div style={{ fontSize: '11px', color: '#64748b' }}>{s.description}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '14px', fontWeight: 'bold', color: displayPrice ? '#fff' : '#64748b' }}>
                            {displayPrice ? `$ ${displayPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                          </div>
                          {pos && (
                            <div style={{ fontSize: '10px', color: '#00ffc8' }}>
                              {pos.quantity} un
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
          
          {/* Center: Chart & Trading */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Chart */}
            <div style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 8,
              padding: '16px',
              flex: 1,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div>
                  <div className="font-bold" style={{ fontSize: '20px' }}>{selectedSymbol}</div>
                  <div style={{ fontSize: '12px', color: '#64748b' }}>
                    {symbols.find(s => s.symbol === selectedSymbol)?.description}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="font-bold" style={{ fontSize: '24px', color: displayPrice ? '#00ffc8' : '#64748b' }}>
                    {displayPrice 
                      ? (selectedSymbol?.endsWith('.US') 
                        ? `$ ${displayPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : `R$ ${displayPrice.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
                      : 'AGUARDANDO...'}
                  </div>
                  {/* Exibir bid/ask/spread */}
                  {currentQuote?.bid && currentQuote?.ask && (
                    <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                      <span style={{ color: '#f87171' }}>Bid: R$ {currentQuote.bid.toFixed(2)}</span>
                      {' | '}
                      <span style={{ color: '#4ade80' }}>Ask: R$ {currentQuote.ask.toFixed(2)}</span>
                      {currentQuote.spreadPct && (
                        <span style={{ color: '#64748b', marginLeft: '4px' }}>
                          (Spread: {currentQuote.spreadPct.toFixed(2)}%)
                        </span>
                      )}
                    </div>
                  )}
                  {currentQuote?.source && (
                    <div style={{ fontSize: '10px', color: '#64748b' }}>
                      Fonte: {currentQuote.source}
                    </div>
                  )}
                </div>
              </div>
              
              {/* Realtime Chart com lightweight-charts */}
              <div style={{ position: 'relative', background: 'rgba(0,0,0,0.3)', borderRadius: 4 }}>
                {selectedSymbol && (
                  <RealtimeChart 
                    symbol={selectedSymbol} 
                    currentPrice={displayPrice}
                    externalTick={currentTick}
                    onCrosshairMove={(data) => {
                      // Callback para atualizar preço/hora no parent
                    }}
                  />
                )}
                {!selectedSymbol && (
                  <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
                    <div style={{ textAlign: 'center' }}>
                      <Activity size={32} style={{ marginBottom: 8, opacity: 0.5 }} />
                      <div>Selecione um ativo para ver o gráfico</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            {/* Trading Panel */}
            <div style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 8,
              padding: '16px',
            }}>
              <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
                <button
                  onClick={() => setTradeModal('BUY')}
                  style={{
                    flex: 1,
                    padding: '16px',
                    background: 'rgba(74, 222, 128, 0.1)',
                    border: '1px solid rgba(74, 222, 128, 0.3)',
                    borderRadius: 8,
                    color: '#4ade80',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    fontSize: '16px',
                    fontWeight: 'bold',
                  }}
                >
                  <ArrowUpCircle size={20} />
                  COMPRAR
                </button>
                <button
                  onClick={() => setTradeModal('SELL')}
                  disabled={!currentPosition || currentPosition.quantity <= 0}
                  style={{
                    flex: 1,
                    padding: '16px',
                    background: 'rgba(248, 113, 113, 0.1)',
                    border: '1px solid rgba(248, 113, 113, 0.3)',
                    borderRadius: 8,
                    color: '#f87171',
                    cursor: currentPosition && currentPosition.quantity > 0 ? 'pointer' : 'not-allowed',
                    opacity: currentPosition && currentPosition.quantity > 0 ? 1 : 0.5,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    fontSize: '16px',
                    fontWeight: 'bold',
                  }}
                >
                  <ArrowDownCircle size={20} />
                  VENDER
                </button>
              </div>
              
              {/* Current Position */}
              {currentPosition && (
                <div style={{
                  padding: '12px',
                  background: 'rgba(0, 255, 200, 0.05)',
                  border: '1px solid rgba(0, 255, 200, 0.2)',
                  borderRadius: 4,
                }}>
                  <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>SUA POSIÇÃO</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="font-bold">{currentPosition.quantity} ações</span>
                    <span style={{ color: '#00ffc8' }}>PM: R$ {currentPosition.avgPrice.toFixed(2)}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
          
          {/* Right: Trade History */}
          <div style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 8,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}>
            <div style={{
              padding: '12px 16px',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              background: 'rgba(0,0,0,0.3)',
            }}>
              <span className="mono font-bold" style={{ fontSize: '12px', letterSpacing: '0.1em' }}>HISTÓRICO</span>
            </div>
            
            <div style={{ flex: 1, overflow: 'auto', maxHeight: '70vh' }}>
              {trades.length === 0 ? (
                <div style={{ padding: '16px', textAlign: 'center', color: '#64748b' }}>
                  Nenhuma operação realizada
                </div>
              ) : (
                trades.map((trade) => (
                  <div
                    key={trade.id}
                    style={{
                      padding: '12px 16px',
                      borderBottom: '1px solid rgba(255,255,255,0.05)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: 2,
                        fontSize: '10px',
                        fontWeight: 'bold',
                        background: trade.type === 'BUY' ? 'rgba(74, 222, 128, 0.2)' : 'rgba(248, 113, 113, 0.2)',
                        color: trade.type === 'BUY' ? '#4ade80' : '#f87171',
                      }}>
                        {trade.type === 'BUY' ? 'COMPRA' : 'VENDA'}
                      </span>
                      <span style={{ fontSize: '10px', color: '#64748b' }}>
                        {new Date(trade.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="font-bold">{trade.symbol}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#9ca3af' }}>
                      <span>{trade.quantity}x R$ {trade.price.toFixed(2)}</span>
                      <span className="font-bold" style={{ color: '#fff' }}>R$ {trade.total.toFixed(2)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
      
      {/* Trade Modal */}
      <AnimatePresence>
        {tradeModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.8)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 100,
            }}
            onClick={() => setTradeModal(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              style={{
                background: 'rgba(20, 20, 20, 0.95)',
                border: `1px solid ${tradeModal === 'BUY' ? 'rgba(74, 222, 128, 0.3)' : 'rgba(248, 113, 113, 0.3)'}`,
                borderRadius: 12,
                padding: '24px',
                width: 400,
                maxWidth: '90vw',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <h2 className="font-bold" style={{ fontSize: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {tradeModal === 'BUY' ? <ArrowUpCircle size={24} style={{ color: '#4ade80' }} /> : <ArrowDownCircle size={24} style={{ color: '#f87171' }} />}
                  {tradeModal === 'BUY' ? 'COMPRAR' : 'VENDER'} {selectedSymbol}
                </h2>
                <button onClick={() => setTradeModal(null)} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}>
                  <X size={20} />
                </button>
              </div>
              
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px' }}>PREÇO ATUAL</div>
                <div className="font-bold" style={{ fontSize: '28px', color: '#00ffc8' }}>
                  R$ {(displayPrice ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </div>
              </div>
              
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px' }}>QUANTIDADE</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <button
                    onClick={() => setTradeQuantity(Math.max(1, tradeQuantity - 1))}
                    style={{
                      width: 40,
                      height: 40,
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 4,
                      color: '#fff',
                      cursor: 'pointer',
                      fontSize: '20px',
                    }}
                  >-</button>
                  <input
                    type="number"
                    value={tradeQuantity}
                    onChange={(e) => setTradeQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                    style={{
                      flex: 1,
                      textAlign: 'center',
                      padding: '12px',
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 4,
                      color: '#fff',
                      fontSize: '18px',
                      fontWeight: 'bold',
                    }}
                  />
                  <button
                    onClick={() => setTradeQuantity(tradeQuantity + 1)}
                    style={{
                      width: 40,
                      height: 40,
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 4,
                      color: '#fff',
                      cursor: 'pointer',
                      fontSize: '20px',
                    }}
                  >+</button>
                </div>
              </div>
              
              <div style={{ marginBottom: '24px' }}>
                <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px' }}>TOTAL</div>
                <div className="font-bold" style={{ fontSize: '24px' }}>
                  {displayPrice ? `R$ ${(tradeQuantity * displayPrice).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—'}
                </div>
              </div>
              
              <button
                onClick={executeTrade}
                disabled={!displayPrice}
                style={{
                  width: '100%',
                  padding: '16px',
                  background: !displayPrice ? '#374151' : tradeModal === 'BUY' ? '#4ade80' : '#f87171',
                  border: 'none',
                  borderRadius: 8,
                  color: !displayPrice ? '#6b7280' : '#000',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  cursor: !displayPrice ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                }}
              >
                <Check size={20} />
                {!displayPrice ? 'AGUARDANDO PREÇO...' : `CONFIRMAR ${tradeModal === 'BUY' ? 'COMPRA' : 'VENDA'}`}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
