import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ApiKafkaProducer } from '../infrastructure/kafka-producer.js';
import { CurrencyConverter, validateBankCode } from '@transaction-auth-engine/shared';
import { submitTransaction } from '../use-cases/submit-transaction.js';
import type Redis from 'ioredis';

const BALANCE_PREFIX = 'balance:';
const INITIAL_BALANCE = 10_000;

const bodySchema = {
  type: 'object',
  required: ['accountId', 'amount', 'currency', 'merchantId', 'idempotencyKey'],
  properties: {
    accountId: { type: 'string' },
    amount: { type: 'integer', minimum: 1 },
    currency: { type: 'string', enum: ['BRL', 'USD', 'EUR'] },
    merchantId: { type: 'string' },
    idempotencyKey: { type: 'string', format: 'uuid' },
    targetBankCode: { type: 'string', description: 'Bank code for TED/DOC/PIX (e.g. 033)' },
    biometricToken: { type: 'string', description: 'Optional biometric validation token (Face ID / Touch ID simulation)' },
  },
};

const currencyConverter = new CurrencyConverter();

const paramsSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
  },
};

export async function transactionRoutes(
  app: FastifyInstance,
  opts: { producer: ApiKafkaProducer; redis?: Redis }
): Promise<void> {
  const { producer, redis } = opts;

  app.post<{
    Body: { accountId: string; amount: number; currency: string; merchantId: string; idempotencyKey: string };
  }>(
    '/api/v1/transactions',
    {
      schema: {
        body: bodySchema,
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
              targetBankCode: { type: 'string' },
              amountBRL: { type: 'integer' },
              rate: { type: 'number' },
              bankName: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: { accountId: string; amount: number; currency: string; merchantId: string; idempotencyKey: string; targetBankCode?: string; biometricToken?: string } }>, reply: FastifyReply) => {
      const body = request.body;
      let amountBRL: number | undefined;
      let rate: number | undefined;
      let bankName: string | undefined;

      if (body.currency !== 'BRL') {
        const converted = await currencyConverter.convertToBRLWithRate(body.amount, body.currency);
        amountBRL = converted.amountBRL;
        rate = converted.rate;
      }

      if (body.targetBankCode) {
        const bank = await validateBankCode(body.targetBankCode);
        bankName = bank.name;
      }

      const debitBRL = amountBRL ?? body.amount;
      if (redis) {
        const key = `${BALANCE_PREFIX}${body.accountId}`;
        const current = await redis.get(key);
        const balance = current !== null ? parseInt(current, 10) : INITIAL_BALANCE;
        if (balance < debitBRL) {
          return reply.status(409).send({
            message: 'Saldo insuficiente',
            required: debitBRL,
            balance,
          });
        }
      }

      const transaction = await submitTransaction(producer, {
        ...body,
        amountBRL,
        rate,
        bankName,
        biometricToken: body.biometricToken,
      });
      return reply.status(201).send(transaction.toJSON());
    }
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/transactions/:id',
    {
      schema: {
        params: paramsSchema,
        response: {
          200: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              status: { type: 'string', enum: ['PENDING', 'AUTHORIZED', 'DENIED', 'PENDING_SETTLEMENT'] },
            },
          },
          404: { type: 'object', properties: { message: { type: 'string' } } },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      return reply.status(200).send({
        id: request.params.id,
        status: 'PENDING',
        message: 'Status is eventually consistent; poll or use result topics for final state.',
      });
    }
  );
}
