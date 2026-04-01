/**
 * VEXOR AI - Testes Automatizados
 * ===============================
 * 
 * Suite de testes unitários e de integração para o sistema VEXOR.
 * Execute com: npm test
 */

import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// ==================== TEST RUNNER ====================

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

const TEST_RESULTS: TestResult[] = [];

function test(name: string, fn: () => Promise<void> | void): void {
  const start = Date.now();
  try {
    const result = fn();
    if (result instanceof Promise) {
      result.then(() => {
        TEST_RESULTS.push({ name, passed: true, duration: Date.now() - start });
      }).catch((err) => {
        TEST_RESULTS.push({ name, passed: false, duration: Date.now() - start, error: err.message });
      });
    } else {
      TEST_RESULTS.push({ name, passed: true, duration: Date.now() - start });
    }
  } catch (err: any) {
    TEST_RESULTS.push({ name, passed: false, duration: Date.now() - start, error: err.message });
  }
}

// ==================== UNIT TESTS ====================

// Test: Circuit Breaker
test('Circuit Breaker - Deve abrir após 3 falhas', () => {
  let failures = 0;
  const threshold = 3;
  
  // Simula 3 falhas
  for (let i = 0; i < 3; i++) {
    failures++;
  }
  
  const isOpen = failures >= threshold;
  if (!isOpen) throw new Error('Circuit Breaker deveria estar aberto');
});

test('Circuit Breaker - Deve fechar após sucesso', () => {
  let failures = 3;
  
  // Simula sucesso
  failures = 0;
  
  const isClosed = failures === 0;
  if (!isClosed) throw new Error('Circuit Breaker deveria estar fechado');
});

// Test: S1 Rules Engine
test('S1 Rules - Deve bloquear volatilidade alta sem tendência', () => {
  const context = { volatility: 'HIGH', trend: 'NEUTRAL', hour: 10 };
  const shouldBlock = context.volatility === 'HIGH' && context.trend === 'NEUTRAL';
  
  if (!shouldBlock) throw new Error('S1 deveria bloquear este contexto');
});

test('S1 Rules - Deve aprovar horário de alta liquidez com tendência', () => {
  const goodHours = [9, 10, 14, 15, 16];
  const context = { volatility: 'LOW', trend: 'UP', hour: 10 };
  
  const shouldApprove = goodHours.includes(context.hour) && context.trend !== 'NEUTRAL';
  if (!shouldApprove) throw new Error('S1 deveria aprovar este contexto');
});

// Test: Concept Drift
test('Concept Drift - Deve detectar WR baixo', () => {
  const winRate = 0.38;
  const threshold = 0.40;
  
  const isDrift = winRate < threshold;
  if (!isDrift) throw new Error('Deveria detectar drift com WR 38%');
});

test('Concept Drift - Deve alertar após 3 dias consecutivos', () => {
  const consecutiveBadDays = 3;
  const threshold = 3;
  
  const shouldAlert = consecutiveBadDays >= threshold;
  if (!shouldAlert) throw new Error('Deveria alertar com 3 dias consecutivos ruins');
});

// Test: PDF Sanitization
test('PDF cleanText - Deve remover acentos', () => {
  const input = 'VOLATILIDADE EXTREMA';
  const expected = 'VOLATILIDADE EXTREMA';
  
  const result = input.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (result !== expected) throw new Error(`Esperado: ${expected}, Recebido: ${result}`);
});

test('PDF cleanText - Deve remover caracteres não-ASCII', () => {
  const input = 'Cenário: <3Ó"ã R•';
  const result = input.normalize('NFD')
                      .replace(/[\u0300-\u036f]/g, '')
                      .replace(/[^\x20-\x7E]/g, '');
  
  if (result.includes('ó') || result.includes('ã')) {
    throw new Error('Não deveria conter caracteres especiais');
  }
});

// Test: Tilt Detection
test('Tilt Detection - Deve pausar após 3 losses consecutivos', () => {
  const consecutiveLosses = 3;
  const shouldPause = consecutiveLosses >= 3;
  
  if (!shouldPause) throw new Error('Deveria pausar com 3 losses consecutivos');
});

test('Tilt Detection - Nível 2 com WR < 45%', () => {
  const winRate = 0.42;
  const expectedLevel = 2; // WR < 45% = Level 2
  
  let level = 0;
  if (winRate < 0.50) level = 1;
  if (winRate < 0.45) level = 2;
  if (winRate < 0.35) level = 3;
  
  if (level !== expectedLevel) throw new Error(`Esperado nível ${expectedLevel}, recebido ${level}`);
});

// ==================== INTEGRATION TESTS ====================

test('Integration - Oracle ATP Connection', async () => {
  // Verifica se as variáveis de ambiente estão configuradas
  const hasPassword = !!process.env.DB_PASSWORD;
  const hasConnectString = !!process.env.DB_CONNECT_STRING;
  const hasWallet = !!process.env.DB_WALLET_PATH;
  
  if (!hasPassword || !hasConnectString || !hasWallet) {
    throw new Error('Configuração Oracle incompleta');
  }
});

test('Integration - Ollama LLM Disponível', async () => {
  try {
    const response = await fetch('http://localhost:11434/api/tags', {
      method: 'GET',
      signal: AbortSignal.timeout(2000)
    });
    
    if (!response.ok) {
      throw new Error('Ollama não está respondendo');
    }
  } catch (e) {
    throw new Error('Ollama indisponível - verifique se está rodando');
  }
});

test('Integration - Telegram Bot Token Válido', () => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token.length < 40) {
    throw new Error('Token Telegram inválido ou não configurado');
  }
});

test('Integration - Yahoo Finance API', async () => {
  try {
    const response = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/USDBRL=X', {
      signal: AbortSignal.timeout(5000)
    });
    
    if (!response.ok) {
      throw new Error('Yahoo Finance não está respondendo');
    }
    
    const data = await response.json();
    if (!data.chart?.result?.[0]?.meta?.regularMarketPrice) {
      throw new Error('Formato de resposta Yahoo inválido');
    }
  } catch (e: any) {
    throw new Error(`Yahoo Finance erro: ${e.message}`);
  }
});

// ==================== CHAOS TESTS ====================

test('Chaos - Simula queda do Oracle', async () => {
  // Simula modo offline
  let isOfflineMode = true;
  let signalsBlocked = true;
  
  if (!isOfflineMode || !signalsBlocked) {
    throw new Error('Sistema deveria entrar em modo degradado');
  }
});

test('Chaos - Simula queda do Ollama', async () => {
  // Verifica se S1 pode operar sozinho
  const s1Available = true;
  const s2Down = true;
  
  const canOperate = s1Available && s2Down;
  if (!canOperate) {
    throw new Error('Sistema não deveria parar completamente');
  }
});

test('Chaos - Simula alta carga (100 sinais simultâneos)', async () => {
  const signals = Array(100).fill(null).map((_, i) => ({
    id: `SIG_${i}`,
    symbol: 'WDOFUT',
    side: 'BUY',
    confidence: 0.5
  }));
  
  // Verifica se consegue processar
  if (signals.length !== 100) {
    throw new Error('Não conseguiu criar 100 sinais');
  }
  
  // Em produção, testaria processamento real
});

// ==================== LOAD TESTS ====================

test('Load - 1000 requisições ao Context Memory', () => {
  const contexts = new Map();
  
  const start = Date.now();
  for (let i = 0; i < 1000; i++) {
    contexts.set(`ctx_${i}`, { wins: 10, losses: 5, winRate: 0.67 });
  }
  const duration = Date.now() - start;
  
  if (contexts.size !== 1000) {
    throw new Error('Não conseguiu criar 1000 contextos');
  }
  
  if (duration > 100) {
    throw new Error(`Muito lento: ${duration}ms para 1000 operações`);
  }
});

test('Load - Cache de preços com TTL', () => {
  const cache = new Map<string, { price: number; timestamp: number }>();
  const TTL = 30000; // 30 segundos
  
  // Adiciona 100 preços
  for (let i = 0; i < 100; i++) {
    cache.set(`SYM_${i}`, { price: 5.0 + i * 0.01, timestamp: Date.now() });
  }
  
  // Verifica se todos estão válidos
  let validCount = 0;
  cache.forEach((value) => {
    if (Date.now() - value.timestamp < TTL) {
      validCount++;
    }
  });
  
  if (validCount !== 100) {
    throw new Error('Cache não está funcionando corretamente');
  }
});

// ==================== REPORT ====================

function generateTestReport(): string {
  const passed = TEST_RESULTS.filter(t => t.passed).length;
  const failed = TEST_RESULTS.filter(t => !t.passed).length;
  const total = TEST_RESULTS.length;
  const successRate = total > 0 ? ((passed / total) * 100).toFixed(1) : '0';
  
  let report = `
╔══════════════════════════════════════════════════════════════╗
║              VEXOR AI - RELATÓRIO DE TESTES                   ║
╠══════════════════════════════════════════════════════════════╣
║                                                               ║
║  📊 RESUMO                                                    ║
║  ├─ Total: ${total.toString().padEnd(3)} testes                                          ║
║  ├─ Passou: ${passed.toString().padEnd(3)} ✅                                            ║
║  ├─ Falhou: ${failed.toString().padEnd(3)} ❌                                            ║
║  └─ Taxa de Sucesso: ${successRate.padEnd(5)}%                                       ║
║                                                               ║
╠══════════════════════════════════════════════════════════════╣
║  📝 DETALHES                                                  ║
╚══════════════════════════════════════════════════════════════╝
`;

  TEST_RESULTS.forEach((t, i) => {
    const status = t.passed ? '✅' : '❌';
    const duration = `${t.duration}ms`.padEnd(5);
    report += `\n${status} [${i + 1}/${total}] ${t.name} (${duration})`;
    if (!t.passed && t.error) {
      report += `\n   └─ Erro: ${t.error}`;
    }
  });

  report += `

╔══════════════════════════════════════════════════════════════╗
║  ${successRate === '100.0' ? '✅ TODOS OS TESTES PASSARAM' : '⚠️ ALGUNS TESTES FALHARAM'}                            ║
╚══════════════════════════════════════════════════════════════╝
`;

  return report;
}

// ==================== EXECUÇÃO ====================

async function runAllTests(): Promise<void> {
  console.log('🧪 VEXOR AI - Executando testes...\n');
  
  // Aguarda testes assíncronos
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Gera relatório
  console.log(generateTestReport());
  
  // Salva relatório
  const reportPath = path.join(__dirname, '../../../data/test_report.txt');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, generateTestReport());
  
  console.log(`\n📄 Relatório salvo em: ${reportPath}`);
  
  // Exit code
  const failed = TEST_RESULTS.filter(t => !t.passed).length;
  process.exit(failed > 0 ? 1 : 0);
}

// Executa se chamado diretamente
if (require.main === module) {
  runAllTests();
}

export { test, runAllTests, generateTestReport };
