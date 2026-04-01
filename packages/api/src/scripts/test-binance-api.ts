/**
 * Testa conexão Binance API e busca trades
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { config } from 'dotenv';

// Carrega .env do root
const rootEnv = 'C:/Users/opc/CascadeProjects/vexor-Oracle/vexor-Oracle-main/.env';
if (fs.existsSync(rootEnv)) {
  config({ path: rootEnv, override: true });
}

const BINANCE_API_KEY = process.env.BINANCE_API_KEY || '';
const BINANCE_SECRET_KEY = process.env.BINANCE_SECRET_KEY || '';

async function testBinance() {
  console.log('🔑 Testando Binance API...\n');
  console.log(`API Key: ${BINANCE_API_KEY.substring(0, 10)}...`);
  console.log(`Secret Length: ${BINANCE_SECRET_KEY.length} chars\n`);
  
  if (!BINANCE_API_KEY || !BINANCE_SECRET_KEY) {
    console.log('❌ Credenciais não configuradas');
    return;
  }
  
  // 1. Testa endpoint público (sem assinatura)
  console.log('📡 Testando conexão pública (ping)...');
  try {
    const ping = await fetch('https://api.binance.com/api/v3/ping');
    console.log(`   Status: ${ping.status} ${ping.ok ? '✅' : '❌'}`);
  } catch (e) {
    console.log('   ❌ Erro de conexão');
    return;
  }
  
  // 2. Pega serverTime para sincronização
  console.log('\n📡 Obtendo serverTime...');
  let serverTime: number;
  try {
    const timeResp = await fetch('https://api.binance.com/api/v3/time');
    const timeData = await timeResp.json() as { serverTime: number };
    serverTime = timeData.serverTime;
    console.log(`   Server Time: ${serverTime}`);
    console.log(`   Local Time: ${Date.now()}`);
    console.log(`   Diff: ${Date.now() - serverTime}ms`);
  } catch (e) {
    console.log('   ❌ Erro ao obter serverTime');
    return;
  }
  
  // 3. Verifica status da API
  console.log('\n📡 Verificando status da API (apiTradingStatus)...');
  try {
    const ts = serverTime;
    const qs = `timestamp=${ts}`;
    const sig = crypto.createHmac('sha256', BINANCE_SECRET_KEY).update(qs).digest('hex');
    
    const resp = await fetch(
      `https://api.binance.com/sapi/v1/account/apiTradingStatus?${qs}&signature=${sig}`,
      { headers: { 'X-MBX-APIKEY': BINANCE_API_KEY } }
    );
    const data = await resp.json() as any;
    console.log(`   Status: ${resp.status}`);
    if (resp.ok) {
      console.log(`   ✅ API Trading Status: ${JSON.stringify(data).substring(0, 200)}`);
    } else {
      console.log(`   ⚠️ ${JSON.stringify(data)}`);
    }
  } catch (e) {
    console.log('   ❌ Erro');
  }
  
  // 4. Usa serverTime sincronizado para assinatura
  console.log('\n📡 Testando account com serverTime SINCRONIZADO...');
  
  // Sincroniza com serverTime
  const timeResp2 = await fetch('https://api.binance.com/api/v3/time');
  const timeData2 = await timeResp2.json() as { serverTime: number };
  const syncServerTime = timeData2.serverTime;
  
  const queryString2 = `timestamp=${syncServerTime}&recvWindow=60000`;
  const signature2 = crypto
    .createHmac('sha256', BINANCE_SECRET_KEY)
    .update(queryString2)
    .digest('hex');
  
  console.log(`   Server Time: ${syncServerTime}`);
  console.log(`   Local Time: ${Date.now()}`);
  console.log(`   Query: ${queryString2}`);
  
  try {
    const response = await fetch(
      `https://api.binance.com/api/v3/account?${queryString2}&signature=${signature2}`,
      { headers: { 'X-MBX-APIKEY': BINANCE_API_KEY } }
    );
    
    const data = await response.json() as any;
    
    if (!response.ok) {
      console.log(`❌ Erro ${response.status}:`, JSON.stringify(data));
      return;
    }
    
    console.log('✅ Conexão OK!');
    console.log(`   Conta: ${data.accountType || 'SPOT'}`);
    
    // Balanços
    const balances = data.balances?.filter((b: any) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0) || [];
    console.log(`   Ativos com saldo: ${balances.length}`);
    
    for (const b of balances.slice(0, 10)) {
      console.log(`     ${b.asset}: ${b.free} (free) + ${b.locked} (locked)`);
    }
    
  } catch (e) {
    console.error('❌ Erro:', e);
  }
  
  // 2. Busca todos os trades (sem símbolo específico)
  console.log('\n📡 Buscando trades (myTrades sem símbolo)...');
  
  try {
    const ts = Date.now();
    const qs = `timestamp=${ts}`;
    const sig = crypto.createHmac('sha256', BINANCE_SECRET_KEY).update(qs).digest('hex');
    
    const resp = await fetch(
      `https://api.binance.com/api/v3/myTrades?${qs}&signature=${sig}`,
      { headers: { 'X-MBX-APIKEY': BINANCE_API_KEY } }
    );
    
    const trades = await resp.json() as any;
    
    if (!resp.ok) {
      console.log(`⚠️ myTrades sem símbolo: ${resp.status}`, trades);
    } else {
      console.log(`✅ Trades encontrados: ${Array.isArray(trades) ? trades.length : 0}`);
    }
    
  } catch (e) {
    console.error('❌ Erro trades:', e);
  }
  
  // 3. Busca por símbolos específicos
  console.log('\n📡 Buscando trades por símbolo...');
  
  const symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];
  
  for (const symbol of symbols) {
    try {
      const ts = Date.now();
      const qs = `symbol=${symbol}&timestamp=${ts}`;
      const sig = crypto.createHmac('sha256', BINANCE_SECRET_KEY).update(qs).digest('hex');
      
      const resp = await fetch(
        `https://api.binance.com/api/v3/myTrades?${qs}&signature=${sig}`,
        { headers: { 'X-MBX-APIKEY': BINANCE_API_KEY } }
      );
      
      const trades = await resp.json() as any[];
      
      if (resp.ok && trades?.length > 0) {
        console.log(`✅ ${symbol}: ${trades.length} trades`);
        
        for (const t of trades.slice(0, 3)) {
          console.log(`   ID: ${t.id} | PnL: ${t.realizedPnl} | Time: ${new Date(t.time).toLocaleString()}`);
        }
      } else {
        console.log(`⚠️ ${symbol}: ${resp.status} - ${JSON.stringify(trades).substring(0, 100)}`);
      }
      
    } catch (e) {
      console.log(`❌ ${symbol}: Erro`);
    }
  }
}

testBinance().catch(console.error);
