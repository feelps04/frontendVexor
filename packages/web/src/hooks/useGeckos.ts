import { useEffect, useRef, useState, useCallback } from 'react';
import { geckos } from '@geckos.io/client';
import { Room, RoomEvent, DataPacket_Kind } from 'livekit-client';
import { WEBRTC_URL, WEBRTC_PORT } from '../lib/config';
import { pythonApiUrl } from '../lib/browserApiOrigin';

const isDev = import.meta.env.DEV;

// Price data types
export interface PriceData {
  symbol: string;
  priceBRL?: number;
  bid?: number;
  ask?: number;
  spread?: number;
  spreadPct?: number;
  source?: string;
  ts?: number;
}

export interface FeedMessage {
  type: 'tick' | 'ticks' | 'init' | 'prices' | 'sector_symbols';
  symbol?: string;
  items?: PriceData[];
  symbols?: PriceData[];
  sectorId?: string;
}

export interface GeckosState {
  connected: boolean;
}

export interface UseGeckosOptions {
  url?: string;
  port?: number;
  symbols: string[];
  onMessage?: (msg: FeedMessage) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  enabled?: boolean;
}

// HTTP Polling fallback for production (avoids Mixed Content)
function useHttpPolling({
  symbols,
  onMessage,
  onConnect,
  onDisconnect,
  enabled = true
}: UseGeckosOptions) {
  const [state, setState] = useState<GeckosState>({ connected: false });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    
    mountedRef.current = true;
    setState({ connected: true });
    onConnect?.();

    // Poll for prices every 2 seconds
    const poll = async () => {
      if (!mountedRef.current) return;
      
      try {
        // Use POST /ticks/batch endpoint
        const response = await fetch(pythonApiUrl('/ticks/batch'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbols })
        });
        if (response.ok && mountedRef.current) {
          const data = await response.json();
          onMessage?.({ type: 'ticks', items: data.ticks || data });
        }
      } catch (err) {
        // Silently fail, will retry
      }
    };

    // Initial poll
    poll();
    
    // Set up polling interval
    intervalRef.current = setInterval(poll, 2000);

    return () => {
      mountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      onDisconnect?.();
    };
  }, [enabled, symbols?.join(','), onConnect, onDisconnect, onMessage]);

  return {
    ...state,
    disconnect: () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
  };
}

// Production hook: Supabase Realtime (broadcast de ticks)
function useGeckosProduction({
  symbols,
  onMessage,
  onConnect,
  onDisconnect,
  enabled = true
}: UseGeckosOptions) {
  const [state, setState] = useState<GeckosState>({ connected: false });
  const channelRef = useRef<any>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;

    mountedRef.current = true;

    import('../lib/appwrite').then(({ supabase }) => {
      if (!mountedRef.current) return;

      // Criar canal para ticks
      const channel = supabase.channel('trading-room');
      channelRef.current = channel;

      // Escutar broadcasts de ticks
      channel.on('broadcast', { event: 'tick' }, (payload: any) => {
        if (!mountedRef.current) return;
        onMessage?.(payload.payload);
      });

      // Subscrever
      channel.subscribe((status: string) => {
        if (!mountedRef.current) return;
        
        if (status === 'SUBSCRIBED') {
          console.log('[Supabase] Connected to realtime feed');
          setState({ connected: true });
          onConnect?.();
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          setState({ connected: false });
          onDisconnect?.();
        }
      });
    });

    return () => {
      mountedRef.current = false;
      if (channelRef.current) {
        channelRef.current.unsubscribe();
        channelRef.current = null;
      }
    };
  }, [enabled]);

  return {
    ...state,
    disconnect: () => {
      if (channelRef.current) {
        channelRef.current.unsubscribe();
        channelRef.current = null;
      }
    }
  };
}

// Development hook: Geckos.io WebRTC
function useGeckosDevelopment({
  url,
  port = 10208,
  symbols,
  onMessage,
  onConnect,
  onDisconnect,
  enabled = true
}: UseGeckosOptions) {
  const [state, setState] = useState<GeckosState>({ connected: false });
  
  const channelRef = useRef<any>(null);
  const mountedRef = useRef(false);
  
  useEffect(() => {
    if (!enabled) return;
    
    mountedRef.current = true;
    if (channelRef.current) return;
    if (typeof window === 'undefined') return;
    
    const connect = () => {
      try {
        const resolvedPort = Number.isFinite(Number(port)) ? Number(port) : 10208;
        // Geckos.io WebRTC client - connects to signaling server (HTTP) and then upgrades to WebRTC
        // Forçar 127.0.0.1 para evitar problemas com IPv6/localhost
        const channel = geckos({ 
          url: url || WEBRTC_URL || 'http://127.0.0.1', 
          port: resolvedPort 
        });
        
        channelRef.current = channel;
        
        channel.onConnect((err: any) => {
          if (err) {
            if (mountedRef.current) {
              setState(s => ({ ...s, connected: false }));
              onDisconnect?.();
            }
            return;
          }
          
          if (mountedRef.current) {
            setState(s => ({ ...s, connected: true }));
            onConnect?.();
            
            // Envia lista de símbolos para o servidor
            if (symbols && symbols.length > 0) {
              channel.emit('set_symbols', { symbols: symbols.map(s => s.toUpperCase()) });
            }
          }
        });
        
        channel.on('ticks', (data: any) => {
          if (!mountedRef.current) return;
          onMessage?.(data);
        });
        
        channel.on('prices', (data: any) => {
          if (!mountedRef.current) return;
          onMessage?.(data);
        });
        
        channel.on('init', (data: any) => {
          if (!mountedRef.current) return;
          onMessage?.(data);
        });
        
        channel.onDisconnect(() => {
          if (mountedRef.current) {
            setState(s => ({ ...s, connected: false }));
            onDisconnect?.();
          }
        });
        
      } catch (err) {
        // Connection error
      }
    };
    
    connect();
    
    return () => {
      mountedRef.current = false;
    };
  }, [enabled, port, url, onConnect, onDisconnect, onMessage]);
  
  // Re-enviar set_symbols quando a lista de símbolos mudar (após conexão estabelecida)
  const symbolsKey = symbols ? symbols.slice().sort().join(',') : '';
  const prevSymbolsKeyRef = useRef<string>('');
  
  useEffect(() => {
    if (!enabled) return;
    if (!symbolsKey) return;
    const channel = channelRef.current;
    if (!channel) return;
    if (!state.connected) return;
    
    // Só re-enviar se a lista realmente mudou
    if (symbolsKey === prevSymbolsKeyRef.current) return;
    prevSymbolsKeyRef.current = symbolsKey;
    
    channel.emit('set_symbols', { symbols: symbols.map(s => s.toUpperCase()) });
  }, [enabled, symbolsKey, state.connected, symbols]);
  
  return {
    ...state,
    disconnect: () => {
      if (channelRef.current) {
        channelRef.current.close();
        channelRef.current = null;
      }
    }
  };
}

// Export: select correct hook based on environment
// In production (HTTPS), use HTTP polling to avoid Mixed Content
// In development, use Geckos.io WebRTC
export function useGeckos(options: UseGeckosOptions) {
  if (isDev) {
    return useGeckosDevelopment(options);
  }
  return useGeckosProduction(options);
}
