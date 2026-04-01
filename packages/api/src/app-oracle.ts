// VEXOR API - Oracle Cloud Integration
// PostgreSQL + OCI GenAI + Memory Mapped File Reader

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import staticPlugin from '@fastify/static';
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { readMemoryMappedFile, analyzeWithGenAI, startMemoryReader, shouldTrade, generateAIWisdom, TRADING_WISDOM } from './services/memory-reader.js';
import { initializeOracleMemory, getTradingWisdomFromOracle, saveToOracle, getFromOracle } from './services/oracle-memory.js';
import { 
  saveAIDecisionLog, 
  saveTradeToATP, 
  saveTickToNoSQL, 
  analyzeWithMarkDouglas,
  AIDecisionLog,
  TradeHistory,
  MarketTickNoSQL
} from './services/oci-databases.js';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Pool } = pg;
const app = Fastify({ logger: true });

// PostgreSQL Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:Vexor2026@localhost:5432/vexor',
  // SSL desabilitado para PostgreSQL local
});

// Plugins
app.register(cors, { origin: '*' });
app.register(helmet, { contentSecurityPolicy: false });

// ==================== HEALTH ====================
app.get('/api/v1/health', async () => ({
  status: 'ok',
  timestamp: new Date().toISOString(),
  version: '2.0.0',
  server: 'VEXOR Oracle Cloud',
  database: 'PostgreSQL',
  ai: 'OCI GenAI Llama 3 70B'
}));

// ==================== MEMORY ROUTES ====================

// Lê dados em tempo real da memória MMF
app.get('/api/v1/memory/ticks', async () => {
  const ticks = await readMemoryMappedFile();
  return {
    success: true,
    data: ticks,
    count: ticks.length,
    timestamp: new Date().toISOString()
  };
});

// Análise de mercado com OCI GenAI
app.get('/api/v1/memory/analyze', async () => {
  const ticks = await readMemoryMappedFile();
  const analysis = await analyzeWithGenAI(ticks);
  return {
    success: true,
    analysis,
    dataPoints: ticks.length,
    timestamp: new Date().toISOString()
  };
});

// Status do sistema
app.get('/api/v1/memory/status', async () => ({
  success: true,
  status: 'active',
  platform: process.platform,
  mmfPath: process.env.MMF_PATH || 'C:\\vexor\\mt5_data\\market_data.mmf',
  database: 'PostgreSQL Local',
  aiModel: 'Llama 3 70B'
}));

// Resumo por símbolo
app.get('/api/v1/memory/summary', async () => {
  const ticks = await readMemoryMappedFile();
  const summary = ticks.reduce((acc, tick) => {
    if (!acc[tick.symbol]) {
      acc[tick.symbol] = {
        symbol: tick.symbol,
        bid: tick.bid,
        ask: tick.ask,
        last: tick.last,
        volume: tick.volume,
        spread: tick.ask - tick.bid
      };
    } else {
      acc[tick.symbol].volume += tick.volume;
    }
    return acc;
  }, {} as Record<string, any>);
  
  return { success: true, summary: Object.values(summary) };
});

// ==================== MARKET DATA ROUTES ====================

// Salvar tick no banco
app.post('/api/v1/market/tick', async (request) => {
  const { symbol, bid, ask, last, volume, timestamp } = request.body as any;
  
  try {
    await pool.query(`
      INSERT INTO market_ticks (symbol, bid, ask, last_price, volume, timestamp)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [symbol, bid, ask, last, volume, timestamp]);
    
    return { success: true };
  } catch (error) {
    return { success: false, error: 'Erro ao salvar tick' };
  }
});

// Histórico de ticks
app.get('/api/v1/market/history/:symbol', async (request) => {
  const { symbol } = request.params as any;
  
  try {
    const result = await pool.query(`
      SELECT * FROM market_ticks
      WHERE symbol = $1
      ORDER BY timestamp DESC
      LIMIT 100
    `, [symbol]);
    
    return { ticks: result.rows };
  } catch {
    return { ticks: [] };
  }
});

// ==================== AI ANALYSIS ROUTES ====================

// Salvar análise
app.post('/api/v1/ai/analysis', async (request) => {
  const { type, content, dataPoints } = request.body as any;
  
  try {
    const result = await pool.query(`
      INSERT INTO ai_analysis (analysis_type, content, data_points)
      VALUES ($1, $2, $3)
      RETURNING id
    `, [type, content, dataPoints]);
    
    return { success: true, id: result.rows[0].id };
  } catch {
    return { success: false };
  }
});

// Histórico de análises
app.get('/api/v1/ai/history', async () => {
  try {
    const result = await pool.query(`
      SELECT * FROM ai_analysis
      ORDER BY created_at DESC
      LIMIT 10
    `);
    return { analyses: result.rows };
  } catch {
    return { analyses: [] };
  }
});

// ==================== TRADING WISDOM ROUTES (Oracle Cloud) ====================

// Verificar se pode operar
app.post('/api/v1/trading/can-trade', async (request) => {
  const traderState = request.body as any;
  const result = shouldTrade(traderState);
  return result;
});

// Obter sabedoria de trading da Oracle Cloud
app.get('/api/v1/trading/wisdom', async () => {
  const wisdom = await getTradingWisdomFromOracle();
  return wisdom;
});

// Gerar mensagem de sabedoria baseada no contexto
app.post('/api/v1/trading/wisdom/generate', async (request) => {
  const context = request.body as any;
  const wisdom = generateAIWisdom(context);
  return { wisdom };
});

// Regras de Cadeado de Ferro
app.get('/api/v1/trading/iron-lock-rules', async () => {
  const wisdom = await getTradingWisdomFromOracle();
  return {
    rules: wisdom.cadeadoDeFerro?.rules || TRADING_WISDOM.cadeadoDeFerro.rules,
    definition: wisdom.cadeadoDeFerro?.definition || TRADING_WISDOM.cadeadoDeFerro.definition,
    enforcement: TRADING_WISDOM.cadeadoDeFerro.enforcement
  };
});

// Salvar memória do trader na Oracle
app.post('/api/v1/trading/memory/save', async (request) => {
  const { key, data } = request.body as any;
  const success = await saveToOracle(key, data);
  return { success, stored: success ? 'oracle-cloud' : 'local-fallback' };
});

// Recuperar memória do trader da Oracle
app.get('/api/v1/trading/memory/get/:key', async (request) => {
  const { key } = request.params as any;
  const data = await getFromOracle(key);
  return { success: !!data, data };
});

// ==================== OCI DATABASES ROUTES ====================

// Salvar log de decisão da IA (Autonomous JSON)
app.post('/api/v1/oci/ai-log', async (request) => {
  const log = request.body as AIDecisionLog;
  const success = await saveAIDecisionLog(log);
  return { success, storage: 'autonomous-json' };
});

// Salvar trade no ATP
app.post('/api/v1/oci/trade', async (request) => {
  const trade = request.body as TradeHistory;
  const success = await saveTradeToATP(trade);
  return { success, storage: 'atp' };
});

// Salvar tick no NoSQL
app.post('/api/v1/oci/tick', async (request) => {
  const tick = request.body as MarketTickNoSQL;
  const success = await saveTickToNoSQL(tick);
  return { success, storage: 'nosql' };
});

// Análise com Mark Douglas Wisdom
app.post('/api/v1/oci/analyze-mark-douglas', async (request) => {
  const { marketData, traderState } = request.body as any;
  const result = await analyzeWithMarkDouglas(marketData, traderState);
  return result;
});

// ==================== STATIC FILES ====================

await app.register(staticPlugin, {
  root: path.join(__dirname, '../web/dist'),
  prefix: '/'
});

app.setNotFoundHandler(async (request, reply) => {
  reply.sendFile('index.html');
});

// ==================== START ====================

const start = async () => {
  try {
    // Inicializa memória Oracle Cloud
    await initializeOracleMemory();
    console.log('🔮 Oracle Cloud Memory inicializada');
    
    // Inicia leitor de memória em background
    startMemoryReader(1000);
    console.log('🔍 Memory Reader iniciado');
    
    const port = parseInt(process.env.PORT || '3000');
    await app.listen({ port, host: '0.0.0.0' });
    console.log(`🚀 VEXOR API rodando na porta ${port}`);
    console.log('📊 PostgreSQL conectado');
    console.log('🤖 OCI GenAI pronto');
    console.log('💾 Trading Wisdom na Oracle Cloud');
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
