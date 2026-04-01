/**
 * Reseta tabela e importa APENAS dados reais
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

async function resetAndImportReal() {
  console.log('📊 ========================================');
  console.log('📊 RESETANDO - APENAS DADOS REAIS');
  console.log('📊 ========================================\n');
  
  // 1. Drop e recria tabela
  console.log('🗑️ Resetando tabela...');
  try {
    await oracleDB.execute('DROP TABLE trade_history');
    console.log('   ✅ Tabela removida');
  } catch (e) {
    console.log('   ⚠️ Tabela não existia');
  }
  
  // Recria tabela
  await oracleDB.execute(`
    CREATE TABLE trade_history (
      id VARCHAR2(100) PRIMARY KEY,
      symbol VARCHAR2(50),
      side VARCHAR2(10),
      quantity NUMBER,
      entry_price NUMBER,
      exit_price NUMBER,
      stop_price NUMBER,
      target_price NUMBER,
      pnl NUMBER,
      pnl_percent NUMBER,
      outcome NUMBER,
      strategy VARCHAR2(100),
      broker VARCHAR2(50),
      closed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log('   ✅ Tabela recriada');
  
  // 2. Importa signals_history.json (único dado real disponível)
  const signalsPath = 'C:/Users/opc/CascadeProjects/vexor-Oracle/vexor-Oracle-main/learning_data/signals_history.json';
  
  if (!fs.existsSync(signalsPath)) {
    console.log('❌ Arquivo signals_history.json não encontrado');
    return;
  }
  
  console.log('\n📊 Importando dados REAIS de signals_history.json...');
  const content = fs.readFileSync(signalsPath, 'utf-8');
  const signals = JSON.parse(content);
  
  console.log(`   Total de sinais: ${signals.length}`);
  
  let inserted = 0;
  let wins = 0;
  let totalPnl = 0;
  
  for (const s of signals) {
    try {
      const pnl = s.pnl * 100;
      
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
          pnl: pnl,
          pnl_percent: pnl,
          outcome: s.outcome === 'WIN' ? 1 : 0,
          strategy: s.strategy,
          broker: 'signals_history',
          closed_at: new Date(s.timestamp)
        }
      );
      
      inserted++;
      if (s.outcome === 'WIN') wins++;
      totalPnl += pnl;
      
    } catch (e) {
      // Ignora erros
    }
  }
  
  const losses = inserted - wins;
  const wr = inserted > 0 ? (wins / inserted) * 100 : 0;
  
  console.log(`   ✅ ${inserted} trades REAIS importados`);
  
  // 3. Relatório
  console.log('\n📊 ========================================');
  console.log('📊 APENAS DADOS REAIS');
  console.log('📊 ========================================');
  console.log(`├─ Total Trades: ${inserted}`);
  console.log(`├─ Wins: ${wins} | Losses: ${losses}`);
  console.log(`├─ Win Rate: ${wr.toFixed(1)}%`);
  console.log(`└─ P&L Total: R$ ${totalPnl.toFixed(2)}`);
  
  // 4. Envia relatório via Telegram
  const reportMsg = `
📊 *DADOS REAIS - ORACLE DB*
━━━━━━━━━━━━━━━━━━━━━━━━━━

📈 *RESUMO:*
├─ Total Trades: *${inserted}*
├─ Wins: ${wins} | Losses: ${losses}
├─ Win Rate: *${wr.toFixed(1)}%*
└─ P&L Total: *R$ ${totalPnl.toFixed(2)}*

📁 Fonte: signals_history.json

━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ *DADOS MT5 AUSENTES:*

Para importar do MetaTrader 5:

1️⃣ Abra MT5 (Genial ou Pepperstone)
2️⃣ Ferramentas → Histórico
3️⃣ Botão direito → Salvar como CSV
4️⃣ Salve em:
\`data/mt5_history.csv\`

⏰ ${new Date().toLocaleString('pt-BR')}
`;

  await sendTelegram(reportMsg);
  console.log('\n✅ Relatório enviado via Telegram!');
}

resetAndImportReal().catch(console.error);
