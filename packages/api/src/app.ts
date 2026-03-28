import Fastify from 'fastify';
import Redis from 'ioredis';
import { Pool } from 'pg';
import path from 'path';
import type { FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import dns from 'node:dns';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../.env') }); // Load .env from project root
config({ path: resolve(process.cwd(), '.env') }); // Also try from cwd
config(); // Also try default
const PORT = Number(process.env.PORT) || 3001;
import pkg from '@transaction-auth-engine/shared';
const { createLogger, MercadoBitcoinClient, BrapiClient, RedisCacheService, OperationLockService } = pkg;
import { ApiKafkaProducer } from './infrastructure/kafka-producer.js';
import { registerSwagger } from './plugins/swagger.js';
import { transactionRoutes } from './routes/transactions.js';
import { orderRoutes } from './routes/orders.js';
import { healthRoutes } from './routes/health.js';
import { integrityRoutes } from './routes/integrity.js';
import { balanceAtRoutes } from './routes/balance-at.js';
import { balanceOpsRoutes } from './routes/balance-ops.js';
import { authRoutes } from './routes/auth.js';

async function ensurePostgresReady(pg: Pool, logger: ReturnType<typeof createLogger>): Promise<boolean> {
  const maxAttempts = Number(process.env.PG_STARTUP_ATTEMPTS ?? 10);
  const backoffMs = Number(process.env.PG_STARTUP_BACKOFF_MS ?? 1000);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await pg.query('SELECT 1');
      logger.info('PostgreSQL ready');
      return true;
    } catch (err) {
      if (attempt === maxAttempts) {
        logger.warn({ err }, 'PostgreSQL unavailable; running API in degraded mode');
        return false;
      }
      await new Promise(r => setTimeout(r, backoffMs));
    }
  }
  return false;
}

/** Allowed browser origins; extend with CORS_ORIGINS=comma,separated,urls in production. */
function getCorsOrigins(): string[] {
  const defaults = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5174',
    'http://localhost:4173',
    'http://127.0.0.1:4173',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://vexorflow.com',
    'https://www.vexorflow.com',
  ];
  const extra = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([...defaults, ...extra])];
}

export async function buildApp(): Promise<FastifyInstance> {
  const logger = createLogger('api');
  const app = Fastify({ logger: false });

  // CORS: local (Vite) + opcional domínio público (CORS_ORIGINS)
  await app.register(import('@fastify/cors'), {
    origin: getCorsOrigins(),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
  });

  // Request timing and metrics hook
  app.addHook('onRequest', (request, _reply, done) => {
    (request as unknown as { log: typeof logger; startTime: number }).log = logger.child({
      requestId: request.id,
      method: request.method,
      url: request.url,
    });
    (request as unknown as { startTime: number }).startTime = Date.now();
    done();
  });

  app.addHook('onResponse', (request, reply, done) => {
    const startTime = (request as unknown as { startTime?: number }).startTime;
    const duration = startTime ? (Date.now() - startTime) / 1000 : 0;
    const route = request.routerPath || request.url;
    
    httpRequestsTotal.inc({
      method: request.method,
      route: route,
      status: reply.statusCode.toString(),
    });
    
    httpRequestDuration.observe(
      { method: request.method, route: route },
      duration
    );
    
    done();
  });

  await registerSwagger(app);
  await app.register(fastifyWebsocket);
  await registerMetrics(app);

  const fs = await import('fs');
  const webDistLocal = path.join(process.cwd(), 'dist');
  const webDistMonorepo = path.join(process.cwd(), 'packages', 'web', 'dist');
  const publicLocal = path.join(process.cwd(), 'public');
  const publicMonorepo = path.join(process.cwd(), 'packages', 'api', 'public');

  const resolvedPublic =
    fs.existsSync(webDistLocal) ? webDistLocal : fs.existsSync(webDistMonorepo) ? webDistMonorepo : fs.existsSync(publicLocal) ? publicLocal : publicMonorepo;

  if (fs.existsSync(resolvedPublic)) {
    const nodeMajor = Number(String(process.versions.node || '0').split('.')[0] || 0);
    if (nodeMajor >= 22) {
      logger.warn({ node: process.versions.node }, '@fastify/static disabled on Node >=22; running API without static assets');
    } else {
    try {
      const fastifyStatic = (await import('@fastify/static')).default;
      await app.register(fastifyStatic, {
        root: resolvedPublic,
        prefix: '/',
        setHeaders: (res, pathname) => {
          const normalized = String(pathname || '').replace(/\\/g, '/');
          if (normalized.endsWith('/app.js') || normalized.endsWith('/index.html') || normalized === 'app.js' || normalized === 'index.html') {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            res.setHeader('Surrogate-Control', 'no-store');
          }
        },
      });
      app.get('/', (_req, reply) => reply.sendFile('index.html'));

      app.get('/login', (_req, reply) => reply.sendFile('index.html'));
      app.get('/register', (_req, reply) => reply.sendFile('index.html'));
      app.get('/app', (_req, reply) => reply.sendFile('index.html'));
      app.get('/app/*', (_req, reply) => reply.sendFile('index.html'));
    } catch (err) {
      logger.warn({ err }, '@fastify/static unavailable; running API without static assets');
    }
    }
  }

  const producer = new ApiKafkaProducer({ brokers: KAFKA_BROKERS });
  await ensureKafkaReady(producer, logger);

  const mercadoBitcoin = new MercadoBitcoinClient();
  const brapi = new BrapiClient({ token: process.env.BRAPI_TOKEN });

  let redis: Redis | undefined;
  try {
    redis = new Redis(REDIS_URL);
    try {
      redis.on('error', () => {
        // avoid noisy unhandled error events; routes already handle redis failures
      });
    } catch {
      // ignore
    }

    const pingTimeoutMs = Number(process.env.REDIS_PING_TIMEOUT_MS ?? 1500);
    const pingOk = await Promise.race([
      redis.ping().then(() => true).catch(() => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), pingTimeoutMs)),
    ]);
    if (!pingOk) {
      try {
        redis.disconnect();
      } catch {
        // ignore
      }
      redis = undefined;
    }
  } catch {
    redis = undefined;
  }

  // High-performance Redis services
  let cacheService: InstanceType<typeof RedisCacheService> | undefined;
  let lockService: InstanceType<typeof OperationLockService> | undefined;
  if (redis) {
    cacheService = new RedisCacheService();
    await cacheService.connect(REDIS_URL, logger);
    lockService = new OperationLockService();
    await lockService.connect(redis, logger);
    logger.info('High-performance Redis services initialized (cache + locks)');
  }

  // Expose high-performance services via Fastify decorator
  if (cacheService && lockService) {
    app.decorate('cacheService', cacheService);
    app.decorate('lockService', lockService);
  }

  let pg: Pool | undefined;
  if (DATABASE_URL) {
    pg = new Pool({
      connectionString: DATABASE_URL,
      connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS ?? 5000),
      idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS ?? 30000),
      max: Number(process.env.PG_POOL_MAX ?? 10),
      ssl: { rejectUnauthorized: false }, // Required for Supabase
    });

    const ok = await ensurePgReady(pg, logger);
    if (!ok) {
      try {
        await pg.end();
      } catch {
        // ignore
      }
      pg = undefined;
    }
  }

  await app.register(fastifyCookie);
  const jwtSecret = process.env.JWT_SECRET;
  // JWT_SECRET is optional - we support Supabase JWT (ES256) without it
  if (jwtSecret) {
    await app.register(fastifyJwt, { secret: jwtSecret });
  }

  if (pg) await runMigrations(pg);

  await app.register(marketGroupsRoutes);
  await app.register(marketCandlesRoutes);
  await app.register(sectorRoutes, { redis });
  await app.register(socialRoutes, { pg });

  await app.register(transactionRoutes, { producer, redis });
  await app.register(orderRoutes, { producer, redis, mercadoBitcoin, brapi });
  await app.register(fxRoutes, { redis });
  await app.register(stockRoutes, { redis });
  await app.register(stocksWsRoutes, { brokers: KAFKA_BROKERS.join(','), redis });
  if (redis) {
    await app.register(teamsRoutes, { redis });
  }
  await app.register(btcWsRoutes, {
    brokers: KAFKA_BROKERS,
    mercadoBitcoin: mercadoBitcoin as unknown as {
      getBtcBrlCandles(params: {
        fromSec: number;
        toSec: number;
        resolution: string;
      }): Promise<Array<{ time: number; open: number; high: number; low: number; close: number; volume?: number }>>;
    },
  });
  await app.register(healthRoutes, { redis: redis ? { ping: () => redis!.ping() } : undefined });
  if (redis && pg) {
    await app.register(integrityRoutes, { redis, pg });
    await app.register(realtimeRoutes, { redis, pg });
  }
  // Register auth routes with PostgreSQL/Supabase
  await app.register(authRoutes, { pg, redis });
  // Register AI signals routes
  await app.register(aiSignalsRoutes);
  // Register trade and broker routes
  await app.register(tradeRoutes);
  // Register doctrine routes
  await app.register(doctrineRoutes);
  // Register psych routes
  await app.register(psychRoutes);
  // Register RAG routes
  await app.register(ragRoutes);
  // Endpoint para workers/status - busca dados do sentinel_api.py + Binance
  app.get('/api/v1/workers/status', async (request, reply) => {
    const http = await import('http');
    const https = await import('https');
    
    // Buscar dados da Binance em paralelo
    const binancePromise = new Promise<any[]>((resolve) => {
      https.get('https://api.binance.com/api/v3/ticker/price', (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const prices = JSON.parse(data);
            // Filtrar apenas pares USDT populares
            const popular = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT'];
            const filtered = prices.filter((p: any) => popular.includes(p.symbol));
            resolve(filtered);
          } catch { resolve([]); }
        });
      }).on('error', () => resolve([]));
    });
    
    try {
      const [dataStr, binancePrices] = await Promise.all([
        new Promise<string>((resolve, reject) => {
          http.get('http://localhost:8765/mmf/debug', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
          }).on('error', reject);
        }),
        binancePromise
      ]);
      
      const data = JSON.parse(dataStr);
      return {
        timestamp: new Date().toISOString(),
        sources: {
          tradingview: {
            webhook: '/api/v1/tradingview/webhook',
            activeSymbols: (mmfCache as any).tv?.length ?? 0,
            samples: ((mmfCache as any).tv ?? []).slice(0, 5).map((t: any) => ({
              symbol: t.symbol, last: t.last, source: 'tradingview'
            }))
          },
          pepperstone: {
            mmf: 'Local\\GLOBALRAM',
            connected: data.global_connected,
            activeSymbols: data.global_symbols.length,
            samples: data.global_symbols.slice(0, 5).map((t: any) => ({
              symbol: t.symbol, bid: t.bid, ask: t.ask, heartbeat: 1
            }))
          },
          genial: {
            mmf: 'Local\\B3RAM',
            connected: data.b3_connected,
            activeSymbols: data.b3_symbols.length,
            samples: data.b3_symbols.slice(0, 5).map((t: any) => ({
              symbol: t.symbol, bid: t.bid, ask: t.ask, heartbeat: 1
            }))
          },
          binance: {
            websocket: 'wss://stream.binance.com:9443',
            status: binancePrices.length > 0 ? 'connected' : 'disconnected',
            activeSymbols: binancePrices.length,
            samples: binancePrices.slice(0, 5).map((p: any) => ({
              symbol: p.symbol,
              price: parseFloat(p.price),
              updatedAt: new Date().toISOString()
            }))
          }
        },
        processes: { mt5_instances: 2, udp_listening: true, api_port: 3000 }
      };
    } catch (e) {
      return {
        timestamp: new Date().toISOString(),
        error: 'sentinel_api.py não disponível',
        sources: {
          pepperstone: { mmf: 'Local\\GLOBALRAM', connected: false, activeSymbols: 0, samples: [] },
          genial: { mmf: 'Local\\B3RAM', connected: false, activeSymbols: 0, samples: [] },
          binance: { websocket: 'wss://stream.binance.com:9443', status: 'connecting', activeSymbols: 0, samples: [] }
        },
        processes: { mt5_instances: 2, udp_listening: true, api_port: 3000 }
      };
    }
  });
  
  // Register Signal Tracker routes
  await app.register(signalTrackerRoutes);
  
  // Register Telegram Webhook routes
  await app.register(telegramWebhookRoutes);

  // Register TradingView Webhook routes (fonte primária de ticks)
  await app.register(tradingviewWebhookRoutes);
  
  // Register LiveKit routes for realtime data
  livekitRoutes(app);
  
  if (pg) {
    await app.register(chatRoutes, { pg });
    await app.register(newsRoutes, { pg });
    await app.register(balanceAtRoutes, { pg });
  }
  if (redis) {
    await app.register(balanceOpsRoutes, { redis, pg });
  }

  app.addHook('onClose', async () => {
    await producer.disconnect();
    if (redis) redis.disconnect();
    if (pg) await pg.end();
  });

  return app;
}

async function main(): Promise<void> {
  const logger = createLogger('api');
  
  // Initialize PostgreSQL via Supabase connection
  
  // Initialize MMF Readers (connect to MT5 EAs)
  logger.info('Connecting to MMF readers...');
  const globalConnected = await globalRAMReader.connect();
  const b3Connected = await b3RAMReader.connect();
  
  if (globalConnected) {
    globalRAMReader.startPolling(5000); // 5 segundos para não travar o sistema
    logger.info('✅ GLOBALRAM (Pepperstone) connected');
  } else {
    logger.warn('⚠️ GLOBALRAM (Pepperstone) not connected - MT5 EA not running?');
  }
  
  if (b3Connected) {
    b3RAMReader.startPolling(5000); // 5 segundos para não travar o sistema
    logger.info('✅ B3RAM (Genial) connected');
  } else {
    logger.warn('⚠️ B3RAM (Genial) not connected - MT5 EA not running?');
  }
  
  const app = await buildApp();

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    logger.info({ port: PORT }, 'API listening');
  } catch (err) {
    logger.error({ err }, 'Failed to start');
    process.exit(1);
  }
}

main();
