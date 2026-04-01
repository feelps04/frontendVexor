import { Kafka, CompressionTypes, logLevel } from 'kafkajs';
import type { Transaction } from '@transaction-auth-engine/core';

const TOPIC_PENDING = 'transactions.pending';

export interface ApiKafkaProducerConfig {
  brokers: string[];
}

export class ApiKafkaProducer {
  private readonly kafka: Kafka;
  private producer: Awaited<ReturnType<Kafka['producer']>> | null = null;
  private enabled = true;

  constructor(config: ApiKafkaProducerConfig) {
    this.kafka = new Kafka({
      clientId: 'transaction-api',
      brokers: config.brokers,
      retry: { retries: 0 },
      logLevel: logLevel.NOTHING,
    });
  }

  async connect(): Promise<void> {
    try {
      this.producer = this.kafka.producer();
      await this.producer.connect();
      this.enabled = true;
    } catch {
      this.producer = null;
      this.enabled = false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.producer) {
      await this.producer.disconnect();
      this.producer = null;
    }
  }

  async sendTransaction(transaction: Transaction): Promise<void> {
    if (!this.enabled) return;
    if (!this.producer) throw new Error('Producer not connected');

    await this.producer.send({
      topic: TOPIC_PENDING,
      compression: CompressionTypes.GZIP,
      messages: [
        {
          key: transaction.accountId,
          value: JSON.stringify(transaction.toJSON()),
        },
      ],
    });
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}
