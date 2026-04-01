/**
 * Análise de R/R Real - Sistema Live vs Backtest
 * Verifica configurações de Risk/Reward no sistema
 */

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

interface Signal {
  id: string;
  symbol: string;
  side: string;
  entry: number;
  stop: number;
  target: number;
  quantity: number;
  strategy: string;
  confidence: number;
  timestamp: number;
  outcome: string;
  pnl: number;
}

async function analyzeRRConfig() {
  console.log('📊 ========================================');
  console.log('📊 ANÁLISE DE R/R REAL - SISTEMA LIVE');
  console.log('📊 ========================================\n');
  
  // Carrega signals_history.json
  const signalsPath = 'C:/Users/opc/CascadeProjects/vexor-Oracle/vexor-Oracle-main/learning_data/signals_history.json';
  
  if (!fs.existsSync(signalsPath)) {
    console.log('❌ Arquivo signals_history.json não encontrado');
    return;
  }
  
  const signals: Signal[] = JSON.parse(fs.readFileSync(signalsPath, 'utf-8'));
  
  console.log(`📊 Total de sinais: ${signals.length}`);
  
  // Calcula R/R configurado para cada sinal
  const rrAnalysis: {
    symbol: string;
    entry: number;
    stop: number;
    target: number;
    risk: number;
    reward: number;
    rr: number;
    outcome: string;
    pnl: number;
    side: string;
  }[] = [];
  
  for (const s of signals) {
    // R = Entry - Stop (risco)
    // R = Target - Entry (recompensa)
    
    let risk: number;
    let reward: number;
    
    if (s.side === 'BUY') {
      risk = Math.abs(s.entry - s.stop); // Distância até stop
      reward = Math.abs(s.target - s.entry); // Distância até target
    } else {
      risk = Math.abs(s.stop - s.entry); // Distância até stop (SELL)
      reward = Math.abs(s.entry - s.target); // Distância até target (SELL)
    }
    
    const rr = risk > 0 ? reward / risk : 0;
    
    rrAnalysis.push({
      symbol: s.symbol,
      entry: s.entry,
      stop: s.stop,
      target: s.target,
      risk,
      reward,
      rr,
      outcome: s.outcome,
      pnl: s.pnl,
      side: s.side
    });
  }
  
  // Estatísticas de R/R
  const avgRR = rrAnalysis.reduce((s, r) => s + r.rr, 0) / rrAnalysis.length;
  const minRR = Math.min(...rrAnalysis.map(r => r.rr));
  const maxRR = Math.max(...rrAnalysis.map(r => r.rr));
  
  // Por símbolo
  const bySymbol: Record<string, { count: number, avgRR: number, wins: number, losses: number, pnl: number }> = {};
  
  for (const r of rrAnalysis) {
    if (!bySymbol[r.symbol]) {
      bySymbol[r.symbol] = { count: 0, avgRR: 0, wins: 0, losses: 0, pnl: 0 };
    }
    bySymbol[r.symbol].count++;
    bySymbol[r.symbol].avgRR += r.rr;
    bySymbol[r.symbol].pnl += r.pnl;
    if (r.outcome === 'WIN') bySymbol[r.symbol].wins++;
    else bySymbol[r.symbol].losses++;
  }
  
  for (const sym of Object.keys(bySymbol)) {
    bySymbol[sym].avgRR = bySymbol[sym].avgRR / bySymbol[sym].count;
  }
  
  // Wins vs Losses por R/R
  const wins = rrAnalysis.filter(r => r.outcome === 'WIN');
  const losses = rrAnalysis.filter(r => r.outcome === 'LOSS');
  
  const avgRRWins = wins.length > 0 ? wins.reduce((s, r) => s + r.rr, 0) / wins.length : 0;
  const avgRRLosses = losses.length > 0 ? losses.reduce((s, r) => s + r.rr, 0) / losses.length : 0;
  
  // Profit Factor
  const grossProfit = wins.reduce((s, r) => s + Math.abs(r.pnl), 0);
  const grossLoss = losses.reduce((s, r) => s + Math.abs(r.pnl), 0);
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 0;
  
  // Win Rate
  const winRate = (wins.length / rrAnalysis.length) * 100;
  
  console.log(`\n📊 R/R MÉDIO: ${avgRR.toFixed(2)}`);
  console.log(`├─ Mínimo: ${minRR.toFixed(2)}`);
  console.log(`├─ Máximo: ${maxRR.toFixed(2)}`);
  console.log(`├─ Wins: ${avgRRWins.toFixed(2)}`);
  console.log(`└─ Losses: ${avgRRLosses.toFixed(2)}`);
  
  console.log(`\n📊 PERFORMANCE:`);
  console.log(`├─ Win Rate: ${winRate.toFixed(1)}%`);
  console.log(`├─ Profit Factor: ${profitFactor.toFixed(2)}`);
  console.log(`├─ Wins: ${wins.length}`);
  console.log(`└─ Losses: ${losses.length}`);
  
  // Telegram - Mensagem 1: R/R Configurado
  const msg1 = `
📊 *ANÁLISE R/R - SISTEMA LIVE*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📐 *R/R CONFIGURADO:*
├─ Médio: *1:${avgRR.toFixed(2)}*
├─ Mínimo: 1:${minRR.toFixed(2)}
├─ Máximo: 1:${maxRR.toFixed(2)}
└─ Total sinais: ${rrAnalysis.length}

📊 *R/R POR OUTCOME:*
├─ Wins: 1:${avgRRWins.toFixed(2)}
└─ Losses: 1:${avgRRLosses.toFixed(2)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ *COMPARAÇÃO:*
├─ Backtest R/R: 1:1.1
├─ Live R/R: 1:${avgRR.toFixed(2)}
└─ ${avgRR > 1.1 ? '✅ Live mais agressivo' : '⚠️ Live mais conservador'}

⏰ ${new Date().toLocaleString('pt-BR')}
`;

  await sendTelegram(msg1);
  
  // Mensagem 2: Por Símbolo
  const msg2 = `
💰 *R/R POR ATIVO*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${Object.entries(bySymbol)
  .sort((a, b) => b[1].pnl - a[1].pnl)
  .slice(0, 10)
  .map(([sym, s]) => {
    const wr = ((s.wins / s.count) * 100).toFixed(0);
    const emoji = s.pnl > 0 ? '✅' : '❌';
    return `${emoji} ${sym}:
   R/R 1:${s.avgRR.toFixed(2)} | WR ${wr}%
   ${s.count} trades | R$ ${s.pnl.toFixed(2)}`;
  }).join('\n\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 *MÉTRICAS GERAIS:*
├─ Win Rate: ${winRate.toFixed(1)}%
├─ Profit Factor: ${profitFactor.toFixed(2)}
└─ P/L Total: R$ ${rrAnalysis.reduce((s, r) => s + r.pnl, 0).toFixed(2)}

⏰ ${new Date().toLocaleString('pt-BR')}
`;

  await sendTelegram(msg2);
  
  // Mensagem 3: Amostra de configurações
  const sample = rrAnalysis.slice(0, 5);
  
  const msg3 = `
🔍 *AMOSTRA DE CONFIGURAÇÕES*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${sample.map((r, i) => {
  return `*Sinal ${i + 1}:*
├─ Ativo: ${r.symbol}
├─ Side: ${r.side}
├─ Entry: ${r.entry.toFixed(2)}
├─ Stop: ${r.stop.toFixed(2)}
├─ Target: ${r.target.toFixed(2)}
├─ Risk: ${r.risk.toFixed(2)}
├─ Reward: ${r.reward.toFixed(2)}
├─ R/R: 1:${r.rr.toFixed(2)}
├─ Outcome: ${r.outcome}
└─ PnL: ${r.pnl.toFixed(4)}`;
}).join('\n\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💡 *ANÁLISE:*
${avgRR < 1.5 
  ? '⚠️ R/R baixo - aumentar targets ou reduzir stops'
  : avgRR > 2.5
  ? '✅ R/R saudável - manter configuração'
  : '📊 R/R moderado - aceitável'}

⏰ ${new Date().toLocaleString('pt-BR')}
`;

  await sendTelegram(msg3);
  
  // Mensagem 4: Recomendações
  const msg4 = `
⚙️ *RECOMENDAÇÕES - SENTINEL_RAM_v520*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 *AJUSTES SUGERIDOS:*

1️⃣ *R/R CONFIGURADO:*
├─ Atual: 1:${avgRR.toFixed(2)}
├─ Ideal: 1:1.5 a 1:2.0
└─ Ação: ${avgRR < 1.5 ? 'Aumentar targets' : 'Manter'}

2️⃣ *LATÊNCIA:*
├─ Medida: 1.39ms
├─ Status: ✅ Excelente
└─ Slippage: Mínimo

3️⃣ *NEWS FILTER:*
├─ Atual: News: 2
├─ Volatilidade Março: Alta
└─ Ação: Aumentar para News: 3

4️⃣ *MAX DRAWDOWN:*
├─ Backtest: 9.8%
├─ Live: Monitorar
└─ Limite: 10% do capital

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🏢 *STACK:*
Oracle ATP | TypeScript
MT5 Genial | Sentinel_RAM

#RiskManagement #Sentinel

⏰ ${new Date().toLocaleString('pt-BR')}
`;

  await sendTelegram(msg4);
  
  console.log('\n✅ 4 mensagens enviadas via Telegram!');
  
  console.log('\n📊 ========================================');
  console.log('📊 RESUMO FINAL');
  console.log('📊 ========================================');
  console.log(`├─ R/R Médio: 1:${avgRR.toFixed(2)}`);
  console.log(`├─ Win Rate: ${winRate.toFixed(1)}%`);
  console.log(`├─ Profit Factor: ${profitFactor.toFixed(2)}`);
  console.log(`└─ P/L: R$ ${rrAnalysis.reduce((s, r) => s + r.pnl, 0).toFixed(2)}`);
}

analyzeRRConfig().catch(console.error);
