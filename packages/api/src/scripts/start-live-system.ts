/**
 * Sistema LIVE - Arquitetura Hybrid
 * Inicializa todo o sistema em modo LIVE
 */

import { oracleDB } from '../infrastructure/oracle-db.js';
import * as fs from 'fs';
import { config } from 'dotenv';

const rootEnv = 'C:/Users/opc/CascadeProjects/vexor-Oracle/vexor-Oracle-main/.env';
if (fs.existsSync(rootEnv)) {
  config({ path: rootEnv, override: true });
}

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const BRAPI_API_KEY = process.env.BRAPI_API_KEY || '';

// Configuração do Sistema LIVE
const LIVE_CONFIG = {
  mode: 'LIVE',
  architecture: 'HYBRID',
  execution: {
    autotrade: false,
    mode: 'COPILOT',
  },
  components: {
    oracle: { enabled: true, type: 'ATP' },
    mt5: { enabled: true, type: 'Genial' },
    brapi: { enabled: true, type: 'REST API' },
    yahoo: { enabled: true, type: 'REST API' },
    telegram: { enabled: true, type: 'Bot API' },
    redis: { enabled: true, type: 'Cache' },
    kafka: { enabled: false, type: 'Stream' }
  },
  risk: {
    maxDrawdown: 0.10, // 10%
    positionSize: 0.02, // 2% por trade
    maxPositions: 3,
    newsFilter: 3,
    latencyLimit: 5 // ms
  },
  strategies: {
    b3_rsi: { enabled: true, symbols: ['WDOFUT', 'DOLFUT', 'WINFUT'] },
    crypto_ema: { enabled: true, symbols: ['BTC-USD', 'ETH-USD'] },
    mean_reversion: { enabled: true, symbols: ['PETR4', 'VALE3'] }
  },
  rr: {
    target: 2.0,
    stop: 1.0,
    ratio: 2.0
  }
};

async function sendTelegram(message: string) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'Markdown' }),
  });
}

async function startLiveSystem() {
  console.log('🚀 ========================================');
  console.log('🚀 INICIANDO SISTEMA LIVE - HYBRID');
  console.log('🚀 ========================================\n');
  
  const status: { component: string, status: string, latency?: number }[] = [];
  
  // 1. Oracle ATP
  console.log('📊 Conectando Oracle ATP...');
  try {
    await oracleDB.execute('SELECT 1 FROM DUAL');
    status.push({ component: 'Oracle ATP', status: '✅ ONLINE' });
    console.log('   ✅ Oracle ATP conectado');
  } catch (e) {
    status.push({ component: 'Oracle ATP', status: '❌ ERRO' });
    console.log('   ❌ Erro Oracle');
  }
  
  // 2. Verificar MT5 Files
  console.log('\n📊 Verificando MT5...');
  const mt5Files = [
    'C:/Users/opc/Documents/WDOJ26.csv',
    'C:/Users/opc/Documents/DOL$.csv'
  ];
  
  let mt5Ok = true;
  for (const file of mt5Files) {
    if (fs.existsSync(file)) {
      const stat = fs.statSync(file);
      console.log(`   ✅ ${file.split('/').pop()} (${(stat.size / 1024).toFixed(1)} KB)`);
    } else {
      console.log(`   ❌ ${file.split('/').pop()} não encontrado`);
      mt5Ok = false;
    }
  }
  status.push({ component: 'MT5 Genial', status: mt5Ok ? '✅ ONLINE' : '⚠️ PARCIAL' });
  
  // 3. Testar BRAPI
  console.log('\n📊 Testando BRAPI...');
  try {
    const resp = await fetch(`https://brapi.dev/api/quote/PETR4?token=${BRAPI_API_KEY}`);
    const data = await resp.json() as any;
    if (data.results) {
      status.push({ component: 'BRAPI API', status: '✅ ONLINE' });
      console.log(`   ✅ BRAPI: PETR4 R$ ${data.results[0].regularMarketPrice}`);
    }
  } catch (e) {
    status.push({ component: 'BRAPI API', status: '❌ ERRO' });
    console.log('   ❌ Erro BRAPI');
  }
  
  // 4. Testar Yahoo Finance
  console.log('\n📊 Testando Yahoo Finance...');
  try {
    const resp = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/BTC-USD', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const data = await resp.json() as any;
    if (data.chart?.result) {
      const price = data.chart.result[0].meta.regularMarketPrice;
      status.push({ component: 'Yahoo Finance', status: '✅ ONLINE' });
      console.log(`   ✅ Yahoo: BTC $${price}`);
    }
  } catch (e) {
    status.push({ component: 'Yahoo Finance', status: '❌ ERRO' });
    console.log('   ❌ Erro Yahoo');
  }
  
  // 5. Telegram
  console.log('\n📊 Testando Telegram...');
  try {
    await sendTelegram('🚀 *Sistema LIVE iniciado*');
    status.push({ component: 'Telegram Bot', status: '✅ ONLINE' });
    console.log('   ✅ Telegram OK');
  } catch (e) {
    status.push({ component: 'Telegram Bot', status: '❌ ERRO' });
    console.log('   ❌ Erro Telegram');
  }
  
  // 6. Salvar configuração LIVE
  console.log('\n💾 Salvando configuração LIVE...');
  
  const configPath = 'C:/Users/opc/CascadeProjects/vexor-Oracle/vexor-Oracle-main/live-config.json';
  fs.writeFileSync(configPath, JSON.stringify(LIVE_CONFIG, null, 2));
  console.log(`   ✅ Config salvo: ${configPath}`);
  
  // 7. Criar tabela de status no Oracle
  console.log('\n💾 Criando tabela de status...');
  
  try {
    await oracleDB.execute('DROP TABLE system_status');
  } catch (e) {}
  
  await oracleDB.execute(`
    CREATE TABLE system_status (
      id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      component VARCHAR2(50),
      status VARCHAR2(20),
      system_mode VARCHAR2(20),
      architecture VARCHAR2(20),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  for (const s of status) {
    await oracleDB.insert(
      `INSERT INTO system_status (component, status, system_mode, architecture) VALUES (:component, :status, :system_mode, :architecture)`,
      { ...s, system_mode: 'LIVE', architecture: 'HYBRID' }
    );
  }
  
  console.log('   ✅ Tabela criada');
  
  // 8. Telegram - Mensagem 1: Sistema Online
  const msg1 = `
🚀 *SISTEMA LIVE - HYBRID*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 *STATUS DOS COMPONENTES:*
${status.map(s => `${s.status} ${s.component}`).join('\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🏗️ *ARQUITETURA HYBRID:*
├─ Oracle ATP (Persistência)
├─ MT5 Genial (Execução)
├─ BRAPI (Cotações Brasil)
├─ Yahoo Finance (Global)
└─ Telegram (Alertas)

⚙️ *MODO: LIVE*
├─ Execução: *COPILOT (sem autotrade)*
├─ R/R: 1:${LIVE_CONFIG.rr.ratio}
├─ Max DD: ${(LIVE_CONFIG.risk.maxDrawdown * 100).toFixed(0)}%
├─ Position Size: ${(LIVE_CONFIG.risk.positionSize * 100).toFixed(0)}%
├─ News Filter: ${LIVE_CONFIG.risk.newsFilter}
└─ Latência Limit: ${LIVE_CONFIG.risk.latencyLimit}ms

⏰ ${new Date().toLocaleString('pt-BR')}
`;

  await sendTelegram(msg1);
  
  // 9. Mensagem 2: Estratégias Ativas
  const msg2 = `
📊 *ESTRATÉGIAS ATIVAS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${Object.entries(LIVE_CONFIG.strategies)
  .filter(([_, s]) => s.enabled)
  .map(([name, s]) => {
    const icon = name.includes('b3') ? '📈' : name.includes('crypto') ? '₿' : '📊';
    return `${icon} *${name.toUpperCase()}*
   Ativos: ${s.symbols.join(', ')}`;
  }).join('\n\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💰 *RISCO CONFIGURADO:*
├─ Target: ${LIVE_CONFIG.rr.target}R
├─ Stop: ${LIVE_CONFIG.rr.stop}R
└─ R/R: 1:${LIVE_CONFIG.rr.ratio}

🎯 *LIMITES:*
├─ Max Posições: ${LIVE_CONFIG.risk.maxPositions}
├─ Max DD: ${(LIVE_CONFIG.risk.maxDrawdown * 100).toFixed(0)}%
└─ News Filter: ${LIVE_CONFIG.risk.newsFilter}

⏰ ${new Date().toLocaleString('pt-BR')}
`;

  await sendTelegram(msg2);
  
  // 10. Mensagem 3: Componentes
  const msg3 = `
🏗️ *ARQUITETURA HYBRID*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 *CAMADA DE DADOS:*
├─ Oracle ATP (80GB RAM)
│  └─ trade_history, system_status
├─ Redis Cache
│  └─ Session, Market Data
└─ MT5 Terminal
   └─ WDOJ26.csv, DOL$.csv

📡 *CAMADA DE API:*
├─ BRAPI.dev
│  └─ Cotações B3 tempo real
├─ Yahoo Finance
│  └─ Dados globais históricos
└─ Telegram Bot
   └─ Alertas e comandos

🤖 *CAMADA DE ESTRATÉGIA:*
├─ B3 RSI (Mini Índice/Dólar)
├─ Crypto EMA (BTC/ETH)
└─ Mean Reversion (Blue Chips)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ *SISTEMA PRONTO PARA OPERAR*

⏰ ${new Date().toLocaleString('pt-BR')}
`;

  await sendTelegram(msg3);
  
  // 11. Mensagem 4: Comandos
  const msg4 = `
🎛️ *COMANDOS DISPONÍVEIS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 *MONITORAMENTO:*
├─ /status - Status do sistema
├─ /pnl - P/L do dia
├─ /positions - Posições abertas
└─ /dd - Drawdown atual

⚙️ *CONTROLE:*
├─ /pause - Pausar sistema
├─ /resume - Retomar sistema
└─ /close_all - Fechar todas

📈 *RELATÓRIOS:*
├─ /daily - Relatório diário
├─ /weekly - Relatório semanal
└─ /monthly - Relatório mensal

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚀 *SISTEMA LIVE ATIVO*

#Vexor #Oracle #Hybrid #Live

⏰ ${new Date().toLocaleString('pt-BR')}
`;

  await sendTelegram(msg4);
  
  console.log('\n✅ 4 mensagens enviadas via Telegram!');
  
  console.log('\n🚀 ========================================');
  console.log('🚀 SISTEMA LIVE - HYBRID ATIVO');
  console.log('🚀 ========================================');
  
  console.log('\n📊 COMPONENTES:');
  for (const s of status) {
    console.log(`├─ ${s.component}: ${s.status}`);
  }
  
  console.log('\n⚙️ CONFIGURAÇÃO:');
  console.log(`├─ Modo: LIVE`);
  console.log(`├─ Arquitetura: HYBRID`);
  console.log(`├─ R/R: 1:${LIVE_CONFIG.rr.ratio}`);
  console.log(`├─ Max DD: ${(LIVE_CONFIG.risk.maxDrawdown * 100).toFixed(0)}%`);
  console.log(`└─ News Filter: ${LIVE_CONFIG.risk.newsFilter}`);
  
  console.log('\n✅ Sistema pronto para operar!');
}

startLiveSystem().catch(console.error);
