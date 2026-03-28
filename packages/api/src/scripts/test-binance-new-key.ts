/**
 * Testa Binance API - verifica se a Secret Key está correta
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

async function testWithNewKey() {
  console.log('🔍 TESTE BINANCE - VERIFICAÇÃO DE CHAVES\n');
  console.log('━'.repeat(50));
  
  // Mostra exatamente o que está no .env
  console.log('\n📋 VALORES DO .ENV:');
  console.log(`API Key raw: "${BINANCE_API_KEY}"`);
  console.log(`API Key length: ${BINANCE_API_KEY.length}`);
  console.log(`Secret Key raw: "${BINANCE_SECRET_KEY}"`);
  console.log(`Secret Key length: ${BINANCE_SECRET_KEY.length}`);
  
  // Verifica se há caracteres invisíveis
  console.log('\n🔬 ANÁLISE DA SECRET KEY:');
  for (let i = 0; i < Math.min(10, BINANCE_SECRET_KEY.length); i++) {
    const char = BINANCE_SECRET_KEY[i];
    const code = char.charCodeAt(0);
    console.log(`   [${i}] "${char}" (code: ${code})`);
  }
  console.log('   ...');
  for (let i = Math.max(0, BINANCE_SECRET_KEY.length - 5); i < BINANCE_SECRET_KEY.length; i++) {
    const char = BINANCE_SECRET_KEY[i];
    const code = char.charCodeAt(0);
    console.log(`   [${i}] "${char}" (code: ${code})`);
  }
  
  // Testa com serverTime sincronizado
  console.log('\n📡 TESTE COM SERVER TIME:');
  
  try {
    // Pega serverTime
    const timeResp = await fetch('https://api.binance.com/api/v3/time');
    const timeData = await timeResp.json() as { serverTime: number };
    const serverTime = timeData.serverTime;
    
    console.log(`   Server Time: ${serverTime}`);
    console.log(`   Local Time: ${Date.now()}`);
    
    // Usa serverTime para a requisição
    const queryString = `timestamp=${serverTime}&recvWindow=60000`;
    const signature = crypto
      .createHmac('sha256', BINANCE_SECRET_KEY)
      .update(queryString)
      .digest('hex');
    
    console.log(`   Query: ${queryString}`);
    console.log(`   Signature: ${signature}`);
    
    const url = `https://api.binance.com/api/v3/account?${queryString}&signature=${signature}`;
    
    const resp = await fetch(url, {
      headers: { 'X-MBX-APIKEY': BINANCE_API_KEY }
    });
    
    const data = await resp.json() as any;
    
    if (resp.ok) {
      console.log(`\n✅ SUCESSO! Status: ${resp.status}`);
      console.log(`   Conta: ${data.accountType}`);
      
      const balances = data.balances?.filter((b: any) => 
        parseFloat(b.free) > 0 || parseFloat(b.locked) > 0
      ) || [];
      
      console.log(`   Ativos: ${balances.length}`);
      for (const b of balances) {
        console.log(`     ${b.asset}: ${b.free}`);
      }
      
      // Busca trades
      await fetchMyTrades(serverTime);
      
    } else {
      console.log(`\n❌ ERRO ${resp.status}: ${JSON.stringify(data)}`);
      
      // Tenta com a chave fornecida diretamente pelo usuário
      console.log('\n🔄 TENTANDO COM CHAVE MANUAL:');
      console.log('   As chaves foram fornecidas pelo usuário:');
      console.log('   API Key: Y4s7XrZyGGaPPmMauhCoLCel56LfsRnAIPL8ivl1NrbU88TaKz80ak2UUNrxN0yQ');
      console.log('   Secret: qLZ8yJKOo1gZZnaxEFtNulsmgk9pVbriihWIuZllCBRfxqcKLKLn3osIJtOIZn0e');
      
      // Verifica se as chaves do .env são iguais às fornecidas
      const expectedKey = 'Y4s7XrZyGGaPPmMauhCoLCel56LfsRnAIPL8ivl1NrbU88TaKz80ak2UUNrxN0yQ';
      const expectedSecret = 'qLZ8yJKOo1gZZnaxEFtNulsmgk9pVbriihWIuZllCBRfxqcKLKLn3osIJtOIZn0e';
      
      console.log(`\n   API Key confere: ${BINANCE_API_KEY === expectedKey ? '✅ SIM' : '❌ NÃO'}`);
      console.log(`   Secret Key confere: ${BINANCE_SECRET_KEY === expectedSecret ? '✅ SIM' : '❌ NÃO'}`);
      
      if (BINANCE_SECRET_KEY !== expectedSecret) {
        console.log('\n   ⚠️ DIFERENÇA ENCONTRADA!');
        console.log(`   .env tem: "${BINANCE_SECRET_KEY}"`);
        console.log(`   Esperado: "${expectedSecret}"`);
      }
    }
    
  } catch (e) {
    console.error('❌ Erro:', e);
  }
}

async function fetchMyTrades(serverTime: number) {
  console.log('\n📊 BUSCANDO TRADES:');
  
  const symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];
  let totalTrades = 0;
  
  for (const symbol of symbols) {
    const queryString = `symbol=${symbol}&timestamp=${serverTime}&recvWindow=60000`;
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
          
          for (const t of trades.slice(0, 3)) {
            console.log(`      ID: ${t.id} | PnL: ${t.realizedPnl} | ${new Date(t.time).toLocaleString()}`);
          }
        }
      }
    } catch (e) {
      // Ignora
    }
  }
  
  console.log(`\n📊 Total: ${totalTrades} trades`);
}

testWithNewKey().catch(console.error);
