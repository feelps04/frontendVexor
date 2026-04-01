/**
 * Trade Monitor Service
 * Monitora posições abertas, detecta alvo/stop, notifica cliente e salva no banco
 * Sistema de aprendizagem: 0 = perda, 1 = ganho
 */

import { oracleDB } from './oracle-db.js';
import { telegramNotifier } from './telegram-notifier.js';
import { realtimePricesService } from './realtime-prices.js';
import { learningEngine } from './nexus-core/ai-core/index.js';

interface OpenPosition {
  id: string;
  userId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  strategy: string;
  agents: string[];
  confidence: number;
  broker: string;
  openedAt: Date;
  trailingStop?: number;
  trailingActivated: boolean;
}

interface TradeResult {
  tradeId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  pnlPercent: number;
  outcome: 0 | 1; // 0 = perda, 1 = ganho
  exitReason: 'STOP' | 'TARGET' | 'TRAILING_STOP' | 'MANUAL';
  strategy: string;
  agents: string[];
  holdTimeMs: number;
}

class TradeMonitorService {
  private positions: Map<string, OpenPosition> = new Map();
  private monitorInterval: NodeJS.Timeout | null = null;
  private readonly MONITOR_INTERVAL_MS = 1000; // 1 segundo

  constructor() {
    this.startMonitoring();
    this.createTables();
  }

  /**
   * Cria tabelas no Oracle para trades e aprendizado
   */
  private async createTables(): Promise<void> {
    try {
      // Tabela de posições abertas
      await oracleDB.execute(`
        BEGIN
          EXECUTE IMMEDIATE 'CREATE TABLE open_positions (
            id VARCHAR2(36) PRIMARY KEY,
            user_id VARCHAR2(36) NOT NULL,
            symbol VARCHAR2(20) NOT NULL,
            side VARCHAR2(10) NOT NULL,
            quantity NUMBER NOT NULL,
            entry_price NUMBER NOT NULL,
            stop_price NUMBER NOT NULL,
            target_price NUMBER NOT NULL,
            strategy VARCHAR2(100),
            agents VARCHAR2(500),
            confidence NUMBER,
            broker VARCHAR2(50),
            trailing_stop NUMBER,
            trailing_activated NUMBER DEFAULT 0,
            opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            telegram_message_id VARCHAR2(50)
          )';
        EXCEPTION WHEN OTHERS THEN NULL; END;
      `);

      // Tabela de histórico de trades
      await oracleDB.execute(`
        BEGIN
          EXECUTE IMMEDIATE 'CREATE TABLE trade_history (
            id VARCHAR2(36) PRIMARY KEY,
            user_id VARCHAR2(36) NOT NULL,
            symbol VARCHAR2(20) NOT NULL,
            side VARCHAR2(10) NOT NULL,
            quantity NUMBER NOT NULL,
            entry_price NUMBER NOT NULL,
            exit_price NUMBER NOT NULL,
            pnl NUMBER NOT NULL,
            pnl_percent NUMBER NOT NULL,
            outcome NUMBER(1) NOT NULL,
            exit_reason VARCHAR2(20) NOT NULL,
            strategy VARCHAR2(100),
            agents VARCHAR2(500),
            confidence NUMBER,
            broker VARCHAR2(50),
            hold_time_ms NUMBER,
            opened_at TIMESTAMP,
            closed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )';
        EXCEPTION WHEN OTHERS THEN NULL; END;
      `);

      // Tabela de notificações
      await oracleDB.execute(`
        BEGIN
          EXECUTE IMMEDIATE 'CREATE TABLE trade_notifications (
            id VARCHAR2(36) PRIMARY KEY,
            user_id VARCHAR2(36) NOT NULL,
            trade_id VARCHAR2(36) NOT NULL,
            type VARCHAR2(20) NOT NULL,
            message CLOB,
            telegram_sent NUMBER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )';
        EXCEPTION WHEN OTHERS THEN NULL; END;
      `);

      // Tabela de aprendizado (0/1)
      await oracleDB.execute(`
        BEGIN
          EXECUTE IMMEDIATE 'CREATE TABLE learning_data (
            id VARCHAR2(36) PRIMARY KEY,
            trade_id VARCHAR2(36) NOT NULL,
            symbol VARCHAR2(20) NOT NULL,
            strategy VARCHAR2(100),
            agents VARCHAR2(500),
            regime VARCHAR2(50),
            outcome NUMBER(1) NOT NULL,
            pnl NUMBER,
            confidence NUMBER,
            features CLOB,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )';
        EXCEPTION WHEN OTHERS THEN NULL; END;
      `);

      console.log('[TradeMonitor] ✅ Tabelas criadas/verificadas no Oracle');
    } catch (e) {
      console.error('[TradeMonitor] Erro ao criar tabelas:', e);
    }
  }

  /**
   * Inicia monitoramento de posições
   */
  private startMonitoring(): void {
    this.monitorInterval = setInterval(() => {
      this.checkAllPositions();
    }, this.MONITOR_INTERVAL_MS);
    
    console.log('[TradeMonitor] 🔍 Monitoramento iniciado (1s interval)');
  }

  /**
   * Verifica todas as posições abertas
   */
  private async checkAllPositions(): Promise<void> {
    for (const [id, position] of this.positions) {
      await this.checkPosition(position);
    }
  }

  /**
   * Verifica se posição atingiu stop ou alvo
   */
  private async checkPosition(position: OpenPosition): Promise<void> {
    const price = realtimePricesService.getPrice(position.symbol);
    if (!price) return;

    const currentPrice = position.side === 'BUY' ? price.bid : price.ask;

    // Atualiza trailing stop se ativado
    if (position.trailingActivated && position.trailingStop) {
      position.trailingStop = this.updateTrailingStop(position, currentPrice);
    }

    // Verifica se atingiu stop
    if (this.isStopHit(position, currentPrice)) {
      await this.closePosition(position, currentPrice, 'STOP');
      return;
    }

    // Verifica se atingiu alvo
    if (this.isTargetHit(position, currentPrice)) {
      await this.closePosition(position, currentPrice, 'TARGET');
      return;
    }

    // Ativa trailing stop se preço moveu a favor
    if (!position.trailingActivated && this.shouldActivateTrailing(position, currentPrice)) {
      position.trailingActivated = true;
      position.trailingStop = this.calculateInitialTrailing(position, currentPrice);
      await this.savePosition(position);
    }
  }

  private isStopHit(position: OpenPosition, currentPrice: number): boolean {
    if (position.trailingActivated && position.trailingStop) {
      return position.side === 'BUY' 
        ? currentPrice <= position.trailingStop 
        : currentPrice >= position.trailingStop;
    }
    return position.side === 'BUY' 
      ? currentPrice <= position.stopPrice 
      : currentPrice >= position.stopPrice;
  }

  private isTargetHit(position: OpenPosition, currentPrice: number): boolean {
    return position.side === 'BUY' 
      ? currentPrice >= position.targetPrice 
      : currentPrice <= position.targetPrice;
  }

  private shouldActivateTrailing(position: OpenPosition, currentPrice: number): boolean {
    const movePercent = Math.abs(currentPrice - position.entryPrice) / position.entryPrice;
    return movePercent >= 0.02; // Ativa após 2% de movimento a favor
  }

  private calculateInitialTrailing(position: OpenPosition, currentPrice: number): number {
    const distance = position.entryPrice * 0.015; // 1.5% trailing distance
    return position.side === 'BUY' ? currentPrice - distance : currentPrice + distance;
  }

  private updateTrailingStop(position: OpenPosition, currentPrice: number): number {
    const distance = position.entryPrice * 0.015;
    if (position.side === 'BUY') {
      const newStop = currentPrice - distance;
      return newStop > (position.trailingStop || position.stopPrice) ? newStop : position.trailingStop!;
    } else {
      const newStop = currentPrice + distance;
      return newStop < (position.trailingStop || position.stopPrice) ? newStop : position.trailingStop!;
    }
  }

  /**
   * Fecha posição e notifica cliente
   */
  private async closePosition(
    position: OpenPosition, 
    exitPrice: number, 
    exitReason: 'STOP' | 'TARGET' | 'TRAILING_STOP' | 'MANUAL'
  ): Promise<TradeResult> {
    // Calcula P&L
    const pnl = position.side === 'BUY'
      ? (exitPrice - position.entryPrice) * position.quantity
      : (position.entryPrice - exitPrice) * position.quantity;
    
    const pnlPercent = (pnl / (position.entryPrice * position.quantity)) * 100;
    const outcome: 0 | 1 = pnl >= 0 ? 1 : 0;
    const holdTimeMs = Date.now() - position.openedAt.getTime();

    const result: TradeResult = {
      tradeId: position.id,
      symbol: position.symbol,
      side: position.side,
      entryPrice: position.entryPrice,
      exitPrice,
      quantity: position.quantity,
      pnl,
      pnlPercent,
      outcome,
      exitReason: exitReason === 'STOP' && position.trailingActivated ? 'TRAILING_STOP' : exitReason,
      strategy: position.strategy,
      agents: position.agents,
      holdTimeMs
    };

    // Remove das posições abertas
    this.positions.delete(position.id);

    // Salva no banco de dados
    await this.saveTradeHistory(result, position);
    await this.saveLearningData(result, position);
    await this.deleteOpenPosition(position.id);

    // Notifica cliente via Telegram
    await this.notifyClient(result, position);

    // Registra para aprendizado contínuo
    learningEngine.recordOutcome({
      strategy: position.strategy,
      symbol: position.symbol,
      outcome: outcome === 1 ? 'WIN' : 'LOSS',
      pnl,
      confidence: position.confidence
    });

    console.log(`[TradeMonitor] 📊 Trade fechado: ${position.symbol} | ${outcome === 1 ? '✅ GANHO' : '❌ PERDA'} | R$ ${pnl.toFixed(2)}`);

    return result;
  }

  /**
   * Salva histórico de trade no Oracle
   */
  private async saveTradeHistory(result: TradeResult, position: OpenPosition): Promise<void> {
    try {
      await oracleDB.insert(`
        INSERT INTO trade_history (
          id, user_id, symbol, side, quantity, entry_price, exit_price,
          pnl, pnl_percent, outcome, exit_reason, strategy, agents,
          confidence, broker, hold_time_ms, opened_at, closed_at
        ) VALUES (
          :id, :userId, :symbol, :side, :quantity, :entryPrice, :exitPrice,
          :pnl, :pnlPercent, :outcome, :exitReason, :strategy, :agents,
          :confidence, :broker, :holdTimeMs, :openedAt, CURRENT_TIMESTAMP
        )
      `, {
        id: result.tradeId,
        userId: position.userId,
        symbol: result.symbol,
        side: result.side,
        quantity: result.quantity,
        entryPrice: result.entryPrice,
        exitPrice: result.exitPrice,
        pnl: result.pnl,
        pnlPercent: result.pnlPercent,
        outcome: result.outcome,
        exitReason: result.exitReason,
        strategy: result.strategy,
        agents: result.agents.join(','),
        confidence: position.confidence,
        broker: position.broker,
        holdTimeMs: result.holdTimeMs,
        openedAt: position.openedAt
      });
    } catch (e) {
      console.error('[TradeMonitor] Erro ao salvar histórico:', e);
    }
  }

  /**
   * Salva dados para aprendizado (0/1)
   */
  private async saveLearningData(result: TradeResult, position: OpenPosition): Promise<void> {
    try {
      // Features: regime, confiança, estratégia, agentes, símbolo
      const features = JSON.stringify({
        regime: 'TREND_UP', // TODO: obter do market analyzer
        confidence: position.confidence,
        strategy: position.strategy,
        agents: position.agents,
        symbol: position.symbol,
        entryHour: position.openedAt.getHours(),
        holdTime: result.holdTimeMs / 60000 // em minutos
      });

      await oracleDB.insert(`
        INSERT INTO learning_data (
          id, trade_id, symbol, strategy, agents, regime, outcome, pnl, confidence, features
        ) VALUES (
          :id, :tradeId, :symbol, :strategy, :agents, :regime, :outcome, :pnl, :confidence, :features
        )
      `, {
        id: oracleDB.generateId(),
        tradeId: result.tradeId,
        symbol: result.symbol,
        strategy: result.strategy,
        agents: result.agents.join(','),
        regime: 'TREND_UP',
        outcome: result.outcome,
        pnl: result.pnl,
        confidence: position.confidence,
        features
      });

      console.log(`[TradeMonitor] 🧠 Aprendizado salvo: ${result.outcome === 1 ? '1 (GANHO)' : '0 (PERDA)'}`);
    } catch (e) {
      console.error('[TradeMonitor] Erro ao salvar aprendizado:', e);
    }
  }

  /**
   * Notifica cliente via Telegram
   */
  private async notifyClient(result: TradeResult, position: OpenPosition): Promise<void> {
    const emoji = result.outcome === 1 ? '✅' : '❌';
    const resultText = result.outcome === 1 ? 'GANHO' : 'PERDA';
    const exitEmoji = result.exitReason === 'TARGET' ? '🎯' : 
                      result.exitReason === 'STOP' ? '🛑' : 
                      result.exitReason === 'TRAILING_STOP' ? '📍' : '👤';

    const message = 
      `${emoji} <b>TRADE FINALIZADO</b>\n\n` +
      `📊 <b>${result.symbol}</b>\n` +
      `${result.side === 'BUY' ? '🟢 COMPRA' : '🔴 VENDA'}\n\n` +
      `💰 <b>Entrada:</b> R$ ${result.entryPrice.toFixed(2)}\n` +
      `${exitEmoji} <b>Saída:</b> R$ ${result.exitPrice.toFixed(2)} (${result.exitReason})\n\n` +
      `📊 <b>P&L:</b> R$ ${result.pnl.toFixed(2)} (${result.pnlPercent.toFixed(2)}%)\n` +
      `${emoji} <b>Resultado:</b> ${resultText}\n\n` +
      `📐 <b>Estratégia:</b> ${result.strategy}\n` +
      `🤖 <b>Agentes:</b> ${result.agents.join(', ')}\n` +
      `⏱️ <b>Tempo:</b> ${Math.round(result.holdTimeMs / 60000)} min\n\n` +
      `🧠 <b>Aprendizado:</b> ${result.outcome === 1 ? '1 (sucesso)' : '0 (erro)'}\n\n` +
      `⏰ ${new Date().toLocaleString('pt-BR')}\n\n` +
      `⚡ <b>VEXOR NEXUS-CORE</b>`;

    await telegramNotifier.sendMessage(message);

    // Salva notificação no banco
    try {
      await oracleDB.insert(`
        INSERT INTO trade_notifications (id, user_id, trade_id, type, message, telegram_sent, created_at)
        VALUES (:id, :userId, :tradeId, :type, :message, 1, CURRENT_TIMESTAMP)
      `, {
        id: oracleDB.generateId(),
        userId: position.userId,
        tradeId: result.tradeId,
        type: 'TRADE_CLOSED',
        message
      });
    } catch (e) {
      console.error('[TradeMonitor] Erro ao salvar notificação:', e);
    }
  }

  /**
   * Abre nova posição
   */
  async openPosition(data: {
    userId: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    entryPrice: number;
    stopPrice: number;
    targetPrice: number;
    strategy: string;
    agents: string[];
    confidence: number;
    broker: string;
  }): Promise<OpenPosition> {
    const position: OpenPosition = {
      id: oracleDB.generateId(),
      ...data,
      openedAt: new Date(),
      trailingActivated: false
    };

    this.positions.set(position.id, position);
    await this.savePosition(position);

    // Notifica abertura
    const emoji = data.side === 'BUY' ? '🟢' : '🔴';
    const message = 
      `${emoji} <b>NOVA POSIÇÃO ABERTA</b>\n\n` +
      `📊 <b>${data.symbol}</b>\n` +
      `💰 <b>Entrada:</b> R$ ${data.entryPrice.toFixed(2)}\n` +
      `🛑 <b>Stop:</b> R$ ${data.stopPrice.toFixed(2)}\n` +
      `🎯 <b>Alvo:</b> R$ ${data.targetPrice.toFixed(2)}\n` +
      `📦 <b>Qtd:</b> ${data.quantity}\n\n` +
      `📐 <b>Estratégia:</b> ${data.strategy}\n` +
      `🤖 <b>Agentes:</b> ${data.agents.join(', ')}\n\n` +
      `⚡ <b>VEXOR</b>`;

    await telegramNotifier.sendMessage(message);

    console.log(`[TradeMonitor] 📈 Posição aberta: ${data.symbol} ${data.side}`);
    return position;
  }

  /**
   * Salva posição no Oracle
   */
  private async savePosition(position: OpenPosition): Promise<void> {
    try {
      await oracleDB.insert(`
        INSERT INTO open_positions (
          id, user_id, symbol, side, quantity, entry_price, stop_price, target_price,
          strategy, agents, confidence, broker, trailing_stop, trailing_activated, opened_at
        ) VALUES (
          :id, :userId, :symbol, :side, :quantity, :entryPrice, :stopPrice, :targetPrice,
          :strategy, :agents, :confidence, :broker, :trailingStop, :trailingActivated, :openedAt
        )
      `, {
        id: position.id,
        userId: position.userId,
        symbol: position.symbol,
        side: position.side,
        quantity: position.quantity,
        entryPrice: position.entryPrice,
        stopPrice: position.stopPrice,
        targetPrice: position.targetPrice,
        strategy: position.strategy,
        agents: position.agents.join(','),
        confidence: position.confidence,
        broker: position.broker,
        trailingStop: position.trailingStop || null,
        trailingActivated: position.trailingActivated ? 1 : 0,
        openedAt: position.openedAt
      });
    } catch (e) {
      console.error('[TradeMonitor] Erro ao salvar posição:', e);
    }
  }

  /**
   * Remove posição do banco
   */
  private async deleteOpenPosition(id: string): Promise<void> {
    try {
      await oracleDB.update(`DELETE FROM open_positions WHERE id = :id`, { id });
    } catch (e) {
      console.error('[TradeMonitor] Erro ao deletar posição:', e);
    }
  }

  /**
   * Carrega posições abertas do banco (ao reiniciar)
   */
  async loadOpenPositions(): Promise<void> {
    try {
      const rows = await oracleDB.query<{
        ID: string;
        USER_ID: string;
        SYMBOL: string;
        SIDE: string;
        QUANTITY: number;
        ENTRY_PRICE: number;
        STOP_PRICE: number;
        TARGET_PRICE: number;
        STRATEGY: string;
        AGENTS: string;
        CONFIDENCE: number;
        BROKER: string;
        TRAILING_STOP: number | null;
        TRAILING_ACTIVATED: number;
        OPENED_AT: Date;
      }>(`SELECT * FROM open_positions`);

      for (const row of rows) {
        this.positions.set(row.ID, {
          id: row.ID,
          userId: row.USER_ID,
          symbol: row.SYMBOL,
          side: row.SIDE as 'BUY' | 'SELL',
          quantity: row.QUANTITY,
          entryPrice: row.ENTRY_PRICE,
          stopPrice: row.STOP_PRICE,
          targetPrice: row.TARGET_PRICE,
          strategy: row.STRATEGY,
          agents: row.AGENTS?.split(',') || [],
          confidence: row.CONFIDENCE,
          broker: row.BROKER,
          trailingStop: row.TRAILING_STOP || undefined,
          trailingActivated: row.TRAILING_ACTIVATED === 1,
          openedAt: row.OPENED_AT
        });
      }

      console.log(`[TradeMonitor] 📂 ${rows.length} posições carregadas do banco`);
    } catch (e) {
      console.error('[TradeMonitor] Erro ao carregar posições:', e);
    }
  }

  /**
   * Retorna todas as posições abertas
   */
  getOpenPositions(): OpenPosition[] {
    return Array.from(this.positions.values());
  }

  /**
   * Retorna estatísticas de aprendizado
   */
  async getLearningStats(): Promise<{
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    avgPnl: number;
    byStrategy: Map<string, { wins: number; losses: number; winRate: number }>;
  }> {
    try {
      const rows = await oracleDB.query<{
        OUTCOME: number;
        PNL: number;
        STRATEGY: string;
      }>(`SELECT outcome, pnl, strategy FROM learning_data`);

      let wins = 0;
      let losses = 0;
      let totalPnl = 0;
      const byStrategy = new Map<string, { wins: number; losses: number }>();

      for (const row of rows) {
        if (row.OUTCOME === 1) wins++;
        else losses++;
        totalPnl += row.PNL || 0;

        const strat = row.STRATEGY || 'unknown';
        const stats = byStrategy.get(strat) || { wins: 0, losses: 0 };
        if (row.OUTCOME === 1) stats.wins++;
        else stats.losses++;
        byStrategy.set(strat, stats);
      }

      const total = wins + losses;
      const resultByStrategy = new Map<string, { wins: number; losses: number; winRate: number }>();
      for (const [strat, stats] of byStrategy) {
        const total = stats.wins + stats.losses;
        resultByStrategy.set(strat, {
          ...stats,
          winRate: total > 0 ? stats.wins / total : 0
        });
      }

      return {
        totalTrades: total,
        wins,
        losses,
        winRate: total > 0 ? wins / total : 0,
        avgPnl: total > 0 ? totalPnl / total : 0,
        byStrategy: resultByStrategy
      };
    } catch (e) {
      console.error('[TradeMonitor] Erro ao obter stats:', e);
      return {
        totalTrades: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        avgPnl: 0,
        byStrategy: new Map()
      };
    }
  }

  /**
   * Cleanup
   */
  destroy(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
    }
  }
}

// Singleton
export const tradeMonitorService = new TradeMonitorService();
export type { OpenPosition, TradeResult };
