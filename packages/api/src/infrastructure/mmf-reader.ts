/**
 * MMF Reader - Memory Mapped File Reader
 * Lê dados do SentinelEuropa_RAM (Pepperstone) e Sentinel_RAM (Genial)
 * 
 * Usa sentinel_api.py (porta 8765) como proxy pois ctypes Python
 * funciona melhor que ffi-napi no Node.js 24
 */

import { EventEmitter } from 'events';

// Layout offsets
const BID_OFF = 0;
const ASK_OFF = 8;
const VOL_OFF = 16;
const TS_OFF = 24;
const ANO_OFF = 32;
const HB_OFF = 36;
const WF_OFF = 40;
const SYM_OFF = 44;
const SYM_BYTES = 16;
const RECORD_BYTES = 128;

interface TickData {
  symbol: string;
  bid: number;
  ask: number;
  volume: bigint;
  timestamp: bigint;
  anomaly: number;
  heartbeat: number;
  source: 'pepperstone' | 'genial';
}

interface MMFConfig {
  name: string;
  slotCount: number;
  source: 'pepperstone' | 'genial';
}

class MMFReader extends EventEmitter {
  private config: MMFConfig;
  private buffer: Buffer | null = null;
  private isRunning = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private lastHeartbeat: Map<number, number> = new Map();
  private sentinelUrl = 'http://localhost:8765';
  private cachedTicks: TickData[] = []; // Cache para endpoint
  private _lastLogTime: number = 0;
  private _lastSymbolCount: number = 0;

  constructor(config: MMFConfig) {
    super();
    this.config = config;
  }

  /**
   * Conecta ao sentinel_api.py
   */
  async connect(): Promise<boolean> {
    try {
      // Verifica se sentinel_api.py está rodando
      const response = await fetch(`${this.sentinelUrl}/status`);
      if (response.ok) {
        this.buffer = Buffer.alloc(this.config.slotCount * RECORD_BYTES);
        console.log(`[MMFReader] ✅ Conectado via sentinel_api.py: ${this.config.name} (${this.config.slotCount} slots)`);
        return true;
      }
    } catch (e) {
      console.log(`[MMFReader] ⚠️ sentinel_api.py não está rodando na porta 8765`);
      console.log(`[MMFReader] Execute: python sentinel_api.py`);
    }
    
    // Fallback
    this.buffer = Buffer.alloc(this.config.slotCount * RECORD_BYTES);
    return true;
  }
  
  /**
   * Lê todos os slots ativos via sentinel_api.py (/mmf/debug)
   */
  async fetchAllActive(): Promise<TickData[]> {
    try {
      const response = await fetch(`${this.sentinelUrl}/mmf/debug`);
      if (!response.ok) {
        console.log(`[MMFReader] ❌ Erro HTTP ${response.status} em /mmf/debug`);
        return [];
      }
      
      const data = await response.json() as {
        b3_symbols: Array<{ symbol: string; bid: number; ask: number }>;
        global_symbols: Array<{ symbol: string; bid: number; ask: number }>;
      };
      
      const symbols = this.config.source === 'pepperstone' 
        ? data.global_symbols 
        : data.b3_symbols;
      
      // Log apenas a cada 60 segundos (throttled)
      const now = Date.now();
      if (now - this._lastLogTime > 60000) {
        console.log(`[MMFReader] 📊 ${this.config.source}: ${symbols.length} símbolos ativos`);
        this._lastLogTime = now;
      }
      this._lastSymbolCount = symbols.length;
      
      return symbols.map(t => ({
        symbol: t.symbol,
        bid: t.bid,
        ask: t.ask,
        volume: BigInt(0),
        timestamp: BigInt(Date.now()),
        anomaly: 0,
        heartbeat: 1,
        source: this.config.source
      }));
    } catch (e) {
      console.log(`[MMFReader] ❌ Erro no fetch: ${e}`);
      return [];
    }
  }

  /**
   * Lê tick de um slot específico (compatibilidade)
   */
  readSlot(slot: number): TickData | null {
    return null; // Usar fetchAllActive()
  }

  /**
   * Busca tick por símbolo (compatibilidade)
   */
  async findTick(symbol: string): Promise<TickData | null> {
    const ticks = await this.fetchAllActive();
    return ticks.find(t => t.symbol === symbol) || null;
  }

  /**
   * Hash FNV-1a (idêntico ao MQ5)
   */
  private hashSymbol(symbol: string): number {
    const s = symbol.toUpperCase();
    let h = 2166136261;
    
    for (let i = 0; i < s.length; i++) {
      h = ((h ^ s.charCodeAt(i)) * 16777619) >>> 0;
    }
    
    return ((h % (this.config.slotCount - 1)) + 1);
  }

  /**
   * Lê todos os slots ativos (sync wrapper)
   */
  readAllActive(): TickData[] {
    // Retorna vazio - usar polling async
    return [];
  }

  /**
   * Inicia polling de ticks (intervalo padrão 1000ms para não travar o sistema)
   */
  startPolling(intervalMs: number = 1000): void {
    if (this.isRunning) return;
    
    this.isRunning = true;
    console.log(`[MMFReader] 🔄 Iniciando polling: ${this.config.name} (${intervalMs}ms)`);
    
    this.pollInterval = setInterval(async () => {
      try {
        const ticks = await this.fetchAllActive();
        
        // Atualiza cache global
        if (this.config.source === 'pepperstone') {
          mmfCache.global = ticks;
        } else {
          mmfCache.b3 = ticks;
        }
        
        // Atualiza cache local
        this.cachedTicks = ticks;
        
        for (const tick of ticks) {
          const lastHb = this.lastHeartbeat.get(this.hashSymbol(tick.symbol)) || 0;
          
          if (tick.heartbeat !== lastHb) {
            this.lastHeartbeat.set(this.hashSymbol(tick.symbol), tick.heartbeat);
            this.emit('tick', tick);
          }
        }
      } catch (e) {
        // Ignora erros de polling
      }
    }, intervalMs);
  }

  /**
   * Retorna cache de ticks (para endpoint)
   */
  getCache(): TickData[] {
    console.log(`[MMFReader] 📦 getCache ${this.config.source}: ${this.cachedTicks.length} ticks`);
    return this.cachedTicks;
  }

  /**
   * Para polling
   */
  stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.isRunning = false;
  }

  /**
   * Cleanup
   */
  disconnect(): void {
    this.stopPolling();
    this.buffer = null;
    console.log(`[MMFReader] 🔌 Desconectado: ${this.config.name}`);
  }
}

// ==================== INSTÂNCIAS GLOBAIS ====================

// Cache global para endpoint (usando globalThis para garantir unicidade)
declare global {
  var __mmfCache: { global: TickData[]; b3: TickData[]; tv: TvTickData[] } | undefined;
}

if (!globalThis.__mmfCache) {
  globalThis.__mmfCache = { global: [], b3: [], tv: [] };
}

export const mmfCache = globalThis.__mmfCache;

// Pepperstone - GLOBALRAM (16384 slots)
export const globalRAMReader = new MMFReader({
  name: 'Local\\GLOBALRAM',
  slotCount: 16384,
  source: 'pepperstone'
});

// Genial - B3RAM (8192 slots)
export const b3RAMReader = new MMFReader({
  name: 'Local\\B3RAM',
  slotCount: 8192,
  source: 'genial'
});

// ==================== TRADINGVIEW ADAPTER ====================

export interface TvTickData {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  time: string;
  source: 'tradingview';
  action?: string;
}

class TradingViewAdapter extends EventEmitter {
  private pollInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private sentinelUrl = 'http://localhost:8765';
  private _lastSymbolCount = 0;

  /** Fetch all TV ticks from sentinel_api.py and merge into mmfCache.tv */
  async fetchFromSentinel(): Promise<TvTickData[]> {
    try {
      const res = await fetch(`${this.sentinelUrl}/tradingview/ticks`, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) return [];
      const data = await res.json() as { ticks: TvTickData[] };
      const ticks = Array.isArray(data.ticks) ? data.ticks : [];

      // Merge into mmfCache.tv (sentinel may have received ticks from a separate process)
      for (const tick of ticks) {
        const idx = mmfCache.tv.findIndex((t) => t.symbol === tick.symbol);
        if (idx >= 0) mmfCache.tv[idx] = tick; else mmfCache.tv.push(tick);
      }

      if (ticks.length !== this._lastSymbolCount) {
        console.log(`[TradingViewAdapter] 📊 ${ticks.length} símbolos TradingView ativos`);
        this._lastSymbolCount = ticks.length;
      }

      return mmfCache.tv;
    } catch {
      return mmfCache.tv;
    }
  }

  /** Start polling sentinel_api.py for TV ticks */
  startPolling(intervalMs = 2000): void {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`[TradingViewAdapter] 🔄 Iniciando polling TradingView (${intervalMs}ms)`);
    this.pollInterval = setInterval(async () => {
      try {
        const ticks = await this.fetchFromSentinel();
        for (const tick of ticks) {
          this.emit('tick', tick);
        }
      } catch { /* ignore */ }
    }, intervalMs);
  }

  stopPolling(): void {
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.isRunning = false;
  }

  /** Get current in-process TV ticks (populated by POST /api/v1/tradingview/webhook) */
  getCache(): TvTickData[] {
    return mmfCache.tv;
  }
}

export const tradingviewAdapter = new TradingViewAdapter();

export { MMFReader, TickData };
