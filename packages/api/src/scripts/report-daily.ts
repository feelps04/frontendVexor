/**
 * Relatório por dia e mês - busca todos os dados e processa em JS
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

async function sendTelegram(message: string) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'Markdown' }),
  });
}

async function generateReport() {
  console.log('📊 Gerando relatório por dia e mês...\n');
  
  // Busca todos os trades
  const trades = await oracleDB.query<{ CLOSED_AT: Date; PNL: number }>(
    `SELECT closed_at as CLOSED_AT, pnl as PNL FROM trade_history WHERE closed_at IS NOT NULL`
  );
  
  console.log(`📊 Total de trades com data: ${trades.length}`);
  
  // Processa em JS
  const monthlyData: Record<string, { wins: number; total: number; pnl: number }> = {};
  const dailyData: Record<string, { wins: number; total: number; pnl: number }> = {};
  
  for (const t of trades) {
    const date = new Date(t.CLOSED_AT);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const dayKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    
    // Mês
    if (!monthlyData[monthKey]) monthlyData[monthKey] = { wins: 0, total: 0, pnl: 0 };
    monthlyData[monthKey].total++;
    monthlyData[monthKey].pnl += t.PNL;
    if (t.PNL > 0) monthlyData[monthKey].wins++;
    
    // Dia
    if (!dailyData[dayKey]) dailyData[dayKey] = { wins: 0, total: 0, pnl: 0 };
    dailyData[dayKey].total++;
    dailyData[dayKey].pnl += t.PNL;
    if (t.PNL > 0) dailyData[dayKey].wins++;
  }
  
  // Ordena
  const months = Object.entries(monthlyData).sort((a, b) => b[0].localeCompare(a[0]));
  const days = Object.entries(dailyData).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 14);
  
  // PARTE 1: Por Mês
  let msg1 = `📅 *POR MÊS*
━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
  for (const [month, s] of months) {
    const wr = ((s.wins / s.total) * 100).toFixed(0);
    const pnl = s.pnl.toFixed(2);
    const emoji = s.pnl > 0 ? '✅' : '❌';
    msg1 += `${emoji} ${month}: WR ${wr}% | R$ ${pnl}\n`;
  }
  
  // PARTE 2: Por Dia (últimos 14)
  let msg2 = `📆 *ÚLTIMOS 14 DIAS*
━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
  for (const [day, s] of days) {
    const wr = ((s.wins / s.total) * 100).toFixed(0);
    const pnl = s.pnl.toFixed(2);
    const emoji = s.pnl > 0 ? '✅' : '❌';
    msg2 += `${emoji} ${day}: WR ${wr}% | R$ ${pnl}\n`;
  }
  
  // Envia
  console.log('📤 Enviando relatório via Telegram...\n');
  
  await sendTelegram(msg1);
  console.log('✅ Parte 1: Por Mês');
  
  await sendTelegram(msg2);
  console.log('✅ Parte 2: Por Dia');
  
  console.log('\n📊 Relatório enviado!');
  console.log('\n' + msg1);
  console.log(msg2);
}

generateReport().catch(console.error);
