import { geckos } from '@geckos.io/server';
import { readFileSync, existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';
import { createSocket } from 'dgram';

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

interface DeltaPacket {
  s: string;  // symbol
  b: number;  // bid
  a: number;  // ask
  e?: string; // exchange
  br?: string; // broker
  t: number;  // timestamp
}

interface BatchPacket {
  type: 'deltas';
  items: DeltaPacket[];
  t: number;
}

// Data stores
const sectorSymbols = new Map<string, SymbolData[]>();
const priceCache = new Map<string, PriceData>();

// UDP Server for Python Bridge (Zero-Copy)
const UDP_PORT = 10209;  // Porta diferente do TCP Geckos
const udpServer = createSocket('udp4');

udpServer.on('message', (msg: Buffer, rinfo) => {
  try {
    const data = JSON.parse(msg.toString()) as BatchPacket | DeltaPacket;
    
    // Batch de deltas
    if ('type' in data && data.type === 'deltas') {
      for (const delta of data.items) {
        updatePrice(delta);
      }
      // Emite imediatamente para clientes conectados
      broadcastPrices();
    }
    // Delta único
    else if ('s' in data) {
      updatePrice(data as DeltaPacket);
      broadcastPrices();
    }
  } catch (err) {
    // Ignora pacotes inválidos
  }
});

function updatePrice(delta: DeltaPacket): void {
  const { s: symbol, b: bid, a: ask, e: exchange, br: broker, t: ts } = delta;
  const spread = ask - bid;
  const spreadPct = bid > 0 ? (spread / bid) * 100 : 0;
  
  priceCache.set(symbol, {
    symbol,
    bid,
    ask,
    priceBRL: (bid + ask) / 2,
    spread,
    spreadPct,
    source: broker || 'udp',
    ts
  });
}

function broadcastPrices(): void {
  // Limita a 50 ticks por broadcast para não exceder maxMessageSize
  const ticks = Array.from(priceCache.entries())
    .slice(0, 50)
    .map(([sym, data]) => ({ ...data, symbol: sym }));
  
  if (ticks.length > 0 && io) {
    io.emit('ticks', { type: 'ticks', items: ticks });
  }
}

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
    
    console.log(`[Geckos] Loaded ${total} symbols from ${sectorSymbols.size} sectors`);
  } catch (err) {
    console.error('[Geckos] Failed to load symbols:', err);
  }
}

// Load prices from Sentinel API (MMF)
async function loadPrices(): Promise<void> {
  try {
    const response = await fetch('http://127.0.0.1:8765/mmf/debug');
    const data = await response.json() as { 
      b3_symbols: Array<{symbol: string, bid: number, ask: number, exchange?: string, broker?: string, pair?: string}>,
      global_symbols: Array<{symbol: string, bid: number, ask: number, exchange?: string, broker?: string, pair?: string}>,
      b3_connected: boolean,
      global_connected: boolean,
      b3_count: number,
      global_count: number
    };
    
    priceCache.clear();
    
    // Process B3 symbols
    for (const item of data.b3_symbols || []) {
      if (item.bid > 0 || item.ask > 0) {
        const price: PriceData = {
          symbol: item.symbol,
          bid: item.bid,
          ask: item.ask,
          priceBRL: item.bid || item.ask,
          source: 'B3',
          ts: Date.now()
        };
        priceCache.set(item.symbol, price);
      }
    }
    
    // Process Global symbols
    for (const item of data.global_symbols || []) {
      if (item.bid > 0 || item.ask > 0) {
        const price: PriceData = {
          symbol: item.symbol,
          bid: item.bid,
          ask: item.ask,
          priceBRL: item.bid || item.ask,
          source: 'GLOBAL',
          ts: Date.now()
        };
        priceCache.set(item.symbol, price);
      }
    }
    
    const total = (data.b3_count || 0) + (data.global_count || 0);
    console.log(`[Geckos] Loaded ${priceCache.size} prices from MMF (B3: ${data.b3_count || 0}, Global: ${data.global_count || 0})`);
  } catch (err) {
    console.error('[Geckos] Failed to load prices:', err);
  }
}

// Load prices from Binance API (crypto)
async function loadBinancePrices(): Promise<number> {
  try {
    const response = await fetch('https://api.binance.com/api/v3/ticker/price');
    const data = await response.json() as Array<{symbol: string, price: string}>;
    
    let count = 0;
    const stablecoins: Record<string, number> = { USDT: 1, USDC: 1, BUSD: 1, DAI: 1 };
    
    for (const item of data) {
      const symbol = item.symbol;
      const price = parseFloat(item.price);
      
      if (price > 0) {
        // Extract base symbol (BTCUSDT -> BTC)
        let base = symbol;
        for (const suffix of ['USDT', 'BRL', 'USD', 'BUSD']) {
          if (symbol.endsWith(suffix)) {
            base = symbol.slice(0, -suffix.length);
            break;
          }
        }
        
        // Add both full symbol and base
        const priceData: PriceData = {
          symbol: base,
          bid: price,
          ask: price,
          priceBRL: price,
          source: 'BINANCE',
          ts: Date.now()
        };
        
        priceCache.set(base, priceData);
        priceCache.set(symbol, { ...priceData, symbol });
        count++;
      }
    }
    
    console.log(`[Geckos] Loaded ${count} prices from Binance`);
    return count;
  } catch (err) {
    console.error('[Geckos] Failed to load Binance prices:', err);
    return 0;
  }
}

// Main
let io: any;  // Geckos server instance

async function main(): Promise<void> {
  const PORT = parseInt(process.env.GECKOS_PORT || '9208');
  
  await loadSymbols();
  await loadPrices();
  await loadBinancePrices();
  
  // Start UDP server for Python Bridge
  udpServer.bind(UDP_PORT, () => {
    console.log(`[UDP] Server listening on port ${UDP_PORT} for Python Bridge`);
  });
  
  // Create Geckos server (UDP/WebRTC)
  io = geckos({
    portRange: {
      min: PORT,
      max: PORT + 100
    }
  });
  
  console.log(`[Geckos] Server created with portRange ${PORT}-${PORT + 100}`);
  console.log(`[Geckos] Signaling server will listen on port ${PORT + 1000}`);
  
  // Handle connections
  io.onConnection((channel: any) => {
    console.log('[Geckos] Client connected:', channel.id);
    
    const subscriptions = new Set<string>();
    
    // Send initial data
    const initMsg = {
      type: 'init',
      symbols: Array.from(priceCache.entries()).slice(0, 50).map(([sym, data]) => ({
        ...data,
        symbol: sym
      }))
    };
    channel.emit('init', initMsg);
    
    // Handle messages
    channel.on('set_symbols', (data: any) => {
      const symbols = data?.symbols || [];
      subscriptions.clear();
      for (const s of symbols) {
        subscriptions.add(String(s).toUpperCase());
      }
      console.log(`[Geckos] Client ${channel.id} subscribed to ${subscriptions.size} symbols`);
      
      // Send subscribed prices
      const prices: PriceData[] = [];
      for (const sym of subscriptions) {
        const p = priceCache.get(sym);
        if (p) prices.push({ ...p, symbol: sym });
      }
      if (prices.length > 0) {
        channel.emit('prices', { type: 'prices', items: prices });
      }
    });
    
    channel.on('get_sector', (data: any) => {
      const sectorId = data?.sector_id;
      const symbols = sectorSymbols.get(sectorId) || [];
      channel.emit('sector_symbols', { sectorId, symbols: symbols.map(s => s.symbol) });
    });
    
    // Handle disconnection
    channel.onDisconnect(() => {
      console.log('[Geckos] Client disconnected:', channel.id);
    });
  });
  
  // Event-driven: carrega preços a cada 10ms e emite deltas imediatamente
  let lastPriceCount = 0;
  let lastTimestamp = 0;
  
  async function broadcastDeltas() {
    await loadPrices();
    await loadBinancePrices();
    
    // Limita a 50 ticks por broadcast para não exceder maxMessageSize
    const ticks = Array.from(priceCache.entries())
      .slice(0, 50)
      .map(([sym, data]) => ({
        ...data,
        symbol: sym
      }));
    
    // Emite apenas se houver mudança
    if (ticks.length > 0 && (priceCache.size !== lastPriceCount || Date.now() - lastTimestamp > 100)) {
      io.emit('ticks', { type: 'ticks', items: ticks });
      lastPriceCount = priceCache.size;
      lastTimestamp = Date.now();
    }
  }
  
  // Loop de 1s para latência razoável (event-driven)
  setInterval(broadcastDeltas, 1000);
  
  // Start server
  io.listen(PORT + 1000);
  
  console.log(`[Geckos] Server listening on UDP port ${PORT}-${PORT + 100}`);
  console.log(`[Geckos] HTTP server on port ${PORT + 1000}`);
  console.log(`[Geckos] Event-driven broadcast at 10ms intervals`);
}

main().catch(console.error);
