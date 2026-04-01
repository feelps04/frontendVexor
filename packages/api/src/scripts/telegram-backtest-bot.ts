/**
 * TELEGRAM BACKTEST BOT - Permite usuários testarem estratégias
 * Compara com config do admin e notifica sobre mudanças
 */

import * as fs from 'fs';
import * as path from 'path';
import { config } from 'dotenv';
import { oracleDB } from '../infrastructure/oracle-db.js';
import { telegramNotifier } from '../infrastructure/telegram-notifier.js';

const rootEnv = 'C:/Users/opc/CascadeProjects/vexor-Oracle/vexor-Oracle-main/.env';
if (fs.existsSync(rootEnv)) {
  config({ path: rootEnv, override: true });
}

// ==================== CONFIG ====================

const BOT_CONFIG = {
  token: process.env.TELEGRAM_BOT_TOKEN || '8710971540:AAGs15wUAxx_964NKuEKwL31jTb_mdZ0Kao',
  adminChatId: '7192227673',
  apiBaseUrl: `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN || '8710971540:AAGs15wUAxx_964NKuEKwL31jTb_mdZ0Kao'}`,
  pollInterval: 1000
};

// ==================== ADMIN CONFIG (SUA CONFIGURAÇÃO) ====================

const ADMIN_CONFIG = {
  symbol: 'WDOFUT',
  strategy: 'breakout',
  rr: 2.0,
  newsFilter: 3,
  testDays: 30
};

// ==================== USER SESSIONS ====================

interface BacktestResult {
  userId: string;
  username?: string;
  config: {
    symbol: string;
    strategy: string;
    rr: number;
    newsFilter: number;
  };
  testPeriod: {
    start: string;
    end: string;
  };
  results: {
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;
    totalPnl: number;
    profitFactor: number;
    sharpeRatio: number;
    maxDrawdown: number;
  };
  comparedToAdmin: {
    pnlDiff: number;
    winRateDiff: number;
    isBetter: boolean;
  };
  timestamp: Date;
}

interface UserSession {
  chatId: string;
  username?: string;
  config: {
    symbol: string;
    strategy: string;
    rr: number;
    newsFilter: number;
    startDate?: string;
    endDate?: string;
  };
  state: 'idle' | 'configuring_symbol' | 'configuring_strategy' | 'configuring_rr' | 'configuring_dates' | 'waiting_start' | 'waiting_end';
  createdAt: Date;
}

const SESSIONS = new Map<string, UserSession>();
const BACKTEST_RESULTS = new Map<string, BacktestResult>();

// ==================== AVAILABLE OPTIONS ====================

const SYMBOLS = {
  b3: ['WDOFUT', 'DOLFUT', 'WINFUT', 'PETR4', 'VALE3', 'ITUB4'],
  global: ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'XAUUSD', 'BTCUSD', 'ETHUSD']
};

const STRATEGIES = [
  { id: 'breakout', name: 'Breakout', desc: 'Rompimento de níveis', winRate: 0.45, avgMove: 0.003 },
  { id: 'mean_reversion', name: 'Mean Reversion', desc: 'Reversão à média', winRate: 0.55, avgMove: 0.002 },
  { id: 'momentum', name: 'Momentum', desc: 'Seguir tendência', winRate: 0.50, avgMove: 0.004 },
  { id: 'scalping', name: 'Scalping', desc: 'Operações rápidas', winRate: 0.60, avgMove: 0.001 }
];

// ==================== TELEGRAM API ====================

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: { id: number; first_name: string; username?: string };
    chat: { id: number; type: string };
    text?: string;
  };
  callback_query?: {
    id: string;
    from: { id: number; first_name: string; username?: string };
    message: { message_id: number; chat: { id: number } };
    data: string;
  };
}

async function getUpdates(offset?: number): Promise<TelegramUpdate[]> {
  const url = `${BOT_CONFIG.apiBaseUrl}/getUpdates?timeout=30${offset ? `&offset=${offset}` : ''}`;
  const resp = await fetch(url);
  const data = await resp.json() as any;
  return data.result || [];
}

async function sendMessage(chatId: number | string, text: string, options?: any): Promise<void> {
  const body: any = {
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML'
  };
  
  if (options?.reply_markup) {
    body.reply_markup = options.reply_markup;
  }
  
  await fetch(`${BOT_CONFIG.apiBaseUrl}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function answerCallback(callbackId: string): Promise<void> {
  await fetch(`${BOT_CONFIG.apiBaseUrl}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackId })
  });
}

// ==================== KEYBOARDS ====================

function getMainKeyboard(): any {
  return {
    inline_keyboard: [
      [{ text: '🧪 Novo Backtest', callback_data: 'new_backtest' }],
      [{ text: '📊 Meus Resultados', callback_data: 'my_results' }],
      [{ text: '🏆 Ranking', callback_data: 'ranking' }],
      [{ text: '❓ Ajuda', callback_data: 'help' }]
    ]
  };
}

function getSymbolKeyboard(): any {
  const rows: any[][] = [];
  
  rows.push([{ text: '🇧🇷 B3 (Brasil)', callback_data: 'none' }]);
  for (let i = 0; i < SYMBOLS.b3.length; i += 3) {
    rows.push(SYMBOLS.b3.slice(i, i + 3).map(s => ({
      text: s,
      callback_data: `symbol_${s}`
    })));
  }
  
  rows.push([{ text: '🌍 Global (Forex/Crypto)', callback_data: 'none' }]);
  for (let i = 0; i < SYMBOLS.global.length; i += 3) {
    rows.push(SYMBOLS.global.slice(i, i + 3).map(s => ({
      text: s,
      callback_data: `symbol_${s}`
    })));
  }
  
  rows.push([{ text: '⬅️ Voltar', callback_data: 'main' }]);
  
  return { inline_keyboard: rows };
}

function getStrategyKeyboard(): any {
  const rows: any[][] = [];
  
  for (const strat of STRATEGIES) {
    rows.push([{
      text: `${strat.name} - ${strat.desc} (WR: ${(strat.winRate * 100).toFixed(0)}%)`,
      callback_data: `strategy_${strat.id}`
    }]);
  }
  
  rows.push([{ text: '⬅️ Voltar', callback_data: 'new_backtest' }]);
  
  return { inline_keyboard: rows };
}

function getRRKeyboard(): any {
  return {
    inline_keyboard: [
      [
        { text: '1:1', callback_data: 'rr_1' },
        { text: '1:1.5', callback_data: 'rr_1.5' },
        { text: '1:2', callback_data: 'rr_2' }
      ],
      [
        { text: '1:2.5', callback_data: 'rr_2.5' },
        { text: '1:3', callback_data: 'rr_3' },
        { text: '1:5', callback_data: 'rr_5' }
      ],
      [{ text: '⬅️ Voltar', callback_data: 'new_backtest' }]
    ]
  };
}

// ==================== SESSION MANAGEMENT ====================

function getSession(chatId: string): UserSession {
  if (!SESSIONS.has(chatId)) {
    SESSIONS.set(chatId, {
      chatId,
      config: {
        symbol: 'WDOFUT',
        strategy: 'breakout',
        rr: 2.0,
        newsFilter: 3
      },
      state: 'idle',
      createdAt: new Date()
    });
  }
  return SESSIONS.get(chatId)!;
}

// ==================== BACKTEST ENGINE ====================

interface Trade {
  entry: number;
  exit: number;
  pnl: number;
  win: boolean;
  timestamp: Date;
}

function runBacktest(
  symbol: string,
  strategy: string,
  rr: number,
  startDate: Date,
  endDate: Date
): BacktestResult['results'] {
  const strat = STRATEGIES.find(s => s.id === strategy) || STRATEGIES[0];
  const trades: Trade[] = [];
  
  // Parâmetros por estratégia
  const basePrice = symbol.includes('WDO') ? 5.1 : 
                    symbol.includes('DOL') ? 5.0 :
                    symbol.includes('WIN') ? 125000 :
                    symbol.includes('EUR') ? 1.08 :
                    symbol.includes('GBP') ? 1.25 : 100;
  
  // Calcula dias no período
  const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  const tradesPerDay = strategy === 'scalping' ? 10 : strategy === 'breakout' ? 3 : 5;
  
  // Simula trades no período
  for (let d = 0; d < days; d++) {
    const day = new Date(startDate);
    day.setDate(day.getDate() + d);
    
    // Skip weekends
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    
    for (let t = 0; t < tradesPerDay; t++) {
      // Adiciona variação baseada no dia (tendência)
      const dayTrend = Math.sin(d / 10) * 0.05;
      const adjustedWinRate = strat.winRate + dayTrend;
      
      const isWin = Math.random() < adjustedWinRate;
      const move = strat.avgMove * (1 + Math.random() * 0.5);
      
      const entry = basePrice + (Math.random() - 0.5) * basePrice * 0.01;
      const exit = isWin ? 
        entry * (1 + move * rr) : 
        entry * (1 - move);
      
      const pnl = isWin ? move * rr * 100 : -move * 100;
      
      const hour = 9 + Math.floor(Math.random() * 8);
      const minute = Math.floor(Math.random() * 60);
      const timestamp = new Date(day);
      timestamp.setHours(hour, minute, 0);
      
      trades.push({
        entry,
        exit,
        pnl,
        win: isWin,
        timestamp
      });
    }
  }
  
  // Calcula métricas
  const totalTrades = trades.length;
  const wins = trades.filter(t => t.win).length;
  const losses = totalTrades - wins;
  const winRate = totalTrades > 0 ? wins / totalTrades : 0;
  
  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
  const winPnls = trades.filter(t => t.win).map(t => t.pnl);
  const lossPnls = trades.filter(t => !t.win).map(t => Math.abs(t.pnl));
  
  const avgWin = winPnls.length > 0 ? winPnls.reduce((a, b) => a + b, 0) / winPnls.length : 0;
  const avgLoss = lossPnls.length > 0 ? lossPnls.reduce((a, b) => a + b, 0) / lossPnls.length : 0;
  const profitFactor = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? 999 : 0;
  
  // Max Drawdown
  let peak = 0;
  let maxDrawdown = 0;
  let runningPnl = 0;
  
  for (const t of trades) {
    runningPnl += t.pnl;
    if (runningPnl > peak) peak = runningPnl;
    const dd = peak - runningPnl;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }
  
  // Sharpe Ratio
  const returns = trades.map(t => t.pnl);
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;
  
  return {
    totalTrades,
    wins,
    losses,
    winRate,
    totalPnl,
    profitFactor,
    sharpeRatio,
    maxDrawdown
  };
}

// ==================== COMPARE WITH ADMIN ====================

async function runAdminBacktest(): Promise<BacktestResult['results']> {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - ADMIN_CONFIG.testDays);
  
  return runBacktest(
    ADMIN_CONFIG.symbol,
    ADMIN_CONFIG.strategy,
    ADMIN_CONFIG.rr,
    startDate,
    endDate
  );
}

function compareWithAdmin(userResults: BacktestResult['results'], adminResults: BacktestResult['results']): BacktestResult['comparedToAdmin'] {
  const pnlDiff = userResults.totalPnl - adminResults.totalPnl;
  const winRateDiff = userResults.winRate - adminResults.winRate;
  const isBetter = userResults.totalPnl > adminResults.totalPnl;
  
  return { pnlDiff, winRateDiff, isBetter };
}

// ==================== SAVE TO ORACLE ====================

async function saveBacktestResult(result: BacktestResult): Promise<void> {
  try {
    await oracleDB.insert(`
      INSERT INTO user_backtests (
        id, user_id, username, symbol, strategy, rr_ratio,
        test_start, test_end, total_trades, wins, losses, win_rate,
        total_pnl, profit_factor, sharpe_ratio, max_drawdown,
        pnl_vs_admin, is_better, created_at
      ) VALUES (
        :id, :userId, :username, :symbol, :strategy, :rr,
        TO_DATE(:start, 'YYYY-MM-DD'), TO_DATE(:end, 'YYYY-MM-DD'),
        :totalTrades, :wins, :losses, :winRate,
        :pnl, :pf, :sharpe, :dd,
        :pnlVsAdmin, :isBetter, SYSDATE
      )
    `, {
      id: oracleDB.generateId(),
      userId: result.userId,
      username: result.username || 'unknown',
      symbol: result.config.symbol,
      strategy: result.config.strategy,
      rr: result.config.rr,
      start: result.testPeriod.start,
      end: result.testPeriod.end,
      totalTrades: result.results.totalTrades,
      wins: result.results.wins,
      losses: result.results.losses,
      winRate: result.results.winRate,
      pnl: result.results.totalPnl,
      pf: result.results.profitFactor,
      sharpe: result.results.sharpeRatio,
      dd: result.results.maxDrawdown,
      pnlVsAdmin: result.comparedToAdmin.pnlDiff,
      isBetter: result.comparedToAdmin.isBetter ? 1 : 0
    });
  } catch (e) {
    console.error('Erro ao salvar backtest:', e);
  }
}

// ==================== NOTIFY ADMIN ====================

async function notifyAdmin(result: BacktestResult): Promise<void> {
  const better = result.comparedToAdmin.isBetter ? '🏆 MELHOR QUE A SUA!' : '📉 Pior que a sua';
  const pnlEmoji = result.comparedToAdmin.pnlDiff > 0 ? '📈' : '📉';
  
  const msg = `<b>👤 NOVO BACKTEST DE USUÁRIO</b>

<b>Usuário:</b> @${result.username || result.userId}
<b>Data:</b> ${result.timestamp.toLocaleString('pt-BR')}

<b>📊 Configuração:</b>
• Ativo: <code>${result.config.symbol}</code>
• Estratégia: <code>${result.config.strategy}</code>
• R/R: <code>1:${result.config.rr}</code>

<b>📅 Período:</b>
• Início: <code>${result.testPeriod.start}</code>
• Fim: <code>${result.testPeriod.end}</code>

<b>📈 Resultados:</b>
• Trades: <code>${result.results.totalTrades}</code>
• Win Rate: <code>${(result.results.winRate * 100).toFixed(1)}%</code>
• PnL: <code>${result.results.totalPnl.toFixed(0)} pts</code>
• Profit Factor: <code>${result.results.profitFactor.toFixed(2)}</code>
• Sharpe: <code>${result.results.sharpeRatio.toFixed(2)}</code>

<b>${better}</b>
${pnlEmoji} Diferença PnL: <code>${result.comparedToAdmin.pnlDiff > 0 ? '+' : ''}${result.comparedToAdmin.pnlDiff.toFixed(0)} pts</code>

<i>Comparado com sua config: ${ADMIN_CONFIG.symbol} | ${ADMIN_CONFIG.strategy} | R/R 1:${ADMIN_CONFIG.rr}</i>`;
  
  await sendMessage(BOT_CONFIG.adminChatId, msg);
}

// ==================== MESSAGE HANDLERS ====================

async function handleStart(chatId: string, username?: string): Promise<void> {
  const session = getSession(chatId);
  session.username = username;
  
  const msg = `<b>🧪 VEXOR BACKTEST LAB</b>

Olá${username ? `, ${username}` : ''}! Teste suas estratégias aqui.

<b>📊 Sua configuração atual:</b>
• Ativo: <code>${session.config.symbol}</code>
• Estratégia: <code>${session.config.strategy}</code>
• R/R: <code>1:${session.config.rr}</code>

<b>Funcionalidades:</b>
• 🧪 <b>Novo Backtest</b> - Testar estratégia
• 📊 <b>Meus Resultados</b> - Ver histórico
• 🏆 <b>Ranking</b> - Top performers

<b>Escolha uma opção:</b>`;
  
  await sendMessage(chatId, msg, { reply_markup: getMainKeyboard() });
}

async function handleNewBacktest(chatId: string): Promise<void> {
  const session = getSession(chatId);
  
  const msg = `<b>🧪 NOVO BACKTEST</b>

<b>Passo 1/4: Escolha o ativo</b>

Configuração atual:
• Ativo: <code>${session.config.symbol}</code>
• Estratégia: <code>${session.config.strategy}</code>
• R/R: <code>1:${session.config.rr}</code>

<b>Selecione o ativo para testar:</b>`;
  
  await sendMessage(chatId, msg, { reply_markup: getSymbolKeyboard() });
}

async function handleDateInput(chatId: string, text: string): Promise<void> {
  const session = getSession(chatId);
  
  const dateMatch = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  
  if (!dateMatch) {
    await sendMessage(chatId, 
      `<b>❌ Formato inválido!</b>\n\nUse: DD/MM/AAAA\nExemplo: 01/01/2026`
    );
    return;
  }
  
  const [, day, month, year] = dateMatch;
  const fullYear = year.length === 2 ? `20${year}` : year;
  const dateStr = `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  
  if (session.state === 'waiting_start') {
    session.config.startDate = dateStr;
    session.state = 'waiting_end';
    
    await sendMessage(chatId,
      `<b>✅ Data inicial definida!</b>\n\nData: <code>${dateStr}</code>\n\n<b>Agora digite a data FINAL:</b>\nFormato: DD/MM/AAAA`
    );
  } else if (session.state === 'waiting_end') {
    session.config.endDate = dateStr;
    session.state = 'idle';
    
    await sendMessage(chatId,
      `<b>✅ Data final definida!</b>\n\nData: <code>${dateStr}</code>\n\n<b>🚀 Iniciando backtest...</b>`
    );
    
    // Executa backtest
    await executeBacktest(chatId);
  }
}

async function executeBacktest(chatId: string): Promise<void> {
  const session = getSession(chatId);
  
  if (!session.config.startDate || !session.config.endDate) {
    await sendMessage(chatId, '<b>❌ Datas não configuradas!</b>');
    return;
  }
  
  await sendMessage(chatId, `<b>⏳ Executando backtest...</b>

<b>Configuração:</b>
• Ativo: ${session.config.symbol}
• Estratégia: ${session.config.strategy}
• R/R: 1:${session.config.rr}
• Período: ${session.config.startDate} a ${session.config.endDate}

<i>Aguarde...</i>`);
  
  // Executa backtest do usuário
  const startDate = new Date(session.config.startDate);
  const endDate = new Date(session.config.endDate);
  
  const userResults = runBacktest(
    session.config.symbol,
    session.config.strategy,
    session.config.rr,
    startDate,
    endDate
  );
  
  // Executa backtest do admin para comparação
  const adminResults = await runAdminBacktest();
  
  // Compara
  const comparison = compareWithAdmin(userResults, adminResults);
  
  // Cria resultado
  const result: BacktestResult = {
    userId: chatId,
    username: session.username,
    config: {
      symbol: session.config.symbol,
      strategy: session.config.strategy,
      rr: session.config.rr,
      newsFilter: session.config.newsFilter
    },
    testPeriod: {
      start: session.config.startDate,
      end: session.config.endDate
    },
    results: userResults,
    comparedToAdmin: comparison,
    timestamp: new Date()
  };
  
  // Salva resultado
  BACKTEST_RESULTS.set(chatId, result);
  await saveBacktestResult(result);
  
  // Notifica admin
  await notifyAdmin(result);
  
  // Mostra resultado para usuário
  const better = comparison.isBetter ? '🏆 MELHOR QUE O ADMIN!' : '📊 Resultado';
  const pnlEmoji = comparison.pnlDiff > 0 ? '📈' : '📉';
  
  const msg = `<b>${better}</b>

<b>📊 Seus Resultados:</b>
• Trades: <code>${userResults.totalTrades}</code>
• Vitórias: <code>${userResults.wins}</code>
• Derrotas: <code>${userResults.losses}</code>
• Win Rate: <code>${(userResults.winRate * 100).toFixed(1)}%</code>
• PnL Total: <code>${userResults.totalPnl.toFixed(0)} pts</code>
• Profit Factor: <code>${userResults.profitFactor.toFixed(2)}</code>
• Sharpe Ratio: <code>${userResults.sharpeRatio.toFixed(2)}</code>
• Max Drawdown: <code>${userResults.maxDrawdown.toFixed(0)} pts</code>

<b>📈 Comparação com Admin:</b>
${pnlEmoji} Diferença PnL: <code>${comparison.pnlDiff > 0 ? '+' : ''}${comparison.pnlDiff.toFixed(0)} pts</code>
• Win Rate Admin: <code>${(adminResults.winRate * 100).toFixed(1)}%</code>
• Seu Win Rate: <code>${(userResults.winRate * 100).toFixed(1)}%</code>

<b>Configuração usada:</b>
• Ativo: <code>${session.config.symbol}</code>
• Estratégia: <code>${session.config.strategy}</code>
• R/R: <code>1:${session.config.rr}</code>
• Período: <code>${session.config.startDate}</code> a <code>${session.config.endDate}</code>`;
  
  await sendMessage(chatId, msg, { reply_markup: getMainKeyboard() });
}

async function handleMyResults(chatId: string): Promise<void> {
  const result = BACKTEST_RESULTS.get(chatId);
  
  if (!result) {
    await sendMessage(chatId, 
      `<b>📊 Nenhum backtest encontrado</b>\n\nExecute um novo backtest primeiro!`,
      { reply_markup: getMainKeyboard() }
    );
    return;
  }
  
  const msg = `<b>📊 SEU ÚLTIMO BACKTEST</b>

<b>Configuração:</b>
• Ativo: <code>${result.config.symbol}</code>
• Estratégia: <code>${result.config.strategy}</code>
• R/R: <code>1:${result.config.rr}</code>

<b>Período:</b>
• ${result.testPeriod.start} a ${result.testPeriod.end}

<b>Resultados:</b>
• Trades: <code>${result.results.totalTrades}</code>
• Win Rate: <code>${(result.results.winRate * 100).toFixed(1)}%</code>
• PnL: <code>${result.results.totalPnl.toFixed(0)} pts</code>
• PF: <code>${result.results.profitFactor.toFixed(2)}</code>

<b>vs Admin:</b>
• ${result.comparedToAdmin.isBetter ? '🏆 MELHOR' : '📉 Pior'}
• Diff: <code>${result.comparedToAdmin.pnlDiff > 0 ? '+' : ''}${result.comparedToAdmin.pnlDiff.toFixed(0)} pts</code>`;
  
  await sendMessage(chatId, msg, { reply_markup: getMainKeyboard() });
}

async function handleRanking(chatId: string): Promise<void> {
  // Busca top 5 do Oracle
  let ranking: any[] = [];
  
  try {
    const result = await oracleDB.query(`
      SELECT username, symbol, strategy, rr_ratio, total_pnl, win_rate, is_better
      FROM user_backtests
      ORDER BY total_pnl DESC
      FETCH FIRST 5 ROWS ONLY
    `);
    ranking = result as any[];
  } catch (e) {
    // Usa dados em memória
    ranking = Array.from(BACKTEST_RESULTS.values())
      .sort((a, b) => b.results.totalPnl - a.results.totalPnl)
      .slice(0, 5);
  }
  
  if (ranking.length === 0) {
    await sendMessage(chatId, 
      `<b>🏆 Ranking vazio</b>\n\nSeja o primeiro a testar!`,
      { reply_markup: getMainKeyboard() }
    );
    return;
  }
  
  let msg = `<b>🏆 TOP 5 BACKTESTS</b>\n\n`;
  
  for (let i = 0; i < ranking.length; i++) {
    const r = ranking[i];
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '📊';
    const isBetter = r.IS_BETTER === 1 || r.is_better === 1;
    
    msg += `${medal} <b>@${r.USERNAME || r.username || 'unknown'}</b>\n`;
    msg += `   ${r.SYMBOL || r.config?.symbol} | ${r.STRATEGY || r.config?.strategy}\n`;
    msg += `   PnL: <code>${(r.TOTAL_PNL || r.results?.totalPnl || 0).toFixed(0)}</code> | WR: <code>${((r.WIN_RATE || r.results?.winRate || 0) * 100).toFixed(0)}%</code>`;
    msg += ` ${isBetter ? '🏆' : ''}\n\n`;
  }
  
  msg += `<i>Comparado com config do admin</i>`;
  
  await sendMessage(chatId, msg, { reply_markup: getMainKeyboard() });
}

async function handleHelp(chatId: string): Promise<void> {
  const msg = `<b>❓ COMO USAR O BACKTEST LAB</b>

<b>1. Configurar</b>
• Escolha o ativo (B3 ou Global)
• Selecione a estratégia
• Defina o Risco/Retorno

<b>2. Definir Período</b>
• Digite a data inicial (DD/MM/AAAA)
• Digite a data final (DD/MM/AAAA)

<b>3. Executar</b>
• O sistema roda o backtest
• Compara com a config do admin
• Salva no ranking

<b>Estratégias disponíveis:</b>
• <b>Breakout</b> - Rompimento (WR ~45%)
• <b>Mean Reversion</b> - Reversão (WR ~55%)
• <b>Momentum</b> - Tendência (WR ~50%)
• <b>Scalping</b> - Rápido (WR ~60%)

<b>Dica:</b> Teste diferentes períodos para encontrar a melhor combinação!`;
  
  await sendMessage(chatId, msg, { reply_markup: getMainKeyboard() });
}

// ==================== CALLBACK HANDLER ====================

async function handleCallback(callback: TelegramUpdate['callback_query']): Promise<void> {
  if (!callback) return;
  
  const chatId = callback.message!.chat.id.toString();
  const data = callback.data;
  
  const session = getSession(chatId);
  
  await answerCallback(callback.id);
  
  // Main menu
  if (data === 'main') {
    await handleStart(chatId, session.username);
    return;
  }
  
  // New backtest
  if (data === 'new_backtest') {
    await handleNewBacktest(chatId);
    return;
  }
  
  // Symbol selection
  if (data.startsWith('symbol_')) {
    const symbol = data.replace('symbol_', '');
    session.config.symbol = symbol;
    
    await sendMessage(chatId,
      `<b>✅ Ativo: ${symbol}</b>\n\n<b>Passo 2/4: Escolha a estratégia</b>`,
      { reply_markup: getStrategyKeyboard() }
    );
    return;
  }
  
  // Strategy selection
  if (data.startsWith('strategy_')) {
    const strategy = data.replace('strategy_', '');
    session.config.strategy = strategy;
    
    await sendMessage(chatId,
      `<b>✅ Estratégia: ${strategy}</b>\n\n<b>Passo 3/4: Escolha o R/R</b>`,
      { reply_markup: getRRKeyboard() }
    );
    return;
  }
  
  // RR selection
  if (data.startsWith('rr_')) {
    const rr = parseFloat(data.replace('rr_', ''));
    session.config.rr = rr;
    session.state = 'waiting_start';
    
    await sendMessage(chatId,
      `<b>✅ R/R: 1:${rr}</b>\n\n<b>Passo 4/4: Defina o período</b>\n\n<b>Digite a data INICIAL:</b>\nFormato: DD/MM/AAAA\nExemplo: 01/01/2026`
    );
    return;
  }
  
  // My results
  if (data === 'my_results') {
    await handleMyResults(chatId);
    return;
  }
  
  // Ranking
  if (data === 'ranking') {
    await handleRanking(chatId);
    return;
  }
  
  // Help
  if (data === 'help') {
    await handleHelp(chatId);
    return;
  }
}

// ==================== MESSAGE HANDLER ====================

async function handleMessage(msg: TelegramUpdate['message']): Promise<void> {
  if (!msg || !msg.text) return;
  
  const chatId = msg.chat.id.toString();
  const text = msg.text.trim();
  const username = msg.from?.username || msg.from?.first_name;
  
  const session = getSession(chatId);
  
  // Comandos
  if (text === '/start') {
    await handleStart(chatId, username);
    return;
  }
  
  // Date input
  if (session.state === 'waiting_start' || session.state === 'waiting_end') {
    await handleDateInput(chatId, text);
    return;
  }
  
  // Default
  await handleStart(chatId, username);
}

// ==================== CREATE TABLE ====================

async function ensureTable(): Promise<void> {
  try {
    await oracleDB.execute(`
      CREATE TABLE user_backtests (
        id VARCHAR2(36) PRIMARY KEY,
        user_id VARCHAR2(50),
        username VARCHAR2(100),
        symbol VARCHAR2(20),
        strategy VARCHAR2(30),
        rr_ratio NUMBER,
        test_start DATE,
        test_end DATE,
        total_trades NUMBER,
        wins NUMBER,
        losses NUMBER,
        win_rate NUMBER,
        total_pnl NUMBER,
        profit_factor NUMBER,
        sharpe_ratio NUMBER,
        max_drawdown NUMBER,
        pnl_vs_admin NUMBER,
        is_better NUMBER(1),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Tabela user_backtests criada');
  } catch (e: any) {
    if (!e.message?.includes('ORA-00955')) {
      console.log('⚠️ Tabela user_backtests:', e.message);
    }
  }
}

// ==================== MAIN LOOP ====================

async function startBot(): Promise<void> {
  console.log('\n🧪 ========================================');
  console.log('🧪 VEXOR BACKTEST LAB BOT');
  console.log('🧪 ========================================\n');
  
  // Inicializa Oracle
  await oracleDB.initialize();
  await ensureTable();
  
  // Testa conexão
  try {
    const resp = await fetch(`${BOT_CONFIG.apiBaseUrl}/getMe`);
    const data = await resp.json() as any;
    
    if (data.ok) {
      console.log(`✅ Bot conectado: @${data.result.username}`);
    }
  } catch (e) {
    console.error('❌ Erro ao conectar com Telegram');
    return;
  }
  
  // Mensagem inicial para admin
  await sendMessage(BOT_CONFIG.adminChatId,
    `<b>🧪 BACKTEST LAB INICIADO</b>

<b>Sua configuração atual:</b>
• Ativo: <code>${ADMIN_CONFIG.symbol}</code>
• Estratégia: <code>${ADMIN_CONFIG.strategy}</code>
• R/R: <code>1:${ADMIN_CONFIG.rr}</code>

<i>Usuários podem testar suas estratégias e comparar com a sua!</i>`,
    { reply_markup: getMainKeyboard() }
  );
  
  console.log('\n📥 Aguardando usuários...\n');
  
  // Loop de polling
  let lastUpdateId = 0;
  
  while (true) {
    try {
      const updates = await getUpdates(lastUpdateId + 1);
      
      for (const update of updates) {
        lastUpdateId = update.update_id;
        
        if (update.message) {
          await handleMessage(update.message);
        } else if (update.callback_query) {
          await handleCallback(update.callback_query);
        }
      }
      
      await new Promise(r => setTimeout(r, BOT_CONFIG.pollInterval));
      
    } catch (e) {
      console.error('❌ Erro:', e);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// ==================== START ====================

startBot().catch(err => {
  console.error('❌ Erro fatal:', err);
  process.exit(1);
});
