/**
 * MT5 Bridge Server - OCI Cloud
 * Recebe ticks do Agent Local (Windows) via HTTP
 * Armazena em RAM e Redis para o Copiloto
 */

import * as http from 'http';
import * as fs from 'fs';
import { config } from 'dotenv';
import { oracleDB } from '../infrastructure/oracle-db.js';
import { telegramNotifier } from '../infrastructure/telegram-notifier.js';
import { ramCache } from '../infrastructure/nexus-core/memory/index.js';

const rootEnv = 'C:/Users/opc/CascadeProjects/vexor-Oracle/vexor-Oracle-main/.env';
if (fs.existsSync(rootEnv)) {
  config({ path: rootEnv, override: true });
}

// ==================== CONFIG ====================

const BRIDGE_CONFIG = {
  port: parseInt(process.env.BRIDGE_PORT || '8080'),
  authToken: process.env.BRIDGE_AUTH_TOKEN || 'vexor-bridge-2026',
  maxBufferSize: 10000,
  flushIntervalMs: 5000
};

// ==================== RAM STATE ====================

interface TickPayload {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  volume: number;
  time: number;
  flags: number;
  source: 'genial' | 'pepperstone';
}

interface ExecutionRequest {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  orderType: 'MARKET' | 'LIMIT';
  reason: string;
  confidence: number;
}

interface ExecutionResponse {
  orderId: string;
  status: 'FILLED' | 'REJECTED' | 'PENDING';
  executedPrice: number;
  slippage: number;
  ticket?: number;
  error?: string;
}

// Fila de ordens para o EA processar
const PENDING_EXECUTIONS: Map<string, ExecutionRequest> = new Map();
const EXECUTION_RESULTS: Map<string, ExecutionResponse> = new Map();

const BRIDGE_STATE = {
  ticks: new Map<string, TickPayload[]>(),
  lastUpdate: new Map<string, number>(),
  totalReceived: 0,
  startTime: Date.now()
};

// Paper Trading Lambda URL
const PAPER_LAMBDA_URL = process.env.PAPER_LAMBDA_URL || 'http://localhost:8081';

// Função para encaminhar tick para Paper Trading Lambda
async function forwardTickToLambda(tick: TickPayload): Promise<void> {
  try {
    await fetch(`${PAPER_LAMBDA_URL}/tick`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BRIDGE_CONFIG.authToken}`
      },
      body: JSON.stringify(tick)
    });
  } catch (e) {
    // Silencioso - Lambda pode não estar rodando
  }
}

// ==================== HTTP SERVER ====================

const server = http.createServer(async (req, res) => {
  const startTime = process.hrtime.bigint();
  
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  // Health check
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      uptime: Date.now() - BRIDGE_STATE.startTime,
      totalReceived: BRIDGE_STATE.totalReceived,
      symbols: Array.from(BRIDGE_STATE.ticks.keys())
    }));
    return;
  }
  
  // Status
  if (req.url === '/status') {
    const status: any = {};
    for (const [symbol, ticks] of BRIDGE_STATE.ticks) {
      const last = ticks[ticks.length - 1];
      status[symbol] = {
        lastPrice: last?.last || 0,
        tickCount: ticks.length,
        lastUpdate: BRIDGE_STATE.lastUpdate.get(symbol)
      };
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status));
    return;
  }
  
  // Receive ticks
  if (req.method === 'POST' && req.url === '/ticks') {
    // Auth check
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${BRIDGE_CONFIG.authToken}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        
        // Single tick
        if (payload.symbol) {
          processTick(payload as TickPayload);
        }
        // Batch ticks
        else if (Array.isArray(payload.ticks)) {
          for (const tick of payload.ticks) {
            processTick(tick as TickPayload);
          }
        }
        
        const elapsed = Number(process.hrtime.bigint() - startTime) / 1e6;
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          ok: true, 
          latency: `${elapsed.toFixed(2)}ms`,
          total: BRIDGE_STATE.totalReceived
        }));
        
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }
  
  // Get ticks for Copilot
  if (req.method === 'GET' && req.url?.startsWith('/ticks/')) {
    const symbol = req.url.replace('/ticks/', '');
    const ticks = BRIDGE_STATE.ticks.get(symbol) || [];
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(ticks.slice(-500))); // últimas 500
    return;
  }
  
  // Get current price for symbol (para o bot usar)
  if (req.method === 'GET' && req.url?.startsWith('/price/')) {
    const symbol = req.url.replace('/price/', '');
    const ticks = BRIDGE_STATE.ticks.get(symbol) || [];
    const lastTick = ticks[ticks.length - 1];
    
    if (lastTick) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        symbol: symbol,
        bid: lastTick.bid,
        ask: lastTick.ask,
        price: lastTick.last,
        time: lastTick.time,
        source: lastTick.source
      }));
    } else {
      // Se não tem tick, retorna preço aproximado baseado no símbolo
      const fallbackPrice = symbol.includes('WIN') ? 125000 : 5.25;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        symbol: symbol,
        bid: fallbackPrice,
        ask: fallbackPrice,
        price: fallbackPrice,
        time: Date.now(),
        source: 'fallback'
      }));
    }
    return;
  }
  
  // ==================== EXECUTION ENDPOINTS ====================
  
  // Receive manual alert from EA (when auto trading blocked)
  if (req.method === 'POST' && req.url === '/alert') {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${BRIDGE_CONFIG.authToken}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const alertData = JSON.parse(body) as any;
        
        console.log(`⚠️ ALERTA MANUAL RECEBIDO: ${alertData.orderId}`);
        
        // Envia para Telegram via notifier
        if (telegramNotifier && alertData.message) {
          await telegramNotifier.sendMessage(alertData.message);
          console.log(`📤 Alerta enviado para Telegram`);
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, message: 'Alert sent to Telegram' }));
        
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }
  
  // Receive execution request from broker-executor
  if (req.method === 'POST' && req.url === '/execute') {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${BRIDGE_CONFIG.authToken}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const order = JSON.parse(body) as ExecutionRequest;
        
        // Adiciona à fila para o EA processar
        PENDING_EXECUTIONS.set(order.id, order);
        
        console.log(`📤 ORDEM ENFILEIRADA: ${order.side} ${order.quantity}x ${order.symbol} @ ${order.entryPrice}`);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          ok: true, 
          orderId: order.id,
          status: 'PENDING',
          message: 'Ordem enfileirada para execução pelo EA'
        }));
        
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }
  
  // EA consulta ordens pendentes
  if (req.method === 'GET' && req.url === '/execute/pending') {
    console.log(`📥 EA consultando ordens pendentes...`);
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${BRIDGE_CONFIG.authToken}`) {
      console.log(`❌ Unauthorized: ${auth}`);
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    
    const pending = Array.from(PENDING_EXECUTIONS.values());
    console.log(`✅ Retornando ${pending.length} ordens pendentes para EA`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    // JSON compacto para facilitar parsing no EA
    res.end(JSON.stringify({ orders: pending, count: pending.length }, null, 0));
    return;
  }
  
  // EA reporta resultado da execução
  if (req.method === 'POST' && req.url === '/execute/result') {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${BRIDGE_CONFIG.authToken}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        console.log(`📥 RESULTADO RECEBIDO: ${body}`);
        const result = JSON.parse(body) as ExecutionResponse;
        
        // Remove da fila de pendentes
        PENDING_EXECUTIONS.delete(result.orderId);
        
        // Salva resultado
        EXECUTION_RESULTS.set(result.orderId, result);
        
        console.log(`📥 RESULTADO: ${result.orderId} → ${result.status} | Ticket: ${result.ticket || 'N/A'}`);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }
  
  // Consulta resultado de uma ordem
  if (req.method === 'GET' && req.url?.startsWith('/execute/result/')) {
    const orderId = req.url.replace('/execute/result/', '');
    const result = EXECUTION_RESULTS.get(orderId);
    
    if (result) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } else {
      // Verifica se ainda está pendente
      if (PENDING_EXECUTIONS.has(orderId)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ orderId, status: 'PENDING' }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Order not found' }));
      }
    }
    return;
  }
  
  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// ==================== PROCESS TICK ====================

function processTick(tick: TickPayload): void {
  const { symbol, bid, ask, last, volume, time, flags, source } = tick;
  
  // Initialize array if needed
  if (!BRIDGE_STATE.ticks.has(symbol)) {
    BRIDGE_STATE.ticks.set(symbol, []);
  }
  
  const ticks = BRIDGE_STATE.ticks.get(symbol)!;
  
  // Add to buffer
  ticks.push(tick);
  
  // Trim buffer
  if (ticks.length > BRIDGE_CONFIG.maxBufferSize) {
    ticks.splice(0, ticks.length - BRIDGE_CONFIG.maxBufferSize);
  }
  
  // Update timestamp
  BRIDGE_STATE.lastUpdate.set(symbol, Date.now());
  BRIDGE_STATE.totalReceived++;
  
  // Update RAM Cache for Copilot
  const prev = ramCache.get(`tick:${symbol}`) || { buyVol: 0, sellVol: 0, tickCount: 0 };
  
  const isBuy = (flags & 4) !== 0;
  const isSell = (flags & 8) !== 0;
  
  ramCache.set(`tick:${symbol}`, {
    lastPrice: last || (bid + ask) / 2,
    bid,
    ask,
    buyVol: prev.buyVol + (isBuy ? volume : 0),
    sellVol: prev.sellVol + (isSell ? volume : 0),
    lastTime: time * 1000,
    tickCount: prev.tickCount + 1,
    imbalance: (prev.buyVol + (isBuy ? volume : 0)) - (prev.sellVol + (isSell ? volume : 0)),
    source
  }, 5000);
  
  // Encaminha tick para Paper Trading Lambda
  forwardTickToLambda(tick);
  
  // Log every 1000 ticks
  if (BRIDGE_STATE.totalReceived % 1000 === 0) {
    console.log(`📊 ${symbol}: ${ticks.length} ticks | Total: ${BRIDGE_STATE.totalReceived}`);
  }
}

// ==================== FLUSH TO ORACLE ====================

async function flushToOracle(): Promise<void> {
  for (const [symbol, ticks] of BRIDGE_STATE.ticks) {
    if (ticks.length === 0) continue;
    
    const last = ticks[ticks.length - 1];
    
    try {
      await oracleDB.insert(
        `INSERT INTO mt5_ticks_bridge (
          symbol, bid, ask, last_price, volume, tick_time, source, created_at
        ) VALUES (
          :symbol, :bid, :ask, :last_price, :volume, 
          TO_DATE('1970-01-01', 'YYYY-MM-DD') + (:tick_time / 86400),
          :source, CURRENT_TIMESTAMP
        )`,
        {
          symbol,
          bid: last.bid,
          ask: last.ask,
          last_price: last.last,
          volume: last.volume,
          tick_time: last.time,
          source: last.source
        }
      );
    } catch (e) {
      // Ignore errors
    }
  }
}

// ==================== START ====================

async function start(): Promise<void> {
  console.log('\n🌐 ========================================');
  console.log('🌐 MT5 BRIDGE SERVER - OCI CLOUD');
  console.log('🌐 ========================================\n');
  
  // Ensure Oracle table
  try {
    await oracleDB.execute(`
      CREATE TABLE mt5_ticks_bridge (
        id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        symbol VARCHAR2(20),
        bid NUMBER,
        ask NUMBER,
        last_price NUMBER,
        volume NUMBER,
        tick_time TIMESTAMP,
        source VARCHAR2(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Oracle table created');
  } catch (e) {
    console.log('✅ Oracle table exists');
  }
  
  // Start HTTP server
  server.listen(BRIDGE_CONFIG.port, () => {
    console.log(`✅ Bridge Server rodando na porta ${BRIDGE_CONFIG.port}`);
    console.log(`   POST /ticks - Recebe ticks do Agent Local`);
    console.log(`   GET /ticks/:symbol - Retorna ticks para Copilot`);
    console.log(`   GET /health - Health check`);
    console.log(`   GET /status - Status dos símbolos`);
  });
  
  // Flush interval
  setInterval(flushToOracle, BRIDGE_CONFIG.flushIntervalMs);
  
  // Heartbeat Telegram
  await telegramNotifier.sendMessage('🌐 <b>MT5 BRIDGE SERVER</b>\n\nStatus: ONLINE\nPorta: ' + BRIDGE_CONFIG.port);
}

start().catch(console.error);
