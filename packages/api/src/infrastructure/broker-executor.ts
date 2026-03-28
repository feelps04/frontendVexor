/**
 * Broker Executor Service
 * Integração com Home Broker Genial e Pepperstone via MT5
 * Executa ordens e gerencia posições
 */

import { spawn } from 'child_process';
import { tradeMonitorService } from './trade-monitor.js';
import { telegramNotifier } from './telegram-notifier.js';

interface BrokerConfig {
  name: string;
  type: 'genial' | 'pepperstone';
  mt5Path: string;
  account?: number;
  server?: string;
  connected: boolean;
}

interface OrderRequest {
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  orderType: 'MARKET' | 'LIMIT' | 'STOP';
  price?: number;
  stopLoss?: number;
  takeProfit?: number;
  comment?: string;
}

interface OrderResult {
  success: boolean;
  orderId?: string;
  executedPrice?: number;
  executedQuantity?: number;
  error?: string;
  timestamp: Date;
}

class BrokerExecutorService {
  private brokers: Map<string, BrokerConfig> = new Map();

  constructor() {
    this.initializeBrokers();
  }

  private initializeBrokers(): void {
    this.brokers.set('genial', {
      name: 'Genial Investimentos',
      type: 'genial',
      mt5Path: process.env.GENIAL_MT5_PATH || 'C:\\Program Files\\MetaTrader 5\\terminal64.exe',
      connected: false
    });

    this.brokers.set('pepperstone', {
      name: 'Pepperstone',
      type: 'pepperstone',
      mt5Path: process.env.PEPPERSTONE_MT5_PATH || 'C:\\Program Files\\Pepperstone MetaTrader 5\\terminal64.exe',
      connected: false
    });

    console.log('[BrokerExecutor] Brokers configurados: Genial, Pepperstone');
  }

  /**
   * Executa comando Python
   */
  private executePython(code: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('python', ['-c', code], { windowsHide: true });
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code === 0) resolve(stdout.trim());
        else reject(new Error(stderr || `Python exit ${code}`));
      });

      proc.on('error', reject);

      setTimeout(() => { proc.kill(); reject(new Error('Timeout')); }, 30000);
    });
  }

  /**
   * Conecta ao broker via MT5 Python
   */
  async connect(brokerName: string): Promise<boolean> {
    const broker = this.brokers.get(brokerName);
    if (!broker) return false;

    try {
      const code = `import MetaTrader5 as mt5
if mt5.initialize(path=r"${broker.mt5Path}"):
    info = mt5.account_info()
    if info:
        print(f"CONNECTED|{info.login}|{info.server}|{info.balance}")
    mt5.shutdown()
else:
    print("CONNECTION_FAILED")`;

      const result = await this.executePython(code);

      if (result.includes('CONNECTED')) {
        const parts = result.split('|');
        broker.account = parseInt(parts[1]);
        broker.server = parts[2];
        broker.connected = true;
        console.log(`[BrokerExecutor] Conectado: ${broker.name} (${broker.account})`);
        return true;
      }
      return false;
    } catch (e) {
      console.error(`[BrokerExecutor] Erro ao conectar ${brokerName}:`, e);
      return false;
    }
  }

  /**
   * Executa ordem no broker
   */
  async executeOrder(brokerName: string, order: OrderRequest): Promise<OrderResult> {
    const broker = this.brokers.get(brokerName);
    if (!broker || !broker.connected) {
      return { success: false, error: 'Broker nao conectado', timestamp: new Date() };
    }

    try {
      const action = order.side === 'BUY' ? 'mt5.ORDER_TYPE_BUY' : 'mt5.ORDER_TYPE_SELL';
      const priceExpr = order.price 
        ? String(order.price) 
        : (order.side === 'BUY' ? 'mt5.symbol_info_tick(symbol).ask' : 'mt5.symbol_info_tick(symbol).bid');

      const code = `import MetaTrader5 as mt5
import json

mt5.initialize(path=r"${broker.mt5Path}")

symbol = "${order.symbol}"
symbol_info = mt5.symbol_info(symbol)
if symbol_info is None:
    print(json.dumps({"success": False, "error": "Symbol not found"}))
    mt5.shutdown()
    exit()

if not symbol_info.visible:
    mt5.symbol_select(symbol, True)

request = {
    "action": mt5.TRADE_ACTION_DEAL,
    "symbol": symbol,
    "volume": ${order.quantity},
    "type": ${action},
    "type_filling": mt5.ORDER_FILLING_IOC,
    "price": ${priceExpr},
    "deviation": 20,
    "magic": 123456,
    "comment": "${order.comment || 'VEXOR IA'}",
    "type_time": mt5.ORDER_TIME_GTC,
}

${order.stopLoss ? `request["sl"] = ${order.stopLoss}` : ''}
${order.takeProfit ? `request["tp"] = ${order.takeProfit}` : ''}

result = mt5.order_send(request)

if result.retcode == mt5.TRADE_RETCODE_DONE:
    print(json.dumps({
        "success": True,
        "orderId": str(result.order),
        "executedPrice": result.price,
        "executedQuantity": result.volume
    }))
else:
    print(json.dumps({"success": False, "error": result.comment}))

mt5.shutdown()`;

      const output = await this.executePython(code);
      const result = JSON.parse(output);
      return { ...result, timestamp: new Date() };
    } catch (e) {
      return { success: false, error: String(e), timestamp: new Date() };
    }
  }

  /**
   * Fecha posicao
   */
  async closePosition(brokerName: string, symbol: string, quantity?: number): Promise<OrderResult> {
    const broker = this.brokers.get(brokerName);
    if (!broker || !broker.connected) {
      return { success: false, error: 'Broker nao conectado', timestamp: new Date() };
    }

    try {
      const code = `import MetaTrader5 as mt5
import json

mt5.initialize(path=r"${broker.mt5Path}")

symbol = "${symbol}"
positions = mt5.positions_get(symbol=symbol)

if positions is None or len(positions) == 0:
    print(json.dumps({"success": False, "error": "No position found"}))
    mt5.shutdown()
    exit()

position = positions[0]
close_volume = ${quantity || 'position.volume'}

request = {
    "action": mt5.TRADE_ACTION_DEAL,
    "symbol": symbol,
    "volume": close_volume,
    "type": mt5.ORDER_TYPE_SELL if position.type == mt5.ORDER_TYPE_BUY else mt5.ORDER_TYPE_BUY,
    "position": position.ticket,
    "price": mt5.symbol_info_tick(symbol).bid if position.type == mt5.ORDER_TYPE_BUY else mt5.symbol_info_tick(symbol).ask,
    "deviation": 20,
    "magic": 123456,
    "comment": "VEXOR Close",
    "type_time": mt5.ORDER_TIME_GTC,
    "type_filling": mt5.ORDER_FILLING_IOC,
}

result = mt5.order_send(request)

if result.retcode == mt5.TRADE_RETCODE_DONE:
    print(json.dumps({"success": True, "executedPrice": result.price, "executedQuantity": result.volume}))
else:
    print(json.dumps({"success": False, "error": result.comment}))

mt5.shutdown()`;

      const output = await this.executePython(code);
      const result = JSON.parse(output);
      return { ...result, timestamp: new Date() };
    } catch (e) {
      return { success: false, error: String(e), timestamp: new Date() };
    }
  }

  /**
   * Obtem posicoes abertas
   */
  async getPositions(brokerName: string): Promise<Array<{
    ticket: number;
    symbol: string;
    type: 'BUY' | 'SELL';
    volume: number;
    openPrice: number;
    currentPrice: number;
    sl: number;
    tp: number;
    pnl: number;
  }>> {
    const broker = this.brokers.get(brokerName);
    if (!broker || !broker.connected) return [];

    try {
      const code = `import MetaTrader5 as mt5
import json

mt5.initialize(path=r"${broker.mt5Path}")

positions = mt5.positions_get()
result = []

if positions:
    for p in positions:
        tick = mt5.symbol_info_tick(p.symbol)
        current = tick.bid if p.type == mt5.ORDER_TYPE_BUY else tick.ask
        pnl = (current - p.price_open) * p.volume * 100 if p.type == mt5.ORDER_TYPE_BUY else (p.price_open - current) * p.volume * 100
        result.append({
            "ticket": p.ticket,
            "symbol": p.symbol,
            "type": "BUY" if p.type == mt5.ORDER_TYPE_BUY else "SELL",
            "volume": p.volume,
            "openPrice": p.price_open,
            "currentPrice": current,
            "sl": p.sl,
            "tp": p.tp,
            "pnl": pnl
        })

print(json.dumps(result))
mt5.shutdown()`;

      const output = await this.executePython(code);
      return JSON.parse(output);
    } catch (e) {
      console.error('[BrokerExecutor] Erro ao obter posicoes:', e);
      return [];
    }
  }

  /**
   * Obtem saldo e equity
   */
  async getAccountInfo(brokerName: string): Promise<{
    balance: number;
    equity: number;
    margin: number;
    freeMargin: number;
    marginLevel: number;
  } | null> {
    const broker = this.brokers.get(brokerName);
    if (!broker || !broker.connected) return null;

    try {
      const code = `import MetaTrader5 as mt5
import json

mt5.initialize(path=r"${broker.mt5Path}")
info = mt5.account_info()

if info:
    print(json.dumps({
        "balance": info.balance,
        "equity": info.equity,
        "margin": info.margin,
        "freeMargin": info.margin_free,
        "marginLevel": info.margin_level
    }))
else:
    print(json.dumps(None))

mt5.shutdown()`;

      const output = await this.executePython(code);
      return JSON.parse(output);
    } catch (e) {
      console.error('[BrokerExecutor] Erro ao obter info:', e);
      return null;
    }
  }

  /**
   * Status dos brokers
   */
  getStatus(): Array<{ name: string; connected: boolean; account?: number; server?: string }> {
    return Array.from(this.brokers.values()).map(b => ({
      name: b.name,
      connected: b.connected,
      account: b.account,
      server: b.server
    }));
  }

  /**
   * Executa ordem a partir de sinal da IA
   */
  async executeFromSignal(signal: {
    symbol: string;
    action: 'BUY' | 'SELL';
    entry: number;
    stop: number;
    target: number;
    quantity: number;
    strategy: string;
    agents: string[];
    confidence: number;
    broker: string;
    userId: string;
  }): Promise<{ success: boolean; positionId?: string; error?: string }> {
    const brokerName = signal.broker === 'genial' ? 'genial' : 'pepperstone';
    const broker = this.brokers.get(brokerName);

    if (!broker?.connected) {
      const connected = await this.connect(brokerName);
      if (!connected) {
        return { success: false, error: `Broker ${brokerName} nao disponivel` };
      }
    }

    const result = await this.executeOrder(brokerName, {
      symbol: signal.symbol,
      side: signal.action,
      quantity: signal.quantity,
      orderType: 'MARKET',
      stopLoss: signal.stop,
      takeProfit: signal.target,
      comment: `VEXOR ${signal.strategy}`
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    const position = await tradeMonitorService.openPosition({
      userId: signal.userId,
      symbol: signal.symbol,
      side: signal.action,
      quantity: result.executedQuantity || signal.quantity,
      entryPrice: result.executedPrice || signal.entry,
      stopPrice: signal.stop,
      targetPrice: signal.target,
      strategy: signal.strategy,
      agents: signal.agents,
      confidence: signal.confidence,
      broker: brokerName
    });

    return { success: true, positionId: position.id };
  }

  /**
   * Desconecta
   */
  async disconnect(brokerName: string): Promise<void> {
    const broker = this.brokers.get(brokerName);
    if (broker) {
      broker.connected = false;
      console.log(`[BrokerExecutor] Desconectado: ${broker.name}`);
    }
  }
}

export const brokerExecutorService = new BrokerExecutorService();
export type { OrderRequest, OrderResult, BrokerConfig };
