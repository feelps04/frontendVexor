/**
 * CAMADA 6: AGENTES AUTÔNOMOS
 * Trend Agent, Mean-Rev Agent, Macro Agent, Crypto Agent, Psych Agent, Orchestrator
 */

import { marketAnalyzer, nexusCore } from '../ai-core/index.js';
export class TrendAgent {
  name = 'TREND_AGENT';
  description = 'Momentum · Breakout · Price Action (Al Brooks, Wyckoff)';
  markets = ['B3', 'BOVESPA'];

  analyze(data: {
    symbol: string;
    prices: number[];
    volumes: number[];
    candles: Array<{ open: number; high: number; low: number; close: number }>;
  }): { action: 'BUY' | 'SELL' | 'HOLD'; confidence: number; reason: string } {
    const regime = marketAnalyzer.detectRegime(data.prices);
    const priceAction = marketAnalyzer.analyzePriceAction(data.candles);
    const wyckoff = marketAnalyzer.analyzeWyckoff(data.prices, data.volumes);

    // Tendência de alta + Price Action bullish + Wyckoff markup
    if (regime === 'TREND_UP' && priceAction.signal === 'BULLISH' && wyckoff.phase === 'MARKUP') {
      return {
        action: 'BUY',
        confidence: Math.min(95, priceAction.strength + 10),
        reason: `${priceAction.pattern} em tendência de alta, fase Wyckoff: ${wyckoff.phase}`
      };
    }

    // Tendência de baixa + Price Action bearish
    if (regime === 'TREND_DOWN' && priceAction.signal === 'BEARISH') {
      return {
        action: 'SELL',
        confidence: Math.min(90, priceAction.strength),
        reason: `${priceAction.pattern} em tendência de baixa`
      };
    }

    // Breakout de range
    if (regime === 'RANGING' && priceAction.strength > 70) {
      return {
        action: priceAction.signal === 'BULLISH' ? 'BUY' : 'SELL',
        confidence: priceAction.strength,
        reason: `Breakout de range: ${priceAction.pattern}`
      };
    }

    return { action: 'HOLD', confidence: 30, reason: 'Sem setup claro' };
  }
}

// ==================== MEAN-REV AGENT ====================
export class MeanRevAgent {
  name = 'MEAN_REV_AGENT';
  description = 'Stat Arb · Pairs Trading · Bollinger Squeeze';
  markets = ['Multi-Asset'];

  analyze(data: {
    symbol: string;
    prices: number[];
    sma20: number;
    bbUpper: number;
    bbLower: number;
    rsi: number;
  }): { action: 'BUY' | 'SELL' | 'HOLD'; confidence: number; reason: string } {
    const currentPrice = data.prices[data.prices.length - 1];
    const bbMid = (data.bbUpper + data.bbLower) / 2;
    const bbWidth = (data.bbUpper - data.bbLower) / bbMid;

    // Bollinger Squeeze - preparando movimento explosivo
    if (bbWidth < 0.02) {
      return {
        action: 'HOLD',
        confidence: 60,
        reason: 'Bollinger Squeeze detectado - aguardando direção'
      };
    }

    // Preço no lower band + RSI oversold
    if (currentPrice <= data.bbLower * 1.01 && data.rsi < 30) {
      return {
        action: 'BUY',
        confidence: 75,
        reason: 'Reversão à média: preço na banda inferior + RSI oversold'
      };
    }

    // Preço no upper band + RSI overbought
    if (currentPrice >= data.bbUpper * 0.99 && data.rsi > 70) {
      return {
        action: 'SELL',
        confidence: 75,
        reason: 'Reversão à média: preço na banda superior + RSI overbought'
      };
    }

    // Voltando para média
    if (currentPrice < bbMid && currentPrice > data.bbLower && data.rsi > 40 && data.rsi < 60) {
      return {
        action: 'BUY',
        confidence: 55,
        reason: 'Retornando para média (pullback)'
      };
    }

    return { action: 'HOLD', confidence: 20, reason: 'Fora das bandas de reversão' };
  }
}

// ==================== MACRO AGENT ====================
export class MacroAgent {
  name = 'MACRO_AGENT';
  description = 'Intermarket · Sentiment · Rates (John Murphy)';
  markets = ['BCB', 'Índices Globais'];

  analyze(data: {
    selic: number;
    ipca: number;
    sp500: number;
    dax: number;
    nikkei: number;
    dollarIndex: number;
    commodities: number;
  }): { action: 'BUY' | 'SELL' | 'HOLD'; confidence: number; reason: string; block: boolean } {
    const warnings: string[] = [];

    // Juros altos = ruim para ações
    if (data.selic > 13.5) {
      warnings.push('SELIC elevada (>13.5%) - ambiente desfavorável para ações');
    }

    // Inflação alta
    if (data.ipca > 5) {
      warnings.push('IPCA alto (>5%) - pressão inflacionária');
    }

    // S&P500 caindo
    if (data.sp500 < -1) {
      warnings.push('S&P500 em queda - risco de contágio');
    }

    // Dólar forte
    if (data.dollarIndex > 0.5) {
      warnings.push('Dólar forte - pressão em emergentes');
    }

    // Valida correlações intermarket
    const intermarket = nexusCore.validateIntermarketCorrelations({
      stocks: 0,
      bonds: -data.selic / 20,
      commodities: data.commodities,
      dollar: data.dollarIndex,
      crypto: 0
    });

    // Bloqueia se muitas warnings
    if (warnings.length >= 3 || !intermarket.valid) {
      return {
        action: 'HOLD',
        confidence: 90,
        reason: `MACRO BLOQUEANDO: ${warnings.join('; ')}`,
        block: true
      };
    }

    // Ambiente favorável
    if (warnings.length === 0 && data.sp500 > 0.5) {
      return {
        action: 'BUY',
        confidence: 70,
        reason: 'Ambiente macro favorável: juros baixos, inflação controlada, S&P subindo',
        block: false
      };
    }

    return {
      action: 'HOLD',
      confidence: 50,
      reason: 'Ambiente macro neutro',
      block: false
    };
  }
}

// ==================== CRYPTO AGENT ====================
export class CryptoAgent {
  name = 'CRYPTO_AGENT';
  description = 'On-chain · DeFi · 24/7 Binance';
  markets = ['BINANCE'];

  analyze(data: {
    symbol: string;
    prices: number[];
    volume24h: number;
    onChainActive: number;
    defiTvl: number;
    fundingRate: number;
    rsi: number;
    bbWidth: number;
  }): { action: 'BUY' | 'SELL' | 'HOLD'; confidence: number; reason: string } {
    const currentPrice = data.prices[data.prices.length - 1];

    // Bollinger Squeeze noturno (movimentos explosivos)
    if (data.bbWidth < 0.03 && data.volume24h > 1000000000) {
      return {
        action: 'HOLD',
        confidence: 70,
        reason: 'Crypto Bollinger Squeeze com alto volume - movimento explosivo iminente'
      };
    }

    // Funding rate negativo = shorts sendo liquidados
    if (data.fundingRate < -0.01 && currentPrice > data.prices[data.prices.length - 24]) {
      return {
        action: 'BUY',
        confidence: 75,
        reason: 'Funding rate negativo + preço subindo = short squeeze'
      };
    }

    // On-chain activity spike
    if (data.onChainActive > 1.5 && data.rsi < 40) {
      return {
        action: 'BUY',
        confidence: 68,
        reason: 'Atividade on-chain elevada + RSI baixo'
      };
    }

    // DeFi TVL crescendo
    if (data.defiTvl > 0.1 && currentPrice > data.prices[0]) {
      return {
        action: 'BUY',
        confidence: 60,
        reason: 'TVL DeFi crescendo + tendência de alta'
      };
    }

    return { action: 'HOLD', confidence: 25, reason: 'Sem sinais claros on-chain' };
  }
}

// ==================== PSYCH AGENT (Anti-Tilt) ====================
export class PsychAgent {
  name = 'PSYCH_AGENT';
  description = 'Anti-Tilt · Douglas · Kahneman · Tendler';
  markets = ['ALL'];

  private recentTrades: Array<{ pnl: number; timestamp: Date }> = [];
  private tiltLevel = 0; // 0-4 (Tendler levels)

  analyze(data: {
    recentPnl: number[];
    consecutiveLosses: number;
    consecutiveWins: number;
    tradeFrequency: number; // trades per hour
    avgHoldTime: number;
    sessionDuration: number; // minutes
  }): { action: 'BUY' | 'SELL' | 'HOLD'; confidence: number; reason: string; block: boolean } {
    // Nível 1: Leve irritação
    if (data.consecutiveLosses >= 2) {
      this.tiltLevel = 1;
    }

    // Nível 2: Frustração
    if (data.consecutiveLosses >= 3 || data.tradeFrequency > 10) {
      this.tiltLevel = 2;
      return {
        action: 'HOLD',
        confidence: 80,
        reason: 'TILT NÍVEL 2: Frustração detectada - reduzir tamanho de posição',
        block: false
      };
    }

    // Nível 3: Raiva
    if (data.consecutiveLosses >= 4 || data.tradeFrequency > 15) {
      this.tiltLevel = 3;
      return {
        action: 'HOLD',
        confidence: 95,
        reason: 'TILT NÍVEL 3: Raiva detectada - PAUSA de 15 minutos obrigatória',
        block: true
      };
    }

    // Nível 4: Tilt completo
    if (data.consecutiveLosses >= 5 || data.tradeFrequency > 20 || data.sessionDuration > 360) {
      this.tiltLevel = 4;
      return {
        action: 'HOLD',
        confidence: 100,
        reason: 'TILT NÍVEL 4: ENCERRAR sessão imediatamente',
        block: true
      };
    }

    // Overconfidence após wins
    if (data.consecutiveWins >= 4) {
      return {
        action: 'HOLD',
        confidence: 70,
        reason: 'OVERCONFIDENCE: Após 4+ wins, aumente stops e reduza posição',
        block: false
      };
    }

    // Sessão muito longa (fadiga)
    if (data.sessionDuration > 240) {
      return {
        action: 'HOLD',
        confidence: 60,
        reason: 'FADIGA: Sessão >4h - considerar pausa',
        block: false
      };
    }

    return {
      action: 'HOLD',
      confidence: 50,
      reason: 'Estado emocional normal',
      block: false
    };
  }

  getTiltLevel(): number {
    return this.tiltLevel;
  }

  reset(): void {
    this.tiltLevel = 0;
  }
}

// ==================== ORCHESTRATOR (Meta-Agent) ====================
export class Orchestrator {
  name = 'ORCHESTRATOR';
  description = 'Consenso 3/5 · Kelly Criterion · Stop Dinâmico';
  
  private trendAgent = new TrendAgent();
  private meanRevAgent = new MeanRevAgent();
  private macroAgent = new MacroAgent();
  private cryptoAgent = new CryptoAgent();
  private psychAgent = new PsychAgent();

  /**
   * Coordena todos os agentes e decide se opera
   */
  async orchestrate(data: {
    symbol: string;
    sector: number;
    prices: number[];
    volumes: number[];
    candles: Array<{ open: number; high: number; low: number; close: number }>;
    indicators: { sma20: number; bbUpper: number; bbLower: number; rsi: number };
    macro: { selic: number; ipca: number; sp500: number; dax: number; nikkei: number; dollarIndex: number; commodities: number };
    crypto?: { volume24h: number; onChainActive: number; defiTvl: number; fundingRate: number };
    psych: { recentPnl: number[]; consecutiveLosses: number; consecutiveWins: number; tradeFrequency: number; avgHoldTime: number; sessionDuration: number };
  }): Promise<{
    approved: boolean;
    action: 'BUY' | 'SELL' | 'HOLD';
    confidence: number;
    positionSize: number;
    stop: number;
    target: number;
    agents: Array<{ name: string; action: string; confidence: number; reason: string }>;
    warnings: string[];
  }> {
    nexusCore.clearSignals();
    const agents: Array<{ name: string; action: string; confidence: number; reason: string }> = [];
    const warnings: string[] = [];

    // 1. Psych Agent (bloqueia se tilt)
    const psychSignal = this.psychAgent.analyze(data.psych);
    agents.push({ name: 'PSYCH', action: psychSignal.action, confidence: psychSignal.confidence, reason: psychSignal.reason });
    if (psychSignal.block) {
      return {
        approved: false,
        action: 'HOLD',
        confidence: 100,
        positionSize: 0,
        stop: 0,
        target: 0,
        agents,
        warnings: [psychSignal.reason]
      };
    }

    // 2. Macro Agent (bloqueia se ambiente adverso)
    const macroSignal = this.macroAgent.analyze(data.macro);
    agents.push({ name: 'MACRO', action: macroSignal.action, confidence: macroSignal.confidence, reason: macroSignal.reason });
    if (macroSignal.block) {
      return {
        approved: false,
        action: 'HOLD',
        confidence: 90,
        positionSize: 0,
        stop: 0,
        target: 0,
        agents,
        warnings: [macroSignal.reason]
      };
    }

    // 3. Trend Agent
    const trendSignal = this.trendAgent.analyze({
      symbol: data.symbol,
      prices: data.prices,
      volumes: data.volumes,
      candles: data.candles
    });
    agents.push({ name: 'TREND', ...trendSignal });
    nexusCore.registerAgentSignal('TREND', trendSignal);

    // 4. Mean-Rev Agent
    const meanRevSignal = this.meanRevAgent.analyze({
      symbol: data.symbol,
      prices: data.prices,
      ...data.indicators
    });
    agents.push({ name: 'MEAN_REV', ...meanRevSignal });
    nexusCore.registerAgentSignal('MEAN_REV', meanRevSignal);

    // 5. Crypto Agent (se setor 29)
    if (data.sector === 29 && data.crypto) {
      const cryptoSignal = this.cryptoAgent.analyze({
        symbol: data.symbol,
        prices: data.prices,
        ...data.crypto,
        rsi: data.indicators.rsi,
        bbWidth: (data.indicators.bbUpper - data.indicators.bbLower) / data.indicators.sma20
      });
      agents.push({ name: 'CRYPTO', ...cryptoSignal });
      nexusCore.registerAgentSignal('CRYPTO', cryptoSignal);
    }

    // Calcula consenso
    const consensus = nexusCore.calculateConsensus();

    if (!consensus.approved) {
      return {
        approved: false,
        action: 'HOLD',
        confidence: 0,
        positionSize: 0,
        stop: 0,
        target: 0,
        agents,
        warnings: ['Consenso não atingido (mínimo 3/5 agentes)']
      };
    }

    // Calcula posição via Kelly Criterion (máx 2% do capital)
    const kellyFraction = (consensus.confidence / 100) * 0.02;
    const positionSize = Math.min(50, Math.round(kellyFraction * 100)); // % do capital

    // Calcula stop e target
    const currentPrice = data.prices[data.prices.length - 1];
    const atr = this.calculateATR(data.candles);
    const stop = consensus.action === 'BUY' 
      ? currentPrice - atr * 2 
      : currentPrice + atr * 2;
    const target = consensus.action === 'BUY'
      ? currentPrice + atr * 4
      : currentPrice - atr * 4;

    return {
      approved: true,
      action: consensus.action,
      confidence: consensus.confidence,
      positionSize,
      stop: Math.round(stop * 100) / 100,
      target: Math.round(target * 100) / 100,
      agents,
      warnings
    };
  }

  private calculateATR(candles: Array<{ high: number; low: number; close: number }>, period: number = 14): number {
    if (candles.length < period) return 0;
    
    let atrSum = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1]?.close || candles[i].close;
      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      atrSum += tr;
    }
    return atrSum / period;
  }
}

// Export singletons
export const trendAgent = new TrendAgent();
export const meanRevAgent = new MeanRevAgent();
export const macroAgent = new MacroAgent();
export const cryptoAgent = new CryptoAgent();
export const psychAgent = new PsychAgent();
export const orchestrator = new Orchestrator();
