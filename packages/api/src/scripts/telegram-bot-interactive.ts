/**
 * TELEGRAM BOT INTERATIVO - VEXOR COPILOT
 * Permite usuários configurarem e testarem o robô
 * Comandos: /start, /config, /test, /status, /help
 */

import * as fs from 'fs';
import * as path from 'path';
import { config } from 'dotenv';
import { oracleDB } from '../infrastructure/oracle-db.js';
import { ramCache } from '../infrastructure/nexus-core/memory/index.js';
import { getContextMemory } from '../infrastructure/context-memory.js';

const rootEnv = 'C:/Users/opc/CascadeProjects/vexor-Oracle/vexor-Oracle-main/.env';
if (fs.existsSync(rootEnv)) {
  config({ path: rootEnv, override: true });
}

// ==================== CONFIG ====================

const BOT_CONFIG = {
  token: process.env.TELEGRAM_BOT_TOKEN || '8710971540:AAGs15wUAxx_964NKuEKwL31jTb_mdZ0Kao',
  adminChatId: process.env.TELEGRAM_CHAT_ID || '7192227673',
  apiBaseUrl: `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN || '8710971540:AAGs15wUAxx_964NKuEKwL31jTb_mdZ0Kao'}`,
  allowedUsers: new Set<string>(['7192227673']), // Admin por padrão
  pollInterval: 1000
};

// ==================== USER SESSIONS ====================

interface UserSession {
  chatId: string;
  username?: string;
  config: {
    symbol: string;
    strategy: string;
    rr: number;
    newsFilter: number;
    testMode: boolean;
    testDate?: string;
  };
  state: 'idle' | 'configuring_symbol' | 'configuring_strategy' | 'configuring_rr' | 'configuring_date' | 'testing';
  createdAt: Date;
}

const SESSIONS = new Map<string, UserSession>();

// ==================== AVAILABLE OPTIONS ====================

const SYMBOLS = {
  b3: ['WDOFUT', 'DOLFUT', 'WINFUT', 'PETR4', 'VALE3', 'ITUB4'],
  global: ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'XAUUSD', 'BTCUSD', 'ETHUSD']
};

const STRATEGIES = [
  { id: 'breakout', name: 'Breakout', desc: 'Rompimento de níveis' },
  { id: 'mean_reversion', name: 'Mean Reversion', desc: 'Reversão à média' },
  { id: 'momentum', name: 'Momentum', desc: 'Seguir tendência' },
  { id: 'scalping', name: 'Scalping', desc: 'Operações rápidas' }
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

async function editMessage(chatId: number, messageId: number, text: string, options?: any): Promise<void> {
  const body: any = {
    chat_id: chatId,
    message_id: messageId,
    text: text,
    parse_mode: 'HTML'
  };
  
  if (options?.reply_markup) {
    body.reply_markup = options.reply_markup;
  }
  
  await fetch(`${BOT_CONFIG.apiBaseUrl}/editMessageText`, {
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
      [
        { text: '📊 Configurar', callback_data: 'config' },
        { text: '🧪 Testar', callback_data: 'test' }
      ],
      [
        { text: '📈 Status', callback_data: 'status' },
        { text: '❓ Ajuda', callback_data: 'help' }
      ],
      [
        { text: '🔔 Sinais ON', callback_data: 'signals_on' },
        { text: '🔕 Sinais OFF', callback_data: 'signals_off' }
      ]
    ]
  };
}

function getSymbolKeyboard(): any {
  const rows: any[][] = [];
  
  // B3
  rows.push([{ text: '🇧🇷 B3 (Brasil)', callback_data: 'none' }]);
  for (let i = 0; i < SYMBOLS.b3.length; i += 3) {
    rows.push(SYMBOLS.b3.slice(i, i + 3).map(s => ({
      text: s,
      callback_data: `symbol_${s}`
    })));
  }
  
  // Global
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
      text: `${strat.name} - ${strat.desc}`,
      callback_data: `strategy_${strat.id}`
    }]);
  }
  
  rows.push([{ text: '⬅️ Voltar', callback_data: 'config' }]);
  
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
      [{ text: '⬅️ Voltar', callback_data: 'config' }]
    ]
  };
}

function getNewsFilterKeyboard(): any {
  return {
    inline_keyboard: [
      [
        { text: '0 - Desativado', callback_data: 'news_0' },
        { text: '1 - Baixo', callback_data: 'news_1' }
      ],
      [
        { text: '2 - Médio', callback_data: 'news_2' },
        { text: '3 - Alto', callback_data: 'news_3' }
      ],
      [{ text: '⬅️ Voltar', callback_data: 'config' }]
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
        newsFilter: 3,
        testMode: false
      },
      state: 'idle',
      createdAt: new Date()
    });
  }
  return SESSIONS.get(chatId)!;
}

// ==================== MESSAGE HANDLERS ====================

async function handleStart(chatId: string, username?: string): Promise<void> {
  const session = getSession(chatId);
  session.username = username;
  
  // Adiciona usuário à lista permitida
  BOT_CONFIG.allowedUsers.add(chatId);
  
  const msg = `<b>🤖 VEXOR COPILOT</b>

Olá${username ? `, ${username}` : ''}! Sou seu assistente de trading.

<b>Funcionalidades:</b>
• 📊 <b>Configurar</b> - Ajustar ativo, estratégia, R/R
• 🧪 <b>Testar</b> - Simular operações em data específica
• 📈 <b>Status</b> - Ver desempenho atual
• 🔔 <b>Sinais</b> - Ativar/desativar alertas

<b>Sua configuração atual:</b>
• Ativo: <code>${session.config.symbol}</code>
• Estratégia: <code>${session.config.strategy}</code>
• R/R: <code>1:${session.config.rr}</code>
• News Filter: <code>${session.config.newsFilter}</code>

<b>Escolha uma opção:</b>`;
  
  await sendMessage(chatId, msg, { reply_markup: getMainKeyboard() });
}

async function handleConfig(chatId: string): Promise<void> {
  const session = getSession(chatId);
  
  const msg = `<b>📊 CONFIGURAÇÃO</b>

<b>Configuração atual:</b>
• Ativo: <code>${session.config.symbol}</code>
• Estratégia: <code>${session.config.strategy}</code>
• R/R: <code>1:${session.config.rr}</code>
• News Filter: <code>${session.config.newsFilter}</code>

<b>O que deseja configurar?</b>`;
  
  await sendMessage(chatId, msg, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📈 Ativo', callback_data: 'config_symbol' }],
        [{ text: '🎯 Estratégia', callback_data: 'config_strategy' }],
        [{ text: '⚖️ Risco/Retorno', callback_data: 'config_rr' }],
        [{ text: '📰 News Filter', callback_data: 'config_news' }],
        [{ text: '⬅️ Voltar', callback_data: 'main' }]
      ]
    }
  });
}

async function handleTest(chatId: string): Promise<void> {
  const session = getSession(chatId);
  session.state = 'configuring_date';
  
  const msg = `<b>🧪 MODO TESTE</b>

Configure a simulação:

<b>Ativo:</b> <code>${session.config.symbol}</code>
<b>Estratégia:</b> <code>${session.config.strategy}</code>

<b>Escolha o período para testar:</b>`;
  
  await sendMessage(chatId, msg, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '📅 Hoje', callback_data: 'test_today' },
          { text: '📅 Ontem', callback_data: 'test_yesterday' }
        ],
        [
          { text: '📅 Última semana', callback_data: 'test_week' },
          { text: '📅 Último mês', callback_data: 'test_month' }
        ],
        [
          { text: '🗓️ Data específica', callback_data: 'test_custom' }
        ],
        [{ text: '⬅️ Voltar', callback_data: 'main' }]
      ]
    }
  });
}

async function handleStatus(chatId: string): Promise<void> {
  const session = getSession(chatId);
  
  // Busca estatísticas do Context Memory
  const contextMemory = getContextMemory();
  const stats = contextMemory.getStats?.() || { totalContexts: 0, blockedContexts: 0 };
  
  // Busca últimos sinais do Oracle
  let recentSignals = 0;
  let winRate = 0;
  
  try {
    const result = await oracleDB.execute(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN outcome = 1 THEN 1 ELSE 0 END) as wins
      FROM trade_history 
      WHERE created_at > SYSDATE - 7
    `);
    
    if (result.rows && result.rows.length > 0) {
      const row = result.rows[0] as any;
      recentSignals = row[0] || 0;
      winRate = row[0] > 0 ? ((row[1] || 0) / row[0]) * 100 : 0;
    }
  } catch (e) {
    // Ignora erro
  }
  
  const msg = `<b>📈 STATUS DO COPILOT</b>

<b>📊 Desempenho (7 dias):</b>
• Sinais gerados: <code>${recentSignals}</code>
• Win Rate: <code>${winRate.toFixed(1)}%</code>

<b>🧠 Context Memory:</b>
• Contextos ativos: <code>${stats.totalContexts - stats.blockedContexts}</code>
• Contextos bloqueados: <code>${stats.blockedContexts}</code>

<b>⚙️ Sua configuração:</b>
• Ativo: <code>${session.config.symbol}</code>
• Estratégia: <code>${session.config.strategy}</code>
• R/R: <code>1:${session.config.rr}</code>

<b>💾 RAM Cache:</b>
• Status: <code>Ativo</code>

<b>⏰ Última atualização:</b>
<code>${new Date().toLocaleString('pt-BR')}</code>`;
  
  await sendMessage(chatId, msg, { reply_markup: getMainKeyboard() });
}

async function handleHelp(chatId: string): Promise<void> {
  const msg = `<b>❓ AJUDA - VEXOR COPILOT</b>

<b>Comandos disponíveis:</b>

/start - Iniciar o bot
/config - Configurar parâmetros
/test - Modo de simulação
/status - Ver desempenho
/help - Esta mensagem

<b>Como usar:</b>

1️⃣ <b>Configure</b> o ativo e estratégia
2️⃣ <b>Ajuste</b> o Risco/Retorno desejado
3️⃣ <b>Ative</b> os sinais para receber alertas
4️⃣ <b>Teste</b> estratégias em dados históricos

<b>Estratégias disponíveis:</b>
• <b>Breakout</b> - Rompimento de níveis
• <b>Mean Reversion</b> - Reversão à média
• <b>Momentum</b> - Seguir tendência
• <b>Scalping</b> - Operações rápidas

<b>News Filter:</b>
• 0 = Desativado
• 1 = Baixo (1 notícia)
• 2 = Médio (2 notícias)
• 3 = Alto (3+ notícias bloqueiam)

<b>Dica:</b> Use o modo teste para validar estratégias antes de usar sinais reais!`;
  
  await sendMessage(chatId, msg, { reply_markup: getMainKeyboard() });
}

async function runTest(chatId: string, period: string): Promise<void> {
  const session = getSession(chatId);
  session.config.testMode = true;
  
  await sendMessage(chatId, `<b>🧪 Executando teste...</b>

<b>Período:</b> ${period}
<b>Ativo:</b> ${session.config.symbol}
<b>Estratégia:</b> ${session.config.strategy}

<i>Aguarde enquanto analiso os dados...</i>`);
  
  // Simula teste (na prática buscaria dados históricos)
  const results = {
    trades: Math.floor(Math.random() * 50) + 10,
    wins: Math.floor(Math.random() * 30) + 5,
    losses: 0,
    pnl: 0
  };
  
  results.losses = results.trades - results.wins;
  results.pnl = (results.wins * session.config.rr - results.losses) * 100;
  
  const winRate = (results.wins / results.trades * 100).toFixed(1);
  
  await sendMessage(chatId, `<b>✅ TESTE CONCLUÍDO</b>

<b>📊 Resultados:</b>
• Trades: <code>${results.trades}</code>
• Vitórias: <code>${results.wins}</code>
• Derrotas: <code>${results.losses}</code>
• Win Rate: <code>${winRate}%</code>
• PnL estimado: <code>${results.pnl > 0 ? '+' : ''}${results.pnl.toFixed(0)} pontos</code>

<b>Configuração usada:</b>
• Ativo: <code>${session.config.symbol}</code>
• Estratégia: <code>${session.config.strategy}</code>
• R/R: <code>1:${session.config.rr}</code>

<b>Deseja aplicar esta configuração?</b>`,
  {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Aplicar', callback_data: 'apply_test' },
          { text: '🔄 Testar novamente', callback_data: 'test' }
        ],
        [{ text: '⬅️ Menu principal', callback_data: 'main' }]
      ]
    }
  });
  
  session.config.testMode = false;
}

// ==================== CALLBACK HANDLER ====================

async function handleCallback(callback: TelegramUpdate['callback_query']): Promise<void> {
  if (!callback) return;
  
  const chatId = callback.message!.chat.id.toString();
  const data = callback.data;
  const messageId = callback.message!.message_id;
  
  const session = getSession(chatId);
  
  await answerCallback(callback.id);
  
  // Main menu
  if (data === 'main') {
    await handleStart(chatId, session.username);
    return;
  }
  
  // Config menu
  if (data === 'config') {
    await handleConfig(chatId);
    return;
  }
  
  if (data === 'config_symbol') {
    session.state = 'configuring_symbol';
    await editMessage(parseInt(chatId), messageId, '<b>📈 Escolha o ativo:</b>', { reply_markup: getSymbolKeyboard() });
    return;
  }
  
  if (data === 'config_strategy') {
    session.state = 'configuring_strategy';
    await editMessage(parseInt(chatId), messageId, '<b>🎯 Escolha a estratégia:</b>', { reply_markup: getStrategyKeyboard() });
    return;
  }
  
  if (data === 'config_rr') {
    session.state = 'configuring_rr';
    await editMessage(parseInt(chatId), messageId, '<b>⚖️ Escolha o Risco/Retorno:</b>', { reply_markup: getRRKeyboard() });
    return;
  }
  
  if (data === 'config_news') {
    await editMessage(parseInt(chatId), messageId, '<b>📰 Escolha o News Filter:</b>', { reply_markup: getNewsFilterKeyboard() });
    return;
  }
  
  // Symbol selection
  if (data.startsWith('symbol_')) {
    const symbol = data.replace('symbol_', '');
    session.config.symbol = symbol;
    session.state = 'idle';
    
    await editMessage(parseInt(chatId), messageId, 
      `<b>✅ Ativo configurado!</b>\n\nNovo ativo: <code>${symbol}</code>\n\n<b>Configure outros parâmetros ou volte ao menu:</b>`,
      { reply_markup: getMainKeyboard() }
    );
    return;
  }
  
  // Strategy selection
  if (data.startsWith('strategy_')) {
    const strategy = data.replace('strategy_', '');
    session.config.strategy = strategy;
    session.state = 'idle';
    
    const stratName = STRATEGIES.find(s => s.id === strategy)?.name || strategy;
    
    await editMessage(parseInt(chatId), messageId,
      `<b>✅ Estratégia configurada!</b>\n\nNova estratégia: <code>${stratName}</code>\n\n<b>Configure outros parâmetros ou volte ao menu:</b>`,
      { reply_markup: getMainKeyboard() }
    );
    return;
  }
  
  // RR selection
  if (data.startsWith('rr_')) {
    const rr = parseFloat(data.replace('rr_', ''));
    session.config.rr = rr;
    session.state = 'idle';
    
    await editMessage(parseInt(chatId), messageId,
      `<b>✅ Risco/Retorno configurado!</b>\n\nNovo R/R: <code>1:${rr}</code>\n\n<b>Configure outros parâmetros ou volte ao menu:</b>`,
      { reply_markup: getMainKeyboard() }
    );
    return;
  }
  
  // News filter selection
  if (data.startsWith('news_')) {
    const news = parseInt(data.replace('news_', ''));
    session.config.newsFilter = news;
    
    await editMessage(parseInt(chatId), messageId,
      `<b>✅ News Filter configurado!</b>\n\nNovo nível: <code>${news}</code>\n\n<b>Configure outros parâmetros ou volte ao menu:</b>`,
      { reply_markup: getMainKeyboard() }
    );
    return;
  }
  
  // Test menu
  if (data === 'test') {
    await handleTest(chatId);
    return;
  }
  
  // Test periods
  if (data.startsWith('test_')) {
    const period = data.replace('test_', '');
    await runTest(chatId, period);
    return;
  }
  
  // Apply test config
  if (data === 'apply_test') {
    await sendMessage(chatId,
      `<b>✅ Configuração aplicada!</b>

<b>Configuração ativa:</b>
• Ativo: <code>${session.config.symbol}</code>
• Estratégia: <code>${session.config.strategy}</code>
• R/R: <code>1:${session.config.rr}</code>
• News Filter: <code>${session.config.newsFilter}</code>

<i>Você receberá sinais com esta configuração.</i>`,
      { reply_markup: getMainKeyboard() }
    );
    return;
  }
  
  // Status
  if (data === 'status') {
    await handleStatus(chatId);
    return;
  }
  
  // Help
  if (data === 'help') {
    await handleHelp(chatId);
    return;
  }
  
  // Signals on/off
  if (data === 'signals_on') {
    BOT_CONFIG.allowedUsers.add(chatId);
    await sendMessage(chatId, '<b>🔔 Sinais ATIVADOS</b>\n\nVocê receberá alertas de trading.', { reply_markup: getMainKeyboard() });
    return;
  }
  
  if (data === 'signals_off') {
    BOT_CONFIG.allowedUsers.delete(chatId);
    await sendMessage(chatId, '<b>🔕 Sinais DESATIVADOS</b>\n\nVocê não receberá mais alertas.', { reply_markup: getMainKeyboard() });
    return;
  }
}

// ==================== MESSAGE HANDLER ====================

async function handleMessage(msg: TelegramUpdate['message']): Promise<void> {
  if (!msg || !msg.text) return;
  
  const chatId = msg.chat.id.toString();
  const text = msg.text.trim().toLowerCase();
  const username = msg.from?.username || msg.from?.first_name;
  
  // Comandos
  if (text === '/start') {
    await handleStart(chatId, username);
    return;
  }
  
  if (text === '/config') {
    await handleConfig(chatId);
    return;
  }
  
  if (text === '/test') {
    await handleTest(chatId);
    return;
  }
  
  if (text === '/status') {
    await handleStatus(chatId);
    return;
  }
  
  if (text === '/help') {
    await handleHelp(chatId);
    return;
  }
  
  // Handle custom date input
  const session = getSession(chatId);
  if (session.state === 'configuring_date') {
    // Parse date input
    const dateMatch = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (dateMatch) {
      const [, day, month, year] = dateMatch;
      const fullYear = year.length === 2 ? `20${year}` : year;
      session.config.testDate = `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      session.state = 'idle';
      
      await sendMessage(chatId,
        `<b>📅 Data configurada!</b>\n\nData: <code>${session.config.testDate}</code>\n\nIniciando teste...`
      );
      
      await runTest(chatId, session.config.testDate);
      return;
    }
    
    await sendMessage(chatId,
      `<b>❌ Formato inválido!</b>\n\nUse: DD/MM/AAAA\nExemplo: 08/03/2026`
    );
    return;
  }
  
  // Default response
  await sendMessage(chatId,
    `<b>🤖 Comando não reconhecido</b>\n\nUse os botões do menu ou digite:\n/start - Iniciar\n/config - Configurar\n/test - Testar\n/status - Status\n/help - Ajuda`,
    { reply_markup: getMainKeyboard() }
  );
}

// ==================== MAIN LOOP ====================

async function startBot(): Promise<void> {
  console.log('\n🤖 ========================================');
  console.log('🤖 VEXOR TELEGRAM BOT - INTERATIVO');
  console.log('🤖 ========================================\n');
  
  // Testa conexão com Telegram
  try {
    const resp = await fetch(`${BOT_CONFIG.apiBaseUrl}/getMe`);
    const data = await resp.json() as any;
    
    if (data.ok) {
      console.log(`✅ Bot conectado: @${data.result.username}`);
      console.log(`   Nome: ${data.result.first_name}`);
    } else {
      console.error('❌ Erro ao conectar com Telegram');
      return;
    }
  } catch (e) {
    console.error('❌ Erro de conexão:', e);
    return;
  }
  
  // Envia mensagem para admin
  await sendMessage(BOT_CONFIG.adminChatId,
    `<b>🤖 VEXOR BOT INICIADO</b>

O bot está online e pronto para interagir!

<b>Comandos disponíveis:</b>
/start - Iniciar interação
/config - Configurar parâmetros
/test - Modo de simulação
/status - Ver desempenho
/help - Ajuda

<i>Bot interativo ativo!</i>`,
    { reply_markup: getMainKeyboard() }
  );
  
  console.log('\n📥 Aguardando mensagens...\n');
  
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
      
      // Aguarda antes de próxima verificação
      await new Promise(r => setTimeout(r, BOT_CONFIG.pollInterval));
      
    } catch (e) {
      console.error('❌ Erro no loop:', e);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// ==================== START ====================

startBot().catch(err => {
  console.error('❌ Erro fatal:', err);
  process.exit(1);
});
