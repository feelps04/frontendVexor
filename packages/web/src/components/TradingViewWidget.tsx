import { useEffect, useRef, memo } from 'react'

interface TradingViewWidgetProps {
  symbol: string
  interval?: string
  theme?: 'light' | 'dark'
  height?: number
  width?: string
  locale?: string
  hideTopToolbar?: boolean
  hideSideToolbar?: boolean
  allowSymbolChange?: boolean
  saveImage?: boolean
  container?: string
}

/** Converte símbolo interno → formato TradingView (EXCHANGE:SYMBOL) */
export function toTVSymbol(symbol: string): string {
  const s = symbol.toUpperCase().trim()

  // ── Crypto — Binance ─────────────────────────────────────────
  const CRYPTO_BASE = [
    'BTC','ETH','SOL','BNB','XRP','ADA','DOGE','DOT','LTC','AVAX',
    'MATIC','LINK','UNI','ATOM','FIL','APT','ARB','OP','NEAR','INJ',
    'BCH','TRX','VET','ALGO','HBAR','ICP','QNT','EGLD','MANA','SAND',
    'AAVE','MKR','COMP','CRV','SNX','GRT','YFI','SUSHI','CAKE','1INCH',
    'PEPE','WIF','SHIB','FLOKI','BONK',
  ]
  // "BTCUSD" ou "BTCUSDT"
  for (const base of CRYPTO_BASE) {
    if (s === base || s === base + 'USD' || s === base + 'USDT') {
      return `BINANCE:${base}USDT`
    }
  }

  // ── Forex ─────────────────────────────────────────────────────
  const FOREX_PAIRS: Record<string, string> = {
    EURUSD: 'FX:EURUSD', GBPUSD: 'FX:GBPUSD', USDJPY: 'FX:USDJPY',
    AUDUSD: 'FX:AUDUSD', USDCAD: 'FX:USDCAD', USDCHF: 'FX:USDCHF',
    NZDUSD: 'FX:NZDUSD', EURGBP: 'FX:EURGBP', EURJPY: 'FX:EURJPY',
    GBPJPY: 'FX:GBPJPY', AUDJPY: 'FX:AUDJPY', CADJPY: 'FX:CADJPY',
    XAUUSD: 'OANDA:XAUUSD', XAGUSD: 'OANDA:XAGUSD',
    USDBRL: 'FX_IDC:USDBRL', EURBRL: 'FX_IDC:EURBRL',
  }
  if (FOREX_PAIRS[s]) return FOREX_PAIRS[s]

  // ── Índices globais ───────────────────────────────────────────
  const INDEX_MAP: Record<string, string> = {
    SPX: 'SP:SPX', SPY: 'AMEX:SPY', QQQ: 'NASDAQ:QQQ',
    IBOV: 'BMFBOVESPA:IBOV', IBOVESPA: 'BMFBOVESPA:IBOV',
    WIN: 'BMFBOVESPA:WIN1!', WDO: 'BMFBOVESPA:WDO1!',
    DJI: 'DJ:DJI', FTSE: 'FOREXCOM:UKXGBP', DAX: 'XETR:DAX',
    NIKKEI: 'TVC:NI225', CHINA50: 'OANDA:CN50USD',
    US30: 'FOREXCOM:DJI', US100: 'NASDAQ:QQQ', US500: 'AMEX:SPY',
    AUS200: 'ASX:XJO', FRA40: 'EURONEXT:FCE1!',
    EUSTX50: 'EUREX:FESX1!',
  }
  if (INDEX_MAP[s]) return INDEX_MAP[s]

  // ── Commodities ───────────────────────────────────────────────
  const COMMODITY_MAP: Record<string, string> = {
    USOIL: 'NYMEX:CL1!', UKOIL: 'ICEEUR:B1!', OIL: 'NYMEX:CL1!',
    NATGAS: 'NYMEX:NG1!', COPPER: 'COMEX:HG1!',
    CORN: 'CBOT:ZC1!', WHEAT: 'CBOT:ZW1!', SOYBEANS: 'CBOT:ZS1!',
    COFFEE: 'ICEUS:KC1!', SUGAR: 'ICEUS:SB1!', COTTON: 'ICEUS:CT1!',
    COCOA: 'ICEUS:CC1!', CATTLE: 'CME:LE1!', GASOLINE: 'NYMEX:RB1!',
  }
  if (COMMODITY_MAP[s]) return COMMODITY_MAP[s]

  // ── Ações US — Pepperstone vira NASDAQ/NYSE ───────────────────
  const US_STOCKS_NASDAQ = [
    'AAPL','MSFT','GOOGL','GOOG','AMZN','META','NVDA','TSLA','AMD',
    'INTC','NFLX','PYPL','ADBE','CRM','ORCL','QCOM','AVGO','TXN',
    'AMAT','LRCX','KLAC','MRVL','SNOW','PLTR','COIN','DDOG','NET',
    'ZS','CRWD','OKTA','PANW','FTNT','SHOP','ASML','TSM',
  ]
  const US_STOCKS_NYSE = [
    'JPM','BAC','GS','MS','C','WFC','V','MA','AXP','BRK.B',
    'JNJ','PFE','MRK','ABT','LLY','UNH','HD','WMT','PG','KO',
    'PEP','MCD','DIS','NKE','BA','CAT','XOM','CVX','GE','MMM',
  ]
  // Remover sufixo .US da Pepperstone
  const cleanUS = s.replace(/\.US$/, '')
  if (US_STOCKS_NASDAQ.includes(cleanUS)) return `NASDAQ:${cleanUS}`
  if (US_STOCKS_NYSE.includes(cleanUS))   return `NYSE:${cleanUS}`

  // ── Ações BR — B3 (BMFBOVESPA) ───────────────────────────────
  // Padrão: letra(s) + número (PETR4, VALE3, ABEV3, etc.)
  if (/^[A-Z]{3,6}[0-9]{1,2}$/.test(s)) {
    return `BMFBOVESPA:${s}`
  }
  // FIIs (ex: HGLG11, XPML11)
  if (/^[A-Z]{4}11$/.test(s)) {
    return `BMFBOVESPA:${s}`
  }

  // ── Fallback: retorna o próprio símbolo ───────────────────────
  return s
}

/** Intervalo interno → intervalo TradingView */
function toTVInterval(interval: string): string {
  const map: Record<string, string> = {
    '1': '1', '1m': '1',
    '5': '5', '5m': '5',
    '15': '15', '15m': '15',
    '30': '30', '30m': '30',
    '60': '60', '1h': '60', 'H1': '60',
    '240': '240', '4h': '240', 'H4': '240',
    'D': 'D', '1d': 'D', 'D1': 'D',
    'W': 'W', '1w': 'W', 'W1': 'W',
    'M': 'M', '1M': 'M',
  }
  return map[interval] ?? '5'
}

let scriptLoaded = false
let scriptLoading = false
const waitingCallbacks: (() => void)[] = []

function loadTVScript(cb: () => void) {
  if (scriptLoaded) { cb(); return }
  waitingCallbacks.push(cb)
  if (scriptLoading) return
  scriptLoading = true
  const s = document.createElement('script')
  s.src = 'https://s3.tradingview.com/tv.js'
  s.async = true
  s.onload = () => {
    scriptLoaded = true
    waitingCallbacks.forEach(fn => fn())
    waitingCallbacks.length = 0
  }
  document.head.appendChild(s)
}

let widgetCounter = 0

const TradingViewWidget = memo(function TradingViewWidget({
  symbol,
  interval = '5',
  theme = 'dark',
  height = 400,
  width = '100%',
  locale = 'br',
  hideTopToolbar = false,
  hideSideToolbar = true,
  allowSymbolChange = true,
  saveImage = false,
}: TradingViewWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetRef = useRef<any>(null)
  const idRef = useRef(`tv_widget_${++widgetCounter}`)

  useEffect(() => {
    const tvSymbol = toTVSymbol(symbol)
    const tvInterval = toTVInterval(interval)
    const containerId = idRef.current

    function createWidget() {
      if (!containerRef.current) return
      if (!(window as any).TradingView) return

      // Limpar widget anterior
      if (widgetRef.current) {
        try { widgetRef.current.remove?.() } catch (_) {}
        widgetRef.current = null
      }
      containerRef.current.innerHTML = `<div id="${containerId}"></div>`

      widgetRef.current = new (window as any).TradingView.widget({
        container_id: containerId,
        width: '100%',
        height,
        symbol: tvSymbol,
        interval: tvInterval,
        timezone: 'America/Sao_Paulo',
        theme,
        style: '1',           // Candlestick
        locale,
        toolbar_bg: '#0d1117',
        enable_publishing: false,
        hide_top_toolbar: hideTopToolbar,
        hide_side_toolbar: hideSideToolbar,
        allow_symbol_change: allowSymbolChange,
        save_image: saveImage,
        studies: [],
        show_popup_button: false,
        popup_width: '1000',
        popup_height: '650',
        no_referral_id: true,
        autosize: false,
      })
    }

    loadTVScript(createWidget)

    return () => {
      try { widgetRef.current?.remove?.() } catch (_) {}
      widgetRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, interval, theme, height])

  return (
    <div
      ref={containerRef}
      style={{ width, height, background: '#0d1117', borderRadius: 8, overflow: 'hidden' }}
    >
      <div id={idRef.current} />
    </div>
  )
})

export default TradingViewWidget
