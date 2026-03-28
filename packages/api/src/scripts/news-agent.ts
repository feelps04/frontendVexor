/**
 * News Agent - Análise de Sentimento com Ollama
 * 
 * Monitora notícias econômicas e analisa impacto no WIN/WDO
 * Integra com calendário econômico e ajusta viés do trading
 */

import * as http from 'http';
import * as fs from 'fs';
import { config } from 'dotenv';

const rootEnv = 'C:/Users/opc/CascadeProjects/vexor-Oracle/vexor-Oracle-main/.env';
if (fs.existsSync(rootEnv)) {
  config({ path: rootEnv, override: true });
}

// ==================== CONFIG ====================

const NEWS_CONFIG = {
  port: parseInt(process.env.NEWS_AGENT_PORT || '8082'),
  ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
  ollamaModel: process.env.OLLAMA_MODEL || 'llama3.2',
  bridgeUrl: process.env.OCI_BRIDGE_URL || 'http://localhost:8080',
  lambdaUrl: process.env.PAPER_LAMBDA_URL || 'http://localhost:8081',
  authToken: process.env.BRIDGE_AUTH_TOKEN || 'vexor-bridge-2026'
};

// ==================== INTERFACES ====================

interface NewsEvent {
  id: string;
  title: string;
  country: string;
  currency: string;
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  forecast?: string;
  previous?: string;
  actual?: string;
  datetime: Date;
  category: string;
}

interface SentimentAnalysis {
  newsId: string;
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;
  impact: {
    win: 'UP' | 'DOWN' | 'NEUTRAL';
    wdo: 'UP' | 'DOWN' | 'NEUTRAL';
  };
  reasoning: string;
  newsLock: boolean;
  lockDuration: number; // minutos
}

interface EconomicCalendar {
  events: NewsEvent[];
  lastUpdate: Date;
}

// ==================== STATE ====================

const CALENDAR: EconomicCalendar = { events: [], lastUpdate: new Date() };
const SENTIMENTS: Map<string, SentimentAnalysis> = new Map();
let NEWS_LOCK_ACTIVE = false;
let NEWS_LOCK_UNTIL = 0;

// ==================== HTTP SERVER ====================

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  // Health check
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'news-agent',
      ollama: NEWS_CONFIG.ollamaUrl,
      model: NEWS_CONFIG.ollamaModel,
      eventsMonitored: CALENDAR.events.length,
      newsLockActive: NEWS_LOCK_ACTIVE
    }));
    return;
  }
  
  // Status do News Agent
  if (req.url === '/status') {
    const highImpactEvents = CALENDAR.events.filter(e => e.impact === 'HIGH');
    const recentSentiments = Array.from(SENTIMENTS.values()).slice(-10);
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      newsLock: NEWS_LOCK_ACTIVE,
      lockUntil: NEWS_LOCK_UNTIL,
      highImpactEvents: highImpactEvents.length,
      recentSentiments,
      nextHighImpact: getNextHighImpactEvent()
    }));
    return;
  }
  
  // Verifica se News Lock está ativo
  if (req.url === '/lock') {
    const now = Date.now();
    NEWS_LOCK_ACTIVE = now < NEWS_LOCK_UNTIL;
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      active: NEWS_LOCK_ACTIVE,
      remainingSeconds: Math.max(0, Math.floor((NEWS_LOCK_UNTIL - now) / 1000))
    }));
    return;
  }
  
  // Recebe evento de notícia para análise
  if (req.method === 'POST' && req.url === '/analyze') {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${NEWS_CONFIG.authToken}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const news = JSON.parse(body) as NewsEvent;
        
        console.log(`📰 Analisando: ${news.title}`);
        console.log(`   Impacto: ${news.impact} | País: ${news.country}`);
        
        // Analisa sentimento com Ollama
        const sentiment = await analyzeWithOllama(news);
        SENTIMENTS.set(news.id, sentiment);
        
        // Ativa News Lock se necessário
        if (sentiment.newsLock) {
          activateNewsLock(sentiment.lockDuration);
        }
        
        // Envia para Bridge/Telegram
        await notifySentiment(news, sentiment);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(sentiment));
        
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }
  
  // Adiciona eventos ao calendário
  if (req.method === 'POST' && req.url === '/calendar') {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${NEWS_CONFIG.authToken}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const events = JSON.parse(body) as NewsEvent[];
        
        for (const event of events) {
          // Verifica se já existe
          const existing = CALENDAR.events.find(e => e.id === event.id);
          if (!existing) {
            CALENDAR.events.push(event);
          }
        }
        
        CALENDAR.lastUpdate = new Date();
        
        console.log(`📅 Calendário atualizado: ${events.length} eventos`);
        
        // Analisa eventos de alto impacto que acontecem em breve
        await analyzeUpcomingEvents();
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, total: CALENDAR.events.length }));
        
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }
  
  // Retorna calendário
  if (req.url === '/calendar') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(CALENDAR.events));
    return;
  }
  
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// ==================== OLLAMA ANALYSIS ====================

async function analyzeWithOllama(news: NewsEvent): Promise<SentimentAnalysis> {
  const prompt = `Você é um analista de mercado financeiro especializado em derivativos brasileiros (WIN - Ibovespa, WDO - Dólar).

Analise o seguinte evento econômico e determine o impacto nos ativos:

EVENTO: ${news.title}
PAÍS: ${news.country}
MOEDA: ${news.currency}
IMPACTO: ${news.impact}
PREVISÃO: ${news.forecast || 'N/A'}
ANTERIOR: ${news.previous || 'N/A'}
REALIZADO: ${news.actual || 'Ainda não divulgado'}
CATEGORIA: ${news.category}

Responda em JSON EXATAMENTE neste formato:
{
  "bias": "BULLISH" ou "BEARISH" ou "NEUTRAL",
  "confidence": 0-100,
  "impact": {
    "win": "UP" ou "DOWN" ou "NEUTRAL",
    "wdo": "UP" ou "DOWN" ou "NEUTRAL"
  },
  "reasoning": "Explicação breve do porquê",
  "newsLock": true se alta volatilidade esperada,
  "lockDuration": minutos de pausa recomendados (0-10)
}`;

  try {
    const response = await fetch(`${NEWS_CONFIG.ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: NEWS_CONFIG.ollamaModel,
        prompt: prompt,
        stream: false,
        format: 'json'
      })
    });

    if (!response.ok) {
      console.log(`⚠️ Ollama erro: ${response.status}`);
      return getDefaultSentiment(news);
    }

    const result = await response.json() as any;
    const analysis = JSON.parse(result.response || '{}');
    
    console.log(`🤖 Ollama Analysis:`);
    console.log(`   Bias: ${analysis.bias} (${analysis.confidence}%)`);
    console.log(`   WIN: ${analysis.impact?.win} | WDO: ${analysis.impact?.wdo}`);
    console.log(`   News Lock: ${analysis.newsLock ? 'SIM' : 'NÃO'}`);
    
    return {
      newsId: news.id,
      bias: analysis.bias || 'NEUTRAL',
      confidence: analysis.confidence || 50,
      impact: analysis.impact || { win: 'NEUTRAL', wdo: 'NEUTRAL' },
      reasoning: analysis.reasoning || 'Análise não disponível',
      newsLock: analysis.newsLock || false,
      lockDuration: analysis.lockDuration || 0
    };

  } catch (e) {
    console.log(`⚠️ Erro Ollama: ${e}`);
    return getDefaultSentiment(news);
  }
}

function getDefaultSentiment(news: NewsEvent): SentimentAnalysis {
  // Fallback baseado em regras simples
  const isUSD = news.currency === 'USD' || news.country === 'United States';
  const isBRL = news.currency === 'BRL' || news.country === 'Brazil';
  
  let bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  let winImpact: 'UP' | 'DOWN' | 'NEUTRAL' = 'NEUTRAL';
  let wdoImpact: 'UP' | 'DOWN' | 'NEUTRAL' = 'NEUTRAL';
  
  // Notícias dos EUA geralmente fortalecem o dólar
  if (isUSD && news.impact === 'HIGH') {
    wdoImpact = 'UP';
    winImpact = 'DOWN';
    bias = 'BEARISH';
  }
  
  // Notícias do Brasil geralmente fortalecem o índice
  if (isBRL && news.impact === 'HIGH') {
    winImpact = 'UP';
    bias = 'BULLISH';
  }
  
  return {
    newsId: news.id,
    bias,
    confidence: 60,
    impact: { win: winImpact, wdo: wdoImpact },
    reasoning: 'Análise baseada em regras (Ollama indisponível)',
    newsLock: news.impact === 'HIGH',
    lockDuration: news.impact === 'HIGH' ? 5 : 0
  };
}

// ==================== NEWS LOCK ====================

function activateNewsLock(durationMinutes: number): void {
  NEWS_LOCK_UNTIL = Date.now() + durationMinutes * 60 * 1000;
  NEWS_LOCK_ACTIVE = true;
  
  console.log(`🔒 NEWS LOCK ATIVADO por ${durationMinutes} minutos`);
  
  // Notifica Lambda para pausar
  fetch(`${NEWS_CONFIG.lambdaUrl}/lock`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${NEWS_CONFIG.authToken}`
    },
    body: JSON.stringify({ active: true, duration: durationMinutes })
  }).catch(() => {});
}

function getNextHighImpactEvent(): NewsEvent | null {
  const now = new Date();
  const upcoming = CALENDAR.events
    .filter(e => e.impact === 'HIGH' && new Date(e.datetime) > now)
    .sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());
  
  return upcoming[0] || null;
}

async function analyzeUpcomingEvents(): Promise<void> {
  const now = new Date();
  const fiveMinutes = 5 * 60 * 1000;
  
  for (const event of CALENDAR.events) {
    if (event.impact !== 'HIGH') continue;
    
    const eventTime = new Date(event.datetime);
    const timeDiff = eventTime.getTime() - now.getTime();
    
    // Se o evento acontece em menos de 5 minutos
    if (timeDiff > 0 && timeDiff < fiveMinutes) {
      console.log(`⏰ Evento próximo: ${event.title} em ${Math.floor(timeDiff / 60000)} min`);
      
      // Analisa com Ollama
      if (!SENTIMENTS.has(event.id)) {
        const sentiment = await analyzeWithOllama(event);
        SENTIMENTS.set(event.id, sentiment);
        
        // Ativa News Lock 2 minutos antes
        if (sentiment.newsLock) {
          activateNewsLock(7); // 2 min antes + 5 min depois
        }
        
        await notifySentiment(event, sentiment);
      }
    }
  }
}

async function notifySentiment(news: NewsEvent, sentiment: SentimentAnalysis): Promise<void> {
  const emoji = sentiment.bias === 'BULLISH' ? '🟢' : sentiment.bias === 'BEARISH' ? '🔴' : '🟡';
  const lockEmoji = sentiment.newsLock ? '🔒' : '✅';
  
  const message = `📰 <b>ANÁLISE DE SENTIMENTO</b>\n\n` +
    `<b>${news.title}</b>\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `${emoji} <b>Viés:</b> ${sentiment.bias} (${sentiment.confidence}%)\n` +
    `📈 <b>WIN:</b> ${sentiment.impact.win}\n` +
    `💵 <b>WDO:</b> ${sentiment.impact.wdo}\n\n` +
    `${lockEmoji} <b>News Lock:</b> ${sentiment.newsLock ? `ATIVO (${sentiment.lockDuration}min)` : 'Inativo'}\n\n` +
    `📝 ${sentiment.reasoning}`;
  
  // Envia para Bridge retransmitir para Telegram
  await fetch(`${NEWS_CONFIG.bridgeUrl}/alert`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${NEWS_CONFIG.authToken}`
    },
    body: JSON.stringify({ type: 'sentiment', newsId: news.id, message })
  });
}

// ==================== START ====================

server.listen(NEWS_CONFIG.port, () => {
  console.log('');
  console.log('📰 ========================================');
  console.log('📰 NEWS AGENT - SENTIMENT ANALYSIS');
  console.log('📰 ========================================');
  console.log('');
  console.log(`Porta: ${NEWS_CONFIG.port}`);
  console.log(`Ollama: ${NEWS_CONFIG.ollamaUrl} (${NEWS_CONFIG.ollamaModel})`);
  console.log(`Bridge: ${NEWS_CONFIG.bridgeUrl}`);
  console.log(`Lambda: ${NEWS_CONFIG.lambdaUrl}`);
  console.log('');
  console.log('Endpoints:');
  console.log('  POST /analyze   - Analisa sentimento de notícia');
  console.log('  POST /calendar  - Adiciona eventos ao calendário');
  console.log('  GET  /calendar  - Retorna calendário econômico');
  console.log('  GET  /status    - Status do News Agent');
  console.log('  GET  /lock      - Verifica News Lock ativo');
  console.log('');
});

// Monitor de eventos a cada minuto
setInterval(analyzeUpcomingEvents, 60000);
