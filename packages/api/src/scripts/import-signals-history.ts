/**
 * Importa signals_history.json para Oracle DB
 * Dados REAIS do sistema de trading
 */

import { oracleDB } from '../infrastructure/oracle-db.js';
import * as fs from 'fs';
import * as path from 'path';
import { config } from 'dotenv';

const rootEnv = 'C:/Users/opc/CascadeProjects/vexor-Oracle/vexor-Oracle-main/.env';
if (fs.existsSync(rootEnv)) {
  config({ path: rootEnv, override: true });
}

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
  timestamp: number;
  outcome: 'WIN' | 'LOSS';
  hour: number;
  dayOfWeek: number;
  volatility: number;
  regime: string;
  rsi_zone: string;
  trend: string;
  atr_zone: string;
  exitPrice: number;
  pnl: number;
}

async function importSignals() {
  console.log('📊 Importando signals_history.json para Oracle DB...\n');
  
  // Lê o arquivo
  const signalsPath = 'C:/Users/opc/CascadeProjects/vexor-Oracle/vexor-Oracle-main/learning_data/signals_history.json';
  
  if (!fs.existsSync(signalsPath)) {
    console.log('❌ Arquivo não encontrado:', signalsPath);
    return;
  }
  
  const content = fs.readFileSync(signalsPath, 'utf-8');
  const signals: Signal[] = JSON.parse(content);
  
  console.log(`📊 Total de sinais: ${signals.length}`);
  
  // Estatísticas
  let wins = 0;
  let losses = 0;
  let totalPnl = 0;
  
  const symbolStats: Record<string, { wins: number; losses: number; pnl: number }> = {};
  
  for (const s of signals) {
    if (s.outcome === 'WIN') wins++;
    else losses++;
    totalPnl += s.pnl;
    
    if (!symbolStats[s.symbol]) {
      symbolStats[s.symbol] = { wins: 0, losses: 0, pnl: 0 };
    }
    if (s.outcome === 'WIN') symbolStats[s.symbol].wins++;
    else symbolStats[s.symbol].losses++;
    symbolStats[s.symbol].pnl += s.pnl;
  }
  
  const wr = (wins / signals.length) * 100;
  
  console.log(`\n📊 ESTATÍSTICAS:`);
  console.log(`├─ Wins: ${wins} | Losses: ${losses}`);
  console.log(`├─ Win Rate: ${wr.toFixed(1)}%`);
  console.log(`└─ P&L Total: ${totalPnl.toFixed(2)}`);
  
  console.log(`\n📊 POR SÍMBOLO:`);
  for (const [symbol, stats] of Object.entries(symbolStats).sort((a, b) => b[1].pnl - a[1].pnl)) {
    const symWR = ((stats.wins / (stats.wins + stats.losses)) * 100).toFixed(1);
    console.log(`├─ ${symbol}: WR ${symWR}% | P&L ${stats.pnl.toFixed(2)}`);
  }
  
  // Insere no Oracle
  console.log(`\n💾 Inserindo ${signals.length} trades no Oracle...`);
  
  let inserted = 0;
  
  for (const s of signals) {
    try {
      await oracleDB.insert(
        `INSERT INTO trade_history 
         (id, symbol, side, quantity, entry_price, exit_price, stop_price, target_price, pnl, pnl_percent, outcome, strategy, broker, closed_at)
         VALUES 
         (:id, :symbol, :side, :quantity, :entry_price, :exit_price, :stop_price, :target_price, :pnl, :pnl_percent, :outcome, :strategy, :broker, :closed_at)`,
        {
          id: s.id,
          symbol: s.symbol,
          side: s.side,
          quantity: s.quantity,
          entry_price: s.entry,
          exit_price: s.exitPrice,
          stop_price: s.stop,
          target_price: s.target,
          pnl: s.pnl * 100, // Converte para R$
          pnl_percent: s.pnl * 100,
          outcome: s.outcome === 'WIN' ? 1 : 0,
          strategy: s.strategy,
          broker: 'signals_history',
          closed_at: new Date(s.timestamp)
        }
      );
      inserted++;
      
      if (inserted % 100 === 0) {
        console.log(`  ✅ ${inserted} trades inseridos...`);
      }
      
    } catch (e) {
      // Ignora duplicatas
    }
  }
  
  console.log(`\n✅ ${inserted} trades inseridos no Oracle DB`);
  
  // Mostra stats finais
  const count = await oracleDB.query<{ TOTAL: number }>('SELECT COUNT(*) as TOTAL FROM trade_history');
  const stats = await oracleDB.query<{ WINS: number; TOTAL: number; PNL: number }>(
    `SELECT 
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as WINS,
      COUNT(*) as TOTAL,
      SUM(pnl) as PNL
     FROM trade_history`
  );
  
  const finalTotal = stats[0]?.TOTAL || 0;
  const finalWins = stats[0]?.WINS || 0;
  const finalPnl = stats[0]?.PNL || 0;
  const finalWR = finalTotal > 0 ? (finalWins / finalTotal) * 100 : 0;
  
  console.log('\n📊 ========================================');
  console.log('📊 ORACLE DB - DADOS REAIS IMPORTADOS');
  console.log('📊 ========================================');
  console.log(`├─ Total Trades: ${finalTotal}`);
  console.log(`├─ Wins: ${finalWins} | Losses: ${finalTotal - finalWins}`);
  console.log(`├─ Win Rate: ${finalWR.toFixed(1)}%`);
  console.log(`└─ P&L Total: R$ ${finalPnl.toFixed(2)}`);
}

importSignals().catch(console.error);
