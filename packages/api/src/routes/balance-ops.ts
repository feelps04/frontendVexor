import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Redis from 'ioredis';
import { Pool } from 'pg';

const BALANCE_PREFIX = 'balance:v2:';
const INITIAL_BALANCE = 0;

export interface BalanceOpsDeps {
  redis?: Redis;
  pg?: Pool;
}

export async function balanceOpsRoutes(
  app: FastifyInstance,
  opts: BalanceOpsDeps
): Promise<void> {
  const { redis, pg } = opts;

  // Get current balance helper
  async function getBalance(accountId: string): Promise<number> {
    if (!redis) return INITIAL_BALANCE;
    const key = `${BALANCE_PREFIX}${accountId}`;
    const val = await redis.get(key);
    return val !== null ? parseInt(val, 10) : INITIAL_BALANCE;
  }

  // Update balance helper (adds amount, can be negative for withdrawal)
  async function updateBalance(accountId: string, amount: number): Promise<number> {
    if (!redis) {
      throw new Error('Redis not available');
    }
    const key = `${BALANCE_PREFIX}${accountId}`;
    const current = await getBalance(accountId);
    const newBalance = current + amount;
    await redis.set(key, newBalance.toString());
    return newBalance;
  }

  // Record operation in database for audit
  async function recordOperation(
    accountId: string,
    type: 'deposit' | 'withdraw',
    amount: number,
    newBalance: number
  ): Promise<void> {
    if (!pg) return;
    try {
      await pg.query(
        `INSERT INTO balance_operations (account_id, type, amount, balance_after, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [accountId, type, amount, newBalance]
      );
    } catch {
      // Table might not exist, ignore
    }
  }

  // POST /api/v1/accounts/:id/deposit - Add money
  app.post<{
    Params: { id: string };
    Body: { amount: number };
  }>(
    '/api/v1/accounts/:id/deposit',
    {
      schema: {
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        body: {
          type: 'object',
          properties: { amount: { type: 'number', minimum: 1 } },
          required: ['amount'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              accountId: { type: 'string' },
              operation: { type: 'string' },
              amount: { type: 'number' },
              previousBalance: { type: 'number' },
              newBalance: { type: 'number' },
            },
          },
          400: { type: 'object', properties: { message: { type: 'string' } } },
          500: { type: 'object', properties: { message: { type: 'string' } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string }; Body: { amount: number } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const rawAmount = request.body.amount;
      // Ensure amount is a proper integer to prevent string concatenation
      const amount = parseInt(String(rawAmount), 10);

      // Debug logging
      console.log('DEPOSIT DEBUG:', { id, amount, rawAmount, amountType: typeof rawAmount });

      if (!Number.isFinite(amount) || amount <= 0) {
        return reply.status(400).send({ message: 'Amount must be positive' });
      }

      if (!redis) {
        return reply.status(500).send({ message: 'Balance service unavailable' });
      }

      const previousBalance = await getBalance(id);
      console.log('DEPOSIT DEBUG:', { previousBalance, amount });
      const newBalance = await updateBalance(id, amount);
      console.log('DEPOSIT DEBUG:', { newBalance });
      await recordOperation(id, 'deposit', amount, newBalance);

      return reply.status(200).send({
        accountId: id,
        operation: 'deposit',
        amount,
        previousBalance,
        newBalance,
      });
    }
  );

  // POST /api/v1/accounts/:id/withdraw - Remove money
  app.post<{
    Params: { id: string };
    Body: { amount: number };
  }>(
    '/api/v1/accounts/:id/withdraw',
    {
      schema: {
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        body: {
          type: 'object',
          properties: { amount: { type: 'number', minimum: 1 } },
          required: ['amount'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              accountId: { type: 'string' },
              operation: { type: 'string' },
              amount: { type: 'number' },
              previousBalance: { type: 'number' },
              newBalance: { type: 'number' },
            },
          },
          400: { type: 'object', properties: { message: { type: 'string' } } },
          409: { type: 'object', properties: { message: { type: 'string' }, balance: { type: 'number' }, requested: { type: 'number' } } },
          500: { type: 'object', properties: { message: { type: 'string' } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string }; Body: { amount: number } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const { amount } = request.body;

      if (!Number.isFinite(amount) || amount <= 0) {
        return reply.status(400).send({ message: 'Amount must be positive' });
      }

      if (!redis) {
        return reply.status(500).send({ message: 'Balance service unavailable' });
      }

      const previousBalance = await getBalance(id);
      if (previousBalance < amount) {
        return reply.status(409).send({
          message: 'Insufficient balance',
          balance: previousBalance,
          requested: amount,
        });
      }

      const newBalance = await updateBalance(id, -amount);
      await recordOperation(id, 'withdraw', amount, newBalance);

      return reply.status(200).send({
        accountId: id,
        operation: 'withdraw',
        amount,
        previousBalance,
        newBalance,
      });
    }
  );

  // GET /api/v1/accounts/:id/balance - Get current balance
  app.get<{
    Params: { id: string };
  }>(
    '/api/v1/accounts/:id/balance',
    {
      schema: {
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              accountId: { type: 'string' },
              balance: { type: 'number' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;
      const balance = await getBalance(id);
      return reply.status(200).send({
        accountId: id,
        balance,
      });
    }
  );

  // GET /api/v1/account/balance - Alias for frontend compatibility (uses default account)
  app.get('/api/v1/account/balance', async (_request, reply) => {
    const balance = await getBalance('default');
    return reply.status(200).send({
      accountId: 'default',
      balance,
    });
  });
}
