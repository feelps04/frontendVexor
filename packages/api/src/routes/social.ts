// Social routes for Vexor platform - PostgreSQL backed
// Feed, Posts, Messages, Teams, Reels, Stories

import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';

let pg: Pool | undefined;

export default async function socialRoutes(app: FastifyInstance, opts?: { pg?: Pool }) {
  pg = opts?.pg;

  // ============ USERS ============
  
  app.get('/api/v1/social/me', async (req, reply) => {
    if (!pg) return reply.code(500).send({ error: 'Database not available' });
    const result = await pg.query('SELECT * FROM social_users WHERE id = $1', ['a0000000-0000-0000-0000-000000000001']);
    return { user: result.rows[0] || null };
  });

  app.get('/api/v1/social/users/:userId', async (req: any, reply) => {
    if (!pg) return reply.code(500).send({ error: 'Database not available' });
    const { userId } = req.params;
    const result = await pg.query('SELECT * FROM social_users WHERE id = $1', [userId]);
    if (result.rows.length === 0) return reply.code(404).send({ error: 'User not found' });
    return { user: result.rows[0] };
  });

  app.get('/api/v1/social/users', async (req: any, reply) => {
    if (!pg) return reply.code(500).send({ error: 'Database not available' });
    const { q } = req.query;
    const result = await pg.query(
      `SELECT * FROM social_users WHERE username ILIKE $1 OR display_name ILIKE $1 LIMIT 20`,
      [`%${q || ''}%`]
    );
    return { users: result.rows };
  });

  // ============ FEED & POSTS ============

  app.get('/api/v1/social/feed', async (req: any, reply) => {
    if (!pg) return reply.code(500).send({ error: 'Database not available' });
    const { page = 0, limit = 20 } = req.query;
    const offset = Number(page) * Number(limit);
    
    const postsResult = await pg.query(
      `SELECT p.*, u.id as user_id, u.username, u.display_name, u.avatar, u.verified, u.is_ai,
              (SELECT COUNT(*) FROM social_likes WHERE post_id = p.id) as likes_count,
              (SELECT COUNT(*) FROM social_comments WHERE post_id = p.id) as comments_count,
              (SELECT EXISTS(SELECT 1 FROM social_likes WHERE post_id = p.id AND user_id = $1)) as liked
       FROM social_posts p
       JOIN social_users u ON p.user_id = u.id
       ORDER BY p.created_at DESC
       LIMIT $2 OFFSET $3`,
      ['a0000000-0000-0000-0000-000000000001', Number(limit), offset]
    );

    const posts = postsResult.rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      content: row.content,
      type: row.type,
      media: row.media || [],
      tags: row.tags || [],
      createdAt: row.created_at,
      user: {
        id: row.user_id,
        username: row.username,
        displayName: row.display_name,
        avatar: row.avatar,
        verified: row.verified,
        isAI: row.is_ai,
      },
      likesCount: parseInt(row.likes_count) || 0,
      commentsCount: parseInt(row.comments_count) || 0,
      liked: row.liked,
    }));

    const countResult = await pg.query('SELECT COUNT(*) as total FROM social_posts');
    
    return { 
      posts, 
      hasMore: offset + posts.length < parseInt(countResult.rows[0].total),
      total: parseInt(countResult.rows[0].total),
    };
  });

  app.post('/api/v1/social/posts', async (req: any, reply) => {
    if (!pg) return reply.code(500).send({ error: 'Database not available' });
    const { content, type = 'text', media = [], tags = [] } = req.body;
    const userId = 'a0000000-0000-0000-0000-000000000001';

    const result = await pg.query(
      `INSERT INTO social_posts (user_id, content, type, media, tags) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [userId, content, type, JSON.stringify(media), tags]
    );

    return { post: result.rows[0] };
  });

  app.post('/api/v1/social/posts/:postId/like', async (req: any, reply) => {
    if (!pg) return reply.code(500).send({ error: 'Database not available' });
    const { postId } = req.params;
    const userId = 'a0000000-0000-0000-0000-000000000001';

    const existing = await pg.query('SELECT id FROM social_likes WHERE post_id = $1 AND user_id = $2', [postId, userId]);

    if (existing.rows.length > 0) {
      await pg.query('DELETE FROM social_likes WHERE id = $1', [existing.rows[0].id]);
      const countResult = await pg.query('SELECT COUNT(*) as count FROM social_likes WHERE post_id = $1', [postId]);
      return { liked: false, likesCount: parseInt(countResult.rows[0].count) };
    } else {
      await pg.query('INSERT INTO social_likes (post_id, user_id) VALUES ($1, $2)', [postId, userId]);
      const countResult = await pg.query('SELECT COUNT(*) as count FROM social_likes WHERE post_id = $1', [postId]);
      return { liked: true, likesCount: parseInt(countResult.rows[0].count) };
    }
  });

  app.post('/api/v1/social/posts/:postId/comments', async (req: any, reply) => {
    if (!pg) return reply.code(500).send({ error: 'Database not available' });
    const { postId } = req.params;
    const { content } = req.body;
    const userId = 'a0000000-0000-0000-0000-000000000001';

    const result = await pg.query(`INSERT INTO social_comments (post_id, user_id, content) VALUES ($1, $2, $3) RETURNING *`, [postId, userId, content]);
    const userResult = await pg.query('SELECT * FROM social_users WHERE id = $1', [userId]);
    return { comment: { ...result.rows[0], user: userResult.rows[0] } };
  });

  app.get('/api/v1/social/posts/:postId/comments', async (req: any, reply) => {
    if (!pg) return reply.code(500).send({ error: 'Database not available' });
    const { postId } = req.params;
    const result = await pg.query(
      `SELECT c.*, u.id as user_id, u.username, u.display_name, u.avatar, u.verified FROM social_comments c JOIN social_users u ON c.user_id = u.id WHERE c.post_id = $1 ORDER BY c.created_at ASC`,
      [postId]
    );
    const comments = result.rows.map(row => ({
      id: row.id, postId: row.post_id, userId: row.user_id, content: row.content, createdAt: row.created_at,
      user: { id: row.user_id, username: row.username, displayName: row.display_name, avatar: row.avatar, verified: row.verified },
    }));
    return { comments };
  });

  // ============ STORIES ============

  app.get('/api/v1/social/stories', async (req, reply) => {
    if (!pg) return reply.code(500).send({ error: 'Database not available' });
    const result = await pg.query(
      `SELECT s.*, u.id as user_id, u.username, u.display_name, u.avatar FROM social_stories s JOIN social_users u ON s.user_id = u.id WHERE s.expires_at > NOW() ORDER BY s.created_at DESC`
    );
    const stories = result.rows.map(row => ({
      id: row.id, userId: row.user_id, mediaUrl: row.media_url, type: row.type, caption: row.caption, expiresAt: row.expires_at, createdAt: row.created_at,
      user: { id: row.user_id, username: row.username, displayName: row.display_name, avatar: row.avatar },
    }));
    return { stories };
  });

  app.post('/api/v1/social/stories', async (req: any, reply) => {
    if (!pg) return reply.code(500).send({ error: 'Database not available' });
    const { mediaUrl, type = 'image', caption } = req.body;
    const userId = 'a0000000-0000-0000-0000-000000000001';
    const result = await pg.query(`INSERT INTO social_stories (user_id, media_url, type, caption) VALUES ($1, $2, $3, $4) RETURNING *`, [userId, mediaUrl, type, caption]);
    return { story: result.rows[0] };
  });

  // ============ REELS ============

  app.get('/api/v1/social/reels', async (req: any, reply) => {
    if (!pg) return reply.code(500).send({ error: 'Database not available' });
    const result = await pg.query(
      `SELECT p.*, u.id as user_id, u.username, u.display_name, u.avatar, u.verified, (SELECT COUNT(*) FROM social_likes WHERE post_id = p.id) as likes_count FROM social_posts p JOIN social_users u ON p.user_id = u.id WHERE p.type = 'reel' ORDER BY p.created_at DESC`
    );
    const reels = result.rows.map(row => ({
      id: row.id, userId: row.user_id, content: row.content, media: row.media || [], createdAt: row.created_at,
      user: { id: row.user_id, username: row.username, displayName: row.display_name, avatar: row.avatar, verified: row.verified },
      likesCount: parseInt(row.likes_count) || 0,
    }));
    return { reels };
  });

  // ============ MESSAGES ============

  app.get('/api/v1/social/conversations', async (req, reply) => {
    if (!pg) return reply.code(500).send({ error: 'Database not available' });
    const userId = 'a0000000-0000-0000-0000-000000000001';
    const result = await pg.query(
      `SELECT DISTINCT CASE WHEN m.from_user_id = $1 THEN m.to_user_id ELSE m.from_user_id END as other_user_id FROM social_messages m WHERE m.from_user_id = $1 OR m.to_user_id = $1`,
      [userId]
    );
    const conversations = await Promise.all(result.rows.map(async (row) => {
      const userResult = await pg!.query('SELECT * FROM social_users WHERE id = $1', [row.other_user_id]);
      const lastMsg = await pg!.query(
        `SELECT content, created_at FROM social_messages WHERE (from_user_id = $1 AND to_user_id = $2) OR (from_user_id = $2 AND to_user_id = $1) ORDER BY created_at DESC LIMIT 1`,
        [userId, row.other_user_id]
      );
      const unread = await pg!.query(`SELECT COUNT(*) as count FROM social_messages WHERE to_user_id = $1 AND from_user_id = $2 AND read = false`, [userId, row.other_user_id]);
      return { id: [userId, row.other_user_id].sort().join(':'), user: userResult.rows[0] || null, lastMessage: lastMsg.rows[0]?.content, lastMessageTime: lastMsg.rows[0]?.created_at, unread: parseInt(unread.rows[0].count) || 0 };
    }));
    return { conversations };
  });

  app.get('/api/v1/social/messages/:otherUserId', async (req: any, reply) => {
    if (!pg) return reply.code(500).send({ error: 'Database not available' });
    const { otherUserId } = req.params;
    const userId = 'a0000000-0000-0000-0000-000000000001';
    const result = await pg.query(`SELECT * FROM social_messages WHERE (from_user_id = $1 AND to_user_id = $2) OR (from_user_id = $2 AND to_user_id = $1) ORDER BY created_at ASC`, [userId, otherUserId]);
    await pg.query(`UPDATE social_messages SET read = true WHERE to_user_id = $1 AND from_user_id = $2 AND read = false`, [userId, otherUserId]);
    return { messages: result.rows };
  });

  app.post('/api/v1/social/messages', async (req: any, reply) => {
    if (!pg) return reply.code(500).send({ error: 'Database not available' });
    const { to, content, type = 'text' } = req.body;
    const from = 'a0000000-0000-0000-0000-000000000001';
    const result = await pg.query(`INSERT INTO social_messages (from_user_id, to_user_id, content, type) VALUES ($1, $2, $3, $4) RETURNING *`, [from, to, content, type]);
    return { message: result.rows[0] };
  });

  // ============ SQUADS (TEAMS) ============

  app.get('/api/v1/social/squads', async (req, reply) => {
    if (!pg) return reply.code(500).send({ error: 'Database not available' });
    const userId = 'a0000000-0000-0000-0000-000000000001';
    const result = await pg.query(
      `SELECT s.*, (SELECT COUNT(*) FROM social_squad_members WHERE squad_id = s.id) as member_count FROM social_squads s JOIN social_squad_members sm ON s.id = sm.squad_id WHERE sm.user_id = $1`,
      [userId]
    );
    return { squads: result.rows };
  });

  app.get('/api/v1/social/squads/:squadId', async (req: any, reply) => {
    if (!pg) return reply.code(500).send({ error: 'Database not available' });
    const { squadId } = req.params;
    const result = await pg.query(
      `SELECT s.*, (SELECT json_agg(json_build_object('id', u.id, 'username', u.username, 'displayName', u.display_name, 'avatar', u.avatar)) FROM social_squad_members sm JOIN social_users u ON sm.user_id = u.id WHERE sm.squad_id = s.id) as members FROM social_squads s WHERE s.id = $1`,
      [squadId]
    );
    if (result.rows.length === 0) return reply.code(404).send({ error: 'Squad not found' });
    return { squad: result.rows[0] };
  });

  app.post('/api/v1/social/squads', async (req: any, reply) => {
    if (!pg) return reply.code(500).send({ error: 'Database not available' });
    const { name, description } = req.body;
    const userId = 'a0000000-0000-0000-0000-000000000001';
    const result = await pg.query(`INSERT INTO social_squads (name, description, owner_id) VALUES ($1, $2, $3) RETURNING *`, [name, description, userId]);
    const squad = result.rows[0];
    await pg.query(`INSERT INTO social_squad_members (squad_id, user_id, role) VALUES ($1, $2, 'owner')`, [squad.id, userId]);
    return { squad };
  });

  app.get('/api/v1/social/squads/:squadId/messages', async (req: any, reply) => {
    if (!pg) return reply.code(500).send({ error: 'Database not available' });
    const { squadId } = req.params;
    const result = await pg.query(
      `SELECT m.*, u.id as user_id, u.username, u.display_name, u.avatar, u.verified FROM social_squad_messages m JOIN social_users u ON m.user_id = u.id WHERE m.squad_id = $1 ORDER BY m.created_at ASC LIMIT 100`,
      [squadId]
    );
    const messages = result.rows.map(row => ({
      id: row.id, squadId: row.squad_id, userId: row.user_id, content: row.content, type: row.type, createdAt: row.created_at,
      user: { id: row.user_id, username: row.username, displayName: row.display_name, avatar: row.avatar, verified: row.verified },
    }));
    return { messages };
  });

  app.post('/api/v1/social/squads/:squadId/messages', async (req: any, reply) => {
    if (!pg) return reply.code(500).send({ error: 'Database not available' });
    const { squadId } = req.params;
    const { content, type = 'text' } = req.body;
    const userId = 'a0000000-0000-0000-0000-000000000001';
    const memberCheck = await pg.query('SELECT id FROM social_squad_members WHERE squad_id = $1 AND user_id = $2', [squadId, userId]);
    if (memberCheck.rows.length === 0) return reply.code(403).send({ error: 'Not a member of this squad' });
    const result = await pg.query(`INSERT INTO social_squad_messages (squad_id, user_id, content, type) VALUES ($1, $2, $3, $4) RETURNING *`, [squadId, userId, content, type]);
    const userResult = await pg.query('SELECT * FROM social_users WHERE id = $1', [userId]);
    return { message: { ...result.rows[0], user: userResult.rows[0] } };
  });

  app.post('/api/v1/social/squads/:squadId/join', async (req: any, reply) => {
    if (!pg) return reply.code(500).send({ error: 'Database not available' });
    const { squadId } = req.params;
    const userId = 'a0000000-0000-0000-0000-000000000001';
    try {
      await pg.query(`INSERT INTO social_squad_members (squad_id, user_id, role) VALUES ($1, $2, 'member')`, [squadId, userId]);
      return { joined: true };
    } catch { return reply.code(400).send({ error: 'Already a member or squad not found' }); }
  });

  // ============ FOLLOW ============

  app.post('/api/v1/social/users/:userId/follow', async (req: any, reply) => {
    if (!pg) return reply.code(500).send({ error: 'Database not available' });
    const { userId } = req.params;
    const currentUserId = 'a0000000-0000-0000-0000-000000000001';
    const existing = await pg.query('SELECT id FROM social_follows WHERE follower_id = $1 AND following_id = $2', [currentUserId, userId]);
    if (existing.rows.length > 0) {
      await pg.query('DELETE FROM social_follows WHERE id = $1', [existing.rows[0].id]);
      return { following: false };
    } else {
      await pg.query('INSERT INTO social_follows (follower_id, following_id) VALUES ($1, $2)', [currentUserId, userId]);
      return { following: true };
    }
  });

  app.get('/api/v1/social/users/:userId/followers', async (req: any, reply) => {
    if (!pg) return reply.code(500).send({ error: 'Database not available' });
    const { userId } = req.params;
    const result = await pg.query(`SELECT u.* FROM social_follows f JOIN social_users u ON f.follower_id = u.id WHERE f.following_id = $1`, [userId]);
    return { followers: result.rows, count: result.rows.length };
  });

  // ============ NOTIFICATIONS ============

  app.get('/api/v1/social/notifications', async (req, reply) => {
    if (!pg) return reply.code(500).send({ error: 'Database not available' });
    const userId = 'a0000000-0000-0000-0000-000000000001';
    const result = await pg.query(
      `SELECT n.*, u.id as from_user_id, u.username, u.display_name, u.avatar FROM social_notifications n LEFT JOIN social_users u ON n.from_user_id = u.id WHERE n.user_id = $1 ORDER BY n.created_at DESC LIMIT 50`,
      [userId]
    );
    const notifications = result.rows.map(row => ({
      id: row.id, type: row.type, from: row.from_user_id ? { id: row.from_user_id, username: row.username, displayName: row.display_name, avatar: row.avatar } : null, message: row.content, read: row.read, createdAt: row.created_at,
    }));
    return { notifications };
  });

  // ============ SEED TEST DATA ============
  
  app.post('/api/v1/social/seed', async (req, reply) => {
    if (!pg) return reply.code(500).send({ error: 'Database not available' });
    
    // Create test users
    await pg.query(`
      INSERT INTO social_users (id, username, display_name, avatar, bio, is_ai, created_at)
      VALUES 
        ('b0000000-0000-0000-0000-000000000001', 'quant_alpha', 'QUANT_ALPHA', 'https://api.dicebear.com/7.x/avataaars/svg?seed=quant', 'Análise Quantitativa | Trading Algorítmico', false, NOW()),
        ('b0000000-0000-0000-0000-000000000002', 'ghost_trader', 'GHOST_TRADER', 'https://api.dicebear.com/7.x/avataaars/svg?seed=ghost', 'Day Trader | Crypto & Forex', false, NOW()),
        ('b0000000-0000-0000-0000-000000000003', 'cyber_bull', 'CYBER_BULL', 'https://api.dicebear.com/7.x/avataaars/svg?seed=cyber', 'Bull Market Enthusiast 🐂', false, NOW())
      ON CONFLICT (id) DO NOTHING
    `);
    
    // Create test posts
    await pg.query(`
      INSERT INTO social_posts (id, user_id, content, type, tags, created_at)
      VALUES 
        ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '📈 Análise técnica do BTC/USD\n\nSuporte forte em $42.500\nResistência em $45.000\n\nEntrada sugerida: $43.200\nStop: $41.800\nTarget: $48.000\n\n#bitcoin #trading #analise', 'text', ARRAY['bitcoin', 'trading', 'analise'], NOW()),
        ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', '🚀 ETH está mostrando força!\n\nVolume aumentando\nWhales acumulando\n\nPotencial pump em breve 📊', 'text', ARRAY['ethereum', 'crypto', 'whales'], NOW()),
        ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000003', '💡 Dica do dia:\n\n"O mercado pode ficar irracional por mais tempo do que você pode ficar solvente"\n\nGerencie seu risco! 🛡️', 'text', ARRAY['dica', 'risco', 'trading'], NOW())
      ON CONFLICT (id) DO NOTHING
    `);
    
    // Create test stories
    await pg.query(`
      INSERT INTO social_stories (id, user_id, media_url, type, caption, expires_at, created_at)
      VALUES 
        ('d0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'https://picsum.photos/400/700?random=1', 'image', 'Análise do dia 📊', NOW() + INTERVAL '24 hours', NOW()),
        ('d0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'https://picsum.photos/400/700?random=2', 'image', 'Setup confirmado! 🎯', NOW() + INTERVAL '24 hours', NOW()),
        ('d0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'https://picsum.photos/400/700?random=3', 'image', 'VEXOR AI: Sinal detectado 🤖', NOW() + INTERVAL '24 hours', NOW())
      ON CONFLICT (id) DO NOTHING
    `);
    
    return { success: true, message: 'Test data seeded successfully' };
  });

  console.log('[Social] Routes registered with PostgreSQL');
}
