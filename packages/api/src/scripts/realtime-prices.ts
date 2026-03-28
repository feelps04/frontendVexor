/**
 * VEXOR Real-Time Prices Engine
 * ==============================
 * 
 * Fontes de preços ao vivo (sem delay):
 * 1. B3RAM - Memória compartilhada com MT5 (B3 Futuros)
 * 2. GLOBALRAM - Pepperstone Forex via MT5
 * 3. Fallback: Yahoo Finance (apenas se outras falharem)
 * 
 * Integração direta com o Sentinel_RAM v5.20 EA
 */

import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';

// ==================== INTERFACES ====================

interface PriceTick {
  symbol: string;
  bid: number;
  ask: number;
  timestamp: number;
  source: 'B3RAM' | 'GLOBALRAM' | 'MT5' | 'YAHOO';
  volume?: number;
}

interface MmfConfig {
  name: string;
  source: string;
  recordBytes: number;
  recordCount: number;
  bidOffset: number;
  askOffset: number;
  volumeOffset: number;
  timeOffset: number;
  hbOffset: number;
  wfOffset: number;
  symbolOffset: number;
  symbolBytes: number;
}

// ==================== CONFIGURAÇÃO ====================

const MMF_CONFIGS: MmfConfig[] = [
  // B3 Futuros (Genial/MT5) - Sentinel_RAM_v520.mq5
  {
    name: 'B3RAM',
    source: 'genial',
    recordBytes: 128,
    recordCount: 8192,
    bidOffset: 0,
    askOffset: 8,
    volumeOffset: 16,
    timeOffset: 24,
    hbOffset: 36,
    wfOffset: 40,
    symbolOffset: 44,
    symbolBytes: 16
  },
  // Forex Global (Pepperstone) - SentinelEuropa_RAM_v100.mq5
  {
    name: 'GLOBALRAM',
    source: 'pepperstone',
    recordBytes: 128,
    recordCount: 16384,
    bidOffset: 0,
    askOffset: 8,
    volumeOffset: 16,
    timeOffset: 24,
    hbOffset: 36,
    wfOffset: 40,
    symbolOffset: 44,
    symbolBytes: 16
  }
];

// Cache de preços
const PRICE_CACHE = new Map<string, PriceTick>();
const CACHE_TTL = 5000; // 5 segundos

// ==================== FFI-NAPI PARA MMF ====================

const PAGE_READONLY = 0x02;
const FILE_MAP_READ = 0x0004;

let ffi: any = null;
let ref: any = null;
let kernel32: any = null;

// Carrega ffi-napi de forma assíncrona
async function loadFfi(): Promise<boolean> {
  try {
    const ffiModule = await import('ffi-napi');
    const refModule = await import('ref-napi');
    
    ffi = ffiModule.default || ffiModule;
    ref = refModule.default || refModule;
    
    const voidPtr = ref.refType(ref.types.void);
    
    kernel32 = ffi.Library('kernel32', {
      OpenFileMappingW: [voidPtr, ['uint32', 'int32', 'pointer']],
      MapViewOfFile: [voidPtr, [voidPtr, 'uint32', 'uint32', 'uint32', 'size_t']],
      UnmapViewOfFile: ['int32', [voidPtr]],
      CloseHandle: ['int32', [voidPtr]],
    });
    
    console.log('[MMF] ffi-napi kernel32 bindings carregadas');
    return true;
  } catch (e) {
    console.log('[MMF] ffi-napi não disponível:', e);
    return false;
  }
}

function toWideString(str: string): Buffer {
  return Buffer.from(str + '\0', 'utf16le');
}

// ==================== MMF READER ====================

interface MmfView {
  handle: any;
  view: any;
  config: MmfConfig;
  buffer: Buffer;
}

class MMFReader {
  private views: MmfView[] = [];
  private initialized = false;
  
  /**
   * Inicializa todas as MMFs configuradas
   */
  initialize(): boolean {
    if (!kernel32) {
      console.log('[MMF] kernel32 não disponível');
      return false;
    }
    
    for (const cfg of MMF_CONFIGS) {
      const view = this.openMmf(cfg);
      if (view) {
        this.views.push(view);
        console.log(`[MMF] Conectado: ${cfg.name} (${cfg.source})`);
      } else {
        console.log(`[MMF] Não encontrado: ${cfg.name}`);
      }
    }
    
    this.initialized = this.views.length > 0;
    return this.initialized;
  }
  
  /**
   * Abre uma MMF específica
   */
  private openMmf(cfg: MmfConfig): MmfView | null {
    const mmfSize = cfg.recordBytes * cfg.recordCount;
    
    // Tenta diferentes nomes
    const candidates = [
      cfg.name,
      cfg.name.replace('Local\\', ''),
      cfg.name.replace('Local\\', 'Global\\'),
      'Global\\' + cfg.name.replace('Local\\', '')
    ];
    
    for (const cand of candidates) {
      try {
        const nameBuf = toWideString(cand);
        const hMap = kernel32.OpenFileMappingW(FILE_MAP_READ, 0, nameBuf);
        
        if (ref.isNull(hMap)) continue;
        
        const pView = kernel32.MapViewOfFile(hMap, FILE_MAP_READ, 0, 0, mmfSize);
        if (ref.isNull(pView)) {
          kernel32.CloseHandle(hMap);
          continue;
        }
        
        // Usa ref.reinterpret para criar buffer a partir do ponteiro
        const buffer = ref.reinterpret(pView, mmfSize, 0) as Buffer;
        
        console.log(`[MMF] Buffer copiado: ${cfg.name} (${buffer.byteLength} bytes)`);
        
        return { handle: hMap, view: pView, config: cfg, buffer };
      } catch (e) {
        console.log(`[MMF] Erro ao abrir ${cand}:`, e);
        continue;
      }
    }
    
    return null;
  }
  
  /**
   * Lê preço de um símbolo
   */
  getPrice(symbol: string): PriceTick | null {
    // Mapeamento de códigos numéricos para símbolos
    const SYMBOL_ALIASES: Record<string, string> = {
      '994158': 'WDO',  // WDO no Genial
      '994160': 'WDO',  // WDO vencimento próximo
    };
    
    const symbolUpper = symbol.toUpperCase().replace('FUT', '');
    
    // Para WDO, buscar primeiro no GLOBALRAM (Pepperstone)
    const isWdo = symbolUpper.includes('WDO');
    
    // Ordenar views: GLOBALRAM primeiro para WDO, senão ordem normal
    const sortedViews = isWdo 
      ? [...this.views].sort((a, b) => 
          a.config.source === 'pepperstone' ? -1 : 1)
      : this.views;
    
    for (const { buffer, config } of sortedViews) {
      // Busca por hash FNV-1a
      let record = this.findRecord(buffer, config, symbolUpper);
      
      // Se não encontrou, busca por alias (códigos numéricos)
      if (!record || record.bid <= 0) {
        for (const [code, sym] of Object.entries(SYMBOL_ALIASES)) {
          if (sym === symbolUpper || (symbolUpper.includes(sym))) {
            record = this.findRecord(buffer, config, code);
            if (record && record.bid > 0) break;
          }
        }
      }
      
      if (record && record.bid > 0) {
        return {
          symbol,
          bid: record.bid,
          ask: record.ask,
          timestamp: record.timestamp,
          source: config.source === 'genial' ? 'B3RAM' : 'GLOBALRAM',
          volume: record.volume
        };
      }
    }
    
    return null;
  }
  
  /**
   * Busca registro por hash FNV-1a ou busca linear para códigos numéricos
   */
  private findRecord(buffer: Buffer, cfg: MmfConfig, symbol: string): { bid: number; ask: number; volume: number; timestamp: number } | null {
    // Hash FNV-1a
    let hash = 2166136261;
    for (let i = 0; i < symbol.length; i++) {
      hash ^= symbol.charCodeAt(i);
      hash = (hash * 16777619) >>> 0;
    }
    
    const slot = hash % cfg.recordCount;
    const offset = slot * cfg.recordBytes;
    
    // Verifica write flag
    const writeFlag = buffer.readInt32LE(offset + cfg.wfOffset);
    if (writeFlag === 1) return null;
    
    // Lê símbolo do registro
    const symbolBytes = buffer.slice(offset + cfg.symbolOffset, offset + cfg.symbolOffset + cfg.symbolBytes);
    const recordSymbol = symbolBytes.toString('ascii').replace(/\0/g, '').trim().toUpperCase();
    
    // Valida símbolo (pode haver colisão)
    if (recordSymbol !== symbol && !recordSymbol.startsWith(symbol)) {
      // Busca linear nos primeiros slots para códigos numéricos
      for (let i = 0; i < Math.min(8000, cfg.recordCount); i++) {
        const off = i * cfg.recordBytes;
        const wf = buffer.readInt32LE(off + cfg.wfOffset);
        if (wf === 1) continue;
        
        const symBytes = buffer.slice(off + cfg.symbolOffset, off + cfg.symbolOffset + cfg.symbolBytes);
        const sym = symBytes.toString('ascii').replace(/\0/g, '').trim().toUpperCase();
        
        // Busca por código 994158 (WDO no Genial)
        if (sym === symbol || sym.includes(symbol) || (symbol === 'WDO' && sym === '994158')) {
          const bid = buffer.readDoubleLE(off + cfg.bidOffset);
          const ask = buffer.readDoubleLE(off + cfg.askOffset);
          const volume = Number(buffer.readBigInt64LE(off + cfg.volumeOffset));
          const timestamp = Number(buffer.readBigInt64LE(off + cfg.timeOffset));
          
          if (bid > 0) {
            return { bid, ask, volume, timestamp };
          }
        }
      }
      return null;
    }
    
    const bid = buffer.readDoubleLE(offset + cfg.bidOffset);
    const ask = buffer.readDoubleLE(offset + cfg.askOffset);
    const volume = Number(buffer.readBigInt64LE(offset + cfg.volumeOffset));
    const timestamp = Number(buffer.readBigInt64LE(offset + cfg.timeOffset));
    
    return { bid, ask, volume, timestamp };
  }
  
  /**
   * Fecha todas as MMFs
   */
  close(): void {
    for (const { handle, view } of this.views) {
      try {
        kernel32.UnmapViewOfFile(view);
        kernel32.CloseHandle(handle);
      } catch (e) {}
    }
    this.views = [];
    this.initialized = false;
  }
}

// ==================== PRICE ENGINE ====================

export class RealtimePriceEngine {
  private mmf: MMFReader;
  private yahooFallback = true;
  
  constructor() {
    this.mmf = new MMFReader();
  }
  
  /**
   * Inicializa conexões
   */
  async initialize(): Promise<void> {
    console.log('[PriceEngine] Conectando fontes de preços ao vivo...');
    
    // Carrega ffi primeiro
    const ffiOk = await loadFfi();
    if (!ffiOk) {
      console.log('[PriceEngine] ffi-napi não carregado, usando Yahoo fallback');
    }
    
    const mmfOk = this.mmf.initialize();
    
    console.log(`[PriceEngine] Status:`);
    console.log(`  MMF (B3RAM + GLOBALRAM): ${mmfOk ? '✅' : '❌'}`);
    console.log(`  Yahoo Fallback: ${this.yahooFallback ? '✅' : '❌'}`);
  }
  
  /**
   * Obtém preço de um símbolo
   */
  async getPrice(symbol: string): Promise<PriceTick | null> {
    // Verifica cache
    const cached = PRICE_CACHE.get(symbol);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached;
    }
    
    // Tenta MMF primeiro
    const mmfPrice = this.mmf.getPrice(symbol);
    if (mmfPrice) {
      PRICE_CACHE.set(symbol, mmfPrice);
      return mmfPrice;
    }
    
    // Fallback: Yahoo Finance
    if (this.yahooFallback) {
      const yahooPrice = await this.getYahooPrice(symbol);
      if (yahooPrice) {
        PRICE_CACHE.set(symbol, yahooPrice);
        return yahooPrice;
      }
    }
    
    return null;
  }
  
  /**
   * Fallback Yahoo Finance
   */
  private async getYahooPrice(symbol: string): Promise<PriceTick | null> {
    try {
      const yahooSymbol = symbol
        .replace('WDOFUT', 'USDBRL=X')
        .replace('DOLFUT', 'USDBRL=X')
        .replace('WINFUT', '^BVSP')
        .replace('EURUSD', 'EURUSD=X')
        .replace('GBPUSD', 'GBPUSD=X');
      
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
      const data = await resp.json() as any;
      
      const meta = data.chart?.result?.[0]?.meta;
      if (meta) {
        return {
          symbol,
          bid: meta.regularMarketPrice,
          ask: meta.regularMarketPrice,
          timestamp: Date.now(),
          source: 'YAHOO'
        };
      }
    } catch (e) {
      // Silencia erro
    }
    
    return null;
  }
  
  /**
   * Fecha conexões
   */
  close(): void {
    this.mmf.close();
  }
}

// Instância global
export const realtimePrices = new RealtimePriceEngine();
