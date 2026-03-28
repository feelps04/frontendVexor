import type { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

export async function registerSwagger(app: FastifyInstance): Promise<void> {
  const enableSwaggerUi = String(process.env.ENABLE_SWAGGER_UI ?? '').toLowerCase() === 'true';

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Transaction Auth Engine API',
        description: 'REST API for submitting and querying transaction authorization',
        version: '1.0.0',
      },
      servers: [{ url: 'http://localhost:3000', description: 'Local' }],
    },
  });

  if (enableSwaggerUi) {
    await app.register(swaggerUi, {
      routePrefix: '/api-docs',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: true,
      },
    });
  }
}
