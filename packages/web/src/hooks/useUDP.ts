import { useEffect, useRef, useState, useCallback } from 'react';
import { WS_UDP } from '../lib/config';
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

export interface UDPState {
  connected: boolean;
}

export interface UseUDPOptions {
  symbols: string[];
  onMessage?: (msg: FeedMessage) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  enabled?: boolean;
}

// HTTP Polling fallback for production (avoids Mixed Content)
function useHttpPollingUDP({
  symbols,
  onMessage,
  onConnect,
  onDisconnect,
  enabled = true
}: UseUDPOptions) {
  const [state, setState] = useState<UDPState>({ connected: false });
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
    subscribeSymbols: () => {},
    getSectorSymbols: () => {},
    disconnect: () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
  };
}

// UDP client using WebRTC data channel (browsers don't support raw UDP)
// We'll use a WebSocket to UDP bridge approach
export function useUDP({
  symbols,
  onMessage,
  onConnect,
  onDisconnect,
  enabled = true
}: UseUDPOptions) {
  // Em produção, usar HTTP polling via proxy para evitar Mixed Content
  if (!isDev) {
    return useHttpPollingUDP({ symbols, onMessage, onConnect, onDisconnect, enabled });
  }

  // Em desenvolvimento, usar WebSocket
  const [state, setState] = useState<UDPState>({ connected: false });
  
  const wsRef = useRef<WebSocket | null>(null);
  const symbolsRef = useRef<string[]>(symbols);
  const mountedRef = useRef(false);
  
  // Update symbols ref when props change
  useEffect(() => {
    symbolsRef.current = symbols;
  }, [symbols]);
  
  // Create WebSocket connection to UDP bridge
  useEffect(() => {
    if (!enabled) return;
    
    mountedRef.current = true;
    
    // Don't create if already exists
    if (wsRef.current) return;
    
    // Check if WebSocket is supported
    if (typeof window === 'undefined') return;
    
    const connect = () => {
      try {
        // Connect to UDP bridge via WebSocket (port 9300)
        const ws = new WebSocket(WS_UDP || 'ws://localhost:9300');
        
        wsRef.current = ws;
        
        ws.onopen = () => {
          if (!mountedRef.current) return;
          
          setState(s => ({ ...s, connected: true }));
          onConnect?.();
          
          // Subscribe to symbols
          if (symbolsRef.current.length > 0) {
            ws.send(JSON.stringify({
              type: 'subscribe',
              symbols: symbolsRef.current.map(s => s.toUpperCase())
            }));
          }
        };
        
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data) as FeedMessage;
            onMessage?.(msg);
          } catch (err) {
            // Parse error
          }
        };
        
        ws.onclose = () => {
          if (!mountedRef.current) return;
          
          setState(s => ({ ...s, connected: false }));
          onDisconnect?.();
          
          // Reconnect after 1s
          setTimeout(() => {
            if (mountedRef.current) {
              wsRef.current = null;
              connect();
            }
          }, 1000);
        };
        
        ws.onerror = (err) => {
          // Connection error
        };
      } catch (err) {
        if (mountedRef.current) {
          setState(s => ({ ...s, connected: false }));
          onDisconnect?.();
        }
      }
    };
    
    connect();
    
    return () => {
      mountedRef.current = false;
      // Don't close on StrictMode cleanup
    };
  }, [enabled]);
  
  // Subscribe to symbols
  const subscribeSymbols = useCallback((syms: string[]) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    
    wsRef.current.send(JSON.stringify({
      type: 'subscribe',
      symbols: syms.map(s => s.toUpperCase())
    }));
  }, []);
  
  // Auto-subscribe when symbols change
  useEffect(() => {
    if (state.connected && symbols.length > 0) {
      subscribeSymbols(symbols);
    }
  }, [state.connected, symbols, subscribeSymbols]);
  
  // Get sector symbols
  const getSectorSymbols = useCallback((sectorId: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({
      type: 'get_sector',
      sector_id: sectorId
    }));
  }, []);
  
  return {
    ...state,
    subscribeSymbols,
    getSectorSymbols,
    disconnect: () => {
      wsRef.current?.close();
      wsRef.current = null;
    }
  };
}
