/**
 * Paper Trading Lambda - Oracle Cloud
 * 
 * Sistema de paper trading que:
 * 1. Recebe preços reais do MT5 via Bridge
 * 2. Executa ordens simuladas (paper)
 * 3. Monitora TP/SL em tempo real
 * 4. Calcula P/L quando atinge alvo ou stop
 */

import * as http from 'http';
import * as fs from 'fs';
import { config } from 'dotenv';

const rootEnv = 'C:/Users/opc/CascadeProjects/vexor-Oracle/vexor-Oracle-main/.env';
if (fs.existsSync(rootEnv)) {
  config({ path: rootEnv, override: true });
}

// ==================== CONFIG ====================

const LAMBDA_CONFIG = {
  port: parseInt(process.env.LAMBDA_PORT || '8081'),
  authToken: process.env.BRIDGE_AUTH_TOKEN || 'vexor-bridge-2026',
  bridgeUrl: process.env.OCI_BRIDGE_URL || 'http://localhost:8080'
};

// ==================== PAPER TRADING STATE ====================

interface PaperPosition {
  orderId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  status: 'OPEN' | 'CLOSED';
  openTime: Date;
  closePrice?: number;
  closeTime?: Date;
  pnl?: number;
  result?: 'TARGET_HIT' | 'STOP_HIT' | 'MANUAL_CLOSE';
}

interface PriceTick {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  time: number;
}

// Estado global
const POSITIONS: Map<string, PaperPosition> = new Map();
const PRICE_CACHE: Map<string, PriceTick> = new Map();
let TRADE_HISTORY: PaperPosition[] = [];
let BALANCE = 100000; // Saldo inicial R$ 100k

// News Lock
let NEWS_LOCK_ACTIVE = false;
let NEWS_LOCK_UNTIL = 0;
let NEWS_SENTIMENT: { bias: string; win: string; wdo: string } | null = null;

// ==================== HTTP SERVER ====================

const server = http.createServer(async (req, res) => {
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
      service: 'paper-trading-lambda',
      openPositions: POSITIONS.size,
      balance: BALANCE,
      totalTrades: TRADE_HISTORY.length
    }));
    return;
  }
  
  // Status do paper trading
  if (req.url === '/status') {
    const openPositions = Array.from(POSITIONS.values()).filter(p => p.status === 'OPEN');
    
    // Verifica se News Lock expirou
    if (NEWS_LOCK_ACTIVE && Date.now() > NEWS_LOCK_UNTIL) {
      NEWS_LOCK_ACTIVE = false;
    }
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      balance: BALANCE,
      openPositions: openPositions.map(p => ({
        orderId: p.orderId,
        symbol: p.symbol,
        side: p.side,
        entryPrice: p.entryPrice,
        stopLoss: p.stopLoss,
        takeProfit: p.takeProfit,
        pnl: calculateUnrealizedPnL(p)
      })),
      totalTrades: TRADE_HISTORY.length,
      winRate: calculateWinRate(),
      newsLock: NEWS_LOCK_ACTIVE,
      sentiment: NEWS_SENTIMENT
    }));
    return;
  }
  
  // News Lock endpoint
  if (req.method === 'POST' && req.url === '/lock') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body) as any;
        NEWS_LOCK_ACTIVE = data.active;
        NEWS_LOCK_UNTIL = Date.now() + (data.duration || 5) * 60 * 1000;
        
        console.log(`🔒 NEWS LOCK: ${NEWS_LOCK_ACTIVE ? 'ATIVADO' : 'DESATIVADO'}`);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, active: NEWS_LOCK_ACTIVE }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }
  
  // Atualiza sentimento
  if (req.method === 'POST' && req.url === '/sentiment') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body) as any;
        NEWS_SENTIMENT = data;
        
        console.log(`📊 Sentimento atualizado: ${data.bias}`);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }
  
  // Recebe tick de preço do Bridge
  if (req.method === 'POST' && req.url === '/tick') {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${LAMBDA_CONFIG.authToken}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const tick = JSON.parse(body) as PriceTick;
        PRICE_CACHE.set(tick.symbol, tick);
        
        // Monitora posições abertas
        await monitorPositions(tick);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }
  
  // Executa ordem paper
  if (req.method === 'POST' && req.url === '/execute') {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${LAMBDA_CONFIG.authToken}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const order = JSON.parse(body) as {
          id: string;
          symbol: string;
          side: 'BUY' | 'SELL';
          quantity: number;
          entryPrice: number;
          stopLoss: number;
          takeProfit: number;
        };
        
        // Verifica News Lock
        if (NEWS_LOCK_ACTIVE && Date.now() < NEWS_LOCK_UNTIL) {
          const remaining = Math.ceil((NEWS_LOCK_UNTIL - Date.now()) / 1000);
          console.log(`🔒 ORDEM BLOQUEADA POR NEWS LOCK (${remaining}s restantes)`);
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: false,
            orderId: order.id,
            status: 'NEWS_LOCK',
            error: `News Lock ativo - aguarde ${remaining} segundos`,
            remainingSeconds: remaining
          }));
          return;
        }
        
        console.log(`📊 PAPER ORDER: ${order.side} ${order.quantity}x ${order.symbol} @ ${order.entryPrice}`);
        console.log(`   SL: ${order.stopLoss} | TP: ${order.takeProfit}`);
        
        // Busca preço atual do Bridge
        const currentPrice = await fetchPriceFromBridge(order.symbol);
        
        // Cria posição paper
        const position: PaperPosition = {
          orderId: order.id,
          symbol: order.symbol,
          side: order.side,
          quantity: order.quantity,
          entryPrice: currentPrice || order.entryPrice,
          stopLoss: order.stopLoss,
          takeProfit: order.takeProfit,
          status: 'OPEN',
          openTime: new Date()
        };
        
        POSITIONS.set(order.id, position);
        
        console.log(`✅ PAPER POSITION OPENED: ${order.id}`);
        console.log(`   Entry: ${position.entryPrice}`);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          orderId: order.id,
          status: 'FILLED',
          executedPrice: position.entryPrice,
          slippage: Math.abs(position.entryPrice - order.entryPrice),
          ticket: Date.now(),
          message: 'Paper order executed successfully'
        }));
        
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }
  
  // Consulta resultado de ordem
  if (req.method === 'GET' && req.url?.startsWith('/execute/result/')) {
    const orderId = req.url.replace('/execute/result/', '');
    const position = POSITIONS.get(orderId);
    
    if (position) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        orderId: position.orderId,
        status: position.status === 'OPEN' ? 'FILLED' : 'CLOSED',
        executedPrice: position.entryPrice,
        pnl: position.pnl || 0,
        result: position.result
      }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Order not found' }));
    }
    return;
  }
  
  // Fecha posição manualmente
  if (req.method === 'POST' && req.url?.startsWith('/close/')) {
    const orderId = req.url.replace('/close/', '');
    const position = POSITIONS.get(orderId);
    
    if (position && position.status === 'OPEN') {
      const currentPrice = await fetchPriceFromBridge(position.symbol);
      
      position.status = 'CLOSED';
      position.closePrice = currentPrice || position.entryPrice;
      position.closeTime = new Date();
      position.result = 'MANUAL_CLOSE';
      position.pnl = calculatePnL(position);
      
      BALANCE += position.pnl || 0;
      TRADE_HISTORY.push(position);
      
      console.log(`📉 PAPER POSITION CLOSED: ${orderId}`);
      console.log(`   Result: ${position.result} | P/L: ${position.pnl}`);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        orderId: orderId,
        status: 'CLOSED',
        pnl: position.pnl,
        result: position.result
      }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Position not found or already closed' }));
    }
    return;
  }
  
  // Histórico de trades
  if (req.url === '/history') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(TRADE_HISTORY.slice(-50)));
    return;
  }
  
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// ==================== FUNCTIONS ====================

async function fetchPriceFromBridge(symbol: string): Promise<number | null> {
  return new Promise((resolve) => {
    http.get(`${LAMBDA_CONFIG.bridgeUrl}/price/${symbol}`, {
      headers: { 'Authorization': `Bearer ${LAMBDA_CONFIG.authToken}` }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const price = JSON.parse(data) as any;
          resolve(price.bid || price.price || null);
        } catch {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

async function monitorPositions(tick: PriceTick): Promise<void> {
  for (const [orderId, position] of POSITIONS) {
    if (position.status !== 'OPEN') continue;
    if (position.symbol !== tick.symbol) continue;
    
    const currentPrice = tick.last;
    let hitTarget = false;
    let hitStop = false;
    
    if (position.side === 'BUY') {
      // BUY: TP acima, SL abaixo
      hitTarget = currentPrice >= position.takeProfit;
      hitStop = currentPrice <= position.stopLoss;
    } else {
      // SELL: TP abaixo, SL acima
      hitTarget = currentPrice <= position.takeProfit;
      hitStop = currentPrice >= position.stopLoss;
    }
    
    if (hitTarget || hitStop) {
      position.status = 'CLOSED';
      position.closePrice = currentPrice;
      position.closeTime = new Date();
      position.result = hitTarget ? 'TARGET_HIT' : 'STOP_HIT';
      position.pnl = calculatePnL(position);
      
      BALANCE += position.pnl || 0;
      TRADE_HISTORY.push(position);
      
      console.log(`🎯 PAPER POSITION CLOSED: ${orderId}`);
      console.log(`   Result: ${position.result}`);
      console.log(`   Entry: ${position.entryPrice} → Exit: ${position.closePrice}`);
      console.log(`   P/L: R$ ${position.pnl?.toFixed(2)}`);
      console.log(`   Balance: R$ ${BALANCE.toFixed(2)}`);
      
      // Envia notificação Telegram via Bridge
      await sendTelegramNotification(position);
    }
  }
}

function calculatePnL(position: PaperPosition): number {
  if (!position.closePrice) return 0;
  
  const priceDiff = position.side === 'BUY' 
    ? position.closePrice - position.entryPrice
    : position.entryPrice - position.closePrice;
  
  // WIN: cada ponto = R$ 0.20 por contrato
  // WDO: cada ponto = R$ 10 por contrato
  const pointValue = position.symbol.includes('WIN') ? 0.20 : 10;
  
  return priceDiff * position.quantity * pointValue;
}

function calculateUnrealizedPnL(position: PaperPosition): number {
  const tick = PRICE_CACHE.get(position.symbol);
  if (!tick) return 0;
  
  const currentPrice = tick.last;
  const priceDiff = position.side === 'BUY'
    ? currentPrice - position.entryPrice
    : position.entryPrice - currentPrice;
  
  const pointValue = position.symbol.includes('WIN') ? 0.20 : 10;
  return priceDiff * position.quantity * pointValue;
}

function calculateWinRate(): number {
  if (TRADE_HISTORY.length === 0) return 0;
  const wins = TRADE_HISTORY.filter(t => (t.pnl || 0) > 0).length;
  return (wins / TRADE_HISTORY.length) * 100;
}

async function sendTelegramNotification(position: PaperPosition): Promise<void> {
  const emoji = position.pnl && position.pnl > 0 ? '✅' : '❌';
  const resultEmoji = position.result === 'TARGET_HIT' ? '🎯' : '🛑';
  
  const message = `${emoji} <b>PAPER TRADE FECHADO</b>\n\n` +
    `${position.side === 'BUY' ? '🟢' : '🔴'} <b>${position.symbol}</b> - ${position.side}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `<b>Entrada:</b> ${position.entryPrice}\n` +
    `<b>Saída:</b> ${position.closePrice}\n` +
    `${resultEmoji} <b>Resultado:</b> ${position.result}\n\n` +
    `<b>P/L:</b> R$ ${position.pnl?.toFixed(2)}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `<b>Saldo:</b> R$ ${BALANCE.toFixed(2)}\n` +
    `<b>Win Rate:</b> ${calculateWinRate().toFixed(1)}%`;
  
  // Envia via Bridge
  const body = JSON.stringify({ type: 'paper_close', orderId: position.orderId, message });
  
  http.request(`${LAMBDA_CONFIG.bridgeUrl}/alert`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LAMBDA_CONFIG.authToken}`
    }
  }, (res) => {
    console.log(`📤 Notificação Telegram enviada: ${res.statusCode}`);
  }).on('error', (e) => {
    console.log(`⚠️ Erro ao enviar notificação: ${e.message}`);
  }).end(body);
}

// ==================== START ====================

server.listen(LAMBDA_CONFIG.port, () => {
  console.log('');
  console.log('📊 ========================================');
  console.log('📊 PAPER TRADING LAMBDA - ORACLE CLOUD');
  console.log('📊 ========================================');
  console.log('');
  console.log(`Porta: ${LAMBDA_CONFIG.port}`);
  console.log(`Bridge URL: ${LAMBDA_CONFIG.bridgeUrl}`);
  console.log(`Saldo Inicial: R$ ${BALANCE.toFixed(2)}`);
  console.log('');
  console.log('Endpoints:');
  console.log('  POST /execute    - Executa ordem paper');
  console.log('  POST /tick       - Recebe preço para monitorar');
  console.log('  GET  /status     - Status do paper trading');
  console.log('  GET  /history    - Histórico de trades');
  console.log('  POST /close/:id  - Fecha posição manualmente');
  console.log('');
});

// Monitor periódico de posições (busca preços do Bridge a cada 5s)
setInterval(async () => {
  for (const [orderId, position] of POSITIONS) {
    if (position.status !== 'OPEN') continue;
    
    const price = await fetchPriceFromBridge(position.symbol);
    if (price) {
      const tick: PriceTick = {
        symbol: position.symbol,
        bid: price,
        ask: price,
        last: price,
        time: Date.now()
      };
      await monitorPositions(tick);
    }
  }
}, 5000);
