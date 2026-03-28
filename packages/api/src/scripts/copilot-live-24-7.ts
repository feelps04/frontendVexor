/**
 * COPILOT LIVE 24/7 - HYBRID
 * Integra MT5 Genial (B3) + Pepperstone (Global)
 * Usa RAMCache (B3) + FeatureStore (Redis) + ContextMemory
 * News Filter 3 real - Sem autotrade
 */

import * as fs from 'fs';
import * as path from 'path';
import { config } from 'dotenv';
import { oracleDB } from '../infrastructure/oracle-db.js';
import { telegramNotifier } from '../infrastructure/telegram-notifier.js';
import { newsService } from '../infrastructure/news-service.js';
import { getContextMemory, TradeContext } from '../infrastructure/context-memory.js';
import { ramCache, featureStore, strategyMemory } from '../infrastructure/nexus-core/memory/index.js';

const rootEnv = 'C:/Users/opc/CascadeProjects/vexor-Oracle/vexor-Oracle-main/.env';
if (fs.existsSync(rootEnv)) {
  config({ path: rootEnv, override: true });
}

// ==================== CONFIGURAÇÃO ====================

const COPILOT_CONFIG = {
  loopIntervalMs: 30000, // 30 segundos
  tickWindow: 500, // últimas 500 linhas do CSV
  minTicksForSignal: 100,
  rr: 2.0,
  newsFilter: 3,
  symbols: {
    b3: ['WDOFUT', 'DOLFUT', 'WINFUT'],
    global: ['EURUSD', 'GBPUSD', 'BTCUSD', 'ETHUSD']
  },
  mt5: {
    genial: {
      path: 'C:/Program Files/Genial Investimentos - MetaTrader 5/terminal64.exe',
      login: 4639348,
      server: 'Genial-Investimentos'
    },
    pepperstone: {
      path: 'C:/Program Files/Pepperstone MetaTrader 5/terminal64.exe',
      login: 451655575,
      server: 'Pepperstone-Demo'
    }
  },
  csvPaths: {
    WDOFUT: 'C:/Users/opc/Documents/WDOJ26.csv',
    DOLFUT: 'C:/Users/opc/Documents/DOL$.csv',
    WINFUT: 'C:/Users/opc/Documents/WINJ26.csv' // se existir
  }
};

// ==================== TIPOS ====================

type Broker = 'genial' | 'pepperstone';
type SymbolType = 'WDOFUT' | 'DOLFUT' | 'WINFUT' | 'EURUSD' | 'GBPUSD' | 'BTCUSD' | 'ETHUSD';
type Side = 'BUY' | 'SELL';

interface TickData {
  time: string;
  bid: number;
  ask: number;
  last: number;
  volume: number;
  type: string;
}

interface Signal {
  id: string;
  symbol: SymbolType;
  side: Side;
  entry: number;
  stop: number;
  target: number;
  rr: number;
  confidence: number;
  reason: string;
  tickWindow: number;
  buyVol: number;
  sellVol: number;
  imbalance: number;
  lastTickTime: string;
  blockedByNews: boolean;
  newsCount: number;
  newsTitles: string[];
  contextAllowed: boolean;
  contextReason: string;
  broker: Broker;
  createdAt: Date;
}

// ==================== UTILITÁRIOS ====================

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function nowId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatMoney(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ==================== MT5 CSV READER ====================

function readMT5TicksCSV(filePath: string, window: number): { ok: boolean; ticks: TickData[]; lastPrice: number; buyVol: number; sellVol: number; lastTime: string } {
  if (!fs.existsSync(filePath)) {
    return { ok: false, ticks: [], lastPrice: 0, buyVol: 0, sellVol: 0, lastTime: '' };
  }

  try {
    const buffer = fs.readFileSync(filePath);
    const start = buffer[0] === 0xFF && buffer[1] === 0xFE ? 2 : 0;
    const content = buffer.slice(start).toString('utf16le');
    const lines = content.split('\n').filter(l => l && l.length > 10);
    
    const slice = lines.slice(Math.max(0, lines.length - window));
    
    let buyVol = 0;
    let sellVol = 0;
    let lastPrice = 0;
    let lastTime = '';
    const ticks: TickData[] = [];

    for (const line of slice) {
      const parts = line.split(',');
      if (parts.length < 6) continue;

      const time = (parts[0] || '').trim();
      const bid = parseFloat(parts[1]) || 0;
      const ask = parseFloat(parts[2]) || 0;
      const last = parseFloat(parts[3]) || 0;
      const vol = parseInt(parts[4]) || 0;
      const type = (parts[5] || '').replace(/\r/g, '').trim();

      const px = last || (bid + ask) / 2;
      if (px > 0) lastPrice = px;
      if (time) lastTime = time;

      if (type === 'Buy') buyVol += vol;
      else if (type === 'Sell') sellVol += vol;

      ticks.push({ time, bid, ask, last, volume: vol, type });
    }

    return { ok: lastPrice > 0, ticks, lastPrice, buyVol, sellVol, lastTime };
  } catch (e) {
    return { ok: false, ticks: [], lastPrice: 0, buyVol: 0, sellVol: 0, lastTime: '' };
  }
}

// ==================== RAM CACHE (B3) ====================

function cacheB3Tick(symbol: string, data: { lastPrice: number; buyVol: number; sellVol: number; lastTime: string }): void {
  const key = `b3:${symbol}:tick`;
  ramCache.set(key, data, 60000); // 1 min TTL
  
  // Também guarda no cache de preço
  ramCache.set(`price:${symbol}`, data.lastPrice, 30000);
}

function getB3FromCache(symbol: string): any {
  return ramCache.get(`b3:${symbol}:tick`);
}

// ==================== FEATURE STORE (INDICADORES) ====================

async function updateIndicators(symbol: string, prices: number[]): Promise<void> {
  if (prices.length < 20) return;
  await featureStore.calculateAndStore(symbol, prices);
}

async function getIndicators(symbol: string): Promise<Record<string, number>> {
  return await featureStore.getAllIndicators(symbol);
}

// ==================== CONTEXT MEMORY ====================

function buildContext(symbol: string, hour: number, indicators: Record<string, number>): TradeContext {
  const rsi = indicators['RSI14'] || 50;
  const atr = indicators['ATR14'] || 0;
  const atrAvg = atr * 0.9; // aproximação
  const ema9 = indicators['EMA12'] || 0;
  const ema21 = indicators['SMA20'] || 0;
  const bbUpper = indicators['BB_UPPER'] || 0;
  const bbLower = indicators['BB_LOWER'] || 0;
  const price = indicators['BB_MID'] || 0;

  // Detecta zona RSI
  const rsiZone = rsi > 60 ? 'HIGH' : rsi < 40 ? 'LOW' : 'MID';
  
  // Detecta regime
  const trendStrength = Math.abs(ema9 - ema21) / Math.max(0.0001, atr);
  const bbWidth = (bbUpper - bbLower) / Math.max(0.0001, price);
  let regime = 'TREND';
  if (trendStrength > 1.0) regime = 'TREND';
  else if (bbWidth < 0.02) regime = 'RANGE';
  else if (atr > atrAvg * 1.5) regime = 'VOLATILE';

  return {
    strategy: symbol.includes('WDO') || symbol.includes('DOL') ? 'breakout' : 'mean_reversion',
    hour,
    trend: ema9 > ema21 ? 'UP' : 'DOWN',
    rsi_zone: rsiZone,
    volatility: atr > atrAvg ? 'HIGH' : 'LOW',
    regime
  };
}

// ==================== NEWS FILTER ====================

async function checkNewsFilter(symbol: string, filterLevel: number): Promise<{ blocked: boolean; count: number; titles: string[] }> {
  const all = await newsService.getAllNews();
  
  const groupKeys = symbol.includes('WDO') || symbol.includes('DOL') 
    ? ['MACRO', 'JUROS', 'DOLAR', 'FED', 'FOMC']
    : symbol.includes('WIN')
    ? ['MACRO', 'IBOVESPA', 'BOLSA']
    : ['FOREX', 'MACRO'];

  const matched = all.filter(n => {
    const title = n.title.toUpperCase();
    const groups = (n.relatedGroups || []).map(g => g.toUpperCase());
    
    if (groups.some(g => groupKeys.includes(g))) return true;
    if (title.includes('FED') || title.includes('JUROS') || title.includes('DÓLAR')) return true;
    
    return false;
  });

  return {
    blocked: matched.length >= filterLevel,
    count: matched.length,
    titles: matched.slice(0, 3).map(n => n.title)
  };
}

// ==================== SINAL ====================

function computeSignal(
  symbol: SymbolType,
  lastPrice: number,
  buyVol: number,
  sellVol: number,
  tickWindow: number,
  lastTime: string,
  rr: number
): { side: Side; stop: number; target: number; confidence: number; reason: string } {
  const imbalance = buyVol - sellVol;
  const total = Math.max(1, buyVol + sellVol);
  const strength = Math.min(1, Math.abs(imbalance) / total);
  
  const side: Side = imbalance >= 0 ? 'BUY' : 'SELL';
  
  // Stop distance baseado em ATR ou % do preço
  const stopDistance = lastPrice * 0.002; // 0.2% do preço
  
  let stop: number;
  let target: number;
  
  if (side === 'BUY') {
    stop = lastPrice - stopDistance;
    target = lastPrice + stopDistance * rr;
  } else {
    stop = lastPrice + stopDistance;
    target = lastPrice - stopDistance * rr;
  }
  
  // Confiança: base 50% + força do imbalance + bônus por janela
  const windowBonus = Math.min(0.15, tickWindow / 2000);
  const confidence = 0.50 + strength * 0.35 + windowBonus;
  
  const reason = `${side === 'BUY' ? 'Compra' : 'Venda'} dominante (${((imbalance/total)*100).toFixed(0)}% imbalance)`;
  
  return { side, stop, target, confidence, reason };
}

// ==================== ORACLE ====================

async function ensureSignalsTable(): Promise<void> {
  try {
    await oracleDB.execute('SELECT 1 FROM copilot_signals WHERE ROWNUM = 1');
    return;
  } catch (e) {}

  try { await oracleDB.execute('DROP TABLE copilot_signals'); } catch (e) {}

  await oracleDB.execute(`
    CREATE TABLE copilot_signals (
      id VARCHAR2(120) PRIMARY KEY,
      symbol VARCHAR2(20),
      side VARCHAR2(10),
      entry NUMBER,
      stop NUMBER,
      target NUMBER,
      rr NUMBER,
      confidence NUMBER,
      reason VARCHAR2(4000),
      tick_window NUMBER,
      buy_vol NUMBER,
      sell_vol NUMBER,
      imbalance NUMBER,
      last_tick_time VARCHAR2(40),
      blocked_by_news NUMBER,
      news_count NUMBER,
      context_allowed NUMBER,
      context_reason VARCHAR2(200),
      broker VARCHAR2(30),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function persistSignal(s: Signal): Promise<void> {
  await oracleDB.insert(
    `INSERT INTO copilot_signals (
      id, symbol, side, entry, stop, target, rr, confidence, reason,
      tick_window, buy_vol, sell_vol, imbalance, last_tick_time,
      blocked_by_news, news_count, context_allowed, context_reason, broker
    ) VALUES (
      :id, :symbol, :side, :entry, :stop, :target, :rr, :confidence, :reason,
      :tick_window, :buy_vol, :sell_vol, :imbalance, :last_tick_time,
      :blocked_by_news, :news_count, :context_allowed, :context_reason, :broker
    )`,
    {
      id: s.id,
      symbol: s.symbol,
      side: s.side,
      entry: s.entry,
      stop: s.stop,
      target: s.target,
      rr: s.rr,
      confidence: s.confidence,
      reason: s.reason,
      tick_window: s.tickWindow,
      buy_vol: s.buyVol,
      sell_vol: s.sellVol,
      imbalance: s.imbalance,
      last_tick_time: s.lastTickTime,
      blocked_by_news: s.blockedByNews ? 1 : 0,
      news_count: s.newsCount,
      context_allowed: s.contextAllowed ? 1 : 0,
      context_reason: s.contextReason,
      broker: s.broker
    }
  );
}

// ==================== TELEGRAM ====================

async function sendSignalAlert(s: Signal): Promise<void> {
  const emoji = s.side === 'BUY' ? '🟢' : '🔴';
  const action = s.side === 'BUY' ? 'COMPRA' : 'VENDA';
  
  let msg = `<b>${emoji} COPILOT LIVE - ${action}</b>\n\n`;
  msg += `<b>Ativo:</b> ${s.symbol}\n`;
  msg += `<b>Entrada:</b> ${formatMoney(s.entry)}\n`;
  msg += `<b>Stop:</b> ${formatMoney(s.stop)} (1R)\n`;
  msg += `<b>Target:</b> ${formatMoney(s.target)} (${s.rr}R)\n`;
  msg += `<b>R/R:</b> 1:${s.rr.toFixed(1)}\n`;
  msg += `<b>Confiança:</b> ${(s.confidence * 100).toFixed(0)}%\n`;
  msg += `<b>Razão:</b> ${s.reason}\n\n`;
  
  if (s.blockedByNews) {
    msg += `<b>⚠️ BLOQUEADO POR NOTÍCIAS</b>\n`;
    msg += `<b>News Count:</b> ${s.newsCount}\n`;
    s.newsTitles.forEach(t => msg += `• ${t}\n`);
    msg += `\n`;
  }
  
  msg += `<b>Contexto:</b> ${s.contextAllowed ? '✅' : '❌'} ${s.contextReason}\n`;
  msg += `<b>Broker:</b> ${s.broker}\n`;
  msg += `<b>Ticks:</b> ${s.tickWindow}\n`;
  msg += `<b>Imbalance:</b> ${((s.imbalance / (s.buyVol + s.sellVol)) * 100).toFixed(0)}%\n\n`;
  msg += `⏰ ${s.createdAt.toLocaleString('pt-BR')}\n`;
  msg += `\n<i>COPILOT LIVE - SEM AUTOTRADE</i>`;
  
  await telegramNotifier.sendMessage(msg);
}

async function sendHeartbeat(): Promise<void> {
  const msg = `<b>💓 COPILOT LIVE</b>\n\n` +
    `Status: <b>ONLINE</b>\n` +
    `Loop: ${COPILOT_CONFIG.loopIntervalMs / 1000}s\n` +
    `Símbolos B3: ${COPILOT_CONFIG.symbols.b3.join(', ')}\n` +
    `Símbolos Global: ${COPILOT_CONFIG.symbols.global.join(', ')}\n` +
    `News Filter: ${COPILOT_CONFIG.newsFilter}\n` +
    `R/R: 1:${COPILOT_CONFIG.rr}\n\n` +
    `⏰ ${new Date().toLocaleString('pt-BR')}`;
  
  await telegramNotifier.sendMessage(msg);
}

// ==================== LOOP PRINCIPAL ====================

async function processSymbol(symbol: SymbolType, broker: Broker): Promise<Signal | null> {
  const csvPath = COPILOT_CONFIG.csvPaths[symbol as keyof typeof COPILOT_CONFIG.csvPaths];
  
  if (!csvPath || !fs.existsSync(csvPath)) {
    return null;
  }
  
  const data = readMT5TicksCSV(csvPath, COPILOT_CONFIG.tickWindow);
  
  if (!data.ok || data.ticks.length < COPILOT_CONFIG.minTicksForSignal) {
    return null;
  }
  
  // Cache B3
  if (broker === 'genial') {
    cacheB3Tick(symbol, { lastPrice: data.lastPrice, buyVol: data.buyVol, sellVol: data.sellVol, lastTime: data.lastTime });
  }
  
  // Feature Store
  const prices = data.ticks.map(t => t.last || (t.bid + t.ask) / 2).filter(p => p > 0);
  await updateIndicators(symbol, prices);
  const indicators = await getIndicators(symbol);
  
  // Context Memory
  const hour = new Date().getHours();
  const context = buildContext(symbol, hour, indicators);
  const contextCheck = getContextMemory().canTrade(context);
  
  // News Filter
  const newsCheck = await checkNewsFilter(symbol, COPILOT_CONFIG.newsFilter);
  
  // Sinal
  const sig = computeSignal(
    symbol,
    data.lastPrice,
    data.buyVol,
    data.sellVol,
    data.ticks.length,
    data.lastTime,
    COPILOT_CONFIG.rr
  );
  
  const signal: Signal = {
    id: nowId('SIG'),
    symbol,
    side: sig.side,
    entry: data.lastPrice,
    stop: sig.stop,
    target: sig.target,
    rr: COPILOT_CONFIG.rr,
    confidence: sig.confidence,
    reason: sig.reason,
    tickWindow: data.ticks.length,
    buyVol: data.buyVol,
    sellVol: data.sellVol,
    imbalance: data.buyVol - data.sellVol,
    lastTickTime: data.lastTime,
    blockedByNews: newsCheck.blocked,
    newsCount: newsCheck.count,
    newsTitles: newsCheck.titles,
    contextAllowed: contextCheck.allowed,
    contextReason: contextCheck.reason,
    broker,
    createdAt: new Date()
  };
  
  // Persiste
  await persistSignal(signal);
  
  // Alerta
  await sendSignalAlert(signal);
  
  return signal;
}

async function mainLoop(): Promise<void> {
  console.log('\n🚀 ========================================');
  console.log('🚀 COPILOT LIVE 24/7 - HYBRID');
  console.log('🚀 ========================================\n');
  
  // Conecta Redis
  try {
    await featureStore.connect();
    console.log('✅ Redis conectado');
  } catch (e) {
    console.log('⚠️ Redis não disponível (usando RAMCache)');
  }
  
  // Garante tabela Oracle
  await ensureSignalsTable();
  console.log('✅ Oracle tabela pronta');
  
  // Carrega Context Memory
  getContextMemory().report();
  
  // Heartbeat inicial
  await sendHeartbeat();
  
  let loopCount = 0;
  let lastHeartbeat = Date.now();
  
  while (true) {
    loopCount++;
    const now = Date.now();
    
    console.log(`\n📊 Loop #${loopCount} - ${new Date().toLocaleString('pt-BR')}`);
    
    // Processa símbolos B3 (Genial)
    for (const symbol of COPILOT_CONFIG.symbols.b3) {
      try {
        const signal = await processSymbol(symbol as SymbolType, 'genial');
        if (signal) {
          console.log(`   📈 ${symbol}: ${signal.side} @ ${formatMoney(signal.entry)} ${signal.blockedByNews ? '🚫 NEWS' : '✅'}`);
        }
      } catch (e) {
        console.error(`   ❌ ${symbol}: ${e}`);
      }
    }
    
    // Heartbeat a cada 30 min
    if (now - lastHeartbeat > 30 * 60 * 1000) {
      await sendHeartbeat();
      lastHeartbeat = now;
    }
    
    // Aguarda próximo loop
    await sleep(COPILOT_CONFIG.loopIntervalMs);
  }
}

// ==================== START ====================

mainLoop().catch(err => {
  console.error('❌ Erro fatal:', err);
  process.exit(1);
});
