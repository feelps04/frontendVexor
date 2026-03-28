import type { FastifyInstance } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import type Redis from 'ioredis';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { verifySupabaseJWT } from '../infrastructure/supabase-jwt.js';

const BALANCE_PREFIX = 'balance:v2:';
const INITIAL_BALANCE = 0;

function sha256Base64(input: string): string {
  return crypto.createHash('sha256').update(input).digest('base64');
}

function parseTtlSec(envValue: string | undefined, fallback: number): number {
  const n = Number(envValue);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function cookieSecure(): boolean {
  const v = String(process.env.COOKIE_SECURE ?? '').toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return process.env.NODE_ENV === 'production';
}

export async function authRoutes(
  app: FastifyInstance,
  opts: { pg?: Pool; redis?: Redis }
): Promise<void> {
  const { pg, redis } = opts;

  const accessTtlSec = parseTtlSec(process.env.JWT_ACCESS_TTL_SEC, 15 * 60);
  const refreshTtlSec = parseTtlSec(process.env.JWT_REFRESH_TTL_SEC, 30 * 24 * 60 * 60);

  app.get('/api/v1/auth/register', async (_request, reply) => {
    return reply.code(405).send({ message: 'Method Not Allowed. Use POST /api/v1/auth/register' });
  });

  app.get('/api/v1/auth/login', async (_request, reply) => {
    return reply.code(405).send({ message: 'Method Not Allowed. Use POST /api/v1/auth/login' });
  });

  app.post<{
    Body: { email: string; password: string };
  }>(
    '/api/v1/auth/register',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string' },
            password: { type: 'string', minLength: 6 },
          },
        },
        response: {
          201: {
            type: 'object',
            properties: {
              userId: { type: 'string' },
              accountId: { type: 'string' },
              accessToken: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const email = String(request.body.email || '').trim().toLowerCase();
      const password = String(request.body.password || '');

      // Mock register when PostgreSQL not available
      if (!pg) {
        const mockUserId = 'mock-user-' + crypto.randomBytes(8).toString('hex');
        const mockAccountId = 'mock-account-' + crypto.randomBytes(8).toString('hex');
        
        // Use app.jwt if available, otherwise create a simple mock token
        let accessToken: string;
        if (app.jwt && typeof app.jwt.sign === 'function') {
          accessToken = app.jwt.sign(
            { email, accountId: mockAccountId },
            { sub: mockUserId, expiresIn: accessTtlSec }
          );
        } else {
          // Simple mock token for development
          accessToken = 'mock.' + Buffer.from(JSON.stringify({ sub: mockUserId, email, accountId: mockAccountId, exp: Math.floor(Date.now() / 1000) + accessTtlSec })).toString('base64url') + '.mock';
        }

        return reply.code(201).send({ userId: mockUserId, accountId: mockAccountId, accessToken });
      }

      const passwordHash = await bcrypt.hash(password, 10);

      let client: PoolClient;
      try {
        client = await pg.connect();
      } catch (err) {
        request.log.error({ err }, 'pg connect failed');
        return reply.code(503).send({ message: 'Database unavailable' });
      }
      try {
        await client.query('BEGIN');

        const userRes = await client.query<{ id: string }>(
          'INSERT INTO users(email, password_hash) VALUES ($1, $2) RETURNING id',
          [email, passwordHash]
        );
        const userId = userRes.rows[0]!.id;

        const accountRes = await client.query<{ id: string }>(
          'INSERT INTO accounts(user_id) VALUES ($1) RETURNING id',
          [userId]
        );
        const accountId = accountRes.rows[0]!.id;

        const refreshToken = crypto.randomBytes(48).toString('base64url');
        const refreshHash = sha256Base64(refreshToken);
        const expiresAt = new Date(Date.now() + refreshTtlSec * 1000);

        await client.query(
          'INSERT INTO refresh_tokens(user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
          [userId, refreshHash, expiresAt.toISOString()]
        );

        await client.query('COMMIT');

        const accessToken = app.jwt.sign(
          { email, accountId },
          { sub: userId, expiresIn: accessTtlSec }
        );

        reply.setCookie('refreshToken', refreshToken, {
          httpOnly: true,
          secure: cookieSecure(),
          sameSite: 'lax',
          path: '/api/v1/auth/refresh',
          expires: expiresAt,
        });

        if (redis) {
          await redis.set(`${BALANCE_PREFIX}${accountId}`, String(INITIAL_BALANCE));
        }

        return reply.code(201).send({ userId, accountId, accessToken });
      } catch (err: any) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // ignore
        }

        // Unique violation on email
        if (err && (err.code === '23505' || String(err.message || '').toLowerCase().includes('duplicate'))) {
          return reply.code(409).send({ message: 'Email já cadastrado' });
        }

        request.log.error({ err }, 'register failed');
        return reply.code(500).send({ message: 'Erro ao cadastrar' });
      } finally {
        client.release();
      }
    }
  );

  app.post<{
    Body: { email: string; password: string };
  }>(
    '/api/v1/auth/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string' },
            password: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              userId: { type: 'string' },
              accountId: { type: 'string' },
              accessToken: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const email = String(request.body.email || '').trim().toLowerCase();
      const password = String(request.body.password || '');

      // Mock login when PostgreSQL not available
      if (!pg) {
        const mockUserId = 'mock-user-' + crypto.randomBytes(8).toString('hex');
        const mockAccountId = 'mock-account-' + crypto.randomBytes(8).toString('hex');
        
        // Use app.jwt if available, otherwise create a simple mock token
        let accessToken: string;
        if (app.jwt && typeof app.jwt.sign === 'function') {
          accessToken = app.jwt.sign(
            { email, accountId: mockAccountId },
            { sub: mockUserId, expiresIn: accessTtlSec }
          );
        } else {
          // Simple mock token for development
          accessToken = 'mock.' + Buffer.from(JSON.stringify({ sub: mockUserId, email, accountId: mockAccountId, exp: Math.floor(Date.now() / 1000) + accessTtlSec })).toString('base64url') + '.mock';
        }

        return reply.send({ userId: mockUserId, accountId: mockAccountId, accessToken });
      }

      try {
        const userRes = await pg.query<{ id: string; password_hash: string }>(
          'SELECT id, password_hash FROM users WHERE email = $1',
          [email]
        );

        if (userRes.rowCount === 0) {
          return reply.code(401).send({ message: 'Credenciais inválidas' });
        }

        const userId = userRes.rows[0]!.id;
        const passwordHash = userRes.rows[0]!.password_hash;
        const ok = await bcrypt.compare(password, passwordHash);
        if (!ok) {
          return reply.code(401).send({ message: 'Credenciais inválidas' });
        }

        const accountRes = await pg.query<{ id: string }>('SELECT id FROM accounts WHERE user_id = $1', [userId]);
        if (accountRes.rowCount === 0) {
          return reply.code(500).send({ message: 'Conta não encontrada para o usuário' });
        }
        const accountId = accountRes.rows[0]!.id;

        const refreshToken = crypto.randomBytes(48).toString('base64url');
        const refreshHash = sha256Base64(refreshToken);
        const expiresAt = new Date(Date.now() + refreshTtlSec * 1000);

        await pg.query(
          'INSERT INTO refresh_tokens(user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
          [userId, refreshHash, expiresAt.toISOString()]
        );

        const accessToken = app.jwt.sign(
          { email, accountId },
          { sub: userId, expiresIn: accessTtlSec }
        );

        reply.setCookie('refreshToken', refreshToken, {
          httpOnly: true,
          secure: cookieSecure(),
          sameSite: 'lax',
          path: '/api/v1/auth/refresh',
          expires: expiresAt,
        });

        return reply.send({ userId, accountId, accessToken });
      } catch (err) {
        const msg = String((err as any)?.message ?? '');
        const isDbUnavailable =
          msg.toLowerCase().includes('connection terminated') ||
          msg.toLowerCase().includes('timeout') ||
          msg.toLowerCase().includes('econnrefused') ||
          msg.toLowerCase().includes('could not connect') ||
          msg.toLowerCase().includes('remaining connection slots');

        request.log.error({ err }, 'login failed');
        if (isDbUnavailable) {
          return reply.code(503).send({ message: 'Database unavailable' });
        }
        return reply.code(500).send({ message: 'Erro ao logar' });
      }
    }
  );
}
