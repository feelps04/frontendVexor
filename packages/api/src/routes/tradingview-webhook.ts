/**
 * TradingView Webhook Routes
 *
 * Recebe alertas do TradingView (Pine Script) e repassa para o pipeline interno.
 *
 * Configurar no TradingView → Alert → Webhook URL:
 *   https://api.vexorflow.com/api/v1/tradingview/webhook
 *
 * Payload Pine Script sugerido (JSON message):
 * {
 *   "ticker": "{{ticker}}",
 *   "close":  {{close}},
 *   "open":   {{open}},
 *   "high":   {{high}},
 *   "low":    {{low}},
 *   "volume": {{volume}},
 *   "time":   "{{timenow}}",
 *   "action": "{{strategy.order.action}}"
 * }
 *
 * Segurança: defina VEXOR_TV_WEBHOOK_SECRET (qualquer string) e passe como header
 *   X-Vexor-Secret: <secret>
 * ou como parâmetro de query ?secret=<secret>.
 * Se a variável não estiver definida, o endpoint aceita qualquer request.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import http from 'node:http';
import { mmfCache } from '../infrastructure/mmf-reader.js';

const SENTINEL_URL = (process.env.MARKET_DATA_URL ?? 'http://localhost:8765').replace(/\/$/, '');
const SECRET = (process.env.VEXOR_TV_WEBHOOK_SECRET ?? '').trim();

// ── Types ─────────────────────────────────────────────────────────────────────

interface TvPayload {
  /** TradingView ticker (e.g. "BMFBOVESPA:WDOH26" or plain "WDOH26") */
  ticker?: string;
  symbol?: string;
  close?: number | string;
  open?: number | string;
  high?: number | string;
  low?: number | string;
  volume?: number | string;
  time?: string;
  timenow?: string;
  bid?: number | string;
  ask?: number | string;
  /** Optional strategy action from Pine Script */
  action?: string;
}

interface NormalizedTick {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  time: string;
  source: 'tradingview';
  action?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TV_PREFIXES = new Set([
  'BMFBOVESPA', 'BINANCE', 'BITMEX', 'BYBIT', 'COINBASE',
  'FX', 'FOREXCOM', 'OANDA', 'FXCM', 'TVC', 'SP',
  'NASDAQ', 'NYSE', 'AMEX', 'ARCA', 'TSX',
  'PEPPERSTONE', 'ICMARKETS',
]);

function normalizeSymbol(raw: string): string {
  if (!raw) return raw;
  const s = raw.trim().toUpperCase();
  if (s.includes(':')) {
    const [prefix, sym] = s.split(':', 2);
    if (TV_PREFIXES.has(prefix)) return sym;
  }
  return s;
}

function toNum(v: number | string | undefined, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeTick(body: TvPayload): NormalizedTick | null {
  const rawSym = body.ticker || body.symbol || '';
  const symbol = normalizeSymbol(rawSym);
  if (!symbol) return null;

  const close = toNum(body.close ?? body.ask ?? body.bid);
  const bid   = toNum(body.bid ?? body.close, close);
  const ask   = toNum(body.ask ?? body.close, close);
  const open  = toNum(body.open, close);
  const high  = toNum(body.high, close);
  const low   = toNum(body.low,  close);
  const vol   = toNum(body.volume);

  if (!close && !bid && !ask) return null;

  return {
    symbol,
    bid,
    ask,
    last:   close,
    open,
    high,
    low,
    volume: vol,
    time:   body.time ?? body.timenow ?? new Date().toISOString(),
    source: 'tradingview',
    ...(body.action ? { action: body.action } : {}),
  };
}

/** Forward tick to sentinel_api.py so Python layer also sees it */
function forwardToSentinel(tick: NormalizedTick): void {
  try {
    const payload = JSON.stringify(tick);
    const url = new URL(`${SENTINEL_URL}/tradingview/tick`);
    const req = http.request(
      { hostname: url.hostname, port: url.port || 80, path: url.pathname, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      () => {},
    );
    req.on('error', () => {}); // best-effort
    req.write(payload);
    req.end();
  } catch {
    // sentinel_api.py may be down; non-fatal
  }
}

// ── Validation ────────────────────────────────────────────────────────────────

function isAuthorized(req: FastifyRequest): boolean {
  if (!SECRET) return true;
  const header = (req.headers['x-vexor-secret'] as string | undefined)?.trim();
  const query  = (req.query as Record<string, string>)['secret']?.trim();
  return header === SECRET || query === SECRET;
}

// ── Route registration ────────────────────────────────────────────────────────

export async function tradingviewWebhookRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/v1/tradingview/webhook
   * Receives a single Pine Script alert payload.
   */
  app.post<{ Body: TvPayload }>('/api/v1/tradingview/webhook', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!isAuthorized(req)) {
      return reply.status(401).send({ error: 'Unauthorized — set X-Vexor-Secret header' });
    }

    const body = req.body as TvPayload;
    const tick = normalizeTick(body);

    if (!tick) {
      return reply.status(400).send({
        error: 'Invalid payload — required: ticker or symbol + close/bid/ask',
        received: body,
      });
    }

    // Update mmfCache.tv so the existing mmf-reader pipeline picks it up immediately
    if (!Array.isArray((mmfCache as any).tv)) {
      (mmfCache as any).tv = [];
    }
    const tvCache: NormalizedTick[] = (mmfCache as any).tv;
    const idx = tvCache.findIndex((t) => t.symbol === tick.symbol);
    if (idx >= 0) {
      tvCache[idx] = tick;
    } else {
      tvCache.push(tick);
    }

    // Best-effort forward to sentinel_api.py
    forwardToSentinel(tick);

    return reply.status(200).send({
      ok: true,
      symbol: tick.symbol,
      last: tick.last,
      source: 'tradingview',
      ts: tick.time,
    });
  });

  /**
   * POST /api/v1/tradingview/ticks  (batch)
   * Accepts { ticks: TvPayload[] }
   */
  app.post<{ Body: { ticks: TvPayload[] } }>('/api/v1/tradingview/ticks', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!isAuthorized(req)) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const items: TvPayload[] = (req.body as any)?.ticks ?? [];
    if (!Array.isArray(items) || items.length === 0) {
      return reply.status(400).send({ error: 'body.ticks must be a non-empty array' });
    }

    if (!Array.isArray((mmfCache as any).tv)) (mmfCache as any).tv = [];
    const tvCache: NormalizedTick[] = (mmfCache as any).tv;

    let stored = 0;
    for (const item of items) {
      const tick = normalizeTick(item);
      if (!tick) continue;
      const idx = tvCache.findIndex((t) => t.symbol === tick.symbol);
      if (idx >= 0) tvCache[idx] = tick; else tvCache.push(tick);
      forwardToSentinel(tick);
      stored++;
    }

    return reply.status(200).send({ ok: true, stored, total: items.length });
  });

  /**
   * GET /api/v1/tradingview/status
   * Returns active TradingView symbols and count in memory.
   */
  app.get('/api/v1/tradingview/status', async (_req: FastifyRequest, reply: FastifyReply) => {
    const tvCache: NormalizedTick[] = (mmfCache as any).tv ?? [];
    // Also try to get status from sentinel_api.py
    let sentinelStatus: Record<string, unknown> = {};
    try {
      const resp = await fetch(`${SENTINEL_URL}/tradingview/status`, { signal: AbortSignal.timeout(2000) });
      if (resp.ok) sentinelStatus = await resp.json() as Record<string, unknown>;
    } catch {
      // sentinel_api.py not running — non-fatal
    }

    return reply.send({
      source: 'tradingview',
      fastify_cache: {
        active_symbols: tvCache.length,
        symbols: tvCache.map((t) => t.symbol).sort(),
      },
      sentinel_api: sentinelStatus,
    });
  });
}
