import { useState, useEffect, useRef } from 'react';

const OPENCLAW_WS = 'ws://127.0.0.1:18789';
const API_URL = '/api/v1';

interface Agent {
  id: string;
  name: string;
  status: string;
}

export default function OpenClawPanel() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tasks, setTasks] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('vexor_token');
    const storedEmail = localStorage.getItem('vexor_email');
    if (token && storedEmail === 'felipecrs04@gmail.com') {
      setIsAuthenticated(true);
    }
  }, []);

  const handleLogin = async () => {
    setError('');
    setLoading(true);
    
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      
      const data = await res.json();
      
      if (data.success && data.token) {
        localStorage.setItem('vexor_token', data.token);
        localStorage.setItem('vexor_email', email);
        setIsAuthenticated(true);
      } else {
        setError(data.error || 'Login falhou');
      }
    } catch (e) {
      setError('Erro de conexão');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) return;

    const ws = new WebSocket(OPENCLAW_WS);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('connected');
      ws.send(JSON.stringify({ type: 'list_agents' }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'agents_list') {
          setAgents(data.agents || []);
        } else if (data.type === 'task_result') {
          setTasks(prev => [...prev, data.result]);
        } else if (data.type === 'error') {
          setTasks(prev => [...prev, `Erro: ${data.message}`]);
        }
      } catch {
        console.log('Raw message:', event.data);
      }
    };

    ws.onclose = () => setStatus('disconnected');
    ws.onerror = () => setStatus('disconnected');

    return () => ws.close();
  }, [isAuthenticated]);

  const sendTask = () => {
    if (!input.trim() || !wsRef.current) return;
    wsRef.current.send(JSON.stringify({ type: 'execute', task: input }));
    setTasks(prev => [...prev, `> ${input}`]);
    setInput('');
  };

  const handleLogout = () => {
    localStorage.removeItem('vexor_token');
    localStorage.removeItem('vexor_email');
    setIsAuthenticated(false);
    setEmail('');
    setPassword('');
  };

  if (!isAuthenticated) {
    return (
      <div style={{ 
        minHeight: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        background: '#0a0a0a',
        color: '#fff'
      }}>
        <div style={{ 
          padding: 40, 
          background: '#1a1a1a', 
          borderRadius: 12,
          width: 400,
          border: '1px solid #333'
        }}>
          <h2 style={{ marginBottom: 24, textAlign: 'center' }}>🔐 OpenClaw</h2>
          <p style={{ color: '#888', marginBottom: 24, textAlign: 'center', fontSize: 14 }}>
            Acesso restrito. Use suas credenciais do VEXOR.
          </p>
          
          {error && (
            <div style={{ 
              background: '#ff3333', 
              color: '#fff', 
              padding: 10, 
              borderRadius: 6,
              marginBottom: 16,
              fontSize: 14
            }}>
              {error}
            </div>
          )}
          
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="Email"
            style={{ 
              width: '100%', 
              padding: 12, 
              marginBottom: 12,
              background: '#0a0a0a',
              border: '1px solid #333',
              borderRadius: 6,
              color: '#fff',
              fontSize: 16
            }}
          />
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Senha"
            style={{ 
              width: '100%', 
              padding: 12, 
              marginBottom: 20,
              background: '#0a0a0a',
              border: '1px solid #333',
              borderRadius: 6,
              color: '#fff',
              fontSize: 16
            }}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
          />
          <button
            onClick={handleLogin}
            disabled={loading}
            style={{ 
              width: '100%', 
              padding: 14, 
              background: '#00FFFF',
              color: '#000',
              border: 'none',
              borderRadius: 6,
              fontSize: 16,
              fontWeight: 'bold',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1
            }}
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 20, fontFamily: 'monospace', background: '#0a0a0a', minHeight: '100vh', color: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2>🤖 OpenClaw Agents</h2>
        <button 
          onClick={handleLogout}
          style={{ 
            padding: '8px 16px', 
            background: '#333', 
            color: '#fff', 
            border: 'none', 
            borderRadius: 6,
            cursor: 'pointer'
          }}
        >
          Sair
        </button>
      </div>
      
      <div style={{ marginBottom: 10 }}>
        <strong>Status:</strong>{' '}
        <span style={{ color: status === 'connected' ? '#00FF00' : '#FF0000' }}>
          {status}
        </span>
      </div>

      <div style={{ marginBottom: 20 }}>
        <strong>Agents:</strong>
        {agents.length === 0 ? (
          <p style={{ color: '#888' }}>Nenhum agent disponível</p>
        ) : (
          <ul>
            {agents.map(agent => (
              <li key={agent.id} style={{ marginBottom: 4 }}>
                {agent.name} - {agent.status}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ marginBottom: 20 }}>
        <strong>Task Input:</strong>
        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendTask()}
            placeholder="Digite um comando..."
            style={{ 
              flex: 1, 
              padding: 10, 
              background: '#1a1a1a',
              border: '1px solid #333',
              borderRadius: 6,
              color: '#fff'
            }}
          />
          <button 
            onClick={sendTask} 
            disabled={status !== 'connected'}
            style={{ 
              padding: '10px 20px', 
              background: '#00FFFF', 
              color: '#000', 
              border: 'none', 
              borderRadius: 6,
              cursor: status !== 'connected' ? 'not-allowed' : 'pointer',
              opacity: status !== 'connected' ? 0.5 : 1
            }}
          >
            Executar
          </button>
        </div>
      </div>

      <div>
        <strong>Output:</strong>
        <pre style={{ 
          background: '#1a1a1a', 
          padding: 15, 
          maxHeight: 400, 
          overflow: 'auto',
          borderRadius: 6,
          border: '1px solid #333',
          marginTop: 8
        }}>
          {tasks.join('\n') || 'Aguardando output...'}
        </pre>
      </div>
    </div>
  );
}
