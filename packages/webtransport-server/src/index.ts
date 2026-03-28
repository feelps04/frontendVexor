import { Http3Server } from '@fails-components/webtransport';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';
import forge from 'node-forge';

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

interface FeedMessage {
  type: 'tick' | 'ticks' | 'init' | 'feed_status';
  symbol?: string;
  items?: PriceData[];
  lastPrices?: Record<string, PriceData>;
  stale?: boolean;
  ageMs?: number;
}

// Symbol cache from CSV
let symbolsBySector: Map<string, SymbolData[]> = new Map();
let allSymbols: Set<string> = new Set();

// Price cache from MT5
let priceCache: Map<string, PriceData> = new Map();
let lastPriceUpdate = 0;
let feedStale = false;

// Client sessions with subscriptions
const sessions: Map<any, Set<string>> = new Map();

// Load symbols from sectors_symbols.csv
async function loadSymbols(): Promise<void> {
  const csvPath = join(__dirname, '..', '..', '..', 'sectors_symbols.csv');
  
  if (existsSync(csvPath)) {
    try {
      const content = await readFile(csvPath, 'utf-8');
      const records = parse(content, {
        columns: true,
        skip_empty_lines: true
      }) as SymbolData[];
      
      symbolsBySector.clear();
      allSymbols.clear();
      
      for (const record of records) {
        const sectorId = record.sector_id;
        if (!symbolsBySector.has(sectorId)) {
          symbolsBySector.set(sectorId, []);
        }
        symbolsBySector.get(sectorId)!.push(record);
        allSymbols.add(record.symbol);
      }
      
      console.log(`[WebTransport] Loaded ${allSymbols.size} symbols from ${symbolsBySector.size} sectors`);
    } catch (err) {
      console.warn('[WebTransport] Error loading symbols:', err);
    }
  }
}

// Load prices from mt5_prices.json
async function loadPrices(): Promise<void> {
  const mt5Path = join(__dirname, '..', '..', '..', 'scripts', 'mt5_prices.json');
  
  if (existsSync(mt5Path)) {
    try {
      const content = await readFile(mt5Path, 'utf-8');
      const data = JSON.parse(content);
      
      if (data && typeof data === 'object') {
        priceCache.clear();
        
        for (const [symbol, priceData] of Object.entries(data)) {
          if (typeof priceData === 'number') {
            priceCache.set(symbol, {
              symbol,
              priceBRL: priceData,
              source: 'mt5'
            });
          } else if (typeof priceData === 'object' && priceData !== null) {
            priceCache.set(symbol, {
              symbol,
              ...(priceData as object)
            });
          }
        }
        
        lastPriceUpdate = Date.now();
        feedStale = false;
        console.log(`[WebTransport] Loaded ${priceCache.size} prices from MT5`);
      }
    } catch (err) {
      console.warn('[WebTransport] Error loading prices:', err);
    }
  }
}

// Broadcast ticks via unreliable datagrams (low latency)
async function broadcastTicks(ticks: PriceData[]): Promise<void> {
  const message: FeedMessage = { type: 'ticks', items: ticks };
  const payload = Buffer.from(JSON.stringify(message));
  
  for (const [session, subscribedSymbols] of sessions) {
    const relevantTicks = ticks.filter(t => subscribedSymbols.has(t.symbol));
    if (relevantTicks.length === 0) continue;
    
    try {
      const writer = session.datagrams.writable.getWriter();
      await writer.write(payload);
      writer.releaseLock();
    } catch {
      // Session might be closed
    }
  }
}

// Send initial prices via reliable stream
async function sendInitialPrices(session: any, symbols: string[]): Promise<void> {
  const lastPrices: Record<string, PriceData> = {};
  
  for (const sym of symbols) {
    const price = priceCache.get(sym);
    if (price) lastPrices[sym] = price;
  }
  
  const message: FeedMessage = {
    type: 'init',
    lastPrices,
    stale: feedStale,
    ageMs: lastPriceUpdate ? Date.now() - lastPriceUpdate : 0
  };
  
  try {
    const stream = await session.createUnidirectionalStream();
    const writer = stream.getWriter();
    await writer.write(Buffer.from(JSON.stringify(message)));
    await writer.close();
    console.log(`[WebTransport] Sent init with ${Object.keys(lastPrices).length} prices`);
  } catch (err) {
    console.warn('[WebTransport] Error sending initial prices:', err);
  }
}

// Handle incoming datagram from client
async function handleClientMessage(session: any, data: Buffer): Promise<void> {
  try {
    const msg = JSON.parse(data.toString());
    const subscribedSymbols = sessions.get(session);
    if (!subscribedSymbols) return;
    
    if (msg.type === 'set_symbols' && Array.isArray(msg.symbols)) {
      const newSymbols = new Set<string>(msg.symbols.map((s: string) => s.toUpperCase()));
      sessions.set(session, newSymbols);
      console.log(`[WebTransport] Client subscribed to ${newSymbols.size} symbols`);
      await sendInitialPrices(session, msg.symbols);
    }
    
    if (msg.type === 'get_sector' && msg.sector_id) {
      const sectorSymbols = symbolsBySector.get(msg.sector_id) || [];
      const symbols = sectorSymbols.map(s => s.symbol);
      sessions.set(session, new Set<string>(symbols));
      await sendInitialPrices(session, symbols);
    }
  } catch (err) {
    console.warn('[WebTransport] Error parsing message:', err);
  }
}

// Setup session handlers
function setupSession(session: any): void {
  console.log('[WebTransport] New client session');
  sessions.set(session, new Set());
  
  // Handle incoming datagrams
  const datagramReader = session.datagrams.readable.getReader();
  (async () => {
    try {
      while (true) {
        const { value, done } = await datagramReader.read();
        if (done) break;
        await handleClientMessage(session, value);
      }
    } catch {}
  })();
  
  // Handle incoming bidirectional streams
  const streamReader = session.incomingBidirectionalStreams.getReader();
  (async () => {
    try {
      while (true) {
        const { value: stream, done } = await streamReader.read();
        if (done) break;
        const reader = stream.readable.getReader();
        try {
          while (true) {
            const { value, done: streamDone } = await reader.read();
            if (streamDone) break;
            await handleClientMessage(session, value);
          }
        } catch {}
      }
    } catch {}
  })();
  
  session.closed.then(() => {
    console.log('[WebTransport] Session closed');
    sessions.delete(session);
  }).catch(() => sessions.delete(session));
}

// Generate self-signed certificates using node-forge
async function ensureCertificates(): Promise<{ key: string; cert: string }> {
  const certsDir = join(__dirname, 'certs');
  const keyPath = join(certsDir, 'key.pem');
  const certPath = join(certsDir, 'cert.pem');
  
  if (!existsSync(certsDir)) mkdirSync(certsDir, { recursive: true });
  
  if (!existsSync(keyPath) || !existsSync(certPath)) {
    console.log('[WebTransport] Generating self-signed certificates...');
    
    // Generate key pair
    const keys = forge.pki.rsa.generateKeyPair(2048);
    
    // Create certificate
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
    
    // Set subject
    const attrs = [
      { name: 'commonName', value: 'localhost' },
      { name: 'organizationName', value: 'Vexor' },
      { name: 'countryName', value: 'BR' }
    ];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    
    // Set extensions
    cert.setExtensions([
      { name: 'basicConstraints', cA: true },
      { name: 'keyUsage', keyCertSign: true, digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [
        { type: 2, value: 'localhost' },
        { type: 7, ip: '127.0.0.1' }
      ]}
    ]);
    
    // Sign certificate
    cert.sign(keys.privateKey, forge.md.sha256.create());
    
    // Convert to PEM
    const privateKeyPem = forge.pki.privateKeyToPem(keys.privateKey);
    const certPem = forge.pki.certificateToPem(cert);
    
    writeFileSync(keyPath, privateKeyPem);
    writeFileSync(certPath, certPem);
    console.log('[WebTransport] Certificates generated');
  }
  
  return { key: readFileSync(keyPath, 'utf-8'), cert: readFileSync(certPath, 'utf-8') };
}

// Main
async function main(): Promise<void> {
  const PORT = parseInt(process.env.WEBTRANSPORT_PORT || '9003');
  
  await loadSymbols();
  await loadPrices();
  
  // Periodic price reload and broadcast
  setInterval(async () => {
    await loadPrices();
    const ticks = Array.from(priceCache.values());
    if (ticks.length > 0) await broadcastTicks(ticks);
  }, 1000);
  
  const { key, cert } = await ensureCertificates();
  
  const server = new Http3Server({
    port: PORT,
    host: '0.0.0.0',
    secret: 'vexor-webtransport-secret',
    cert,
    privKey: key
  });
  
  // Get session stream for path '/'
  const sessionStream = server.sessionStream('/');
  const reader = sessionStream.getReader();
  
  // Handle sessions from stream
  (async () => {
    try {
      while (true) {
        const { value: session, done } = await reader.read();
        if (done) break;
        setupSession(session);
      }
    } catch (err) {
      console.error('[WebTransport] Session stream error:', err);
    }
  })();
  
  server.startServer();
  
  console.log(`[WebTransport] Server listening on https://localhost:${PORT}`);
  console.log(`[WebTransport] Symbols: ${allSymbols.size} from ${symbolsBySector.size} sectors`);
}

main().catch(console.error);
