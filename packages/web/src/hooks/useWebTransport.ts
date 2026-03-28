import { useEffect, useRef, useState, useCallback } from 'react';

// WebTransport types (not yet in standard lib)
interface WebTransportDatagram {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
}

interface WebTransportBidirectionalStream {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
}

interface WebTransportIncoming {
  incomingBidirectionalStreams: ReadableStream<WebTransportBidirectionalStream>;
  incomingUnidirectionalStreams: ReadableStream<ReadableStream<Uint8Array>>;
}

interface WebTransportInstance {
  ready: Promise<void>;
  closed: Promise<void>;
  datagrams: WebTransportDatagram;
  createUnidirectionalStream(): WritableStream<Uint8Array>;
  createBidirectionalStream(): Promise<WebTransportBidirectionalStream>;
  incomingUnidirectionalStreams: ReadableStream<ReadableStream<Uint8Array>>;
  incomingBidirectionalStreams: ReadableStream<WebTransportBidirectionalStream>;
  close(): void;
}

interface WebTransportOptions {
  allowPooling?: boolean;
  requireUnreliable?: boolean;
  congestionControl?: 'default' | 'throughput' | 'low-latency';
}

declare global {
  interface Window {
    WebTransport: new (url: string, options?: WebTransportOptions) => WebTransportInstance;
  }
}

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
  type: 'tick' | 'ticks' | 'init' | 'feed_status';
  symbol?: string;
  items?: PriceData[];
  lastPrices?: Record<string, PriceData>;
  stale?: boolean;
  ageMs?: number;
}

export interface WebTransportState {
  connected: boolean;
  stale: boolean;
  ageMs: number | null;
}

export interface UseWebTransportOptions {
  url: string;
  symbols: string[];
  onMessage?: (msg: FeedMessage) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  enabled?: boolean;
}

export function useWebTransport({
  url,
  symbols,
  onMessage,
  onConnect,
  onDisconnect,
  enabled = true
}: UseWebTransportOptions) {
  const [state, setState] = useState<WebTransportState>({
    connected: false,
    stale: false,
    ageMs: null
  });
  
  const wtRef = useRef<WebTransportInstance | null>(null);
  const datagramWriterRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(null);
  const symbolsRef = useRef<string[]>(symbols);
  const mountedRef = useRef(false);
  
  // Update symbols ref when props change
  useEffect(() => {
    symbolsRef.current = symbols;
  }, [symbols]);
  
  // Create WebTransport connection
  useEffect(() => {
    if (!enabled) return;
    
    mountedRef.current = true;
    
    // Check if WebTransport is supported
    if (!window.WebTransport) {
      console.warn('[WebTransport] Not supported, falling back to WebSocket');
      return;
    }
    
    // Don't create if already exists
    if (wtRef.current) return;
    
    const connect = async () => {
      try {
        // Create WebTransport with unreliable datagrams (low latency)
        const wt = new window.WebTransport(url, {
          allowPooling: false,
          requireUnreliable: true,
          congestionControl: 'low-latency'
        });
        
        wtRef.current = wt;
        
        // Wait for connection
        await wt.ready;
        
        if (!mountedRef.current) return;
        
        console.log('[WebTransport] Connected');
        setState(s => ({ ...s, connected: true }));
        onConnect?.();
        
        // Setup datagram writer for sending
        datagramWriterRef.current = wt.datagrams.writable.getWriter();
        
        // Handle incoming datagrams (unreliable, unordered - low latency)
        const reader = wt.datagrams.readable.getReader();
        
        (async () => {
          try {
            while (mountedRef.current) {
              const { value, done } = await reader.read();
              if (done) break;
              
              try {
                const msg: FeedMessage = JSON.parse(new TextDecoder().decode(value));
                
                if (!mountedRef.current) return;
                
                if (msg.type === 'feed_status') {
                  setState(s => ({
                    ...s,
                    stale: msg.stale ?? false,
                    ageMs: msg.ageMs ?? null
                  }));
                }
                
                onMessage?.(msg);
              } catch {
                // Ignore parse errors
              }
            }
          } catch {
            // Stream closed
          }
        })();
        
        // Handle incoming unidirectional streams (reliable for init data)
        const streamReader = wt.incomingUnidirectionalStreams.getReader();
        
        (async () => {
          try {
            while (mountedRef.current) {
              const { value: stream, done } = await streamReader.read();
              if (done) break;
              
              const streamReader2 = stream.getReader();
              try {
                const { value } = await streamReader2.read();
                if (value) {
                  const msg: FeedMessage = JSON.parse(new TextDecoder().decode(value));
                  
                  if (msg.type === 'init' && msg.lastPrices) {
                    onMessage?.(msg);
                  }
                }
              } catch {
                // Ignore
              }
            }
          } catch {
            // Stream closed
          }
        })();
        
        // Wait for close
        await wt.closed;
        
        if (mountedRef.current) {
          console.log('[WebTransport] Disconnected');
          setState(s => ({ ...s, connected: false }));
          onDisconnect?.();
        }
        
      } catch (err) {
        console.warn('[WebTransport] Connection error:', err);
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
  }, [enabled, url]);
  
  // Subscribe to symbols
  const subscribeSymbols = useCallback(async (syms: string[]) => {
    if (!datagramWriterRef.current) return;
    
    const msg = JSON.stringify({
      type: 'set_symbols',
      symbols: syms.map(s => s.toUpperCase())
    });
    
    try {
      await datagramWriterRef.current.write(new TextEncoder().encode(msg));
    } catch {
      // Ignore write errors
    }
  }, []);
  
  // Auto-subscribe when symbols change
  useEffect(() => {
    if (state.connected && symbols.length > 0) {
      subscribeSymbols(symbols);
    }
  }, [state.connected, symbols, subscribeSymbols]);
  
  return {
    ...state,
    subscribeSymbols,
    disconnect: () => {
      wtRef.current?.close();
      wtRef.current = null;
    }
  };
}

// Fallback to WebSocket if WebTransport not available
export function useWebSocketFallback({
  url,
  symbols,
  onMessage,
  onConnect,
  onDisconnect,
  enabled = true
}: UseWebTransportOptions) {
  const [state, setState] = useState<WebTransportState>({
    connected: false,
    stale: false,
    ageMs: null
  });
  
  const wsRef = useRef<WebSocket | null>(null);
  const symbolsRef = useRef<string[]>(symbols);
  const mountedRef = useRef(false);
  
  useEffect(() => {
    symbolsRef.current = symbols;
  }, [symbols]);
  
  useEffect(() => {
    if (!enabled) return;
    
    mountedRef.current = true;
    
    if (wsRef.current) return;
    
    const ws = new WebSocket(url, 'json');
    wsRef.current = ws;
    
    ws.onopen = () => {
      if (!mountedRef.current) return;
      setState(s => ({ ...s, connected: true }));
      onConnect?.();
      
      // Subscribe to symbols
      if (symbolsRef.current.length > 0) {
        ws.send(JSON.stringify({
          type: 'set_symbols',
          symbols: symbolsRef.current
        }));
      }
    };
    
    ws.onmessage = (ev) => {
      if (!mountedRef.current) return;
      
      try {
        const msg: FeedMessage = JSON.parse(ev.data);
        
        if (msg.type === 'feed_status') {
          setState(s => ({
            ...s,
            stale: msg.stale ?? false,
            ageMs: msg.ageMs ?? null
          }));
        }
        
        onMessage?.(msg);
      } catch {
        // Ignore
      }
    };
    
    ws.onclose = () => {
      if (!mountedRef.current) return;
      setState(s => ({ ...s, connected: false }));
      onDisconnect?.();
    };
    
    ws.onerror = () => {
      if (!mountedRef.current) return;
      setState(s => ({ ...s, connected: false }));
    };
    
    return () => {
      mountedRef.current = false;
    };
  }, [enabled, url]);
  
  // Re-subscribe when symbols change
  useEffect(() => {
    if (state.connected && wsRef.current && symbols.length > 0) {
      wsRef.current.send(JSON.stringify({
        type: 'set_symbols',
        symbols: symbols
      }));
    }
  }, [state.connected, symbols]);
  
  return {
    ...state,
    subscribeSymbols: (syms: string[]) => {
      if (wsRef.current && state.connected) {
        wsRef.current.send(JSON.stringify({
          type: 'set_symbols',
          symbols: syms
        }));
      }
    },
    disconnect: () => {
      wsRef.current?.close();
      wsRef.current = null;
    }
  };
}

// Combined hook that uses WebTransport if available, falls back to WebSocket
export function useRealTimeFeed(options: UseWebTransportOptions) {
  const [useWT, setUseWT] = useState(false);
  
  // Check WebTransport support
  useEffect(() => {
    if (window.WebTransport && options.url.startsWith('https')) {
      setUseWT(true);
    }
  }, [options.url]);
  
  const wtHook = useWebTransport(options);
  const wsHook = useWebSocketFallback(options);
  
  return useWT ? wtHook : wsHook;
}
