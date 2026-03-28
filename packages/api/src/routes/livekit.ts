import { FastifyInstance } from 'fastify';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'devkey';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'secret';
const LIVEKIT_URL = process.env.LIVEKIT_URL || 'ws://localhost:7880';

console.log('[LiveKit] Config:', { 
  key: LIVEKIT_API_KEY, 
  secret: LIVEKIT_API_SECRET?.substring(0, 10) + '...', 
  url: LIVEKIT_URL 
});

const roomService = new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

export function livekitRoutes(app: FastifyInstance) {
  // Generate token for client to join room
  app.get('/api/v1/livekit/token', async (request, reply) => {
    try {
      const { room = 'trading-room', identity = `user-${Date.now()}` } = request.query as any;
      
      const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
        identity,
        ttl: '24h',
      });
      
      token.addGrant({
        roomJoin: true,
        room,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      });
      
      const jwt = await token.toJwt();
      console.log('[LiveKit] Generated token for room:', room, 'identity:', identity, 'token length:', jwt?.length);
      
      return { 
        token: jwt,
        url: LIVEKIT_URL,
        room 
      };
    } catch (error) {
      console.error('[LiveKit] Error generating token:', error);
      reply.code(500).send({ error: 'Failed to generate token' });
    }
  });

  // Get room info
  app.get('/api/v1/livekit/rooms', async (request, reply) => {
    try {
      const rooms = await roomService.listRooms();
      return { rooms };
    } catch (error) {
      console.error('[LiveKit] Error listing rooms:', error);
      reply.code(500).send({ error: 'Failed to list rooms' });
    }
  });
}
