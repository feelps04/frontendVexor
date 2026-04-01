/**
 * Auto-Learner - Sistema de Aprendizado Automático 100% RAM
 * Latência 0 para operação em tempo real
 * Persistência via snapshot periódico para JSON
 * 
 * FLUXO:
 * 1. Registra experiências em RAM (0ms)
 * 2. Identifica padrões em RAM (0ms)
 * 3. Promove S2 → S1 em RAM (0ms)
 * 4. Snapshot periódico para disco (background)
 * 5. Carrega padrões salvos na inicialização
 */

import { hybridAI } from './rag-service.js';
import * as fs from 'fs';
import * as path from 'path';

interface Experience {
  id: string;
  query: string;
  response: string;
  system: 'S1' | 'S2';
  feedback?: 'positive' | 'negative';
  timestamp: number;
  pnl?: number;
}

interface PatternCandidate {
  name: string;
  trigger: string;
  response: string;
  confidence: number;
  occurrences: number;
  avgPnL: number;
  traits: string[];
}

interface Snapshot {
  version: string;
  timestamp: number;
  experiences: Experience[];
  patterns: Array<{
    trigger: string;
    response: string;
    confidence: number;
    learnedFrom: string;
  }>;
  stats: {
    totalExperiences: number;
    patternsCreatedToday: number;
  };
}

export class AutoLearner {
  // ==================== MEMÓRIA RAM (0 LATÊNCIA) ====================
  
  private experiences: Experience[] = []; // Histórico em RAM
  private patternsCreatedToday = 0;
  private lastResetDate = new Date().toDateString();
  
  // Configuração
  private minOccurrences = 3;
  private minConfidence = 0.70;
  private maxPatternsPerDay = 5;
  private rollbackThreshold = 0.30;
  
  // Persistência
  private snapshotPath = path.join(process.cwd(), 'data', 'auto-learner-snapshot.json');
  private snapshotInterval: NodeJS.Timeout | null = null;
  
  // Scheduler
  private schedulerInterval: NodeJS.Timeout | null = null;
  private rollbackInterval: NodeJS.Timeout | null = null;
  private monitorInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  
  constructor() {
    // Carrega snapshot salvo na inicialização
    this.loadSnapshot();
  }
  
  // ==================== PERSISTÊNCIA AUTOMÁTICA ====================
  
  /**
   * Salva snapshot para disco (background, não bloqueia)
   */
  private saveSnapshot(): void {
    try {
      const skillRegistry = (hybridAI as any).skillRegistry;
      const patterns = skillRegistry.system1Patterns || [];
      
      const snapshot: Snapshot = {
        version: '1.0',
        timestamp: Date.now(),
        experiences: this.experiences.slice(-5000), // Últimas 5000
        patterns: patterns.map((p: any) => ({
          trigger: p.trigger?.toString() || '',
          response: p.response?.toString() || '',
          confidence: p.confidence || 0.7,
          learnedFrom: p.learnedFrom || 'unknown'
        })),
        stats: {
          totalExperiences: this.experiences.length,
          patternsCreatedToday: this.patternsCreatedToday
        }
      };
      
      // Garante diretório existe
      const dir = path.dirname(this.snapshotPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // Salva assíncrono (não bloqueia)
      fs.promises.writeFile(this.snapshotPath, JSON.stringify(snapshot, null, 2))
        .then(() => console.log(`[AutoLearner] 💾 Snapshot salvo: ${patterns.length} padrões, ${this.experiences.length} experiências`))
        .catch(e => console.error('[AutoLearner] ❌ Erro ao salvar snapshot:', e));
        
    } catch (e) {
      console.error('[AutoLearner] ❌ Erro no snapshot:', e);
    }
  }
  
  /**
   * Carrega snapshot salvo na inicialização
   */
  private loadSnapshot(): void {
    try {
      if (!fs.existsSync(this.snapshotPath)) {
        console.log('[AutoLearner] 📄 Nenhum snapshot encontrado, iniciando do zero');
        return;
      }
      
      const data = fs.readFileSync(this.snapshotPath, 'utf-8');
      const snapshot: Snapshot = JSON.parse(data);
      
      // Restaura experiências
      this.experiences = snapshot.experiences || [];
      
      // Restaura padrões S1
      const skillRegistry = (hybridAI as any).skillRegistry;
      for (const pattern of snapshot.patterns || []) {
        if (pattern.trigger && pattern.response) {
          skillRegistry.addSystem1Pattern({
            trigger: pattern.trigger,
            response: pattern.response,
            confidence: pattern.confidence,
            learnedFrom: pattern.learnedFrom
          });
        }
      }
      
      console.log(`[AutoLearner] 🔄 Snapshot restaurado: ${snapshot.patterns?.length || 0} padrões, ${this.experiences.length} experiências`);
      
    } catch (e) {
      console.log('[AutoLearner] ⚠️ Erro ao carregar snapshot, iniciando do zero:', e);
    }
  }
  
  /**
   * Registra experiência em RAM (0ms)
   */
  recordExperience(exp: Omit<Experience, 'id' | 'timestamp'>): void {
    const experience: Experience = {
      ...exp,
      id: `exp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now()
    };
    
    this.experiences.push(experience);
    
    // Limita histórico a 10000 experiências em RAM
    if (this.experiences.length > 10000) {
      this.experiences = this.experiences.slice(-5000);
    }
    
    console.log(`[AutoLearner] 📝 Experiência registrada em RAM: ${exp.system} | Total: ${this.experiences.length}`);
  }
  
  /**
   * Registra feedback em RAM (0ms)
   */
  recordFeedback(experienceId: string, feedback: 'positive' | 'negative', pnl?: number): void {
    const exp = this.experiences.find(e => e.id === experienceId);
    if (exp) {
      exp.feedback = feedback;
      exp.pnl = pnl;
      console.log(`[AutoLearner] ✅ Feedback ${feedback} registrado em RAM`);
      
      // Se positivo, considera promoção imediata
      if (feedback === 'positive' && exp.system === 'S2') {
        this.considerPromotion(exp);
      }
    }
  }
  
  /**
   * Considera promoção S2 → S1 (0ms)
   */
  private considerPromotion(exp: Experience): void {
    this.checkDailyReset();
    
    if (this.patternsCreatedToday >= this.maxPatternsPerDay) {
      return;
    }
    
    // Cria padrão S1 diretamente em RAM
    const trigger = exp.query.toLowerCase().split(' ').slice(0, 3).join(' ');
    
    const skillRegistry = (hybridAI as any).skillRegistry;
    skillRegistry.addSystem1Pattern({
      trigger,
      response: exp.response,
      confidence: 0.75,
      learnedFrom: 'ram_auto'
    });
    
    this.patternsCreatedToday++;
    console.log(`[AutoLearner] 🚀 Promoção instantânea S2→S1: "${trigger}" (${this.patternsCreatedToday}/${this.maxPatternsPerDay})`);
  }
  
  /**
   * Processa losses em RAM (0ms)
   */
  async processLosses(): Promise<PatternCandidate[]> {
    console.log('[AutoLearner] 🔍 Processando losses da RAM...');
    
    const losses = this.experiences.filter(e => e.feedback === 'negative');
    
    console.log(`[AutoLearner] 📊 ${losses.length} losses em RAM | ${this.experiences.length} total`);
    
    if (losses.length < this.minOccurrences) {
      console.log('[AutoLearner] ⚠️ Poucos losses para aprender');
      return [];
    }
    
    // Identifica traços comuns em RAM
    const traits = new Map<string, { count: number; avgPnL: number }>();
    
    for (const loss of losses) {
      const hour = new Date(loss.timestamp).getHours();
      
      // Violino
      if (hour >= 12 && hour < 14) {
        const existing = traits.get('hour_violino') || { count: 0, avgPnL: 0 };
        traits.set('hour_violino', { count: existing.count + 1, avgPnL: 0 });
      }
      
      // Abertura
      if (hour >= 9 && hour < 10) {
        const existing = traits.get('hour_abertura') || { count: 0, avgPnL: 0 };
        traits.set('hour_abertura', { count: existing.count + 1, avgPnL: 0 });
      }
    }
    
    // Gera candidatos
    const candidates: PatternCandidate[] = [];
    for (const [trait, data] of traits) {
      if (data.count >= this.minOccurrences) {
        candidates.push({
          name: this.generatePatternName(trait),
          trigger: this.generateTrigger(trait),
          response: this.generateResponse(trait, data),
          confidence: Math.min(0.85, 0.6 + data.count * 0.05),
          occurrences: data.count,
          avgPnL: data.avgPnL,
          traits: [trait]
        });
      }
    }
    
    // Promove para S1 em RAM
    const promoted = await this.promotePatterns(candidates);
    return promoted;
  }
  
  /**
   * Executa rollback em RAM (0ms)
   */
  async rollbackBadPatterns(): Promise<{ removed: number; kept: number }> {
    console.log('[AutoLearner] 🔍 Verificando padrões para rollback...');
    
    // Busca padrões com feedback negativo em RAM
    const negativeExperiences = this.experiences.filter(e => e.feedback === 'negative');
    
    // Agrupa por query similar
    const patternStats = new Map<string, { wins: number; losses: number }>();
    
    for (const exp of negativeExperiences) {
      const trigger = exp.query.toLowerCase().split(' ').slice(0, 3).join(' ');
      const stats = patternStats.get(trigger) || { wins: 0, losses: 0 };
      if (exp.feedback === 'positive') stats.wins++;
      if (exp.feedback === 'negative') stats.losses++;
      patternStats.set(trigger, stats);
    }
    
    let removed = 0;
    const skillRegistry = (hybridAI as any).skillRegistry;
    const patterns = skillRegistry.system1Patterns;
    
    for (const [trigger, stats] of patternStats) {
      const total = stats.wins + stats.losses;
      const wr = total > 0 ? stats.wins / total : 1;
      
      if (wr < this.rollbackThreshold && total >= 5) {
        // Remove de RAM
        const idx = patterns.findIndex((p: any) => 
          p.trigger.toString().toLowerCase().includes(trigger)
        );
        
        if (idx >= 0) {
          patterns.splice(idx, 1);
          console.log(`[AutoLearner] ❌ Rollback: "${trigger}" (WR: ${(wr * 100).toFixed(1)}%)`);
          removed++;
        }
      }
    }
    
    console.log(`[AutoLearner] 📊 Rollback: ${removed} removidos`);
    return { removed, kept: 0 };
  }
  
  /**
   * Promove padrões em RAM (0ms)
   */
  private async promotePatterns(candidates: PatternCandidate[]): Promise<PatternCandidate[]> {
    const promoted: PatternCandidate[] = [];
    
    this.checkDailyReset();
    
    for (const candidate of candidates) {
      if (this.patternsCreatedToday >= this.maxPatternsPerDay) {
        console.log(`[AutoLearner] ⚠️ Limite diário atingido (${this.maxPatternsPerDay} padrões/dia)`);
        break;
      }
      
      const skillRegistry = (hybridAI as any).skillRegistry;
      
      skillRegistry.addSystem1Pattern({
        trigger: candidate.trigger,
        response: candidate.response,
        confidence: candidate.confidence,
        learnedFrom: 'ram_auto'
      });
      
      promoted.push(candidate);
      this.patternsCreatedToday++;
      console.log(`[AutoLearner] 🎓 Promovido S2→S1 em RAM: ${candidate.name} (${this.patternsCreatedToday}/${this.maxPatternsPerDay})`);
    }
    
    return promoted;
  }
  
  /**
   * Monitora WinRate em RAM (0ms)
   */
  private async monitorWinRate(): Promise<void> {
    const last24h = this.experiences.filter(e => 
      Date.now() - e.timestamp < 24 * 60 * 60 * 1000
    );
    
    if (last24h.length < 5) {
      console.log('[AutoLearner] 📊 Monitor: Dados insuficientes em RAM');
      return;
    }
    
    const wins = last24h.filter(e => e.feedback === 'positive').length;
    const losses = last24h.filter(e => e.feedback === 'negative').length;
    const total = wins + losses;
    const wr = total > 0 ? wins / total : 0;
    
    // Alerta se WR crítico
    if (wr < 0.35 && total >= 10) {
      console.log(`[AutoLearner] 🚨 ALERTA: WR 24h = ${(wr * 100).toFixed(1)}% (${total} trades)`);
      
      const skillRegistry = (hybridAI as any).skillRegistry;
      skillRegistry.addSystem1Pattern({
        trigger: 'wr critico',
        response: `🚨 ALERTA: WinRate 24h = ${(wr * 100).toFixed(1)}%. Pare de operar. Revise setup.`,
        confidence: 0.95,
        learnedFrom: 'monitor_auto'
      });
    }
    
    console.log(`[AutoLearner] 📊 Monitor RAM: WR 24h = ${(wr * 100).toFixed(1)}% | ${wins}W/${losses}L (${total} trades)`);
  }
  
  // ==================== SCHEDULER 24/7 ====================
  
  /**
   * Inicia scheduler 24/7 automático
   */
  startScheduler() {
    if (this.isRunning) {
      console.log('[AutoLearner] ⚠️ Scheduler já está rodando');
      return;
    }
    
    this.isRunning = true;
    
    // 1. Auto-aprendizado a cada 1 hora
    this.schedulerInterval = setInterval(async () => {
      try {
        console.log('[AutoLearner] ⏰ Executando ciclo horário...');
        await this.processLosses();
      } catch (e) {
        console.error('[AutoLearner] ❌ Erro no ciclo horário:', e);
      }
    }, 60 * 60 * 1000);
    
    // 2. Rollback a cada 6 horas
    this.rollbackInterval = setInterval(async () => {
      try {
        console.log('[AutoLearner] ⏰ Executando rollback check...');
        await this.rollbackBadPatterns();
      } catch (e) {
        console.error('[AutoLearner] ❌ Erro no rollback:', e);
      }
    }, 6 * 60 * 60 * 1000);
    
    // 3. Monitoramento de WR a cada 15 minutos
    this.monitorInterval = setInterval(async () => {
      try {
        await this.monitorWinRate();
      } catch (e) {
        console.error('[AutoLearner] ❌ Erro no monitoramento:', e);
      }
    }, 15 * 60 * 1000);
    
    // 4. Snapshot automático a cada 30 minutos (persistência)
    this.snapshotInterval = setInterval(() => {
      this.saveSnapshot();
    }, 30 * 60 * 1000);
    
    // Executa imediatamente na inicialização
    setTimeout(() => this.saveSnapshot(), 5000); // Salva snapshot inicial
    
    console.log('[AutoLearner] 🔄 Scheduler 24/7 iniciado (100% RAM - 0 latência)');
    console.log('[AutoLearner] 📅 Aprendizado: 1h | Rollback: 6h | Monitor: 15min | Snapshot: 30min');
  }
  
  /**
   * Para scheduler
   */
  stopScheduler() {
    if (this.schedulerInterval) clearInterval(this.schedulerInterval);
    if (this.rollbackInterval) clearInterval(this.rollbackInterval);
    if (this.monitorInterval) clearInterval(this.monitorInterval);
    if (this.snapshotInterval) clearInterval(this.snapshotInterval);
    this.isRunning = false;
    
    // Salva snapshot final antes de parar
    this.saveSnapshot();
    
    console.log('[AutoLearner] 🛑 Scheduler parado, snapshot salvo');
  }
  
  /**
   * Verifica e reseta contador diário
   */
  private checkDailyReset() {
    const today = new Date().toDateString();
    if (this.lastResetDate !== today) {
      this.patternsCreatedToday = 0;
      this.lastResetDate = today;
      console.log('[AutoLearner] 🔄 Contador diário resetado');
    }
  }
  
  /**
   * Status do sistema
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      patternsCreatedToday: this.patternsCreatedToday,
      maxPatternsPerDay: this.maxPatternsPerDay,
      totalExperiences: this.experiences.length,
      memoryUsage: 'RAM (0ms latency)',
      lastResetDate: this.lastResetDate
    };
  }
  
  /**
   * Retorna histórico em RAM
   */
  getHistory(limit: number = 100): Experience[] {
    return this.experiences.slice(-limit);
  }
  
  // Helpers
  private generatePatternName(trait: string): string {
    const names: Record<string, string> = {
      'hour_violino': 'bloqueio_violino',
      'hour_abertura': 'alerta_abertura'
    };
    return names[trait] || `pattern_${trait}`;
  }
  
  private generateTrigger(trait: string): string {
    const triggers: Record<string, string> = {
      'hour_violino': 'violino horário',
      'hour_abertura': 'abertura mercado'
    };
    return triggers[trait] || trait.replace('_', ' ');
  }
  
  private generateResponse(trait: string, data: { count: number; avgPnL: number }): string {
    const responses: Record<string, string> = {
      'hour_violino': '🛑 Horário de violino detectado. Liquidez baixa, spread alto. BLOQUEADO.',
      'hour_abertura': '⚠️ Abertura de mercado (09:00-09:45). Volatilidade alta. Aguarde estabilização.'
    };
    return responses[trait] || `⚠️ Padrão detectado: ${trait}. Ocorrências: ${data.count}.`;
  }
  
  /**
   * Executa ciclo completo de aprendizado
   */
  async runLearningCycle(): Promise<{
    lossesProcessed: number;
    patternsIdentified: number;
    patternsPromoted: number;
  }> {
    console.log('[AutoLearner] 🚀 Iniciando ciclo de aprendizado...');
    
    const promoted = await this.processLosses();
    
    const result = {
      lossesProcessed: promoted.length > 0 ? promoted[0].occurrences : 0,
      patternsIdentified: promoted.length,
      patternsPromoted: promoted.length
    };
    
    console.log(`[AutoLearner] ✅ Ciclo completo: ${result.patternsPromoted} padrões promovidos`);
    
    return result;
  }
}

// Singleton
export const autoLearner = new AutoLearner();
