/**
 * CAMADA 8: EXECUÇÃO E OUTPUT
 * Order Router, Execution Engine, Fill Handler, Fee Optimizer, Reconciliation
 */

import { telegramNotifier } from '../../telegram-notifier.js';

// ==================== ORDER ROUTER ====================
export class OrderRouter {
  private routes: Map<string, { venue: string; latency: number; fee: number }> = new Map();

  constructor() {
    // Configura rotas
    this.routes.set('B3', { venue: 'genial', latency: 50, fee: 0.00025 });
    this.routes.set('BINANCE', { venue: 'binance', latency: 20, fee: 0.00075 });
    this.routes.set('OANDA', { venue: 'oanda', latency: 30, fee: 0.0001 });
  }

  /**
   * Smart Routing - escolhe melhor venue
   */
  route(order: {
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    exchange: 'B3' | 'BINANCE' | 'OANDA';
  }): {
    venue: string;
    expectedLatency: number;
    estimatedFee: number;
    route: string;
  } {
    const route = this.routes.get(order.exchange) || { venue: 'unknown', latency: 100, fee: 0.001 };

    return {
      venue: route.venue,
      expectedLatency: route.latency,
      estimatedFee: order.quantity * route.fee,
      route: `${order.exchange} → ${route.venue}`
    };
  }
}

// ==================== EXECUTION ENGINE ====================
export class ExecutionEngine {
  /**
   * TWAP (Time-Weighted Average Price)
   */
  async executeTWAP(order: {
    symbol: string;
    side: 'BUY' | 'SELL';
    totalQuantity: number;
    durationMinutes: number;
    exchange: string;
  }): Promise<{
    fills: Array<{ price: number; quantity: number; timestamp: Date }>;
    avgPrice: number;
    totalQuantity: number;
    slippage: number;
  }> {
    const slices = Math.ceil(order.durationMinutes / 5); // 5 min per slice
    const quantityPerSlice = order.totalQuantity / slices;
    const fills: Array<{ price: number; quantity: number; timestamp: Date }> = [];

    // Simula execução (em produção conecta ao broker)
    for (let i = 0; i < slices; i++) {
      fills.push({
        price: 0, // Será preenchido pelo broker
        quantity: quantityPerSlice,
        timestamp: new Date(Date.now() + i * 5 * 60 * 1000)
      });
    }

    return {
      fills,
      avgPrice: 0,
      totalQuantity: order.totalQuantity,
      slippage: 0
    };
  }

  /**
   * VWAP (Volume-Weighted Average Price)
   */
  async executeVWAP(order: {
    symbol: string;
    side: 'BUY' | 'SELL';
    totalQuantity: number;
    exchange: string;
  }): Promise<{
    fills: Array<{ price: number; quantity: number; timestamp: Date }>;
    vwap: number;
    slippage: number;
  }> {
    // Em produção, usa volume profile para determinar slices
    return {
      fills: [],
      vwap: 0,
      slippage: 0
    };
  }
}

// ==================== FILL HANDLER ====================
export class FillHandler {
  private partialFills: Map<string, Array<{ price: number; quantity: number }>> = new Map();

  /**
   * Processa fill parcial
   */
  processFill(orderId: string, fill: { price: number; quantity: number; isComplete: boolean }): {
    filledQuantity: number;
    avgPrice: number;
    remainingQuantity: number;
    status: 'FILLED' | 'PARTIAL' | 'PENDING';
  } {
    const fills = this.partialFills.get(orderId) || [];
    fills.push(fill);
    this.partialFills.set(orderId, fills);

    const totalFilled = fills.reduce((sum, f) => sum + f.quantity, 0);
    const avgPrice = fills.reduce((sum, f) => sum + f.price * f.quantity, 0) / totalFilled;

    return {
      filledQuantity: totalFilled,
      avgPrice: Math.round(avgPrice * 100) / 100,
      remainingQuantity: 0, // TODO: track original quantity
      status: fill.isComplete ? 'FILLED' : 'PARTIAL'
    };
  }

  /**
   * Estatísticas de fills
   */
  getStats(): { totalFills: number; totalQuantity: number; avgPrice: number } {
    let totalFills = 0;
    let totalQuantity = 0;
    let priceSum = 0;

    for (const fills of this.partialFills.values()) {
      for (const fill of fills) {
        totalFills++;
        totalQuantity += fill.quantity;
        priceSum += fill.price * fill.quantity;
      }
    }

    return {
      totalFills,
      totalQuantity,
      avgPrice: totalQuantity > 0 ? priceSum / totalQuantity : 0
    };
  }
}

// ==================== FEE OPTIMIZER ====================
export class FeeOptimizer {
  /**
   * Calcula fees e otimiza
   */
  calculateFees(trade: {
    exchange: 'B3' | 'BINANCE' | 'OANDA';
    quantity: number;
    price: number;
    side: 'BUY' | 'SELL';
  }): {
    exchangeFee: number;
    brokerFee: number;
    totalFees: number;
    suggestion: string;
  } {
    let exchangeFee = 0;
    let brokerFee = 0;
    let suggestion = '';

    switch (trade.exchange) {
      case 'B3':
        exchangeFee = trade.quantity * trade.price * 0.00025; // 0.025%
        brokerFee = trade.quantity * trade.price * 0.0005; // 0.05%
        suggestion = 'Usar ordens limitadas para reduzir spread';
        break;
      case 'BINANCE':
        exchangeFee = trade.quantity * trade.price * 0.00075; // 0.075% maker
        brokerFee = 0;
        suggestion = 'Usar BNB para 25% de desconto';
        break;
      case 'OANDA':
        exchangeFee = 0; // Spread only
        brokerFee = trade.quantity * trade.price * 0.0001;
        suggestion = 'Negociar spread em lotes grandes';
        break;
    }

    return {
      exchangeFee: Math.round(exchangeFee * 100) / 100,
      brokerFee: Math.round(brokerFee * 100) / 100,
      totalFees: Math.round((exchangeFee + brokerFee) * 100) / 100,
      suggestion
    };
  }

  /**
   * Total de fees acumulados
   */
  private totalFeesAccumulated = 0;

  addFees(fees: number): void {
    this.totalFeesAccumulated += fees;
  }

  getTotalFees(): number {
    return this.totalFeesAccumulated;
  }
}

// ==================== RECONCILIATION ====================
export class Reconciliation {
  private positions: Map<string, {
    symbol: string;
    quantity: number;
    avgPrice: number;
    currentPrice: number;
    unrealizedPnl: number;
    realizedPnl: number;
  }> = new Map();

  private dailyPnL = 0;
  private trades: Array<{
    id: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    price: number;
    pnl: number;
    timestamp: Date;
  }> = [];

  /**
   * Atualiza posição após trade
   */
  updatePosition(trade: {
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    price: number;
    fees: number;
  }): void {
    const existing = this.positions.get(trade.symbol);

    if (trade.side === 'BUY') {
      if (existing) {
        const newQuantity = existing.quantity + trade.quantity;
        const newAvgPrice = (existing.avgPrice * existing.quantity + trade.price * trade.quantity) / newQuantity;
        existing.quantity = newQuantity;
        existing.avgPrice = newAvgPrice;
      } else {
        this.positions.set(trade.symbol, {
          symbol: trade.symbol,
          quantity: trade.quantity,
          avgPrice: trade.price,
          currentPrice: trade.price,
          unrealizedPnl: 0,
          realizedPnl: 0
        });
      }
    } else {
      if (existing) {
        const pnl = (trade.price - existing.avgPrice) * trade.quantity - trade.fees;
        existing.realizedPnl += pnl;
        existing.quantity -= trade.quantity;
        this.dailyPnL += pnl;

        this.trades.push({
          id: `trade-${Date.now()}`,
          symbol: trade.symbol,
          side: trade.side,
          quantity: trade.quantity,
          price: trade.price,
          pnl,
          timestamp: new Date()
        });

        if (existing.quantity <= 0) {
          this.positions.delete(trade.symbol);
        }
      }
    }
  }

  /**
   * Atualiza P&L em tempo real
   */
  updatePnL(prices: Map<string, number>): {
    totalUnrealizedPnl: number;
    totalRealizedPnl: number;
    dailyPnL: number;
    positions: Array<{
      symbol: string;
      quantity: number;
      avgPrice: number;
      currentPrice: number;
      unrealizedPnl: number;
      realizedPnl: number;
    }>;
  } {
    let totalUnrealizedPnl = 0;

    for (const [symbol, position] of this.positions) {
      const currentPrice = prices.get(symbol) || position.avgPrice;
      position.currentPrice = currentPrice;
      position.unrealizedPnl = (currentPrice - position.avgPrice) * position.quantity;
      totalUnrealizedPnl += position.unrealizedPnl;
    }

    return {
      totalUnrealizedPnl,
      totalRealizedPnl: Array.from(this.positions.values()).reduce((sum, p) => sum + p.realizedPnl, 0),
      dailyPnL: this.dailyPnL,
      positions: Array.from(this.positions.values())
    };
  }

  /**
   * Relatório de performance
   */
  getPerformanceReport(): {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    avgWin: number;
    avgLoss: number;
    profitFactor: number;
    sharpe: number;
  } {
    const wins = this.trades.filter(t => t.pnl > 0);
    const losses = this.trades.filter(t => t.pnl < 0);

    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 0;

    return {
      totalTrades: this.trades.length,
      winningTrades: wins.length,
      losingTrades: losses.length,
      winRate: this.trades.length > 0 ? wins.length / this.trades.length : 0,
      avgWin,
      avgLoss,
      profitFactor: avgLoss > 0 ? avgWin / avgLoss : 0,
      sharpe: 0 // TODO: calculate with returns
    };
  }
}

// ==================== OUTPUT / ALERT SYSTEM ====================
export class AlertSystem {
  /**
   * Envia alerta de trade via Telegram
   */
  async sendTradeAlert(trade: {
    symbol: string;
    action: 'BUY' | 'SELL';
    entry: number;
    stop: number;
    target: number;
    quantity: number;
    strategy: string;
    confidence: number;
    agents: string[];
  }): Promise<void> {
    const emoji = trade.action === 'BUY' ? '🟢' : '🔴';
    
    const message = 
      `${emoji} <b>TRADE EXECUTADO</b>\n\n` +
      `📊 <b>${trade.symbol}</b>\n` +
      `💰 <b>Entrada:</b> R$ ${trade.entry.toFixed(2)}\n` +
      `🛑 <b>Stop:</b> R$ ${trade.stop.toFixed(2)}\n` +
      `🎯 <b>Alvo:</b> R$ ${trade.target.toFixed(2)}\n` +
      `📦 <b>Qtd:</b> ${trade.quantity}\n\n` +
      `📐 <b>Estratégia:</b> ${trade.strategy}\n` +
      `📊 <b>Confiança:</b> ${trade.confidence}%\n` +
      `🤖 <b>Agentes:</b> ${trade.agents.join(', ')}\n\n` +
      `⏰ ${new Date().toLocaleString('pt-BR')}\n\n` +
      `⚡ <b>VEXOR NEXUS-CORE</b>`;

    await telegramNotifier.sendMessage(message);
  }

  /**
   * Envia relatório diário
   */
  async sendDailyReport(data: {
    dailyPnL: number;
    trades: number;
    winRate: number;
    sharpe: number;
  }): Promise<void> {
    const emoji = data.dailyPnL >= 0 ? '📈' : '📉';

    const message = 
      `📊 <b>RELATÓRIO DIÁRIO</b>\n\n` +
      `${emoji} <b>P&L:</b> R$ ${data.dailyPnL.toFixed(2)}\n` +
      `🔄 <b>Trades:</b> ${data.trades}\n` +
      `✅ <b>Win Rate:</b> ${(data.winRate * 100).toFixed(1)}%\n` +
      `📊 <b>Sharpe:</b> ${data.sharpe.toFixed(2)}\n\n` +
      `⏰ ${new Date().toLocaleString('pt-BR')}\n\n` +
      `⚡ <b>VEXOR</b>`;

    await telegramNotifier.sendMessage(message);
  }
}

// Export singletons
export const orderRouter = new OrderRouter();
export const executionEngine = new ExecutionEngine();
export const fillHandler = new FillHandler();
export const feeOptimizer = new FeeOptimizer();
export const reconciliation = new Reconciliation();
export const alertSystem = new AlertSystem();
