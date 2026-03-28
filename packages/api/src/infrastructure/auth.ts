import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifySupabaseJWT } from './supabase-jwt.js';

export type AuthUser = {
  userId: string;
  email?: string;
  accountId?: string;
};

export async function requireAuth(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply): Promise<AuthUser | null> {
  const authHeader = String(request.headers.authorization ?? '');
  const token = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    reply.code(401).send({ message: 'Unauthorized' });
    return null;
  }

  try {
    // Try Supabase JWT verification first (ES256)
    const supabasePayload = verifySupabaseJWT(token);
    if (supabasePayload) {
      const userId = String(supabasePayload.sub ?? '');
      if (!userId) {
        reply.code(401).send({ message: 'Unauthorized' });
        return null;
      }
      const user: AuthUser = { 
        userId, 
        email: supabasePayload.email, 
        accountId: supabasePayload.app_metadata?.accountId as string | undefined 
      };
      (request as any).user = user;
      return user;
    }

    // Fallback to @fastify/jwt (HS256) for backward compatibility
    const decoded = app.jwt.verify(token) as { sub?: string; email?: string; accountId?: string };
    const userId = String(decoded.sub ?? '');
    if (!userId) {
      reply.code(401).send({ message: 'Unauthorized' });
      return null;
    }
    const user: AuthUser = { userId, email: decoded.email, accountId: decoded.accountId };
    (request as any).user = user;
    return user;
  } catch {
    reply.code(401).send({ message: 'Unauthorized' });
    return null;
  }
}
