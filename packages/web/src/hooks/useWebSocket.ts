import { useEffect, useRef, useCallback, useState } from 'react'

interface UseWebSocketOptions {
  url: string
  onMessage?: (data: any) => void
  onOpen?: () => void
  onClose?: () => void
  onError?: () => void
  reconnect?: boolean
  reconnectInterval?: number
}

export function useWebSocket({
  url,
  onMessage,
  onOpen,
  onClose,
  onError,
  reconnect = true,
  reconnectInterval = 3000,
}: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(false)

  const connect = useCallback(() => {
    if (!mountedRef.current) return
    
    try {
      const ws = new WebSocket(url, 'json')
      wsRef.current = ws

      ws.onopen = () => {
        if (!mountedRef.current) {
          ws.close()
          return
        }
        setIsConnected(true)
        onOpen?.()
      }

      ws.onclose = () => {
        setIsConnected(false)
        onClose?.()
        
        // Tentar reconectar se ainda montado
        if (mountedRef.current && reconnect) {
          reconnectTimeoutRef.current = setTimeout(() => {
            connect()
          }, reconnectInterval)
        }
      }

      ws.onerror = () => {
        onError?.()
      }

      ws.onmessage = (ev) => {
        if (!mountedRef.current) return
        try {
          const data = JSON.parse(String(ev.data))
          onMessage?.(data)
        } catch {
          // ignore parse errors
        }
      }
    } catch (e) {
      console.warn('WebSocket creation failed:', e)
    }
  }, [url, onMessage, onOpen, onClose, onError, reconnect, reconnectInterval])

  const send = useCallback((data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data))
    }
  }, [])

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
    }
    if (wsRef.current) {
      try {
        wsRef.current.close()
      } catch {}
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    
    // Delay para evitar problemas com StrictMode
    const timer = setTimeout(() => {
      if (mountedRef.current) {
        connect()
      }
    }, 100)

    return () => {
      mountedRef.current = false
      clearTimeout(timer)
      disconnect()
    }
  }, [connect, disconnect])

  return { isConnected, send, disconnect, ws: wsRef.current }
}
