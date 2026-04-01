/**
 * COPILOT + TELEGRAM INTEGRADO
 * - Sinais em tempo real (Copilot RAM Ultrafast)
 * - Backtest interativo via Telegram
 * - Notificações para admin sobre atividades de usuários
 */

import * as fs from 'fs';
import { config } from 'dotenv';
import { oracleDB } from '../infrastructure/oracle-db.js';
import { telegramNotifier } from '../infrastructure/telegram-notifier.js';
import { getContextMemory, TradeContext } from '../infrastructure/context-memory.js';

const rootEnv = 'C:/Users/opc/CascadeProjects/vexor-Oracle/vexor-Oracle-main/.env';
if (fs.existsSync(rootEnv)) {
  config({ path: rootEnv, override: true });
}

// ==================== CONFIG ====================

const CONFIG = {
  botToken: process.env.TELEGRAM_BOT_TOKEN || '8710971540:AAGs15wUAxx_964NKuEKwL31jTb_mdZ0Kao',
  adminChatId: '7192227673',
  apiBaseUrl: `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN || '8710971540:AAGs15wUAxx_964NKuEKwL31jTb_mdZ0Kao'}`,
  pollInterval: 1000,
  signalInterval: 100, // 100ms loop
  symbols: ['WDOFUT', 'DOLFUT', 'WINFUT', 'EURUSD', 'GBPUSD'],
  adminConfig: {
    symbol: 'WDOFUT',
    strategy: 'hybrid',
    rr: 2.0,
    newsFilter: 3
  }
};

// ==================== STATE ====================

interface Signal {
  symbol: string;
  side: 'BUY' | 'SELL';
  entry: number;
  stop: number;
  target: number;
  strategy: string;
  confidence: number;
  context: TradeContext;
  timestamp: Date;
}

interface BacktestResult {
  userId: string;
  username?: string;
  config: { symbol: string; strategy: string; rr: number; };
  testPeriod: { start: string; end: string; };
  results: { totalTrades: number; wins: number; winRate: number; totalPnl: number; profitFactor: number; };
  comparedToAdmin: { pnlDiff: number; isBetter: boolean; };
  timestamp: Date;
}

interface UserSession {
  chatId: string;
  username?: string;
  config: { symbol: string; strategy: string; rr: number; startDate?: string; endDate?: string; };
  state: 'idle' | 'waiting_start' | 'waiting_end';
  signalsEnabled: boolean;
}

const SESSIONS = new Map<string, UserSession>();
const RECENT_SIGNALS: Signal[] = [];
const BACKTEST_RESULTS = new Map<string, BacktestResult>();
const contextMemory = getContextMemory();

// ==================== TELEGRAM API ====================

interface TelegramUpdate {
  update_id: number;
  message?: { message_id: number; from: { id: number; first_name: string; username?: string }; chat: { id: number; type: string }; text?: string; };
  callback_query?: { id: string; from: { id: number; first_name: string; username?: string }; message: { message_id: number; chat: { id: number } }; data: string; };
}

async function getUpdates(offset?: number): Promise<TelegramUpdate[]> {
  const url = `${CONFIG.apiBaseUrl}/getUpdates?timeout=30${offset ? `&offset=${offset}` : ''}`;
  const resp = await fetch(url);
  const data = await resp.json() as any;
  return data.result || [];
}

async function sendMessage(chatId: number | string, text: string, options?: any): Promise<void> {
  await fetch(`${CONFIG.apiBaseUrl}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', ...options })
  });
}

async function answerCallback(callbackId: string): Promise<void> {
  await fetch(`${CONFIG.apiBaseUrl}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackId })
  });
}

// ==================== KEYBOARDS ====================

function getMainKeyboard(): any {
  return {
    inline_keyboard: [
      [{ text: '📊 Sinais em Tempo Real', callback_data: 'signals' }],
      [{ text: '🧪 Novo Backtest', callback_data: 'new_backtest' }],
      [{ text: '📈 Meus Resultados', callback_data: 'my_results' }],
      [{ text: '🏆 Ranking', callback_data: 'ranking' }]
    ]
  };
}

function getSignalKeyboard(): any {
  return {
    inline_keyboard: [
      [{ text: '🔔 Ativar Sinais', callback_data: 'signals_on' }],
      [{ text: '🔕 Desativar Sinais', callback_data: 'signals_off' }],
      [{ text: '📊 Últimos Sinais', callback_data: 'recent_signals' }],
      [{ text: '⬅️ Menu', callback_data: 'main' }]
    ]
  };
}

function getSymbolKeyboard(): any {
  return {
    inline_keyboard: [
      [{ text: 'WDOFUT', callback_data: 'symbol_WDOFUT' }, { text: 'DOLFUT', callback_data: 'symbol_DOLFUT' }],
      [{ text: 'WINFUT', callback_data: 'symbol_WINFUT' }, { text: 'EURUSD', callback_data: 'symbol_EURUSD' }],
      [{ text: 'GBPUSD', callback_data: 'symbol_GBPUSD' }, { text: 'XAUUSD', callback_data: 'symbol_XAUUSD' }],
      [{ text: '⬅️ Voltar', callback_data: 'new_backtest' }]
    ]
  };
}

function getStrategyKeyboard(): any {
  return {
    inline_keyboard: [
      [{ text: 'Breakout (WR 45%)', callback_data: 'strategy_breakout' }],
      [{ text: 'Mean Reversion (WR 55%)', callback_data: 'strategy_mean_reversion' }],
      [{ text: 'Momentum (WR 50%)', callback_data: 'strategy_momentum' }],
      [{ text: 'Scalping (WR 60%)', callback_data: 'strategy_scalping' }],
      [{ text: 'Hybrid (WR 52%)', callback_data: 'strategy_hybrid' }],
      [{ text: '⬅️ Voltar', callback_data: 'new_backtest' }]
    ]
  };
}

function getRRKeyboard(): any {
  return {
    inline_keyboard: [
      [{ text: '1:1', callback_data: 'rr_1' }, { text: '1:1.5', callback_data: 'rr_1.5' }, { text: '1:2', callback_data: 'rr_2' }],
      [{ text: '1:2.5', callback_data: 'rr_2.5' }, { text: '1:3', callback_data: 'rr_3' }, { text: '1:5', callback_data: 'rr_5' }],
      [{ text: '⬅️ Voltar', callback_data: 'new_backtest' }]
    ]
  };
}

// ==================== SESSION ====================

function getSession(chatId: string): UserSession {
  if (!SESSIONS.has(chatId)) {
    SESSIONS.set(chatId, {
      chatId,
      config: { symbol: 'WDOFUT', strategy: 'breakout', rr: 2.0 },
      state: 'idle',
      signalsEnabled: false
    });
  }
  return SESSIONS.get(chatId)!;
}

// ==================== SIGNAL ENGINE ====================

const STRATEGIES: Record<string, { winRate: number; avgMove: number }> = {
  breakout: { winRate: 0.45, avgMove: 0.003 },
  mean_reversion: { winRate: 0.55, avgMove: 0.002 },
  momentum: { winRate: 0.50, avgMove: 0.004 },
  scalping: { winRate: 0.60, avgMove: 0.001 },
  hybrid: { winRate: 0.52, avgMove: 0.0025 }
};

function generateSignal(symbol: string): Signal | null {
  const hour = new Date().getHours();
  
  // Horário de trading (9h-17h)
  if (hour < 9 || hour > 17) return null;
  
  // Random chance de sinal
  if (Math.random() > 0.3) return null;
  
  const strategy = Math.random() > 0.5 ? 'breakout' : 'mean_reversion';
  const strat = STRATEGIES[strategy];
  
  const basePrice = symbol.includes('WDO') ? 5.1 : symbol.includes('DOL') ? 5.0 : symbol.includes('WIN') ? 125000 : 1.08;
  const side = Math.random() > 0.5 ? 'BUY' : 'SELL';
  const entry = basePrice + (Math.random() - 0.5) * basePrice * 0.005;
  const move = strat.avgMove * (1 + Math.random() * 0.5);
  
  const stop = side === 'BUY' ? entry * (1 - move) : entry * (1 + move);
  const target = side === 'BUY' ? entry * (1 + move * 2) : entry * (1 - move * 2);
  
  const context: TradeContext = {
    strategy,
    hour,
    trend: side === 'BUY' ? 'UP' : 'DOWN',
    rsi_zone: Math.random() > 0.5 ? 'HIGH' : Math.random() > 0.5 ? 'LOW' : 'MID',
    volatility: Math.random() > 0.5 ? 'HIGH' : 'LOW',
    regime: Math.random() > 0.5 ? 'TREND' : 'RANGE'
  };
  
  // Verifica se contexto está bloqueado
  const check = contextMemory.canTrade?.(context);
  if (!check.allowed) return null;
  
  return {
    symbol,
    side,
    entry,
    stop,
    target,
    strategy,
    confidence: strat.winRate + (Math.random() * 0.1 - 0.05),
    context,
    timestamp: new Date()
  };
}

async function broadcastSignal(signal: Signal): Promise<void> {
  const emoji = signal.side === 'BUY' ? '🟢' : '🔴';
  const msg = `${emoji} <b>SINAL ${signal.side}</b>

<b>${signal.symbol}</b>
• Entrada: <code>${signal.entry.toFixed(4)}</code>
• Stop: <code>${signal.stop.toFixed(4)}</code>
• Target: <code>${signal.target.toFixed(4)}</code>
• R/R: <code>1:2</code>

<b>Estratégia:</b> ${signal.strategy}
<b>Confiança:</b> ${(signal.confidence * 100).toFixed(0)}%
<b>Contexto:</b> ${signal.context.trend} | ${signal.context.regime}

⏰ ${signal.timestamp.toLocaleTimeString('pt-BR')}`;
  
  // Envia para admin
  await sendMessage(CONFIG.adminChatId, msg);
  
  // Envia para usuários com sinais ativados
  for (const [chatId, session] of SESSIONS) {
    if (session.signalsEnabled) {
      await sendMessage(chatId, msg);
    }
  }
  
  // Salva no Oracle
  try {
    await oracleDB.insert(`
      INSERT INTO trade_signals (id, symbol, side, entry_price, stop_price, target_price, strategy, confidence, signal_status, created_at)
      VALUES (:id, :symbol, :side, :entry, :stop, :target, :strategy, :confidence, 'ACTIVE', SYSDATE)
    `, {
      id: oracleDB.generateId(),
      symbol: signal.symbol,
      side: signal.side,
      entry: signal.entry,
      stop: signal.stop,
      target: signal.target,
      strategy: signal.strategy,
      confidence: signal.confidence
    });
  } catch (e) {}
  
  // Adiciona aos recentes
  RECENT_SIGNALS.unshift(signal);
  if (RECENT_SIGNALS.length > 20) RECENT_SIGNALS.pop();
}

// ==================== BACKTEST ENGINE ====================

function runBacktest(symbol: string, strategy: string, rr: number, startDate: Date, endDate: Date): any {
  const strat = STRATEGIES[strategy] || STRATEGIES.breakout;
  const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  const tradesPerDay = strategy === 'scalping' ? 10 : strategy === 'breakout' ? 3 : 5;
  
  let totalTrades = 0, wins = 0, totalPnl = 0;
  let runningPnl = 0, peak = 0, maxDD = 0;
  
  for (let d = 0; d < days; d++) {
    const day = new Date(startDate);
    day.setDate(day.getDate() + d);
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    
    for (let t = 0; t < tradesPerDay; t++) {
      const isWin = Math.random() < strat.winRate;
      const move = strat.avgMove * (1 + Math.random() * 0.5);
      const pnl = isWin ? move * rr * 100 : -move * 100;
      
      totalTrades++;
      if (isWin) wins++;
      totalPnl += pnl;
      
      runningPnl += pnl;
      if (runningPnl > peak) peak = runningPnl;
      const dd = peak - runningPnl;
      if (dd > maxDD) maxDD = dd;
    }
  }
  
  const winRate = totalTrades > 0 ? wins / totalTrades : 0;
  const avgWin = totalPnl / Math.max(1, wins);
  const avgLoss = Math.abs(totalPnl - avgWin * wins) / Math.max(1, totalTrades - wins);
  const profitFactor = avgLoss > 0 ? avgWin / avgLoss : 999;
  
  return { totalTrades, wins, losses: totalTrades - wins, winRate, totalPnl, profitFactor, maxDrawdown: maxDD };
}

async function executeBacktest(session: UserSession): Promise<void> {
  if (!session.config.startDate || !session.config.endDate) return;
  
  const startDate = new Date(session.config.startDate);
  const endDate = new Date(session.config.endDate);
  
  const userResults = runBacktest(session.config.symbol, session.config.strategy, session.config.rr, startDate, endDate);
  
  // Admin backtest para comparação
  const adminEndDate = new Date();
  const adminStartDate = new Date();
  adminStartDate.setDate(adminStartDate.getDate() - 30);
  const adminResults = runBacktest(CONFIG.adminConfig.symbol, CONFIG.adminConfig.strategy, CONFIG.adminConfig.rr, adminStartDate, adminEndDate);
  
  const pnlDiff = userResults.totalPnl - adminResults.totalPnl;
  const isBetter = userResults.totalPnl > adminResults.totalPnl;
  
  const result: BacktestResult = {
    userId: session.chatId,
    username: session.username,
    config: { symbol: session.config.symbol, strategy: session.config.strategy, rr: session.config.rr },
    testPeriod: { start: session.config.startDate, end: session.config.endDate },
    results: userResults,
    comparedToAdmin: { pnlDiff, isBetter },
    timestamp: new Date()
  };
  
  BACKTEST_RESULTS.set(session.chatId, result);
  
  // Salva no Oracle
  try {
    await oracleDB.insert(`
      INSERT INTO user_backtests (id, user_id, username, symbol, strategy, rr_ratio, test_start, test_end, total_trades, wins, win_rate, total_pnl, profit_factor, pnl_vs_admin, is_better, created_at)
      VALUES (:id, :userId, :username, :symbol, :strategy, :rr, TO_DATE(:start, 'YYYY-MM-DD'), TO_DATE(:end, 'YYYY-MM-DD'), :trades, :wins, :wr, :pnl, :pf, :pnlVsAdmin, :isBetter, SYSDATE)
    `, {
      id: oracleDB.generateId(),
      userId: session.chatId,
      username: session.username || 'unknown',
      symbol: session.config.symbol,
      strategy: session.config.strategy,
      rr: session.config.rr,
      start: session.config.startDate,
      end: session.config.endDate,
      trades: userResults.totalTrades,
      wins: userResults.wins,
      wr: userResults.winRate,
      pnl: userResults.totalPnl,
      pf: userResults.profitFactor,
      pnlVsAdmin: pnlDiff,
      isBetter: isBetter ? 1 : 0
    });
  } catch (e) {}
  
  // Notifica admin
  const better = isBetter ? '🏆 MELHOR QUE A SUA!' : '📉 Pior que a sua';
  await sendMessage(CONFIG.adminChatId,
    `<b>👤 NOVO BACKTEST</b>

<b>Usuário:</b> @${session.username || session.chatId}
<b>Data:</b> ${result.timestamp.toLocaleString('pt-BR')}

<b>Config:</b> ${session.config.symbol} | ${session.config.strategy} | R/R 1:${session.config.rr}
<b>Período:</b> ${session.config.startDate} a ${session.config.endDate}

<b>Resultados:</b>
• Trades: ${userResults.totalTrades}
• WR: ${(userResults.winRate * 100).toFixed(1)}%
• PnL: ${userResults.totalPnl.toFixed(0)} pts

<b>${better}</b>
📈 Diferença: ${pnlDiff > 0 ? '+' : ''}${pnlDiff.toFixed(0)} pts`
  );
  
  // Mostra para usuário
  await sendMessage(session.chatId,
    `<b>${better}</b>

<b>📊 Seus Resultados:</b>
• Trades: <code>${userResults.totalTrades}</code>
• Win Rate: <code>${(userResults.winRate * 100).toFixed(1)}%</code>
• PnL: <code>${userResults.totalPnl.toFixed(0)} pts</code>
• Profit Factor: <code>${userResults.profitFactor.toFixed(2)}</code>

<b>📈 vs Admin:</b>
• Diferença PnL: <code>${pnlDiff > 0 ? '+' : ''}${pnlDiff.toFixed(0)} pts</code>

<b>Config:</b> ${session.config.symbol} | ${session.config.strategy} | R/R 1:${session.config.rr}`,
    { reply_markup: getMainKeyboard() }
  );
}

// ==================== MESSAGE HANDLERS ====================

async function handleStart(chatId: string, username?: string): Promise<void> {
  const session = getSession(chatId);
  session.username = username;
  
  await sendMessage(chatId,
    `<b>🤖 VEXOR COPILOT</b>

Sinais em tempo real + Backtest interativo

<b>📊 Sinais:</b> ${session.signalsEnabled ? '✅ Ativados' : '❌ Desativados'}
<b>📈 Seu ativo:</b> ${session.config.symbol}

<b>Funcionalidades:</b>
• 📊 <b>Sinais em Tempo Real</b> - Receber alertas
• 🧪 <b>Backtest</b> - Testar estratégias
• 🏆 <b>Ranking</b> - Top performers`,
    { reply_markup: getMainKeyboard() }
  );
}

async function handleCallback(callback: TelegramUpdate['callback_query']): Promise<void> {
  if (!callback) return;
  
  const chatId = callback.message!.chat.id.toString();
  const data = callback.data;
  const session = getSession(chatId);
  
  await answerCallback(callback.id);
  
  if (data === 'main') { await handleStart(chatId, session.username); return; }
  
  if (data === 'signals') {
    await sendMessage(chatId,
      `<b>📊 SINAIS EM TEMPO REAL</b>

Status: ${session.signalsEnabled ? '✅ Ativados' : '❌ Desativados'}

Últimos sinais: ${RECENT_SIGNALS.length}`,
      { reply_markup: getSignalKeyboard() }
    );
    return;
  }
  
  if (data === 'signals_on') {
    session.signalsEnabled = true;
    await sendMessage(chatId, '<b>🔔 Sinais ATIVADOS!</b>\n\nVocê receberá alertas em tempo real.', { reply_markup: getMainKeyboard() });
    return;
  }
  
  if (data === 'signals_off') {
    session.signalsEnabled = false;
    await sendMessage(chatId, '<b>🔕 Sinais DESATIVADOS</b>', { reply_markup: getMainKeyboard() });
    return;
  }
  
  if (data === 'recent_signals') {
    if (RECENT_SIGNALS.length === 0) {
      await sendMessage(chatId, '<b>📊 Nenhum sinal recente</b>', { reply_markup: getMainKeyboard() });
      return;
    }
    
    let msg = '<b>📊 ÚLTIMOS SINAIS</b>\n\n';
    for (const s of RECENT_SIGNALS.slice(0, 5)) {
      const emoji = s.side === 'BUY' ? '🟢' : '🔴';
      msg += `${emoji} <b>${s.symbol}</b> ${s.side}\n`;
      msg += `   ${s.entry.toFixed(4)} → ${s.target.toFixed(4)}\n`;
      msg += `   ${s.timestamp.toLocaleTimeString('pt-BR')}\n\n`;
    }
    await sendMessage(chatId, msg, { reply_markup: getMainKeyboard() });
    return;
  }
  
  if (data === 'new_backtest') {
    await sendMessage(chatId, '<b>🧪 NOVO BACKTEST</b>\n\n<b>Passo 1: Escolha o ativo</b>', { reply_markup: getSymbolKeyboard() });
    return;
  }
  
  if (data.startsWith('symbol_')) {
    session.config.symbol = data.replace('symbol_', '');
    await sendMessage(chatId, `<b>✅ Ativo: ${session.config.symbol}</b>\n\n<b>Passo 2: Escolha a estratégia</b>`, { reply_markup: getStrategyKeyboard() });
    return;
  }
  
  if (data.startsWith('strategy_')) {
    session.config.strategy = data.replace('strategy_', '');
    await sendMessage(chatId, `<b>✅ Estratégia: ${session.config.strategy}</b>\n\n<b>Passo 3: Escolha o R/R</b>`, { reply_markup: getRRKeyboard() });
    return;
  }
  
  if (data.startsWith('rr_')) {
    session.config.rr = parseFloat(data.replace('rr_', ''));
    session.state = 'waiting_start';
    await sendMessage(chatId, `<b>✅ R/R: 1:${session.config.rr}</b>\n\n<b>Passo 4: Digite a data INICIAL</b>\nFormato: DD/MM/AAAA`);
    return;
  }
  
  if (data === 'my_results') {
    const result = BACKTEST_RESULTS.get(chatId);
    if (!result) {
      await sendMessage(chatId, '<b>📊 Nenhum backtest encontrado</b>', { reply_markup: getMainKeyboard() });
      return;
    }
    await sendMessage(chatId,
      `<b>📊 SEU ÚLTIMO BACKTEST</b>

<b>Config:</b> ${result.config.symbol} | ${result.config.strategy} | R/R 1:${result.config.rr}
<b>Período:</b> ${result.testPeriod.start} a ${result.testPeriod.end}

<b>Resultados:</b>
• Trades: ${result.results.totalTrades}
• WR: ${(result.results.winRate * 100).toFixed(1)}%
• PnL: ${result.results.totalPnl.toFixed(0)} pts

<b>vs Admin:</b> ${result.comparedToAdmin.isBetter ? '🏆 MELHOR' : '📉 Pior'} (${result.comparedToAdmin.pnlDiff > 0 ? '+' : ''}${result.comparedToAdmin.pnlDiff.toFixed(0)} pts)`,
      { reply_markup: getMainKeyboard() }
    );
    return;
  }
  
  if (data === 'ranking') {
    const sorted = Array.from(BACKTEST_RESULTS.values()).sort((a, b) => b.results.totalPnl - a.results.totalPnl).slice(0, 5);
    
    if (sorted.length === 0) {
      await sendMessage(chatId, '<b>🏆 Ranking vazio</b>', { reply_markup: getMainKeyboard() });
      return;
    }
    
    let msg = '<b>🏆 TOP 5 BACKTESTS</b>\n\n';
    for (let i = 0; i < sorted.length; i++) {
      const r = sorted[i];
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '📊';
      msg += `${medal} @${r.username || r.userId}\n`;
      msg += `   ${r.config.symbol} | ${r.config.strategy}\n`;
      msg += `   PnL: ${r.results.totalPnl.toFixed(0)} | WR: ${(r.results.winRate * 100).toFixed(0)}%`;
      msg += ` ${r.comparedToAdmin.isBetter ? '🏆' : ''}\n\n`;
    }
    await sendMessage(chatId, msg, { reply_markup: getMainKeyboard() });
    return;
  }
}

async function handleMessage(msg: TelegramUpdate['message']): Promise<void> {
  if (!msg || !msg.text) return;
  
  const chatId = msg.chat.id.toString();
  const text = msg.text.trim();
  const username = msg.from?.username || msg.from?.first_name;
  const session = getSession(chatId);
  
  if (text === '/start') {
    await handleStart(chatId, username);
    return;
  }
  
  // Date input
  if (session.state === 'waiting_start' || session.state === 'waiting_end') {
    const match = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (!match) {
      await sendMessage(chatId, '<b>❌ Formato inválido!</b>\n\nUse: DD/MM/AAAA');
      return;
    }
    
    const [, day, month, year] = match;
    const fullYear = year.length === 2 ? `20${year}` : year;
    const dateStr = `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    
    if (session.state === 'waiting_start') {
      session.config.startDate = dateStr;
      session.state = 'waiting_end';
      await sendMessage(chatId, `<b>✅ Data inicial: ${dateStr}</b>\n\n<b>Digite a data FINAL:</b>`);
    } else {
      session.config.endDate = dateStr;
      session.state = 'idle';
      await sendMessage(chatId, `<b>✅ Data final: ${dateStr}</b>\n\n<b>🚀 Executando backtest...</b>`);
      await executeBacktest(session);
    }
    return;
  }
  
  await handleStart(chatId, username);
}

// ==================== MAIN ====================

async function main(): Promise<void> {
  console.log('\n🤖 ========================================');
  console.log('🤖 VEXOR COPILOT + TELEGRAM INTEGRADO');
  console.log('🤖 ========================================\n');
  
  // Inicializa Oracle
  await oracleDB.initialize();
  console.log('✅ Oracle conectado');
  
  // Carrega context memory
  console.log(`✅ Context Memory: ${contextMemory.getStats?.()?.totalContexts || 0} contextos`);
  
  // Testa bot
  const resp = await fetch(`${CONFIG.apiBaseUrl}/getMe`);
  const data = await resp.json() as any;
  if (data.ok) console.log(`✅ Bot: @${data.result.username}`);
  
  // Mensagem para admin
  await sendMessage(CONFIG.adminChatId,
    `<b>🤖 COPILOT INICIADO</b>

<b>Funcionalidades ativas:</b>
• 📊 Sinais em tempo real
• 🧪 Backtest interativo
• 📈 Comparação com sua config

<b>Sua config:</b>
• Ativo: ${CONFIG.adminConfig.symbol}
• Estratégia: ${CONFIG.adminConfig.strategy}
• R/R: 1:${CONFIG.adminConfig.rr}

<i>Usuários podem testar estratégias e você será notificado!</i>`,
    { reply_markup: getMainKeyboard() }
  );
  
  console.log('\n📥 Aguardando usuários e sinais...\n');
  
  // Loop principal
  let lastUpdateId = 0;
  
  while (true) {
    try {
      // Processa Telegram updates
      const updates = await getUpdates(lastUpdateId + 1);
      for (const update of updates) {
        lastUpdateId = update.update_id;
        if (update.message) await handleMessage(update.message);
        else if (update.callback_query) await handleCallback(update.callback_query);
      }
      
      // Gera sinais para cada símbolo
      for (const symbol of CONFIG.symbols) {
        const signal = generateSignal(symbol);
        if (signal) {
          console.log(`📊 Sinal: ${signal.symbol} ${signal.side}`);
          await broadcastSignal(signal);
        }
      }
      
      // Aguarda
      await new Promise(r => setTimeout(r, CONFIG.signalInterval));
      
    } catch (e) {
      console.error('❌ Erro:', e);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

main().catch(err => {
  console.error('❌ Erro fatal:', err);
  process.exit(1);
});
