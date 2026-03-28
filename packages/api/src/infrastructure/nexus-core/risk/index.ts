/**
 * CAMADA 7: RISCO
 * Position Sizer, Drawdown Guard, VaR Engine, Compliance, Stop Manager
 */

// ==================== POSITION SIZER (Kelly Criterion) ====================
export class PositionSizer {
  private maxLeverage = 10; // Max 10x
  private maxPositionPct = 50; // Max 50% do capital

  /**
   * Calcula tamanho da posição via Kelly Criterion
   */
  calculate(data: {
    capital: number;
    winRate: number;
    avgWin: number;
    avgLoss: number;
    confidence: number;
    volatility: number;
  }): {
    sizePct: number;
    sizeValue: number;
    kellyFraction: number;
    leverage: number;
  } {
    // Kelly = W - (1-W) / R
    // W = win rate, R = avgWin / avgLoss
    const R = data.avgLoss > 0 ? data.avgWin / data.avgLoss : 2;
    const kelly = data.winRate - (1 - data.winRate) / R;

    // Kelly ajustado pela confiança
    const adjustedKelly = kelly * (data.confidence / 100);

    // Limita a 50% do capital e aplica max leverage
    const sizePct = Math.min(this.maxPositionPct, Math.max(5, adjustedKelly * 100));
    const leverage = Math.min(this.maxLeverage, sizePct / 10);

    return {
      sizePct,
      sizeValue: data.capital * (sizePct / 100) * leverage,
      kellyFraction: adjustedKelly,
      leverage
    };
  }

  /**
   * Ajusta posição baseado em risco atual
   */
  adjustForRisk(baseSize: number, currentDrawdown: number, dailyPnL: number): number {
    // Reduz 10% para cada 1% de drawdown
    const drawdownFactor = Math.max(0.5, 1 - currentDrawdown * 0.1);

    // Reduz se já perdeu muito hoje
    const dailyFactor = dailyPnL < -1000 ? 0.5 : 1;

    return baseSize * drawdownFactor * dailyFactor;
  }
}

// ==================== DRAWDOWN GUARD ====================
export class DrawdownGuard {
  private maxDrawdown = 0.15; // 15% max drawdown
  private circuitBreakerThreshold = 0.10; // 10% para circuit breaker
  private circuitBreakerActive = false;
  private cooldownUntil: Date | null = null;

  check(portfolioValue: number, peakValue: number): {
    drawdown: number;
    status: 'OK' | 'WARNING' | 'CIRCUIT_BREAKER' | 'STOP_TRADING';
    action: string;
  } {
    const drawdown = (peakValue - portfolioValue) / peakValue;

    if (drawdown >= this.maxDrawdown) {
      this.circuitBreakerActive = true;
      this.cooldownUntil = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h cooldown
      return {
        drawdown,
        status: 'STOP_TRADING',
        action: 'ENCERRAR todas as posições imediatamente. Cooldown 24h.'
      };
    }

    if (drawdown >= this.circuitBreakerThreshold) {
      this.circuitBreakerActive = true;
      this.cooldownUntil = new Date(Date.now() + 60 * 60 * 1000); // 1h cooldown
      return {
        drawdown,
        status: 'CIRCUIT_BREAKER',
        action: 'Circuit breaker ativado. Pausa de 1h. Reduzir posições em 50%.'
      };
    }

    if (drawdown >= 0.05) {
      return {
        drawdown,
        status: 'WARNING',
        action: 'Drawdown > 5%. Monitorar de perto. Reduzir novas entradas.'
      };
    }

    return {
      drawdown,
      status: 'OK',
      action: 'Risco dentro dos limites'
    };
  }

  isCircuitBreakerActive(): boolean {
    if (!this.circuitBreakerActive) return false;
    if (this.cooldownUntil && new Date() >= this.cooldownUntil) {
      this.circuitBreakerActive = false;
      this.cooldownUntil = null;
      return false;
    }
    return true;
  }

  reset(): void {
    this.circuitBreakerActive = false;
    this.cooldownUntil = null;
  }
}

// ==================== VAR ENGINE ====================
export class VaREngine {
  /**
   * Calcula VaR (Value at Risk) paramétrico
   */
  calculateVaR(data: {
    positions: Array<{ symbol: string; size: number; entryPrice: number }>;
    returns: number[];
    confidence: 0.95 | 0.99; // 95% ou 99%
  }): {
    var: number;
    cvar: number;
    maxLoss: number;
  } {
    const sortedReturns = [...data.returns].sort((a, b) => a - b);
    const index = Math.floor(sortedReturns.length * (1 - data.confidence));

    // VaR
    const varReturn = sortedReturns[index];
    const portfolioValue = data.positions.reduce((sum, p) => sum + p.size * p.entryPrice, 0);
    const var_ = Math.abs(varReturn * portfolioValue);

    // CVaR (Expected Shortfall)
    const tailReturns = sortedReturns.slice(0, index);
    const cvarReturn = tailReturns.reduce((a, b) => a + b, 0) / tailReturns.length;
    const cvar = Math.abs(cvarReturn * portfolioValue);

    // Max loss (pior caso histórico)
    const maxLossReturn = sortedReturns[0];
    const maxLoss = Math.abs(maxLossReturn * portfolioValue);

    return { var: var_, cvar, maxLoss };
  }

  /**
   * Stress test
   */
  stressTest(positions: Array<{ symbol: string; size: number; entryPrice: number }>): {
    scenario: string;
    loss: number;
  }[] {
    const portfolioValue = positions.reduce((sum, p) => sum + p.size * p.entryPrice, 0);

    return [
      { scenario: 'Crash 2008 (-40%)', loss: portfolioValue * 0.40 },
      { scenario: 'Flash Crash (-10%)', loss: portfolioValue * 0.10 },
      { scenario: 'Interest Rate Shock (+2%)', loss: portfolioValue * 0.05 },
      { scenario: 'Currency Crisis (USD+20%)', loss: portfolioValue * 0.15 },
      { scenario: 'Liquidity Crisis', loss: portfolioValue * 0.25 },
    ];
  }
}

// ==================== COMPLIANCE (CVM Rules) ====================
export class Compliance {
  private readonly B3_LIMITS = {
    maxSinglePosition: 0.20, // 20% do PL em um ativo
    maxSectorExposure: 0.35, // 35% em um setor
    maxDailyTurnover: 10000000, // R$ 10M/dia
    maxLeverage: 10,
    tradingHours: { start: 10, end: 17, closeAll: 23.75 } // 23:45
  };

  checkPosition(data: {
    symbol: string;
    sector: number;
    positionValue: number;
    portfolioValue: number;
    sectorExposure: number;
  }): { approved: boolean; warnings: string[] } {
    const warnings: string[] = [];

    // Limite por ativo
    if (data.positionValue / data.portfolioValue > this.B3_LIMITS.maxSinglePosition) {
      warnings.push(`Posição em ${data.symbol} excede 20% do PL`);
    }

    // Limite por setor
    if (data.sectorExposure > this.B3_LIMITS.maxSectorExposure) {
      warnings.push(`Exposição ao setor ${data.sector} excede 35%`);
    }

    return {
      approved: warnings.length === 0,
      warnings
    };
  }

  checkTradingHours(): { canTrade: boolean; mustCloseAll: boolean; message: string } {
    const now = new Date();
    const hour = now.getHours() + now.getMinutes() / 60;

    if (hour >= this.B3_LIMITS.tradingHours.closeAll) {
      return {
        canTrade: false,
        mustCloseAll: true,
        message: 'APÓS 23:45 - Encerrar todas as posições (regra B3 liquidação)'
      };
    }

    if (hour < this.B3_LIMITS.tradingHours.start || hour >= this.B3_LIMITS.tradingHours.end) {
      return {
        canTrade: false,
        mustCloseAll: false,
        message: 'Fora do horário de pregão (10:00-17:00)'
      };
    }

    return {
      canTrade: true,
      mustCloseAll: false,
      message: 'Dentro do horário de pregão'
    };
  }

  checkLeverage(leverage: number): { approved: boolean; message: string } {
    if (leverage > this.B3_LIMITS.maxLeverage) {
      return {
        approved: false,
        message: `Alavancagem ${leverage}x excede limite de ${this.B3_LIMITS.maxLeverage}x`
      };
    }
    return { approved: true, message: 'Alavancagem dentro do limite' };
  }
}

// ==================== STOP MANAGER ====================
export class StopManager {
  private readonly MAX_LOSS_PER_TRADE = 2066; // R$ 2.066 max loss

  /**
   * Calcula stop dinâmico
   */
  calculateStop(data: {
    entryPrice: number;
    atr: number;
    volatility: number;
    positionSize: number;
    capital: number;
    action: 'BUY' | 'SELL';
  }): {
    stopPrice: number;
    stopPercent: number;
    stopValue: number;
    trailingActivate: number;
    trailingStep: number;
  } {
    // Stop baseado em ATR (2x ATR)
    const atrStop = data.atr * 2;
    const stopPercent = (atrStop / data.entryPrice) * 100;

    // Stop baseado em risco máximo
    const maxLossPerShare = this.MAX_LOSS_PER_TRADE / data.positionSize;
    const riskStop = data.entryPrice - maxLossPerShare;

    // Usa o mais conservador
    const stopDistance = Math.min(atrStop, maxLossPerShare);
    const stopPrice = data.action === 'BUY'
      ? Math.round((data.entryPrice - stopDistance) * 100) / 100
      : Math.round((data.entryPrice + stopDistance) * 100) / 100;

    // Trailing stop
    const trailingActivate = data.action === 'BUY'
      ? data.entryPrice + stopDistance * 2
      : data.entryPrice - stopDistance * 2;
    const trailingStep = stopDistance * 0.5;

    return {
      stopPrice,
      stopPercent,
      stopValue: stopDistance * data.positionSize,
      trailingActivate: Math.round(trailingActivate * 100) / 100,
      trailingStep: Math.round(trailingStep * 100) / 100
    };
  }

  /**
   * Atualiza trailing stop
   */
  updateTrailingStop(currentStop: number, currentPrice: number, trailingStep: number, action: 'BUY' | 'SELL'): number {
    if (action === 'BUY') {
      const newStop = currentPrice - trailingStep;
      return newStop > currentStop ? Math.round(newStop * 100) / 100 : currentStop;
    } else {
      const newStop = currentPrice + trailingStep;
      return newStop < currentStop ? Math.round(newStop * 100) / 100 : currentStop;
    }
  }

  /**
   * Verifica se stop foi atingido
   */
  isStopHit(stopPrice: number, low: number, high: number, action: 'BUY' | 'SELL'): boolean {
    if (action === 'BUY') {
      return low <= stopPrice;
    } else {
      return high >= stopPrice;
    }
  }
}

// Export singletons
export const positionSizer = new PositionSizer();
export const drawdownGuard = new DrawdownGuard();
export const varEngine = new VaREngine();
export const compliance = new Compliance();
export const stopManager = new StopManager();
