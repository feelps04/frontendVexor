/**
 * News Service
 * Fetches news from Pepperstone, MT5 Genial and other sources
 */

interface NewsItem {
  id: string;
  title: string;
  summary: string;
  source: string;
  symbol?: string;
  category: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  publishedAt: Date;
  url?: string;
  relatedGroups?: string[];
}

class NewsService {
  private cache: NewsItem[] = [];
  private lastUpdate: Date = new Date(0);

  async getPepperstoneNews(): Promise<NewsItem[]> {
    try {
      // Pepperstone news API (mock - in production use real API)
      const response = await fetch('https://api.pepperstone.com/v1/news', {
        headers: {
          'Authorization': `Bearer ${process.env.PEPPERSTONE_API_KEY || ''}`,
        },
      });
      
      if (!response.ok) {
        // Return mock news if API unavailable
        return this.getMockNews('Pepperstone');
      }
      
      const data = await response.json() as { news?: any[] };
      return (data.news || []).map((n: any) => this.parseNewsItem(n, 'Pepperstone'));
    } catch (error) {
      return this.getMockNews('Pepperstone');
    }
  }

  async getMT5GenialNews(): Promise<NewsItem[]> {
    try {
      // MT5 Genial news (via WebSocket or REST)
      // In production, connect to MT5 terminal via ZeroMQ or WebSocket
      const response = await fetch('https://api.genial.com.br/v1/market-news', {
        headers: {
          'Authorization': `Bearer ${process.env.GENIAL_API_KEY || ''}`,
        },
      });
      
      if (!response.ok) {
        return this.getMockNews('MT5 Genial');
      }
      
      const data = await response.json() as { news?: any[] };
      return (data.news || []).map((n: any) => this.parseNewsItem(n, 'MT5 Genial'));
    } catch (error) {
      return this.getMockNews('MT5 Genial');
    }
  }

  async getInvestingNews(): Promise<NewsItem[]> {
    try {
      // Investing.com RSS feed
      const response = await fetch('https://br.investing.com/rss/news.rss');
      if (!response.ok) {
        return this.getMockNews('Investing.com');
      }
      
      const text = await response.text();
      return this.parseRSS(text, 'Investing.com');
    } catch (error) {
      return this.getMockNews('Investing.com');
    }
  }

  async getAllNews(): Promise<NewsItem[]> {
    const [pepperstone, mt5, investing] = await Promise.all([
      this.getPepperstoneNews(),
      this.getMT5GenialNews(),
      this.getInvestingNews(),
    ]);

    const all = [...pepperstone, ...mt5, ...investing];
    
    // Deduplicate by title
    const seen = new Set<string>();
    const unique = all.filter(n => {
      const key = n.title.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort by date
    unique.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());

    this.cache = unique;
    this.lastUpdate = new Date();

    return unique;
  }

  async getNewsForSymbol(symbol: string): Promise<NewsItem[]> {
    const all = this.cache.length > 0 ? this.cache : await this.getAllNews();
    return all.filter(n => 
      n.symbol?.toUpperCase() === symbol.toUpperCase() ||
      n.title.toUpperCase().includes(symbol.toUpperCase())
    );
  }

  async getNewsForGroup(group: string): Promise<NewsItem[]> {
    const all = this.cache.length > 0 ? this.cache : await this.getAllNews();
    return all.filter(n => 
      n.relatedGroups?.includes(group) || 
      n.category.toLowerCase() === group.toLowerCase()
    );
  }

  private parseNewsItem(raw: any, source: string): NewsItem {
    return {
      id: raw.id || Math.random().toString(36).substr(2, 9),
      title: raw.title || raw.headline || '',
      summary: raw.summary || raw.description || '',
      source,
      symbol: raw.symbol || raw.ticker,
      category: raw.category || 'general',
      sentiment: this.detectSentiment(raw.title || ''),
      publishedAt: new Date(raw.publishedAt || raw.date || Date.now()),
      url: raw.url || raw.link,
      relatedGroups: raw.relatedGroups || [],
    };
  }

  private parseRSS(rss: string, source: string): NewsItem[] {
    const items: NewsItem[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(rss)) !== null) {
      const item = match[1];
      const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/);
      const descMatch = item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) || item.match(/<description>(.*?)<\/description>/);
      const linkMatch = item.match(/<link>(.*?)<\/link>/);
      const dateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/);

      if (titleMatch) {
        items.push({
          id: Math.random().toString(36).substr(2, 9),
          title: titleMatch[1].trim(),
          summary: descMatch?.[1]?.trim() || '',
          source,
          category: 'general',
          sentiment: this.detectSentiment(titleMatch[1]),
          publishedAt: new Date(dateMatch?.[1] || Date.now()),
          url: linkMatch?.[1]?.trim(),
        });
      }
    }

    return items;
  }

  private detectSentiment(text: string): 'positive' | 'negative' | 'neutral' {
    const positive = ['alta', 'subiu', 'ganho', 'recorde', 'crescimento', 'positivo', 'alta de', 'rally', 'otimista'];
    const negative = ['queda', 'caiu', 'perda', 'prejuízo', 'negativo', 'queda de', 'crise', 'recessão', 'pessimista'];
    
    const lower = text.toLowerCase();
    
    const posCount = positive.filter(p => lower.includes(p)).length;
    const negCount = negative.filter(n => lower.includes(n)).length;
    
    if (posCount > negCount) return 'positive';
    if (negCount > posCount) return 'negative';
    return 'neutral';
  }

  private getMockNews(source: string): NewsItem[] {
    const now = new Date();
    return [
      {
        id: '1',
        title: 'PETR4: Petroleiro Brasileiro atinge máxima do ano',
        summary: 'Petrobras atinge maior cotação em 12 meses com alta do petróleo',
        source,
        symbol: 'PETR4',
        category: 'energia',
        sentiment: 'positive',
        publishedAt: new Date(now.getTime() - 1000 * 60 * 30),
        relatedGroups: ['ENERGIA', 'PETROLEO'],
      },
      {
        id: '2',
        title: 'VALE3: Preço do minério de ferro cai 5% na China',
        summary: 'Demanda chinesa por minério enfraquece com desaceleração econômica',
        source,
        symbol: 'VALE3',
        category: 'mineracao',
        sentiment: 'negative',
        publishedAt: new Date(now.getTime() - 1000 * 60 * 60),
        relatedGroups: ['MINERACAO', 'COMMODITIES'],
      },
      {
        id: '3',
        title: 'Fed sinaliza manutenção de juros altos por mais tempo',
        summary: 'Minutos do FOMC indicam cautela com inflação persistente',
        source,
        category: 'macro',
        sentiment: 'negative',
        publishedAt: new Date(now.getTime() - 1000 * 60 * 90),
        relatedGroups: ['MACRO', 'JUROS'],
      },
      {
        id: '4',
        title: 'Bitcoin rompe resistência de $65.000',
        summary: 'Criptomoeda ganha impulso com entrada de ETFs spot',
        source,
        symbol: 'BTC',
        category: 'crypto',
        sentiment: 'positive',
        publishedAt: new Date(now.getTime() - 1000 * 60 * 120),
        relatedGroups: ['CRYPTO', 'BITCOIN'],
      },
      {
        id: '5',
        title: 'WEGE3: Eletrodomésticos e industriais impulsionam vendas',
        summary: 'WEG reporta crescimento de 15% no faturamento no trimestre',
        source,
        symbol: 'WEGE3',
        category: 'industrial',
        sentiment: 'positive',
        publishedAt: new Date(now.getTime() - 1000 * 60 * 180),
        relatedGroups: ['INDUSTRIAL', 'EQUIPAMENTOS'],
      },
    ];
  }
}

export const newsService = new NewsService();
export type { NewsItem };
