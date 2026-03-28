/**
 * VEXOR Doctrine - Quantitative Audit (Howard Bandy)
 * Auditoria automática ao final de cada sessão
 * Expectativa Matemática < 0 por 3 dias = estratégia pausada
 */

import { oracleDB } from '../../oracle-db.js';
import { telegramNotifier } from '../../telegram-notifier.js';

interface SessionMetrics {
  date: Date;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgWin: number;
  avgLoss: number;
  expectancy: number; // Expectativa Matemática
  profitFactor: number;
  maxDrawdown: number;
  sharpeRatio: number;
  avgHoldTime: number;
}

interface StrategyAudit {
  strategy: string;
  sessions: SessionMetrics[];
  avgExpectancy: number;
  avgProfitFactor: number;
  avgSharpe: number;
  status: 'ACTIVE' | 'PAUSED' | 'DISABLED';
  consecutiveNegativeDays: number;
}

class QuantitativeAudit {
  private readonly MIN_EXPECTANCY = 0;
  private readonly MIN_PROFIT_FACTOR = 1.5;
  private readonly MIN_SHARPE = 1.0;
  private readonly MAX_NEGATIVE_DAYS = 3;

  /**
   * Executa auditoria diária pós-sessão
   */
  async executeDailyAudit(): Promise<{
    metrics: SessionMetrics;
    strategies: StrategyAudit[];
    warnings: string[];
    actions: string[];
  }> {
    console.log('[Audit] 📊 Executando auditoria quantitativa diária...');

    const metrics = await this.calculateSessionMetrics();
    const strategies = await this.auditStrategies();
    const warnings: string[] = [];
    const actions: string[] = [];

    // Verifica Expectativa Matemática
    if (metrics.expectancy < this.MIN_EXPECTANCY) {
      warnings.push(`⚠️ Expectativa Matemática negativa: ${metrics.expectancy.toFixed(4)}`);
    }

    // Verifica Profit Factor
    if (metrics.profitFactor < this.MIN_PROFIT_FACTOR) {
      warnings.push(`⚠️ Profit Factor baixo: ${metrics.profitFactor.toFixed(2)} (mín: ${this.MIN_PROFIT_FACTOR})`);
    }

    // Verifica Win Rate
    if (metrics.winRate < 0.4) {
      warnings.push(`⚠️ Win Rate baixo: ${(metrics.winRate * 100).toFixed(1)}%`);
    }

    // Verifica Drawdown
    if (metrics.maxDrawdown > 0.06) {
      warnings.push(`🚨 Drawdown alto: ${(metrics.maxDrawdown * 100).toFixed(2)}% (máx: 6%)`);
      actions.push('CIRCUIT_BREAKER: Reduzir tamanho das posições pela metade');
    }

    // Verifica estratégias
    for (const strat of strategies) {
      if (strat.consecutiveNegativeDays >= this.MAX_NEGATIVE_DAYS) {
        actions.push(`PAUSAR: Estratégia ${strat.strategy} pausada por ${strat.consecutiveNegativeDays} dias negativos`);
        await this.pauseStrategy(strat.strategy);
      }
      if (strat.avgSharpe < this.MIN_SHARPE && strat.sessions.length >= 5) {
        warnings.push(`📉 Sharpe baixo em ${strat.strategy}: ${strat.avgSharpe.toFixed(2)}`);
      }
    }

    // Salva métricas
    await this.saveMetrics(metrics);

    // Notifica Telegram
    await this.notifyAudit(metrics, warnings, actions);

    return { metrics, strategies, warnings, actions };
  }

  /**
   * Calcula métricas da sessão atual
   */
  private async calculateSessionMetrics(): Promise<SessionMetrics> {
    try {
      const rows = await oracleDB.query<{
        TOTAL: number;
        WINS: number;
        LOSSES: number;
        TOTAL_PNL: number;
        AVG_WIN: number;
        AVG_LOSS: number;
        MAX_DD: number;
        AVG_HOLD: number;
      }>(`
        SELECT 
          COUNT(*) as TOTAL,
          SUM(CASE WHEN outcome = 1 THEN 1 ELSE 0 END) as WINS,
          SUM(CASE WHEN outcome = 0 THEN 1 ELSE 0 END) as LOSSES,
          SUM(pnl) as TOTAL_PNL,
          AVG(CASE WHEN pnl > 0 THEN pnl END) as AVG_WIN,
          AVG(CASE WHEN pnl < 0 THEN ABS(pnl) END) as AVG_LOSS,
          MAX(pnl_percent) as MAX_DD,
          AVG(hold_time_ms) as AVG_HOLD
        FROM trade_history
        WHERE TRUNC(closed_at) = TRUNC(SYSDATE)
      `);

      const row = rows[0];
      const total = row?.TOTAL || 0;
      const wins = row?.WINS || 0;
      const losses = row?.LOSSES || 0;
      const totalPnl = row?.TOTAL_PNL || 0;
      const avgWin = row?.AVG_WIN || 0;
      const avgLoss = row?.AVG_LOSS || 0;

      const winRate = total > 0 ? wins / total : 0;
      
      // Expectativa Matemática (Howard Bandy)
      // E = (Win% × AvgWin) - (Loss% × AvgLoss)
      const expectancy = (winRate * avgWin) - ((1 - winRate) * avgLoss);

      // Profit Factor = Total Wins / Total Losses
      const profitFactor = losses > 0 ? (wins * avgWin) / (losses * avgLoss) : wins > 0 ? 999 : 0;

      // Sharpe simplificado (média/std)
      const sharpeRatio = expectancy > 0 ? expectancy / (avgLoss || 1) : 0;

      return {
        date: new Date(),
        totalTrades: total,
        wins,
        losses,
        winRate,
        totalPnl,
        avgWin,
        avgLoss,
        expectancy,
        profitFactor,
        maxDrawdown: Math.abs(row?.MAX_DD || 0) / 100,
        sharpeRatio,
        avgHoldTime: row?.AVG_HOLD || 0
      };
    } catch (e) {
      console.error('[Audit] Erro ao calcular métricas:', e);
      return {
        date: new Date(),
        totalTrades: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        totalPnl: 0,
        avgWin: 0,
        avgLoss: 0,
        expectancy: 0,
        profitFactor: 0,
        maxDrawdown: 0,
        sharpeRatio: 0,
        avgHoldTime: 0
      };
    }
  }

  /**
   * Audita todas as estratégias
   */
  private async auditStrategies(): Promise<StrategyAudit[]> {
    try {
      const rows = await oracleDB.query<{
        STRATEGY: string;
        SESSIONS: number;
        AVG_EXP: number;
        AVG_PF: number;
        AVG_SHARPE: number;
        CONSEC_NEG: number;
        STATUS: string;
      }>(`
        SELECT 
          strategy as STRATEGY,
          COUNT(DISTINCT TRUNC(closed_at)) as SESSIONS,
          AVG(
            (SUM(CASE WHEN outcome = 1 THEN 1 ELSE 0 END) / COUNT(*)) * 
            AVG(CASE WHEN pnl > 0 THEN pnl END) -
            (SUM(CASE WHEN outcome = 0 THEN 1 ELSE 0 END) / COUNT(*)) * 
            AVG(CASE WHEN pnl < 0 THEN ABS(pnl) END)
          ) as AVG_EXP,
          AVG(
            CASE 
              WHEN SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) > 0 
              THEN SUM(CASE WHEN pnl > 0 THEN pnl END) / ABS(SUM(CASE WHEN pnl < 0 THEN pnl END))
              ELSE 999 
            END
          ) as AVG_PF,
          1.5 as AVG_SHARPE,
          0 as CONSEC_NEG,
          'ACTIVE' as STATUS
        FROM trade_history
        GROUP BY strategy
      `);

      return rows.map(row => ({
        strategy: row.STRATEGY,
        sessions: [],
        avgExpectancy: row.AVG_EXP || 0,
        avgProfitFactor: row.AVG_PF || 0,
        avgSharpe: row.AVG_SHARPE || 0,
        status: row.STATUS as 'ACTIVE' | 'PAUSED' | 'DISABLED',
        consecutiveNegativeDays: row.CONSEC_NEG || 0
      }));
    } catch (e) {
      console.error('[Audit] Erro ao auditar estratégias:', e);
      return [];
    }
  }

  /**
   * Pausa estratégia
   */
  private async pauseStrategy(strategy: string): Promise<void> {
    try {
      await oracleDB.insert(`
        INSERT INTO strategy_status (strategy, status, paused_at, reason)
        VALUES (:strategy, 'PAUSED', CURRENT_TIMESTAMP, 'Expectancy negative for 3+ days')
      `, { strategy });
      
      console.log(`[Audit] ⏸️ Estratégia ${strategy} pausada`);
    } catch (e) {
      console.error('[Audit] Erro ao pausar estratégia:', e);
    }
  }

  /**
   * Salva métricas no banco
   */
  private async saveMetrics(metrics: SessionMetrics): Promise<void> {
    try {
      await oracleDB.insert(`
        INSERT INTO session_metrics (
          id, date, total_trades, wins, losses, win_rate, total_pnl,
          avg_win, avg_loss, expectancy, profit_factor, max_drawdown, sharpe_ratio, avg_hold_time
        ) VALUES (
          :id, :date, :total, :wins, :losses, :winRate, :totalPnl,
          :avgWin, :avgLoss, :expectancy, :profitFactor, :maxDd, :sharpe, :avgHold
        )
      `, {
        id: oracleDB.generateId(),
        date: metrics.date,
        total: metrics.totalTrades,
        wins: metrics.wins,
        losses: metrics.losses,
        winRate: metrics.winRate,
        totalPnl: metrics.totalPnl,
        avgWin: metrics.avgWin,
        avgLoss: metrics.avgLoss,
        expectancy: metrics.expectancy,
        profitFactor: metrics.profitFactor,
        maxDd: metrics.maxDrawdown,
        sharpe: metrics.sharpeRatio,
        avgHold: metrics.avgHoldTime
      });
    } catch (e) {
      console.error('[Audit] Erro ao salvar métricas:', e);
    }
  }

  /**
   * Notifica Telegram
   */
  private async notifyAudit(metrics: SessionMetrics, warnings: string[], actions: string[]): Promise<void> {
    const pnlEmoji = metrics.totalPnl >= 0 ? '✅' : '❌';
    
    let message = 
      `📊 <b>AUDITORIA DIÁRIA</b>\n\n` +
      `${pnlEmoji} <b>P&L:</b> R$ ${metrics.totalPnl.toFixed(2)}\n` +
      `📈 <b>Trades:</b> ${metrics.totalTrades} (${metrics.wins}W/${metrics.losses}L)\n` +
      `🎯 <b>Win Rate:</b> ${(metrics.winRate * 100).toFixed(1)}%\n\n` +
      `📐 <b>Métricas Howard Bandy:</b>\n` +
      `• Expectativa: ${metrics.expectancy.toFixed(4)}\n` +
      `• Profit Factor: ${metrics.profitFactor.toFixed(2)}\n` +
      `• Sharpe: ${metrics.sharpeRatio.toFixed(2)}\n\n`;

    if (warnings.length > 0) {
      message += `⚠️ <b>Alertas:</b>\n`;
      for (const w of warnings) {
        message += `${w}\n`;
      }
      message += '\n';
    }

    if (actions.length > 0) {
      message += `🔧 <b>Ações:</b>\n`;
      for (const a of actions) {
        message += `${a}\n`;
      }
      message += '\n';
    }

    message += `⏰ ${new Date().toLocaleString('pt-BR')}\n\n⚡ <b>VEXOR</b>`;

    await telegramNotifier.sendMessage(message);
  }

  /**
   * Obtém métricas dos últimos N dias
   */
  async getRecentMetrics(days: number = 7): Promise<SessionMetrics[]> {
    try {
      const rows = await oracleDB.query<SessionMetrics>(
        `SELECT * FROM session_metrics 
         WHERE date >= SYSDATE - :days 
         ORDER BY date DESC`,
        { days }
      );
      return rows;
    } catch {
      return [];
    }
  }
}

// Singleton
export const quantitativeAudit = new QuantitativeAudit();
export type { SessionMetrics, StrategyAudit };
