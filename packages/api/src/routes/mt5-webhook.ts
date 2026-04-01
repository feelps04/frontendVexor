/**
 * MT5 WebRequest Routes
 *
 * Recebe ticks do Genial MetaTrader via WebRequest (MQL5) e injeta no mmfCache.b3
 * para que o pipeline interno os veja como se viessem do MMF local.
 *
 * Configurar no EA MQL5:
 *   string API_URL    = "https://www.vexorflow.com/api/v1/mt5/ticks";
 *   string API_SECRET = "<seu_VEXOR_MT5_SECRET>";
 *
 * Segurança: defina VEXOR_MT5_SECRET no .env da API.
 * Se a variável não estiver definida, o endpoint aceita qualquer request.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { mmfCache } from '../infrastructure/mmf-reader.js';

const SECRET = (process.env.VEXOR_MT5_SECRET ?? '').trim();

// Extrai token de "Bearer <token>" ou retorna a string direto
function extractToken(header: string): string {
  const lower = header.toLowerCase();
  if (lower.startsWith('bearer ')) return header.slice(7).trim();
  return header.trim();
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Mt5TickPayload {
  symbol: string;
  bid?: number | string;
  ask?: number | string;
  last?: number | string;
  volume?: number | string;
  time?: string;
  source?: string;
}

interface NormalizedB3Tick {
  symbol: string;
  bid: number;
  ask: number;
  volume: bigint;
  timestamp: bigint;
  anomaly: number;
  heartbeat: number;
  source: 'genial';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toNum(v: number | string | undefined, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeTick(body: Mt5TickPayload): NormalizedB3Tick | null {
  const symbol = String(body.symbol ?? '').trim().toUpperCase();
  if (!symbol) return null;

  const bid = toNum(body.bid);
  const ask = toNum(body.ask, bid);
  if (bid <= 0 && ask <= 0) return null;

  return {
    symbol,
    bid,
    ask,
    volume: BigInt(Math.round(toNum(body.volume))),
    timestamp: BigInt(Date.now()),
    anomaly: 0,
    heartbeat: 1,
    source: 'genial',
  };
}

function isAuthorized(req: FastifyRequest): boolean {
  if (!SECRET) return true;
  // Aceita: Authorization: Bearer <token>  OU  X-Vexor-Secret: <token>
  const authHeader = (req.headers['authorization'] as string | undefined) ?? '';
  const secretHeader = (req.headers['x-vexor-secret'] as string | undefined) ?? '';
  const query = ((req.query as Record<string, string>)['secret'] ?? '').trim();
  const fromBearer = authHeader ? extractToken(authHeader) : '';
  const fromSecret = secretHeader.trim();
  return fromBearer === SECRET || fromSecret === SECRET || query === SECRET;
}

function upsertB3(tick: NormalizedB3Tick): void {
  if (!Array.isArray(mmfCache.b3)) (mmfCache as any).b3 = [];
  const cache = mmfCache.b3 as NormalizedB3Tick[];
  const idx = cache.findIndex((t) => t.symbol === tick.symbol);
  if (idx >= 0) cache[idx] = tick; else cache.push(tick);
}

// ── Route registration ────────────────────────────────────────────────────────

export async function mt5WebhookRoutes(app: FastifyInstance): Promise<void> {

  /**
   * POST /api/v1/mt5/tick
   * Recebe um único tick do EA (útil para testes ou símbolos únicos).
   */
  app.post<{ Body: Mt5TickPayload }>('/api/v1/mt5/tick', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!isAuthorized(req)) {
      return reply.status(401).send({ error: 'Unauthorized — set X-Vexor-Secret header' });
    }

    const tick = normalizeTick(req.body as Mt5TickPayload);
    if (!tick) {
      return reply.status(400).send({ error: 'Invalid payload — required: symbol + bid/ask' });
    }

    upsertB3(tick);

    return reply.status(200).send({ ok: true, symbol: tick.symbol, bid: tick.bid, ask: tick.ask });
  });

  /**
   * POST /api/v1/mt5/ticks
   * Recebe um lote de ticks do EA (todos os ativos do MarketWatch de uma vez).
   * Body: { ticks: Mt5TickPayload[] }
   */
  app.post<{ Body: { ticks: Mt5TickPayload[] } }>('/api/v1/mt5/ticks', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!isAuthorized(req)) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const items: Mt5TickPayload[] = (req.body as any)?.ticks ?? [];
    if (!Array.isArray(items) || items.length === 0) {
      return reply.status(400).send({ error: 'body.ticks must be a non-empty array' });
    }

    // Responde imediatamente e processa em background para reduzir latência no EA.
    reply.status(202).send({ ok: true, accepted: items.length });

    setImmediate(() => {
      try {
        let stored = 0;
        for (const item of items) {
          const tick = normalizeTick(item);
          if (!tick) continue;
          upsertB3(tick);
          stored++;
        }

        app.log.debug({ accepted: items.length, stored }, 'mt5 ticks batch processed');
      } catch (err) {
        app.log.error({ err }, 'mt5 ticks batch background processing failed');
      }
    });
  });

  /**
   * GET /api/v1/mt5/status
   * Retorna quantos símbolos Genial estão em cache e uma amostra.
   */
  app.get('/api/v1/mt5/status', async (_req: FastifyRequest, reply: FastifyReply) => {
    const b3Cache = (mmfCache.b3 as NormalizedB3Tick[]) ?? [];
    return reply.send({
      source: 'genial',
      active_symbols: b3Cache.length,
      symbols: b3Cache.map((t) => t.symbol).sort(),
      sample: b3Cache.slice(0, 10).map((t) => ({
        symbol: t.symbol,
        bid: t.bid,
        ask: t.ask,
        ts: Number(t.timestamp),
      })),
    });
  });
}
