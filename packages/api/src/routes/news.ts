import type { FastifyInstance } from 'fastify';

export async function newsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/news', async (_req, reply) => {
    return reply.status(200).send({ items: [] });
  });
}