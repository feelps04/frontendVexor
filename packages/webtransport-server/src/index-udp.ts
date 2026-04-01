import { createSocket, Socket, RemoteInfo } from 'dgram';
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

interface TickData {
  symbol: string;
  bid: number;
  ask: number;
  ts: number;
  source: string;
}

// Data stores
const sectorSymbols = new Map<string, SymbolData[]>();
const allSymbols = new Set<string>();
let lastPrices: TickData[] = [];

// Load symbols from CSV
async function loadSymbols(): Promise<void> {
  try {
    const csvPath = join(__dirname, '..', '..', '..', 'sectors_symbols.csv');
    const content = await readFile(csvPath, 'utf-8');
    const records = parse(content, { columns: true, skip_empty_lines: true }) as SymbolData[];
    
    sectorSymbols.clear();
    allSymbols.clear();
    
    for (const record of records) {
      const sectorId = record.sector_id;
      if (!sectorSymbols.has(sectorId)) {
        sectorSymbols.set(sectorId, []);
      }
      sectorSymbols.get(sectorId)!.push(record);
      allSymbols.add(record.symbol.toUpperCase());
    }
    
    console.log(`[UDP] Loaded ${allSymbols.size} symbols from ${sectorSymbols.size} sectors`);
  } catch (err) {
    console.error('[UDP] Failed to load symbols:', err);
  }
}

// Fetch prices from Sentinel API (MMF)
async function fetchPrices(): Promise<TickData[]> {
  try {
    const response = await fetch('http://127.0.0.1:8765/mmf/debug');
    const data = await response.json() as { 
      b3_symbols: Array<{symbol: string, bid: number, ask: number}>, 
      global_symbols: Array<{symbol: string, bid: number, ask: number}> 
    };
    
    const ticks: TickData[] = [];
    const ts = Date.now();
    
    // B3 symbols
    for (const item of data.b3_symbols || []) {
      if (item.bid > 0 || item.ask > 0) {
        ticks.push({
          symbol: item.symbol.toUpperCase(),
          bid: item.bid,
          ask: item.ask,
          ts,
          source: 'b3'
        });
      }
    }
    
    // Global symbols
    for (const item of data.global_symbols || []) {
      if (item.bid > 0 || item.ask > 0) {
        ticks.push({
          symbol: item.symbol.toUpperCase(),
          bid: item.bid,
          ask: item.ask,
          ts,
          source: 'global'
        });
      }
    }
    
    return ticks;
  } catch (err) {
    console.error('[UDP] Failed to fetch prices:', err);
    return [];
  }
}

// Main
async function main(): Promise<void> {
  const PORT = parseInt(process.env.UDP_PORT || '9208');
  
  await loadSymbols();
  
  // Create UDP socket
  const server: Socket = createSocket('udp4');
  
  // Client registry (ip:port -> subscriptions)
  const clients = new Map<string, Set<string>>();
  
  server.on('error', (err) => {
    console.error(`[UDP] Server error:\n${err.stack}`);
    server.close();
  });
  
  server.on('message', (msg: Buffer, rinfo: RemoteInfo) => {
    const clientKey = `${rinfo.address}:${rinfo.port}`;
    
    try {
      const text = msg.toString('utf8').trim();
      
      // Handle subscription
      if (text.startsWith('SUB:')) {
        const symbols = text.slice(4).split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
        clients.set(clientKey, new Set(symbols));
        console.log(`[UDP] Client ${clientKey} subscribed to ${symbols.length} symbols`);
        
        // Send ACK
        const ack = Buffer.from(`ACK:${symbols.length}`);
        server.send(ack, rinfo.port, rinfo.address);
        return;
      }
      
      // Handle sector subscription
      if (text.startsWith('SECTOR:')) {
        const sectorId = text.slice(7).trim();
        const symbols = sectorSymbols.get(sectorId) || [];
        const symbolList = symbols.map(s => s.symbol.toUpperCase());
        clients.set(clientKey, new Set(symbolList));
        console.log(`[UDP] Client ${clientKey} subscribed to sector ${sectorId} (${symbolList.length} symbols)`);
        
        // Send ACK
        const ack = Buffer.from(`ACK:${symbolList.length}`);
        server.send(ack, rinfo.port, rinfo.address);
        return;
      }
      
      // Handle unsubscribe
      if (text === 'UNSUB') {
        clients.delete(clientKey);
        console.log(`[UDP] Client ${clientKey} unsubscribed`);
        return;
      }
      
      // Handle ping
      if (text === 'PING') {
        const pong = Buffer.from('PONG');
        server.send(pong, rinfo.port, rinfo.address);
        return;
      }
      
      // Unknown command - ignore
    } catch (err) {
      console.error(`[UDP] Message error from ${clientKey}:`, err);
    }
  });
  
  server.on('listening', () => {
    const address = server.address();
    console.log(`[UDP] Server listening on ${address.address}:${address.port}`);
    console.log(`[UDP] Ready to serve ${allSymbols.size} symbols from MMF`);
  });
  
  // Bind to port
  server.bind(PORT, '0.0.0.0');
  
  // Broadcast ticks every 50ms (latência ultra-baixa)
  setInterval(async () => {
    const ticks = await fetchPrices();
    if (ticks.length === 0) return;
    
    lastPrices = ticks;
    
    // Broadcast to subscribed clients
    for (const [clientKey, subs] of clients) {
      // Filter ticks by subscription
      const filtered = subs.size > 0 
        ? ticks.filter(t => subs.has(t.symbol))
        : ticks;
      
      if (filtered.length > 0) {
        const [ip, portStr] = clientKey.split(':');
        const port = parseInt(portStr);
        
        // Send as compact JSON
        const payload = Buffer.from(JSON.stringify({ type: 'ticks', items: filtered }));
        server.send(payload, port, ip);
      }
    }
  }, 50); // 50ms = latência ultra-baixa
  
  // Cleanup stale clients every 30s
  setInterval(() => {
    // Could add heartbeat tracking here
  }, 30000);
}

main().catch(console.error);
