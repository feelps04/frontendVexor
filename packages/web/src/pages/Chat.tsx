import { useEffect, useMemo, useRef, useState } from 'react'
import { apiGet, apiPost } from '../lib/api'
import { getAuth } from '../lib/auth'

type Room = {
  id: string
  type: 'dm' | 'room'
  name: string | null
  created_at: string
}

type Message = {
  id: string
  room_id: string
  sender_user_id: string
  content: string
  created_at: string
}

export default function ChatPage() {
  const [rooms, setRooms] = useState<Room[]>([])
  const [roomsLoading, setRoomsLoading] = useState(false)
  const [roomsError, setRoomsError] = useState<string | null>(null)

  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null)

  const [dmEmail, setDmEmail] = useState('')
  const [dmLoading, setDmLoading] = useState(false)

  const [messages, setMessages] = useState<Message[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [messagesError, setMessagesError] = useState<string | null>(null)

  const wsRef = useRef<WebSocket | null>(null)

  const [draft, setDraft] = useState('')
  const [sendLoading, setSendLoading] = useState(false)

  async function loadRooms() {
    setRoomsLoading(true)
    setRoomsError(null)
    try {
      const data = await apiGet<{ rooms: Room[] }>('/api/v1/chat/rooms')
      setRooms(data.rooms)
      if (!selectedRoomId && data.rooms.length) {
        setSelectedRoomId(data.rooms[0]!.id)
      }
    } catch (e: any) {
      setRoomsError(e?.message || 'Erro ao carregar salas')
    } finally {
      setRoomsLoading(false)
    }
  }

  async function loadMessages(roomId: string) {
    setMessagesLoading(true)
    setMessagesError(null)
    try {
      const data = await apiGet<{ roomId: string; messages: Message[] }>(
        `/api/v1/chat/rooms/${roomId}/messages`
      )
      setMessages(data.messages)
    } catch (e: any) {
      setMessagesError(e?.message || 'Erro ao carregar mensagens')
      setMessages([])
    } finally {
      setMessagesLoading(false)
    }
  }

  useEffect(() => {
    loadRooms()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!selectedRoomId) return
    loadMessages(selectedRoomId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoomId])

  useEffect(() => {
    const roomId = selectedRoomId
    if (!roomId) return

    const auth = getAuth()
    const token = auth?.accessToken
    if (!token) return

    try {
      wsRef.current?.close()
    } catch {
      // ignore
    }
    wsRef.current = null

    const host = window.location.hostname
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const wsUrl = `${proto}://${host}:3000/ws/chat?roomId=${encodeURIComponent(roomId)}&token=${encodeURIComponent(token)}`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onmessage = (ev) => {
      let msg: any
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }

      if (msg?.type === 'error') {
        setMessagesError(String(msg?.message ?? 'Erro no websocket'))
        return
      }

      if (msg?.type === 'message' && msg?.roomId === roomId && msg?.message) {
        const incoming = msg.message as Message
        setMessages((prev) => {
          if (prev.some((m) => m.id === incoming.id)) return prev
          return [...prev, incoming]
        })
      }
    }

    ws.onerror = () => {
      setMessagesError('WebSocket: falha na conexão')
    }

    return () => {
      try {
        ws.close()
      } catch {
        // ignore
      }
      if (wsRef.current === ws) wsRef.current = null
    }
  }, [selectedRoomId])

  const selectedRoom = useMemo(() => {
    if (!selectedRoomId) return null
    return rooms.find((r) => r.id === selectedRoomId) ?? null
  }, [rooms, selectedRoomId])

  async function startDm() {
    const email = dmEmail.trim().toLowerCase()
    if (!email) return

    setDmLoading(true)
    try {
      const data = await apiPost<{ roomId: string }>('/api/v1/chat/dm', { email })
      await loadRooms()
      setSelectedRoomId(data.roomId)
      setDmEmail('')
    } catch (e: any) {
      setRoomsError(e?.message || 'Erro ao criar DM')
    } finally {
      setDmLoading(false)
    }
  }

  async function sendMessage() {
    if (!selectedRoomId) return
    const content = draft.trim()
    if (!content) return

    setSendLoading(true)
    try {
      await apiPost(`/api/v1/chat/rooms/${selectedRoomId}/messages`, { content })
      setDraft('')
    } catch (e: any) {
      setMessagesError(e?.message || 'Erro ao enviar')
    } finally {
      setSendLoading(false)
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16, minHeight: '70vh' }}>
      <aside
        style={{
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 12,
          padding: 12,
          display: 'grid',
          gridTemplateRows: 'auto auto 1fr',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1 style={{ margin: 0, fontSize: 18 }}>Chat</h1>
          <button onClick={loadRooms} disabled={roomsLoading}>
            Atualizar
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={dmEmail}
            onChange={(e) => setDmEmail(e.target.value)}
            placeholder="Iniciar DM: email"
            style={{ flex: 1 }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') startDm()
            }}
          />
          <button onClick={startDm} disabled={dmLoading || !dmEmail.trim()}>
            DM
          </button>
        </div>

        <div style={{ display: 'grid', gap: 8, alignContent: 'start', overflow: 'auto' }}>
          {roomsError ? <div style={{ color: '#ff8a8a' }}>{roomsError}</div> : null}
          {roomsLoading ? <div style={{ opacity: 0.75 }}>Carregando...</div> : null}
          {!roomsLoading && rooms.length === 0 ? (
            <div style={{ opacity: 0.75 }}>Sem conversas ainda. Crie um DM acima.</div>
          ) : null}

          {rooms.map((r) => {
            const active = r.id === selectedRoomId
            const label = r.type === 'dm' ? 'DM' : r.name || 'Sala'
            return (
              <button
                key={r.id}
                onClick={() => setSelectedRoomId(r.id)}
                style={{
                  textAlign: 'left',
                  padding: '10px 10px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.12)',
                  background: active ? 'rgba(255,255,255,0.08)' : 'transparent',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                  <strong style={{ fontSize: 13 }}>{label}</strong>
                  <span style={{ opacity: 0.6, fontSize: 11 }}>{new Date(r.created_at).toLocaleDateString()}</span>
                </div>
                <div style={{ opacity: 0.7, fontSize: 12 }}>#{r.id.slice(0, 8)}</div>
              </button>
            )
          })}
        </div>
      </aside>

      <section
        style={{
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 12,
          padding: 12,
          display: 'grid',
          gridTemplateRows: 'auto 1fr auto',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'grid', gap: 2 }}>
            <strong style={{ fontSize: 14 }}>{selectedRoom ? (selectedRoom.type === 'dm' ? 'DM' : selectedRoom.name || 'Sala') : 'Selecione uma conversa'}</strong>
            {selectedRoom ? <span style={{ opacity: 0.7, fontSize: 12 }}>{selectedRoom.id}</span> : null}
          </div>
          <button onClick={() => selectedRoomId && loadMessages(selectedRoomId)} disabled={!selectedRoomId || messagesLoading}>
            Recarregar
          </button>
        </div>

        <div
          style={{
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 12,
            padding: 12,
            overflow: 'auto',
            display: 'grid',
            alignContent: 'start',
            gap: 8,
            background: 'rgba(0,0,0,0.15)',
          }}
        >
          {messagesError ? <div style={{ color: '#ff8a8a' }}>{messagesError}</div> : null}
          {messagesLoading ? <div style={{ opacity: 0.75 }}>Carregando...</div> : null}
          {!messagesLoading && selectedRoomId && messages.length === 0 ? (
            <div style={{ opacity: 0.75 }}>Nenhuma mensagem ainda.</div>
          ) : null}

          {messages.map((m) => (
            <div key={m.id} style={{ padding: '8px 10px', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ opacity: 0.7, fontSize: 12 }}>{m.sender_user_id.slice(0, 8)}</span>
                <span style={{ opacity: 0.6, fontSize: 12 }}>{new Date(m.created_at).toLocaleString()}</span>
              </div>
              <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{m.content}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={selectedRoomId ? 'Digite uma mensagem...' : 'Selecione uma conversa'}
            style={{ flex: 1 }}
            disabled={!selectedRoomId || sendLoading}
            onKeyDown={(e) => {
              if (e.key === 'Enter') sendMessage()
            }}
          />
          <button onClick={sendMessage} disabled={!selectedRoomId || sendLoading || !draft.trim()}>
            Enviar
          </button>
        </div>
      </section>
    </div>
  )
}
