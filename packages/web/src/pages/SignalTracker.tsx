import { useState, useEffect } from 'react';

interface Signal {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  entry: number;
  stop: number;
  target: number;
  quantity: number;
  strategy: string;
  confidence: number;
  status: 'PENDING' | 'ACTIVE' | 'WIN' | 'LOSS' | 'BREAKEVEN';
  exitPrice?: number;
  pnl?: number;
  pnlPercent?: number;
  outcome?: 0 | 1;
  durationMs?: number;
  exitReason?: string;
  timestamp: string;
}

interface Stats {
  active: number;
  todayWins: number;
  todayLosses: number;
  todayPnL: number;
  winRate: number;
}

export default function SignalTracker() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [stats, setStats] = useState<Stats>({
    active: 0,
    todayWins: 0,
    todayLosses: 0,
    todayPnL: 0,
    winRate: 0
  });
  const [form, setForm] = useState({
    symbol: 'PETR4',
    side: 'BUY' as 'BUY' | 'SELL',
    entry: 0,
    stop: 0,
    target: 0,
    quantity: 100,
    strategy: 'TREND_FOLLOW',
    confidence: 0.75
  });
  const [loading, setLoading] = useState(false);

  const API = 'http://localhost:3000/api/v1/tracker';

  // Carregar dados
  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, []);

  const refresh = async () => {
    try {
      const [activeRes, statsRes] = await Promise.all([
        fetch(`${API}/active`),
        fetch(`${API}/stats`)
      ]);
      const activeData = await activeRes.json();
      const statsData = await statsRes.json();
      setSignals(activeData.signals || []);
      setStats(statsData);
    } catch (e) {
      console.error('Erro ao carregar dados:', e);
    }
  };

  // Registrar sinal
  const registerSignal = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const data = await res.json();
      if (data.success) {
        refresh();
        setForm({ ...form, entry: 0, stop: 0, target: 0 });
      }
    } catch (e) {
      console.error('Erro ao registrar:', e);
    }
    setLoading(false);
  };

  // Fechar sinal
  const closeSignal = async (id: string, exitPrice: number, reason: string) => {
    try {
      await fetch(`${API}/${id}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exitPrice, reason })
      });
      refresh();
    } catch (e) {
      console.error('Erro ao fechar:', e);
    }
  };

  // Atualizar preço
  const updatePrice = async (symbol: string, price: number) => {
    try {
      await fetch(`${API}/price`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, price })
      });
      refresh();
    } catch (e) {
      console.error('Erro ao atualizar preço:', e);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">🎯 Signal Tracker</h1>
            <p className="text-gray-400 mt-1">Monitoramento WIN/LOSS + Aprendizado Contínuo</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={refresh}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition"
            >
              🔄 Atualizar
            </button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
            <div className="text-gray-400 text-sm">Sinais Ativos</div>
            <div className="text-2xl font-bold text-blue-400">{stats.active}</div>
          </div>
          <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
            <div className="text-gray-400 text-sm">Wins Hoje</div>
            <div className="text-2xl font-bold text-green-400">{stats.todayWins} 🟢</div>
          </div>
          <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
            <div className="text-gray-400 text-sm">Losses Hoje</div>
            <div className="text-2xl font-bold text-red-400">{stats.todayLosses} 🔴</div>
          </div>
          <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
            <div className="text-gray-400 text-sm">PnL Hoje</div>
            <div className={`text-2xl font-bold ${stats.todayPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              R$ {stats.todayPnL.toFixed(2)}
            </div>
          </div>
          <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
            <div className="text-gray-400 text-sm">Win Rate</div>
            <div className={`text-2xl font-bold ${stats.winRate >= 0.55 ? 'text-green-400' : 'text-yellow-400'}`}>
              {(stats.winRate * 100).toFixed(1)}%
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Register Form */}
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h2 className="text-xl font-bold mb-4">📝 Registrar Novo Sinal</h2>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-gray-400 text-sm mb-1">Ativo</label>
                <input
                  type="text"
                  value={form.symbol}
                  onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white"
                  placeholder="PETR4"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-1">Lado</label>
                <select
                  value={form.side}
                  onChange={(e) => setForm({ ...form, side: e.target.value as 'BUY' | 'SELL' })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white"
                >
                  <option value="BUY">🟢 COMPRA</option>
                  <option value="SELL">🔴 VENDA</option>
                </select>
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-1">Entrada</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.entry || ''}
                  onChange={(e) => setForm({ ...form, entry: parseFloat(e.target.value) })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white"
                  placeholder="30.50"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-1">Stop</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.stop || ''}
                  onChange={(e) => setForm({ ...form, stop: parseFloat(e.target.value) })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white"
                  placeholder="29.50"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-1">Target</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.target || ''}
                  onChange={(e) => setForm({ ...form, target: parseFloat(e.target.value) })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white"
                  placeholder="32.50"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-1">Quantidade</label>
                <input
                  type="number"
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: parseInt(e.target.value) })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white"
                  placeholder="100"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-1">Estratégia</label>
                <select
                  value={form.strategy}
                  onChange={(e) => setForm({ ...form, strategy: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white"
                >
                  <option value="TREND_FOLLOW">Trend Follow</option>
                  <option value="MEAN_REVERSION">Mean Reversion</option>
                  <option value="BREAKOUT">Breakout</option>
                  <option value="SCALPING">Scalping</option>
                  <option value="SWING">Swing Trade</option>
                </select>
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-1">Confiança</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={form.confidence}
                  onChange={(e) => setForm({ ...form, confidence: parseFloat(e.target.value) })}
                  className="w-full mt-2"
                />
                <div className="text-center text-sm">{(form.confidence * 100).toFixed(0)}%</div>
              </div>
            </div>

            <button
              onClick={registerSignal}
              disabled={loading || !form.entry || !form.stop || !form.target}
              className="w-full mt-4 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 rounded-lg font-bold transition"
            >
              {loading ? '⏳ Registrando...' : '✅ Registrar Sinal'}
            </button>
          </div>

          {/* Active Signals */}
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h2 className="text-xl font-bold mb-4">📊 Sinais Ativos</h2>
            
            {signals.length === 0 ? (
              <div className="text-center text-gray-400 py-8">
                Nenhum sinal ativo no momento
              </div>
            ) : (
              <div className="space-y-4">
                {signals.map((signal) => (
                  <div key={signal.id} className="bg-gray-700 rounded-lg p-4 border border-gray-600">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-2xl ${signal.side === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                          {signal.side === 'BUY' ? '🟢' : '🔴'}
                        </span>
                        <div>
                          <div className="font-bold">{signal.symbol}</div>
                          <div className="text-sm text-gray-400">{signal.strategy}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold">{signal.entry.toFixed(2)}</div>
                        <div className="text-sm text-gray-400">Entrada</div>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-3 gap-2 text-sm mb-3">
                      <div className="bg-gray-600 rounded p-2 text-center">
                        <div className="text-red-400">Stop</div>
                        <div className="font-bold">{signal.stop.toFixed(2)}</div>
                      </div>
                      <div className="bg-gray-600 rounded p-2 text-center">
                        <div className="text-green-400">Target</div>
                        <div className="font-bold">{signal.target.toFixed(2)}</div>
                      </div>
                      <div className="bg-gray-600 rounded p-2 text-center">
                        <div className="text-blue-400">Qtd</div>
                        <div className="font-bold">{signal.quantity}</div>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => closeSignal(signal.id, signal.target, 'TARGET_HIT')}
                        className="flex-1 py-2 bg-green-600 hover:bg-green-700 rounded text-sm font-bold"
                      >
                        🎯 WIN
                      </button>
                      <button
                        onClick={() => closeSignal(signal.id, signal.stop, 'STOP_LOSS')}
                        className="flex-1 py-2 bg-red-600 hover:bg-red-700 rounded text-sm font-bold"
                      >
                        🛑 LOSS
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Learning Info */}
        <div className="mt-6 bg-gradient-to-r from-purple-900/50 to-blue-900/50 rounded-xl p-6 border border-purple-700">
          <h3 className="text-lg font-bold mb-2">🧠 Aprendizado Contínuo</h3>
          <p className="text-gray-300 text-sm">
            Cada operação é salva com <span className="text-green-400 font-bold">outcome = 1 (WIN)</span> ou{' '}
            <span className="text-red-400 font-bold">outcome = 0 (LOSS)</span>. Os dados são usados pelo RAG Pipeline
            para melhorar decisões futuras baseados nos 27 livros da Doutrina Vexor.
          </p>
          <div className="mt-3 flex gap-4 text-sm">
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 bg-green-400 rounded-full"></span>
              <span>WIN → Reforça estratégia</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 bg-red-400 rounded-full"></span>
              <span>LOSS → Ajusta abordagem</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
