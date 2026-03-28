/**
 * VEXOR Psych Agent - Monitor Psicológico
 * Ollama Llama 3.3 90B - 100% Local
 * Integrado na compra/venda da plataforma web
 */

import { slowPipeline, VEXOR_SYSTEM_PROMPT } from './slow-pipeline.js';
import { oracleDB } from '../oracle-db.js';
import { telegramNotifier } from '../telegram-notifier.js';
import { riskEngine } from './risk-engine.js';

// ==================== PSYCH AGENT ====================

interface PsychState {
  tiltLevel: 0 | 1 | 2 | 3 | 4;
  lastAnalysis: Date | null;
  consecutiveLosses: number;
  consecutiveWins: number;
  blockedUntil: Date | null;
  blockReason: string | null;
  recentMessages: string[];
  detectedBiases: string[];
}

interface PsychIntervention {
  type: 'BLOCK' | 'REDUCE' | 'PAUSE' | 'WARN' | 'COACH';
  reason: string;
  duration?: number; // minutos
  response: string;
  action: () => Promise<void>;
}

class PsychAgent {
  private state: PsychState = {
    tiltLevel: 0,
    lastAnalysis: null,
    consecutiveLosses: 0,
    consecutiveWins: 0,
    blockedUntil: null,
    blockReason: null,
    recentMessages: [],
    detectedBiases: []
  };

  // Keywords de Tilt (Tendler)
  private readonly TILT_KEYWORDS = {
    L1: ['irritado', 'impaciente', 'chato'],
    L2: ['frustrado', 'cansado', 'cansando', 'chateado'],
    L3: ['raiva', 'ódio', 'odeio', 'puta', 'merda', 'droga', 'caralho'],
    L4: ['vingança', 'recuperar', 'vou mostrar', 'nunca mais', 'sempre perde', 'armadilha', 'manipulação']
  };

  // Keywords de Viés (Kahneman)
  private readonly BIAS_KEYWORDS = {
    CONFIRMATION: ['eu sabia', 'tá vindo', 'vai dar certo', 'confirmou'],
    LOSS_AVERSION: ['não posso perder', 'preciso recuperar', 'não aguento'],
    RECENCY: ['última vez', 'ontem foi', 'agora vai'],
    OVERCONFIDENCE: ['certeza', 'garantido', 'sem erro', 'infalível'],
    REVENGE: ['vou recuperar', 'vingança', 'vou mostrar pra eles']
  };

  /**
   * FAST: Verificação pré-trade (<1ms)
   * Chamado ANTES de cada ordem
   */
  async preTradeCheck(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    price: number;
    capital: number;
    dailyPnL: number;
    dailyTrades: number;
  }): Promise<{
    approved: boolean;
    interventions: PsychIntervention[];
    state: PsychState;
  }> {
    const interventions: PsychIntervention[] = [];

    // 1. Verifica bloqueio ativo
    if (this.state.blockedUntil && new Date() < this.state.blockedUntil) {
      interventions.push({
        type: 'BLOCK',
        reason: `Bloqueado até ${this.state.blockedUntil.toLocaleTimeString()}`,
        response: `⚠️ Sistema bloqueado. Motivo: ${this.state.blockReason}`,
        action: async () => {}
      });

      return { approved: false, interventions, state: this.state };
    }

    // 2. Verifica perdas consecutivas
    if (this.state.consecutiveLosses >= 3) {
      interventions.push({
        type: 'WARN',
        reason: '3+ perdas consecutivas',
        response: '⚠️ ATENÇÃO: 3 perdas seguidas. Reduzir tamanho ou pausar.',
        action: async () => {
          await this.notifyPsychAlert('Perdas consecutivas', 2);
        }
      });
    }

    // 3. Verifica limite diário
    const dailyLossPercent = Math.abs(params.dailyPnL) / params.capital;
    if (dailyLossPercent >= 0.06) {
      interventions.push({
        type: 'BLOCK',
        reason: 'Limite diário de perda atingido (6%)',
        response: '🚫 CIRCUIT BREAKER: 6% de perda diária. Dia encerrado.',
        action: async () => {
          await this.blockTrading(24 * 60, 'Limite diário de perda');
        }
      });

      return { approved: false, interventions, state: this.state };
    }

    // 4. Verifica overtrading
    if (params.dailyTrades >= 10) {
      interventions.push({
        type: 'BLOCK',
        reason: 'Limite de 10 trades/dia atingido',
        response: '🚫 OVERTRADING: 10 trades hoje. Qualidade > quantidade.',
        action: async () => {}
      });

      return { approved: false, interventions, state: this.state };
    }

    // 5. Verifica tilt
    if (this.state.tiltLevel >= 3) {
      interventions.push({
        type: 'PAUSE',
        reason: `Tilt nível ${this.state.tiltLevel} detectado`,
        response: `🧘 TILT NÍVEL ${this.state.tiltLevel}: Pausa obrigatória de 15 minutos.`,
        action: async () => {
          await this.pauseTrading(15);
        }
      });

      return { approved: false, interventions, state: this.state };
    }

    // 6. Redução de posição se tilt nível 2
    let approved = true;
    if (this.state.tiltLevel === 2) {
      interventions.push({
        type: 'REDUCE',
        reason: 'Tilt nível 2 - reduzir posição',
        response: '⚠️ Tilt detectado. Tamanho da posição reduzido em 50%.',
        action: async () => {}
      });
      // Reduz quantidade pela metade
      params.quantity = Math.floor(params.quantity * 0.5);
    }

    return { approved, interventions, state: this.state };
  }

  /**
   * FAST: Análise de mensagem (<1ms keyword check)
   * SLOW: Ollama análise completa (3-10s)
   */
  async analyzeMessage(message: string): Promise<{
    fastResult: {
      tiltLevel: number;
      biases: string[];
    };
    slowResult?: {
      response: string;
      action: string;
    };
  }> {
    // FAST: Keyword check (<1ms)
    const fastResult = this.fastAnalyzeMessage(message);

    // Adiciona ao histórico
    this.state.recentMessages.push(message);
    if (this.state.recentMessages.length > 20) {
      this.state.recentMessages.shift();
    }

    // Atualiza estado
    if (fastResult.tiltLevel > this.state.tiltLevel) {
      this.state.tiltLevel = fastResult.tiltLevel as any;
      this.state.detectedBiases = fastResult.biases;
    }

    // SLOW: Ollama analysis (apenas se tilt detectado)
    let slowResult: { response: string; action: string } | undefined;

    if (fastResult.tiltLevel >= 2) {
      // Chama Ollama para análise completa
      const analysis = await slowPipeline.analyzeTraderMessage(message, {
        dailyPnL: 0,
        trades: 0,
        winRate: 0.5
      });

      slowResult = {
        response: analysis.response,
        action: analysis.action
      };

      // Aplica ação automática
      await this.applyTiltAction(fastResult.tiltLevel);

      // Notifica
      await this.notifyTiltDetected(fastResult.tiltLevel, message, analysis.response);
    }

    // Salva análise
    await this.saveAnalysis(message, fastResult, slowResult);

    return { fastResult, slowResult };
  }

  /**
   * FAST: Keyword-based analysis (<1ms)
   */
  private fastAnalyzeMessage(message: string): { tiltLevel: number; biases: string[] } {
    const lower = message.toLowerCase();
    let tiltLevel = 0;
    const biases: string[] = [];

    // Detecta nível de tilt
    if (this.TILT_KEYWORDS.L4.some(k => lower.includes(k))) {
      tiltLevel = 4;
    } else if (this.TILT_KEYWORDS.L3.some(k => lower.includes(k))) {
      tiltLevel = 3;
    } else if (this.TILT_KEYWORDS.L2.some(k => lower.includes(k))) {
      tiltLevel = 2;
    } else if (this.TILT_KEYWORDS.L1.some(k => lower.includes(k))) {
      tiltLevel = 1;
    }

    // Detecta vieses
    for (const [bias, keywords] of Object.entries(this.BIAS_KEYWORDS)) {
      if (keywords.some(k => lower.includes(k))) {
        biases.push(bias);
      }
    }

    return { tiltLevel, biases };
  }

  /**
   * Aplica ação baseada no nível de tilt
   */
  private async applyTiltAction(level: number): Promise<void> {
    switch (level) {
      case 4:
        // Tilt total: para o dia
        await this.blockTrading(24 * 60, 'Tilt nível 4 - dia encerrado');
        break;
      case 3:
        // Raiva: pausa 15min
        await this.pauseTrading(15);
        break;
      case 2:
        // Frustração: reduz posição
        riskEngine.drawdownGuard.update(
          riskEngine.drawdownGuard.getState().currentCapital * 0.5
        );
        break;
    }
  }

  /**
   * Pausa trading por X minutos
   */
  private async pauseTrading(minutes: number): Promise<void> {
    const until = new Date(Date.now() + minutes * 60 * 1000);
    this.state.blockedUntil = until;
    this.state.blockReason = `Tilt - pausa de ${minutes} minutos`;

    await telegramNotifier.sendMessage(
      `🧘 <b>PAUSA OBRIGATÓRIA</b>\n\n` +
      `⏱️ Duração: ${minutes} minutos\n` +
      `⏰ Retorno: ${until.toLocaleTimeString()}\n\n` +
      `Respire. O mercado não vai a lugar nenhum.`
    );
  }

  /**
   * Bloqueia trading por X minutos
   */
  private async blockTrading(minutes: number, reason: string): Promise<void> {
    const until = new Date(Date.now() + minutes * 60 * 1000);
    this.state.blockedUntil = until;
    this.state.blockReason = reason;

    await telegramNotifier.sendMessage(
      `🚫 <b>TRADING BLOQUEADO</b>\n\n` +
      `📝 Motivo: ${reason}\n` +
      `⏰ Bloqueio até: ${until.toLocaleTimeString()}\n\n` +
      `O mercado não deve nada a você. Amanhã é outro dia.`
    );
  }

  /**
   * Atualiza estado após trade
   */
  async postTradeUpdate(outcome: number, pnl: number): Promise<void> {
    if (outcome === 0) {
      // Perda
      this.state.consecutiveLosses++;
      this.state.consecutiveWins = 0;

      // Aumenta tilt com perdas consecutivas
      if (this.state.consecutiveLosses >= 3 && this.state.tiltLevel < 2) {
        this.state.tiltLevel = 2;
      }
      if (this.state.consecutiveLosses >= 5 && this.state.tiltLevel < 3) {
        this.state.tiltLevel = 3;
      }
    } else {
      // Ganho
      this.state.consecutiveWins++;
      this.state.consecutiveLosses = 0;

      // Reduz tilt com ganhos
      if (this.state.consecutiveWins >= 2 && this.state.tiltLevel > 0) {
        this.state.tiltLevel = Math.max(0, this.state.tiltLevel - 1) as any;
      }
    }

    this.state.lastAnalysis = new Date();

    // Reflexão automática após perda (Steenbarger)
    if (outcome === 0 && pnl < -100) {
      await slowPipeline.postTradeReflection({
        symbol: 'TRADE',
        side: 'BUY',
        pnl,
        outcome,
        setup: 'Setup não informado'
      });
    }
  }

  /**
   * Notifica detecção de tilt
   */
  private async notifyTiltDetected(level: number, message: string, response: string): Promise<void> {
    const emojis = ['', '🟡', '🟠', '🔴', '🚨'];
    const names = ['', 'Leve Irritação', 'Frustração', 'Raiva', 'Tilt Total'];

    await telegramNotifier.sendMessage(
      `${emojis[level]} <b>TILT DETECTADO - NÍVEL ${level}</b>\n\n` +
      `📊 ${names[level]}\n\n` +
      `💬 Mensagem: "${message.substring(0, 50)}..."\n\n` +
      `🧠 Análise:\n${response}\n\n` +
      `⚡ VEXOR Psych Agent`
    );
  }

  /**
   * Notifica alerta psicológico
   */
  private async notifyPsychAlert(reason: string, level: number): Promise<void> {
    await telegramNotifier.sendMessage(
      `⚠️ <b>ALERTA PSICOLÓGICO</b>\n\n` +
      `📝 ${reason}\n` +
      `📊 Nível: ${level}\n\n` +
      `⚡ VEXOR`
    );
  }

  /**
   * Salva análise no banco
   */
  private async saveAnalysis(message: string, fastResult: any, slowResult: any): Promise<void> {
    try {
      await oracleDB.insert(`
        INSERT INTO psych_analysis (id, message, tilt_level, biases, slow_response, timestamp)
        VALUES (:id, :msg, :tilt, :biases, :slow, CURRENT_TIMESTAMP)
      `, {
        id: oracleDB.generateId(),
        msg: message.substring(0, 500),
        tilt: fastResult.tiltLevel,
        biases: fastResult.biases.join(','),
        slow: slowResult?.response?.substring(0, 500) || ''
      });
    } catch {}
  }

  /**
   * Coach livre - qualquer pergunta
   */
  async askCoach(question: string): Promise<string> {
    return slowPipeline.askCoach(question);
  }

  /**
   * Verifica saúde do Ollama
   */
  async checkHealth(): Promise<{ ollama: boolean; model: string }> {
    const health = await slowPipeline.checkOllamaHealth();
    return {
      ollama: health.available,
      model: health.model
    };
  }

  /**
   * Obtém estado atual
   */
  getState(): PsychState {
    return { ...this.state };
  }

  /**
   * Reseta estado (após pausa ou novo dia)
   */
  resetState(): void {
    this.state = {
      tiltLevel: 0,
      lastAnalysis: null,
      consecutiveLosses: 0,
      consecutiveWins: 0,
      blockedUntil: null,
      blockReason: null,
      recentMessages: [],
      detectedBiases: []
    };
  }

  /**
   * Verifica se pode operar
   */
  canTrade(): boolean {
    if (this.state.blockedUntil && new Date() < this.state.blockedUntil) {
      return false;
    }
    return this.state.tiltLevel < 3;
  }
}

// Singleton
export const psychAgent = new PsychAgent();
export type { PsychState, PsychIntervention };
