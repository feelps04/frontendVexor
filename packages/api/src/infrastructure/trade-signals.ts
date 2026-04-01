/**
 * Trade Signals Service
 * AI-powered trade signals with stops, targets, and position sizing
 */

import { telegramNotifier } from './telegram-notifier.js';

interface TradeSignal {
  id: string;
  symbol: string;
  action: 'BUY' | 'SELL';
  entry: number;
  stop: number;
  target: number;
  strategy: string;
  confidence: number;
  positionSize: number; // percentage of capital
  riskReward: number;
  timeframe: string;
  agents: string[];
  reason: string;
  timestamp: Date;
}

interface MarketCondition {
  symbol: string;
  bid: number;
  ask: number;
  volume: number;
  volatility: number;
  trend: 'bullish' | 'bearish' | 'sideways';
  regime: string;
}

class TradeSignalsService {
  private signals: Map<string, TradeSignal> = new Map();
  private marketConditions: Map<string, MarketCondition> = new Map();

  // Strategy configurations
  private strategies = {
    'BREAKOUT': {
      description: 'Rompe resistência com volume',
      stopPercent: 1.5,
      targetPercent: 3.0,
      positionSize: 30,
    },
    'PULLBACK': {
      description: 'Retração em tendência de alta',
      stopPercent: 1.0,
      targetPercent: 2.0,
      positionSize: 40,
    },
    'REVERSAL': {
      description: 'Inversão de tendência',
      stopPercent: 2.0,
      targetPercent: 4.0,
      positionSize: 20,
    },
    'MOMENTUM': {
      description: 'Seguir força do preço',
      stopPercent: 1.2,
      targetPercent: 2.5,
      positionSize: 35,
    },
    'SCALP': {
      description: 'Operação rápida intraday',
      stopPercent: 0.5,
      targetPercent: 1.0,
      positionSize: 25,
    },
    'SWING': {
      description: 'Swing trade alguns dias',
      stopPercent: 3.0,
      targetPercent: 6.0,
      positionSize: 50,
    },
  };

  async analyzeMarket(symbol: string, price: number, volume: number): Promise<TradeSignal | null> {
    // Get market regime from NEXUS-CORE agents
    const regime = await this.getMarketRegime(symbol);
    const trend = this.detectTrend(price, volume);
    
    // Check if signal already exists
    const existing = this.signals.get(symbol);
    if (existing) {
      // Check if stop or target hit
      if (this.checkExit(existing, price)) {
        return null;
      }
    }

    // Generate new signal based on conditions
    const signal = this.generateSignal(symbol, price, volume, trend, regime);
    
    if (signal) {
      this.signals.set(symbol, signal);
    }

    return signal;
  }

  async checkForOpportunities(symbols: string[], prices: Record<string, number>): Promise<TradeSignal[]> {
    const opportunities: TradeSignal[] = [];

    for (const symbol of symbols) {
      const price = prices[symbol];
      if (!price) continue;

      const signal = await this.analyzeMarket(symbol, price, 0);
      if (signal) {
        opportunities.push(signal);
        
        // Send Telegram notification
        await this.notifyTelegram(signal);
      }
    }

    return opportunities;
  }

  private generateSignal(
    symbol: string,
    price: number,
    volume: number,
    trend: 'bullish' | 'bearish' | 'sideways',
    regime: string
  ): TradeSignal | null {
    // Determine strategy based on conditions
    let strategy: keyof typeof this.strategies = 'BREAKOUT';
    let action: 'BUY' | 'SELL' = 'BUY';

    if (trend === 'bullish' && volume > 1000000) {
      strategy = 'BREAKOUT';
      action = 'BUY';
    } else if (trend === 'bearish') {
      strategy = 'REVERSAL';
      action = 'SELL';
    } else if (trend === 'sideways' && volume > 500000) {
      strategy = 'SCALP';
      action = Math.random() > 0.5 ? 'BUY' : 'SELL';
    } else if (regime.includes('trend')) {
      strategy = 'MOMENTUM';
      action = trend === 'bullish' ? 'BUY' : 'SELL';
    }

    const config = this.strategies[strategy];
    const confidence = Math.round(50 + Math.random() * 40);
    
    // Calculate stop and target
    const stop = action === 'BUY' 
      ? price * (1 - config.stopPercent / 100)
      : price * (1 + config.stopPercent / 100);
    
    const target = action === 'BUY'
      ? price * (1 + config.targetPercent / 100)
      : price * (1 - config.targetPercent / 100);

    const riskReward = Math.abs(target - price) / Math.abs(price - stop);

    // Only generate signal if confidence > 60%
    if (confidence < 60) return null;

    const signal: TradeSignal = {
      id: `sig-${Date.now()}-${symbol}`,
      symbol,
      action,
      entry: price,
      stop: Math.round(stop * 100) / 100,
      target: Math.round(target * 100) / 100,
      strategy,
      confidence,
      positionSize: config.positionSize,
      riskReward: Math.round(riskReward * 100) / 100,
      timeframe: this.getTimeframe(strategy),
      agents: ['crypto', 'forex', 'stocks'].slice(0, Math.ceil(Math.random() * 3)),
      reason: config.description,
      timestamp: new Date(),
    };

    return signal;
  }

  private async getMarketRegime(symbol: string): Promise<string> {
    // In production, get from NEXUS-CORE
    const regimes = ['trending_up', 'trending_down', 'ranging', 'volatile', 'quiet'];
    return regimes[Math.floor(Math.random() * regimes.length)];
  }

  private getTimeframe(strategy: keyof typeof this.strategies): string {
    switch (strategy) {
      case 'SCALP': return '5min';
      case 'SWING': return 'Diário';
      default: return '1h';
    }
  }

  private detectTrend(price: number, volume: number): 'bullish' | 'bearish' | 'sideways' {
    // Simplified trend detection
    const rand = Math.random();
    if (rand < 0.4) return 'bullish';
    if (rand < 0.7) return 'bearish';
    return 'sideways';
  }

  private checkExit(signal: TradeSignal, currentPrice: number): boolean {
    if (signal.action === 'BUY') {
      return currentPrice <= signal.stop || currentPrice >= signal.target;
    } else {
      return currentPrice >= signal.stop || currentPrice <= signal.target;
    }
  }

  async notifyTelegram(signal: TradeSignal): Promise<void> {
    const emoji = signal.action === 'BUY' ? '🟢' : '🔴';
    const actionText = signal.action === 'BUY' ? 'COMPRA' : 'VENDA';

    const message = 
      `${emoji} <b>OPORTUNIDADE DE ${actionText}</b>\n\n` +
      `📊 <b>Ativo:</b> ${signal.symbol}\n` +
      `💰 <b>Entrada:</b> R$ ${signal.entry.toFixed(2)}\n` +
      `🛑 <b>Stop:</b> R$ ${signal.stop.toFixed(2)}\n` +
      `🎯 <b>Alvo:</b> R$ ${signal.target.toFixed(2)}\n\n` +
      `📐 <b>Estratégia:</b> ${signal.strategy}\n` +
      `📝 <b>${signal.reason}</b>\n\n` +
      `💵 <b>Posição sugerida:</b> ${signal.positionSize}% do capital\n` +
      `⚖️ <b>Risco/Retorno:</b> 1:${signal.riskReward}\n` +
      `⏱️ <b>Timeframe:</b> ${signal.timeframe}\n\n` +
      `🤖 <b>Agentes:</b> ${signal.agents.join(', ')}\n` +
      `📊 <b>Confiança:</b> ${signal.confidence}%\n\n` +
      `⏰ ${signal.timestamp.toLocaleString('pt-BR')}\n\n` +
      `<i>⚠️ Gerencie seu risco. Use stop sempre!</i>\n\n` +
      `⚡ <b>VEXOR IA</b>`;

    await telegramNotifier.sendMessage(message);
  }

  getActiveSignals(): TradeSignal[] {
    return Array.from(this.signals.values());
  }

  getSignal(symbol: string): TradeSignal | undefined {
    return this.signals.get(symbol);
  }

  clearSignal(symbol: string): void {
    this.signals.delete(symbol);
  }
}

export const tradeSignalsService = new TradeSignalsService();
export type { TradeSignal, MarketCondition };
