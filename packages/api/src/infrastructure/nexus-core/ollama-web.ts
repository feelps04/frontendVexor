/**
 * VEXOR Ollama Web - Acesso à Internet para Tempo Real
 * 
 * Permite que o Ollama consulte dados em tempo real:
 * - Preços de ativos
 * - Notícias de mercado
 * - Indicadores macroeconômicos
 * - Sentiment de redes sociais
 * 
 * Integração MetaTrader:
 * - Genial (MT5) — corretora brasileira, B3
 * - Pepperstone (MT5) — forex/CFD global
 */

import * as https from 'https';
import * as http from 'http';

// ==================== TYPES ====================

interface WebSearchResult {
  title: string;
  snippet: string;
  url: string;
  timestamp: Date;
}

interface MarketData {
  symbol: string;
  price: number;
  change_24h: number;
  volume_24h: number;
  timestamp: Date;
}

interface NewsItem {
  title: string;
  source: string;
  summary: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  timestamp: Date;
  url: string;
}

interface MacroIndicator {
  name: string;
  value: number;
  change: number;
  country: string;
  timestamp: Date;
}

interface OllamaWebResponse {
  context: string;
  market_data: MarketData[];
  news: NewsItem[];
  macro: MacroIndicator[];
  response: string;
}

// ==================== OLLAMA WEB SERVICE ====================

class OllamaWebService {
  private ollamaHost = process.env.OLLAMA_HOST || 'localhost';
  private ollamaPort = process.env.OLLAMA_PORT || '11434';
  private ollamaModel = process.env.OLLAMA_MODEL || 'llama3.2:latest';
  
  // Sentinel API (MT5 real) - múltiplos brokers
  private sentinelUrl = 'http://localhost:8765';
  private genialUrl = process.env.GENIAL_MT5_URL || 'http://localhost:8766';
  private pepperstoneUrl = process.env.PEPPERSTONE_MT5_URL || 'http://localhost:8767';
  
  // Mapeamento de símbolos para brokers
  private brokerSymbols: Record<string, string> = {
    // B3 - Genial
    'WIN': 'genial', 'WDO': 'genial', 'IND': 'genial', 'DOL': 'genial',
    'PETR4': 'genial', 'VALE3': 'genial', 'ITUB4': 'genial', 'BBDC4': 'genial',
    'BBAS3': 'genial', 'MGLU3': 'genial', 'ABEV3': 'genial', 'BBSE3': 'genial',
    // Forex/CFD - Pepperstone
    'EURUSD': 'pepperstone', 'GBPUSD': 'pepperstone', 'USDJPY': 'pepperstone',
    'AUDUSD': 'pepperstone', 'USDCAD': 'pepperstone', 'USDCHF': 'pepperstone',
    'XAUUSD': 'pepperstone', 'XAGUSD': 'pepperstone', 'USOIL': 'pepperstone',
    'US500': 'pepperstone', 'US30': 'pepperstone', 'NAS100': 'pepperstone',
  };
  
  // Cache para dados de mercado
  private marketCache: Map<string, { data: MarketData; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 60000; // 1 minuto

  /**
   * Consulta Ollama com contexto web em tempo real
   */
  async queryWithWeb(
    prompt: string,
    symbols: string[] = [],
    includeNews: boolean = true,
    includeMacro: boolean = true
  ): Promise<OllamaWebResponse> {
    const startTime = Date.now();
    
    // Busca dados em paralelo
    const [marketData, news, macro] = await Promise.all([
      symbols.length > 0 ? this.fetchMarketData(symbols) : Promise.resolve([]),
      includeNews ? this.fetchMarketNews() : Promise.resolve([]),
      includeMacro ? this.fetchMacroIndicators() : Promise.resolve([])
    ]);

    // Monta contexto web
    const webContext = this.buildWebContext(marketData, news, macro);

    // Monta prompt completo
    const fullPrompt = `
=== DADOS EM TEMPO REAL ===
${webContext}

=== PERGUNTA ===
${prompt}

Responda considerando os dados em tempo real acima.
`;

    // Chama Ollama
    const response = await this.callOllama(fullPrompt);

    console.log(`[OllamaWeb] Query completada em ${Date.now() - startTime}ms`);

    return {
      context: webContext,
      market_data: marketData,
      news,
      macro,
      response
    };
  }

  /**
   * Busca dados de mercado em tempo real
   */
  async fetchMarketData(symbols: string[]): Promise<MarketData[]> {
    const results: MarketData[] = [];
    
    for (const symbol of symbols) {
      // Verifica cache
      const cached = this.marketCache.get(symbol);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        results.push(cached.data);
        continue;
      }

      try {
        const data = await this.fetchSingleMarketData(symbol);
        if (data) {
          this.marketCache.set(symbol, { data, timestamp: Date.now() });
          results.push(data);
        }
      } catch (e) {
        console.error(`[OllamaWeb] Erro ao buscar ${symbol}:`, e);
      }
    }

    return results;
  }

  /**
   * Busca dados de um símbolo específico
   */
  private async fetchSingleMarketData(symbol: string): Promise<MarketData | null> {
    const s = symbol.toUpperCase();
    
    // Cripto - usa Binance API
    if (s.includes('USDT') || s.includes('BTC') || s.includes('ETH')) {
      return this.fetchBinanceData(s);
    }
    
    // Tenta Sentinel API primeiro (MT5 real)
    const mt5Data = await this.fetchMT5Data(s);
    if (mt5Data) return mt5Data;
    
    // Fallback para dados simulados
    if (s.includes('USD') || s.includes('EUR') || s.includes('GBP')) {
      return this.fetchForexData(s);
    }
    
    return this.fetchB3Data(s);
  }
  
  /**
   * Busca dados do Sentinel API (MT5 real) - Genial ou Pepperstone
   */
  private async fetchMT5Data(symbol: string): Promise<MarketData | null> {
    // Determina qual broker usar
    const broker = this.brokerSymbols[symbol] || 'genial';
    const brokerUrl = broker === 'pepperstone' ? this.pepperstoneUrl : 
                      broker === 'genial' ? this.genialUrl : this.sentinelUrl;
    
    try {
      const response = await fetch(`${brokerUrl}/tick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, broker })
      });
      
      if (!response.ok) return null;
      
      const data = await response.json() as { bid?: number; ask?: number; last?: number; time?: string; error?: string };
      
      if (data.error || (!data.bid && !data.last)) return null;
      
      const price = data.last || ((data.bid || 0 + data.ask || 0) / 2);
      
      return {
        symbol,
        price,
        change_24h: 0, // MT5 não fornece change_24h diretamente
        volume_24h: 0,
        timestamp: data.time ? new Date(data.time) : new Date()
      };
    } catch {
      // Fallback: tenta outro broker
      const fallbackUrl = broker === 'pepperstone' ? this.genialUrl : this.pepperstoneUrl;
      try {
        const response = await fetch(`${fallbackUrl}/tick`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol, broker: broker === 'pepperstone' ? 'genial' : 'pepperstone' })
        });
        
        if (!response.ok) return null;
        
        const data = await response.json() as { bid?: number; ask?: number; last?: number; time?: string; error?: string };
        
        if (data.error || (!data.bid && !data.last)) return null;
        
        const price = data.last || ((data.bid || 0 + data.ask || 0) / 2);
        
        return {
          symbol,
          price,
          change_24h: 0,
          volume_24h: 0,
          timestamp: data.time ? new Date(data.time) : new Date()
        };
      } catch {
        return null;
      }
    }
  }

  /**
   * Busca dados da Binance
   */
  private async fetchBinanceData(symbol: string): Promise<MarketData | null> {
    try {
      const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`;
      const data = await this.fetchJSON(url);
      
      return {
        symbol: symbol,
        price: parseFloat(data.lastPrice),
        change_24h: parseFloat(data.priceChangePercent),
        volume_24h: parseFloat(data.volume),
        timestamp: new Date()
      };
    } catch {
      return null;
    }
  }

  /**
   * Busca dados Forex (simulado)
   */
  private async fetchForexData(symbol: string): Promise<MarketData | null> {
    // Em produção, usar API real como exchangerate-api
    const prices: Record<string, number> = {
      'USDBRL': 5.15,
      'EURUSD': 1.08,
      'GBPUSD': 1.26
    };
    
    const price = prices[symbol] || 1.0;
    
    return {
      symbol,
      price,
      change_24h: (Math.random() - 0.5) * 2, // Simulado
      volume_24h: 0,
      timestamp: new Date()
    };
  }

  /**
   * Busca dados B3 (simulado)
   */
  private async fetchB3Data(symbol: string): Promise<MarketData | null> {
    // Em produção, usar API real como Brapi ou YFinance
    return {
      symbol,
      price: 20 + Math.random() * 30, // Simulado
      change_24h: (Math.random() - 0.5) * 5,
      volume_24h: Math.random() * 1000000,
      timestamp: new Date()
    };
  }

  /**
   * Busca notícias de mercado
   */
  async fetchMarketNews(): Promise<NewsItem[]> {
    try {
      // Em produção, usar API de notícias real
      // Por agora, retorna estrutura simulada
      return [
        {
          title: 'Federal Reserve mantém juros',
          source: 'Reuters',
          summary: 'Fed mantém taxa de juros inalterada, sinalizando cautela com inflação.',
          sentiment: 'neutral',
          timestamp: new Date(),
          url: 'https://reuters.com'
        },
        {
          title: 'Bitcoin atinge nova alta',
          source: 'CoinDesk',
          summary: 'Bitcoin supera resistência e atinge maior valor em 30 dias.',
          sentiment: 'positive',
          timestamp: new Date(),
          url: 'https://coindesk.com'
        }
      ];
    } catch {
      return [];
    }
  }

  /**
   * Busca indicadores macroeconômicos
   */
  async fetchMacroIndicators(): Promise<MacroIndicator[]> {
    const indicators: MacroIndicator[] = [];
    
    try {
      // Busca dólar do Sentinel API
      const dolarResponse = await fetch(`${this.sentinelUrl}/tick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: 'USDBRL', broker: 'pepperstone' })
      });
      
      if (dolarResponse.ok) {
        const data = await dolarResponse.json() as { bid?: number; ask?: number; error?: string };
        if (!data.error && (data.bid || data.ask)) {
          indicators.push({
            name: 'DÓLAR',
            value: data.bid || data.ask || 0,
            change: 0,
            country: 'BR',
            timestamp: new Date()
          });
        }
      }
    } catch {
      // Ignora erro
    }
    
    // Indicadores estáticos (podem ser buscados de APIs reais depois)
    indicators.push(
      {
        name: 'SELIC',
        value: 13.75,
        change: 0,
        country: 'BR',
        timestamp: new Date()
      },
      {
        name: 'VIX',
        value: 15.2,
        change: -0.5,
        country: 'US',
        timestamp: new Date()
      }
    );
    
    return indicators;
  }

  /**
   * Monta contexto web para o prompt
   */
  private buildWebContext(
    marketData: MarketData[],
    news: NewsItem[],
    macro: MacroIndicator[]
  ): string {
    const parts: string[] = [];

    if (marketData.length > 0) {
      parts.push('📊 PREÇOS EM TEMPO REAL:');
      marketData.forEach(m => {
        parts.push(`  ${m.symbol}: $${m.price.toFixed(2)} (${m.change_24h >= 0 ? '+' : ''}${m.change_24h.toFixed(2)}%)`);
      });
    }

    if (news.length > 0) {
      parts.push('\n📰 NOTÍCIAS:');
      news.forEach(n => {
        parts.push(`  [${n.sentiment.toUpperCase()}] ${n.title}: ${n.summary}`);
      });
    }

    if (macro.length > 0) {
      parts.push('\n🌍 MACROECONOMIA:');
      macro.forEach(m => {
        parts.push(`  ${m.name} (${m.country}): ${m.value} (${m.change >= 0 ? '+' : ''}${m.change})`);
      });
    }

    return parts.join('\n');
  }

  /**
   * Chama Ollama local
   */
  private async callOllama(prompt: string): Promise<string> {
    try {
      const response = await fetch(`http://${this.ollamaHost}:${this.ollamaPort}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.ollamaModel,
          messages: [
            { role: 'system', content: 'Você é o VEXOR, sistema de trading com acesso a dados em tempo real. Responda de forma objetiva.' },
            { role: 'user', content: prompt }
          ],
          stream: false,
          options: {
            temperature: 0.2,
            num_predict: 500
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama error: ${response.status}`);
      }

      const data = await response.json() as { message?: { content: string } };
      return data.message?.content || 'Sem resposta';
    } catch (e) {
      console.error('[OllamaWeb] Ollama error:', e);
      return 'Ollama não disponível';
    }
  }

  /**
   * Fetch JSON helper
   */
  private fetchJSON(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      
      client.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error('Invalid JSON'));
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * Limpa cache de mercado
   */
  clearCache(): void {
    this.marketCache.clear();
  }

  /**
   * Estatísticas
   */
  getStats(): { cacheSize: number } {
    return {
      cacheSize: this.marketCache.size
    };
  }
}

// ==================== SINGLETON ====================

export const ollamaWebService = new OllamaWebService();
export type { 
  WebSearchResult, 
  MarketData, 
  NewsItem, 
  MacroIndicator, 
  OllamaWebResponse 
};
