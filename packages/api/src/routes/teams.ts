import type { FastifyInstance } from 'fastify';
import type Redis from 'ioredis';

export interface TeamsDeps {
  redis: Redis;
}

const TEAM_OF_ACCOUNT_PREFIX = 'team:account:v1:';
const TEAM_MEMBERS_PREFIX = 'team:members:v1:';
const TEAM_SCORE_ZSET = 'team:ranking:v1';

export async function teamsRoutes(app: FastifyInstance, opts: TeamsDeps): Promise<void> {
  const { redis } = opts;

  app.post<{ Body: { accountId: string; teamId: string } }>('/api/v1/teams/join', async (req, reply) => {
    const accountId = String(req.body?.accountId ?? '').trim();
    const teamId = String(req.body?.teamId ?? '').trim();
    if (!accountId) return reply.status(400).send({ message: 'accountId is required' });
    if (!teamId) return reply.status(400).send({ message: 'teamId is required' });

    const prevTeam = await redis.get(`${TEAM_OF_ACCOUNT_PREFIX}${accountId}`);
    if (prevTeam && prevTeam !== teamId) {
      try {
        await redis.srem(`${TEAM_MEMBERS_PREFIX}${prevTeam}`, accountId);
      } catch {
        // ignore
      }
    }

    await redis.set(`${TEAM_OF_ACCOUNT_PREFIX}${accountId}`, teamId);
    await redis.sadd(`${TEAM_MEMBERS_PREFIX}${teamId}`, accountId);
    // Ensure team exists in ranking
    await redis.zadd(TEAM_SCORE_ZSET, 'NX', 0, teamId);

    return reply.send({ ok: true, accountId, teamId });
  });

  app.get<{ Params: { accountId: string } }>('/api/v1/accounts/:accountId/team', async (req, reply) => {
    const accountId = String(req.params.accountId ?? '').trim();
    if (!accountId) return reply.status(400).send({ message: 'accountId is required' });
    const teamId = await redis.get(`${TEAM_OF_ACCOUNT_PREFIX}${accountId}`);
    return reply.send({ accountId, teamId: teamId ?? null });
  });

  app.get<{ Params: { teamId: string } }>('/api/v1/teams/:teamId/score', async (req, reply) => {
    const teamId = String(req.params.teamId ?? '').trim();
    if (!teamId) return reply.status(400).send({ message: 'teamId is required' });
    const scoreRaw = await redis.zscore(TEAM_SCORE_ZSET, teamId);
    const score = scoreRaw != null ? Number(scoreRaw) : 0;
    return reply.send({ teamId, score });
  });

  app.get('/api/v1/teams/ranking', async (req, reply) => {
    const q = (req.query ?? {}) as { limit?: string };
    const limit = Math.max(1, Math.min(100, Number(q.limit ?? '10') || 10));

    const rows = await redis.zrevrange(TEAM_SCORE_ZSET, 0, limit - 1, 'WITHSCORES');
    const out: Array<{ teamId: string; score: number }> = [];
    for (let i = 0; i < rows.length; i += 2) {
      const teamId = String(rows[i] ?? '');
      const score = Number(rows[i + 1] ?? 0);
      if (!teamId) continue;
      out.push({ teamId, score: Number.isFinite(score) ? score : 0 });
    }

    return reply.send({ items: out });
  });
}
