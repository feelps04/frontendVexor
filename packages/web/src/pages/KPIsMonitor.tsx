import { useState, useEffect } from 'react';

interface KPI {
  name: string;
  value: number;
  target: number;
  unit: string;
  status: 'good' | 'warning' | 'critical';
  action?: string;
}

interface Stats {
  active: number;
  todayWins: number;
  todayLosses: number;
  todayPnL: number;
  winRate: number;
}

export default function KPIsMonitor() {
  const [stats, setStats] = useState<Stats>({
    active: 0,
    todayWins: 0,
    todayLosses: 0,
    todayPnL: 0,
    winRate: 0
  });
  const [trades, setTrades] = useState(0);
  const [tiltLevel, setTiltLevel] = useState(0);
  const [alerts, setAlerts] = useState<string[]>([]);

  const API = 'http://localhost:3000/api/v1';

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, []);

  const refresh = async () => {
    try {
      const [trackerRes, psychRes] = await Promise.all([
        fetch(`${API}/tracker/stats`),
        fetch(`${API}/psych/state`)
      ]);
      
      const trackerData = await trackerRes.json();
      const psychData = await psychRes.json();
      
      setStats(trackerData);
      setTiltLevel(psychData.tiltLevel || 0);
      setTrades(trackerData.todayWins + trackerData.todayLosses);
      
      // Gerar alertas automáticos
      const newAlerts: string[] = [];
      if (trackerData.winRate < 0.45) {
        newAlerts.push('⚠️ Win Rate < 45% → REDUCE_SIZE');
      }
      if (trackerData.todayLosses >= 3) {
        newAlerts.push('🚨 3+ Losses seguidos → PAUSE');
      }
      if (psychData.tiltLevel >= 3) {
        newAlerts.push('🔥 Tilt Nível 3+ → BLOCK_15MIN');
      }
      if (trackerData.todayPnL < -0.06 * 10000) { // Assume 10k capital
        newAlerts.push('🛑 Daily Loss > 6% → CIRCUIT_BREAKER');
      }
      if (trades >= 10) {
        newAlerts.push('⛔ Overtrading → STOP_TRADING');
      }
      setAlerts(newAlerts);
    } catch (e) {
      console.error('Erro ao carregar KPIs:', e);
    }
  };

  // Calcular KPIs
  const kpis: KPI[] = [
    {
      name: 'Win Rate',
      value: stats.winRate * 100,
      target: 55,
      unit: '%',
      status: stats.winRate >= 0.55 ? 'good' : stats.winRate >= 0.45 ? 'warning' : 'critical',
      action: stats.winRate < 0.45 ? 'REDUCE_SIZE' : undefined
    },
    {
      name: 'Profit Factor',
      value: stats.todayWins > 0 && stats.todayLosses > 0 
        ? Math.abs(stats.todayPnL / (stats.todayLosses * 10)) 
        : stats.todayPnL > 0 ? 2 : 0,
      target: 1.5,
      unit: 'x',
      status: stats.todayPnL > 0 ? 'good' : 'warning',
    },
    {
      name: 'Drawdown',
      value: stats.todayPnL < 0 ? Math.abs(stats.todayPnL) / 10000 * 100 : 0,
      target: 20,
      unit: '%',
      status: stats.todayPnL < -0.2 * 10000 ? 'critical' : stats.todayPnL < -0.1 * 10000 ? 'warning' : 'good',
      action: stats.todayPnL < -0.2 * 10000 ? 'PAUSE_TRADING' : undefined
    },
    {
      name: 'Sharpe Ratio',
      value: stats.winRate > 0 ? (stats.winRate - 0.5) * 2 : 0,
      target: 1.0,
      unit: '',
      status: stats.winRate >= 0.55 ? 'good' : 'warning',
    },
    {
      name: 'Trades/Dia',
      value: trades,
      target: 10,
      unit: '',
      status: trades <= 10 ? 'good' : 'critical',
      action: trades > 10 ? 'STOP_TRADING' : undefined
    },
    {
      name: 'Tilt Level',
      value: tiltLevel,
      target: 2,
      unit: '',
      status: tiltLevel <= 2 ? 'good' : tiltLevel === 3 ? 'warning' : 'critical',
      action: tiltLevel >= 3 ? 'BLOCK_15MIN' : undefined
    }
  ];

  const getStatusColor = (status: KPI['status']) => {
    switch (status) {
      case 'good': return 'bg-green-500';
      case 'warning': return 'bg-yellow-500';
      case 'critical': return 'bg-red-500';
    }
  };

  const getStatusBg = (status: KPI['status']) => {
    switch (status) {
      case 'good': return 'bg-green-900/30 border-green-700';
      case 'warning': return 'bg-yellow-900/30 border-yellow-700';
      case 'critical': return 'bg-red-900/30 border-red-700';
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">📈 KPIs Monitor</h1>
            <p className="text-gray-400 mt-1">Métricas em Tempo Real com Ações Automáticas</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-sm text-gray-400">Última atualização</div>
              <div className="text-lg">{new Date().toLocaleTimeString()}</div>
            </div>
            <button
              onClick={refresh}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition"
            >
              🔄
            </button>
          </div>
        </div>

        {/* Alerts */}
        {alerts.length > 0 && (
          <div className="mb-6 space-y-2">
            {alerts.map((alert, i) => (
              <div key={i} className="bg-red-900/50 border border-red-700 rounded-lg p-3 flex items-center gap-2">
                <span className="text-xl">⚠️</span>
                <span className="font-bold">{alert}</span>
              </div>
            ))}
          </div>
        )}

        {/* KPIs Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
          {kpis.map((kpi, i) => (
            <div key={i} className={`rounded-xl p-4 border ${getStatusBg(kpi.status)}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-400 text-sm">{kpi.name}</span>
                <span className={`w-3 h-3 rounded-full ${getStatusColor(kpi.status)}`}></span>
              </div>
              
              <div className="text-3xl font-bold mb-1">
                {kpi.value.toFixed(kpi.unit === '%' ? 1 : kpi.unit === 'x' ? 2 : 0)}
                <span className="text-lg text-gray-400 ml-1">{kpi.unit}</span>
              </div>
              
              <div className="text-sm text-gray-400">
                Target: {kpi.target}{kpi.unit}
              </div>

              {/* Progress Bar */}
              <div className="mt-3 h-2 bg-gray-700 rounded-full overflow-hidden">
                <div 
                  className={`h-full ${getStatusColor(kpi.status)} transition-all`}
                  style={{ 
                    width: `${Math.min(100, (kpi.value / kpi.target) * 100)}%` 
                  }}
                ></div>
              </div>

              {/* Action */}
              {kpi.action && (
                <div className="mt-2 text-xs bg-red-600 rounded px-2 py-1 text-center font-bold">
                  {kpi.action}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Gauges */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {/* Win Rate Gauge */}
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h3 className="text-lg font-bold mb-4">Win Rate Gauge</h3>
            <div className="relative w-48 h-48 mx-auto">
              <svg viewBox="0 0 100 100" className="w-full h-full">
                {/* Background arc */}
                <circle
                  cx="50"
                  cy="50"
                  r="40"
                  fill="none"
                  stroke="#374151"
                  strokeWidth="8"
                  strokeDasharray="188.5 251.3"
                  strokeLinecap="round"
                  transform="rotate(-90 50 50)"
                />
                {/* Value arc */}
                <circle
                  cx="50"
                  cy="50"
                  r="40"
                  fill="none"
                  stroke={stats.winRate >= 0.55 ? '#22c55e' : stats.winRate >= 0.45 ? '#eab308' : '#ef4444'}
                  strokeWidth="8"
                  strokeDasharray={`${188.5 * stats.winRate} 251.3`}
                  strokeLinecap="round"
                  transform="rotate(-90 50 50)"
                  className="transition-all duration-500"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <div className="text-4xl font-bold">{(stats.winRate * 100).toFixed(1)}%</div>
                  <div className="text-gray-400 text-sm">Win Rate</div>
                </div>
              </div>
            </div>
            <div className="flex justify-center gap-4 mt-4 text-sm">
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                <span>&lt;45%</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 bg-yellow-500 rounded-full"></span>
                <span>45-55%</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                <span>&gt;55%</span>
              </div>
            </div>
          </div>

          {/* Tilt Level Gauge */}
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
            <h3 className="text-lg font-bold mb-4">Tilt Level Gauge</h3>
            <div className="flex justify-center items-end gap-2 h-40">
              {[1, 2, 3, 4].map((level) => (
                <div
                  key={level}
                  className={`w-12 rounded-t-lg transition-all ${
                    tiltLevel >= level
                      ? level === 4 ? 'bg-red-500' : level === 3 ? 'bg-orange-500' : level === 2 ? 'bg-yellow-500' : 'bg-green-500'
                      : 'bg-gray-700'
                  }`}
                  style={{ height: `${level * 25}%` }}
                >
                  <div className="text-center text-xs mt-2 font-bold">L{level}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 text-center">
              <div className="text-2xl font-bold">Nível {tiltLevel}</div>
              <div className="text-gray-400 text-sm">
                {tiltLevel === 0 && 'Normal'}
                {tiltLevel === 1 && 'Leve irritação → Monitorar'}
                {tiltLevel === 2 && 'Frustração → Reduzir posição'}
                {tiltLevel === 3 && 'Raiva → Pausar 15 min'}
                {tiltLevel === 4 && 'TILT TOTAL → PARAR DIA'}
              </div>
            </div>
          </div>
        </div>

        {/* Today's Performance */}
        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
          <h3 className="text-lg font-bold mb-4">📊 Performance Hoje</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-4xl font-bold text-green-400">{stats.todayWins}</div>
              <div className="text-gray-400">Wins</div>
            </div>
            <div className="text-center">
              <div className="text-4xl font-bold text-red-400">{stats.todayLosses}</div>
              <div className="text-gray-400">Losses</div>
            </div>
            <div className="text-center">
              <div className={`text-4xl font-bold ${stats.todayPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                R$ {stats.todayPnL.toFixed(2)}
              </div>
              <div className="text-gray-400">PnL</div>
            </div>
            <div className="text-center">
              <div className="text-4xl font-bold text-blue-400">{stats.active}</div>
              <div className="text-gray-400">Ativos</div>
            </div>
          </div>
        </div>

        {/* Auto Actions Legend */}
        <div className="mt-6 bg-gradient-to-r from-blue-900/50 to-purple-900/50 rounded-xl p-6 border border-blue-700">
          <h3 className="text-lg font-bold mb-3">⚡ Ações Automáticas</h3>
          <div className="grid md:grid-cols-2 gap-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="bg-yellow-600 px-2 py-1 rounded text-xs font-bold">REDUCE_SIZE</span>
              <span className="text-gray-300">Win Rate &lt; 45%</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="bg-orange-600 px-2 py-1 rounded text-xs font-bold">PAUSE</span>
              <span className="text-gray-300">3+ Losses seguidos</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="bg-red-600 px-2 py-1 rounded text-xs font-bold">BLOCK_15MIN</span>
              <span className="text-gray-300">Tilt Nível 3+</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="bg-red-700 px-2 py-1 rounded text-xs font-bold">CIRCUIT_BREAKER</span>
              <span className="text-gray-300">Daily Loss &gt; 6%</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="bg-red-800 px-2 py-1 rounded text-xs font-bold">STOP_TRADING</span>
              <span className="text-gray-300">Overtrading (&gt;10 trades)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="bg-purple-600 px-2 py-1 rounded text-xs font-bold">PAUSE_TRADING</span>
              <span className="text-gray-300">Drawdown &gt; 20%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
