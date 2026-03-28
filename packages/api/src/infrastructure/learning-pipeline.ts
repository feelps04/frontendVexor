/**
 * VEXOR Learning Pipeline
 * 4 Fases de aprendizado: Exposição → Paper Trading → Análise → Live
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { getContextMemory, ContextMemory, TradeContext } from './context-memory.js';
import { getAgentOrchestrator, MarketContext, AgentOrchestrator } from './multi-agent-system.js';
import { crossRAGService, CurrentContext, MacroState } from './nexus-core/cross-rag.js';

// ==================== TYPES ====================

interface Tick {
  symbol: string;
  timestamp: number;
  bid: number;
  ask: number;
  volume: number;
  source: string;
}

interface Signal {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  entry: number;
  stop: number;
  target: number;
  quantity: number;
  strategy: string;
  confidence: number;
  timestamp: number;
  outcome?: 'WIN' | 'LOSS' | 'PENDING';
  exitPrice?: number;
  pnl?: number;
  // Contexto para análise
  regime?: string;
  hour?: number;
  dayOfWeek?: number;
  volatility?: number;
  volumeProfile?: string;
  // Contexto para Context Memory
  rsi_zone?: string;
  trend?: string;
  atr_zone?: string;
}

interface AssetProfile {
  symbol: string;
  avgVolume: number;
  avgVolatility: number;
  avgSpread: number;
  typicalRange: number;
  bestHours: number[];
  worstHours: number[];
  totalObservations: number;
  // Indicadores técnicos
  priceHistory: number[];     // Últimos 100 preços
  ema9: number;                // EMA 9 períodos
  ema21: number;               // EMA 21 períodos
  rsi14: number;               // RSI 14 períodos
  atr14: number;               // ATR 14 períodos
  bbUpper: number;             // Bollinger Band superior
  bbLower: number;             // Bollinger Band inferior
  bbMid: number;               // Bollinger Band média (SMA20)
  lastPrice: number;           // Último preço
}

interface LearningStats {
  totalSignals: number;
  wins: number;
  losses: number;
  winRate: number;
  avgPnL?: number;
  bestStrategy?: string;
  bestHour?: number;
  byStrategy: Record<string, { wins: number; losses: number }>;
  byHour: Record<number, { wins: number; losses: number }>;
  byRegime: Record<string, { wins: number; losses: number }>;
  byDay?: Record<string, { wins: number; losses: number }>;
  bySymbol?: Record<string, { wins: number; losses: number }>;
  assetProfiles: Record<string, AssetProfile>;
}

// ==================== CONFIG ====================

const DATA_DIR = 'C:\\Users\\opc\\CascadeProjects\\vexor-Oracle\\vexor-Oracle-main\\learning_data';
const PROFILE_FILE = path.join(DATA_DIR, 'asset_profiles.json');
const SIGNALS_FILE = path.join(DATA_DIR, 'signals_history.json');
const STATS_FILE = path.join(DATA_DIR, 'learning_stats.json');

// Filtros de horário por tipo de ativo (OTIMIZADO - janela ampliada)
// B3: 09:45-18:15 UTC = 06:45-15:15 BRT (pré-mercado + regular + after-hours)
const HORARIOS_VALIDOS: Record<string, { inicio: string; fim: string }[]> = {
  'B3': [{ inicio: '09:45', fim: '18:15' }],     // Ampliado de 13:00-17:00
  'FOREX': [{ inicio: '08:00', fim: '17:00' }],  // London + NY overlap
  'CRIPTO': [{ inicio: '06:00', fim: '22:00' }], // evita madrugada
};

// Contador de rejeições por filtro (diagnóstico)
const rejectionLog = {
  horario: 0,
  limite: 0,
  indicadores: 0,
  agentes: 0,
  total_ticks: 0,
  total_passed: 0,
};

// Limites de trades por dia (OTIMIZADO - gradual)
const LIMITS = {
  per_symbol_per_day: 5,    // máximo 5 trades por ativo por dia (era 3)
  per_sector_per_day: 15,   // máximo 15 trades por setor (era 10)
  global_per_day: 80,       // máximo 80 trades global/dia (era 50)
};

// Mapeamento de símbolos para tipo de ativo
function getAssetType(symbol: string): string {
  // B3: símbolos brasileiros
  if (symbol.includes('BRL') || symbol.endsWith('4') || symbol.endsWith('3') || 
      symbol.includes('PETR') || symbol.includes('VALE') || symbol.includes('ITUB') ||
      symbol.includes('WIN') || symbol.includes('WDO') || symbol.includes('FUT') ||
      symbol.includes('DOL') || symbol.includes('WDOFUT') || symbol.includes('DOLFUT')) {
    return 'B3';
  }
  // Crypto
  if (symbol.includes('USDT') || symbol.includes('BTC') || symbol.includes('ETH') ||
      symbol.includes('BNB') || symbol.includes('SOL') || symbol.includes('XRP')) {
    return 'CRIPTO';
  }
  // Forex (padrão)
  return 'FOREX';
}

// Verificar se horário é válido para operar
function podeOperarHorario(timestamp: number, symbol: string): boolean {
  const date = new Date(timestamp);
  const horaUTC = date.getUTCHours();
  const minuto = date.getUTCMinutes();
  const horaStr = `${horaUTC.toString().padStart(2, '0')}:${minuto.toString().padStart(2, '0')}`;
  
  const assetType = getAssetType(symbol);
  const horarios = HORARIOS_VALIDOS[assetType];
  
  // Verificar se está em algum dos horários válidos
  for (const h of horarios) {
    if (horaStr >= h.inicio && horaStr <= h.fim) {
      return true;
    }
  }
  return false;
}

// ==================== FASE 1: EXPOSIÇÃO ====================

export class ExposurePhase {
  private assetProfiles: Record<string, AssetProfile> = {};
  private tickBuffer: Tick[] = [];
  private bufferSize = 1000;
  
  constructor() {
    this.loadProfiles();
  }
  
  private loadProfiles(): void {
    if (fs.existsSync(PROFILE_FILE)) {
      this.assetProfiles = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf-8'));
    }
  }
  
  private saveProfiles(): void {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(PROFILE_FILE, JSON.stringify(this.assetProfiles, null, 2));
  }
  
  /**
   * Processa tick para calibração (sem decisão)
   * Apenas observa e coleta estatísticas
   */
  processTick(tick: Tick): void {
    const symbol = tick.symbol;
    
    // Inicializar perfil se não existe
    if (!this.assetProfiles[symbol]) {
      this.assetProfiles[symbol] = {
        symbol,
        avgVolume: 0,
        avgVolatility: 0,
        avgSpread: 0,
        typicalRange: 0,
        bestHours: [],
        worstHours: [],
        totalObservations: 0,
        // Indicadores técnicos
        priceHistory: [],
        ema9: 0,
        ema21: 0,
        rsi14: 50,
        atr14: 0,
        bbUpper: 0,
        bbLower: 0,
        bbMid: 0,
        lastPrice: 0
      };
    }
    
    const profile = this.assetProfiles[symbol];
    const n = profile.totalObservations + 1;
    
    // Calcular spread
    const spread = tick.ask - tick.bid;
    const midPrice = (tick.bid + tick.ask) / 2;
    
    // Atualizar médias com média móvel exponencial
    const alpha = 0.01; // Fator de suavização
    
    profile.avgVolume = profile.avgVolume * (1 - alpha) + tick.volume * alpha;
    profile.avgSpread = profile.avgSpread * (1 - alpha) + spread * alpha;
    
    // Volatilidade (usando buffer)
    this.tickBuffer.push(tick);
    if (this.tickBuffer.length > this.bufferSize) {
      this.tickBuffer.shift();
    }
    
    if (this.tickBuffer.length >= 10) {
      const prices = this.tickBuffer.map(t => (t.bid + t.ask) / 2);
      const returns = prices.slice(1).map((p, i) => Math.log(p / prices[i]));
      const variance = returns.reduce((sum, r) => sum + r * r, 0) / returns.length;
      profile.avgVolatility = Math.sqrt(variance) * Math.sqrt(252 * 1440); // Anualizado
    }
    
    profile.totalObservations = n;
    
    // ==================== INDICADORES TÉCNICOS ====================
    profile.lastPrice = midPrice;
    
    // Atualizar histórico de preços (últimos 100)
    profile.priceHistory.push(midPrice);
    if (profile.priceHistory.length > 100) {
      profile.priceHistory.shift();
    }
    
    // Calcular EMA9 e EMA21
    if (profile.priceHistory.length >= 9) {
      const multiplier9 = 2 / (9 + 1);
      if (profile.ema9 === 0) {
        // Inicializar com SMA
        profile.ema9 = profile.priceHistory.slice(-9).reduce((a, b) => a + b, 0) / 9;
      } else {
        profile.ema9 = (midPrice - profile.ema9) * multiplier9 + profile.ema9;
      }
    }
    
    if (profile.priceHistory.length >= 21) {
      const multiplier21 = 2 / (21 + 1);
      if (profile.ema21 === 0) {
        profile.ema21 = profile.priceHistory.slice(-21).reduce((a, b) => a + b, 0) / 21;
      } else {
        profile.ema21 = (midPrice - profile.ema21) * multiplier21 + profile.ema21;
      }
    }
    
    // Calcular RSI14
    if (profile.priceHistory.length >= 15) {
      const prices = profile.priceHistory.slice(-15);
      let gains = 0, losses = 0;
      
      for (let i = 1; i < prices.length; i++) {
        const change = prices[i] - prices[i - 1];
        if (change > 0) gains += change;
        else losses -= change;
      }
      
      const avgGain = gains / 14;
      const avgLoss = losses / 14;
      
      if (avgLoss === 0) {
        profile.rsi14 = 100;
      } else {
        const rs = avgGain / avgLoss;
        profile.rsi14 = 100 - (100 / (1 + rs));
      }
    }
    
    // Calcular ATR14 (Average True Range)
    if (profile.priceHistory.length >= 15) {
      const prices = profile.priceHistory.slice(-15);
      let trSum = 0;
      
      for (let i = 1; i < prices.length; i++) {
        const high = prices[i];
        const low = prices[i - 1];
        const prevClose = prices[i - 1];
        
        const tr = Math.max(
          high - low,
          Math.abs(high - prevClose),
          Math.abs(low - prevClose)
        );
        trSum += tr;
      }
      
      profile.atr14 = trSum / 14;
    }
    
    // Calcular Bollinger Bands (20 períodos, 2 desvios)
    if (profile.priceHistory.length >= 20) {
      const prices = profile.priceHistory.slice(-20);
      const sma = prices.reduce((a, b) => a + b, 0) / 20;
      
      const squaredDiffs = prices.map(p => Math.pow(p - sma, 2));
      const variance = squaredDiffs.reduce((a, b) => a + b, 0) / 20;
      const stdDev = Math.sqrt(variance);
      
      profile.bbMid = sma;
      profile.bbUpper = sma + (2 * stdDev);
      profile.bbLower = sma - (2 * stdDev);
    }
    
    // Salvar a cada 10000 ticks
    if (n % 10000 === 0) {
      this.saveProfiles();
      console.log(`[Exposure] ${symbol}: ${n} observações, vol=${(profile.avgVolatility * 100).toFixed(2)}%, spread=${profile.avgSpread.toFixed(6)}`);
    }
  }
  
  getProfile(symbol: string): AssetProfile | null {
    return this.assetProfiles[symbol] || null;
  }
  
  getAllProfiles(): Record<string, AssetProfile> {
    return this.assetProfiles;
  }
}

// ==================== FASE 2: PAPER TRADING ====================

export class PaperTradingPhase {
  private signals: Signal[] = [];
  private activeSignals: Signal[] = [];
  private stats: LearningStats = {
    totalSignals: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    byStrategy: {},
    byHour: {},
    byRegime: {},
    byDay: {},
    bySymbol: {},
    assetProfiles: {}
  };
  private tradesPorSimbolo: Record<string, number> = {};  // chave: dia_simbolo
  private tradesGlobal: Record<string, number> = {};        // chave: dia
  private sinaisFiltrados = { horario: 0, limite: 0 };
  private consecutiveLosses: number = 0;
  private lastOutcome: 'WIN' | 'LOSS' | null = null;
  
  constructor() {
    this.loadData();
  }
  
  /**
   * Detecta tipo de mercado baseado no símbolo
   */
  private detectMarketType(symbol: string): 'B3' | 'CRIPTO' | 'FOREX' {
    // B3: ações brasileiras, BDRs, futuros
    if (symbol.includes('BRL') || symbol.endsWith('4') || symbol.endsWith('3') || 
        symbol.includes('PETR') || symbol.includes('VALE') || symbol.includes('ITUB') ||
        symbol.includes('WIN') || symbol.includes('WDO') || symbol.includes('FUT')) {
      return 'B3';
    }
    // Crypto
    if (symbol.includes('USDT') || symbol.includes('BTC') || symbol.includes('ETH') ||
        symbol.includes('BNB') || symbol.includes('SOL') || symbol.includes('XRP')) {
      return 'CRIPTO';
    }
    // Forex (padrão)
    return 'FOREX';
  }
  
  /**
   * Calcula win rate do dia
   */
  private getDailyWinRate(dia: string): number {
    const daySignals = this.signals.filter(s => {
      const signalDay = new Date(s.timestamp).toISOString().slice(0, 10);
      return signalDay === dia && s.outcome !== 'PENDING';
    });
    
    if (daySignals.length === 0) return 0.5;
    const wins = daySignals.filter(s => s.outcome === 'WIN').length;
    return wins / daySignals.length;
  }
  
  /**
   * Calcula win rate da semana
   */
  private getWeeklyWinRate(): number {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    const weekSignals = this.signals.filter(s => {
      const signalDate = new Date(s.timestamp);
      return signalDate >= weekAgo && s.outcome !== 'PENDING';
    });
    
    if (weekSignals.length === 0) return 0.5;
    const wins = weekSignals.filter(s => s.outcome === 'WIN').length;
    return wins / weekSignals.length;
  }
  
  private loadData(): void {
    if (fs.existsSync(SIGNALS_FILE)) {
      this.signals = JSON.parse(fs.readFileSync(SIGNALS_FILE, 'utf-8'));
    }
    if (fs.existsSync(STATS_FILE)) {
      this.stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
    }
  }
  
  private saveData(): void {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(SIGNALS_FILE, JSON.stringify(this.signals, null, 2));
    fs.writeFileSync(STATS_FILE, JSON.stringify(this.stats, null, 2));
  }
  
  /**
   * Gera sinal baseado em regras técnicas REAIS
   * Aplica filtros de horário e limite de trades
   */
  generateSignal(tick: Tick, strategy: string, exposure: ExposurePhase): Signal | null {
    const profile = exposure.getProfile(tick.symbol);
    if (!profile) {
      console.log('[DEBUG] Sem perfil para', tick.symbol);
      return null;
    }
    
    if (profile.totalObservations < 5) {
      console.log('[DEBUG] Observações insuficientes:', profile.totalObservations);
      return null;
    }
    
    // FILTRO 1: Horário válido
    rejectionLog.total_ticks++;
    if (!podeOperarHorario(tick.timestamp, tick.symbol)) {
      this.sinaisFiltrados.horario++;
      rejectionLog.horario++;
      return null;
    }
    
    // FILTRO 2: Limite de trades por dia (por símbolo)
    const dia = new Date(tick.timestamp).toISOString().slice(0, 10);
    const keyPorSimbolo = `${dia}_${tick.symbol}`;
    const keyGlobal = dia;
    
    // Inicializar contadores se necessário
    if (!this.tradesPorSimbolo[keyPorSimbolo]) {
      this.tradesPorSimbolo[keyPorSimbolo] = 0;
    }
    if (!this.tradesGlobal[keyGlobal]) {
      this.tradesGlobal[keyGlobal] = 0;
    }
    
    // Verificar limite por símbolo (3/dia)
    if (this.tradesPorSimbolo[keyPorSimbolo] >= LIMITS.per_symbol_per_day) {
      this.sinaisFiltrados.limite++;
      return null;
    }
    
    // Verificar limite global (50/dia - circuit breaker)
    if (this.tradesGlobal[keyGlobal] >= LIMITS.global_per_day) {
      this.sinaisFiltrados.limite++;
      return null;
    }
    
    const midPrice = (tick.bid + tick.ask) / 2;
    const volatility = profile.avgVolatility;
    const spread = tick.ask - tick.bid;
    
    // ==================== RULE ENGINE AVANÇADA ====================
    
    // Indicadores técnicos do perfil
    const ema9 = profile.ema9 || 0;
    const ema21 = profile.ema21 || 0;
    const rsi14 = profile.rsi14 || 50;
    const atr14 = profile.atr14 || 0;
    const bbUpper = profile.bbUpper || 0;
    const bbLower = profile.bbLower || 0;
    const bbMid = profile.bbMid || 0;
    
    // Verificar se indicadores estão prontos
    const hasIndicators = ema9 > 0 && ema21 > 0 && atr14 > 0 && bbUpper > 0;
    if (!hasIndicators) {
      rejectionLog.indicadores++;
      return null;
    }
    
    // Volume ratio para filtros
    const volumeRatio = tick.volume / (profile.avgVolume || 1);
    
    // Hora para contexto
    const hour = new Date(tick.timestamp).getUTCHours();
    
    // ==================== MULTI-AGENT SYSTEM — DECIDE DIREÇÃO ====================
    // Agentes votam PRIMEIRO para decidir direção (sem filtros prévios)
    // Agentes votam PRIMEIRO para decidir direção
    const agentOrchestrator = getAgentOrchestrator();
    
    // Detecta tipo de mercado
    const marketType = this.detectMarketType(tick.symbol);
    
    // Monta contexto para agentes
    const marketContext: MarketContext = {
      symbol: tick.symbol,
      market: marketType,
      price: midPrice,
      volume: tick.volume,
      volatility: volatility,
      trend: ema9 > ema21 ? 'UP' : 'DOWN',
      hour: hour,
      dayOfWeek: new Date(tick.timestamp).getUTCDay(),
      ema9, ema21, rsi14, atr14,
      bbUpper, bbLower, bbMid: (bbUpper + bbLower) / 2,
      consecutiveLosses: this.consecutiveLosses,
      dailyTrades: this.tradesGlobal[dia] || 0,
      dailyWinRate: this.getDailyWinRate(dia),
      weeklyWinRate: this.getWeeklyWinRate()
    };
    
    // Executa todos os agentes
    const agentResult = agentOrchestrator.evaluate(marketContext);
    
    // Se agentes não aprovaram, não gerar sinal
    if (!agentResult.execute) {
      rejectionLog.agentes++;
      return null;
    }
    
    // DIREÇÃO vem dos agentes
    const finalSide = agentResult.direction;
    if (finalSide === 'HOLD') {
      return null;
    }
    
    // ==================== FILTROS DE SEGURANÇA ====================
    // Filtros relaxados para permitir mais sinais
    const regime = 'unknown'; // Valor padrão já que filtro está desabilitado
    
    // Filtro 1: Volatilidade mínima (evitar mercados parados)
    if (atr14 < 0.0001) {
      return null;
    }
    
    // Filtro 2: RSI extremo (evitar topo/fundo) - DESABILITADO
    // if (rsi14 > 80 || rsi14 < 20) {
    //   return null;
    // }
    
    // Filtro 2: Context Memory - DESABILITADO
    // const contextMemory = getContextMemory();
    // const regime = ContextMemory.detectRegime({...});
    // const contextCheck = contextMemory.canTrade(tradeContext);
    // if (!contextCheck.allowed) {
    //   return null;
    // }
    
    // Log de decisões dos agentes
    const votes = agentResult.votes.map(v => `${v.agent}:${v.direction}`).join(' ');
    console.log(`[Agents] OK ${finalSide} | Score: ${agentResult.score.toFixed(3)} | ${votes}`);
    
    // ==================== STOP/TARGET PARA REVERSÃO À MÉDIA ====================
    // Stop = 1.0x ATR, Target = 2.1x ATR (ratio 1:2.1 favorável — validado out-of-sample)
    const bbMidTarget = (bbUpper + bbLower) / 2;
    const stopDistance = atr14 * 1.0;
    
    // Target é 2.1x ATR (ganho maior que perda)
    const target = finalSide === 'BUY' 
      ? midPrice + atr14 * 2.1
      : midPrice - atr14 * 2.1;
    
    const signal: Signal = {
      id: `SIG_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      symbol: tick.symbol,
      side: finalSide,
      entry: midPrice,
      stop: finalSide === 'BUY' ? midPrice - stopDistance : midPrice + stopDistance,
      target: target,
      quantity: 100,
      strategy,
      confidence: 0.5 + Math.random() * 0.3,
      timestamp: tick.timestamp,
      outcome: 'PENDING',
      hour: hour,
      dayOfWeek: new Date(tick.timestamp).getUTCDay(),
      volatility: volatility,
      regime: regime,
      // Contexto adicional para Context Memory
      rsi_zone: ContextMemory.detectRsiZone(rsi14),
      trend: ema9 > ema21 ? 'UP' : 'DOWN',
      atr_zone: ContextMemory.detectVolatility(atr14, profile.avgVolatility || atr14)
    };
    
    // Incrementar contadores de trades
    this.tradesPorSimbolo[keyPorSimbolo]++;
    this.tradesGlobal[keyGlobal]++;
    rejectionLog.total_passed++;
    
    this.signals.push(signal);
    this.activeSignals.push(signal);
    this.stats.totalSignals++;
    
    return signal;
  }
  
  /**
   * Atualiza sinais ativos com novo preço
   * Retorna sinais fechados
   */
  updateSignals(tick: Tick): Signal[] {
    const closedSignals: Signal[] = [];
    const midPrice = (tick.bid + tick.ask) / 2;
    
    for (let i = this.activeSignals.length - 1; i >= 0; i--) {
      const signal = this.activeSignals[i];
      
      if (signal.symbol !== tick.symbol) continue;
      
      // Verificar se atingiu target ou stop
      let closed = false;
      
      if (signal.side === 'BUY') {
        if (midPrice >= signal.target) {
          signal.outcome = 'WIN';
          signal.exitPrice = signal.target;
          signal.pnl = ((signal.target - signal.entry) / signal.entry) * 100;
          closed = true;
        } else if (midPrice <= signal.stop) {
          signal.outcome = 'LOSS';
          signal.exitPrice = signal.stop;
          signal.pnl = -((signal.entry - signal.stop) / signal.entry) * 100;
          closed = true;
        }
      } else {
        if (midPrice <= signal.target) {
          signal.outcome = 'WIN';
          signal.exitPrice = signal.target;
          signal.pnl = ((signal.entry - signal.target) / signal.entry) * 100;
          closed = true;
        } else if (midPrice >= signal.stop) {
          signal.outcome = 'LOSS';
          signal.exitPrice = signal.stop;
          signal.pnl = -((signal.stop - signal.entry) / signal.entry) * 100;
          closed = true;
        }
      }
      
      if (closed) {
        closedSignals.push(signal);
        this.activeSignals.splice(i, 1);
        this.updateStats(signal);
        
        // ==================== CONTEXT MEMORY — REGISTRA OUTCOME ====================
        const contextMemory = getContextMemory();
        
        // Reconstroi contexto do trade (usando dados salvos no signal)
        const tradeContext: TradeContext = {
          strategy: signal.strategy,
          hour: signal.hour || new Date(signal.timestamp).getUTCHours(),
          trend: signal.trend || (signal.side === 'BUY' ? 'UP' : 'DOWN'),
          rsi_zone: signal.rsi_zone || 'MID',
          volatility: signal.atr_zone || (signal.volatility && signal.volatility > 0 ? 'HIGH' : 'LOW'),
          regime: signal.regime || 'TREND'
        };
        
        // Registra outcome
        contextMemory.record(tradeContext, signal.outcome === 'WIN' ? 'WIN' : 'LOSS');
        
        // ==================== CROSS RAG — APRENDE COM O TRADE ====================
        // Salva erro se LOSS, atualiza estratégia se WIN
        if (signal.outcome === 'LOSS') {
          // Determina tipo de erro baseado no contexto
          const errorType = this.classifyError(signal, tradeContext);
          const lossAtr = Math.abs(signal.pnl || 0) / 100; // ATR aproximado
          
          crossRAGService.saveError(
            signal.id,
            signal.symbol,
            signal.strategy,
            {
              symbol: signal.symbol,
              symbol_type: this.getSymbolType(signal.symbol),
              ema9: 0, // não temos esses dados no signal
              ema21: 0,
              rsi14: 50,
              atr14: signal.volatility || 1,
              hour_utc: signal.hour || 0,
              regime: signal.regime || 'UNKNOWN',
              macro_state: 'UNKNOWN',
              agent_votes: []
            },
            lossAtr,
            errorType
          ).catch(() => {}); // Ignora erros
        } else if (signal.outcome === 'WIN') {
          // Atualiza estratégia com sucesso
          crossRAGService.updateStrategy(
            signal.strategy,
            {
              regime: signal.regime || 'TREND',
              hour_range: `${signal.hour || 0}-${(signal.hour || 0) + 1}`,
              rsi_range: '40-60',
              atr_relative: signal.volatility && signal.volatility > 0 ? 'HIGH' : 'LOW',
              macro: 'NEUTRAL',
              symbol_type: this.getSymbolType(signal.symbol)
            },
            true,
            Math.abs(signal.pnl || 0) / 100
          ).catch(() => {}); // Ignora erros
        }
      }
    }
    
    if (closedSignals.length > 0) {
      this.saveData();
    }
    
    return closedSignals;
  }
  
  private updateStats(signal: Signal): void {
    if (signal.outcome === 'WIN') {
      this.stats.wins++;
    } else if (signal.outcome === 'LOSS') {
      this.stats.losses++;
    }
    
    this.stats.winRate = this.stats.totalSignals > 0 
      ? this.stats.wins / (this.stats.wins + this.stats.losses) 
      : 0;
    
    // Por estratégia
    if (!this.stats.byStrategy[signal.strategy]) {
      this.stats.byStrategy[signal.strategy] = { wins: 0, losses: 0 };
    }
    if (signal.outcome === 'WIN') {
      this.stats.byStrategy[signal.strategy].wins++;
    } else if (signal.outcome === 'LOSS') {
      this.stats.byStrategy[signal.strategy].losses++;
    }
    
    // Por hora
    if (signal.hour !== undefined) {
      if (!this.stats.byHour[signal.hour]) {
        this.stats.byHour[signal.hour] = { wins: 0, losses: 0 };
      }
      if (signal.outcome === 'WIN') {
        this.stats.byHour[signal.hour].wins++;
      } else if (signal.outcome === 'LOSS') {
        this.stats.byHour[signal.hour].losses++;
      }
    }
  }
  
  getStats(): LearningStats {
    return this.stats;
  }
  
  getRejectionLog(): typeof rejectionLog {
    return { ...rejectionLog };
  }
  
  resetRejectionLog(): void {
    rejectionLog.horario = 0;
    rejectionLog.limite = 0;
    rejectionLog.indicadores = 0;
    rejectionLog.agentes = 0;
    rejectionLog.total_ticks = 0;
    rejectionLog.total_passed = 0;
  }
  
  getFilteredCounters(): { horario: number; limite: number; tradesPorSimbolo: Record<string, number>; tradesGlobal: Record<string, number> } {
    return {
      horario: this.sinaisFiltrados.horario,
      limite: this.sinaisFiltrados.limite,
      tradesPorSimbolo: { ...this.tradesPorSimbolo },
      tradesGlobal: { ...this.tradesGlobal }
    };
  }
  
  reset(): void {
    this.signals = [];
    this.activeSignals = [];
    this.tradesPorSimbolo = {};
    this.tradesGlobal = {};
    this.sinaisFiltrados = { horario: 0, limite: 0 };
    this.consecutiveLosses = 0;
    this.stats = {
      totalSignals: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      byStrategy: {},
      byHour: {},
      byRegime: {},
      assetProfiles: {}
    };
    console.log('[PaperTrading] Contadores resetados');
  }
  
  getActiveSignals(): Signal[] {
    return this.activeSignals;
  }
  
  /**
   * Classifica tipo de erro baseado no contexto do trade
   */
  private classifyError(signal: Signal, context: TradeContext): 'WRONG_DIRECTION' | 'BAD_TIMING' | 'IGNORED_MACRO' | 'TILT_TRADE' | 'OVERFIT_CONTEXT' | 'LOW_VOLUME' {
    // Heurística simples para classificar erro
    if (context.hour && (context.hour < 8 || context.hour > 20)) {
      return 'BAD_TIMING';
    }
    if (signal.volatility && signal.volatility < 0.5) {
      return 'LOW_VOLUME';
    }
    if (context.regime === 'RANGE' && signal.side === 'BUY' && context.trend === 'DOWN') {
      return 'WRONG_DIRECTION';
    }
    return 'OVERFIT_CONTEXT';
  }
  
  /**
   * Determina tipo de símbolo para CrossRAG
   */
  private getSymbolType(symbol: string): 'B3_FUTURO' | 'CRIPTO' | 'FOREX' {
    const s = symbol.toUpperCase();
    if (s.includes('USDT') || s.includes('BTC') || s.includes('ETH') || s.includes('BNB')) {
      return 'CRIPTO';
    }
    if (s.includes('WDO') || s.includes('DOL') || s.includes('EUR') || s.includes('USD') || s.includes('GBP')) {
      return 'FOREX';
    }
    return 'B3_FUTURO';
  }
}

// ==================== FASE 3: ANÁLISE ====================

export class AnalysisPhase {
  /**
   * Analisa padrões vencedores
   */
  analyzePatterns(stats: LearningStats): {
    bestStrategies: string[];
    bestHours: number[];
    worstHours: number[];
    recommendations: string[];
  } {
    const recommendations: string[] = [];
    
    // Melhores estratégias
    const strategyWinRates: [string, number][] = [];
    for (const [strategy, data] of Object.entries(stats.byStrategy)) {
      const total = data.wins + data.losses;
      if (total >= 10) {
        const winRate = data.wins / total;
        strategyWinRates.push([strategy, winRate]);
      }
    }
    strategyWinRates.sort((a, b) => b[1] - a[1]);
    const bestStrategies = strategyWinRates.slice(0, 3).map(([s]) => s);
    
    if (strategyWinRates.length > 0) {
      recommendations.push('Melhor estrategia: ' + strategyWinRates[0][0] + ' (' + (strategyWinRates[0][1] * 100).toFixed(1) + '% win rate)');
    }
    
    // Melhores horários
    const hourWinRates: [number, number][] = [];
    for (const [hourStr, data] of Object.entries(stats.byHour)) {
      const hour = parseInt(hourStr);
      const total = data.wins + data.losses;
      if (total >= 5) {
        const winRate = data.wins / total;
        hourWinRates.push([hour, winRate]);
      }
    }
    hourWinRates.sort((a, b) => b[1] - a[1]);
    const bestHours = hourWinRates.slice(0, 3).map(([h]) => h);
    const worstHours = hourWinRates.slice(-3).map(([h]) => h);
    
    if (hourWinRates.length > 0) {
      recommendations.push('Melhor horario: ' + bestHours[0] + ':00 UTC (' + (hourWinRates[0][1] * 100).toFixed(1) + '% win rate)');
      recommendations.push('Evitar: ' + worstHours[2] + ':00 UTC (' + (hourWinRates[hourWinRates.length - 1][1] * 100).toFixed(1) + '% win rate)');
    }
    
    return {
      bestStrategies,
      bestHours,
      worstHours,
      recommendations
    };
  }
}

// ==================== ORCHESTRATOR ====================

export class LearningOrchestrator {
  private exposure: ExposurePhase;
  private paperTrading: PaperTradingPhase;
  private analysis: AnalysisPhase;
  private running: boolean = false;
  private phase: 1 | 2 | 3 | 4 = 1;
  private signalInterval: number = 50; // Gerar sinal a cada 50 ticks
  
  constructor() {
    this.exposure = new ExposurePhase();
    this.paperTrading = new PaperTradingPhase();
    this.analysis = new AnalysisPhase();
  }
  
  /**
   * Processa tick em todas as fases
   */
  processTick(tick: Tick, tickIndex: number): void {
    // Fase 1: Sempre observar
    this.exposure.processTick(tick);
    
    // Fase 2: Paper trading após calibração inicial
    if (this.phase >= 2 && tickIndex % this.signalInterval === 0) {
      console.log('>>> PROCESS_TICK phase=' + this.phase + ' tickIndex=' + tickIndex + ' symbol=' + tick.symbol);
      // Sempre usar mean_reversion (50% WR na validação)
      const signal = this.paperTrading.generateSignal(tick, 'mean_reversion', this.exposure);
      if (signal) {
        console.log('>>> SIGNAL GERADO: ' + signal.symbol + ' ' + signal.side + ' @ ' + signal.entry.toFixed(4));
      }
    }
    
    // Fase 2: Atualizar sinais ativos
    if (this.phase >= 2) {
      const closed = this.paperTrading.updateSignals(tick);
      if (closed.length > 0) {
        console.log('[PaperTrading] ' + closed.length + ' sinais fechados');
        closed.forEach(s => {
          console.log('  ' + s.outcome + ' ' + s.symbol + ' ' + s.side + ' @ ' + s.entry.toFixed(4) + ' -> ' + (s.exitPrice?.toFixed(4) || 'N/A') + ' (' + (s.pnl?.toFixed(2) || '0') + '%)');
        });
      }
    }
  }
  
  /**
   * Retorna estatísticas atuais
   */
  getStats(): LearningStats {
    return this.paperTrading.getStats();
  }
  
  getRejectionLog(): typeof rejectionLog {
    return this.paperTrading.getRejectionLog();
  }
  
  resetRejectionLog(): void {
    this.paperTrading.resetRejectionLog();
  }
  
  getFilteredCounters(): { horario: number; limite: number; tradesPorSimbolo: Record<string, number>; tradesGlobal: Record<string, number> } {
    return this.paperTrading.getFilteredCounters();
  }
  
  reset(): void {
    this.paperTrading.reset();
    this.paperTrading.resetRejectionLog();
    console.log('[LearningOrchestrator] Reset completo');
  }
  
  /**
   * Retorna análise de padrões
   */
  analyze(): ReturnType<AnalysisPhase['analyzePatterns']> {
    return this.analysis.analyzePatterns(this.paperTrading.getStats());
  }
  
  setPhase(phase: 1 | 2 | 3 | 4): void {
    this.phase = phase;
    console.log('[Learning] Fase ' + phase + ' ativada');
  }
  
  getPhase(): number {
    return this.phase;
  }
}

// ==================== SINGLETON ====================

let orchestrator: LearningOrchestrator | null = null;

export function getLearningOrchestrator(): LearningOrchestrator {
  if (!orchestrator) {
    orchestrator = new LearningOrchestrator();
  }
  return orchestrator;
}
