import type { FastifyInstance } from 'fastify';

export const httpRequestsTotal = {
  inc: (_labels: any) => {},
};

export const httpRequestDuration = {
  observe: (_labels: any, _value: number) => {},
};

export async function registerMetrics(_app: FastifyInstance): Promise<void> {}

export const KAFKA_BROKERS = (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',');

export async function ensureKafkaReady(_producer: any, _logger: any): Promise<void> {}

export const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

export const DATABASE_URL = process.env.DATABASE_URL ?? '';

export async function ensurePgReady(_pg: any, _logger: any): Promise<boolean> {
  return true;
}

export async function runMigrations(_pg: any): Promise<void> {}
