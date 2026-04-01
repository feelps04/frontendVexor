#!/usr/bin/env python3
"""
Sentinel API — Servidor local para conectar Dashboard → MetaTrader 5 / Pepperstone
Porta: 8765
Uso:   python sentinel_api.py

Requer:  pip install MetaTrader5 pandas
OS:      Windows (MetaTrader5 só funciona no Windows)

Endpoints GET:
  /status           → estado das conexões + stats do CSV
  /sectors          → lista todos os 52 setores
  /assets           → todos os 1901 ativos (query: sector, exchange, type, q, page, size)
  /assets/count     → contagem por setor/tipo/exchange

Endpoints POST:
  /mt5/connect | /mt5/disconnect
  /pepperstone/connect | /pepperstone/disconnect
  /tick              { symbol, broker }
  /ticks/batch       { symbols:[], broker }
  /ticks/sector      { sector_id, broker }        ← TODOS ativos de um setor
  /ticks/all         { broker, exchange?, sector_id?, type?, limit? }  ← TODOS 1901
  /ohlcv             { symbol, timeframe, count, broker }
  /symbol/info       { symbol, broker }
  /symbols/list      { broker }
"""

import csv
import gzip
import json
import logging
import struct
import threading
import time
import urllib.request
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pandas as pd

# MessagePack-like binary protocol (sem dependência externa)
def encode_delta(deltas: dict) -> bytes:
    """Codifica deltas em formato binário ultra-compacto.
    Formato: [count:2bytes][symbol_len:1byte][symbol][bid:8bytes][ask:8bytes]...
    """
    buf = bytearray()
    buf.extend(struct.pack(">H", len(deltas)))  # count (2 bytes, big-endian)
    for sym, data in deltas.items():
        sym_bytes = sym.encode("utf-8")[:255]  # max 255 chars
        buf.extend(struct.pack("B", len(sym_bytes)))  # symbol length (1 byte)
        buf.extend(sym_bytes)  # symbol
        buf.extend(struct.pack(">dd", data.get("bid", 0), data.get("ask", 0)))  # bid/ask (16 bytes)
    return bytes(buf)

def decode_delta(data: bytes) -> dict:
    """Decodifica formato binário para dict."""
    result = {}
    offset = 0
    count = struct.unpack(">H", data[offset:offset+2])[0]
    offset += 2
    for _ in range(count):
        sym_len = struct.unpack("B", data[offset:offset+1])[0]
        offset += 1
        sym = data[offset:offset+sym_len].decode("utf-8")
        offset += sym_len
        bid, ask = struct.unpack(">dd", data[offset:offset+16])
        offset += 16
        result[sym] = {"bid": bid, "ask": ask}
    return result

# ── Windows-only MT5 import ──────────────────────────────────────────────────
try:
    import MetaTrader5 as mt5
    MT5_AVAILABLE = True
except ImportError:
    MT5_AVAILABLE = False
    print("[WARN] MetaTrader5 não disponível — instale: pip install MetaTrader5")

# ── Config ───────────────────────────────────────────────────────────────────
HOST = "0.0.0.0"
PORT = 8765
logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)s  %(message)s")
log = logging.getLogger("sentinel_api")

# ── Latência ultra-baixa: Cache em memória com background refresh ────────────
CACHE_TTL_MS = 100  # 100ms TTL para tempo real
BACKGROUND_REFRESH_MS = 100  # 100ms para não bloquear HTTP
PRICE_CHANGE_THRESHOLD = 0.0001  # 0.01% de mudança para considerar delta

class UltraLowLatencyCache:
    """Cache com atualização em background e protocolo Delta para latência <1ms"""
    def __init__(self):
        self._data = {"symbols": [], "timestamp": 0}
        self._previous_prices = {}  # {symbol: (bid, ask)} - preço anterior
        self._deltas = {}  # {symbol: {bid, ask}} - apenas mudanças
        self._lock = threading.RLock()
        self._running = False
        self._thread = None
        self._ready = False
        
    def start_background_refresh(self):
        """Inicia thread de atualização em background"""
        self._running = True
        self._thread = threading.Thread(target=self._refresh_loop, daemon=True)
        self._thread.start()
        log.info("Cache background iniciado (refresh: %dms, delta tracking)", BACKGROUND_REFRESH_MS)
        
    def stop_background_refresh(self):
        """Para thread de atualização"""
        self._running = False
        if self._thread:
            self._thread.join(timeout=1)
            
    def _refresh_loop(self):
        """Loop de atualização em background"""
        while self._running:
            try:
                self._refresh_data()
                self._ready = True
            except Exception as e:
                log.warning("Erro no refresh: %s", e)
            time.sleep(BACKGROUND_REFRESH_MS / 1000.0)
            
    def _refresh_data(self):
        """Atualiza dados do cache e calcula deltas"""
        global CONNECTIONS, BINANCE_SYMBOLS, BINANCE_CACHE
        
        all_symbols = []
        new_deltas = {}
        now = time.time()
        
        # BOVESPA via Genial + NYSE via Pepperstone
        if MT5_AVAILABLE:
            # BOVESPA via Genial - reconecta ao terminal correto
            if CONNECTIONS["mt5"]["connected"]:
                genial_path = r"C:\Program Files\MetaTrader 5\terminal64.exe"
                mt5.initialize(path=genial_path)
                bovespa_symbols = sorted({a["symbol"] for a in ASSETS if a["exchange"] == "BOVESPA"})
                for sym in bovespa_symbols:
                    try:
                        mt5.symbol_select(sym, True)
                        tick = mt5.symbol_info_tick(sym)
                        if tick and ((tick.bid or 0) > 0 or (getattr(tick, 'last', 0) or 0) > 0):
                            bid = tick.bid or 0.0
                            ask = tick.ask or 0.0
                            last = getattr(tick, 'last', 0.0) or 0.0
                            if bid <= 0 and last > 0:
                                bid = last
                            if ask <= 0 and last > 0:
                                ask = last
                            all_symbols.append({
                                "symbol": sym, "exchange": "BOVESPA",
                                "bid": bid, "ask": ask,
                                "last": last or bid,
                                "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                                "broker": "genial",
                            })
                            prev = self._previous_prices.get(sym)
                            if prev is None or abs(bid - prev[0]) / prev[0] > PRICE_CHANGE_THRESHOLD:
                                new_deltas[sym] = {"bid": bid, "ask": ask}
                            self._previous_prices[sym] = (bid, ask)
                    except:
                        pass
            
            # NYSE via Pepperstone (acoes US com .US) - reconecta ao terminal correto
            if CONNECTIONS["pepperstone"]["connected"]:
                pepperstone_path = r"C:\Program Files\Pepperstone MetaTrader 5\terminal64.exe"
                mt5.initialize(path=pepperstone_path)
                nyse_symbols = sorted({a["symbol"] for a in ASSETS if a["exchange"] == "NYSE"})
                for sym in nyse_symbols:
                    try:
                        mt5.symbol_select(sym, True)
                        tick = mt5.symbol_info_tick(sym)
                        if tick and ((tick.bid or 0) > 0 or (getattr(tick, 'last', 0) or 0) > 0):
                            bid = tick.bid or 0.0
                            ask = tick.ask or 0.0
                            last = getattr(tick, 'last', 0.0) or 0.0
                            if bid <= 0 and last > 0:
                                bid = last
                            if ask <= 0 and last > 0:
                                ask = last
                            all_symbols.append({
                                "symbol": sym, "exchange": "NYSE",
                                "bid": bid, "ask": ask,
                                "last": last or bid,
                                "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                                "broker": "pepperstone",
                            })
                            prev = self._previous_prices.get(sym)
                            if prev is None or abs(bid - prev[0]) / prev[0] > PRICE_CHANGE_THRESHOLD:
                                new_deltas[sym] = {"bid": bid, "ask": ask}
                            self._previous_prices[sym] = (bid, ask)
                    except:
                        pass
        
        # Pepperstone + Binance
        if CONNECTIONS["pepperstone"]["connected"] and MT5_AVAILABLE:
            # Forex
            for sym in ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "NZDUSD", "EURGBP", "EURJPY", "GBPJPY"]:
                try:
                    tick = mt5.symbol_info_tick(sym)
                    if tick and tick.bid > 0:
                        all_symbols.append({
                            "symbol": sym, "exchange": "FOREX",
                            "bid": tick.bid, "ask": tick.ask,
                            "last": getattr(tick, 'last', 0) or tick.bid,
                            "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                            "broker": "pepperstone",
                        })
                        prev = self._previous_prices.get(sym)
                        if prev is None or abs(tick.bid - prev[0]) / prev[0] > PRICE_CHANGE_THRESHOLD:
                            new_deltas[sym] = {"bid": tick.bid, "ask": tick.ask}
                        self._previous_prices[sym] = (tick.bid, tick.ask)
                except:
                    pass
            
            # Binance (usa cache já atualizado)
            prices = BINANCE_CACHE.get("prices", {})
            for sym in BINANCE_SYMBOLS:
                for pair in [f"{sym}USDT", f"{sym}BRL", f"{sym}USD", f"{sym}BUSD"]:
                    if pair in prices and prices[pair] > 0:
                        price = prices[pair]
                        all_symbols.append({
                            "symbol": sym, "exchange": "CRYPTO",
                            "bid": price, "ask": price,
                            "last": price,
                            "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                            "broker": "binance", "pair": pair,
                        })
                        prev = self._previous_prices.get(sym)
                        if prev is None or abs(price - prev[0]) / prev[0] > PRICE_CHANGE_THRESHOLD:
                            new_deltas[sym] = {"bid": price, "ask": price}
                        self._previous_prices[sym] = (price, price)
                        break
            
            # Índices e Commodities Pepperstone
            commodities = [
                # Metais
                "XAUUSD", "XAGUSD", "XPDUSD", "XPTUSD", "Copper",
                # Energia
                "SpotBrent", "NatGas", "Gasoline",
                # Agrícolas
                "Coffee", "Cotton", "Sugar", "Soybeans", "Wheat", "Corn", "Cattle",
                # Índices
                "SP500", "NAS100", "US30", "GER30", "UK100"
            ]
            for sym in commodities:
                try:
                    tick = mt5.symbol_info_tick(sym)
                    if tick and tick.bid > 0:
                        exchange = "COMMODITIES" if sym not in ["SP500", "NAS100", "US30", "GER30", "UK100"] else "INDEX"
                        all_symbols.append({
                            "symbol": sym, "exchange": exchange,
                            "bid": tick.bid, "ask": tick.ask,
                            "last": getattr(tick, 'last', 0) or tick.bid,
                            "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                            "broker": "pepperstone",
                        })
                        prev = self._previous_prices.get(sym)
                        if prev is None or abs(tick.bid - prev[0]) / prev[0] > PRICE_CHANGE_THRESHOLD:
                            new_deltas[sym] = {"bid": tick.bid, "ask": tick.ask}
                        self._previous_prices[sym] = (tick.bid, tick.ask)
                except:
                    pass
        
        # Atualiza cache com lock
        with self._lock:
            self._data = {"symbols": all_symbols, "timestamp": now}
            self._deltas = new_deltas
            
    def get(self):
        """Retorna dados completos do cache"""
        with self._lock:
            return {"symbols": self._data["symbols"], "total": len(self._data["symbols"])}
    
    def get_deltas(self):
        """Retorna apenas mudanças de preço (delta)"""
        with self._lock:
            return {"deltas": dict(self._deltas), "count": len(self._deltas), "timestamp": self._data["timestamp"]}
    
    def get_deltas_binary(self) -> bytes:
        """Retorna deltas em formato binário ultra-compacto"""
        with self._lock:
            return encode_delta(self._deltas)
    
    def get_deltas_json(self) -> dict:
        """Retorna deltas em JSON compacto"""
        with self._lock:
            # Formato compacto: {"d": {"PETR4": [34.51, 34.52], ...}, "t": timestamp}
            compact_deltas = {}
            for sym, data in self._deltas.items():
                compact_deltas[sym] = [data["bid"], data["ask"]]
            return {"d": compact_deltas, "t": int(self._data["timestamp"] * 1000)}

# Instância global do cache
MMF_CACHE = UltraLowLatencyCache()

# ── Carregar CSV ──────────────────────────────────────────────────────────────
def load_csv():
    script_dir = Path(__file__).parent
    candidates = [
        script_dir / ".." / ".." / "sectors_symbols.csv",
        script_dir / "sectors_symbols.csv",
        Path("sectors_symbols.csv"),
    ]
    for path in candidates:
        if path.exists():
            log.info("Carregando CSV: %s", path)
            rows = []
            with open(path, encoding="utf-8-sig", newline="") as f:
                for row in csv.DictReader(f):
                    rows.append({k.strip(): v.strip() for k, v in row.items()})
            log.info("CSV carregado: %d ativos em %d setores", len(rows),
                     len({r["sector_id"] for r in rows}))
            return rows
    log.warning("sectors_symbols.csv NÃO encontrado.")
    return []

ASSETS = load_csv()

# ── Binance API para cripto ───────────────────────────────────────────────────
BINANCE_CACHE = {"prices": {}, "timestamp": 0}
BINANCE_SYMBOLS = set()  # Todos os símbolos Binance
CACHE_TTL = 2  # Cache TTL em segundos para tempo real

def fetch_binance_prices() -> dict:
    """Busca preços de cripto da Binance API pública (sem autenticação)."""
    global BINANCE_CACHE, BINANCE_SYMBOLS
    try:
        # Cache por CACHE_TTL segundos
        if BINANCE_CACHE["timestamp"] > 0 and (datetime.now().timestamp() - BINANCE_CACHE["timestamp"]) < CACHE_TTL:
            return BINANCE_CACHE["prices"]
        
        url = "https://api.binance.com/api/v3/ticker/price"
        req = urllib.request.Request(url, headers={"User-Agent": "Sentinel-API/1.0"})
        with urllib.request.urlopen(req, timeout=3) as resp:  # Timeout reduzido
            data = json.loads(resp.read().decode())
        
        prices = {}
        for item in data:
            symbol = item.get("symbol", "")
            price = float(item.get("price", 0))
            if price > 0:
                prices[symbol] = price
                # Extrai símbolo base (BTCUSDT -> BTC)
                for suffix in ["USDT", "BRL", "USD", "BUSD"]:
                    if symbol.endswith(suffix):
                        BINANCE_SYMBOLS.add(symbol[:-len(suffix)])
                        break
        
        BINANCE_CACHE = {"prices": prices, "timestamp": datetime.now().timestamp()}
        log.info("Binance: %d símbolos carregados", len(prices))
        return prices
    except Exception as e:
        log.warning("Binance API erro: %s", e)
        return BINANCE_CACHE.get("prices", {})

def get_binance_price(symbol: str) -> dict:
    """Retorna preço da Binance para um símbolo (ex: BTC, ETH, AAVE)."""
    prices = fetch_binance_prices()
    symbol_upper = symbol.upper()
    
    # Stablecoins têm preço fixo ~1 USD
    stablecoins = {"DAI": 1.0, "USDC": 1.0, "USDT": 1.0, "BUSD": 1.0, "FDUSD": 1.0}
    if symbol_upper in stablecoins:
        # Tenta buscar da Binance primeiro
        for pair in [f"{symbol_upper}USDT", f"{symbol_upper}BRL", f"{symbol_upper}USD", f"{symbol_upper}BUSD"]:
            if pair in prices and prices[pair] > 0:
                return {"bid": prices[pair], "ask": prices[pair], "source": "binance", "pair": pair}
        # Fallback para 1 USD
        return {"bid": stablecoins[symbol_upper], "ask": stablecoins[symbol_upper], "source": "stablecoin", "pair": f"{symbol_upper}USD"}
    
    # Tenta variações: BTCUSDT, BTCBRL, BTCUSD
    for pair in [f"{symbol_upper}USDT", f"{symbol_upper}BRL", f"{symbol_upper}USD", f"{symbol_upper}BUSD"]:
        if pair in prices:
            return {"bid": prices[pair], "ask": prices[pair], "source": "binance", "pair": pair}
    
    return {}

# ── Yahoo Finance para BDRs sem cotação no MT5 ────────────────────────────────
def fetch_yahoo_price(symbol: str) -> dict:
    """Busca preço de BDR do Yahoo Finance (ex: AAPL34.SA)."""
    global YAHOO_CACHE
    try:
        # Cache por YAHOO_TTL segundos
        if YAHOO_CACHE["timestamp"] > 0 and (datetime.now().timestamp() - YAHOO_CACHE["timestamp"]) < YAHOO_TTL:
            if symbol in YAHOO_CACHE["prices"]:
                return YAHOO_CACHE["prices"][symbol]
        
        # Yahoo usa sufixo .SA para BDRs brasileiros
        yahoo_symbol = f"{symbol}.SA"
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{yahoo_symbol}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"})
        
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
        
        result = data.get("chart", {}).get("result", [{}])[0]
        meta = result.get("meta", {})
        price = meta.get("regularMarketPrice", 0)
        
        if price and price > 0:
            result_data = {"bid": price, "ask": price, "source": "yahoo", "symbol": symbol}
            YAHOO_CACHE["prices"][symbol] = result_data
            YAHOO_CACHE["timestamp"] = datetime.now().timestamp()
            return result_data
    except Exception as e:
        log.debug("Yahoo erro %s: %s", symbol, e)
    
    return {}

def get_binance_ohlcv(symbol: str, interval: str = "1h", limit: int = 100) -> dict:
    """Busca OHLCV da Binance para um símbolo de cripto."""
    try:
        symbol_upper = symbol.upper()
        # Tenta variações de par
        for pair in [f"{symbol_upper}USDT", f"{symbol_upper}BRL", f"{symbol_upper}USD", f"{symbol_upper}BUSD"]:
            url = f"https://api.binance.com/api/v3/klines?symbol={pair}&interval={interval}&limit={limit}"
            req = urllib.request.Request(url, headers={"User-Agent": "Sentinel-API/1.0"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode())
            
            if data:
                candles = []
                for item in data:
                    candles.append({
                        "time": datetime.fromtimestamp(item[0] / 1000).strftime("%Y-%m-%d %H:%M"),
                        "open": float(item[1]),
                        "high": float(item[2]),
                        "low": float(item[3]),
                        "close": float(item[4]),
                        "volume": float(item[5]),
                    })
                return {"symbol": symbol, "pair": pair, "timeframe": interval, "count": len(candles), "data": candles}
        return {"error": f"Símbolo '{symbol}' não encontrado na Binance"}
    except Exception as e:
        return {"error": str(e)}

# ── Índices auxiliares ────────────────────────────────────────────────────────
SECTORS, BY_SECTOR, BY_EXCHANGE, BY_TYPE = {}, {}, {}, {}
for a in ASSETS:
    sid = a["sector_id"]
    SECTORS[sid] = a["sector_name"]
    BY_SECTOR.setdefault(sid, []).append(a)
    BY_EXCHANGE.setdefault(a["exchange"], []).append(a)
    BY_TYPE.setdefault(a["type"], []).append(a)

log.info("Índices: %d setores | %d exchanges | %d tipos",
         len(SECTORS), len(BY_EXCHANGE), len(BY_TYPE))

# Carrega símbolos Binance na inicialização
fetch_binance_prices()
log.info("Binance: %d símbolos únicos disponíveis", len(BINANCE_SYMBOLS))

# ── State ────────────────────────────────────────────────────────────────────
CONNECTIONS = {
    "mt5":         {"connected": False, "account": None},
    "pepperstone": {"connected": False, "account": None},
}

# ── Pepperstone symbol map ────────────────────────────────────────────────────
PEPP_MAP = {
    # Índices
    "IBOV":"IBOVESPA","SPX":"US500","SP500":"US500","NDX":"US100","NAS100":"US100",
    "DJI":"US30","DAX":"GER40","GER30":"GER40","FTSE":"UK100","CAC40":"FRA40",
    "NIKKEI":"JPN225","HSI":"HK50","RUT":"US2000","VIX":"VIX",
    # Ações US (Pepperstone CFD)
    "AAPL":"AAPL.us","AAPL.US":"AAPL.us","MSFT":"MSFT.us","MSFT.US":"MSFT.us",
    "GOOGL":"GOOGL.us","GOOGL.US":"GOOGL.us","AMZN":"AMZN.us","AMZN.US":"AMZN.us",
    "META":"META.us","META.US":"META.us","NVDA":"NVDA.us","NVDA.US":"NVDA.us",
    "TSLA":"TSLA.us","TSLA.US":"TSLA.us","AMD":"AMD.us","AMD.US":"AMD.us",
    "INTC":"INTC.us","INTC.US":"INTC.us","NFLX":"NFLX.us","NFLX.US":"NFLX.us",
    "DIS":"DIS.us","DIS.US":"DIS.us","JPM":"JPM.us","JPM.US":"JPM.us",
    "V":"V.us","V.US":"V.us","MA":"MA.us","MA.US":"MA.us",
    "HD":"HD.us","HD.US":"HD.us","WMT":"WMT.us","WMT.US":"WMT.us",
    "PG":"PG.us","PG.US":"PG.us","JNJ":"JNJ.us","JNJ.US":"JNJ.us",
    "ADBE":"ADBE.us","ADBE.US":"ADBE.us","CRM":"CRM.us","CRM.US":"CRM.us",
    "COST":"COST.us","COST.US":"COST.us","PEP":"PEP.us","PEP.US":"PEP.us",
    "KO":"KO.us","KO.US":"KO.us","NKE":"NKE.us","NKE.US":"NKE.us",
    "MRK":"MRK.us","MRK.US":"MRK.us","LLY":"LLY.us","LLY.US":"LLY.us",
    "AVGO":"AVGO.us","AVGO.US":"AVGO.us","ORCL":"ORCL.us","ORCL.US":"ORCL.us",
    "QCOM":"QCOM.us","QCOM.US":"QCOM.us","TXN":"TXN.us","TXN.US":"TXN.us",
    "IBM":"IBM.us","IBM.US":"IBM.us","BAC":"BAC.us","BAC.US":"BAC.us",
    "ABBV":"ABBV.us","ABBV.US":"ABBV.us","TMO":"TMO.us","TMO.US":"TMO.us",
    "UNH":"UNH.us","UNH.US":"UNH.us","CVX":"CVX.us","CVX.US":"CVX.us",
    "XOM":"XOM.us","XOM.US":"XOM.us","ABT":"ABT.us","ABT.US":"ABT.us",
    "DHR":"DHR.us","DHR.US":"DHR.us","CSCO":"CSCO.us","CSCO.US":"CSCO.us",
    "BRK.B":"BRK.B.us","BRK.B.US":"BRK.B.us","BABA":"BABA.us","BABA.US":"BABA.us",
    "TSM":"TSM.us","TSM.US":"TSM.us","ASML":"ASML.us","ASML.US":"ASML.us",
    "AMAT":"AMAT.us","AMAT.US":"AMAT.us","LRCX":"LRCX.us","LRCX.US":"LRCX.us",
    "NEE":"NEE.us","NEE.US":"NEE.us","MCD":"MCD.us","MCD.US":"MCD.us",
    "MELI":"MELI.us","MELI.US":"MELI.us",
    # Metais
    "GC":"XAUUSD","GOLD":"XAUUSD","XAU":"XAUUSD",
    "SI":"XAGUSD","SILVER":"XAGUSD","XAG":"XAGUSD",
    "HG":"Copper","COPPER":"Copper",
    "PA":"XPDUSD","PALLADIUM":"XPDUSD",
    "PL":"XPTUSD","PLATINUM":"XPTUSD",
    # Energia
    "CL":"SpotBrent","OIL":"SpotBrent","WTI":"SpotBrent","USOIL":"SpotBrent",
    "BZ":"SpotBrent","BRENT":"SpotBrent","UKOIL":"SpotBrent",
    "NG":"NatGas","NATGAS":"NatGas","GAS":"NatGas",
    "RB":"Gasoline","GASOLINE":"Gasoline","HO":"HeatingOil",
    # Agrícolas
    "KC":"Coffee","COFFEE":"Coffee",
    "CT":"Cotton","COTTON":"Cotton",
    "SB":"Sugar","SUGAR":"Sugar",
    "ZS":"Soybeans","SOY":"Soybeans","SOYBEAN":"Soybeans",
    "ZW":"Wheat","WHEAT":"Wheat",
    "ZC":"Corn","CORN":"Corn",
    "LE":"Cattle","GF":"Cattle","CATTLE":"Cattle",
    # Soft commodities ICE/CME
    "CC":"Coffee","COCOA":"Cocoa","COCOA2":"Cocoa",
    "HE":"Cattle","LEAN":"Cattle","LIVE":"Cattle",
    "OJ":"Sugar","ORANGE":"Sugar","ORANGEJUICE":"Sugar",
    "LB":"Lumber","LUMBER":"Lumber",
    # Cripto principais
    "BTC":"BTCUSD","ETH":"ETHUSD","XRP":"XRPUSD","SOL":"SOLUSD","BNB":"BNBUSD",
    "ADA":"ADAUSD","DOGE":"DOGEUSD","LINK":"LINKUSD","LTC":"LTCUSD","DOT":"DOTUSD",
    "AVAX":"AVAXUSD","MATIC":"MATICUSD","ATOM":"ATOMUSD","UNI":"UNIUSD",
    "TRX":"TRXUSD","XLM":"XLMUSD","BCH":"BCHUSD","NEAR":"NEARUSD",
    # Cripto alternativas
    "ALGO":"ALGOUSD","AXS":"AXSUSD","FIL":"FILUSD","HBAR":"HBARUSD","ICP":"ICPUSD",
    "MANA":"MANAUSD","OP":"OPUSD","SAND":"SANDUSD","SHIB":"SHIBUSD","SUI":"SUIUSD",
    "TON":"TONUSD","VET":"VETUSD","XTZ":"XTZUSD","EOS":"EOSUSD",
    # Layer 1/2
    "APT":"APTUSD","ARB":"ARBUSD","FTM":"FTMUSD","INJ":"INJUSD","SEI":"SEIUSD",
    # BNB Chain
    "CAKE":"CAKEUSD","XVS":"XVSUSD","BAND":"BANDUSD",
    # Solana
    "RAY":"RAYUSD","JUP":"JUPUSD","BONK":"BONKUSD","WIF":"WIFUSD",
    # RWA
    "ONDO":"ONDOUSD","TRU":"TRUUSD",
    # Meme
    "PEPE":"PEPEUSD","FLOKI":"FLOKIUSD",
    # AI
    "FET":"FETUSD","RNDR":"RNDRUSD","TAO":"TAOUSD","GRT":"GRTUSD","AGIX":"AGIXUSD",
    # Metaverso
    "ENJ":"ENJUSD","ILV":"ILVUSD",
    # Gaming
    "GALA":"GALAUSD","IMX":"IMXUSD","YGG":"YGGUSD","PIXEL":"PIXELUSD",
    # DeFi
    "AAVE":"AAVEUSD","MKR":"MKRUSD","CRV":"CRVUSD","COMP":"COMPUSD",
    "SUSHI":"SUSHIUSD","SNX":"SNXUSD","LDO":"LDOUSD",
    # Staking
    "RPL":"RPLUSD","FXS":"FXSUSD",
    # Fan Token
    "CHZ":"CHZUSD","PSG":"PSGUSD","BAR":"BARUSD","JUV":"JUVUSD",
    # Infra
    "QNT":"QNTUSD",
    # Storage
    "AR":"ARUSD","STORJ":"STORJUSD",
    # NFT
    "APE":"APEUSD","BLUR":"BLURUSD",
    # POW
    "KAS":"KASUSD","DASH":"DASHUSD",
    # Polkadot
    "KSM":"KSMUSD","GLMR":"GLMRUSD","ASTR":"ASTRUSD",
    # Privacy
    "XMR":"XMRUSD","ZEC":"ZECUSD",
    # Interop
    "RUNE":"RUNEUSD",
    # Yield
    "YFI":"YFIUSD",
    # Derivatives
    "DYDX":"DYDXUSD","GMX":"GMXUSD","PERP":"PERPUSD",
    # Ethereum ecosystem
    "ENS":"ENSUSD",
    # Bitcoin ecosystem
    "STX":"STXUSD","ORDI":"ORDIUSD","SATS":"SATSUSD",
    # Cosmos
    "OSMO":"OSMOUSD",
    # Avalanche
    "JOE":"JOEUSD",
    # Tron
    "BTT":"BTTUSD","JST":"JSTUSD",
    # Forex principais
    "EURUSD":"EURUSD","GBPUSD":"GBPUSD","USDJPY":"USDJPY","AUDUSD":"AUDUSD",
    "USDCAD":"USDCAD","USDCHF":"USDCHF","NZDUSD":"NZDUSD",
    "EURGBP":"EURGBP","EURJPY":"EURJPY","GBPJPY":"GBPJPY",
    # Forex exotic/BR
    "USDBRL":"USDBRL","GBPBRL":"GBPBRL","JPYBRL":"JPYBRL",
    "AUDBRL":"AUDBRL","CADBRL":"CADBRL","CHFBRL":"CHFBRL","MXNBRL":"MXNBRL",
    "ARS":"USDBRL","AUD":"AUDUSD","CAD":"USDCAD","CHF":"USDCHF",
    "EUR":"EURUSD","GBP":"GBPUSD","JPY":"USDJPY","NZD":"NZDUSD",
    "USD":"DXY","CNY":"USDCNY","CNH":"USDCNH",
}

# ── MT5 Genial symbol map (B3/BMF) ─────────────────────────────────────────────
MT5_GENIAL_MAP = {
    # Futuros Dólar (usar $ para contrato atual)
    "DOL":"DOL$","WDO":"WDO$",
    "DOLJ25":"DOL$","DOLN25":"DOL$","DOLV25":"DOL$","DOLF26":"DOL$",
    "WDOJ25":"WDO$","WDON25":"WDO$","WDOV25":"WDO$","WDOF26":"WDO$",
    # Futuros antigos (redirecionar para atual)
    "DOLF28":"DOL$","DOLF30":"DOL$","DOLH26":"DOL$",
    "DOLJ27":"DOL$","DOLJ28":"DOL$","DOLN26":"DOL$",
    "DOLN27":"DOL$","DOLN28":"DOL$","DOLN29":"DOL$","DOLN30":"DOL$",
    "DOLV26":"DOL$","DOLV27":"DOL$","DOLV28":"DOL$",
    # Futuros DI (taxa de juros)
    "DI1":"DI1$","DI1H26":"DI1$","DI1J26":"DI1$","DI1N26":"DI1$","DI1V26":"DI1$",
    "DI1F27":"DI1$","DI1F28":"DI1$","DI1F29":"DI1$","DI1F30":"DI1$","DI1F36":"DI1$",
    # Opções DI
    "OC1":"OC1$","OC1F27":"OC1$","OC1F28":"OC1$","OC1F29":"OC1$","OC1F30":"OC1$",
    "OC1F31":"OC1$","OC1F32":"OC1$","OC1F33":"OC1$","OC1F34":"OC1$","OC1F35":"OC1$",
    "OC1F36":"OC1$","OC1F37":"OC1$","OC1F38":"OC1$","OC1F39":"OC1$","OC1F40":"OC1$",
    "OC1H26":"OC1$","OC1J26":"OC1$","OC1J27":"OC1$","OC1J28":"OC1$","OC1J29":"OC1$","OC1J30":"OC1$",
    "OC1N26":"OC1$","OC1N27":"OC1$","OC1N28":"OC1$","OC1N29":"OC1$","OC1N30":"OC1$",
    "OC1V26":"OC1$","OC1V27":"OC1$",
    # Spreads DI
    "DIF":"DIF$","DIFF27F32":"DIF$","DIFF27F35":"DIF$","DIFF27J28":"DIF$","DIFF27N28":"DIF$",
    "DIFF27V27":"DIF$","DIFF27V28":"DIF$","DIFF33F37":"DIF$","DIFF33F38":"DIF$",
    "DIFH26J26":"DIF$","DIFJ26F28":"DIF$","DIFJ26F29":"DIF$","DIFJ26F31":"DIF$","DIFJ26J27":"DIF$",
    "DIFJ27F28":"DIF$","DIFN26F29":"DIF$","DIFN26F30":"DIF$","DIFN27F30":"DIF$","DIFN27F31":"DIF$",
    "DIFN29F32":"DIF$","DIFV26F28":"DIF$","DIFV26F29":"DIF$","DIFV26F31":"DIF$",
    "DIFV27F29":"DIF$","DIFV27F30":"DIF$","DIFV27N28":"DIF$",
    # Futuros Ouro/Bitcoin
    "BGI":"BGI$","BGIO":"BGI$",
    "BIT":"BIT@","BITG26":"BIT@","BITK26":"BIT@","BITN26":"BIT@","BITU26":"BIT@","BITZ26":"BIT@",
    "ETR":"PETRPFUT","ETRG26":"PETRPFUT",
    "SOL":"SOLH26","SOLG26":"SOLH26",
    # Futuros Café/Etanol
    "SJC":"SJC$","SJCH26":"SJC$","SJCK25":"SJC$","SJCN25":"SJC$",
    "ETH":"ETHE11","ETHG26":"ETHE11",
    # Índices
    "WIN":"WIN$","IND":"IND$",
    # Euro Futuro (BMF)
    "EUR":"EUR$","EURBRL":"EUR$","EURF26":"EUR$",
    # Cupom Cambial (não têm cotação no MT5 - remover do CSV)
    # DDI
    "DDI":"DDIJ25","DDIF34":"DDIJ25","DDIF38":"DDIJ25","DDIF39":"DDIJ25","DDIF40":"DDIJ25",
    "DDIH26":"DDIJ25","DDIJ29":"DDIJ25","DDIJ30":"DDIJ25",
    "DDIN29":"DDIJ25","DDIN30":"DDIJ25","DDIV28":"DDIJ25","DDIV29":"DDIJ25",
}

# ── Símbolos sem preço real (renda fixa, stablecoins, etc) ──────────────────────
STATIC_PRICE_SYMBOLS = {
    "USDT":1.0,"USDC":1.0,"DAI":1.0,"BUSD":1.0,"FDUSD":1.0,
    "PEPE":0.00001,"SHIB":0.00001,
    "CDB":100.0,"COE":100.0,"CRA":100.0,"CRI":100.0,
    "DEBENTURE":100.0,"DEBENTURE_INC":100.0,
    "FI_RF":100.0,"LCA":100.0,"LCI":100.0,
    "LFT":100.0,"LTN":100.0,"NTN-B":100.0,"NTN-B_PRINC":100.0,
    "NTN-C":100.0,"NTN-F":100.0,"POUPANCA":100.0,
}

def resolve_symbol(symbol, broker):
    """Resolve símbolo para o formato correto do broker."""
    if broker == "pepperstone":
        return PEPP_MAP.get(symbol, symbol)
    elif broker == "mt5":
        # Primeiro verifica mapeamento específico do Genial
        if symbol in MT5_GENIAL_MAP:
            return MT5_GENIAL_MAP[symbol]
        return symbol
    return symbol

def get_static_price(symbol):
    """Retorna preço estático para símbolos sem cotação real."""
    return STATIC_PRICE_SYMBOLS.get(symbol)

def get_tf(tf_str):
    if not MT5_AVAILABLE:
        return None
    tf_map = {
        "M1":mt5.TIMEFRAME_M1,"M5":mt5.TIMEFRAME_M5,"M15":mt5.TIMEFRAME_M15,
        "M30":mt5.TIMEFRAME_M30,"H1":mt5.TIMEFRAME_H1,"H4":mt5.TIMEFRAME_H4,
        "D1":mt5.TIMEFRAME_D1,"W1":mt5.TIMEFRAME_W1,"MN1":mt5.TIMEFRAME_MN1,
    }
    return tf_map.get(tf_str.upper(), mt5.TIMEFRAME_H1)

# ── MT5 Operations ────────────────────────────────────────────────────────────
def mt5_connect(login, password, server, path=None, broker="mt5"):
    if not MT5_AVAILABLE:
        return {"error": "MetaTrader5 não instalado. Execute: pip install MetaTrader5"}
    if not isinstance(login, int) or login <= 0:
        return {"error": "Login inválido — deve ser número inteiro positivo."}
    kwargs = {"login": login, "password": password, "server": server}
    if path:
        kwargs["path"] = path
    if not mt5.initialize(**kwargs):
        return {"error": f"Falha ao inicializar MT5: {mt5.last_error()}"}
    info = mt5.account_info()
    if info is None:
        mt5.shutdown()
        return {"error": f"Conta não encontrada: {mt5.last_error()}"}
    CONNECTIONS[broker]["connected"] = True
    CONNECTIONS[broker]["account"] = f"{info.login} | {info.name} | {info.currency} | {info.server}"
    log.info("Connected [%s] %s", broker, CONNECTIONS[broker]["account"])
    return {"ok": True, "account": CONNECTIONS[broker]["account"]}

def mt5_disconnect(broker="mt5"):
    if MT5_AVAILABLE:
        mt5.shutdown()
    CONNECTIONS[broker]["connected"] = False
    CONNECTIONS[broker]["account"] = None
    return {"ok": True}

def mt5_tick(symbol, broker="mt5"):
    """Busca tick do símbolo, reconectando ao broker correto se necessário."""
    
    # Auto-detecção de broker baseado no símbolo
    if broker == "mt5":
        # Verifica se é cripto conhecido (todos os mapeados no PEPP_MAP)
        crypto_symbols = [
            'BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'ADA', 'DOGE', 'DOT', 'LINK', 'LTC', 
            'AVAX', 'ATOM', 'UNI', 'AAVE', 'MATIC', 'NEAR', 'APT', 'ARB', 'TRX', 'XLM',
            'ALGO', 'AXS', 'FIL', 'HBAR', 'ICP', 'MANA', 'OP', 'SAND', 'SHIB', 'SUI', 
            'TON', 'VET', 'XTZ', 'EOS', 'PEPE', 'BCH', 'FTM', 'INJ', 'SEI', 'CAKE',
            'XVS', 'BAND', 'RAY', 'JUP', 'BONK', 'WIF', 'ONDO', 'TRU', 'FLOKI',
            'FET', 'RNDR', 'TAO', 'GRT', 'AGIX', 'ENJ', 'ILV', 'GALA', 'IMX', 'YGG',
            'PIXEL', 'MKR', 'CRV', 'COMP', 'SUSHI', 'SNX', 'LDO', 'RPL', 'FXS',
            'CHZ', 'PSG', 'BAR', 'JUV', 'QNT', 'AR', 'STORJ', 'APE', 'BLUR',
            'KAS', 'DASH', 'KSM', 'GLMR', 'ASTR', 'XMR', 'ZEC', 'RUNE', 'YFI',
            'DYDX', 'GMX', 'PERP', 'ENS', 'STX', 'ORDI', 'SATS', 'OSMO', 'JOE',
            'BTT', 'JST'
        ]
        if symbol in crypto_symbols:
            broker = "binance"
        # Verifica se é commodity/forex conhecido
        elif symbol in PEPP_MAP or symbol in ['GC', 'SI', 'CL', 'NG', 'KC', 'ZS', 'ZW', 'ZC', 'CT', 'SB', 'LE', 'GF', 'HG', 'PA', 'PL', 'HO']:
            broker = "pepperstone"
        # Verifica se é futuro BMF
        elif symbol in MT5_GENIAL_MAP:
            broker = "mt5"  # Mantém no Genial para futuros BMF
    
    # Para cripto, busca do cache MMF (Binance)
    if broker == "binance":
        mmf = get_mmf_debug()
        for sym_data in mmf.get("symbols", []):
            if sym_data.get("symbol") == symbol and sym_data.get("exchange") == "CRYPTO":
                return {
                    "symbol": symbol,
                    "bid": sym_data.get("bid", 0),
                    "ask": sym_data.get("ask", 0),
                    "last": sym_data.get("last", 0),
                    "broker": "binance",
                    "exchange": "CRYPTO",
                    "time": sym_data.get("time", ""),
                }
        return {"error": f"Símbolo '{symbol}' não encontrado no cache Binance"}
    
    if not MT5_AVAILABLE:
        return {"error": "MetaTrader5 não disponível"}
    
    # Paths dos terminais
    paths = {
        "mt5": r"C:\Program Files\MetaTrader 5\terminal64.exe",
        "pepperstone": r"C:\Program Files\Pepperstone MetaTrader 5\terminal64.exe"
    }
    
    # Reconecta ao broker correto se necessário
    if not CONNECTIONS[broker]["connected"]:
        return {"error": f"Broker [{broker}] não está conectado"}
    
    # Inicializa MT5 com o path do broker
    broker_path = paths.get(broker)
    if broker_path and Path(broker_path).exists():
        mt5.initialize(path=broker_path)
    else:
        mt5.initialize()
    
    mt5_sym = resolve_symbol(symbol, broker)
    info = mt5.symbol_info(mt5_sym)
    if info is None:
        return {"error": f"Símbolo '{mt5_sym}' não encontrado no broker [{broker}]"}
    if not info.visible:
        mt5.symbol_select(mt5_sym, True)
    else:
        # Garante assinatura/Market Watch
        mt5.symbol_select(mt5_sym, True)
    tick = mt5.symbol_info_tick(mt5_sym)
    if tick is None:
        return {"error": f"Sem tick para '{mt5_sym}'"}

    bid = float(tick.bid or 0.0)
    ask = float(tick.ask or 0.0)
    last = float(getattr(tick, 'last', 0.0) or 0.0)

    # Fallback: em alguns ativos (fora do horário / feed) bid/ask vem 0 mas last vem válido
    if bid <= 0 and last > 0:
        bid = last
    if ask <= 0 and last > 0:
        ask = last

    spread = round((ask - bid) * 10000, 2) if ask and bid else None
    return {
        "symbol": symbol, "mt5_symbol": mt5_sym,
        "bid": bid, "ask": ask, "last": last,
        "volume": tick.volume, "spread": spread,
        "time": datetime.fromtimestamp(tick.time).strftime("%Y-%m-%d %H:%M:%S"),
    }

def mt5_ticks_batch(symbols, broker="mt5"):
    if not MT5_AVAILABLE:
        return {"error": "MetaTrader5 não disponível"}
    if not CONNECTIONS[broker]["connected"]:
        return {"error": f"Não conectado ao broker [{broker}]"}
    result, errors = {}, []
    for sym in symbols:
        r = mt5_tick(sym, broker)
        if "error" in r:
            errors.append({"symbol": sym, "error": r["error"]})
        else:
            result[sym] = r
    return {"ticks": result, "errors": errors, "count": len(result)}

def mt5_ticks_sector(sector_id, broker="mt5"):
    assets = BY_SECTOR.get(sector_id, [])
    
    # Para setores cripto, busca do cache MMF (Binance)
    if sector_id.startswith("crypto_"):
        mmf = get_mmf_debug()
        crypto_symbols = [s for s in mmf.get("symbols", []) if s.get("exchange") == "CRYPTO"]
        
        # Busca nome do setor
        sector_name = SECTORS.get(sector_id, sector_id)
        
        # Busca símbolos do cache que pertencem a este setor
        ticks = {}
        for sym_data in crypto_symbols:
            sym = sym_data.get("symbol")
            if sym and sym_data.get("bid", 0) > 0:
                ticks[sym] = {
                    "symbol": sym,
                    "bid": sym_data.get("bid"),
                    "ask": sym_data.get("ask"),
                    "last": sym_data.get("last"),
                    "broker": "binance",
                    "exchange": "CRYPTO"
                }
        return {
            "sector_id": sector_id,
            "sector_name": sector_name,
            "ticks": ticks,
            "count": len(ticks),
            "total_symbols": len(ticks),
            "errors": []
        }
    
    if not assets:
        return {"error": f"Setor '{sector_id}' não encontrado"}
    
    # Detecta broker automaticamente baseado na exchange
    exchanges = {a.get("exchange", "") for a in assets}
    if "NYSE" in exchanges and CONNECTIONS["pepperstone"]["connected"]:
        broker = "pepperstone"
    elif "BOVESPA" in exchanges and CONNECTIONS["mt5"]["connected"]:
        broker = "mt5"
    
    if not CONNECTIONS[broker]["connected"]:
        return {"error": f"Não conectado ao broker [{broker}]"}
    
    symbols = list({a["symbol"] for a in assets})
    log.info("Setor %s: buscando %d símbolos [%s]", sector_id, len(symbols), broker)
    result = mt5_ticks_batch(symbols, broker)
    result["sector_id"] = sector_id
    result["sector_name"] = SECTORS.get(sector_id, "")
    result["total_symbols"] = len(symbols)
    return result

def mt5_ticks_all(broker="mt5", exchange=None, sector_id=None, asset_type=None, limit=0):
    if not CONNECTIONS[broker]["connected"]:
        return {"error": f"Não conectado ao broker [{broker}]"}
    pool = ASSETS
    if exchange:
        pool = [a for a in pool if a["exchange"] == exchange]
    if sector_id:
        pool = [a for a in pool if a["sector_id"] == sector_id]
    if asset_type:
        pool = [a for a in pool if a["type"] == asset_type]
    seen, symbols = set(), []
    for a in pool:
        if a["symbol"] not in seen:
            seen.add(a["symbol"])
            symbols.append(a["symbol"])
    if limit > 0:
        symbols = symbols[:limit]
    total = len(symbols)
    log.info("ticks/all: %d símbolos únicos (ex=%s sec=%s type=%s) [%s]",
             total, exchange, sector_id, asset_type, broker)
    result, errors = {}, []
    for sym in symbols:
        r = mt5_tick(sym, broker)
        if "error" in r:
            errors.append({"symbol": sym, "error": r["error"]})
        else:
            result[sym] = r
    return {
        "ticks": result, "errors": errors,
        "count": len(result), "total_requested": total, "failed": len(errors),
        "filters": {"exchange": exchange, "sector_id": sector_id,
                    "type": asset_type, "limit": limit},
    }

def mt5_ohlcv(symbol, timeframe="H1", count=100, broker="mt5"):
    """Busca OHLCV real do MT5 com reconexão dinâmica.
    Ordem: mt5 (Genial para B3) → pepperstone (forex/cripto) → binance (cripto fallback)"""
    tf_map = {"M1":"1m","M5":"5m","M15":"15m","M30":"30m","H1":"1h","H4":"4h","D1":"1d","W1":"1w"}

    # Heurística: ações US (.US) tendem a estar no Pepperstone; BOVESPA no mt5 (Genial)
    if isinstance(symbol, str) and symbol.upper().endswith('.US') and CONNECTIONS.get('pepperstone', {}).get('connected'):
        broker = 'pepperstone'
    elif CONNECTIONS.get('mt5', {}).get('connected'):
        broker = 'mt5'
    
    # Lista de brokers a tentar em ordem
    brokers_to_try = [broker] + [b for b in ["mt5", "pepperstone"] if b != broker]
    
    for try_broker in brokers_to_try:
        if MT5_AVAILABLE and CONNECTIONS.get(try_broker, {}).get("connected"):
            # Reconecta ao broker correto
            broker_path = {
                "mt5": r"C:\Program Files\MetaTrader 5\terminal64.exe",
                "pepperstone": r"C:\Program Files\Pepperstone MetaTrader 5\terminal64.exe"
            }.get(try_broker)
            
            if broker_path and Path(broker_path).exists():
                mt5.shutdown()  # Fecha sessão anterior
                if not mt5.initialize(path=broker_path):
                    continue  # Tenta próximo broker
            
            mt5_sym = resolve_symbol(symbol, try_broker)
            tf = get_tf(timeframe)
            info = mt5.symbol_info(mt5_sym)
            if info is not None:
                if not info.visible:
                    mt5.symbol_select(mt5_sym, True)
                rates = mt5.copy_rates_from_pos(mt5_sym, tf, 0, count)
                if rates is not None and len(rates) > 0:
                    df = pd.DataFrame(rates)
                    df["time"] = pd.to_datetime(df["time"], unit="s").dt.strftime("%Y-%m-%d %H:%M")
                    data = [{"time":r["time"],"open":r["open"],"high":r["high"],"low":r["low"],
                              "close":r["close"],"volume":r["tick_volume"],"spread":r.get("spread")}
                            for r in df.to_dict("records")]
                    return {"symbol": symbol, "mt5_symbol": mt5_sym, "timeframe": timeframe,
                            "count": len(data), "data": data, "source": "mt5", "broker": try_broker}
    
    # Fallback para Binance (apenas cripto)
    binance_tf = tf_map.get(timeframe, "1h")
    result = get_binance_ohlcv(symbol, binance_tf, count)
    if "error" not in result:
        return result
    
    if not MT5_AVAILABLE:
        return {"error": "MetaTrader5 não disponível"}
    
    # Verifica qual broker está conectado
    connected_brokers = [b for b, c in CONNECTIONS.items() if c.get("connected")]
    if not connected_brokers:
        return {"error": "Nenhum broker conectado"}
    
    return {"error": f"Símbolo '{symbol}' não encontrado em {connected_brokers} nem na Binance"}

def mt5_symbol_info(symbol, broker="mt5"):
    if not MT5_AVAILABLE:
        return {"error": "MetaTrader5 não disponível"}
    if not CONNECTIONS[broker]["connected"]:
        return {"error": f"Não conectado ao broker [{broker}]"}
    mt5_sym = resolve_symbol(symbol, broker)
    info = mt5.symbol_info(mt5_sym)
    if info is None:
        return {"error": f"Símbolo '{mt5_sym}' não encontrado"}
    return {
        "symbol": symbol, "mt5_symbol": mt5_sym,
        "name": info.name, "description": info.description,
        "currency_base": info.currency_base, "currency_profit": info.currency_profit,
        "digits": info.digits, "point": info.point,
        "trade_contract_size": info.trade_contract_size,
        "volume_min": info.volume_min, "volume_max": info.volume_max,
        "bid": info.bid, "ask": info.ask, "visible": info.visible,
    }

def list_symbols(broker="mt5"):
    if not MT5_AVAILABLE:
        return {"error": "MetaTrader5 não disponível"}
    if not CONNECTIONS[broker]["connected"]:
        return {"error": f"Não conectado ao broker [{broker}]"}
    syms = mt5.symbols_get()
    if syms is None:
        return {"error": "Não foi possível listar símbolos"}
    return {"count": len(syms),
            "symbols": [{"name":s.name,"description":s.description,
                          "visible":s.visible,"bid":s.bid,"ask":s.ask} for s in syms]}

# ── Assets / Sectors queries ──────────────────────────────────────────────────
def get_sectors():
    """Retorna setores com contagens reais de ativos com preço."""
    # Conta ticks reais por setor
    tick_counts = {}
    mmf = get_mmf_debug()
    for sym_data in mmf.get("symbols", []):
        sym = sym_data.get("symbol", "")
        # Busca setor do símbolo no CSV
        for a in ASSETS:
            if a["symbol"] == sym:
                sid = a["sector_id"]
                tick_counts[sid] = tick_counts.get(sid, 0) + 1
                break
    
    sectors = []
    for sid, name in sorted(SECTORS.items()):
        assets = BY_SECTOR.get(sid, [])
        real_count = tick_counts.get(sid, 0)
        sectors.append({
            "sector_id": sid, 
            "sector_name": name, 
            "count": len(assets),  # Total no CSV
            "real_count": real_count,  # Com preço real
            "exchanges": sorted({a["exchange"] for a in assets}),
            "types": sorted({a["type"] for a in assets}),
        })
    
    # Adiciona setores dinâmicos para CRIPTO - Categorias da Binance
    crypto_symbols = [s for s in mmf.get("symbols", []) if s.get("exchange") == "CRYPTO"]
    
    # Categorias exatas da Binance + categorias expandidas
    bnb_chain = ["BNB", "CAKE", "BUSD", "TUSD", "FDUSD", "BGB", "LEO", "CRO", "HT", "OKB", "KCS", "MX", "BETH", "BAKE", "BUNNY", "BURGER", "CAKE", "DODO", "ELLER", "FIL", "FOR", "FRONT", "GTC", "HARD", "TWT", "ALPACA", "VENUSTRATEGY", "BSW", "QNT", "QUICK", "SXP", "TLM", "WRX"]
    solana = ["SOL", "BONK", "JUP", "RAY", "SRM", "STEP", "ATLAS", "POLIS", "FIDA", "COPE", "SAMO", "SONIC", "ORCA", "MANGO", "MNGO", "SERUM", "SLRS", "HNT", "SAMOYEDCOIN", "STARL", "WIF", "BOME", "PYTH", "JITO", "JITOSOL", "MSOL", "STSOL", "DUAL", "CLOUD", "CIVIL", "CWAR", "DAVI", "DRIFT", "ELIZA", "FINK", "GARI", "GOFX", "GRAPE", "GUAC", "KWEEN", "LST", "MBS", "MEDIA", "MONKE", "NINJA", "OBSVR", "ORCA", "PENG", "PNL", "POPCAT", "QUARRY", "RAMP", "REAL", "ROAD", "SAMO", "SBR", "SHDW", "SILLY", "SMB", "SNY", "SOLI", "SONIC", "STARS", "STEPN", "SWIM", "SWIPE", "TULIP", "VHM", "VVE", "WEN", "WOOF", "XWAS", "YFI", "ZBC"]
    rwa = ["ONDO", "MAPLE", "GOLD", "CUSD", "DUSD", "USDR", "TBT", "TBTC", "WCFG", "LQTY", "OUSG", "USTB", "BUIDL", "MNT", "USDM", "USDV", "USDY", "TETH", "TRU", "TRIBE", "FIG", "HOMES", "PROPS", "RLY", "SND", "XAI", "ZRO"]
    meme = ["DOGE", "SHIB", "PEPE", "FLOKI", "BONK", "BABYDOGE", "WIF", "BOME", "MEME", "MYRO", "NEIRO", "SPX", "MOG", "TURBO", "KEKE", "LADYS", "MOG", "PEPE2", "PIKACHU", "PONKE", "SCOTT", "TOSHI", "WEN", "WOJAK", "YTC", "CHILLGUY", "GIGACHAD", "HPOS", "MOG", "NFD", "SMOKE", "TOSHI", "TURBO", "WEN", "WOJAK", "BABYDOGE", "CAT", "CHEEMS", "DOGS", "FLOKI", "KEKE", "LADYS", "MEME", "MOG", "PEPE", "PONKE", "SHIB", "TOSHI", "TURBO", "WEN", "WOJAK", "WIF"]
    payments = ["XRP", "XLM", "XDC", "COTI", "CEL", "NEXO", "CRO", "FLEX", "TUSD", "USDC", "USDT", "BUSD", "DAI", "FRAX", "LUSD", "USDD", "USDJ", "GUSD", "BGBP", "EURS", "EURT", "XAUT", "PAXG", "DGD", "AMPL", "RSR", "XRP", "XLM", "XDC", "COTI", "CEL", "NEXO", "CRO", "FLEX"]
    ai = ["FET", "AGIX", "RNDR", "TAO", "NEURAL", "PAAL", "QNT", "AR", "FIL", "STORJ", "OCEAN", "AI", "GRT", "NMR", "OLAS", "ORAI", "PHB", "RLC", "ROSE", "TRAC", "WLD", "WLD", "ZK", "ZPRO", "0X0", "AION", "AKASH", "ALEPH", "ARPA", "AUTONOMOUS", "BAND", "BIC", "BIT", "BOTTOS", "CERE", "CHAIN", "CIPHER", "COVA", "CUDOS", "DIA", "DIMENSION", "ECHAIN", "ELF", "ENDOR", "FETCH", "FET", "GNT", "GO", "GRID", "GRT", "HIGH", "HOLO", "IEXEC", "IOTEX", "KARL", "LAYER", "LTO", "MATH", "MIR", "NKN", "NOIA", "NU", "NUMERAI", "OCEAN", "ORAI", "ORBS", "OST", "PNT", "POLKASTARTER", "QNT", "QUANT", "RADAR", "RADICLE", "RARI", "RLC", "ROSE", "SIA", "SONM", "STORJ", "STREAMR", "SYNAPSE", "TAO", "TELEPORT", "THETA", "TOKO", "UPTREND", "VORTE", "WLD", "XMO", "ZPRO"]
    layer1_layer2 = ["BTC", "ETH", "SOL", "ADA", "AVAX", "DOT", "ATOM", "LTC", "BCH", "XRP", "XLM", "TRX", "NEAR", "ALGO", "XTZ", "EOS", "VET", "ICP", "FIL", "THETA", "FTM", "RUNE", "KAVA", "MATIC", "ARB", "OP", "IMX", "METIS", "BOBA", "ZIL", "KSM", "CELO", "MINA", "APT", "SUI", "SEI", "INJ", "TIA", "MANTA", "BLUR", "STRK", "LINEA", "SCROLL", "ZKSYNC", "STARKNET", "POLYGON", "ARBITRUM", "OPTIMISM", "BASE", "BLAST", "MODE", "MANTLE", "AVALANCHE", "FANTOM", "HARMONY", "CRONOS", "KADENA", "KAVA", "KUSAMA", "OASIS", "PARALLEL", "POLKADOT", "RADIX", "SORA", "SUBSTRATE", "TEZOS", "WAVES", "ZENON"]
    metaverse = ["MANA", "SAND", "AXS", "ENJ", "ILV", "GALA", "MAGIC", "PYR", "ALICE", "SLP", "WEMIX", "RFOX", "SIPHER", "WILD", "HIGH", "TVK", "MONA", "RARI", "SUPER", "BAL", "CUBE", "DEAP", "DPET", "ERN", "FOTA", "GODS", "HERO", "HOT", "IN", "KLAY", "MCE", "MIST", "NFT", "OVR", "PLOT", "PUNK", "RBN", "REV", "RIN", "SAND", "SKILL", "SLP", "STARL", "STG", "TLM", "TOKE", "TRU", "TUSD", "UOS", "VAI", "WAXP", "WILD", "YGG"]
    gaming = ["MANA", "SAND", "AXS", "ENJ", "ILV", "GALA", "IMX", "MAGIC", "PYR", "ALICE", "SLP", "WEMIX", "GAME", "MCADE", "RIA", "GODS", "HIGH", "TVK", "MONA", "RARI", "SUPER", "BETA", "BICO", "BTR", "CUBE", "DEAP", "DPET", "ERN", "FOTA", "GODS", "HERO", "HOT", "IN", "KLAY", "MCE", "MIST", "NFT", "OVR", "PLOT", "PUNK", "RBN", "REV", "RIN", "SAND", "SKILL", "SLP", "STARL", "STG", "TLM", "TOKE", "TRU", "TUSD", "UOS", "VAI", "WAXP", "WILD", "YGG", "GALA", "IMX", "MAGIC", "PYR", "ALICE", "SLP", "WEMIX", "GAME", "MCADE", "RIA"]
    defi = ["UNI", "AAVE", "COMP", "MKR", "SNX", "CRV", "SUSHI", "1INCH", "YFI", "BAL", "ZRX", "CAKE", "GRT", "LINK", "BAND", "REN", "KNC", "LON", "LRC", "PERP", "RPL", "LDO", "RocketPool", "INST", "INSTADAPP", "PARASWAP", "COW", "COWSWAP", "0X", "MATCHA", "DEX", "AGGREGATOR", "SUSHISWAP", "TRISOLARIS", "SOLARIS", "JUPITER", "ORCA", "RAYDIUM", "SERUM", "ABRACADABRA", "SPELL", "ICE", "MIM", "YFI", "YEARN", "PICKLE", "HARVEST", "BADGER", "SET", "TOKENSETS", "DPI", "BED", "DATA", "INDEX", "ICHI", "ONE", "FARM", "HARVEST", "PICKLE", "YEARNA", "YVECRV", "YVBOOST", "PWR", "POWER", "YFI", "YFIM", "YFII", "YFIS", "YFIVE", "YFIMX", "YFIONE", "YFT", "YFV", "YFDELTA", "YFSG", "YFTHETA", "YFLINK", "YFO", "YFION", "YFSENSE", "YFPRO", "YFBETA", "YFALPHA", "YFGAMMA", "YFDELTA", "YFZETA", "YFETA", "YFIOTA", "YFKAPPA", "YFLAMBDA", "YFMU", "YFNU", "YFXI", "YFOMICRON", "YFPI", "YFRHO", "YFSIGMA", "YFTAU", "YFUPSILON", "YFPHI", "YFCHI", "YFPSI", "YFOMEGA"]
    liquid_staking = ["LDO", "RPL", "CBETH", "RETH", "STETH", "MATICX", "STMATIC", "SOL", "JITOSOL", "MSOL", "STSOL", "ANALOS", "BLZE", "BUTTER", "COCO", "DUAL", "FLWR", "GARI", "GHOST", "GHOST", "GUAC", "HNT", "JITOSOL", "KWEEN", "LST", "MBS", "MEDIA", "MONKE", "NINJA", "OBSVR", "ORCA", "PENG", "PNL", "POPCAT", "QUARRY", "RAMP", "REAL", "ROAD", "SAMO", "SBR", "SHDW", "SILLY", "SMB", "SNY", "SOLI", "SONIC", "STARS", "STEPN", "SWIM", "SWIPE", "TULIP", "VHM", "VVE", "WEN", "WOOF", "XWAS", "YFI", "ZBC"]
    fan_token = ["CITY", "PSG", "JUV", "BAR", "ATM", "ASR", "LAZIO", "PORTO", "SANTOS", "ALPINE", "AFA", "OG", "NAVI", "ACM", "ASR", "ATM", "BAR", "CITY", "GAL", "INTER", "JUV", "LAZIO", "MEN", "NAVI", "OG", "PAG", "PORTO", "PSG", "SANTOS", "TFC", "VAL", "VCF", "YBO"]
    infrastructure = ["LINK", "GRT", "BAND", "API3", "DIA", "PARA", "LAYER", "POLYGON", "ARBITRUM", "OPTIMISM", "CHAINLINK", "THEGRAPH", "BANDPROTOCOL", "API3", "DIA", "PARACHUTE", "LAYERZERO", "POLYGON", "ARBITRUM", "OPTIMISM", "BASE", "BLAST", "MODE", "MANTLE", "AVALANCHE", "FANTOM", "HARMONY", "CRONOS", "KADENA", "KAVA", "KUSAMA", "OASIS", "PARALLEL", "POLKADOT", "RADIX", "SORA", "SUBSTRATE", "TEZOS", "WAVES", "ZENON"]
    storage = ["FIL", "AR", "STORJ", "SC", "BTT", "BLZ", "MAID", "SIACOIN", "FILECOIN", "ARWEAVE", "STORJ", "SIACOIN", "BITTORRENT", "BLAZEL", "MAIDSAFECOIN", "SC", "BTT", "BLZ", "MAID", "SC"]
    nft = ["MATIC", "ENJ", "MANA", "SAND", "AXS", "GALA", "IMX", "RARI", "SUPER", "NFT", "WAXP", "RARI", "SUPER", "AZUKI", "BAYC", "CRYPTOPUNKS", "DOODLES", "MEEBITS", "MOONBIRDS", "CLONEX", "DOODLES", "WORLDOFWOMEN", "BEEPLE", "FEWOCIOUS", "TYLERXHOBBS", "XCOPY", "PUNKS", "BAYC", "MAYC", "BAKC", "CRYPTOPUNKS", "AZUKI", "BEANZ", "CLONEX", "MOONBIRDS", "DOODLES", "MEEBITS", "WORLDWOMEN", "COOLCATS", "BOREDAPES", "MUTANTAPES", "DOGS", "POODL", "PUNK", "RARI", "SUPER", "WAXP"]
    pow = ["BTC", "LTC", "BCH", "DOGE", "XMR", "ZEC", "DASH", "ETC", "RVN", "DCR", "KAS", "SC", "BITCOIN", "LITECOIN", "BITCOINCASH", "DOGECOIN", "MONERO", "ZCASH", "DASH", "ETHEREUMCLASSIC", "RAVENCoin", "DECRED", "KASPA", "SIACOIN"]
    polkadot = ["DOT", "KSM", "ACA", "ASTR", "GLMR", "PARA", "SUB", "ZLK", "INTR", "TEER", "KILT", "POLKADOT", "KUSAMA", "ACALA", "ASTAR", "MOONBEAM", "PARALLEL", "SUBSTRATE", "ZENLINK", "INTEGRITEE", "KILT", "CENTRIFUGE", "HYDRADX", "INTERLAY", "KARURA", "KHALA", "OAK", "PHALA", "ROBONOMICS", "SHIDEN", "SUBSOCIAL", "UNIQUE"]
    launchpad = ["BGB", "LAZIO", "PORTO", "SANTOS", "ALPINE", "CITY", "DOT", "MATIC", "AXS", "SAND", "BITLEX", "LAUNCHPAD", "BGB", "LAZIO", "PORTO", "SANTOS", "ALPINE", "CITY", "DOT", "MATIC", "AXS", "SAND"]
    seed = ["MEME", "NFP", "XAI", "MANTA", "JUP", "W", "ALT", "PIXEL", "STRK", "MANTA", "ONDO", "SEED", "EARLY", "PRESALE", "ICO", "IDO", "IEO", "LAUNCH", "NEW", "SEED", "MEME", "NFP", "XAI", "MANTA", "JUP", "W", "ALT", "PIXEL", "STRK", "ONDO"]
    # Novas categorias expandidas
    privacy = ["XMR", "ZEC", "DASH", "BEAM", "GRIN", "FIRO", "NAV", "PIVX", "XVG", "ZEN", "SCRT", "ROSE", "KEEP", "TRAC", "NYM", "HORUS", "MWC", "AEON", "BIP", "BTE", "CLOAK", "DNET", "DYN", "ECN", "ENC", "GRC", "HNC", "KMD", "LBC", "LYNX", "MUE", "NIX", "PART", "RDD", "SUMO", "TRTL", "VTC", "XHV", "XMY", "XSH", "XUE", "ZCL", "ZEPH"]
    exchange = ["BNB", "CRO", "KCS", "FTT", "HT", "OKB", "BGB", "MX", "LEO", "BUSD", "TUSD", "FDUSD", "USDC", "USDT", "DAI", "FRAX", "LUSD", "USDD", "USDJ", "GUSD", "BGBP", "EURS", "EURT", "XAUT", "PAXG", "DGD", "AMPL", "RSR", "KNC", "BNT", "LRC", "1INCH", "SUSHI", "UNI", "CAKE", "PANCAKESWAP", "SUSHISWAP", "UNISWAP", "BINANCE", "COINBASE", "KRAKEN", "FTX", "HUOBI", "OKEX", "BITTREX", "POLONIEX", "KUCOIN", "GATE", "BYBIT", "MEXC", "BITFINEX", "BITSTAMP", "BITTREX", "POLONIEX", "KUCOIN", "GATE", "BYBIT", "MEXC"]
    stablecoins = ["USDT", "USDC", "DAI", "BUSD", "FDUSD", "TUSD", "USDD", "FRAX", "LUSD", "USDJ", "GUSD", "BGBP", "EURS", "EURT", "XAUT", "PAXG", "DGD", "AMPL", "RSR", "UST", "MIM", "FRAX", "LUSD", "USDD", "USDJ", "GUSD", "BGBP", "EURS", "EURT", "XAUT", "PAXG", "DGD", "AMPL", "RSR"]
    interoperability = ["ATOM", "DOT", "LINK", "RUNE", "AXL", "ZRO", "LAYER", "SYN", "CELAR", "MAP", "ROUTER", "GRAVITY", "SOCKET", "LAYERZERO", "WORMHOLE", "MULTICHAIN", "SYNAPSE", "CELER", "MAPPROTOCOL", "ROUTERPROTOCOL", "GRAVITYBRIDGE", "SOCKET", "LAYERZERO", "WORMHOLE", "MULTICHAIN", "SYNAPSE"]
    yield_aggregators = ["YFI", "PICKLE", "HARVEST", "BADGER", "SET", "DPI", "BED", "DATA", "INDEX", "ICHI", "ONE", "FARM", "YEARN", "YVECRV", "YVBOOST", "PWR", "POWER", "YFI", "YFIM", "YFII", "YFIS", "YFIVE", "YFIMX", "YFIONE", "YFT", "YFV", "YFDELTA", "YFSG", "YFTHETA", "YFLINK", "YFO", "YFION", "YFSENSE", "YFPRO", "YFBETA", "YFALPHA", "YFGAMMA", "YFDELTA", "YFZETA", "YFETA", "YFIOTA", "YFKAPPA", "YFLAMBDA", "YFMU", "YFNU", "YFXI", "YFOMICRON", "YFPI", "YFRHO", "YFSIGMA", "YFTAU", "YFUPSILON", "YFPHI", "YFCHI", "YFPSI", "YFOMEGA"]
    derivatives = ["DYDX", "GMX", "GNS", "PERP", "APEX", "LEVEL", "MUX", "VELA", "SYNTHETIX", "SNX", "KWENTA", "POLYMARKET", "THALES", "LYRA", "DERI", "HEDGE", "OPYN", "HEGIC", "FINN", "GRIN", "MYC", "NFT", "PERP", "PREMIA", "RIBBON", "SIREN", "VOLMEX", "ZHE", "DYDX", "GMX", "GNS", "PERP", "APEX", "LEVEL", "MUX", "VELA"]
    lending = ["AAVE", "COMP", "MKR", "CRV", "CONVEX", "FRAX", "LQTY", "YFI", "YFI", "YEARN", "COMPOUND", "AAVE", "MAKERDAO", "CURVE", "CONVEX", "FRAX", "LQTY", "YFI", "YEARN", "PICKLE", "HARVEST", "BADGER", "SET", "DPI", "BED", "DATA", "INDEX", "ICHI", "ONE", "FARM", "YEARN", "YVECRV", "YVBOOST", "PWR", "POWER"]
    insurance = ["NEXO", "CEL", "DPI", "INSURANCE", "BRIDGE", "MUTUAL", "NEXUS", "OPYN", "HEGIC", "COVER", "NEXUS", "INSURACE", "BRIDGE", "MUTUAL", "NEXO", "CEL", "DPI", "INSURANCE", "BRIDGE", "MUTUAL", "NEXUS", "OPYN", "HEGIC", "COVER", "NEXUS", "INSURACE"]
    prediction_markets = ["POLYMARKET", "AUGUR", "GNOSIS", "OLYMPUS", "PRODE", "THALES", "AZURO", "SX", "POLYMARKET", "AUGUR", "GNOSIS", "OLYMPUS", "PRODE", "THALES", "AZURO", "SX"]
    # Mais categorias para cobrir ativos restantes
    ethereum_ecosystem = ["ETH", "ENS", "LDO", "RPL", "UNI", "AAVE", "COMP", "MKR", "SNX", "CRV", "SUSHI", "1INCH", "YFI", "BAL", "ZRX", "KNC", "LRC", "REN", "PERP", "INST", "COW", "GRT", "API3", "DIA", "BAND", "LINK", "LON", "RARI", "SUPER", "MANA", "SAND", "AXS", "ENJ", "ILV", "GALA", "IMX", "MAGIC", "PYR", "ALICE", "SLP", "HIGH", "TVK", "MONA", "OVR", "PUNK", "RBN", "REV", "RIN", "SKILL", "STG", "TLM", "TOKE", "UOS", "VAI", "WAXP", "WILD", "YGG", "NFT", "RARI", "SUPER", "ENS", "LDO", "RPL", "CBETH", "RETH", "STETH", "MATICX", "STMATIC", "FRAX", "LUSD", "USDC", "DAI", "BUSD", "TUSD", "FDUSD", "USDT", "USDD", "USDJ", "GUSD", "BGBP", "EURS", "EURT", "XAUT", "PAXG", "DGD", "AMPL", "RSR", "UST", "MIM", "FRAX", "LUSD", "USDD", "USDJ", "GUSD", "BGBP", "EURS", "EURT", "XAUT", "PAXG", "DGD", "AMPL", "RSR"]
    bitcoin_ecosystem = ["BTC", "BCH", "BSV", "BTG", "BTD", "BTV", "BCD", "BTCP", "BTF", "BTM", "BTS", "BTWT", "BUB", "B2X", "BCX", "BPA", "BRAINS", "BRZ", "BSV", "BT2", "BTG", "BTH", "BTM", "BTN", "BTO", "BTS", "BTT", "BTU", "BTW", "BTX", "BTY", "BTZ", "BUB", "BUC", "BUD", "BUG", "BUK", "BUL", "BUM", "BUN", "BUO", "BUP", "BUR", "BUS", "BUT", "BUU", "BUV", "BUW", "BUX", "BUY", "BUZ", "BVA", "BVB", "BVC", "BVD", "BVE", "BVF", "BVG", "BVH", "BVI", "BVJ", "BVK", "BVL", "BVM", "BVN", "BVO", "BVP", "BVQ", "BVR", "BVS", "BVT", "BVU", "BVV", "BVW", "BVX", "BVY", "BVZ", "BWA", "BWB", "BWC", "BWD", "BWE", "BWF", "BWG", "BWH", "BWI", "BWJ", "BWK", "BWL", "BWM", "BWN", "BWO", "BWP", "BWQ", "BWR", "BWS", "BWT", "BWU", "BWV", "BWW", "BWX", "BWY", "BWZ", "BXA", "BXB", "BXC", "BXD", "BXE", "BXF", "BXG", "BXH", "BXI", "BXJ", "BXK", "BXL", "BXM", "BXN", "BXO", "BXP", "BXQ", "BXR", "BXS", "BXT", "BXU", "BXV", "BXW", "BXX", "BXY", "BXZ", "BYA", "BYB", "BYC", "BYD", "BYE", "BYF", "BYG", "BYH", "BYI", "BYJ", "BYK", "BYL", "BYM", "BYN", "BYO", "BYP", "BYQ", "BYR", "BYS", "BYT", "BYU", "BYV", "BYW", "BYX", "BYY", "BYZ", "BZA", "BZB", "BZC", "BZD", "BZE", "BZF", "BZG", "BZH", "BZI", "BZJ", "BZK", "BZL", "BZM", "BZN", "BZO", "BZP", "BZQ", "BZR", "BZS", "BZT", "BZU", "BZV", "BZW", "BZX", "BZY", "BZZ", "WBTC", "TBTC", "RBTC", "LBTC", "SBTC", "HBTC", "PBTC", "IBTC", "MBTC", "ABTC", "EBTC", "FBTC", "GBTC", "NBTC", "OBTC", "QBTC", "TBTC", "VBTC", "WBTC", "XBTC", "YBTC", "ZBTC"]
    cosmos_ecosystem = ["ATOM", "OSMO", "JUNO", "SCRT", "CRO", "RUNE", "AKT", "INJ", "KAVA", "HARD", "IRIS", "IOV", "LIKE", "DVPN", "REGEN", "STARNAME", "IXO", "MED", "BAND", "CERTIK", "SENTINEL", "LUNA", "UST", "KRT", "MIR", "MNT", "ANC", "ORION", "VOT", "VKR", "WHALE", "BETH", "APOLLO", "AUST", "PSI", "STT", "TGD", "TNS", "TULIP", "VAL", "VKR", "VRS", "WHALE", "XDEFI", "ZIL", "ZRX"]
    avalanche_ecosystem = ["AVAX", "JOE", "PNG", "SNOB", "ELK", "YAK", "BAG", "GMX", "BENQI", "XPLA", "CRA", "COQ", "KIMCHI", "PEFI", "SNOW", "WOO", "YAK", "ZABU", "0X0", "AAVE", "COMP", "CRV", "DAI", "LINK", "SUSHI", "UNI", "USDC", "USDT", "WBTC", "WETH"]
    polygon_ecosystem = ["MATIC", "AAVE", "QUICK", "SUSHI", "UNI", "WBTC", "WETH", "USDC", "USDT", "DAI", "LINK", "CRV", "COMP", "BAL", "YFI", "SNX", "REN", "KNC", "LRC", "1INCH", "ZRX", "BAND", "API3", "DIA", "GRT", "INST", "COW", "LON", "RARI", "SUPER", "MANA", "SAND", "AXS", "ENJ", "ILV", "GALA", "IMX", "MAGIC", "PYR", "ALICE", "SLP", "HIGH", "TVK", "MONA", "OVR", "PUNK", "RBN", "REV", "RIN", "SKILL", "STG", "TLM", "TOKE", "UOS", "VAI", "WAXP", "WILD", "YGG", "NFT", "RARI", "SUPER"]
    arbitrum_ecosystem = ["ARB", "GMX", "GNS", "JOE", "SUSHI", "UNI", "AAVE", "COMP", "CRV", "LINK", "BAL", "YFI", "SNX", "REN", "KNC", "LRC", "1INCH", "ZRX", "BAND", "API3", "DIA", "GRT", "INST", "COW", "LON", "RARI", "SUPER", "MANA", "SAND", "AXS", "ENJ", "ILV", "GALA", "IMX", "MAGIC", "PYR", "ALICE", "SLP", "HIGH", "TVK", "MONA", "OVR", "PUNK", "RBN", "REV", "RIN", "SKILL", "STG", "TLM", "TOKE", "UOS", "VAI", "WAXP", "WILD", "YGG", "NFT", "RARI", "SUPER", "RDNT", "GRV", "XGRAV", "SPA", "SFUND", "PAD", "VSTA", "VST", "GMX", "GNS", "JOE", "SUSHI", "UNI", "AAVE", "COMP", "CRV", "LINK", "BAL", "YFI", "SNX", "REN", "KNC", "LRC", "1INCH", "ZRX"]
    optimism_ecosystem = ["OP", "VELO", "SNX", "KWENTA", "THALES", "LYRA", "PERP", "UNI", "AAVE", "COMP", "CRV", "LINK", "BAL", "YFI", "REN", "KNC", "LRC", "1INCH", "ZRX", "BAND", "API3", "DIA", "GRT", "INST", "COW", "LON", "RARI", "SUPER", "MANA", "SAND", "AXS", "ENJ", "ILV", "GALA", "IMX", "MAGIC", "PYR", "ALICE", "SLP", "HIGH", "TVK", "MONA", "OVR", "PUNK", "RBN", "REV", "RIN", "SKILL", "STG", "TLM", "TOKE", "UOS", "VAI", "WAXP", "WILD", "YGG", "NFT", "RARI", "SUPER", "BEAM", "BOND", "DPI", "ELK", "GALA", "HOP", "JUV", "KNC", "LYRA", "OP", "PERP", "PSG", "SNX", "SONNE", "THALES", "UMA", "UNI", "VELO", "WOO", "XBOY", "YFI"]
    binance_ecosystem = ["BNB", "BUSD", "TUSD", "FDUSD", "USDC", "USDT", "DAI", "FRAX", "LUSD", "USDD", "USDJ", "GUSD", "BGBP", "EURS", "EURT", "XAUT", "PAXG", "DGD", "AMPL", "RSR", "CAKE", "BUNNY", "BURGER", "BAKE", "DODO", "ELLER", "FIL", "FOR", "FRONT", "GTC", "HARD", "TWT", "ALPACA", "VENUSTRATEGY", "BSW", "QNT", "QUICK", "SXP", "TLM", "WRX", "BETH", "BIFI", "BSCS", "BSCPAD", "BSCSTATION", "BSCFARM", "BSCGEMS", "BSCGROW", "BSCGURU", "BSCGURU", "BSCID", "BSCLEAGUE", "BSCPAD", "BSCPEOPLE", "BSCPLANET", "BSCPLAY", "BSCPOKER", "BSCPOLICY", "BSCPOOL", "BSCPOWER", "BSCPRIVACY", "BSCPROJECT", "BSCQUEST", "BSCRUG", "BSCSANTA", "BSCSHIB", "BSCSNIPE", "BSCSPORT", "BSCSTAKE", "BSCSTAR", "BSCSTATION", "BSCSWAP", "BSCTECH", "BSCVAULT", "BSCVIP", "BSCWORLD", "BSCX", "BSCY", "BSCZ"]
    tron_ecosystem = ["TRX", "BTT", "JST", "SUN", "WIN", "ANTE", "DLIVE", "SEED", "TUSD", "USDD", "USDT", "WINK", "BTC", "ETH", "LTC", "BCH", "DOGE", "XRP", "XLM", "ADA", "DOT", "ATOM", "LINK", "UNI", "AAVE", "COMP", "MKR", "SNX", "CRV", "SUSHI", "1INCH", "YFI", "BAL", "ZRX", "KNC", "LRC", "REN", "PERP", "INST", "COW", "GRT", "API3", "DIA", "BAND", "LON", "RARI", "SUPER", "MANA", "SAND", "AXS", "ENJ", "ILV", "GALA", "IMX", "MAGIC", "PYR", "ALICE", "SLP", "HIGH", "TVK", "MONA", "OVR", "PUNK", "RBN", "REV", "RIN", "SKILL", "STG", "TLM", "TOKE", "UOS", "VAI", "WAXP", "WILD", "YGG", "NFT", "RARI", "SUPER"]
    cardano_ecosystem = ["ADA", "SUNDAE", "MIN", "MILK", "INDY", "WMT", "MELD", "LENFI", "LQ", "DJED", "SHEN", "COTI", "CLAY", "MILK", "MIN", "MELD", "INDY", "WMT", "SUNDAE", "LQ", "DJED", "SHEN", "COTI", "CLAY", "AGIX", "WING", "FLICK", "NEWM", "BOOK", "HOSKY", "SNEK", "BANK", "LEOS", "ARIA", "CCDAO", "CLAY", "DANDELION", "DESO", "DNA", "DRIP", "DSTOR", "FACT", "FREED", "GAME", "GLOW", "HUNT", "JPG", "KELP", "KILN", "LITTLE", "MARLIN", "MCC", "MOSAIC", "MUSIC", "MYR", "NAMI", "NFT", "NORA", "OCTA", "ORC", "PAV", "PEEP", "PEPE", "PINE", "PLANET", "PLUS", "POTION", "PRAIRIE", "QUANT", "RADIAN", "RAFFLE", "RATS", "REAP", "REAPV", "REVU", "RJPG", "ROCKET", "RVC", "SHAN", "SHEEP", "SING", "SNEK", "SOUL", "SPACE", "SPICE", "SPN", "STAMP", "STAR", "STORK", "SUNDAE", "SUNSET", "TAD", "TANGO", "TESS", "TINY", "TOWER", "TRVL", "VYFI", "WADA", "WALLET", "WAVE", "WING", "WMT", "XMON", "YACI", "YUMMI", "ZOMBIE"]
    algorand_ecosystem = ["ALGO", "USDC", "USDT", "GOVT", "OPUL", "YLDY", "SMILE", "AKITA", "KEY", "CHOICE", "COIN", "GARD", "PLANET", "ALGOMUSIC", "ALGOWORLD", "ALGOWORLDGEMS", "ALGOWORLDGOLD", "ALGOWORLDPUNKS", "ALGOWORLDTRASH", "ALGOWORLDVIP", "ALGOWORLDVIPGOLD", "ALGOWORLDVIPPLATINUM", "ALGOWORLDVIPSILVER", "ALGOWORLDVIPDIAMOND", "ALGOWORLDVIPBRONZE", "ALGOWORLDVIPRUBY", "ALGOWORLDVIPEMERALD", "ALGOWORLDVIPSAPPHIRE", "ALGOWORLDVIPAMETHYST", "ALGOWORLDVIPTOPAZ", "ALGOWORLDVIPJADE", "ALGOWORLDVIPPEARL", "ALGOWORLDVIPCRYSTAL", "ALGOWORLDVIPGARNET", "ALGOWORLDVIPTURQUOISE", "ALGOWORLDVIPAQUAMARINE", "ALGOWORLDVIPDIAMOND", "ALGOWORLDVIPRUBY", "ALGOWORLDVIPEMERALD", "ALGOWORLDVIPSAPPHIRE", "ALGOWORLDVIPAMETHYST", "ALGOWORLDVIPTOPAZ", "ALGOWORLDVIPJADE", "ALGOWORLDVIPPEARL", "ALGOWORLDVIPCRYSTAL", "ALGOWORLDVIPGARNET", "ALGOWORLDVIPTURQUOISE", "ALGOWORLDVIPAQUAMARINE"]
    near_ecosystem = ["NEAR", "USDC", "USDT", "DAI", "REF", "SKYWARD", "OCT", "TRISOLARIS", "AURORA", "AURORABOREALIS", "SWEAT", "PILLAR", "PARAS", "MINTBASE", "FLIPPY", "NEARPAD", "JUMBO", "SHARD", "SHARDORM", "TENCENT", "HAPI", "CREAM", "BRRR", "BETH", "BOO", "BOREALIS", "BOS", "CAN", "CANARY", "CAP", "CERE", "CITRUS", "COCO", "COFFEE", "COIN", "COSMOS", "COURT", "CROWN", "CRYSTAL", "CUBE", "DAIR", "DARLING", "DEBANK", "DEFI", "DEGEN", "DODO", "DOLLAR", "DRAGON", "DROP", "EARN", "ECHO", "EDGE", "EGG", "ELITE", "EMERALD", "EMOJI", "ENERGY", "EPIC", "ESSENCE", "EURO", "EVOLUTION", "EXCHANGE", "FAME", "FAN", "FARM", "FASHION", "FATE", "FEAR", "FESTIVAL", "FIGHT", "FILM", "FIRE", "FISH", "FLAME", "FLASH", "FLEA", "FLOWER", "FOOD", "FOOTBALL", "FORCE", "FOREST", "FORTUNE", "FOX", "FRAME", "FREE", "FREEDOM", "FROG", "FROST", "FRUIT", "FUTURE", "GALAXY", "GAME", "GAMING", "GARDEN", "GATE", "GEM", "GENESIS", "GENIUS", "GHOST", "GIFT", "GIG", "GIRL", "GLASS", "GLOBE", "GLOW", "GOD", "GOLD", "GOLF", "GOVERNANCE", "GRAPE", "GRAVITY", "GREEN", "GRID", "GRIFFIN", "GROWTH", "GUARD", "GUILD", "GURU", "HACKER", "HAMMER", "HAND", "HARMONY", "HARVEST", "HAWK", "HAZE", "HEAD", "HEALTH", "HEART", "HEAVEN", "HELMET", "HELP", "HERO", "HIDE", "HIGH", "HILL", "HINT", "HIVE", "HONEY", "HOPE", "HORSE", "HOSPITAL", "HOTEL", "HOUSE", "HUB", "HUMAN", "HUNTER", "HYBRID", "HYDRO", "HYPER", "ICE", "ICON", "IDEA", "IDOL", "IGNITE", "IMAGE", "IMMORTAL", "IMPERIUM", "INDEX", "INFINITY", "INFO", "INNOVATION", "INSIGHT", "INSPIRE", "INSTANT", "INTEL", "INTELLIGENCE", "INTENT", "INTERNET", "INVEST", "INVINCIBLE", "IRON", "ISLAND", "IVORY", "JADE", "JAGUAR", "JAZZ", "JELLY", "JEWEL", "JOB", "JOY", "JUDGE", "JUICE", "JUMBO", "JUNGLE", "JUSTICE", "KARMA", "KEY", "KINGDOM", "KNIGHT", "KNOWLEDGE", "KRYPTON", "LAB", "LADDER", "LAKE", "LAMBORGHINI", "LAND", "LANGUAGE", "LAPTOP", "LASER", "LAUNCH", "LAVA", "LAW", "LAYER", "LEADER", "LEAGUE", "LEARN", "LEATHER", "LEGEND", "LEMON", "LENS", "LEOPARD", "LEVEL", "LIBERTY", "LIFE", "LIGHT", "LIGHTNING", "LIMIT", "LINE", "LINK", "LION", "LIQUID", "LIST", "LITTER", "LITTLE", "LIVE", "LIZARD", "LOAN", "LOBSTER", "LOGIC", "LOGO", "LONG", "LOTUS", "LOVE", "LUCID", "LUCK", "LUMEN", "LUNAR", "LUXURY", "LYNX", "MACHINE", "MADNESS", "MAGIC", "MAGNET", "MAKER", "MAMMOTH", "MANA", "MANAGER", "MANGO", "MAP", "MARBLE", "MARS", "MASK", "MASTER", "MATRIX", "MATTER", "MAXIMUM", "MEADOW", "MEAL", "MEDAL", "MEDIA", "MEDICINE", "MEDIUM", "MEGA", "MELON", "MEMBER", "MEMORY", "MENTOR", "MERCURY", "MERGER", "MERLIN", "META", "METAL", "METEOR", "METRO", "MICRO", "MIGHT", "MILE", "MILK", "MILLION", "MIND", "MINE", "MINERAL", "MINI", "MINOTAUR", "MINT", "MIRROR", "MISSION", "MIST", "MIX", "MOBILE", "MODE", "MODERN", "MOMENT", "MONEY", "MONKEY", "MONSTER", "MOON", "MORNING", "MOTION", "MOTOR", "MOUNTAIN", "MOUSE", "MOVIE", "MUDDY", "MULTI", "MUSEUM", "MUSHROOM", "MUSIC", "MUSTANG", "MYSTERY", "NANO", "NATURE", "NAVY", "NEAR", "NEBULA", "NEED", "NEON", "NERVE", "NEST", "NET", "NETWORK", "NEURAL", "NEUTRON", "NEW", "NEWS", "NEXUS", "NFT", "NIGHT", "NINJA", "NIRVANA", "NOBLE", "NODE", "NORDIC", "NORTH", "NOTE", "NOTICE", "NOVA", "NUCLEUS", "NUMBER", "NURSE", "OASIS", "OCEAN", "OCTOPUS", "ODYSSEY", "OFFER", "OFFICE", "OIL", "OLYMPUS", "OMEGA", "ONE", "ONION", "ONLINE", "ONYX", "OPEN", "OPERATION", "OPINION", "OPTICS", "OPTIMISM", "ORACLE", "ORANGE", "ORBIT", "ORDER", "ORE", "ORGAN", "ORIGIN", "ORION", "ORNAMENT", "ORACLE", "OSCAR", "OUTPOST", "OWL", "OXYGEN", "OZONE", "PACIFIC", "PALACE", "PALM", "PANDA", "PAPER", "PARADISE", "PARADOX", "PARALLEL", "PARCEL", "PARK", "PARROT", "PARTY", "PASSION", "PASSPORT", "PASSWORD", "PAST", "PATENT", "PATH", "PATROL", "PATTERN", "PAVE", "PAWN", "PEACE", "PEARL", "PEDESTAL", "PEER", "PEGASUS", "PEN", "PENGUIN", "PENNY", "PEPPER", "PERCEPTION", "PERFECT", "PERFUME", "PERIOD", "PERL", "PERMISSION", "PERSPECTIVE", "PET", "PETAL", "PETROL", "PHANTOM", "PHASE", "PHENIX", "PHILOSOPHY", "PHOENIX", "PHONE", "PHOTO", "PHYSICS", "PIANO", "PICTURE", "PIECE", "PIG", "PILOT", "PINE", "PIONEER", "PIPE", "PIRATE", "PISTON", "PIXEL", "PIZZA", "PLACE", "PLAN", "PLANET", "PLASMA", "PLASTIC", "PLATE", "PLATFORM", "PLAY", "PLAYER", "PLAZA", "PLEDGE", "PLOT", "PLUG", "PLUNGE", "PLUS", "POCKET", "POEM", "POET", "POETRY", "POINT", "POISON", "POLAR", "POLICE", "POLICY", "POLISH", "POLYGON", "POLYMER", "POND", "POOL", "POPCORN", "POPCORN", "PORT", "PORTAL", "PORTFOLIO", "PORTRAIT", "POSE", "POSITION", "POSITIVE", "POST", "POT", "POTATO", "POTENTIAL", "POTION", "POWER", "PRACTICE", "PRAYER", "PREMIUM", "PRESENCE", "PRESENT", "PRESIDENT", "PRESS", "PRICE", "PRIDE", "PRIME", "PRINCE", "PRINCESS", "PRINT", "PRISM", "PRISON", "PRIVACY", "PRIVATE", "PRIZE", "PRO", "PROBABILITY", "PROBE", "PROBLEM", "PROCESS", "PROFIT", "PROGRAM", "PROGRESS", "PROJECT", "PROMISE", "PROMPT", "PROOF", "PROPER", "PROPERTY", "PROPHET", "PROPOSAL", "PROSE", "PROSPERITY", "PROTECT", "PROTEIN", "PROTOCOL", "PROTON", "PROTOTYPE", "PROVIDER", "PROVINCE", "PROXY", "PSYCHOLOGY", "PUBLIC", "PULSE", "PUMA", "PUMP", "PUNCH", "PUPPY", "PURCHASE", "PURE", "PURPLE", "PURPOSE", "PURSE", "PYRAMID", "PYTHON", "QUANTUM", "QUARTZ", "QUESTION", "QUICK", "QUIET", "QUILL", "QUINN", "QUOTA", "QUOTE", "RABBIT", "RACE", "RACING", "RADAR", "RADIO", "RAID", "RAIL", "RAIN", "RAINBOW", "RAISE", "RALLY", "RAM", "RANCH", "RANGE", "RANK", "RAPID", "RARE", "RASPBERRY", "RATE", "RATIO", "RAVEN", "RAY", "RAZOR", "REACH", "REACT", "READER", "READY", "REAL", "REALITY", "REALM", "REAPER", "REBEL", "REBUILD", "RECALL", "RECEIPT", "RECEPTION", "RECIPE", "RECORD", "RECOVERY", "RECRUIT", "RECYCLE", "RED", "REDEEM", "REDIRECT", "REDISCOVER", "REDSTONE", "REDUCE", "REEF", "REFER", "REFERENCE", "REFINE", "REFLECT", "REFORM", "REFRESH", "REFRIGERATOR", "REFUGE", "REFUND", "REFUSE", "REGARD", "REGION", "REGISTER", "REGISTRY", "REGRET", "REGULAR", "REIGN", "REJECT", "RELATE", "RELAX", "RELEASE", "RELEVANT", "RELIABLE", "RELIEF", "RELIEVE", "RELIGION", "RELOAD", "REMAIN", "REMARK", "REMEDY", "REMEMBER", "REMIND", "REMOTE", "REMOVE", "RENDER", "RENEW", "RENT", "REOPEN", "REPAIR", "REPEAT", "REPLACE", "REPLY", "REPORT", "REPUBLIC", "REQUEST", "REQUIRE", "RESCUE", "RESEARCH", "RESEMBLE", "RESENT", "RESERVE", "RESET", "RESIDE", "RESIDENT", "RESIGN", "RESIST", "RESOLUTION", "RESORT", "RESOURCE", "RESPOND", "REST", "RESTAURANT", "RESTORE", "RESTRICT", "RESULT", "RESUME", "RETAIL", "RETAIN", "RETIRE", "RETREAT", "RETURN", "REVEAL", "REVENGE", "REVENUE", "REVERSE", "REVIEW", "REVOLUTION", "REWARD", "RHYTHM", "RIBBON", "RICE", "RICH", "RIDE", "RIDGE", "RIFLE", "RIGHT", "RING", "RIOT", "RISE", "RISK", "RITUAL", "RIVAL", "RIVER", "ROAD", "ROAR", "ROAST", "ROBOT", "ROCKET", "ROGUE", "ROLE", "ROLL", "ROMAN", "ROOF", "ROOM", "ROOT", "ROPE", "ROSE", "ROTOR", "ROTTEN", "ROUGH", "ROUND", "ROUTE", "ROUTER", "ROVER", "ROYAL", "RUBY", "RUDDER", "RUG", "RUIN", "RULE", "RULER", "RUNNER", "RUNWAY", "RUSH", "RUSSIA", "RUST", "SABER", "SADDLE", "SAFARI", "SAFE", "SAFETY", "SAGE", "SAIL", "SAINT", "SAKE", "SALAD", "SALE", "SALMON", "SALT", "SALVAGE", "SAME", "SAMPLE", "SANDBOX", "SANDWICH", "SAPPHIRE", "SATELLITE", "SATISFACTION", "SATURN", "SAUCE", "SAUSAGE", "SAVE", "SAVIOR", "SAW", "SCALE", "SCALPEL", "SCAM", "SCANNER", "SCAPE", "SCAR", "SCARE", "SCARF", "SCENE", "SCHEME", "SCHOLAR", "SCHOOL", "SCIENCE", "SCISSOR", "SCOPE", "SCORE", "SCORPION", "SCOTLAND", "SCOUT", "SCRAP", "SCREAM", "SCREEN", "SCRIPT", "SCROLL", "SEA", "SEAL", "SEARCH", "SEASON", "SEAT", "SECOND", "SECRET", "SECTION", "SECTOR", "SECURE", "SECURITY", "SEED", "SEEK", "SEEM", "SEIZE", "SELECT", "SELECTION", "SELF", "SELL", "SEMAPHORE", "SENATE", "SEND", "SENIOR", "SENSE", "SENSOR", "SENTIMENT", "SEPARATE", "SEPTEMBER", "SEQUENCE", "SERIAL", "SERIES", "SERVE", "SERVICE", "SESSION", "SET", "SETTING", "SETTLE", "SETTLEMENT", "SETUP", "SEVEN", "SEVERE", "SEW", "SEX", "SHADOW", "SHAKE", "SHALL", "SHAME", "SHAPE", "SHARE", "SHARK", "SHARP", "SHAVE", "SHEEP", "SHEER", "SHEET", "SHELF", "SHELL", "SHELTER", "SHIFT", "SHINE", "SHIP", "SHIRT", "SHOCK", "SHOE", "SHOOT", "SHOP", "SHORE", "SHORT", "SHOT", "SHOULDER", "SHOUT", "SHOW", "SHRINK", "SIDE", "SIGHT", "SIGN", "SIGNAL", "SIGNATURE", "SIGNIFICANCE", "SILENCE", "SILK", "SILVER", "SIMILAR", "SIMPLE", "SIMULATION", "SINCERE", "SING", "SINGER", "SINGLE", "SINK", "SIR", "SISTER", "SITE", "SITUATION", "SIZE", "SKATE", "SKETCH", "SKI", "SKILL", "SKIN", "SKY", "SKYLINE", "SKYSCRAPER", "SLAB", "SLACK", "SLAM", "SLANG", "SLAP", "SLASH", "SLATE", "SLAVE", "SLEEP", "SLEEVE", "SLICE", "SLIDE", "SLIGHT", "SLOGAN", "SLOPE", "SLOT", "SLOW", "SMALL", "SMART", "SMELL", "SMILE", "SMOKE", "SMOOTH", "SNACK", "SNAKE", "SNAP", "SNAPSHOT", "SNOW", "SNOWBALL", "SOAP", "SOCCER", "SOCIAL", "SOCKET", "SOFT", "SOFTWARE", "SOIL", "SOLAR", "SOLDIER", "SOLE", "SOLID", "SOLO", "SOLUTION", "SOLVE", "SOME", "SONG", "SONIC", "SONNET", "SOON", "SORROW", "SORT", "SOUL", "SOUND", "SOUP", "SOURCE", "SOUTH", "SOUTHERN", "SOVEREIGN", "SPACE", "SPADE", "SPAN", "SPARE", "SPARK", "SPARKLE", "SPEAK", "SPEAKER", "SPEAR", "SPECIAL", "SPECIES", "SPECIFIC", "SPECTRUM", "SPEECH", "SPEED", "SPELL", "SPEND", "SPHERE", "SPICE", "SPIDER", "SPIKE", "SPILL", "SPIN", "SPINE", "SPIRAL", "SPIRIT", "SPLASH", "SPLIT", "SPOON", "SPORT", "SPOT", "SPRAY", "SPREAD", "SPRING", "SPROUT", "SPY", "SQUARE", "SQUASH", "SQUEEZE", "SQUIRREL", "STABLE", "STADIUM", "STAFF", "STAGE", "STAIR", "STAKE", "STALL", "STAMP", "STAND", "STANDARD", "STAR", "STARE", "START", "STATE", "STATION", "STATUE", "STATUS", "STAY", "STEADY", "STEAK", "STEAL", "STEAM", "STEEL", "STEEP", "STEER", "STEM", "STEP", "STERN", "STICK", "STICKER", "STILL", "STING", "STIR", "STOCK", "STOMACH", "STONE", "STOOL", "STOP", "STORE", "STORM", "STORY", "STOVE", "STRATEGY", "STRAW", "STREAM", "STREET", "STRENGTH", "STRESS", "STRETCH", "STRING", "STRIP", "STROKE", "STRONG", "STRUCTURE", "STRUGGLE", "STUDENT", "STUDIO", "STUDY", "STUFF", "STUN", "STYLE", "SUBJECT", "SUBMARINE", "SUBMIT", "SUBSCRIBE", "SUBSTANCE", "SUBSTITUTE", "SUBTLE", "SUBWAY", "SUCCESS", "SUCK", "SUDAN", "SUDOKU", "SUGAR", "SUGGEST", "SUICIDE", "SUIT", "SUMMER", "SUMMIT", "SUN", "SUNDAY", "SUNFLOWER", "SUNGLASSES", "SUNLIGHT", "SUNRISE", "SUNSET", "SUPER", "SUPERMARKET", "SUPPLY", "SUPPORT", "SUPPOSE", "SUPREME", "SURE", "SURFACE", "SURGEON", "SURPRISE", "SURROUND", "SURVEY", "SURVIVAL", "SURVIVE", "SUSPECT", "SUSPEND", "SWALLOW", "SWAMP", "SWAN", "SWAP", "SWEAR", "SWEAT", "SWEATER", "SWEEP", "SWEET", "SWELL", "SWIFT", "SWIM", "SWING", "SWITCH", "SWORD", "SYMBOL", "SYMPATHY", "SYMPTOM", "SYNAGOGUE", "SYNDROME", "SYNTHESIS", "SYSTEM", "TABLE", "TABLET", "TACKLE", "TACTIC", "TAG", "TAIL", "TAKE", "TALE", "TALENT", "TALK", "TALL", "TANK", "TAP", "TAPE", "TARGET", "TASK", "TASTE", "TAX", "TAXI", "TEA", "TEACH", "TEAM", "TEAR", "TECH", "TECHNOLOGY", "TEENAGER", "TEETH", "TELEGRAM", "TELEPHONE", "TELESCOPE", "TELEVISION", "TELL", "TEMPERATURE", "TEMPLE", "TENDENCY", "TENNIS", "TENSION", "TENT", "TERM", "TERMINAL", "TERRAIN", "TERRIBLE", "TERRIFIC", "TERRITORY", "TERROR", "TEST", "TEXT", "TEXTBOOK", "THAN", "THANK", "THEATER", "THEFT", "THEIR", "THEME", "THEORY", "THERAPY", "THERE", "THESE", "THICK", "THIEF", "THIGH", "THIN", "THING", "THINK", "THIRD", "THIRST", "THIRTEEN", "THIRTY", "THIS", "THORN", "THOSE", "THOUGH", "THOUGHT", "THOUSAND", "THREAD", "THREAT", "THREE", "THRILL", "THROAT", "THRONE", "THROUGH", "THROW", "THUMB", "THUNDER", "THURSDAY", "TICKET", "TIDE", "TIE", "TIGER", "TIGHT", "TILE", "TILL", "TIMBER", "TIME", "TIN", "TINY", "TIP", "TIRE", "TISSUE", "TITLE", "TO", "TOAST", "TODAY", "TOE", "TOGETHER", "TOILET", "TOKEN", "TOLD", "TOLERANCE", "TOLL", "TOMATO", "TOMORROW", "TONGUE", "TONIGHT", "TOO", "TOOL", "TOOTH", "TOP", "TOPIC", "TORCH", "TORNADO", "TORQUE", "TORTOISE", "TOSS", "TOTAL", "TOUCH", "TOUGH", "TOUR", "TOURISM", "TOURNAMENT", "TOWEL", "TOWER", "TOWN", "TOY", "TRACE", "TRACK", "TRADE", "TRADER", "TRADING", "TRAFFIC", "TRAGEDY", "TRAIL", "TRAIN", "TRAINER", "TRANSFER", "TRANSFORM", "TRANSIT", "TRANSLATE", "TRANSPORT", "TRAP", "TRASH", "TRAVEL", "TRAY", "TREASURE", "TREAT", "TREATY", "TREE", "TREND", "TRIAL", "TRIBE", "TRICK", "TRIGGER", "TRIM", "TRIP", "TRIPLE", "TRIUMPH", "TROPHY", "TROPICAL", "TROUBLE", "TROUSERS", "TRUCK", "TRUE", "TRULY", "TRUMPET", "TRUNK", "TRUST", "TRUTH", "TRY", "TUBE", "TUESDAY", "TUMOR", "TUNE", "TUNNEL", "TURKEY", "TURN", "TURTLE", "TWELVE", "TWENTY", "TWICE", "TWIN", "TWIST", "TWO", "TYPE", "TYPICAL", "UGLY", "ULTRA", "UMBRELLA", "UNABLE", "UNCLE", "UNDER", "UNDERSTAND", "UNIVERSE", "UNIVERSITY", "UNKNOWN", "UNLESS", "UNLIKE", "UNLOCK", "UNSTABLE", "UNTIL", "UNUSUAL", "UP", "UPDATE", "UPGRADE", "UPON", "UPPER", "UPSET", "UPSTAIRS", "URBAN", "URGE", "URGENT", "USAGE", "USE", "USED", "USEFUL", "USER", "USUAL", "VACATION", "VACUUM", "VALID", "VALLEY", "VALUE", "VAN", "VANISH", "VAPOR", "VARIABLE", "VARIATION", "VARIETY", "VARIOUS", "VARY", "VAST", "VEGETABLE", "VEHICLE", "VELOCITY", "VELVET", "VENDOR", "VENUE", "VENUS", "VERBAL", "VERDICT", "VERSION", "VERTICAL", "VERY", "VESSEL", "VETERAN", "VIA", "VIBRATION", "VICTIM", "VICTORY", "VIDEO", "VIEW", "VILLAGE", "VILLAIN", "VINE", "VINEGAR", "VIOLIN", "VIRTUAL", "VIRUS", "VISA", "VISION", "VISIT", "VISUAL", "VITAL", "VOCAL", "VOICE", "VOLATILE", "VOLCANO", "VOLUME", "VOTE", "VOWEL", "VOYAGE", "WAGE", "WAGON", "WAIST", "WAIT", "WAKE", "WALK", "WALL", "WALLET", "WANDER", "WANT", "WAR", "WARD", "WARM", "WARMTH", "WARNING", "WARRANTY", "WARRIOR", "WASH", "WASP", "WASTE", "WATCH", "WATER", "WAVE", "WAX", "WAY", "WEAK", "WEALTH", "WEAPON", "WEAR", "WEATHER", "WEB", "WEDDING", "WEDNESDAY", "WEEK", "WEEKEND", "WEIGH", "WEIGHT", "WEIRD", "WELCOME", "WELFARE", "WELL", "WEST", "WESTERN", "WET", "WHALE", "WHEAT", "WHEEL", "WHEN", "WHERE", "WHETHER", "WHICH", "WHILE", "WHISPER", "WHITE", "WHO", "WHOLE", "WHOSE", "WHY", "WICKED", "WIDE", "WIDOW", "WIDTH", "WIFE", "WILD", "WILDLIFE", "WILL", "WIN", "WIND", "WINDOW", "WINE", "WING", "WINNER", "WINTER", "WIRE", "WISDOM", "WISE", "WISH", "WITCH", "WITH", "WITHDRAW", "WITHIN", "WITHOUT", "WITNESS", "WOLF", "WOMAN", "WONDER", "WOOD", "WOOL", "WORD", "WORK", "WORKER", "WORKSHOP", "WORLD", "WORM", "WORRY", "WORSE", "WORST", "WORTH", "WOULD", "WOUND", "WRAP", "WRIST", "WRITE", "WRITER", "WRONG", "YARD", "YAWN", "YEAR", "YELLOW", "YES", "YESTERDAY", "YET", "YIELD", "YOGA", "YOUNG", "YOUR", "YOURS", "YOUTH", "ZERO", "ZONE", "ZOOM"]
    
    # Função para adicionar setor se houver símbolos
    def add_crypto_sector(sector_id, name, symbols_list):
        matches = [s for s in crypto_symbols if s["symbol"] in symbols_list]
        if matches:
            sectors.append({
                "sector_id": sector_id,
                "sector_name": f"Cripto - {name}",
                "count": len(matches),
                "real_count": len(matches),
                "exchanges": ["BINANCE", "PEPPERSTONE"],
                "types": ["CRYPTO"],
            })
    
    # Adiciona setores na mesma ordem da Binance + categorias expandidas
    add_crypto_sector("crypto_layer1_layer2", "Layer 1 / Layer 2", layer1_layer2)
    add_crypto_sector("crypto_bnb_chain", "BNB Chain", bnb_chain)
    add_crypto_sector("crypto_solana", "Solana", solana)
    add_crypto_sector("crypto_rwa", "RWA (Ativos do Mundo Real)", rwa)
    add_crypto_sector("crypto_meme", "Meme Coins", meme)
    add_crypto_sector("crypto_payments", "Payments", payments)
    add_crypto_sector("crypto_ai", "Inteligência Artificial", ai)
    add_crypto_sector("crypto_metaverse", "Metaverso", metaverse)
    add_crypto_sector("crypto_gaming", "Jogos (Gaming)", gaming)
    add_crypto_sector("crypto_defi", "DeFi", defi)
    add_crypto_sector("crypto_liquid_staking", "Staking de Liquidez", liquid_staking)
    add_crypto_sector("crypto_fan_token", "Fan Token", fan_token)
    add_crypto_sector("crypto_infrastructure", "Infraestrutura", infrastructure)
    add_crypto_sector("crypto_storage", "Storage (Armazenamento)", storage)
    add_crypto_sector("crypto_nft", "NFT", nft)
    add_crypto_sector("crypto_pow", "POW (Proof of Work)", pow)
    add_crypto_sector("crypto_polkadot", "Polkadot Ecosystem", polkadot)
    add_crypto_sector("crypto_launchpad", "Launchpad", launchpad)
    add_crypto_sector("crypto_seed", "Seed (Novos Projetos)", seed)
    # Categorias expandidas
    add_crypto_sector("crypto_privacy", "Privacidade", privacy)
    add_crypto_sector("crypto_exchange", "Exchange Tokens", exchange)
    add_crypto_sector("crypto_stablecoins", "Stablecoins", stablecoins)
    add_crypto_sector("crypto_interoperability", "Interoperabilidade", interoperability)
    add_crypto_sector("crypto_yield", "Yield Aggregators", yield_aggregators)
    add_crypto_sector("crypto_derivatives", "Derivativos", derivatives)
    add_crypto_sector("crypto_lending", "Empréstimos (Lending)", lending)
    add_crypto_sector("crypto_insurance", "Seguros DeFi", insurance)
    add_crypto_sector("crypto_prediction", "Mercados de Previsão", prediction_markets)
    # Ecossistemas
    add_crypto_sector("crypto_ethereum", "Ethereum Ecosystem", ethereum_ecosystem)
    add_crypto_sector("crypto_bitcoin", "Bitcoin Ecosystem", bitcoin_ecosystem)
    add_crypto_sector("crypto_cosmos", "Cosmos Ecosystem", cosmos_ecosystem)
    add_crypto_sector("crypto_avalanche", "Avalanche Ecosystem", avalanche_ecosystem)
    add_crypto_sector("crypto_polygon", "Polygon Ecosystem", polygon_ecosystem)
    add_crypto_sector("crypto_arbitrum", "Arbitrum Ecosystem", arbitrum_ecosystem)
    add_crypto_sector("crypto_optimism", "Optimism Ecosystem", optimism_ecosystem)
    add_crypto_sector("crypto_binance", "Binance Ecosystem", binance_ecosystem)
    add_crypto_sector("crypto_tron", "Tron Ecosystem", tron_ecosystem)
    add_crypto_sector("crypto_cardano", "Cardano Ecosystem", cardano_ecosystem)
    add_crypto_sector("crypto_algorand", "Algorand Ecosystem", algorand_ecosystem)
    add_crypto_sector("crypto_near", "NEAR Ecosystem", near_ecosystem)
    
    # Outras cripto que não se encaixam nas categorias acima
    categorized = set(bnb_chain + solana + rwa + meme + payments + ai + layer1_layer2 + 
                      metaverse + gaming + defi + liquid_staking + fan_token + infrastructure + 
                      storage + nft + pow + polkadot + launchpad + seed + 
                      privacy + exchange + stablecoins + interoperability + yield_aggregators + 
                      derivatives + lending + insurance + prediction_markets +
                      ethereum_ecosystem + bitcoin_ecosystem + cosmos_ecosystem + avalanche_ecosystem +
                      polygon_ecosystem + arbitrum_ecosystem + optimism_ecosystem + binance_ecosystem +
                      tron_ecosystem + cardano_ecosystem + algorand_ecosystem + near_ecosystem)
    outros = [s for s in crypto_symbols if s["symbol"] not in categorized]
    
    # Categoriza por padrões especiais da Binance
    leverage_tokens = [s for s in outros if "UP" in s["symbol"] or "DOWN" in s["symbol"]]
    futures_tokens = [s for s in outros if s["symbol"].endswith("FD")]
    b_tokens = [s for s in outros if s["symbol"].endswith("B") and len(s["symbol"]) > 1]
    
    if leverage_tokens:
        sectors.append({
            "sector_id": "crypto_leverage",
            "sector_name": f"Cripto - Tokens Alavancados (UP/DOWN)",
            "count": len(leverage_tokens),
            "real_count": len(leverage_tokens),
            "exchanges": ["BINANCE"],
            "types": ["CRYPTO"],
        })
    if futures_tokens:
        sectors.append({
            "sector_id": "crypto_futures",
            "sector_name": f"Cripto - Futuros (FD)",
            "count": len(futures_tokens),
            "real_count": len(futures_tokens),
            "exchanges": ["BINANCE"],
            "types": ["CRYPTO"],
        })
    if b_tokens:
        sectors.append({
            "sector_id": "crypto_b_tokens",
            "sector_name": f"Cripto - Tokens B (Binance)",
            "count": len(b_tokens),
            "real_count": len(b_tokens),
            "exchanges": ["BINANCE"],
            "types": ["CRYPTO"],
        })
    
    # Remove os já categorizados por padrão
    padrao_categorizados = set(s["symbol"] for s in leverage_tokens + futures_tokens + b_tokens)
    restantes = [s for s in outros if s["symbol"] not in padrao_categorizados]
    
    if restantes:
        # Agrupa por letra inicial para organização
        for letra in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
            grupo = [s for s in restantes if s["symbol"].startswith(letra)]
            if grupo:
                sectors.append({
                    "sector_id": f"crypto_letra_{letra}",
                    "sector_name": f"Cripto - {letra}* ({len(grupo)} ativos)",
                    "count": len(grupo),
                    "real_count": len(grupo),
                    "exchanges": ["BINANCE"],
                    "types": ["CRYPTO"],
                })
        
        # Números e outros
        numeros = [s for s in restantes if s["symbol"][0].isdigit() or not s["symbol"][0].isalpha()]
        if numeros:
            sectors.append({
                "sector_id": "crypto_numeros",
                "sector_name": f"Cripto - Números/Símbolos ({len(numeros)} ativos)",
                "count": len(numeros),
                "real_count": len(numeros),
                "exchanges": ["BINANCE"],
                "types": ["CRYPTO"],
            })
    
    # Remove duplicates by sector_id (keep the one with higher count)
    unique_sectors = {}
    for s in sectors:
        sid = s["sector_id"]
        if sid not in unique_sectors or s["count"] > unique_sectors[sid]["count"]:
            unique_sectors[sid] = s
    
    # Sort alphabetically by sector_name
    sorted_sectors = sorted(unique_sectors.values(), key=lambda x: x["sector_name"].lower())
    
    return {"count": len(sorted_sectors), "sectors": sorted_sectors, 
            "total_bovespa": tick_counts.get("bovespa", 0) if "bovespa" in tick_counts else sum(tick_counts.values()),
            "total_crypto": len(crypto_symbols)}

def get_assets(sector_id=None, exchange=None, asset_type=None,
               search=None, page=0, page_size=0):
    pool = ASSETS
    if sector_id:  pool = [a for a in pool if a["sector_id"] == sector_id]
    if exchange:   pool = [a for a in pool if a["exchange"] == exchange]
    if asset_type: pool = [a for a in pool if a["type"] == asset_type]
    if search:
        q = search.lower()
        pool = [a for a in pool if q in a["symbol"].lower() or q in a["description"].lower()]
    total = len(pool)
    if page_size > 0:
        pool = pool[page * page_size: page * page_size + page_size]
    return {"total": total, "count": len(pool), "assets": pool}

def get_assets_count():
    return {
        "total": len(ASSETS),
        "by_sector":   {s: len(v) for s, v in BY_SECTOR.items()},
        "by_exchange": {e: len(v) for e, v in BY_EXCHANGE.items()},
        "by_type":     {t: len(v) for t, v in BY_TYPE.items()},
    }

def get_mmf_debug():
    """Retorna ticks do cache em memória (latência <1ms)."""
    return MMF_CACHE.get()

# ── HTTP Handler ──────────────────────────────────────────────────────────────
class SentinelHandler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        log.info(fmt, *args)

    def _normalize_path(self, path):
        """Remove prefixo /python-api se presente."""
        if path.startswith("/python-api"):
            path = path[len("/python-api"):] or "/"
        return path

    def do_OPTIONS(self):
        self.send_response(200); self._cors(); self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = self._normalize_path(parsed.path)
        qs = parse_qs(parsed.query)
        p = lambda k, d=None: qs.get(k, [d])[0]

        if path == "/status":
            self._json({
                "mt5": CONNECTIONS["mt5"]["connected"],
                "pepperstone": CONNECTIONS["pepperstone"]["connected"],
                "mt5_account": CONNECTIONS["mt5"]["account"],
                "pp_account": CONNECTIONS["pepperstone"]["account"],
                "mt5_available": MT5_AVAILABLE,
                "csv_loaded": len(ASSETS) > 0,
                "total_assets": len(ASSETS),
                "total_sectors": len(SECTORS),
            })
        elif path == "/sectors":
            self._json(get_sectors())
        elif path.startswith("/sectors/") and path.endswith("/symbols"):
            # Compat endpoint for the web UI.
            # Example: GET /sectors/sector_001/symbols
            parts = [x for x in path.split("/") if x]
            sector_id = parts[1] if len(parts) >= 3 else ""
            assets = BY_SECTOR.get(sector_id, [])
            symbols = sorted({a["symbol"] for a in assets})
            self._json({"sector_id": sector_id, "symbols": [{"symbol": s} for s in symbols], "count": len(symbols)})
        elif path == "/symbols":
            # Compat endpoint for the web UI.
            symbols = sorted({a["symbol"] for a in ASSETS})
            self._json({"symbols": [{"symbol": s} for s in symbols], "count": len(symbols)})
        elif path == "/assets":
            self._json(get_assets(
                sector_id=p("sector"), exchange=p("exchange"),
                asset_type=p("type"), search=p("q"),
                page=int(p("page") or 0), page_size=int(p("size") or 0),
            ))
        elif path == "/assets/count":
            self._json(get_assets_count())
        elif path == "/mmf/debug":
            # Debug endpoint for SectorDetailPage polling fallback
            self._json(get_mmf_debug())
        elif path == "/delta":
            # Protocolo Delta - apenas mudanças de preço (JSON compacto)
            self._json(MMF_CACHE.get_deltas_json())
        elif path == "/delta/json":
            # Protocolo Delta - formato JSON expandido
            self._json(MMF_CACHE.get_deltas())
        elif path == "/delta/binary":
            # Protocolo Delta - formato binário ultra-compacto
            data = MMF_CACHE.get_deltas_binary()
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", len(data))
            self._cors(); self.end_headers()
            self.wfile.write(data)
        elif path.startswith("/api/v1/market/symbols/check"):
            # Endpoint para verificar símbolos e retornar preços
            symbols_param = p("symbols", "")
            symbols_list = [s.strip().upper() for s in symbols_param.split(",") if s.strip()]
            items = []
            for sym in symbols_list[:200]:  # Limitar a 200 símbolos
                tick = mt5_tick(sym, "mt5")
                if "error" not in tick and tick.get("bid"):
                    items.append({
                        "symbol": sym,
                        "requested": sym,
                        "status": "ok",
                        "priceBRL": tick.get("last") or (tick.get("bid") + tick.get("ask", 0)) / 2,
                        "bid": tick.get("bid"),
                        "ask": tick.get("ask"),
                        "time": tick.get("time", ""),
                    })
                else:
                    items.append({
                        "symbol": sym,
                        "requested": sym,
                        "status": "error",
                        "error": tick.get("error", "Symbol not found"),
                    })
            self._json({"items": items, "total": len(items)})
        elif path == "/":
            self._html(INDEX_PAGE)
        else:
            self._json({"error": "Not found"}, 404)

    def do_POST(self):
        b = self._read_body()
        path = self._normalize_path(urlparse(self.path).path)
        routes = {
            "/mt5/connect":            lambda: mt5_connect(b.get("login",0), b.get("password",""), b.get("server",""), b.get("path"), "mt5"),
            "/mt5/disconnect":         lambda: mt5_disconnect("mt5"),
            "/pepperstone/connect":    lambda: mt5_connect(b.get("login",0), b.get("password",""), b.get("server","Pepperstone-MT5"), b.get("path"), "pepperstone"),
            "/pepperstone/disconnect": lambda: mt5_disconnect("pepperstone"),
            "/tick":                   lambda: mt5_tick(b.get("symbol",""), b.get("broker","mt5")),
            "/ticks/batch":            lambda: mt5_ticks_batch(b.get("symbols",[]), b.get("broker","mt5")),
            "/ticks/sector":           lambda: mt5_ticks_sector(b.get("sector_id",""), b.get("broker","mt5")),
            "/ticks/all":              lambda: mt5_ticks_all(
                                           broker=b.get("broker","mt5"),
                                           exchange=b.get("exchange"),
                                           sector_id=b.get("sector_id"),
                                           asset_type=b.get("type"),
                                           limit=int(b.get("limit",0))),
            "/ohlcv":                  lambda: mt5_ohlcv(b.get("symbol",""), b.get("timeframe","H1"), int(b.get("count",100)), b.get("broker","mt5")),
            "/symbol/info":            lambda: mt5_symbol_info(b.get("symbol",""), b.get("broker","mt5")),
            "/symbols/list":           lambda: list_symbols(b.get("broker","mt5")),
        }
        fn = routes.get(path)
        if fn:
            try:
                self._json(fn())
            except Exception as e:
                log.exception("Handler error")
                self._json({"error": str(e)}, 500)
        else:
            self._json({"error": f"Endpoint não encontrado: {path}"}, 404)

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        try:
            return json.loads(self.rfile.read(length))
        except Exception:
            return {}

    def _json(self, data, status=200):
        # Desabilita gzip temporariamente para debug
        use_gzip = False
        
        payload = json.dumps(data, ensure_ascii=False, default=str).encode("utf-8")
        
        if use_gzip and len(payload) > 1024:  # Só comprime se >1KB
            payload = gzip.compress(payload, compresslevel=6)
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Content-Length", len(payload))
            self._cors(); self.end_headers()
            self.wfile.write(payload)
        else:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", len(payload))
            self._cors(); self.end_headers()
            self.wfile.write(payload)

    def _html(self, html, status=200):
        payload = html.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", len(payload))
        self._cors(); self.end_headers()
        self.wfile.write(payload)

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")


INDEX_PAGE = """<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><title>Sentinel API</title>
<style>
body{font-family:monospace;background:#080a0e;color:#dde2ef;padding:40px;line-height:1.8;max-width:1100px}
h1{color:#00e5a0}h2{color:#4d9fff;margin-top:28px}h3{color:#ff6535;margin-top:16px}
code{background:#151821;border:1px solid #1c2030;padding:2px 8px;border-radius:4px;color:#00e5a0}
pre{background:#151821;border:1px solid #1c2030;padding:16px;border-radius:8px;overflow-x:auto;font-size:13px}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #1c2030;padding:6px 12px;text-align:left}
th{background:#151821;color:#4d9fff}
</style></head><body>
<h1>🛡 Sentinel API &mdash; localhost:8765</h1>
<p>Servidor ativo. CSV: <strong>1901 ativos</strong> em <strong>52 setores</strong>.</p>
<h2>GET</h2>
<pre>GET /status
GET /sectors
GET /assets[?sector=sector_001&exchange=BOVESPA&type=Ação&q=PETR&page=0&size=100]
GET /assets/count</pre>
<h2>POST</h2>
<table>
<tr><th>Endpoint</th><th>Body</th><th>Retorno</th></tr>
<tr><td>POST /mt5/connect</td><td>{login, password, server, path?}</td><td>{ok, account}</td></tr>
<tr><td>POST /mt5/disconnect</td><td>{}</td><td>{ok}</td></tr>
<tr><td>POST /pepperstone/connect</td><td>{login, password, server, path?}</td><td>{ok, account}</td></tr>
<tr><td>POST /pepperstone/disconnect</td><td>{}</td><td>{ok}</td></tr>
<tr><td>POST /tick</td><td>{symbol, broker}</td><td>bid, ask, last, spread, time</td></tr>
<tr><td>POST /ticks/batch</td><td>{symbols:[], broker}</td><td>{ticks:{}, errors:[]}</td></tr>
<tr><td><b>POST /ticks/sector</b></td><td>{sector_id, broker}</td><td>Todos ativos do setor</td></tr>
<tr><td><b>POST /ticks/all</b></td><td>{broker, exchange?, sector_id?, type?, limit?}</td><td>Todos 1901 ativos</td></tr>
<tr><td>POST /ohlcv</td><td>{symbol, timeframe, count, broker}</td><td>{data:[{t,o,h,l,c,v}]}</td></tr>
<tr><td>POST /symbol/info</td><td>{symbol, broker}</td><td>info completo</td></tr>
<tr><td>POST /symbols/list</td><td>{broker}</td><td>todos símbolos do terminal</td></tr>
</table>
</body></html>"""

# ── Entry point ───────────────────────────────────────────────────────────────
def auto_connect():
    """Tenta conectar automaticamente ao MT5 já logado (Genial e Pepperstone)."""
    if not MT5_AVAILABLE:
        log.warning("MT5 não disponível para auto-conexão")
        return
    
    # Paths dos terminais MT5
    # Genial usa o MT5 padrao (GenialInvestimentos-PRD)
    genial_path = r"C:\Program Files\MetaTrader 5\terminal64.exe"
    pepperstone_path = r"C:\Program Files\Pepperstone MetaTrader 5\terminal64.exe"
    
    # Tenta conectar ao Genial primeiro (para ativos BOVESPA)
    if Path(genial_path).exists():
        if mt5.initialize(path=genial_path):
            info = mt5.account_info()
            if info:
                server = info.server.lower()
                if 'genial' in server:
                    CONNECTIONS["mt5"]["connected"] = True
                    CONNECTIONS["mt5"]["account"] = f"{info.login} | {info.name} | {info.currency} | {info.server}"
                    log.info("Auto-conectado [Genial] %s", CONNECTIONS["mt5"]["account"])
                elif 'pepperstone' not in server:
                    # Outro broker, marca como mt5 generico
                    CONNECTIONS["mt5"]["connected"] = True
                    CONNECTIONS["mt5"]["account"] = f"{info.login} | {info.name} | {info.currency} | {info.server}"
                    log.info("Auto-conectado [MT5/%s] %s", info.server, CONNECTIONS["mt5"]["account"])
            else:
                log.warning("Genial conectado mas sem account_info")
        else:
            log.warning("Falha ao conectar Genial: %s", mt5.last_error())
    
    # Tenta conectar ao Pepperstone (para acoes US e Forex)
    if Path(pepperstone_path).exists():
        if mt5.initialize(path=pepperstone_path):
            info = mt5.account_info()
            if info:
                CONNECTIONS["pepperstone"]["connected"] = True
                CONNECTIONS["pepperstone"]["account"] = f"{info.login} | {info.name} | {info.currency} | {info.server}"
                log.info("Auto-conectado [Pepperstone] %s", CONNECTIONS["pepperstone"]["account"])
            else:
                log.warning("Pepperstone conectado mas sem account_info")
        else:
            log.warning("Falha ao conectar Pepperstone: %s", mt5.last_error())

if __name__ == "__main__":
    auto_connect()  # Tenta conectar automaticamente ao MT5 já logado
    server = ThreadingHTTPServer((HOST, PORT), SentinelHandler)
    log.info("=" * 60)
    log.info("Sentinel API  http://%s:%d (ThreadingHTTPServer)", HOST, PORT)
    log.info("MT5 disponível: %s", MT5_AVAILABLE)
    log.info("CSV: %d ativos | %d setores", len(ASSETS), len(SECTORS))
    log.info("Conexões: mt5=%s | pepperstone=%s", CONNECTIONS["mt5"]["connected"], CONNECTIONS["pepperstone"]["connected"])
    log.info("Ctrl+C para parar")
    log.info("=" * 60)
    
    # Inicia cache background para latência <5ms
    MMF_CACHE.start_background_refresh()
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("Servidor parado.")
        MMF_CACHE.stop_background_refresh()
        server.server_close()
