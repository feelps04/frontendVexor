/**
 * VEXOR Pipeline FAST - Sinais de Trade
 * Latência <50ms - Nunca passa pelo LLM
 * WebSocket → Indicadores → Regras → Ordem
 */

import { riskEngine } from './risk-engine.js';
import { probabilityFilters } from './doctrine/probability-filters.js';
import { telegramNotifier } from '../telegram-notifier.js';

// ==================== FAST PIPELINE ====================

interface Tick {
  symbol: string;
  price: number;
  volume: number;
  timestamp: number;
}

interface IndicatorSet {
  ema9: number;
  ema21: number;
  rsi14: number;
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  atr14: number;
  volume: number;
  avgVolume: number;
}

interface TradeSignal {
  symbol: string;
  side: 'BUY' | 'SELL';
  entry: number;
  stop: number;
  target: number;
  quantity: number;
  confidence: number;
  strategy: string;
  latencyMs: number;
  timestamp: number;
}

interface FastRuleResult {
  signal: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  strategy: string;
  reasons: string[];
}

class FastPipeline {
  private priceBuffer: Map<string, number[]> = new Map();
  private volumeBuffer: Map<string, number[]> = new Map();
  private readonly BUFFER_SIZE = 100;

  // Cache de indicadores em RAM
  private indicatorCache: Map<string, IndicatorSet> = new Map();

  // ==================== ETAPA 1: WebSocket Feed ====================

  /**
   * Processa tick recebido via WebSocket
   * <1ms
   */
  processTick(tick: Tick): void {
    // Atualiza buffers em RAM
    let prices = this.priceBuffer.get(tick.symbol) || [];
    let volumes = this.volumeBuffer.get(tick.symbol) || [];

    prices.push(tick.price);
    volumes.push(tick.volume);

    if (prices.length > this.BUFFER_SIZE) {
      prices = prices.slice(-this.BUFFER_SIZE);
      volumes = volumes.slice(-this.BUFFER_SIZE);
    }

    this.priceBuffer.set(tick.symbol, prices);
    this.volumeBuffer.set(tick.symbol, volumes);
  }

  // ==================== ETAPA 2: Feature Calculation ====================

  /**
   * Calcula indicadores TA em RAM
   * <5ms
   */
  calculateIndicators(symbol: string): IndicatorSet | null {
    const prices = this.priceBuffer.get(symbol);
    const volumes = this.volumeBuffer.get(symbol);

    if (!prices || prices.length < 21) return null;

    // EMA 9
    const ema9 = this.calculateEMA(prices, 9);

    // EMA 21
    const ema21 = this.calculateEMA(prices, 21);

    // RSI 14
    const rsi14 = this.calculateRSI(prices, 14);

    // Bollinger Bands (20, 2)
    const bb = this.calculateBollingerBands(prices, 20, 2);

    // ATR 14
    const atr14 = this.calculateATR(prices, 14);

    // Volume médio
    const avgVolume = volumes ? volumes.slice(-20).reduce((a, b) => a + b, 0) / 20 : 0;
    const currentVolume = volumes ? volumes[volumes.length - 1] : 0;

    const indicators: IndicatorSet = {
      ema9,
      ema21,
      rsi14,
      bbUpper: bb.upper,
      bbMiddle: bb.middle,
      bbLower: bb.lower,
      atr14,
      volume: currentVolume,
      avgVolume
    };

    this.indicatorCache.set(symbol, indicators);
    return indicators;
  }

  // ==================== ETAPA 3: Rule Engine ====================

  /**
   * Decisão determinística via regras
   * <2ms
   */
  evaluateRules(symbol: string, indicators: IndicatorSet): FastRuleResult {
    const reasons: string[] = [];
    let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    let confidence = 0;
    let strategy = '';

    // REGRA 1: Trend Following (EMA crossover)
    if (indicators.ema9 > indicators.ema21 * 1.001) {
      signal = 'BUY';
      confidence += 0.3;
      reasons.push('EMA9 > EMA21 (tendência alta)');
      strategy = 'TREND_FOLLOW';
    } else if (indicators.ema9 < indicators.ema21 * 0.999) {
      signal = 'SELL';
      confidence += 0.3;
      reasons.push('EMA9 < EMA21 (tendência baixa)');
      strategy = 'TREND_FOLLOW';
    }

    // REGRA 2: RSI Extremos
    if (signal === 'BUY' && indicators.rsi14 < 35) {
      confidence += 0.2;
      reasons.push('RSI sobrevendido');
    } else if (signal === 'SELL' && indicators.rsi14 > 65) {
      confidence += 0.2;
      reasons.push('RSI sobrecomprado');
    } else if (indicators.rsi14 < 25 && signal === 'HOLD') {
      signal = 'BUY';
      confidence = 0.4;
      reasons.push('RSI extremamente sobrevendido');
      strategy = 'MEAN_REVERSION';
    } else if (indicators.rsi14 > 75 && signal === 'HOLD') {
      signal = 'SELL';
      confidence = 0.4;
      reasons.push('RSI extremamente sobrecomprado');
      strategy = 'MEAN_REVERSION';
    }

    // REGRA 3: Bollinger Band Bounce
    const lastPrice = this.priceBuffer.get(symbol)?.slice(-1)[0] || 0;
    if (lastPrice <= indicators.bbLower * 1.01 && signal !== 'SELL') {
      signal = 'BUY';
      confidence += 0.25;
      reasons.push('Preço na banda inferior de Bollinger');
      strategy = strategy || 'BB_BOUNCE';
    } else if (lastPrice >= indicators.bbUpper * 0.99 && signal !== 'BUY') {
      signal = 'SELL';
      confidence += 0.25;
      reasons.push('Preço na banda superior de Bollinger');
      strategy = strategy || 'BB_BOUNCE';
    }

    // REGRA 4: Volume Confirmation
    if (indicators.volume > indicators.avgVolume * 1.5) {
      confidence += 0.15;
      reasons.push('Volume 50% acima da média');
    } else {
      confidence *= 0.7; // Penaliza se volume baixo
      reasons.push('Volume abaixo do ideal');
    }

    // REGRA 5: Filtros Obrigatórios da Doutrina
    if (signal !== 'HOLD') {
      const trendOk = signal === 'BUY' ? indicators.ema9 > indicators.ema21 : indicators.ema9 < indicators.ema21;
      if (!trendOk) {
        confidence *= 0.5;
        reasons.push('⚠️ Tendência não confirmada');
      }
    }

    return { signal, confidence: Math.min(confidence, 1), strategy, reasons };
  }

  // ==================== ETAPA 4: Risk Check ====================

  /**
   * Verifica risco e calcula posição
   * <2ms
   */
  checkRisk(params: {
    symbol: string;
    signal: 'BUY' | 'SELL';
    entry: number;
    indicators: IndicatorSet;
    capital: number;
    winRate: number;
    avgWin: number;
    avgLoss: number;
  }): { stop: number; target: number; quantity: number; approved: boolean } {
    const { symbol, signal, entry, indicators, capital, winRate, avgWin, avgLoss } = params;

    // Stop baseado em ATR (2x ATR)
    const stopDistance = indicators.atr14 * 2;
    const stop = signal === 'BUY' ? entry - stopDistance : entry + stopDistance;

    // Target com R:R 1:2
    const targetDistance = stopDistance * 2;
    const target = signal === 'BUY' ? entry + targetDistance : entry - targetDistance;

    // Kelly Criterion
    const positionSize = riskEngine.positionSizer.calculate({
      capital,
      winRate,
      avgWin,
      avgLoss,
      entryPrice: entry,
      stopPrice: stop
    });

    // Drawdown check
    const ddMultiplier = riskEngine.drawdownGuard.getRiskMultiplier();

    return {
      stop,
      target,
      quantity: Math.floor(positionSize.quantity * ddMultiplier),
      approved: positionSize.quantity > 0 && !riskEngine.drawdownGuard.isBlocked()
    };
  }

  // ==================== ETAPA 5: Order Execution ====================

  /**
   * Executa ordem e notifica
   * <40ms
   */
  async executeSignal(params: {
    symbol: string;
    signal: 'BUY' | 'SELL';
    entry: number;
    stop: number;
    target: number;
    quantity: number;
    confidence: number;
    strategy: string;
    broker: 'genial' | 'pepperstone';
  }): Promise<TradeSignal> {
    const startTime = Date.now();

    // TODO: Enviar ordem via broker executor
    // Por ora, apenas registra

    const latencyMs = Date.now() - startTime;

    const tradeSignal: TradeSignal = {
      symbol: params.symbol,
      side: params.signal,
      entry: params.entry,
      stop: params.stop,
      target: params.target,
      quantity: params.quantity,
      confidence: params.confidence,
      strategy: params.strategy,
      latencyMs,
      timestamp: Date.now()
    };

    // Notifica Telegram (async, não bloqueia)
    this.notifySignal(tradeSignal).catch(() => {});

    return tradeSignal;
  }

  private async notifySignal(signal: TradeSignal): Promise<void> {
    const emoji = signal.side === 'BUY' ? '🟢' : '🔴';
    await telegramNotifier.sendMessage(
      `${emoji} <b>SINAL ${signal.side}</b>\n\n` +
      `📊 ${signal.symbol}\n` +
      `💰 Entrada: ${signal.entry.toFixed(2)}\n` +
      `🛡️ Stop: ${signal.stop.toFixed(2)}\n` +
      `🎯 Target: ${signal.target.toFixed(2)}\n` +
      `📦 Qtd: ${signal.quantity}\n` +
      `📈 Confiança: ${(signal.confidence * 100).toFixed(0)}%\n` +
      `⚡ Latência: ${signal.latencyMs}ms\n\n` +
      `⚡ VEXOR FAST`
    );
  }

  // ==================== HELPERS ====================

  private calculateEMA(prices: number[], period: number): number {
    if (prices.length < period) return prices[prices.length - 1] || 0;

    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;

    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }

    return ema;
  }

  private calculateRSI(prices: number[], period: number): number {
    if (prices.length < period + 1) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = prices.length - period; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) gains += change;
      else losses -= change;
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  private calculateBollingerBands(prices: number[], period: number, stdDev: number): { upper: number; middle: number; lower: number } {
    const slice = prices.slice(-period);
    const middle = slice.reduce((a, b) => a + b, 0) / period;

    const variance = slice.reduce((sum, p) => sum + Math.pow(p - middle, 2), 0) / period;
    const std = Math.sqrt(variance);

    return {
      upper: middle + stdDev * std,
      middle,
      lower: middle - stdDev * std
    };
  }

  private calculateATR(prices: number[], period: number): number {
    // Simplificado - usa variação percentual média
    if (prices.length < period) return prices[prices.length - 1] * 0.02;

    let totalRange = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
      totalRange += Math.abs(prices[i] - prices[i - 1]);
    }

    return totalRange / period;
  }

  // ==================== FULL PIPELINE ====================

  /**
   * Pipeline completo FAST
   * Total <50ms
   */
  async runPipeline(params: {
    tick: Tick;
    capital: number;
    winRate: number;
    avgWin: number;
    avgLoss: number;
    broker: 'genial' | 'pepperstone';
  }): Promise<TradeSignal | null> {
    const totalStart = Date.now();

    // 1. Process tick (<1ms)
    this.processTick(params.tick);

    // 2. Calculate indicators (<5ms)
    const indicators = this.calculateIndicators(params.tick.symbol);
    if (!indicators) return null;

    // 3. Evaluate rules (<2ms)
    const ruleResult = this.evaluateRules(params.tick.symbol, indicators);
    if (ruleResult.signal === 'HOLD') return null;

    // 4. Check risk (<2ms)
    const riskResult = this.checkRisk({
      symbol: params.tick.symbol,
      signal: ruleResult.signal,
      entry: params.tick.price,
      indicators,
      capital: params.capital,
      winRate: params.winRate,
      avgWin: params.avgWin,
      avgLoss: params.avgLoss
    });

    if (!riskResult.approved) return null;

    // 5. Execute (<40ms)
    const signal = await this.executeSignal({
      symbol: params.tick.symbol,
      signal: ruleResult.signal,
      entry: params.tick.price,
      stop: riskResult.stop,
      target: riskResult.target,
      quantity: riskResult.quantity,
      confidence: ruleResult.confidence,
      strategy: ruleResult.strategy,
      broker: params.broker
    });

    signal.latencyMs = Date.now() - totalStart;
    return signal;
  }

  getIndicators(symbol: string): IndicatorSet | undefined {
    return this.indicatorCache.get(symbol);
  }
}

// Singleton
export const fastPipeline = new FastPipeline();
export type { Tick, IndicatorSet, TradeSignal, FastRuleResult };
