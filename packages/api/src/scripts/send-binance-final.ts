/**
 * Envia mensagem final sobre Binance API
 */

import * as fs from 'fs';
import { config } from 'dotenv';

const rootEnv = 'C:/Users/opc/CascadeProjects/vexor-Oracle/vexor-Oracle-main/.env';
if (fs.existsSync(rootEnv)) {
  config({ path: rootEnv, override: true });
}

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

async function sendFinal() {
  const message = `
🔴 *BINANCE API - AÇÃO NECESSÁRIA*
━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ *TESTES REALIZADOS:*
├─ Conexão: ✅ OK
├─ API Key: ✅ Reconhecida
├─ BTC Price: ✅ $67,315
└─ Assinatura: ❌ *INVÁLIDA*

━━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 *PROBLEMA IDENTIFICADO:*

A API Key **NÃO TEM** permissão de leitura.

━━━━━━━━━━━━━━━━━━━━━━━━━━

📝 *PASSO A PASSO:*

1️⃣ Acesse: *binance.com*
2️⃣ Menu: API Management
3️⃣ Clique em *Edit* na API Key
4️⃣ Marque:
   ✅ *Enable Reading*
   ✅ *Enable Spot & Margin Trading*
5️⃣ Clique em *Save Changes*
6️⃣ Aguarde 2-3 minutos

━━━━━━━━━━━━━━━━━━━━━━━━━━

🔄 *DEPOIS DE SALVAR:*
\`\`\`
node dist/scripts/test-binance-new-key.js
\`\`\`

⏰ ${new Date().toLocaleString('pt-BR')}
`;

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
  
  console.log('✅ Mensagem enviada!');
}

sendFinal().catch(console.error);
