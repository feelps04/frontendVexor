/**
 * VEXOR News Intelligence
 * 
 * CAMADA 1 — Coleta notícias em tempo real (sem LLM)
 * CAMADA 2 — LLM analisa e cruza com RAG
 * 
 * Fontes Globais (Wall Street e Europa):
 * - Bloomberg (Internacional/Línea) — padrão ouro, Fed, BCE
 * - Reuters (Finanças) — maior agência, dados brutos imparciais
 * - Investing.com — agregador técnico, calendário econômico global
 * - Financial Times (FT) — política econômica, bonds europeus
 * - CNBC — mercado americano, Nasdaq/NYSE, sentimento traders
 * - Pepperstone — forex, CFD, mercado global (MetaTrader)
 * - Binance — cripto, notícias de mercado
 * 
 * Fontes Brasil (B3 e Política Nacional):
 * - BCB (Banco Central do Brasil) — dados oficiais SELIC, câmbio
 * - Valor Econômico — referência Brasil, política Brasília
 * - InfoMoney — B3 diário, commodities, Vale/Petrobras
 * - Estadão E-Investidor — educação financeira, volatilidade política
 * - ADVFN Brasil — small caps, fluxo de ordens
 * - Forbes Money (Brasil) — negócios, grandes fortunas, tendências
 * - Genial Investimentos — B3, análises brasileiras (MetaTrader)
 * 
 * Sentimento de Mercado (Social):
 * - Twitter/X (FinTwit) — velocidade, sentimento, furos de mercado
 *   Perfis monitorados: @DeItaone, @KobeissiLetter, @unusual_whales
 * 
 * Integração MetaTrader:
 * - Genial (MT5) — corretora brasileira
 * - Pepperstone (MT5) — forex/CFD global
 * 
 * ⚠️ Uso do FinTwit: Como radar, não como bússola.
 * Validar sempre em portais oficiais antes de operar.
 */

import * as https from 'https';
import { crossRAGService } from './cross-rag.js';

// ==================== TYPES ====================

interface NewsItem {
  title: string;
  summary: string;
  source: string;
  url: string;
  timestamp: Date;
  sentiment: 'positive' | 'negative' | 'neutral';
  relatedAssets: string[];
}

interface AssetImpact {
  symbol: string;
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;
  reason: string;
  affectedBy: string[]; // Quais ativos/setores afetam este
  affects: string[];    // Quais ativos/setores este afeta
}

interface CrossAnalysis {
  symbol: string;
  makesSense: boolean;   // Se o impacto faz sentido dado o contexto
  contradictions: string[]; // Contradições detectadas
  correlations: string[];   // Correlações confirmadas
}

interface SectorImpact {
  sectorId: string;
  sectorName: string;
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  affectedAssets: string[];
  confidence: number;
}

interface MarketInsight {
  // Impactos específicos por ativo (até 2000)
  assetImpacts: Map<string, AssetImpact>;
  
  // Impactos por setor (agregação)
  sectorImpacts: SectorImpact[];
  
  // Análise cruzada - verifica consistência
  crossAnalysis: CrossAnalysis[];
  
  // Ativos com impacto direto das notícias
  directlyAffected: string[];
  
  // Ativos afetados por correlação/cruzamento
  indirectlyAffected: string[];
  
  // Legacy (compatibilidade)
  impact: {
    ibov: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    dolar: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    petr4: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    vale3: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    btc: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  };
  
  suggestedStrategy: string;
  shouldVeto: boolean;
  vetoReason: string;
  riskLevel: 'BAIXO' | 'MÉDIO' | 'ALTO';
  confidence: number;
  rawAnalysis: string;
}

interface BCBData {
  serie: string;
  valor: number;
  data: string;
}

// ==================== NEWS INTELLIGENCE ====================

class NewsIntelligence {
  private alphaVantageKey = process.env.ALPHA_VANTAGE_KEY || 'demo';
  private ollamaHost = process.env.OLLAMA_HOST || 'localhost';
  private ollamaPort = process.env.OLLAMA_PORT || '11434';
  private ollamaModel = process.env.OLLAMA_MODEL || 'llama3.1:8b'; // Modelo rápido para triagem
  
  // Cache de notícias
  private newsCache: NewsItem[] = [];
  private lastFetch: number = 0;
  private readonly CACHE_TTL = 300000; // 5 minutos

  /**
   * CAMADA 1 — Coleta notícias de todas as fontes
   */
  async fetchNews(): Promise<NewsItem[]> {
    const now = Date.now();
    
    // Usa cache se ainda válido
    if (this.newsCache.length > 0 && now - this.lastFetch < this.CACHE_TTL) {
      console.log('[NewsIntelligence] Usando cache de notícias');
      return this.newsCache;
    }

    console.log('[NewsIntelligence] Buscando notícias em tempo real...');

    const allNews: NewsItem[] = [];

    // Busca em paralelo
    const results = await Promise.allSettled([
      // Fontes globais
      this.fetchBCBData(),
      this.fetchInvestingRSS(),
      this.fetchCoinGeckoNews(),
      this.fetchAlphaVantageNews(),
      this.fetchYahooFinanceRSS(),
      this.fetchPepperstoneNews(),
      this.fetchBinanceNews(),
      this.fetchReutersNews(),
      this.fetchBloombergNews(),
      this.fetchCNBCNews(),
      this.fetchFinancialTimesNews(),
      // Fontes Brasil
      this.fetchGenialNews(),
      this.fetchValorEconomicoNews(),
      this.fetchInfoMoneyNews(),
      this.fetchEstadaoInvestidorNews(),
      this.fetchADVFNNews(),
      this.fetchForbesMoneyNews(),
      // Sentimento Social
      this.fetchFinTwitSentiment()
    ]);

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        allNews.push(...result.value);
      }
    }

    // Ordena por timestamp
    allNews.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Mantém últimas 50 notícias
    this.newsCache = allNews.slice(0, 50);
    this.lastFetch = now;

    console.log(`[NewsIntelligence] ${this.newsCache.length} notícias coletadas`);

    return this.newsCache;
  }

  /**
   * BCB — Banco Central do Brasil (dados oficiais)
   */
  private async fetchBCBData(): Promise<NewsItem[]> {
    try {
      // SELIC, Dólar, Reservas
      const urls = [
        'https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json', // SELIC
        'https://api.bcb.gov.br/dados/serie/bcdata.sgs.1/dados/ultimos/1?formato=json',  // Dólar
      ];

      const items: NewsItem[] = [];

      for (const url of urls) {
        try {
          const data = await this.fetchJSON(url) as BCBData[];
          if (data && data.length > 0) {
            const item = data[0];
            const isDolar = url.includes('bcdata.sgs.1');
            
            items.push({
              title: isDolar ? `USD/BRL: ${item.valor}` : `SELIC: ${item.valor}%`,
              summary: `Dados oficiais BCB - ${item.data}`,
              source: 'Banco Central do Brasil',
              url: 'https://www.bcb.gov.br',
              timestamp: new Date(),
              sentiment: 'neutral',
              relatedAssets: isDolar ? ['USDBRL', 'DOL'] : ['B3', 'IBOV']
            });
          }
        } catch {
          // Ignora erros individuais
        }
      }

      return items;
    } catch {
      return [];
    }
  }

  /**
   * Investing.com RSS — B3, IBOV, dólar
   */
  private async fetchInvestingRSS(): Promise<NewsItem[]> {
    try {
      const url = 'https://br.investing.com/rss/news.rss';
      const xml = await this.fetchText(url);
      
      // Parse simples de RSS
      const items: NewsItem[] = [];
      const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
      
      for (const match of itemMatches) {
        const item = match[1];
        const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/);
        const linkMatch = item.match(/<link>(.*?)<\/link>/);
        const pubDateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/);
        
        if (titleMatch) {
          items.push({
            title: titleMatch[1],
            summary: titleMatch[1],
            source: 'Investing.com',
            url: linkMatch ? linkMatch[1] : '',
            timestamp: pubDateMatch ? new Date(pubDateMatch[1]) : new Date(),
            sentiment: this.detectSentiment(titleMatch[1]),
            relatedAssets: this.detectAssets(titleMatch[1])
          });
        }
        
        if (items.length >= 10) break;
      }

      return items;
    } catch {
      return [];
    }
  }

  /**
   * CoinGecko — cripto sem autenticação
   */
  private async fetchCoinGeckoNews(): Promise<NewsItem[]> {
    try {
      const url = 'https://api.coingecko.com/api/v3/status_updates?per_page=10';
      const data = await this.fetchJSON(url);
      
      if (!data.status_updates) return [];

      return data.status_updates.slice(0, 10).map((u: any) => ({
        title: u.project?.name || 'Crypto Update',
        summary: u.description?.text || '',
        source: 'CoinGecko',
        url: `https://www.coingecko.com/en/coins/${u.project?.id}`,
        timestamp: new Date(u.created_at),
        sentiment: this.detectSentiment(u.description?.text || ''),
        relatedAssets: ['BTC', 'ETH', 'CRYPTO']
      }));
    } catch {
      return [];
    }
  }

  /**
   * Alpha Vantage — news sentiment
   */
  private async fetchAlphaVantageNews(): Promise<NewsItem[]> {
    try {
      const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=IBOV,USD&apikey=${this.alphaVantageKey}`;
      const data = await this.fetchJSON(url);
      
      if (!data.feed) return [];

      return data.feed.slice(0, 10).map((f: any) => ({
        title: f.title,
        summary: f.summary || '',
        source: 'Alpha Vantage',
        url: f.url,
        timestamp: new Date(f.time_published),
        sentiment: f.overall_sentiment?.toLowerCase() || 'neutral',
        relatedAssets: this.detectAssets(f.title + ' ' + f.summary)
      }));
    } catch {
      return [];
    }
  }

  /**
   * Yahoo Finance RSS
   */
  private async fetchYahooFinanceRSS(): Promise<NewsItem[]> {
    try {
      const url = 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=^BVSP,BTC-USD';
      const xml = await this.fetchText(url);
      
      const items: NewsItem[] = [];
      const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
      
      for (const match of itemMatches) {
        const item = match[1];
        const titleMatch = item.match(/<title>(.*?)<\/title>/);
        const linkMatch = item.match(/<link>(.*?)<\/link>/);
        
        if (titleMatch) {
          items.push({
            title: titleMatch[1],
            summary: titleMatch[1],
            source: 'Yahoo Finance',
            url: linkMatch ? linkMatch[1] : '',
            timestamp: new Date(),
            sentiment: this.detectSentiment(titleMatch[1]),
            relatedAssets: this.detectAssets(titleMatch[1])
          });
        }
        
        if (items.length >= 10) break;
      }

      return items;
    } catch {
      return [];
    }
  }

  /**
   * Pepperstone — Forex, CFD, mercado global
   */
  private async fetchPepperstoneNews(): Promise<NewsItem[]> {
    try {
      // Pepperstone tem RSS de market news
      const url = 'https://www.pepperstone.com/rss/market-news';
      const xml = await this.fetchText(url);
      
      const items: NewsItem[] = [];
      const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
      
      for (const match of itemMatches) {
        const item = match[1];
        const titleMatch = item.match(/<title>(.*?)<\/title>/);
        const linkMatch = item.match(/<link>(.*?)<\/link>/);
        const descMatch = item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/);
        
        if (titleMatch) {
          items.push({
            title: titleMatch[1],
            summary: descMatch ? descMatch[1] : titleMatch[1],
            source: 'Pepperstone',
            url: linkMatch ? linkMatch[1] : '',
            timestamp: new Date(),
            sentiment: this.detectSentiment(titleMatch[1]),
            relatedAssets: this.detectAssets(titleMatch[1] + ' ' + (descMatch ? descMatch[1] : ''))
          });
        }
        
        if (items.length >= 10) break;
      }

      return items;
    } catch {
      // Fallback: busca via API alternativa
      try {
        const url = 'https://www.dailyfx.com/rss/news';
        const xml = await this.fetchText(url);
        
        const items: NewsItem[] = [];
        const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
        
        for (const match of itemMatches) {
          const item = match[1];
          const titleMatch = item.match(/<title>(.*?)<\/title>/);
          const linkMatch = item.match(/<link>(.*?)<\/link>/);
          
          if (titleMatch) {
            items.push({
              title: titleMatch[1],
              summary: titleMatch[1],
              source: 'DailyFX/Pepperstone',
              url: linkMatch ? linkMatch[1] : '',
              timestamp: new Date(),
              sentiment: this.detectSentiment(titleMatch[1]),
              relatedAssets: this.detectAssets(titleMatch[1])
            });
          }
          
          if (items.length >= 5) break;
        }
        return items;
      } catch {
        return [];
      }
    }
  }

  /**
   * Binance — Cripto, notícias de mercado
   */
  private async fetchBinanceNews(): Promise<NewsItem[]> {
    try {
      // Binance News API
      const url = 'https://www.binance.com/bapi/composite/v1/public/cms/article/list/query?type=1&pageNo=1&pageSize=10';
      const data = await this.fetchJSON(url);
      
      if (!data.data?.list) return [];

      return data.data.list.slice(0, 10).map((article: any) => ({
        title: article.title,
        summary: article.summary || article.title,
        source: 'Binance',
        url: `https://www.binance.com/en/support/announcement/${article.code}`,
        timestamp: new Date(article.releaseDate),
        sentiment: this.detectSentiment(article.title),
        relatedAssets: this.detectAssets(article.title + ' ' + (article.summary || ''))
      }));
    } catch {
      // Fallback: RSS do Binance Square
      try {
        const url = 'https://www.binance.com/en/square/rss';
        const xml = await this.fetchText(url);
        
        const items: NewsItem[] = [];
        const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
        
        for (const match of itemMatches) {
          const item = match[1];
          const titleMatch = item.match(/<title>(.*?)<\/title>/);
          const linkMatch = item.match(/<link>(.*?)<\/link>/);
          
          if (titleMatch) {
            items.push({
              title: titleMatch[1],
              summary: titleMatch[1],
              source: 'Binance Square',
              url: linkMatch ? linkMatch[1] : '',
              timestamp: new Date(),
              sentiment: this.detectSentiment(titleMatch[1]),
              relatedAssets: ['BTC', 'ETH', 'CRYPTO']
            });
          }
          
          if (items.length >= 5) break;
        }
        return items;
      } catch {
        return [];
      }
    }
  }

  /**
   * Genial Investimentos — B3, análises brasileiras
   */
  private async fetchGenialNews(): Promise<NewsItem[]> {
    try {
      // Genial API de notícias
      const url = 'https://api.genial.com.br/v1/market-news?limit=10';
      const data = await this.fetchJSON(url);
      
      if (!data.items) return [];

      return data.items.slice(0, 10).map((item: any) => ({
        title: item.title,
        summary: item.summary || item.title,
        source: 'Genial Investimentos',
        url: item.url || 'https://www.genialinvestimentos.com.br',
        timestamp: new Date(item.publishedAt),
        sentiment: this.detectSentiment(item.title),
        relatedAssets: this.detectAssets(item.title + ' ' + (item.summary || ''))
      }));
    } catch {
      // Fallback: scraping do blog da Genial
      try {
        const url = 'https://www.genialinvestimentos.com.br/blog/feed/';
        const xml = await this.fetchText(url);
        
        const items: NewsItem[] = [];
        const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
        
        for (const match of itemMatches) {
          const item = match[1];
          const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/);
          const linkMatch = item.match(/<link>(.*?)<\/link>/);
          const descMatch = item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/);
          
          if (titleMatch) {
            items.push({
              title: titleMatch[1],
              summary: descMatch ? descMatch[1].replace(/<[^>]*>/g, '').substring(0, 200) : titleMatch[1],
              source: 'Genial Investimentos',
              url: linkMatch ? linkMatch[1] : '',
              timestamp: new Date(),
              sentiment: this.detectSentiment(titleMatch[1]),
              relatedAssets: this.detectAssets(titleMatch[1] + ' ' + (descMatch ? descMatch[1] : ''))
            });
          }
          
          if (items.length >= 10) break;
        }
        return items;
      } catch {
        return [];
      }
    }
  }

  /**
   * Reuters — Maior agência de notícias do mundo
   */
  private async fetchReutersNews(): Promise<NewsItem[]> {
    try {
      const url = 'https://www.reutersagency.com/feed/?taxonomy=best-topics&post_type=best';
      const xml = await this.fetchText(url);
      
      const items: NewsItem[] = [];
      const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
      
      for (const match of itemMatches) {
        const item = match[1];
        const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/);
        const linkMatch = item.match(/<link>(.*?)<\/link>/);
        
        if (titleMatch) {
          items.push({
            title: titleMatch[1],
            summary: titleMatch[1],
            source: 'Reuters',
            url: linkMatch ? linkMatch[1] : '',
            timestamp: new Date(),
            sentiment: this.detectSentiment(titleMatch[1]),
            relatedAssets: this.detectAssets(titleMatch[1])
          });
        }
        
        if (items.length >= 10) break;
      }
      return items;
    } catch {
      return [];
    }
  }

  /**
   * Bloomberg (Línea) — Padrão ouro, Fed, BCE
   */
  private async fetchBloombergNews(): Promise<NewsItem[]> {
    try {
      // Bloomberg Línea (América Latina)
      const url = 'https://www.bloomberglinea.com.br/rss';
      const xml = await this.fetchText(url);
      
      const items: NewsItem[] = [];
      const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
      
      for (const match of itemMatches) {
        const item = match[1];
        const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/);
        const linkMatch = item.match(/<link>(.*?)<\/link>/);
        
        if (titleMatch) {
          items.push({
            title: titleMatch[1],
            summary: titleMatch[1],
            source: 'Bloomberg Línea',
            url: linkMatch ? linkMatch[1] : '',
            timestamp: new Date(),
            sentiment: this.detectSentiment(titleMatch[1]),
            relatedAssets: this.detectAssets(titleMatch[1])
          });
        }
        
        if (items.length >= 10) break;
      }
      return items;
    } catch {
      return [];
    }
  }

  /**
   * CNBC — Mercado americano, Nasdaq/NYSE
   */
  private async fetchCNBCNews(): Promise<NewsItem[]> {
    try {
      const url = 'https://www.cnbc.com/id/10000664/device/rss/rss.html';
      const xml = await this.fetchText(url);
      
      const items: NewsItem[] = [];
      const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
      
      for (const match of itemMatches) {
        const item = match[1];
        const titleMatch = item.match(/<title>(.*?)<\/title>/);
        const linkMatch = item.match(/<link>(.*?)<\/link>/);
        const descMatch = item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/);
        
        if (titleMatch) {
          items.push({
            title: titleMatch[1],
            summary: descMatch ? descMatch[1].replace(/<[^>]*>/g, '').substring(0, 200) : titleMatch[1],
            source: 'CNBC',
            url: linkMatch ? linkMatch[1] : '',
            timestamp: new Date(),
            sentiment: this.detectSentiment(titleMatch[1]),
            relatedAssets: this.detectAssets(titleMatch[1])
          });
        }
        
        if (items.length >= 10) break;
      }
      return items;
    } catch {
      return [];
    }
  }

  /**
   * Financial Times — Política econômica, bonds europeus
   */
  private async fetchFinancialTimesNews(): Promise<NewsItem[]> {
    try {
      const url = 'https://www.ft.com/rss/home';
      const xml = await this.fetchText(url);
      
      const items: NewsItem[] = [];
      const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
      
      for (const match of itemMatches) {
        const item = match[1];
        const titleMatch = item.match(/<title>(.*?)<\/title>/);
        const linkMatch = item.match(/<link>(.*?)<\/link>/);
        
        if (titleMatch) {
          items.push({
            title: titleMatch[1],
            summary: titleMatch[1],
            source: 'Financial Times',
            url: linkMatch ? linkMatch[1] : '',
            timestamp: new Date(),
            sentiment: this.detectSentiment(titleMatch[1]),
            relatedAssets: this.detectAssets(titleMatch[1])
          });
        }
        
        if (items.length >= 10) break;
      }
      return items;
    } catch {
      return [];
    }
  }

  /**
   * Valor Econômico — Referência Brasil, política Brasília
   */
  private async fetchValorEconomicoNews(): Promise<NewsItem[]> {
    try {
      const url = 'https://valor.globo.com/rss/valor';
      const xml = await this.fetchText(url);
      
      const items: NewsItem[] = [];
      const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
      
      for (const match of itemMatches) {
        const item = match[1];
        const titleMatch = item.match(/<title>(.*?)<\/title>/);
        const linkMatch = item.match(/<link>(.*?)<\/link>/);
        const descMatch = item.match(/<description>(.*?)<\/description>/);
        
        if (titleMatch) {
          items.push({
            title: titleMatch[1],
            summary: descMatch ? descMatch[1].replace(/<[^>]*>/g, '').substring(0, 200) : titleMatch[1],
            source: 'Valor Econômico',
            url: linkMatch ? linkMatch[1] : '',
            timestamp: new Date(),
            sentiment: this.detectSentiment(titleMatch[1]),
            relatedAssets: this.detectAssets(titleMatch[1] + ' ' + (descMatch ? descMatch[1] : ''))
          });
        }
        
        if (items.length >= 10) break;
      }
      return items;
    } catch {
      return [];
    }
  }

  /**
   * InfoMoney — B3 diário, commodities
   */
  private async fetchInfoMoneyNews(): Promise<NewsItem[]> {
    try {
      const url = 'https://www.infomoney.com.br/feed/';
      const xml = await this.fetchText(url);
      
      const items: NewsItem[] = [];
      const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
      
      for (const match of itemMatches) {
        const item = match[1];
        const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/);
        const linkMatch = item.match(/<link>(.*?)<\/link>/);
        const descMatch = item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/);
        
        if (titleMatch) {
          items.push({
            title: titleMatch[1],
            summary: descMatch ? descMatch[1].replace(/<[^>]*>/g, '').substring(0, 200) : titleMatch[1],
            source: 'InfoMoney',
            url: linkMatch ? linkMatch[1] : '',
            timestamp: new Date(),
            sentiment: this.detectSentiment(titleMatch[1]),
            relatedAssets: this.detectAssets(titleMatch[1] + ' ' + (descMatch ? descMatch[1] : ''))
          });
        }
        
        if (items.length >= 10) break;
      }
      return items;
    } catch {
      return [];
    }
  }

  /**
   * Estadão E-Investidor — Educação financeira, volatilidade política
   */
  private async fetchEstadaoInvestidorNews(): Promise<NewsItem[]> {
    try {
      const url = 'https://investidor.estadao.com.br/feed/';
      const xml = await this.fetchText(url);
      
      const items: NewsItem[] = [];
      const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
      
      for (const match of itemMatches) {
        const item = match[1];
        const titleMatch = item.match(/<title>(.*?)<\/title>/);
        const linkMatch = item.match(/<link>(.*?)<\/link>/);
        
        if (titleMatch) {
          items.push({
            title: titleMatch[1],
            summary: titleMatch[1],
            source: 'Estadão E-Investidor',
            url: linkMatch ? linkMatch[1] : '',
            timestamp: new Date(),
            sentiment: this.detectSentiment(titleMatch[1]),
            relatedAssets: this.detectAssets(titleMatch[1])
          });
        }
        
        if (items.length >= 10) break;
      }
      return items;
    } catch {
      return [];
    }
  }

  /**
   * ADVFN Brasil — Small caps, fluxo de ordens
   */
  private async fetchADVFNNews(): Promise<NewsItem[]> {
    try {
      const url = 'https://br.advfn.com/rss';
      const xml = await this.fetchText(url);
      
      const items: NewsItem[] = [];
      const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
      
      for (const match of itemMatches) {
        const item = match[1];
        const titleMatch = item.match(/<title>(.*?)<\/title>/);
        const linkMatch = item.match(/<link>(.*?)<\/link>/);
        
        if (titleMatch) {
          items.push({
            title: titleMatch[1],
            summary: titleMatch[1],
            source: 'ADVFN Brasil',
            url: linkMatch ? linkMatch[1] : '',
            timestamp: new Date(),
            sentiment: this.detectSentiment(titleMatch[1]),
            relatedAssets: this.detectAssets(titleMatch[1])
          });
        }
        
        if (items.length >= 10) break;
      }
      return items;
    } catch {
      return [];
    }
  }

  /**
   * Forbes Money (Brasil) — Negócios, grandes fortunas, tendências
   */
  private async fetchForbesMoneyNews(): Promise<NewsItem[]> {
    try {
      const url = 'https://forbes.com.br/feed/';
      const xml = await this.fetchText(url);
      
      const items: NewsItem[] = [];
      const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
      
      for (const match of itemMatches) {
        const item = match[1];
        const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/);
        const linkMatch = item.match(/<link>(.*?)<\/link>/);
        const descMatch = item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/);
        
        if (titleMatch) {
          items.push({
            title: titleMatch[1],
            summary: descMatch ? descMatch[1].replace(/<[^>]*>/g, '').substring(0, 200) : titleMatch[1],
            source: 'Forbes Brasil',
            url: linkMatch ? linkMatch[1] : '',
            timestamp: new Date(),
            sentiment: this.detectSentiment(titleMatch[1]),
            relatedAssets: this.detectAssets(titleMatch[1] + ' ' + (descMatch ? descMatch[1] : ''))
          });
        }
        
        if (items.length >= 10) break;
      }
      return items;
    } catch {
      return [];
    }
  }

  /**
   * Twitter/X (FinTwit) — Sentimento de mercado em tempo real
   * 
   * Perfis monitorados:
   * - @DeItaone (Walter Bloomberg) — Headlines Bloomberg, velocidade máxima
   * - @KobeissiLetter — Macro global, indicadores EUA
   * - @unusual_whales — Fluxo de baleias, opções, políticos
   * 
   * ⚠️ Usar como radar, não como bússola. Validar em portais oficiais.
   */
  private async fetchFinTwitSentiment(): Promise<NewsItem[]> {
    try {
      // Twitter/X API v2 - requer bearer token
      // Fallback: usa Nitter (instância pública) para scraping
      const finTwitProfiles = [
        { handle: 'DeItaone', name: 'Walter Bloomberg', focus: 'Global Headlines' },
        { handle: 'KobeissiLetter', name: 'Kobeissi Letter', focus: 'Macro Global' },
        { handle: 'unusual_whales', name: 'Unusual Whales', focus: 'Flow/Options' }
      ];
      
      const items: NewsItem[] = [];
      
      // Tenta buscar via Nitter (RSS público)
      for (const profile of finTwitProfiles) {
        try {
          const url = `https://nitter.net/${profile.handle}/rss`;
          const xml = await this.fetchText(url);
          
          const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
          
          for (const match of itemMatches) {
            const item = match[1];
            const titleMatch = item.match(/<title>(.*?)<\/title>/);
            const linkMatch = item.match(/<link>(.*?)<\/link>/);
            const pubDateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/);
            
            if (titleMatch) {
              const title = titleMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
              
              items.push({
                title,
                summary: `[${profile.focus}] ${title}`,
                source: `FinTwit/@${profile.handle}`,
                url: linkMatch ? linkMatch[1].replace('nitter.net', 'twitter.com') : `https://twitter.com/${profile.handle}`,
                timestamp: pubDateMatch ? new Date(pubDateMatch[1]) : new Date(),
                sentiment: this.detectSentiment(title),
                relatedAssets: this.detectAssets(title)
              });
            }
            
            if (items.length >= 5) break;
          }
        } catch {
          // Fallback: usa API alternativa (syndication)
          continue;
        }
      }
      
      // Se não conseguiu via Nitter, retorna sentimento agregado simulado
      // baseado em palavras-chave de mercado
      if (items.length === 0) {
        // Busca tendências via API alternativa
        try {
          const url = 'https://api.tickertweet.com/v1/fintwit/trending';
          const data = await this.fetchJSON(url);
          
          if (data.trending) {
            for (const trend of data.trending.slice(0, 5)) {
              items.push({
                title: trend.text || trend.hashtag,
                summary: `Trending: ${trend.text || trend.hashtag}`,
                source: 'FinTwit Trending',
                url: 'https://twitter.com/search?q=' + encodeURIComponent(trend.text || trend.hashtag),
                timestamp: new Date(),
                sentiment: this.detectSentiment(trend.text || ''),
                relatedAssets: this.detectAssets(trend.text || '')
              });
            }
          }
        } catch {
          // Retorna vazio se todas as fontes falharem
          return [];
        }
      }
      
      return items.slice(0, 15);
    } catch {
      return [];
    }
  }

  /**
   * CAMADA 2 — LLM analisa e cruza com RAG
   */
  async analyzeWithRAG(news?: NewsItem[]): Promise<MarketInsight> {
    // Busca notícias se não fornecidas
    const newsItems = news || await this.fetchNews();

    if (newsItems.length === 0) {
      return {
        assetImpacts: new Map(),
        sectorImpacts: [],
        crossAnalysis: [],
        directlyAffected: [],
        indirectlyAffected: [],
        impact: { ibov: 'NEUTRAL', dolar: 'NEUTRAL', petr4: 'NEUTRAL', vale3: 'NEUTRAL', btc: 'NEUTRAL' },
        suggestedStrategy: 'Aguardar dados',
        shouldVeto: false,
        vetoReason: '',
        riskLevel: 'MÉDIO',
        confidence: 0,
        rawAnalysis: 'Sem notícias disponíveis'
      };
    }

    // Busca cenários históricos similares
    const scenarios = await crossRAGService.queryScenarioRAG({
      sp500_trend: 'UNKNOWN',
      sp500_change_pct: 0,
      vix: 15,
      usdbrl: 5.15,
      usdbrl_trend: 'NEUTRAL',
      selic: 13.75,
      regime: 'UNKNOWN'
    });

    // Busca estratégias validadas
    const strategies = await crossRAGService.queryStrategyRAG({
      symbol: 'IBOV',
      symbol_type: 'B3_FUTURO',
      ema9: 0,
      ema21: 0,
      rsi14: 50,
      atr14: 1,
      hour_utc: new Date().getUTCHours(),
      regime: 'UNKNOWN',
      macro_state: 'UNKNOWN',
      agent_votes: []
    });

    // Monta prompt
    const prompt = this.buildAnalysisPrompt(newsItems, scenarios, strategies);

    // Chama Ollama
    const analysis = await this.callOllama(prompt);

    // Parse da análise
    const insight = this.parseAnalysis(analysis);
    
    // Propaga impactos para ativos correlacionados
    this.propagateImpactToCorrelated(insight);
    
    // Realiza análise cruzada
    insight.crossAnalysis = this.performCrossAnalysis(insight);
    
    return insight;
  }

  /**
   * Monta prompt de análise
   */
  private buildAnalysisPrompt(
    news: NewsItem[],
    scenarios: any[],
    strategies: any[]
  ): string {
    return `
=== NOTÍCIAS AGORA ===
${news.slice(0, 15).map(n => `• [${n.source}] ${n.title} (ativos: ${n.relatedAssets.join(',')})`).join('\n')}

=== CENÁRIOS HISTÓRICOS SIMILARES (RAG) ===
${scenarios.length > 0 
  ? scenarios.map(s => `• ${s.name}: funcionou=[${s.what_worked?.join(',')}] falhou=[${s.what_failed?.join(',')}]`).join('\n')
  : '• Nenhum cenário histórico similar encontrado'
}

=== ESTRATÉGIAS VALIDADAS PARA ESSE CONTEXTO (RAG) ===
${strategies.length > 0
  ? strategies.map(s => `• ${s.name}: WR=${s.performance?.win_rate}% PF=${s.performance?.profit_factor}`).join('\n')
  : '• Nenhuma estratégia validada para esse contexto'
}

Analise as notícias considerando que a plataforma tem 2000+ ativos. Para cada notícia:
1. Identifique quais ativos/setores são afetados DIRETAMENTE
2. Identifique quais ativos/setores são afetados INDIRETAMENTE (correlação, cadeia)
3. Verifique se há CONTRADIÇÕES entre os impactos (ex: notícia positiva para petróleo mas negativa para PETR4)
4. Verifique se o impacto FAZ SENTIDO dado o contexto macro

Responda no formato:
IBOV: [BULLISH/BEARISH/NEUTRAL]
DOLAR: [BULLISH/BEARISH/NEUTRAL]
PETR4: [BULLISH/BEARISH/NEUTRAL]
VALE3: [BULLISH/BEARISH/NEUTRAL]
BTC: [BULLISH/BEARISH/NEUTRAL]

DIRETAMENTE: [lista de ativos diretamente afetados separados por vírgula]
INDIRETAMENTE: [lista de ativos indiretamente afetados separados por vírgula]

SECTOR: [setor]: [BULLISH/BEARISH/NEUTRAL] (um por linha para cada setor relevante)

ASSET: [SIMBOLO]: [BULLISH/BEARISH/NEUTRAL] (motivo curto) (um por linha para ativos específicos)

ESTRATEGIA: [nome da estratégia sugerida]
VETO: [SIM/NÃO]
MOTIVO: [motivo se veto]
RISCO: [BAIXO/MÉDIO/ALTO]
CONFIANCA: [0-100]
`;
  }

  /**
   * Chama Ollama
   */
  private async callOllama(prompt: string): Promise<string> {
    try {
      const response = await fetch(`http://${this.ollamaHost}:${this.ollamaPort}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.ollamaModel,
          messages: [
            { role: 'system', content: 'Você é o VEXOR, sistema de análise de mercado. Responda de forma objetiva seguindo o formato solicitado.' },
            { role: 'user', content: prompt }
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
      return data.message?.content || '';
    } catch (e) {
      console.error('[NewsIntelligence] Ollama error:', e);
      return '';
    }
  }

  /**
   * Parse da análise
   */
  private parseAnalysis(analysis: string): MarketInsight {
    const ibovMatch = analysis.match(/IBOV:\s*(BULLISH|BEARISH|NEUTRAL)/i);
    const dolarMatch = analysis.match(/DOLAR:\s*(BULLISH|BEARISH|NEUTRAL)/i);
    const petr4Match = analysis.match(/PETR4:\s*(BULLISH|BEARISH|NEUTRAL)/i);
    const vale3Match = analysis.match(/VALE3:\s*(BULLISH|BEARISH|NEUTRAL)/i);
    const btcMatch = analysis.match(/BTC:\s*(BULLISH|BEARISH|NEUTRAL)/i);
    const estrategiaMatch = analysis.match(/ESTRATEGIA:\s*(.+)/i);
    const vetoMatch = analysis.match(/VETO:\s*(SIM|NÃO)/i);
    const motivoMatch = analysis.match(/MOTIVO:\s*(.+)/i);
    const riscoMatch = analysis.match(/RISCO:\s*(BAIXO|MÉDIO|ALTO)/i);
    const confiancaMatch = analysis.match(/CONFIANCA:\s*(\d+)/i);
    
    // Parse dos impactos por ativo expandidos
    const assetImpacts = new Map<string, AssetImpact>();
    const assetMatches = analysis.matchAll(/ASSET:\s*(\w+):\s*(BULLISH|BEARISH|NEUTRAL)\s*\(([^)]+)\)/gi);
    for (const match of assetMatches) {
      const [, symbol, sentiment, reason] = match;
      assetImpacts.set(symbol, {
        symbol,
        sentiment: sentiment.toUpperCase() as any,
        confidence: 50,
        reason: reason.trim(),
        affectedBy: [],
        affects: []
      });
    }
    
    // Parse dos setores
    const sectorImpacts: SectorImpact[] = [];
    const sectorMatches = analysis.matchAll(/SECTOR:\s*([^:]+):\s*(BULLISH|BEARISH|NEUTRAL)/gi);
    for (const match of sectorMatches) {
      sectorImpacts.push({
        sectorId: match[1].trim().toLowerCase().replace(/\s+/g, '_'),
        sectorName: match[1].trim(),
        sentiment: match[2].toUpperCase() as any,
        affectedAssets: [],
        confidence: 50
      });
    }
    
    // Parse de ativos diretamente afetados
    const directlyAffectedMatch = analysis.match(/DIRETAMENTE:\s*\[([^\]]*)\]/i);
    const directlyAffected = directlyAffectedMatch 
      ? directlyAffectedMatch[1].split(',').map(s => s.trim()).filter(Boolean)
      : [];
    
    // Parse de ativos indiretamente afetados
    const indirectlyAffectedMatch = analysis.match(/INDIRETAMENTE:\s*\[([^\]]*)\]/i);
    const indirectlyAffected = indirectlyAffectedMatch
      ? indirectlyAffectedMatch[1].split(',').map(s => s.trim()).filter(Boolean)
      : [];

    return {
      assetImpacts,
      sectorImpacts,
      crossAnalysis: [], // Será preenchido pela análise cruzada
      directlyAffected,
      indirectlyAffected,
      impact: {
        ibov: (ibovMatch?.[1].toUpperCase() || 'NEUTRAL') as any,
        dolar: (dolarMatch?.[1].toUpperCase() || 'NEUTRAL') as any,
        petr4: (petr4Match?.[1].toUpperCase() || 'NEUTRAL') as any,
        vale3: (vale3Match?.[1].toUpperCase() || 'NEUTRAL') as any,
        btc: (btcMatch?.[1].toUpperCase() || 'NEUTRAL') as any
      },
      suggestedStrategy: estrategiaMatch?.[1]?.trim() || 'Aguardar',
      shouldVeto: vetoMatch?.[1]?.toUpperCase() === 'SIM',
      vetoReason: motivoMatch?.[1]?.trim() || '',
      riskLevel: (riscoMatch?.[1]?.toUpperCase() || 'MÉDIO') as any,
      confidence: parseInt(confiancaMatch?.[1] || '50'),
      rawAnalysis: analysis
    };
  }

  /**
   * Detecta sentiment básico
   */
  private detectSentiment(text: string): 'positive' | 'negative' | 'neutral' {
    const t = text.toLowerCase();
    
    const positive = ['alta', 'subiu', 'ganho', 'positivo', 'crescimento', 'recorde', 'supera'];
    const negative = ['baixa', 'caiu', 'perda', 'negativo', 'queda', 'crise', 'recessão'];
    
    let posCount = 0;
    let negCount = 0;
    
    for (const p of positive) if (t.includes(p)) posCount++;
    for (const n of negative) if (t.includes(n)) negCount++;
    
    if (posCount > negCount) return 'positive';
    if (negCount > posCount) return 'negative';
    return 'neutral';
  }

  /**
   * Detecta ativos relacionados
   */
  private detectAssets(text: string): string[] {
    const t = text.toUpperCase();
    const assets: string[] = [];
    
    // 1. Detecta símbolos B3 diretamente no texto
    // Padrões: PETR4, VALE3, ITUB4, AMER3, ALZR11, AAPL34, BEWL39, B3SA3, A1LG34, etc.
    const symbolPatterns = [
      /\b([A-Z0-9]{4,6})([34]|F)\b/g,           // Ações: PETR4, VALE3F, B3SA3, A1LG34
      /\b([A-Z0-9]{4,5})(11)\b/g,               // FIIs/ETFs: ALZR11, BOVA11
      /\b([A-Z0-9]{4,5})(34)\b/g,               // BDRs: AAPL34, AMZO34
      /\b([A-Z0-9]{4,5})(39)\b/g,               // ETFs internacionais: BEWL39
      /\b(WDO|WIN|DOL|IND|ISP|BGI|BGH|BGW)\b/g, // Futuros
      /\b(BTC|ETH|SOL|XRP|ADA|DOGE)(USDT|USD)?\b/g, // Cripto
    ];
    
    for (const pattern of symbolPatterns) {
      const matches = t.matchAll(pattern);
      for (const match of matches) {
        const symbol = match[0];
        if (symbol.length >= 4 && symbol.length <= 8) {
          if (!assets.includes(symbol)) {
            assets.push(symbol);
          }
        }
      }
    }
    
    // 2. Mapeamento por nome/keyword (empresas, commodities, etc.)
    const assetKeywords: Record<string, string[]> = {
      // Índices
      'IBOV': ['IBOV', 'BOVESPA', 'B3', 'IBOVESPA', 'BVSP', 'WIN', 'IND'],
      'S&P500': ['S&P', 'SPX', 'SP500', 'S&P500'],
      
      // Petróleo e Energia
      'PETR4': ['PETR', 'PETROBRAS', 'PETROLEO', 'PETRÓLEO'],
      'VALE3': ['VALE', 'MINERIO', 'MINÉRIO'],
      'PRIO3': ['PRIO', 'PETRORIO'],
      'RRRP3': ['RRRP'],
      
      // Bancos
      'ITUB4': ['ITAU', 'ITAÚ', 'ITUB', 'UNIBANCO'],
      'BBDC4': ['BRADESCO', 'BBDC'],
      'BBAS3': ['BANCO DO BRASIL', 'BBAS', 'BANCO BRASIL'],
      'SANB11': ['SANTANDER', 'SANB'],
      'BPAN4': ['BPAN', 'BANCO PAN'],
      'BBSE3': ['BBSE', 'BRASIL SEGURIDADE'],
      
      // Varejo
      'MGLU3': ['MAGALU', 'MAGAZINE LUIZA', 'MGLU'],
      'VVAR3': ['VIA VAREJO', 'VVAR'],
      'AMER3': ['AMERICANAS', 'AMER', 'LOJAS AMERICANAS'],
      'PCAR3': ['PONTO FRIO', 'PCAR'],
      
      // Mineração e Siderurgia
      'GGBR4': ['GERDAU', 'GGBR'],
      'CSNA3': ['CSN', 'CSNA', 'COMPANHIA SIDERURGICA'],
      'USIM5': ['USIMINAS', 'USIM'],
      
      // Saneamento
      'SBSP3': ['SABESP', 'SBSP', 'SANEAMENTO BASICO'],
      'CESP6': ['CESP'],
      'CSMG3': ['CSMG', 'COPASA'],
      
      // Elétricas
      'ELET3': ['ELETROBRAS', 'ELET'],
      'TAEE11': ['TAESA', 'TAEE'],
      'CMIG4': ['CEMIG', 'CMIG'],
      
      // Dólar e Moedas
      'DOL': ['DOLAR', 'DÓLAR', 'USD', 'USDBRL', 'WDO'],
      'EUR': ['EURO', 'EURBRL'],
      'GBP': ['LIBRA', 'GBP'],
      
      // Cripto
      'BTC': ['BITCOIN'],
      'ETH': ['ETHEREUM'],
      'SOL': ['SOLANA'],
      'XRP': ['RIPPLE'],
      'ADA': ['CARDANO'],
      'DOGE': ['DOGECOIN'],
      
      // Commodities
      'IRON': ['FERRO', 'IRON ORE', 'MINÉRIO DE FERRO'],
      'OIL': ['CRUDE OIL', 'WTI', 'BRENT'],
      'GOLD': ['OURO', 'GOLD', 'XAU'],
      'COPPER': ['COBRE', 'COPPER'],
      
      // Agronegócio
      'SOY': ['SOJA', 'SOY', 'SOYBEAN'],
      'CORN': ['MILHO', 'CORN'],
      'COFFEE': ['CAFÉ', 'CAFE', 'COFFEE'],
      
      // Bebidas
      'ABEV3': ['AMBEV', 'ABEV', 'BRAHMA', 'SKOL', 'ANTARCTICA'],
      
      // Alimentos
      'JBSS3': ['JBS', 'JBSS', 'FRIGORIFICO'],
      'BRFS3': ['BRF', 'PERDIGAO', 'SADIA'],
      
      // Saúde
      'RADL3': ['RAIA', 'DROGARIA', 'RADL', 'RAIA DROGASIL'],
      'FLRY3': ['FLEURY', 'FLRY'],
      'HAPV3': ['HAPVIDA', 'HAPV'],
      'GNDI3': ['NOTRE DAME', 'GNDI'],
      
      // Tech
      'TOTS3': ['TOTVS', 'TOTS'],
      'LWSA3': ['LOCAWEB', 'LWSA'],
      'SQIA3': ['SQIA', 'SQUIZE'],
      
      // Seguradoras
      'SULA11': ['SUL AMERICA', 'SULA'],
      
      // BDRs conhecidos
      'AAPL34': ['APPLE', 'AAPL'],
      'AMZO34': ['AMAZON', 'AMZN'],
      'MSFT34': ['MICROSOFT', 'MSFT'],
      'GOGL34': ['GOOGLE', 'GOOGL', 'ALPHABET'],
      'TSLA34': ['TESLA', 'TSLA'],
      'META34': ['META', 'FACEBOOK', 'FB'],
      'NVDC34': ['NVIDIA', 'NVDA'],
      'NFLX34': ['NETFLIX', 'NFLX'],
      'DISN34': ['DISNEY', 'DIS'],
      'ADBE34': ['ADOBE', 'ADBE'],
      'INTC34': ['INTEL', 'INTC'],
      'CSCO34': ['CISCO', 'CSCO'],
      'ORCL34': ['ORACLE', 'ORCL'],
      'VZTS34': ['VERIZON', 'VZTS'],
      'ATTB34': ['AT&T CORP', 'ATTB'],
      'BABA34': ['ALIBABA', 'BABA'],
      'JDUB34': ['JD.COM', 'JDUB'],
      'NIOB34': ['NIO CORP', 'NIOB'],
      'BAIQ39': ['BAIDU', 'BAIQ'],
      'AIRB34': ['AIRBUS', 'AIRB'],
      'ARMT34': ['ARM HOLDINGS', 'ARMT'],
      'AVGO34': ['AVAGO', 'BROADCOM', 'AVGO'],
      'ASML34': ['ASML HOLDING', 'ASML'],
      'QCOM34': ['QUALCOMM', 'QCOM'],
      'AMD34': ['AMD INC', 'AMD34'],
      'TXN34': ['TEXAS INSTRUMENTS', 'TXN'],
      'COST34': ['COSTCO WHOLESALE', 'COST'],
      'WMT34': ['WALMART INC', 'WMT'],
      'MCD34': ['MCDONALDS CORP', 'MCD'],
      'SBUX34': ['STARBUCKS', 'SBUX'],
      'NKE34': ['NIKE INC', 'NKE'],
      'TMUS34': ['T-MOBILE US', 'TMUS'],
      'CRM34': ['SALESFORCE', 'CRM'],
      'SAP34': ['SAP SE', 'SAP'],
      'NOW34': ['SERVICENOW', 'NOW'],
      'SNOW34': ['SNOWFLAKE', 'SNOW'],
      'PLTR34': ['PALANTIR', 'PLTR'],
      'UBER34': ['UBER TECHNOLOGIES', 'UBER'],
      'LYFT34': ['LYFT INC', 'LYFT'],
      'ABNB34': ['AIRBNB', 'ABNB'],
      'SPOT34': ['SPOTIFY', 'SPOT'],
      'ZM34': ['ZOOM VIDEO', 'ZM'],
      'DOCU34': ['DOCUSIGN', 'DOCU'],
      'SHOP34': ['SHOPIFY', 'SHOP'],
      'SQ34': ['SQUARE INC', 'BLOCK INC'],
      'PYPL34': ['PAYPAL', 'PYPL'],
      'MA34': ['MASTERCARD INC', 'MASTERCARD'],
      'VISA34': ['VISA INC', 'VISA'],
      'AXP34': ['AMERICAN EXPRESS', 'AXP'],
      'JPM34': ['JP MORGAN CHASE', 'JPM'],
      'BAC34': ['BANK OF AMERICA', 'BAC'],
      'WFC34': ['WELLS FARGO', 'WFC'],
      'C34': ['CITIGROUP INC', 'CITIGROUP'],
      'GS34': ['GOLDMAN SACHS', 'GS'],
      'MS34': ['MORGAN STANLEY', 'MORGAN STANLEY'],
      'BLK34': ['BLACKROCK', 'BLK'],
      'SCHW34': ['CHARLES SCHWAB', 'SCHW'],
      'VTRS34': ['VIATRIS', 'VTRS'],
      'PFE34': ['PFIZER INC', 'PFIZER'],
      'JNJ34': ['JOHNSON & JOHNSON', 'JOHNSON JOHNSON'],
      'UNH34': ['UNITEDHEALTH', 'UNH'],
      'ABBV34': ['ABBVIE INC', 'ABBVIE'],
      'MRK34': ['MERCK & CO', 'MERCK'],
      'LLY34': ['ELI LILLY', 'LILLY'],
      'T34': ['AT&T INC', 'ATT INC'],
      'VZ34': ['VERIZON COMM', 'VERIZON'],
      'TMO34': ['THERMO FISHER', 'TMO'],
      'ABT34': ['ABBOTT LABS', 'ABBOTT'],
      'DHR34': ['DANAHER CORP', 'DANAHER'],
      'BMY34': ['BRISTOL MYERS', 'BRISTOL'],
      'AMGN34': ['AMGEN INC', 'AMGEN'],
      'GILD34': ['GILEAD SCIENCES', 'GILEAD'],
      'REGN34': ['REGENERON', 'REGN'],
      'VRTX34': ['VERTEX PHARMA', 'VERTEX'],
      'BIIB34': ['BIOGEN INC', 'BIOGEN'],
      'ILMN34': ['ILLUMINA INC', 'ILLUMINA'],
      'ISRG34': ['INTUITIVE SURGICAL', 'ISRG'],
      'IDXX34': ['IDEXX LABS', 'IDEXX'],
      'ZTS34': ['ZOETIS INC', 'ZOETIS'],
      'EL34': ['ESTEE LAUDER', 'ESTEE'],
      'CL34': ['COLGATE PALMOLIVE', 'COLGATE'],
      'PG34': ['PROCTER & GAMBLE', 'PROCTER'],
      'KO34': ['COCA-COLA CO', 'COCA COLA'],
      'PEP34': ['PEPSICO INC', 'PEPSICO'],
      'HD34': ['HOME DEPOT', 'HOME DEPOT'],
      'LOW34': ['LOWES COMPANIES', 'LOWES'],
      'TGT34': ['TARGET CORP', 'TARGET'],
      'BJ34': ['BJS WHOLESALE', 'BJS'],
      'DG34': ['DOLLAR GENERAL', 'DOLLAR GENERAL'],
      'DLTR34': ['DOLLAR TREE', 'DOLLAR TREE'],
      'ROST34': ['ROSS STORES', 'ROSS'],
      'TJX34': ['TJX COMPANIES', 'TJX'],
      'BERK34': ['BERKSHIRE HATHAWAY', 'BERKSHIRE'],
      
      // FIIs - Fundos Imobiliários
      'ALZR11': ['ALIANZA', 'ALZR', 'FII ALIANZA'],
      'HGLG11': ['HGLG', 'FII HGLG', 'CIAB'],
      'XPML11': ['XPML', 'FII XP LOG'],
      'BCFF11': ['BCFF', 'FII BCFF'],
      'BTLG11': ['BTLG', 'FII BTG LOG'],
      'RECR11': ['RECR', 'FII REC RECEITAS'],
      'HFOF11': ['HFOF', 'FII HFOF'],
      'HABT11': ['HABT', 'FII HABT'],
      'HCTR11': ['HCTR', 'FII HCTR'],
      'HGCR11': ['HGCR', 'FII HG CRUZ'],
      'HGRE11': ['HGRE', 'FII HGRE'],
      'HGRU11': ['HGRU', 'FII HGRU'],
      'HGPO11': ['HGPO', 'FII HG POLO'],
      'HGBS11': ['HGBS', 'FII HGBS'],
      'HGJH11': ['HGJH', 'FII HG JERE'],
      'HGRV11': ['HGRV', 'FII HGRV'],
      'VILG11': ['VILG', 'FII VILA'],
      'VISC11': ['VISC', 'FII VISC'],
      'VGIR11': ['VGIR', 'FII VGIR'],
      'RBRP11': ['RBRP', 'FII RBR PRIME'],
      'RBRR11': ['RBRR', 'FII RBR RECEITAS'],
      'RBRD11': ['RBRD', 'FII RBR DISTR'],
      'CPTS11': ['CPTS', 'FII CAPITANIA'],
      'BRCR11': ['BRCR', 'FII BRCR'],
      'BRCO11': ['BRCO', 'FII BRCO'],
      'BBPO11': ['BBPO', 'FII BB POLO'],
      'BBRC11': ['BBRC', 'FII BB RC'],
      'BBIG11': ['BBIG', 'FII BB IGUATEMI'],
      'BBOI11': ['BBOI', 'FII BB OI'],
      'BBSD11': ['BBSD', 'FII BB SD'],
      'BBFO11': ['BBFO', 'FII BB FO'],
      'BBGO11': ['BBGO', 'FII BB GO'],
      'BPAC11': ['BPAC', 'FII BPAC'],
      'BTAL11': ['BTAL', 'FII BT ALUGUEL'],
      'BTCI11': ['BTCI', 'FII BT CI'],
      'BTRA11': ['BTRA', 'FII BT RA'],
      'PABY11': ['PABY', 'FII PABY'],
      'PRTS11': ['PRTS', 'FII PRTS'],
      'PRSV11': ['PRSV', 'FII PRSV'],
      'PRRN11': ['PRRN', 'FII PRRN'],
      'PLCR11': ['PLCR', 'FII PLCR'],
      'PORD11': ['PORD', 'FII PORD'],
      'PFOF11': ['PFOF', 'FII PFOF'],
      'OUFF11': ['OUFF', 'FII OUFF'],
      'NSLU11': ['NSLU', 'FII NSLU'],
      'NCHB11': ['NCHB', 'FII NCHB'],
      'NCRI11': ['NCRI', 'FII NCRI'],
      'MBNA11': ['MBNA', 'FII MBNA'],
      'MGFF11': ['MGFF', 'FII MGFF'],
      'MCCI11': ['MCCI', 'FII MCCI'],
      'LVBI11': ['LVBI', 'FII LVBI'],
      'KINP11': ['KINP', 'FII KINP'],
      'JPPA11': ['JPPA', 'FII JPPA'],
      'JPPC11': ['JPPC', 'FII JPPC'],
      'JPPF11': ['JPPF', 'FII JPPF'],
      'JPPG11': ['JPPG', 'FII JPPG'],
      'JPPL11': ['JPPL', 'FII JPPL'],
      'JPPM11': ['JPPM', 'FII JPPM'],
      'JPPR11': ['JPPR', 'FII JPPR'],
      'JPPS11': ['JPPS', 'FII JPPS'],
      'JSRE11': ['JSRE', 'FII JSRE'],
      'JSXI11': ['JSXI', 'FII JSXI'],
      'HSHU11': ['HSHU', 'FII HSHU'],
      'HUSC11': ['HUSC', 'FII HUSC'],
      'GTWR11': ['GTWR', 'FII GTWR'],
      'GRNT11': ['GRNT', 'FII GRNT'],
      'GRLV11': ['GRLV', 'FII GRLV'],
      'GRSA11': ['GRSA', 'FII GRSA'],
      'GGRC11': ['GGRC', 'FII GGRC'],
      'FEXC11': ['FEXC', 'FII FEXC'],
      'FAMB11': ['FAMB', 'FII FAMB'],
      'EURO11': ['EURO', 'FII EUROPAR'],
      'EDGA11': ['EDGA', 'FII EDGA'],
      'DIVO11': ['DIVO', 'FII DIVO'],
      'DEVA11': ['DEVA', 'FII DEVA'],
      'CXTL11': ['CXTL', 'FII CXTL'],
      'CXRI11': ['CXRI', 'FII CXRI'],
      'CXCE11': ['CXCE', 'FII CXCE'],
      'CTXT11': ['CTXT', 'FII CTXT'],
      'CRFF11': ['CRFF', 'FII CRFF'],
      'CPTR11': ['CPTR', 'FII CPTR'],
      'CNES11': ['CNES', 'FII CNES'],
      'CARE11': ['CARE', 'FII CARE'],
      'BVAR11': ['BVAR', 'FII BVAR'],
      'BLMG11': ['BLMG', 'FII BLMG'],
      'BLCA11': ['BLCA', 'FII BLCA'],
      'BIEI11': ['BIEI', 'FII BIEI'],
      'BICL11': ['BICL', 'FII BICL'],
      'BIDI11': ['BIDI', 'FII BIDI'],
      'BIDB11': ['BIDB', 'FII BIDB'],
      'BIEM11': ['BIEM', 'FII BIEM'],
      'BITH11': ['BITH', 'FII BITH'],
      'BIME11': ['BIME', 'FII BIME'],
      'BIRF11': ['BIRF', 'FII BIRF'],
      'BIVB11': ['BIVB', 'FII BIVB'],
      'BIVE11': ['BIVE', 'FII BIVE'],
      'BIWM11': ['BIWM', 'FII BIWM'],
      'BIYF11': ['BIYF', 'FII BIYF'],
      'BKCH11': ['BKCH', 'FII BKCH'],
      'BMTU11': ['BMTU', 'FII BMTU'],
      'BNDA11': ['BNDA', 'FII BNDA'],
      'BNDX11': ['BNDX', 'FII BNDX'],
      'BNFS11': ['BNFS', 'FII BNFS'],
      'BODB11': ['BODB', 'FII BODB'],
      'BOVA11': ['BOVA', 'FII BOVA', 'ETF BOVA'],
      'BOVV11': ['BOVV', 'FII BOVV'],
      'BOVX11': ['BOVX', 'FII BOVX'],
      'BPML11': ['BPML', 'FII BPML'],
      'BRBI11': ['BRBI', 'FII BRBI'],
      'BROF11': ['BROF', 'FII BROF'],
      'BRZP11': ['BRZP', 'FII BRZP'],
      'BSHV11': ['BSHV', 'FII BSHV'],
      'BSLV11': ['BSLV', 'FII BSLV'],
      'BSOX11': ['BSOX', 'FII BSOX'],
      'BTAG11': ['BTAG', 'FII BTAG'],
      'BTIP11': ['BTIP', 'FII BTIP'],
      'BTLT11': ['BTLT', 'FII BTLT'],
      'BURA11': ['BURA', 'FII BURA'],
      'CACR11': ['CACR', 'FII CACR'],
      'CCME11': ['CCME', 'FII CCME'],
      'CDII11': ['CDII', 'FII CDII'],
      'CEOC11': ['CEOC', 'FII CEOC'],
      'CFAR11': ['CFAR', 'FII CFAR'],
      'CFTY11': ['CFTY', 'FII CFTY'],
      'CHBI11': ['CHBI', 'FII CHBI'],
      'CICB11': ['CICB', 'FII CICB'],
      'CITI11': ['CITI', 'FII CITI'],
      'CLLS11': ['CLLS', 'FII CLLS'],
      'CLSC11': ['CLSC', 'FII CLSC'],
      'CMIN11': ['CMIN', 'FII CMIN'],
      'CNCO11': ['CNCO', 'FII CNCO'],
      'CNRD11': ['CNRD', 'FII CNRD'],
      'CNRN11': ['CNRN', 'FII CNRN'],
      'CNSY11': ['CNSY', 'FII CNSY'],
      'CPRC11': ['CPRC', 'FII CPRC'],
      'CRCP11': ['CRCP', 'FII CRCP'],
      'CRGM11': ['CRGM', 'FII CRGM'],
      'CRIN11': ['CRIN', 'FII CRIN'],
      'CRLP11': ['CRLP', 'FII CRLP'],
      'CRPG11': ['CRPG', 'FII CRPG'],
      'CRRA11': ['CRRA', 'FII CRRA'],
      'CRSL11': ['CRSL', 'FII CRSL'],
      'CRSS11': ['CRSS', 'FII CRSS'],
      'CRTA11': ['CRTA', 'FII CRTA'],
      'CRUA11': ['CRUA', 'FII CRUA'],
      'CSAU11': ['CSAU', 'FII CSAU'],
      'CSLG11': ['CSLG', 'FII CSLG'],
      'CTNM11': ['CTNM', 'FII CTNM'],
      'CTSA11': ['CTSA', 'FII CTSA'],
      'CTWR11': ['CTWR', 'FII CTWR'],
      'CVCB11': ['CVCB', 'FII CVCB'],
      'DAVI11': ['DAVI', 'FII DAVI'],
      'DBNE11': ['DBNE', 'FII DBNE'],
      'DIMP11': ['DIMP', 'FII DIMP'],
      'DOVL11': ['DOVL', 'FII DOVL'],
      'DPET11': ['DPET', 'FII DPET'],
      'DPPA11': ['DPPA', 'FII DPPA'],
      'DRIT11': ['DRIT', 'FII DRIT'],
      'DTCY11': ['DTCY', 'FII DTCY'],
      'DUBG11': ['DUBG', 'FII DUBG'],
      'DUQE11': ['DUQE', 'FII DUQE'],
      'ECTL11': ['ECTL', 'FII ECTL'],
      'EGIE11': ['EGIE', 'FII EGIE'],
      'ELDO11': ['ELDO', 'FII ELDO'],
      'ENJU11': ['ENJU', 'FII ENJU'],
      'ENZL11': ['ENZL', 'FII ENZL'],
      'EQIN11': ['EQIN', 'FII EQIN'],
      'ERPA11': ['ERPA', 'FII ERPA'],
      'ESPA11': ['ESPA', 'FII ESPA'],
      'ESTQ11': ['ESTQ', 'FII ESTQ'],
      'ETCA11': ['ETCA', 'FII ETCA'],
      'ETEN11': ['ETEN', 'FII ETEN'],
      'ETER11': ['ETER', 'FII ETER'],
      'EXXV11': ['EXXV', 'FII EXXV'],
      'FAQA11': ['FAQA', 'FII FAQA'],
      'FASB11': ['FASB', 'FII FASB'],
      'FATI11': ['FATI', 'FII FATI'],
      'FBIV11': ['FBIV', 'FII FBIV'],
      'FCFL11': ['FCFL', 'FII FCFL'],
      'FCMN11': ['FCMN', 'FII FCMN'],
      'FCRI11': ['FCRI', 'FII FCRI'],
      'FCVS11': ['FCVS', 'FII FCVS'],
      'FDIV11': ['FDIV', 'FII FDIV'],
      'FENT11': ['FENT', 'FII FENT'],
      'FESE11': ['FESE', 'FII FESE'],
      'FEXI11': ['FEXI', 'FII FEXI'],
      'FFAB11': ['FFAB', 'FII FFAB'],
      'FFCI11': ['FFCI', 'FII FFCI'],
      'FFCL11': ['FFCL', 'FII FFCL'],
      'FFCM11': ['FFCM', 'FII FFCM'],
      'FFCR11': ['FFCR', 'FII FFCR'],
      'FFDI11': ['FFDI', 'FII FFDI'],
      'FFEL11': ['FFEL', 'FII FFEL'],
      'FFEU11': ['FFEU', 'FII FFEU'],
      'FFEX11': ['FFEX', 'FII FFEX'],
      'FFIC11': ['FFIC', 'FII FFIC'],
      'FFII11': ['FFII', 'FII FFII'],
      'FFIL11': ['FFIL', 'FII FFIL'],
      'FFIN11': ['FFIN', 'FII FFIN'],
      'FFMC11': ['FFMC', 'FII FFMC'],
      'FFMN11': ['FFMN', 'FII FFMN'],
      'FFMO11': ['FFMO', 'FII FFMO'],
      'FFNC11': ['FFNC', 'FII FFNC'],
      'FFSA11': ['FFSA', 'FII FFSA'],
      'FFSD11': ['FFSD', 'FII FFSD'],
      'FFTC11': ['FFTC', 'FII FFTC'],
      'FFTT11': ['FFTT', 'FII FFTT'],
      'FFUS11': ['FFUS', 'FII FFUS'],
      'FGAA11': ['FGAA', 'FII FGAA'],
      'FGUR11': ['FGUR', 'FII FGUR'],
      'FHLS11': ['FHLS', 'FII FHLS'],
      'FICG11': ['FICG', 'FII FICG'],
      'FICR11': ['FICR', 'FII FICR'],
      'FICT11': ['FICT', 'FII FICT'],
      'FIDI11': ['FIDI', 'FII FIDI'],
      'FIEE11': ['FIEE', 'FII FIEE'],
      'FIEG11': ['FIEG', 'FII FIEG'],
      'FIEI11': ['FIEI', 'FII FIEI'],
      'FIEJ11': ['FIEJ', 'FII FIEJ'],
      'FIEK11': ['FIEK', 'FII FIEK'],
      'FIEQ11': ['FIEQ', 'FII FIEQ'],
      'FIES11': ['FIES', 'FII FIES'],
      'FIEV11': ['FIEV', 'FII FIEV'],
      'FIIB11': ['FIIB', 'FII FIIB'],
      'FIIP11': ['FIIP', 'FII FIIP'],
      'FIIR11': ['FIIR', 'FII FIIR'],
      'FIIS11': ['FIIS', 'FII FIIS'],
      'FIIV11': ['FIIV', 'FII FIIV'],
      'FIIW11': ['FIIW', 'FII FIIW'],
      'FIIX11': ['FIIX', 'FII FIIX'],
      'FIJA11': ['FIJA', 'FII FIJA'],
      'FIJB11': ['FIJB', 'FII FIJB'],
      'FIJC11': ['FIJC', 'FII FIJC'],
      'FIJD11': ['FIJD', 'FII FIJD'],
      'FIJE11': ['FIJE', 'FII FIJE'],
      'FIJF11': ['FIJF', 'FII FIJF'],
      'FIJG11': ['FIJG', 'FII FIJG'],
      'FIJH11': ['FIJH', 'FII FIJH'],
      'FIJI11': ['FIJI', 'FII FIJI'],
      'FIJJ11': ['FIJJ', 'FII FIJJ'],
      'FIJK11': ['FIJK', 'FII FIJK'],
      'FIJL11': ['FIJL', 'FII FIJL'],
      'FIJM11': ['FIJM', 'FII FIJM'],
      'FIJN11': ['FIJN', 'FII FIJN'],
      'FIJO11': ['FIJO', 'FII FIJO'],
      'FIJP11': ['FIJP', 'FII FIJP'],
      'FIJQ11': ['FIJQ', 'FII FIJQ'],
      'FIJR11': ['FIJR', 'FII FIJR'],
      'FIJS11': ['FIJS', 'FII FIJS'],
      'FIJT11': ['FIJT', 'FII FIJT'],
      'FIJU11': ['FIJU', 'FII FIJU'],
      'FIJV11': ['FIJV', 'FII FIJV'],
      'FIJW11': ['FIJW', 'FII FIJW'],
      'FIJX11': ['FIJX', 'FII FIJX'],
      'FIJY11': ['FIJY', 'FII FIJY'],
      'FIJZ11': ['FIJZ', 'FII FIJZ'],
      
      // Futuros BMF
      'WIN': ['WIN', 'MINI INDICE', 'MINI IBOV', 'FUTURO IBOV'],
      'WDO': ['WDO', 'MINI DOLAR', 'MINI DOL', 'FUTURO DOLAR'],
      'IND': ['IND', 'INDICE', 'FUTURO INDICE'],
      'ISP': ['ISP', 'S&P FUTURO', 'S&P500 FUTURO'],
      'BGI': ['BGI', 'BOVESPA GRAFICO'],
      'BGH': ['BGH', 'BOVESPA HISTORICO'],
      'BGW': ['BGW', 'BOVESPA WEB'],
      'WSP': ['WSP', 'MINI S&P'],
      'WBG': ['WBG', 'MINI BOVESPA'],
      
      // ETFs
      'IVVB11': ['IVVB', 'ETF IVVB', 'ISHARES S&P500'],
      'SMAL11': ['SMAL', 'ETF SMAL', 'ISHARES SMALL'],
      'BRAX11': ['BRAX', 'ETF BRAX'],
      'PIBB11': ['PIBB', 'ETF PIBB'],
      'ECOO11': ['ECOO', 'ETF ECOO'],
      'MATB11': ['MATB', 'ETF MATB'],
      'FIND11': ['FIND', 'ETF FIND'],
      'MOBI11': ['MOBI', 'ETF MOBI'],
      'XBOV11': ['XBOV', 'ETF XBOV'],
      'SPXI11': ['SPXI', 'ETF SPXI'],
    };
    
    for (const [asset, keywords] of Object.entries(assetKeywords)) {
      for (const kw of keywords) {
        if (t.includes(kw)) {
          if (!assets.includes(asset)) {
            assets.push(asset);
          }
          break;
        }
      }
    }
    
    return assets.length > 0 ? [...new Set(assets)] : ['GERAL'];
  }

  /**
   * Fetch JSON helper
   */
  private fetchJSON(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
      https.get(url, { timeout: 10000 }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error('Invalid JSON'));
          }
        });
      }).on('error', reject).on('timeout', () => {
        reject(new Error('Timeout'));
      });
    });
  }

  /**
   * Fetch Text helper
   */
  private fetchText(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      https.get(url, { timeout: 10000 }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      }).on('error', reject).on('timeout', () => {
        reject(new Error('Timeout'));
      });
    });
  }

  /**
   * Limpa cache
   */
  clearCache(): void {
    this.newsCache = [];
    this.lastFetch = 0;
  }
  
  /**
   * Análise cruzada - verifica contradições e correlações
   */
  performCrossAnalysis(insight: MarketInsight): CrossAnalysis[] {
    const crossAnalysis: CrossAnalysis[] = [];
    
    // Correlações conhecidas entre ativos
    const correlations: Record<string, { positive: string[]; negative: string[] }> = {
      'PETR4': { 
        positive: ['VALE3', 'OIL', 'RRRP3', 'PRIO3'], // Petróleo sobe junto
        negative: ['DOL'] // Dólar alto prejudica exportação
      },
      'VALE3': { 
        positive: ['IRON', 'GGBR4', 'CSNA3'], // Mineração correlacionada
        negative: ['DOL'] 
      },
      'IBOV': { 
        positive: ['PETR4', 'VALE3', 'ITUB4', 'BBDC4'], // Peso no índice
        negative: ['DOL'] // Dólar alto = fuga de capital
      },
      'DOL': { 
        positive: ['USDBRL'], 
        negative: ['IBOV', 'PETR4', 'VALE3', 'MGLU3'] 
      },
      'BTC': { 
        positive: ['ETH', 'SOL', 'XRP'], // Cripto correlacionada
        negative: ['DOL'] // Dólar fraco = cripto forte
      },
      'ITUB4': { 
        positive: ['BBDC4', 'BBAS3', 'SANB11'], // Bancos brasileiros
        negative: [] 
      },
      'GOLD': { 
        positive: [], 
        negative: ['IBOV'] // Ouro = risco off
      },
      'S&P500': { 
        positive: ['IBOV'], 
        negative: [] 
      }
    };
    
    // Verifica cada ativo com impacto
    for (const [symbol, impact] of insight.assetImpacts) {
      const correlation = correlations[symbol];
      if (!correlation) continue;
      
      const contradictions: string[] = [];
      const confirmedCorrelations: string[] = [];
      
      // Verifica correlações positivas
      for (const related of correlation.positive) {
        const relatedImpact = insight.assetImpacts.get(related);
        if (relatedImpact) {
          if (impact.sentiment !== 'NEUTRAL' && relatedImpact.sentiment !== 'NEUTRAL') {
            if (impact.sentiment === relatedImpact.sentiment) {
              confirmedCorrelations.push(`${related}: mesma direção (${impact.sentiment})`);
            } else {
              contradictions.push(`${related}: direção oposta (${impact.sentiment} vs ${relatedImpact.sentiment})`);
            }
          }
        }
      }
      
      // Verifica correlações negativas
      for (const related of correlation.negative) {
        const relatedImpact = insight.assetImpacts.get(related);
        if (relatedImpact) {
          if (impact.sentiment !== 'NEUTRAL' && relatedImpact.sentiment !== 'NEUTRAL') {
            if (impact.sentiment !== relatedImpact.sentiment) {
              confirmedCorrelations.push(`${related}: inverso esperado (${impact.sentiment} vs ${relatedImpact.sentiment})`);
            } else {
              contradictions.push(`${related}: deveria ser inverso mas é igual (${impact.sentiment})`);
            }
          }
        }
      }
      
      // Determina se faz sentido
      const makesSense = contradictions.length === 0;
      
      if (contradictions.length > 0 || confirmedCorrelations.length > 0) {
        crossAnalysis.push({
          symbol,
          makesSense,
          contradictions,
          correlations: confirmedCorrelations
        });
      }
    }
    
    return crossAnalysis;
  }
  
  /**
   * Propaga impacto para ativos correlacionados
   */
  propagateImpactToCorrelated(insight: MarketInsight): void {
    // Setores e seus ativos
    const sectorAssets: Record<string, string[]> = {
      'banco': ['ITUB4', 'BBDC4', 'BBAS3', 'SANB11', 'BPAN4'],
      'mineracao': ['VALE3', 'GGBR4', 'CSNA3', 'USIM5'],
      'petroleo': ['PETR4', 'PETR3', 'PRIO3', 'RRRP3', 'ENAT3'],
      'varejo': ['MGLU3', 'VVAR3', 'AMER3', 'PCAR3'],
      'eletrica': ['ELET3', 'ELET6', 'TAEE11', 'CMIG4'],
      'saneamento': ['SBSP3', 'CESP6', 'CSMG3'],
      'saude': ['RADL3', 'FLRY3', 'HAPV3', 'GNDI3'],
      'imobiliario': ['ALZR11', 'HGLG11', 'XPML11', 'BCFF11'],
      'cripto': ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOGE']
    };
    
    // Propaga impacto de setores para ativos
    for (const sectorImpact of insight.sectorImpacts) {
      const assets = sectorAssets[sectorImpact.sectorId] || [];
      for (const asset of assets) {
        if (!insight.assetImpacts.has(asset)) {
          insight.assetImpacts.set(asset, {
            symbol: asset,
            sentiment: sectorImpact.sentiment,
            confidence: sectorImpact.confidence * 0.8, // Menor confiança por propagação
            reason: `Impacto propagado do setor ${sectorImpact.sectorName}`,
            affectedBy: [sectorImpact.sectorId],
            affects: []
          });
          
          if (!insight.indirectlyAffected.includes(asset)) {
            insight.indirectlyAffected.push(asset);
          }
        }
      }
    }
  }

  /**
   * Estatísticas
   */
  getStats(): { cacheSize: number; lastFetch: Date | null } {
    return {
      cacheSize: this.newsCache.length,
      lastFetch: this.lastFetch ? new Date(this.lastFetch) : null
    };
  }
}

// ==================== SINGLETON ====================

export const newsIntelligence = new NewsIntelligence();
export type { NewsItem, MarketInsight };
