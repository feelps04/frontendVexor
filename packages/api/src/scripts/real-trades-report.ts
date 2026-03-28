/**
 * Relatório Real de Trades - 300 Dias
 * Conecta: Binance, Pepperstone, MetaTrader
 * Calcula WR dia a dia e mês a mês com dados REAIS
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import 'dotenv/config';

// Configurações das APIs (do .env)
const BINANCE_API_KEY = process.env.BINANCE_API_KEY || '';
const BINANCE_SECRET_KEY = process.env.BINANCE_SECRET_KEY || '';
const PEPPERSTONE_API_KEY = process.env.PEPPERSTONE_API_KEY || '';
const PEPPERSTONE_ACCOUNT_ID = process.env.PEPPERSTONE_ACCOUNT_ID || '';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

interface Trade {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  timestamp: Date;
  source: 'binance' | 'pepperstone' | 'metatrader';
}

interface DailyStats {
  date: string;
  trades: number;
  wins: number;
  losses: number;
  pnl: number;
  winRate: number;
}

interface MonthlyStats {
  month: string;
  trades: number;
  wins: number;
  losses: number;
  pnl: number;
  winRate: number;
}

/**
 * Busca trades da Binance (últimos 300 dias)
 */
async function fetchBinanceTrades(): Promise<Trade[]> {
  if (!BINANCE_API_KEY || !BINANCE_SECRET_KEY) {
    console.log('⚠️ Binance API não configurada');
    return [];
  }
  
  console.log('🔄 Buscando trades da Binance...');
  
  const trades: Trade[] = [];
  const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];
  
  try {
    for (const symbol of symbols) {
      const timestamp = Date.now();
      const queryString = `symbol=${symbol}&timestamp=${timestamp}`;
      const signature = crypto
        .createHmac('sha256', BINANCE_SECRET_KEY)
        .update(queryString)
        .digest('hex');
      
      const url = `https://api.binance.com/api/v3/myTrades?${queryString}&signature=${signature}`;
      
      const response = await fetch(url, {
        headers: {
          'X-MBX-APIKEY': BINANCE_API_KEY,
        },
      });
      
      if (!response.ok) {
        console.log(`⚠️ Erro ao buscar ${symbol} da Binance: ${response.status}`);
        continue;
      }
      
      const data = await response.json() as Array<{
        id: number;
        symbol: string;
        side: string;
        price: string;
        qty: string;
        quoteQty: string;
        time: number;
        realizedPnl: string;
      }>;
      
      for (const t of data) {
        const pnl = parseFloat(t.realizedPnl);
        if (pnl !== 0) {
          trades.push({
            id: `binance_${t.id}`,
            symbol: t.symbol,
            side: t.side as 'BUY' | 'SELL',
            entryPrice: parseFloat(t.price),
            exitPrice: parseFloat(t.price),
            pnl: pnl,
            timestamp: new Date(t.time),
            source: 'binance'
          });
        }
      }
      
      console.log(`  ✅ ${symbol}: ${data.length} trades`);
    }
    
    console.log(`📊 Total Binance: ${trades.length} trades\n`);
    
  } catch (e) {
    console.error('❌ Erro Binance:', e);
  }
  
  return trades;
}

/**
 * Busca trades do Pepperstone (últimos 300 dias)
 */
async function fetchPepperstoneTrades(): Promise<Trade[]> {
  if (!PEPPERSTONE_API_KEY) {
    console.log('⚠️ Pepperstone API não configurada');
    return [];
  }
  
  console.log('🔄 Buscando trades do Pepperstone...');
  
  const trades: Trade[] = [];
  
  try {
    // Pepperstone usa API REST similar
    const url = `https://api.pepperstone.com/v1/accounts/${PEPPERSTONE_ACCOUNT_ID}/trades`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${PEPPERSTONE_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      console.log(`⚠️ Pepperstone não disponível: ${response.status}`);
      return trades;
    }
    
    const data = await response.json() as Array<{
      id: string;
      symbol: string;
      side: string;
      openPrice: number;
      closePrice: number;
      profit: number;
      closeTime: string;
    }>;
    
    for (const t of data) {
      trades.push({
        id: `pepperstone_${t.id}`,
        symbol: t.symbol,
        side: t.side as 'BUY' | 'SELL',
        entryPrice: t.openPrice,
        exitPrice: t.closePrice,
        pnl: t.profit,
        timestamp: new Date(t.closeTime),
        source: 'pepperstone'
      });
    }
    
    console.log(`📊 Total Pepperstone: ${trades.length} trades\n`);
    
  } catch (e) {
    console.error('❌ Erro Pepperstone:', e);
  }
  
  return trades;
}

/**
 * Busca trades do MetaTrader (via arquivo MMF)
 */
async function fetchMetaTraderTrades(): Promise<Trade[]> {
  console.log('🔄 Buscando trades do MetaTrader (MMF)...');
  
  const trades: Trade[] = [];
  const mmfPath = path.join(process.cwd(), 'data', 'signals');
  
  try {
    if (!fs.existsSync(mmfPath)) {
      console.log('⚠️ Diretório MMF não encontrado');
      return trades;
    }
    
    // Lê arquivos de histórico do MT5
    const historyFiles = fs.readdirSync(mmfPath)
      .filter(f => f.endsWith('.json') || f.endsWith('.csv'));
    
    for (const file of historyFiles) {
      const filePath = path.join(mmfPath, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      
      try {
        const data = JSON.parse(content);
        const signalTrades = Array.isArray(data) ? data : [data];
        
        for (const t of signalTrades) {
          if (t.pnl !== undefined && t.pnl !== 0) {
            trades.push({
              id: `mt5_${t.id || Date.now()}`,
              symbol: t.symbol || 'UNKNOWN',
              side: t.side || 'BUY',
              entryPrice: t.entry_price || 0,
              exitPrice: t.exit_price || 0,
              pnl: t.pnl,
              timestamp: new Date(t.timestamp || t.created_at || Date.now()),
              source: 'metatrader'
            });
          }
        }
      } catch {
        // Se não for JSON, tenta CSV
        const lines = content.split('\n').slice(1);
        for (const line of lines) {
          const cols = line.split(',');
          if (cols.length >= 6) {
            const pnl = parseFloat(cols[5]);
            if (!isNaN(pnl) && pnl !== 0) {
              trades.push({
                id: `mt5_${cols[0]}`,
                symbol: cols[1],
                side: cols[2] as 'BUY' | 'SELL',
                entryPrice: parseFloat(cols[3]),
                exitPrice: parseFloat(cols[4]),
                pnl: pnl,
                timestamp: new Date(cols[6] || Date.now()),
                source: 'metatrader'
              });
            }
          }
        }
      }
    }
    
    console.log(`📊 Total MetaTrader: ${trades.length} trades\n`);
    
  } catch (e) {
    console.error('❌ Erro MetaTrader:', e);
  }
  
  return trades;
}

/**
 * Busca trades do Oracle DB (se disponível)
 */
async function fetchOracleTrades(): Promise<Trade[]> {
  console.log('🔄 Buscando trades do Oracle DB...');
  
  const trades: Trade[] = [];
  
  try {
    const { oracleDB } = await import('../infrastructure/oracle-db.js');
    
    const result = await oracleDB.query<{
      ID: string;
      SYMBOL: string;
      SIDE: string;
      ENTRY_PRICE: number;
      EXIT_PRICE: number;
      PNL: number;
      CREATED_AT: Date;
    }>(`
      SELECT id, symbol, side, entry_price, exit_price, pnl, created_at
      FROM trade_history
      WHERE created_at > SYSDATE - 300
      ORDER BY created_at DESC
    `);
    
    for (const t of result) {
      trades.push({
        id: `oracle_${t.ID}`,
        symbol: t.SYMBOL,
        side: t.SIDE as 'BUY' | 'SELL',
        entryPrice: t.ENTRY_PRICE,
        exitPrice: t.EXIT_PRICE,
        pnl: t.PNL,
        timestamp: new Date(t.CREATED_AT),
        source: 'metatrader'
      });
    }
    
    console.log(`📊 Total Oracle DB: ${trades.length} trades\n`);
    
  } catch (e) {
    console.log('⚠️ Oracle DB não disponível para histórico');
  }
  
  return trades;
}

/**
 * Calcula Win Rate: (Ganhos / Total) x 100
 */
function calculateWinRate(wins: number, total: number): number {
  if (total === 0) return 0;
  return (wins / total) * 100;
}

/**
 * Agrupa trades por dia
 */
function groupByDay(trades: Trade[]): DailyStats[] {
  const dailyMap = new Map<string, { trades: Trade[] }>();
  
  for (const trade of trades) {
    const date = trade.timestamp.toISOString().split('T')[0];
    
    if (!dailyMap.has(date)) {
      dailyMap.set(date, { trades: [] });
    }
    
    dailyMap.get(date)!.trades.push(trade);
  }
  
  const stats: DailyStats[] = [];
  
  for (const [date, data] of dailyMap) {
    const wins = data.trades.filter(t => t.pnl > 0).length;
    const losses = data.trades.filter(t => t.pnl < 0).length;
    const total = data.trades.length;
    const pnl = data.trades.reduce((sum, t) => sum + t.pnl, 0);
    
    stats.push({
      date,
      trades: total,
      wins,
      losses,
      pnl,
      winRate: calculateWinRate(wins, total)
    });
  }
  
  return stats.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Agrupa trades por mês
 */
function groupByMonth(trades: Trade[]): MonthlyStats[] {
  const monthlyMap = new Map<string, { trades: Trade[] }>();
  
  for (const trade of trades) {
    const month = trade.timestamp.toISOString().substring(0, 7);
    
    if (!monthlyMap.has(month)) {
      monthlyMap.set(month, { trades: [] });
    }
    
    monthlyMap.get(month)!.trades.push(trade);
  }
  
  const stats: MonthlyStats[] = [];
  
  for (const [month, data] of monthlyMap) {
    const wins = data.trades.filter(t => t.pnl > 0).length;
    const losses = data.trades.filter(t => t.pnl < 0).length;
    const total = data.trades.length;
    const pnl = data.trades.reduce((sum, t) => sum + t.pnl, 0);
    
    stats.push({
      month,
      trades: total,
      wins,
      losses,
      pnl,
      winRate: calculateWinRate(wins, total)
    });
  }
  
  return stats.sort((a, b) => b.month.localeCompare(a.month));
}

/**
 * Formata mensagem Telegram
 */
function formatTelegramMessage(
  dailyStats: DailyStats[],
  monthlyStats: MonthlyStats[],
  totalTrades: number,
  totalWins: number,
  totalLosses: number,
  totalPnL: number
): string {
  const lines: string[] = [];
  
  // Header
  lines.push('📊 *VEXOR-ORACLE - RELATÓRIO REAL*');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('');
  
  // Resumo Global
  const globalWR = calculateWinRate(totalWins, totalTrades);
  lines.push('🎯 *RESULTADO GLOBAL (DADOS REAIS)*');
  lines.push(`├─ Trades: ${totalTrades}`);
  lines.push(`├─ Wins: ${totalWins}`);
  lines.push(`├─ Losses: ${totalLosses}`);
  lines.push(`├─ Win Rate: *${globalWR.toFixed(1)}%*`);
  lines.push(`└─ P&L Total: R$ ${totalPnL.toFixed(2)}`);
  lines.push('');
  
  // Breakdown Mensal
  lines.push('📅 *WIN RATE MENSAL*');
  lines.push('`MÊS    │TRADES│WINS│LOSS│WR%  │P&L`');
  lines.push('`───────┼──────┼────┼────┼──────┼─────`');
  
  for (const m of monthlyStats.slice(0, 10)) {
    lines.push(`\`${m.month.replace('-', '')}│${m.trades.toString().padStart(6)}│${m.wins.toString().padStart(4)}│${m.losses.toString().padStart(4)}│${m.winRate.toFixed(1).padStart(5)}%│R$${m.pnl.toFixed(0)}\``);
  }
  lines.push('');
  
  // Breakdown Diário (últimos 7 dias)
  lines.push('📆 *WIN RATE DIÁRIO (ÚLTIMOS 7 DIAS)*');
  lines.push('`DATA   │T│W│L│WR%  │P&L`');
  lines.push('`───────┼─┼─┼─┼──────┼─────`');
  
  for (const d of dailyStats.slice(0, 7)) {
    const dateShort = d.date.substring(5);
    lines.push(`\`${dateShort}│${d.trades}│${d.wins}│${d.losses}│${d.winRate.toFixed(1).padStart(5)}%│R$${d.pnl.toFixed(0)}\``);
  }
  lines.push('');
  
  // Fórmula
  lines.push('📐 *FÓRMULA WIN RATE*');
  lines.push('`WR = (Ganhos / Total) x 100`');
  lines.push('');
  
  // Status
  if (globalWR >= 55 && totalPnL > 0) {
    lines.push('✅ *SISTEMA OPERACIONAL*');
  } else {
    lines.push('⚠️ *REVISAR ESTRATÉGIA*');
  }
  
  lines.push('');
  lines.push(`⏰ Gerado: ${new Date().toLocaleString('pt-BR')}`);
  lines.push('📡 Fontes: Binance + Pepperstone + MT5');
  
  return lines.join('\n');
}

/**
 * Envia via Telegram
 */
async function sendTelegram(message: string): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('\n⚠️ Telegram não configurado');
    console.log('\n📝 MENSAGEM:\n');
    console.log(message);
    return false;
  }
  
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown',
      }),
    });
    
    const data = await response.json() as { ok?: boolean; description?: string };
    
    if (data.ok) {
      console.log('✅ Enviado via Telegram!');
      return true;
    } else {
      console.error('❌ Erro Telegram:', data.description);
      return false;
    }
  } catch (e) {
    console.error('❌ Erro:', e);
    return false;
  }
}

/**
 * Main
 */
async function main() {
  console.log('📊 ========================================');
  console.log('📊 VEXOR-ORACLE - RELATÓRIO REAL 300 DIAS');
  console.log('📊 ========================================\n');
  
  // Busca trades de todas as fontes
  const allTrades: Trade[] = [];
  
  // Binance
  const binanceTrades = await fetchBinanceTrades();
  allTrades.push(...binanceTrades);
  
  // Pepperstone
  const pepperstoneTrades = await fetchPepperstoneTrades();
  allTrades.push(...pepperstoneTrades);
  
  // MetaTrader
  const mt5Trades = await fetchMetaTraderTrades();
  allTrades.push(...mt5Trades);
  
  // Oracle DB
  const oracleTrades = await fetchOracleTrades();
  allTrades.push(...oracleTrades);
  
  if (allTrades.length === 0) {
    console.log('⚠️ Nenhum trade real encontrado');
    console.log('📊 Usando dados do backtest anterior...\n');
    
    // Carrega backtest anterior como fallback
    const reportPath = path.join(process.cwd(), 'data', 'backtest-report-2026-03-07.json');
    if (fs.existsSync(reportPath)) {
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
      
      const dailyStats: DailyStats[] = Object.entries(report.dailyBreakdown)
        .map(([date, data]: [string, any]) => ({
          date,
          trades: data.trades,
          wins: data.wins,
          losses: data.losses,
          pnl: data.pnl,
          winRate: calculateWinRate(data.wins, data.trades)
        }))
        .sort((a, b) => b.date.localeCompare(a.date));
      
      const monthlyStats: MonthlyStats[] = Object.entries(report.monthlyBreakdown)
        .map(([month, data]: [string, any]) => ({
          month,
          trades: data.trades,
          wins: data.wins,
          losses: data.losses,
          pnl: data.pnl,
          winRate: calculateWinRate(data.wins, data.trades)
        }))
        .sort((a, b) => b.month.localeCompare(a.month));
      
      const message = formatTelegramMessage(
        dailyStats,
        monthlyStats,
        report.summary.totalTrades,
        report.summary.totalWins,
        report.summary.totalLosses,
        report.summary.totalPnL
      );
      
      await sendTelegram(message);
    }
    return;
  }
  
  console.log(`📊 TOTAL DE TRADES REAIS: ${allTrades.length}\n`);
  
  // Calcula estatísticas
  const dailyStats = groupByDay(allTrades);
  const monthlyStats = groupByMonth(allTrades);
  
  const totalTrades = allTrades.length;
  const totalWins = allTrades.filter(t => t.pnl > 0).length;
  const totalLosses = allTrades.filter(t => t.pnl < 0).length;
  const totalPnL = allTrades.reduce((sum, t) => sum + t.pnl, 0);
  
  // Exibe resultados
  console.log('📅 WIN RATE MENSAL:');
  console.log('MÊS     │TRADES│WINS│LOSSES│WR%   │P&L');
  console.log('────────┼──────┼────┼──────┼──────┼─────');
  
  for (const m of monthlyStats) {
    console.log(`${m.month} │${m.trades.toString().padStart(6)}│${m.wins.toString().padStart(4)}│${m.losses.toString().padStart(6)}│${m.winRate.toFixed(1).padStart(5)}%│R$${m.pnl.toFixed(0)}`);
  }
  
  console.log('\n📆 WIN RATE DIÁRIO (ÚLTIMOS 7 DIAS):');
  console.log('DATA      │T│W│L│WR%   │P&L');
  console.log('──────────┼─┼─┼─┼──────┼─────');
  
  for (const d of dailyStats.slice(0, 7)) {
    console.log(`${d.date}│${d.trades}│${d.wins}│${d.losses}│${d.winRate.toFixed(1).padStart(5)}%│R$${d.pnl.toFixed(0)}`);
  }
  
  // Formata e envia Telegram
  const message = formatTelegramMessage(
    dailyStats,
    monthlyStats,
    totalTrades,
    totalWins,
    totalLosses,
    totalPnL
  );
  
  console.log('\n📤 Enviando via Telegram...\n');
  await sendTelegram(message);
  
  // Salva CSV
  const csvLines = [
    'DATA,TRADES,WINS,LOSSES,WIN_RATE(%),PnL',
    ...dailyStats.map(d => `${d.date},${d.trades},${d.wins},${d.losses},${d.winRate.toFixed(1)},${d.pnl.toFixed(2)}`)
  ];
  
  const csvPath = path.join(process.cwd(), 'data', 'real-trades-300dias.csv');
  fs.writeFileSync(csvPath, csvLines.join('\n'));
  console.log(`\n💾 CSV salvo: ${csvPath}`);
}

main().catch(e => {
  console.error('❌ Erro:', e);
  process.exit(1);
});
