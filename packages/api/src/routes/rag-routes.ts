/**
 * VEXOR RAG Routes
 * APIs para RAG e aprendizado contínuo
 * 
 * SISTEMA HÍBRIDO:
 * - RAG Vetorial: busca por similaridade
 * - Skills: roteamento inteligente
 * - Tempo Real: dados de mercado ao vivo
 */

import { FastifyInstance } from 'fastify';
import { ragService, telegramLearning, hybridAI, vectorStore, skillRegistry } from '../infrastructure/nexus-core/rag-service.js';

export async function ragRoutes(app: FastifyInstance) {
  // ==================== HYBRID AI QUERY ====================

  // Query principal com HybridAI (RAG + Skills + Tempo Real)
  // Modo rápido por padrão para tempo real
  app.post('/api/v1/ai/query', async (request, reply) => {
    const body = request.body as {
      query: string;
      userId?: string;
      context?: {
        dailyPnL: number;
        trades: number;
        winRate: number;
      };
      skipLLM?: boolean; // Pular LLM para resposta instantânea
    };

    // Modo rápido por padrão (tempo real)
    const skipLLM = body.skipLLM !== false; // Default: true

    const result = await hybridAI.query({
      query: body.query,
      userId: body.userId,
      context: body.context,
      skipLLM
    });

    return result;
  });

  // Query com LLM completo (mais lento, mais elaborado)
  app.post('/api/v1/ai/query/full', async (request, reply) => {
    const body = request.body as {
      query: string;
      userId?: string;
      context?: {
        dailyPnL: number;
        trades: number;
        winRate: number;
      };
    };

    const result = await hybridAI.query({
      query: body.query,
      userId: body.userId,
      context: body.context,
      skipLLM: false // Força uso do LLM
    });

    return result;
  });

  // ==================== RAG QUERY ====================

  // Query com RAG tradicional
  app.post('/api/v1/rag/query', async (request, reply) => {
    const body = request.body as {
      query: string;
      topK?: number;
      categoryFilter?: string;
    };

    const result = await ragService.retrieve(
      body.query,
      body.topK || 5,
      body.categoryFilter
    );

    return result;
  });

  // Query completa com Ollama
  app.post('/api/v1/rag/complete', async (request, reply) => {
    const body = request.body as {
      query: string;
      systemPrompt?: string;
      tradeContext?: {
        dailyPnL: number;
        trades: number;
        winRate: number;
        drawdown: number;
      };
      categoryFilter?: string;
    };

    const systemPrompt = body.systemPrompt || `
Você é o Psych Agent da NEXUS-AI.
Baseie suas respostas na Doutrina Vexor.
Seja conciso e direto.
`;

    const response = await ragService.queryWithRAG({
      query: body.query,
      systemPrompt,
      tradeContext: body.tradeContext,
      categoryFilter: body.categoryFilter
    });

    return { response };
  });

  // ==================== VECTOR STORE ====================

  // Indexa documento para busca vetorial
  app.post('/api/v1/rag/index', async (request, reply) => {
    const body = request.body as {
      content: string;
      source: string;
      category: string;
    };

    if (!body.content || !body.source || !body.category) {
      return reply.status(400).send({ error: 'content, source e category são obrigatórios' });
    }

    const id = await hybridAI.indexDocument(body.content, body.source, body.category);
    
    return { 
      success: true, 
      id,
      message: 'Documento indexado com sucesso' 
    };
  });

  // Busca documentos similares
  app.post('/api/v1/rag/search', async (request, reply) => {
    const body = request.body as {
      query: string;
      category?: string;
      topK?: number;
    };

    const docs = await vectorStore.loadDocuments(body.category);
    const similar = await vectorStore.searchSimilar(body.query, docs, body.topK || 5);

    return {
      results: similar.map(d => ({
        id: d.id,
        content: d.content.substring(0, 500),
        source: d.metadata.source,
        category: d.metadata.category
      }))
    };
  });

  // ==================== SKILLS ====================

  // Lista skills disponíveis
  app.get('/api/v1/ai/skills', async (request, reply) => {
    return { 
      skills: hybridAI.getSkillDescriptions() 
    };
  });

  // Executa skill específica
  app.post('/api/v1/ai/skill/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    const body = request.body as Record<string, any>;

    const result = await skillRegistry.execute(name, body);
    return { result };
  });

  // Registra nova skill
  app.post('/api/v1/ai/skills/register', async (request, reply) => {
    const body = request.body as {
      name: string;
      description: string;
      keywords: string[];
    };

    if (!body.name || !body.description || !body.keywords) {
      return reply.status(400).send({ error: 'name, description e keywords são obrigatórios' });
    }

    hybridAI.registerSkill({
      name: body.name,
      description: body.description,
      keywords: body.keywords,
      handler: async (params: any) => {
        // Handler genérico - pode ser sobrescrito
        return `Skill ${body.name} executada com params: ${JSON.stringify(params)}`;
      }
    });

    return { success: true, message: `Skill '${body.name}' registrada` };
  });

  // ==================== LEARNING ====================

  // Estatísticas de aprendizado do Sistema 1 e Sistema 2
  app.get('/api/v1/ai/learning/stats', async (request, reply) => {
    const stats = hybridAI.getLearningStats();
    return {
      ...stats,
      description: {
        system1: 'Padrões rápidos aprendidos (Kahneman S1)',
        system2: 'Raciocínios analíticos registrados (Kahneman S2)',
        positiveFeedback: 'Feedbacks positivos promovem S2 → S1',
        negativeFeedback: 'Feedbacks negativos reduzem confiança S1'
      }
    };
  });

  // Feedback para aprendizado
  app.post('/api/v1/ai/feedback', async (request, reply) => {
    const body = request.body as {
      experienceId: string;
      feedback: 'positive' | 'negative';
    };

    if (!body.experienceId || !body.feedback) {
      return reply.status(400).send({ error: 'experienceId e feedback são obrigatórios' });
    }

    hybridAI.feedback(body.experienceId, body.feedback);
    
    return { 
      success: true, 
      message: `Feedback ${body.feedback} registrado. O sistema aprenderá com isso.` 
    };
  });

  // Processa mensagem para aprendizado
  app.post('/api/v1/rag/learn', async (request, reply) => {
    const body = request.body as {
      from: string;
      text: string;
      chatId: string;
    };

    const result = await telegramLearning.processMessage(body);
    return result;
  });

  // Salva insight manual
  app.post('/api/v1/rag/insight', async (request, reply) => {
    const body = request.body as {
      topic: string;
      insight: string;
      author?: string;
    };

    await ragService.notifyLearning(body.topic, body.insight);
    return { success: true, message: 'Insight salvo e notificado' };
  });

  // ==================== STATS ====================

  // Estatísticas do RAG
  app.get('/api/v1/rag/stats', async (request, reply) => {
    const stats = ragService.getStats();
    return {
      ...stats,
      books: [
        'Trading in the Zone - Mark Douglas',
        'O Trader Disciplinado - Mark Douglas',
        'Antifrágil - Nassim Taleb',
        'Rápido e Devagar - Kahneman',
        'The Mental Game of Trading - Tendler',
        'Atomic Habits - James Clear',
        'Meditations - Marcus Aurelius',
        'The Daily Trading Coach - Steenbarger',
        'Quantitative Trading - Howard Bandy',
        'Intermarket Analysis - John Murphy'
      ],
      status: 'active',
      features: ['RAG Vetorial', 'Skills', 'Tempo Real', 'HybridAI']
    };
  });

  // Limpa cache
  app.post('/api/v1/rag/cache/clear', async (request, reply) => {
    ragService.clearCache();
    return { success: true };
  });

  // ==================== BOOKS ====================

  // Lista livros disponíveis
  app.get('/api/v1/rag/books', async (request, reply) => {
    return {
      total: 27,
      categories: {
        psicologia: ['Trading in the Zone', 'O Trader Disciplinado', 'Rápido e Devagar', 'The Mental Game of Trading'],
        risco: ['Antifrágil', 'Cisne Negro', 'Skin in the Game'],
        habitos: ['Atomic Habits'],
        coach: ['The Daily Trading Coach'],
        filosofia: ['Meditations'],
        quant: ['Quantitative Trading Systems'],
        correlacao: ['Intermarket Analysis'],
        tecnica: ['Japanese Candlestick', 'Bollinger on Bands', 'Price Action Trends']
      }
    };
  });

  console.log('[Routes] RAG routes registered (HybridAI + Skills + VectorStore)');
}
