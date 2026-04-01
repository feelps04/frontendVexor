/**
 * Envia instruções sobre permissões Binance via Telegram
 */

import * as fs from 'fs';
import { config } from 'dotenv';

const rootEnv = 'C:/Users/opc/CascadeProjects/vexor-Oracle/vexor-Oracle-main/.env';
if (fs.existsSync(rootEnv)) {
  config({ path: rootEnv, override: true });
}

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

async function sendPermissionsHelp() {
  const message = `
⚠️ *BINANCE API - ASSINATURA INVÁLIDA*
━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ *CREDENCIAIS CONFIRMADAS:*
├─ API Key: ✅ Correta
├─ Secret Key: ✅ Correta
└─ Withdrawals: ✅ Desabilitado

❌ *ERRO PERSISTENTE:*
└─ Signature not valid

📋 *PERMISSÕES NECESSÁRIAS:*

Acesse: binance.com → API Management

Edite sua API Key e habilite:

✅ *Enable Reading*
└─ Permite ler saldo e trades

✅ *Enable Spot & Margin Trading*
└─ Permite operar na conta

❌ *Withdrawals*
└─ Mantenha DESABILITADO

━━━━━━━━━━━━━━━━━━━━━━━━━━

🔧 *OUTRAS VERIFICAÇÕES:*

1️⃣ *IP Restriction*
├─ Deixe vazio para aceitar qualquer IP
└─ Ou adicione seu IP atual

2️⃣ *Tempo de ativação*
├─ Se criou a API Key agora
└─ Aguarde 5-10 minutos

3️⃣ *Conta verificada?*
├─ A conta precisa estar verificada (KYC)
└─ Para usar a API

━━━━━━━━━━━━━━━━━━━━━━━━━━

🔄 *APÓS CONFIGURAR:*
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
  
  console.log('✅ Mensagem enviada via Telegram!');
}

sendPermissionsHelp().catch(console.error);
