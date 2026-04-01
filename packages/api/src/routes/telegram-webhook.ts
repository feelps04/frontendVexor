/**
 * Telegram Webhook
 * Captures chat_id when user starts conversation with bot
 * Integrates with Ollama for AI responses
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { telegramNotifier } from '../infrastructure/telegram-notifier.js';
import { oracleDB } from '../infrastructure/oracle-db.js';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const USE_GEMINI = process.env.USE_GEMINI === 'true' || !GEMINI_API_KEY; // Default to Ollama if no key

const PUBLIC_APP_URL = (process.env.PUBLIC_APP_URL || 'http://127.0.0.1:5173').replace(/\/$/, '');
/** URL pública da API (webhook Telegram). Em local use túnel (ngrok) se o bot estiver na internet. */
const API_PUBLIC_URL = (process.env.API_PUBLIC_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');

// Country to language mapping
const COUNTRY_LANG: Record<string, {lang: string, prompt: string}> = {
  'BR': { lang: 'pt', prompt: 'Voce e o VEXOR, assistente de trading. Responda de forma direta e concisa em portugues. Maximo 3 frases.' },
  'PT': { lang: 'pt', prompt: 'Voce e o VEXOR, assistente de trading. Responda de forma direta e concisa em portugues. Maximo 3 frases.' },
  'US': { lang: 'en', prompt: 'You are VEXOR, trading assistant. Respond directly and concisely in English. Maximum 3 sentences.' },
  'GB': { lang: 'en', prompt: 'You are VEXOR, trading assistant. Respond directly and concisely in English. Maximum 3 sentences.' },
  'ES': { lang: 'es', prompt: 'Eres VEXOR, asistente de trading. Responde de forma directa y concisa en español. Máximo 3 frases.' },
  'MX': { lang: 'es', prompt: 'Eres VEXOR, asistente de trading. Responde de forma directa y concisa en español. Máximo 3 frases.' },
  'AR': { lang: 'es', prompt: 'Eres VEXOR, asistente de trading. Responde de forma directa y concisa en español. Máximo 3 frases.' },
  'FR': { lang: 'fr', prompt: 'Vous êtes VEXOR, assistant de trading. Répondez de manière directe et concise en français. Maximum 3 phrases.' },
  'DE': { lang: 'de', prompt: 'Du bist VEXOR, Trading-Assistent. Antworte direkt und prägnant auf Deutsch. Maximal 3 Sätze.' },
  'IT': { lang: 'it', prompt: 'Sei VEXOR, assistente di trading. Rispondi in modo diretto e conciso in italiano. Massimo 3 frasi.' },
  'JP': { lang: 'ja', prompt: 'あなたはVEXOR、トレーディングアシスタントです。日本語で直接かつ簡潔に答えてください。最大3文。' },
  'CN': { lang: 'zh', prompt: '你是VEXOR，交易助手。用中文直接简洁地回答。最多3句话。' },
  'RU': { lang: 'ru', prompt: 'Вы - VEXOR, торговый помощник. Отвечайте прямо и кратко на русском. Максимум 3 предложения.' },
  'KR': { lang: 'ko', prompt: '당신은 VEXOR, 트레이딩 어시스턴트입니다. 한국어로 직접적이고 간결하게 답변하세요. 최대 3문장.' },
  'IN': { lang: 'en', prompt: 'You are VEXOR, trading assistant. Respond directly and concisely in English. Maximum 3 sentences.' },
  'SA': { lang: 'ar', prompt: 'أنت VEXOR، مساعد التداول. أجب بشكل مباشر وموجز باللغة العربية. بحد أقصى 3 جمل.' },
  'AE': { lang: 'ar', prompt: 'أنت VEXOR، مساعد التداول. أجب بشكل مباشر وموجز باللغة العربية. بحد أقصى 3 جمل.' },
};

// Default prompts by language code from Telegram
const LANG_PROMPTS: Record<string, string> = {
  'pt': 'Voce e o VEXOR, assistente de trading. Responda de forma direta e concisa em portugues. Maximo 3 frases.',
  'en': 'You are VEXOR, trading assistant. Respond directly and concisely in English. Maximum 3 sentences.',
  'es': 'Eres VEXOR, asistente de trading. Responde de forma directa y concisa en español. Máximo 3 frases.',
  'fr': 'Vous êtes VEXOR, assistant de trading. Répondez de manière directe et concise en français. Maximum 3 phrases.',
  'de': 'Du bist VEXOR, Trading-Assistent. Antworte direkt und prägnant auf Deutsch. Maximal 3 Sätze.',
  'it': 'Sei VEXOR, assistente di trading. Rispondi in modo diretto e conciso in italiano. Massimo 3 frasi.',
  'ja': 'あなたはVEXOR、トレーディングアシスタントです。日本語で直接かつ簡潔に答えてください。最大3文。',
  'zh': '你是VEXOR，交易助手。用中文直接简洁地回答。最多3句话。',
  'ru': 'Вы - VEXOR, торговый помощник. Отвечайте прямо и кратко на русском. Максимум 3 предложения.',
  'ko': '당신은 VEXOR, 트레이딩 어시스턴트입니다. 한국어로 직접적이고 간결하게 답변하세요. 최대 3문장.',
  'ar': 'أنت VEXOR، مساعد التداول. أجب بشكل مباشر وموجز باللغة العربية. بحد أقصى 3 جمل.',
};

// Universal prompt - Ollama detects language automatically
const UNIVERSAL_PROMPT = `You are VEXOR, a trading assistant. IMPORTANT: You MUST reply in the EXACT SAME LANGUAGE the user writes to you. If user writes in English, reply in English. If user writes in Portuguese, reply in Portuguese. If user writes in Spanish, reply in Spanish. Always match the user's language. Be direct and concise. Maximum 3 sentences.`;

// Detect language from message text
function detectLanguageFromText(text: string): string | null {
  const lowerText = text.toLowerCase();
  
  // Portuguese patterns
  if (/\b(oi|olá|ola|bom dia|boa tarde|boa noite|como vai|obrigad|por favor|qual|quanto|quando|onde|você|voce|não|nao)\b/i.test(lowerText)) {
    return 'pt';
  }
  // Spanish patterns
  if (/\b(hola|buenos días|buenas tardes|buenas noches|cómo está|gracias|por favor|qué|cuánto|cuándo|dónde|usted|no)\b/i.test(lowerText)) {
    return 'es';
  }
  // French patterns
  if (/\b(bonjour|bonsoir|comment allez|merci|s'il vous plaît|quel|combien|quand|où|vous)\b/i.test(lowerText)) {
    return 'fr';
  }
  // German patterns
  if (/\b(hallo|guten tag|guten morgen|wie geht|danke|bitte|was|wie viel|wann|wo|sie)\b/i.test(lowerText)) {
    return 'de';
  }
  // Italian patterns
  if (/\b(ciao|buongiorno|buonasera|come stai|grazie|per favore|cosa|quanto|quando|dove|lei)\b/i.test(lowerText)) {
    return 'it';
  }
  // Portuguese patterns
  if (/\b(こんにちは|おはよう|こんばんは|ありがとう|ください|何|いくら|いつ|どこ)\b/.test(text)) {
    return 'ja';
  }
  // Chinese patterns
  if (/[\u4e00-\u9fff]/.test(text)) {
    return 'zh';
  }
  // Russian patterns
  if (/[\u0400-\u04ff]/.test(text)) {
    return 'ru';
  }
  // Korean patterns
  if (/[\uac00-\ud7af]/.test(text)) {
    return 'ko';
  }
  // Arabic patterns
  if (/[\u0600-\u06ff]/.test(text)) {
    return 'ar';
  }
  
  return null;
}

// Get user's country from database by chat_id
async function getUserCountry(chatId: string): Promise<string | null> {
  try {
    const result = await oracleDB.query(
      `SELECT country FROM users WHERE telegram_chat_id = :chatId`,
      { chatId }
    ) as any;
    return result?.rows?.[0]?.COUNTRY || result?.rows?.[0]?.country || null;
  } catch {
    return null;
  }
}

// Conversation history per chat
const conversationHistory = new Map<string, Array<{role: string, content: string}>>();

async function callOllama(chatId: string, userMessage: string, telegramLang?: string): Promise<string> {
  // Get or create conversation history
  let history = conversationHistory.get(chatId) || [];
  
  // Add user message to history
  history.push({ role: 'user', content: userMessage });
  
  // Keep only last 10 messages for context
  if (history.length > 10) {
    history = history.slice(-10);
  }
  
  // Use universal prompt - Ollama detects language automatically from user message
  const systemPrompt = UNIVERSAL_PROMPT;
  console.log('[Ollama] Using universal prompt with auto-language detection');

  try {
    console.log('[Ollama] Calling with model:', OLLAMA_MODEL, 'message:', userMessage);
    
    // Use streaming for faster perceived response
    const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          ...history
        ],
        stream: true,  // Enable streaming
        options: {
          num_predict: 30,
          temperature: 0.1,
          num_thread: 10,  // Use all 16 threads of VM
          num_ctx: 512     // Smaller context = faster
        },
        keep_alive: '10m'
      })
    });

    // Collect streamed response
    let fullResponse = '';
    const reader = resp.body?.getReader();
    const decoder = new TextDecoder();
    
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          try {
            const json = JSON.parse(line);
            if (json.message?.content) {
              fullResponse += json.message.content;
            }
          } catch {}
        }
      }
    }
    
    console.log('[Ollama] Response:', fullResponse.slice(0, 100));
    
    if (!fullResponse.trim()) {
      return 'Desculpe, nao consegui processar sua mensagem.';
    }
    
    // Add assistant response to history
    history.push({ role: 'assistant', content: fullResponse });
    conversationHistory.set(chatId, history);
    
    return fullResponse;
  } catch (error) {
    console.error('[Ollama] Error:', error);
    return 'Desculpe, estou com dificuldades tecnicas. Tente novamente.';
  }
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      is_bot: boolean;
      first_name: string;
      last_name?: string;
      username?: string;
      language_code: string;
    };
    chat: {
      id: number;
      type: string;
      title?: string;
      username?: string;
      first_name?: string;
      last_name?: string;
    };
    date: number;
    text?: string;
    contact?: {
      phone_number: string;
      first_name: string;
      last_name?: string;
      user_id: number;
    };
  };
}

export async function telegramWebhookRoutes(app: FastifyInstance) {
  // Webhook endpoint for Telegram bot
  app.post('/api/v1/telegram/webhook', async (request: FastifyRequest<{ Body: TelegramUpdate }>, reply: FastifyReply) => {
    const update = request.body;
    
    console.log('[Telegram Webhook] Received update:', JSON.stringify(update, null, 2));
    
    try {
      if (update.message?.text === '/start') {
        const chatId = update.message.chat.id;
        const username = update.message.from.username || update.message.from.first_name;
        
        console.log(`[Telegram Webhook] User started bot: chat_id=${chatId}, username=${username}`);
        
        // Send welcome message
        await telegramNotifier.sendToUser(chatId.toString(),
          `🎯 <b>BEM-VINDO AO VEXOR!</b>\n\n` +
          `Olá, ${username}! 👋\n\n` +
          `Para receber alertas personalizados, precisamos vincular seu Telegram à sua conta.\n\n` +
          `📱 <b>Envie seu número de telefone</b> tocando no botão abaixo:\n\n` +
          `<i>Ou digite seu telefone no formato: +55 11 99999-9999</i>`
        );
        
        return reply.send({ ok: true });
      }
      
      // Handle contact sharing (phone number)
      if (update.message?.contact) {
        const chatId = update.message.chat.id;
        const phoneNumber = '+' + update.message.contact.phone_number.replace(/\D/g, '');
        
        console.log(`[Telegram Webhook] Contact shared: chat_id=${chatId}, phone=${phoneNumber}`);
        
        // Update user's telegram_chat_id in database
        await updateUserTelegramChatId(phoneNumber, chatId.toString());
        
        await telegramNotifier.sendToUser(chatId.toString(),
          `✅ <b>TELEGRAM VINCULADO COM SUCESSO!</b>\n\n` +
          `📱 Telefone: ${phoneNumber}\n` +
          `🆔 Chat ID: ${chatId}\n\n` +
          `Agora você receberá alertas personalizados do VEXOR!\n\n` +
          `🎯 <b>O que você vai receber:</b>\n` +
          `• Sinais de entrada/saída\n` +
          `• Alertas de oportunidades\n` +
          `• Notícias relevantes do mercado\n` +
          `• Resumo diário de performance\n\n` +
          `⚡ <b>VEXOR - Inteligência Artificial para Traders</b>`
        );
        
        return reply.send({ ok: true, linked: true });
      }
      
      // Handle phone number as text
      if (update.message?.text && update.message.text.startsWith('+')) {
        const chatId = update.message.chat.id;
        const phoneNumber = update.message.text.trim();
        
        console.log(`[Telegram Webhook] Phone as text: chat_id=${chatId}, phone=${phoneNumber}`);
        
        // Update user's telegram_chat_id in database
        const updated = await updateUserTelegramChatId(phoneNumber, chatId.toString());
        
        if (updated) {
          await telegramNotifier.sendToUser(chatId.toString(),
            `✅ <b>TELEGRAM VINCULADO COM SUCESSO!</b>\n\n` +
            `📱 Telefone: ${phoneNumber}\n\n` +
            `Agora você receberá alertas personalizados do VEXOR!\n\n` +
            `⚡ <b>VEXOR - Inteligência Artificial para Traders</b>`
          );
        } else {
          await telegramNotifier.sendToUser(chatId.toString(),
            `⚠️ <b>TELEFONE NÃO ENCONTRADO</b>\n\n` +
            `📱 Telefone: ${phoneNumber}\n\n` +
            `Este telefone não está cadastrado no VEXOR.\n` +
            `Por favor, cadastre-se primeiro em:\n` +
            `${PUBLIC_APP_URL}/register\n\n` +
            `⚡ <b>VEXOR</b>`
          );
        }
        
        return reply.send({ ok: true, linked: updated });
      }
      
      // Handle regular messages with Ollama AI
      if (update.message?.text) {
        const chatId = update.message.chat.id;
        const text = update.message.text;
        
        console.log(`[Telegram Webhook] Message from ${chatId}: ${text}`);
        
        // Special commands (not AI)
        if (text === '/status') {
          await telegramNotifier.sendToUser(chatId.toString(),
            `📊 <b>STATUS DO SISTEMA</b>\n\n` +
            `✅ Bot: Online\n` +
            `✅ Webhook: Ativo\n` +
            `✅ API: Funcionando\n` +
            `✅ Ollama: ${OLLAMA_MODEL}\n\n` +
            `⚡ <b>VEXOR</b>`
          );
        } else if (text === '/help') {
          await telegramNotifier.sendToUser(chatId.toString(),
            `❓ <b>COMANDOS DISPONÍVEIS</b>\n\n` +
            `/start - Iniciar bot\n` +
            `/status - Ver status do sistema\n` +
            `/help - Ver esta ajuda\n\n` +
            `� Qualquer outra mensagem será respondida pela IA\n\n` +
            `⚡ <b>VEXOR</b>`
          );
        } else {
          // All other messages go to Ollama AI
          // Return immediately to prevent Telegram retry, then process async
          reply.send({ ok: true });
          
          // Get Telegram language_code from user
          const telegramLang = update.message.from.language_code?.split('-')[0]; // e.g., 'pt-BR' -> 'pt'
          
          // Process async after response
          (async () => {
            try {
              const msgId = await telegramNotifier.sendToUserWithId(chatId.toString(), '⏳ Processando...');
              const aiResponse = await callOllama(chatId.toString(), text, telegramLang);
              
              if (msgId) {
                await telegramNotifier.editMessage(chatId.toString(), msgId, aiResponse);
              } else {
                await telegramNotifier.sendToUser(chatId.toString(), aiResponse);
              }
            } catch (err) {
              console.error('[Telegram Webhook] Async error:', err);
            }
          })();
          
          return; // Already sent response
        }
        
        return reply.send({ ok: true });
      }
      
      return reply.send({ ok: true });
    } catch (error) {
      console.error('[Telegram Webhook] Error:', error);
      return reply.status(500).send({ error: 'Internal error' });
    }
  });
  
  // Get webhook info
  app.get('/api/v1/telegram/webhook/info', async (_request, reply) => {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return reply.send({ configured: false });
    }
    
    try {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
      const data = await response.json();
      return reply.send({ configured: true, ...data });
    } catch (error) {
      return reply.send({ configured: true, error: String(error) });
    }
  });
  
  // Set webhook
  app.post('/api/v1/telegram/webhook/set', async (request, reply) => {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return reply.status(400).send({ error: 'TELEGRAM_BOT_TOKEN not configured' });
    }
    
    const { url } = request.body as { url?: string };
    const webhookUrl = url || `${API_PUBLIC_URL}/api/v1/telegram/webhook`;
    
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`
      );
      const data = await response.json();
      return reply.send({ ...data, webhookUrl });
    } catch (error) {
      return reply.status(500).send({ error: String(error) });
    }
  });
}

/**
 * Update user's telegram_chat_id in database
 */
async function updateUserTelegramChatId(phoneNumber: string, chatId: string): Promise<boolean> {
  try {
    const conn = await oracleDB.getConnection();
    if (!conn) {
      console.log('[Telegram] No DB connection, skipping chat_id update');
      return false;
    }
    
    try {
      // Normalize phone number (remove non-digits, add +)
      const normalizedPhone = '+' + phoneNumber.replace(/\D/g, '');
      
      // Update user with this phone number
      const result = await conn.execute(
        `UPDATE users SET telegram_chat_id = :chatId 
         WHERE REPLACE(REPLACE(REPLACE(telegram_phone, '+', ''), '-', ''), ' ', '') = 
               REPLACE(REPLACE(REPLACE(:phone, '+', ''), '-', ''), ' ', '')`,
        { chatId, phone: normalizedPhone },
        { autoCommit: true }
      );
      
      const rowsAffected = result.rowsAffected || 0;
      console.log(`[Telegram] Updated ${rowsAffected} user(s) with chat_id=${chatId}`);
      
      return rowsAffected > 0;
    } finally {
      await conn.close();
    }
  } catch (error) {
    console.error('[Telegram] Error updating chat_id:', error);
    return false;
  }
}
