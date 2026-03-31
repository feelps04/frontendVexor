import type { IncomingMessage, ServerResponse } from 'node:http';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tick = {
  symbol: string;
  bid: number;
  ask: number;
  volume: bigint;
  timestamp: bigint;
  source: 'genial';
};

type SectorSymbolRow = {
  sector_id: string;
  sector_name: string;
  exchange: string;
  symbol: string;
  description: string;
  type: string;
  full_symbol: string;
};

type SectorInfo = {
  sector_id: string;
  sector_name: string;
  count: number;
  exchanges: string[];
};

type SectorData = {
  sectors: SectorInfo[];
  symbolsBySector: Map<string, SectorSymbolRow[]>;
  loadedAt: number;
};

type QuoteItem = {
  symbol: string;
  exchange: string;
  priceBRL?: number;
  status: 'ok' | 'no_data';
  message?: string;
  updatedAt?: number;
  source?: string;
};

// ---------------------------------------------------------------------------
// MT5 tick cache (existing functionality)
// ---------------------------------------------------------------------------

const ticksCache = new Map<string, Tick>();

function extractBearer(auth: string): string {
  const lower = auth.toLowerCase();
  if (lower.startsWith('bearer ')) return auth.slice(7).trim();
  return auth.trim();
}

function isAuthorized(req: IncomingMessage): boolean {
  const secret = (process.env.VEXOR_MT5_SECRET ?? '').trim();
  if (!secret) return true;
  const auth = String(req.headers['authorization'] ?? '');
  const alt = String(req.headers['x-vexor-secret'] ?? '');
  const url = new URL(req.url ?? '/', 'http://localhost');
  const querySecret = (url.searchParams.get('secret') ?? '').trim();
  return extractBearer(auth) === secret || alt.trim() === secret || querySecret === secret;
}

function toNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

async function readJsonBody(req: IncomingMessage): Promise<any> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) chunks.push(chunk as Uint8Array);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function normalizeTick(item: any): Tick | null {
  const symbol = String(item?.symbol ?? '').trim().toUpperCase();
  if (!symbol) return null;
  const bid = toNum(item?.bid);
  const ask = toNum(item?.ask, bid);
  if (bid <= 0 && ask <= 0) return null;
  return {
    symbol,
    bid,
    ask,
    volume: BigInt(Math.max(0, Math.round(toNum(item?.volume)))),
    timestamp: BigInt(Date.now()),
    source: 'genial',
  };
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization,x-vexor-secret',
  };
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  Object.entries({ ...corsHeaders(), 'content-type': 'application/json; charset=utf-8' }).forEach(([k, v]) =>
    res.setHeader(k, v)
  );
  res.end(JSON.stringify(payload));
}

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; continue; }
      inQ = !inQ;
      continue;
    }
    if (ch === ',' && !inQ) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const vals = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = vals[i] ?? ''; });
    return row;
  });
}

// ---------------------------------------------------------------------------
// Sector data (loaded from hosted CSV, cached in memory)
// ---------------------------------------------------------------------------

let sectorCache: SectorData | null = null;
const SECTOR_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

const SECTORS_CSV_URL =
  (process.env.SECTORS_CSV_URL ?? '').trim() || 'https://vexorflow.com/sectors_symbols.csv';

async function loadSectorData(): Promise<SectorData> {
  if (sectorCache && Date.now() - sectorCache.loadedAt < SECTOR_CACHE_TTL_MS) {
    return sectorCache;
  }

  let rows: Record<string, string>[] = [];
  try {
    const res = await fetch(SECTORS_CSV_URL, { signal: AbortSignal.timeout(12_000) });
    if (res.ok) {
      const text = await res.text();
      rows = parseCsv(text);
    }
  } catch {
    // If fetch fails and we have stale cache, keep using it
    if (sectorCache) return sectorCache;
  }

  const symbolsBySector = new Map<string, SectorSymbolRow[]>();
  const sectorMeta = new Map<string, { name: string; exchanges: Set<string> }>();

  for (const row of rows) {
    const id = String(row['sector_id'] ?? '').trim();
    const name = String(row['sector_name'] ?? '').trim();
    const exchange = String(row['exchange'] ?? '').trim();
    const symbol = String(row['symbol'] ?? '').trim().toUpperCase();
    if (!id || !symbol) continue;

    if (!sectorMeta.has(id)) sectorMeta.set(id, { name, exchanges: new Set() });
    sectorMeta.get(id)!.exchanges.add(exchange);

    const sym: SectorSymbolRow = {
      sector_id: id,
      sector_name: name,
      exchange,
      symbol,
      description: String(row['description'] ?? '').trim(),
      type: String(row['type'] ?? '').trim(),
      full_symbol: String(row['full_symbol'] ?? '').trim() || `${exchange}\\${symbol}`,
    };
    if (!symbolsBySector.has(id)) symbolsBySector.set(id, []);
    symbolsBySector.get(id)!.push(sym);
  }

  const sectors: SectorInfo[] = Array.from(sectorMeta.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, meta]) => ({
      sector_id: id,
      sector_name: meta.name,
      count: symbolsBySector.get(id)?.length ?? 0,
      exchanges: Array.from(meta.exchanges),
    }));

  sectorCache = { sectors, symbolsBySector, loadedAt: Date.now() };
  return sectorCache;
}

// ---------------------------------------------------------------------------
// BRAPI quotes
// ---------------------------------------------------------------------------

const BRAPI_TOKEN = (process.env.BRAPI_TOKEN ?? '').trim();
const BRAPI_BASE = 'https://brapi.dev/api';

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchBrapiQuotes(symbols: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!BRAPI_TOKEN || symbols.length === 0) return out;

  const chunks = chunkArray(symbols, 50);
  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const url = `${BRAPI_BASE}/quote/${chunk.join(',')}?token=${BRAPI_TOKEN}&range=1d&interval=1d`;
        const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) return;
        const data: any = await res.json();
        for (const item of data?.results ?? []) {
          const price = item?.regularMarketPrice;
          if (item?.symbol && Number.isFinite(price) && price > 0) {
            out.set(String(item.symbol).toUpperCase(), price);
          }
        }
      } catch {
        // ignore chunk failure
      }
    })
  );
  return out;
}

// ---------------------------------------------------------------------------
// Normalise sector ID from URL param
// ---------------------------------------------------------------------------

function normaliseSectorId(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const method = String(req.method ?? 'GET').toUpperCase();
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.statusCode = 204;
    Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
    res.end();
    return;
  }

  // -------------------------------------------------------------------------
  // MT5 webhook routes (existing)
  // -------------------------------------------------------------------------

  if (method === 'GET' && path === '/api/v1/mt5/status') {
    const sample = Array.from(ticksCache.values()).slice(0, 10).map((t) => ({
      symbol: t.symbol,
      bid: t.bid,
      ask: t.ask,
      ts: Number(t.timestamp),
    }));
    return json(res, 200, {
      source: 'genial',
      active_symbols: ticksCache.size,
      symbols: Array.from(ticksCache.keys()).sort(),
      sample,
    });
  }

  if (method === 'POST' && path === '/api/v1/mt5/tick') {
    if (!isAuthorized(req)) return json(res, 401, { error: 'Unauthorized' });
    try {
      const body = await readJsonBody(req);
      const tick = normalizeTick(body);
      if (!tick) return json(res, 400, { error: 'Invalid payload — required: symbol + bid/ask' });
      ticksCache.set(tick.symbol, tick);
      return json(res, 200, { ok: true, symbol: tick.symbol, bid: tick.bid, ask: tick.ask });
    } catch {
      return json(res, 400, { error: 'Invalid JSON body' });
    }
  }

  if (method === 'POST' && path === '/api/v1/mt5/ticks') {
    if (!isAuthorized(req)) return json(res, 401, { error: 'Unauthorized' });
    try {
      const body = await readJsonBody(req);
      const items = body?.ticks;
      if (!Array.isArray(items) || items.length === 0) {
        return json(res, 400, { error: 'body.ticks must be a non-empty array' });
      }
      json(res, 202, { ok: true, accepted: items.length });
      setImmediate(() => {
        for (const item of items) {
          const tick = normalizeTick(item);
          if (tick) ticksCache.set(tick.symbol, tick);
        }
      });
      return;
    } catch {
      return json(res, 400, { error: 'Invalid JSON body' });
    }
  }

  // -------------------------------------------------------------------------
  // Sector data routes (python-api compatible)
  // -------------------------------------------------------------------------

  if (method === 'GET' && path === '/python-api/sectors') {
    try {
      const data = await loadSectorData();
      // Merge MT5 live symbols into a virtual sector if any are active
      const sectors = [...data.sectors];
      if (ticksCache.size > 0) {
        sectors.unshift({
          sector_id: 'mt5_live',
          sector_name: 'MT5 Live Feed',
          count: ticksCache.size,
          exchanges: ['B3'],
        });
      }
      return json(res, 200, { sectors });
    } catch {
      return json(res, 200, { sectors: [] });
    }
  }

  if (method === 'GET' && path === '/python-api/symbols') {
    return json(res, 200, {
      symbols: Array.from(ticksCache.keys()).sort().map((symbol) => ({ symbol })),
    });
  }

  const pythonSectorSymbolsMatch = path.match(/^\/python-api\/sectors\/([^/]+)\/symbols$/);
  if (method === 'GET' && pythonSectorSymbolsMatch) {
    const sectorId = normaliseSectorId(decodeURIComponent(pythonSectorSymbolsMatch[1]));

    if (sectorId === 'mt5_live') {
      const symbols = Array.from(ticksCache.values()).map((t) => ({
        symbol: t.symbol,
        exchange: 'B3',
        description: t.symbol,
        type: 'equity',
        full_symbol: `B3\\${t.symbol}`,
      }));
      return json(res, 200, { sector_id: 'mt5_live', sector_name: 'MT5 Live Feed', symbols });
    }

    try {
      const data = await loadSectorData();
      const list = data.symbolsBySector.get(sectorId) ?? [];
      const sectorName = data.sectors.find((s) => s.sector_id === sectorId)?.sector_name ?? `Setor ${sectorId}`;
      return json(res, 200, {
        sector_id: sectorId,
        sector_name: sectorName,
        symbols: list.map((s) => ({
          symbol: s.symbol,
          exchange: s.exchange,
          description: s.description,
          type: s.type,
          full_symbol: s.full_symbol,
        })),
      });
    } catch {
      return json(res, 200, { sector_id: sectorId, sector_name: sectorId, symbols: [] });
    }
  }

  if (method === 'POST' && path === '/python-api/ticks/batch') {
    try {
      const body = await readJsonBody(req);
      const symbolsRaw = Array.isArray(body?.symbols) ? body.symbols : [];
      const requested = symbolsRaw.map((s: unknown) => String(s || '').toUpperCase()).filter(Boolean);
      const source = requested.length > 0 ? requested : Array.from(ticksCache.keys());
      const ticks = source
        .map((sym) => ticksCache.get(sym))
        .filter((t): t is Tick => Boolean(t))
        .map((t) => ({
          symbol: t.symbol,
          bid: t.bid,
          ask: t.ask,
          priceBRL: t.ask > 0 ? t.ask : t.bid,
          source: t.source,
          ts: Number(t.timestamp),
        }));
      return json(res, 200, { ticks });
    } catch {
      return json(res, 400, { error: 'Invalid JSON body' });
    }
  }

  if (method === 'POST' && path === '/python-api/ohlcv') {
    try {
      const body = await readJsonBody(req);
      const symbol = String(body?.symbol ?? '').toUpperCase();
      const t = ticksCache.get(symbol);
      const close = t ? (t.ask > 0 ? t.ask : t.bid) : 0;
      const now = Date.now();
      return json(res, 200, {
        symbol,
        timeframe: String(body?.timeframe ?? 'M5'),
        data:
          close > 0
            ? [{ time: now, open: close, high: close, low: close, close, volume: Number(t?.volume ?? 0n) }]
            : [],
      });
    } catch {
      return json(res, 400, { error: 'Invalid JSON body' });
    }
  }

  // -------------------------------------------------------------------------
  // Market / Sectors API routes
  // -------------------------------------------------------------------------

  if (method === 'GET' && path === '/api/v1/market/sectors') {
    try {
      const data = await loadSectorData();
      const sectors = [...data.sectors];
      if (ticksCache.size > 0) {
        sectors.unshift({
          sector_id: 'mt5_live',
          sector_name: 'MT5 Live Feed',
          count: ticksCache.size,
          exchanges: ['B3'],
        });
      }
      return json(res, 200, { sectors, total: sectors.length });
    } catch {
      return json(res, 200, { sectors: [], total: 0 });
    }
  }

  if (method === 'GET' && path === '/api/v1/market/health') {
    return json(res, 200, {
      status: 'ok',
      mt5_symbols: ticksCache.size,
      sector_cache_age_ms: sectorCache ? Date.now() - sectorCache.loadedAt : null,
      brapi_configured: BRAPI_TOKEN.length > 0,
    });
  }

  const sectorDetailMatch = path.match(/^\/api\/v1\/market\/sectors\/([^/]+)$/);
  if (method === 'GET' && sectorDetailMatch) {
    const sectorId = normaliseSectorId(decodeURIComponent(sectorDetailMatch[1]));
    try {
      const data = await loadSectorData();
      const sector = data.sectors.find((s) => s.sector_id === sectorId);
      if (!sector) return json(res, 404, { error: 'Sector not found', sectorId });
      return json(res, 200, sector);
    } catch {
      return json(res, 500, { error: 'Failed to load sector data' });
    }
  }

  const sectorSymbolsMatch = path.match(/^\/api\/v1\/market\/sectors\/([^/]+)\/symbols$/);
  if (method === 'GET' && sectorSymbolsMatch) {
    const sectorId = normaliseSectorId(decodeURIComponent(sectorSymbolsMatch[1]));
    try {
      const data = await loadSectorData();
      const list = data.symbolsBySector.get(sectorId) ?? [];
      return json(res, 200, {
        sectorId,
        total: list.length,
        symbols: list.map((s) => ({
          symbol: s.symbol,
          exchange: s.exchange,
          description: s.description,
          type: s.type,
          full_symbol: s.full_symbol,
        })),
      });
    } catch {
      return json(res, 200, { sectorId, total: 0, symbols: [] });
    }
  }

  const sectorQuotesMatch = path.match(/^\/api\/v1\/market\/sectors\/([^/]+)\/quotes$/);
  if (method === 'GET' && sectorQuotesMatch) {
    const sectorId = normaliseSectorId(decodeURIComponent(sectorQuotesMatch[1]));

    // MT5 live sector
    if (sectorId === 'mt5_live') {
      const items: QuoteItem[] = Array.from(ticksCache.values()).map((t) => ({
        symbol: t.symbol,
        exchange: 'B3',
        priceBRL: t.ask > 0 ? t.ask : t.bid,
        status: 'ok',
        updatedAt: Number(t.timestamp),
        source: 'mt5',
      }));
      return json(res, 200, { sectorId, total: items.length, items });
    }

    try {
      const data = await loadSectorData();
      const limitParam = url.searchParams.get('limit');
      const limit = limitParam ? Math.max(1, Math.min(50_000, parseInt(limitParam, 10))) : null;

      let list = data.symbolsBySector.get(sectorId) ?? [];
      const exchangeParam = (url.searchParams.get('exchange') ?? '').trim().toUpperCase();
      if (exchangeParam) list = list.filter((s) => s.exchange === exchangeParam);
      if (limit !== null) list = list.slice(0, limit);

      const items: QuoteItem[] = [];

      // First: check MT5 cache
      const brapiSymbols: string[] = [];
      for (const s of list) {
        const mt5 = ticksCache.get(s.symbol);
        if (mt5) {
          items.push({
            symbol: s.symbol,
            exchange: s.exchange,
            priceBRL: mt5.ask > 0 ? mt5.ask : mt5.bid,
            status: 'ok',
            updatedAt: Number(mt5.timestamp),
            source: 'mt5',
          });
        } else {
          brapiSymbols.push(s.symbol);
        }
      }

      // Then: fetch remaining from BRAPI (only BOVESPA symbols)
      const bovespaSymbols = brapiSymbols.filter((sym) => {
        const row = list.find((s) => s.symbol === sym);
        return !row || row.exchange === 'BOVESPA' || row.exchange === 'B3';
      });

      const brapiPrices = await fetchBrapiQuotes(bovespaSymbols);

      for (const sym of brapiSymbols) {
        const row = list.find((s) => s.symbol === sym)!;
        const price = brapiPrices.get(sym);
        if (price !== undefined) {
          items.push({
            symbol: sym,
            exchange: row.exchange,
            priceBRL: price,
            status: 'ok',
            updatedAt: Date.now(),
            source: 'brapi',
          });
        } else {
          items.push({
            symbol: sym,
            exchange: row.exchange,
            status: 'no_data',
            message: BRAPI_TOKEN
              ? 'Quote unavailable from BRAPI'
              : 'Set BRAPI_TOKEN env var to enable real-time quotes',
          });
        }
      }

      return json(res, 200, { sectorId, total: items.length, items });
    } catch (err: any) {
      return json(res, 500, { error: String(err?.message ?? err) });
    }
  }

  // -------------------------------------------------------------------------
  // 404 fallback
  // -------------------------------------------------------------------------

  return json(res, 404, { error: 'Not found', path });
}
