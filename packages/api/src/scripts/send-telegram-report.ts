/**
 * Envia Relatório Backtest via Telegram
 * Win Rate dia a dia e mês a mês - 300 dias
 * 
 * Fórmula WR: (Ganhos / Total) x 100
 */

import * as fs from 'fs';
import * as path from 'path';

// Configuração Telegram (via env)
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

interface DailyStats {
  trades: number;
  wins: number;
  losses: number;
  pnl: number;
}

interface MonthlyStats {
  trades: number;
  wins: number;
  losses: number;
  pnl: number;
}

interface BacktestReport {
  timestamp: string;
  period: string;
  summary: {
    totalTrades: number;
    totalWins: number;
    totalLosses: number;
    winRate: number;
    totalPnL: number;
    approved: boolean;
  };
  symbols: Array<{
    symbol: string;
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    totalPnL: number;
  }>;
  dailyBreakdown: Record<string, DailyStats>;
  monthlyBreakdown: Record<string, MonthlyStats>;
}

/**
 * Calcula Win Rate: (Ganhos / Total) x 100
 */
function calculateWinRate(wins: number, total: number): number {
  if (total === 0) return 0;
  return (wins / total) * 100;
}

/**
 * Formata mensagem para Telegram (limite 4096 chars)
 */
function formatTelegramMessage(report: BacktestReport): string {
  const lines: string[] = [];
  
  // Header
  lines.push('📊 *VEXOR-ORACLE - BACKTEST 300 DIAS*');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('');
  
  // Resumo Global
  const wr = calculateWinRate(report.summary.totalWins, report.summary.totalTrades);
  lines.push('🎯 *RESULTADO GLOBAL*');
  lines.push(`├─ Trades: ${report.summary.totalTrades}`);
  lines.push(`├─ Wins: ${report.summary.totalWins}`);
  lines.push(`├─ Losses: ${report.summary.totalLosses}`);
  lines.push(`├─ Win Rate: *${wr.toFixed(1)}%*`);
  lines.push(`├─ P&L Total: R$ ${report.summary.totalPnL.toFixed(2)}`);
  lines.push(`└─ Status: ${report.summary.approved ? '✅ APROVADO' : '❌ REPROVADO'}`);
  lines.push('');
  
  // Top Símbolos
  lines.push('📈 *TOP SÍMBOLOS (por WR)*');
  const sortedSymbols = [...report.symbols].sort((a, b) => b.winRate - a.winRate).slice(0, 5);
  for (const s of sortedSymbols) {
    const sWr = calculateWinRate(s.wins, s.totalTrades);
    lines.push(`${s.symbol}: ${sWr.toFixed(1)}% (${s.totalTrades} trades)`);
  }
  lines.push('');
  
  // Breakdown Mensal
  lines.push('📅 *WIN RATE MENSAL*');
  lines.push('`MÊS      │TRADES│WINS│LOSS│WR%  │P&L`');
  lines.push('`─────────┼──────┼────┼────┼──────┼─────`');
  
  const sortedMonths = Object.entries(report.monthlyBreakdown)
    .sort((a, b) => b[0].localeCompare(a[0]));
  
  for (const [month, data] of sortedMonths) {
    const mWr = calculateWinRate(data.wins, data.trades);
    const monthShort = month.replace('-', '');
    lines.push(`\`${monthShort} │${data.trades.toString().padStart(6)}│${data.wins.toString().padStart(4)}│${data.losses.toString().padStart(4)}│${mWr.toFixed(1).padStart(5)}%│R$${data.pnl.toFixed(0)}\``);
  }
  lines.push('');
  
  // Breakdown Diário (últimos 7 dias)
  lines.push('📆 *WIN RATE DIÁRIO (ÚLTIMOS 7 DIAS)*');
  lines.push('`DATA     │T│W│L│WR%  │P&L`');
  lines.push('`─────────┼─┼─┼─┼──────┼─────`');
  
  const sortedDays = Object.entries(report.dailyBreakdown)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 7);
  
  for (const [date, data] of sortedDays) {
    const dWr = calculateWinRate(data.wins, data.trades);
    const dateShort = date.substring(5); // MM-DD
    lines.push(`\`${dateShort} │${data.trades}│${data.wins}│${data.losses}│${dWr.toFixed(1).padStart(5)}%│R$${data.pnl.toFixed(0)}\``);
  }
  lines.push('');
  
  // Fórmula
  lines.push('📐 *FÓRMULA WIN RATE*');
  lines.push('`WR = (Ganhos / Total) x 100`');
  lines.push('');
  
  // Status Final
  if (report.summary.approved) {
    lines.push('✅✅✅ *SISTEMA APROVADO - PRONTO PARA LIVE*');
  } else {
    lines.push('❌ *SISTEMA REPROVADO - REVISAR PARÂMETROS*');
  }
  
  lines.push('');
  lines.push(`⏰ Gerado: ${new Date().toLocaleString('pt-BR')}`);
  
  return lines.join('\n');
}

/**
 * Formata mensagem CSV para arquivo
 */
function formatCSVReport(report: BacktestReport): string {
  const lines: string[] = [];
  
  // Header
  lines.push('VEXOR-ORACLE BACKTEST 300 DIAS');
  lines.push('');
  lines.push('WIN RATE DIÁRIO');
  lines.push('DATA,TRADES,WINS,LOSSES,WIN_RATE(%),PnL(R$)');
  
  // Dados diários
  const sortedDays = Object.entries(report.dailyBreakdown)
    .sort((a, b) => b[0].localeCompare(a[0]));
  
  for (const [date, data] of sortedDays) {
    const wr = calculateWinRate(data.wins, data.trades);
    lines.push(`${date},${data.trades},${data.wins},${data.losses},${wr.toFixed(1)},${data.pnl.toFixed(2)}`);
  }
  
  lines.push('');
  lines.push('WIN RATE MENSAL');
  lines.push('MES,TRADES,WINS,LOSSES,WIN_RATE(%),PnL(R$)');
  
  const sortedMonths = Object.entries(report.monthlyBreakdown)
    .sort((a, b) => b[0].localeCompare(a[0]));
  
  for (const [month, data] of sortedMonths) {
    const wr = calculateWinRate(data.wins, data.trades);
    lines.push(`${month},${data.trades},${data.wins},${data.losses},${wr.toFixed(1)},${data.pnl.toFixed(2)}`);
  }
  
  lines.push('');
  lines.push('RESUMO GLOBAL');
  lines.push(`Total Trades,${report.summary.totalTrades}`);
  lines.push(`Total Wins,${report.summary.totalWins}`);
  lines.push(`Total Losses,${report.summary.totalLosses}`);
  lines.push(`Win Rate (%),${calculateWinRate(report.summary.totalWins, report.summary.totalTrades).toFixed(1)}`);
  lines.push(`P&L Total (R$),${report.summary.totalPnL.toFixed(2)}`);
  lines.push(`Status,${report.summary.approved ? 'APROVADO' : 'REPROVADO'}`);
  
  return lines.join('\n');
}

/**
 * Envia mensagem via Telegram API
 */
async function sendTelegramMessage(message: string): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('⚠️ Telegram não configurado. Configure TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID');
    console.log('\n📝 MENSAGEM QUE SERIA ENVIADA:\n');
    console.log(message);
    return false;
  }
  
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown',
      }),
    });
    
    const data = await response.json() as { ok?: boolean; description?: string };
    
    if (data.ok) {
      console.log('✅ Mensagem enviada via Telegram!');
      return true;
    } else {
      console.error('❌ Erro ao enviar Telegram:', data.description);
      return false;
    }
  } catch (e) {
    console.error('❌ Erro na API Telegram:', e);
    return false;
  }
}

/**
 * Envia arquivo CSV via Telegram
 */
async function sendTelegramDocument(csvContent: string, filename: string): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('⚠️ Telegram não configurado para envio de arquivo');
    return false;
  }
  
  try {
    // Salva arquivo temporário
    const tempPath = path.join(process.cwd(), 'data', filename);
    fs.writeFileSync(tempPath, csvContent);
    
    const FormData = require('form-data');
    const form = new FormData();
    form.append('chat_id', TELEGRAM_CHAT_ID);
    form.append('document', fs.createReadStream(tempPath));
    form.append('caption', '📊 Relatório completo Win Rate 300 dias');
    
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`;
    
    const response = await fetch(url, {
      method: 'POST',
      body: form,
    });
    
    const data = await response.json() as { ok?: boolean };
    
    if (data.ok) {
      console.log('✅ Arquivo CSV enviado via Telegram!');
      return true;
    }
    
    return false;
  } catch (e) {
    console.error('❌ Erro ao enviar arquivo:', e);
    return false;
  }
}

/**
 * Main
 */
async function main() {
  console.log('📊 ========================================');
  console.log('📊 VEXOR-ORACLE - RELATÓRIO TELEGRAM');
  console.log('📊 ========================================\n');
  
  // Carrega relatório
  const reportPath = path.join(process.cwd(), 'data', 'backtest-report-2026-03-07.json');
  
  if (!fs.existsSync(reportPath)) {
    console.error('❌ Relatório não encontrado. Execute o backtest primeiro.');
    process.exit(1);
  }
  
  const report: BacktestReport = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  
  console.log('📋 Calculando Win Rates...\n');
  
  // Calcula WR global
  const globalWR = calculateWinRate(report.summary.totalWins, report.summary.totalTrades);
  console.log(`WR Global: ${globalWR.toFixed(1)}%`);
  
  // Calcula WR por símbolo
  console.log('\nWR por Símbolo:');
  for (const s of report.symbols) {
    const wr = calculateWinRate(s.wins, s.totalTrades);
    console.log(`  ${s.symbol}: ${wr.toFixed(1)}%`);
  }
  
  // Calcula WR por mês
  console.log('\nWR por Mês:');
  for (const [month, data] of Object.entries(report.monthlyBreakdown).sort((a, b) => b[0].localeCompare(a[0]))) {
    const wr = calculateWinRate(data.wins, data.trades);
    console.log(`  ${month}: ${wr.toFixed(1)}% (${data.wins}W/${data.losses}L)`);
  }
  
  // Formata mensagem
  const message = formatTelegramMessage(report);
  
  // Formata CSV
  const csv = formatCSVReport(report);
  
  // Salva CSV
  const csvPath = path.join(process.cwd(), 'data', 'winrate-300dias.csv');
  fs.writeFileSync(csvPath, csv);
  console.log(`\n💾 CSV salvo: ${csvPath}`);
  
  // Envia via Telegram
  console.log('\n📤 Enviando via Telegram...\n');
  
  await sendTelegramMessage(message);
  
  // Tenta enviar CSV também
  // await sendTelegramDocument(csv, 'winrate-300dias.csv');
  
  console.log('\n✅ Relatório processado!');
}

main().catch(e => {
  console.error('❌ Erro:', e);
  process.exit(1);
});
