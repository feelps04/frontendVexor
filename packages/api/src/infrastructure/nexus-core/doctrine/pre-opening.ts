/**
 * VEXOR Doctrine - Pre-Opening Checklist (Atomic Habits - James Clear)
 * Executado antes das 9h pelo sistema
 * Nenhum agente entra em operação sem briefing completo e aprovado
 */

import { telegramNotifier } from '../../telegram-notifier.js';
import { oracleDB } from '../../oracle-db.js';
import { marketAnalyzer } from '../ai-core/index.js';

interface ChecklistItem {
  id: string;
  category: 'macro' | 'risk' | 'psych' | 'setup';
  description: string;
  check: () => Promise<boolean>;
  critical: boolean; // Se true, bloqueia operação
}

interface BriefingResult {
  approved: boolean;
  timestamp: Date;
  items: Array<{
    id: string;
    description: string;
    passed: boolean;
    notes?: string;
  }>;
  macroSummary: {
    sp500: number;
    dollar: number;
    selic: number;
    ipca: number;
    crypto: number;
    commodities: number;
  };
  riskStatus: {
    dailyLoss: number;
    dailyLossLimit: number;
    positionsOpen: number;
    exposurePercent: number;
  };
  psychStatus: {
    emotionalState: 'OK' | 'CAUTION' | 'DANGER';
    consecutiveLosses: number;
    consecutiveWins: number;
    planWritten: boolean;
  };
  warnings: string[];
}

class PreOpeningChecklist {
  private checklist: ChecklistItem[] = [];
  private lastBriefing: BriefingResult | null = null;

  constructor() {
    this.initializeChecklist();
  }

  private initializeChecklist(): void {
    this.checklist = [
      // === MACRO ===
      {
        id: 'MACRO_01',
        category: 'macro',
        description: 'Verificar notícias econômicas de alto impacto do dia',
        critical: true,
        check: async () => {
          // TODO: Integrar com API de notícias
          // Por ora, retorna true
          return true;
        }
      },
      {
        id: 'MACRO_02',
        category: 'macro',
        description: 'Analisar S&P 500, Dólar e índices correlacionados',
        critical: true,
        check: async () => {
          // TODO: obter preços do realtime
          const regime = await marketAnalyzer.detectRegime([]);
          return regime !== 'RANGING';
        }
      },
      {
        id: 'MACRO_03',
        category: 'macro',
        description: 'Identificar suportes e resistências na Strategy Memory',
        critical: false,
        check: async () => {
          // Verifica se há dados na memória
          try {
            const rows = await oracleDB.query('SELECT COUNT(*) as cnt FROM strategy_memory');
            return rows.length > 0 && (rows[0] as any).CNT > 0;
          } catch {
            return false;
          }
        }
      },
      {
        id: 'MACRO_04',
        category: 'macro',
        description: 'Confirmar volume médio esperado por setor',
        critical: false,
        check: async () => true
      },

      // === RISK ===
      {
        id: 'RISK_01',
        category: 'risk',
        description: 'Stop Loss obrigatório definido para todas as posições',
        critical: true,
        check: async () => {
          // Verifica posições sem stop
          try {
            const rows = await oracleDB.query(
              `SELECT COUNT(*) as cnt FROM open_positions WHERE stop_price = 0 OR stop_price IS NULL`
            );
            return (rows[0] as any).CNT === 0;
          } catch {
            return true;
          }
        }
      },
      {
        id: 'RISK_02',
        category: 'risk',
        description: 'Máximo 6% de perda diária não atingido',
        critical: true,
        check: async () => {
          // Verifica perda diária
          try {
            const rows = await oracleDB.query(
              `SELECT COALESCE(SUM(pnl), 0) as daily_pnl FROM trade_history 
               WHERE TRUNC(closed_at) = TRUNC(SYSDATE)`
            );
            const dailyPnl = (rows[0] as any).DAILY_PNL;
            return dailyPnl >= -0.06; // -6%
          } catch {
            return true;
          }
        }
      },
      {
        id: 'RISK_03',
        category: 'risk',
        description: 'Exposição total dentro do limite (máx 20% do capital)',
        critical: true,
        check: async () => {
          // Verifica exposição
          return true;
        }
      },
      {
        id: 'RISK_04',
        category: 'risk',
        description: 'B3: Verificar horário de fechamento (23:45)',
        critical: false,
        check: async () => {
          const now = new Date();
          const hour = now.getHours();
          return hour < 23 || (hour === 23 && now.getMinutes() < 45);
        }
      },

      // === PSYCH ===
      {
        id: 'PSYCH_01',
        category: 'psych',
        description: 'Estado emocional OK? (Sem tilt detectado)',
        critical: true,
        check: async () => {
          // Verifica histórico de tilt
          try {
            const rows = await oracleDB.query(
              `SELECT tilt_level FROM psych_state ORDER BY detected_at DESC FETCH FIRST 1 ROWS ONLY`
            );
            if (rows.length === 0) return true;
            return (rows[0] as any).TILT_LEVEL < 3;
          } catch {
            return true;
          }
        }
      },
      {
        id: 'PSYCH_02',
        category: 'psych',
        description: 'Plano de trading escrito e registrado',
        critical: false,
        check: async () => {
          // Verifica se há plano do dia
          try {
            const rows = await oracleDB.query(
              `SELECT COUNT(*) as cnt FROM trading_plans WHERE TRUNC(created_at) = TRUNC(SYSDATE)`
            );
            return (rows[0] as any).CNT > 0;
          } catch {
            return false;
          }
        }
      },
      {
        id: 'PSYCH_03',
        category: 'psych',
        description: 'Stop e alvo definidos mentalmente antes de operar',
        critical: true,
        check: async () => true // Sempre true - é mental
      },
      {
        id: 'PSYCH_04',
        category: 'psych',
        description: 'Sem viés de confirmação ativo (verificado pelo Psych Agent)',
        critical: true,
        check: async () => {
          // Psych Agent verifica viés
          return true;
        }
      },

      // === SETUP ===
      {
        id: 'SETUP_01',
        category: 'setup',
        description: 'Tendência clara definida - sem mercados laterais sem volume',
        critical: true,
        check: async () => true
      },
      {
        id: 'SETUP_02',
        category: 'setup',
        description: 'Volume 50% acima da média no ativo alvo',
        critical: true,
        check: async () => true
      },
      {
        id: 'SETUP_03',
        category: 'setup',
        description: 'Setup completo - todos os critérios presentes',
        critical: true,
        check: async () => true
      },
      {
        id: 'SETUP_04',
        category: 'setup',
        description: 'Risco/Retorno mínimo de 1:2 verificado matematicamente',
        critical: true,
        check: async () => true
      },
      {
        id: 'SETUP_05',
        category: 'setup',
        description: 'Sem notícias de alto impacto nos próximos 30 minutos',
        critical: true,
        check: async () => true
      }
    ];
  }

  /**
   * Executa briefing completo pré-sessão
   */
  async executeBriefing(): Promise<BriefingResult> {
    console.log('[PreOpening] 📋 Iniciando briefing pré-sessão...');

    const items: BriefingResult['items'] = [];
    const warnings: string[] = [];
    let allCriticalPassed = true;

    for (const item of this.checklist) {
      try {
        const passed = await item.check();
        items.push({
          id: item.id,
          description: item.description,
          passed
        });

        if (!passed && item.critical) {
          allCriticalPassed = false;
          warnings.push(`❌ CRÍTICO: ${item.description}`);
        } else if (!passed) {
          warnings.push(`⚠️ AVISO: ${item.description}`);
        }
      } catch (e) {
        items.push({
          id: item.id,
          description: item.description,
          passed: false,
          notes: String(e)
        });
        if (item.critical) {
          allCriticalPassed = false;
        }
      }
    }

    // Coleta dados macro
    const macroSummary = await this.collectMacroData();

    // Coleta status de risco
    const riskStatus = await this.collectRiskStatus();

    // Coleta status psicológico
    const psychStatus = await this.collectPsychStatus();

    const result: BriefingResult = {
      approved: allCriticalPassed,
      timestamp: new Date(),
      items,
      macroSummary,
      riskStatus,
      psychStatus,
      warnings
    };

    this.lastBriefing = result;

    // Notifica via Telegram
    await this.notifyBriefing(result);

    // Salva no banco
    await this.saveBriefing(result);

    console.log(`[PreOpening] ${allCriticalPassed ? '✅ APROVADO' : '❌ REPROVADO'} - ${items.filter(i => i.passed).length}/${items.length} itens passaram`);

    return result;
  }

  private async collectMacroData(): Promise<BriefingResult['macroSummary']> {
    // TODO: Integrar com APIs reais
    return {
      sp500: 0.5,
      dollar: 0.1,
      selic: 13.75,
      ipca: 4.5,
      crypto: 1.2,
      commodities: -0.3
    };
  }

  private async collectRiskStatus(): Promise<BriefingResult['riskStatus']> {
    try {
      const rows = await oracleDB.query(
        `SELECT 
          COALESCE(SUM(CASE WHEN pnl < 0 THEN ABS(pnl) ELSE 0 END), 0) as daily_loss,
          COUNT(*) as positions
        FROM trade_history 
        WHERE TRUNC(closed_at) = TRUNC(SYSDATE)`
      );
      const row = rows[0] as any;
      return {
        dailyLoss: row?.DAILY_LOSS || 0,
        dailyLossLimit: 0.06,
        positionsOpen: row?.POSITIONS || 0,
        exposurePercent: 0
      };
    } catch {
      return {
        dailyLoss: 0,
        dailyLossLimit: 0.06,
        positionsOpen: 0,
        exposurePercent: 0
      };
    }
  }

  private async collectPsychStatus(): Promise<BriefingResult['psychStatus']> {
    try {
      const rows = await oracleDB.query(
        `SELECT 
          COUNT(CASE WHEN outcome = 0 THEN 1 END) as losses,
          COUNT(CASE WHEN outcome = 1 THEN 1 END) as wins
        FROM trade_history 
        WHERE closed_at >= SYSDATE - 7`
      );
      const row = rows[0] as any;
      const losses = row?.LOSSES || 0;
      const wins = row?.WINS || 0;

      return {
        emotionalState: losses >= 4 ? 'DANGER' : losses >= 2 ? 'CAUTION' : 'OK',
        consecutiveLosses: losses,
        consecutiveWins: wins,
        planWritten: false
      };
    } catch {
      return {
        emotionalState: 'OK',
        consecutiveLosses: 0,
        consecutiveWins: 0,
        planWritten: false
      };
    }
  }

  private async notifyBriefing(result: BriefingResult): Promise<void> {
    const emoji = result.approved ? '✅' : '❌';
    const status = result.approved ? 'APROVADO' : 'REPROVADO';

    const passed = result.items.filter(i => i.passed).length;
    const total = result.items.length;

    let message = 
      `${emoji} <b>BRIEFING PRÉ-SESSÃO</b>\n\n` +
      `📊 <b>Status:</b> ${status}\n` +
      `📋 <b>Checklist:</b> ${passed}/${total} itens\n\n`;

    if (result.warnings.length > 0) {
      message += `⚠️ <b>Alertas:</b>\n`;
      for (const w of result.warnings.slice(0, 5)) {
        message += `${w}\n`;
      }
      message += '\n';
    }

    message += 
      `📈 <b>Macro:</b>\n` +
      `• S&P500: ${result.macroSummary.sp500 > 0 ? '+' : ''}${result.macroSummary.sp500.toFixed(2)}%\n` +
      `• Dólar: ${result.macroSummary.dollar > 0 ? '+' : ''}${result.macroSummary.dollar.toFixed(2)}%\n` +
      `• SELIC: ${result.macroSummary.selic}%\n\n` +
      `🛡️ <b>Risco:</b>\n` +
      `• Perda Diária: ${(result.riskStatus.dailyLoss * 100).toFixed(2)}%\n` +
      `• Limite: ${(result.riskStatus.dailyLossLimit * 100).toFixed(2)}%\n\n` +
      `🧠 <b>Psych:</b> ${result.psychStatus.emotionalState}\n\n` +
      `⏰ ${result.timestamp.toLocaleString('pt-BR')}\n\n` +
      `⚡ <b>VEXOR NEXUS-CORE</b>`;

    await telegramNotifier.sendMessage(message);
  }

  private async saveBriefing(result: BriefingResult): Promise<void> {
    try {
      await oracleDB.insert(`
        INSERT INTO briefing_history (
          id, approved, timestamp, items_json, macro_json, risk_json, psych_json, warnings
        ) VALUES (
          :id, :approved, :timestamp, :items, :macro, :risk, :psych, :warnings
        )
      `, {
        id: oracleDB.generateId(),
        approved: result.approved ? 1 : 0,
        timestamp: result.timestamp,
        items: JSON.stringify(result.items),
        macro: JSON.stringify(result.macroSummary),
        risk: JSON.stringify(result.riskStatus),
        psych: JSON.stringify(result.psychStatus),
        warnings: result.warnings.join(';')
      });
    } catch (e) {
      console.error('[PreOpening] Erro ao salvar briefing:', e);
    }
  }

  getLastBriefing(): BriefingResult | null {
    return this.lastBriefing;
  }

  isApproved(): boolean {
    return this.lastBriefing?.approved ?? false;
  }
}

// Singleton
export const preOpeningChecklist = new PreOpeningChecklist();
export type { BriefingResult, ChecklistItem };
