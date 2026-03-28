import type { FastifyInstance } from 'fastify';
import type Redis from 'ioredis';
import type { Pool } from 'pg';

const BALANCE_PREFIX = 'balance:v2:';
const INITIAL_BALANCE = 0;

export interface RealtimeDeps {
  redis: Redis;
  pg: Pool;
}

function parseAccountsParam(v: unknown): string[] {
  if (typeof v !== 'string') return [];
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function getRedisBalances(redis: Redis, accounts: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const accountId of accounts) {
    const key = `${BALANCE_PREFIX}${accountId}`;
    const val = await redis.get(key);
    out[accountId] = val !== null ? parseInt(val, 10) : INITIAL_BALANCE;
  }
  return out;
}

async function getSqlBalances(pg: Pool, accounts: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (accounts.length === 0) return out;

  for (const accountId of accounts) {
    out[accountId] = INITIAL_BALANCE;
  }

  try {
    const placeholders = accounts.map((_, i) => `$${i + 1}`).join(',');
    const res = await pg.query(
      `SELECT account_id,
              COALESCE(SUM(
                CASE
                  WHEN type = 'deposit' THEN amount
                  WHEN type = 'withdraw' THEN -amount
                  ELSE 0
                END
              ), 0)::bigint AS net_operations
       FROM balance_operations
       WHERE account_id IN (${placeholders})
       GROUP BY account_id`,
      accounts
    );
    for (const row of res.rows) {
      out[row.account_id] = INITIAL_BALANCE + parseInt(String(row.net_operations), 10);
    }
  } catch {
    // ignore and keep defaults
  }
  return out;
}

async function getTimeMachineBalance(pg: Pool, accountId: string, atIso: string): Promise<number> {
  const atDate = new Date(atIso);
  if (Number.isNaN(atDate.getTime())) return INITIAL_BALANCE;

  try {
    const res = await pg.query(
      `SELECT COALESCE(SUM(
        CASE
          WHEN type = 'deposit' THEN amount
          WHEN type = 'withdraw' THEN -amount
          ELSE 0
        END
      ), 0)::bigint AS net_operations
       FROM balance_operations
       WHERE account_id = $1 AND created_at <= $2`,
      [accountId, atDate.toISOString()]
    );
    const netOperations = Number(res.rows[0]?.net_operations ?? 0);
    return INITIAL_BALANCE + netOperations;
  } catch {
    return INITIAL_BALANCE;
  }
}

export async function realtimeRoutes(app: FastifyInstance, opts: RealtimeDeps): Promise<void> {
  const { redis, pg } = opts;

  app.get('/ws', { websocket: true }, (connection, req) => {
    const ws = (connection as unknown as { socket?: { send(data: string): void; on(event: string, cb: () => void): void } }).socket ??
      (connection as unknown as { send(data: string): void; on(event: string, cb: () => void): void });
    let closed = false;

    const url = req.url ?? '';
    const u = new URL(url, 'http://localhost');
    const accounts = parseAccountsParam(u.searchParams.get('accounts') ?? '');
    const accountId = u.searchParams.get('accountId') ?? (accounts[0] ?? 'acc-1');

    const sendSnapshot = async (): Promise<void> => {
      try {
        const now = new Date().toISOString();
        const redisBalances = await getRedisBalances(redis, accounts.length ? accounts : [accountId]);
        const sqlBalances = await getSqlBalances(pg, accounts.length ? accounts : [accountId]);

        let match = true;
        const keys = Array.from(new Set([...Object.keys(redisBalances), ...Object.keys(sqlBalances)]));
        for (const k of keys) {
          if (redisBalances[k] !== sqlBalances[k]) {
            match = false;
            break;
          }
        }

        const balanceBrlAt = await getTimeMachineBalance(pg, accountId, now);

        const payload = {
          type: 'snapshot',
          ts: now,
          accountId,
          timeMachine: { accountId, at: now, balanceBrl: balanceBrlAt },
          integrity: { redis: redisBalances, sql: sqlBalances, match },
        };

        if (!closed) ws.send(JSON.stringify(payload));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!closed) ws.send(JSON.stringify({ type: 'error', message: msg }));
      }
    };

    const intervalMs = Math.max(500, Math.min(10_000, Number(u.searchParams.get('intervalMs') ?? 2000)));

    const timer = setInterval(() => {
      void sendSnapshot();
    }, intervalMs);

    void sendSnapshot();

    ws.on('close', () => {
      closed = true;
      clearInterval(timer);
    });
  });
}
