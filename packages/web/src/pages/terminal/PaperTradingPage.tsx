import { useEffect, useState } from 'react'
import { TrendingUp, TrendingDown, Lock, Unlock, Newspaper, Activity, DollarSign, Target, BarChart3 } from 'lucide-react'
import { LAMBDA_URL, NEWS_URL } from '../../lib/config'

interface Position {
  orderId: string
  symbol: string
  side: 'BUY' | 'SELL'
  entryPrice: number
  stopLoss: number
  takeProfit: number
  pnl: number
}

interface Status {
  balance: number
  openPositions: Position[]
  totalTrades: number
  winRate: number
  newsLock: boolean
  sentiment: { bias: string; win: string; wdo: string } | null
}

interface LogEntry {
  time: string
  type: 'info' | 'success' | 'error' | 'warn'
  message: string
}

export default function PaperTradingPage() {
  const [status, setStatus] = useState<Status | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)

  const addLog = (type: LogEntry['type'], message: string) => {
    const time = new Date().toTimeString().split(' ')[0]
    setLogs(prev => [{ time, type, message }, ...prev].slice(0, 50))
  }

  const fetchStatus = async () => {
    try {
      const response = await fetch(`${LAMBDA_URL}/status`)
      const data = await response.json()
      setStatus(data)
      setLoading(false)
    } catch (e) {
      addLog('error', 'Erro ao conectar com Paper Trading Lambda')
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 5000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (status) {
      addLog('success', `Status atualizado - Saldo: R$ ${status.balance.toFixed(2)}`)
    }
  }, [status?.balance])

  const formatCurrency = (value: number) => {
    return value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0d1117]">
        <div className="text-white text-xl">Carregando Paper Trading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0d1117] text-[#c9d1d9] p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6 border-b border-[#30363d] pb-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl font-bold text-[#a371f7]">VEXOR</span>
          <span className="text-xl">Paper Trading</span>
        </div>
        <div className="flex items-center gap-4">
          {status?.newsLock ? (
            <span className="flex items-center gap-2 px-3 py-1 rounded-full bg-[#d29922]/20 text-[#d29922] text-sm">
              <Lock size={14} /> LOCKED
            </span>
          ) : (
            <span className="flex items-center gap-2 px-3 py-1 rounded-full bg-[#3fb950]/20 text-[#3fb950] text-sm">
              <Unlock size={14} /> ONLINE
            </span>
          )}
          <button 
            onClick={fetchStatus}
            className="px-4 py-2 bg-[#21262d] border border-[#30363d] rounded-lg hover:bg-[#30363d] transition"
          >
            Atualizar
          </button>
        </div>
      </div>

      {/* News Lock Banner */}
      {status?.newsLock && (
        <div className="flex items-center gap-4 p-4 mb-6 bg-[#d29922]/10 border border-[#d29922] rounded-lg">
          <Lock size={24} className="text-[#d29922]" />
          <div className="flex-1">
            <div className="font-bold text-[#d29922]">NEWS LOCK ATIVO</div>
            <div className="text-sm text-[#8b949e]">Trading pausado por evento de alto impacto</div>
          </div>
        </div>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-3 gap-6">
        {/* Balance Card */}
        <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-6">
          <div className="flex justify-between items-center mb-4 border-b border-[#30363d] pb-3">
            <span className="text-sm text-[#8b949e] uppercase tracking-wider">Saldo</span>
            <DollarSign size={20} className="text-[#8b949e]" />
          </div>
          <div className={`text-4xl font-bold ${status?.balance && status.balance >= 100000 ? 'text-[#3fb950]' : 'text-[#f85149]'}`}>
            R$ {status?.balance ? formatCurrency(status.balance) : '0,00'}
          </div>
          <div className="grid grid-cols-2 gap-4 mt-6">
            <div className="bg-[#21262d] rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-[#3fb950]">{status?.winRate.toFixed(1)}%</div>
              <div className="text-xs text-[#8b949e] mt-1">Win Rate</div>
            </div>
            <div className="bg-[#21262d] rounded-lg p-4 text-center">
              <div className="text-2xl font-bold">{status?.totalTrades}</div>
              <div className="text-xs text-[#8b949e] mt-1">Trades</div>
            </div>
          </div>
        </div>

        {/* Open Positions */}
        <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-6">
          <div className="flex justify-between items-center mb-4 border-b border-[#30363d] pb-3">
            <span className="text-sm text-[#8b949e] uppercase tracking-wider">Posições Abertas</span>
            <span className="text-[#58a6ff]">{status?.openPositions.length || 0}</span>
          </div>
          <div className="max-h-[200px] overflow-y-auto space-y-3">
            {status?.openPositions && status.openPositions.length > 0 ? (
              status.openPositions.map((pos) => (
                <div key={pos.orderId} className="flex justify-between items-center bg-[#21262d] rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-1 rounded text-xs font-bold ${pos.side === 'BUY' ? 'bg-[#3fb950]/20 text-[#3fb950]' : 'bg-[#f85149]/20 text-[#f85149]'}`}>
                      {pos.side}
                    </span>
                    <span>{pos.symbol}</span>
                  </div>
                  <div className="text-right">
                    <div className="text-sm">@ {pos.entryPrice}</div>
                    <div className={`text-sm font-bold ${pos.pnl >= 0 ? 'text-[#3fb950]' : 'text-[#f85149]'}`}>
                      R$ {pos.pnl.toFixed(2)}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center text-[#8b949e] py-8">Nenhuma posição aberta</div>
            )}
          </div>
        </div>

        {/* Sentiment */}
        <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-6">
          <div className="flex justify-between items-center mb-4 border-b border-[#30363d] pb-3">
            <span className="text-sm text-[#8b949e] uppercase tracking-wider">Sentimento Atual</span>
            <Newspaper size={20} className="text-[#8b949e]" />
          </div>
          <div className="text-center py-4">
            <div className={`text-3xl font-bold ${
              status?.sentiment?.bias === 'BULLISH' ? 'text-[#3fb950]' :
              status?.sentiment?.bias === 'BEARISH' ? 'text-[#f85149]' : 'text-[#d29922]'
            }`}>
              {status?.sentiment?.bias || '--'}
            </div>
            <div className="flex justify-center gap-8 mt-6">
              <div>
                <div className="text-xs text-[#8b949e]">WIN</div>
                <div className={`font-bold ${
                  status?.sentiment?.win === 'UP' ? 'text-[#3fb950]' :
                  status?.sentiment?.win === 'DOWN' ? 'text-[#f85149]' : 'text-[#d29922]'
                }`}>
                  {status?.sentiment?.win || '--'}
                </div>
              </div>
              <div>
                <div className="text-xs text-[#8b949e]">WDO</div>
                <div className={`font-bold ${
                  status?.sentiment?.wdo === 'UP' ? 'text-[#3fb950]' :
                  status?.sentiment?.wdo === 'DOWN' ? 'text-[#f85149]' : 'text-[#d29922]'
                }`}>
                  {status?.sentiment?.wdo || '--'}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Execution Log */}
        <div className="col-span-3 bg-[#161b22] border border-[#30363d] rounded-xl p-6">
          <div className="flex justify-between items-center mb-4 border-b border-[#30363d] pb-3">
            <span className="text-sm text-[#8b949e] uppercase tracking-wider">Terminal de Execução</span>
            <span className="text-xs text-[#8b949e]">Tempo Real</span>
          </div>
          <div className="bg-black rounded-lg p-4 font-mono text-sm max-h-[300px] overflow-y-auto">
            {logs.map((log, i) => (
              <div key={i} className="flex gap-3 mb-1">
                <span className="text-[#8b949e]">{log.time}</span>
                <span className={`font-bold ${
                  log.type === 'success' ? 'text-[#3fb950]' :
                  log.type === 'error' ? 'text-[#f85149]' :
                  log.type === 'warn' ? 'text-[#d29922]' : 'text-[#58a6ff]'
                }`}>
                  [{log.type.toUpperCase()}]
                </span>
                <span>{log.message}</span>
              </div>
            ))}
            {logs.length === 0 && (
              <div className="text-[#8b949e]">Aguardando logs...</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
