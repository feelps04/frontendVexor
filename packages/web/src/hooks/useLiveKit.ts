import { useState, useEffect, useRef, useCallback } from 'react';
import { Room, RoomEvent, DataPacket_Kind } from 'livekit-client';
import { getApiOrigin } from '../lib/browserApiOrigin';

interface UseLiveKitOptions {
  room?: string;
  onMessage?: (data: any) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  enabled?: boolean;
}

interface LiveKitState {
  connected: boolean;
  room: Room | null;
}

// Hook for LiveKit realtime data
export function useLiveKit({
  room = 'trading-room',
  onMessage,
  onConnect,
  onDisconnect,
  enabled = true
}: UseLiveKitOptions = {}) {
  const [state, setState] = useState<LiveKitState>({ connected: false, room: null });
  const roomRef = useRef<Room | null>(null);
  const mountedRef = useRef(false);
  
  // Use refs for callbacks to avoid reconnection loops
  const onMessageRef = useRef(onMessage);
  const onConnectRef = useRef(onConnect);
  const onDisconnectRef = useRef(onDisconnect);
  
  useEffect(() => {
    onMessageRef.current = onMessage;
    onConnectRef.current = onConnect;
    onDisconnectRef.current = onDisconnect;
  });

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;

    mountedRef.current = true;

    const connect = async () => {
      try {
        // Get token from API
        const resp = await fetch(`${getApiOrigin()}/api/v1/livekit/token?room=${room}`);
        if (!resp.ok) {
          console.error('[LiveKit] Failed to get token');
          onDisconnectRef.current?.();
          return;
        }
        
        const { token, url } = await resp.json();
        
        // Create and connect to room
        const livekitRoom = new Room();
        roomRef.current = livekitRoom;
        
        console.log('[LiveKit] Registering DataReceived event handler...');
        
        livekitRoom.on(RoomEvent.DataReceived, (payload: Uint8Array, participant: any, kind?: any, topic?: string) => {
          if (!mountedRef.current) return;
          console.log('[LiveKit] DataReceived event triggered, payload size:', payload.length, 'kind:', kind, 'topic:', topic);
          try {
            const data = JSON.parse(new TextDecoder().decode(payload));
            console.log('[LiveKit] Parsed data:', data.symbol, data.last);
            onMessageRef.current?.(data);
          } catch (err) {
            console.error('[LiveKit] Error parsing data:', err);
          }
        });
        
        livekitRoom.on(RoomEvent.Disconnected, () => {
          if (!mountedRef.current) return;
          console.log('[LiveKit] Disconnected');
          setState(s => ({ ...s, connected: false }));
          onDisconnectRef.current?.();
        });
        
        await livekitRoom.connect(url, token);
        
        if (mountedRef.current) {
          console.log('[LiveKit] Connected to room:', room);
          console.log('[LiveKit] Participants:', livekitRoom.participants.size);
          console.log('[LiveKit] Local participant:', livekitRoom.localParticipant.identity);
          setState({ connected: true, room: livekitRoom });
          onConnectRef.current?.();
        }
        
      } catch (err) {
        console.error('[LiveKit] Connection error:', err);
        if (mountedRef.current) {
          onDisconnectRef.current?.();
        }
      }
    };

    connect();

    return () => {
      mountedRef.current = false;
      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }
    };
  }, [enabled, room]);

  // Send data to room
  const publishData = useCallback((data: any) => {
    if (!roomRef.current || !state.connected) return;
    const encoder = new TextEncoder();
    roomRef.current.localParticipant.publishData(
      encoder.encode(JSON.stringify(data)),
      DataPacket_Kind.RELIABLE
    );
  }, [state.connected]);

  return {
    ...state,
    publishData,
    disconnect: () => {
      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }
    }
  };
}
