import { randomUUID } from 'crypto';
import { Transaction } from '@transaction-auth-engine/core';
import type { ApiKafkaProducer } from '../infrastructure/kafka-producer.js';

export interface SubmitTransactionInput {
  accountId: string;
  amount: number;
  currency: string;
  merchantId: string;
  idempotencyKey: string;
  targetBankCode?: string;
  amountBRL?: number;
  rate?: number;
  bankName?: string;
  biometricToken?: string;
}

export async function submitTransaction(
  producer: ApiKafkaProducer,
  input: SubmitTransactionInput
): Promise<Transaction> {
  const transaction = new Transaction(
    randomUUID(),
    input.idempotencyKey,
    input.accountId,
    input.amount,
    input.currency,
    input.merchantId,
    'PENDING',
    undefined,
    input.targetBankCode,
    input.amountBRL,
    input.rate,
    input.bankName,
    'settlement',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    input.biometricToken
  );

  await producer.sendTransaction(transaction);
  return transaction;
}
