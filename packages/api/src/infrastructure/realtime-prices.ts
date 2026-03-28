/**
 * Realtime Prices Service
 * Consome dados reais do UDP Bridge (Genial + Pepperstone)
 * Porta UDP: 10209
 */

import dgram from 'dgram';
import { telegramNotifier } from './telegram-notifier.js';
import { signalTracker } from './nexus-core/signal-tracker.js';

interface Tick {
  symbol: string;
  bid: number;
  ask: number;
  exchange: string;
  broker: string;
  timestamp: number;
}

interface PriceData {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  exchange: string;
  broker: string;
  lastUpdate: Date;
  dayHigh: number;
  dayLow: number;
  volume: number;
}

interface TradeOpportunity {
  symbol: string;
  action: 'BUY' | 'SELL';
  entry: number;
  stop: number;
  target: number;
  strategy: string;
  confidence: number;
  positionSize: number;
  reason: string;
  broker: string;
  timestamp: Date;
}

class RealtimePricesService {
  private prices: Map<string, PriceData> = new Map();
  private udpSocket: dgram.Socket | null = null;
  private opportunities: Map<string, TradeOpportunity> = new Map();
  private lastNotification: Map<string, Date> = new Map();
  private analysisInterval: NodeJS.Timeout | null = null;
  
  // Configurações
  private readonly UDP_PORT = 10210; // Porta diferente do bridge (10209)
  private readonly UDP_HOST = '127.0.0.1';
  private readonly MIN_NOTIFICATION_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos entre notificações do mesmo ativo

  constructor() {
    this.startUDPListener();
    this.startAnalysisLoop();
  }

  private startUDPListener() {
    try {
      this.udpSocket = dgram.createSocket('udp4');
      
      this.udpSocket.on('message', (buffer: Buffer) => {
        try {
          const data = JSON.parse(buffer.toString());
          this.processIncomingData(data);
        } catch (e) {
          // Ignora pacotes inválidos
        }
      });

      this.udpSocket.on('error', (err) => {
        console.error('[RealtimePrices] UDP error:', err);
      });

      this.udpSocket.bind(this.UDP_PORT, () => {
        console.log(`[RealtimePrices] 📡 Escutando UDP ${this.UDP_HOST}:${this.UDP_PORT}`);
      });
    } catch (e) {
      console.error('[RealtimePrices] Falha ao iniciar UDP:', e);
    }
  }

  private processIncomingData(data: any) {
    if (data.type === 'deltas' && Array.isArray(data.items)) {
      for (const item of data.items) {
        this.updatePrice(item);
      }
    } else if (data.s) {
      // Tick único
      this.updatePrice(data);
    }
  }

  private updatePrice(tick: any) {
    const symbol = tick.s || tick.symbol;
    if (!symbol) return;

    const bid = Number(tick.b || tick.bid || 0);
    const ask = Number(tick.a || tick.ask || 0);
    
    if (bid <= 0 || ask <= 0) return;

    const existing = this.prices.get(symbol);
    const mid = (bid + ask) / 2;
    const spread = ((ask - bid) / mid) * 100;

    const priceData: PriceData = {
      symbol,
      bid,
      ask,
      mid,
      spread,
      exchange: tick.e || tick.exchange || 'UNKNOWN',
      broker: tick.br || tick.broker || 'unknown',
      lastUpdate: new Date(),
      dayHigh: existing ? Math.max(existing.dayHigh, ask) : ask,
      dayLow: existing ? Math.min(existing.dayLow, bid) : bid,
      volume: existing?.volume || 0,
    };

    this.prices.set(symbol, priceData);

    // 🎯 ATUALIZA SIGNAL TRACKER COM PREÇO ATUAL
    signalTracker.updatePrice(symbol, mid);
  }

  private startAnalysisLoop() {
    // Analisa oportunidades a cada 30 segundos
    this.analysisInterval = setInterval(() => {
      this.analyzeOpportunities();
    }, 30000);
  }

  private analyzeOpportunities() {
    for (const [symbol, price] of this.prices) {
      // Ignora se não tem dados recentes (últimos 60 segundos)
      const ageMs = Date.now() - price.lastUpdate.getTime();
      if (ageMs > 60000) continue;

      const opportunity = this.detectOpportunity(symbol, price);
      
      if (opportunity) {
        const existing = this.opportunities.get(symbol);
        
        // Só notifica se é nova oportunidade ou mudou de direção
        if (!existing || existing.action !== opportunity.action) {
          this.opportunities.set(symbol, opportunity);
          this.notifyOpportunity(opportunity);
        }
      }
    }
  }

  private detectOpportunity(symbol: string, price: PriceData): TradeOpportunity | null {
    // Estratégias baseadas em dados REAIS
    const range = price.dayHigh - price.dayLow;
    const rangePercent = (range / price.mid) * 100;
    const positionInRange = (price.mid - price.dayLow) / range;

    let action: 'BUY' | 'SELL' | null = null;
    let strategy = '';
    let reason = '';
    let confidence = 0;
    let positionSize = 30;

    // Estratégia 1: Rompimento de máxima do dia
    if (price.bid >= price.dayHigh * 0.998 && rangePercent > 1) {
      action = 'BUY';
      strategy = 'BREAKOUT';
      reason = 'Rompendo máxima do dia com volume';
      confidence = 75;
      positionSize = 35;
    }
    // Estratégia 2: Bounce na mínima
    else if (price.ask <= price.dayLow * 1.002 && positionInRange < 0.2) {
      action = 'BUY';
      strategy = 'PULLBACK';
      reason = 'Testando suporte (mínima do dia)';
      confidence = 70;
      positionSize = 40;
    }
    // Estratégia 3: Rejeição na máxima
    else if (price.bid >= price.dayHigh * 0.995 && positionInRange > 0.95) {
      action = 'SELL';
      strategy = 'REVERSAL';
      reason = 'Rejeição na resistência (máxima do dia)';
      confidence = 68;
      positionSize = 25;
    }
    // Estratégia 4: Quebra de suporte
    else if (price.ask < price.dayLow * 0.998) {
      action = 'SELL';
      strategy = 'BREAKDOWN';
      reason = 'Quebrou suporte (mínima do dia)';
      confidence = 72;
      positionSize = 30;
    }
    // Estratégia 5: Spread apertado = alta liquidez
    else if (price.spread < 0.05 && rangePercent > 0.5) {
      // Verifica tendência
      if (positionInRange > 0.6) {
        action = 'BUY';
        strategy = 'MOMENTUM';
        reason = 'Spread apertado, tendência de alta';
        confidence = 65;
        positionSize = 30;
      }
    }

    if (!action) return null;

    // Calcula stop e target com MÍNIMO de distância
    const minStopPercent = 0.005; // 0.5% mínimo
    const minTargetPercent = 0.01; // 1% mínimo
    
    let stopDistance = Math.max(range * 0.3, price.mid * minStopPercent);
    let targetDistance = Math.max(range * 0.6, price.mid * minTargetPercent);

    const entry = action === 'BUY' ? price.ask : price.bid;
    const stop = action === 'BUY' 
      ? Math.round((entry - stopDistance) * 10000) / 10000
      : Math.round((entry + stopDistance) * 10000) / 10000;
    const target = action === 'BUY'
      ? Math.round((entry + targetDistance) * 10000) / 10000
      : Math.round((entry - targetDistance) * 10000) / 10000;

    // Ajusta confiança baseado no spread
    if (price.spread > 0.5) {
      confidence = Math.max(50, confidence - 10);
    }

    return {
      symbol,
      action,
      entry: Math.round(entry * 100) / 100,
      stop: Math.round(stop * 100) / 100,
      target: Math.round(target * 100) / 100,
      strategy,
      confidence,
      positionSize,
      reason,
      broker: price.broker,
      timestamp: new Date(),
    };
  }

  private async notifyOpportunity(opp: TradeOpportunity) {
    // Verifica intervalo mínimo entre notificações
    const lastNotif = this.lastNotification.get(opp.symbol);
    if (lastNotif) {
      const elapsed = Date.now() - lastNotif.getTime();
      if (elapsed < this.MIN_NOTIFICATION_INTERVAL_MS) {
        return;
      }
    }

    this.lastNotification.set(opp.symbol, new Date());

    // 🎯 REGISTRA SINAL NO TRACKER PARA MONITORAR WIN/LOSS
    // (Signal Tracker vai notificar Telegram separadamente)
    try {
      await signalTracker.registerSignal({
        symbol: opp.symbol,
        side: opp.action,
        entry: opp.entry,
        stop: opp.stop,
        target: opp.target,
        quantity: Math.round(opp.positionSize),
        strategy: opp.strategy,
        confidence: opp.confidence
      });
      console.log(`[RealtimePrices] 📊 Sinal registrado no Tracker: ${opp.symbol} ${opp.action}`);
    } catch (e) {
      console.error('[RealtimePrices] Erro ao registrar sinal:', e);
    }
    
    // NOTA: Signal Tracker já envia notificação Telegram, então não duplicamos aqui
    return;

    const emoji = opp.action === 'BUY' ? '🟢' : '🔴';
    const actionText = opp.action === 'BUY' ? 'COMPRA' : 'VENDA';

    const price = this.prices.get(opp.symbol);
    const priceInfo = price 
      ? `\n📊 <b>Preço atual:</b> Bid ${price.bid.toFixed(2)} | Ask ${price.ask.toFixed(2)}`
      : '';

    const message = 
      `${emoji} <b>OPORTUNIDADE REAL DE ${actionText}</b>\n\n` +
      `📊 <b>Ativo:</b> ${opp.symbol}${priceInfo}\n` +
      `🏦 <b>Broker:</b> ${opp.broker.toUpperCase()}\n` +
      `📈 <b>Exchange:</b> ${price?.exchange || 'N/A'}\n\n` +
      `💰 <b>Entrada:</b> R$ ${opp.entry.toFixed(2)}\n` +
      `🛑 <b>Stop:</b> R$ ${opp.stop.toFixed(2)}\n` +
      `🎯 <b>Alvo:</b> R$ ${opp.target.toFixed(2)}\n\n` +
      `📐 <b>Estratégia:</b> ${opp.strategy}\n` +
      `📝 <b>${opp.reason}</b>\n\n` +
      `💵 <b>Posição sugerida:</b> ${opp.positionSize}% do capital\n` +
      `📊 <b>Confiança:</b> ${opp.confidence}%\n\n` +
      `⏰ ${opp.timestamp.toLocaleString('pt-BR')}\n\n` +
      `<i>⚠️ Dados em tempo real via UDP. Gerencie seu risco!</i>\n\n` +
      `⚡ <b>VEXOR IA - Dados Reais</b>`;

    await telegramNotifier.sendMessage(message);
  }

  // API pública
  getPrice(symbol: string): PriceData | undefined {
    return this.prices.get(symbol);
  }

  getAllPrices(): PriceData[] {
    return Array.from(this.prices.values());
  }

  getOpportunity(symbol: string): TradeOpportunity | undefined {
    return this.opportunities.get(symbol);
  }

  getAllOpportunities(): TradeOpportunity[] {
    return Array.from(this.opportunities.values());
  }

  // Força análise manual
  async forceAnalysis(symbols?: string[]): Promise<TradeOpportunity[]> {
    const toAnalyze = symbols || Array.from(this.prices.keys());
    const found: TradeOpportunity[] = [];

    for (const symbol of toAnalyze) {
      const price = this.prices.get(symbol);
      if (!price) continue;

      const opp = this.detectOpportunity(symbol, price);
      if (opp) {
        this.opportunities.set(symbol, opp);
        found.push(opp);
        await this.notifyOpportunity(opp);
      }
    }

    return found;
  }

  // Cleanup
  destroy() {
    if (this.udpSocket) {
      this.udpSocket.close();
    }
    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
    }
  }
}

// Singleton
export const realtimePricesService = new RealtimePricesService();
export type { Tick, PriceData, TradeOpportunity };
