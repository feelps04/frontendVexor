import { useState, useEffect } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  tiltLevel?: number;
  biases?: string[];
}

interface PsychState {
  tiltLevel: number;
  consecutiveLosses: number;
  dailyPnL: number;
  blocked: boolean;
  blockReason?: string;
}

const TILT_KEYWORDS = {
  L1: ['irritado', 'frustrado', 'impaciente'],
  L2: ['recuperar', 'vingança', 'burro', 'idiota'],
  L3: ['sempre', 'nunca', 'merda', 'droga', 'odeio'],
  L4: ['canalha', 'manipulação', 'armadilha', 'injusto', 'impossível']
};

export default function PsychAgentChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<PsychState>({
    tiltLevel: 0,
    consecutiveLosses: 0,
    dailyPnL: 0,
    blocked: false
  });
  const [detectedKeywords, setDetectedKeywords] = useState<string[]>([]);

  const API = 'http://localhost:3000/api/v1';

  useEffect(() => {
    loadState();
  }, []);

  const loadState = async () => {
    try {
      const res = await fetch(`${API}/psych/state`);
      const data = await res.json();
      setState(data);
    } catch (e) {
      console.error('Erro ao carregar estado:', e);
    }
  };

  // Fast keyword check em tempo real
  const checkKeywords = (text: string): { level: number; keywords: string[] } => {
    const lowerText = text.toLowerCase();
    const foundKeywords: string[] = [];
    let maxLevel = 0;

    Object.entries(TILT_KEYWORDS).forEach(([level, keywords]) => {
      keywords.forEach(keyword => {
        if (lowerText.includes(keyword)) {
          foundKeywords.push(keyword);
          const levelNum = parseInt(level.replace('L', ''));
          if (levelNum > maxLevel) maxLevel = levelNum;
        }
      });
    });

    return { level: maxLevel, keywords: foundKeywords };
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setInput(text);
    
    // Real-time keyword detection
    const { keywords } = checkKeywords(text);
    setDetectedKeywords(keywords);
  };

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage: Message = {
      role: 'user',
      content: input,
      timestamp: new Date()
    };

    const { level, keywords } = checkKeywords(input);
    userMessage.tiltLevel = level;
    userMessage.biases = keywords;

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setDetectedKeywords([]);
    setLoading(true);

    try {
      // Chamar Psych Agent
      const res = await fetch(`${API}/psych/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: input })
      });
      const data = await res.json();

      const assistantMessage: Message = {
        role: 'assistant',
        content: data.slowResult?.response || 'Psych Agent processando...',
        timestamp: new Date()
      };

      setMessages(prev => [...prev, assistantMessage]);
      
      // Atualizar estado
      loadState();
    } catch (e) {
      console.error('Erro ao enviar mensagem:', e);
      const errorMessage: Message = {
        role: 'assistant',
        content: 'Erro ao conectar com Psych Agent. Verifique se a API está rodando.',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    }

    setLoading(false);
  };

  const getTiltColor = (level: number) => {
    if (level === 0) return 'text-green-400';
    if (level === 1) return 'text-yellow-400';
    if (level === 2) return 'text-orange-400';
    if (level === 3) return 'text-red-400';
    return 'text-red-600';
  };

  const getTiltBg = (level: number) => {
    if (level === 0) return 'bg-green-900/30 border-green-700';
    if (level === 1) return 'bg-yellow-900/30 border-yellow-700';
    if (level === 2) return 'bg-orange-900/30 border-orange-700';
    if (level === 3) return 'bg-red-900/30 border-red-700';
    return 'bg-red-900/50 border-red-600';
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 p-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-3xl">🧠</span>
            <div>
              <h1 className="text-xl font-bold">Psych Agent</h1>
              <p className="text-gray-400 text-sm">Coach de Trading baseado na Doutrina Vexor</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {/* State Indicators */}
            <div className="flex gap-2">
              <div className={`px-3 py-1 rounded-lg border ${getTiltBg(state.tiltLevel)}`}>
                <span className="text-xs text-gray-400">Tilt</span>
                <span className={`ml-1 font-bold ${getTiltColor(state.tiltLevel)}`}>
                  N{state.tiltLevel}
                </span>
              </div>
              <div className="px-3 py-1 rounded-lg bg-gray-700 border border-gray-600">
                <span className="text-xs text-gray-400">Losses</span>
                <span className={`ml-1 font-bold ${state.consecutiveLosses >= 3 ? 'text-red-400' : 'text-white'}`}>
                  {state.consecutiveLosses}
                </span>
              </div>
              <div className={`px-3 py-1 rounded-lg border ${state.dailyPnL >= 0 ? 'bg-green-900/30 border-green-700' : 'bg-red-900/30 border-red-700'}`}>
                <span className="text-xs text-gray-400">PnL</span>
                <span className={`ml-1 font-bold ${state.dailyPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  R$ {state.dailyPnL.toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Blocked Banner */}
      {state.blocked && (
        <div className="bg-red-900 border-b border-red-700 p-3">
          <div className="max-w-4xl mx-auto flex items-center gap-2">
            <span className="text-xl">🚫</span>
            <span className="font-bold">BLOQUEADO:</span>
            <span>{state.blockReason}</span>
          </div>
        </div>
      )}

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-4xl mx-auto space-y-4">
          {messages.length === 0 && (
            <div className="text-center text-gray-400 py-12">
              <div className="text-6xl mb-4">🧠</div>
              <div className="text-xl font-bold mb-2">Psych Agent</div>
              <div className="text-sm">
                Digite como você está se sentindo ou pergunte sobre psicologia de trading.
                <br />
                O sistema detecta tilt em tempo real e responde com base na Doutrina Vexor.
              </div>
              <div className="mt-6 grid grid-cols-2 gap-2 max-w-md mx-auto">
                <div className="bg-gray-800 rounded-lg p-3 text-sm">
                  "Perdi 3 trades seguidos"
                </div>
                <div className="bg-gray-800 rounded-lg p-3 text-sm">
                  "Preciso recuperar agora"
                </div>
                <div className="bg-gray-800 rounded-lg p-3 text-sm">
                  "O mercado está manipulado"
                </div>
                <div className="bg-gray-800 rounded-lg p-3 text-sm">
                  "Como controlar o tilt?"
                </div>
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-xl p-4 ${
                msg.role === 'user' 
                  ? 'bg-blue-600' 
                  : 'bg-gray-800 border border-gray-700'
              }`}>
                {/* Tilt Detection for User Messages */}
                {msg.role === 'user' && msg.tiltLevel && msg.tiltLevel > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1">
                    {msg.biases?.map((bias, j) => (
                      <span key={j} className="bg-red-600 text-xs px-2 py-0.5 rounded-full">
                        {bias}
                      </span>
                    ))}
                    <span className={`text-xs px-2 py-0.5 rounded-full ${getTiltBg(msg.tiltLevel)}`}>
                      Tilt N{msg.tiltLevel}
                    </span>
                  </div>
                )}
                
                <div className="whitespace-pre-wrap">{msg.content}</div>
                
                <div className="text-xs text-gray-400 mt-2">
                  {msg.timestamp.toLocaleTimeString()}
                </div>
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
                <div className="flex items-center gap-2">
                  <div className="animate-spin w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full"></div>
                  <span>Psych Agent analisando...</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input Area */}
      <div className="bg-gray-800 border-t border-gray-700 p-4">
        <div className="max-w-4xl mx-auto">
          {/* Detected Keywords */}
          {detectedKeywords.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1">
              <span className="text-xs text-gray-400">Keywords detectadas:</span>
              {detectedKeywords.map((kw, i) => (
                <span key={i} className="bg-red-600 text-xs px-2 py-0.5 rounded-full">
                  {kw}
                </span>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={handleInputChange}
              onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="Como você está se sentindo?"
              className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={sendMessage}
              disabled={loading || !input.trim()}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 rounded-lg font-bold transition"
            >
              {loading ? '⏳' : 'Enviar'}
            </button>
          </div>

          {/* Quick Actions */}
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => setInput('Perdi 3 trades seguidos, preciso recuperar')}
              className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm"
            >
              📉 Perdas consecutivas
            </button>
            <button
              onClick={() => setInput('Estou tiltado, como controlar?')}
              className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm"
            >
              🔥 Tilt
            </button>
            <button
              onClick={() => setInput('Me dê um briefing do mercado')}
              className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm"
            >
              📊 Briefing
            </button>
            <button
              onClick={loadState}
              className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm"
            >
              🔄 Atualizar Estado
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
