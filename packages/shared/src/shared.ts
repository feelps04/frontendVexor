export class BrapiClient {
  constructor(_options?: { token?: string }) {}
  async getQuote(_symbol: string): Promise<any> { return {}; }
  async getHistorical(_symbol: string, _interval: string): Promise<any> { return {}; }
  toJSON(): any { return {}; }
}

export class MercadoBitcoinClient {
  constructor() {}
  async getTicker(_pair: string): Promise<any> { return {}; }
  async getOrderBook(_pair: string): Promise<any> { return {}; }
  async getBtcBrlTicker(): Promise<any> { return {}; }
  toJSON(): any { return {}; }
}

export type Mt5Timeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1' | 'W1' | 'MN1';
export type Mt5Interval = '1m' | '5m' | '15m' | '30m' | '60m' | '240' | '1440' | '10080' | '43200';

export class CurrencyConverter {
  static convert(amount: number, from: string, to: string): number {
    return amount;
  }
  static convertToBRLWithRate(amount: number, rate: number): number {
    return amount * rate;
  }
}

export function validateBankCode(code: string): boolean {
  return code.length === 3;
}

export class RedisCacheService {
  constructor() {}
  async connect(_url: string, _logger?: any): Promise<void> {}
  async get(key: string): Promise<any> {
    return null;
  }
  async set(key: string, value: any, ttl?: number): Promise<void> {
    return;
  }
  async getRecentCandles(_key: string, _limit: number): Promise<any[]> {
    return [];
  }
}

export class OperationLockService {
  constructor() {}
  async connect(_redis: any, _logger?: any): Promise<void> {}
  async acquire(_key: string, _ttl: number): Promise<boolean> {
    return true;
  }
  async release(_key: string): Promise<void> {}
}

export function createLogger(_name: string): any {
  return {
    info: (...args: any[]) => console.log(...args),
    warn: (...args: any[]) => console.warn(...args),
    error: (...args: any[]) => console.error(...args),
    debug: (...args: any[]) => console.log(...args),
    child: () => createLogger(_name),
  };
}

export interface SharedConfig {
  apiUrl: string;
  wsUrl: string;
}

export class Shared {
  constructor(config: SharedConfig) {
    this.config = config;
  }

  private config: SharedConfig;

  getConfig(): SharedConfig {
    return this.config;
  }
}
