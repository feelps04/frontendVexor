/**
 * Testa Binance API com debug detalhado
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import { config } from 'dotenv';

const rootEnv = 'C:/Users/opc/CascadeProjects/vexor-Oracle/vexor-Oracle-main/.env';
if (fs.existsSync(rootEnv)) {
  config({ path: rootEnv, override: true });
}

const BINANCE_API_KEY = process.env.BINANCE_API_KEY || '';
const BINANCE_SECRET_KEY = process.env.BINANCE_SECRET_KEY || '';

async function testDetailed() {
  console.log('🔍 TESTE DETALHADO BINANCE API\n');
  console.log('━'.repeat(50));
  
  // 1. Verifica credenciais
  console.log('\n📋 CREDENCIAIS:');
  console.log(`API Key: ${BINANCE_API_KEY}`);
  console.log(`API Key Length: ${BINANCE_API_KEY.length}`);
  console.log(`Secret Key: ${BINANCE_SECRET_KEY.substring(0, 20)}...`);
  console.log(`Secret Key Length: ${BINANCE_SECRET_KEY.length}`);
  
  // Verifica caracteres especiais
  const hasNewline = BINANCE_SECRET_KEY.includes('\n') || BINANCE_SECRET_KEY.includes('\r');
  const hasSpace = BINANCE_SECRET_KEY.includes(' ');
  const hasTab = BINANCE_SECRET_KEY.includes('\t');
  console.log(`\n⚠️ Caracteres especiais:`);
  console.log(`   Newlines: ${hasNewline ? '❌ SIM' : '✅ NÃO'}`);
  console.log(`   Espaços: ${hasSpace ? '❌ SIM' : '✅ NÃO'}`);
  console.log(`   Tabs: ${hasTab ? '❌ SIM' : '✅ NÃO'}`);
  
  // 2. Testa endpoint público
  console.log('\n📡 TESTE PÚBLICO (sem assinatura):');
  try {
    const ping = await fetch('https://api.binance.com/api/v3/ping');
    console.log(`   Ping: ${ping.status} ✅`);
    
    const time = await fetch('https://api.binance.com/api/v3/time');
    const timeData = await time.json() as { serverTime: number };
    console.log(`   Server Time: ${timeData.serverTime} ✅`);
  } catch (e) {
    console.log('   ❌ Erro de conexão');
    return;
  }
  
  // 3. Testa API Key (endpoint que aceita apenas API Key, sem assinatura)
  console.log('\n📡 TESTE API KEY (sem assinatura):');
  
  // API Key Status - não precisa de assinatura
  try {
    const resp = await fetch('https://api.binance.com/api/v3/exchangeInfo', {
      headers: { 'X-MBX-APIKEY': BINANCE_API_KEY }
    });
    console.log(`   exchangeInfo: ${resp.status} ${resp.ok ? '✅' : '❌'}`);
  } catch (e) {
    console.log('   ❌ Erro');
  }
  
  // 4. Gera assinatura manualmente para debug
  console.log('\n🔐 TESTE DE ASSINATURA:');
  
  const timestamp = Date.now();
  const queryString = `timestamp=${timestamp}`;
  
  console.log(`   Query String: "${queryString}"`);
  console.log(`   Query Length: ${queryString.length}`);
  
  // Cria HMAC SHA256
  const hmac = crypto.createHmac('sha256', BINANCE_SECRET_KEY);
  hmac.update(queryString);
  const signature = hmac.digest('hex');
  
  console.log(`   Signature: ${signature}`);
  console.log(`   Signature Length: ${signature.length}`);
  
  // 5. Testa account com a assinatura
  console.log('\n📡 TESTE ACCOUNT:');
  const url = `https://api.binance.com/api/v3/account?${queryString}&signature=${signature}`;
  console.log(`   URL: ${url.substring(0, 80)}...`);
  
  try {
    const resp = await fetch(url, {
      headers: { 
        'X-MBX-APIKEY': BINANCE_API_KEY,
        'Content-Type': 'application/json'
      }
    });
    
    const data = await resp.json() as any;
    
    if (resp.ok) {
      console.log(`   Status: ${resp.status} ✅`);
      console.log(`   Conta: ${data.accountType || 'SPOT'}`);
      
      const balances = data.balances?.filter((b: any) => 
        parseFloat(b.free) > 0 || parseFloat(b.locked) > 0
      ) || [];
      
      console.log(`   Ativos: ${balances.length}`);
      for (const b of balances.slice(0, 10)) {
        console.log(`     ${b.asset}: ${b.free}`);
      }
      
      // Busca trades
      console.log('\n📊 BUSCANDO TRADES:');
      await fetchTrades();
      
    } else {
      console.log(`   Status: ${resp.status} ❌`);
      console.log(`   Erro: ${JSON.stringify(data)}`);
      
      // Diagnóstico
      console.log('\n🔧 DIAGNÓSTICO:');
      if (data.code === -1022) {
        console.log('   ❌ Assinatura inválida');
        console.log('   Possíveis causas:');
        console.log('   1. Secret Key incorreta');
        console.log('   2. API Key não tem permissão de leitura');
        console.log('   3. IP não autorizado');
        console.log('   4. API Key criada recentemente (aguardar 5 min)');
      } else if (data.code === -2015) {
        console.log('   ❌ API Key não tem permissão');
        console.log('   Habilite: Enable Reading');
      }
    }
    
  } catch (e) {
    console.log('   ❌ Erro:', e);
  }
}

async function fetchTrades() {
  const symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];
  let totalTrades = 0;
  
  for (const symbol of symbols) {
    const timestamp = Date.now();
    const queryString = `symbol=${symbol}&timestamp=${timestamp}`;
    const signature = crypto
      .createHmac('sha256', BINANCE_SECRET_KEY)
      .update(queryString)
      .digest('hex');
    
    const url = `https://api.binance.com/api/v3/myTrades?${queryString}&signature=${signature}`;
    
    try {
      const resp = await fetch(url, {
        headers: { 'X-MBX-APIKEY': BINANCE_API_KEY }
      });
      
      if (resp.ok) {
        const trades = await resp.json() as any[];
        if (trades.length > 0) {
          console.log(`   ✅ ${symbol}: ${trades.length} trades`);
          totalTrades += trades.length;
        }
      }
    } catch (e) {
      // Ignora
    }
  }
  
  if (totalTrades > 0) {
    console.log(`\n📊 Total: ${totalTrades} trades encontrados!`);
  } else {
    console.log('\n⚠️ Nenhum trade encontrado');
  }
}

testDetailed().catch(console.error);
