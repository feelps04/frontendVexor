import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ApiKafkaProducer } from '../infrastructure/kafka-producer.js';
import { MercadoBitcoinClient, BrapiClient } from '@transaction-auth-engine/shared';
import { submitBtcOrder } from '../use-cases/submit-btc-order.js';
import { submitStockOrder } from '../use-cases/submit-stock-order.js';
import type Redis from 'ioredis';

const BALANCE_PREFIX = 'balance:';
const INITIAL_BALANCE = 10_000;

const STRESS_KEY = 'market:stress:v1';
const TEAM_OF_ACCOUNT_PREFIX = 'team:account:v1:';
const TEAM_SCORE_ZSET = 'team:ranking:v1';

type Stress = {
  level?: 'calm' | 'warm' | 'hot' | 'panic' | string;
  score?: number;
  ticksPerSecond?: number;
  baseline?: number;
  change?: number | null;
};

async function applyEmotionalScore(redis: Redis, accountId: string): Promise<{ teamId: string; delta: number; level: string } | null> {
  const teamId = await redis.get(`${TEAM_OF_ACCOUNT_PREFIX}${accountId}`);
  if (!teamId) return null;

  let stress: Stress | null = null;
  try {
    const raw = await redis.get(STRESS_KEY);
    stress = raw ? (JSON.parse(raw) as Stress) : null;
  } catch {
    stress = null;
  }

  const level = String(stress?.level ?? 'unknown').toLowerCase();
  // Rule: placing orders during hot/panic costs points.
  const delta = level === 'panic' ? -8 : level === 'hot' ? -4 : level === 'warm' ? 1 : level === 'calm' ? 2 : 0;

  if (delta !== 0) {
    await redis.zincrby(TEAM_SCORE_ZSET, delta, teamId);
  }
  return { teamId, delta, level };
}

const btcOrderBodySchema = {
  type: 'object',
  required: ['accountId', 'amountBtc', 'idempotencyKey'],
  properties: {
    accountId: { type: 'string' },
    amountBtc: { type: 'number', minimum: 0.00000001, description: 'BTC amount (e.g. 0.001)' },
    idempotencyKey: { type: 'string', format: 'uuid' },
    merchantId: { type: 'string' },
  },
};

const stockOrderBodySchema = {
  type: 'object',
  required: ['accountId', 'symbol', 'quantity', 'idempotencyKey'],
  properties: {
    accountId: { type: 'string' },
    symbol: { type: 'string', description: 'Stock symbol (e.g. PETR4, VALE3)' },
    quantity: { type: 'integer', minimum: 1 },
    idempotencyKey: { type: 'string', format: 'uuid' },
    merchantId: { type: 'string' },
  },
};

export async function orderRoutes(
  app: FastifyInstance,
  opts: { producer: ApiKafkaProducer; redis?: Redis; mercadoBitcoin: MercadoBitcoinClient; brapi: BrapiClient }
): Promise<void> {
  const { producer, redis, mercadoBitcoin, brapi } = opts;

  app.post<{
    Body: { accountId: string; amountBtc: number; idempotencyKey: string; merchantId?: string };
  }>(
    '/api/v1/orders/btc',
    {
      schema: {
        body: btcOrderBodySchema,
        response: {
          201: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              idempotencyKey: { type: 'string' },
              accountId: { type: 'string' },
              amount: { type: 'integer' },
              currency: { type: 'string' },
              merchantId: { type: 'string' },
              status: { type: 'string', enum: ['PENDING'] },
              orderType: { type: 'string', enum: ['crypto_buy'] },
              amountBRL: { type: 'integer' },
              amountBtc: { type: 'number' },
              btcRate: { type: 'number' },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Body: { accountId: string; amountBtc: number; idempotencyKey: string; merchantId?: string };
      }>,
      reply: FastifyReply
    ) => {
      const body = request.body;

      if (redis) {
        try {
          const scored = await applyEmotionalScore(redis, body.accountId);
          if (scored && scored.delta !== 0) {
            (request as any).log?.info?.({ teamId: scored.teamId, delta: scored.delta, level: scored.level }, 'Team emotional score updated (btc order)');
          }
        } catch {
          // ignore scoring failures
        }
      }

      const { priceBRL } = await mercadoBitcoin.getBtcBrlTicker();
      const required = Math.round(body.amountBtc * priceBRL * 100);
      if (redis) {
        const key = `${BALANCE_PREFIX}${body.accountId}`;
        const current = await redis.get(key);
        const balance = current !== null ? parseInt(current, 10) : INITIAL_BALANCE;
        if (balance < required) {
          return reply.status(409).send({
            message: 'Saldo insuficiente',
            required,
            balance,
          });
        }
      }

      const transaction = await submitBtcOrder(producer, mercadoBitcoin, {
        accountId: body.accountId,
        amountBtc: body.amountBtc,
        idempotencyKey: body.idempotencyKey,
        merchantId: body.merchantId,
        priceBRL,
      });

      return reply.status(201).send(transaction.toJSON());
    }
  );

  app.post<{
    Body: { accountId: string; symbol: string; quantity: number; idempotencyKey: string; merchantId?: string };
  }>(
    '/api/v1/orders/stock',
    {
      schema: {
        body: stockOrderBodySchema,
        response: {
          201: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              idempotencyKey: { type: 'string' },
              accountId: { type: 'string' },
              amount: { type: 'integer' },
              currency: { type: 'string' },
              merchantId: { type: 'string' },
              status: { type: 'string', enum: ['PENDING'] },
              orderType: { type: 'string', enum: ['stock_buy'] },
              amountBRL: { type: 'integer' },
              symbol: { type: 'string' },
              quantity: { type: 'integer' },
              stockPrice: { type: 'number' },
            },
          },
          503: { type: 'object', properties: { message: { type: 'string' } } },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Body: { accountId: string; symbol: string; quantity: number; idempotencyKey: string; merchantId?: string };
      }>,
      reply: FastifyReply
    ) => {
      const body = request.body;
      try {
        if (redis) {
          try {
            const scored = await applyEmotionalScore(redis, body.accountId);
            if (scored && scored.delta !== 0) {
              (request as any).log?.info?.({ teamId: scored.teamId, delta: scored.delta, level: scored.level }, 'Team emotional score updated (stock order)');
            }
          } catch {
            // ignore scoring failures
          }
        }

        const quote = await brapi.getQuote(body.symbol);
        const required = Math.round(body.quantity * quote.priceBRL * 100);
        if (redis) {
          const key = `${BALANCE_PREFIX}${body.accountId}`;
          const current = await redis.get(key);
          const balance = current !== null ? parseInt(current, 10) : INITIAL_BALANCE;
          if (balance < required) {
            return reply.status(409).send({
              message: 'Saldo insuficiente',
              required,
              balance,
            });
          }
        }

        const transaction = await submitStockOrder(producer, brapi, {
          accountId: body.accountId,
          symbol: body.symbol,
          quantity: body.quantity,
          idempotencyKey: body.idempotencyKey,
          merchantId: body.merchantId,
          priceBRL: quote.priceBRL,
          quoteSymbol: quote.symbol,
        });

        return reply.status(201).send(transaction.toJSON());
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('token') || msg.includes('Brapi')) {
          return reply.status(503).send({ message: msg });
        }
        throw err;
      }
    }
  );
}
