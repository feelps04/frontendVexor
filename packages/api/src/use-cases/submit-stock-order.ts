import { randomUUID } from 'crypto';
import { Transaction } from '@transaction-auth-engine/core';
import type { ApiKafkaProducer } from '../infrastructure/kafka-producer.js';
import type { BrapiClient } from '@transaction-auth-engine/shared';

export interface SubmitStockOrderInput {
  accountId: string;
  symbol: string;
  quantity: number;
  idempotencyKey: string;
  merchantId?: string;
  /** Optional pre-fetched stock price in BRL. */
  priceBRL?: number;
  /** Optional resolved symbol from quote provider. */
  quoteSymbol?: string;
}

/** Fetches stock price from Brapi, builds order payload, sends to Kafka. */
export async function submitStockOrder(
  producer: ApiKafkaProducer,
  brapi: BrapiClient,
  input: SubmitStockOrderInput
): Promise<Transaction> {
  const quote = input.priceBRL == null ? await brapi.getQuote(input.symbol) : undefined;
  const priceBRL = input.priceBRL ?? quote!.priceBRL;
  const symbol = input.quoteSymbol ?? quote?.symbol ?? input.symbol;
  const amountBRL = Math.round(input.quantity * priceBRL * 100); // cents
  const transaction = new Transaction(
    randomUUID(),
    input.idempotencyKey,
    input.accountId,
    amountBRL,
    'BRL',
    input.merchantId ?? 'stock-exchange',
    'PENDING',
    undefined,
    undefined,
    amountBRL,
    priceBRL,
    undefined,
    'stock_buy',
    undefined,
    undefined,
    symbol,
    input.quantity,
    priceBRL
  );

  await producer.sendTransaction(transaction);
  return transaction;
}
