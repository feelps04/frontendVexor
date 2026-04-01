/**
 * Busca APENAS dados REAIS - sem dados fictícios
 * Fontes: MT5 Genial, MT5 Pepperstone, Binance
 */

import { oracleDB } from '../infrastructure/oracle-db.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import 'dotenv/config';

// Configurações das APIs
const BINANCE_API_KEY = process.env.BINANCE_API_KEY || '';
const BINANCE_SECRET_KEY = process.env.BINANCE_SECRET_KEY || '';

// Caminhos MT5
const MT5_PATHS = {
  genial: process.env.GENIAL_MT5_PATH || 'C:\\Program Files\\Genial Investimentos\\MetaTrader 5',
  pepperstone: process.env.PEPPERSTONE_MT5_PATH || 'C:\\Program Files\\Pepperstone\\MetaTrader 5',
};

interface TradeData {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  entry_price: number;
  exit_price: number;
  pnl: number;
  pnl_percent: number;
  outcome: number;
  strategy: string;
  broker: string;
  closed_at: Date;
}

// ==================== LIMPAR TABELA ====================

async function clearTradeHistory(): Promise<void> {
  console.log('🗑️ Limpando tabela trade_history (dados fictícios)...');
  
  try {
    await oracleDB.execute('DELETE FROM trade_history');
    console.log('✅ Tabela limpa!\n');
  } catch (e) {
    console.error('❌ Erro ao limpar:', e);
  }
}

// ==================== BINANCE - DADOS REAIS ====================

async function fetchBinanceRealTrades(): Promise<TradeData[]> {
  if (!BINANCE_API_KEY || !BINANCE_SECRET_KEY) {
    console.log('⚠️ Binance: Configure BINANCE_API_KEY e BINANCE_SECRET_KEY no .env');
    return [];
  }
  
  console.log('\n🔄 BINANCE - Buscando trades REAIS...');
  
  const trades: TradeData[] = [];
  const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT'];
  
  try {
    // Busca últimos 90 dias (limite da API)
    const startTime = Date.now() - (90 * 24 * 60 * 60 * 1000);
    
    for (const symbol of symbols) {
      const timestamp = Date.now();
      const queryString = `symbol=${symbol}&timestamp=${timestamp}&startTime=${startTime}`;
      const signature = crypto
        .createHmac('sha256', BINANCE_SECRET_KEY)
        .update(queryString)
        .digest('hex');
      
      const url = `https://api.binance.com/api/v3/myTrades?${queryString}&signature=${signature}`;
      
      const response = await fetch(url, {
        headers: { 'X-MBX-APIKEY': BINANCE_API_KEY },
      });
      
      if (!response.ok) {
        console.log(`  ⚠️ ${symbol}: HTTP ${response.status}`);
        continue;
      }
      
      const data = await response.json() as Array<{
        id: number;
        symbol: string;
        side: string;
        price: string;
        qty: string;
        time: number;
        realizedPnl: string;
        commission: string;
      }>;
      
      let count = 0;
      for (const t of data) {
        const pnl = parseFloat(t.realizedPnl);
        if (pnl !== 0) {
          trades.push({
            id: `BINANCE_${t.id}`,
            symbol: t.symbol,
            side: t.side as 'BUY' | 'SELL',
            quantity: parseFloat(t.qty),
            entry_price: parseFloat(t.price),
            exit_price: parseFloat(t.price),
            pnl: pnl,
            pnl_percent: pnl / parseFloat(t.price) * 100,
            outcome: pnl > 0 ? 1 : 0,
            strategy: 'binance_spot',
            broker: 'binance',
            closed_at: new Date(t.time)
          });
          count++;
        }
      }
      
      if (count > 0) {
        console.log(`  ✅ ${symbol}: ${count} trades REAIS`);
      }
    }
    
    console.log(`📊 Total Binance REAL: ${trades.length} trades`);
    
  } catch (e) {
    console.error('❌ Erro Binance:', e);
  }
  
  return trades;
}

// ==================== MT5 - LÊ HISTÓRICO REAL ====================

async function fetchMT5RealTrades(mt5Path: string, brokerName: string): Promise<TradeData[]> {
  console.log(`\n🔄 ${brokerName} - Buscando trades REAIS do MT5...`);
  
  const trades: TradeData[] = [];
  
  // Caminhos possíveis do histórico MT5
  const historyPaths = [
    path.join(mt5Path, 'history'),
    path.join(mt5Path, 'MQL5', 'Files'),
    path.join(mt5Path, 'profiles'),
    path.join(process.env.APPDATA || '', 'MetaQuotes', 'Terminal', brokerName.toLowerCase()),
  ];
  
  // Também busca em data/signals
  const signalsPath = path.join(process.cwd(), 'data', 'signals', brokerName.toLowerCase());
  
  try {
    // 1. Tenta ler arquivos CSV/JSON de sinais exportados
    if (fs.existsSync(signalsPath)) {
      const files = fs.readdirSync(signalsPath).filter(f => f.endsWith('.json') || f.endsWith('.csv'));
      
      for (const file of files) {
        const content = fs.readFileSync(path.join(signalsPath, file), 'utf-8');
        const tradesFromFile = parseTradeFile(content, brokerName);
        trades.push(...tradesFromFile);
        
        if (tradesFromFile.length > 0) {
          console.log(`  ✅ ${file}: ${tradesFromFile.length} trades`);
        }
      }
    }
    
    // 2. Busca arquivos de histórico .hst do MT5
    for (const hPath of historyPaths) {
      if (fs.existsSync(hPath)) {
        const hstFiles = fs.readdirSync(hPath).filter(f => f.endsWith('.hst'));
        
        if (hstFiles.length > 0) {
          console.log(`  📁 ${hstFiles.length} arquivos .hst encontrados em ${hPath}`);
          // Note: .hst precisa de parser específico do MT5
        }
      }
    }
    
    console.log(`📊 Total ${brokerName} REAL: ${trades.length} trades`);
    
  } catch (e) {
    console.error(`❌ Erro ${brokerName}:`, e);
  }
  
  return trades;
}

// Parse de arquivos de trade
function parseTradeFile(content: string, broker: string): TradeData[] {
  const trades: TradeData[] = [];
  
  try {
    // Tenta JSON
    const data = JSON.parse(content);
    const items = Array.isArray(data) ? data : [data];
    
    for (const t of items) {
      if (t.pnl !== undefined && t.pnl !== 0) {
        trades.push({
          id: `MT5_${broker}_${t.id || Date.now()}`,
          symbol: t.symbol || 'UNKNOWN',
          side: (t.side || t.type || 'BUY') as 'BUY' | 'SELL',
          quantity: t.volume || t.quantity || 1,
          entry_price: t.entry_price || t.openPrice || 0,
          exit_price: t.exit_price || t.closePrice || 0,
          pnl: t.pnl || t.profit || 0,
          pnl_percent: t.pnl_percent || 0,
          outcome: (t.pnl || t.profit || 0) > 0 ? 1 : 0,
          strategy: t.strategy || 'mt5_manual',
          broker: broker.toLowerCase(),
          closed_at: new Date(t.closed_at || t.closeTime || t.timestamp || Date.now())
        });
      }
    }
  } catch {
    // Tenta CSV
    const lines = content.split('\n');
    const header = lines[0]?.toLowerCase() || '';
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const cols = line.split(/[,;\t]/);
      
      // Tenta diferentes formatos de CSV
      let pnl = 0;
      let symbol = '';
      let side: 'BUY' | 'SELL' = 'BUY';
      let entryPrice = 0;
      let exitPrice = 0;
      let closedAt = new Date();
      
      if (header.includes('pnl') || header.includes('profit')) {
        const pnlIdx = header.includes('pnl') ? header.indexOf('pnl') : header.indexOf('profit');
        pnl = parseFloat(cols[pnlIdx]) || 0;
      }
      
      if (header.includes('symbol')) {
        const idx = header.indexOf('symbol');
        symbol = cols[idx]?.trim() || '';
      }
      
      if (header.includes('side') || header.includes('type')) {
        const idx = header.includes('side') ? header.indexOf('side') : header.indexOf('type');
        side = cols[idx]?.toUpperCase().includes('SELL') ? 'SELL' : 'BUY';
      }
      
      if (pnl !== 0 && symbol) {
        trades.push({
          id: `MT5_${broker}_${Date.now()}_${i}`,
          symbol,
          side,
          quantity: 1,
          entry_price: entryPrice,
          exit_price: exitPrice,
          pnl,
          pnl_percent: 0,
          outcome: pnl > 0 ? 1 : 0,
          strategy: 'mt5_manual',
          broker: broker.toLowerCase(),
          closed_at: closedAt
        });
      }
    }
  }
  
  return trades;
}

// ==================== INSERIR NO ORACLE ====================

async function insertTradesToOracle(trades: TradeData[]): Promise<number> {
  if (trades.length === 0) return 0;
  
  console.log(`\n💾 Inserindo ${trades.length} trades REAIS no Oracle...`);
  
  let inserted = 0;
  
  for (const trade of trades) {
    try {
      await oracleDB.insert(
        `INSERT INTO trade_history 
         (id, symbol, side, quantity, entry_price, exit_price, pnl, pnl_percent, outcome, strategy, broker, closed_at)
         VALUES 
         (:id, :symbol, :side, :quantity, :entry_price, :exit_price, :pnl, :pnl_percent, :outcome, :strategy, :broker, :closed_at)`,
        {
          id: trade.id,
          symbol: trade.symbol,
          side: trade.side,
          quantity: trade.quantity,
          entry_price: trade.entry_price,
          exit_price: trade.exit_price,
          pnl: trade.pnl,
          pnl_percent: trade.pnl_percent,
          outcome: trade.outcome,
          strategy: trade.strategy,
          broker: trade.broker,
          closed_at: trade.closed_at
        }
      );
      inserted++;
    } catch (e) {
      // Ignora duplicatas
    }
  }
  
  console.log(`✅ ${inserted} trades REAIS inseridos`);
  return inserted;
}

// ==================== STATS ====================

async function showStats(): Promise<void> {
  try {
    const count = await oracleDB.query<{ TOTAL: number }>('SELECT COUNT(*) as TOTAL FROM trade_history');
    const stats = await oracleDB.query<{ WINS: number; TOTAL: number; PNL: number; BROKERS: string }>(
      `SELECT 
        SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as WINS,
        COUNT(*) as TOTAL,
        SUM(pnl) as PNL,
        LISTAGG(DISTINCT broker, ', ') WITHIN GROUP (ORDER BY broker) as BROKERS
       FROM trade_history`
    );
    
    const total = stats[0]?.TOTAL || 0;
    const wins = stats[0]?.WINS || 0;
    const pnl = stats[0]?.PNL || 0;
    const brokers = stats[0]?.BROKERS || 'nenhum';
    const wr = total > 0 ? (wins / total) * 100 : 0;
    
    console.log('\n📊 ========================================');
    console.log('📊 ORACLE DB - DADOS REAIS');
    console.log('📊 ========================================');
    console.log(`├─ Total Trades: ${total}`);
    console.log(`├─ Wins: ${wins} | Losses: ${total - wins}`);
    console.log(`├─ Win Rate: ${wr.toFixed(1)}%`);
    console.log(`├─ P&L Total: R$ ${pnl.toFixed(2)}`);
    console.log(`└─ Brokers: ${brokers}`);
    
  } catch (e) {
    console.error('❌ Erro ao buscar stats:', e);
  }
}

// ==================== MAIN ====================

async function main() {
  console.log('📊 ========================================');
  console.log('📊 BUSCANDO APENAS DADOS REAIS');
  console.log('📊 SEM DADOS FICTÍCIOS');
  console.log('📊 ========================================');
  
  // 1. Limpa dados fictícios
  await clearTradeHistory();
  
  const allTrades: TradeData[] = [];
  
  // 2. Binance REAL
  const binanceTrades = await fetchBinanceRealTrades();
  allTrades.push(...binanceTrades);
  
  // 3. MT5 Genial REAL
  const genialTrades = await fetchMT5RealTrades(MT5_PATHS.genial, 'Genial');
  allTrades.push(...genialTrades);
  
  // 4. MT5 Pepperstone REAL
  const pepperstoneTrades = await fetchMT5RealTrades(MT5_PATHS.pepperstone, 'Pepperstone');
  allTrades.push(...pepperstoneTrades);
  
  console.log(`\n📊 TOTAL REAL: ${allTrades.length} trades`);
  
  // 5. Insere no Oracle
  if (allTrades.length > 0) {
    await insertTradesToOracle(allTrades);
  } else {
    console.log('\n⚠️ NENHUM TRADE REAL ENCONTRADO');
    console.log('📋 Para ter dados reais:');
    console.log('   1. Binance: Configure BINANCE_API_KEY e BINANCE_SECRET_KEY');
    console.log('   2. MT5 Genial: Exporte histórico para data/signals/genial/');
    console.log('   3. MT5 Pepperstone: Exporte histórico para data/signals/pepperstone/');
  }
  
  // 6. Mostra stats
  await showStats();
  
  console.log('\n✅ Busca completa!');
}

main().catch(console.error);
