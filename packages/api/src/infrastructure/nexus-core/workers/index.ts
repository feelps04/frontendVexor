/**
 * CAMADA 2: WORKERS
 * B3 Worker, Crypto Worker, Forex Worker, Macro Worker
 * 
 * Integração MMF:
 *   - Local\B3RAM (Genial MT5) → B3Worker
 *   - Local\GLOBALRAM (Pepperstone MT5) → ForexWorker
 */

import WebSocket from 'ws';
import type { IncomingMessage } from 'http';
import { globalRAMReader, b3RAMReader, MMFReader, TickData } from '../../mmf-reader.js';

// ==================== B3 WORKER (SETOR 001-028) ====================
export class B3Worker {
  private mmfName = 'Local\\B3RAM';
  private isRunning = false;
  private reader: MMFReader = b3RAMReader;
  
  async start(): Promise<void> {
    this.isRunning = true;
    console.log('[B3Worker] 🏭 Iniciando - Setores 001-028 (MMF B3RAM)');
    
    // Conecta no MMF do Sentinel_RAM (Genial)
    const connected = await this.reader.connect();
    if (connected) {
      this.reader.startPolling(100);
      this.reader.on('tick', (tick: TickData) => {
        // Emite para NEXUS-CORE
        this.processTick(tick);
      });
    }
  }

  private processTick(tick: TickData): void {
    // Converte símbolo B3 para formato padrão
    const symbol = tick.symbol;
    console.log(`[B3Worker] 📊 ${symbol} | BID: ${tick.bid} | ASK: ${tick.ask}`);
  }

  async getTick(symbol: string): Promise<{ bid: number; ask: number; volume: bigint } | null> {
    const tick = await this.reader.findTick(symbol);
    if (tick) {
      return { bid: tick.bid, ask: tick.ask, volume: tick.volume };
    }
    return null;
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    this.reader.disconnect();
  }
}

// ==================== CRYPTO WORKER (SETOR 029) ====================
export class CryptoWorker {
  private ws: WebSocket | null = null;
  private isRunning = false;
  private callbacks: Map<string, (data: any) => void> = new Map();

  async start(): Promise<void> {
    this.isRunning = true;
    console.log('[CryptoWorker] 🏭 Iniciando - Setor 029 (WebSocket Async)');
    
    // Conecta na Binance WebSocket
    this.connectBinance();
  }

  private connectBinance(): void {
    const streams = [
      'btcusdt@ticker', 'ethusdt@ticker', 'bnbusdt@ticker',
      'xrpusdt@ticker', 'adausdt@ticker', 'dogeusdt@ticker',
      'solusdt@ticker', 'maticusdt@ticker', 'dotusdt@ticker'
    ];
    
    const url = `wss://stream.binance.com:9443/ws/${streams.join('/')}`;
    
    this.ws = new WebSocket(url);
    
    this.ws.on('message', (data: Buffer) => {
      try {
        const tick = JSON.parse(data.toString());
        const symbol = tick.s?.replace('USDT', '/USDT') || tick.s;
        this.callbacks.forEach(cb => cb({ symbol, bid: tick.b, ask: tick.a, volume: tick.v }));
      } catch (e) {
        // ignore
      }
    });

    this.ws.on('error', (err) => {
      console.error('[CryptoWorker] WebSocket error:', err.message);
    });

    this.ws.on('close', () => {
      if (this.isRunning) {
        setTimeout(() => this.connectBinance(), 5000);
      }
    });
  }

  onTick(callback: (data: any) => void): void {
    const id = Math.random().toString(36);
    this.callbacks.set(id, callback);
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.ws) this.ws.close();
  }
}

// ==================== FOREX WORKER (SETOR 039) ====================
export class ForexWorker {
  private isRunning = false;
  private reader: MMFReader = globalRAMReader;
  private rates: Map<string, { bid: number; ask: number; timestamp: Date }> = new Map();
  
  // Setores cobertos pelo SentinelEuropa_RAM (Pepperstone)
  // sector_029: Cripto Spot (41 símbolos)
  // sector_036: Moedas Divisas Spot (31 símbolos)
  // sector_039: Pares Cambiais (24 símbolos)
  // sector_008: Ações Globais NYSE/NASDAQ (49 símbolos)
  // sector_052: Índices Globais (28 símbolos)
  // sector_023: Commodities Energia (14 símbolos)
  // sector_025: Commodities Metais (9 símbolos)

  async start(): Promise<void> {
    this.isRunning = true;
    console.log('[ForexWorker] 🏭 Iniciando - Setores 029/036/039/008/052/023/025');
    console.log('[ForexWorker] 📊 Conectando GLOBALRAM (Pepperstone MT5)');
    
    // Conecta no MMF do SentinelEuropa_RAM
    const connected = await this.reader.connect();
    if (connected) {
      this.reader.startPolling(50); // 50ms = mesma frequência do EA
      this.reader.on('tick', (tick: TickData) => {
        this.processTick(tick);
      });
    }
  }

  private processTick(tick: TickData): void {
    // Normaliza símbolo (EURUSD → EUR/USD)
    let symbol = tick.symbol;
    
    // Converte formato MT5 para padrão
    if (symbol.length === 6 && !symbol.includes('/')) {
      // Forex pair: EURUSD → EUR/USD
      symbol = symbol.slice(0, 3) + '/' + symbol.slice(3);
    }
    
    this.rates.set(symbol, {
      bid: tick.bid,
      ask: tick.ask,
      timestamp: new Date(Number(tick.timestamp))
    });
    
    // Log apenas para pares principais
    if (['EUR/USD', 'GBP/USD', 'USD/JPY'].includes(symbol)) {
      console.log(`[ForexWorker] � ${symbol} | ${tick.bid}/${tick.ask} | HB: ${tick.heartbeat}`);
    }
  }

  async getRate(pair: string): Promise<{ bid: number; ask: number; spread: number } | null> {
    // Busca do cache local
    const rate = this.rates.get(pair);
    if (rate) {
      return {
        bid: rate.bid,
        ask: rate.ask,
        spread: rate.ask - rate.bid
      };
    }
    
    // Busca direto do MMF
    const tick = await this.reader.findTick(pair.replace('/', ''));
    if (tick) {
      return {
        bid: tick.bid,
        ask: tick.ask,
        spread: tick.ask - tick.bid
      };
    }
    
    return null;
  }

  getAllRates(): Map<string, { bid: number; ask: number; timestamp: Date }> {
    return this.rates;
  }
  
  async stop(): Promise<void> {
    this.isRunning = false;
    this.reader.disconnect();
  }
}

// ==================== MACRO WORKER (SETOR 048-052) ====================
export class MacroWorker {
  private isRunning = false;
  private cache: Map<string, { value: number; timestamp: Date }> = new Map();

  async start(): Promise<void> {
    this.isRunning = true;
    console.log('[MacroWorker] 🏭 Iniciando - BCB+Yahoo (REST JSON Poll)');
    
    // Poll BCB a cada 1 hora
    setInterval(() => this.fetchBCB(), 3600000);
    
    // Poll Yahoo a cada 5 minutos
    setInterval(() => this.fetchYahoo(), 300000);
  }

  private async fetchBCB(): Promise<void> {
    try {
      // SELIC
      const selic = await fetch('https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1');
      const selicData = await selic.json() as Array<{ valor: string; data: string }>;
      if (selicData?.[0]) {
        this.cache.set('SELIC', { value: parseFloat(selicData[0].valor), timestamp: new Date() });
      }
      
      // IPCA
      const ipca = await fetch('https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados/ultimos/1');
      const ipcaData = await ipca.json() as Array<{ valor: string; data: string }>;
      if (ipcaData?.[0]) {
        this.cache.set('IPCA', { value: parseFloat(ipcaData[0].valor), timestamp: new Date() });
      }
      
      console.log('[MacroWorker] 📊 BCB atualizado');
    } catch (e) {
      console.error('[MacroWorker] Erro BCB:', e);
    }
  }

  private async fetchYahoo(): Promise<void> {
    try {
      const symbols = ['^GSPC', '^BVSP', '^GDAXI', '^N225'];
      const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols.join(',')}`;
      
      const response = await fetch(url);
      const data = await response.json() as any;
      
      if (data?.quoteResponse?.result) {
        for (const quote of data.quoteResponse.result) {
          this.cache.set(quote.symbol, { value: quote.regularMarketPrice, timestamp: new Date() });
        }
      }
      
      console.log('[MacroWorker] 🌍 Yahoo atualizado');
    } catch (e) {
      console.error('[MacroWorker] Erro Yahoo:', e);
    }
  }

  getIndicator(name: string): { value: number; timestamp: Date } | undefined {
    return this.cache.get(name);
  }
}

// Export singleton instances
export const b3Worker = new B3Worker();
export const cryptoWorker = new CryptoWorker();
export const forexWorker = new ForexWorker();
export const macroWorker = new MacroWorker();
