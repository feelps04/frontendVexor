/**
 * VEXOR Context Memory
 * Aprendizado por reforço — a IA aprende quais contextos funcionam
 * Bloqueia automaticamente contextos com histórico negativo
 */

import * as fs from 'fs';
import * as path from 'path';

// ==================== TYPES ====================

export interface TradeContext {
  strategy: string;    // 'breakout' | 'mean_reversion' | 'trend_follow'
  hour: number;        // 13, 14, 15, 16, 17, 18
  trend: string;       // 'UP' | 'DOWN'
  rsi_zone: string;    // 'HIGH' (>60) | 'MID' (40-60) | 'LOW' (<40)
  volatility: string;  // 'HIGH' | 'LOW'
  regime: string;      // 'TREND' | 'RANGE' | 'VOLATILE'
}

export interface ContextRecord {
  wins: number;
  losses: number;
  last_loss_at: Date | null;
  consecutive_losses: number;
  blocked: boolean;
  block_reason: string;
  blocked_until: Date | null;
  last_updated: Date;
}

export interface ContextCheck {
  allowed: boolean;
  reason: string;
  win_rate: number;
  total_trades: number;
}

// ==================== CONTEXT MEMORY ====================

export class ContextMemory {
  private memory: Map<string, ContextRecord> = new Map();
  private dataDir: string;
  private blockAfterConsecutiveLosses = 2;
  private minTradesForWinRateBlock = 10;
  private minWinRateToAllow = 0.35;
  private cooldownMsAfterBlock = 6 * 60 * 60 * 1000; // 6h

  constructor(dataDir?: string) {
    // Usa sempre um diretório absoluto baseado no cwd do processo
    this.dataDir = dataDir || path.resolve(process.cwd(), '..', 'learning_data');
    this.load();
  }

  // Gera chave única para cada combinação de contexto
  buildKey(ctx: TradeContext): string {
    return `${ctx.strategy}_${ctx.hour}h_${ctx.trend}_${ctx.rsi_zone}_${ctx.volatility}_${ctx.regime}`;
  }

  // Detecta regime de mercado baseado em indicadores
  static detectRegime(indicators: { 
    ema9: number; 
    ema21: number; 
    atr14: number; 
    atr_avg: number;
    bbUpper: number;
    bbLower: number;
    price: number;
  }): string {
    const trendStrength = Math.abs(indicators.ema9 - indicators.ema21) / indicators.atr14;
    const bbWidth = (indicators.bbUpper - indicators.bbLower) / indicators.price;
    
    if (trendStrength > 1.0) return 'TREND';
    if (bbWidth < 0.02) return 'RANGE';
    if (indicators.atr14 > indicators.atr_avg * 1.5) return 'VOLATILE';
    return 'TREND';
  }

  // Detecta zona de RSI
  static detectRsiZone(rsi14: number): string {
    if (rsi14 > 60) return 'HIGH';
    if (rsi14 < 40) return 'LOW';
    return 'MID';
  }

  // Detecta volatilidade
  static detectVolatility(atr14: number, atr_avg: number): string {
    return atr14 > atr_avg ? 'HIGH' : 'LOW';
  }

  // Registra outcome após fechar trade
  record(ctx: TradeContext, outcome: 'WIN' | 'LOSS'): void {
    const key = this.buildKey(ctx);

    if (!this.memory.has(key)) {
      this.memory.set(key, {
        wins: 0,
        losses: 0,
        last_loss_at: null,
        consecutive_losses: 0,
        blocked: false,
        block_reason: '',
        blocked_until: null,
        last_updated: new Date()
      });
    }

    const record = this.memory.get(key)!;

    if (outcome === 'WIN') {
      record.wins++;
      record.consecutive_losses = 0;   // reset sequência
      // WIN não "apaga" bloqueio por win rate baixo; apenas remove bloqueio por sequência
      if (record.block_reason.includes('losses consecutivos')) {
        record.blocked = false;
        record.block_reason = '';
        record.blocked_until = null;
      }
    } else {
      record.losses++;
      record.consecutive_losses++;
      record.last_loss_at = new Date();

      // REGRA 1 — 2 losses consecutivos no mesmo contexto = bloqueia
      if (record.consecutive_losses >= this.blockAfterConsecutiveLosses) {
        record.blocked = true;
        record.block_reason = `${record.consecutive_losses} losses consecutivos`;
        record.blocked_until = new Date(Date.now() + this.cooldownMsAfterBlock);
      }

      // REGRA 2 — win rate abaixo de 35% com 10+ trades = bloqueia
      const total = record.wins + record.losses;
      const wr = record.wins / total;
      if (total >= this.minTradesForWinRateBlock && wr < this.minWinRateToAllow) {
        record.blocked = true;
        record.block_reason = `Win rate ${(wr * 100).toFixed(1)}% com ${total} trades`;
        record.blocked_until = null;
      }
    }

    record.last_updated = new Date();
    this.memory.set(key, record);
    
    console.log(`[ContextMemory] ${outcome} → ${key} (W:${record.wins} L:${record.losses})`);
    
    // Salva após cada registro
    this.save();
  }

  // Verifica se pode operar nesse contexto
  canTrade(ctx: TradeContext): ContextCheck {
    const key = this.buildKey(ctx);
    const record = this.memory.get(key);

    // Contexto novo — sem histórico — permite com cautela
    if (!record) {
      return { 
        allowed: true, 
        reason: 'Contexto novo — monitorando', 
        win_rate: 0.5,
        total_trades: 0
      };
    }

    // Bloqueado por losses consecutivos ou win rate baixo
    if (record.blocked) {
      if (record.blocked_until && Date.now() >= record.blocked_until.getTime()) {
        // Expirou o cooldown: libera e zera apenas a sequência
        record.blocked = false;
        record.block_reason = '';
        record.consecutive_losses = 0;
        record.blocked_until = null;
        record.last_updated = new Date();
        this.memory.set(key, record);
        this.save();
      }
    }

    if (record.blocked) {
      return { 
        allowed: false, 
        reason: record.block_reason, 
        win_rate: this.getWinRate(key),
        total_trades: record.wins + record.losses
      };
    }

    const total = record.wins + record.losses;
    const win_rate = total > 0 ? record.wins / total : 0.5;

    return { 
      allowed: true, 
      reason: 'Contexto aprovado', 
      win_rate,
      total_trades: total
    };
  }

  // Calcula win rate de um contexto
  private getWinRate(key: string): number {
    const r = this.memory.get(key);
    if (!r) return 0.5;
    const total = r.wins + r.losses;
    return total > 0 ? r.wins / total : 0.5;
  }

  // Relatório completo — mostra o que a IA aprendeu
  report(): void {
    console.log('\n=== CONTEXT MEMORY — O QUE A IA APRENDEU ===\n');

    const entries = Array.from(this.memory.entries())
      .sort((a, b) => (b[1].wins + b[1].losses) - (a[1].wins + a[1].losses));

    if (entries.length === 0) {
      console.log('Nenhum contexto registrado ainda.');
      return;
    }

    for (const [key, record] of entries) {
      const total = record.wins + record.losses;
      if (total < 3) continue;  // ignora contextos com poucos dados

      const wr = (record.wins / total * 100).toFixed(1);
      const status = record.blocked ? '🔴 BLOQUEADO' : '🟢 ATIVO';

      console.log(`${status} | ${key}`);
      console.log(`  W:${record.wins} L:${record.losses} WR:${wr}% | ${record.block_reason || 'OK'}`);
    }
  }

  // Retorna todos os contextos bloqueados
  getBlockedContexts(): string[] {
    const blocked: string[] = [];
    for (const [key, record] of this.memory.entries()) {
      if (record.blocked) {
        blocked.push(`${key} — ${record.block_reason}`);
      }
    }
    return blocked;
  }

  // Retorna estatísticas gerais
  getStats(): { 
    totalContexts: number; 
    blockedContexts: number; 
    totalWins: number; 
    totalLosses: number;
    overallWinRate: number;
  } {
    let totalWins = 0;
    let totalLosses = 0;
    let blockedContexts = 0;

    for (const record of this.memory.values()) {
      totalWins += record.wins;
      totalLosses += record.losses;
      if (record.blocked) blockedContexts++;
    }

    const total = totalWins + totalLosses;

    return {
      totalContexts: this.memory.size,
      blockedContexts,
      totalWins,
      totalLosses,
      overallWinRate: total > 0 ? totalWins / total : 0
    };
  }

  // Persiste memória em arquivo
  save(): void {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
        console.log(`[ContextMemory] Diretório criado: ${this.dataDir}`);
      }

      const data: Record<string, any> = {};
      for (const [key, record] of this.memory.entries()) {
        data[key] = {
          wins: record.wins,
          losses: record.losses,
          last_loss_at: record.last_loss_at?.toISOString() || null,
          consecutive_losses: record.consecutive_losses,
          blocked: record.blocked,
          block_reason: record.block_reason,
          blocked_until: record.blocked_until?.toISOString() || null,
          last_updated: record.last_updated.toISOString()
        };
      }

      const file = path.join(this.dataDir, 'context_memory.json');
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
      console.log(`[ContextMemory] Salvo: ${this.memory.size} contextos em ${file}`);
    } catch (e) {
      console.error('[ContextMemory] Erro ao salvar:', e);
    }
  }

  // Carrega memória de arquivo
  load(): void {
    try {
      const file = path.join(this.dataDir, 'context_memory.json');

      if (!fs.existsSync(file)) {
        console.log('[ContextMemory] Nenhum histórico encontrado — iniciando do zero');
        return;
      }

      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      
      for (const [key, record] of Object.entries(data)) {
        const r = record as any;
        this.memory.set(key, {
          wins: r.wins,
          losses: r.losses,
          last_loss_at: r.last_loss_at ? new Date(r.last_loss_at) : null,
          consecutive_losses: r.consecutive_losses,
          blocked: r.blocked,
          block_reason: r.block_reason,
          blocked_until: r.blocked_until ? new Date(r.blocked_until) : null,
          last_updated: new Date(r.last_updated)
        });
      }

      console.log(`[ContextMemory] ✅ Memória carregada: ${this.memory.size} contextos`);
      const stats = this.getStats();
      console.log(`[ContextMemory] 📊 W:${stats.totalWins} L:${stats.totalLosses} WR:${(stats.overallWinRate * 100).toFixed(1)}% | Bloqueados: ${stats.blockedContexts}`);
    } catch (e) {
      console.error('[ContextMemory] Erro ao carregar:', e);
    }
  }

  // Limpa memória (cuidado!)
  clear(): void {
    this.memory.clear();
    this.save();
    console.log('[ContextMemory] Memória limpa');
  }
}

// ==================== SINGLETON ====================

let contextMemory: ContextMemory | null = null;

export function getContextMemory(): ContextMemory {
  if (!contextMemory) {
    contextMemory = new ContextMemory();
  }
  return contextMemory;
}
