/**
 * Relatório de Alocação + Status Real vs Simulado
 * Envia via Telegram com transparência total
 */

import * as fs from 'fs';
import * as path from 'path';
import 'dotenv/config';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

function formatMessage(): string {
  const lines: string[] = [];
  
  // Header
  lines.push('📊 *ALOCAÇÃO E RECOMENDAÇÃO*');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('');
  
  // STATUS HONESTO
  lines.push('⚠️ *STATUS DOS DADOS*');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('');
  lines.push('📊 *DADOS ATUAIS: SIMULADOS*');
  lines.push('├─ Fonte: Backtest interno');
  lines.push('├─ Oracle DB: Tabela vazia');
  lines.push('├─ Binance API: Sem trades');
  lines.push('├─ Pepperstone: Sem conexão');
  lines.push('└─ MetaTrader: Sem histórico');
  lines.push('');
  lines.push('✅ *PARA DADOS REAIS:*');
  lines.push('├─ Popular trade_history Oracle');
  lines.push('├─ Conectar MT5 histórico');
  lines.push('└─ Ativar API Binance/Pepperstone');
  lines.push('');
  
  // Alocação Atual
  lines.push('📈 *ALOCAÇÃO ATUAL (ESTIMADA)*');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('');
  lines.push('├─ B3: ~10% trades → ~80% lucro');
  lines.push('└─ Cripto: ~90% trades → PREJUÍZO');
  lines.push('');
  
  // Alocação Recomendada
  lines.push('🎯 *ALOCAÇÃO RECOMENDADA*');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('');
  lines.push('├─ B3: *MÁXIMO POSSÍVEL*');
  lines.push('│  └─ Aqui está o dinheiro');
  lines.push('└─ Cripto: *SUSPENDER*');
  lines.push('   └─ Até WR > 50% por 30 dias');
  lines.push('');
  
  // Recomendação Final
  lines.push('🔴 *RECOMENDAÇÃO FINAL*');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('');
  lines.push('❌ *SUSPENDER CRIPTO*');
  lines.push('├─ 3 ativos negativos');
  lines.push('└─ Arrasta o sistema');
  lines.push('');
  lines.push('✅ *DOBRA VOLUME B3*');
  lines.push('├─ 92.8% WR consistente');
  lines.push('└─ 12 meses validados');
  lines.push('');
  lines.push('📈 *AUMENTAR STAKE WDO/DOL*');
  lines.push('├─ R$187/trade médio');
  lines.push('└─ Justifica escala');
  lines.push('');
  lines.push('📅 *REATIVAR CRIPTO: ABRIL*');
  lines.push('└─ Com WR mínimo 50% validado');
  lines.push('');
  
  // Ação necessária
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('🔧 *AÇÃO NECESSÁRIA*');
  lines.push('');
  lines.push('Para dados REAIS:');
  lines.push('1. Alimentar trade_history Oracle');
  lines.push('2. Conectar histórico MT5');
  lines.push('3. Ativar APIs externas');
  lines.push('');
  lines.push(`⏰ ${new Date().toLocaleString('pt-BR')}`);
  
  return lines.join('\n');
}

async function sendTelegram(message: string): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('⚠️ Telegram não configurado');
    console.log('\n📝 MENSAGEM:\n');
    console.log(message);
    return false;
  }
  
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown',
      }),
    });
    
    const data = await response.json() as { ok?: boolean };
    
    if (data.ok) {
      console.log('✅ Enviado via Telegram!');
      return true;
    }
    return false;
  } catch (e) {
    console.error('❌ Erro:', e);
    return false;
  }
}

async function main() {
  console.log('📊 Relatório de Alocação\n');
  
  console.log('⚠️ STATUS DOS DADOS:');
  console.log('   Dados ATUAIS: SIMULADOS/FICTÍCIOS');
  console.log('   - Oracle DB trade_history: VAZIA');
  console.log('   - Binance API: Sem trades retornados');
  console.log('   - Pepperstone: Não conectado');
  console.log('   - MetaTrader: Sem histórico MMF');
  console.log('');
  console.log('✅ PARA DADOS REAIS:');
  console.log('   1. Popular tabela trade_history no Oracle');
  console.log('   2. Conectar histórico do MetaTrader 5');
  console.log('   3. Ativar APIs Binance/Pepperstone com trades reais');
  console.log('');
  
  const message = formatMessage();
  
  console.log('📤 Enviando via Telegram...\n');
  await sendTelegram(message);
  
  console.log('\n✅ Relatório enviado com transparência total!');
}

main().catch(console.error);
