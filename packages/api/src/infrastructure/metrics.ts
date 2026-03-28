import { register, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';
import type { FastifyInstance } from 'fastify';

// Enable default metrics (memory, CPU, event loop, etc.)
collectDefaultMetrics();

// Custom metrics
export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status'],
});

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

export const transactionsAuthorizedTotal = new Counter({
  name: 'transactions_authorized_total',
  help: 'Total number of authorized transactions',
  labelNames: ['currency'],
});

export const transactionsDeniedTotal = new Counter({
  name: 'transactions_denied_total',
  help: 'Total number of denied transactions',
  labelNames: ['reason'],
});

export const transactionsDlqTotal = new Counter({
  name: 'transactions_dlq_total',
  help: 'Total number of messages sent to DLQ',
});

export const kafkaConsumerLag = new Gauge({
  name: 'kafka_consumer_lag',
  help: 'Kafka consumer lag by topic and partition',
  labelNames: ['topic', 'partition'],
});

export const redisOperationsTotal = new Counter({
  name: 'redis_operations_total',
  help: 'Total number of Redis operations',
  labelNames: ['operation', 'status'],
});

export const activeWebSockets = new Gauge({
  name: 'active_websockets',
  help: 'Number of active WebSocket connections',
  labelNames: ['endpoint'],
});

export async function registerMetrics(app: FastifyInstance): Promise<void> {
  app.get('/metrics', async (_req, reply) => {
    const metrics = await register.metrics();
    return reply.type('text/plain').send(metrics);
  });
}
