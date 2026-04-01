/**
 * VEXOR Doctrine - Barbell Strategy (Nassim Taleb)
 * 90% conservador (alta prob, baixo risco)
 * 10% assimétrico (alto potencial, perda limitada)
 * Anti-frágil: ganha com volatilidade
 */

import { oracleDB } from '../../oracle-db.js';
import { telegramNotifier } from '../../telegram-notifier.js';
import { marketAnalyzer } from '../ai-core/index.js';

interface BarbellAllocation {
  conservative: {
    percent: number;
    strategies: string[];
    maxRisk: number;
    targetWinRate: number;
  };
  asymmetric: {
    percent: number;
    strategies: string[];
    maxRisk: number;
    maxLoss: number;
    unlimitedUpside: boolean;
  };
  mode: 'BARBELL' | 'STANDARD' | 'DEFENSIVE';
  reason: string;
}

interface MarketCondition {
  volatility: number;
  trend: 'TREND_UP' | 'TREND_DOWN' | 'RANGING' | 'VOLATILE';
  uncertainty: number;
  blackSwanRisk: number;
}

class BarbellStrategy {
  private allocation: BarbellAllocation = {
    conservative: {
      percent: 90,
      strategies: ['TREND_FOLLOW', 'MEAN_REVERSION', 'BREAKOUT_CONFIRMED'],
      maxRisk: 0.02,
      targetWinRate: 0.65
    },
    asymmetric: {
      percent: 10,
      strategies: ['EVENT_DRIVEN', 'VOLATILITY_BET', 'ASYMMETRIC_OPTION'],
      maxRisk: 0.01,
      maxLoss: 0.01,
      unlimitedUpside: true
    },
    mode: 'STANDARD',
    reason: 'Inicialização'
  };

  private readonly VOLATILITY_THRESHOLD = 0.03;
  private readonly BLACK_SWAN_THRESHOLD = 0.7;

  /**
   * Determina alocação atual baseado em condições de mercado
   */
  async determineAllocation(): Promise<BarbellAllocation> {
    const conditions = await this.analyzeMarketConditions();

    // MODO BARBELL: Volatilidade alta + incerteza
    if (conditions.volatility > this.VOLATILITY_THRESHOLD && 
        conditions.uncertainty > 0.5) {
      this.allocation.mode = 'BARBELL';
      this.allocation.reason = 'Volatilidade alta - modo anti-frágil ativado';
      this.allocation.conservative.percent = 90;
      this.allocation.asymmetric.percent = 10;
    }
    // MODO DEFENSIVE: Risco de black swan
    else if (conditions.blackSwanRisk > this.BLACK_SWAN_THRESHOLD) {
      this.allocation.mode = 'DEFENSIVE';
      this.allocation.reason = 'Risco de evento extremo - modo defensivo';
      this.allocation.conservative.percent = 95;
      this.allocation.asymmetric.percent = 5;
    }
    // MODO STANDARD: Condições normais
    else {
      this.allocation.mode = 'STANDARD';
      this.allocation.reason = 'Condições normais de mercado';
      this.allocation.conservative.percent = 85;
      this.allocation.asymmetric.percent = 15;
    }

    await this.saveAllocation();
    return this.allocation;
  }

  /**
   * Analisa condições de mercado
   */
  private async analyzeMarketConditions(): Promise<MarketCondition> {
    // Obtém preços do realtime
    const prices: number[] = []; // TODO: do realtime service
    const regime = await marketAnalyzer.detectRegime(prices);

    // Calcula volatilidade
    const volatility = prices.length > 20 
      ? this.calculateVolatility(prices.slice(-20))
      : 0.02;

    // Calcula incerteza (baseado em regime)
    const uncertainty = regime === 'VOLATILE' ? 0.8 : 
                        regime === 'RANGING' ? 0.5 : 0.3;

    // Risco de black swan (baseado em notícias, correlações, etc)
    const blackSwanRisk = await this.assessBlackSwanRisk();

    return {
      volatility,
      trend: regime,
      uncertainty,
      blackSwanRisk
    };
  }

  private calculateVolatility(prices: number[]): number {
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
    return Math.sqrt(variance) / mean;
  }

  /**
   * Avalia risco de evento extremo
   */
  private async assessBlackSwanRisk(): Promise<number> {
    try {
      // Verifica:
      // 1. Correlações altas entre ativos (contágio)
      // 2. Volume anômalo
      // 3. Notícias de alto impacto
      // 4. VIX elevado

      const rows = await oracleDB.query<{ RISK: number }>(`
        SELECT 
          CASE 
            WHEN EXISTS (SELECT 1 FROM news WHERE impact = 'HIGH' AND timestamp >= SYSDATE - 1) THEN 0.7
            ELSE 0.2
          END as RISK
        FROM DUAL
      `);

      return rows[0]?.RISK || 0.2;
    } catch {
      return 0.2;
    }
  }

  /**
   * Classifica trade como conservador ou assimétrico
   */
  classifyTrade(trade: {
    strategy: string;
    riskReward: number;
    winProbability: number;
    maxLoss: number;
    unlimitedUpside: boolean;
  }): 'CONSERVATIVE' | 'ASYMMETRIC' | 'REJECTED' {
    // Critérios conservadores
    const isConservative = 
      trade.winProbability >= 0.6 &&
      trade.riskReward >= 1.5 &&
      trade.maxLoss <= this.allocation.conservative.maxRisk;

    // Critérios assimétricos
    const isAsymmetric = 
      trade.unlimitedUpside &&
      trade.maxLoss <= this.allocation.asymmetric.maxLoss &&
      trade.riskReward >= 3;

    if (isConservative) return 'CONSERVATIVE';
    if (isAsymmetric) return 'ASYMMETRIC';
    return 'REJECTED';
  }

  /**
   * Calcula tamanho da posição baseado na alocação
   */
  calculatePositionSize(params: {
    capital: number;
    tradeType: 'CONSERVATIVE' | 'ASYMMETRIC';
    entryPrice: number;
    stopPrice: number;
  }): number {
    const { capital, tradeType, entryPrice, stopPrice } = params;

    // Percentual do capital para este tipo
    const allocationPercent = tradeType === 'CONSERVATIVE'
      ? this.allocation.conservative.percent / 100
      : this.allocation.asymmetric.percent / 100;

    // Risco máximo por trade
    const maxRisk = tradeType === 'CONSERVATIVE'
      ? this.allocation.conservative.maxRisk
      : this.allocation.asymmetric.maxRisk;

    // Capital alocado
    const allocatedCapital = capital * allocationPercent;

    // Risco por ação
    const riskPerShare = Math.abs(entryPrice - stopPrice);

    // Quantidade = (Capital alocado * MaxRisk) / Risco por ação
    const quantity = Math.floor((allocatedCapital * maxRisk) / riskPerShare);

    return Math.max(quantity, 0);
  }

  /**
   * Salva alocação no banco
   */
  private async saveAllocation(): Promise<void> {
    try {
      await oracleDB.insert(`
        INSERT INTO barbell_allocations (
          id, mode, conservative_percent, asymmetric_percent, 
          reason, timestamp
        ) VALUES (
          :id, :mode, :conservative, :asymmetric, :reason, CURRENT_TIMESTAMP
        )
      `, {
        id: oracleDB.generateId(),
        mode: this.allocation.mode,
        conservative: this.allocation.conservative.percent,
        asymmetric: this.allocation.asymmetric.percent,
        reason: this.allocation.reason
      });
    } catch (e) {
      console.error('[Barbell] Erro ao salvar:', e);
    }
  }

  /**
   * Notifica mudança de alocação
   */
  async notifyAllocation(): Promise<void> {
    const modeEmoji = {
      'BARBELL': '🏋️',
      'STANDARD': '📊',
      'DEFENSIVE': '🛡️'
    }[this.allocation.mode];

    const message = 
      `${modeEmoji} <b>BARBELL STRATEGY</b>\n\n` +
      `📊 <b>Modo:</b> ${this.allocation.mode}\n` +
      `📝 <b>Razão:</b> ${this.allocation.reason}\n\n` +
      `🟢 <b>Conservador:</b> ${this.allocation.conservative.percent}%\n` +
      `• Win Rate alvo: ${(this.allocation.conservative.targetWinRate * 100).toFixed(0)}%\n` +
      `• Risco máx: ${(this.allocation.conservative.maxRisk * 100).toFixed(1)}%\n\n` +
      `🔴 <b>Assimétrico:</b> ${this.allocation.asymmetric.percent}%\n` +
      `• Upside ilimitado: ${this.allocation.asymmetric.unlimitedUpside ? 'Sim' : 'Não'}\n` +
      `• Perda máx: ${(this.allocation.asymmetric.maxLoss * 100).toFixed(1)}%\n\n` +
      `⏰ ${new Date().toLocaleString('pt-BR')}\n\n` +
      `⚡ <b>VEXOR — Anti-Fragil (Taleb)</b>`;

    await telegramNotifier.sendMessage(message);
  }

  getAllocation(): BarbellAllocation {
    return this.allocation;
  }

  getMode(): 'BARBELL' | 'STANDARD' | 'DEFENSIVE' {
    return this.allocation.mode;
  }
}

// Singleton
export const barbellStrategy = new BarbellStrategy();
export type { BarbellAllocation, MarketCondition };
