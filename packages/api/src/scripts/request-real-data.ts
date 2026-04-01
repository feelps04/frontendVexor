/**
 * Envia mensagem via Telegram solicitando dados reais
 */

import 'dotenv/config';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

async function sendTelegram(message: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('⚠️ Telegram não configurado');
    return;
  }
  
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'Markdown',
    }),
  });
  
  console.log('✅ Mensagem enviada via Telegram!');
}

async function main() {
  const message = `
📊 *VEXOR-ORACLE - DADOS REAIS*
━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ *TABELA LIMPA*
└─ Aguardando dados REAIS

📋 *PARA TER DADOS REAIS:*

1️⃣ *BINANCE*
├─ Acesse: binance.com → API Management
├─ Crie uma API Key
├─ Adicione no .env:
│  \`BINANCE_API_KEY=sua_key\`
│  \`BINANCE_SECRET_KEY=seu_secret\`
└─ Execute: \`node dist/scripts/fetch-real-trades-only.js\`

2️⃣ *METATRADER 5 (GENIAL/PEPPERSTONE)*
├─ Abra o MT5
├─ Arquivo → Salvar como relatório
├─ Salve em CSV ou JSON
├─ Copie para:
│  \`data/signals/genial/\`
│  \`data/signals/pepperstone/\`
└─ Execute: \`node dist/scripts/fetch-real-trades-only.js\`

3️⃣ *ORACLE DB*
└─ Tabela trade_history está VAZIA
   └─ Pronta para receber dados reais

━━━━━━━━━━━━━━━━━━━━━━━━━━
⏰ ${new Date().toLocaleString('pt-BR')}
`;

  console.log('📊 Enviando solicitação via Telegram...\n');
  await sendTelegram(message);
  console.log('\n✅ Mensagem enviada!');
}

main().catch(console.error);
