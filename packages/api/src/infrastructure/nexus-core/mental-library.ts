/**
 * VEXOR Mental Library
 * Base Intelectual dos Agentes
 * Douglas, Taleb, Kahneman, Tendler, Aurelius, Steenbarger
 */

import { oracleDB } from '../oracle-db.js';
import { telegramNotifier } from '../telegram-notifier.js';

// ==================== MARK DOUGLAS ====================

interface StatisticalIndependence {
  tradeId: string;
  previousOutcome: number;
  currentBias: 'NONE' | 'REVENGE' | 'OVERCONFIDENCE' | 'FEAR';
  intervention: string;
}

class DouglasPrinciples {
  /**
   * Verifica independência estatística
   * Cada trade é independente do anterior
   * O mercado não tem memória
   */
  async checkIndependence(previousTrades: number[]): Promise<StatisticalIndependence> {
    const lastThree = previousTrades.slice(-3);
    const allLosses = lastThree.every(o => o === 0);
    const allWins = lastThree.every(o => o === 1);

    let bias: 'NONE' | 'REVENGE' | 'OVERCONFIDENCE' | 'FEAR' = 'NONE';
    let intervention = '';

    // Revenge trading: perdas consecutivas criam desejo de recuperar
    if (allLosses && lastThree.length >= 3) {
      bias = 'REVENGE';
      intervention = 'SEQUÊNCIA DE PERDAS: O mercado NÃO deve nada. Próximo trade é independente.';
    }

    // Overconfidence: ganhos consecutivos criam falsa segurança
    if (allWins && lastThree.length >= 3) {
      bias = 'OVERCONFIDENCE';
      intervention = 'SEQUÊNCIA DE GANHOS: Não aumentar risco. Cada trade é um novo evento.';
    }

    // Fear: após grande perda
    const lastTrade = lastThree[lastThree.length - 1];
    if (lastTrade === 0 && previousTrades.length > 0) {
      bias = 'FEAR';
      intervention = 'PERDA RECENTE: Não reduzir tamanho indevidamente. Processo é o que importa.';
    }

    return {
      tradeId: oracleDB.generateId(),
      previousOutcome: lastTrade || 0,
      currentBias: bias,
      intervention
    };
  }

  /**
   * Aplica princípio: "Isso também passa"
   */
  applyImpermanence(): string {
    return 'TODA sequência de resultados é temporária. Foco no processo.';
  }
}

// ==================== NASSIM TALEB ====================

interface AntifragileState {
  volatilityExposure: number;
  barbellRatio: { conservative: number; asymmetric: number };
  blackSwanProtection: boolean;
  tailRisk: number;
}

class TalebPrinciples {
  /**
   * Verifica se sistema é antifrágil
   * Se beneficia da volatilidade
   */
  checkAntifragility(volatility: number, pnl: number): AntifragileState {
    // Sistema antifrágil: ganha com volatilidade
    const benefitsFromVolatility = volatility > 0.02 && pnl > 0;

    return {
      volatilityExposure: volatility,
      barbellRatio: { conservative: 0.90, asymmetric: 0.10 },
      blackSwanProtection: true,
      tailRisk: volatility * 2.33 // 99th percentile
    };
  }

  /**
   * Verifica skin in the game
   */
  verifySkinInTheGame(capitalAtRisk: number, totalCapital: number): boolean {
    // Sempre ter capital em risco real
    return capitalAtRisk > 0 && capitalAtRisk <= totalCapital * 0.10;
  }

  /**
   * Aplica: "Nunca arriscar o que não pode perder"
   */
  calculateMaxAcceptableLoss(capital: number, ruinThreshold: number = 0.20): number {
    // Perda máxima que não causa ruína
    return capital * ruinThreshold;
  }

  /**
   * Aplica: "Aceitar consequências sem culpar o mercado"
   */
  applyRadicalResponsibility(): string {
    return 'O mercado é um sistema complexo. Aceitar resultados sem atribuir culpa externa.';
  }
}

// ==================== DANIEL KAHNEMAN ====================

interface SystemCheck {
  system: 'SYSTEM_1' | 'SYSTEM_2';
  decisionType: 'IMPULSIVE' | 'ANALYTICAL';
  biases: string[];
  intervention: string;
}

class KahnemanPrinciples {
  private readonly BIASES = {
    CONFIRMATION: 'Viés de confirmação - buscando apenas informações que confirmam tese',
    LOSS_AVERSION: 'Aversão à perda - medo desproporcional de perder vs ganhar',
    ANCHORING: 'Ancoragem - fixação em preço ou valor inicial',
    AVAILABILITY: 'Disponibilidade - peso excessivo em eventos recentes',
    RECENCY: 'Recência - dar mais importância ao último evento',
    REPRESENTATIVENESS: 'Representatividade - generalizar de amostra pequena'
  };

  /**
   * Verifica se decisão é Sistema 2 (analítica)
   * Elimina decisões impulsivas (Sistema 1)
   */
  checkDecisionSystem(params: {
    timeToDecision: number; // segundos
    analysisSteps: number;
    dataPoints: number;
    emotionalState: number; // 0-1
  }): SystemCheck {
    const biases: string[] = [];

    // Decisão muito rápida = Sistema 1
    const isImpulsive = params.timeToDecision < 10 || params.analysisSteps < 3;

    // Verifica vieses
    if (params.emotionalState > 0.7) {
      biases.push(this.BIASES.LOSS_AVERSION);
    }

    if (params.dataPoints < 5) {
      biases.push(this.BIASES.CONFIRMATION);
    }

    if (params.timeToDecision < 5) {
      biases.push(this.BIASES.RECENCY);
    }

    const system = isImpulsive ? 'SYSTEM_1' : 'SYSTEM_2';
    const decisionType = isImpulsive ? 'IMPULSIVE' : 'ANALYTICAL';

    let intervention = '';
    if (isImpulsive) {
      intervention = '🧠 PAUSA OBRIGATÓRIA: Decisão impulsiva detectada. Aguardar 30 segundos e reanalisar com Sistema 2.';
    } else if (biases.length > 0) {
      intervention = `⚠️ VIÉS DETECTADO: ${biases.join(', ')}. Revisar análise.`;
    }

    return {
      system,
      decisionType,
      biases,
      intervention
    };
  }

  /**
   * Detecta viés de confirmação
   */
  detectConfirmationBias(thesis: string, dataPoints: string[]): boolean {
    // Verifica se todos os dados confirmam a tese
    const allConfirm = dataPoints.every(d => d.includes(thesis));
    return allConfirm && dataPoints.length < 5;
  }

  /**
   * Detecta aversão à perda
   */
  detectLossAversion(potentialGain: number, potentialLoss: number, riskTolerance: number): boolean {
    // Aversão: recusa trade com R:R favorável por medo de perder
    const ratio = potentialGain / potentialLoss;
    return ratio >= 2 && riskTolerance < 0.5;
  }
}

// ==================== JARED TENDLER ====================

interface TiltLevel {
  level: 0 | 1 | 2 | 3 | 4;
  name: string;
  symptoms: string[];
  actions: string[];
  cooldownMinutes: number;
}

class TendlerPrinciples {
  private readonly TILT_LEVELS: TiltLevel[] = [
    {
      level: 0,
      name: 'Normal',
      symptoms: ['Estado emocional estável'],
      actions: ['Continuar operando normalmente'],
      cooldownMinutes: 0
    },
    {
      level: 1,
      name: 'Leve Irritação',
      symptoms: ['Impaciência', 'Frustração leve'],
      actions: ['Aumentar atenção', 'Respirar fundo'],
      cooldownMinutes: 0
    },
    {
      level: 2,
      name: 'Frustração',
      symptoms: ['Comentários negativos', 'Tensão muscular'],
      actions: ['Pausar 5 minutos', 'Revisar plano'],
      cooldownMinutes: 5
    },
    {
      level: 3,
      name: 'Raiva',
      symptoms: ['Desejo de recuperar perdas', 'Ignorar regras'],
      actions: ['Pausar 15 minutos', 'Reduzir posições 50%'],
      cooldownMinutes: 15
    },
    {
      level: 4,
      name: 'Tilt Total',
      symptoms: ['Perda de controle', 'Decisões irracionais'],
      actions: ['Parar operações', 'Encerrar dia'],
      cooldownMinutes: 60
    }
  ];

  /**
   * Detecta nível de tilt
   */
  detectTiltLevel(symptoms: string[]): TiltLevel {
    // Mapeia sintomas para níveis
    for (let i = this.TILT_LEVELS.length - 1; i >= 0; i--) {
      const level = this.TILT_LEVELS[i];
      const matchCount = symptoms.filter(s => 
        level.symptoms.some(ls => ls.toLowerCase().includes(s.toLowerCase()))
      ).length;

      if (matchCount > 0) {
        return level;
      }
    }

    return this.TILT_LEVELS[0];
  }

  /**
   * Aprende gatilhos do comportamento
   */
  async learnTriggers(userId: string, trigger: string, level: number): Promise<void> {
    try {
      await oracleDB.insert(`
        INSERT INTO tilt_triggers (id, user_id, trigger_col, tilt_level, timestamp)
        VALUES (:id, :userId, :trigger, :level, CURRENT_TIMESTAMP)
      `, { id: oracleDB.generateId(), userId, trigger, level });
    } catch {}
  }

  /**
   * Obtém gatilhos aprendidos
   */
  async getLearnedTriggers(userId: string): Promise<Array<{ trigger: string; level: number; frequency: number }>> {
    try {
      return await oracleDB.query(`
        SELECT trigger_col as trigger, tilt_level as level, COUNT(*) as frequency
        FROM tilt_triggers
        WHERE user_id = :userId
        GROUP BY trigger_col, tilt_level
        ORDER BY frequency DESC
      `, { userId });
    } catch {
      return [];
    }
  }
}

// ==================== MARCUS AURELIUS ====================

interface StoicControl {
  controllable: string[];
  uncontrollable: string[];
  focus: string;
  acceptance: string;
}

class AureliusPrinciples {
  /**
   * Separa o que está sob controle do que não está
   */
  separateControl(params: {
    marketCondition: string;
    newsEvent: string;
    execution: string;
    risk: string;
    outcome: string;
    otherTraders: string;
  }): StoicControl {
    return {
      controllable: [
        'Execução do plano',
        'Gestão de risco',
        'Mentalidade',
        'Processo de decisão'
      ],
      uncontrollable: [
        'Resultado do mercado',
        'Notícias',
        'Ações de outros traders',
        'Condições macroeconômicas'
      ],
      focus: 'Foco total no PROCESSO — jamais no outcome.',
      acceptance: 'Aceitar consequências sem resistência interna. "Isso também passa."'
    };
  }

  /**
   * Aplica estoicismo: equanimidade
   */
  applyEquanimity(outcome: number): string {
    if (outcome === 1) {
      return 'GANHO: Aceitar sem euforia. Resultado é consequência do processo.';
    } else {
      return 'PERDA: Aceitar sem desespero. Cada trade é um evento independente.';
    }
  }

  /**
   * Reflexão matinal estoica
   */
  morningReflection(): string {
    return 'Hoje vou encontrar: pessoas impulsivas, mercado volátil, resultados incertos. Mas não posso ser afetado por isso, pois foco apenas no que controlo: minha execução.';
  }
}

// ==================== BRETT STEENBARGER ====================

interface PostTradeReflection {
  questions: string[];
  insights: string[];
  learningPoints: string[];
  addToMemory: boolean;
}

class SteenbargerPrinciples {
  private readonly REFLECTION_QUESTIONS = [
    'O que eu (o sistema) estava "pensando" quando entrou? Setup completo?',
    'Quais agentes concordaram e quais discordaram?',
    'O resultado seguiu a probabilidade esperada do setup?',
    'Houve viés emocional na decisão?',
    'O que pode ser aprendido e ajustado para o próximo ciclo?'
  ];

  /**
   * Reflexão pós-perda estruturada
   * Converte 100% das perdas em aprendizado
   */
  async reflectOnLoss(trade: {
    setup: string;
    agents: string[];
    expectedProb: number;
    actualOutcome: number;
    emotionalState: string;
  }): Promise<PostTradeReflection> {
    const questions = this.REFLECTION_QUESTIONS;
    const insights: string[] = [];
    const learningPoints: string[] = [];

    // Análise do setup
    if (!trade.setup || trade.setup.length < 10) {
      insights.push('Setup não estava completamente definido');
      learningPoints.push('Obrigatório: definir todos os critérios do setup antes de entrar');
    }

    // Análise de agentes
    if (trade.agents && trade.agents.includes('PSYCH_AGENT')) {
      insights.push('Psych Agent estava ativo - verificar estado emocional');
    }

    // Análise de probabilidade
    if (trade.expectedProb > 0.6 && trade.actualOutcome === 0) {
      insights.push('Trade com alta probabilidade resultou em perda - variância normal');
      learningPoints.push('Aceitar variância como parte do processo estatístico');
    }

    // Salva na Strategy Memory
    await this.saveToStrategyMemory(trade, insights, learningPoints);

    return {
      questions,
      insights,
      learningPoints,
      addToMemory: true
    };
  }

  /**
   * Reflexão pós-ganho
   */
  async reflectOnWin(trade: {
    setup: string;
    agents: string[];
    expectedProb: number;
    actualOutcome: number;
  }): Promise<PostTradeReflection> {
    const insights: string[] = [];
    const learningPoints: string[] = [];

    // Verifica se foi sorte ou processo
    if (trade.expectedProb < 0.5) {
      insights.push('Ganho com baixa probabilidade - possível sorte');
      learningPoints.push('Não repetir setups de baixa probabilidade');
    } else {
      insights.push('Ganho seguindo processo - validar setup');
      learningPoints.push(`Setup "${trade.setup}" validado - adicionar à memória`);
    }

    return {
      questions: this.REFLECTION_QUESTIONS,
      insights,
      learningPoints,
      addToMemory: true
    };
  }

  /**
   * Salva na Strategy Memory
   */
  private async saveToStrategyMemory(trade: any, insights: string[], learnings: string[]): Promise<void> {
    try {
      await oracleDB.insert(`
        INSERT INTO strategy_memory (id, symbol, price, type, strength, created_at)
        VALUES (:id, :symbol, 0, 'REFLECTION', 1, CURRENT_TIMESTAMP)
      `, { id: oracleDB.generateId(), symbol: trade.setup?.substring(0, 20) || 'UNKNOWN' });

      await oracleDB.insert(`
        INSERT INTO learning_data (id, trade_id, strategy, outcome, features, created_at)
        VALUES (:id, :tradeId, :strategy, :outcome, :features, CURRENT_TIMESTAMP)
      `, {
        id: oracleDB.generateId(),
        tradeId: oracleDB.generateId(),
        strategy: trade.setup,
        outcome: trade.actualOutcome,
        features: JSON.stringify({ insights, learnings })
      });
    } catch {}
  }
}

// ==================== MENTAL LIBRARY (Facade) ====================

class MentalLibrary {
  readonly douglas = new DouglasPrinciples();
  readonly taleb = new TalebPrinciples();
  readonly kahneman = new KahnemanPrinciples();
  readonly tendler = new TendlerPrinciples();
  readonly aurelius = new AureliusPrinciples();
  readonly steenbarger = new SteenbargerPrinciples();

  /**
   * Aplica todos os princípios antes de um trade
   */
  async preTradeAnalysis(params: {
    previousTrades: number[];
    timeToDecision: number;
    analysisSteps: number;
    dataPoints: number;
    emotionalState: number;
    capital: number;
    capitalAtRisk: number;
  }): Promise<{
    approved: boolean;
    warnings: string[];
    interventions: string[];
  }> {
    const warnings: string[] = [];
    const interventions: string[] = [];

    // 1. Douglas: Independência estatística
    const independence = await this.douglas.checkIndependence(params.previousTrades);
    if (independence.currentBias !== 'NONE') {
      warnings.push(`Viés detectado: ${independence.currentBias}`);
      interventions.push(independence.intervention);
    }

    // 2. Kahneman: Sistema 2
    const decision = this.kahneman.checkDecisionSystem(params);
    if (decision.system === 'SYSTEM_1') {
      interventions.push(decision.intervention);
      return {
        approved: false,
        warnings,
        interventions
      };
    }
    if (decision.biases.length > 0) {
      warnings.push(...decision.biases);
    }

    // 3. Taleb: Skin in the game
    const hasSkinInTheGame = this.taleb.verifySkinInTheGame(
      params.capitalAtRisk,
      params.capital
    );
    if (!hasSkinInTheGame) {
      warnings.push('Capital em risco inadequado');
    }

    // 4. Tendler: Tilt
    const tiltLevel = this.tendler.detectTiltLevel(
      params.emotionalState > 0.7 ? ['Frustração'] : []
    );
    if (tiltLevel.level >= 3) {
      interventions.push(`Tilt nível ${tiltLevel.level}: ${tiltLevel.actions.join(', ')}`);
      return {
        approved: false,
        warnings,
        interventions
      };
    }

    return {
      approved: warnings.length === 0,
      warnings,
      interventions
    };
  }

  /**
   * Reflexão pós-trade
   */
  async postTradeReflection(trade: {
    outcome: number;
    setup: string;
    agents: string[];
    expectedProb: number;
    emotionalState: string;
  }): Promise<PostTradeReflection> {
    const tradeData = { ...trade, actualOutcome: trade.outcome };
    
    if (trade.outcome === 0) {
      return this.steenbarger.reflectOnLoss(tradeData);
    } else {
      return this.steenbarger.reflectOnWin(tradeData);
    }
  }
}

// Singleton
export const mentalLibrary = new MentalLibrary();
export { DouglasPrinciples, TalebPrinciples, KahnemanPrinciples, TendlerPrinciples, AureliusPrinciples, SteenbargerPrinciples };
export type { StatisticalIndependence, AntifragileState, SystemCheck, TiltLevel, StoicControl, PostTradeReflection };
