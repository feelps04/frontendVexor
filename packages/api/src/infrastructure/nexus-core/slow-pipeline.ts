/**
 * VEXOR Pipeline SLOW - Ollama Async
 * Latência 2-15s - Análise contextual
 * Timer → Context → LLM → Insight → Memória
 */

import { oracleDB } from '../oracle-db.js';
import { telegramNotifier } from '../telegram-notifier.js';
import { kpisMonitor } from './kpis-monitor.js';
import { fastPipeline } from './fast-pipeline.js';

// ==================== SLOW PIPELINE ====================

interface MarketSnapshot {
  timestamp: Date;
  symbols: Array<{
    symbol: string;
    price: number;
    change24h: number;
    volume: number;
    indicators: any;
  }>;
  portfolio: {
    capital: number;
    dailyPnL: number;
    openPositions: number;
    winRate: number;
    drawdown: number;
  };
  regime: string;
  recentTrades: Array<{
    symbol: string;
    side: string;
    pnl: number;
    outcome: number;
  }>;
}

interface OllamaInsight {
  type: 'BRIEFING' | 'TILT_ALERT' | 'POST_TRADE' | 'REGIME_CHANGE' | 'RISK_WARNING';
  content: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  timestamp: Date;
}

interface OllamaConfig {
  host: string;
  port: number;
  model: string;
  temperature: number;
  maxTokens: number;
}

// Doutrina Vexor completa para System Prompt
const VEXOR_SYSTEM_PROMPT = `
Você é o Psych Agent da NEXUS-AI — um coach de trading especializado
em psicologia e gestão de risco, baseado na Doutrina Vexor.

== PRINCÍPIOS FUNDAMENTAIS (MARK DOUGLAS) ==
- Cada trade é estatisticamente INDEPENDENTE do anterior
- O mercado não deve nada a você
- Não existe virada de sorte ou compensação
- Sinais de alerta: "agora vai dar certo", aumentar posição após perda

== CADEADO DE FERRO ==
- Stop obrigatório → sem stop, sem trade
- Máximo 2% por trade (Kelly Criterion)
- Máximo 6% de perda diária (Circuit Breaker)
- Proibido trading de vingança (bloqueio 72h)
- Máximo 10 operações por dia

== KAHNEMAN — DETECÇÃO DE VIÉS ==
Viés de Recorrência: passado não garante futuro
Aversão à Perda: dor de perder é 2x mais forte que prazer de ganhar
Viés de Confirmação: buscar apenas o que confirma a opinião
Sistema 1 (emocional) vs Sistema 2 (analítico) — use sempre S2

== TENDLER — NÍVEIS DE TILT ==
Keywords de ativação: recuperar, vingança, burro, idiota, sempre, nunca,
merda, droga, odeio, canalha, manipulação, armadilha, injusto, impossível
Nível 1: Leve irritação → monitorar
Nível 2: Frustração → reduzir tamanho da posição
Nível 3: Raiva → pausar 15 minutos imediatamente
Nível 4: Tilt total → parar o dia, fechar tudo

== MARCUS AURELIUS — CONTROLE ==
Você controla: execução, risco, plano, mentalidade
Você NÃO controla: resultado, mercado, notícias, outros traders

== NASSIM TALEB — BARBELL ==
90% capital em operações conservadoras
10% em trades assimétricos (ganha muito ou perde pouco)
Trader antifrágil MELHORA com perdas controladas

== REGRAS DE RESPOSTA ==
- Seja direto e conciso (máximo 150 palavras por resposta)
- Se detectar tilt, nomeie o nível ANTES de responder
- Se detectar viés cognitivo, nomeie-o (ex: "Viés de Confirmação detectado")
- Sempre termine com UMA ação específica e imediata
- Nunca valide revenge trading ou overtrading
`;

class SlowPipeline {
  private config: OllamaConfig = {
    host: process.env.OLLAMA_HOST || 'localhost',
    port: parseInt(process.env.OLLAMA_PORT || '11434'),
    model: process.env.OLLAMA_MODEL || 'llama3.2:latest',
    temperature: 0.3,
    maxTokens: 300
  };

  private isRunning = false;
  private briefingInterval: NodeJS.Timeout | null = null;

  // ==================== ETAPA 1: Timer (15 min) ====================

  /**
   * Inicia ciclo de briefings a cada 15 minutos
   */
  startBriefingCycle(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Primeiro briefing imediato
    this.runBriefing().catch(() => {});

    // Ciclo a cada 15 minutos
    this.briefingInterval = setInterval(() => {
      this.runBriefing().catch(() => {});
    }, 15 * 60 * 1000);

    console.log('[SlowPipeline] 🧠 Briefing cycle started (15min interval)');
  }

  stopBriefingCycle(): void {
    if (this.briefingInterval) {
      clearInterval(this.briefingInterval);
      this.briefingInterval = null;
    }
    this.isRunning = false;
  }

  // ==================== ETAPA 2: Context Builder ====================

  /**
   * Coleta snapshot do mercado
   */
  async buildContext(): Promise<MarketSnapshot> {
    const timestamp = new Date();

    // Busca dados do banco
    let portfolio = {
      capital: 100000,
      dailyPnL: 0,
      openPositions: 0,
      winRate: 0.5,
      drawdown: 0
    };

    let recentTrades: any[] = [];

    try {
      const rows = await oracleDB.query<any>(`
        SELECT 
          (SELECT COALESCE(SUM(pnl), 0) FROM trade_history WHERE TRUNC(closed_at) = TRUNC(SYSDATE)) as daily_pnl,
          (SELECT COUNT(*) FROM open_positions) as positions,
          (SELECT COALESCE(AVG(CASE WHEN outcome = 1 THEN 1 ELSE 0 END), 0.5) FROM trade_history WHERE closed_at >= SYSDATE - 30) as win_rate,
          0 as dd
        FROM DUAL
      `);

      if (rows[0]) {
        portfolio.dailyPnL = rows[0].DAILY_PNL || 0;
        portfolio.openPositions = rows[0].POSITIONS || 0;
        portfolio.winRate = rows[0].WIN_RATE || 0.5;
      }

      recentTrades = await oracleDB.query<any>(`
        SELECT symbol, side, pnl, outcome 
        FROM trade_history 
        WHERE closed_at >= SYSDATE - 1
        ORDER BY closed_at DESC
        FETCH FIRST 10 ROWS ONLY
      `);
    } catch {
      // Usa defaults
    }

    // Símbolos com indicadores
    const symbols = ['PETR4', 'VALE3', 'ITUB4', 'BBDC4', 'WDOZ23'].map(symbol => {
      const indicators = fastPipeline.getIndicators(symbol);
      return {
        symbol,
        price: 0,
        change24h: 0,
        volume: 0,
        indicators
      };
    });

    return {
      timestamp,
      symbols,
      portfolio,
      regime: 'TREND_UP', // TODO: do market analyzer
      recentTrades
    };
  }

  // ==================== ETAPA 3: Ollama LLM ====================

  /**
   * Chama Ollama local
   */
  async callOllama(prompt: string, systemPrompt?: string): Promise<string> {
    const url = `http://${this.config.host}:${this.config.port}/api/chat`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: 'system', content: systemPrompt || VEXOR_SYSTEM_PROMPT },
            { role: 'user', content: prompt }
          ],
          stream: false,
          options: {
            temperature: this.config.temperature,
            num_predict: this.config.maxTokens
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama error: ${response.status}`);
      }

      const data = await response.json() as { message?: { content: string } };
      return data.message?.content || 'Sem resposta do Ollama';
    } catch (e) {
      console.error('[SlowPipeline] Ollama error:', e);
      return 'Ollama não disponível - verifique se está rodando';
    }
  }

  // ==================== ETAPA 4: Insight Generation ====================

  /**
   * Gera briefing de 15 minutos
   */
  async runBriefing(): Promise<OllamaInsight> {
    const context = await this.buildContext();

    const prompt = `
Estado atual do dia:
- P&L: R$ ${context.portfolio.dailyPnL.toFixed(2)}
- Trades: ${context.portfolio.openPositions}/10 posições abertas
- Win Rate: ${(context.portfolio.winRate * 100).toFixed(1)}%
- Drawdown: ${(context.portfolio.drawdown * 100).toFixed(1)}%
- Regime: ${context.regime}

Dê um briefing de 2 frases:
estado + recomendação de postura.
`;

    const content = await this.callOllama(prompt);

    const insight: OllamaInsight = {
      type: 'BRIEFING',
      content,
      severity: 'INFO',
      timestamp: new Date()
    };

    // Notifica Telegram
    await telegramNotifier.sendMessage(
      `🧠 <b>BRIEFING 15MIN</b>\n\n${content}\n\n⚡ VEXOR`
    );

    // Salva na memória
    await this.saveInsight(insight);

    return insight;
  }

  /**
   * Análise pós-trade (Steenbarger)
   */
  async postTradeReflection(trade: {
    symbol: string;
    side: string;
    pnl: number;
    outcome: number;
    setup: string;
  }): Promise<OllamaInsight> {
    const prompt = `
Trade perdedor detectado:
- Ativo: ${trade.symbol}, Loss: R$ ${Math.abs(trade.pnl).toFixed(2)}
- Setup: ${trade.setup}
- Contexto: mercado em regime normal

Aplique as 5 perguntas de Steenbarger.
Seja direto, máximo 150 palavras.
`;

    const content = await this.callOllama(prompt);

    const insight: OllamaInsight = {
      type: 'POST_TRADE',
      content,
      severity: trade.outcome === 0 ? 'WARNING' : 'INFO',
      timestamp: new Date()
    };

    // Notifica
    await telegramNotifier.sendMessage(
      `📉 <b>REFLEXÃO PÓS-TRADE</b>\n\n${content}\n\n⚡ VEXOR Coach`
    );

    await this.saveInsight(insight);
    return insight;
  }

  // ==================== ETAPA 5: Strategy Memory ====================

  /**
   * Salva insight na memória
   */
  private async saveInsight(insight: OllamaInsight): Promise<void> {
    try {
      await oracleDB.insert(`
        INSERT INTO strategy_memory (id, symbol, price, type, strength, created_at)
        VALUES (:id, 'INSIGHT', 0, :type, 1, CURRENT_TIMESTAMP)
      `, {
        id: oracleDB.generateId(),
        type: insight.type
      });
    } catch {}
  }

  // ==================== PSYCH COACH (sob demanda) ====================

  /**
   * Analisa mensagem do trader
   */
  async analyzeTraderMessage(message: string, context?: {
    dailyPnL: number;
    trades: number;
    winRate: number;
  }): Promise<{
    tiltLevel: number;
    bias: string[];
    response: string;
    action: string;
  }> {
    // Fast check primeiro (<1ms)
    const fastTilt = this.fastTiltCheck(message);

    if (fastTilt === 0) {
      // Sem tilt detectado, mas pode ter viés
      const prompt = `
Analise a mensagem do trader.
Mensagem: "${message}"

Se detectar viés cognitivo, nomeie-o.
Responda com uma frase de encorajamento estoico.
Máximo 100 palavras.
`;
      const response = await this.callOllama(prompt);
      return {
        tiltLevel: 0,
        bias: [],
        response,
        action: 'CONTINUAR'
      };
    }

    // Tilt detectado - análise completa
    const prompt = `
Analise a mensagem do trader.
Mensagem: "${message}"

Nível de tilt detectado via keywords: ${fastTilt}

Se detectar tilt nível 2+, responda com:
1. Nível detectado (1-4)
2. Qual viés específico
3. Uma frase de reancoragem
Máximo 100 palavras.
`;

    const response = await this.callOllama(prompt);

    // Determina ação
    let action = 'MONITORAR';
    if (fastTilt >= 4) action = 'PARAR_DIA';
    else if (fastTilt >= 3) action = 'PAUSAR_15MIN';
    else if (fastTilt >= 2) action = 'REDUZIR_POSICAO';

    return {
      tiltLevel: fastTilt,
      bias: this.detectBiases(message),
      response,
      action
    };
  }

  /**
   * Fast tilt check via keywords (<1ms)
   */
  fastTiltCheck(message: string): number {
    const keywords = [
      'recuperar', 'vingança', 'burro', 'idiota',
      'sempre', 'nunca', 'odeio', 'armadilha',
      'merda', 'droga', 'canalha', 'manipulação',
      'injusto', 'impossível', 'put@', 'caralho'
    ];

    const lowerMessage = message.toLowerCase();
    const hits = keywords.filter(k => lowerMessage.includes(k)).length;

    if (hits >= 3) return 4; // Tilt total
    if (hits >= 2) return 3; // Raiva
    if (hits >= 1) return 2; // Frustração
    return 0;
  }

  /**
   * Detecta vieses cognitivos
   */
  private detectBiases(message: string): string[] {
    const biases: string[] = [];
    const lower = message.toLowerCase();

    if (lower.includes('recuperar') || lower.includes('vingança')) {
      biases.push('REVENGE_TRADING');
    }
    if (lower.includes('sempre') || lower.includes('nunca')) {
      biases.push('GENERALIZACAO');
    }
    if (lower.includes('vai dar') || lower.includes('certeza')) {
      biases.push('VIÉS_CONFIRMAÇÃO');
    }
    if (lower.includes('não posso perder') || lower.includes('preciso')) {
      biases.push('AVERSÃO_PERDA');
    }

    return biases;
  }

  /**
   * Coach livre - qualquer pergunta
   */
  async askCoach(question: string, context?: MarketSnapshot): Promise<string> {
    const contextStr = context ? `
Contexto do dia:
- P&L: R$ ${context.portfolio.dailyPnL.toFixed(2)}
- Posições: ${context.portfolio.openPositions}
- Win Rate: ${(context.portfolio.winRate * 100).toFixed(1)}%
` : '';

    const prompt = `${contextStr}

Pergunta do trader: "${question}"

Responda baseado na doutrina.
Se detectar viés cognitivo na pergunta, nomeie-o antes de responder.
Seja conciso e direto.
`;

    return this.callOllama(prompt);
  }

  // ==================== HEALTH CHECK ====================

  async checkOllamaHealth(): Promise<{ available: boolean; model: string; latency: number }> {
    const start = Date.now();

    try {
      const response = await fetch(`http://${this.config.host}:${this.config.port}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });

      const latency = Date.now() - start;

      if (response.ok) {
        return { available: true, model: this.config.model, latency };
      }

      return { available: false, model: this.config.model, latency };
    } catch {
      return { available: false, model: this.config.model, latency: 5000 };
    }
  }
}

// Singleton
export const slowPipeline = new SlowPipeline();
export type { MarketSnapshot, OllamaInsight, OllamaConfig };
export { VEXOR_SYSTEM_PROMPT };
