/**
 * VEXOR Signal Tracker
 * Monitora sinais até WIN ou LOSS
 * Aprendizado contínuo com 0/1
 */

import { oracleDB } from '../oracle-db.js';
import { telegramNotifier } from '../telegram-notifier.js';
import { psychAgent } from './psych-agent.js';
import { ragService } from './rag-service.js';

// ==================== TYPES ====================

interface TradeSignal {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  entry: number;
  stop: number;
  target: number;
  quantity: number;
  strategy: string;
  confidence: number;
  timestamp: Date;
  status: 'PENDING' | 'ACTIVE' | 'WIN' | 'LOSS' | 'BREAKEVEN';
  exitPrice?: number;
  pnl?: number;
  pnlPercent?: number;
  outcome?: 0 | 1; // 0 = LOSS, 1 = WIN
  durationMs?: number;
  exitReason?: string;
}

interface SignalTrackerConfig {
  checkIntervalMs: number;
  maxDurationMs: number;
  notifyOnEntry: boolean;
  notifyOnExit: boolean;
}

// ==================== SIGNAL TRACKER ====================

class SignalTracker {
  private activeSignals: Map<string, TradeSignal> = new Map();
  private config: SignalTrackerConfig = {
    checkIntervalMs: 5000, // 5 segundos
    maxDurationMs: 24 * 60 * 60 * 1000, // 24 horas
    notifyOnEntry: true,
    notifyOnExit: true
  };
  private checkInterval: NodeJS.Timeout | null = null;
  private priceCache: Map<string, number> = new Map();

  /**
   * Registra novo sinal
   */
  async registerSignal(signal: Omit<TradeSignal, 'id' | 'status' | 'timestamp'>): Promise<TradeSignal> {
    const id = this.generateId();
    const fullSignal: TradeSignal = {
      ...signal,
      id,
      status: 'ACTIVE',
      timestamp: new Date(),
      outcome: undefined
    };

    // Salva no mapa
    this.activeSignals.set(id, fullSignal);

    // 🎯 INICIA MONITORAMENTO AUTOMATICAMENTE
    if (!this.checkInterval) {
      this.startMonitoring();
    }

    // Salva no banco
    await this.saveSignal(fullSignal);

    // Notifica entrada
    if (this.config.notifyOnEntry) {
      await this.notifyEntry(fullSignal);
    }

    console.log(`[SignalTracker] 📊 Sinal registrado: ${signal.symbol} ${signal.side} @ ${signal.entry}`);

    return fullSignal;
  }

  /**
   * Atualiza preço atual do ativo
   */
  updatePrice(symbol: string, price: number): void {
    this.priceCache.set(symbol, price);
    console.log(`[SignalTracker] 💰 Preço atualizado: ${symbol} = ${price}`);
  }

  /**
   * Inicia monitoramento
   */
  startMonitoring(): void {
    if (this.checkInterval) return;

    this.checkInterval = setInterval(() => {
      this.checkAllSignals();
    }, this.config.checkIntervalMs);

    console.log('[SignalTracker] 🔍 Monitoramento iniciado');
  }

  /**
   * Para monitoramento
   */
  stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Verifica todos os sinais ativos
   */
  private async checkAllSignals(): Promise<void> {
    if (this.activeSignals.size === 0) return;
    
    console.log(`[SignalTracker] 🔍 Verificando ${this.activeSignals.size} sinais ativos...`);
    
    for (const [id, signal] of this.activeSignals) {
      const currentPrice = this.priceCache.get(signal.symbol);

      if (!currentPrice) {
        console.log(`[SignalTracker] ⚠️ Sem preço para ${signal.symbol}`);
        continue;
      }

      console.log(`[SignalTracker] 📊 ${signal.symbol}: preço=${currentPrice}, stop=${signal.stop}, target=${signal.target}`);

      // Verifica se atingiu stop ou target
      const result = this.checkSignalOutcome(signal, currentPrice);

      if (result.outcome !== undefined && result.exitPrice !== undefined && result.exitReason !== undefined) {
        await this.closeSignal(signal, {
          outcome: result.outcome,
          exitPrice: result.exitPrice,
          exitReason: result.exitReason
        });
      }
    }
  }

  /**
   * Verifica resultado do sinal
   */
  private checkSignalOutcome(signal: TradeSignal, currentPrice: number): {
    outcome: 0 | 1 | undefined;
    exitPrice?: number;
    exitReason?: string;
  } {
    const { side, stop, target } = signal;

    if (side === 'BUY') {
      // Compra: stop abaixo, target acima
      if (currentPrice <= stop) {
        return { outcome: 0, exitPrice: stop, exitReason: 'STOP_LOSS' };
      }
      if (currentPrice >= target) {
        return { outcome: 1, exitPrice: target, exitReason: 'TARGET_HIT' };
      }
    } else {
      // Venda: stop acima, target abaixo
      if (currentPrice >= stop) {
        return { outcome: 0, exitPrice: stop, exitReason: 'STOP_LOSS' };
      }
      if (currentPrice <= target) {
        return { outcome: 1, exitPrice: target, exitReason: 'TARGET_HIT' };
      }
    }

    // Verifica timeout
    const elapsed = Date.now() - signal.timestamp.getTime();
    if (elapsed > this.config.maxDurationMs) {
      // Fecha a mercado após timeout
      return { outcome: 0, exitPrice: currentPrice, exitReason: 'TIMEOUT' };
    }

    return { outcome: undefined };
  }

  /**
   * Fecha sinal com resultado
   */
  private async closeSignal(signal: TradeSignal, result: {
    outcome: 0 | 1;
    exitPrice: number;
    exitReason: string;
  }): Promise<void> {
    const exitPrice = result.exitPrice!;
    const pnl = this.calculatePnL(signal, exitPrice);
    const pnlPercent = this.calculatePnLPercent(signal, exitPrice);
    const durationMs = Date.now() - signal.timestamp.getTime();

    // Atualiza sinal
    signal.status = result.outcome === 1 ? 'WIN' : 'LOSS';
    signal.exitPrice = exitPrice;
    signal.pnl = pnl;
    signal.pnlPercent = pnlPercent;
    signal.outcome = result.outcome;
    signal.durationMs = durationMs;
    signal.exitReason = result.exitReason;

    // Remove do mapa de ativos
    this.activeSignals.delete(signal.id);

    // Salva resultado no banco
    await this.saveSignalResult(signal);

    // Notifica resultado
    if (this.config.notifyOnExit) {
      await this.notifyResult(signal);
    }

    // Atualiza Psych Agent
    await psychAgent.postTradeUpdate(result.outcome, pnl);

    // Aprendizado contínuo - salva para RAG
    await this.saveForLearning(signal);

    console.log(
      `[SignalTracker] ${result.outcome === 1 ? '🟢 WIN' : '🔴 LOSS'}: ${signal.symbol} ` +
      `PnL: R$ ${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)`
    );
  }

  /**
   * Calcula PnL
   */
  private calculatePnL(signal: TradeSignal, exitPrice: number): number {
    const diff = signal.side === 'BUY'
      ? exitPrice - signal.entry
      : signal.entry - exitPrice;

    return diff * signal.quantity;
  }

  /**
   * Calcula PnL percentual
   */
  private calculatePnLPercent(signal: TradeSignal, exitPrice: number): number {
    const diff = signal.side === 'BUY'
      ? exitPrice - signal.entry
      : signal.entry - exitPrice;

    return (diff / signal.entry) * 100;
  }

  /**
   * Salva sinal no banco
   */
  private async saveSignal(signal: TradeSignal): Promise<void> {
    try {
      await oracleDB.insert(`
        INSERT INTO trade_signals (
          id, symbol, side, entry, stop, target, quantity,
          strategy, confidence, status, timestamp
        ) VALUES (
          :id, :symbol, :side, :entry, :stop, :target, :quantity,
          :strategy, :confidence, :status, CURRENT_TIMESTAMP
        )
      `, {
        id: signal.id,
        symbol: signal.symbol,
        side: signal.side,
        entry: signal.entry,
        stop: signal.stop,
        target: signal.target,
        quantity: signal.quantity,
        strategy: signal.strategy,
        confidence: signal.confidence,
        status: signal.status
      });
    } catch (e) {
      console.error('[SignalTracker] Erro ao salvar:', e);
    }
  }

  /**
   * Salva resultado no banco
   */
  private async saveSignalResult(signal: TradeSignal): Promise<void> {
    try {
      await oracleDB.insert(`
        UPDATE trade_signals SET
          status = :status,
          exit_price = :exit,
          pnl = :pnl,
          pnl_percent = :pnlPct,
          outcome = :outcome,
          duration_ms = :duration,
          exit_reason = :reason,
          closed_at = CURRENT_TIMESTAMP
        WHERE id = :id
      `, {
        id: signal.id,
        status: signal.status,
        exit: signal.exitPrice,
        pnl: signal.pnl,
        pnlPct: signal.pnlPercent,
        outcome: signal.outcome,
        duration: signal.durationMs,
        reason: signal.exitReason
      });

      // Também salva no histórico de trades
      await oracleDB.insert(`
        INSERT INTO trade_history (
          id, symbol, side, entry_price, exit_price, stop_price, target_price,
          quantity, pnl, outcome, strategy, closed_at
        ) VALUES (
          :id, :symbol, :side, :entry, :exit, :stop, :target,
          :quantity, :pnl, :outcome, :strategy, CURRENT_TIMESTAMP
        )
      `, {
        id: signal.id,
        symbol: signal.symbol,
        side: signal.side,
        entry: signal.entry,
        exit: signal.exitPrice,
        stop: signal.stop,
        target: signal.target,
        quantity: signal.quantity,
        pnl: signal.pnl,
        outcome: signal.outcome,
        strategy: signal.strategy
      });
    } catch (e) {
      console.error('[SignalTracker] Erro ao salvar resultado:', e);
    }
  }

  /**
   * Salva para aprendizado RAG
   */
  private async saveForLearning(signal: TradeSignal): Promise<void> {
    try {
      const outcomeLabel = signal.outcome === 1 ? 'WIN' : 'LOSS';
      const learningText = `
SINAL: ${signal.symbol} ${signal.side}
Estratégia: ${signal.strategy}
Entrada: ${signal.entry}
Stop: ${signal.stop}
Target: ${signal.target}
Resultado: ${outcomeLabel}
PnL: R$ ${signal.pnl?.toFixed(2)} (${signal.pnlPercent?.toFixed(2)}%)
Duração: ${Math.round((signal.durationMs || 0) / 60000)} minutos
Razão: ${signal.exitReason}
`.trim();

      await oracleDB.insert(`
        INSERT INTO learning_data (
          id, type, content, outcome, created_at
        ) VALUES (
          :id, 'SIGNAL_OUTCOME', :content, :outcome, CURRENT_TIMESTAMP
        )
      `, {
        id: oracleDB.generateId(),
        content: learningText,
        outcome: signal.outcome
      });

      // Notifica aprendizado
      await ragService.notifyLearning(
        `Sinal ${signal.symbol} - ${outcomeLabel}`,
        learningText
      );
    } catch (e) {
      console.error('[SignalTracker] Erro ao salvar aprendizado:', e);
    }
  }

  /**
   * Notifica entrada do sinal
   */
  private async notifyEntry(signal: TradeSignal): Promise<void> {
    const emoji = signal.side === 'BUY' ? '🟢' : '🔴';
    const side = signal.side === 'BUY' ? 'COMPRA' : 'VENDA';

    await telegramNotifier.sendMessage(
      `${emoji} <b>SINAL ${side}</b>\n\n` +
      `📊 <b>${signal.symbol}</b>\n` +
      `💰 Entrada: ${signal.entry.toFixed(2)}\n` +
      `🛡️ Stop: ${signal.stop.toFixed(2)}\n` +
      `🎯 Target: ${signal.target.toFixed(2)}\n` +
      `📦 Qtd: ${signal.quantity}\n` +
      `📈 Estratégia: ${signal.strategy}\n` +
      `⚡ Confiança: ${signal.confidence.toFixed(0)}%\n\n` +
      `🔍 <i>Monitorando até WIN ou LOSS...</i>\n\n` +
      `⚡ VEXOR`
    );
  }

  /**
   * Notifica resultado
   */
  private async notifyResult(signal: TradeSignal): Promise<void> {
    const isWin = signal.outcome === 1;
    const emoji = isWin ? '🟢' : '🔴';
    const resultLabel = isWin ? 'WIN! ✅' : 'LOSS ❌';
    const pnlEmoji = (signal.pnl || 0) >= 0 ? '📈' : '📉';

    const duration = Math.round((signal.durationMs || 0) / 60000);

    await telegramNotifier.sendMessage(
      `${emoji} <b>${resultLabel}</b>\n\n` +
      `📊 <b>${signal.symbol}</b>\n` +
      `${pnlEmoji} PnL: R$ ${signal.pnl?.toFixed(2)} (${signal.pnlPercent?.toFixed(2)}%)\n` +
      `💰 Entrada: ${signal.entry.toFixed(2)} → Saída: ${signal.exitPrice?.toFixed(2)}\n` +
      `⏱️ Duração: ${duration} min\n` +
      `📝 Razão: ${signal.exitReason}\n\n` +
      `📚 <b>Aprendizado salvo:</b> ${isWin ? '1' : '0'}\n` +
      `🧠 RAG atualizado para próximas decisões\n\n` +
      `⚡ VEXOR`
    );
  }

  /**
   * Gera ID único
   */
  private generateId(): string {
    return `SIG${Date.now()}${Math.random().toString(36).substr(2, 9)}`.toUpperCase();
  }

  /**
   * Lista sinais ativos
   */
  getActiveSignals(): TradeSignal[] {
    return Array.from(this.activeSignals.values());
  }

  /**
   * Obtém sinal por ID
   */
  getSignal(id: string): TradeSignal | undefined {
    return this.activeSignals.get(id);
  }

  /**
   * Estatísticas
   */
  async getStats(): Promise<{
    active: number;
    todayWins: number;
    todayLosses: number;
    todayPnL: number;
    winRate: number;
  }> {
    const active = this.activeSignals.size;

    try {
      const rows = await oracleDB.query<any>(`
        SELECT 
          COUNT(CASE WHEN outcome = 1 THEN 1 END) as wins,
          COUNT(CASE WHEN outcome = 0 THEN 1 END) as losses,
          COALESCE(SUM(pnl), 0) as total_pnl
        FROM trade_history
        WHERE TRUNC(closed_at) = TRUNC(SYSDATE)
      `);

      const wins = rows[0]?.WINS || 0;
      const losses = rows[0]?.LOSSES || 0;
      const total = wins + losses;

      return {
        active,
        todayWins: wins,
        todayLosses: losses,
        todayPnL: rows[0]?.TOTAL_PNL || 0,
        winRate: total > 0 ? wins / total : 0
      };
    } catch {
      return {
        active,
        todayWins: 0,
        todayLosses: 0,
        todayPnL: 0,
        winRate: 0
      };
    }
  }

  /**
   * Fecha sinal manualmente
   */
  async closeManually(id: string, exitPrice: number, reason: string = 'MANUAL'): Promise<void> {
    const signal = this.activeSignals.get(id);
    if (!signal) {
      throw new Error('Sinal não encontrado');
    }

    // Determina outcome baseado no preço de saída
    const pnl = this.calculatePnL(signal, exitPrice);
    const outcome = pnl >= 0 ? 1 : 0;

    await this.closeSignal(signal, {
      outcome,
      exitPrice,
      exitReason: reason
    });
  }
}

// ==================== SINGLETON ====================

export const signalTracker = new SignalTracker();
export type { TradeSignal, SignalTrackerConfig };
