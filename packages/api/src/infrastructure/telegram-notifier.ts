/**
 * Telegram Notifier
 * Sends trade notifications to users via Telegram Bot
 */

import { oracleDB, OracleTradeRepository } from './oracle-db.js';

interface TelegramConfig {
  botToken: string;
  chatId: string;
}

interface TradeNotification {
  symbol: string;
  side: 'BUY' | 'SELL' | 'HOLD';
  entryPrice?: number;
  exitPrice?: number;
  pnl?: number;
  pnlPercent?: number;
  agents?: string[];
  confidence?: number;
  timestamp: Date;
}

class TelegramNotifier {
  private config: TelegramConfig | null = null;
  private enabled: boolean = false;
  private initialized: boolean = false;

  constructor() {
    // Don't load config in constructor - will be loaded lazily
  }

  private ensureConfig() {
    if (this.initialized) return;
    this.initialized = true;
    this.loadConfig();
  }

  private loadConfig() {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (botToken && chatId) {
      this.config = { botToken, chatId };
      this.enabled = true;
      console.log('✅ Telegram notifier configured');
    } else {
      console.log('⚠️ Telegram not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID');
    }
  }

  getStatus(): { enabled: boolean; configured: boolean; chatId?: string } {
    this.ensureConfig();
    return {
      enabled: this.enabled,
      configured: this.config !== null,
      chatId: this.config?.chatId ? `${this.config.chatId.slice(0, 6)}...` : undefined
    };
  }

  async sendMessage(text: string): Promise<boolean> {
    this.ensureConfig();
    if (!this.config || !this.enabled) {
      return false;
    }

    try {
      const url = `https://api.telegram.org/bot${this.config.botToken}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.config.chatId,
          text: text,
          parse_mode: 'HTML',
          disable_notification: false,
        }),
      });

      const data = await response.json() as { ok?: boolean };
      if (!data.ok) {
        console.error('Telegram API error:', data);
        return false;
      }

      console.log('✅ Telegram message sent successfully');
      return true;
    } catch (error) {
      console.error('Failed to send Telegram message:', error);
      return false;
    }
  }

  /**
   * Send message to a specific Telegram user (chatId)
   * Note: User must have started a conversation with the bot first
   */
  async sendToUser(chatId: string, text: string): Promise<boolean> {
    this.ensureConfig();
    if (!this.config || !this.enabled) {
      console.log('⚠️ Telegram not configured, skipping user message');
      return false;
    }

    try {
      const url = `https://api.telegram.org/bot${this.config.botToken}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: 'HTML',
          disable_notification: false,
        }),
      });

      const data = await response.json() as { ok?: boolean; description?: string };
      if (!data.ok) {
        console.error('Telegram API error for user:', chatId, data.description);
        return false;
      }

      console.log(`✅ Telegram message sent to user ${chatId}`);
      return true;
    } catch (error) {
      console.error('Failed to send Telegram message to user:', error);
      return false;
    }
  }

  /**
   * Send message and return message_id for later editing
   */
  async sendToUserWithId(chatId: string, text: string): Promise<number | null> {
    this.ensureConfig();
    if (!this.config || !this.enabled) {
      return null;
    }

    try {
      const url = `https://api.telegram.org/bot${this.config.botToken}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: 'HTML',
        }),
      });

      const data = await response.json() as { ok?: boolean; result?: { message_id: number }; description?: string };
      if (!data.ok) {
        console.error('Telegram API error for user:', chatId, data.description);
        return null;
      }

      return data.result?.message_id || null;
    } catch (error) {
      console.error('Failed to send Telegram message to user:', error);
      return null;
    }
  }

  /**
   * Edit an existing message
   */
  async editMessage(chatId: string, messageId: number, text: string): Promise<boolean> {
    this.ensureConfig();
    if (!this.config || !this.enabled) {
      return false;
    }

    try {
      const url = `https://api.telegram.org/bot${this.config.botToken}/editMessageText`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          text: text,
          parse_mode: 'HTML',
        }),
      });

      const data = await response.json() as { ok?: boolean; description?: string };
      if (!data.ok) {
        console.error('Telegram API error editing message:', data.description);
        return false;
      }

      console.log(`✅ Telegram message edited for user ${chatId}`);
      return true;
    } catch (error) {
      console.error('Failed to edit Telegram message:', error);
      return false;
    }
  }

  /**
   * Send message to admin chat (configured via env)
   */
  async sendToAdmin(text: string): Promise<boolean> {
    return this.sendMessage(text);
  }

  async notifyTrade(notification: TradeNotification): Promise<boolean> {
    const emoji = notification.side === 'BUY' ? '🟢' : '🔴';
    const action = notification.side === 'BUY' ? 'COMPRA' : 'VENDA';

    let message = `<b>${emoji} VEXOR IA - ${action}</b>\n\n`;
    message += `<b>Ativo:</b> ${notification.symbol}\n`;

    if (notification.entryPrice) {
      message += `<b>Entrada:</b> R$ ${notification.entryPrice.toFixed(2)}\n`;
    }

    if (notification.exitPrice) {
      message += `<b>Saída:</b> R$ ${notification.exitPrice.toFixed(2)}\n`;
    }

    if (notification.pnl !== undefined) {
      const pnlEmoji = notification.pnl >= 0 ? '📈' : '📉';
      const pnlSign = notification.pnl >= 0 ? '+' : '';
      message += `<b>PnL:</b> ${pnlEmoji} R$ ${pnlSign}${notification.pnl.toFixed(2)}`;
      if (notification.pnlPercent) {
        message += ` (${pnlSign}${notification.pnlPercent.toFixed(2)}%)`;
      }
      message += '\n';
    }

    if (notification.agents && notification.agents.length > 0) {
      message += `<b>Agentes:</b> ${notification.agents.join(', ')}\n`;
    }

    if (notification.confidence) {
      message += `<b>Confiança:</b> ${notification.confidence.toFixed(0)}%\n`;
    }

    message += `\n⏰ ${notification.timestamp.toLocaleString('pt-BR')}`;
    message += `\n\n<i>VEXOR Trading System</i>`;

    return this.sendMessage(message);
  }

  async notifyBehaviorAlert(data: {
    pattern: string;
    severity: number;
    description: string;
    recommendation: string;
  }): Promise<boolean> {
    const severityEmoji = data.severity >= 3 ? '🚨' : data.severity >= 2 ? '⚠️' : 'ℹ️';

    let message = `<b>${severityEmoji} ALERTA COMPORTAMENTAL</b>\n\n`;
    message += `<b>Padrão:</b> ${data.pattern}\n`;
    message += `<b>Severidade:</b> ${'🔴'.repeat(data.severity)}${'⚪'.repeat(3 - data.severity)}\n`;
    message += `<b>Descrição:</b> ${data.description}\n`;
    message += `<b>Recomendação:</b> ${data.recommendation}\n`;

    return this.sendMessage(message);
  }

  async notifyDailySummary(data: {
    totalTrades: number;
    winRate: number;
    totalPnl: number;
    bestTrade?: { symbol: string; pnl: number };
    worstTrade?: { symbol: string; pnl: number };
  }): Promise<boolean> {
    const pnlEmoji = data.totalPnl >= 0 ? '📈' : '📉';
    const pnlSign = data.totalPnl >= 0 ? '+' : '';

    let message = `<b>📊 RESUMO DIÁRIO</b>\n\n`;
    message += `<b>Trades:</b> ${data.totalTrades}\n`;
    message += `<b>Win Rate:</b> ${data.winRate.toFixed(1)}%\n`;
    message += `<b>PnL Total:</b> ${pnlEmoji} R$ ${pnlSign}${data.totalPnl.toFixed(2)}\n`;

    if (data.bestTrade) {
      message += `<b>Melhor:</b> ${data.bestTrade.symbol} (+R$ ${data.bestTrade.pnl.toFixed(2)})\n`;
    }

    if (data.worstTrade) {
      message += `<b>Pior:</b> ${data.worstTrade.symbol} (-R$ ${Math.abs(data.worstTrade.pnl).toFixed(2)})\n`;
    }

    message += `\n<i>VEXOR Trading System</i>`;

    return this.sendMessage(message);
  }

  enable() {
    this.enabled = true;
  }

  disable() {
    this.enabled = false;
  }

  isEnabled(): boolean {
    this.ensureConfig();
    return this.enabled && this.config !== null;
  }

  updateConfig(botToken: string, chatId: string) {
    this.config = { botToken, chatId };
    this.enabled = true;
  }
}

export const telegramNotifier = new TelegramNotifier();

// API endpoint helper
export async function sendTelegramNotification(notification: TradeNotification): Promise<{ success: boolean }> {
  const success = await telegramNotifier.notifyTrade(notification);
  return { success };
}

export async function sendBehaviorAlert(data: {
  pattern: string;
  severity: number;
  description: string;
  recommendation: string;
}): Promise<{ success: boolean }> {
  const success = await telegramNotifier.notifyBehaviorAlert(data);
  return { success };
}
