/**
 * MT5 LOCAL AGENT - Windows
 * Lê ticks do MT5 (Genial + Pepperstone) e envia para o bridge local.
 * Roda na máquina onde o MT5 está instalado.
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { config } from 'dotenv';

const rootEnv = 'C:/Users/opc/CascadeProjects/vexor-Oracle/vexor-Oracle-main/.env';
if (fs.existsSync(rootEnv)) {
  config({ path: rootEnv, override: true });
}

// ==================== CONFIG ====================

const AGENT_CONFIG = {
  bridgeUrl: process.env.OCI_BRIDGE_URL || 'http://127.0.0.1:8080',
  bridgeToken: process.env.BRIDGE_AUTH_TOKEN || 'vexor-bridge-2026',
  
  // MT5
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
  },
  
  // Symbols
  symbols: {
    b3: ['WDOFUT', 'DOLFUT', 'WINFUT'],
    global: ['EURUSD', 'GBPUSD', 'XAUUSD']
  },
  
  // Timing
  sendIntervalMs: 100, // envia a cada 100ms
  batchSize: 50 // máximo de ticks por batch
};

// ==================== MT5 PYTHON BRIDGE ====================

const MT5_AGENT_CODE = `
import MetaTrader5 as mt5
import json
import sys
import time
import threading

BROKER = sys.argv[1] if len(sys.argv) > 1 else 'genial'
SYMBOLS = sys.argv[2].split(',') if len(sys.argv) > 2 else ['WDOFUT', 'DOLFUT', 'WINFUT']

if BROKER == 'genial':
    PATH = r'C:\\Program Files\\Genial Investimentos - MetaTrader 5\\terminal64.exe'
    LOGIN = 4639348
    PASSWORD = 'L26112004Lf@'
    SERVER = 'Genial-Investimentos'
else:
    PATH = r'C:\\Program Files\\Pepperstone MetaTrader 5\\terminal64.exe'
    LOGIN = 451655575
    PASSWORD = 'L26112004Lf@'
    SERVER = 'Pepperstone-Demo'

print(f'[MT5] Conectando {BROKER}...', file=sys.stderr)

if not mt5.initialize(path=PATH, login=LOGIN, password=PASSWORD, server=SERVER):
    print(json.dumps({'error': mt5.last_error()}))
    sys.exit(1)

print(f'[MT5] Conectado: {BROKER}', file=sys.stderr)

# Buffer de ticks
tick_buffer = []
lock = threading.Lock()

def collect_ticks():
    while True:
        try:
            for symbol in SYMBOLS:
                tick = mt5.symbol_info_tick(symbol)
                if tick:
                    with lock:
                        tick_buffer.append({
                            'symbol': symbol,
                            'bid': tick.bid,
                            'ask': tick.ask,
                            'last': tick.last,
                            'volume': tick.volume,
                            'time': tick.time,
                            'flags': tick.flags,
                            'source': BROKER
                        })
            time.sleep(0.02)  # 20ms
        except Exception as e:
            print(json.dumps({'error': str(e)}), file=sys.stderr)

# Inicia coletor em thread
collector = threading.Thread(target=collect_ticks, daemon=True)
collector.start()

# Envia ticks para stdout a cada 50ms
while True:
    time.sleep(0.05)
    
    with lock:
        if tick_buffer:
            batch = tick_buffer[:50]  # max 50 por batch
            tick_buffer = tick_buffer[50:]
            print(json.dumps({'ticks': batch}), flush=True)
`;

// ==================== STATE ====================

const AGENT_STATE = {
  processes: new Map<string, ChildProcess>(),
  isRunning: false,
  totalSent: 0,
  lastSend: 0,
  errors: 0
};

// ==================== SEND TO CLOUD ====================

async function sendToCloud(ticks: any[]): Promise<boolean> {
  try {
    const resp = await fetch(`${AGENT_CONFIG.bridgeUrl}/ticks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AGENT_CONFIG.bridgeToken}`
      },
      body: JSON.stringify({ ticks })
    });
    
    if (!resp.ok) {
      console.log(`❌ Cloud erro: ${resp.status}`);
      return false;
    }
    
    AGENT_STATE.totalSent += ticks.length;
    return true;
  } catch (e) {
    AGENT_STATE.errors++;
    console.log(`❌ Conexão falhou: ${e}`);
    return false;
  }
}

// ==================== START MT5 BRIDGE ====================

function startMT5Bridge(broker: 'genial' | 'pepperstone', symbols: string[]): ChildProcess {
  const proc = spawn('python', ['-c', MT5_AGENT_CODE, broker, symbols.join(',')], {
    windowsHide: true
  });
  
  proc.stdout?.on('data', async (data: Buffer) => {
    try {
      const payload = JSON.parse(data.toString());
      
      if (payload.ticks && payload.ticks.length > 0) {
        await sendToCloud(payload.ticks);
        AGENT_STATE.lastSend = Date.now();
      }
    } catch (e) {
      // Ignore parse errors
    }
  });
  
  proc.stderr?.on('data', (data: Buffer) => {
    console.log(`[${broker}] ${data.toString().trim()}`);
  });
  
  proc.on('close', (code) => {
    console.log(`[${broker}] Processo terminou: ${code}`);
    AGENT_STATE.processes.delete(broker);
    
    // Restart após 5s
    if (AGENT_STATE.isRunning) {
      setTimeout(() => {
        console.log(`[${broker}] Reiniciando...`);
        const newProc = startMT5Bridge(broker, symbols);
        AGENT_STATE.processes.set(broker, newProc);
      }, 5000);
    }
  });
  
  return proc;
}

// ==================== HEARTBEAT ====================

async function sendHeartbeat(): Promise<void> {
  try {
    const resp = await fetch(`${AGENT_CONFIG.bridgeUrl}/health`);
    const data = await resp.json() as any;
    console.log(`💓 Cloud OK | Uptime: ${data.uptime}s | Ticks: ${data.totalReceived}`);
  } catch (e) {
    console.log(`💔 Cloud indisponível`);
  }
}

// ==================== MAIN ====================

async function main(): Promise<void> {
  console.log('\n🖥️ ========================================');
  console.log('🖥️ MT5 LOCAL AGENT - WINDOWS');
  console.log('🖥️ ========================================\n');
  
  console.log(`🌐 Bridge URL: ${AGENT_CONFIG.bridgeUrl}`);
  console.log(`📊 Símbolos B3: ${AGENT_CONFIG.symbols.b3.join(', ')}`);
  console.log(`📊 Símbolos Global: ${AGENT_CONFIG.symbols.global.join(', ')}`);
  
  // Inicia bridges
  console.log('\n🔌 Iniciando MT5 Bridges...');
  
  const genialProc = startMT5Bridge('genial', AGENT_CONFIG.symbols.b3);
  AGENT_STATE.processes.set('genial', genialProc);
  
  const pepperProc = startMT5Bridge('pepperstone', AGENT_CONFIG.symbols.global);
  AGENT_STATE.processes.set('pepperstone', pepperProc);
  
  AGENT_STATE.isRunning = true;
  
  console.log('✅ Agent rodando');
  
  // Heartbeat a cada 30s
  setInterval(sendHeartbeat, 30000);
  
  // Stats a cada 60s
  setInterval(() => {
    console.log(`\n📊 Stats:`);
    console.log(`   Enviados: ${AGENT_STATE.totalSent}`);
    console.log(`   Erros: ${AGENT_STATE.errors}`);
    console.log(`   Processos: ${AGENT_STATE.processes.size}`);
  }, 60000);
}

main().catch(console.error);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Parando Agent...');
  AGENT_STATE.isRunning = false;
  for (const [name, proc] of AGENT_STATE.processes) {
    console.log(`   Matando ${name}...`);
    proc.kill();
  }
  process.exit(0);
});
