import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Pool } from 'pg';

const INITIAL_BALANCE = 0;

export interface BalanceAtDeps {
  pg: Pool;
}

export async function balanceAtRoutes(
  app: FastifyInstance,
  opts: BalanceAtDeps
): Promise<void> {
  const { pg } = opts;

  app.get<{ Params: { accountId: string }; Querystring: { at?: string } }>(
    '/api/v1/accounts/:accountId/balance-at',
    {
      schema: {
        params: { type: 'object', properties: { accountId: { type: 'string' } }, required: ['accountId'] },
        querystring: { type: 'object', properties: { at: { type: 'string', format: 'date-time' } } },
        response: {
          200: {
            type: 'object',
            properties: {
              accountId: { type: 'string' },
              at: { type: 'string' },
              balanceBrl: { type: 'integer' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { accountId: string }; Querystring: { at?: string } }>, reply: FastifyReply) => {
      const { accountId } = request.params;
      const at = request.query.at ?? new Date().toISOString();
      const atDate = new Date(at);
      if (Number.isNaN(atDate.getTime())) {
        return reply.status(400).send({ error: 'Invalid at date' });
      }

      // Calculate balance from initial balance + deposits - withdrawals - transaction debits
      let netOperations = 0;
      try {
        const depositsRes = await pg.query(
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
        netOperations = Number(depositsRes.rows[0]?.net_operations ?? 0);
      } catch {
        netOperations = 0;
      }

      const balanceBrl = INITIAL_BALANCE + netOperations;

      return reply.status(200).send({
        accountId,
        at: atDate.toISOString(),
        balanceBrl,
      });
    }
  );

  app.get<{ Params: { accountId: string } }>(
    '/api/v1/accounts/:accountId/balance-series',
    {
      schema: {
        params: { type: 'object', properties: { accountId: { type: 'string' } }, required: ['accountId'] },
        response: {
          200: {
            type: 'object',
            properties: {
              accountId: { type: 'string' },
              points: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    time: { type: 'integer' },
                    balanceBrl: { type: 'integer' },
                  },
                  required: ['time', 'balanceBrl'],
                },
              },
            },
            required: ['accountId', 'points'],
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { accountId: string } }>, reply: FastifyReply) => {
      const { accountId } = request.params;
      let balance = INITIAL_BALANCE;
      let rows: Array<{ created_at: string; type: string; amount: string | number }> = [];
      try {
        const res = await pg.query(
          `SELECT created_at, type, amount
           FROM balance_operations
           WHERE account_id = $1
           ORDER BY created_at ASC`,
          [accountId]
        );
        rows = res.rows as typeof rows;
      } catch {
        rows = [];
      }

      const points: Array<{ time: number; balanceBrl: number }> = [];
      for (const r of rows) {
        const amount = Number(r.amount);
        if (!Number.isFinite(amount)) continue;
        if (r.type === 'deposit') balance += amount;
        else if (r.type === 'withdraw') balance -= amount;
        const t = new Date(r.created_at).getTime();
        if (Number.isNaN(t)) continue;
        points.push({ time: Math.floor(t / 1000), balanceBrl: balance });
      }

      return reply.status(200).send({ accountId, points });
    }
  );
}
