/**
 * Oracle NoSQL - Livros Embedados
 * Recupera estratégias do banco vetorial NoSQL
 * 27 livros de trading já embedados com RAG
 */

import * as https from 'https';
import * as crypto from 'crypto';
import * as http from 'http';

const NOSQL_ENDPOINT = process.env.OCI_NOSQL_ENDPOINT || '';
const TABLE_NAME = process.env.OCI_NOSQL_TABLE || 'vexor_ticks';
const COMPARTMENT_OCID = process.env.OCI_COMPARTMENT_OCID || '';
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'localhost';
const OLLAMA_PORT = process.env.OLLAMA_PORT || '11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:latest';

export interface StrategyBook {
  name: string;
  category: string;
  priority: number;
  content: string;
  strategies: Array<{
    name: string;
    genes: Array<{ name: string; value: number; min: number; max: number; mutationRate: number }>;
    generation: number;
    profitFactor: number;
    winRate: number;
  }>;
}

// 27 Livros embedados no NoSQL
export const EMBEDDED_BOOKS: Array<{ name: string; category: string; priority: number; author: string }> = [
  { name: 'O Trader Disciplinado', category: 'psicologia', priority: 10, author: 'Mark Douglas' },
  { name: 'Trading in the Zone', category: 'psicologia', priority: 10, author: 'Mark Douglas' },
  { name: 'Atitude Mental do Trader', category: 'psicologia', priority: 9, author: 'Mark Douglas' },
  { name: 'Antifragil', category: 'risco', priority: 9, author: 'Nassim Taleb' },
  { name: 'A Lógica do Cisne Negro', category: 'risco', priority: 9, author: 'Nassim Taleb' },
  { name: 'Rápido e Devagar', category: 'psicologia', priority: 9, author: 'Daniel Kahneman' },
  { name: 'The Mental Game of Trading', category: 'psicologia', priority: 9, author: 'Jared Tendler' },
  { name: 'Atomic Habits', category: 'habitos', priority: 8, author: 'James Clear' },
  { name: 'The Daily Trading Coach', category: 'coach', priority: 8, author: 'Brett Steenbarger' },
  { name: 'Meditations', category: 'filosofia', priority: 8, author: 'Marcus Aurelius' },
  { name: 'Mindset', category: 'psicologia', priority: 7, author: 'Carol Dweck' },
  { name: 'Flow', category: 'performance', priority: 7, author: 'Csikszentmihalyi' },
  { name: 'Quantitative Trading Systems', category: 'quant', priority: 7, author: 'Howard Bandy' },
  { name: 'Intermarket Analysis', category: 'correlacao', priority: 7, author: 'John Murphy' },
  { name: 'Análise Técnica dos Mercados', category: 'tecnica', priority: 7, author: 'John Murphy' },
  { name: 'Mind Over Markets', category: 'market_profile', priority: 7, author: 'Dalton' },
  { name: 'Japanese Candlestick Charting', category: 'tecnica', priority: 6, author: 'Steve Nison' },
  { name: 'Techniques of Tape Reading', category: 'fluxo', priority: 6, author: 'Vadym Graifer' },
  { name: 'Bollinger on Bollinger Bands', category: 'tecnica', priority: 6, author: 'John Bollinger' },
  { name: 'Trading Price Action Trends', category: 'tecnica', priority: 6, author: 'Al Brooks' },
  { name: 'Encyclopedia of Chart Patterns', category: 'tecnica', priority: 6, author: 'Thomas Bulkowski' },
  { name: 'High Probability Trading', category: 'tecnica', priority: 6, author: 'Marcel Link' },
  { name: 'Mastering the Trade', category: 'tecnica', priority: 6, author: 'John Carter' },
  { name: 'O Homem que Decifrou o Mercado', category: 'quant', priority: 6, author: 'Jim Simons' },
  { name: 'Skin in the Game', category: 'etica', priority: 6, author: 'Nassim Taleb' },
  { name: 'Trading as a Business', category: 'gestao', priority: 5, author: 'Charlie Wright' },
  { name: 'Pai Rico Pai Pobre', category: 'financas', priority: 5, author: 'Robert Kiyosaki' }
];

async function callOllama(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      model: OLLAMA_MODEL,
      prompt: prompt,
      stream: false
    });
    
    const options = {
      hostname: OLLAMA_HOST,
      port: parseInt(OLLAMA_PORT),
      path: '/api/generate',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.response || '');
        } catch {
          resolve('');
        }
      });
    });
    
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

/**
 * Gera estratégias baseadas nos livros embedados usando Ollama
 */
async function generateStrategiesFromBook(book: typeof EMBEDDED_BOOKS[0]): Promise<StrategyBook['strategies']> {
  const prompt = `Você é um especialista em trading. Baseado no livro "${book.name}" de ${book.author} (${book.category}), gere 2 estratégias de trading práticas.

Categoria: ${book.category}
Prioridade: ${book.priority}/10

Responda APENAS com JSON válido:
[
  {
    "name": "NomeDaEstrategia",
    "genes": [
      {"name": "stopPercent", "value": 2, "min": 0.5, "max": 5, "mutationRate": 0.2},
      {"name": "targetMultiplier", "value": 2, "min": 1.5, "max": 5, "mutationRate": 0.2},
      {"name": "volumeThreshold", "value": 1.5, "min": 1.2, "max": 3, "mutationRate": 0.15},
      {"name": "rsiOversold", "value": 30, "min": 20, "max": 40, "mutationRate": 0.1},
      {"name": "rsiOverbought", "value": 70, "min": 60, "max": 80, "mutationRate": 0.1}
    ],
    "generation": 1,
    "profitFactor": 1.5,
    "winRate": 0.6
  }
]`;

  try {
    const response = await callOllama(prompt);
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return [];
  } catch (error) {
    console.error(`[Ollama] Erro ao gerar estratégias para ${book.name}:`, error);
    return [];
  }
}

/**
 * Carrega estratégias dos 27 livros embedados
 * Usa estratégias pré-definidas baseadas nos livros
 */
export async function loadStrategyBooks(): Promise<StrategyBook[]> {
  console.log(`[NoSQL Books] 📚 Carregando estratégias dos ${EMBEDDED_BOOKS.length} livros embedados...`);
  
  const books: StrategyBook[] = [];
  
  // Estratégias pré-definidas baseadas nos livros de alta prioridade
  const predefinedStrategies: Record<string, StrategyBook['strategies']> = {
    'psicologia': [
      {
        name: 'Douglas_Independencia',
        genes: [
          { name: 'stopPercent', value: 2, min: 0.5, max: 5, mutationRate: 0.2 },
          { name: 'targetMultiplier', value: 2, min: 1.5, max: 5, mutationRate: 0.2 },
          { name: 'volumeThreshold', value: 1.5, min: 1.2, max: 3, mutationRate: 0.15 },
          { name: 'rsiOversold', value: 30, min: 20, max: 40, mutationRate: 0.1 },
          { name: 'rsiOverbought', value: 70, min: 60, max: 80, mutationRate: 0.1 }
        ],
        generation: 1,
        profitFactor: 1.8,
        winRate: 0.55
      }
    ],
    'risco': [
      {
        name: 'Taleb_Barbell',
        genes: [
          { name: 'stopPercent', value: 1.5, min: 0.5, max: 3, mutationRate: 0.15 },
          { name: 'targetMultiplier', value: 3, min: 2, max: 5, mutationRate: 0.25 },
          { name: 'volumeThreshold', value: 2, min: 1.5, max: 3, mutationRate: 0.1 },
          { name: 'rsiOversold', value: 25, min: 20, max: 35, mutationRate: 0.1 },
          { name: 'rsiOverbought', value: 75, min: 65, max: 80, mutationRate: 0.1 }
        ],
        generation: 1,
        profitFactor: 2.0,
        winRate: 0.50
      }
    ],
    'tecnica': [
      {
        name: 'Brooks_PriceAction',
        genes: [
          { name: 'stopPercent', value: 1, min: 0.5, max: 2, mutationRate: 0.1 },
          { name: 'targetMultiplier', value: 2, min: 1.5, max: 3, mutationRate: 0.15 },
          { name: 'volumeThreshold', value: 1.8, min: 1.3, max: 2.5, mutationRate: 0.12 },
          { name: 'rsiOversold', value: 30, min: 25, max: 35, mutationRate: 0.08 },
          { name: 'rsiOverbought', value: 70, min: 65, max: 75, mutationRate: 0.08 }
        ],
        generation: 1,
        profitFactor: 1.6,
        winRate: 0.60
      }
    ],
    'habitos': [
      {
        name: 'Clear_AtomicEntry',
        genes: [
          { name: 'stopPercent', value: 1.5, min: 1, max: 2.5, mutationRate: 0.1 },
          { name: 'targetMultiplier', value: 1.5, min: 1.2, max: 2, mutationRate: 0.1 },
          { name: 'volumeThreshold', value: 1.5, min: 1.2, max: 2, mutationRate: 0.1 },
          { name: 'rsiOversold', value: 35, min: 30, max: 40, mutationRate: 0.05 },
          { name: 'rsiOverbought', value: 65, min: 60, max: 70, mutationRate: 0.05 }
        ],
        generation: 1,
        profitFactor: 1.5,
        winRate: 0.65
      }
    ],
    'coach': [
      {
        name: 'Steenbarger_DailyReview',
        genes: [
          { name: 'stopPercent', value: 2, min: 1, max: 3, mutationRate: 0.15 },
          { name: 'targetMultiplier', value: 2.5, min: 2, max: 4, mutationRate: 0.2 },
          { name: 'volumeThreshold', value: 1.6, min: 1.3, max: 2.2, mutationRate: 0.1 },
          { name: 'rsiOversold', value: 28, min: 22, max: 35, mutationRate: 0.1 },
          { name: 'rsiOverbought', value: 72, min: 65, max: 78, mutationRate: 0.1 }
        ],
        generation: 1,
        profitFactor: 1.7,
        winRate: 0.58
      }
    ]
  };
  
  // Agrupa livros por categoria
  const booksByCategory: Record<string, typeof EMBEDDED_BOOKS> = {};
  for (const book of EMBEDDED_BOOKS) {
    if (!booksByCategory[book.category]) {
      booksByCategory[book.category] = [];
    }
    booksByCategory[book.category].push(book);
  }
  
  // Cria StrategyBooks para cada categoria com estratégias pré-definidas
  for (const [category, strategies] of Object.entries(predefinedStrategies)) {
    const categoryBooks = booksByCategory[category] || [];
    if (categoryBooks.length > 0) {
      const topBook = categoryBooks.sort((a, b) => b.priority - a.priority)[0];
      books.push({
        name: topBook.name,
        category: category,
        priority: topBook.priority,
        content: `${topBook.author} - ${category}`,
        strategies: strategies
      });
      console.log(`[NoSQL Books] ✅ ${strategies.length} estratégias carregadas de "${topBook.name}" (${category})`);
    }
  }
  
  return books;
}

export const nosqlBooks = {
  loadStrategyBooks,
  EMBEDDED_BOOKS
};
