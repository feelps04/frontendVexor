/**
 * VEXOR RAG Pipeline - TypeScript Interface
 * Integração com Python para RAG
 * Oracle NoSQL + OCI Bucket + Llama 3.3
 * 
 * SISTEMA HÍBRIDO:
 * 1. RAG Vetorial - busca por similaridade em docs estáticos/wikis/logs
 * 2. Skills - roteamento inteligente para ferramentas específicas
 * 3. Tempo Real - dados de mercado ao vivo
 */

import { spawn } from 'child_process';
import { oracleDB } from '../oracle-db.js';
import { telegramNotifier } from '../telegram-notifier.js';

// ==================== TYPES ====================

interface RAGContext {
  text: string;
  author: string;
  book: string;
  category: string;
  similarity: number;
  embedding?: number[];
}

interface RAGQueryResult {
  context: string;
  chunks: RAGContext[];
  response: string;
  latency: number;
  sources: string[];
}

interface BookMeta {
  author: string;
  category: string;
  priority: number;
}

// ==================== SKILL SYSTEM ====================

interface Skill {
  name: string;
  description: string;
  handler: (params: any) => Promise<string>;
  keywords: string[];
}

// ==================== SISTEMA 1 & SISTEMA 2 ====================

/**
 * Sistema 1 (Kahneman): Pensamento rápido, intuitivo, automático
 * - Respostas instantâneas baseadas em padrões
 * - Heurísticas e intuição
 * - Baixo custo cognitivo
 */
interface System1Pattern {
  trigger: string | RegExp;
  response: string | ((match: any) => string);
  confidence: number;
  learnedFrom: string;
}

/**
 * Sistema 2 (Kahneman): Pensamento lento, deliberativo, analítico
 * - Análise profunda com RAG + LLM
 * - Raciocínio complexo
 * - Alto custo cognitivo (latência)
 */
interface System2Reasoning {
  query: string;
  analysis: string[];
  conclusion: string;
  evidence: string[];
  confidence: number;
}

/**
 * Aprendizado Contínuo
 * - Feedback loop para melhorar Sistema 1
 * - Estratégias evolutivas (GA)
 * - Memória de experiências
 */
interface LearningExperience {
  id: string;
  query: string;
  systemUsed: 'S1' | 'S2';
  response: string;
  feedback?: 'positive' | 'negative';
  timestamp: Date;
  pattern?: System1Pattern;
}

/**
 * Sistema de Skills - O modelo escolhe o que carregar
 * Reduz tokens e aumenta precisão
 */
class SkillRegistry {
  private skills: Map<string, Skill> = new Map();
  
  // Sistema 1: Padrões rápidos
  private system1Patterns: System1Pattern[] = [];
  
  // Sistema 2: Histórico de raciocínios
  private system2History: System2Reasoning[] = [];
  
  // Aprendizado: Experiências
  private learningMemory: LearningExperience[] = [];
  
  register(skill: Skill) {
    this.skills.set(skill.name, skill);
    console.log(`[Skills] Registrada: ${skill.name}`);
  }
  
  // ==================== SISTEMA 1 ====================
  
  /**
   * Adiciona padrão ao Sistema 1
   */
  addSystem1Pattern(pattern: System1Pattern) {
    this.system1Patterns.push(pattern);
    console.log(`[Sistema1] Padrão aprendido: ${pattern.trigger}`);
  }
  
  /**
   * Tenta responder com Sistema 1 (rápido/intuitivo)
   */
  trySystem1(query: string): { response: string; confidence: number } | null {
    const q = query.toLowerCase().trim();
    
    // Busca padrão correspondente
    for (const pattern of this.system1Patterns) {
      let match: RegExpMatchArray | null = null;
      
      if (typeof pattern.trigger === 'string') {
        if (q.includes(pattern.trigger.toLowerCase())) {
          match = [pattern.trigger];
        }
      } else {
        match = query.match(pattern.trigger);
      }
      
      if (match && pattern.confidence >= 0.7) {
        const response = typeof pattern.response === 'function' 
          ? pattern.response(match) 
          : pattern.response;
        
        console.log(`[Sistema1] ✅ Padrão ativado: ${pattern.trigger} (${(pattern.confidence * 100).toFixed(0)}%)`);
        return { response, confidence: pattern.confidence };
      }
    }
    
    return null;
  }
  
  // ==================== SISTEMA 2 ====================
  
  /**
   * Registra raciocínio do Sistema 2
   */
  recordSystem2Reasoning(reasoning: System2Reasoning) {
    this.system2History.push(reasoning);
    // Mantém apenas últimos 100
    if (this.system2History.length > 100) {
      this.system2History.shift();
    }
  }
  
  /**
   * Busca raciocínios similares no Sistema 2
   */
  findSimilarReasoning(query: string): System2Reasoning | null {
    const similar = this.system2History.find(r => 
      r.query.toLowerCase().includes(query.toLowerCase().substring(0, 20)) ||
      query.toLowerCase().includes(r.query.toLowerCase().substring(0, 20))
    );
    return similar || null;
  }
  
  // ==================== APRENDIZADO ====================
  
  /**
   * Registra experiência para aprendizado
   */
  recordExperience(exp: Omit<LearningExperience, 'id' | 'timestamp'>) {
    const experience: LearningExperience = {
      ...exp,
      id: `exp_${Date.now()}`,
      timestamp: new Date()
    };
    
    this.learningMemory.push(experience);
    
    // Se recebeu feedback positivo, cria padrão S1
    if (exp.feedback === 'positive' && exp.systemUsed === 'S2') {
      this.promoteToSystem1(exp.query, exp.response);
    }
    
    console.log(`[Learning] Experiência registrada: ${exp.systemUsed}`);
  }
  
  /**
   * Promove resposta do S2 para padrão do S1
   */
  private promoteToSystem1(query: string, response: string) {
    // Simplifica query para trigger
    const words = query.toLowerCase().split(' ').filter(w => w.length > 3);
    const trigger = words.slice(0, 3).join(' ');
    
    // Verifica se já existe
    const exists = this.system1Patterns.some(p => 
      p.trigger.toString().includes(trigger)
    );
    
    if (!exists && trigger.length > 5) {
      this.addSystem1Pattern({
        trigger,
        response: response.substring(0, 300),
        confidence: 0.75,
        learnedFrom: 'S2_promotion'
      });
      
      console.log(`[Learning] 🎓 S2 → S1: "${trigger}"`);
    }
  }
  
  /**
   * Recebe feedback e ajusta padrões
   */
  receiveFeedback(experienceId: string, feedback: 'positive' | 'negative') {
    const exp = this.learningMemory.find(e => e.id === experienceId);
    if (!exp) return;
    
    exp.feedback = feedback;
    
    // Ajusta confiança do padrão S1 se aplicável
    if (exp.pattern) {
      const pattern = this.system1Patterns.find(p => 
        p.trigger === exp.pattern?.trigger
      );
      if (pattern) {
        pattern.confidence += feedback === 'positive' ? 0.05 : -0.1;
        pattern.confidence = Math.max(0, Math.min(1, pattern.confidence));
        
        // Remove padrão com baixa confiança
        if (pattern.confidence < 0.3) {
          this.system1Patterns = this.system1Patterns.filter(p => p !== pattern);
          console.log(`[Learning] ❌ Padrão removido: ${pattern.trigger}`);
        }
      }
    }
  }
  
  /**
   * Estatísticas de aprendizado
   */
  getLearningStats() {
    return {
      system1Patterns: this.system1Patterns.length,
      system2Reasonings: this.system2History.length,
      totalExperiences: this.learningMemory.length,
      positiveFeedback: this.learningMemory.filter(e => e.feedback === 'positive').length,
      negativeFeedback: this.learningMemory.filter(e => e.feedback === 'negative').length
    };
  }
  
  // Avalia qual skill usar baseado na query
  async route(query: string): Promise<Skill | null> {
    const q = query.toLowerCase();
    let bestMatch: Skill | null = null;
    let bestScore = 0;
    
    for (const skill of this.skills.values()) {
      const score = skill.keywords.reduce((acc, kw) => 
        q.includes(kw.toLowerCase()) ? acc + 1 : acc, 0
      );
      if (score > bestScore) {
        bestScore = score;
        bestMatch = skill;
      }
    }
    
    return bestMatch;
  }
  
  // Lista skills disponíveis para o prompt
  getSkillDescriptions(): string {
    const descs = Array.from(this.skills.values())
      .map(s => `- ${s.name}: ${s.description}`)
      .join('\n');
    return `Skills disponíveis:\n${descs}`;
  }
  
  async execute(skillName: string, params: any): Promise<string> {
    const skill = this.skills.get(skillName);
    if (!skill) return `Skill '${skillName}' não encontrada`;
    return skill.handler(params);
  }
}

// ==================== VECTOR STORE ====================

interface VectorDocument {
  id: string;
  content: string;
  embedding: number[];
  metadata: {
    source: string;
    category: string;
    timestamp: Date;
  };
}

/**
 * Vector Store - Armazenamento e busca vetorial
 * Usa Oracle DB para persistência
 */
class VectorStore {
  private embeddingsCache: Map<string, number[]> = new Map();
  
  // Gera embedding simples (TF-IDF simplificado para demo)
  // Em produção: usar OpenAI embeddings ou modelo local
  async generateEmbedding(text: string): Promise<number[]> {
    // Cache check
    const cached = this.embeddingsCache.get(text);
    if (cached) return cached;
    
    // Embedding simplificado baseado em palavras-chave
    const words = text.toLowerCase().split(/\s+/);
    const embedding: number[] = new Array(128).fill(0);
    
    // Hash simples para gerar vetor
    words.forEach((word, i) => {
      const hash = this.simpleHash(word);
      embedding[hash % 128] += 1;
    });
    
    // Normaliza
    const norm = Math.sqrt(embedding.reduce((a, b) => a + b * b, 0));
    const normalized = embedding.map(v => norm > 0 ? v / norm : 0);
    
    this.embeddingsCache.set(text, normalized);
    return normalized;
  }
  
  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }
  
  // Similaridade de cosseno
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
  
  // Busca documentos similares
  async searchSimilar(query: string, documents: VectorDocument[], topK: number = 5): Promise<VectorDocument[]> {
    const queryEmbedding = await this.generateEmbedding(query);
    
    const scored = documents.map(doc => ({
      doc,
      score: this.cosineSimilarity(queryEmbedding, doc.embedding)
    }));
    
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map(s => s.doc);
  }
  
  // Indexa documento no Oracle
  async indexDocument(doc: Omit<VectorDocument, 'id' | 'embedding'>): Promise<string> {
    const id = oracleDB.generateId();
    const embedding = await this.generateEmbedding(doc.content);
    
    try {
      await oracleDB.insert(`
        INSERT INTO vector_documents (id, content, embedding, source, category, timestamp)
        VALUES (:id, :content, :embedding, :source, :category, CURRENT_TIMESTAMP)
      `, {
        id,
        content: doc.content.substring(0, 4000),
        embedding: JSON.stringify(embedding),
        source: doc.metadata.source,
        category: doc.metadata.category
      });
      
      console.log(`[VectorStore] Documento indexado: ${id}`);
      return id;
    } catch (e) {
      console.error('[VectorStore] Erro ao indexar:', e);
      return '';
    }
  }
  
  // Carrega documentos do Oracle
  async loadDocuments(category?: string): Promise<VectorDocument[]> {
    try {
      const rows = await oracleDB.query<{
        ID: string;
        CONTENT: string;
        EMBEDDING: string;
        SOURCE: string;
        CATEGORY: string;
      }>(
        category 
          ? `SELECT id, content, embedding, source, category FROM vector_documents WHERE category = :category`
          : `SELECT id, content, embedding, source, category FROM vector_documents`,
        category ? { category } : {}
      );
      
      return rows.map(r => ({
        id: r.ID,
        content: r.CONTENT,
        embedding: JSON.parse(r.EMBEDDING || '[]'),
        metadata: {
          source: r.SOURCE,
          category: r.CATEGORY,
          timestamp: new Date()
        }
      }));
    } catch (e) {
      console.error('[VectorStore] Erro ao carregar:', e);
      return [];
    }
  }
}

// ==================== RAG SERVICE ====================

class RAGService {
  private pythonPath = 'python';
  private ragScriptPath = './src/infrastructure/nexus-core/rag-pipeline.py';
  private cache: Map<string, { result: RAGQueryResult; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutos

  // 27 Livros da Doutrina Vexor
  private readonly BOOKS_META: Record<string, BookMeta> = {
    "trading_in_the_zone": { author: "Mark Douglas", category: "psicologia", priority: 10 },
    "o_trader_disciplinado": { author: "Mark Douglas", category: "psicologia", priority: 10 },
    "antifragil": { author: "Nassim Taleb", category: "risco", priority: 9 },
    "rapido_e_devagar": { author: "Daniel Kahneman", category: "psicologia", priority: 9 },
    "mental_game_of_trading": { author: "Jared Tendler", category: "psicologia", priority: 9 },
    "atomic_habits": { author: "James Clear", category: "habitos", priority: 8 },
    "meditations": { author: "Marcus Aurelius", category: "filosofia", priority: 8 },
    "daily_trading_coach": { author: "Brett Steenbarger", category: "coach", priority: 8 },
    "quantitative_trading": { author: "Howard Bandy", category: "quant", priority: 7 },
    "intermarket_analysis": { author: "John Murphy", category: "correlacao", priority: 7 }
  };

  /**
   * Recupera contexto relevante do RAG
   */
  async retrieve(query: string, topK: number = 5, categoryFilter?: string): Promise<RAGQueryResult> {
    const start = Date.now();
    const cacheKey = `${query}:${categoryFilter || 'all'}`;

    // Verifica cache
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      console.log('[RAG] Cache hit');
      return cached.result;
    }

    try {
      // Chama Python RAG pipeline
      const result = await this.callPythonRAG(query, topK, categoryFilter);
      
      const ragResult: RAGQueryResult = {
        context: result.context,
        chunks: result.chunks || [],
        response: result.response || '',
        latency: Date.now() - start,
        sources: result.chunks?.map((c: any) => c.book || c.source) || []
      };

      // Salva no cache
      this.cache.set(cacheKey, { result: ragResult, timestamp: Date.now() });

      return ragResult;
    } catch (e) {
      console.error('[RAG] Erro:', e);
      return {
        context: 'Erro ao recuperar contexto RAG',
        chunks: [],
        response: '',
        latency: Date.now() - start,
        sources: []
      };
    }
  }

  /**
   * Chama Python RAG via subprocess
   */
  private async callPythonRAG(query: string, topK: number, categoryFilter?: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const args = [
        this.ragScriptPath,
        '--query', query,
        '--top-k', String(topK),
        ...(categoryFilter ? ['--category', categoryFilter] : [])
      ];

      const proc = spawn(this.pythonPath, args, {
        cwd: process.cwd()
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          try {
            resolve(JSON.parse(stdout));
          } catch {
            resolve({ context: stdout, chunks: [] });
          }
        } else {
          reject(new Error(stderr || 'Python RAG error'));
        }
      });

      proc.on('error', reject);
    });
  }

  /**
   * Query completa com RAG + Ollama
   */
  async queryWithRAG(params: {
    query: string;
    systemPrompt: string;
    tradeContext?: {
      dailyPnL: number;
      trades: number;
      winRate: number;
      drawdown: number;
    };
    categoryFilter?: string;
  }): Promise<string> {
    const { query, systemPrompt, tradeContext, categoryFilter } = params;

    // Determina categoria baseado no tipo de query
    const category = categoryFilter || this.inferCategory(query);

    // Recupera contexto RAG
    const ragResult = await this.retrieve(query, 5, category);

    // Formata estado do dia
    const dailyState = tradeContext ? `
=== ESTADO DO DIA ===
P&L: R$ ${tradeContext.dailyPnL.toFixed(2)}
Trades: ${tradeContext.trades}/10
Win Rate: ${(tradeContext.winRate * 100).toFixed(1)}%
Drawdown: ${(tradeContext.drawdown * 100).toFixed(1)}%
` : '';

    // Monta prompt completo
    const fullPrompt = `
=== CONHECIMENTO RELEVANTE (Oracle NoSQL RAG) ===
${ragResult.context}

${dailyState}

=== PERGUNTA ===
${query}
`;

    // Chama Ollama
    const response = await this.callOllama(systemPrompt, fullPrompt);

    // Salva na memória de aprendizado
    await this.saveLearning(query, ragResult.context, response);

    return response;
  }

  /**
   * Infere categoria da query
   */
  private inferCategory(query: string): string | undefined {
    const q = query.toLowerCase();

    if (q.includes('perd') || q.includes('loss') || q.includes('frustr')) {
      return 'psicologia';
    }
    if (q.includes('risco') || q.includes('risk') || q.includes('stop')) {
      return 'risco';
    }
    if (q.includes('setup') || q.includes('padrão') || q.includes('pattern')) {
      return 'tecnica';
    }
    if (q.includes('correlação') || q.includes('dólar') || q.includes('macro')) {
      return 'correlacao';
    }
    if (q.includes('hábito') || q.includes('rotina') || q.includes('checklist')) {
      return 'habitos';
    }

    return undefined; // Busca em todas
  }

  /**
   * Chama Ollama local
   */
  private async callOllama(systemPrompt: string, userPrompt: string): Promise<string> {
    const host = process.env.OLLAMA_HOST || 'localhost';
    const port = process.env.OLLAMA_PORT || '11434';
    const model = process.env.OLLAMA_MODEL || 'llama3.2:latest';

    try {
      const response = await fetch(`http://${host}:${port}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          stream: false,
          options: {
            temperature: 0.2,
            num_predict: 300
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama error: ${response.status}`);
      }

      const data = await response.json() as { message?: { content: string } };
      return data.message?.content || 'Sem resposta';
    } catch (e) {
      console.error('[RAG] Ollama error:', e);
      return 'Ollama não disponível';
    }
  }

  /**
   * Salva aprendizado na memória
   */
  private async saveLearning(query: string, context: string, response: string): Promise<void> {
    try {
      await oracleDB.insert(`
        INSERT INTO rag_learning (id, query, context, response, timestamp)
        VALUES (:id, :query, :context, :response, CURRENT_TIMESTAMP)
      `, {
        id: oracleDB.generateId(),
        query: query.substring(0, 500),
        context: context.substring(0, 2000),
        response: response.substring(0, 1000)
      });
    } catch {
      // Ignora erro de tabela não existente
    }
  }

  /**
   * Notifica aprendizado via Telegram
   */
  async notifyLearning(topic: string, insight: string): Promise<void> {
    await telegramNotifier.sendMessage(
      `📚 <b>RAG LEARNING</b>\n\n` +
      `📖 Tópico: ${topic}\n\n` +
      `💡 ${insight.substring(0, 300)}\n\n` +
      `⚡ VEXOR RAG`
    );
  }

  /**
   * Estatísticas do RAG
   */
  getStats(): { cacheSize: number; booksCount: number } {
    return {
      cacheSize: this.cache.size,
      booksCount: Object.keys(this.BOOKS_META).length
    };
  }

  /**
   * Limpa cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// ==================== HYBRID AI SERVICE ====================

/**
 * HybridAI - Combina Sistema 1, Sistema 2, RAG, Skills e Tempo Real
 * Sistema principal de IA do VEXOR
 * 
 * SISTEMA 1 (Rápido/Intuitivo):
 * - Padrões aprendidos → resposta instantânea
 * - Skills de tempo real → dados ao vivo
 * - Heurísticas → decisões rápidas
 * 
 * SISTEMA 2 (Lento/Analítico):
 * - RAG + LLM → análise profunda
 * - Raciocínio complexo → múltiplas fontes
 * - Estratégias evolutivas → GA
 */
class HybridAI {
  private vectorStore: VectorStore;
  private skillRegistry: SkillRegistry;
  private ragService: RAGService;
  private lastExperienceId: string | null = null;
  
  constructor() {
    this.vectorStore = new VectorStore();
    this.skillRegistry = new SkillRegistry();
    this.ragService = new RAGService();
    
    // Registra skills padrão
    this.registerDefaultSkills();
    
    // Inicializa padrões do Sistema 1
    this.initializeSystem1Patterns();
    
    // Inicia scheduler 24/7 automático
    this.startAutoLearner();
  }
  
  /**
   * Inicia auto-learner 24/7
   */
  private startAutoLearner() {
    // Importa e inicia o scheduler
    import('./auto-learner.js').then(({ autoLearner }) => {
      autoLearner.startScheduler();
      console.log('[HybridAI] 🤖 Auto-Learner 24/7 iniciado');
    }).catch(e => {
      console.log('[HybridAI] ⚠️ Auto-Learner não disponível:', e);
    });
  }
  
  /**
   * Inicializa padrões base do Sistema 1
   */
  private initializeSystem1Patterns() {
    // ==================== PADRÕES COMPORTAMENTAIS ====================
    
    // Padrões de trading (Doutrina Vexor)
    this.skillRegistry.addSystem1Pattern({
      trigger: 'stop loss',
      response: '🛑 Stop Loss é essencial. Defina antes de entrar no trade. Risco máximo 1-2% do capital por trade.',
      confidence: 0.95,
      learnedFrom: 'doctrine'
    });
    
    this.skillRegistry.addSystem1Pattern({
      trigger: 'disciplina',
      response: '📋 Disciplina é seguir o plano. Não desvie por emoção. Cada trade é uma decisão independente.',
      confidence: 0.9,
      learnedFrom: 'doctrine'
    });
    
    this.skillRegistry.addSystem1Pattern({
      trigger: 'fomo',
      response: '😰 FOMO: Fear Of Missing Out. Reconheça a emoção, não aja por impulso. O mercado sempre terá oportunidades.',
      confidence: 0.9,
      learnedFrom: 'doctrine'
    });
    
    this.skillRegistry.addSystem1Pattern({
      trigger: 'overtrading',
      response: '⚠️ Overtrading: operar demais por frustração ou ganância. Pare, respire, revise seu plano.',
      confidence: 0.9,
      learnedFrom: 'doctrine'
    });
    
    this.skillRegistry.addSystem1Pattern({
      trigger: 'risco',
      response: '⚖️ Gestão de risco: nunca arrisque mais que 1-2% por trade. Preserve capital para sobreviver.',
      confidence: 0.92,
      learnedFrom: 'doctrine'
    });
    
    this.skillRegistry.addSystem1Pattern({
      trigger: 'mindset',
      response: '🧠 Mindset de trader: aceite a incerteza, cada trade é probabilístico. Foque no processo, não no resultado.',
      confidence: 0.88,
      learnedFrom: 'doctrine'
    });
    
    // ==================== PADRÕES TÉCNICOS (S1 AUTOMÁTICO) ====================
    
    // ATR Stop Loss
    this.skillRegistry.addSystem1Pattern({
      trigger: 'atr stop',
      response: '📐 ATR Stop Loss: Stop = Entry - (ATR14 × 1.0), Target = Entry + (ATR14 × 2.1). Ajuste conforme volatilidade.',
      confidence: 0.92,
      learnedFrom: 'technical_auto'
    });
    
    this.skillRegistry.addSystem1Pattern({
      trigger: 'atr atual',
      response: '📊 ATR (Average True Range) mede volatilidade. Use ATR14 para stops dinâmicos. Valor típico: 0.5-2.0% do preço.',
      confidence: 0.85,
      learnedFrom: 'technical_auto'
    });
    
    // EMA
    this.skillRegistry.addSystem1Pattern({
      trigger: 'ema cruzou',
      response: '📈 Cruzamento EMA válido quando: EMA9 cruza EMA21, volume acima da média, fora de consolidação. Confirme com RSI.',
      confidence: 0.88,
      learnedFrom: 'technical_auto'
    });
    
    this.skillRegistry.addSystem1Pattern({
      trigger: 'ema sinal',
      response: '✅ Sinal EMA válido: 1) Cruzamento confirmado, 2) Volume > 20MA, 3) RSI não sobrecomprado/sobrevendido, 4) Sem resistência próxima.',
      confidence: 0.87,
      learnedFrom: 'technical_auto'
    });
    
    // WDO/B3
    this.skillRegistry.addSystem1Pattern({
      trigger: 'wdo horario',
      response: '🕐 WDO opera 09:45-18:15 B3. Melhor liquidez: 09:45-11:30 e 14:30-17:00. Evite violino: 12:00-14:00.',
      confidence: 0.94,
      learnedFrom: 'technical_auto'
    });
    
    this.skillRegistry.addSystem1Pattern({
      trigger: 'wdo horário',
      response: '🕐 WDO opera 09:45-18:15 B3. Melhor liquidez: 09:45-11:30 e 14:30-17:00. Evite violino: 12:00-14:00.',
      confidence: 0.94,
      learnedFrom: 'technical_auto'
    });
    
    this.skillRegistry.addSystem1Pattern({
      trigger: 'devo entrar agora',
      response: (match: any) => {
        const now = new Date();
        const hour = now.getUTCHours() - 3; // B3 time
        const min = now.getUTCMinutes();
        const timeNum = hour + min/60;
        
        // B3: 09:45-18:15
        if (timeNum >= 9.75 && timeNum < 18.25) {
          if (hour >= 12 && hour < 14) {
            return '⚠️ Horário de "violino" (12:00-14:00). Liquidez baixa, spread alto. Aguarde 14:30.';
          }
          return `✅ Mercado aberto (${hour}:${min.toString().padStart(2,'0')} B3). Verifique: 1) Setup confirmado, 2) Volume, 3) ATR adequado.`;
        }
        return '🚫 Mercado fechado. B3 opera 09:45-18:15. Aguarde abertura.';
      },
      confidence: 0.90,
      learnedFrom: 'technical_auto'
    });
    
    // WinRate / Limites
    this.skillRegistry.addSystem1Pattern({
      trigger: 'limite diário',
      response: '🔢 Limite diário Vexor: 5 trades/símbolo, 80 trades global/dia. Atingiu? Pare. Amanhã é outro dia.',
      confidence: 0.93,
      learnedFrom: 'technical_auto'
    });
    
    this.skillRegistry.addSystem1Pattern({
      trigger: 'win rate',
      response: '📊 WinRate alvo: > 55%. Atual < 45%? Reduza tamanho, revise setup, aumente seletividade. Qualidade > quantidade.',
      confidence: 0.88,
      learnedFrom: 'technical_auto'
    });
    
    this.skillRegistry.addSystem1Pattern({
      trigger: 'wr mínimo',
      response: '🎯 WR mínimo cripto: 32.3% break-even. Abaixo? Stop trading, revise estratégia, volte ao paper.',
      confidence: 0.91,
      learnedFrom: 'technical_auto'
    });
    
    // ==================== PADRÕES URGENTES (12 NOVOS) ====================
    
    // RR válido
    this.skillRegistry.addSystem1Pattern({
      trigger: 'rr valido',
      response: '✅ Risco/Retorno válido: mínimo 1:2. Stop 1x ATR, Target 2.1x ATR. Abaixo disso, não compensa estatisticamente.',
      confidence: 0.90,
      learnedFrom: 'urgent_v4'
    });
    
    // BTC fraco
    this.skillRegistry.addSystem1Pattern({
      trigger: 'btc fraco',
      response: '⚠️ BTC WR < 40%. Reduza exposição cripto 50%. Priorize stablecoins. Aguarde recuperação de confiança.',
      confidence: 0.88,
      learnedFrom: 'urgent_v4'
    });
    
    // SOL desativar
    this.skillRegistry.addSystem1Pattern({
      trigger: 'sol desativar',
      response: '🛑 SOLUSDT piorou na v4. WinRate caiu significativamente. DESATIVAR até nova validação.',
      confidence: 0.92,
      learnedFrom: 'urgent_v4'
    });
    
    // Volume baixo
    this.skillRegistry.addSystem1Pattern({
      trigger: 'volume baixo',
      response: '📉 Volume abaixo da média 20MA. Sinais fracos, maior probabilidade de falso rompimento. Filtre rigorosamente.',
      confidence: 0.85,
      learnedFrom: 'urgent_v4'
    });
    
    // London open
    this.skillRegistry.addSystem1Pattern({
      trigger: 'london open',
      response: '🇬🇧 London Open: 08:00-12:00 UTC. Melhor janela FOREX. Alta volatilidade, bons movimentos. Priorize pares EUR/GBP.',
      confidence: 0.90,
      learnedFrom: 'urgent_v4'
    });
    
    // NY open
    this.skillRegistry.addSystem1Pattern({
      trigger: 'ny open',
      response: '🇺🇸 NY Open: 13:30-17:00 UTC. Segunda melhor janela FOREX. Overlap com London 13:30-14:00 = máximo volume.',
      confidence: 0.88,
      learnedFrom: 'urgent_v4'
    });
    
    // B3 escala
    this.skillRegistry.addSystem1Pattern({
      trigger: 'b3 escala',
      response: '📈 B3 subutilizado: WDO$ 100% WR, DOL$ 89% WR. Aumente limite para 8 trades/dia por símbolo. Capital: 30-40%.',
      confidence: 0.87,
      learnedFrom: 'urgent_v4'
    });
    
    // Janeiro alerta
    this.skillRegistry.addSystem1Pattern({
      trigger: 'janeiro alerta',
      response: '📉 WR caiu para 20% em Janeiro. MONITORAR: Reduza risco 50%, aumente seletividade, valide cada setup 2x.',
      confidence: 0.80,
      learnedFrom: 'protection_auto'
    });
    
    // Fevereiro monitorar
    this.skillRegistry.addSystem1Pattern({
      trigger: 'fevereiro monitorar',
      response: '📊 Se Fevereiro confirmar WR < 30% → revisar parâmetros EMA cripto imediatamente. Não ignore sinais de queda.',
      confidence: 0.82,
      learnedFrom: 'urgent_v4'
    });
    
    // Cripto correlação
    this.skillRegistry.addSystem1Pattern({
      trigger: 'cripto correlacao',
      response: '🔗 Cripto correlacionada: BTC lidera, ETH segue, alts copiam. BTC cai 5%? Aguarde estabilização antes de alts.',
      confidence: 0.83,
      learnedFrom: 'crypto_protection'
    });
    
    // Gap abertura
    this.skillRegistry.addSystem1Pattern({
      trigger: 'gap abertura',
      response: '⚠️ Gap de abertura detectado. Não opere contra o gap. Aguarde preenchimento ou confirme direção após 30min.',
      confidence: 0.86,
      learnedFrom: 'urgent_v4'
    });
    
    // News evento
    this.skillRegistry.addSystem1Pattern({
      trigger: 'news evento',
      response: '📰 Evento macroeconômico próximo (FOMC, CPI, NFP). Feche posições 15min antes. Reentre apenas após 30min pós-anúncio.',
      confidence: 0.89,
      learnedFrom: 'urgent_v4'
    });
    
    // ==================== PADRÕES DE BLOQUEIO (PROTEÇÃO) ====================
    
    this.skillRegistry.addSystem1Pattern({
      trigger: 'agente invalido',
      response: '🛑 BLOQUEIO: Agentes institucionais ausentes. Volume ratio < 0.4. Risco de "violino" elevado. Trade negado.',
      confidence: 0.85,
      learnedFrom: 'protection_auto'
    });
    
    this.skillRegistry.addSystem1Pattern({
      trigger: 'consolidacao',
      response: '⚠️ Mercado em consolidação. ATR baixo, volume fraco. Aguarde rompimento com confirmação.',
      confidence: 0.82,
      learnedFrom: 'protection_auto'
    });
    
    this.skillRegistry.addSystem1Pattern({
      trigger: 'janeiro alerta',
      response: '📉 WR caiu para 20% em Janeiro. MONITORAR: Reduza risco 50%, aumente seletividade, valide cada setup 2x.',
      confidence: 0.80,
      learnedFrom: 'protection_auto'
    });
    
    // ==================== PADRÕES PREDITIVOS (NOVO) ====================
    
    // Regime Change - Detecta mudança antes de perder
    this.skillRegistry.addSystem1Pattern({
      trigger: 'regime change',
      response: '🔄 Regime Change detectado. Volatilidade mudou > 30%. Recalcule stops/targets. Evite posições antigas.',
      confidence: 0.82,
      learnedFrom: 'predictive_auto'
    });
    
    this.skillRegistry.addSystem1Pattern({
      trigger: 'mercado mudou',
      response: '📊 Comportamento de preço alterado. ATR fora do normal. Aguarde 3 candles de confirmação antes de operar.',
      confidence: 0.80,
      learnedFrom: 'predictive_auto'
    });
    
    // ==================== PROTEÇÃO CRIPTO ESPECÍFICA ====================
    
    this.skillRegistry.addSystem1Pattern({
      trigger: 'cripto wr baixo',
      response: '⚠️ WR cripto < 40% por 3+ dias. Reduza alavancagem, revise setup, considere paper trading até recuperar.',
      confidence: 0.88,
      learnedFrom: 'crypto_protection'
    });
    
    this.skillRegistry.addSystem1Pattern({
      trigger: 'btc dominancia',
      response: '₿ BTC dominância > 55%? Altcoins sofrem. Priorize BTC/ETH. < 45%? Altcoins podem subir. Diversifique.',
      confidence: 0.85,
      learnedFrom: 'crypto_protection'
    });
    
    this.skillRegistry.addSystem1Pattern({
      trigger: 'rr valido',
      response: '✅ Risco/Retorno válido: mínimo 1:2. Stop 1x ATR, Target 2.1x ATR. Abaixo disso, não compensa estatisticamente.',
      confidence: 0.90,
      learnedFrom: 'crypto_protection'
    });
    
    this.skillRegistry.addSystem1Pattern({
      trigger: 'correlacao cripto',
      response: '🔗 Cripto correlacionada: BTC lidera, ETH segue, alts copiam. BTC cai 5%? Aguarde estabilização antes de alts.',
      confidence: 0.83,
      learnedFrom: 'crypto_protection'
    });
    
    // ==================== VALIDAÇÃO EMA/RSI ====================
    
    this.skillRegistry.addSystem1Pattern({
      trigger: 'rsi sobrecomprado',
      response: '📈 RSI > 70: sobrecomprado. Evite compras. Aguarde cruzamento para baixo ou divergência para short.',
      confidence: 0.87,
      learnedFrom: 'technical_auto'
    });
    
    this.skillRegistry.addSystem1Pattern({
      trigger: 'rsi sobrevendido',
      response: '📉 RSI < 30: sobrevendido. Evite vendas. Aguarde cruzamento para cima ou divergência para compra.',
      confidence: 0.87,
      learnedFrom: 'technical_auto'
    });
    
    console.log('[HybridAI] Sistema 1 inicializado: 6 comportamentais + 12 técnicos + 12 urgentes + 3 proteção + 2 preditivos + 5 cripto = 40 padrões');
  }
  
  private registerDefaultSkills() {
    // Skill: Análise de mercado em tempo real (dados do MMFReader)
    this.skillRegistry.register({
      name: 'market_analysis',
      description: 'Analisa condições atuais do mercado (preços, tendências, volume)',
      keywords: ['mercado', 'preço', 'tendência', 'análise técnica', 'cotação', 'atual', 'preços', 'ativo'],
      handler: async (params) => {
        try {
          // Busca dados do sentinel_api.py (MMFReader)
          const response = await fetch('http://localhost:8765/mmf/debug');
          if (!response.ok) {
            return 'Sentinel API indisponível. Execute: python sentinel_api.py';
          }
          
          const data = await response.json() as {
            b3_symbols: Array<{ symbol: string; bid: number; ask: number }>;
            global_symbols: Array<{ symbol: string; bid: number; ask: number }>;
          };
          
          // Formata resposta com dados em tempo real
          const global = data.global_symbols?.slice(0, 10) || [];
          const b3 = data.b3_symbols?.slice(0, 10) || [];
          
          let result = '📊 **MERCADO EM TEMPO REAL**\n\n';
          
          if (global.length > 0) {
            result += `🌍 **Global (Pepperstone):**\n${global.map(p => 
              `${p.symbol}: ${p.bid.toFixed(2)} / ${p.ask.toFixed(2)}`
            ).join('\n')}\n\n`;
          }
          
          if (b3.length > 0) {
            result += `🇧🇷 **B3 (Genial):**\n${b3.map(p => 
              `${p.symbol}: R$ ${p.bid.toFixed(2)} / R$ ${p.ask.toFixed(2)}`
            ).join('\n')}`;
          }
          
          return result || 'Nenhum dado disponível';
        } catch (e) {
          return `Erro ao buscar dados: ${(e as Error).message}`;
        }
      }
    });
    
    // Skill: Busca vetorial em documentação
    this.skillRegistry.register({
      name: 'search_docs',
      description: 'Busca em documentação estática, wikis e logs históricos',
      keywords: ['documentação', 'wiki', 'manual', 'como fazer', 'tutorial', 'ajuda'],
      handler: async (params) => {
        const docs = await this.vectorStore.loadDocuments('docs');
        const similar = await this.vectorStore.searchSimilar(params.query || '', docs, 3);
        return similar.map(d => d.content).join('\n\n---\n\n');
      }
    });
    
    // Skill: Consulta doutrina de trading
    this.skillRegistry.register({
      name: 'doctrine_query',
      description: 'Consulta a doutrina de trading (Mark Douglas, Taleb, etc)',
      keywords: ['douglas', 'taleb', 'kahneman', 'psicologia', 'risco', 'disciplina', 'mindset'],
      handler: async (params) => {
        const result = await this.ragService.retrieve(params.query || '', 3, 'psicologia');
        return result.context;
      }
    });
    
    // Skill: Análise de posição aberta
    this.skillRegistry.register({
      name: 'position_analysis',
      description: 'Analisa posições abertas do usuário com dados em tempo real',
      keywords: ['posição', 'aberta', 'pnl', 'lucro', 'prejuízo', 'trade ativo'],
      handler: async (params) => {
        const positions = await oracleDB.query<{
          SYMBOL: string;
          SIDE: string;
          QUANTITY: number;
          ENTRY_PRICE: number;
          PNL: number;
        }>(`SELECT symbol, side, quantity, entry_price, pnl FROM open_positions WHERE user_id = :userId`, 
          { userId: params.userId || 'default' }
        );
        
        if (positions.length === 0) return 'Nenhuma posição aberta';
        
        return `Posições abertas:\n${positions.map(p => 
          `${p.SYMBOL} ${p.SIDE} ${p.QUANTITY} @ $${p.ENTRY_PRICE} | PnL: $${p.PNL}`
        ).join('\n')}`;
      }
    });
    
    // Skill: Binance - Crypto em tempo real
    this.skillRegistry.register({
      name: 'binance_prices',
      description: 'Preços de criptomoedas da Binance em tempo real',
      keywords: ['binance', 'crypto', 'bitcoin', 'btc', 'eth', 'ethereum', 'cripto', 'cryptocurrency'],
      handler: async (params) => {
        try {
          // Busca preços da Binance API (público, sem auth)
          const response = await fetch('https://api.binance.com/api/v3/ticker/price?symbols=["BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT","DOGEUSDT","ADAUSDT","AVAXUSDT","DOTUSDT","MATICUSDT"]');
          
          if (!response.ok) {
            return 'Binance API indisponível';
          }
          
          const data = await response.json() as Array<{ symbol: string; price: string }>;
          
          // Busca variação 24h
          const ticker24h = await fetch('https://api.binance.com/api/v3/ticker/24hr?symbols=["BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT"]');
          const data24h = await ticker24h.json() as Array<{ symbol: string; priceChangePercent: string }>;
          
          const changeMap = new Map(data24h.map(d => [d.symbol, d.priceChangePercent]));
          
          let result = '₿ **BINANCE - CRYPTO EM TEMPO REAL**\n\n';
          
          const icons: Record<string, string> = {
            'BTCUSDT': '🟠 BTC',
            'ETHUSDT': '🔷 ETH',
            'BNBUSDT': '🟡 BNB',
            'SOLUSDT': '🟣 SOL',
            'XRPUSDT': '🔵 XRP',
            'DOGEUSDT': '🐕 DOGE',
            'ADAUSDT': '🔵 ADA',
            'AVAXUSDT': '🔺 AVAX',
            'DOTUSDT': '⚫ DOT',
            'MATICUSDT': '🟣 MATIC'
          };
          
          result += data.map(p => {
            const icon = icons[p.symbol] || p.symbol;
            const change = changeMap.get(p.symbol) || '0';
            const changeNum = parseFloat(change);
            const arrow = changeNum >= 0 ? '📈' : '📉';
            return `${icon}: $${parseFloat(p.price).toLocaleString()} ${arrow} ${changeNum >= 0 ? '+' : ''}${changeNum.toFixed(2)}%`;
          }).join('\n');
          
          result += '\n\n⚡ Atualizado em tempo real via Binance API';
          
          return result;
        } catch (e) {
          return `Erro ao buscar Binance: ${(e as Error).message}`;
        }
      }
    });
    
    // ==================== AUTO-APRENDIZADO DOS 2700+ SINAIS ====================
    
    // Skill: Validação automática de trade
    this.skillRegistry.register({
      name: 'trade_validator',
      description: 'Valida trade automaticamente com base em 2700+ sinais históricos',
      keywords: ['validar', 'trade', 'entrada', 'setup', 'confirmar', 'sinal'],
      handler: async (params) => {
        try {
          // Busca sinais do Oracle para validar
          const signals = await oracleDB.query<{
            SIGNAL_TYPE: string;
            SYMBOL: string;
            WIN_RATE: number;
            AVG_PNL: number;
            COUNT: number;
          }>(`
            SELECT 
              signal_type as SIGNAL_TYPE,
              symbol as SYMBOL,
              AVG(CASE WHEN outcome = 1 THEN 1 ELSE 0 END) as WIN_RATE,
              AVG(pnl) as AVG_PNL,
              COUNT(*) as COUNT
            FROM signal_history
            WHERE symbol = :symbol OR :symbol IS NULL
            GROUP BY signal_type, symbol
            ORDER BY COUNT DESC
            FETCH FIRST 20 ROWS ONLY
          `, { symbol: params.symbol || null });
          
          if (signals.length === 0) {
            return '⚠️ Sem histórico suficiente para validar. Prossiga com cautela.';
          }
          
          // Calcula métricas
          const totalTrades = signals.reduce((sum, s) => sum + s.COUNT, 0);
          const avgWinRate = signals.reduce((sum, s) => sum + (s.WIN_RATE * s.COUNT), 0) / totalTrades;
          const avgPnL = signals.reduce((sum, s) => sum + (s.AVG_PNL * s.COUNT), 0) / totalTrades;
          
          // Determina validação
          const isValid = avgWinRate >= 0.45 && avgPnL >= 0;
          
          let result = isValid ? '✅ TRADE VÁLIDO\n\n' : '🛑 TRADE NEGADO\n\n';
          
          result += `📊 **Base: ${totalTrades} sinais históricos**\n`;
          result += `WinRate médio: ${(avgWinRate * 100).toFixed(1)}%\n`;
          result += `PnL médio: R$ ${avgPnL.toFixed(2)}\n\n`;
          
          if (!isValid) {
            result += '❌ Critérios não atendidos:\n';
            if (avgWinRate < 0.45) result += '- WinRate abaixo de 45%\n';
            if (avgPnL < 0) result += '- PnL médio negativo\n';
            result += '\n💡 Revise setup ou aguarde melhor oportunidade.';
          } else {
            result += '✅ Critérios atendidos. Prossiga com gestão de risco.';
          }
          
          return result;
        } catch (e) {
          return `Erro na validação: ${(e as Error).message}`;
        }
      }
    });
    
    // Skill: Auto-aprendizado contínuo
    this.skillRegistry.register({
      name: 'auto_learner',
      description: 'Aprende automaticamente com novos trades e promove para S1',
      keywords: ['aprender', 'treinar', 'evoluir', 'padrão'],
      handler: async (params) => {
        try {
          // Busca trades com feedback positivo que ainda não viraram padrão
          const candidates = await oracleDB.query<{
            QUERY: string;
            RESPONSE: string;
            COUNT: number;
            AVG_PNL: number;
          }>(`
            SELECT 
              SUBSTR(query, 1, 50) as QUERY,
              SUBSTR(response, 1, 300) as RESPONSE,
              COUNT(*) as COUNT,
              AVG(pnl) as AVG_PNL
            FROM trade_feedback
            WHERE feedback = 'positive' AND promoted = 0
            GROUP BY SUBSTR(query, 1, 50), SUBSTR(response, 1, 300)
            HAVING COUNT(*) >= 3 AND AVG(pnl) > 0
            ORDER BY COUNT DESC
            FETCH FIRST 10 ROWS ONLY
          `, {});
          
          if (candidates.length === 0) {
            return '📚 Nenhum novo padrão candidato. Continue operando.';
          }
          
          let result = `🎓 **AUTO-APRENDIZADO**\n\n${candidates.length} padrões candidatos encontrados.\n\n`;
          
          for (const c of candidates) {
            // Promove para S1
            const trigger = c.QUERY.toLowerCase().split(' ').slice(0, 3).join(' ');
            
            this.skillRegistry.addSystem1Pattern({
              trigger,
              response: c.RESPONSE,
              confidence: Math.min(0.9, 0.7 + (c.COUNT * 0.02)),
              learnedFrom: 'auto_promotion'
            });
            
            result += `✅ Promovido: "${trigger}" (${c.COUNT} ocorrências)\n`;
            
            // Marca como promovido no banco
            await oracleDB.update(
              `UPDATE trade_feedback SET promoted = 1 WHERE SUBSTR(query, 1, 50) = :query`,
              { query: c.QUERY }
            );
          }
          
          result += `\n🎯 Total de padrões S1 atualizado automaticamente.`;
          
          return result;
        } catch (e) {
          return `Erro no auto-aprendizado: ${(e as Error).message}`;
        }
      }
    });
    
    // Skill: Bloqueio automático de trades inválidos
    this.skillRegistry.register({
      name: 'trade_blocker',
      description: 'Bloqueia trades automaticamente baseado em critérios de proteção',
      keywords: ['bloquear', 'negar', 'proteção', 'limite', 'agente'],
      handler: async (params) => {
        const reasons: string[] = [];
        let blocked = false;
        
        // 1. Verifica limite diário (80 global)
        const dailyTrades = await oracleDB.query<{ COUNT: number }>(
          `SELECT COUNT(*) as COUNT FROM trade_history WHERE TRUNC(created_at) = TRUNC(SYSDATE)`
        );
        
        if (dailyTrades[0]?.COUNT >= 80) {
          reasons.push('🛑 Limite diário atingido (80 trades)');
          blocked = true;
        }
        
        // 2. Verifica limite por símbolo (5 por símbolo)
        if (params.symbol) {
          const symbolTrades = await oracleDB.query<{ COUNT: number }>(
            `SELECT COUNT(*) as COUNT FROM trade_history WHERE symbol = :symbol AND TRUNC(created_at) = TRUNC(SYSDATE)`,
            { symbol: params.symbol }
          );
          
          if (symbolTrades[0]?.COUNT >= 5) {
            reasons.push(`🛑 Limite por símbolo atingido (${params.symbol}: 5 trades)`);
            blocked = true;
          }
        }
        
        // 3. Verifica horário B3 (violino)
        const now = new Date();
        const hour = now.getUTCHours() - 3;
        if (hour >= 12 && hour < 14 && params.market === 'B3') {
          reasons.push('⚠️ Horário de violino (12:00-14:00 B3). Liquidez baixa.');
          blocked = true;
        }
        
        // 4. Verifica agentes institucionais (se dados disponíveis)
        if (params.agentVolumeRatio && params.agentVolumeRatio < 0.4) {
          reasons.push('🛑 Agentes institucionais ausentes (ratio < 0.4)');
          blocked = true;
        }
        
        // 5. Verifica WinRate recente
        const recentWR = await oracleDB.query<{ WR: number }>(
          `SELECT AVG(CASE WHEN outcome = 1 THEN 1 ELSE 0 END) as WR FROM trade_history WHERE created_at > SYSDATE - 7`
        );
        
        if (recentWR[0]?.WR < 0.35) {
          reasons.push(`📉 WinRate semanal crítico (${(recentWR[0].WR * 100).toFixed(1)}%). Reduza risco.`);
          // Não bloqueia, mas alerta
        }
        
        if (blocked) {
          return `🚫 **TRADE BLOQUEADO**\n\n${reasons.join('\n')}\n\n⚡ Vexor Protection System`;
        }
        
        return `✅ Trade liberado. Nenhum critério de bloqueio ativado.`;
      }
    });
  }
  
  /**
   * Query principal - Sistema 1 + Sistema 2 + Aprendizado
   * 
   * FLUXO:
   * 1. Sistema 1: Padrões rápidos (instantâneo)
   * 2. Skills: Tempo real (ms)
   * 3. Sistema 2: RAG + LLM (segundos)
   * 4. Aprendizado: Registra experiência
   */
  async query(params: {
    query: string;
    userId?: string;
    context?: {
      dailyPnL?: number;
      trades?: number;
      winRate?: number;
    };
    skipLLM?: boolean;
  }): Promise<{
    response: string;
    sources: string[];
    skill?: string;
    system?: 'S1' | 'S2';
    latency: number;
    cached?: boolean;
    experienceId?: string;
  }> {
    const start = Date.now();
    
    // 1. Cache check
    const cacheKey = `query:${params.query}:${params.skipLLM}`;
    const cached = this.queryCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 60000) {
      console.log('[HybridAI] Cache hit - resposta instantânea');
      return { ...cached.result, cached: true, latency: Date.now() - start };
    }
    
    // 2. SISTEMA 1: Tenta padrões rápidos (instantâneo)
    const s1Result = this.skillRegistry.trySystem1(params.query);
    if (s1Result) {
      const result = {
        response: s1Result.response,
        sources: [],
        system: 'S1' as const,
        latency: Date.now() - start,
        experienceId: `exp_${Date.now()}`
      };
      
      // Registra experiência
      this.skillRegistry.recordExperience({
        query: params.query,
        systemUsed: 'S1',
        response: s1Result.response,
        feedback: undefined
      });
      
      this.queryCache.set(cacheKey, { result, timestamp: Date.now() });
      console.log(`[HybridAI] ✅ Sistema 1 ativado (${result.latency}ms)`);
      return result;
    }
    
    // 3. Skills: Tempo real
    const skill = await this.skillRegistry.route(params.query);
    
    if (skill) {
      console.log(`[HybridAI] Skill roteada: ${skill.name}`);
      const skillResponse = await this.skillRegistry.execute(skill.name, {
        ...params,
        query: params.query
      });
      
      // Skills de tempo real = Sistema 1
      if (params.skipLLM || skill.name === 'market_analysis' || skill.name === 'position_analysis' || skill.name === 'binance_prices') {
        const result = {
          response: skillResponse,
          sources: [],
          skill: skill.name,
          system: 'S1' as const,
          latency: Date.now() - start,
          experienceId: `exp_${Date.now()}`
        };
        
        this.skillRegistry.recordExperience({
          query: params.query,
          systemUsed: 'S1',
          response: skillResponse,
          feedback: undefined
        });
        
        this.queryCache.set(cacheKey, { result, timestamp: Date.now() });
        return result;
      }
      
      // 4. SISTEMA 2: RAG + LLM (analítico)
      const ragResult = await this.ragService.retrieve(params.query, 2);
      
      const fullPrompt = `
=== CONTEXTO SKILL (${skill.name}) ===
${skillResponse}

=== CONHECIMENTO RELEVANTE ===
${ragResult.context}

=== PERGUNTA ===
${params.query}

Responda de forma direta e prática em no máximo 2 parágrafos.
`;
      
      const response = await this.ragService['callOllama'](
        'Você é a IA VEXOR. REGRAS OBRIGATÓRIAS: 1) NUNCA use saudações (Boa noite, Bom dia, Olá, Oi) 2) NUNCA use emojis 3) NUNCA diga "Tudo ótimo por aqui" ou "E com você?" 4) Vá DIRETO ao assunto 5) Máximo 2 frases. Responda em português.',
        fullPrompt
      );
      
      const result = {
        response,
        sources: ragResult.sources,
        skill: skill.name,
        system: 'S2' as const,
        latency: Date.now() - start,
        experienceId: `exp_${Date.now()}`
      };
      
      // Registra raciocínio S2
      this.skillRegistry.recordSystem2Reasoning({
        query: params.query,
        analysis: [skillResponse, ragResult.context],
        conclusion: response,
        evidence: ragResult.sources,
        confidence: 0.8
      });
      
      // Registra experiência
      this.skillRegistry.recordExperience({
        query: params.query,
        systemUsed: 'S2',
        response,
        feedback: undefined
      });
      
      this.queryCache.set(cacheKey, { result, timestamp: Date.now() });
      console.log(`[HybridAI] 🧠 Sistema 2 ativado (${result.latency}ms)`);
      return result;
    }
    
    // 5. Fallback: Sistema 2 puro
    const ragResult = await this.ragService.retrieve(params.query, 3);
    
    if (params.skipLLM) {
      return {
        response: ragResult.context || 'Nenhum contexto relevante encontrado.',
        sources: ragResult.sources,
        system: 'S2',
        latency: Date.now() - start
      };
    }
    
    const contextInfo = params.context ? `
=== ESTADO DO DIA ===
P&L: R$ ${(params.context.dailyPnL || 0).toFixed(2)}
Trades: ${params.context.trades || 0}
Win Rate: ${((params.context.winRate || 0) * 100).toFixed(1)}%
` : '';
    
    const fullPrompt = `
=== CONHECIMENTO RELEVANTE ===
${ragResult.context}

${contextInfo}

=== PERGUNTA ===
${params.query}

Responda em no máximo 2 parágrafos de forma direta.
`;
    
    const response = await this.ragService['callOllama'](
      'Você é a IA VEXOR. REGRAS OBRIGATÓRIAS: 1) NUNCA use saudações (Boa noite, Bom dia, Olá, Oi) 2) NUNCA use emojis 3) NUNCA diga "Tudo ótimo por aqui" ou "E com você?" 4) Vá DIRETO ao assunto 5) Máximo 2 frases. Responda em português.',
      fullPrompt
    );
    
    const result = {
      response,
      sources: ragResult.sources,
      system: 'S2' as const,
      latency: Date.now() - start,
      experienceId: `exp_${Date.now()}`
    };
    
    this.skillRegistry.recordExperience({
      query: params.query,
      systemUsed: 'S2',
      response,
      feedback: undefined
    });
    
    this.queryCache.set(cacheKey, { result, timestamp: Date.now() });
    console.log(`[HybridAI] 🧠 Sistema 2 fallback (${result.latency}ms)`);
    return result;
  }
  
  /**
   * Recebe feedback para aprendizado
   */
  feedback(experienceId: string, feedback: 'positive' | 'negative') {
    this.skillRegistry.receiveFeedback(experienceId, feedback);
    console.log(`[HybridAI] Feedback recebido: ${feedback}`);
  }
  
  /**
   * Estatísticas de aprendizado
   */
  getLearningStats() {
    return this.skillRegistry.getLearningStats();
  }
  
  private queryCache: Map<string, { result: any; timestamp: number }> = new Map();
  
  /**
   * Indexa documento para busca vetorial
   */
  async indexDocument(content: string, source: string, category: string): Promise<string> {
    return this.vectorStore.indexDocument({
      content,
      metadata: { source, category, timestamp: new Date() }
    });
  }
  
  /**
   * Registra nova skill
   */
  registerSkill(skill: Skill) {
    this.skillRegistry.register(skill);
  }
  
  /**
   * Lista skills disponíveis
   */
  getSkillDescriptions(): string {
    return this.skillRegistry.getSkillDescriptions();
  }
}

// ==================== TELEGRAM LEARNING INTEGRATION ====================

class TelegramLearning {
  /**
   * Processa mensagem do Telegram para aprendizado
   */
  async processMessage(message: {
    from: string;
    text: string;
    chatId: string;
  }): Promise<{
    response: string;
    learned: boolean;
    topic?: string;
  }> {
    const text = message.text.toLowerCase();

    // Detecta intenção de aprendizado
    if (text.includes('aprender') || text.includes('ensinar') || text.includes('salvar')) {
      const topic = this.extractTopic(message.text);
      const insight = this.extractInsight(message.text);

      await this.saveInsight(topic, insight, message.from);

      return {
        response: `✅ Aprendido: "${topic}" salvo na base de conhecimento.`,
        learned: true,
        topic
      };
    }

    // Detecta pergunta sobre doutrina
    if (text.includes('douglas') || text.includes('kahneman') || text.includes('taleb') ||
        text.includes('tendler') || text.includes('steenbarger') || text.includes('aurelius')) {
      return {
        response: await this.queryDoctrine(message.text),
        learned: false
      };
    }

    return {
      response: '',
      learned: false
    };
  }

  /**
   * Extrai tópico da mensagem
   */
  private extractTopic(text: string): string {
    const match = text.match(/(?:sobre|acerca|referente)\s+(.+?)(?:\s*:|\s*-|\s*\.)/i);
    return match ? match[1].trim() : 'Geral';
  }

  /**
   * Extrai insight da mensagem
   */
  private extractInsight(text: string): string {
    const match = text.match(/[:\-]\s*(.+)/);
    return match ? match[1].trim() : text.substring(0, 200);
  }

  /**
   * Salva insight na base
   */
  private async saveInsight(topic: string, insight: string, author: string): Promise<void> {
    try {
      await oracleDB.insert(`
        INSERT INTO telegram_learning (id, topic, insight, author, timestamp)
        VALUES (:id, :topic, :insight, :author, CURRENT_TIMESTAMP)
      `, {
        id: oracleDB.generateId(),
        topic,
        insight,
        author
      });
    } catch {}
  }

  /**
   * Query na doutrina via RAG
   */
  private async queryDoctrine(query: string): Promise<string> {
    const ragService = new RAGService();
    const result = await ragService.retrieve(query, 3);
    return result.context;
  }
}

// ==================== SINGLETONS ====================

export const ragService = new RAGService();
export const telegramLearning = new TelegramLearning();
export const hybridAI = new HybridAI();
export const vectorStore = new VectorStore();
export const skillRegistry = new SkillRegistry();
export type { RAGContext, RAGQueryResult, BookMeta, Skill, VectorDocument };
