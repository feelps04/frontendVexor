/**
 * VEXOR Intermarket Analysis
 * Correlações validadas pelo Macro Agent
 * Dólar, Commodities, Ibovespa, S&P 500, SELIC, Ouro
 */

import { oracleDB } from '../oracle-db.js';
import { telegramNotifier } from '../telegram-notifier.js';

// ==================== CORRELATIONS ====================

interface Correlation {
  asset1: string;
  asset2: string;
  type: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  strength: number; // -1 to 1
  description: string;
  tradingRule: string;
}

interface MarketData {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  timestamp: Date;
}

interface CrossMarketSignal {
  primaryAsset: string;
  correlatedAssets: Array<{
    symbol: string;
    correlation: number;
    currentMove: number;
    alignment: 'ALIGNED' | 'DIVERGENT' | 'NEUTRAL';
  }>;
  overallSignal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;
  warning?: string;
}

class IntermarketAnalysis {
  // Correlações validadas
  private readonly CORRELATIONS: Correlation[] = [
    {
      asset1: 'DOLAR',
      asset2: 'COMMODITIES',
      type: 'NEGATIVE',
      strength: -0.7,
      description: 'Dólar forte = commodities pressionadas',
      tradingRule: 'Não comprar commodity se dólar em alta significativa'
    },
    {
      asset1: 'DOLAR',
      asset2: 'IBOVESPA',
      type: 'NEGATIVE',
      strength: -0.6,
      description: 'Dólar subindo = Ibovespa tende a cair',
      tradingRule: 'Cuidado ao comprar ações com dólar em forte alta'
    },
    {
      asset1: 'SP500',
      asset2: 'IBOVESPA',
      type: 'POSITIVE',
      strength: 0.75,
      description: 'S&P 500 em queda = sinal de não comprar Ibovespa',
      tradingRule: 'Confirmar cada sinal B3 com índice americano'
    },
    {
      asset1: 'SELIC',
      asset2: 'ACOES',
      type: 'NEGATIVE',
      strength: -0.5,
      description: 'SELIC subindo = ações pressionadas',
      tradingRule: 'Macro Agent alerta antes de qualquer entrada na B3'
    },
    {
      asset1: 'DOLAR',
      asset2: 'OURO',
      type: 'NEGATIVE',
      strength: -0.8,
      description: 'Dólar forte = ouro pressionado',
      tradingRule: 'Ouro serve de hedge em cenários de dólar fraco'
    },
    {
      asset1: 'DOLLAR_INDEX',
      asset2: 'EMERGING',
      type: 'NEGATIVE',
      strength: -0.65,
      description: 'DXY forte = emergentes sob pressão',
      tradingRule: 'Brasil é afetado por DXY alto'
    },
    {
      asset1: 'VIX',
      asset2: 'SP500',
      type: 'NEGATIVE',
      strength: -0.85,
      description: 'VIX alto = medo no mercado',
      tradingRule: 'VIX > 25 = reduzir exposição em ações'
    },
    {
      asset1: 'TREASURY_10Y',
      asset2: 'ACOES',
      type: 'NEGATIVE',
      strength: -0.4,
      description: 'Taxas altas = valuation de ações pressionado',
      tradingRule: 'Monitorar Treasury 10Y como proxy de risco'
    }
  ];

  private marketData: Map<string, MarketData> = new Map();

  /**
   * Atualiza dados de mercado
   */
  updateMarketData(data: MarketData): void {
    this.marketData.set(data.symbol, data);
  }

  /**
   * Analisa correlações cruzadas
   */
  analyzeCrossMarket(primaryAsset: string): CrossMarketSignal {
    const correlatedAssets: CrossMarketSignal['correlatedAssets'] = [];

    // Busca correlações relevantes
    const relevantCorrelations = this.CORRELATIONS.filter(
      c => c.asset1 === primaryAsset || c.asset2 === primaryAsset
    );

    for (const corr of relevantCorrelations) {
      const otherAsset = corr.asset1 === primaryAsset ? corr.asset2 : corr.asset1;
      const otherData = this.marketData.get(otherAsset);

      if (!otherData) continue;

      // Calcula alinhamento
      const primaryData = this.marketData.get(primaryAsset);
      const primaryMove = primaryData?.changePercent || 0;
      const otherMove = otherData.changePercent;

      let alignment: 'ALIGNED' | 'DIVERGENT' | 'NEUTRAL' = 'NEUTRAL';

      if (corr.type === 'POSITIVE') {
        // Correlação positiva: ambos devem se mover na mesma direção
        if (Math.sign(primaryMove) === Math.sign(otherMove)) {
          alignment = 'ALIGNED';
        } else if (Math.abs(primaryMove) > 0.01 && Math.abs(otherMove) > 0.01) {
          alignment = 'DIVERGENT';
        }
      } else if (corr.type === 'NEGATIVE') {
        // Correlação negativa: devem se mover em direções opostas
        if (Math.sign(primaryMove) !== Math.sign(otherMove)) {
          alignment = 'ALIGNED';
        } else if (Math.abs(primaryMove) > 0.01 && Math.abs(otherMove) > 0.01) {
          alignment = 'DIVERGENT';
        }
      }

      correlatedAssets.push({
        symbol: otherAsset,
        correlation: corr.strength,
        currentMove: otherMove,
        alignment
      });
    }

    // Calcula sinal geral
    const alignedCount = correlatedAssets.filter(a => a.alignment === 'ALIGNED').length;
    const divergentCount = correlatedAssets.filter(a => a.alignment === 'DIVERGENT').length;
    const total = correlatedAssets.length;

    let overallSignal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    let confidence = 0;
    let warning: string | undefined;

    if (total > 0) {
      const alignmentScore = (alignedCount - divergentCount) / total;
      confidence = Math.abs(alignmentScore);

      const primaryData = this.marketData.get(primaryAsset);
      const primaryMove = primaryData?.changePercent || 0;

      if (alignmentScore > 0.3) {
        overallSignal = primaryMove > 0 ? 'BULLISH' : 'BEARISH';
      } else if (alignmentScore < -0.3) {
        overallSignal = primaryMove > 0 ? 'BEARISH' : 'BULLISH';
        warning = 'DIVERGÊNCIA: Correlações não confirmam movimento';
      }
    }

    return {
      primaryAsset,
      correlatedAssets,
      overallSignal,
      confidence,
      warning
    };
  }

  /**
   * Verifica se pode operar ativo brasileiro
   */
  async checkBrazilianAsset(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
  }): Promise<{
    approved: boolean;
    warnings: string[];
    macroFactors: string[];
  }> {
    const warnings: string[] = [];
    const macroFactors: string[] = [];

    // 1. Dólar
    const dolar = this.marketData.get('DOLAR');
    if (dolar && dolar.changePercent > 1) {
      macroFactors.push(`Dólar em alta forte: +${dolar.changePercent.toFixed(2)}%`);
      if (params.side === 'BUY') {
        warnings.push('⚠️ Dólar em alta significativa - cuidado com ações brasileiras');
      }
    }

    // 2. S&P 500
    const sp500 = this.marketData.get('SP500');
    if (sp500 && sp500.changePercent < -1) {
      macroFactors.push(`S&P 500 em queda: ${sp500.changePercent.toFixed(2)}%`);
      if (params.side === 'BUY') {
        warnings.push('⚠️ S&P 500 em queda - confirmar tese antes de comprar');
      }
    }

    // 3. VIX
    const vix = this.marketData.get('VIX');
    if (vix && vix.price > 25) {
      macroFactors.push(`VIX elevado: ${vix.price.toFixed(1)}`);
      warnings.push('⚠️ VIX > 25 - mercado com medo, reduzir exposição');
    }

    // 4. SELIC
    const selic = this.marketData.get('SELIC');
    if (selic && selic.changePercent > 0) {
      macroFactors.push(`SELIC subindo: tendência negativa para ações`);
    }

    // 5. Correlação cruzada
    const crossSignal = this.analyzeCrossMarket('IBOVESPA');
    if (crossSignal.warning) {
      warnings.push(crossSignal.warning);
    }

    return {
      approved: warnings.filter(w => w.includes('⚠️')).length < 2,
      warnings,
      macroFactors
    };
  }

  /**
   * Verifica se pode operar commodity
   */
  async checkCommodity(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
  }): Promise<{
    approved: boolean;
    warnings: string[];
  }> {
    const warnings: string[] = [];

    const dolar = this.marketData.get('DOLAR');
    if (dolar && dolar.changePercent > 0.5 && params.side === 'BUY') {
      warnings.push('Dólar em alta = commodities pressionadas');
    }

    const dollarIndex = this.marketData.get('DOLLAR_INDEX');
    if (dollarIndex && dollarIndex.changePercent > 0.3 && params.side === 'BUY') {
      warnings.push('DXY forte = commodities em desvantagem');
    }

    return {
      approved: warnings.length === 0,
      warnings
    };
  }

  /**
   * Obtém correlação entre dois ativos
   */
  getCorrelation(asset1: string, asset2: string): Correlation | undefined {
    return this.CORRELATIONS.find(
      c => (c.asset1 === asset1 && c.asset2 === asset2) ||
           (c.asset1 === asset2 && c.asset2 === asset1)
    );
  }

  /**
   * Lista todas as correlações
   */
  getAllCorrelations(): Correlation[] {
    return this.CORRELATIONS;
  }

  /**
   * Salva análise no banco
   */
  async saveAnalysis(signal: CrossMarketSignal): Promise<void> {
    try {
      await oracleDB.insert(`
        INSERT INTO intermarket_analysis (
          id, primary_asset, signal, confidence, correlated_json, timestamp
        ) VALUES (
          :id, :primary, :signal, :confidence, :correlated, CURRENT_TIMESTAMP
        )
      `, {
        id: oracleDB.generateId(),
        primary: signal.primaryAsset,
        signal: signal.overallSignal,
        confidence: signal.confidence,
        correlated: JSON.stringify(signal.correlatedAssets)
      });
    } catch {}
  }

  /**
   * Notifica divergência crítica
   */
  async notifyDivergence(signal: CrossMarketSignal): Promise<void> {
    if (!signal.warning) return;

    await telegramNotifier.sendMessage(
      `🌍 <b>INTERMARKET ALERT</b>\n\n` +
      `📊 Ativo: ${signal.primaryAsset}\n` +
      `⚠️ ${signal.warning}\n\n` +
      `🔗 Correlações:\n${signal.correlatedAssets
        .filter(a => a.alignment === 'DIVERGENT')
        .map(a => `• ${a.symbol}: ${a.currentMove > 0 ? '+' : ''}${a.currentMove.toFixed(2)}%`)
        .join('\n')}\n\n` +
      `⚡ VEXOR Macro Agent`
    );
  }
}

// Singleton
export const intermarketAnalysis = new IntermarketAnalysis();
export type { Correlation, MarketData, CrossMarketSignal };
