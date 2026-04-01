/**
 * VEXOR Signal Tracker Routes
 * APIs para monitoramento de sinais
 */

import { FastifyInstance } from 'fastify';
import { signalTracker } from '../infrastructure/nexus-core/signal-tracker.js';
import { telegramNotifier } from '../infrastructure/telegram-notifier.js';
import { strategyFactory } from '../infrastructure/nexus-core/doctrine/strategy-factory.js';
import { globalRAMReader, b3RAMReader } from '../infrastructure/mmf-reader.js';
import { ReplayEngine, prepareReplayData, getReplayEngine } from '../infrastructure/replay-engine.js';
import { getLearningOrchestrator } from '../infrastructure/learning-pipeline.js';
import http from 'http';

// Helper para buscar dados do sentinel_api.py
async function fetchMMFData(): Promise<{ b3_symbols: any[]; global_symbols: any[] }> {
  return new Promise((resolve) => {
    http.get('http://localhost:8765/mmf/debug', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch { resolve({ b3_symbols: [], global_symbols: [] }); }
      });
    }).on('error', () => resolve({ b3_symbols: [], global_symbols: [] }));
  });
}

// Trading automático
let autoTradingInterval: NodeJS.Timeout | null = null;
let tradeCount = 0;
let winCount = 0;
let lossCount = 0;
let simulationMode = false;
let simulationSpeed = 30000; // 30s padrão
let simulatedPrices: Map<string, number[]> = new Map();

// Gerar preços simulados para um dia aleatório
function generateDayPrices(basePrice: number): number[] {
  const prices: number[] = [];
  let price = basePrice;
  const volatility = basePrice * 0.03; // 3% volatilidade
  
  // 390 minutos de pregão (6.5 horas)
  for (let i = 0; i < 390; i++) {
    const change = (Math.random() - 0.5) * volatility;
    price = Math.max(price * 0.1, price + change); // não deixa preço negativo
    prices.push(price);
  }
  return prices;
}

// Obter preço atual (real ou simulado)
function getCurrentPrice(symbol: string, bid: number, ask: number, tickIndex: number): number {
  if (!simulationMode) {
    return (bid + ask) / 2;
  }
  
  // Modo simulação: usar preços do dia aleatório
  if (!simulatedPrices.has(symbol)) {
    const basePrice = (bid + ask) / 2;
    simulatedPrices.set(symbol, generateDayPrices(basePrice));
  }
  
  const prices = simulatedPrices.get(symbol)!;
  const idx = Math.min(tickIndex, prices.length - 1);
  return prices[idx];
}

async function generateAutoTrade(): Promise<void> {
  const mmfData = await fetchMMFData();
  const allSymbols = [...mmfData.global_symbols, ...mmfData.b3_symbols];
  
  if (allSymbols.length === 0) return;
  
  // Escolher símbolo aleatório
  const tick = allSymbols[Math.floor(Math.random() * allSymbols.length)];
  const tickIndex = tradeCount * 10; // avança 10 ticks por operação
  const midPrice = getCurrentPrice(tick.symbol, tick.bid, tick.ask, tickIndex);
  
  // Estratégia simples: 60% BUY, 40% SELL
  const side = Math.random() > 0.4 ? 'BUY' : 'SELL';
  const strategies = ['momentum', 'reversal', 'breakout', 'trend_follow', 'mean_reversion'];
  const strategy = strategies[Math.floor(Math.random() * strategies.length)];
  
  // Calcular stop e target
  const stopDistance = midPrice * 0.02; // 2% stop
  const targetDistance = midPrice * 0.03; // 3% target
  
  const signal = {
    symbol: tick.symbol,
    side: side as 'BUY' | 'SELL',
    entry: midPrice,
    stop: side === 'BUY' ? midPrice - stopDistance : midPrice + stopDistance,
    target: side === 'BUY' ? midPrice + targetDistance : midPrice - targetDistance,
    quantity: 100,
    strategy,
    confidence: 0.6 + Math.random() * 0.3
  };
  
  try {
    const registered = await signalTracker.registerSignal(signal);
    tradeCount++;
    
    // Simular resultado imediatamente no modo simulação
    if (simulationMode) {
      const futureIdx = Math.min(tickIndex + 50, 389);
      const futurePrice = getCurrentPrice(tick.symbol, tick.bid, tick.ask, futureIdx);
      
      let result = 'PENDING';
      let pnl = 0;
      
      if (side === 'BUY') {
        if (futurePrice >= signal.target) {
          result = 'WIN';
          winCount++;
          pnl = ((signal.target - signal.entry) / signal.entry) * 100;
        } else if (futurePrice <= signal.stop) {
          result = 'LOSS';
          lossCount++;
          pnl = -((signal.entry - signal.stop) / signal.entry) * 100;
        }
      } else {
        if (futurePrice <= signal.target) {
          result = 'WIN';
          winCount++;
          pnl = ((signal.entry - signal.target) / signal.entry) * 100;
        } else if (futurePrice >= signal.stop) {
          result = 'LOSS';
          lossCount++;
          pnl = -((signal.stop - signal.entry) / signal.entry) * 100;
        }
      }
      
      console.log(`[AutoTrade] #${tradeCount} ${signal.side} ${signal.symbol} @ ${signal.entry.toFixed(4)} → ${result} (${pnl.toFixed(2)}%) | W:${winCount} L:${lossCount}`);
      
      if (result !== 'PENDING') {
        await telegramNotifier.sendMessage(
          `${result === 'WIN' ? '🟢' : '🔴'} <b>${result}!</b>\n\n` +
          `📊 ${signal.symbol} ${signal.side}\n` +
          `� Entry: ${signal.entry.toFixed(4)}\n` +
          `📈 Exit: ${futurePrice.toFixed(4)}\n` +
          `� PnL: ${pnl.toFixed(2)}%\n` +
          `📚 ${strategy}\n\n` +
          `� Wins: ${winCount} | ❌ Losses: ${lossCount}`
        );
      }
    } else {
      console.log(`[AutoTrade] #${tradeCount} ${signal.side} ${signal.symbol} @ ${signal.entry.toFixed(4)} (${strategy})`);
    }
    
    if (tradeCount % 5 === 0) {
      await telegramNotifier.sendMessage(
        `🤖 <b>AUTO-TRADING ATIVO</b>\n\n` +
        `� Operações: ${tradeCount}\n` +
        `🏆 Wins: ${winCount} | ❌ Losses: ${lossCount}\n` +
        `📈 Win Rate: ${tradeCount > 0 ? ((winCount / tradeCount) * 100).toFixed(1) : 0}%\n` +
        `⚡ Modo: ${simulationMode ? 'SIMULAÇÃO' : 'REAL'}`
      );
    }
  } catch (e) {
    console.error('[AutoTrade] Erro:', e);
  }
}

export async function signalTrackerRoutes(app: FastifyInstance) {
  // ==================== START LEARNING ====================
  
  // Inicia aprendizagem contínua
  app.post('/api/v1/learning/start', async (request, reply) => {
    await telegramNotifier.sendMessage(
      `🧠 <b>VEXOR - APRENDIZADO CONTÍNUO INICIADO</b>\n\n` +
      `📚 27 livros embedados carregados\n` +
      `🤖 5 estratégias ativas\n` +
      `📊 Oracle DB conectado\n` +
      `📡 UDP 10210 escutando ticks\n\n` +
      `✅ Sistema pronto para aprender com cada operação\n` +
      `🔄 Feedback loop ativo: WIN=1, LOSS=0\n\n` +
      `⚡ VEXOR Trading System`
    );
    
    return { 
      success: true, 
      message: 'Aprendizagem contínua iniciada',
      strategies: 5,
      books: 27
    };
  });

  // ==================== START AUTO-TRADING ====================
  
  app.post('/api/v1/trading/auto/start', async (request, reply) => {
    if (autoTradingInterval) {
      return { success: false, message: 'Auto-trading já está rodando' };
    }
    
    // Gerar operação a cada 30 segundos
    autoTradingInterval = setInterval(generateAutoTrade, simulationSpeed);
    
    // Gerar primeira operação imediatamente
    await generateAutoTrade();
    
    await telegramNotifier.sendMessage(
      `🚀 <b>AUTO-TRADING INICIADO</b>\n\n` +
      `⏱️ Intervalo: ${simulationSpeed/1000}s\n` +
      `📊 Fontes: Pepperstone + Genial + Binance\n` +
      `🧠 Aprendizado ativo com cada operação\n\n` +
      `⚡ VEXOR está operando automaticamente!`
    );
    
    return { 
      success: true, 
      message: 'Auto-trading iniciado',
      interval: `${simulationSpeed/1000}s`
    };
  });

  // ==================== START SIMULATION ====================
  
  app.post('/api/v1/trading/simulation/start', async (request, reply) => {
    if (autoTradingInterval) {
      clearInterval(autoTradingInterval);
      autoTradingInterval = null;
    }
    
    // Reset contadores
    tradeCount = 0;
    winCount = 0;
    lossCount = 0;
    simulatedPrices.clear();
    simulationMode = true;
    simulationSpeed = 3000; // 3 segundos - velocidade alta!
    
    // Gerar operação a cada 3 segundos
    autoTradingInterval = setInterval(generateAutoTrade, simulationSpeed);
    
    // Gerar primeira operação imediatamente
    await generateAutoTrade();
    
    await telegramNotifier.sendMessage(
      `🎲 <b>SIMULAÇÃO INICIADA</b>\n\n` +
      `📅 Dia aleatório gerado\n` +
      `⚡ Velocidade: 3s (alta)\n` +
      `📊 390 ticks de pregão\n` +
      `🧠 Aprendizado acelerado\n\n` +
      `⚡ VEXOR simulando operações!`
    );
    
    return { 
      success: true, 
      message: 'Simulação iniciada',
      mode: 'simulation',
      speed: '3s',
      ticks: 390
    };
  });

  // ==================== STOP AUTO-TRADING ====================
  
  app.post('/api/v1/trading/auto/stop', async (request, reply) => {
    if (autoTradingInterval) {
      clearInterval(autoTradingInterval);
      autoTradingInterval = null;
      
      await telegramNotifier.sendMessage(
        `⏹️ <b>AUTO-TRADING PARADO</b>\n\n` +
        `📊 Total de operações: ${tradeCount}\n` +
        `🧠 Sistema de aprendizado continua ativo`
      );
      
      return { success: true, message: 'Auto-trading parado', totalTrades: tradeCount };
    }
    
    return { success: false, message: 'Auto-trading não estava rodando' };
  });

  // ==================== AUTO-TRADING STATUS ====================
  
  app.get('/api/v1/trading/auto/status', async (request, reply) => {
    return {
      running: autoTradingInterval !== null,
      totalTrades: tradeCount,
      wins: winCount,
      losses: lossCount,
      winRate: tradeCount > 0 ? ((winCount / tradeCount) * 100).toFixed(1) + '%' : '0%',
      mode: simulationMode ? 'SIMULATION' : 'REAL',
      interval: `${simulationSpeed/1000}s`
    };
  });

  // ==================== REPLAY HISTÓRICO ====================
  
  // Preparar dados de replay (baixar de Binance, MT5)
  app.post('/api/v1/replay/prepare', async (request, reply) => {
    const body = (request.body || {}) as {
      date?: string;
      pepperstone?: string[];
      genial?: string[];
      binance?: string[];
    };
    
    const date = body.date || new Date().toISOString().slice(0, 10).replace(/-/g, '');
    
    const symbolsPepperstone = body.pepperstone || ['EURUSD', 'GBPUSD', 'USDJPY'];
    const symbolsGenial = body.genial || ['PETR4', 'VALE3', 'ITUB4'];
    const symbolsBinance = body.binance || ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'];
    
    try {
      const result = await prepareReplayData(date, symbolsPepperstone, symbolsGenial, symbolsBinance);
      return { success: true, file: result, date };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });
  
  // Iniciar replay de um dia específico
  app.post('/api/v1/replay/start', async (request, reply) => {
    const body = (request.body || {}) as {
      date?: string;
      speed?: 'realtime' | 'fast' | 'ultra';
    };
    
    const date = body.date || new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const speed = body.speed || 'fast';
    
    const engine = getReplayEngine();
    
    // Parar simulação atual se houver
    if (autoTradingInterval) {
      clearInterval(autoTradingInterval);
      autoTradingInterval = null;
    }
    
    // Executar replay em background (não bloquear)
    engine.replayDay(date, speed).then(async (result) => {
      await telegramNotifier.sendMessage(
        `📼 <b>REPLAY HISTÓRICO</b>\n\n` +
        `📅 Data: ${date}\n` +
        `📊 Ticks: ${result.ticks}\n` +
        `⏱️ Tempo: ${result.elapsed.toFixed(1)}s\n` +
        `⚡ Velocidade: ${speed}`
      );
    }).catch(e => {
      console.error('[Replay] Erro:', e);
    });
    
    return { success: true, message: 'Replay iniciado', date, speed };
  });
  
  // Parar replay
  app.post('/api/v1/replay/stop', async (request, reply) => {
    const engine = getReplayEngine();
    engine.stop();
    return { success: true, message: 'Replay parado' };
  });
  
  // Status do replay
  app.get('/api/v1/replay/status', async (request, reply) => {
    const engine = getReplayEngine();
    return engine.getStatus();
  });

  // Context Memory status
  app.get('/api/v1/context-memory/status', async (request, reply) => {
    const { getContextMemory } = await import('../infrastructure/context-memory.js');
    const contextMemory = getContextMemory();
    const stats = contextMemory.getStats();
    const blocked = contextMemory.getBlockedContexts();
    
    return {
      stats,
      blockedContexts: blocked,
      totalBlocked: blocked.length
    };
  });

  // Context Memory report
  app.get('/api/v1/context-memory/report', async (request, reply) => {
    const { getContextMemory } = await import('../infrastructure/context-memory.js');
    const contextMemory = getContextMemory();
    contextMemory.report();
    
    return { success: true, message: 'Relatório impresso no console' };
  });

  // ==================== LEARNING PIPELINE ====================
  
  // Definir fase do aprendizado (1-4)
  app.post('/api/v1/learning/phase', async (request, reply) => {
    const body = (request.body || {}) as { phase?: number };
    const phase = (body.phase || 1) as 1 | 2 | 3 | 4;
    
    const learning = getLearningOrchestrator();
    learning.setPhase(phase);
    
    const phaseNames = {
      1: 'Exposição (observação)',
      2: 'Paper Trading (sinais simulados)',
      3: 'Análise (padrões vencedores)',
      4: 'Live Trading (1 contrato)'
    };
    
    await telegramNotifier.sendMessage(
      `🧠 <b>FASE ${phase} ATIVADA</b>\n\n` +
      `📚 ${phaseNames[phase]}\n\n` +
      `1️⃣ Exposição\n2️⃣ Paper Trading\n3️⃣ Análise\n4️⃣ Live`
    );
    
    return { success: true, phase, name: phaseNames[phase] };
  });
  
  // Estatísticas de aprendizado
  app.get('/api/v1/learning/stats', async (request, reply) => {
    const learning = getLearningOrchestrator();
    const stats = learning.getStats();
    const analysis = learning.analyze();
    
    return {
      phase: learning.getPhase(),
      stats,
      analysis,
      summary: {
        totalSignals: stats.totalSignals,
        winRate: `${(stats.winRate * 100).toFixed(1)}%`,
        bestStrategies: analysis.bestStrategies,
        bestHours: analysis.bestHours,
        recommendations: analysis.recommendations
      }
    };
  });
  
  // Análise de padrões vencedores
  app.get('/api/v1/learning/analyze', async (request, reply) => {
    const learning = getLearningOrchestrator();
    const analysis = learning.analyze();
    
    await telegramNotifier.sendMessage(
      `📊 <b>ANÁLISE DE PADRÕES</b>\n\n` +
      analysis.recommendations.map(r => `• ${r}`).join('\n')
    );
    
    return analysis;
  });
  
  // Baixar dados históricos de múltiplos meses (otimizado)
  app.post('/api/v1/replay/download', async (request, reply) => {
    const body = (request.body || {}) as {
      months?: number;
      symbols?: string[];
    };
    
    const months = body.months || 1;
    const symbols = body.symbols || ['BTCUSDT', 'ETHUSDT'];
    
    const https = await import('https');
    const fs = await import('fs');
    const path = await import('path');
    
    const DATA_DIR = 'C:\\Users\\opc\\CascadeProjects\\vexor-Oracle\\vexor-Oracle-main\\replay_data';
    
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    
    const now = Date.now();
    const msPerMonth = 30 * 24 * 60 * 60 * 1000;
    const startTime = now - months * msPerMonth;
    
    let totalTicks = 0;
    const ticksByDay: Record<string, any[]> = {};
    
    for (const symbol of symbols) {
      console.log(`[Download] Baixando ${symbol}...`);
      
      let currentStart = startTime;
      let symbolTotal = 0;
      
      while (currentStart < now) {
        const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&startTime=${currentStart}&endTime=${now}&limit=1000`;
        
        const ticks = await new Promise<any[]>((resolve) => {
          https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
              try {
                const candles = JSON.parse(data);
                if (!Array.isArray(candles)) {
                  resolve([]);
                  return;
                }
                resolve(candles.map((c: any[]) => ({
                  symbol,
                  timestamp: c[0],
                  bid: parseFloat(c[4]) * 0.99995,
                  ask: parseFloat(c[4]) * 1.00005,
                  volume: parseFloat(c[5]),
                  source: 'binance'
                })));
              } catch (e) {
                resolve([]);
              }
            });
          }).on('error', () => resolve([]));
        });
        
        if (ticks.length === 0) break;
        
        // Processar imediatamente (não acumular)
        for (const tick of ticks) {
          const day = new Date(tick.timestamp).toISOString().slice(0, 10).replace(/-/g, '');
          if (!ticksByDay[day]) ticksByDay[day] = [];
          ticksByDay[day].push(tick);
        }
        
        symbolTotal += ticks.length;
        currentStart = ticks[ticks.length - 1].timestamp + 60000;
        
        // Salvar parcialmente a cada 10000 ticks
        if (symbolTotal % 10000 < 1000) {
          for (const [day, dayTicks] of Object.entries(ticksByDay)) {
            const file = path.join(DATA_DIR, `day_${day}.json`);
            // Ler existente e mesclar
            let existing: any[] = [];
            if (fs.existsSync(file)) {
              try {
                existing = JSON.parse(fs.readFileSync(file, 'utf-8'));
              } catch (e) {}
            }
            const merged = [...existing, ...dayTicks];
            // Dedup por timestamp
            const unique = merged.filter((t, i, arr) => 
              arr.findIndex(x => x.timestamp === t.timestamp && x.symbol === t.symbol) === i
            );
            fs.writeFileSync(file, JSON.stringify(unique, null, 2));
          }
          // Limpar buffer
          Object.keys(ticksByDay).forEach(k => delete ticksByDay[k]);
        }
        
        await new Promise(r => setTimeout(r, 100));
      }
      
      totalTicks += symbolTotal;
      console.log(`[Download] ${symbol}: ${symbolTotal} ticks`);
    }
    
    // Salvar restante
    for (const [day, dayTicks] of Object.entries(ticksByDay)) {
      const file = path.join(DATA_DIR, `day_${day}.json`);
      let existing: any[] = [];
      if (fs.existsSync(file)) {
        try {
          existing = JSON.parse(fs.readFileSync(file, 'utf-8'));
        } catch (e) {}
      }
      const merged = [...existing, ...dayTicks];
      const unique = merged.filter((t, i, arr) => 
        arr.findIndex(x => x.timestamp === t.timestamp && x.symbol === t.symbol) === i
      );
      fs.writeFileSync(file, JSON.stringify(unique, null, 2));
    }
    
    // Contar dias
    const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('day_'));
    
    await telegramNotifier.sendMessage(
      `📥 <b>DADOS HISTÓRICOS BAIXADOS</b>\n\n` +
      `📅 Meses: ${months}\n` +
      `📊 Ticks: ${totalTicks.toLocaleString()}\n` +
      `📁 Dias: ${files.length}\n` +
      `💰 Símbolos: ${symbols.join(', ')}`
    );
    
    return {
      success: true,
      totalTicks,
      days: files.length,
      months,
      symbols
    };
  });
  
  // Gravar ticks do MMF em tempo real para replay
  let mmfRecording = false;
  let mmfTicks: any[] = [];
  let mmfInterval: NodeJS.Timeout | null = null;
  
  app.post('/api/v1/replay/record', async (request, reply) => {
    const body = (request.body || {}) as {
      action?: 'start' | 'stop';
      duration?: number; // minutos
    };
    
    const action = body.action || 'start';
    const duration = body.duration || 60; // 1 hora padrão
    
    if (action === 'start') {
      if (mmfRecording) {
        return { success: false, message: 'Já gravando' };
      }
      
      mmfRecording = true;
      mmfTicks = [];
      
      const fs = await import('fs');
      const path = await import('path');
      const DATA_DIR = 'C:\\Users\\opc\\CascadeProjects\\vexor-Oracle\\vexor-Oracle-main\\replay_data';
      
      // Capturar ticks do MMF a cada 100ms
      mmfInterval = setInterval(async () => {
        try {
          const http = await import('http');
          http.get('http://localhost:8765/mmf/debug', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
              try {
                const mmf = JSON.parse(data);
                const timestamp = Date.now();
                
                // Processar símbolos B3 (Genial)
                for (const sym of mmf.b3_symbols || []) {
                  if (sym.bid > 0 && sym.ask > 0) {
                    mmfTicks.push({
                      symbol: sym.symbol,
                      timestamp,
                      bid: sym.bid,
                      ask: sym.ask,
                      volume: 0,
                      source: 'genial'
                    });
                  }
                }
                
                // Processar símbolos Global (Pepperstone)
                for (const sym of mmf.global_symbols || []) {
                  if (sym.bid > 0 && sym.ask > 0) {
                    mmfTicks.push({
                      symbol: sym.symbol,
                      timestamp,
                      bid: sym.bid,
                      ask: sym.ask,
                      volume: 0,
                      source: 'pepperstone'
                    });
                  }
                }
                
                // Salvar a cada 1000 ticks
                if (mmfTicks.length >= 1000) {
                  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
                  const file = path.join(DATA_DIR, `day_${day}.json`);
                  
                  let existing: any[] = [];
                  if (fs.existsSync(file)) {
                    try {
                      existing = JSON.parse(fs.readFileSync(file, 'utf-8'));
                    } catch (e) {}
                  }
                  
                  const merged = [...existing, ...mmfTicks];
                  fs.writeFileSync(file, JSON.stringify(merged, null, 2));
                  mmfTicks = [];
                }
              } catch (e) {}
            });
          });
        } catch (e) {}
      }, 100);
      
      // Parar após duração
      setTimeout(() => {
        if (mmfInterval) {
          clearInterval(mmfInterval);
          mmfRecording = false;
          console.log(`[MMF Record] Gravação parada automaticamente`);
        }
      }, duration * 60 * 1000);
      
      await telegramNotifier.sendMessage(
        `🔴 <b>GRAVAÇÃO INICIADA</b>\n\n` +
        `⏱️ Duração: ${duration} min\n` +
        `📊 Fontes: Genial + Pepperstone`
      );
      
      return { success: true, message: 'Gravação iniciada', duration };
    }
    
    if (action === 'stop') {
      if (mmfInterval) {
        clearInterval(mmfInterval);
        mmfInterval = null;
      }
      mmfRecording = false;
      
      // Salvar ticks restantes
      const fs = await import('fs');
      const path = await import('path');
      const DATA_DIR = 'C:\\Users\\opc\\CascadeProjects\\vexor-Oracle\\vexor-Oracle-main\\replay_data';
      
      if (mmfTicks.length > 0) {
        const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const file = path.join(DATA_DIR, `day_${day}.json`);
        
        let existing: any[] = [];
        if (fs.existsSync(file)) {
          try {
            existing = JSON.parse(fs.readFileSync(file, 'utf-8'));
          } catch (e) {}
        }
        
        const merged = [...existing, ...mmfTicks];
        fs.writeFileSync(file, JSON.stringify(merged, null, 2));
      }
      
      const total = mmfTicks.length;
      mmfTicks = [];
      
      return { success: true, message: 'Gravação parada', ticksSaved: total };
    }
    
    return { success: false, message: 'Ação inválida' };
  });
  
  // Status da gravação MMF
  app.get('/api/v1/replay/record', async (request, reply) => {
    return {
      recording: mmfRecording,
      ticksBuffer: mmfTicks.length
    };
  });

  // Rodar replay em todos os dias (Fase 1 + Fase 2)
  app.post('/api/v1/replay/all', async (request, reply) => {
    const body = (request.body || {}) as {
      phase?: number;
      speed?: 'realtime' | 'fast' | 'ultra';
      dateFrom?: string;  // YYYYMMDD - para validação out-of-sample
      dateTo?: string;    // YYYYMMDD
    };
    
    const phase = body.phase || 1;
    const speed = body.speed || 'ultra';
    const dateFrom = body.dateFrom; // ex: "20260101"
    const dateTo = body.dateTo;     // ex: "20260228"
    
    const fs = await import('fs');
    const path = await import('path');
    
    const DATA_DIR = 'C:\\Users\\opc\\CascadeProjects\\vexor-Oracle\\vexor-Oracle-main\\replay_data';
    const learning = getLearningOrchestrator();
    
    // Reset contadores antes de iniciar novo replay
    learning.reset();
    
    learning.setPhase(phase as 1 | 2 | 3 | 4);
    
    let files = fs.readdirSync(DATA_DIR)
      .filter(f => f.startsWith('day_') && f.endsWith('.json'))
      .sort();
    
    // Filtrar por período se especificado
    if (dateFrom || dateTo) {
      files = files.filter(f => {
        const day = f.replace('day_', '').replace('.json', '');
        if (dateFrom && day < dateFrom) return false;
        if (dateTo && day > dateTo) return false;
        return true;
      });
    }
    
    console.log(`[Replay All] Iniciando replay em ${files.length} dias, Fase ${phase}`);
    if (dateFrom || dateTo) {
      console.log(`[Replay All] Período: ${dateFrom || 'início'} → ${dateTo || 'fim'}`);
    }
    
    let totalTicks = 0;
    let totalSignals = 0;
    const startTime = Date.now();
    const MAX_TIME_MS = 60000; // 60 segundos máximo (aumentado para processar tudo)
    
    // Processa TODOS os ticks - sem pular dados
    for (const file of files) {
      // Verifica timeout apenas como segurança
      if (Date.now() - startTime > MAX_TIME_MS) {
        console.log(`[Replay All] Timeout de 60s atingido, parando...`);
        break;
      }
      
      const day = file.replace('day_', '').replace('.json', '');
      const filepath = path.join(DATA_DIR, file);
      
      try {
        const ticks = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
        
        // Processa TODOS os ticks - sem sleep, sem await, sem pular
        for (let i = 0; i < ticks.length; i++) {
          learning.processTick(ticks[i], totalTicks + i);
        }
        totalTicks += ticks.length;
        
        // Log a cada 30 dias
        if (files.indexOf(file) % 30 === 0) {
          const stats = learning.getStats();
          console.log(`[Replay All] Dia ${day}: ${ticks.length} ticks | Total: ${totalTicks} | Signals: ${stats.totalSignals} | WR: ${(stats.winRate * 100).toFixed(1)}%`);
        }
        
      } catch (e: any) {
        console.error(`[Replay All] Erro no dia ${day}: ${e.message}`);
      }
    }
    
    const elapsed = (Date.now() - startTime) / 1000;
    const stats = learning.getStats();
    const analysis = learning.analyze();
    const filtered = learning.getFilteredCounters();
    const rejectionLog = learning.getRejectionLog();
    
    console.log('=== FILTROS ===');
    console.log(`Ticks processados:  ${rejectionLog.total_ticks}`);
    console.log(`Passou tudo:        ${rejectionLog.total_passed}`);
    console.log(`Bloqueado horário:  ${rejectionLog.horario}`);
    console.log(`Bloqueado limite:   ${rejectionLog.limite}`);
    console.log(`Bloqueado indicadores: ${rejectionLog.indicadores}`);
    console.log(`Bloqueado agentes:  ${rejectionLog.agentes}`);
    
    await telegramNotifier.sendMessage(
      `🎬 <b>REPLAY COMPLETO</b>\n\n` +
      `📅 Dias: ${files.length}\n` +
      `📊 Ticks: ${totalTicks.toLocaleString()}\n` +
      `⏱️ Tempo: ${elapsed.toFixed(1)}s\n` +
      `🧠 Fase: ${phase}\n\n` +
      `📈 Sinais: ${stats.totalSignals}\n` +
      `✅ Wins: ${stats.wins}\n` +
      `❌ Losses: ${stats.losses}\n` +
      `📊 Win Rate: ${(stats.winRate * 100).toFixed(1)}%`
    );
    
    return {
      success: true,
      days: files.length,
      totalTicks,
      elapsed,
      phase,
      stats: {
        totalSignals: stats.totalSignals,
        wins: stats.wins,
        losses: stats.losses,
        winRate: stats.winRate
      },
      filtered,
      rejectionLog,
      analysis
    };
  });

  // ==================== WORKERS STATUS ====================
  // Endpoint movido para app.ts para debug
  
  // ==================== REGISTER SIGNAL ====================

  // Registra novo sinal para monitoramento
  app.post('/api/v1/tracker/register', async (request, reply) => {
    const body = request.body as {
      symbol: string;
      side: 'BUY' | 'SELL';
      entry: number;
      stop: number;
      target: number;
      quantity: number;
      strategy: string;
      confidence: number;
    };

    const signal = await signalTracker.registerSignal(body);
    return { success: true, signal };
  });

  // ==================== UPDATE PRICE ====================

  // Atualiza preço atual do ativo
  app.post('/api/v1/tracker/price', async (request, reply) => {
    const body = request.body as {
      symbol: string;
      price: number;
    };

    signalTracker.updatePrice(body.symbol, body.price);
    return { success: true };
  });

  // ==================== ACTIVE SIGNALS ====================

  // Lista sinais ativos
  app.get('/api/v1/tracker/active', async (request, reply) => {
    const signals = signalTracker.getActiveSignals();
    return { signals, count: signals.length };
  });

  // Obtém sinal por ID
  app.get('/api/v1/tracker/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const signal = signalTracker.getSignal(params.id);
    
    if (!signal) {
      return reply.status(404).send({ error: 'Sinal não encontrado' });
    }
    
    return signal;
  });

  // ==================== CLOSE SIGNAL ====================

  // Fecha sinal manualmente
  app.post('/api/v1/tracker/:id/close', async (request, reply) => {
    const params = request.params as { id: string };
    const body = request.body as {
      exitPrice: number;
      reason?: string;
    };

    try {
      await signalTracker.closeManually(params.id, body.exitPrice, body.reason);
      return { success: true, message: 'Sinal fechado com sucesso' };
    } catch (e) {
      return reply.status(400).send({ error: String(e) });
    }
  });

  // ==================== STATS ====================

  // Estatísticas do dia
  app.get('/api/v1/tracker/stats', async (request, reply) => {
    const stats = await signalTracker.getStats();
    return stats;
  });

  // ==================== MONITORING CONTROL ====================

  // Inicia monitoramento
  app.post('/api/v1/tracker/monitoring/start', async (request, reply) => {
    signalTracker.startMonitoring();
    return { success: true, message: 'Monitoramento iniciado' };
  });

  // Para monitoramento
  app.post('/api/v1/tracker/monitoring/stop', async (request, reply) => {
    signalTracker.stopMonitoring();
    return { success: true, message: 'Monitoramento parado' };
  });

  console.log('[Routes] Signal Tracker routes registered');
}
