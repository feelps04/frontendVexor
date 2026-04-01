/**
 * Envia ajuda via Telegram sobre configuração Binance
 */

import * as fs from 'fs';
import { config } from 'dotenv';

const rootEnv = 'C:/Users/opc/CascadeProjects/vexor-Oracle/vexor-Oracle-main/.env';
if (fs.existsSync(rootEnv)) {
  config({ path: rootEnv, override: true });
}

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

async function sendHelp() {
  const message = `
⚠️ *BINANCE API - ERRO DE ASSINATURA*
━━━━━━━━━━━━━━━━━━━━━━━━━━

❌ Erro: \`Signature for this request is not valid\`

📋 *POSSÍVEIS CAUSAS:*

1️⃣ *API Key sem permissões*
├─ Acesse: binance.com → API Management
├─ Edite sua API Key
├─ Habilite: ✅ *Enable Reading*
├─ Habilite: ✅ *Enable Spot & Margin Trading*
└─ Desabilite: ❌ Withdrawals

2️⃣ *IP não autorizado*
├─ Na mesma página, adicione seu IP
└─ Ou deixe em branco (qualquer IP)

3️⃣ *Secret Key incorreta*
├─ Copie novamente o Secret Key
├─ Cole no .env sem espaços
└─ Reinicie o script

━━━━━━━━━━━━━━━━━━━━━━━━━━

🔧 *TESTE APÓS CORRIGIR:*
\`\`\`
node dist/scripts/test-binance-api.js
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
  
  console.log('✅ Mensagem de ajuda enviada via Telegram!');
}

sendHelp().catch(console.error);
