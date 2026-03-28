/**
 * CAMADA 3: NORMALIZER
 * Schema Unify - Pipeline ETL
 */

// Schema unificado para todos os ativos
export interface UnifiedTick {
  // Identificação
  symbol: string;
  exchange: 'B3' | 'BINANCE' | 'OANDA' | 'BCB' | 'YAHOO';
  sector: number; // 001-052
  
  // Preços
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  spreadPct: number;
  
  // Volume
  volume: number;
  volume24h?: number;
  
  // Timestamps
  timestamp: Date;
  receivedAt: Date;
  latencyMs: number;
  
  // Metadados
  source: string;
  quality: 'REAL' | 'DELAYED' | 'ESTIMATED';
  
  // Contexto
  dayHigh?: number;
  dayLow?: number;
  dayOpen?: number;
  dayClose?: number;
  previousClose?: number;
  change?: number;
  changePct?: number;
}

export class Normalizer {
  /**
   * Normaliza tick da B3 (MMF)
   */
  normalizeB3(raw: any): UnifiedTick {
    const bid = Number(raw.b || raw.bid || 0);
    const ask = Number(raw.a || raw.ask || 0);
    const mid = (bid + ask) / 2;
    
    return {
      symbol: raw.s || raw.symbol,
      exchange: 'B3',
      sector: this.getSector(raw.s || raw.symbol),
      bid,
      ask,
      mid,
      spread: ask - bid,
      spreadPct: ((ask - bid) / mid) * 100,
      volume: Number(raw.v || raw.volume || 0),
      timestamp: new Date(raw.t || raw.timestamp || Date.now()),
      receivedAt: new Date(),
      latencyMs: Date.now() - Number(raw.t || Date.now()),
      source: raw.br || raw.broker || 'genial',
      quality: 'REAL',
      dayHigh: raw.h || raw.dayHigh,
      dayLow: raw.l || raw.dayLow,
    };
  }

  /**
   * Normaliza tick da Binance
   */
  normalizeBinance(raw: any): UnifiedTick {
    const bid = Number(raw.b || raw.bidPrice || 0);
    const ask = Number(raw.a || raw.askPrice || 0);
    const mid = (bid + ask) / 2;
    
    return {
      symbol: raw.s || raw.symbol,
      exchange: 'BINANCE',
      sector: 29,
      bid,
      ask,
      mid,
      spread: ask - bid,
      spreadPct: ((ask - bid) / mid) * 100,
      volume: Number(raw.v || raw.volume || 0),
      volume24h: Number(raw.V || raw.quoteVolume || 0),
      timestamp: new Date(raw.E || raw.eventTime || Date.now()),
      receivedAt: new Date(),
      latencyMs: Date.now() - Number(raw.E || Date.now()),
      source: 'binance',
      quality: 'REAL',
    };
  }

  /**
   * Normaliza dados do BCB
   */
  normalizeBCB(raw: any, indicator: string): UnifiedTick {
    const value = Number(raw.valor || raw.value || 0);
    
    return {
      symbol: indicator,
      exchange: 'BCB',
      sector: 48,
      bid: value,
      ask: value,
      mid: value,
      spread: 0,
      spreadPct: 0,
      volume: 0,
      timestamp: new Date(raw.data || raw.timestamp || Date.now()),
      receivedAt: new Date(),
      latencyMs: 0,
      source: 'bcb-sgs',
      quality: 'REAL',
    };
  }

  /**
   * Normaliza dados do Yahoo Finance
   */
  normalizeYahoo(raw: any): UnifiedTick {
    const price = Number(raw.regularMarketPrice || 0);
    
    return {
      symbol: raw.symbol,
      exchange: 'YAHOO',
      sector: 52,
      bid: price,
      ask: price,
      mid: price,
      spread: 0,
      spreadPct: 0,
      volume: Number(raw.regularMarketVolume || 0),
      timestamp: new Date(raw.regularMarketTime * 1000 || Date.now()),
      receivedAt: new Date(),
      latencyMs: 0,
      source: 'yahoo',
      quality: 'DELAYED',
      dayHigh: Number(raw.regularMarketDayHigh || price),
      dayLow: Number(raw.regularMarketDayLow || price),
      dayOpen: Number(raw.regularMarketOpen || price),
      previousClose: Number(raw.regularMarketPreviousClose || price),
      change: Number(raw.regularMarketChange || 0),
      changePct: Number(raw.regularMarketChangePercent || 0),
    };
  }

  /**
   * Determina setor do símbolo
   */
  getSector(symbol: string): number {
    if (symbol.includes('USDT') || symbol.includes('BRL')) return 29;
    if (symbol.startsWith('^')) return 52;
    if (['EURUSD', 'GBPUSD', 'USDJPY'].some(p => symbol.includes(p))) return 39;
    if (['SELIC', 'IPCA', 'CDI'].includes(symbol)) return 48;
    if (symbol.endsWith('FUT')) return 21;
    return 1; // Ações B3
  }
}

export const normalizer = new Normalizer();
