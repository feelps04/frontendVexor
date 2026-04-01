import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Types
interface SymbolData {
  sector_id: string;
  sector_name: string;
  exchange: string;
  symbol: string;
  description: string;
  type: string;
  full_symbol: string;
}

interface PriceData {
  symbol: string;
  priceBRL?: number;
  bid?: number;
  ask?: number;
  spread?: number;
  spreadPct?: number;
  source?: string;
  ts?: number;
}

// Data stores
const sectorSymbols = new Map<string, SymbolData[]>();
const priceCache = new Map<string, PriceData>();

// Load symbols from CSV
async function loadSymbols(): Promise<void> {
  try {
    const csvPath = join(__dirname, '..', '..', '..', 'sectors_symbols.csv');
    const content = await readFile(csvPath, 'utf-8');
    const records = parse(content, { columns: true, skip_empty_lines: true }) as SymbolData[];
    
    sectorSymbols.clear();
    let total = 0;
    
    for (const record of records) {
      const sectorId = record.sector_id;
      if (!sectorSymbols.has(sectorId)) {
        sectorSymbols.set(sectorId, []);
      }
      sectorSymbols.get(sectorId)!.push(record);
      total++;
    }
    
    console.log(`[WS] Loaded ${total} symbols from ${sectorSymbols.size} sectors`);
  } catch (err) {
    console.error('[WS] Failed to load symbols:', err);
  }
}

// Load prices from Sentinel API (MMF)
async function loadPrices(): Promise<void> {
  try {
    const response = await fetch('http://127.0.0.1:8765/mmf/debug');
    const data = await response.json() as { b3_symbols: Array<{symbol: string, bid: number, ask: number}>, global_symbols: Array<{symbol: string, bid: number, ask: number}> };
    
    priceCache.clear();
    
    // B3 symbols
    for (const item of data.b3_symbols || []) {
      if (item.bid > 0 || item.ask > 0) {
        priceCache.set(item.symbol, {
          symbol: item.symbol,
          bid: item.bid,
          ask: item.ask,
          priceBRL: item.bid || item.ask,
          source: 'b3'
        });
      }
    }
    
    // Global symbols
    for (const item of data.global_symbols || []) {
      if (item.bid > 0 || item.ask > 0) {
        priceCache.set(item.symbol, {
          symbol: item.symbol,
          bid: item.bid,
          ask: item.ask,
          priceBRL: item.bid || item.ask,
          source: 'global'
        });
      }
    }
    
    console.log(`[WS] Loaded ${priceCache.size} prices from MMF`);
  } catch (err) {
    console.error('[WS] Failed to load prices:', err);
  }
}

// Main
async function main(): Promise<void> {
  const PORT = parseInt(process.env.WS_PORT || '9300');
  
  await loadSymbols();
  await loadPrices();
  
  // Create HTTP server
  const server = createServer();
  
  // Create WebSocket server
  const wss = new WebSocketServer({ server });
  
  // Client subscriptions
  const clientSubscriptions = new Map<WebSocket, Set<string>>();
  
  wss.on('connection', (ws) => {
    console.log('[WS] Client connected');
    clientSubscriptions.set(ws, new Set());
    
    // Send initial data
    const initMsg = {
      type: 'init',
      symbols: Array.from(priceCache.entries()).slice(0, 50).map(([sym, data]) => ({
        ...data,
        symbol: sym
      }))
    };
    ws.send(JSON.stringify(initMsg));
    
    // Handle messages
    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        
        if (msg.type === 'subscribe' && msg.symbols) {
          const subs = clientSubscriptions.get(ws) || new Set();
          subs.clear();
          for (const s of msg.symbols) {
            subs.add(String(s).toUpperCase());
          }
          clientSubscriptions.set(ws, subs);
          console.log(`[WS] Client subscribed to ${subs.size} symbols`);
          
          // Send subscribed prices
          const prices: PriceData[] = [];
          for (const sym of subs) {
            const p = priceCache.get(sym);
            if (p) prices.push({ ...p, symbol: sym });
          }
          if (prices.length > 0) {
            ws.send(JSON.stringify({ type: 'prices', items: prices }));
          }
        }
        
        if (msg.type === 'get_sector' && msg.sector_id) {
          const symbols = sectorSymbols.get(msg.sector_id) || [];
          ws.send(JSON.stringify({ type: 'sector_symbols', sectorId: msg.sector_id, symbols: symbols.map(s => s.symbol) }));
        }
      } catch (err) {
        console.error('[WS] Message error:', err);
      }
    });
    
    // Handle close
    ws.on('close', () => {
      console.log('[WS] Client disconnected');
      clientSubscriptions.delete(ws);
    });
  });
  
  // Periodic price broadcast (100ms interval for low latency)
  setInterval(async () => {
    await loadPrices();
    
    const ticks = Array.from(priceCache.entries()).map(([sym, data]) => ({
      ...data,
      symbol: sym
    }));
    
    if (ticks.length > 0) {
      // Broadcast to all clients
      const msg = JSON.stringify({ type: 'ticks', items: ticks });
      for (const [ws, subs] of clientSubscriptions) {
        if (ws.readyState === WebSocket.OPEN) {
          // Filter by subscription if set
          if (subs.size > 0) {
            const filtered = ticks.filter(t => subs.has(t.symbol));
            if (filtered.length > 0) {
              ws.send(JSON.stringify({ type: 'ticks', items: filtered }));
            }
          } else {
            ws.send(msg);
          }
        }
      }
    }
  }, 100); // 100ms = latência baixa
  
  // Start server
  server.listen(PORT, () => {
    console.log(`[WS] WebSocket server listening on port ${PORT}`);
    console.log(`[WS] Ready to serve ${priceCache.size} prices from MMF`);
  });
}

main().catch(console.error);
