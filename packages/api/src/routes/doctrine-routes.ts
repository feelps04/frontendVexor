/**
 * VEXOR Doctrine Routes
 * APIs para sistema de doutrina de trading
 */

import { FastifyInstance } from 'fastify';
import { preOpeningChecklist } from '../infrastructure/nexus-core/doctrine/pre-opening.js';
import { probabilityFilters } from '../infrastructure/nexus-core/doctrine/probability-filters.js';
import { quantitativeAudit } from '../infrastructure/nexus-core/doctrine/quantitative-audit.js';
import { tiltDetector } from '../infrastructure/nexus-core/doctrine/tilt-detector.js';
import { strategyFactory } from '../infrastructure/nexus-core/doctrine/strategy-factory.js';
import { barbellStrategy } from '../infrastructure/nexus-core/doctrine/barbell-strategy.js';

export async function doctrineRoutes(app: FastifyInstance) {
  // ==================== PRE-OPENING ====================

  // Executar briefing
  app.post('/api/v1/doctrine/briefing', async (request, reply) => {
    const result = await preOpeningChecklist.executeBriefing();
    return result;
  });

  // Status do briefing
  app.get('/api/v1/doctrine/briefing', async (request, reply) => {
    const briefing = preOpeningChecklist.getLastBriefing();
    return briefing || { error: 'Nenhum briefing executado' };
  });

  // ==================== FILTERS ====================

  // Validar trade
  app.post('/api/v1/doctrine/filters/validate', async (request, reply) => {
    const body = request.body as {
      symbol: string;
      side: 'BUY' | 'SELL';
      entryPrice: number;
      stopPrice: number;
      targetPrice: number;
      volume: number;
      avgVolume: number;
    };

    const result = await probabilityFilters.runFilters({
      ...body,
      regime: 'TREND_UP', // TODO: do market analyzer
      newsIn30Min: false
    });

    return result;
  });

  // ==================== AUDIT ====================

  // Auditoria diária
  app.post('/api/v1/doctrine/audit/daily', async (request, reply) => {
    const result = await quantitativeAudit.executeDailyAudit();
    return result;
  });

  // Métricas recentes
  app.get('/api/v1/doctrine/audit/metrics', async (request, reply) => {
    const query = request.query as { days?: number };
    const metrics = await quantitativeAudit.getRecentMetrics(query.days || 7);
    return { metrics };
  });

  // ==================== TILT ====================

  // Detectar tilt
  app.post('/api/v1/doctrine/tilt/detect', async (request, reply) => {
    const state = await tiltDetector.detectTilt();
    return state;
  });

  // Estado atual
  app.get('/api/v1/doctrine/tilt', async (request, reply) => {
    const state = tiltDetector.getCurrentState();
    return state || { level: 0, safe: true };
  });

  // ==================== STRATEGY ====================

  // Evoluir estratégias
  app.post('/api/v1/doctrine/strategy/evolve', async (request, reply) => {
    const strategies = await strategyFactory.evolve();
    return { 
      count: strategies.length,
      active: strategies.filter(s => s.status === 'LIVE').length,
      paper: strategies.filter(s => s.status === 'PAPER').length
    };
  });

  // Estratégias ativas
  app.get('/api/v1/doctrine/strategy/active', async (request, reply) => {
    const strategies = strategyFactory.getActiveStrategies();
    return { strategies, count: strategies.length };
  });

  // Melhor estratégia
  app.get('/api/v1/doctrine/strategy/best', async (request, reply) => {
    const best = strategyFactory.getBestStrategy();
    return best || { error: 'Nenhuma estratégia ativa' };
  });

  // ==================== BARBELL ====================

  // Alocação atual
  app.get('/api/v1/doctrine/barbell', async (request, reply) => {
    const allocation = await barbellStrategy.determineAllocation();
    return allocation;
  });

  // Classificar trade
  app.post('/api/v1/doctrine/barbell/classify', async (request, reply) => {
    const body = request.body as {
      strategy: string;
      riskReward: number;
      winProbability: number;
      maxLoss: number;
      unlimitedUpside: boolean;
    };

    const classification = barbellStrategy.classifyTrade(body);
    return { classification };
  });

  console.log('[Routes] Doctrine routes registered');
}
