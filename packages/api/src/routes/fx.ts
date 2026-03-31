import type { FastifyInstance } from 'fastify';
import { type Mt5Interval } from '@transaction-auth-engine/shared';
import { Kafka, logLevel } from 'kafkajs';
import dns from 'node:dns';
import type Redis from 'ioredis';

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',');
const TOPIC_FX = 'fx.ticker';

type FxTick = { ts: number; rate: number };

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

type Currency = 'USD' | 'EUR';

type Range = '1h' | '6h' | '1d' | '5d' | '7d' | '1mo' | '3mo' | '6mo' | '1y' | '2y' | '5y';

async function resolveIpv4Host(hostname: string, timeoutMs = 1000): Promise<string> {
  const host = String(hostname || '').trim();
  if (!host) return host;

  const lookupPromise = new Promise<string>((resolve, reject) => {
    dns.lookup(host, { family: 4 }, (err, address) => {
      if (err || !address) return reject(err ?? new Error('dns lookup failed'));
      resolve(address);
    });
  });

  const timeoutPromise = new Promise<string>((resolve) => {
    setTimeout(() => resolve(host), timeoutMs);
  });

  try {
    return await Promise.race([lookupPromise, timeoutPromise]);
  } catch {
    return host;
  }
}

async function httpGetJson(url: string): Promise<{ status: number; json: unknown; text: string }> {
  const res = await fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(20_000),
  });

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

function isMt5Interval(v: string): v is Mt5Interval {
  return ['1m', '2m', '5m', '15m', '30m', '60m', '1h', '1d'].includes(v);
}

function isCurrency(v: string): v is Currency {
  return v === 'USD' || v === 'EUR';
}

function rangeDays(range: string): number {
  if (range === '5d') return 5;
  if (range === '7d') return 7;
  if (range === '1mo') return 30;
  if (range === '3mo') return 90;
  if (range === '6mo') return 180;
  if (range === '1y') return 365;
  if (range === '2y') return 730;
  if (range === '5y') return 1825;
  return 7;
}

type AwesomeDailyItem = {
  timestamp?: string;
  high?: string;
  low?: string;
  bid?: string;
};

type CachedRate = { rate: number; ts: number };

function buildDailyCandles(items: AwesomeDailyItem[]): Candle[] {
  // AwesomeAPI returns most recent first
  const sorted = items
    .map((it) => {
      const ts = parseInt(String(it.timestamp ?? ''), 10);
      const close = parseFloat(String(it.bid ?? ''));
      const highRaw = parseFloat(String(it.high ?? ''));
      const lowRaw = parseFloat(String(it.low ?? ''));
      const high = Number.isFinite(highRaw) ? highRaw : close;
      const low = Number.isFinite(lowRaw) ? lowRaw : close;
      return { ts, high, low, close };
    })
    .filter((x) => Number.isFinite(x.ts) && Number.isFinite(x.close))
    .sort((a, b) => a.ts - b.ts);

  const out: Candle[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    const prevClose = i > 0 ? sorted[i - 1].close : cur.close;
    const dayStartSec = Math.floor(cur.ts / 86400) * 86400;
    out.push({ time: dayStartSec, open: prevClose, high: cur.high, low: cur.low, close: cur.close });
  }
  return out;
}

export async function fxRoutes(app: FastifyInstance, opts?: { redis?: Redis }): Promise<void> {
  const marketDataUrl = String(process.env.MARKET_DATA_URL ?? '').trim();

  const redis = opts?.redis;
  const FX_LAST_RATE_KEY_PREFIX = 'market:fx:lastRate:v1:';

  const subsByCurrency = new Map<Currency, Set<{ send(data: string): void; on(event: string, cb: () => void): void }>>();
  const timers = new Map<Currency, NodeJS.Timeout>();
  const ticksByCurrency = new Map<Currency, FxTick[]>();
  const MAX_TICKS = 120_000;

  // Kafka consumer for real-time ticks
  const kafka = new Kafka({
    clientId: 'api-fx-bridge',
    brokers: KAFKA_BROKERS,
    retry: { retries: 0 },
    logLevel: logLevel.NOTHING,
  });
  const consumer = kafka.consumer({ groupId: 'api-fx-bridge' });

  let stopping = false;
  let started = false;

  const startConsumer = async (): Promise<void> => {
    if (started || stopping) return;
    started = true;

    try {
      await consumer.connect();
      await consumer.subscribe({ topic: TOPIC_FX, fromBeginning: false });

      void consumer.run({
        eachMessage: async ({ message }) => {
            const value = message.value?.toString();
            if (!value) return;
            let tick: { type?: string; pair?: string; currency?: string; rate?: number; ts?: number; open?: number; high?: number; low?: number; close?: number };
            try {
              tick = JSON.parse(value);
            } catch {
              return;
            }
            if (tick.type !== 'tick') return;
            const currency = String(tick.currency ?? '').toUpperCase();
            if (!currency || (currency !== 'USD' && currency !== 'EUR')) return;
            const rate = Number(tick.rate);
            if (!Number.isFinite(rate) || rate <= 0) return;

            // Atualiza ticks em memória
            const ts = Number(tick.ts) || Math.floor(Date.now() / 1000);
            const ticks = ticksByCurrency.get(currency as Currency) ?? [];
            ticks.push({ ts: ts * 1000, rate });
            if (ticks.length > MAX_TICKS) {
              ticks.splice(0, ticks.length - MAX_TICKS);
            }
            ticksByCurrency.set(currency as Currency, ticks);

            if (redis) {
              try {
                await redis.set(
                  `${FX_LAST_RATE_KEY_PREFIX}${currency}`,
                  JSON.stringify({ rate, ts: ts * 1000 })
                );
              } catch {
                // ignore
              }
            }

            // Broadcast via WebSocket
            const payload = JSON.stringify({
              type: 'tick',
              pair: `${currency}BRL`,
              currency,
              rate,
              ts: ts * 1000,
              open: tick.open ?? rate,
              high: tick.high ?? rate,
              low: tick.low ?? rate,
              close: tick.close ?? rate,
            });
            const subs = subsByCurrency.get(currency as Currency);
            if (!subs || subs.size === 0) return;
            for (const ws of subs) {
              try {
                ws.send(payload);
              } catch {
                // ignore
              }
            }
        },
      });
    } catch {
      try {
        await consumer.disconnect();
      } catch {
        // ignore
      }
    }
  };

  void startConsumer();

  const ensurePolling = (_currency: Currency): void => {
    return;
  };

  app.get('/api/v1/fx/history', async (req, reply) => {
    const q = (req.query ?? {}) as { currency?: string; range?: string; interval?: string };
    const currencyRaw = String(q.currency ?? 'USD').toUpperCase();
    const currency = isCurrency(currencyRaw) ? currencyRaw : 'USD';
    const range = (q.range ?? '7d') as Range;
    const intervalParam = String(q.interval ?? '1d');
    const interval = isMt5Interval(intervalParam) ? intervalParam : '1d';

    return reply.status(503).send({
      message: 'fx history unavailable: no local FX candles. Provide fx.ticker feed (FIX/producer) or enable MARKET_DATA_URL bridge',
    });
  });

  app.get('/api/v1/fx/quote', async (req, reply) => {
    const q = (req.query ?? {}) as { currency?: string };
    const currencyRaw = String(q.currency ?? 'USD').toUpperCase();
    const currency = isCurrency(currencyRaw) ? currencyRaw : 'USD';

    // 1) Prefer Kafka real-time ticks (MetaTrader -> fx-price-producer -> fx.ticker)
    const memTicks = ticksByCurrency.get(currency);
    const lastMem = memTicks && memTicks.length > 0 ? memTicks[memTicks.length - 1] : null;
    if (lastMem && Number.isFinite(lastMem.rate) && lastMem.rate > 0) {
      return reply.send({
        currency,
        pair: `${currency}BRL`,
        rateBRL: lastMem.rate,
      });
    }

    // 2) Use last persisted rate (keeps value when feed is paused)
    if (redis) {
      try {
        const raw = await redis.get(`${FX_LAST_RATE_KEY_PREFIX}${currency}`);
        if (raw) {
          const parsed = JSON.parse(raw) as { rate?: unknown; ts?: unknown };
          const rate = Number(parsed?.rate);
          if (Number.isFinite(rate) && rate > 0) {
            return reply.send({
              currency,
              pair: `${currency}BRL`,
              rateBRL: rate,
              stale: true,
            });
          }
        }
      } catch {
        // ignore
      }
    }

    return reply.status(503).send({
      message: 'fx quote unavailable: no local FX feed (fx.ticker empty) and no cached Redis rate',
    });
  });

  // Alias route for frontend compatibility
  app.get('/api/v1/market/fx', async (req, reply) => {
    // Return mock FX rates for dashboard
    return reply.send({
      USDBRL: 5.72,
      EURBRL: 6.18,
      BTCBRL: 578420.50,
      timestamp: Date.now(),
    });
  });

  app.get('/ws/fx', { websocket: true }, (connection, req) => {
    const ws = (connection as unknown as { socket?: { send(data: string): void; on(event: string, cb: () => void): void } }).socket ??
      (connection as unknown as { send(data: string): void; on(event: string, cb: () => void): void });

    const url = req.url ?? '';
    const u = new URL(url, 'http://localhost');
    const currencyRaw = String(u.searchParams.get('currency') ?? 'USD').toUpperCase();
    const currency = isCurrency(currencyRaw) ? currencyRaw : 'USD';

    const set = subsByCurrency.get(currency) ?? new Set();
    set.add(ws);
    subsByCurrency.set(currency, set);

    ws.on('close', () => {
      const s = subsByCurrency.get(currency);
      if (s) s.delete(ws);
    });
  });

  app.addHook('onClose', async () => {
    stopping = true;
    for (const t of timers.values()) {
      clearInterval(t);
    }
    timers.clear();
    subsByCurrency.clear();
    ticksByCurrency.clear();
    try {
      await consumer.disconnect();
    } catch {
      // ignore
    }
  });
}
