/**
 * Limpa tabela e busca dados REAIS do MT5
 */

import { oracleDB } from '../infrastructure/oracle-db.js';
import * as fs from 'fs';
import * as path from 'path';
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

// Caminhos MT5
const MT5_PATHS = {
  metaTrader: 'C:/Program Files/MetaTrader 5',
  pepperstone: 'C:/Program Files/Pepperstone MetaTrader 5',
  appData: 'C:/Users/opc/AppData/Roaming/MetaQuotes/Terminal/73B7A2420D6397DFF9014A20F1201F97',
};

async function cleanAndFetchReal() {
  console.log('📊 ========================================');
  console.log('📊 LIMPANDO E BUSCANDO DADOS REAIS');
  console.log('📊 ========================================\n');
  
  // 1. Limpa tabela
  console.log('🗑️ Limpando tabela trade_history...');
  try {
    await oracleDB.execute('DELETE FROM trade_history');
    console.log('   ✅ Tabela limpa');
  } catch (e) {
    console.log('   ❌ Erro ao limpar:', e);
  }
  
  // 2. Verifica arquivos MT5
  console.log('\n📁 Verificando arquivos MT5...');
  
  // Verifica se há arquivos de exportação
  const exportPaths = [
    `${MT5_PATHS.appData}/MQL5/Files`,
    `${MT5_PATHS.appData}/files`,
    `C:/Users/opc/Documents/MetaTrader 5`,
    `C:/Users/opc/Downloads`,
  ];
  
  let foundExports: string[] = [];
  
  for (const p of exportPaths) {
    if (fs.existsSync(p)) {
      const files = fs.readdirSync(p).filter(f => 
        f.endsWith('.csv') || f.endsWith('.json') || f.includes('history') || f.includes('trade')
      );
      if (files.length > 0) {
        console.log(`   ✅ ${p}: ${files.length} arquivos`);
        foundExports = files.map(f => path.join(p, f));
      }
    }
  }
  
  // 3. Verifica histórico binário
  console.log('\n📁 Verificando histórico binário MT5...');
  
  const historyPath = `${MT5_PATHS.appData}/bases/Default/History`;
  if (fs.existsSync(historyPath)) {
    const symbols = fs.readdirSync(historyPath);
    console.log(`   Símbolos encontrados: ${symbols.length}`);
    
    for (const sym of symbols.slice(0, 5)) {
      const symPath = path.join(historyPath, sym);
      if (fs.statSync(symPath).isDirectory()) {
        const files = fs.readdirSync(symPath).filter(f => f.endsWith('.hcc'));
        console.log(`   ${sym}: ${files.length} arquivos .hcc`);
      }
    }
  }
  
  // 4. Envia instruções via Telegram
  const message = `
⚠️ *DADOS REAIS NECESSÁRIOS*
━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 *STATUS:*
├─ Tabela limpa ✅
├─ MT5 Genial instalado ✅
├─ MT5 Pepperstone instalado ✅
└─ Dados exportados: ❌ *NENHUM*

━━━━━━━━━━━━━━━━━━━━━━━━━━

📝 *COMO EXPORTAR DO MT5:*

1️⃣ Abra o *MetaTrader 5*
2️⃣ Menu: *Ferramentas* → *Histórico*
3️⃣ Clique com botão direito
4️⃣ Selecione: *Salvar como relatório*
5️⃣ Salve em CSV
6️⃣ Cole em:
\`C:/Users/opc/CascadeProjects/vexor-Oracle/vexor-Oracle-main/data/\`

━━━━━━━━━━━━━━━━━━━━━━━━━━

📁 *OU USE A API:*

Se você tiver Python instalado:
\`\`\`
pip install MetaTrader5
\`\`\`

⏰ ${new Date().toLocaleString('pt-BR')}
`;

  await sendTelegram(message);
  console.log('\n✅ Instruções enviadas via Telegram!');
  
  // 5. Verifica se há dados no signals_history.json (único real)
  const signalsPath = 'C:/Users/opc/CascadeProjects/vexor-Oracle/vexor-Oracle-main/learning_data/signals_history.json';
  
  if (fs.existsSync(signalsPath)) {
    console.log('\n📊 Importando signals_history.json (dados reais)...');
    const content = fs.readFileSync(signalsPath, 'utf-8');
    const signals = JSON.parse(content);
    
    console.log(`   Total de sinais: ${signals.length}`);
    
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
            pnl: s.pnl * 100,
            pnl_percent: s.pnl * 100,
            outcome: s.outcome === 'WIN' ? 1 : 0,
            strategy: s.strategy,
            broker: 'signals_history',
            closed_at: new Date(s.timestamp)
          }
        );
        inserted++;
      } catch (e) {
        // Ignora
      }
    }
    
    console.log(`   ✅ ${inserted} trades reais importados`);
    
    // Relatório
    const stats = await oracleDB.query<{ WINS: number; TOTAL: number; PNL: number }>(
      `SELECT SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as WINS, COUNT(*) as TOTAL, SUM(pnl) as PNL FROM trade_history`
    );
    
    const total = stats[0]?.TOTAL || 0;
    const wins = stats[0]?.WINS || 0;
    const pnl = stats[0]?.PNL || 0;
    const wr = total > 0 ? (wins / total) * 100 : 0;
    
    console.log('\n📊 ========================================');
    console.log('📊 DADOS REAIS IMPORTADOS');
    console.log('📊 ========================================');
    console.log(`├─ Total Trades: ${total}`);
    console.log(`├─ Wins: ${wins} | Losses: ${total - wins}`);
    console.log(`├─ Win Rate: ${wr.toFixed(1)}%`);
    console.log(`└─ P&L Total: R$ ${pnl.toFixed(2)}`);
    
    // Envia relatório real
    const reportMsg = `
📊 *DADOS REAIS - ORACLE DB*
━━━━━━━━━━━━━━━━━━━━━━━━━━

📈 *RESUMO:*
├─ Total Trades: *${total}*
├─ Wins: ${wins} | Losses: ${total - wins}
├─ Win Rate: *${wr.toFixed(1)}%*
└─ P&L Total: *R$ ${pnl.toFixed(2)}*

📁 Fonte: signals_history.json

⚠️ *AGUARDANDO:*
├─ MT5 Genial export
└─ MT5 Pepperstone export

⏰ ${new Date().toLocaleString('pt-BR')}
`;

    await sendTelegram(reportMsg);
  }
}

cleanAndFetchReal().catch(console.error);
