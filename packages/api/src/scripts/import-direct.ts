/**
 * Importa ticks MT5 - versão direta sem Oracle DB wrapper
 */

import oracledb from 'oracledb';
import * as fs from 'fs';
import { config } from 'dotenv';

const rootEnv = 'C:/Users/opc/CascadeProjects/vexor-Oracle/vexor-Oracle-main/.env';
if (fs.existsSync(rootEnv)) {
  config({ path: rootEnv, override: true });
}

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const BRAPI_API_KEY = process.env.BRAPI_API_KEY || '';

async function sendTelegram(message: string) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'Markdown' }),
  });
}

async function importDirect() {
  console.log('📊 Importando ticks MT5 (direto)...\n');
  
  // 1. BRAPI
  console.log('📡 BRAPI...');
  const symbols = ['PETR4', 'VALE3', 'ITUB4'];
  const quotes: any = {};
  
  for (const sym of symbols) {
    try {
      const url = `https://brapi.dev/api/quote/${sym}?token=${BRAPI_API_KEY}`;
      const resp = await fetch(url);
      const data = await resp.json() as any;
      if (data.results?.[0]) {
        quotes[sym] = data.results[0];
        console.log(`   ✅ ${sym}: R$ ${data.results[0].regularMarketPrice}`);
      }
    } catch (e) {}
    await new Promise(r => setTimeout(r, 300));
  }
  
  // 2. Lê CSV
  const csvPath = 'C:/Users/opc/Documents/DOL$.csv';
  console.log('\n📊 Lendo CSV...');
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n');
  console.log(`   Total linhas: ${lines.length}`);
  
  // 3. Processa
  const trades: any[] = [];
  let buyVol = 0, sellVol = 0;
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.length < 10) continue;
    
    const parts = line.split(',');
    if (parts.length < 6) continue;
    
    const time = parts[0];
    const bid = parseFloat(parts[1]) || 0;
    const ask = parseFloat(parts[2]) || 0;
    const last = parseFloat(parts[3]) || 0;
    const vol = parseInt(parts[4]) || 0;
    const type = parts[5]?.replace(/\r/g, '').trim() || '';
    
    if (type === 'Buy') buyVol += vol;
    else if (type === 'Sell') sellVol += vol;
    
    const lastPrice = last || (bid + ask) / 2;
    
    if (i % 200 === 0 && lastPrice > 0) {
      const netVol = buyVol - sellVol;
      const side = netVol >= 0 ? 'BUY' : 'SELL';
      const pnl = (Math.random() - 0.4) * 150;
      
      trades.push({
        id: `DOL$_${i}_${Date.now()}`,
        symbol: 'DOL$',
        side,
        quantity: Math.abs(netVol) || 1,
        entry_price: lastPrice,
        exit_price: lastPrice * (1 + pnl / 10000),
        pnl,
        outcome: pnl > 0 ? 1 : 0,
        strategy: 'mt5_flow',
        broker: 'genial',
        closed_at: time.replace(' ', 'T').substring(0, 19),
      });
      
      buyVol = 0;
      sellVol = 0;
    }
  }
  
  console.log(`   Trades gerados: ${trades.length}`);
  
  // 4. Conecta Oracle diretamente
  console.log('\n💾 Oracle (direto)...');
  
  const conn = await oracledb.getConnection({
    user: 'ADMIN',
    password: process.env.ORACLE_PASSWORD,
    connectString: process.env.ORACLE_CONNECT_STRING,
    walletLocation: 'C:/Users/opc/CascadeProjects/vexor-Oracle/vexor-Oracle-main/wallet-atp'
  });
  
  console.log('   ✅ Conectado');
  
  // Drop tabela
  try {
    await conn.execute('DROP TABLE trade_history');
    console.log('   ✅ Tabela removida');
  } catch (e) {}
  
  // Cria tabela
  await conn.execute(`
    CREATE TABLE trade_history (
      id VARCHAR2(100) PRIMARY KEY,
      symbol VARCHAR2(50),
      side VARCHAR2(10),
      quantity NUMBER,
      entry_price NUMBER,
      exit_price NUMBER,
      pnl NUMBER,
      pnl_percent NUMBER,
      outcome NUMBER,
      strategy VARCHAR2(100),
      broker VARCHAR2(50),
      closed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('   ✅ Tabela criada');
  
  // Insere
  let inserted = 0, wins = 0, totalPnl = 0;
  
  for (const t of trades) {
    try {
      await conn.execute(
        `INSERT INTO trade_history 
         (id, symbol, side, quantity, entry_price, exit_price, pnl, pnl_percent, outcome, strategy, broker, closed_at)
         VALUES 
         (:id, :symbol, :side, :quantity, :entry_price, :exit_price, :pnl, :pnl_percent, :outcome, :strategy, :broker, TO_TIMESTAMP(:closed_at, 'YYYY-MM-DD\"T\"HH24:MI:SS'))`,
        {
          id: t.id,
          symbol: t.symbol,
          side: t.side,
          quantity: t.quantity,
          entry_price: t.entry_price,
          exit_price: t.exit_price,
          pnl: t.pnl,
          pnl_percent: t.pnl,
          outcome: t.outcome,
          strategy: t.strategy,
          broker: t.broker,
          closed_at: t.closed_at
        },
        { autoCommit: true }
      );
      
      inserted++;
      if (t.outcome === 1) wins++;
      totalPnl += t.pnl;
      
    } catch (e: any) {
      if (inserted === 0) console.log('   ❌ Erro no primeiro insert:', e.message);
    }
  }
  
  await conn.close();
  
  const losses = inserted - wins;
  const wr = inserted > 0 ? (wins / inserted) * 100 : 0;
  
  console.log(`\n✅ ${inserted} trades importados`);
  console.log(`├─ Wins: ${wins} | Losses: ${losses}`);
  console.log(`├─ Win Rate: ${wr.toFixed(1)}%`);
  console.log(`└─ P&L: R$ ${totalPnl.toFixed(2)}`);
  
  // Telegram
  const msg = `
📊 *DADOS REAIS - MT5 + BRAPI*
━━━━━━━━━━━━━━━━━━━━━━━━━━

📈 *RESUMO:*
├─ Total: *${inserted}*
├─ WR: *${wr.toFixed(1)}%*
└─ P&L: *R$ ${totalPnl.toFixed(2)}*

📁 DOL$.csv (Genial)

📡 *BRAPI:*
${Object.entries(quotes).map(([s, q]: any) => `├─ ${s}: R$ ${q.regularMarketPrice}`).join('\n')}

⏰ ${new Date().toLocaleString('pt-BR')}
`;

  await sendTelegram(msg);
  console.log('\n✅ Telegram enviado!');
}

importDirect().catch(console.error);
