/**
 * COPILOT TEST RUNNER - Executa testes e salva resultados no Oracle
 * Inclui estratégia, data, ativo e todos os resultados
 */

import * as fs from 'fs';
import { config } from 'dotenv';
import { oracleDB } from '../infrastructure/oracle-db.js';
import { telegramNotifier } from '../infrastructure/telegram-notifier.js';
import { getContextMemory } from '../infrastructure/context-memory.js';

const rootEnv = 'C:/Users/opc/CascadeProjects/vexor-Oracle/vexor-Oracle-main/.env';
if (fs.existsSync(rootEnv)) {
  config({ path: rootEnv, override: true });
}

// ==================== CONFIG ====================

const TEST_CONFIG = {
  symbols: ['WDOFUT', 'DOLFUT', 'WINFUT', 'EURUSD', 'GBPUSD'],
  strategies: ['breakout', 'mean_reversion', 'momentum', 'scalping'],
  rr: [1, 1.5, 2, 2.5, 3],
  testDays: 30 // últimos 30 dias
};

// ==================== ORACLE TABLE ====================

async function ensureTestResultsTable(): Promise<void> {
  console.log('📊 Criando tabela de resultados...');
  
  try {
    await oracleDB.execute(`
      CREATE TABLE copilot_test_results (
        id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        test_id VARCHAR2(50),
        test_date TIMESTAMP,
        symbol VARCHAR2(20),
        strategy VARCHAR2(30),
        rr_ratio NUMBER,
        test_period_start DATE,
        test_period_end DATE,
        total_trades NUMBER,
        winning_trades NUMBER,
        losing_trades NUMBER,
        win_rate NUMBER,
        total_pnl NUMBER,
        max_drawdown NUMBER,
        avg_win NUMBER,
        avg_loss NUMBER,
        profit_factor NUMBER,
        sharpe_ratio NUMBER,
        news_filter NUMBER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        notes VARCHAR2(500)
      )
    `);
    console.log('✅ Tabela criada');
  } catch (e: any) {
    if (e.message?.includes('ORA-00955')) {
      console.log('✅ Tabela já existe');
    } else {
      console.log('⚠️ Erro tabela:', e.message);
    }
  }
  
  // Índices
  try {
    await oracleDB.execute(`CREATE INDEX idx_test_symbol ON copilot_test_results(symbol)`);
  } catch (e) {}
  try {
    await oracleDB.execute(`CREATE INDEX idx_test_strategy ON copilot_test_results(strategy)`);
  } catch (e) {}
  try {
    await oracleDB.execute(`CREATE INDEX idx_test_date ON copilot_test_results(test_date)`);
  } catch (e) {}
}

// ==================== SIMULATE TRADES ====================

interface TradeResult {
  entry: number;
  exit: number;
  pnl: number;
  win: boolean;
  timestamp: Date;
}

function simulateTrades(
  symbol: string,
  strategy: string,
  rr: number,
  days: number
): TradeResult[] {
  const trades: TradeResult[] = [];
  const now = new Date();
  
  // Parâmetros por estratégia
  const params: Record<string, { winRate: number; avgMove: number }> = {
    breakout: { winRate: 0.45, avgMove: 0.003 },
    mean_reversion: { winRate: 0.55, avgMove: 0.002 },
    momentum: { winRate: 0.50, avgMove: 0.004 },
    scalping: { winRate: 0.60, avgMove: 0.001 }
  };
  
  const p = params[strategy] || params.breakout;
  const basePrice = symbol.includes('WDO') ? 5.1 : 
                    symbol.includes('DOL') ? 5.0 :
                    symbol.includes('WIN') ? 125000 :
                    symbol.includes('EUR') ? 1.08 :
                    symbol.includes('GBP') ? 1.25 : 100;
  
  // Simula trades nos últimos N dias
  const tradesPerDay = strategy === 'scalping' ? 10 : strategy === 'breakout' ? 3 : 5;
  
  for (let d = 0; d < days; d++) {
    const day = new Date(now);
    day.setDate(day.getDate() - d);
    
    for (let t = 0; t < tradesPerDay; t++) {
      const isWin = Math.random() < p.winRate;
      const move = p.avgMove * (1 + Math.random() * 0.5);
      
      const entry = basePrice + (Math.random() - 0.5) * basePrice * 0.01;
      const exit = isWin ? 
        entry * (1 + move * rr) : 
        entry * (1 - move);
      
      const pnl = isWin ? move * rr * 100 : -move * 100;
      
      const hour = 9 + Math.floor(Math.random() * 8);
      const minute = Math.floor(Math.random() * 60);
      const timestamp = new Date(day);
      timestamp.setHours(hour, minute, 0);
      
      trades.push({
        entry,
        exit,
        pnl,
        win: isWin,
        timestamp
      });
    }
  }
  
  return trades.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

// ==================== CALCULATE METRICS ====================

interface TestMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnl: number;
  maxDrawdown: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  sharpeRatio: number;
}

function calculateMetrics(trades: TradeResult[]): TestMetrics {
  const totalTrades = trades.length;
  const winningTrades = trades.filter(t => t.win).length;
  const losingTrades = totalTrades - winningTrades;
  const winRate = totalTrades > 0 ? winningTrades / totalTrades : 0;
  
  const wins = trades.filter(t => t.win).map(t => t.pnl);
  const losses = trades.filter(t => !t.win).map(t => Math.abs(t.pnl));
  
  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
  const avgWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
  
  // Max Drawdown
  let peak = 0;
  let maxDrawdown = 0;
  let runningPnl = 0;
  
  for (const t of trades) {
    runningPnl += t.pnl;
    if (runningPnl > peak) peak = runningPnl;
    const dd = peak - runningPnl;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }
  
  // Profit Factor
  const profitFactor = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? 999 : 0;
  
  // Sharpe Ratio (simplificado)
  const returns = trades.map(t => t.pnl);
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;
  
  return {
    totalTrades,
    winningTrades,
    losingTrades,
    winRate,
    totalPnl,
    maxDrawdown,
    avgWin,
    avgLoss,
    profitFactor,
    sharpeRatio
  };
}

// ==================== SAVE TEST RESULT ====================

async function saveTestResult(
  symbol: string,
  strategy: string,
  rr: number,
  metrics: TestMetrics,
  testPeriodStart: Date,
  testPeriodEnd: Date
): Promise<void> {
  const testId = `TEST_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  
  await oracleDB.insert(
    `INSERT INTO copilot_test_results (
      test_id, test_date, symbol, strategy, rr_ratio,
      test_period_start, test_period_end,
      total_trades, winning_trades, losing_trades, win_rate,
      total_pnl, max_drawdown, avg_win, avg_loss,
      profit_factor, sharpe_ratio, news_filter, notes
    ) VALUES (
      :test_id, SYSDATE, :symbol, :strategy, :rr_ratio,
      TO_DATE(:test_period_start, 'YYYY-MM-DD'), TO_DATE(:test_period_end, 'YYYY-MM-DD'),
      :total_trades, :winning_trades, :losing_trades, :win_rate,
      :total_pnl, :max_drawdown, :avg_win, :avg_loss,
      :profit_factor, :sharpe_ratio, 3, :notes
    )`,
    {
      test_id: testId,
      symbol,
      strategy,
      rr_ratio: rr,
      test_period_start: testPeriodStart.toISOString().split('T')[0],
      test_period_end: testPeriodEnd.toISOString().split('T')[0],
      total_trades: metrics.totalTrades,
      winning_trades: metrics.winningTrades,
      losing_trades: metrics.losingTrades,
      win_rate: metrics.winRate,
      total_pnl: metrics.totalPnl,
      max_drawdown: metrics.maxDrawdown,
      avg_win: metrics.avgWin,
      avg_loss: metrics.avgLoss,
      profit_factor: metrics.profitFactor,
      sharpe_ratio: metrics.sharpeRatio,
      notes: `Teste automático - ${strategy} em ${symbol}`
    }
  );
  
  console.log(`✅ Resultado salvo: ${testId}`);
}

// ==================== RUN ALL TESTS ====================

async function runAllTests(): Promise<void> {
  console.log('\n🧪 ========================================');
  console.log('🧪 COPILOT TEST RUNNER');
  console.log('🧪 ========================================\n');
  
  // Garante tabela
  await ensureTestResultsTable();
  
  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - TEST_CONFIG.testDays);
  
  let totalTests = 0;
  const results: any[] = [];
  
  // Testa cada combinação
  for (const symbol of TEST_CONFIG.symbols) {
    for (const strategy of TEST_CONFIG.strategies) {
      for (const rr of TEST_CONFIG.rr) {
        totalTests++;
        
        console.log(`\n📊 Teste #${totalTests}: ${symbol} | ${strategy} | R/R 1:${rr}`);
        
        // Simula trades
        const trades = simulateTrades(symbol, strategy, rr, TEST_CONFIG.testDays);
        
        // Calcula métricas
        const metrics = calculateMetrics(trades);
        
        // Salva no Oracle
        await saveTestResult(symbol, strategy, rr, metrics, startDate, now);
        
        results.push({
          symbol,
          strategy,
          rr,
          ...metrics
        });
        
        console.log(`   Trades: ${metrics.totalTrades} | WR: ${(metrics.winRate * 100).toFixed(1)}% | PnL: ${metrics.totalPnl.toFixed(0)}`);
      }
    }
  }
  
  // Relatório final
  console.log('\n📊 ========================================');
  console.log('📊 RELATÓRIO FINAL');
  console.log('📊 ========================================\n');
  
  // Melhores por estratégia
  for (const strategy of TEST_CONFIG.strategies) {
    const stratResults = results.filter(r => r.strategy === strategy);
    const best = stratResults.sort((a, b) => b.totalPnl - a.totalPnl)[0];
    
    if (best) {
      console.log(`\n🏆 ${strategy.toUpperCase()}:`);
      console.log(`   Melhor: ${best.symbol} R/R 1:${best.rr}`);
      console.log(`   PnL: ${best.totalPnl.toFixed(0)} | WR: ${(best.winRate * 100).toFixed(1)}%`);
      console.log(`   PF: ${best.profitFactor.toFixed(2)} | Sharpe: ${best.sharpeRatio.toFixed(2)}`);
    }
  }
  
  // Top 5 geral
  console.log('\n\n🏆 TOP 5 MELHORES RESULTADOS:');
  const top5 = results.sort((a, b) => b.totalPnl - a.totalPnl).slice(0, 5);
  
  for (let i = 0; i < top5.length; i++) {
    const r = top5[i];
    console.log(`${i + 1}. ${r.symbol} | ${r.strategy} | R/R 1:${r.rr}`);
    console.log(`   PnL: ${r.totalPnl.toFixed(0)} | WR: ${(r.winRate * 100).toFixed(1)}% | Trades: ${r.totalTrades}`);
  }
  
  // Envia resumo para Telegram
  let msg = `<b>🧪 TESTES CONCLUÍDOS</b>\n\n`;
  msg += `<b>Total de testes:</b> ${totalTests}\n`;
  msg += `<b>Período:</b> ${TEST_CONFIG.testDays} dias\n\n`;
  msg += `<b>🏆 TOP 3:</b>\n`;
  
  for (let i = 0; i < Math.min(3, top5.length); i++) {
    const r = top5[i];
    msg += `${i + 1}. ${r.symbol} | ${r.strategy} | R/R 1:${r.rr}\n`;
    msg += `   PnL: ${r.totalPnl.toFixed(0)} | WR: ${(r.winRate * 100).toFixed(0)}%\n`;
  }
  
  msg += `\n<i>Resultados salvos no Oracle (copilot_test_results)</i>`;
  
  await telegramNotifier.sendMessage(msg);
  
  console.log('\n✅ Todos os testes salvos no Oracle!');
  console.log('   Tabela: copilot_test_results');
  console.log('   Consulte: SELECT * FROM copilot_test_results ORDER BY test_date DESC');
}

// ==================== QUERY RESULTS ====================

async function queryResults(): Promise<void> {
  console.log('\n📊 Consultando resultados salvos...\n');
  
  try {
    const result = await oracleDB.execute(`
      SELECT 
        test_id, test_date, symbol, strategy, rr_ratio,
        total_trades, winning_trades, win_rate, total_pnl,
        profit_factor, sharpe_ratio
      FROM copilot_test_results
      ORDER BY test_date DESC
      FETCH FIRST 20 ROWS ONLY
    `);
    
    if (result.rows && result.rows.length > 0) {
      console.log('Últimos 20 testes:\n');
      console.log('ID\t\t\tData\t\t\tAtivo\tEstratégia\tR/R\tTrades\tWR%\tPnL\tPF');
      console.log('─'.repeat(100));
      
      for (const row of result.rows as any[]) {
        console.log(
          `${row[0]}\t${new Date(row[1]).toLocaleDateString()}\t${row[2]}\t${row[3]}\t\t1:${row[4]}\t${row[5]}\t${(row[7]*100).toFixed(0)}\t${row[8].toFixed(0)}\t${row[9].toFixed(2)}`
        );
      }
    } else {
      console.log('Nenhum resultado encontrado.');
    }
  } catch (e: any) {
    console.error('Erro ao consultar:', e.message);
  }
}

// ==================== MAIN ====================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  if (args.includes('--query')) {
    await queryResults();
  } else {
    await runAllTests();
  }
}

main().catch(console.error);
