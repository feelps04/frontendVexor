/**
 * VEXOR Historical Replay Engine
 * Replay de dados históricos reais com velocidade variável
 * Fontes: MT5 (Pepperstone/Genial) + Binance API
 * Integrado com Learning Pipeline (4 Fases)
 */

import * as dgram from 'dgram';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { getLearningOrchestrator } from './learning-pipeline.js';

// ==================== TYPES ====================

interface Tick {
  symbol: string;
  timestamp: number;  // Unix ms
  bid: number;
  ask: number;
  volume: number;
  source: 'pepperstone' | 'genial' | 'binance';
}

// ==================== CONFIG ====================

const REPLAY_DIR = 'C:\\Users\\opc\\CascadeProjects\\vexor-Oracle\\vexor-Oracle-main\\replay_data';
const UDP_PORT = 10210;
const UDP_HOST = '127.0.0.1';

// ==================== BINANCE HISTORICAL ====================

async function fetchBinanceKlines(
  symbol: string,
  interval: string = '1m',
  limit: number = 1000,
  startTime?: number,
  endTime?: number
): Promise<Tick[]> {
  return new Promise((resolve, reject) => {
    let url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    
    if (startTime) url += `&startTime=${startTime}`;
    if (endTime) url += `&endTime=${endTime}`;
    
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const candles = JSON.parse(data) as any[][];
          const ticks: Tick[] = candles.map(candle => {
            const openTime = candle[0];
            const close = parseFloat(candle[4]);
            const volume = parseFloat(candle[5]);
            const spread = close * 0.0001;
            
            return {
              symbol,
              timestamp: openTime,
              bid: close - spread / 2,
              ask: close + spread / 2,
              volume,
              source: 'binance' as const
            };
          });
          resolve(ticks);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function downloadBinanceHistory(symbols: string[], days: number = 30): Promise<Tick[]> {
  const now = Date.now();
  const startTime = now - days * 24 * 60 * 60 * 1000;
  
  const allTicks: Tick[] = [];
  
  for (const symbol of symbols) {
    console.log(`[Replay] Baixando ${symbol}...`);
    try {
      const ticks = await fetchBinanceKlines(symbol, '1m', 1000, startTime, now);
      allTicks.push(...ticks);
      console.log(`[Replay] ${symbol}: ${ticks.length} ticks`);
    } catch (e) {
      console.error(`[Replay] Erro ao baixar ${symbol}:`, e);
    }
    // Rate limit
    await new Promise(r => setTimeout(r, 500));
  }
  
  return allTicks;
}

// ==================== REPLAY ENGINE ====================

export class ReplayEngine {
  private speedMs: number;
  private running: boolean = false;
  private tickIndex: number = 0;
  private totalTicks: number = 0;
  private ticks: Tick[] = [];
  private socket: dgram.Socket;
  
  constructor(speedMs: number = 10) {
    this.speedMs = speedMs;
    this.socket = dgram.createSocket('udp4');
  }
  
  private publishTick(tick: Tick): void {
    const msg = `${tick.symbol}|${tick.timestamp}|${tick.bid}|${tick.ask}|${tick.volume}|${tick.source}`;
    this.socket.send(msg, UDP_PORT, UDP_HOST);
  }
  
  async loadDay(date: string): Promise<number> {
    const dataFile = path.join(REPLAY_DIR, `day_${date}.json`);
    
    if (!fs.existsSync(dataFile)) {
      console.error(`[Replay] Arquivo não encontrado: ${dataFile}`);
      return 0;
    }
    
    const data = fs.readFileSync(dataFile, 'utf-8');
    this.ticks = JSON.parse(data);
    
    // Ordenar por timestamp (CRUCIAL: ordem cronológica sagrada!)
    this.ticks.sort((a, b) => a.timestamp - b.timestamp);
    this.totalTicks = this.ticks.length;
    
    console.log(`[Replay] Carregados ${this.totalTicks} ticks de ${date}`);
    return this.totalTicks;
  }
  
  async replayDay(date: string, speed: 'realtime' | 'fast' | 'ultra' = 'fast'): Promise<{ ticks: number; elapsed: number }> {
    const speedMap: Record<string, number> = { realtime: 60000, fast: 10, ultra: 0 };
    this.speedMs = speedMap[speed] || 10;
    
    const loaded = await this.loadDay(date);
    if (loaded === 0) {
      return { ticks: 0, elapsed: 0 };
    }
    
    this.running = true;
    this.tickIndex = 0;
    
    console.log(`[Replay] Iniciando replay de ${date}`);
    console.log(`[Replay] Total: ${this.totalTicks} ticks, velocidade: ${this.speedMs}ms`);
    
    const startTime = Date.now();
    
    for (const tick of this.ticks) {
      if (!this.running) break;
      
      this.publishTick(tick);
      this.tickIndex++;
      
      // Processar tick no Learning Pipeline
      const learning = getLearningOrchestrator();
      learning.processTick(tick, this.tickIndex);
      
      if (this.tickIndex % 1000 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = this.tickIndex / elapsed;
        const stats = learning.getStats();
        console.log(`[Replay] ${this.tickIndex}/${this.totalTicks} ticks (${rate.toFixed(0)}/s) | Signals: ${stats.totalSignals} | W:${stats.wins} L:${stats.losses} | WR:${(stats.winRate * 100).toFixed(1)}%`);
      }
      
      if (this.speedMs > 0) {
        await new Promise(r => setTimeout(r, this.speedMs));
      }
    }
    
    const elapsed = (Date.now() - startTime) / 1000;
    console.log(`[Replay] Finalizado! ${this.totalTicks} ticks em ${elapsed.toFixed(1)}s`);
    
    this.socket.close();
    
    return { ticks: this.totalTicks, elapsed };
  }
  
  stop(): void {
    this.running = false;
  }
  
  getStatus(): { running: boolean; tickIndex: number; totalTicks: number; progress: string } {
    return {
      running: this.running,
      tickIndex: this.tickIndex,
      totalTicks: this.totalTicks,
      progress: this.totalTicks > 0 ? `${((this.tickIndex / this.totalTicks) * 100).toFixed(1)}%` : '0%'
    };
  }
}

// ==================== DATA PREPARATION ====================

export async function prepareReplayData(
  date: string,
  symbolsPepperstone: string[],
  symbolsGenial: string[],
  symbolsBinance: string[]
): Promise<string> {
  if (!fs.existsSync(REPLAY_DIR)) {
    fs.mkdirSync(REPLAY_DIR, { recursive: true });
  }
  
  const allTicks: Tick[] = [];
  
  // Buscar dados da Binance
  console.log('[Replay] Buscando dados da Binance...');
  const binanceTicks = await downloadBinanceHistory(symbolsBinance, 1);
  allTicks.push(...binanceTicks);
  
  // TODO: Buscar dados do MT5 via Python bridge
  // Por enquanto, usar apenas Binance
  
  // Ordenar por timestamp
  allTicks.sort((a, b) => a.timestamp - b.timestamp);
  
  // Salvar
  const outputFile = path.join(REPLAY_DIR, `day_${date}.json`);
  fs.writeFileSync(outputFile, JSON.stringify(allTicks, null, 2));
  
  console.log(`[Replay] Dados preparados: ${allTicks.length} ticks salvos em ${outputFile}`);
  return outputFile;
}

// ==================== SINGLETON ====================

let replayEngine: ReplayEngine | null = null;

export function getReplayEngine(): ReplayEngine {
  if (!replayEngine) {
    replayEngine = new ReplayEngine();
  }
  return replayEngine;
}
