/**
 * VEXOR Telegram Trading Bot
 * 
 * Bot para:
 * - Entrar em grupos de trading
 * - Coletar sentiment de traders
 * - Detectar sinais compartilhados
 * - Noticiar movimentos de mercado
 */

import { telegramNotifier } from '../telegram-notifier.js';

// ==================== TYPES ====================

interface TradingGroup {
  id: string;
  name: string;
  type: 'signal' | 'discussion' | 'news' | 'whale';
  active: boolean;
  joinedAt: Date;
  messageCount: number;
}

interface GroupMessage {
  id: string;
  groupId: string;
  userId: string;
  username: string;
  text: string;
  timestamp: Date;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  hasSignal: boolean;
  signal?: {
    symbol: string;
    direction: 'BUY' | 'SELL';
    entry?: number;
    stop?: number;
    target?: number;
  };
}

interface SentimentAnalysis {
  groupId: string;
  period: '1h' | '4h' | '24h';
  bullish: number;
  bearish: number;
  neutral: number;
  topSymbols: string[];
  signals: GroupMessage[];
}

// ==================== TELEGRAM TRADING BOT ====================

class TelegramTradingBot {
  private botToken = process.env.TELEGRAM_BOT_TOKEN || '';
  private groups: Map<string, TradingGroup> = new Map();
  private messages: GroupMessage[] = [];
  private readonly MAX_MESSAGES = 1000;

  // Palavras-chave para detectar sinais
  private readonly SIGNAL_KEYWORDS = {
    buy: ['compra', 'buy', 'long', 'call', 'entrada', 'entrar', 'alvo', 'target'],
    sell: ['venda', 'sell', 'short', 'put', 'saída', 'sair', 'stop'],
    symbols: ['btc', 'eth', 'bnb', 'petr', 'vale', 'wdo', 'dol', 'win', 'wsp']
  };

  /**
   * Inicializa o bot
   */
  async initialize(): Promise<boolean> {
    if (!this.botToken) {
      console.log('[TelegramBot] Token não configurado');
      return false;
    }

    console.log('[TelegramBot] 🤖 Bot inicializado');
    return true;
  }

  /**
   * Entra em um grupo de trading
   */
  async joinGroup(groupId: string, name: string, type: TradingGroup['type']): Promise<boolean> {
    try {
      // Em produção, usaria API do Telegram para entrar no grupo
      const group: TradingGroup = {
        id: groupId,
        name,
        type,
        active: true,
        joinedAt: new Date(),
        messageCount: 0
      };

      this.groups.set(groupId, group);
      
      console.log(`[TelegramBot] ✅ Entrou no grupo: ${name} (${type})`);
      
      // Notifica entrada
      await telegramNotifier.sendMessage(
        `🤖 <b>BOT ENTROU EM GRUPO</b>\n\n` +
        `Grupo: ${name}\n` +
        `Tipo: ${type}\n` +
        `ID: ${groupId}`
      );

      return true;
    } catch (e) {
      console.error('[TelegramBot] Erro ao entrar no grupo:', e);
      return false;
    }
  }

  /**
   * Sai de um grupo
   */
  async leaveGroup(groupId: string): Promise<void> {
    const group = this.groups.get(groupId);
    if (group) {
      group.active = false;
      console.log(`[TelegramBot] 👋 Saiu do grupo: ${group.name}`);
    }
  }

  /**
   * Processa mensagem recebida de um grupo
   */
  async processMessage(
    groupId: string,
    userId: string,
    username: string,
    text: string
  ): Promise<GroupMessage | null> {
    const group = this.groups.get(groupId);
    if (!group || !group.active) return null;

    // Detecta sentiment
    const sentiment = this.detectSentiment(text);
    
    // Detecta se é um sinal
    const signal = this.extractSignal(text);
    const hasSignal = signal !== null;

    const message: GroupMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      groupId,
      userId,
      username,
      text,
      timestamp: new Date(),
      sentiment,
      hasSignal,
      signal: signal || undefined
    };

    // Salva mensagem
    this.messages.push(message);
    group.messageCount++;

    // Mantém apenas últimas MAX_MESSAGES
    if (this.messages.length > this.MAX_MESSAGES) {
      this.messages = this.messages.slice(-this.MAX_MESSAGES);
    }

    // Se detectou sinal, notifica
    if (hasSignal && signal) {
      await this.notifySignal(message, signal);
    }

    return message;
  }

  /**
   * Detecta sentiment da mensagem
   */
  private detectSentiment(text: string): 'bullish' | 'bearish' | 'neutral' {
    const t = text.toLowerCase();
    
    let bullishScore = 0;
    let bearishScore = 0;

    // Palavras bullish
    if (t.includes('alta') || t.includes('subiu') || t.includes('rocket') || 
        t.includes('moon') || t.includes('comprar') || t.includes('bull')) {
      bullishScore += 2;
    }
    if (t.includes('👍') || t.includes('🚀') || t.includes('📈') || t.includes('💪')) {
      bullishScore += 1;
    }

    // Palavras bearish
    if (t.includes('baixa') || t.includes('caiu') || t.includes('dump') || 
        t.includes('vender') || t.includes('bear') || t.includes('crash')) {
      bearishScore += 2;
    }
    if (t.includes('👎') || t.includes('📉') || t.includes('💀') || t.includes('😱')) {
      bearishScore += 1;
    }

    if (bullishScore > bearishScore) return 'bullish';
    if (bearishScore > bullishScore) return 'bearish';
    return 'neutral';
  }

  /**
   * Extrai sinal da mensagem
   */
  private extractSignal(text: string): GroupMessage['signal'] | null {
    const t = text.toLowerCase();
    
    // Detecta direção
    let direction: 'BUY' | 'SELL' | null = null;
    
    for (const keyword of this.SIGNAL_KEYWORDS.buy) {
      if (t.includes(keyword)) {
        direction = 'BUY';
        break;
      }
    }
    
    if (!direction) {
      for (const keyword of this.SIGNAL_KEYWORDS.sell) {
        if (t.includes(keyword)) {
          direction = 'SELL';
          break;
        }
      }
    }

    if (!direction) return null;

    // Detecta símbolo
    let symbol = '';
    for (const sym of this.SIGNAL_KEYWORDS.symbols) {
      if (t.includes(sym)) {
        symbol = sym.toUpperCase();
        if (!symbol.includes('USDT') && (symbol === 'BTC' || symbol === 'ETH' || symbol === 'BNB')) {
          symbol += 'USDT';
        }
        break;
      }
    }

    if (!symbol) return null;

    // Extrai níveis (entrada, stop, target)
    const numbers = text.match(/(\d+\.?\d*)/g);
    
    return {
      symbol,
      direction,
      entry: numbers && numbers.length > 0 ? parseFloat(numbers[0]) : undefined,
      stop: numbers && numbers.length > 1 ? parseFloat(numbers[1]) : undefined,
      target: numbers && numbers.length > 2 ? parseFloat(numbers[2]) : undefined
    };
  }

  /**
   * Notifica sobre sinal detectado
   */
  private async notifySignal(message: GroupMessage, signal: NonNullable<GroupMessage['signal']>): Promise<void> {
    const group = this.groups.get(message.groupId);
    
    await telegramNotifier.sendMessage(
      `🚨 <b>SINAL DETECTADO</b>\n\n` +
      `Grupo: ${group?.name || 'Desconhecido'}\n` +
      `User: @${message.username}\n\n` +
      `📊 <b>${signal.symbol}</b>\n` +
      `Direção: ${signal.direction}\n` +
      `${signal.entry ? `Entrada: ${signal.entry}` : ''}\n` +
      `${signal.stop ? `Stop: ${signal.stop}` : ''}\n` +
      `${signal.target ? `Target: ${signal.target}` : ''}\n\n` +
      `💬 ${message.text.substring(0, 100)}`
    );
  }

  /**
   * Analisa sentiment de um grupo
   */
  analyzeSentiment(groupId: string, period: '1h' | '4h' | '24h' = '4h'): SentimentAnalysis {
    const now = Date.now();
    const periodMs = period === '1h' ? 3600000 : period === '4h' ? 14400000 : 86400000;
    
    const recentMessages = this.messages.filter(
      m => m.groupId === groupId && (now - m.timestamp.getTime()) < periodMs
    );

    const bullish = recentMessages.filter(m => m.sentiment === 'bullish').length;
    const bearish = recentMessages.filter(m => m.sentiment === 'bearish').length;
    const neutral = recentMessages.filter(m => m.sentiment === 'neutral').length;

    // Conta símbolos mais mencionados
    const symbolCounts: Record<string, number> = {};
    for (const msg of recentMessages) {
      if (msg.signal?.symbol) {
        symbolCounts[msg.signal.symbol] = (symbolCounts[msg.signal.symbol] || 0) + 1;
      }
    }

    const topSymbols = Object.entries(symbolCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([sym]) => sym);

    // Sinais do período
    const signals = recentMessages.filter(m => m.hasSignal);

    return {
      groupId,
      period,
      bullish,
      bearish,
      neutral,
      topSymbols,
      signals
    };
  }

  /**
   * Retorna todos os grupos
   */
  getGroups(): TradingGroup[] {
    return Array.from(this.groups.values());
  }

  /**
   * Retorna mensagens recentes
   */
  getRecentMessages(groupId?: string, limit: number = 50): GroupMessage[] {
    let msgs = this.messages;
    if (groupId) {
      msgs = msgs.filter(m => m.groupId === groupId);
    }
    return msgs.slice(-limit);
  }

  /**
   * Estatísticas do bot
   */
  getStats(): {
    groupsCount: number;
    activeGroups: number;
    messagesCount: number;
    signalsCount: number;
  } {
    return {
      groupsCount: this.groups.size,
      activeGroups: Array.from(this.groups.values()).filter(g => g.active).length,
      messagesCount: this.messages.length,
      signalsCount: this.messages.filter(m => m.hasSignal).length
    };
  }

  /**
   * Limpa mensagens antigas
   */
  clearOldMessages(): void {
    const oneDayAgo = Date.now() - 86400000;
    this.messages = this.messages.filter(m => m.timestamp.getTime() > oneDayAgo);
    console.log('[TelegramBot] Mensagens antigas limpas');
  }
}

// ==================== SINGLETON ====================

export const telegramTradingBot = new TelegramTradingBot();
export type { TradingGroup, GroupMessage, SentimentAnalysis };
