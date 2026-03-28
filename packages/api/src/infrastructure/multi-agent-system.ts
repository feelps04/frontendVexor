/**
 * VEXOR Multi-Agent System — UNIÃO
 * 5 Agentes especializados em sistema de votação com consenso mínimo
 * "Sozinhos cada agente tem edge parcial. Unidos, filtram os trades ruins e amplificam os bons."
 */

import * as fs from 'fs';
import * as path from 'path';

// ==================== TYPES ====================

export type AgentVoteType = 'BUY' | 'SELL' | 'HOLD';
export type AgentName = 'b3' | 'cripto' | 'forex' | 'psico' | 'macro';

export interface AgentVote {
  agent: AgentName;
  direction: AgentVoteType;
  confidence: number;  // 0.0 – 1.0
  reason: string;
}

export interface MacroState {
  sp500_change_pct: number;    // % no dia
  vix: number;                 // índice de medo
  usdbrl_change_pct: number;   // % dólar no dia
  selic_last_change: number;   // última mudança bps
  usdbrl_trend: 'UP' | 'DOWN' | 'SIDE';
  usdbrl_strength: number;     // 0.0 – 1.0
  selic_rate?: number;         // taxa atual
  ipca?: number;               // inflação
}

export interface PsychState {
  tiltLevel: 0 | 1 | 2 | 3 | 4;  // L0 = calmo, L4 = tilt extremo
  consecutiveLosses: number;
  consecutiveWins: number;
}

export interface DayStats {
  trades: number;
  wins: number;
  losses: number;
  consecutiveLosses: number;
  consecutiveWins: number;
}

export interface Indicators {
  price: number;
  bbUpper: number;
  bbLower: number;
  bbMid: number;
  bbWidthAvg: number;
  prevSqueezeOn: boolean;
  ema9: number;
  ema21: number;
  atr14: number;
  rsi14: number;
  volume: number;
  avgVol: number;
  timestamp: number;
  symbol: string;
}

// Compatibilidade com learning-pipeline
export interface MarketContext {
  symbol: string;
  market: 'B3' | 'CRIPTO' | 'FOREX';
  price: number;
  volume: number;
  volatility: number;
  trend: 'UP' | 'DOWN' | 'SIDE';
  hour: number;
  dayOfWeek: number;
  ema9: number;
  ema21: number;
  rsi14: number;
  atr14: number;
  bbUpper: number;
  bbLower: number;
  bbMid: number;
  selic?: number;
  cdi?: number;
  ipca?: number;
  sp500?: number;
  dxy?: number;
  nikkei?: number;
  dax?: number;
  consecutiveLosses: number;
  dailyTrades: number;
  dailyWinRate: number;
  weeklyWinRate: number;
}

export interface ErrorMemoryRecord {
  key: string;
  blocked: boolean;
  blockReason: string;
  consecutiveErrors: number;
  lastErrorAt: Date | null;
  totalErrors: number;
  cooldownUntil: Date | null;
}

// ==================== SISTEMA DE VOTAÇÃO — UNIÃO ====================

const WEIGHTS: Record<AgentName, number> = {
  b3: 0.30,
  cripto: 0.25,
  forex: 0.25,
  psico: 0.20,
  macro: 0  // Macro não vota, apenas veta
};

const THRESHOLD = 0.70;  // Normalizado: 70% de consenso mínimo

export interface AggregateResult {
  execute: boolean;
  direction: AgentVoteType;
  score: number;
  votes: AgentVote[];
  veto: boolean;
  vetoReason: string;
  consensusCount: number;
}

export function aggregateVotes(
  macroVeto: boolean,
  vetoReason: string,
  votes: AgentVote[]
): AggregateResult {

  // Macro tem poder de veto absoluto
  if (macroVeto) {
    return { 
      execute: false, 
      direction: 'HOLD', 
      score: 0, 
      votes, 
      veto: true, 
      vetoReason,
      consensusCount: 0
    };
  }

  let score = 0;
  let maxPossible = 0;

  for (const vote of votes) {
    const weight = WEIGHTS[vote.agent];
    const direction = vote.direction === 'BUY' ? 1 : vote.direction === 'SELL' ? -1 : 0;
    
    // Score bruto
    score += direction * weight * vote.confidence;
    
    // Máximo que esse voto poderia contribuir (só se tem opinião)
    if (vote.direction !== 'HOLD') {
      maxPossible += weight * vote.confidence;
    }
  }

  // Normaliza — score relativo ao máximo possível
  // HOLD não penaliza nem ajuda, só agentes com opinião contam
  const normalizedScore = maxPossible > 0 ? score / maxPossible : 0;

  // Contar consenso
  const buyCount = votes.filter(v => v.direction === 'BUY').length;
  const sellCount = votes.filter(v => v.direction === 'SELL').length;
  const consensusCount = Math.max(buyCount, sellCount);

  // Threshold normalizado: 0.70 = 70% do consenso possível
  if (normalizedScore > THRESHOLD) {
    return { execute: true, direction: 'BUY', score: normalizedScore, votes, veto: false, vetoReason: '', consensusCount };
  }
  if (normalizedScore < -THRESHOLD) {
    return { execute: true, direction: 'SELL', score: normalizedScore, votes, veto: false, vetoReason: '', consensusCount };
  }
  return { execute: false, direction: 'HOLD', score: normalizedScore, votes, veto: false, vetoReason: '', consensusCount };
}

// ==================== AGENTE MACRO — VETO ABSOLUTO ====================

export function macroVeto(state: MacroState): { veto: boolean; reason: string } {

  // S&P500 em queda sistêmica
  if (state.sp500_change_pct < -2.0) {
    return { veto: true, reason: 'S&P500 em queda sistêmica' };
  }

  // VIX > 30 — medo extremo
  if (state.vix > 30) {
    return { veto: true, reason: 'VIX > 30 — medo extremo' };
  }

  // Dólar +1.5% — fuga de capital
  if (state.usdbrl_change_pct > 1.5) {
    return { veto: true, reason: 'Dólar +1.5% — fuga de capital' };
  }

  // SELIC subindo > 0.5% (50 bps)
  if (state.selic_last_change > 50) {
    return { veto: true, reason: 'SELIC subindo — aperto monetário' };
  }

  // IPCA acima do teto da meta (4.5% + 1.5% = 6%)
  if (state.ipca && state.ipca > 6) {
    return { veto: false, reason: 'IPCA alto — reduzir exposição' };
  }

  return { veto: false, reason: 'Macro OK — operar' };
}

// ==================== AGENTE B3 — Reversão à Média ====================

export function b3Vote(context: MarketContext): AgentVote {
  // Distância da banda média
  const bbRange = context.bbUpper - context.bbLower;
  const bbMid = (context.bbUpper + context.bbLower) / 2;
  const deviation = (context.price - bbMid) / bbRange; // -0.5 a 0.5
  
  // Reversão à média: preço acima/abaixo da média
  if (deviation > 0.48) {
    return { agent: 'b3', direction: 'SELL', confidence: 0.95, reason: 'Preço acima da média' };
  }

  if (deviation < -0.48) {
    return { agent: 'b3', direction: 'BUY', confidence: 0.95, reason: 'Preço abaixo da média' };
  }

  return { agent: 'b3', direction: 'HOLD', confidence: 0, reason: 'Preço na média' };
}

// ==================== AGENTE CRIPTO — Reversão à Média ====================

export function criptoVote(context: MarketContext): AgentVote {
  // Distância da banda média
  const bbRange = context.bbUpper - context.bbLower;
  const bbMid = (context.bbUpper + context.bbLower) / 2;
  const deviation = (context.price - bbMid) / bbRange; // -0.5 a 0.5
  
  // Reversão à média
  if (deviation > 0.48) {
    return { agent: 'cripto', direction: 'SELL', confidence: 0.95, reason: 'Preço acima da média' };
  }

  if (deviation < -0.48) {
    return { agent: 'cripto', direction: 'BUY', confidence: 0.95, reason: 'Preço abaixo da média' };
  }

  return { agent: 'cripto', direction: 'HOLD', confidence: 0, reason: 'Preço na média' };
}

// ==================== AGENTE FOREX — Reversão à Média ====================

export function forexVote(context: MarketContext, macro: MacroState): AgentVote {
  // Distância da banda média
  const bbRange = context.bbUpper - context.bbLower;
  const bbMid = (context.bbUpper + context.bbLower) / 2;
  const deviation = (context.price - bbMid) / bbRange; // -0.5 a 0.5
  
  // Reversão à média
  if (deviation > 0.48) {
    return { agent: 'forex', direction: 'SELL', confidence: 0.95, reason: 'Preço acima da média' };
  }

  if (deviation < -0.48) {
    return { agent: 'forex', direction: 'BUY', confidence: 0.95, reason: 'Preço abaixo da média' };
  }

  return { agent: 'forex', direction: 'HOLD', confidence: 0, reason: 'Preço na média' };
}

// ==================== AGENTE PSICO — Anti-Tilt Douglas/Kahneman ====================

export function psicoVote(psychState: PsychState, todayStats: DayStats, dominantDirection: AgentVoteType = 'HOLD'): AgentVote {

  // Tilt alto = não vota, bloqueia entrada
  if (psychState.tiltLevel >= 3) {
    return { agent: 'psico', direction: 'HOLD', confidence: 0, reason: `Tilt L${psychState.tiltLevel} — bloqueado` };
  }

  // Overtrading — já operou demais hoje
  if (todayStats.trades >= 8) {
    return { agent: 'psico', direction: 'HOLD', confidence: 0, reason: `Overtrading — ${todayStats.trades} trades hoje` };
  }

  // Losses consecutivos — reduz confiança mas não bloqueia
  let confidence = 0.65;
  if (todayStats.consecutiveLosses >= 3) {
    confidence = 0.35;  // freia mas não bloqueia
  }
  if (todayStats.consecutiveLosses >= 5) {
    confidence = 0;
    return { agent: 'psico', direction: 'HOLD', confidence: 0, reason: '5+ losses — pausar operações' };
  }

  // Streak positivo — aumenta confiança levemente
  if (todayStats.consecutiveWins >= 3) {
    confidence = Math.min(0.80, confidence * 1.10);
  }

  // Psico confirma a direção dominante dos outros agentes
  if (dominantDirection !== 'HOLD') {
    return { agent: 'psico', direction: dominantDirection, confidence, reason: `Psico OK — confirma ${dominantDirection}` };
  }

  return { agent: 'psico', direction: 'HOLD', confidence, reason: 'Sem direção clara para confirmar' };
}

// ==================== ERROR MEMORY CACHE (RAM) ====================

export class ErrorMemoryCache {
  private cache: Map<string, ErrorMemoryRecord> = new Map();
  private maxSize = 1000;
  private defaultCooldownMs = 6 * 60 * 60 * 1000; // 6h

  buildKey(context: Partial<MarketContext>): string {
    return `${context.market}_${context.symbol}_${context.hour}h_${context.trend}`;
  }

  recordError(key: string, reason: string): void {
    const existing = this.cache.get(key);
    
    if (existing) {
      existing.consecutiveErrors++;
      existing.totalErrors++;
      existing.lastErrorAt = new Date();
      existing.blocked = existing.consecutiveErrors >= 2;
      if (existing.blocked) {
        existing.blockReason = `${existing.consecutiveErrors} erros consecutivos: ${reason}`;
        existing.cooldownUntil = new Date(Date.now() + this.defaultCooldownMs);
      }
    } else {
      this.cache.set(key, {
        key,
        blocked: false,
        blockReason: '',
        consecutiveErrors: 1,
        lastErrorAt: new Date(),
        totalErrors: 1,
        cooldownUntil: null
      });
    }

    if (this.cache.size > this.maxSize) {
      const oldestKey = this.findOldestKey();
      if (oldestKey) this.cache.delete(oldestKey);
    }
  }

  recordSuccess(key: string): void {
    const existing = this.cache.get(key);
    if (existing) {
      existing.consecutiveErrors = 0;
      existing.blocked = false;
      existing.blockReason = '';
      existing.cooldownUntil = null;
    }
  }

  isBlocked(key: string): { blocked: boolean; reason: string } {
    const record = this.cache.get(key);
    
    if (!record) {
      return { blocked: false, reason: '' };
    }

    if (record.cooldownUntil && Date.now() >= record.cooldownUntil.getTime()) {
      record.blocked = false;
      record.blockReason = '';
      record.consecutiveErrors = 0;
      record.cooldownUntil = null;
    }

    return {
      blocked: record.blocked,
      reason: record.blockReason
    };
  }

  getStats(): { totalEntries: number; blockedEntries: number; totalErrors: number } {
    let blockedEntries = 0;
    let totalErrors = 0;
    
    for (const record of this.cache.values()) {
      if (record.blocked) blockedEntries++;
      totalErrors += record.totalErrors;
    }

    return {
      totalEntries: this.cache.size,
      blockedEntries,
      totalErrors
    };
  }

  private findOldestKey(): string | null {
    let oldest: string | null = null;
    let oldestTime = Date.now();
    
    for (const [key, record] of this.cache.entries()) {
      if (record.lastErrorAt && record.lastErrorAt.getTime() < oldestTime) {
        oldestTime = record.lastErrorAt.getTime();
        oldest = key;
      }
    }
    
    return oldest;
  }

  clear(): void {
    this.cache.clear();
  }
}

// ==================== UNION ORCHESTRATOR — CONSENSO 3/5 ====================

export class UnionOrchestrator {
  private errorMemory: ErrorMemoryCache;
  
  private readonly MIN_CONSENSUS = 3;

  constructor() {
    this.errorMemory = new ErrorMemoryCache();
  }

  /**
   * Executa votação em união — consenso 3/5
   */
  evaluate(context: MarketContext): AggregateResult {
    const votes: AgentVote[] = [];
    
    // 1. MACRO VETO CHECK
    const macroState: MacroState = {
      sp500_change_pct: context.sp500 ?? 0,
      vix: 15,  // Default normal
      usdbrl_change_pct: context.dxy ?? 0,
      selic_last_change: 0,
      usdbrl_trend: context.dxy && context.dxy > 0 ? 'UP' : context.dxy && context.dxy < 0 ? 'DOWN' : 'SIDE',
      usdbrl_strength: Math.abs(context.dxy ?? 0) / 2,
      selic_rate: context.selic,
      ipca: context.ipca
    };
    
    const { veto, reason: vetoReason } = macroVeto(macroState);
    
    if (veto) {
      console.log(`[UNIÃO] 🚫 VETO MACRO: ${vetoReason}`);
      return aggregateVotes(true, vetoReason, []);
    }

    // 2. B3 VOTE — vota em qualquer mercado
    votes.push(b3Vote(context));

    // 3. CRIPTO VOTE — vota em qualquer mercado
    votes.push(criptoVote(context));

    // 4. FOREX VOTE — vota em qualquer mercado
    votes.push(forexVote(context, macroState));

    // 5. CALCULAR DIREÇÃO DOMINANTE para o Psico
    let buyScore = 0;
    let sellScore = 0;
    for (const v of votes) {
      if (v.direction === 'BUY') buyScore += WEIGHTS[v.agent] * v.confidence;
      else if (v.direction === 'SELL') sellScore += WEIGHTS[v.agent] * v.confidence;
    }
    const dominantDirection: AgentVoteType = buyScore > sellScore ? 'BUY' : sellScore > buyScore ? 'SELL' : 'HOLD';

    // 6. PSICO VOTE — confirma direção dominante
    const psychState: PsychState = {
      tiltLevel: context.consecutiveLosses >= 5 ? 4 : 
                 context.consecutiveLosses >= 3 ? 3 :
                 context.consecutiveLosses >= 2 ? 2 :
                 context.consecutiveLosses >= 1 ? 1 : 0,
      consecutiveLosses: context.consecutiveLosses,
      consecutiveWins: 0
    };
    
    const dayStats: DayStats = {
      trades: context.dailyTrades,
      wins: Math.floor(context.dailyTrades * context.dailyWinRate),
      losses: Math.floor(context.dailyTrades * (1 - context.dailyWinRate)),
      consecutiveLosses: context.consecutiveLosses,
      consecutiveWins: 0
    };
    
    votes.push(psicoVote(psychState, dayStats, dominantDirection));

    // 7. AGGREGATE
    const result = aggregateVotes(false, '', votes);

    return result;
  }

  recordOutcome(context: MarketContext, outcome: 'WIN' | 'LOSS'): void {
    const key = this.errorMemory.buildKey(context);
    
    if (outcome === 'LOSS') {
      this.errorMemory.recordError(key, 'Trade com prejuízo');
    } else {
      this.errorMemory.recordSuccess(key);
    }
  }

  getStats(): { totalEntries: number; blockedEntries: number; totalErrors: number } {
    return this.errorMemory.getStats();
  }

  clearMemory(): void {
    this.errorMemory.clear();
  }
}

// ==================== SINGLETON ====================

let orchestrator: UnionOrchestrator | null = null;

export function getUnionOrchestrator(): UnionOrchestrator {
  if (!orchestrator) {
    orchestrator = new UnionOrchestrator();
  }
  return orchestrator;
}

// Alias para compatibilidade
export const getAgentOrchestrator = getUnionOrchestrator;
export type AgentOrchestrator = UnionOrchestrator;
