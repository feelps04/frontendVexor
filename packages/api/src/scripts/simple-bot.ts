// Bot Telegram MÍNIMO - Sem injeção de contexto, sem prompts customizados
import * as dotenv from 'dotenv';
dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID!;

let offset = 0;

async function getUpdates() {
  const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${offset}&timeout=30`);
  const data = await resp.json() as any;
  return data.result || [];
}

async function sendMessage(chatId: string, text: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text })
  });
}

async function callOllama(prompt: string): Promise<string> {
  try {
    const resp = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.1:8b',
        prompt: prompt,
        stream: false,
        system: 'REGRAS OBRIGATÓRIAS:\n1. NUNCA use saudações (Boa noite, Bom dia, Olá, Oi, etc)\n2. NUNCA use emojis\n3. NUNCA pergunte "E com você?" ou similar\n4. NUNCA diga "Tudo ótimo por aqui"\n5. Vá DIRETO ao assunto\n6. Se não souber, diga apenas "Não sei"\n7. Responda em português'
      })
    });
    const data = await resp.json() as any;
    return data.response || '';
  } catch (e) {
    return 'Erro ao conectar com Ollama';
  }
}

async function main() {
  console.log('🤖 Bot simples iniciado');
  
  while (true) {
    const updates = await getUpdates();
    
    for (const update of updates) {
      offset = update.update_id + 1;
      
      if (update.message?.text) {
        const text = update.message.text;
        const chatId = update.message.chat.id.toString();
        
        console.log(`📩 Recebido: ${text}`);
        
        // Chama Ollama DIRETAMENTE com o texto do usuário - SEM modificação
        const response = await callOllama(text);
        
        console.log(`📤 Enviando: ${response.slice(0, 100)}...`);
        await sendMessage(chatId, response);
        console.log(`✅ Enviado`);
      }
    }
    
    await new Promise(r => setTimeout(r, 100));
  }
}

main().catch(console.error);
