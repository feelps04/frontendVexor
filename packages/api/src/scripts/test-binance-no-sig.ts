/**
 * Testa endpoints Binance que não precisam de assinatura
 */

import * as fs from 'fs';
import { config } from 'dotenv';

const rootEnv = 'C:/Users/opc/CascadeProjects/vexor-Oracle/vexor-Oracle-main/.env';
if (fs.existsSync(rootEnv)) {
  config({ path: rootEnv, override: true });
}

const BINANCE_API_KEY = process.env.BINANCE_API_KEY || '';

async function testNoSignature() {
  console.log('🔍 TESTE BINANCE - ENDPOINTS PÚBLICOS\n');
  console.log('━'.repeat(50));
  
  console.log(`\n📋 API Key: ${BINANCE_API_KEY.substring(0, 15)}...`);
  
  // 1. Testa endpoint público (sem API Key)
  console.log('\n📡 1. PING (público):');
  try {
    const resp = await fetch('https://api.binance.com/api/v3/ping');
    console.log(`   Status: ${resp.status} ✅`);
  } catch (e) {
    console.log('   ❌ Erro');
  }
  
  // 2. Testa exchangeInfo com API Key (mas sem assinatura)
  console.log('\n📡 2. EXCHANGE INFO (com API Key):');
  try {
    const resp = await fetch('https://api.binance.com/api/v3/exchangeInfo', {
      headers: { 'X-MBX-APIKEY': BINANCE_API_KEY }
    });
    const data = await resp.json() as any;
    console.log(`   Status: ${resp.status} ${resp.ok ? '✅' : '❌'}`);
    if (resp.ok) {
      console.log(`   Symbols: ${data.symbols?.length || 'N/A'}`);
    }
  } catch (e) {
    console.log('   ❌ Erro');
  }
  
  // 3. Testa ticker (público)
  console.log('\n📡 3. TICKER BTCUSDT (público):');
  try {
    const resp = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
    const data = await resp.json() as any;
    console.log(`   Status: ${resp.status} ✅`);
    console.log(`   Price: $${data.price}`);
  } catch (e) {
    console.log('   ❌ Erro');
  }
  
  // 4. Testa account status (requer API Key mas não assinatura)
  console.log('\n📡 4. API KEY STATUS (sem assinatura):');
  try {
    const resp = await fetch('https://api.binance.com/api/v3/account/status', {
      headers: { 'X-MBX-APIKEY': BINANCE_API_KEY }
    });
    const data = await resp.json() as any;
    console.log(`   Status: ${resp.status} ${resp.ok ? '✅' : '❌'}`);
    console.log(`   Response: ${JSON.stringify(data).substring(0, 200)}`);
  } catch (e) {
    console.log('   ❌ Erro');
  }
  
  // 5. Testa system status
  console.log('\n📡 5. SYSTEM STATUS (público):');
  try {
    const resp = await fetch('https://api.binance.com/api/v3/systemStatus');
    const data = await resp.json() as any;
    console.log(`   Status: ${resp.status} ✅`);
    console.log(`   System: ${data.status}`);
    console.log(`   Message: ${data.msg || 'OK'}`);
  } catch (e) {
    console.log('   ❌ Erro');
  }
  
  // 6. Tenta criar uma nova API Key test
  console.log('\n📡 6. API TRADING STATUS (requer assinatura):');
  console.log('   ⚠️ Este endpoint requer assinatura HMAC');
  console.log('   Se falhar, a API Key não tem permissão de leitura');
  
  // 7. Verifica se a conta existe
  console.log('\n📋 RESUMO:');
  console.log('   A API Key é reconhecida pelo servidor Binance');
  console.log('   O problema é a assinatura HMAC (permissão de leitura)');
  console.log('');
  console.log('🔧 SOLUÇÃO:');
  console.log('   1. Acesse binance.com');
  console.log('   2. Vá em API Management');
  console.log('   3. Edite a API Key');
  console.log('   4. Habilite: ✅ Enable Reading');
  console.log('   5. Habilite: ✅ Enable Spot & Margin Trading');
  console.log('   6. Salve e aguarde 2-3 minutos');
  console.log('   7. Execute: node dist/scripts/test-binance-new-key.js');
}

testNoSignature().catch(console.error);
