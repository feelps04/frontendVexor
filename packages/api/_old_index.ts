import type { IncomingMessage, ServerResponse } from 'node:http';

type Tick = {
  symbol: string;
  bid: number;
  ask: number;
  volume: bigint;
  timestamp: bigint;
  source: 'genial';
};

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

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type,authorization,x-vexor-secret');
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
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

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const method = String(req.method ?? 'GET').toUpperCase();
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  if (method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type,authorization,x-vexor-secret');
    res.end();
    return;
  }

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
          if (!tick) continue;
          ticksCache.set(tick.symbol, tick);
        }
      });
      return;
    } catch {
      return json(res, 400, { error: 'Invalid JSON body' });
    }
  }

  // Compatibility layer for legacy /python-api endpoints used by frontend.
  if (method === 'GET' && path === '/python-api/sectors') {
    return json(res, 200, {
      sectors: [
        {
          sector_id: 'mt5_live',
          sector_name: 'MT5 Live Feed',
          count: ticksCache.size,
          exchanges: ['B3'],
        },
      ],
    });
  }

  if (method === 'GET' && path === '/python-api/symbols') {
    return json(res, 200, {
      symbols: Array.from(ticksCache.keys()).sort().map((symbol) => ({ symbol })),
    });
  }

  if (method === 'GET' && path.startsWith('/python-api/sectors/') && path.endsWith('/symbols')) {
    const symbols = Array.from(ticksCache.values()).map((t) => ({
      symbol: t.symbol,
      exchange: 'B3',
      description: t.symbol,
      type: 'equity',
      full_symbol: `B3\\${t.symbol}`,
    }));
    return json(res, 200, {
      sector_id: path.split('/')[3] ?? 'mt5_live',
      sector_name: 'MT5 Live Feed',
      symbols,
    });
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
        data: close > 0 ? [{ time: now, open: close, high: close, low: close, close, volume: Number(t?.volume ?? 0n) }] : [],
      });
    } catch {
      return json(res, 400, { error: 'Invalid JSON body' });
    }
  }

  return json(res, 404, { error: 'Not found', path });
}
