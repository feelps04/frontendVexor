import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

// ── Supabase helpers ──────────────────────────────────────────────────────────
function supaFetch(path: string, init?: RequestInit) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return Promise.resolve(null);
  return fetch(`${url}/rest/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'return=representation',
      ...(init?.headers ?? {}),
    },
  });
}

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
  const raw = Buffer.concat(chunks).toString('utf8').replace(/\0+$/, '');
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

async function persistToSupabase(ticks: Tick[]): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return;

  const rows = ticks.map((t) => ({
    symbol: t.symbol,
    bid: t.bid,
    ask: t.ask,
    last: t.ask > 0 ? t.ask : t.bid,
    volume: Number(t.volume),
    time: Number(t.timestamp / 1000n),
    source: 'mt5',
    updated_at: new Date().toISOString(),
  }));

  await fetch(`${url}/rest/v1/ticks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
  }).catch(() => {});
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

  // ── MT5 original routes ────────────────────────────────────────────────────

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

  if (method === 'POST' && (path === '/api/v1/mt5/tick' || path === '/tick')) {
    if (!isAuthorized(req)) return json(res, 401, { error: 'Unauthorized' });
    try {
      const body = await readJsonBody(req);
      const tick = normalizeTick(body);
      if (!tick) return json(res, 400, { error: 'Invalid payload — required: symbol + bid/ask' });
      ticksCache.set(tick.symbol, tick);
      persistToSupabase([tick]);
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
        const normalized: Tick[] = [];
        for (const item of items) {
          const tick = normalizeTick(item);
          if (!tick) continue;
          ticksCache.set(tick.symbol, tick);
          normalized.push(tick);
        }
        persistToSupabase(normalized);
      });
      return;
    } catch {
      return json(res, 400, { error: 'Invalid JSON body' });
    }
  }

  // EA alias: /ticks/batch  →  same as /api/v1/mt5/ticks
  if (method === 'POST' && path === '/ticks/batch') {
    if (!isAuthorized(req)) return json(res, 401, { error: 'Unauthorized' });
    try {
      const body = await readJsonBody(req);
      const items = body?.ticks;
      if (!Array.isArray(items) || items.length === 0) {
        return json(res, 400, { error: 'body.ticks must be a non-empty array' });
      }
      const normalized: Tick[] = [];
      for (const item of items) {
        const tick = normalizeTick(item);
        if (!tick) continue;
        ticksCache.set(tick.symbol, tick);
        normalized.push(tick);
      }
      persistToSupabase(normalized);
      return json(res, 200, { ok: true, count: normalized.length });
    } catch {
      return json(res, 400, { error: 'Invalid JSON body' });
    }
  }

  // ── Frontend / python-api routes ───────────────────────────────────────────

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

  // ── /api/v1/market routes (used by frontend) ──────────────────────────────

  if (method === 'GET' && path === '/api/v1/market/sectors') {
    const hasData = ticksCache.size > 0;
    return json(res, 200, {
      sectors: [
        {
          sectorId: '1',
          sectorName: 'MT5 Live Feed',
          symbols: ticksCache.size,
          exchanges: ['B3'],
          types: ['equity', 'futures', 'fx'],
          description: 'Dados em tempo real do MetaTrader 5',
          active: hasData,
          source: 'mt5',
          protocol: 'http',
          frequency: '50ms',
          recommendation: hasData ? 'Dados disponíveis' : 'Aguardando feed MT5',
        },
      ],
    });
  }

  if (method === 'GET' && path.startsWith('/api/v1/market/sectors/') && path.endsWith('/quotes')) {
    const sectorId = path.split('/')[5] ?? '1';
    const items = Array.from(ticksCache.values()).map((t) => ({
      symbol: t.symbol,
      exchange: 'B3',
      priceBRL: t.ask > 0 ? t.ask : t.bid,
      bid: t.bid,
      ask: t.ask,
      spread: t.ask > 0 && t.bid > 0 ? +(t.ask - t.bid).toFixed(5) : null,
      updatedAt: Number(t.timestamp),
      source: 'mt5',
      status: 'ok' as const,
    }));
    return json(res, 200, { sectorId, total: items.length, items });
  }

  if (method === 'GET' && path === '/api/v1/market/symbols/check') {
    const raw = url.searchParams.get('symbols') ?? '';
    const requested = raw
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    if (requested.length === 0) {
      return json(res, 200, { items: [] });
    }

    const items = requested.map((sym) => {
      const t = ticksCache.get(sym);
      if (!t) return { requested: sym, symbol: sym, status: 'no_data' as const, message: 'Symbol not in cache' };
      return {
        requested: sym,
        symbol: sym,
        status: 'ok' as const,
        priceBRL: t.ask > 0 ? t.ask : t.bid,
      };
    });

    return json(res, 200, { items });
  }

  // ── /api/v1/orders routes ──────────────────────────────────────────────────

  // POST /api/v1/orders — frontend creates order (real mode)
  if (method === 'POST' && path === '/api/v1/orders') {
    try {
      const body = await readJsonBody(req);
      const symbol  = String(body?.symbol ?? '').toUpperCase();
      const type    = String(body?.type ?? '').toUpperCase();
      const volume  = toNum(body?.volume, 0);
      const price   = toNum(body?.price, 0);

      if (!symbol || !['BUY', 'SELL'].includes(type) || volume <= 0) {
        return json(res, 400, { error: 'Required: symbol, type (BUY|SELL), volume > 0' });
      }

      const order = {
        id: randomUUID(),
        user_id: String(body?.userId ?? ''),
        symbol,
        type,
        volume,
        price,
        status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const r = await supaFetch('/orders', {
        method: 'POST',
        body: JSON.stringify(order),
      });

      if (!r || !r.ok) {
        const err = await r?.text();
        return json(res, 500, { error: 'Failed to save order', detail: err });
      }

      return json(res, 201, { ok: true, orderId: order.id, status: 'pending' });
    } catch {
      return json(res, 400, { error: 'Invalid JSON body' });
    }
  }

  // GET /api/v1/orders/pending — MT5 EA polls for orders to execute
  if (method === 'GET' && path === '/api/v1/orders/pending') {
    if (!isAuthorized(req)) return json(res, 401, { error: 'Unauthorized' });

    const r = await supaFetch(
      "/orders?status=eq.pending&order=created_at.asc&limit=10&select=id,symbol,type,volume,price"
    );
    if (!r || !r.ok) return json(res, 200, { orders: [] });

    const orders = await r.json();

    // Mark as sent so they aren't returned twice
    if (Array.isArray(orders) && orders.length > 0) {
      const ids = orders.map((o: any) => o.id);
      await supaFetch(`/orders?id=in.(${ids.join(',')})`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'sent', updated_at: new Date().toISOString() }),
        headers: { Prefer: 'return=minimal' },
      });
    }

    return json(res, 200, { orders: Array.isArray(orders) ? orders : [] });
  }

  // PATCH /api/v1/orders/:id — MT5 EA reports execution result
  if (method === 'PATCH' && path.startsWith('/api/v1/orders/') && !path.endsWith('/status')) {
    if (!isAuthorized(req)) return json(res, 401, { error: 'Unauthorized' });
    try {
      const id   = path.split('/')[4];
      const body = await readJsonBody(req);
      const update: Record<string, any> = { updated_at: new Date().toISOString() };

      if (body.status)      update.status       = body.status;
      if (body.ticket)      update.ticket       = Number(body.ticket);
      if (body.filledPrice) update.filled_price = toNum(body.filledPrice);
      if (body.error)       update.error        = String(body.error);

      const r = await supaFetch(`/orders?id=eq.${id}`, {
        method: 'PATCH',
        body: JSON.stringify(update),
        headers: { Prefer: 'return=minimal' },
      });

      return json(res, r?.ok ? 200 : 500, { ok: r?.ok ?? false });
    } catch {
      return json(res, 400, { error: 'Invalid body' });
    }
  }

  // GET /api/v1/orders/:id/status — frontend polls for result
  if (method === 'GET' && path.match(/^\/api\/v1\/orders\/[^/]+\/status$/)) {
    const id = path.split('/')[4];
    const r  = await supaFetch(`/orders?id=eq.${id}&select=id,status,ticket,filled_price,error`);
    if (!r || !r.ok) return json(res, 404, { error: 'Order not found' });
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) return json(res, 404, { error: 'Order not found' });
    return json(res, 200, rows[0]);
  }

  // GET /api/v1/orders — frontend lists own orders (by userId query param)
  if (method === 'GET' && path === '/api/v1/orders') {
    const userId = url.searchParams.get('userId') ?? '';
    if (!userId) return json(res, 200, { orders: [] });
    const r = await supaFetch(
      `/orders?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=50`
    );
    if (!r || !r.ok) return json(res, 200, { orders: [] });
    const orders = await r.json();
    return json(res, 200, { orders: Array.isArray(orders) ? orders : [] });
  }

  return json(res, 404, { error: 'Not found', path });
}
