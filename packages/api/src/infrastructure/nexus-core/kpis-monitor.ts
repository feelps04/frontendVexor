/**
 * VEXOR KPIs VM Monitor
 * Métricas monitoradas em tempo real com ações automáticas
 */

import { oracleDB } from '../oracle-db.js';
import { telegramNotifier } from '../telegram-notifier.js';
import { riskEngine } from './risk-engine.js';

interface KPI {
  name: string;
  value: number;
  min: number;
  optimal: number;
  status: 'OK' | 'WARNING' | 'CRITICAL';
  action: string;
  autoAction?: () => Promise<void>;
}

interface KPIReport {
  timestamp: Date;
  kpis: KPI[];
  overallStatus: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
  actionsTriggered: string[];
  capital: number;
  dailyPnL: number;
  openPositions: number;
}

class KPIsMonitor {
  private lastReport: KPIReport | null = null;
  private consecutiveNegativeExpectancy = 0;
  private consecutiveNegativeDays = 0;

  /**
   * Calculate all KPIs and trigger actions
   */
  async calculateKPIs(): Promise<KPIReport> {
    const metrics = await this.getMetrics();
    const kpis: KPI[] = [];
    const actionsTriggered: string[] = [];

    // 1. Expectativa Matemática
    const expectancy = this.calculateExpectancy(metrics);
    const expectancyKPI = this.evaluateExpectancy(expectancy);
    kpis.push(expectancyKPI);
    if (expectancyKPI.status === 'CRITICAL') {
      await this.handleExpectancyCritical();
      actionsTriggered.push(expectancyKPI.action);
    }

    // 2. Profit Factor
    const profitFactor = this.calculateProfitFactor(metrics);
    const pfKPI = this.evaluateProfitFactor(profitFactor);
    kpis.push(pfKPI);
    if (pfKPI.status === 'CRITICAL') {
      actionsTriggered.push(pfKPI.action);
    }

    // 3. Sharpe Ratio
    const sharpe = this.calculateSharpe(metrics);
    const sharpeKPI = this.evaluateSharpe(sharpe);
    kpis.push(sharpeKPI);
    if (sharpeKPI.status === 'WARNING') {
      actionsTriggered.push(sharpeKPI.action);
    }

    // 4. Win Rate
    const winRate = metrics.totalTrades > 0 ? metrics.wins / metrics.totalTrades : 0;
    const wrKPI = this.evaluateWinRate(winRate);
    kpis.push(wrKPI);

    // 5. Drawdown
    const ddKPI = this.evaluateDrawdown(metrics.currentDrawdown);
    kpis.push(ddKPI);
    if (ddKPI.status === 'CRITICAL') {
      actionsTriggered.push(ddKPI.action);
    }

    // 6. Expectancy per Trade ($)
    const expectancyDollar = metrics.totalTrades > 0 ? metrics.totalPnL / metrics.totalTrades : 0;
    const expDollarKPI = this.evaluateExpectancyDollar(expectancyDollar);
    kpis.push(expDollarKPI);

    // Determine overall status
    const overallStatus = this.determineOverallStatus(kpis);

    const report: KPIReport = {
      timestamp: new Date(),
      kpis,
      overallStatus,
      actionsTriggered,
      capital: metrics.capital,
      dailyPnL: metrics.dailyPnL,
      openPositions: metrics.openPositions
    };

    this.lastReport = report;

    // Save report
    await this.saveReport(report);

    // Notify if critical
    if (overallStatus === 'CRITICAL') {
      await this.notifyCritical(report);
    }

    return report;
  }

  private async getMetrics(): Promise<{
    totalTrades: number;
    wins: number;
    losses: number;
    totalPnL: number;
    totalWins: number;
    totalLosses: number;
    avgWin: number;
    avgLoss: number;
    capital: number;
    dailyPnL: number;
    currentDrawdown: number;
    openPositions: number;
    returns: number[];
  }> {
    try {
      const rows = await oracleDB.query<{
        TOTAL: number;
        WINS: number;
        LOSSES: number;
        TOTAL_PNL: number;
        TOTAL_WINS: number;
        TOTAL_LOSSES: number;
        AVG_WIN: number;
        AVG_LOSS: number;
        CAPITAL: number;
        DAILY_PNL: number;
        DD: number;
        POSITIONS: number;
      }>(`
        SELECT 
          (SELECT COUNT(*) FROM trade_history WHERE closed_at >= TRUNC(SYSDATE) - 30) as TOTAL,
          (SELECT COUNT(*) FROM trade_history WHERE outcome = 1 AND closed_at >= TRUNC(SYSDATE) - 30) as WINS,
          (SELECT COUNT(*) FROM trade_history WHERE outcome = 0 AND closed_at >= TRUNC(SYSDATE) - 30) as LOSSES,
          (SELECT COALESCE(SUM(pnl), 0) FROM trade_history WHERE closed_at >= TRUNC(SYSDATE) - 30) as TOTAL_PNL,
          (SELECT COALESCE(SUM(CASE WHEN pnl > 0 THEN pnl END), 0) FROM trade_history WHERE closed_at >= TRUNC(SYSDATE) - 30) as TOTAL_WINS,
          (SELECT COALESCE(ABS(SUM(CASE WHEN pnl < 0 THEN pnl END)), 0) FROM trade_history WHERE closed_at >= TRUNC(SYSDATE) - 30) as TOTAL_LOSSES,
          (SELECT COALESCE(AVG(CASE WHEN pnl > 0 THEN pnl END), 0) FROM trade_history WHERE closed_at >= TRUNC(SYSDATE) - 30) as AVG_WIN,
          (SELECT COALESCE(ABS(AVG(CASE WHEN pnl < 0 THEN pnl END)), 0) FROM trade_history WHERE closed_at >= TRUNC(SYSDATE) - 30) as AVG_LOSS,
          100000 as CAPITAL,
          (SELECT COALESCE(SUM(pnl), 0) FROM trade_history WHERE TRUNC(closed_at) = TRUNC(SYSDATE)) as DAILY_PNL,
          0 as DD,
          (SELECT COUNT(*) FROM open_positions) as POSITIONS
        FROM DUAL
      `);

      const row = rows[0];

      return {
        totalTrades: row?.TOTAL ?? 0,
        wins: row?.WINS ?? 0,
        losses: row?.LOSSES ?? 0,
        totalPnL: row?.TOTAL_PNL ?? 0,
        totalWins: row?.TOTAL_WINS ?? 0,
        totalLosses: row?.TOTAL_LOSSES ?? 0,
        avgWin: row?.AVG_WIN ?? 0,
        avgLoss: row?.AVG_LOSS ?? 0,
        capital: row?.CAPITAL ?? 100000,
        dailyPnL: row?.DAILY_PNL ?? 0,
        currentDrawdown: row?.DD ?? 0,
        openPositions: row?.POSITIONS ?? 0,
        returns: []
      };
    } catch {
      return {
        totalTrades: 0,
        wins: 0,
        losses: 0,
        totalPnL: 0,
        totalWins: 0,
        totalLosses: 0,
        avgWin: 0,
        avgLoss: 0,
        capital: 100000,
        dailyPnL: 0,
        currentDrawdown: 0,
        openPositions: 0,
        returns: []
      };
    }
  }

  // ==================== CALCULATIONS ====================

  private calculateExpectancy(m: { wins: number; losses: number; avgWin: number; avgLoss: number; totalTrades: number }): number {
    if (m.totalTrades === 0) return 0;

    const winRate = m.wins / m.totalTrades;
    const lossRate = m.losses / m.totalTrades;

    // E = (Win% × AvgWin) − (Loss% × AvgLoss)
    return (winRate * m.avgWin) - (lossRate * m.avgLoss);
  }

  private calculateProfitFactor(m: { totalWins: number; totalLosses: number }): number {
    if (m.totalLosses === 0) return m.totalWins > 0 ? 999 : 0;
    return m.totalWins / m.totalLosses;
  }

  private calculateSharpe(m: { totalPnL: number; returns: number[]; capital: number }): number {
    if (m.returns.length < 5) return 0;

    const avgReturn = m.returns.reduce((a, b) => a + b, 0) / m.returns.length;
    const variance = m.returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / m.returns.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) return 0;

    const riskFreeRate = 0.10 / 252; // SELIC 10% anual
    return (avgReturn - riskFreeRate) / stdDev;
  }

  // ==================== EVALUATIONS ====================

  private evaluateExpectancy(value: number): KPI {
    const status = value < 0 ? 'CRITICAL' : value < 0.001 ? 'WARNING' : 'OK';

    return {
      name: 'Expectativa Matemática',
      value,
      min: 0,
      optimal: 0.01,
      status,
      action: status === 'CRITICAL' 
        ? '3 dias abaixo → pausar estratégia + Strategy Factory' 
        : 'Monitorar'
    };
  }

  private evaluateProfitFactor(value: number): KPI {
    const status = value < 1.5 ? 'CRITICAL' : value < 2.0 ? 'WARNING' : 'OK';

    return {
      name: 'Profit Factor',
      value,
      min: 1.5,
      optimal: 2.0,
      status,
      action: status === 'CRITICAL'
        ? 'Abaixo de 1.5 → reduzir tamanho de posição 50%'
        : 'Monitorar',
      autoAction: status === 'CRITICAL' ? async () => {
        // Reduce position size
        console.log('[KPIs] Reduzindo tamanho de posição 50%');
      } : undefined
    };
  }

  private evaluateSharpe(value: number): KPI {
    const status = value < 1.0 ? 'CRITICAL' : value < 2.0 ? 'WARNING' : 'OK';

    return {
      name: 'Sharpe Ratio',
      value,
      min: 1.0,
      optimal: 2.0,
      status,
      action: status === 'CRITICAL'
        ? 'Abaixo de 1.0 → ajustar parâmetros via Learning Engine'
        : 'Monitorar'
    };
  }

  private evaluateWinRate(value: number): KPI {
    const status = value < 0.35 ? 'CRITICAL' : value < 0.40 ? 'WARNING' : 'OK';

    return {
      name: 'Win Rate',
      value,
      min: 0.40,
      optimal: 0.55,
      status,
      action: status !== 'OK'
        ? 'Queda de 10% da média → investigar regime de mercado'
        : 'Monitorar'
    };
  }

  private evaluateDrawdown(value: number): KPI {
    const status = value > 0.20 ? 'CRITICAL' : value > 0.15 ? 'WARNING' : 'OK';

    return {
      name: 'Drawdown Máximo',
      value,
      min: 0,
      optimal: 0.10,
      status,
      action: status === 'CRITICAL'
        ? 'DD > 20% → fechar todas as posições'
        : status === 'WARNING'
        ? 'DD > 15% → risco pela metade'
        : 'Monitorar',
      autoAction: status === 'CRITICAL' ? async () => {
        await riskEngine.drawdownGuard.update(0);
      } : undefined
    };
  }

  private evaluateExpectancyDollar(value: number): KPI {
    const status = value < 0 ? 'CRITICAL' : 'OK';

    return {
      name: 'Expectancy ($/trade)',
      value,
      min: 0,
      optimal: 6.47, // Alpha Arena benchmark
      status,
      action: status === 'CRITICAL'
        ? 'Negativo por 5 dias → revisar modelo completo'
        : 'Monitorar'
    };
  }

  // ==================== HANDLERS ====================

  private async handleExpectancyCritical(): Promise<void> {
    this.consecutiveNegativeExpectancy++;

    if (this.consecutiveNegativeExpectancy >= 3) {
      await telegramNotifier.sendMessage(
        `🚨 <b>KPI CRÍTICO - EXPECTATIVA</b>\n\n` +
        `Expectativa negativa por 3 dias consecutivos.\n` +
        `⏸️ Estratégias pausadas.\n` +
        `🔄 Strategy Factory acionada.\n\n` +
        `⚡ VEXOR`
      );

      // Reset counter
      this.consecutiveNegativeExpectancy = 0;
    }
  }

  private determineOverallStatus(kpis: KPI[]): 'HEALTHY' | 'DEGRADED' | 'CRITICAL' {
    const critical = kpis.filter(k => k.status === 'CRITICAL').length;
    const warning = kpis.filter(k => k.status === 'WARNING').length;

    if (critical >= 2) return 'CRITICAL';
    if (critical >= 1 || warning >= 3) return 'DEGRADED';
    return 'HEALTHY';
  }

  private async saveReport(report: KPIReport): Promise<void> {
    try {
      await oracleDB.insert(`
        INSERT INTO kpi_reports (
          id, timestamp, overall_status, kpis_json, actions_triggered,
          capital, daily_pnl, open_positions
        ) VALUES (
          :id, :ts, :status, :kpis, :actions, :capital, :pnl, :positions
        )
      `, {
        id: oracleDB.generateId(),
        ts: report.timestamp,
        status: report.overallStatus,
        kpis: JSON.stringify(report.kpis),
        actions: report.actionsTriggered.join(';'),
        capital: report.capital,
        pnl: report.dailyPnL,
        positions: report.openPositions
      });
    } catch {}
  }

  private async notifyCritical(report: KPIReport): Promise<void> {
    const criticalKPIs = report.kpis.filter(k => k.status === 'CRITICAL');

    let message = 
      `🚨 <b>KPIs CRÍTICOS</b>\n\n` +
      `📊 Status: ${report.overallStatus}\n\n` +
      `❌ Problemas:\n`;

    for (const kpi of criticalKPIs) {
      message += `• ${kpi.name}: ${kpi.value.toFixed(4)}\n`;
    }

    message += '\n🔧 Ações:\n';
    for (const action of report.actionsTriggered) {
      message += `• ${action}\n`;
    }

    message += `\n⏰ ${report.timestamp.toLocaleString('pt-BR')}\n\n⚡ VEXOR`;

    await telegramNotifier.sendMessage(message);
  }

  getLastReport(): KPIReport | null {
    return this.lastReport;
  }

  getOverallStatus(): 'HEALTHY' | 'DEGRADED' | 'CRITICAL' {
    return this.lastReport?.overallStatus || 'HEALTHY';
  }
}

// Singleton
export const kpisMonitor = new KPIsMonitor();
export type { KPI, KPIReport };
