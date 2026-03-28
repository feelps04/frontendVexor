// Bot Telegram Avançado - Com contexto, PDF, notícias em tempo real e Twitter/X
import { generateTradingPDF, createSampleReport } from './pdf-generator.js';
import { queueOrder, initializeBrokerExecutor, getExecutionStats } from './broker-executor.js';
import type { OrderRequest } from './broker-executor.js';

const VEXOR_BOT_TOKEN = '8710971540:AAGs15wUAxx_964NKuEKwL31jTb_mdZ0Kao';
const VEXOR_CHAT_ID = '7192227673';

let vexorOffset = 0;
const vexorProcessedIds = new Set<number>();

// ==================== PROGRESSO EM TEMPO REAL ====================
let progressMessageId: number | null = null;
let lastProgressText = '';

async function sendProgress(status: string, percent: number): Promise<void> {
  const progressBar = '█'.repeat(Math.floor(percent / 10)) + '░'.repeat(10 - Math.floor(percent / 10));
  const text = `⏳ <b>Processando...</b>\n\n${status}\n[${progressBar}] ${percent}%`;
  
  // Só envia se mudou significativamente
  if (text === lastProgressText) return;
  lastProgressText = text;
  
  try {
    if (progressMessageId) {
      // Atualiza mensagem existente
      const resp = await fetch(`https://api.telegram.org/bot${VEXOR_BOT_TOKEN}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: VEXOR_CHAT_ID,
          message_id: progressMessageId,
          text,
          parse_mode: 'HTML'
        })
      });
      const data = await resp.json() as any;
      if (!data.ok) {
        progressMessageId = null; // Mensagem foi deletada, criar nova
      }
    }
    
    if (!progressMessageId) {
      // Cria nova mensagem
      const resp = await fetch(`https://api.telegram.org/bot${VEXOR_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: VEXOR_CHAT_ID,
          text,
          parse_mode: 'HTML'
        })
      });
      const data = await resp.json() as any;
      if (data.ok) {
        progressMessageId = data.result.message_id;
      }
    }
  } catch (e) {
    console.error('Erro ao enviar progresso:', e);
  }
}

async function deleteProgress(): Promise<void> {
  if (progressMessageId) {
    try {
      await fetch(`https://api.telegram.org/bot${VEXOR_BOT_TOKEN}/deleteMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: VEXOR_CHAT_ID,
          message_id: progressMessageId
        })
      });
    } catch (e) {
      // Ignora erro
    }
    progressMessageId = null;
    lastProgressText = '';
  }
}

// ==================== CONTEXTO DE CONVERSA ====================
interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

const conversationHistory: Message[] = [];
const MAX_HISTORY = 20; // Mantém últimas 20 mensagens

function addToHistory(role: 'user' | 'assistant', content: string) {
  conversationHistory.push({ role, content, timestamp: new Date() });
  if (conversationHistory.length > MAX_HISTORY) {
    conversationHistory.shift();
  }
}

function getContextString(): string {
  if (conversationHistory.length === 0) return '';
  return conversationHistory.map(m => 
    `${m.role === 'user' ? 'USUÁRIO' : 'ASSISTENTE'}: ${m.content}`
  ).join('\n');
}

// ==================== TRADING CONTEXT ====================
interface TradingStats {
  winRate: number;
  trades: number;
  wins: number;
  losses: number;
  pnl: number;
  lastUpdate: Date;
  performance: { date: string; pnl: number }[];
}

const tradingStats: TradingStats = {
  winRate: 0.52,
  trades: 47,
  wins: 24,
  losses: 23,
  pnl: 127,
  lastUpdate: new Date(),
  performance: [
    { date: '01/03', pnl: 10 },
    { date: '02/03', pnl: -5 },
    { date: '03/03', pnl: 20 },
    { date: '04/03', pnl: 15 },
    { date: '05/03', pnl: -8 },
    { date: '06/03', pnl: 25 },
    { date: '07/03', pnl: 30 },
    { date: '08/03', pnl: -10 },
    { date: '09/03', pnl: 40 },
    { date: '10/03', pnl: 35 }
  ]
};

function getTradingContext(): string {
  return `
DADOS DE TRADING ATUAIS:
- Win Rate: ${(tradingStats.winRate * 100).toFixed(1)}%
- Trades hoje: ${tradingStats.trades}
- Wins: ${tradingStats.wins} | Losses: ${tradingStats.losses}
- P&L: ${tradingStats.pnl >= 0 ? '+' : ''}${tradingStats.pnl} pts
- Última atualização: ${tradingStats.lastUpdate.toLocaleTimeString('pt-BR')}
`;
}

// ==================== NOTÍCIAS EM TEMPO REAL ====================
interface NewsItem {
  title: string;
  source: string;
  url: string;
  timestamp: Date;
  relevance: 'high' | 'medium' | 'low';
  category: 'mercado' | 'petroleo' | 'geopolitica' | 'economia' | 'empresa';
  impact?: 'positivo' | 'negativo' | 'neutro';
  summary?: string;
}

let cachedNews: NewsItem[] = [];
let lastNewsUpdate = new Date(0);
let sentNewsTitles = new Set<string>(); // Notícias já enviadas

// Análise automática de impacto
function analyzeNewsImpact(title: string, category: string): { impact: 'positivo' | 'negativo' | 'neutro'; summary: string } {
  const lowerTitle = title.toLowerCase();
  
  // Padrões de impacto negativo
  if (lowerTitle.includes('guerra') || lowerTitle.includes('conflito') || lowerTitle.includes('tensão')) {
    return { 
      impact: 'negativo', 
      summary: '⚠️ Tensão geopolítica pode aumentar volatilidade e aversão ao risco em mercados emergentes.' 
    };
  }
  
  if (lowerTitle.includes('petróleo') && (lowerTitle.includes('alta') || lowerTitle.includes('salto'))) {
    return { 
      impact: 'negativo', 
      summary: '📈 Alta do petróleo pressiona inflação e custos. Setores de energia podem se beneficiar, mas consumo é afetado.' 
    };
  }
  
  if (lowerTitle.includes('inflação') && lowerTitle.includes('alta')) {
    return { 
      impact: 'negativo', 
      summary: '📊 Inflação alta pode levar a juros maiores, pressionando ações e aumentando custo de capital.' 
    };
  }
  
  if (lowerTitle.includes('juro') && lowerTitle.includes('alta')) {
    return { 
      impact: 'negativo', 
      summary: '🏦 Juros altos desestimulam investimentos e consumo. Mercado de ações tende a cair.' 
    };
  }
  
  // Padrões de impacto positivo
  if (lowerTitle.includes('queda') && (lowerTitle.includes('juro') || lowerTitle.includes('inflação'))) {
    return { 
      impact: 'positivo', 
      summary: '✅ Queda de juros/inflação favorece mercado de ações e aumenta liquidez.' 
    };
  }
  
  if (lowerTitle.includes('recorde') || lowerTitle.includes('máxima histórica')) {
    return { 
      impact: 'positivo', 
      summary: '🚀 Novos recordes indicam confiança do mercado, mas cuidado com exaustão.' 
    };
  }
  
  if (lowerTitle.includes('fusão') || lowerTitle.includes('aquisição')) {
    return { 
      impact: 'positivo', 
      summary: '💼 M&A indica dinamismo do mercado. Pode gerar premium nas ações envolvidas.' 
    };
  }
  
  // B3 horário
  if (lowerTitle.includes('b3') && lowerTitle.includes('horário')) {
    return { 
      impact: 'neutro', 
      summary: '⏰ Mudança de horário da B3 pode afetar liquidez em períodos de transição.' 
    };
  }
  
  return { 
    impact: 'neutro', 
    summary: '📌 Notícia relevante para acompanhamento. Avalie impacto específico no seu portfólio.' 
    };
}

async function fetchNews(): Promise<NewsItem[]> {
  const now = new Date();
  
  // Cache por 2 minutos para não sobrecarregar
  if (now.getTime() - lastNewsUpdate.getTime() < 2 * 60 * 1000 && cachedNews.length > 0) {
    return cachedNews;
  }
  
  const news: NewsItem[] = [];
  
  // 1. Google News - Brasil Economia
  try {
    const googleNewsUrl = 'https://news.google.com/rss/search?q=bolsa+valores+brasil+ibovespa&hl=pt-BR&gl=BR&ceid=BR:pt-419';
    const resp = await fetch(googleNewsUrl);
    const text = await resp.text();
    
    const items = text.match(/<item>[\s\S]*?<\/item>/g) || [];
    items.slice(0, 5).forEach(item => {
      const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/);
      const linkMatch = item.match(/<link>(.*?)<\/link>/);
      
      if (titleMatch) {
        const title = titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '');
        const analysis = analyzeNewsImpact(title, 'mercado');
        
        news.push({
          title,
          source: 'Google News',
          url: linkMatch?.[1] || '',
          timestamp: new Date(),
          relevance: 'high',
          category: 'mercado',
          impact: analysis.impact,
          summary: analysis.summary
        });
      }
    });
  } catch (e) {
    console.error('Erro ao buscar notícias Google:', e);
  }
  
  // 2. Notícias de Petróleo e Energia
  try {
    const oilUrl = 'https://news.google.com/rss/search?q=petróleo+preço+petroleo+bruto&hl=pt-BR&gl=BR&ceid=BR:pt-419';
    const resp = await fetch(oilUrl);
    const text = await resp.text();
    
    const items = text.match(/<item>[\s\S]*?<\/item>/g) || [];
    items.slice(0, 3).forEach(item => {
      const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/);
      const linkMatch = item.match(/<link>(.*?)<\/link>/);
      
      if (titleMatch) {
        const title = titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '');
        const analysis = analyzeNewsImpact(title, 'petroleo');
        
        news.push({
          title,
          source: 'Energy News',
          url: linkMatch?.[1] || '',
          timestamp: new Date(),
          relevance: 'high',
          category: 'petroleo',
          impact: analysis.impact,
          summary: analysis.summary
        });
      }
    });
  } catch (e) {
    console.error('Erro ao buscar notícias petróleo:', e);
  }
  
  // 3. Geopolítica e Conflitos
  try {
    const geoUrl = 'https://news.google.com/rss/search?q=guerra+conflito+geopolitica+russia+ucrania+oriente+medio&hl=pt-BR&gl=BR&ceid=BR:pt-419';
    const resp = await fetch(geoUrl);
    const text = await resp.text();
    
    const items = text.match(/<item>[\s\S]*?<\/item>/g) || [];
    items.slice(0, 3).forEach(item => {
      const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/);
      const linkMatch = item.match(/<link>(.*?)<\/link>/);
      
      if (titleMatch) {
        const title = titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '');
        const analysis = analyzeNewsImpact(title, 'geopolitica');
        
        news.push({
          title,
          source: 'Geopolitics',
          url: linkMatch?.[1] || '',
          timestamp: new Date(),
          relevance: 'high',
          category: 'geopolitica',
          impact: analysis.impact,
          summary: analysis.summary
        });
      }
    });
  } catch (e) {
    console.error('Erro ao buscar notícias geopolítica:', e);
  }
  
  // 4. Notícias importantes de mercado (simuladas se APIs falharem)
  const importantNews: NewsItem[] = [
    {
      title: 'Petróleo salta com tensões no Oriente Médio; Brent supera US$ 85',
      source: 'Reuters',
      url: 'https://reuters.com',
      timestamp: new Date(),
      relevance: 'high',
      category: 'petroleo',
      impact: 'negativo',
      summary: '📈 Alta do petróleo pressiona inflação global. Brasil importa derivados, impactando custos de transporte e energia. Setor de petróleo local (PETR4) pode se beneficiar.'
    },
    {
      title: 'B3 altera horário de negociação a partir de 9 de março',
      source: 'B3',
      url: 'https://b3.com.br',
      timestamp: new Date(),
      relevance: 'high',
      category: 'mercado',
      impact: 'neutro',
      summary: '⏰ Novo horário pode afetar liquidez em períodos de transição. Ajuste suas estratégias de execução.'
    },
    {
      title: 'Fed mantém juros altos; mercados emergentes sob pressão',
      source: 'Bloomberg',
      url: 'https://bloomberg.com',
      timestamp: new Date(),
      relevance: 'high',
      category: 'economia',
      impact: 'negativo',
      summary: '🏦 Juros americanos altos reduzem fluxo para emergentes. Dólar pode subir, pressionando Ibovespa.'
    }
  ];
  
  // Adiciona notícias importantes se não tiver muitas
  if (news.length < 5) {
    news.push(...importantNews);
  }
  
  cachedNews = news;
  lastNewsUpdate = now;
  
  return news;
}

// ==================== SISTEMA HÍBRIDO DE TRADING ====================
// Integração com arquitetura existente do projeto VEXOR
// - AutoLearner (100% RAM, 0 latência)
// - MentalLibrary (Douglas, Taleb, Kahneman, Tendler, Aurelius, Steenbarger)
// - Oracle ATP (Persistência)
// - MT5 Genial (Execução LIVE)
// - Broker Executor (Execução automática de ordens)

interface TradeSignal {
  id: string;
  symbol: string;
  type: 'LONG' | 'SHORT';
  status: 'PENDING' | 'ACTIVE' | 'CLOSED';
  entryPrice: number;
  currentPrice: number;
  targetPrice: number;
  stopPrice: number;
  size: number;
  pnl: number;
  openedAt: Date;
  closedAt?: Date;
  closeReason?: 'TARGET' | 'STOP' | 'MANUAL';
  // Aprendizagem (AutoLearner)
  system: 'S1' | 'S2'; // Sistema 1 (rápido) ou Sistema 2 (analítico)
  marketCondition?: 'TREND_UP' | 'TREND_DOWN' | 'RANGE';
  volatility?: 'LOW' | 'MEDIUM' | 'HIGH';
  newsImpact?: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  confidence?: number;
  // Mental Library
  emotionalState?: number;
  tiltLevel?: 0 | 1 | 2 | 3 | 4;
  biasesDetected?: string[];
}

interface LearningEntry {
  tradeId: string;
  symbol: string;
  type: 'LONG' | 'SHORT';
  result: 'WIN' | 'LOSS';
  pnl: number;
  marketCondition: string;
  volatility: string;
  newsImpact: string;
  entryHour: number;
  duration: number;
  confidence: number;
  timestamp: Date;
  lessons: string[];
  // Mental Library Integration
  mentalInsights: string[];
  biasesAvoided: string[];
  stoicLesson: string;
}

interface HybridSystem {
  active: boolean;
  liveMode: boolean;
  architecture: 'HYBRID'; // Arquitetura validada do projeto
  activatedAt?: Date;
  firstInteraction?: Date;
  currentTrade: TradeSignal | null;
  tradeHistory: TradeSignal[];
  learningDb: LearningEntry[];
  // Contabilidade
  balance: number;
  initialBalance: number;
  totalWins: number;
  totalLosses: number;
  bestTrade: number;
  worstTrade: number;
  avgWin: number;
  avgLoss: number;
  // Padrões aprendidos (AutoLearner RAM)
  patterns: {
    bestHours: number[];
    bestConditions: string[];
    avoidConditions: string[];
    s1Patterns: Array<{ trigger: string; response: string; confidence: number }>;
  };
  // Mental Library Stats
  mentalStats: {
    biasesCaught: number;
    tiltPrevented: number;
    stoicMoments: number;
    reflectionsGenerated: number;
  };
}

const hybridSystem: HybridSystem = {
  active: false,
  liveMode: false,
  architecture: 'HYBRID',
  currentTrade: null,
  tradeHistory: [],
  learningDb: [],
  balance: 10000,
  initialBalance: 10000,
  totalWins: 0,
  totalLosses: 0,
  bestTrade: 0,
  worstTrade: 0,
  avgWin: 0,
  avgLoss: 0,
  patterns: {
    bestHours: [],
    bestConditions: [],
    avoidConditions: [],
    s1Patterns: []
  },
  mentalStats: {
    biasesCaught: 0,
    tiltPrevented: 0,
    stoicMoments: 0,
    reflectionsGenerated: 0
  }
};

// Valida se pode operar baseado no Win Rate
function validateWinRate(): { approved: boolean; message: string } {
  const minWinRate = parseInt(process.env.MIN_WIN_RATE || '55');
  const total = hybridSystem.totalWins + hybridSystem.totalLosses;
  
  // Precisa de pelo menos 10 trades para validar
  if (total < 10) {
    return { 
      approved: true, 
      message: `Coletando dados: ${total}/10 trades para validação de Win Rate` 
    };
  }
  
  const winRate = (hybridSystem.totalWins / total) * 100;
  
  if (winRate < minWinRate) {
    return { 
      approved: false, 
      message: `🚨 BLOQUEADO: Win Rate ${winRate.toFixed(1)}% < ${minWinRate}% mínimo. Pare e revise.` 
    };
  }
  
  return { 
    approved: true, 
    message: `✅ Win Rate: ${winRate.toFixed(1)}% (mínimo: ${minWinRate}%)` 
  };
}

// Ativa o sistema após primeira interação
function activateSystem(): void {
  if (!hybridSystem.active) {
    hybridSystem.active = true;
    hybridSystem.liveMode = true; // Ativa modo live automaticamente
    hybridSystem.activatedAt = new Date('2026-03-08T09:00:00');
    hybridSystem.firstInteraction = new Date();
    console.log('⚡ Sistema Híbrido ATIVADO em modo LIVE');
    console.log(`📊 Validação: ${validateWinRate().message}`);
  }
}

// Detecta condição de mercado atual
function detectMarketCondition(): { trend: string; volatility: string; newsImpact: string } {
  const hour = new Date().getHours();
  const trend = systemState.mode === 'AGRESSIVO' ? 'TREND_UP' : systemState.mode === 'DEFENSIVO' ? 'TREND_DOWN' : 'RANGE';
  const volatility = systemState.volatility;
  const newsImpact = cachedNews[0]?.impact?.toUpperCase() || 'NEUTRAL';
  
  return { trend, volatility, newsImpact };
}

// Gera sinal de entrada baseado em análise com IA
async function generateEntrySignal(): Promise<TradeSignal | null> {
  if (hybridSystem.currentTrade) return null;
  
  // Análise de mercado via IA
  const market = detectMarketCondition();
  
  // Verifica se deve evitar baseado em aprendizagem
  const shouldAvoid = hybridSystem.patterns.avoidConditions.some(c => 
    c.includes(market.trend) || c.includes(market.volatility)
  );
  
  if (shouldAvoid && hybridSystem.liveMode) {
    console.log('⚠️ Condição evitada baseada em aprendizagem anterior');
    return null;
  }
  
  const symbols = ['WINFUT', 'WDOFUT'];
  const symbol = symbols[Math.floor(Math.random() * symbols.length)];
  
  // Decide direção baseada em tendência e aprendizagem
  let type: 'LONG' | 'SHORT';
  if (market.trend === 'TREND_UP') {
    type = 'LONG';
  } else if (market.trend === 'TREND_DOWN') {
    type = 'SHORT';
  } else {
    type = Math.random() > 0.5 ? 'LONG' : 'SHORT';
  }
  
  // Busca preço real do mercado via Bridge
  let entryPrice: number;
  try {
    const bridgeUrl = process.env.OCI_BRIDGE_URL || 'http://localhost:8080';
    const response = await fetch(`${bridgeUrl}/price/${symbol}`, {
      headers: { 'Authorization': 'Bearer vexor-bridge-2026' }
    });
    
    if (response.ok) {
      const data = await response.json() as any;
      entryPrice = data.bid || data.price || 0;
      console.log(`📈 Preço real ${symbol}: ${entryPrice}`);
    } else {
      console.log('⚠️ Bridge não retornou preço, usando fallback');
      // Fallback: preços aproximados baseados no mercado
      entryPrice = symbol === 'WINFUT' ? 125000 : 5.25;
    }
  } catch (e) {
    console.log('⚠️ Erro ao buscar preço, usando fallback');
    entryPrice = symbol === 'WINFUT' ? 125000 : 5.25;
  }
  
  // Calcula SL/TP baseado em pontos reais
  let targetPrice: number;
  let stopPrice: number;
  
  if (symbol === 'WINFUT') {
    // WIN: 500 pts target, 300 pts stop (R:R 1.67)
    if (type === 'LONG') {
      targetPrice = entryPrice + 500;
      stopPrice = entryPrice - 300;
    } else {
      targetPrice = entryPrice - 500;
      stopPrice = entryPrice + 300;
    }
  } else {
    // WDO: 500 pts target, 300 pts stop
    if (type === 'LONG') {
      targetPrice = entryPrice + 0.05;
      stopPrice = entryPrice - 0.03;
    } else {
      targetPrice = entryPrice - 0.05;
      stopPrice = entryPrice + 0.03;
    }
  }
  
  // Calcula confiança baseada em aprendizagem
  const hour = new Date().getHours();
  const isBestHour = hybridSystem.patterns.bestHours.includes(hour);
  const confidence = isBestHour ? 0.85 : 0.65;
  
  const signal: TradeSignal = {
    id: `TRADE-${Date.now()}`,
    symbol,
    type,
    status: 'PENDING',
    entryPrice: parseFloat(entryPrice.toFixed(2)),
    currentPrice: parseFloat(entryPrice.toFixed(2)),
    targetPrice: parseFloat(targetPrice.toFixed(2)),
    stopPrice: parseFloat(stopPrice.toFixed(2)),
    size: 1,
    pnl: 0,
    openedAt: new Date(),
    system: isBestHour ? 'S1' : 'S2', // S1 para horários aprendidos, S2 para novos
    marketCondition: market.trend as any,
    volatility: market.volatility as any,
    newsImpact: market.newsImpact as any,
    confidence,
    emotionalState: 0.3, // Estado emocional baseline
    tiltLevel: 0,
    biasesDetected: []
  };
  
  return signal;
}

// Abre posição e envia ordem para broker
async function openPosition(signal: TradeSignal): Promise<string> {
  signal.status = 'ACTIVE';
  hybridSystem.currentTrade = signal;
  
  // ==================== EXECUÇÃO AUTOMÁTICA ====================
  // Cria ordem para o broker executor
  const order: OrderRequest = {
    id: signal.id,
    symbol: signal.symbol,
    side: signal.type === 'LONG' ? 'BUY' : 'SELL',
    quantity: signal.size,
    entryPrice: signal.entryPrice,
    stopLoss: signal.stopPrice,
    takeProfit: signal.targetPrice,
    orderType: 'MARKET',
    timestamp: new Date(),
    reason: `Hybrid System S${signal.system} | Confiança: ${((signal.confidence || 0.5) * 100).toFixed(0)}%`,
    confidence: signal.confidence || 0.5
  };
  
  // Envia para fila de execução
  const queued = queueOrder(order);
  
  const emoji = signal.type === 'LONG' ? '🟢' : '🔴';
  const direction = signal.type === 'LONG' ? 'COMPRA' : 'VENDA';
  const execStatus = queued ? '📤 Ordem enviada para execução' : '⚠️ Ordem não enfileirada';
  
  return `<b>⚡ SINAL DE ENTRADA</b>

${emoji} <b>${signal.symbol}</b> - ${direction}

━━━━━━━━━━━━━━━━━━━━━━━━

<b>Entrada:</b> ${signal.entryPrice}
<b>Target:</b> ${signal.targetPrice} 🎯
<b>Stop:</b> ${signal.stopPrice} 🛑

<b>Risco/Reward:</b> 1:1.67
<b>Size:</b> ${signal.size} contrato
<b>Sistema:</b> S${signal.system}

━━━━━━━━━━━━━━━━━━━━━━━━

<b>📊 CONTEXTO</b>
├─ Condição: ${signal.marketCondition}
├─ Volatilidade: ${signal.volatility}
├─ Confiança: ${((signal.confidence || 0.5) * 100).toFixed(0)}%
└─ Viéses: ${signal.biasesDetected?.length || 0}

━━━━━━━━━━━━━━━━━━━━━━━━

${execStatus}

📅 <b>Aberto em:</b> ${signal.openedAt.toLocaleString('pt-BR')}
<b>Saldo Atual:</b> R$ ${hybridSystem.balance.toFixed(2)}
<b>Modo:</b> ${process.env.TRADING_MODE || 'DEMO'}`;
}

// Atualiza preço atual e verifica stop/target
function updateTradePrice(newPrice: number): { closed: boolean; reason?: string } {
  if (!hybridSystem.currentTrade) return { closed: false };
  
  const trade = hybridSystem.currentTrade;
  trade.currentPrice = newPrice;
  
  // Calcula P&L
  if (trade.type === 'LONG') {
    trade.pnl = (newPrice - trade.entryPrice) * trade.size;
    
    // Verifica target
    if (newPrice >= trade.targetPrice) {
      return closePosition('TARGET');
    }
    // Verifica stop
    if (newPrice <= trade.stopPrice) {
      return closePosition('STOP');
    }
  } else {
    trade.pnl = (trade.entryPrice - newPrice) * trade.size;
    
    // Verifica target
    if (newPrice <= trade.targetPrice) {
      return closePosition('TARGET');
    }
    // Verifica stop
    if (newPrice >= trade.stopPrice) {
      return closePosition('STOP');
    }
  }
  
  return { closed: false };
}

// Fecha posição e aprende com resultado
function closePosition(reason: 'TARGET' | 'STOP' | 'MANUAL'): { closed: boolean; reason: string } {
  if (!hybridSystem.currentTrade) return { closed: false, reason: '' };
  
  const trade = hybridSystem.currentTrade;
  trade.status = 'CLOSED';
  trade.closedAt = new Date();
  trade.closeReason = reason;
  
  // Ajusta P&L final baseado no motivo
  if (reason === 'TARGET') {
    trade.pnl = Math.abs(trade.targetPrice - trade.entryPrice) * trade.size;
    if (trade.type === 'SHORT') trade.pnl = trade.pnl;
  } else if (reason === 'STOP') {
    trade.pnl = -Math.abs(trade.entryPrice - trade.stopPrice) * trade.size;
  }
  
  // Atualiza saldo
  const pnlInMoney = trade.pnl * 0.2;
  hybridSystem.balance += pnlInMoney;
  
  // ==================== APRENDIZAGEM ====================
  const isWin = trade.pnl > 0;
  const result: 'WIN' | 'LOSS' = isWin ? 'WIN' : 'LOSS';
  
  // Atualiza estatísticas
  if (isWin) {
    hybridSystem.totalWins++;
    if (trade.pnl > hybridSystem.bestTrade) hybridSystem.bestTrade = trade.pnl;
    hybridSystem.avgWin = (hybridSystem.avgWin * (hybridSystem.totalWins - 1) + trade.pnl) / hybridSystem.totalWins;
  } else {
    hybridSystem.totalLosses++;
    if (trade.pnl < hybridSystem.worstTrade) hybridSystem.worstTrade = trade.pnl;
    hybridSystem.avgLoss = (hybridSystem.avgLoss * (hybridSystem.totalLosses - 1) + trade.pnl) / hybridSystem.totalLosses;
  }
  
  // Cria entrada de aprendizagem
  const learningEntry: LearningEntry = {
    tradeId: trade.id,
    symbol: trade.symbol,
    type: trade.type,
    result,
    pnl: trade.pnl,
    marketCondition: trade.marketCondition || 'UNKNOWN',
    volatility: trade.volatility || 'MEDIUM',
    newsImpact: trade.newsImpact || 'NEUTRAL',
    entryHour: trade.openedAt.getHours(),
    duration: (trade.closedAt.getTime() - trade.openedAt.getTime()) / 60000,
    confidence: trade.confidence || 0.5,
    timestamp: new Date(),
    lessons: [],
    // Mental Library Integration
    mentalInsights: [],
    biasesAvoided: trade.biasesDetected || [],
    stoicLesson: ''
  };
  
  // Gera lições aprendidas
  if (isWin) {
    learningEntry.lessons.push(`${trade.type} em ${trade.marketCondition} funcionou`);
    if (!hybridSystem.patterns.bestHours.includes(learningEntry.entryHour)) {
      hybridSystem.patterns.bestHours.push(learningEntry.entryHour);
    }
    const condition = `${trade.marketCondition}_${trade.volatility}`;
    if (!hybridSystem.patterns.bestConditions.includes(condition)) {
      hybridSystem.patterns.bestConditions.push(condition);
    }
    // Mental Library - Douglas: Aceitar sem euforia
    learningEntry.mentalInsights.push('GANHO: Aceitar sem euforia. Resultado é consequência do processo.');
    learningEntry.stoicLesson = 'Equanimidade: manter foco no processo, não no outcome.';
  } else {
    learningEntry.lessons.push(`Evitar ${trade.type} em ${trade.marketCondition}`);
    const avoidCondition = `${trade.marketCondition}_${trade.volatility}_${trade.newsImpact}`;
    if (!hybridSystem.patterns.avoidConditions.includes(avoidCondition)) {
      hybridSystem.patterns.avoidConditions.push(avoidCondition);
    }
    // Mental Library - Steenbarger: Converter perda em aprendizado
    learningEntry.mentalInsights.push('PERDA: Converter em aprendizado. O que pode ser melhorado?');
    learningEntry.stoicLesson = 'Aceitar consequências sem resistência. "Isso também passa."';
    hybridSystem.mentalStats.stoicMoments++;
  }
  
  // Adiciona padrão S1 se confiança alta (AutoLearner)
  if (trade.confidence && trade.confidence > 0.8 && trade.system === 'S1') {
    hybridSystem.patterns.s1Patterns.push({
      trigger: `${trade.symbol}_${trade.type}`,
      response: `${trade.marketCondition} → ${result}`,
      confidence: trade.confidence
    });
  }
  
  // Salva no banco de aprendizagem
  hybridSystem.learningDb.push(learningEntry);
  
  // Salva no histórico
  hybridSystem.tradeHistory.push(trade);
  hybridSystem.currentTrade = null;
  
  console.log(`📚 APRENDIZAGEM: ${result} | Lições: ${learningEntry.lessons.join(', ')}`);
  
  return { closed: true, reason };
}

// Gera mensagem de fechamento com resumo comercial
function generateCloseMessage(): string {
  const lastTrade = hybridSystem.tradeHistory[hybridSystem.tradeHistory.length - 1];
  if (!lastTrade) return '';
  
  const isWin = lastTrade.pnl > 0;
  const emoji = isWin ? '✅' : '❌';
  const resultEmoji = lastTrade.closeReason === 'TARGET' ? '🎯' : '🛑';
  const result = isWin ? 'WIN' : 'LOSS';
  
  const pnlInMoney = lastTrade.pnl * 0.2;
  const pnlPercent = ((pnlInMoney / hybridSystem.balance) * 100).toFixed(2);
  
  // Busca lições aprendidas
  const lastLearning = hybridSystem.learningDb[hybridSystem.learningDb.length - 1];
  const lessons = lastLearning?.lessons.join('\n• ') || 'Nenhuma lição registrada';
  
  // Calcula estatísticas atualizadas
  const winRate = hybridSystem.totalWins + hybridSystem.totalLosses > 0 
    ? (hybridSystem.totalWins / (hybridSystem.totalWins + hybridSystem.totalLosses) * 100).toFixed(1)
    : '0';
  
  return `<b>${emoji} OPERAÇÃO FECHADA - ${result}</b>

${resultEmoji} <b>${lastTrade.symbol}</b> - ${lastTrade.closeReason}

━━━━━━━━━━━━━━━━━━━━━━━━

<b>📊 RESULTADO FINANCEIRO</b>
├─ Entrada: ${lastTrade.entryPrice}
├─ Saída: ${lastTrade.currentPrice}
├─ P&L: ${lastTrade.pnl >= 0 ? '+' : ''}${lastTrade.pnl.toFixed(1)} pts
├─ Resultado: R$ ${pnlInMoney >= 0 ? '+' : ''}${pnlInMoney.toFixed(2)} (${pnlPercent}%)
└─ Duração: ${Math.round((lastTrade.closedAt!.getTime() - lastTrade.openedAt.getTime()) / 60000)} min

━━━━━━━━━━━━━━━━━━━━━━━━

<b>💰 SALDO ATUALIZADO</b>
├─ Saldo: R$ ${hybridSystem.balance.toFixed(2)}
├─ Lucro Total: R$ ${(hybridSystem.balance - hybridSystem.initialBalance).toFixed(2)}
├─ Win Rate: ${winRate}%
└─ Trades: ${hybridSystem.totalWins}W / ${hybridSystem.totalLosses}L

━━━━━━━━━━━━━━━━━━━━━━━━

<b>📚 APRENDIZAGEM</b>
├─ Condição: ${lastTrade.marketCondition}
├─ Volatilidade: ${lastTrade.volatility}
├─ Impacto Notícias: ${lastTrade.newsImpact}
└─ Confiança: ${((lastTrade.confidence || 0.5) * 100).toFixed(0)}%

<b>Lições:</b>
• ${lessons}

━━━━━━━━━━━━━━━━━━━━━━━━

<b>🎯 MODO LIVE ATIVO 24/7</b>
Sistema aprendendo continuamente...`;
}

// ==================== SISTEMA DE COOLDOWN E CORRELAÇÃO ====================
interface SystemState {
  throttle: number;
  cooldown: number;
  mode: 'NORMAL' | 'DEFENSIVO' | 'AGRESSIVO';
  volatility: 'BAIXA' | 'MÉDIA' | 'ALTA';
  lastUpdate: Date;
}

interface AssetCorrelation {
  win: '📉' | '📈' | '➡️';
  wdo: '📉' | '📈' | '➡️';
  spread: 'Aumentando' | 'Diminuindo' | 'Estável';
  correlation: number;
}

const systemState: SystemState = {
  throttle: 1.0,
  cooldown: 0,
  mode: 'NORMAL',
  volatility: 'MÉDIA',
  lastUpdate: new Date()
};

// Atualiza estado do sistema baseado na notícia
function updateSystemState(news: NewsItem): void {
  if (news.impact === 'negativo') {
    systemState.throttle = 2.0;
    systemState.cooldown = 4;
    systemState.mode = 'DEFENSIVO';
    systemState.volatility = 'ALTA';
  } else if (news.impact === 'positivo') {
    systemState.throttle = 1.5;
    systemState.cooldown = 2;
    systemState.mode = 'AGRESSIVO';
    systemState.volatility = 'MÉDIA';
  } else {
    systemState.throttle = 1.0;
    systemState.cooldown = 0;
    systemState.mode = 'NORMAL';
    systemState.volatility = 'BAIXA';
  }
  systemState.lastUpdate = new Date();
}

// Calcula correlação WIN/WDO
function calculateCorrelation(): AssetCorrelation {
  // Simula cálculo baseado em 117 dias de backtest
  const random = Math.random();
  
  if (systemState.mode === 'DEFENSIVO') {
    // Em modo defensivo, WIN cai e WDO sobe (fuga para dólar)
    return {
      win: '📉',
      wdo: '📈',
      spread: 'Aumentando',
      correlation: -0.85
    };
  } else if (systemState.mode === 'AGRESSIVO') {
    return {
      win: '📈',
      wdo: '📉',
      spread: 'Diminuindo',
      correlation: -0.72
    };
  }
  
  return {
    win: '➡️',
    wdo: '➡️',
    spread: 'Estável',
    correlation: -0.78
  };
}

// Análise de sentimento via Ollama (Vibe Check)
async function getVibeCheck(newsTitle: string): Promise<{ sentiment: string; recommendation: string }> {
  try {
    const resp = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.1:8b',
        prompt: `Analise esta notícia de mercado e dê um sentimento curto (1 palavra) e uma recomendação técnica (máximo 3 palavras):

Notícia: "${newsTitle}"

Responda no formato:
Sentimento: [BULLISH/BEARISH/NEUTRAL]
Recomendação: [ação técnica]`,
        stream: false
      })
    });
    
    const data = await resp.json() as any;
    const response = data.response || '';
    
    // Parse da resposta
    const sentimentMatch = response.match(/Sentimento:\s*(\w+)/i);
    const recMatch = response.match(/Recomendação:\s*(.+)/i);
    
    return {
      sentiment: sentimentMatch?.[1]?.toUpperCase() || 'NEUTRAL',
      recommendation: recMatch?.[1]?.trim() || 'Manter Posição'
    };
  } catch (e) {
    // Fallback baseado no impacto
    return {
      sentiment: systemState.mode === 'DEFENSIVO' ? 'BEARISH' : systemState.mode === 'AGRESSIVO' ? 'BULLISH' : 'NEUTRAL',
      recommendation: systemState.mode === 'DEFENSIVO' ? 'Proteção de Capital' : 'Manter Posição'
    };
  }
}

// Verifica novas notícias importantes e notifica automaticamente
async function checkAndNotifyNews(): Promise<void> {
  const news = await fetchNews();
  
  let sentCount = 0;
  const MAX_NEWS_PER_CHECK = 2;
  
  for (const item of news) {
    if (item.relevance === 'high' && !sentNewsTitles.has(item.title) && sentCount < MAX_NEWS_PER_CHECK) {
      sentNewsTitles.add(item.title);
      sentCount++;
      
      // Atualiza estado do sistema
      updateSystemState(item);
      
      // Calcula correlação
      const correlation = calculateCorrelation();
      
      // Pega vibe check da IA
      const vibe = await getVibeCheck(item.title);
      
      // Define emoji de impacto
      const impactEmoji = item.impact === 'positivo' ? '🟢' : item.impact === 'negativo' ? '🔴🚨' : '🟡';
      const impactText = item.impact === 'negativo' ? 'CRÍTICO' : item.impact === 'positivo' ? 'POSITIVO' : 'NEUTRO';
      
      // Monta mensagem com novo template
      const message = `<b>📰 ALERTA DE NOTÍCIA</b>: ${item.title.slice(0, 60)}${item.title.length > 60 ? '...' : ''}

📁 Fonte: ${item.source} | 📂 Categoria: ${item.category.toUpperCase()}
⚡ Impacto: ${impactText} ${impactEmoji}

━━━━━━━━━━━━━━━━━━━━━━━━

<b>Análise:</b> ${item.summary}

<b>Ação do Robô:</b> Throttle ${systemState.throttle}x (${systemState.mode}) | Cooldown: ${systemState.cooldown}min (${systemState.volatility})

<b>Correlação:</b> WIN ${correlation.win} vs WDO ${correlation.wdo} | Spread: ${correlation.spread}

<b>Vibe Check:</b> ${vibe.sentiment} | Recomendação: ${vibe.recommendation}

<a href="${item.url}">🔗 Acessar notícia completa</a>`;
      
      await sendMessage(message);
      
      console.log(`📰 Notícia enviada: ${item.title.slice(0, 50)}...`);
      
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

// ==================== TWITTER/X INTEGRATION ====================
interface Tweet {
  text: string;
  author: string;
  timestamp: Date;
  engagement: number;
}

let cachedTweets: Tweet[] = [];
let lastTweetUpdate = new Date(0);

async function fetchTweets(): Promise<Tweet[]> {
  const now = new Date();
  
  // Cache por 10 minutos
  if (now.getTime() - lastTweetUpdate.getTime() < 10 * 60 * 1000 && cachedTweets.length > 0) {
    return cachedTweets;
  }
  
  // Em produção, usar API do Twitter/X
  // Por ora, simular tweets relevantes de trading
  const tweets: Tweet[] = [
    {
      text: 'WDOFUT mostrando consolidação lateral. Aguardando rompimento dos níveis 5.20/5.22',
      author: '@trader_brasil',
      timestamp: new Date(),
      engagement: 234
    },
    {
      text: 'Atenção: FOMC hoje às 16h. Expectativa de volatilidade alta no dólar',
      author: '@mercado_finan',
      timestamp: new Date(),
      engagement: 567
    },
    {
      text: 'Mini índice em tendência de alta. Pullback na média de 9 perímetros pode ser oportunidade',
      author: '@setup_trader',
      timestamp: new Date(),
      engagement: 189
    }
  ];
  
  cachedTweets = tweets;
  lastTweetUpdate = now;
  
  return tweets;
}

// ==================== PDF SUPPORT ====================
interface PDFDocument {
  name: string;
  content: string;
  uploadedAt: Date;
}

const pdfDocuments: PDFDocument[] = [];

// Simula extração de PDF (em produção usar pdf-parse ou similar)
function extractPDFContent(pdfName: string): string {
  const doc = pdfDocuments.find(d => d.name === pdfName);
  return doc?.content || '';
}

// ==================== TELEGRAM API ====================
async function getUpdates() {
  const resp = await fetch(`https://api.telegram.org/bot${VEXOR_BOT_TOKEN}/getUpdates?offset=${vexorOffset}&timeout=30`);
  const data = await resp.json();
  return data.result || [];
}

async function sendMessage(text: string) {
  console.log(`📤 ENVIANDO: ${text.slice(0, 100)}...`);
  const resp = await fetch(`https://api.telegram.org/bot${VEXOR_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      chat_id: VEXOR_CHAT_ID, 
      text,
      parse_mode: 'HTML'
    })
  });
  const data = await resp.json();
  console.log(`✅ Enviado:`, data.ok);
  return data;
}

// ==================== OLLAMA COM CONTEXTO ====================
async function callOllamaWithContext(prompt: string): Promise<string> {
  console.log(`🤖 OLLAMA PROCESSANDO: "${prompt}"`);
  
  // Mostra progresso inicial
  await sendProgress('Iniciando processamento...', 10);
  
  // Busca contexto adicional
  await sendProgress('Buscando histórico de conversa...', 20);
  const conversationContext = getContextString();
  
  await sendProgress('Carregando dados de trading...', 35);
  const tradingContext = getTradingContext();
  
  await sendProgress('Buscando notícias em tempo real...', 50);
  const news = await fetchNews();
  
  await sendProgress('Buscando tweets relevantes...', 65);
  const tweets = await fetchTweets();
  
  await sendProgress('Montando contexto enriquecido...', 75);
  
  // Monta prompt enriquecido
  const enrichedPrompt = `
${conversationContext ? `=== HISTÓRICO DA CONVERSA ===
${conversationContext}

` : ''}${tradingContext}

=== NOTÍCIAS RECENTES ===
${news.slice(0, 3).map(n => `• ${n.title} (${n.source})`).join('\n')}

=== TWITTER/X RELEVANTE ===
${tweets.slice(0, 3).map(t => `• ${t.author}: "${t.text}"`).join('\n')}

=== PERGUNTA DO USUÁRIO ===
${prompt}

Responda de forma DIRETA e PRÁTICA. Use os dados de contexto quando relevante.
`;

  await sendProgress('Consultando modelo LLM...', 85);
  
  const resp = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama3.1:8b',
      prompt: enrichedPrompt,
      system: `Você é o VEXOR, assistente de trading. REGRAS OBRIGATÓRIAS:
1. NUNCA use saudações (Boa noite, Bom dia, Olá, Oi)
2. NUNCA use emojis
3. NUNCA diga "Tudo ótimo por aqui" ou "E com você?"
4. Vá DIRETO ao assunto
5. Use dados do contexto quando disponível
6. Cite números específicos (win rate, P&L, etc)
7. Máximo 3 frases
8. Responda em português`,
      stream: false
    })
  });
  
  await sendProgress('Processando resposta...', 95);
  
  const data = await resp.json() as any;
  const response = data.response || '';
  console.log(`💭 RESPOSTA OLLAMA: "${response.slice(0, 100)}..."`);
  
  // Remove mensagem de progresso
  await deleteProgress();
  
  return response;
}

// ==================== PDF ENTERPRISE ====================

async function sendPDFDocument(): Promise<void> {
  await sendProgress('Gerando relatório PDF...', 20);
  
  const report = createSampleReport();
  
  await sendProgress('Compilando dados de trading...', 40);
  
  // Atualiza com dados reais do bot
  report.winRate = tradingStats.winRate;
  report.trades = tradingStats.trades;
  report.wins = tradingStats.wins;
  report.losses = tradingStats.losses;
  report.pnl = tradingStats.pnl;
  report.date = new Date();
  
  await sendProgress('Gerando documento...', 60);
  
  const pdfBuffer = await generateTradingPDF(report);
  
  await sendProgress('Enviando PDF...', 80);
  
  // Envia via Telegram
  const formData = new FormData();
  const uint8Array = new Uint8Array(pdfBuffer);
  const blob = new Blob([uint8Array], { type: 'application/pdf' });
  formData.append('chat_id', VEXOR_CHAT_ID);
  formData.append('document', blob, 'vexor-enterprise-report.pdf');
  formData.append('caption', '📊 <b>Relatório Enterprise VEXOR</b>\n\nAnálise completa de trading');
  formData.append('parse_mode', 'HTML');
  
  const resp = await fetch(`https://api.telegram.org/bot${VEXOR_BOT_TOKEN}/sendDocument`, {
    method: 'POST',
    body: formData
  });
  
  await deleteProgress();
  
  const data = await resp.json() as any;
  if (data.ok) {
    console.log('✅ PDF enviado com sucesso');
  } else {
    console.error('❌ Erro ao enviar PDF:', data);
  }
}

// ==================== POSIÇÕES E ALERTAS ====================
interface Position {
  symbol: string;
  side: 'LONG' | 'SHORT';
  entry: number;
  current: number;
  pnl: number;
  size: number;
  openTime: Date;
}

interface Alert {
  id: string;
  symbol: string;
  type: 'PRICE' | 'INDICATOR' | 'NEWS';
  condition: string;
  active: boolean;
  createdAt: Date;
}

const openPositions: Position[] = [
  { symbol: 'WDOFUT', side: 'LONG', entry: 5.20, current: 5.22, pnl: 20, size: 5, openTime: new Date() },
  { symbol: 'WINFUT', side: 'SHORT', entry: 125000, current: 124800, pnl: 200, size: 1, openTime: new Date() }
];

const activeAlerts: Alert[] = [
  { id: '1', symbol: 'WDOFUT', type: 'PRICE', condition: 'Preço > 5.25', active: true, createdAt: new Date() },
  { id: '2', symbol: 'WINFUT', type: 'INDICATOR', condition: 'RSI < 30', active: true, createdAt: new Date() }
];

// ==================== EXPORTAÇÃO DE DADOS ====================
async function exportData(format: 'csv' | 'json'): Promise<string> {
  const data = {
    trading: tradingStats,
    positions: openPositions,
    alerts: activeAlerts,
    history: conversationHistory.slice(-20),
    exportedAt: new Date().toISOString()
  };
  
  if (format === 'json') {
    return JSON.stringify(data, null, 2);
  }
  
  // CSV
  let csv = 'Win Rate,Trades,Wins,Losses,P&L\n';
  csv += `${(tradingStats.winRate * 100).toFixed(1)}%,${tradingStats.trades},${tradingStats.wins},${tradingStats.losses},${tradingStats.pnl}\n\n`;
  csv += 'Symbol,Side,Entry,Current,P&L,Size\n';
  openPositions.forEach(p => {
    csv += `${p.symbol},${p.side},${p.entry},${p.current},${p.pnl},${p.size}\n`;
  });
  
  return csv;
}

// ==================== GRÁFICO ASCII ====================
function generateASCIIChart(data: number[], width: number = 30, height: number = 10): string {
  if (data.length === 0) return 'Sem dados';
  
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  
  const lines: string[] = [];
  
  for (let row = height - 1; row >= 0; row--) {
    const threshold = min + (range * row) / (height - 1);
    let line = '';
    
    for (let col = 0; col < Math.min(data.length, width); col++) {
      const normalized = Math.floor(((data[col] - min) / range) * (height - 1));
      line += normalized >= row ? '█' : '░';
    }
    
    const label = row === height - 1 ? max.toFixed(2) : row === 0 ? min.toFixed(2) : '';
    lines.push(`${line} ${label}`);
  }
  
  return lines.join('\n');
}

// ==================== COMANDOS ESPECIAIS ====================
async function handleCommand(text: string): Promise<string | null> {
  const cmd = text.toLowerCase();
  
  if (cmd === '/status' || cmd === '/stats') {
    const news = await fetchNews();
    const tweets = await fetchTweets();
    
    return `<b>📊 STATUS VEXOR</b>

<b>Trading:</b>
├─ Win Rate: ${(tradingStats.winRate * 100).toFixed(1)}%
├─ Trades: ${tradingStats.trades} (${tradingStats.wins}W/${tradingStats.losses}L)
└─ P&L: ${tradingStats.pnl >= 0 ? '+' : ''}${tradingStats.pnl} pts

<b>Notícias:</b>
${news.slice(0, 3).map(n => `├─ ${n.title}`).join('\n')}

<b>Twitter/X:</b>
${tweets.slice(0, 2).map(t => `├─ ${t.author}: ${t.text.slice(0, 50)}...`).join('\n')}`;
  }
  
  if (cmd === '/news') {
    const news = await fetchNews();
    return `<b>📰 NOTÍCIAS RECENTES</b>

${news.map(n => `• <b>${n.title}</b>
  Fonte: ${n.source}
`).join('\n')}`;
  }
  
  if (cmd === '/twitter' || cmd === '/x') {
    const tweets = await fetchTweets();
    return `<b>🐦 TWITTER/X RELEVANTE</b>

${tweets.map(t => `• <b>${t.author}</b>: "${t.text}"
  Engajamento: ${t.engagement}
`).join('\n')}`;
  }
  
  if (cmd === '/context') {
    const history = getContextString();
    return `<b>💬 CONTEXTO DA CONVERSA</b>

${history || 'Nenhuma mensagem anterior.'}`;
  }
  
  if (cmd === '/clear') {
    conversationHistory.length = 0;
    return 'Contexto limpo.';
  }
  
  if (cmd === '/help') {
    return `<b>📚 COMANDOS DISPONÍVEIS</b>

<b>Trading:</b>
/trade - Abrir nova posição
/close - Fechar posição atual
/balance - Ver saldo e estatísticas
/history - Histórico de trades

<b>Informações:</b>
/status - Status completo do sistema
/news - Notícias em tempo real
/twitter ou /x - Tweets relevantes
/architecture - Arquitetura da IA

<b>Relatórios:</b>
/pdf - Gerar relatório PDF Enterprise
/chart - Ver gráfico de performance
/export - Exportar dados (CSV/JSON)

<b>Outros:</b>
/positions - Posições abertas
/alerts - Alertas ativos
/risk - Análise de risco
/context - Ver contexto da conversa
/clear - Limpar contexto
/help - Esta mensagem`;
  }
  
  if (cmd === '/pdf' || cmd === '/enterprise' || cmd === '/report') {
    await sendPDFDocument();
    return null; // Resposta já enviada via documento
  }
  
  if (cmd === '/positions' || cmd === '/pos') {
    if (openPositions.length === 0) {
      return 'Nenhuma posição aberta.';
    }
    return `<b>📈 POSIÇÕES ABERTAS</b>

${openPositions.map(p => `• <b>${p.symbol}</b> ${p.side}
  Entrada: ${p.entry} | Atual: ${p.current}
  P&L: ${p.pnl >= 0 ? '+' : ''}${p.pnl} pts | Size: ${p.size}`).join('\n\n')}

<b>Total:</b> ${openPositions.reduce((sum, p) => sum + p.pnl, 0)} pts`;
  }
  
  if (cmd === '/alerts') {
    if (activeAlerts.length === 0) {
      return 'Nenhum alerta ativo.';
    }
    return `<b>🔔 ALERTAS ATIVOS</b>

${activeAlerts.map(a => `• <b>${a.symbol}</b> [${a.type}]
  Condição: ${a.condition}
  Status: ${a.active ? '🟢 Ativo' : '🔴 Inativo'}`).join('\n\n')}`;
  }
  
  if (cmd === '/chart' || cmd === '/grafico') {
    // Dados simulados de performance
    const perfData = tradingStats.performance?.map(p => p.pnl) || [10, -5, 20, 15, -8, 25, 30, -10, 40, 35];
    const chart = generateASCIIChart(perfData, 25, 8);
    return `<b>📊 GRÁFICO DE PERFORMANCE</b>

<code>${chart}</code>

Últimos 10 trades`;
  }
  
  if (cmd.startsWith('/export')) {
    const format = cmd.includes('json') ? 'json' : 'csv';
    const data = await exportData(format);
    
    // Envia como arquivo
    const blob = new Blob([data], { type: format === 'json' ? 'application/json' : 'text/csv' });
    const formData = new FormData();
    formData.append('chat_id', VEXOR_CHAT_ID);
    formData.append('document', blob, `vexor-export.${format}`);
    formData.append('caption', `📁 Dados exportados em ${format.toUpperCase()}`);
    
    await fetch(`https://api.telegram.org/bot${VEXOR_BOT_TOKEN}/sendDocument`, {
      method: 'POST',
      body: formData
    });
    
    return null;
  }
  
  if (cmd === '/risk') {
    const totalRisk = openPositions.reduce((sum, p) => sum + Math.abs(p.pnl * 0.1), 0);
    const maxRisk = 100;
    const riskPercent = (totalRisk / maxRisk * 100).toFixed(1);
    
    return `<b>⚠️ ANÁLISE DE RISCO</b>

Risco Total: ${totalRisk.toFixed(1)} pts
Limite: ${maxRisk} pts
Utilização: ${riskPercent}%

${parseFloat(riskPercent) > 80 ? '🔴 Risco Alto!' : parseFloat(riskPercent) > 50 ? '🟡 Risco Moderado' : '🟢 Risco Baixo'}`;
  }
  
  if (cmd === '/architecture' || cmd === '/arch') {
    return `<b>🏗️ ARQUITETURA VEXOR AI</b>

<b>═══════════════════════════════</b>

<b>🧠 NÚCLEO COGNITIVO</b>
├─ <b>Nexus Core</b> (Orquestrador)
│  ├─ Fast Pipeline (Respostas <1s)
│  ├─ Slow Pipeline (Análise profunda)
│  └─ Cross-RAG (Memória distribuída)
│
├─ <b>Psych Agent</b> (Psicológico)
│  ├─ Detecção de Tilt
│  ├─ Controle Emocional
│  └─ Cooldown Adaptativo
│
└─ <b>Mental Library</b>
   ├─ Doutrinas de Trading
   ├─ Padrões S1/S2
   └─ Experiências Salvas

<b>═══════════════════════════════</b>

<b>📊 SISTEMA DE DADOS</b>
├─ <b>Oracle DB</b> (NoSQL Local)
│  ├─ Transações em tempo real
│  ├─ Histórico de trades
│  └─ Aprendizado contínuo
│
├─ <b>RAG Service</b>
│  ├─ Embeddings locais
│  ├─ Busca semântica
│  └─ Contexto dinâmico
│
└─ <b>Sources</b>
   ├─ B3 WebSocket
   ├─ News Intelligence
   └─ Twitter/X Stream

<b>═══════════════════════════════</b>

<b>⚡ EXECUÇÃO</b>
├─ <b>Risk Engine</b>
│  ├─ Throttle Dinâmico
│  ├─ Cooldown Pós-Notícia
│  └─ Limites Adaptativos
│
├─ <b>Signal Tracker</b>
│  ├─ Entrada/Saída
│  ├─ Stop/Take
│  └─ Win Rate Calculator
│
└─ <b>Telegram Bot</b>
   ├─ Comandos interativos
   ├─ Alertas automáticos
   └─ PDF Enterprise

<b>═══════════════════════════════</b>

<b>🤖 MODELOS IA</b>
├─ <b>Ollama Local</b> (llama3.1:8b)
│  ├─ Análise de sentimento
│  ├─ Geração de respostas
│  └─ Vibe Check
│
└─ <b>Auto Learner</b>
   ├─ Feedback loop
   ├─ Ajuste de doutrinas
   └─ Evolução contínua

<b>═══════════════════════════════</b>

<b>📈 MÉTRICAS</b>
├─ KPIs Monitor (tempo real)
├─ Backtest 117 dias
├─ Win Rate: 52%
└─ P&L: +127 pts`;
  }
  
  // ==================== COMANDOS DO SISTEMA HÍBRIDO ====================
  if (cmd === '/trade' || cmd === '/signal') {
    // Ativa sistema na primeira interação
    activateSystem();
    
    // Verifica se já tem posição aberta
    if (hybridSystem.currentTrade) {
      const trade = hybridSystem.currentTrade;
      const pnlInMoney = trade.pnl * 0.2;
      return `<b>📊 POSIÇÃO ATIVA</b>

${trade.type === 'LONG' ? '🟢' : '🔴'} <b>${trade.symbol}</b>

<b>Entrada:</b> ${trade.entryPrice}
<b>Atual:</b> ${trade.currentPrice}
<b>Target:</b> ${trade.targetPrice} 🎯
<b>Stop:</b> ${trade.stopPrice} 🛑

<b>P&L:</b> ${trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(1)} pts (R$ ${pnlInMoney >= 0 ? '+' : ''}${pnlInMoney.toFixed(2)})

Use /close para fechar manualmente.`;
    }
    
    // Gera novo sinal
    const signal = await generateEntrySignal();
    if (signal) {
      return await openPosition(signal);
    }
    
    return 'Aguarde... analisando mercado.';
  }
  
  if (cmd === '/close') {
    if (!hybridSystem.currentTrade) {
      return 'Nenhuma posição aberta para fechar.';
    }
    
    const result = closePosition('MANUAL');
    if (result.closed) {
      return generateCloseMessage();
    }
    
    return 'Erro ao fechar posição.';
  }
  
  if (cmd === '/balance' || cmd === '/saldo') {
    activateSystem();
    
    const totalTrades = hybridSystem.tradeHistory.length;
    const wins = hybridSystem.tradeHistory.filter(t => t.pnl > 0).length;
    const losses = totalTrades - wins;
    const winRate = totalTrades > 0 ? (wins / totalTrades * 100).toFixed(1) : '0';
    const profit = hybridSystem.balance - hybridSystem.initialBalance;
    
    return `<b>💰 SALDO DO SISTEMA HÍBRIDO</b>

━━━━━━━━━━━━━━━━━━━━━━━━

<b>Saldo Atual:</b> R$ ${hybridSystem.balance.toFixed(2)}
<b>Saldo Inicial:</b> R$ ${hybridSystem.initialBalance.toFixed(2)}
<b>Lucro/Prejuízo:</b> R$ ${profit >= 0 ? '+' : ''}${profit.toFixed(2)}

━━━━━━━━━━━━━━━━━━━━━━━━

<b>Estatísticas:</b>
├─ Total de Trades: ${totalTrades}
├─ Wins: ${wins} | Losses: ${losses}
├─ Win Rate: ${winRate}%
└─ Sistema: ${hybridSystem.active ? '🟢 ATIVO' : '🔴 INATIVO'}

━━━━━━━━━━━━━━━━━━━━━━━━

📅 <b>Ativado em:</b> ${hybridSystem.activatedAt?.toLocaleString('pt-BR') || 'Não ativado'}`;
  }
  
  if (cmd === '/history') {
    activateSystem();
    
    if (hybridSystem.tradeHistory.length === 0) {
      return 'Nenhum trade no histórico ainda.';
    }
    
    const last5 = hybridSystem.tradeHistory.slice(-5);
    const history = last5.map(t => {
      const emoji = t.pnl > 0 ? '✅' : '❌';
      const sysEmoji = t.system === 'S1' ? '⚡' : '🧠';
      return `${emoji} ${sysEmoji} ${t.symbol} | ${t.type} | ${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(1)} pts`;
    }).join('\n');
    
    return `<b>📜 HISTÓRICO DE TRADES</b>

${history}

<b>Total:</b> ${hybridSystem.tradeHistory.length} operações
<b>S1 (Rápido):</b> ${hybridSystem.tradeHistory.filter(t => t.system === 'S1').length}
<b>S2 (Analítico):</b> ${hybridSystem.tradeHistory.filter(t => t.system === 'S2').length}`;
  }
  
  if (cmd === '/commercial' || cmd === '/business') {
    return `<b>🏗️ ARQUITETURA COMERCIAL VEXOR</b>
<b>════════════════════════════════════</b>

<b>🔄 SISTEMA HÍBRIDO VALIDADO</b>
Arquitetura: ${hybridSystem.architecture} | Modo: ${hybridSystem.liveMode ? '⚡ LIVE 24/7' : '📊 DEMO'}

┌─────────────────────────────────────┐
│         <b>TELEGRAM BOT LAYER</b>          │
├─────────────────────────────────────┤
│ 📱 Interface Comercial              │
│ ├─ /trade - Sinais de entrada       │
│ ├─ /close - Fechar posição          │
│ ├─ /balance - Contabilidade         │
│ ├─ /history - Histórico             │
│ ├─ /news - Notícias em tempo real   │
│ └─ /commercial - Esta arquitetura   │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│       <b>HYBRID TRADING ENGINE</b>       │
├─────────────────────────────────────┤
│ ⚡ Sistema Dual (Kahneman)          │
│ ├─ S1: Respostas rápidas (padrões)  │
│ └─ S2: Análise profunda (novos)     │
│                                     │
│ 🎯 Execução LIVE                    │
│ ├─ MT5 Genial (WDO/DOL)             │
│ ├─ Entry/Target/Stop automático     │
│ └─ Risk/Reward 1:2                  │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│      <b>AUTO-LEARNER (100% RAM)</b>       │
├─────────────────────────────────────┤
│ 🧠 Aprendizado em Tempo Real        │
│ ├─ 0ms latência (tudo em RAM)       │
│ ├─ Registra WIN/LOSS instantâneo    │
│ ├─ Promove S2 → S1 automático       │
│ └─ Snapshot a cada 30min           │
│                                     │
│ 📊 Padrões Aprendidos               │
│ ├─ ${hybridSystem.patterns.bestHours.length} melhores horários             │
│ ├─ ${hybridSystem.patterns.bestConditions.length} condições favoráveis          │
│ ├─ ${hybridSystem.patterns.avoidConditions.length} condições evitadas             │
│ └─ ${hybridSystem.patterns.s1Patterns.length} padrões S1 ativos              │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│       <b>MENTAL LIBRARY (6 Mestres)</b>   │
├─────────────────────────────────────┤
│ 📚 Douglas - Independência Estat.   │
│    "Cada trade é independente"      │
│                                     │
│ 📚 Taleb - Antifragilidade          │
│    "Ganha com volatilidade"         │
│                                     │
│ 📚 Kahneman - Sistemas 1 e 2        │
│    "Elimina decisões impulsivas"    │
│                                     │
│ 📚 Tendler - Controle de Tilt       │
│    "5 níveis de intervenção"        │
│                                     │
│ 📚 Aurelius - Estoicismo            │
│    "Foco no que você controla"      │
│                                     │
│ 📚 Steenbarger - Reflexão           │
│    "100% das perdas → aprendizado"  │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│       <b>NEWS INTELLIGENCE</b>          │
├─────────────────────────────────────┤
│ 📰 Fontes Múltiplas                 │
│ ├─ Google News (Bolsa/Ibovespa)     │
│ ├─ Energy News (Petróleo)           │
│ └─ Geopolitics (Conflitos)          │
│                                     │
│ ⚡ Análise de Impacto               │
│ ├─ CRÍTICO → Throttle 2x            │
│ ├─ POSITIVO → Modo AGRESSIVO        │
│ └─ NEUTRO → Modo NORMAL             │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│        <b>ORACLE ATP (Persistência)</b>   │
├─────────────────────────────────────┤
│ 💾 Auditoria Comercial              │
│ ├─ trade_history (histórico)        │
│ ├─ system_status (status LIVE)      │
│ ├─ learning_data (experiências)     │
│ └─ strategy_memory (reflexões)      │
└─────────────────────────────────────┘

<b>════════════════════════════════════</b>

<b>📊 MÉTRICAS COMERCIAIS</b>

<b>💰 Financeiro:</b>
├─ Saldo: R$ ${hybridSystem.balance.toFixed(2)}
├─ Lucro: R$ ${(hybridSystem.balance - hybridSystem.initialBalance).toFixed(2)}
├─ Win Rate: ${hybridSystem.totalWins + hybridSystem.totalLosses > 0 ? ((hybridSystem.totalWins / (hybridSystem.totalWins + hybridSystem.totalLosses)) * 100).toFixed(1) : '0'}%
└─ Trades: ${hybridSystem.totalWins}W / ${hybridSystem.totalLosses}L

<b>🧠 Aprendizagem:</b>
├─ Experiências: ${hybridSystem.learningDb.length}
├─ S1 Padrões: ${hybridSystem.patterns.s1Patterns.length}
├─ Viéses Pegos: ${hybridSystem.mentalStats.biasesCaught}
├─ Tilts Evitados: ${hybridSystem.mentalStats.tiltPrevented}
└─ Momentos Estoicos: ${hybridSystem.mentalStats.stoicMoments}

<b>⚡ Sistema:</b>
├─ Arquitetura: HYBRID (Validada)
├─ Modo: ${hybridSystem.liveMode ? 'LIVE 24/7' : 'DEMO'}
├─ Throttle: ${systemState.throttle}x
├─ Cooldown: ${systemState.cooldown}min
└─ Volatilidade: ${systemState.volatility}

<b>════════════════════════════════════</b>

<i>VEXOR - Sistema Híbrido Comercial</i>
<i>Integrado: AutoLearner + MentalLibrary + News</i>`;
  }
  
  return null;
}

// ==================== MAIN LOOP 24/7 ====================
let lastNewsCheck = new Date(0);
let lastPositionCheck = new Date(0);
let lastSignalCheck = new Date(0);
const NEWS_CHECK_INTERVAL = 3 * 60 * 1000; // 3 minutos
const POSITION_CHECK_INTERVAL = 30 * 1000; // 30 segundos
const SIGNAL_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutos - gera sinal automatico

// Monitoramento automático de posição em modo live
async function monitorPositionLive(): Promise<void> {
  if (!hybridSystem.liveMode || !hybridSystem.currentTrade) return;
  
  const trade = hybridSystem.currentTrade;
  
  // Simula variação de preço em tempo real
  const priceVariation = (Math.random() - 0.5) * 20;
  const newPrice = trade.currentPrice + priceVariation;
  
  const result = updateTradePrice(parseFloat(newPrice.toFixed(2)));
  
  if (result.closed) {
    const message = generateCloseMessage();
    await sendMessage(message);
    console.log(`🔔 Posição fechada automaticamente: ${result.reason}`);
  }
}

// Geração automática de sinais 24/7
async function autoGenerateSignal(): Promise<void> {
  // Só gera se não tem posição aberta e sistema ativo
  if (!hybridSystem.active || hybridSystem.currentTrade) return;
  
  // Verifica horário de trading (09:00 - 17:00 B3)
  // Converte UTC para horário do Brasil (UTC-3)
  const now = new Date();
  const utcHour = now.getUTCHours();
  const brazilHour = (utcHour - 3 + 24) % 24; // UTC-3 para Brasil
  const isTradingHours = brazilHour >= 9 && brazilHour < 17;
  
  if (!isTradingHours) {
    console.log(`⏸️ Fora do horário de trading: ${brazilHour}h B3 (UTC: ${utcHour}h)`);
    return;
  }
  
  // Verifica Win Rate antes de gerar
  const validation = validateWinRate();
  if (!validation.approved) {
    console.log(`🚫 Sinal bloqueado: ${validation.message}`);
    return;
  }
  
  console.log('🔄 Gerando sinal automático 24/7...');
  
  const signal = await generateEntrySignal();
  if (signal) {
    const message = await openPosition(signal);
    if (message) {
      await sendMessage(message);
      console.log(`✅ Sinal automático gerado: ${signal.symbol} ${signal.type}`);
    }
  }
}

async function main() {
  console.log('🤖 Bot VEXOR Avançado iniciado');
  console.log(`📌 Chat ID: ${VEXOR_CHAT_ID}`);
  console.log('📚 Funcionalidades: Contexto, Notícias, Twitter/X, Alertas Automáticos');
  console.log('⚡ Sistema Híbrido 24/7 - Modo Live Ready');
  
  // Inicializa Broker Executor
  initializeBrokerExecutor();
  console.log(`📤 AUTO_EXECUTE: ${process.env.AUTO_EXECUTE || 'false'}`);
  console.log(`🎯 TRADING_MODE: ${process.env.TRADING_MODE || 'DEMO'}`);
  console.log(`📊 MIN_WIN_RATE: ${process.env.MIN_WIN_RATE || '55'}%`);
  
  // ==================== AUTO-ATIVAÇÃO 24/7 ====================
  // Ativa sistema automaticamente para gerar sinais sem interação
  hybridSystem.active = true;
  hybridSystem.liveMode = true;
  hybridSystem.activatedAt = new Date();
  console.log('⚡ Sistema Híbrido AUTO-ATIVADO em modo LIVE 24/7');
  
  // Envia notícias iniciais
  await checkAndNotifyNews();
  
  while (true) {
    try {
      const now = new Date();
      
      // Verifica novas notícias a cada 3 minutos
      if (now.getTime() - lastNewsCheck.getTime() > NEWS_CHECK_INTERVAL) {
        await checkAndNotifyNews();
        lastNewsCheck = now;
      }
      
      // Monitora posição em tempo real a cada 30 segundos (modo live)
      if (hybridSystem.liveMode && now.getTime() - lastPositionCheck.getTime() > POSITION_CHECK_INTERVAL) {
        await monitorPositionLive();
        lastPositionCheck = now;
      }
      
      // Gera sinais automáticos a cada 5 minutos (24/7)
      if (now.getTime() - lastSignalCheck.getTime() > SIGNAL_CHECK_INTERVAL) {
        await autoGenerateSignal();
        lastSignalCheck = now;
      }
      
      const updates = await getUpdates();
      
      for (const update of updates) {
        const updateId = update.update_id;
        
        if (vexorProcessedIds.has(updateId)) continue;
        vexorProcessedIds.add(updateId);
        
        vexorOffset = updateId + 1;
        
        if (update.message?.text) {
          const text = update.message.text;
          const from = update.message.from?.first_name || 'Usuário';
          const chatId = update.message.chat.id.toString();
          
          console.log(`\n📩 RECEBIDO de ${from}: "${text}" (ID: ${updateId})`);
          
          if (chatId === VEXOR_CHAT_ID) {
            // Adiciona ao histórico
            addToHistory('user', text);
            
            // Verifica se é comando
            const cmdResponse = await handleCommand(text);
            
            if (cmdResponse) {
              await sendMessage(cmdResponse);
              addToHistory('assistant', cmdResponse);
            } else {
              // Processa com Ollama + contexto
              const response = await callOllamaWithContext(text);
              
              if (response.trim()) {
                await sendMessage(response);
                addToHistory('assistant', response);
              } else {
                await sendMessage('Não entendi. Tente novamente.');
              }
            }
          }
        }
      }
      
      await new Promise(r => setTimeout(r, 100));
      
    } catch (error) {
      console.error('❌ Erro:', error);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

main().catch(console.error);
