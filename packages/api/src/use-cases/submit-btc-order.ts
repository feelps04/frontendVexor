import { randomUUID } from 'crypto';
import { Transaction } from '@transaction-auth-engine/core';
import type { ApiKafkaProducer } from '../infrastructure/kafka-producer.js';
import type { MercadoBitcoinClient } from '@transaction-auth-engine/shared';

export interface SubmitBtcOrderInput {
  accountId: string;
  /** BTC amount (e.g. 0.001). */
  amountBtc: number;
  idempotencyKey: string;
  merchantId?: string;
  /** Optional pre-fetched BTC price in BRL. */
  priceBRL?: number;
}

/** Fetches BTC price from Mercado Bitcoin, builds order payload, sends to Kafka. */
export async function submitBtcOrder(
  producer: ApiKafkaProducer,
  mercadoBitcoin: MercadoBitcoinClient,
  input: SubmitBtcOrderInput
): Promise<Transaction> {
  const priceBRL = input.priceBRL ?? (await mercadoBitcoin.getBtcBrlTicker()).priceBRL;
  const amountBRL = Math.round(input.amountBtc * priceBRL * 100); // cents
  const transaction = new Transaction(
    randomUUID(),
    input.idempotencyKey,
    input.accountId,
    amountBRL,
    'BRL',
    input.merchantId ?? 'crypto-exchange',
    'PENDING',
    undefined,
    undefined,
    amountBRL,
    priceBRL,
    undefined,
    'crypto_buy',
    input.amountBtc,
    priceBRL
  );

  await producer.sendTransaction(transaction);
  return transaction;
}
