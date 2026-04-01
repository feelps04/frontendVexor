/**
 * VEXOR Risk Engine - 5 Camadas de Proteção de Capital
 * Position Sizer, Drawdown Guard, VaR Engine, Compliance Engine, Stop Manager
 */

import { oracleDB } from '../oracle-db.js';
import { telegramNotifier } from '../telegram-notifier.js';

// ==================== POSITION SIZER (Kelly Criterion) ====================

interface PositionSizeParams {
  capital: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  entryPrice: number;
  stopPrice: number;
  maxLeverage?: number;
}

class PositionSizer {
  private readonly MAX_RISK_PER_TRADE = 0.02; // 2% max
  private readonly MAX_LEVERAGE = 10;
  private readonly VOL_TARGET = 0.15; // 15% vol target

  /**
   * Kelly Criterion: f = (p*b - q) / b
   * p = win probability, q = loss probability, b = win/loss ratio
   */
  calculateKellyFraction(winRate: number, avgWin: number, avgLoss: number): number {
    const p = winRate;
    const q = 1 - winRate;
    const b = avgWin / avgLoss;

    // Kelly fraction
    let kelly = (p * b - q) / b;

    // Use half-Kelly for safety
    kelly = kelly * 0.5;

    // Cap at max risk
    return Math.min(kelly, this.MAX_RISK_PER_TRADE);
  }

  /**
   * Calculate position size
   */
  calculate(params: PositionSizeParams): {
    quantity: number;
    riskAmount: number;
    riskPercent: number;
    kellyFraction: number;
    leverage: number;
    warning?: string;
  } {
    const { capital, winRate, avgWin, avgLoss, entryPrice, stopPrice } = params;

    // Kelly fraction
    const kellyFraction = this.calculateKellyFraction(winRate, avgWin, avgLoss);

    // Risk amount
    const riskAmount = capital * kellyFraction;

    // Risk per share
    const riskPerShare = Math.abs(entryPrice - stopPrice);

    // Quantity
    let quantity = Math.floor(riskAmount / riskPerShare);

    // Max leverage check
    const maxLeverage = params.maxLeverage || this.MAX_LEVERAGE;
    const maxQuantity = Math.floor((capital * maxLeverage) / entryPrice);

    let warning: string | undefined;
    if (quantity > maxQuantity) {
      quantity = maxQuantity;
      warning = 'Quantidade limitada por alavancagem máxima';
    }

    // Calculate actual risk
    const actualRisk = quantity * riskPerShare;
    const riskPercent = actualRisk / capital;
    const leverage = (quantity * entryPrice) / capital;

    return {
      quantity,
      riskAmount: actualRisk,
      riskPercent,
      kellyFraction,
      leverage,
      warning
    };
  }

  /**
   * Vol targeting - adjust position based on volatility
   */
  adjustForVolatility(baseQuantity: number, currentVol: number, targetVol?: number): number {
    const target = targetVol || this.VOL_TARGET;

    // If vol is higher than target, reduce position
    if (currentVol > target) {
      return Math.floor(baseQuantity * (target / currentVol));
    }

    // If vol is lower, can increase slightly
    return Math.floor(baseQuantity * Math.min(1.5, target / currentVol));
  }
}

// ==================== DRAWDOWN GUARD ====================

interface DrawdownState {
  currentDrawdown: number;
  peakCapital: number;
  currentCapital: number;
  riskMultiplier: number;
  action: 'NORMAL' | 'REDUCE_RISK' | 'CLOSE_ALL' | 'BLOCKED';
}

class DrawdownGuard {
  private state: DrawdownState = {
    currentDrawdown: 0,
    peakCapital: 0,
    currentCapital: 0,
    riskMultiplier: 1,
    action: 'NORMAL'
  };

  private readonly DD_REDUCE_THRESHOLD = 0.15; // 15%
  private readonly DD_CLOSE_THRESHOLD = 0.20; // 20%
  private readonly DD_BLOCK_THRESHOLD = 0.25; // 25%

  /**
   * Update drawdown state
   */
  async update(currentCapital: number): Promise<DrawdownState> {
    // Update peak
    if (currentCapital > this.state.peakCapital) {
      this.state.peakCapital = currentCapital;
    }

    this.state.currentCapital = currentCapital;

    // Calculate drawdown
    this.state.currentDrawdown = 
      (this.state.peakCapital - currentCapital) / this.state.peakCapital;

    // Determine action
    if (this.state.currentDrawdown >= this.DD_BLOCK_THRESHOLD) {
      this.state.action = 'BLOCKED';
      this.state.riskMultiplier = 0;
      await this.alertCritical('BLOQUEADO');
    } else if (this.state.currentDrawdown >= this.DD_CLOSE_THRESHOLD) {
      this.state.action = 'CLOSE_ALL';
      this.state.riskMultiplier = 0;
      await this.alertCritical('FECHAR TUDO');
    } else if (this.state.currentDrawdown >= this.DD_REDUCE_THRESHOLD) {
      this.state.action = 'REDUCE_RISK';
      this.state.riskMultiplier = 0.5;
      await this.alertWarning();
    } else {
      this.state.action = 'NORMAL';
      this.state.riskMultiplier = 1;
    }

    // Save to DB
    await this.saveState();

    return this.state;
  }

  private async alertCritical(action: string): Promise<void> {
    await telegramNotifier.sendMessage(
      `🚨 <b>DRAWDOWN CRÍTICO</b>\n\n` +
      `📊 DD: ${(this.state.currentDrawdown * 100).toFixed(1)}%\n` +
      `💰 Pico: R$ ${this.state.peakCapital.toFixed(2)}\n` +
      `📉 Atual: R$ ${this.state.currentCapital.toFixed(2)}\n\n` +
      `⚠️ AÇÃO: ${action}\n\n` +
      `⚡ VEXOR`
    );
  }

  private async alertWarning(): Promise<void> {
    await telegramNotifier.sendMessage(
      `⚠️ <b>DRAWDOWN ALERTA</b>\n\n` +
      `📊 DD: ${(this.state.currentDrawdown * 100).toFixed(1)}%\n` +
      `🔧 Risco reduzido para 50%\n\n` +
      `⚡ VEXOR`
    );
  }

  private async saveState(): Promise<void> {
    try {
      await oracleDB.insert(`
        INSERT INTO risk_state (id, drawdown, updated_at)
        VALUES (:id, :dd, CURRENT_TIMESTAMP)
      `, { id: oracleDB.generateId(), dd: this.state.currentDrawdown });
    } catch {}
  }

  getState(): DrawdownState {
    return this.state;
  }

  getRiskMultiplier(): number {
    return this.state.riskMultiplier;
  }

  isBlocked(): boolean {
    return this.state.action === 'BLOCKED';
  }
}

// ==================== VaR ENGINE ====================

interface VaRResult {
  var99: number;
  cvar99: number;
  portfolioValue: number;
  positions: Array<{
    symbol: string;
    quantity: number;
    value: number;
    var: number;
    weight: number;
  }>;
}

class VaREngine {
  private readonly CONFIDENCE = 0.99;
  private historicalReturns: number[] = [];

  /**
   * Calculate VaR at 99% confidence
   */
  calculateVaR(positions: Array<{ symbol: string; quantity: number; price: number; volatility: number }>): VaRResult {
    // Portfolio value
    const portfolioValue = positions.reduce((sum, p) => sum + p.quantity * p.price, 0);

    // Individual position VaR
    const positionVars = positions.map(p => {
      const value = p.quantity * p.price;
      const weight = value / portfolioValue;

      // VaR = Value * Volatility * Z-score (2.33 for 99%)
      const var99 = value * p.volatility * 2.33;

      return {
        symbol: p.symbol,
        quantity: p.quantity,
        value,
        var: var99,
        weight
      };
    });

    // Portfolio VaR (simplified - assumes some correlation)
    const portfolioVar = positionVars.reduce((sum, p) => sum + p.var * p.weight, 0);

    // CVaR (Expected Shortfall) - average of losses beyond VaR
    // Approximation: CVaR ≈ VaR * 1.15 for normal distribution
    const cvar99 = portfolioVar * 1.15;

    return {
      var99: portfolioVar,
      cvar99,
      portfolioValue,
      positions: positionVars
    };
  }

  /**
   * Update historical returns for more accurate VaR
   */
  addReturn(r: number): void {
    this.historicalReturns.push(r);
    if (this.historicalReturns.length > 252) {
      this.historicalReturns.shift();
    }
  }

  /**
   * Historical VaR (more accurate)
   */
  calculateHistoricalVaR(portfolioValue: number): number {
    if (this.historicalReturns.length < 30) {
      return 0; // Not enough data
    }

    const sorted = [...this.historicalReturns].sort((a, b) => a - b);
    const index = Math.floor((1 - this.CONFIDENCE) * sorted.length);

    return Math.abs(sorted[index] * portfolioValue);
  }
}

// ==================== COMPLIANCE ENGINE ====================

interface ComplianceCheck {
  passed: boolean;
  violations: string[];
  warnings: string[];
  b3Limits: {
    maxPositionValue: number;
    currentExposure: number;
    withinLimit: boolean;
  };
  timeRestrictions: {
    canTrade: boolean;
    reason?: string;
    minutesToClose?: number;
  };
}

class ComplianceEngine {
  private readonly B3_CLOSE_TIME = '23:45';
  private readonly MAX_POSITION_PERCENT = 0.20; // 20% of capital per position
  private readonly CVM_MAX_LEVERAGE = 10;

  /**
   * Check compliance before order
   */
  async checkOrder(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    price: number;
    capital: number;
    currentExposure: number;
    hasStop: boolean;
  }): Promise<ComplianceCheck> {
    const violations: string[] = [];
    const warnings: string[] = [];

    // 1. Stop obrigatório
    if (!params.hasStop) {
      violations.push('Stop Loss obrigatório não definido');
    }

    // 2. Limite de posição
    const positionValue = params.quantity * params.price;
    const positionPercent = positionValue / params.capital;
    const withinPositionLimit = positionPercent <= this.MAX_POSITION_PERCENT;

    if (!withinPositionLimit) {
      violations.push(`Posição excede ${(this.MAX_POSITION_PERCENT * 100)}% do capital`);
    }

    // 3. Horário de fechamento B3
    const now = new Date();
    const closeTime = this.parseTime(this.B3_CLOSE_TIME);
    const minutesToClose = this.minutesUntil(now, closeTime);

    const timeRestrictions = {
      canTrade: true,
      reason: undefined as string | undefined,
      minutesToClose
    };

    // Warning 30 min before close
    if (minutesToClose < 30 && minutesToClose > 0) {
      warnings.push(`Fechamento B3 em ${minutesToClose} minutos`);
    }

    // Block new positions 15 min before close
    if (minutesToClose < 15) {
      timeRestrictions.canTrade = false;
      timeRestrictions.reason = 'Mercado fechando - não abrir novas posições';
      violations.push('Proibido abrir posição 15min antes do fechamento');
    }

    // 4. Alavancagem máxima CVM
    const newExposure = params.currentExposure + positionValue;
    const leverage = newExposure / params.capital;

    if (leverage > this.CVM_MAX_LEVERAGE) {
      violations.push(`Alavancagem ${leverage.toFixed(1)}x excede máximo CVM (${this.CVM_MAX_LEVERAGE}x)`);
    }

    // 5. Audit trail
    await this.logOrder(params, violations);

    return {
      passed: violations.length === 0,
      violations,
      warnings,
      b3Limits: {
        maxPositionValue: params.capital * this.MAX_POSITION_PERCENT,
        currentExposure: params.currentExposure,
        withinLimit: withinPositionLimit
      },
      timeRestrictions
    };
  }

  private parseTime(time: string): Date {
    const [h, m] = time.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
  }

  private minutesUntil(now: Date, target: Date): number {
    const diff = target.getTime() - now.getTime();
    return Math.floor(diff / 60000);
  }

  private async logOrder(params: any, violations: string[]): Promise<void> {
    try {
      await oracleDB.insert(`
        INSERT INTO compliance_log (id, order_data, violations, timestamp)
        VALUES (:id, :data, :violations, CURRENT_TIMESTAMP)
      `, {
        id: oracleDB.generateId(),
        data: JSON.stringify(params),
        violations: violations.join(';')
      });
    } catch {}
  }
}

// ==================== STOP MANAGER ====================

interface StopConfig {
  initialStop: number;
  trailingStopPercent?: number;
  trailingActivationPercent?: number;
  breakEvenTriggerPercent?: number;
}

interface StopState {
  positionId: string;
  entryPrice: number;
  currentStop: number;
  highestPrice: number;
  trailingActive: boolean;
  breakEvenActive: boolean;
  stopMovedToBreakEven: boolean;
}

class StopManager {
  private stops: Map<string, StopState> = new Map();

  private readonly DEFAULT_TRAILING_PERCENT = 0.015; // 1.5%
  private readonly DEFAULT_TRAILING_ACTIVATION = 0.02; // 2% profit

  /**
   * Initialize stop for position
   */
  initStop(positionId: string, entryPrice: number, config: StopConfig): StopState {
    const state: StopState = {
      positionId,
      entryPrice,
      currentStop: config.initialStop,
      highestPrice: entryPrice,
      trailingActive: false,
      breakEvenActive: false,
      stopMovedToBreakEven: false
    };

    this.stops.set(positionId, state);
    return state;
  }

  /**
   * Update stop based on price movement
   */
  updateStop(positionId: string, currentPrice: number, config?: StopConfig): {
    stop: number;
    moved: boolean;
    reason?: string;
  } {
    const state = this.stops.get(positionId);
    if (!state) {
      return { stop: 0, moved: false };
    }

    // Update highest price
    if (currentPrice > state.highestPrice) {
      state.highestPrice = currentPrice;
    }

    const trailingPercent = config?.trailingStopPercent || this.DEFAULT_TRAILING_PERCENT;
    const activationPercent = config?.trailingActivationPercent || this.DEFAULT_TRAILING_ACTIVATION;

    // Check trailing activation
    const profitPercent = (currentPrice - state.entryPrice) / state.entryPrice;

    if (!state.trailingActive && profitPercent >= activationPercent) {
      state.trailingActive = true;
    }

    // Move stop to break-even
    if (!state.stopMovedToBreakEven && 
        config?.breakEvenTriggerPercent && 
        profitPercent >= config.breakEvenTriggerPercent) {
      state.currentStop = state.entryPrice;
      state.stopMovedToBreakEven = true;
      return {
        stop: state.currentStop,
        moved: true,
        reason: 'Stop movido para break-even'
      };
    }

    // Trailing stop
    if (state.trailingActive) {
      const newStop = currentPrice * (1 - trailingPercent);

      // Stop only moves up, never down
      if (newStop > state.currentStop) {
        state.currentStop = newStop;
        return {
          stop: state.currentStop,
          moved: true,
          reason: `Trailing stop: ${((1 - trailingPercent) * 100).toFixed(1)}%`
        };
      }
    }

    return {
      stop: state.currentStop,
      moved: false
    };
  }

  /**
   * Check if stop hit
   */
  isStopHit(positionId: string, currentPrice: number, side: 'BUY' | 'SELL'): boolean {
    const state = this.stops.get(positionId);
    if (!state) return false;

    if (side === 'BUY') {
      return currentPrice <= state.currentStop;
    } else {
      return currentPrice >= state.currentStop;
    }
  }

  /**
   * Remove stop
   */
  removeStop(positionId: string): void {
    this.stops.delete(positionId);
  }

  getStop(positionId: string): StopState | undefined {
    return this.stops.get(positionId);
  }
}

// ==================== RISK ENGINE (Facade) ====================

class RiskEngine {
  readonly positionSizer = new PositionSizer();
  readonly drawdownGuard = new DrawdownGuard();
  readonly varEngine = new VaREngine();
  readonly complianceEngine = new ComplianceEngine();
  readonly stopManager = new StopManager();

  /**
   * Full risk check before order
   */
  async preOrderCheck(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    price: number;
    stopPrice: number;
    capital: number;
    currentExposure: number;
    winRate: number;
    avgWin: number;
    avgLoss: number;
  }): Promise<{
    approved: boolean;
    positionSize: ReturnType<PositionSizer['calculate']>;
    compliance: ComplianceCheck;
    drawdown: DrawdownState;
    violations: string[];
  }> {
    // 1. Check drawdown
    const drawdown = this.drawdownGuard.getState();

    // 2. Calculate position size with Kelly
    const baseSize = this.positionSizer.calculate({
      capital: params.capital,
      winRate: params.winRate,
      avgWin: params.avgWin,
      avgLoss: params.avgLoss,
      entryPrice: params.price,
      stopPrice: params.stopPrice
    });

    // Apply drawdown multiplier
    const adjustedQuantity = Math.floor(baseSize.quantity * drawdown.riskMultiplier);

    // 3. Compliance check
    const compliance = await this.complianceEngine.checkOrder({
      symbol: params.symbol,
      side: params.side,
      quantity: adjustedQuantity,
      price: params.price,
      capital: params.capital,
      currentExposure: params.currentExposure,
      hasStop: params.stopPrice > 0
    });

    // Collect violations
    const violations: string[] = [
      ...compliance.violations
    ];

    if (this.drawdownGuard.isBlocked()) {
      violations.push('Sistema bloqueado por drawdown excessivo');
    }

    return {
      approved: compliance.passed && !this.drawdownGuard.isBlocked() && violations.length === 0,
      positionSize: { ...baseSize, quantity: adjustedQuantity },
      compliance,
      drawdown,
      violations
    };
  }

  /**
   * Initialize stop for new position
   */
  initPositionStop(positionId: string, entryPrice: number, stopPrice: number, targetPrice: number): void {
    const profitTarget = (targetPrice - entryPrice) / entryPrice;

    this.stopManager.initStop(positionId, entryPrice, {
      initialStop: stopPrice,
      trailingStopPercent: 0.015,
      trailingActivationPercent: profitTarget * 0.5, // Activate at 50% of target
      breakEvenTriggerPercent: profitTarget * 0.3 // Break-even at 30% of target
    });
  }

  /**
   * Update capital for drawdown monitoring
   */
  async updateCapital(currentCapital: number): Promise<DrawdownState> {
    return this.drawdownGuard.update(currentCapital);
  }

  /**
   * Calculate portfolio VaR
   */
  calculatePortfolioRisk(positions: Array<{ symbol: string; quantity: number; price: number; volatility: number }>): VaRResult {
    return this.varEngine.calculateVaR(positions);
  }
}

// Singleton
export const riskEngine = new RiskEngine();
export { PositionSizer, DrawdownGuard, VaREngine, ComplianceEngine, StopManager };
export type { PositionSizeParams, DrawdownState, VaRResult, ComplianceCheck, StopConfig, StopState };
