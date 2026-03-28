/**
 * CAMADA 5: IA CORE
 * Market Analyzer, NEXUS-CORE, Prediction Engine, Learning Engine, Strategy Factory
 */

// ==================== MARKET ANALYZER ====================
export class MarketAnalyzer {
  /**
   * Detecta regime de mercado
   */
  detectRegime(prices: number[]): 'TREND_UP' | 'TREND_DOWN' | 'RANGING' | 'VOLATILE' {
    if (prices.length < 20) return 'RANGING';

    const recent = prices.slice(-20);
    const older = prices.slice(-40, -20);

    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.length > 0 ? older.reduce((a, b) => a + b, 0) / older.length : recentAvg;

    const trend = (recentAvg - olderAvg) / olderAvg;
    const volatility = this.calculateVolatility(recent);

    if (volatility > 0.03) return 'VOLATILE';
    if (trend > 0.02) return 'TREND_UP';
    if (trend < -0.02) return 'TREND_DOWN';
    return 'RANGING';
  }

  private calculateVolatility(prices: number[]): number {
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
    return Math.sqrt(variance) / mean;
  }

  /**
   * Análise de Price Action (Al Brooks)
   */
  analyzePriceAction(candles: Array<{ open: number; high: number; low: number; close: number }>): {
    signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    strength: number;
    pattern: string;
  } {
    if (candles.length < 3) return { signal: 'NEUTRAL', strength: 0, pattern: 'INSUFFICIENT_DATA' };

    const last3 = candles.slice(-3);
    const [c1, c2, c3] = last3;

    // Doji
    if (Math.abs(c3.close - c3.open) < (c3.high - c3.low) * 0.1) {
      return { signal: 'NEUTRAL', strength: 50, pattern: 'DOJI' };
    }

    // Bullish Engulfing
    if (c2.close < c2.open && c3.close > c3.open && c3.close > c2.open && c3.open < c2.close) {
      return { signal: 'BULLISH', strength: 80, pattern: 'BULLISH_ENGULFING' };
    }

    // Bearish Engulfing
    if (c2.close > c2.open && c3.close < c3.open && c3.close < c2.open && c3.open > c2.close) {
      return { signal: 'BEARISH', strength: 80, pattern: 'BEARISH_ENGULFING' };
    }

    // Hammer
    if (c3.close > c3.open && (c3.open - c3.low) > 2 * (c3.close - c3.open)) {
      return { signal: 'BULLISH', strength: 70, pattern: 'HAMMER' };
    }

    // Shooting Star
    if (c3.close < c3.open && (c3.high - c3.open) > 2 * (c3.open - c3.close)) {
      return { signal: 'BEARISH', strength: 70, pattern: 'SHOOTING_STAR' };
    }

    // Three White Soldiers
    if (last3.every(c => c.close > c.open) && c3.close > c2.close && c2.close > c1.close) {
      return { signal: 'BULLISH', strength: 90, pattern: 'THREE_WHITE_SOLDIERS' };
    }

    // Three Black Crows
    if (last3.every(c => c.close < c.open) && c3.close < c2.close && c2.close < c1.close) {
      return { signal: 'BEARISH', strength: 90, pattern: 'THREE_BLACK_CROWS' };
    }

    return { signal: 'NEUTRAL', strength: 30, pattern: 'NO_PATTERN' };
  }

  /**
   * Wyckoff Analysis
   */
  analyzeWyckoff(prices: number[], volumes: number[]): {
    phase: 'ACCUMULATION' | 'MARKUP' | 'DISTRIBUTION' | 'MARKDOWN';
    event: string;
  } {
    const priceTrend = prices[prices.length - 1] > prices[0] ? 'UP' : 'DOWN';
    const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    const recentVolume = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const volumeSpike = recentVolume > avgVolume * 1.5;

    if (priceTrend === 'UP' && volumeSpike) {
      return { phase: 'MARKUP', event: 'SOC' }; // Spring or Sign of Strength
    }
    if (priceTrend === 'DOWN' && volumeSpike) {
      return { phase: 'ACCUMULATION', event: 'PS' }; // Preliminary Support
    }
    if (priceTrend === 'UP' && !volumeSpike) {
      return { phase: 'DISTRIBUTION', event: 'UTAD' }; // Upthrust
    }
    return { phase: 'MARKDOWN', event: 'SOW' }; // Sign of Weakness
  }
}

// ==================== NEXUS-CORE (Situational Awareness) ====================
export class NexusCore {
  private marketAnalyzer = new MarketAnalyzer();
  private agentSignals: Map<string, { action: 'BUY' | 'SELL' | 'HOLD'; confidence: number; reason: string }> = new Map();

  /**
   * Registra sinal de um agente
   */
  registerAgentSignal(agentName: string, signal: { action: 'BUY' | 'SELL' | 'HOLD'; confidence: number; reason: string }): void {
    this.agentSignals.set(agentName, signal);
  }

  /**
   * Calcula consenso entre agentes
   * Mínimo 3/5 agentes devem concordar
   */
  calculateConsensus(): {
    approved: boolean;
    action: 'BUY' | 'SELL' | 'HOLD';
    confidence: number;
    agreeingAgents: string[];
    disagreeingAgents: string[];
  } {
    const signals = Array.from(this.agentSignals.entries());
    
    const buySignals = signals.filter(([_, s]) => s.action === 'BUY');
    const sellSignals = signals.filter(([_, s]) => s.action === 'SELL');
    const holdSignals = signals.filter(([_, s]) => s.action === 'HOLD');

    // Precisa de pelo menos 3 agentes concordando
    if (buySignals.length >= 3) {
      const avgConfidence = buySignals.reduce((sum, [_, s]) => sum + s.confidence, 0) / buySignals.length;
      return {
        approved: true,
        action: 'BUY',
        confidence: avgConfidence,
        agreeingAgents: buySignals.map(([name]) => name),
        disagreeingAgents: signals.filter(([name]) => !buySignals.some(([n]) => n === name)).map(([name]) => name)
      };
    }

    if (sellSignals.length >= 3) {
      const avgConfidence = sellSignals.reduce((sum, [_, s]) => sum + s.confidence, 0) / sellSignals.length;
      return {
        approved: true,
        action: 'SELL',
        confidence: avgConfidence,
        agreeingAgents: sellSignals.map(([name]) => name),
        disagreeingAgents: signals.filter(([name]) => !sellSignals.some(([n]) => n === name)).map(([name]) => name)
      };
    }

    return {
      approved: false,
      action: 'HOLD',
      confidence: 0,
      agreeingAgents: holdSignals.map(([name]) => name),
      disagreeingAgents: []
    };
  }

  /**
   * Valida correlações intermarket (John Murphy)
   */
  validateIntermarketCorrelations(data: {
    stocks: number;
    bonds: number;
    commodities: number;
    dollar: number;
    crypto: number;
  }): { valid: boolean; warnings: string[] } {
    const warnings: string[] = [];

    // Dollar forte = commodities fracas
    if (data.dollar > 0.5 && data.commodities > 0) {
      warnings.push('⚠️ Dólar forte mas commodities subindo - correlação negativa esperada');
    }

    // Stocks e bonds inversamente correlacionados
    if (data.stocks > 0.5 && data.bonds > 0.5) {
      warnings.push('⚠️ Stocks e bonds subindo juntos - risco de flight to quality');
    }

    // Crypto como leading indicator
    if (data.crypto < -0.5 && data.stocks > 0) {
      warnings.push('⚠️ Crypto caindo enquanto stocks sobem - possível sinal de aviso');
    }

    return {
      valid: warnings.length === 0,
      warnings
    };
  }

  /**
   * Limpa sinais (chamado a cada novo ciclo)
   */
  clearSignals(): void {
    this.agentSignals.clear();
  }
}

// ==================== PREDICTION ENGINE ====================
export class PredictionEngine {
  /**
   * Predição simples baseada em tendência
   */
  predict(prices: number[], horizon: number = 5): {
    direction: 'UP' | 'DOWN' | 'FLAT';
    probability: number;
    targetPrice: number;
  } {
    if (prices.length < 10) {
      return { direction: 'FLAT', probability: 50, targetPrice: prices[prices.length - 1] };
    }

    const trend = prices[prices.length - 1] - prices[0];
    const trendPerPeriod = trend / prices.length;
    const targetPrice = prices[prices.length - 1] + trendPerPeriod * horizon;

    const volatility = Math.sqrt(
      prices.reduce((sum, p, i) => {
        if (i === 0) return 0;
        return sum + Math.pow(p - prices[i - 1], 2);
      }, 0) / prices.length
    );

    const probability = Math.min(90, Math.max(10, 50 + (Math.abs(trend) / volatility) * 20));

    return {
      direction: targetPrice > prices[prices.length - 1] ? 'UP' : targetPrice < prices[prices.length - 1] ? 'DOWN' : 'FLAT',
      probability,
      targetPrice
    };
  }
}

// ==================== LEARNING ENGINE ====================
export class LearningEngine {
  private performanceHistory: Array<{
    strategy: string;
    symbol: string;
    outcome: 'WIN' | 'LOSS';
    pnl: number;
    confidence: number;
  }> = [];

  /**
   * Registra resultado para aprendizado
   */
  recordOutcome(data: typeof this.performanceHistory[0]): void {
    this.performanceHistory.push(data);
  }

  /**
   * Calcula taxa de acerto por estratégia
   */
  getStrategyPerformance(): Map<string, { wins: number; losses: number; winRate: number; avgPnl: number }> {
    const stats = new Map<string, { wins: number; losses: number; totalPnl: number }>();

    for (const record of this.performanceHistory) {
      const current = stats.get(record.strategy) || { wins: 0, losses: 0, totalPnl: 0 };
      if (record.outcome === 'WIN') current.wins++;
      else current.losses++;
      current.totalPnl += record.pnl;
      stats.set(record.strategy, current);
    }

    const result = new Map<string, { wins: number; losses: number; winRate: number; avgPnl: number }>();
    for (const [strategy, data] of stats) {
      const total = data.wins + data.losses;
      result.set(strategy, {
        wins: data.wins,
        losses: data.losses,
        winRate: total > 0 ? data.wins / total : 0,
        avgPnl: total > 0 ? data.totalPnl / total : 0
      });
    }

    return result;
  }

  /**
   * Ajusta confiança baseado em performance histórica
   */
  adjustConfidence(strategy: string, baseConfidence: number): number {
    const stats = this.getStrategyPerformance().get(strategy);
    if (!stats) return baseConfidence;

    // Aumenta confiança se win rate > 60%, diminui se < 40%
    if (stats.winRate > 0.6) {
      return Math.min(100, baseConfidence + 10);
    }
    if (stats.winRate < 0.4) {
      return Math.max(10, baseConfidence - 15);
    }
    return baseConfidence;
  }
}

// ==================== STRATEGY FACTORY ====================
export class StrategyFactory {
  /**
   * Gera estratégia baseada em condições de mercado
   */
  generateStrategy(marketData: {
    regime: string;
    volatility: number;
    trend: number;
    volume: number;
  }): {
    name: string;
    description: string;
    positionSize: number;
    stopLoss: number;
    takeProfit: number;
    timeframe: string;
  } {
    if (marketData.regime === 'TREND_UP') {
      return {
        name: 'MOMENTUM_TREND',
        description: 'Seguir tendência de alta com trailing stop',
        positionSize: 40,
        stopLoss: marketData.volatility * 2,
        takeProfit: marketData.volatility * 4,
        timeframe: '1H'
      };
    }

    if (marketData.regime === 'TREND_DOWN') {
      return {
        name: 'SHORT_TREND',
        description: 'Vender em tendência de baixa',
        positionSize: 30,
        stopLoss: marketData.volatility * 2,
        takeProfit: marketData.volatility * 3,
        timeframe: '1H'
      };
    }

    if (marketData.regime === 'RANGING') {
      return {
        name: 'MEAN_REVERSION',
        description: 'Comprar na mínima, vender na máxima do range',
        positionSize: 25,
        stopLoss: marketData.volatility * 1.5,
        takeProfit: marketData.volatility * 2,
        timeframe: '15M'
      };
    }

    // VOLATILE
    return {
      name: 'SCALP_VOLATILE',
      description: 'Operações rápidas em mercado volátil',
      positionSize: 15,
      stopLoss: marketData.volatility * 1,
      takeProfit: marketData.volatility * 1.5,
      timeframe: '5M'
    };
  }
}

// Export singletons
export const marketAnalyzer = new MarketAnalyzer();
export const nexusCore = new NexusCore();
export const predictionEngine = new PredictionEngine();
export const learningEngine = new LearningEngine();
export const strategyFactory = new StrategyFactory();
