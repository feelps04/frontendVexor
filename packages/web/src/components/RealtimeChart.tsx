import { useState } from 'react'
import TradingViewWidget from './TradingViewWidget'

export type MarketType = 'brazil' | 'usa' | 'crypto' | 'forex' | 'unknown'

interface RealtimeChartProps {
  symbol: string
  currentPrice?: number | null
  onCrosshairMove?: (data: { price: number; time: string } | null) => void
  // mantido para compatibilidade — TradingView trata ticks internamente
  externalTick?: { symbol: string; bid?: number; ask?: number; last?: number; volume?: number; time?: number } | null
}

const TIMEFRAMES = ['1', '5', '15', '60', 'D', 'W'] as const
type TF = typeof TIMEFRAMES[number]

export function RealtimeChart({ symbol }: RealtimeChartProps) {
  const [timeframe, setTimeframe] = useState<TF>('5')

  return (
    <div style={{ position: 'relative' }}>
      {/* Toolbar de timeframes */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            onClick={() => setTimeframe(tf)}
            style={{
              padding: '4px 10px',
              background: timeframe === tf ? 'rgba(0,255,200,0.2)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${timeframe === tf ? 'rgba(0,255,200,0.5)' : 'rgba(255,255,255,0.1)'}`,
              borderRadius: 4,
              color: timeframe === tf ? '#00ffc8' : '#94a3b8',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: timeframe === tf ? 'bold' : 'normal',
            }}
          >
            {tf === 'D' ? '1D' : tf === 'W' ? '1W' : `${tf}m`}
          </button>
        ))}

        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#475569' }}>
          powered by TradingView
        </span>
      </div>

      {/* Grafico TradingView */}
      <TradingViewWidget
        symbol={symbol}
        interval={timeframe}
        height={360}
        hideSideToolbar={false}
        allowSymbolChange={false}
      />
    </div>
  )
}
