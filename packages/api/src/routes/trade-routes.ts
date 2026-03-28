/**
 * Routes for Trade Monitor and Broker Executor
 * API para monitoramento de posições, execução de ordens e aprendizado
 */

import { FastifyInstance } from 'fastify';
import { tradeMonitorService } from '../infrastructure/trade-monitor.js';
import { brokerExecutorService } from '../infrastructure/broker-executor.js';
import { orchestrator } from '../infrastructure/nexus-core/agents/index.js';

export async function tradeRoutes(app: FastifyInstance) {
  // ==================== BROKER ====================
  
  // Status dos brokers
  app.get('/api/v1/brokers/status', async (request, reply) => {
    const status = brokerExecutorService.getStatus();
    return { brokers: status };
  });

  // Conectar ao broker
  app.post('/api/v1/brokers/:name/connect', async (request, reply) => {
    const { name } = request.params as { name: string };
    const success = await brokerExecutorService.connect(name);
    return { success, broker: name };
  });

  // Informações da conta
  app.get('/api/v1/brokers/:name/account', async (request, reply) => {
    const { name } = request.params as { name: string };
    const info = await brokerExecutorService.getAccountInfo(name);
    return info || { error: 'Broker not connected' };
  });

  // Posições abertas no broker
  app.get('/api/v1/brokers/:name/positions', async (request, reply) => {
    const { name } = request.params as { name: string };
    const positions = await brokerExecutorService.getPositions(name);
    return { positions, count: positions.length };
  });

  // ==================== ORDERS ====================

  // Executar ordem manual
  app.post('/api/v1/orders/execute', async (request, reply) => {
    const body = request.body as {
      broker: string;
      symbol: string;
      side: 'BUY' | 'SELL';
      quantity: number;
      orderType?: 'MARKET' | 'LIMIT';
      price?: number;
      stopLoss?: number;
      takeProfit?: number;
    };

    const result = await brokerExecutorService.executeOrder(body.broker, {
      symbol: body.symbol,
      side: body.side,
      quantity: body.quantity,
      orderType: body.orderType || 'MARKET',
      price: body.price,
      stopLoss: body.stopLoss,
      takeProfit: body.takeProfit
    });

    return result;
  });

  // Fechar posição
  app.post('/api/v1/orders/close', async (request, reply) => {
    const body = request.body as {
      broker: string;
      symbol: string;
      quantity?: number;
    };

    const result = await brokerExecutorService.closePosition(
      body.broker, 
      body.symbol, 
      body.quantity
    );

    return result;
  });

  // ==================== TRADES MONITOR ====================

  // Posições monitoradas
  app.get('/api/v1/trades/positions', async (request, reply) => {
    const positions = tradeMonitorService.getOpenPositions();
    return { positions, count: positions.length };
  });

  // Estatísticas de aprendizado
  app.get('/api/v1/trades/learning', async (request, reply) => {
    const stats = await tradeMonitorService.getLearningStats();
    return stats;
  });

  // Carregar posições do banco
  app.post('/api/v1/trades/load', async (request, reply) => {
    await tradeMonitorService.loadOpenPositions();
    return { success: true };
  });

  // ==================== IA EXECUTION ====================

  // Executar sinal da IA
  app.post('/api/v1/ia/execute', async (request, reply) => {
    const body = request.body as {
      userId: string;
      symbol: string;
      broker?: string;
    };

    // Analisa com orchestrator
    const analysis = await orchestrator.orchestrate({
      symbol: body.symbol,
      sector: 1, // TODO: detectar setor
      prices: [], // TODO: obter do realtime
      volumes: [],
      candles: [],
      indicators: { sma20: 0, bbUpper: 0, bbLower: 0, rsi: 50 },
      macro: { selic: 13.75, ipca: 4.5, sp500: 0.5, dax: 0.3, nikkei: 0.2, dollarIndex: 0.1, commodities: 0.2 },
      psych: { recentPnl: [], consecutiveLosses: 0, consecutiveWins: 0, tradeFrequency: 0, avgHoldTime: 0, sessionDuration: 0 }
    });

    if (!analysis.approved || analysis.action === 'HOLD') {
      return { 
        success: false, 
        reason: 'IA nao aprovou operacao',
        analysis 
      };
    }

    // Executa ordem
    const result = await brokerExecutorService.executeFromSignal({
      userId: body.userId,
      symbol: body.symbol,
      action: analysis.action as 'BUY' | 'SELL',
      entry: 0, // Será preenchido pelo market
      stop: analysis.stop,
      target: analysis.target,
      quantity: 100, // TODO: calcular via position sizer
      strategy: analysis.agents[0]?.name || 'ORCHESTRATOR',
      agents: analysis.agents.map(a => a.name),
      confidence: analysis.confidence,
      broker: body.broker || 'genial'
    });

    return { 
      success: result.success, 
      positionId: result.positionId,
      error: result.error,
      analysis 
    };
  });

  // ==================== HISTORY ====================

  // Histórico de trades
  app.get('/api/v1/trades/history', async (request, reply) => {
    const query = request.query as { userId?: string; limit?: number };
    
    // TODO: implementar busca no Oracle
    return { 
      trades: [],
      message: 'Use Oracle query directly'
    };
  });

  console.log('[Routes] Trade and Broker routes registered');
}
