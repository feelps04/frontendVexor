import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { RedisCacheService } from '@transaction-auth-engine/shared';

// Extend FastifyInstance to include our decorators
declare module 'fastify' {
  interface FastifyInstance {
    cacheService: RedisCacheService;
  }
}

export async function marketCandlesRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Params: { symbol: string };
    Querystring: { interval?: string; count?: string; before?: string };
  }>('/api/v1/market/candles/:symbol', async (request, reply) => {
    const { symbol } = request.params;
    const { interval = '1', count = '100', before } = request.query;

    // Validate inputs
    const intervalMinutes = parseInt(interval, 10);
    const candleCount = Math.min(parseInt(count, 10) || 100, 1000); // Max 1000

    if (isNaN(intervalMinutes) || intervalMinutes < 1) {
      return reply.status(400).send({
        error: 'Invalid interval. Must be a positive integer (minutes).',
      });
    }

    if (candleCount <= 0) {
      return reply.status(400).send({
        error: 'Invalid count. Must be a positive integer.',
      });
    }

    // Get cache service from decorator
    const cacheService = request.server.cacheService;

    if (!cacheService) {
      request.log.warn({ symbol }, 'Redis cache service not available');
      return reply.send([]);
    }

    try {
      const beforeTimestamp = before ? parseInt(before, 10) : undefined;

      const candles = await cacheService.getRecentCandles(
        symbol.toUpperCase(),
        candleCount,
        intervalMinutes,
        beforeTimestamp
      );

      if (candles.length === 0) {
        request.log.info({ symbol, interval: intervalMinutes, count: candleCount }, 'Cache Miss - no candles found');
      } else {
        request.log.debug(
          { symbol, interval: intervalMinutes, count: candleCount, oldest: candles[candles.length - 1]?.timestamp },
          'Cache Hit'
        );
      }

      return reply.send(candles);
    } catch (err) {
      request.log.error({ err, symbol }, 'Error retrieving candles from cache');
      return reply.status(500).send({
        error: 'Failed to retrieve candles',
      });
    }
  });
}
