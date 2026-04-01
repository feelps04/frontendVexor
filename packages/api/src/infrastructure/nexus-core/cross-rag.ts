/**
 * VEXOR RAG Cruzado - 3 Bases Separadas, 1 Raciocínio Unificado
 * 
 * RAG 1 - Erros: O que deu errado e por quê
 * RAG 2 - Cenários: Em qual contexto estava
 * RAG 3 - Estratégias: O que fazer agora
 * 
 * Cruzamento dos 3 contextos para decisão fundamentada
 */

import { oracleDB } from '../oracle-db.js';

// ==================== TYPES ====================

interface AgentVote {
  agent: string;
  vote: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
}

interface ErrorRecord {
  trade_id: string;
  timestamp: Date;
  symbol: string;
  strategy: string;
  error_type: 'WRONG_DIRECTION' | 'BAD_TIMING' | 'IGNORED_MACRO' | 
              'TILT_TRADE' | 'OVERFIT_CONTEXT' | 'LOW_VOLUME';
  context: {
    ema9: number;
    ema21: number;
    rsi14: number;
    atr14: number;
    hour_utc: number;
    regime: string;
    macro_state: string;
    symbol_type: 'B3_FUTURO' | 'CRIPTO' | 'FOREX';
    agent_votes: AgentVote[];
  };
  loss_atr: number;
  lesson: string;
}

interface ScenarioRecord {
  scenario_id: string;
  date: Date;
  name: string;
  macro: {
    sp500_trend: string;
    vix_level: number;
    usdbrl: number;
    selic: number;
    regime: string;
  };
  market_behavior: {
    ibov_direction: string;
    petr4_behavior: string;
    wdo_behavior: string;
    cripto_behavior: string;
  };
  what_worked: string[];
  what_failed: string[];
  duration_days: number;
  outcome: string;
}

interface StrategyRecord {
  strategy_id: string;
  name: string;
  conditions: {
    regime: string;
    hour_range: string;
    rsi_range: string;
    atr_relative: 'HIGH' | 'LOW';
    macro: 'RISK_ON' | 'RISK_OFF' | 'NEUTRAL';
    symbol_type: 'B3_FUTURO' | 'CRIPTO' | 'FOREX';
  };
  performance: {
    win_rate: number;
    profit_factor: number;
    avg_win_atr: number;
    avg_loss_atr: number;
    sample_size: number;
  };
  last_validated: Date;
  trend: 'IMPROVING' | 'STABLE' | 'DEGRADING';
}

interface RAGInsight {
  decision: 'EXECUTAR' | 'AGUARDAR' | 'BLOQUEAR';
  confidence: number;
  reason: string;
  errors_matched: ErrorRecord[];
  scenarios_matched: ScenarioRecord[];
  strategies_matched: StrategyRecord[];
  raw_response: string;
}

interface CurrentContext {
  symbol: string;
  symbol_type: 'B3_FUTURO' | 'CRIPTO' | 'FOREX';
  ema9: number;
  ema21: number;
  rsi14: number;
  atr14: number;
  hour_utc: number;
  regime: string;
  macro_state: string;
  agent_votes: AgentVote[];
}

interface MacroState {
  sp500_trend: string;
  sp500_change_pct: number;
  vix: number;
  usdbrl: number;
  usdbrl_trend: string;
  selic: number;
  regime: string;
}

interface Signal {
  direction: 'BUY' | 'SELL';
  symbol: string;
  strategy: string;
}

// ==================== CROSS RAG SERVICE ====================

class CrossRAGService {
  private ollamaHost = process.env.OLLAMA_HOST || 'localhost';
  private ollamaPort = process.env.OLLAMA_PORT || '11434';
  private ollamaModel = process.env.OLLAMA_MODEL || 'llama3.2:latest';
  
  // Cache para queries frequentes
  private errorCache: Map<string, ErrorRecord[]> = new Map();
  private scenarioCache: Map<string, ScenarioRecord[]> = new Map();
  private strategyCache: Map<string, StrategyRecord[]> = new Map();

  /**
   * RAG Cruzado Principal - 3 RAGs em paralelo
   */
  async crossRAGReasoning(
    currentContext: CurrentContext,
    macroState: MacroState,
    signal: Signal
  ): Promise<RAGInsight> {
    const startTime = Date.now();
    
    // 3 RAGs em paralelo — não sequencial
    const [errors, scenarios, strategies] = await Promise.all([
      this.queryErrorRAG(currentContext),
      this.queryScenarioRAG(macroState),
      this.queryStrategyRAG(currentContext)
    ]);

    console.log(`[CrossRAG] 🔍 RAGs consultados em ${Date.now() - startTime}ms`);
    console.log(`[CrossRAG] 📊 Erros: ${errors.length} | Cenários: ${scenarios.length} | Estratégias: ${strategies.length}`);

    // Monta o prompt cruzado para o LLM
    const crossPrompt = this.buildCrossPrompt(currentContext, macroState, signal, errors, scenarios, strategies);

    // LLM raciocina com os 3 contextos cruzados
    const response = await this.callOllama(crossPrompt);

    return this.parseDecision(response, errors, scenarios, strategies);
  }

  /**
   * RAG 1 — Base de Erros
   * Busca erros similares ao contexto atual
   */
  async queryErrorRAG(currentContext: CurrentContext): Promise<ErrorRecord[]> {
    const cacheKey = `${currentContext.symbol}:${currentContext.hour_utc}:${currentContext.regime}`;
    
    // Verifica cache
    const cached = this.errorCache.get(cacheKey);
    if (cached) {
      console.log('[ErrorRAG] Cache hit');
      return cached;
    }

    try {
      // Query simplificada - busca por contexto similar
      const query = `trade em ${currentContext.symbol} às ${currentContext.hour_utc}h UTC com RSI ${currentContext.rsi14} e regime ${currentContext.regime}`;
      
      // Busca no Oracle NoSQL ou arquivo local
      const errors = await this.queryLocalErrors(currentContext);
      
      // Salva no cache
      this.errorCache.set(cacheKey, errors);
      
      return errors;
    } catch (e) {
      console.error('[ErrorRAG] Erro:', e);
      return [];
    }
  }

  /**
   * Busca erros em arquivo local (fallback)
   */
  private async queryLocalErrors(context: CurrentContext): Promise<ErrorRecord[]> {
    try {
      const fs = await import('fs');
      const path = `C:\\Users\\opc\\CascadeProjects\\vexor-Oracle\\vexor-Oracle-main\\packages\\learning_data\\error_rag.json`;
      
      if (!fs.existsSync(path)) {
        return [];
      }
      
      const data = JSON.parse(fs.readFileSync(path, 'utf-8')) as ErrorRecord[];
      
      // Filtra por similaridade de contexto
      return data
        .filter(e => 
          e.context.hour_utc === context.hour_utc ||
          e.context.regime === context.regime
        )
        .slice(0, 5);
    } catch {
      return [];
    }
  }

  /**
   * RAG 2 — Base de Cenários
   * Detecta qual cenário atual mais se parece com o histórico
   */
  async queryScenarioRAG(macroState: MacroState): Promise<ScenarioRecord[]> {
    const cacheKey = `${macroState.usdbrl_trend}:${macroState.vix}:${macroState.regime}`;
    
    const cached = this.scenarioCache.get(cacheKey);
    if (cached) {
      console.log('[ScenarioRAG] Cache hit');
      return cached;
    }

    try {
      const scenarios = await this.queryLocalScenarios(macroState);
      this.scenarioCache.set(cacheKey, scenarios);
      return scenarios;
    } catch (e) {
      console.error('[ScenarioRAG] Erro:', e);
      return [];
    }
  }

  /**
   * Busca cenários em arquivo local
   */
  private async queryLocalScenarios(macro: MacroState): Promise<ScenarioRecord[]> {
    try {
      const fs = await import('fs');
      const path = `C:\\Users\\opc\\CascadeProjects\\vexor-Oracle\\vexor-Oracle-main\\packages\\learning_data\\scenario_rag.json`;
      
      if (!fs.existsSync(path)) {
        return [];
      }
      
      const data = JSON.parse(fs.readFileSync(path, 'utf-8')) as ScenarioRecord[];
      
      // Filtra por similaridade de macro
      return data
        .filter(s => 
          Math.abs(s.macro.vix_level - macro.vix) < 5 ||
          s.macro.regime === macro.regime
        )
        .slice(0, 3);
    } catch {
      return [];
    }
  }

  /**
   * RAG 3 — Base de Estratégias
   * Busca qual estratégia tem melhor histórico para o contexto atual
   */
  async queryStrategyRAG(context: CurrentContext): Promise<StrategyRecord[]> {
    const cacheKey = `${context.symbol_type}:${context.regime}:${context.hour_utc}`;
    
    const cached = this.strategyCache.get(cacheKey);
    if (cached) {
      console.log('[StrategyRAG] Cache hit');
      return cached;
    }

    try {
      const strategies = await this.queryLocalStrategies(context);
      this.strategyCache.set(cacheKey, strategies);
      return strategies;
    } catch (e) {
      console.error('[StrategyRAG] Erro:', e);
      return [];
    }
  }

  /**
   * Busca estratégias em arquivo local
   */
  private async queryLocalStrategies(context: CurrentContext): Promise<StrategyRecord[]> {
    try {
      const fs = await import('fs');
      const path = `C:\\Users\\opc\\CascadeProjects\\vexor-Oracle\\vexor-Oracle-main\\packages\\learning_data\\strategy_rag.json`;
      
      if (!fs.existsSync(path)) {
        return [];
      }
      
      const data = JSON.parse(fs.readFileSync(path, 'utf-8')) as StrategyRecord[];
      
      // Filtra por contexto e sample_size >= 30
      return data
        .filter(s => 
          s.conditions.symbol_type === context.symbol_type &&
          s.conditions.regime === context.regime &&
          s.performance.sample_size >= 30
        )
        .sort((a, b) => b.performance.win_rate - a.performance.win_rate)
        .slice(0, 3);
    } catch {
      return [];
    }
  }

  /**
   * Monta prompt cruzado
   */
  private buildCrossPrompt(
    context: CurrentContext,
    macro: MacroState,
    signal: Signal,
    errors: ErrorRecord[],
    scenarios: ScenarioRecord[],
    strategies: StrategyRecord[]
  ): string {
    return `
=== SITUAÇÃO ATUAL ===
Sinal: ${signal.direction} em ${signal.symbol}
Contexto: EMA9=${context.ema9.toFixed(2)} EMA21=${context.ema21.toFixed(2)} RSI=${context.rsi14.toFixed(1)} ATR=${context.atr14.toFixed(2)}
Hora: ${context.hour_utc}h UTC | Regime: ${context.regime} | Macro: ${context.macro_state}
Macro: S&P ${macro.sp500_change_pct}% | VIX ${macro.vix} | USD/BRL ${macro.usdbrl} | SELIC ${macro.selic}%

=== RAG ERROS — O que deu errado em situações similares ===
${errors.length > 0 
  ? errors.map(e => `• ${e.error_type}: ${e.lesson} (loss: ${e.loss_atr} ATR)`).join('\n')
  : '• Nenhum erro histórico similar encontrado'
}

=== RAG CENÁRIOS — Cenários históricos parecidos ===
${scenarios.length > 0
  ? scenarios.map(s => `• ${s.name}: funcionou=[${s.what_worked.join(',')}] falhou=[${s.what_failed.join(',')}]`).join('\n')
  : '• Nenhum cenário histórico similar encontrado'
}

=== RAG ESTRATÉGIAS — O que funcionou nesse contexto ===
${strategies.length > 0
  ? strategies.map(s => `• ${s.name}: WR=${s.performance.win_rate}% PF=${s.performance.profit_factor} (n=${s.performance.sample_size})`).join('\n')
  : '• Nenhuma estratégia validada para esse contexto'
}

=== PERGUNTA ===
Cruzando os 3 contextos acima:
1. Esse sinal repete algum erro histórico conhecido?
2. O cenário atual favorece ou contraria esse tipo de entrada?
3. A estratégia sugerida tem histórico positivo nessas condições?
4. Decisão final: EXECUTAR / AGUARDAR / BLOQUEAR — com justificativa em 1 frase.

Responda no formato:
DECISAO: [EXECUTAR/AGUARDAR/BLOQUEAR]
CONFIANCA: [0-100]
JUSTIFICATIVA: [1 frase]
`;
  }

  /**
   * Chama Ollama local
   */
  private async callOllama(prompt: string): Promise<string> {
    try {
      const response = await fetch(`http://${this.ollamaHost}:${this.ollamaPort}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.ollamaModel,
          messages: [
            { role: 'system', content: 'Você é o VEXOR, sistema de trading com RAG cruzado. Responda de forma objetiva e direta.' },
            { role: 'user', content: prompt }
          ],
          stream: false,
          options: {
            temperature: 0.1,
            num_predict: 200
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama error: ${response.status}`);
      }

      const data = await response.json() as { message?: { content: string } };
      return data.message?.content || 'Sem resposta';
    } catch (e) {
      console.error('[CrossRAG] Ollama error:', e);
      return 'Ollama não disponível - usando heurística simples';
    }
  }

  /**
   * Parse da decisão do LLM
   */
  private parseDecision(
    response: string,
    errors: ErrorRecord[],
    scenarios: ScenarioRecord[],
    strategies: StrategyRecord[]
  ): RAGInsight {
    // Parse da resposta
    const decisaoMatch = response.match(/DECISAO:\s*(EXECUTAR|AGUARDAR|BLOQUEAR)/i);
    const confiancaMatch = response.match(/CONFIANCA:\s*(\d+)/i);
    const justificativaMatch = response.match(/JUSTIFICATIVA:\s*(.+)/i);

    // Heurística de fallback se Ollama não responder
    let decision: 'EXECUTAR' | 'AGUARDAR' | 'BLOQUEAR' = 'EXECUTAR';
    let confidence = 50;
    let reason = 'Análise RAG cruzado';

    if (decisaoMatch) {
      decision = decisaoMatch[1].toUpperCase() as 'EXECUTAR' | 'AGUARDAR' | 'BLOQUEAR';
    } else {
      // Heurística: bloqueia se muitos erros similares
      if (errors.length >= 3) {
        decision = 'BLOQUEAR';
        reason = `${errors.length} erros históricos similares detectados`;
      } else if (strategies.length > 0 && strategies[0].performance.win_rate > 60) {
        decision = 'EXECUTAR';
        confidence = strategies[0].performance.win_rate;
        reason = `Estratégia ${strategies[0].name} com WR ${strategies[0].performance.win_rate}%`;
      }
    }

    if (confiancaMatch) {
      confidence = parseInt(confiancaMatch[1]);
    }

    if (justificativaMatch) {
      reason = justificativaMatch[1].trim();
    }

    return {
      decision,
      confidence,
      reason,
      errors_matched: errors,
      scenarios_matched: scenarios,
      strategies_matched: strategies,
      raw_response: response
    };
  }

  /**
   * Salva erro após trade com LOSS
   */
  async saveError(
    tradeId: string,
    symbol: string,
    strategy: string,
    context: CurrentContext,
    lossAtr: number,
    errorType: ErrorRecord['error_type']
  ): Promise<void> {
    try {
      // Gera lesson simples sem LLM (mais rápido)
      const lesson = `${errorType} detectado em ${symbol} às ${context.hour_utc}h UTC - evitar entrada similar`;
      
      const errorRecord: ErrorRecord = {
        trade_id: tradeId,
        timestamp: new Date(),
        symbol,
        strategy,
        error_type: errorType,
        context: {
          ema9: context.ema9,
          ema21: context.ema21,
          rsi14: context.rsi14,
          atr14: context.atr14,
          hour_utc: context.hour_utc,
          regime: context.regime,
          macro_state: context.macro_state,
          symbol_type: context.symbol_type,
          agent_votes: context.agent_votes
        },
        loss_atr: lossAtr,
        lesson
      };

      // Salva em arquivo local de forma síncrona
      this.saveErrorSync(errorRecord);
      
      console.log(`[CrossRAG] 💾 Erro salvo: ${errorType} em ${symbol} (loss: ${lossAtr} ATR)`);
    } catch (e) {
      console.error('[CrossRAG] Erro ao salvar:', e);
    }
  }

  /**
   * Salva erro de forma síncrona (mais rápido para replay)
   */
  private saveErrorSync(error: ErrorRecord): void {
    try {
      const fs = require('fs');
      const path = `C:\\Users\\opc\\CascadeProjects\\vexor-Oracle\\vexor-Oracle-main\\packages\\learning_data\\error_rag.json`;
      
      let data: ErrorRecord[] = [];
      
      if (fs.existsSync(path)) {
        try {
          data = JSON.parse(fs.readFileSync(path, 'utf-8'));
        } catch {
          data = [];
        }
      }
      
      data.push(error);
      
      // Mantém últimos 1000 erros
      if (data.length > 1000) {
        data = data.slice(-1000);
      }
      
      fs.writeFileSync(path, JSON.stringify(data, null, 2));
    } catch (e) {
      // Ignora erros de escrita
    }
  }

  /**
   * Gera lesson automática via LLM
   */
  private async generateLesson(
    errorType: ErrorRecord['error_type'],
    context: CurrentContext,
    lossAtr: number
  ): Promise<string> {
    const prompt = `Gere uma lição curta (max 50 palavras) para um trade com erro ${errorType} em ${context.symbol} às ${context.hour_utc}h UTC. RSI era ${context.rsi14}, regime ${context.regime}. Loss: ${lossAtr} ATR.`;
    
    try {
      const response = await this.callOllama(prompt);
      return response.substring(0, 200);
    } catch {
      return `${errorType} detectado em ${context.symbol} - evitar entrada similar`;
    }
  }

  /**
   * Salva erro em arquivo local
   */
  private async saveErrorToFile(error: ErrorRecord): Promise<void> {
    const fs = await import('fs');
    const path = `C:\\Users\\opc\\CascadeProjects\\vexor-Oracle\\vexor-Oracle-main\\packages\\learning_data\\error_rag.json`;
    
    let data: ErrorRecord[] = [];
    
    if (fs.existsSync(path)) {
      try {
        data = JSON.parse(fs.readFileSync(path, 'utf-8'));
      } catch {
        data = [];
      }
    }
    
    data.push(error);
    
    // Mantém últimos 1000 erros
    if (data.length > 1000) {
      data = data.slice(-1000);
    }
    
    fs.writeFileSync(path, JSON.stringify(data, null, 2));
  }

  /**
   * Salva cenário quando regime muda
   */
  async saveScenario(
    name: string,
    macro: ScenarioRecord['macro'],
    marketBehavior: ScenarioRecord['market_behavior'],
    whatWorked: string[],
    whatFailed: string[]
  ): Promise<void> {
    try {
      const scenario: ScenarioRecord = {
        scenario_id: `scenario_${Date.now()}`,
        date: new Date(),
        name,
        macro,
        market_behavior: marketBehavior,
        what_worked: whatWorked,
        what_failed: whatFailed,
        duration_days: 0,
        outcome: 'Em andamento'
      };

      const fs = await import('fs');
      const path = `C:\\Users\\opc\\CascadeProjects\\vexor-Oracle\\vexor-Oracle-main\\packages\\learning_data\\scenario_rag.json`;
      
      let data: ScenarioRecord[] = [];
      
      if (fs.existsSync(path)) {
        try {
          data = JSON.parse(fs.readFileSync(path, 'utf-8'));
        } catch {
          data = [];
        }
      }
      
      data.push(scenario);
      
      // Mantém últimos 100 cenários
      if (data.length > 100) {
        data = data.slice(-100);
      }
      
      fs.writeFileSync(path, JSON.stringify(data, null, 2));
      
      console.log(`[CrossRAG] 📸 Cenário salvo: ${name}`);
    } catch (e) {
      console.error('[CrossRAG] Erro ao salvar cenário:', e);
    }
  }

  /**
   * Atualiza estratégia após trade
   */
  async updateStrategy(
    name: string,
    conditions: StrategyRecord['conditions'],
    won: boolean,
    profitAtr: number
  ): Promise<void> {
    try {
      const fs = await import('fs');
      const path = `C:\\Users\\opc\\CascadeProjects\\vexor-Oracle\\vexor-Oracle-main\\packages\\learning_data\\strategy_rag.json`;
      
      let data: StrategyRecord[] = [];
      
      if (fs.existsSync(path)) {
        try {
          data = JSON.parse(fs.readFileSync(path, 'utf-8'));
        } catch {
          data = [];
        }
      }
      
      // Busca estratégia existente
      let strategy = data.find(s => 
        s.name === name && 
        JSON.stringify(s.conditions) === JSON.stringify(conditions)
      );
      
      if (strategy) {
        // Atualiza estatísticas
        strategy.performance.sample_size++;
        if (won) {
          strategy.performance.win_rate = 
            (strategy.performance.win_rate * (strategy.performance.sample_size - 1) + 100) / 
            strategy.performance.sample_size;
          strategy.performance.avg_win_atr = 
            (strategy.performance.avg_win_atr * (strategy.performance.sample_size - 1) + profitAtr) / 
            strategy.performance.sample_size;
        } else {
          strategy.performance.win_rate = 
            (strategy.performance.win_rate * (strategy.performance.sample_size - 1)) / 
            strategy.performance.sample_size;
          strategy.performance.avg_loss_atr = 
            (strategy.performance.avg_loss_atr * (strategy.performance.sample_size - 1) + profitAtr) / 
            strategy.performance.sample_size;
        }
        strategy.last_validated = new Date();
        
        // Calcula trend
        if (strategy.performance.win_rate > 55) {
          strategy.trend = 'IMPROVING';
        } else if (strategy.performance.win_rate < 45) {
          strategy.trend = 'DEGRADING';
        } else {
          strategy.trend = 'STABLE';
        }
      } else {
        // Cria nova estratégia
        strategy = {
          strategy_id: `strategy_${Date.now()}`,
          name,
          conditions,
          performance: {
            win_rate: won ? 100 : 0,
            profit_factor: won ? profitAtr : 0,
            avg_win_atr: won ? profitAtr : 0,
            avg_loss_atr: won ? 0 : profitAtr,
            sample_size: 1
          },
          last_validated: new Date(),
          trend: 'STABLE'
        };
        data.push(strategy);
      }
      
      // Mantém últimas 200 estratégias
      if (data.length > 200) {
        data = data.slice(-200);
      }
      
      fs.writeFileSync(path, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('[CrossRAG] Erro ao atualizar estratégia:', e);
    }
  }

  /**
   * Limpa caches
   */
  clearCaches(): void {
    this.errorCache.clear();
    this.scenarioCache.clear();
    this.strategyCache.clear();
    console.log('[CrossRAG] Caches limpos');
  }

  /**
   * Estatísticas
   */
  getStats(): {
    errorCacheSize: number;
    scenarioCacheSize: number;
    strategyCacheSize: number;
  } {
    return {
      errorCacheSize: this.errorCache.size,
      scenarioCacheSize: this.scenarioCache.size,
      strategyCacheSize: this.strategyCache.size
    };
  }
}

// ==================== SINGLETON ====================

export const crossRAGService = new CrossRAGService();
export type { 
  ErrorRecord, 
  ScenarioRecord, 
  StrategyRecord, 
  RAGInsight, 
  CurrentContext, 
  MacroState, 
  Signal,
  AgentVote
};
