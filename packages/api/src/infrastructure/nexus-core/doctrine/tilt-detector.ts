/**
 * VEXOR Doctrine - Anti-Tilt Detection (Tendler/Douglas)
 * 4 níveis de alerta
 * Nível 3+ = reduz automaticamente tamanho das posições pela metade
 */

import { oracleDB } from '../../oracle-db.js';
import { telegramNotifier } from '../../telegram-notifier.js';

type TiltLevel = 0 | 1 | 2 | 3 | 4;

interface TiltIndicator {
  id: string;
  name: string;
  description: string;
  weight: number;
  check: () => Promise<number>; // 0-1 score
}

interface TiltState {
  level: TiltLevel;
  score: number;
  indicators: Array<{
    name: string;
    score: number;
    triggered: boolean;
  }>;
  actions: string[];
  timestamp: Date;
}

class TiltDetector {
  private indicators: TiltIndicator[] = [];
  private currentState: TiltState | null = null;
  private readonly ALERT_THRESHOLDS = [0, 0.25, 0.5, 0.75, 0.9];

  constructor() {
    this.initializeIndicators();
  }

  private initializeIndicators(): void {
    this.indicators = [
      // INDICADOR 1: Perdas Consecutivas
      {
        id: 'TILT_01',
        name: 'Perdas Consecutivas',
        description: 'Número de perdas seguidas (Douglas: 3+ = tilt)',
        weight: 0.25,
        check: async () => {
          try {
            const rows = await oracleDB.query<{ LOSSES: number }>(`
              SELECT COUNT(*) as LOSSES FROM (
                SELECT outcome FROM trade_history 
                WHERE closed_at >= SYSDATE - 1
                ORDER BY closed_at DESC
              ) 
              WHERE outcome = 0
              CONNECT BY PRIOR outcome = 0 AND PRIOR closed_at = closed_at - 1/86400
              START WITH outcome = 0 AND ROWNUM = 1
            `);
            const losses = rows[0]?.LOSSES || 0;
            // 0 perdas = 0, 3+ perdas = 1
            return Math.min(losses / 3, 1);
          } catch {
            return 0;
          }
        }
      },

      // INDICADOR 2: Aumentar Posição Após Perda
      {
        id: 'TILT_02',
        name: 'Aumento de Posição',
        description: 'Aumentar posição após perda (viés de recuperação)',
        weight: 0.2,
        check: async () => {
          try {
            const rows = await oracleDB.query<{ INCREASED: number }>(`
              SELECT 
                CASE WHEN 
                  EXISTS (
                    SELECT 1 FROM trade_history t1
                    JOIN trade_history t2 ON t1.closed_at < t2.closed_at
                    WHERE t1.outcome = 0 
                    AND t2.quantity > t1.quantity * 1.5
                    AND t2.closed_at >= SYSDATE - 1
                  )
                THEN 1 ELSE 0 END as INCREASED
              FROM DUAL
            `);
            return rows[0]?.INCREASED || 0;
          } catch {
            return 0;
          }
        }
      },

      // INDICADOR 3: Operar Acima do Limite Diário
      {
        id: 'TILT_03',
        name: 'Excesso de Operações',
        description: 'Operar acima do limite diário de trades',
        weight: 0.15,
        check: async () => {
          try {
            const rows = await oracleDB.query<{ COUNT: number }>(`
              SELECT COUNT(*) as COUNT FROM trade_history
              WHERE TRUNC(closed_at) = TRUNC(SYSDATE)
            `);
            const count = rows[0]?.COUNT || 0;
            // 10+ trades = 1
            return Math.min(count / 10, 1);
          } catch {
            return 0;
          }
        }
      },

      // INDICADOR 4: Ignorar Sinais Contrários
      {
        id: 'TILT_04',
        name: 'Ignorar Sinais',
        description: 'Ignorar sinais contrários dos agentes',
        weight: 0.15,
        check: async () => {
          try {
            const rows = await oracleDB.query<{ IGNORED: number }>(`
              SELECT COUNT(*) as IGNORED FROM trade_history
              WHERE TRUNC(closed_at) = TRUNC(SYSDATE)
              AND agents_disagreed IS NOT NULL
              AND LENGTH(agents_disagreed) > LENGTH(agents_agreed)
            `);
            const ignored = rows[0]?.IGNORED || 0;
            return Math.min(ignored / 3, 1);
          } catch {
            return 0;
          }
        }
      },

      // INDICADOR 5: Operar Sem Stop
      {
        id: 'TILT_05',
        name: 'Sem Stop',
        description: 'Operar sem stop definido',
        weight: 0.25,
        check: async () => {
          try {
            const rows = await oracleDB.query<{ NO_STOP: number }>(`
              SELECT COUNT(*) as NO_STOP FROM open_positions
              WHERE stop_price = 0 OR stop_price IS NULL
            `);
            const noStop = rows[0]?.NO_STOP || 0;
            return noStop > 0 ? 1 : 0;
          } catch {
            return 0;
          }
        }
      }
    ];
  }

  /**
   * Detecta nível de tilt atual
   */
  async detectTilt(): Promise<TiltState> {
    console.log('[TiltDetector] 🧠 Verificando estado psicológico...');

    const indicatorResults: Array<{ name: string; score: number; triggered: boolean }> = [];
    let totalScore = 0;
    let totalWeight = 0;

    for (const indicator of this.indicators) {
      try {
        const score = await indicator.check();
        const weighted = score * indicator.weight;
        totalScore += weighted;
        totalWeight += indicator.weight;

        indicatorResults.push({
          name: indicator.name,
          score,
          triggered: score > 0.5
        });
      } catch (e) {
        indicatorResults.push({
          name: indicator.name,
          score: 0,
          triggered: false
        });
      }
    }

    const normalizedScore = totalWeight > 0 ? totalScore / totalWeight : 0;
    const level = this.calculateLevel(normalizedScore);
    const actions = this.determineActions(level);

    const state: TiltState = {
      level,
      score: normalizedScore,
      indicators: indicatorResults,
      actions,
      timestamp: new Date()
    };

    this.currentState = state;

    // Salva no banco
    await this.saveState(state);

    // Notifica se nível >= 2
    if (level >= 2) {
      await this.notifyTilt(state);
    }

    // Aplica ações automáticas se nível >= 3
    if (level >= 3) {
      await this.applyActions(actions);
    }

    console.log(`[TiltDetector] Nível ${level} (${(normalizedScore * 100).toFixed(0)}%)`);

    return state;
  }

  private calculateLevel(score: number): TiltLevel {
    if (score >= 0.9) return 4;
    if (score >= 0.75) return 3;
    if (score >= 0.5) return 2;
    if (score >= 0.25) return 1;
    return 0;
  }

  private determineActions(level: TiltLevel): string[] {
    const actions: string[] = [];

    switch (level) {
      case 1:
        actions.push('MONITOR: Acompanhar de perto');
        break;
      case 2:
        actions.push('ALERT: Notificar trader');
        actions.push('PAUSE: Pausar novas entradas por 15min');
        break;
      case 3:
        actions.push('REDUCE: Reduzir tamanho das posições pela metade');
        actions.push('COOLDOWN: Pausar operações por 30min');
        actions.push('REVIEW: Revisar checklist psicológico');
        break;
      case 4:
        actions.push('STOP: Fechar todas as posições');
        actions.push('LOCK: Bloquear novas operações por 24h');
        actions.push('ESCALATE: Contatar supervisor');
        break;
    }

    return actions;
  }

  private async applyActions(actions: string[]): Promise<void> {
    for (const action of actions) {
      console.log(`[TiltDetector] 🔧 Ação: ${action}`);

      // TODO: Implementar ações reais
      // - REDUCE: Atualizar position sizer
      // - STOP: Fechar posições via broker executor
      // - LOCK: Setar flag no banco
    }
  }

  private async saveState(state: TiltState): Promise<void> {
    try {
      await oracleDB.insert(`
        INSERT INTO tilt_state (
          id, tilt_level, score, indicators_json, actions, detected_at
        ) VALUES (
          :id, :level, :score, :indicators, :actions, :timestamp
        )
      `, {
        id: oracleDB.generateId(),
        level: state.level,
        score: state.score,
        indicators: JSON.stringify(state.indicators),
        actions: state.actions.join(';'),
        timestamp: state.timestamp
      });
    } catch (e) {
      console.error('[TiltDetector] Erro ao salvar:', e);
    }
  }

  private async notifyTilt(state: TiltState): Promise<void> {
    const levelEmoji = ['🟢', '🟡', '🟠', '🔴', '🚨'][state.level];
    const levelNames = ['OK', 'CAUTION', 'WARNING', 'DANGER', 'CRITICAL'];

    let message = 
      `${levelEmoji} <b>TILT DETECTADO</b>\n\n` +
      `📊 <b>Nível:</b> ${state.level} - ${levelNames[state.level]}\n` +
      `📈 <b>Score:</b> ${(state.score * 100).toFixed(0)}%\n\n` +
      `🔍 <b>Indicadores:</b>\n`;

    for (const ind of state.indicators.filter(i => i.triggered)) {
      message += `• ${ind.name}: ${(ind.score * 100).toFixed(0)}%\n`;
    }

    message += '\n🔧 <b>Ações:</b>\n';
    for (const action of state.actions) {
      message += `• ${action}\n`;
    }

    message += `\n⏰ ${state.timestamp.toLocaleString('pt-BR')}\n\n⚡ <b>VEXOR</b>`;

    await telegramNotifier.sendMessage(message);
  }

  getCurrentState(): TiltState | null {
    return this.currentState;
  }

  getLevel(): TiltLevel {
    return this.currentState?.level ?? 0;
  }

  isSafe(): boolean {
    return (this.currentState?.level ?? 0) < 3;
  }
}

// Singleton
export const tiltDetector = new TiltDetector();
export type { TiltLevel, TiltState };
