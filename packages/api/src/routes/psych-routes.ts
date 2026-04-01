/**
 * VEXOR Psych Agent Routes
 * APIs para monitor psicológico integrado
 */

import { FastifyInstance } from 'fastify';
import { psychAgent } from '../infrastructure/nexus-core/psych-agent.js';
import { slowPipeline } from '../infrastructure/nexus-core/slow-pipeline.js';
import { fastPipeline } from '../infrastructure/nexus-core/fast-pipeline.js';

export async function psychRoutes(app: FastifyInstance) {
  // ==================== PRE-TRADE CHECK ====================

  // Verificação psicológica pré-trade (chamado antes de cada ordem)
  app.post('/api/v1/psych/pre-trade', async (request, reply) => {
    const body = request.body as {
      symbol: string;
      side: 'BUY' | 'SELL';
      quantity: number;
      price: number;
      capital: number;
      dailyPnL: number;
      dailyTrades: number;
    };

    const result = await psychAgent.preTradeCheck(body);
    return result;
  });

  // ==================== MESSAGE ANALYSIS ====================

  // Analisa mensagem do trader (FAST + SLOW)
  app.post('/api/v1/psych/analyze', async (request, reply) => {
    const body = request.body as { message: string };
    const result = await psychAgent.analyzeMessage(body.message);
    return result;
  });

  // ==================== FAST TILT CHECK ====================

  // Verificação rápida de tilt (<1ms)
  app.post('/api/v1/psych/tilt-check', async (request, reply) => {
    const body = request.body as { message: string };
    const fastResult = {
      tiltLevel: psychAgent['fastAnalyzeMessage'](body.message)
    };
    return fastResult;
  });

  // ==================== COACH ====================

  // Pergunta livre ao coach
  app.post('/api/v1/psych/coach', async (request, reply) => {
    const body = request.body as { question: string };
    const response = await psychAgent.askCoach(body.question);
    return { response };
  });

  // ==================== STATE ====================

  // Estado psicológico atual
  app.get('/api/v1/psych/state', async (request, reply) => {
    const state = psychAgent.getState();
    const canTrade = psychAgent.canTrade();
    return { ...state, canTrade };
  });

  // Reset estado (novo dia)
  app.post('/api/v1/psych/reset', async (request, reply) => {
    psychAgent.resetState();
    return { success: true, message: 'Estado resetado' };
  });

  // ==================== POST-TRADE ====================

  // Atualiza estado após trade
  app.post('/api/v1/psych/post-trade', async (request, reply) => {
    const body = request.body as { outcome: number; pnl: number };
    await psychAgent.postTradeUpdate(body.outcome, body.pnl);
    return { success: true };
  });

  // Reflexão pós-trade (Steenbarger)
  app.post('/api/v1/psych/reflect', async (request, reply) => {
    const body = request.body as {
      symbol: string;
      side: string;
      pnl: number;
      outcome: number;
      setup: string;
    };
    const insight = await slowPipeline.postTradeReflection(body);
    return insight;
  });

  // ==================== HEALTH ====================

  // Verifica saúde do Ollama
  app.get('/api/v1/psych/health', async (request, reply) => {
    const health = await psychAgent.checkHealth();
    return health;
  });

  // ==================== BRIEFING ====================

  // Inicia ciclo de briefings
  app.post('/api/v1/psych/briefing/start', async (request, reply) => {
    slowPipeline.startBriefingCycle();
    return { success: true, message: 'Briefing cycle started' };
  });

  // Para ciclo de briefings
  app.post('/api/v1/psych/briefing/stop', async (request, reply) => {
    slowPipeline.stopBriefingCycle();
    return { success: true, message: 'Briefing cycle stopped' };
  });

  // Briefing manual
  app.post('/api/v1/psych/briefing', async (request, reply) => {
    const insight = await slowPipeline.runBriefing();
    return insight;
  });

  // ==================== FAST PIPELINE ====================

  // Processa tick
  app.post('/api/v1/pipeline/tick', async (request, reply) => {
    const body = request.body as {
      symbol: string;
      price: number;
      volume: number;
      timestamp: number;
    };
    fastPipeline.processTick(body);
    return { success: true };
  });

  // Obtém indicadores
  app.get('/api/v1/pipeline/indicators/:symbol', async (request, reply) => {
    const params = request.params as { symbol: string };
    const indicators = fastPipeline.getIndicators(params.symbol);
    return indicators || { error: 'Indicadores não disponíveis' };
  });

  // Pipeline completo FAST
  app.post('/api/v1/pipeline/run', async (request, reply) => {
    const body = request.body as {
      tick: { symbol: string; price: number; volume: number; timestamp: number };
      capital: number;
      winRate: number;
      avgWin: number;
      avgLoss: number;
      broker: 'genial' | 'pepperstone';
    };
    const signal = await fastPipeline.runPipeline(body);
    return signal || { signal: 'HOLD' };
  });

  console.log('[Routes] Psych routes registered');
}
