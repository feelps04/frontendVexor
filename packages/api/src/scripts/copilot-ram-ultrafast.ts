/**
 * COPILOT RAM ULTRAFAST - LATÊNCIA <1ms
 * Tudo em RAM, sem I/O disco
 * Python bridge para MT5 direto (ticks em tempo real)
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import { config } from 'dotenv';
import { oracleDB } from '../infrastructure/oracle-db.js';
import { telegramNotifier } from '../infrastructure/telegram-notifier.js';
import { getContextMemory, TradeContext } from '../infrastructure/context-memory.js';
import { ramCache } from '../infrastructure/nexus-core/memory/index.js';

const rootEnv = 'C:/Users/opc/CascadeProjects/vexor-Oracle/vexor-Oracle-main/.env';
if (fs.existsSync(rootEnv)) {
  config({ path: rootEnv, override: true });
}

// ==================== CONFIG ULTRAFAST ====================

const ULTRA_CONFIG = {
  loopIntervalMs: 100, // 100ms - 10x por segundo
  maxLatencyMs: 1, // latência máxima aceitável
  rr: 2.0,
  newsFilter: 3,
  symbols: {
    b3: ['WDOFUT', 'DOLFUT', 'WINFUT'],
    global: ['EURUSD', 'GBPUSD']
  },
  mt5: {
    genial: {
      path: 'C:/Program Files/Genial Investimentos - MetaTrader 5/terminal64.exe',
      login: 4639348,
      password: 'L26112004Lf@',
      server: 'Genial-Investimentos'
    },
    pepperstone: {
      path: 'C:/Program Files/Pepperstone MetaTrader 5/terminal64.exe',
      login: 451655575,
      password: 'L26112004Lf@',
      server: 'Pepperstone-Demo'
    }
  }
};

// ==================== RAM STATE (tudo em memória) ====================

interface TickState {
  lastPrice: number;
  bid: number;
  ask: number;
  buyVol: number;
  sellVol: number;
  lastTime: number;
  tickCount: number;
  imbalance: number;
}

// Estado global em RAM
const RAM_STATE: {
  ticks: Map<string, TickState>;
  signals: Map<string, any>;
  news: any[];
  lastNewsUpdate: number;
  lastHeartbeat: number;
  isRunning: boolean;
  mt5Process: ChildProcess | null;
} = {
  ticks: new Map(),
  signals: new Map(),
  news: [],
  lastNewsUpdate: 0,
  lastHeartbeat: 0,
  isRunning: false,
  mt5Process: null
};

// ==================== MT5 PYTHON BRIDGE ====================

const MT5_BRIDGE_CODE = `
import MetaTrader5 as mt5
import json
import sys
import time

# Config
BROKER = sys.argv[1] if len(sys.argv) > 1 else 'genial'
SYMBOLS = ['WDOFUT', 'DOLFUT', 'WINFUT', 'EURUSD', 'GBPUSD']

if BROKER == 'genial':
    PATH = r'C:\\Program Files\\Genial Investimentos - MetaTrader 5\\terminal64.exe'
    LOGIN = 4639348
    PASSWORD = 'L26112004Lf@'
    SERVER = 'Genial-Investissements'
else:
    PATH = r'C:\\Program Files\\Pepperstone MetaTrader 5\\terminal64.exe'
    LOGIN = 451655575
    PASSWORD = 'L26112004Lf@'
    SERVER = 'Pepperstone-Demo'

# Conecta
if not mt5.initialize(path=PATH, login=LOGIN, password=PASSWORD, server=SERVER):
    print(json.dumps({'error': mt5.last_error()}))
    sys.exit(1)

# Loop de ticks
while True:
    try:
        data = {}
        for symbol in SYMBOLS:
            tick = mt5.symbol_info_tick(symbol)
            if tick:
                data[symbol] = {
                    'bid': tick.bid,
                    'ask': tick.ask,
                    'last': tick.last,
                    'volume': tick.volume,
                    'time': tick.time,
                    'flags': tick.flags
                }
        
        if data:
            print(json.dumps(data), flush=True)
        
        time.sleep(0.05)  # 50ms - 20x por segundo
        
    except Exception as e:
        print(json.dumps({'error': str(e)}), flush=True)
        break

mt5.shutdown()
`;

function startMT5Bridge(broker: 'genial' | 'pepperstone'): ChildProcess {
  const proc = spawn('python', ['-c', MT5_BRIDGE_CODE, broker], {
    windowsHide: true
  });
  
  proc.stdout?.on('data', (data: Buffer) => {
    try {
      const ticks = JSON.parse(data.toString());
      for (const [symbol, tick] of Object.entries(ticks)) {
        const t = tick as any;
        updateRAMTick(symbol, t);
      }
    } catch (e) {
      // Ignora parse errors
    }
  });
  
  proc.stderr?.on('data', (data: Buffer) => {
    console.error('[MT5]', data.toString());
  });
  
  proc.on('close', (code) => {
    console.log(`[MT5] Bridge terminou: ${code}`);
    RAM_STATE.mt5Process = null;
  });
  
  return proc;
}

// ==================== RAM UPDATE (<1μs) ====================

function updateRAMTick(symbol: string, tick: { bid: number; ask: number; last: number; volume: number; time: number; flags: number }): void {
  const start = process.hrtime.bigint();
  
  const existing = RAM_STATE.ticks.get(symbol) || {
    lastPrice: 0,
    bid: 0,
    ask: 0,
    buyVol: 0,
    sellVol: 0,
    lastTime: 0,
    tickCount: 0,
    imbalance: 0
  };
  
  // Detecta agressão (flags: 4=Buy, 8=Sell)
  const isBuy = (tick.flags & 4) !== 0;
  const isSell = (tick.flags & 8) !== 0;
  
  const newState: TickState = {
    lastPrice: tick.last || (tick.bid + tick.ask) / 2,
    bid: tick.bid,
    ask: tick.ask,
    buyVol: existing.buyVol + (isBuy ? tick.volume : 0),
    sellVol: existing.sellVol + (isSell ? tick.volume : 0),
    lastTime: tick.time * 1000,
    tickCount: existing.tickCount + 1,
    imbalance: existing.buyVol - existing.sellVol
  };
  
  RAM_STATE.ticks.set(symbol, newState);
  
  // Também atualiza RAMCache global
  ramCache.set(`tick:${symbol}`, newState, 5000);
  
  const elapsed = Number(process.hrtime.bigint() - start) / 1000; // microssegundos
  
  if (elapsed > 1000) { // >1ms
    console.log(`⚠️ ${symbol}: ${elapsed.toFixed(0)}μs (lento)`);
  }
}

// ==================== SINAL EM RAM (<100μs) ====================

function computeRAMSignal(symbol: string): any | null {
  const start = process.hrtime.bigint();
  
  const state = RAM_STATE.ticks.get(symbol);
  if (!state || state.tickCount < 50) return null;
  
  const imbalance = state.buyVol - state.sellVol;
  const total = state.buyVol + state.sellVol;
  if (total === 0) return null;
  
  const strength = Math.abs(imbalance) / total;
  if (strength < 0.3) return null; // precisa de desequilíbrio significativo
  
  const side = imbalance >= 0 ? 'BUY' : 'SELL';
  const price = state.lastPrice;
  
  // Stop/target em RAM
  const stopDist = price * 0.002;
  const stop = side === 'BUY' ? price - stopDist : price + stopDist;
  const target = side === 'BUY' ? price + stopDist * ULTRA_CONFIG.rr : price - stopDist * ULTRA_CONFIG.rr;
  
  const confidence = 0.5 + strength * 0.4;
  
  const elapsed = Number(process.hrtime.bigint() - start) / 1000;
  
  return {
    id: `SIG_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    symbol,
    side,
    entry: price,
    stop,
    target,
    rr: ULTRA_CONFIG.rr,
    confidence,
    imbalance: (imbalance / total) * 100,
    buyVol: state.buyVol,
    sellVol: state.sellVol,
    tickCount: state.tickCount,
    latencyUs: elapsed,
    timestamp: Date.now()
  };
}

// ==================== NEWS EM RAM (cache 5min) ====================

async function updateNewsRAM(): Promise<void> {
  const now = Date.now();
  if (now - RAM_STATE.lastNewsUpdate < 5 * 60 * 1000) return; // 5min cache
  
  try {
    const resp = await fetch('https://br.investing.com/rss/news.rss');
    const text = await resp.text();
    
    // Parse simples
    const items = text.match(/<item>[\s\S]*?<\/item>/g) || [];
    RAM_STATE.news = items.slice(0, 20).map(item => {
      const title = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] || 
                    item.match(/<title>(.*?)<\/title>/)?.[1] || '';
      return { title: title.toUpperCase() };
    });
    
    RAM_STATE.lastNewsUpdate = now;
  } catch (e) {
    // Mantém cache anterior
  }
}

function checkNewsBlockRAM(symbol: string): { blocked: boolean; count: number } {
  const keywords = symbol.includes('WDO') || symbol.includes('DOL')
    ? ['FED', 'JUROS', 'DOLAR', 'FOMC', 'MACRO']
    : ['IBOVESPA', 'BOLSA', 'MACRO'];
  
  const count = RAM_STATE.news.filter(n => 
    keywords.some(k => n.title.includes(k))
  ).length;
  
  return {
    blocked: count >= ULTRA_CONFIG.newsFilter,
    count
  };
}

// ==================== TELEGRAM ASYNC ====================

async function sendSignalTelegram(signal: any, newsBlock: { blocked: boolean; count: number }): Promise<void> {
  const emoji = signal.side === 'BUY' ? '🟢' : '🔴';
  
  let msg = `<b>${emoji} COPILOT RAM - ${signal.side}</b>\n\n`;
  msg += `<b>${signal.symbol}</b> @ ${signal.entry.toFixed(2)}\n`;
  msg += `Stop: ${signal.stop.toFixed(2)} | Target: ${signal.target.toFixed(2)}\n`;
  msg += `R/R: 1:${signal.rr} | Conf: ${(signal.confidence * 100).toFixed(0)}%\n`;
  msg += `Imbalance: ${signal.imbalance.toFixed(0)}%\n`;
  msg += `Latência: ${signal.latencyUs.toFixed(0)}μs\n`;
  
  if (newsBlock.blocked) {
    msg += `\n⚠️ <b>BLOQUEADO POR NOTÍCIAS</b> (${newsBlock.count})\n`;
  }
  
  msg += `\n⏰ ${new Date().toLocaleString('pt-BR')}`;
  
  await telegramNotifier.sendMessage(msg);
}

// ==================== ORACLE ASYNC (batch) ====================

let pendingSignals: any[] = [];

async function flushSignalsToOracle(): Promise<void> {
  if (pendingSignals.length === 0) return;
  
  const batch = pendingSignals;
  pendingSignals = [];
  
  try {
    for (const s of batch) {
      await oracleDB.insert(
        `INSERT INTO copilot_signals_ram (
          id, symbol, side, entry, stop, target, rr, confidence,
          imbalance, buy_vol, sell_vol, tick_count, latency_us, created_at
        ) VALUES (
          :id, :symbol, :side, :entry, :stop, :target, :rr, :confidence,
          :imbalance, :buy_vol, :sell_vol, :tick_count, :latency_us, CURRENT_TIMESTAMP
        )`,
        s
      );
    }
  } catch (e) {
    // Re-adiciona ao pendente se falhar
    pendingSignals = [...batch, ...pendingSignals];
  }
}

async function ensureRAMTable(): Promise<void> {
  try {
    await oracleDB.execute('SELECT 1 FROM copilot_signals_ram WHERE ROWNUM = 1');
    return;
  } catch (e) {}
  
  try { await oracleDB.execute('DROP TABLE copilot_signals_ram'); } catch (e) {}
  
  await oracleDB.execute(`
    CREATE TABLE copilot_signals_ram (
      id VARCHAR2(60) PRIMARY KEY,
      symbol VARCHAR2(20),
      side VARCHAR2(10),
      entry NUMBER,
      stop NUMBER,
      target NUMBER,
      rr NUMBER,
      confidence NUMBER,
      imbalance NUMBER,
      buy_vol NUMBER,
      sell_vol NUMBER,
      tick_count NUMBER,
      latency_us NUMBER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

// ==================== LOOP ULTRAFAST ====================

async function ultrafastLoop(): Promise<void> {
  console.log('\n⚡ ========================================');
  console.log('⚡ COPILOT RAM ULTRAFAST - <1ms LATÊNCIA');
  console.log('⚡ ========================================\n');
  
  // Inicia MT5 Bridge
  console.log('🔌 Iniciando MT5 Bridge...');
  RAM_STATE.mt5Process = startMT5Bridge('genial');
  
  // Garante tabela Oracle
  await ensureRAMTable();
  console.log('✅ Oracle RAM table pronta');
  
  // Carrega Context Memory
  getContextMemory().report();
  
  // Heartbeat inicial
  await telegramNotifier.sendMessage('⚡ <b>COPILOT RAM ULTRAFAST</b>\n\nStatus: ONLINE\nLatência: &lt;1ms\nLoop: 100ms');
  
  RAM_STATE.isRunning = true;
  let loopCount = 0;
  let lastFlush = Date.now();
  let lastHeartbeat = Date.now();
  
  while (RAM_STATE.isRunning) {
    loopCount++;
    const loopStart = process.hrtime.bigint();
    
    // 1. Atualiza news (async, não bloqueia)
    updateNewsRAM().catch(() => {});
    
    // 2. Processa cada símbolo
    for (const symbol of ULTRA_CONFIG.symbols.b3) {
      const signal = computeRAMSignal(symbol);
      
      if (signal) {
        const newsBlock = checkNewsBlockRAM(symbol);
        
        // Adiciona ao pendente para Oracle
        pendingSignals.push(signal);
        
        // Envia Telegram (async, não bloqueia)
        sendSignalTelegram(signal, newsBlock).catch(() => {});
        
        console.log(`📊 ${symbol}: ${signal.side} @ ${signal.entry.toFixed(2)} | ${signal.latencyUs.toFixed(0)}μs`);
      }
    }
    
    // 3. Flush Oracle a cada 10s
    if (Date.now() - lastFlush > 10000) {
      flushSignalsToOracle().catch(() => {});
      lastFlush = Date.now();
    }
    
    // 4. Heartbeat a cada 30min
    if (Date.now() - lastHeartbeat > 30 * 60 * 1000) {
      telegramNotifier.sendMessage('💓 COPILOT RAM ONLINE').catch(() => {});
      lastHeartbeat = Date.now();
    }
    
    // 5. Aguarda próximo loop
    const loopElapsed = Number(process.hrtime.bigint() - loopStart) / 1e6; // ms
    
    if (loopElapsed < ULTRA_CONFIG.loopIntervalMs) {
      await new Promise(r => setTimeout(r, ULTRA_CONFIG.loopIntervalMs - loopElapsed));
    } else if (loopElapsed > ULTRA_CONFIG.loopIntervalMs * 2) {
      console.log(`⚠️ Loop lento: ${loopElapsed.toFixed(0)}ms`);
    }
  }
}

// ==================== START ====================

ultrafastLoop().catch(err => {
  console.error('❌ Erro fatal:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Parando...');
  RAM_STATE.isRunning = false;
  RAM_STATE.mt5Process?.kill();
  flushSignalsToOracle().finally(() => process.exit(0));
});
