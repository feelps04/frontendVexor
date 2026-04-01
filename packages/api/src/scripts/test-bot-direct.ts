// Bot Telegram de Teste - Chat direto com Ollama
const BOT_TOKEN = '8710971540:AAGs15wUAxx_964NKuEKwL31jTb_mdZ0Kao';
const CHAT_ID = '7192227673';

let offset = 0;
const processedIds = new Set<number>();

async function getUpdates() {
  const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${offset}&timeout=30`);
  const data = await resp.json();
  return data.result || [];
}

async function sendMessage(text: string) {
  console.log(`📤 ENVIANDO: ${text}`);
  const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text })
  });
  const data = await resp.json();
  console.log(`✅ Enviado:`, data.ok);
  return data;
}

async function callOllama(prompt: string): Promise<string> {
  console.log(`🤖 OLLAMA PROCESSANDO: "${prompt}"`);
  
  const resp = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama3.1:8b',
      prompt: prompt,
      system: `REGRAS OBRIGATÓRIAS:
1. NUNCA use saudações (Boa noite, Bom dia, Olá, Oi, E aí)
2. NUNCA use emojis (👋 😊 📊 etc)
3. NUNCA diga "Tudo ótimo por aqui" ou "E com você?"
4. Vá DIRETO ao assunto
5. Máximo 2 frases
6. Responda em português`,
      stream: false
    })
  });
  
  const data = await resp.json() as any;
  const response = data.response || '';
  console.log(`💭 RESPOSTA OLLAMA: "${response.slice(0, 100)}..."`);
  return response;
}

async function main() {
  console.log('🤖 Bot de teste iniciado - aguardando mensagens...');
  console.log(`📌 Chat ID: ${CHAT_ID}`);
  
  // Loop principal
  while (true) {
    try {
      const updates = await getUpdates();
      
      for (const update of updates) {
        const updateId = update.update_id;
        
        // Pula se já processou
        if (processedIds.has(updateId)) {
          continue;
        }
        processedIds.add(updateId);
        
        // Atualiza offset
        offset = updateId + 1;
        
        if (update.message?.text) {
          const text = update.message.text;
          const from = update.message.from?.first_name || 'Usuário';
          const chatId = update.message.chat.id.toString();
          
          console.log(`\n📩 RECEBIDO de ${from}: "${text}" (ID: ${updateId})`);
          
          // Só responde se for do chat correto
          if (chatId === CHAT_ID) {
            // Chama Ollama
            const response = await callOllama(text);
            
            // Envia resposta
            if (response.trim()) {
              await sendMessage(response);
            } else {
              await sendMessage('Não entendi. Tente novamente.');
            }
          } else {
            console.log(`⚠️ Chat ignorado: ${chatId}`);
          }
        }
      }
      
      // Pequena pausa
      await new Promise(r => setTimeout(r, 100));
      
    } catch (error) {
      console.error('❌ Erro:', error);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

main().catch(console.error);
