/**
 * AI Signals Routes
 * Returns trading signals from NEXUS-CORE agents
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { oracleDB } from '../infrastructure/oracle-db.js';
import { telegramNotifier, sendTelegramNotification, sendBehaviorAlert } from '../infrastructure/telegram-notifier.js';
import { newsService } from '../infrastructure/news-service.js';
import { tradeSignalsService } from '../infrastructure/trade-signals.js';
import { realtimePricesService } from '../infrastructure/realtime-prices.js';

interface AISignal {
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  entry_price?: number;
  exit_price?: number;
  pnl?: number;
  timestamp: string;
  agents: string[];
  confidence: number;
}

// Mock signals for demo (in production, these come from NEXUS-CORE agents)
const mockSignals: AISignal[] = [
  { symbol: 'PETR4', action: 'BUY', entry_price: 38.50, timestamp: new Date().toISOString(), agents: ['crypto', 'forex', 'stocks'], confidence: 85 },
  { symbol: 'VALE3', action: 'SELL', exit_price: 68.20, timestamp: new Date().toISOString(), agents: ['crypto', 'stocks'], confidence: 72 },
  { symbol: 'ITUB4', action: 'BUY', entry_price: 32.10, timestamp: new Date().toISOString(), agents: ['forex', 'stocks'], confidence: 68 },
  { symbol: 'BBDC4', action: 'HOLD', pnl: 150.00, timestamp: new Date().toISOString(), agents: ['stocks'], confidence: 55 },
  { symbol: 'WEGE3', action: 'BUY', entry_price: 35.80, timestamp: new Date().toISOString(), agents: ['crypto', 'stocks', 'forex'], confidence: 91 },
  { symbol: 'RENT3', action: 'SELL', exit_price: 48.90, pnl: -120.50, timestamp: new Date().toISOString(), agents: ['stocks'], confidence: 63 },
  { symbol: 'MGLU3', action: 'HOLD', pnl: 320.00, timestamp: new Date().toISOString(), agents: ['crypto', 'stocks'], confidence: 77 },
  { symbol: 'BBAS3', action: 'BUY', entry_price: 56.40, timestamp: new Date().toISOString(), agents: ['forex', 'stocks'], confidence: 81 },
  { symbol: 'ABEV3', action: 'SELL', exit_price: 14.25, timestamp: new Date().toISOString(), agents: ['stocks'], confidence: 59 },
  { symbol: 'SUZB3', action: 'BUY', entry_price: 52.30, timestamp: new Date().toISOString(), agents: ['crypto', 'stocks'], confidence: 74 },
];

export async function aiSignalsRoutes(app: FastifyInstance) {
  // Get AI signals for symbols
  app.get('/api/v1/ai/signals', async (request: FastifyRequest<{ Querystring: { symbols?: string } }>, reply: FastifyReply) => {
    const symbolsParam = request.query.symbols || '';
    const requestedSymbols = symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

    try {
      // Try to get from Oracle AI_DECISION_LOGS table
      if (oracleDB) {
        try {
          const rows = await oracleDB.query<{
            SYMBOL: string;
            FINAL_ACTION: string;
            POSITION_SIZE: number;
            STOP_LOSS: number;
            TAKE_PROFIT: number;
            TIMESTAMP: Date;
            AGREEING_AGENTS: string;
            DISAGREEING_AGENTS: string;
          }>(
            `SELECT symbol, final_action, position_size, stop_loss, take_profit, timestamp, 
                    agreeing_agents, disagreeing_agents
             FROM ai_decision_logs 
             WHERE timestamp > CURRENT_TIMESTAMP - INTERVAL '24' HOUR
             ORDER BY timestamp DESC`
          );

          if (rows.length > 0) {
            const signals: AISignal[] = rows.map(row => ({
              symbol: row.SYMBOL,
              action: (row.FINAL_ACTION?.toUpperCase() || 'HOLD') as 'BUY' | 'SELL' | 'HOLD',
              entry_price: row.POSITION_SIZE ? row.POSITION_SIZE : undefined,
              exit_price: row.TAKE_PROFIT ? row.TAKE_PROFIT : undefined,
              timestamp: row.TIMESTAMP.toISOString(),
              agents: row.AGREEING_AGENTS ? JSON.parse(row.AGREEING_AGENTS) : [],
              confidence: row.AGREEING_AGENTS && row.DISAGREEING_AGENTS
                ? Math.round((JSON.parse(row.AGREEING_AGENTS).length / 
                    (JSON.parse(row.AGREEING_AGENTS).length + JSON.parse(row.DISAGREEING_AGENTS).length)) * 100)
                : 50,
            }));

            // Filter by requested symbols if provided
            const filtered = requestedSymbols.length > 0
              ? signals.filter(s => requestedSymbols.includes(s.symbol))
              : signals;

            return reply.send({ signals: filtered });
          }
        } catch (e) {
          // Oracle not available, use mock
        }
      }

      // Use mock signals
      const filtered = requestedSymbols.length > 0
        ? mockSignals.filter(s => requestedSymbols.includes(s.symbol))
        : mockSignals;

      return reply.send({ signals: filtered });
    } catch (error) {
      app.log.error({ error }, 'Failed to get AI signals');
      return reply.status(500).send({ error: 'Failed to get AI signals' });
    }
  });

  // Get latest AI decisions
  app.get('/api/v1/ai/decisions', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (oracleDB) {
        const rows = await oracleDB.query<any>(
          `SELECT * FROM ai_decision_logs ORDER BY timestamp DESC FETCH FIRST 50 ROWS ONLY`
        );
        if (rows.length > 0) {
          return reply.send({ decisions: rows });
        }
      }
      return reply.send({ decisions: mockSignals });
    } catch (error) {
      return reply.send({ decisions: mockSignals });
    }
  });

  // Get AI performance stats
  app.get('/api/v1/ai/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const stats = {
      totalTrades: 156,
      winRate: 68.5,
      avgWin: 245.30,
      avgLoss: -98.50,
      profitFactor: 2.49,
      sharpeRatio: 1.82,
      maxDrawdown: -8.5,
      bestTrade: { symbol: 'WEGE3', pnl: 1250.00 },
      worstTrade: { symbol: 'MGLU3', pnl: -450.00 },
      agentPerformance: [
        { name: 'crypto', winRate: 72, trades: 45 },
        { name: 'forex', winRate: 65, trades: 38 },
        { name: 'stocks', winRate: 70, trades: 73 },
      ],
      recentSignals: mockSignals.slice(0, 5),
    };
    return reply.send(stats);
  });

  // Send trade notification via Telegram
  app.post('/api/v1/telegram/trade', async (request: FastifyRequest<{ Body: AISignal }>, reply: FastifyReply) => {
    const body = request.body;
    if (!body?.symbol) {
      return reply.status(400).send({ error: 'Symbol required' });
    }

    const result = await sendTelegramNotification({
      symbol: body.symbol,
      side: body.action,
      entryPrice: body.entry_price,
      exitPrice: body.exit_price,
      pnl: body.pnl,
      agents: body.agents,
      confidence: body.confidence,
      timestamp: new Date(body.timestamp || new Date()),
    });

    return reply.send(result);
  });

  // Send behavior alert via Telegram
  app.post('/api/v1/telegram/alert', async (request: FastifyRequest<{ Body: { pattern: string; severity: number; description: string; recommendation: string } }>, reply: FastifyReply) => {
    const body = request.body;
    if (!body?.pattern) {
      return reply.status(400).send({ error: 'Pattern required' });
    }

    const result = await sendBehaviorAlert(body);
    return reply.send(result);
  });

  // Test Telegram connection
  app.get('/api/v1/telegram/test', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!telegramNotifier.isEnabled()) {
      return reply.send({ success: false, error: 'Telegram not configured' });
    }

    const success = await telegramNotifier.sendMessage('🤖 *VEXOR* - Telegram configurado com sucesso!\n\nVocê receberá notificações de trades da IA.');
    return reply.send({ success });
  });

  // ==================== NEWS ROUTES ====================

  // Get all news
  app.get('/api/v1/news', async (request: FastifyRequest, reply: FastifyReply) => {
    const news = await newsService.getAllNews();
    return reply.send({ news, total: news.length });
  });

  // Get news for symbol
  app.get('/api/v1/news/symbol/:symbol', async (request: FastifyRequest<{ Params: { symbol: string } }>, reply: FastifyReply) => {
    const { symbol } = request.params;
    const news = await newsService.getNewsForSymbol(symbol);
    return reply.send({ symbol, news, total: news.length });
  });

  // Get news for group
  app.get('/api/v1/news/group/:group', async (request: FastifyRequest<{ Params: { group: string } }>, reply: FastifyReply) => {
    const { group } = request.params;
    const news = await newsService.getNewsForGroup(group);
    return reply.send({ group, news, total: news.length });
  });

  // Send news alert to Telegram
  app.post('/api/v1/news/alert', async (request: FastifyRequest<{ Body: { newsId: string; chatId?: string } }>, reply: FastifyReply) => {
    const { newsId } = request.body || {};
    const allNews = await newsService.getAllNews();
    const news = allNews.find(n => n.id === newsId);

    if (!news) {
      return reply.status(404).send({ error: 'News not found' });
    }

    const sentimentEmoji = news.sentiment === 'positive' ? '📈' : news.sentiment === 'negative' ? '📉' : '📊';
    const groups = news.relatedGroups?.length ? `\n📁 <b>Grupos relacionados:</b> ${news.relatedGroups.join(', ')}` : '';

    const message = 
      `📰 <b>NOTÍCIA IMPORTANTE</b>\n\n` +
      `${sentimentEmoji} <b>${news.title}</b>\n\n` +
      `📝 ${news.summary}\n\n` +
      `🏷️ <b>Fonte:</b> ${news.source}\n` +
      `📊 <b>Sentimento:</b> ${news.sentiment.toUpperCase()}` +
      `${groups}\n\n` +
      `⏰ ${news.publishedAt.toLocaleString('pt-BR')}\n\n` +
      `<i>Verifique se essa notícia afeta suas posições!</i>\n\n` +
      `⚡ <b>VEXOR News</b>`;

    const success = await telegramNotifier.sendMessage(message);
    return reply.send({ success, news });
  });

  // ==================== TRADE SIGNALS ROUTES ====================

  // Get active trade signals
  app.get('/api/v1/signals', async (request: FastifyRequest, reply: FastifyReply) => {
    const signals = tradeSignalsService.getActiveSignals();
    return reply.send({ signals, total: signals.length });
  });

  // Get signal for symbol
  app.get('/api/v1/signals/:symbol', async (request: FastifyRequest<{ Params: { symbol: string } }>, reply: FastifyReply) => {
    const { symbol } = request.params;
    const signal = tradeSignalsService.getSignal(symbol);
    return reply.send({ signal });
  });

  // Analyze market for opportunities
  app.post('/api/v1/signals/analyze', async (request: FastifyRequest<{ Body: { symbols: string[]; prices: Record<string, number> } }>, reply: FastifyReply) => {
    const { symbols, prices } = request.body || {};
    if (!symbols || !prices) {
      return reply.status(400).send({ error: 'Symbols and prices required' });
    }

    const opportunities = await tradeSignalsService.checkForOpportunities(symbols, prices);
    return reply.send({ opportunities, total: opportunities.length });
  });

  // Manually trigger signal notification
  app.post('/api/v1/signals/notify', async (request: FastifyRequest<{ Body: { symbol: string } }>, reply: FastifyReply) => {
    const { symbol } = request.body || {};
    const signal = tradeSignalsService.getSignal(symbol);

    if (!signal) {
      return reply.status(404).send({ error: 'No active signal for this symbol' });
    }

    await tradeSignalsService.notifyTelegram(signal);
    return reply.send({ success: true, signal });
  });

  // ==================== REALTIME PRICES ROUTES (UDP) ====================

  // Get all realtime prices from UDP bridge
  app.get('/api/v1/prices/realtime', async (request: FastifyRequest, reply: FastifyReply) => {
    const prices = realtimePricesService.getAllPrices();
    return reply.send({ 
      prices, 
      total: prices.length,
      source: 'UDP Bridge (Genial + Pepperstone)',
      port: 10209
    });
  });

  // Get realtime price for symbol
  app.get('/api/v1/prices/realtime/:symbol', async (request: FastifyRequest<{ Params: { symbol: string } }>, reply: FastifyReply) => {
    const { symbol } = request.params;
    const price = realtimePricesService.getPrice(symbol.toUpperCase());
    
    if (!price) {
      return reply.status(404).send({ 
        error: 'Symbol not found in realtime feed',
        hint: 'Check if UDP bridge is running on port 10209'
      });
    }
    
    return reply.send({ price });
  });

  // Get all realtime opportunities (based on real prices)
  app.get('/api/v1/opportunities/realtime', async (request: FastifyRequest, reply: FastifyReply) => {
    const opportunities = realtimePricesService.getAllOpportunities();
    const prices = realtimePricesService.getAllPrices();
    
    return reply.send({ 
      opportunities, 
      total: opportunities.length,
      pricesMonitored: prices.length,
      lastUpdate: new Date()
    });
  });

  // Get realtime opportunity for symbol
  app.get('/api/v1/opportunities/realtime/:symbol', async (request: FastifyRequest<{ Params: { symbol: string } }>, reply: FastifyReply) => {
    const { symbol } = request.params;
    const opportunity = realtimePricesService.getOpportunity(symbol.toUpperCase());
    const price = realtimePricesService.getPrice(symbol.toUpperCase());
    
    return reply.send({ 
      symbol: symbol.toUpperCase(),
      opportunity,
      currentPrice: price
    });
  });

  // Force analysis on specific symbols (real data)
  app.post('/api/v1/opportunities/analyze-realtime', async (request: FastifyRequest<{ Body: { symbols?: string[] } }>, reply: FastifyReply) => {
    const { symbols } = request.body || {};
    const opportunities = await realtimePricesService.forceAnalysis(symbols);
    
    return reply.send({ 
      opportunities, 
      total: opportunities.length,
      analyzed: symbols || 'all monitored symbols'
    });
  });

  // Telegram bot status
  app.get('/api/v1/telegram/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const status = telegramNotifier.getStatus();
    return reply.send({
      ...status,
      message: status.enabled 
        ? '✅ Telegram bot ativo e configurado' 
        : '⚠️ Telegram bot não configurado'
    });
  });
}
