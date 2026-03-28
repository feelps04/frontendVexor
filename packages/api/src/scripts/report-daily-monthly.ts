/**
 * Relatório completo por dia e por mês - envia via Telegram
 */

import { oracleDB } from '../infrastructure/oracle-db.js';
import * as fs from 'fs';
import { config } from 'dotenv';

const rootEnv = 'C:/Users/opc/CascadeProjects/vexor-Oracle/vexor-Oracle-main/.env';
if (fs.existsSync(rootEnv)) {
  config({ path: rootEnv, override: true });
}

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

async function sendTelegram(message: string): Promise<void> {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'Markdown',
    }),
  });
}

async function generateReport() {
  console.log('📊 Gerando relatório por dia e por mês...\n');
  
  // Stats gerais
  const stats = await oracleDB.query<{ WINS: number; TOTAL: number; PNL: number }>(
    `SELECT 
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as WINS,
      COUNT(*) as TOTAL,
      SUM(pnl) as PNL
     FROM trade_history`
  );
  
  const total = stats[0]?.TOTAL || 0;
  const wins = stats[0]?.WINS || 0;
  const pnl = stats[0]?.PNL || 0;
  const wr = total > 0 ? (wins / total) * 100 : 0;
  
  // Por mês
  const monthlyStats = await oracleDB.query<{ MONTH: string; WINS: number; TOTAL: number; PNL: number }>(
    `SELECT 
      TO_CHAR(closed_at, 'YYYY-MM') as MONTH,
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as WINS,
      COUNT(*) as TOTAL,
      SUM(pnl) as PNL
     FROM trade_history
     WHERE closed_at IS NOT NULL
     GROUP BY TO_CHAR(closed_at, 'YYYY-MM')
     ORDER BY MONTH DESC`
  );
  
  // Por dia
  const dailyStats = await oracleDB.query<{ DATE: string; WINS: number; TOTAL: number; PNL: number }>(
    `SELECT 
      TO_CHAR(closed_at, 'YYYY-MM-DD') as DATE,
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as WINS,
      COUNT(*) as TOTAL,
      SUM(pnl) as PNL
     FROM trade_history
     WHERE closed_at IS NOT NULL
     GROUP BY TO_CHAR(closed_at, 'YYYY-MM-DD')
     ORDER BY DATE DESC`
  );
  
  // Por símbolo
  const symbolStats = await oracleDB.query<{ SYMBOL: string; WINS: number; TOTAL: number; PNL: number }>(
    `SELECT 
      symbol as SYMBOL,
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as WINS,
      COUNT(*) as TOTAL,
      SUM(pnl) as PNL
     FROM trade_history
     GROUP BY symbol
     ORDER BY PNL DESC`
  );
  
  // Por broker
  const brokerStats = await oracleDB.query<{ BROKER: string; WINS: number; TOTAL: number; PNL: number }>(
    `SELECT 
      broker as BROKER,
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as WINS,
      COUNT(*) as TOTAL,
      SUM(pnl) as PNL
     FROM trade_history
     GROUP BY broker
     ORDER BY PNL DESC`
  );
  
  // Monta mensagens (dividir em partes devido ao limite do Telegram)
  
  // PARTE 1: Resumo Geral
  let msg1 = `
📊 *VEXOR-ORACLE - RELATÓRIO COMPLETO*
━━━━━━━━━━━━━━━━━━━━━━━━━━

📈 *RESUMO GERAL*
├─ Total Trades: *${total}*
├─ Wins: ${wins} | Losses: ${total - wins}
├─ Win Rate: *${wr.toFixed(1)}%*
└─ P&L Total: *R$ ${pnl.toFixed(2)}*

━━━━━━━━━━━━━━━━━━━━━━━━━━
⏰ ${new Date().toLocaleString('pt-BR')}
`;
  
  // PARTE 2: Por Mês
  let msg2 = `
📅 *POR MÊS*
━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
  
  for (const m of monthlyStats) {
    const mWR = ((m.WINS / m.TOTAL) * 100).toFixed(0);
    const mPnl = m.PNL.toFixed(2);
    const emoji = m.PNL > 0 ? '✅' : '❌';
    msg2 += `${emoji} ${m.MONTH}: WR ${mWR}% | R$ ${mPnl}\n`;
  }
  
  // PARTE 3: Últimos 14 dias
  let msg3 = `
📆 *ÚLTIMOS 14 DIAS*
━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
  
  for (const d of dailyStats) {
    const dWR = ((d.WINS / d.TOTAL) * 100).toFixed(0);
    const dPnl = d.PNL.toFixed(2);
    const emoji = d.PNL > 0 ? '✅' : '❌';
    msg3 += `${emoji} ${d.DATE}: WR ${dWR}% | R$ ${dPnl}\n`;
  }
  
  // PARTE 4: Por Ativo
  let msg4 = `
💰 *POR ATIVO*
━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
  
  for (const s of symbolStats.slice(0, 10)) {
    const sWR = ((s.WINS / s.TOTAL) * 100).toFixed(0);
    const sPnl = s.PNL.toFixed(2);
    const emoji = s.PNL > 0 ? '✅' : '❌';
    msg4 += `${emoji} ${s.SYMBOL}: WR ${sWR}% | R$ ${sPnl}\n`;
  }
  
  // PARTE 5: Por Broker
  let msg5 = `
🏦 *POR BROKER*
━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
  
  for (const b of brokerStats) {
    const bWR = ((b.WINS / b.TOTAL) * 100).toFixed(0);
    const bPnl = b.PNL.toFixed(2);
    const emoji = b.PNL > 0 ? '✅' : '❌';
    msg5 += `${emoji} ${b.BROKER}: WR ${bWR}% | R$ ${bPnl}\n`;
  }
  
  // Envia todas as partes
  console.log('📤 Enviando relatório via Telegram...\n');
  
  await sendTelegram(msg1);
  console.log('✅ Parte 1: Resumo Geral');
  
  await sendTelegram(msg2);
  console.log('✅ Parte 2: Por Mês');
  
  await sendTelegram(msg3);
  console.log('✅ Parte 3: Por Dia');
  
  await sendTelegram(msg4);
  console.log('✅ Parte 4: Por Ativo');
  
  await sendTelegram(msg5);
  console.log('✅ Parte 5: Por Broker');
  
  console.log('\n📊 Relatório completo enviado!');
  
  // Mostra no console também
  console.log('\n' + msg1);
  console.log(msg2);
  console.log(msg3);
  console.log(msg4);
  console.log(msg5);
}

generateReport().catch(console.error);
