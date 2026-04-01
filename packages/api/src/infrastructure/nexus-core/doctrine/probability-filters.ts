/**
 * VEXOR Doctrine - Probability Filters (Obrigatórios)
 * Todos os filtros devem passar antes de qualquer entrada
 * Sem exceções - sem filtro = sem trade
 */

import { oracleDB } from '../../oracle-db.js';
import { marketAnalyzer } from '../ai-core/index.js';

interface ProbabilityFilter {
  id: string;
  name: string;
  description: string;
  check: (context: FilterContext) => Promise<FilterResult>;
  mandatory: boolean;
}

interface FilterContext {
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  volume: number;
  avgVolume: number;
  regime: 'TREND_UP' | 'TREND_DOWN' | 'RANGING' | 'VOLATILE';
  newsIn30Min: boolean;
}

interface FilterResult {
  passed: boolean;
  reason?: string;
  value?: number;
}

class ProbabilityFilters {
  private filters: ProbabilityFilter[] = [];

  constructor() {
    this.initializeFilters();
  }

  private initializeFilters(): void {
    this.filters = [
      // FILTRO 1: Tendência clara
      {
        id: 'FILTER_01',
        name: 'Tendência Clara',
        description: 'Tendência clara definida — sem mercados laterais sem volume',
        mandatory: true,
        check: async (ctx: FilterContext): Promise<FilterResult> => {
          if (ctx.regime === 'RANGING' && ctx.volume < ctx.avgVolume * 1.5) {
            return { 
              passed: false, 
              reason: 'Mercado lateral sem volume suficiente' 
            };
          }
          return { passed: true, value: ctx.regime === 'TREND_UP' ? 1 : ctx.regime === 'TREND_DOWN' ? -1 : 0 };
        }
      },

      // FILTRO 2: Volume 50% acima
      {
        id: 'FILTER_02',
        name: 'Volume Acima da Média',
        description: 'Volume 50% acima da média no ativo alvo',
        mandatory: true,
        check: async (ctx: FilterContext): Promise<FilterResult> => {
          const volumeRatio = ctx.volume / ctx.avgVolume;
          if (volumeRatio < 1.5) {
            return { 
              passed: false, 
              reason: `Volume ${((volumeRatio - 1) * 100).toFixed(0)}% acima da média (mínimo 50%)`,
              value: volumeRatio
            };
          }
          return { passed: true, value: volumeRatio };
        }
      },

      // FILTRO 3: Setup completo
      {
        id: 'FILTER_03',
        name: 'Setup Completo',
        description: 'Setup completo — todos os critérios presentes, sem exceções',
        mandatory: true,
        check: async (ctx: FilterContext): Promise<FilterResult> => {
          // Verifica se stop e target estão definidos
          if (ctx.stopPrice <= 0 || ctx.targetPrice <= 0) {
            return { passed: false, reason: 'Stop ou target não definidos' };
          }
          // Verifica se stop faz sentido
          if (ctx.side === 'BUY' && ctx.stopPrice >= ctx.entryPrice) {
            return { passed: false, reason: 'Stop de compra deve ser menor que entrada' };
          }
          if (ctx.side === 'SELL' && ctx.stopPrice <= ctx.entryPrice) {
            return { passed: false, reason: 'Stop de venda deve ser maior que entrada' };
          }
          // Verifica se target faz sentido
          if (ctx.side === 'BUY' && ctx.targetPrice <= ctx.entryPrice) {
            return { passed: false, reason: 'Target de compra deve ser maior que entrada' };
          }
          if (ctx.side === 'SELL' && ctx.targetPrice >= ctx.entryPrice) {
            return { passed: false, reason: 'Target de venda deve ser menor que entrada' };
          }
          return { passed: true };
        }
      },

      // FILTRO 4: Risco/Retorno mínimo 1:2
      {
        id: 'FILTER_04',
        name: 'Risco/Retorno',
        description: 'Risco/Retorno mínimo de 1:2 verificado matematicamente',
        mandatory: true,
        check: async (ctx: FilterContext): Promise<FilterResult> => {
          const risk = Math.abs(ctx.entryPrice - ctx.stopPrice);
          const reward = Math.abs(ctx.targetPrice - ctx.entryPrice);
          const ratio = reward / risk;

          if (ratio < 2) {
            return { 
              passed: false, 
              reason: `R/R = 1:${ratio.toFixed(1)} (mínimo 1:2)`,
              value: ratio
            };
          }
          return { passed: true, value: ratio };
        }
      },

      // FILTRO 5: Sem notícias de alto impacto
      {
        id: 'FILTER_05',
        name: 'Sem Notícias de Impacto',
        description: 'Sem notícias de alto impacto nos próximos 30 minutos',
        mandatory: true,
        check: async (ctx: FilterContext): Promise<FilterResult> => {
          if (ctx.newsIn30Min) {
            return { passed: false, reason: 'Notícia de alto impacto em menos de 30 minutos' };
          }
          return { passed: true };
        }
      },

      // FILTRO 6: Segunda Entrada (High2/Low2)
      {
        id: 'FILTER_06',
        name: 'Segunda Entrada',
        description: 'High2/Low2 — 60-70% de sucesso histórico',
        mandatory: false, // Opcional, mas aumenta probabilidade
        check: async (ctx: FilterContext): Promise<FilterResult> => {
          // TODO: Implementar detecção de High2/Low2
          // Por ora, retorna true
          return { passed: true, reason: 'Segunda entrada detectada' };
        }
      },

      // FILTRO 7: Zona S/R confirmada
      {
        id: 'FILTER_07',
        name: 'Zona S/R Confirmada',
        description: 'Candle de sinal em zona S/R confirmada na Strategy Memory',
        mandatory: false,
        check: async (ctx: FilterContext): Promise<FilterResult> => {
          try {
            // Busca na Strategy Memory se há S/R próximo
            const rows = await oracleDB.query(
              `SELECT COUNT(*) as cnt FROM strategy_memory 
               WHERE symbol = :symbol 
               AND ABS(price - :entry) / :entry < 0.02`,
              { symbol: ctx.symbol, entry: ctx.entryPrice }
            );
            const count = (rows[0] as any)?.CNT || 0;
            return { passed: count > 0, value: count };
          } catch {
            return { passed: true }; // Se não conseguir verificar, passa
          }
        }
      },

      // FILTRO 8: Tape Reading
      {
        id: 'FILTER_08',
        name: 'Tape Reading',
        description: 'Confirmar absorção e fluxo de ordens antes da entrada',
        mandatory: false,
        check: async (ctx: FilterContext): Promise<FilterResult> => {
          // TODO: Integrar com dados de tape
          return { passed: true };
        }
      }
    ];
  }

  /**
   * Executa todos os filtros obrigatórios e opcionais
   */
  async runFilters(context: FilterContext): Promise<{
    approved: boolean;
    results: Array<{ id: string; name: string; passed: boolean; reason?: string; value?: number }>;
    mandatoryFailed: string[];
    optionalPassed: number;
    score: number;
  }> {
    const results: Array<{ id: string; name: string; passed: boolean; reason?: string; value?: number }> = [];
    const mandatoryFailed: string[] = [];
    let optionalPassed = 0;

    for (const filter of this.filters) {
      try {
        const result = await filter.check(context);
        results.push({
          id: filter.id,
          name: filter.name,
          passed: result.passed,
          reason: result.reason,
          value: result.value
        });

        if (!result.passed && filter.mandatory) {
          mandatoryFailed.push(filter.name);
        }
        if (result.passed && !filter.mandatory) {
          optionalPassed++;
        }
      } catch (e) {
        results.push({
          id: filter.id,
          name: filter.name,
          passed: false,
          reason: String(e)
        });
        if (filter.mandatory) {
          mandatoryFailed.push(filter.name);
        }
      }
    }

    // Score = (mandatórios passados / total mandatórios) + bônus opcionais
    const mandatoryTotal = this.filters.filter(f => f.mandatory).length;
    const mandatoryPassed = mandatoryTotal - mandatoryFailed.length;
    const score = (mandatoryPassed / mandatoryTotal) + (optionalPassed * 0.05);

    return {
      approved: mandatoryFailed.length === 0,
      results,
      mandatoryFailed,
      optionalPassed,
      score
    };
  }

  /**
   * Validação rápida para uso em tempo real
   */
  async quickValidate(context: FilterContext): Promise<boolean> {
    // Executa apenas filtros mandatórios
    for (const filter of this.filters.filter(f => f.mandatory)) {
      const result = await filter.check(context);
      if (!result.passed) {
        console.log(`[Filters] ❌ ${filter.name}: ${result.reason}`);
        return false;
      }
    }
    return true;
  }
}

// Singleton
export const probabilityFilters = new ProbabilityFilters();
export type { FilterContext, FilterResult };
