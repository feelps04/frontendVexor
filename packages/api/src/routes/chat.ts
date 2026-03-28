import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { requireAuth } from '../infrastructure/auth.js';

export interface ChatDeps {
  pg: Pool;
}

type WsLike = { send(data: string): void; on(event: string, cb: () => void): void };

function wsFromConnection(connection: unknown): WsLike {
  return (
    (connection as { socket?: WsLike }).socket ??
    (connection as WsLike)
  );
}

async function requireWsAuth(app: FastifyInstance, req: any, ws: WsLike): Promise<{ userId: string } | null> {
  const url = req?.url ?? '';
  const u = new URL(url, 'http://localhost');
  const token = String(u.searchParams.get('token') ?? '').trim();
  if (!token) {
    try {
      ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }));
    } catch {
      // ignore
    }
    return null;
  }
  try {
    const decoded = app.jwt.verify(token) as { sub?: string };
    const userId = String(decoded.sub ?? '');
    if (!userId) return null;
    return { userId };
  } catch {
    try {
      ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }));
    } catch {
      // ignore
    }
    return null;
  }
}

export async function chatRoutes(app: FastifyInstance, opts: ChatDeps): Promise<void> {
  const { pg } = opts;

  const roomSubs = new Map<string, Set<WsLike>>();

  const broadcast = (roomId: string, payload: unknown): void => {
    const subs = roomSubs.get(roomId);
    if (!subs || subs.size === 0) return;
    const data = JSON.stringify(payload);
    for (const ws of subs) {
      try {
        ws.send(data);
      } catch {
        // ignore
      }
    }
  };

  app.get('/ws/chat', { websocket: true }, (connection, req) => {
    const ws = wsFromConnection(connection);
    let closed = false;

    const url = req?.url ?? '';
    const u = new URL(url, 'http://localhost');
    const roomId = String(u.searchParams.get('roomId') ?? '').trim();

    const join = async (): Promise<void> => {
      if (!roomId) {
        try {
          ws.send(JSON.stringify({ type: 'error', message: 'roomId requerido' }));
        } catch {
          // ignore
        }
        return;
      }

      const auth = await requireWsAuth(app, req, ws);
      if (!auth) return;

      const memberRes = await pg.query(
        `SELECT 1 FROM chat_members WHERE room_id = $1 AND user_id = $2`,
        [roomId, auth.userId]
      );
      if (memberRes.rowCount === 0) {
        try {
          ws.send(JSON.stringify({ type: 'error', message: 'Forbidden' }));
        } catch {
          // ignore
        }
        return;
      }

      if (!roomSubs.has(roomId)) roomSubs.set(roomId, new Set());
      roomSubs.get(roomId)!.add(ws);

      try {
        ws.send(JSON.stringify({ type: 'ready', roomId }));
      } catch {
        // ignore
      }
    };

    void join();

    ws.on('close', () => {
      closed = true;
      const set = roomSubs.get(roomId);
      if (!set) return;
      set.delete(ws);
      if (set.size === 0) roomSubs.delete(roomId);
    });

    // Prevent unused var lint in some setups
    void closed;
  });

  app.get('/api/v1/chat/rooms', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await requireAuth(app, request, reply);
    if (!user) return;

    const res = await pg.query(
      `SELECT r.id, r.type, r.name, r.created_at
       FROM chat_rooms r
       JOIN chat_members m ON m.room_id = r.id
       WHERE m.user_id = $1
       ORDER BY r.created_at DESC`,
      [user.userId]
    );

    return reply.send({ rooms: res.rows });
  });

  app.post<{ Body: { name?: string; memberEmails?: string[] } }>(
    '/api/v1/chat/rooms',
    async (request: FastifyRequest<{ Body: { name?: string; memberEmails?: string[] } }>, reply: FastifyReply) => {
      const user = await requireAuth(app, request, reply);
      if (!user) return;

      const name = request.body?.name ? String(request.body.name).trim() : null;
      const memberEmails = Array.isArray(request.body?.memberEmails) ? request.body.memberEmails : [];

      const client = await pg.connect();
      try {
        await client.query('BEGIN');

        const roomRes = await client.query<{ id: string }>(
          `INSERT INTO chat_rooms(type, name, created_by)
           VALUES ('room', $1, $2)
           RETURNING id`,
          [name, user.userId]
        );
        const roomId = roomRes.rows[0]!.id;

        await client.query(
          `INSERT INTO chat_members(room_id, user_id, role)
           VALUES ($1, $2, 'admin')
           ON CONFLICT DO NOTHING`,
          [roomId, user.userId]
        );

        if (memberEmails.length) {
          const usersRes = await client.query<{ id: string }>(
            `SELECT id FROM users WHERE email = ANY($1::text[])`,
            [memberEmails.map((e) => String(e).trim().toLowerCase())]
          );
          for (const row of usersRes.rows) {
            await client.query(
              `INSERT INTO chat_members(room_id, user_id, role)
               VALUES ($1, $2, 'member')
               ON CONFLICT DO NOTHING`,
              [roomId, row.id]
            );
          }
        }

        await client.query('COMMIT');
        return reply.code(201).send({ roomId });
      } catch (err) {
        await client.query('ROLLBACK');
        request.log.error({ err }, 'create room failed');
        return reply.code(500).send({ message: 'Erro ao criar sala' });
      } finally {
        client.release();
      }
    }
  );

  app.post<{ Body: { email: string } }>(
    '/api/v1/chat/dm',
    async (request: FastifyRequest<{ Body: { email: string } }>, reply: FastifyReply) => {
      const user = await requireAuth(app, request, reply);
      if (!user) return;

      const otherEmail = String(request.body?.email ?? '').trim().toLowerCase();
      if (!otherEmail) return reply.code(400).send({ message: 'Email inválido' });

      const otherRes = await pg.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [otherEmail]);
      if (otherRes.rowCount === 0) return reply.code(404).send({ message: 'Usuário não encontrado' });
      const otherUserId = otherRes.rows[0]!.id;

      // Find existing dm: room with type dm that has both members
      const dmRes = await pg.query<{ id: string }>(
        `SELECT r.id
         FROM chat_rooms r
         JOIN chat_members m1 ON m1.room_id = r.id AND m1.user_id = $1
         JOIN chat_members m2 ON m2.room_id = r.id AND m2.user_id = $2
         WHERE r.type = 'dm'
         LIMIT 1`,
        [user.userId, otherUserId]
      );
      if ((dmRes.rowCount ?? 0) > 0) return reply.send({ roomId: dmRes.rows[0]!.id });

      const client = await pg.connect();
      try {
        await client.query('BEGIN');
        const roomRes = await client.query<{ id: string }>(
          `INSERT INTO chat_rooms(type, name, created_by)
           VALUES ('dm', NULL, $1)
           RETURNING id`,
          [user.userId]
        );
        const roomId = roomRes.rows[0]!.id;

        await client.query(
          `INSERT INTO chat_members(room_id, user_id, role)
           VALUES ($1, $2, 'member'), ($1, $3, 'member')
           ON CONFLICT DO NOTHING`,
          [roomId, user.userId, otherUserId]
        );

        await client.query('COMMIT');
        return reply.code(201).send({ roomId });
      } catch (err) {
        await client.query('ROLLBACK');
        request.log.error({ err }, 'create dm failed');
        return reply.code(500).send({ message: 'Erro ao criar DM' });
      } finally {
        client.release();
      }
    }
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/chat/rooms/:id/messages',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const user = await requireAuth(app, request, reply);
      if (!user) return;

      const roomId = request.params.id;

      const memberRes = await pg.query(
        `SELECT 1 FROM chat_members WHERE room_id = $1 AND user_id = $2`,
        [roomId, user.userId]
      );
      if (memberRes.rowCount === 0) return reply.code(403).send({ message: 'Forbidden' });

      const res = await pg.query(
        `SELECT id, room_id, sender_user_id, content, created_at
         FROM chat_messages
         WHERE room_id = $1
         ORDER BY created_at ASC
         LIMIT 200`,
        [roomId]
      );

      return reply.send({ roomId, messages: res.rows });
    }
  );

  app.post<{ Params: { id: string }; Body: { content: string } }>(
    '/api/v1/chat/rooms/:id/messages',
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { content: string } }>,
      reply: FastifyReply
    ) => {
      const user = await requireAuth(app, request, reply);
      if (!user) return;

      const roomId = request.params.id;
      const content = String(request.body?.content ?? '').trim();
      if (!content) return reply.code(400).send({ message: 'Mensagem vazia' });

      const memberRes = await pg.query(
        `SELECT 1 FROM chat_members WHERE room_id = $1 AND user_id = $2`,
        [roomId, user.userId]
      );
      if (memberRes.rowCount === 0) return reply.code(403).send({ message: 'Forbidden' });

      const res = await pg.query<{ id: string }>(
        `INSERT INTO chat_messages(room_id, sender_user_id, content)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [roomId, user.userId, content]
      );

      const msgRes = await pg.query(
        `SELECT id, room_id, sender_user_id, content, created_at
         FROM chat_messages
         WHERE id = $1`,
        [res.rows[0]!.id]
      );
      const message = msgRes.rows[0] ?? null;
      if (message) {
        broadcast(roomId, { type: 'message', roomId, message });
      }

      return reply.code(201).send({ id: res.rows[0]!.id });
    }
  );
}
