/**
 * CAMADA 4: MEMÓRIA
 * B3 RAM Cache, Crypto Cache, Feature Store, Strategy Memory
 */

import Redis from 'ioredis';

// ==================== RAM CACHE (<1ms) ====================
export class RAMCache {
  private cache: Map<string, { value: any; timestamp: number; ttl: number }> = new Map();
  private maxSize = 100000; // 100k itens

  set(key: string, value: any, ttlMs: number = 60000): void {
    // Evict old entries if full
    if (this.cache.size >= this.maxSize) {
      const oldest = [...this.cache.entries()]
        .sort((a, b) => a[1].timestamp - b[1].timestamp)
        .slice(0, 10000);
      for (const [k] of oldest) {
        this.cache.delete(k);
      }
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      ttl: ttlMs
    });
  }

  get(key: string): any | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  getMulti(keys: string[]): Map<string, any> {
    const result = new Map();
    for (const key of keys) {
      const value = this.get(key);
      if (value !== null) {
        result.set(key, value);
      }
    }
    return result;
  }

  clear(): void {
    this.cache.clear();
  }

  stats(): { size: number; maxSize: number; hitRate: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: 0 // TODO: implement hit tracking
    };
  }
}

// ==================== FEATURE STORE (Redis) ====================
export class FeatureStore {
  private redis: Redis | null = null;

  async connect(url: string = 'redis://localhost:6379'): Promise<void> {
    try {
      this.redis = new Redis(url);
      console.log('[FeatureStore] 🧠 Conectado ao Redis');
    } catch (e) {
      console.error('[FeatureStore] Erro ao conectar Redis:', e);
    }
  }

  async setIndicator(symbol: string, indicator: string, value: number, ttl: number = 3600): Promise<void> {
    if (!this.redis) return;
    const key = `feature:${symbol}:${indicator}`;
    await this.redis.set(key, value.toString(), 'EX', ttl);
  }

  async getIndicator(symbol: string, indicator: string): Promise<number | null> {
    if (!this.redis) return null;
    const key = `feature:${symbol}:${indicator}`;
    const value = await this.redis.get(key);
    return value ? parseFloat(value) : null;
  }

  async getAllIndicators(symbol: string): Promise<Record<string, number>> {
    if (!this.redis) return {};
    const keys = await this.redis.keys(`feature:${symbol}:*`);
    const result: Record<string, number> = {};
    
    for (const key of keys) {
      const indicator = key.split(':').pop() || '';
      const value = await this.redis.get(key);
      if (value) {
        result[indicator] = parseFloat(value);
      }
    }
    
    return result;
  }

  // Indicadores Técnicos
  async calculateAndStore(symbol: string, prices: number[]): Promise<void> {
    if (prices.length < 20) return;

    // SMA 20
    const sma20 = prices.slice(-20).reduce((a, b) => a + b, 0) / 20;
    await this.setIndicator(symbol, 'SMA20', sma20);

    // EMA 12
    const multiplier = 2 / (12 + 1);
    let ema12 = prices[0];
    for (const price of prices.slice(1)) {
      ema12 = (price - ema12) * multiplier + ema12;
    }
    await this.setIndicator(symbol, 'EMA12', ema12);

    // RSI 14
    let gains = 0, losses = 0;
    for (let i = 1; i < Math.min(15, prices.length); i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) gains += change;
      else losses -= change;
    }
    const avgGain = gains / 14;
    const avgLoss = losses / 14;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));
    await this.setIndicator(symbol, 'RSI14', rsi);

    // Bollinger Bands
    const std = Math.sqrt(prices.slice(-20).reduce((sum, p) => sum + Math.pow(p - sma20, 2), 0) / 20);
    await this.setIndicator(symbol, 'BB_UPPER', sma20 + 2 * std);
    await this.setIndicator(symbol, 'BB_LOWER', sma20 - 2 * std);
    await this.setIndicator(symbol, 'BB_MID', sma20);

    // ATR 14
    let atrSum = 0;
    for (let i = 1; i < Math.min(15, prices.length); i++) {
      const high = prices[i];
      const low = prices[i - 1];
      const prevClose = prices[i - 1];
      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      atrSum += tr;
    }
    await this.setIndicator(symbol, 'ATR14', atrSum / 14);
  }
}

// ==================== STRATEGY MEMORY (PostgreSQL) ====================
export class StrategyMemory {
  private trades: Array<{
    id: string;
    symbol: string;
    action: 'BUY' | 'SELL';
    entry: number;
    exit?: number;
    pnl?: number;
    strategy: string;
    agents: string[];
    timestamp: Date;
    outcome: 'WIN' | 'LOSS' | 'PENDING';
    holdTime?: number;
  }> = [];

  async recordTrade(trade: {
    symbol: string;
    action: 'BUY' | 'SELL';
    entry: number;
    strategy: string;
    agents: string[];
  }): Promise<string> {
    const id = `trade-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    this.trades.push({
      id,
      ...trade,
      timestamp: new Date(),
      outcome: 'PENDING'
    });

    return id;
  }

  async closeTrade(id: string, exit: number, pnl: number): Promise<void> {
    const trade = this.trades.find(t => t.id === id);
    if (trade) {
      trade.exit = exit;
      trade.pnl = pnl;
      trade.outcome = pnl >= 0 ? 'WIN' : 'LOSS';
      trade.holdTime = Date.now() - trade.timestamp.getTime();
    }
  }

  async getStats(): Promise<{
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    avgPnl: number;
    totalPnl: number;
    avgHoldTime: number;
  }> {
    const closed = this.trades.filter(t => t.outcome !== 'PENDING');
    const wins = closed.filter(t => t.outcome === 'WIN').length;
    const losses = closed.filter(t => t.outcome === 'LOSS').length;
    const totalPnl = closed.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const avgHoldTime = closed.reduce((sum, t) => sum + (t.holdTime || 0), 0) / closed.length;

    return {
      totalTrades: this.trades.length,
      wins,
      losses,
      winRate: closed.length > 0 ? wins / closed.length : 0,
      avgPnl: closed.length > 0 ? totalPnl / closed.length : 0,
      totalPnl,
      avgHoldTime: avgHoldTime || 0
    };
  }

  async getTradesByStrategy(strategy: string): Promise<typeof this.trades> {
    return this.trades.filter(t => t.strategy === strategy);
  }

  async getTradesBySymbol(symbol: string): Promise<typeof this.trades> {
    return this.trades.filter(t => t.symbol === symbol);
  }
}

// Export singletons
export const ramCache = new RAMCache();
export const featureStore = new FeatureStore();
export const strategyMemory = new StrategyMemory();
