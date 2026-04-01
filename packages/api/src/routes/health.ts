import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

const REDIS_LATENCY_DEGRADED_MS = 100;

export interface HealthDeps {
  redis?: { ping(): Promise<string> };
}

export async function healthRoutes(
  app: FastifyInstance,
  opts: HealthDeps
): Promise<void> {
  const { redis } = opts ?? {};

  app.get(
    '/health',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['ok', 'degraded'] },
              redis: { type: 'string', enum: ['up', 'down', 'unconfigured'] },
              redisLatencyMs: { type: 'number' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      let redisStatus: 'up' | 'down' | 'unconfigured' = redis ? 'down' : 'unconfigured';
      let redisLatencyMs = 0;
      let message: string | undefined;
      if (redis) {
        try {
          const start = Date.now();
          await redis.ping();
          redisLatencyMs = Date.now() - start;
          redisStatus = 'up';
          if (redisLatencyMs > REDIS_LATENCY_DEGRADED_MS) {
            message = 'Degraded performance detected. Self-healing protocol active.';
          }
        } catch {
          redisStatus = 'down';
          message = 'Degraded performance detected. Self-healing protocol active.';
        }
      }
      const status =
        redisStatus === 'down' || (redisStatus === 'up' && redisLatencyMs > REDIS_LATENCY_DEGRADED_MS)
          ? 'degraded'
          : redisStatus === 'unconfigured' || redisStatus === 'up'
            ? 'ok'
            : 'degraded';
      return reply.status(200).send({
        status,
        redis: redisStatus,
        redisLatencyMs,
        ...(message ? { message } : {}),
      });
    }
  );
}
