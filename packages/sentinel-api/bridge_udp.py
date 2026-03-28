"""
Sentinel UDP Bridge - Zero-Copy Emitter
Latência <1ms: Python detecta -> UDP emit -> Geckos.io

NÃO é um servidor HTTP. É um canhão UDP que dispara deltas.
"""
import socket
import time
import threading
from datetime import datetime

# orjson é 10x mais rápido que json padrão
try:
    import orjson
    USE_ORJSON = True
except ImportError:
    import json
    orjson = None
    USE_ORJSON = False

# MT5
try:
    import MetaTrader5 as mt5
    MT5_AVAILABLE = True
except ImportError:
    MT5_AVAILABLE = False

# ── Config ───────────────────────────────────────────────────────────────────
GECKOS_UDP_PORT = 10210  # Porta UDP para API Node.js
GECKOS_UDP_HOST = "127.0.0.1"
REFRESH_INTERVAL_MS = 10  # 10ms para latência mínima
PRICE_CHANGE_THRESHOLD = 0.0001  # 0.01% de mudança

# ── UDP Socket (Canhão de Dados) ─────────────────────────────────────────────
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 1024 * 1024)  # 1MB buffer

def emit_delta(symbol: str, bid: float, ask: float, exchange: str = "", broker: str = ""):
    """Emite delta via UDP com latência <1ms"""
    packet = {
        "s": symbol,  # symbol
        "b": bid,     # bid
        "a": ask,     # ask
        "e": exchange,  # exchange
        "br": broker,   # broker
        "t": time.time_ns()  # timestamp nanosegundos
    }
    
    if USE_ORJSON:
        data = orjson.dumps(packet)
    else:
        data = json.dumps(packet, separators=(',', ':')).encode()
    
    sock.sendto(data, (GECKOS_UDP_HOST, GECKOS_UDP_PORT))

def emit_batch(deltas: list):
    """Emite lote de deltas em um único pacote UDP"""
    packet = {
        "type": "deltas",
        "items": deltas,
        "t": time.time_ns()
    }
    
    if USE_ORJSON:
        data = orjson.dumps(packet)
    else:
        data = json.dumps(packet, separators=(',', ':')).encode()
    
    sock.sendto(data, (GECKOS_UDP_HOST, GECKOS_UDP_PORT))

# ── MT5 Connections ──────────────────────────────────────────────────────────
CONNECTIONS = {
    "mt5": {"connected": False, "path": r"C:\Program Files\MetaTrader 5\terminal64.exe"},
    "pepperstone": {"connected": False, "path": r"C:\Program Files\Pepperstone MetaTrader 5\terminal64.exe"}
}

def connect_broker(broker: str) -> bool:
    """Conecta ao broker MT5"""
    if not MT5_AVAILABLE:
        return False
    
    path = CONNECTIONS[broker]["path"]
    from pathlib import Path
    if not Path(path).exists():
        return False
    
    mt5.shutdown()
    if mt5.initialize(path=path):
        info = mt5.account_info()
        if info:
            CONNECTIONS[broker]["connected"] = True
            print(f"[Bridge] Conectado: {broker} - {info.login} | {info.server}")
            return True
    return False

# ── Delta Tracker ────────────────────────────────────────────────────────────
previous_prices = {}  # {symbol: (bid, ask)}

def check_delta(symbol: str, bid: float, ask: float) -> bool:
    """Verifica se houve mudança de preço significativa"""
    prev = previous_prices.get(symbol)
    if prev is None:
        previous_prices[symbol] = (bid, ask)
        return True  # Primeira vez, emite
    
    old_bid = prev[0]
    if abs(bid - old_bid) / old_bid > PRICE_CHANGE_THRESHOLD:
        previous_prices[symbol] = (bid, ask)
        return True
    
    return False

# ── Main Loop (Zero-Copy Emitter) ─────────────────────────────────────────────
running = True

def main_loop():
    """Loop principal de emissão de deltas"""
    global running
    
    # ==================== SETORES 001-020: AÇÕES B3 ====================
    bovespa_symbols = [
        # Large Caps
        "PETR4", "VALE3", "ITUB4", "BBDC4", "ABEV3", "WEGE3", "RENT3", "MGLU3",
        "BBAS3", "SANB11", "SUZB3", "JBSS3", "GGBR4", "CSNA3", "USIM5", "CSAN3",
        "BRAP4", "CMIG4", "CPLE6", "CPFE3", "ELET3", "ELET6", "ENBR3", "ENEV3",
        "EGIE3", "EQTL3", "TAEE11", "TRPL4", "BRKM5", "BRFS3", "CCRO3", "CVCB3",
        "CYRE3", "DIRR3", "EZTC3", "GFSA3", "GNDI3", "HAPV3", "HYPE3", "IGTI11",
        "IRBR3", "ITSA4", "KLBN11", "LREN3", "MRFG3", "MRVE3", "MULT3", "PCAR3",
        "PDGR3", "PETR3", "POMO4", "POSI3", "QUAL3", "RADL3", "RAIL3", "RECV3",
        "SBSP3", "SMTO3", "SULA11", "TIMS3", "TOTS3", "UGPA3", "VIVT3", "VVAR3",
        "WIZC3", "YDUQ3", "BBSE3", "BPAC11", "BPAN4", "B3SA3", "ALPA4", "ALSO3",
        # Small Caps
        "AALR3", "AMAR3", "ANIM3", "ARML3", "ARZZ3", "AURA33", "AVLL3", "AZUL4",
        "BAUH4", "BBDC3", "BBRK3", "BDLL4", "BEEF3", "BGIP4", "BIDI11", "BIDI4",
        "BMEB4", "BMGB4", "BMIN4", "BMOB3", "BNBR3", "BOBR4", "BPAC5", "BRBI11",
        "BRDT3", "BRGE12", "BRGE3", "BRML3", "BRPR3", "BRSR6", "BTOW3", "BVMF3",
        "CAML3", "CARD3", "CBMA4", "CEBR6", "CEDO4", "CEEB5", "CEPE3", "CESP6",
        "CGAS5", "CGRA4", "CIQU4", "CIEL3", "CLSC4", "CMIG3", "CNTO4", "COCE5",
        "COCE6", "COGN3", "CPLE3", "CPLE5", "CPRE6", "CRDE3", "CRFB3", "CRIV4",
        "CRPG5", "CSAB4", "CSED3", "CSMG3", "CSTB4", "CTKA4", "CTNM4", "DASA3",
        "DCXU33", "DOHL4", "DTCY3", "DUQE3", "ECAT3", "EDGA3", "EDMA4", "ELEK4",
        "ELPL3", "EMAE4", "EMBR3", "ENAT3", "ENDI33", "ENGI11", "ENG11", "ENJH33",
        "ESPA4", "ESTR4", "ETER3", "EUCA4", "EVEN3", "FCTB4", "FHER3", "FIEI3",
        "FJTA4", "FLCL3", "FLRY3", "FNCN3B", "FRTA3", "FRXA33", "FUGR4", "FUND12",
        "FUND3", "FUND5", "GOAU4", "GOLL4", "GPCP3", "GPSC3", "GRND3", "GSHP3",
        "HBRE3", "HETA4", "HGCL3", "HGPO3", "HGRU11", "IDNT3", "IGBR3", "IGTA3",
        "INEP3", "INTB3", "ITSA3", "ITUB3", "JALL3", "JFEN3", "JHSF3", "JOPA3",
        "JPSF3", "KEPL3", "KLBN4", "KROT4", "LAME3", "LCAM3", "LEVE3", "LFFT3",
        "LIGA3", "LINX3", "LIPR3", "LIVE3", "LLIS3", "LMER3", "LUPA3", "LWSA3",
        "MAGG3", "MAPT4", "MBLY3", "MDIA3", "MEAL3", "MEDI3", "MEGA3", "MILS3",
        "MIST11", "MITS33", "MMXM3", "MNDL3", "MOAR3", "MPTA4", "MSAN3", "MTRE3",
        "MTSA4", "NAFG3", "NAKP3", "NATU3", "NEOE3", "NGRD3", "NIPE3", "NMHI3",
        "NUTR3", "ODPV3", "OFER3", "OGMN3", "OIBR3", "OIBR4", "OPCT3", "ORVR3",
        "OSXB3", "OXER3", "PARD3", "PATI3", "PATI4", "PBRA3", "PBRA5", "PEAB4",
        "PINE4", "PLAS3", "PLPL3", "PMAM3", "PNFV3", "PNVL3", "PPAR3", "PRBC4",
        "PRIO3", "PRSR3", "PTBL3", "PTNT4", "QGEP3", "QNET3", "QVQP3B", "RANI3",
        "RANI4", "RCSL3", "RDOR3", "REET3", "ROMI3", "RRRP3", "RSAN3", "RSCP4",
        "RSID3", "RUMO3", "RZAT4", "SANB3", "SANB4", "SAPR11", "SAPR4", "SBAP3",
        "SBFG3", "SBMO3", "SCAR3", "SCLO3", "SEAB3", "SEER3", "SEIV3", "SEIV4",
        "SGEN33", "SHUL4", "SHOW3", "SLED4", "SLCE3", "SLFG3", "SMLS3", "SMTR3",
        "SNES3", "SNFE3", "SNSY5", "SODB3", "SOMA3", "SPAR3", "SPRI3", "SPTW3",
        "SQIA3", "SRNA3", "SSPA3", "STAP3", "STBP3", "STDR3", "SULA3", "SULA4",
        "SWET3", "TAEE3", "TAEE4", "TANC11", "TASA4", "TBLE3", "TCNO3", "TECN3",
        "TEF3", "TEF4", "TELB4", "TERI3", "TGMA3", "TIET11", "TIET3", "TIET4",
        "TICK3", "TKNO3", "TOYB3", "TPIS3", "TRAD3", "TRAD4", "TRFX3", "TRIS3",
        "TRPL3", "TSIM3", "UCAS3", "UGAR3", "UGPA4", "UNIP6", "USIM3", "USIM6",
        "VAGR3", "VAMO3", "VAPT3", "VCAS3", "VECT3", "VGIR11", "VGRA3", "VIBR3",
        "VIVA3", "VIVR3", "VULC3", "VVAR4", "WEGE4", "WHRL3", "WLCC4", "WIZS3",
        "WSON33", "XPCM3", "YAMAB3", "ZAMP3"
    ]
    
    # ==================== SETORES 021-028: FUTUROS E COMMODITIES ====================
    futuros_symbols = [
        "WINFUT", "WINFUT1", "WINFUT2", "WDOFUT", "WDOFUT1", "WDOFUT2",
        "WSPFUT", "WSPFUT1", "INDFUT", "INDFUT1", "BGI", "CCM", "ICF",
        "SFI", "TFC", "TCM", "WET", "WGC", "WHE", "WHG", "WIG", "WIP",
        "WIT", "WMG", "WMT", "WOF", "WPG", "WPP", "WPR", "WRA", "WRG"
    ]
    
    # ==================== SETOR 029: CRIPTO (BINANCE) ====================
    crypto_symbols = [
        "BTCUSDT", "ETHUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT",
        "SOLUSDT", "DOTUSDT", "MATICUSDT", "LTCUSDT", "SHIBUSDT", "TRXUSDT",
        "AVAXUSDT", "LINKUSDT", "ATOMUSDT", "UNIUSDT", "XLMUSDT", "BCHUSDT",
        "FILUSDT", "NEARUSDT", "APTUSDT", "ARBUSDT", "OPUSDT", "INJUSDT",
        "SUIUSDT", "SEIUSDT", "TIAUSDT", "BLURUSDT", "IMXUSDT", "RNDRUSDT",
        "FETUSDT", "GRTUSDT", "AAVEUSDT", "MKRUSDT", "SNXUSDT", "COMPUSDT",
        "SUSHIUSDT", "YFIUSDT", "CRVUSDT", "1INCHUSDT", "ZRXUSDT", "KNCUSDT",
        "ENJUSDT", "MANAUSDT", "SANDUSDT", "AXSUSDT", "GALAUSDT", "CHZUSDT",
        "BATUSDT", "OCEANUSDT", "BANDUSDT", "ALGOUSDT", "VETUSDT", "HBARUSDT",
        "ICPUSDT", "FTMUSDT", "LRCUSDT", "CELOUSDT", "STORJUSDT", "SKLUSDT",
        "KAVAUSDT", "RUNEUSDT", "CAKEUSDT", "DYDXUSDT", "PERPUSDT", "RSRUSDT",
        "UMAUSDT", "KSMUSDT", "ZECUSDT", "DASHUSDT", "EOSUSDT", "ONTUSDT",
        "ICXUSDT", "QTUMUSDT", "WAVESUSDT", "ZILUSDT", "IOSTUSDT", "XMRUSDT",
        "DGBUSDT", "ETCUSDT", "XDCUSDT", "HOTUSDT", "LUNAUSDT", "LUNCUSDT",
        "BTCBRL", "ETHBRL", "BNBBRL", "SOLBRL"
    ]
    
    # ==================== SETOR 039: FOREX (28 PARES) ====================
    pepperstone_symbols = [
        # Majors
        "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD",
        # Crosses
        "EURGBP", "EURJPY", "EURCHF", "EURAUD", "EURCAD", "EURNZD",
        "GBPJPY", "GBPCHF", "GBPAUD", "GBPCAD", "GBPNZD",
        "AUDJPY", "AUDCHF", "AUDCAD", "AUDNZD",
        "CADJPY", "CADCHF", "NZDJPY", "NZDCHF", "NZDCAD", "CHFJPY",
        # Exotics
        "USDBRL", "USDTRY", "USDZAR", "USDMXN", "USDNOK", "USDSEK"
    ]
    
    # ==================== ÍNDICES E COMMODITIES ====================
    index_symbols = ["US500", "US30", "US100", "GER40", "UK100", "JPN225", "AUS200"]
    commodity_symbols = ["XAUUSD", "XAGUSD", "USOIL", "UKOIL", "NATGAS", "COPPER"]
    
    # Total
    total_symbols = len(bovespa_symbols) + len(futuros_symbols) + len(crypto_symbols) + len(pepperstone_symbols) + len(index_symbols) + len(commodity_symbols)
    
    print(f"[Bridge] Iniciando emissão UDP para {GECKOS_UDP_HOST}:{GECKOS_UDP_PORT}")
    print(f"[Bridge] Intervalo: {REFRESH_INTERVAL_MS}ms | Serialização: {'orjson' if USE_ORJSON else 'json'}")
    print(f"[Bridge] 📊 Total de símbolos: {total_symbols}")
    print(f"[Bridge]   - B3 Ações: {len(bovespa_symbols)}")
    print(f"[Bridge]   - Futuros: {len(futuros_symbols)}")
    print(f"[Bridge]   - Cripto: {len(crypto_symbols)}")
    print(f"[Bridge]   - Forex: {len(pepperstone_symbols)}")
    print(f"[Bridge]   - Índices: {len(index_symbols)}")
    print(f"[Bridge]   - Commodities: {len(commodity_symbols)}")
    
    while running:
        try:
            deltas = []
            
            # BOVESPA via Genial
            if CONNECTIONS["mt5"]["connected"] and MT5_AVAILABLE:
                for sym in bovespa_symbols:
                    try:
                        tick = mt5.symbol_info_tick(sym)
                        if tick and tick.bid > 0:
                            if check_delta(sym, tick.bid, tick.ask):
                                deltas.append({
                                    "s": sym, "b": tick.bid, "a": tick.ask,
                                    "e": "BOVESPA", "br": "genial"
                                })
                    except:
                        pass
            
            # Pepperstone (Forex/Índices/Commodities)
            if CONNECTIONS["pepperstone"]["connected"] and MT5_AVAILABLE:
                # Reconecta ao Pepperstone
                mt5.shutdown()
                mt5.initialize(path=CONNECTIONS["pepperstone"]["path"])
                
                for sym in pepperstone_symbols + index_symbols + commodity_symbols:
                    try:
                        tick = mt5.symbol_info_tick(sym)
                        if tick and tick.bid > 0:
                            exchange = "FOREX" if sym in pepperstone_symbols else \
                                       "INDEX" if sym in index_symbols else "COMMODITIES"
                            if check_delta(sym, tick.bid, tick.ask):
                                deltas.append({
                                    "s": sym, "b": tick.bid, "a": tick.ask,
                                    "e": exchange, "br": "pepperstone"
                                })
                    except:
                        pass
                
                # Volta para Genial
                mt5.shutdown()
                mt5.initialize(path=CONNECTIONS["mt5"]["path"])
            
            # Emite deltas se houver mudanças
            if deltas:
                emit_batch(deltas)
                print(f"[Bridge] Emitidos {len(deltas)} deltas")
            
        except Exception as e:
            print(f"[Bridge] Erro: {e}")
        
        time.sleep(REFRESH_INTERVAL_MS / 1000.0)

# ── Binance WebSocket Thread ─────────────────────────────────────────────────
def binance_ws_loop():
    """Conecta ao WebSocket da Binance para cripto 24/7"""
    import websocket
    import json
    
    # Streams de ticker para principais criptos
    streams = [f"{s.lower()}@ticker" for s in crypto_symbols[:30]]  # Top 30
    url = f"wss://stream.binance.com:9443/ws/{'/'.join(streams)}"
    
    def on_message(ws, message):
        try:
            data = json.loads(message)
            if 's' in data and 'b' in data and 'a' in data:
                symbol = data['s']
                bid = float(data['b'])
                ask = float(data['a'])
                
                if check_delta(symbol, bid, ask):
                    emit_delta(symbol, bid, ask, "BINANCE", "binance")
        except:
            pass
    
    def on_error(ws, error):
        print(f"[Binance] WebSocket error: {error}")
    
    def on_close(ws, close_status_code, close_msg):
        print("[Binance] WebSocket fechado. Reconectando em 5s...")
        time.sleep(5)
        if running:
            binance_ws_loop()
    
    def on_open(ws):
        print("[Binance] ✅ WebSocket conectado - Cripto 24/7 ativo")
    
    print(f"[Binance] Conectando WebSocket para {len(streams)} streams...")
    ws = websocket.WebSocketApp(
        url,
        on_open=on_open,
        on_message=on_message,
        on_error=on_error,
        on_close=on_close
    )
    ws.run_forever()

# ── Entry Point ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("=" * 60)
    print("Sentinel UDP Bridge - Zero-Copy Emitter")
    print("=" * 60)
    
    # Conecta aos brokers
    connect_broker("mt5")
    connect_broker("pepperstone")
    
    # Inicia loop MT5 em background
    loop_thread = threading.Thread(target=main_loop, daemon=True)
    loop_thread.start()
    
    # Inicia Binance WebSocket em background (cripto 24/7)
    binance_thread = threading.Thread(target=binance_ws_loop, daemon=True)
    binance_thread.start()
    
    print("[Bridge] Pressione Ctrl+C para parar")
    
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        running = False
        print("\n[Bridge] Parado.")
        sock.close()
        if MT5_AVAILABLE:
            mt5.shutdown()
