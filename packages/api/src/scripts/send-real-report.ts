/**
 * Envia relatório de dados REAIS via Telegram
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

async function sendReport() {
  console.log('📊 Gerando relatório de dados REAIS...\n');
  
  // Busca stats gerais
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
  
  // Busca stats por símbolo
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
  
  // Busca brokers distintos
  const brokers = await oracleDB.query<{ BROKER: string }>(
    `SELECT DISTINCT broker as BROKER FROM trade_history`
  );
  
  const brokerList = brokers.map(b => b.BROKER).join(', ') || 'nenhum';
  
  // Monta mensagem
  let message = `
📊 *VEXOR-ORACLE - DADOS REAIS*
━━━━━━━━━━━━━━━━━━━━━━━━━━

📈 *RESUMO GERAL*
├─ Total Trades: ${total}
├─ Wins: ${wins} | Losses: ${total - wins}
├─ Win Rate: *${wr.toFixed(1)}%*
├─ P&L Total: *R$ ${pnl.toFixed(2)}*
└─ Fontes: ${brokers}

📊 *POR ATIVO (TOP 5)*
`;
  
  for (const s of symbolStats.slice(0, 5)) {
    const symWR = ((s.WINS / s.TOTAL) * 100).toFixed(1);
    const symPnl = s.PNL.toFixed(2);
    const emoji = s.PNL > 0 ? '✅' : '❌';
    message += `├─ ${emoji} ${s.SYMBOL}: WR ${symWR}% | R$ ${symPnl}\n`;
  }
  
  message += `
━━━━━━━━━━━━━━━━━━━━━━━━━━
⏰ ${new Date().toLocaleString('pt-BR')}
`;
  
  // Envia via Telegram
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
  
  if (response.ok) {
    console.log('✅ Relatório enviado via Telegram!');
  } else {
    console.log('❌ Erro ao enviar:', await response.text());
  }
  
  console.log('\n' + message);
}

sendReport().catch(console.error);
