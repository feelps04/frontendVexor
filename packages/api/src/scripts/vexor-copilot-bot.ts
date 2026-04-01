import { Telegram } from 'telegraf';
import { Ollama } from 'ollama';

// Enterprise Signal Throttle - Configurações de Cooldown
const THROTTLE_CONFIG = {
    breakout: 120,
    mean_reversion: 90,
    momentum: 45,
    scalping: 30
};

export class VexorCopilot {
    private telegram: Telegram;
    private ai: Ollama;

    constructor() {
        this.telegram = new Telegram(process.env.TELEGRAM_TOKEN!);
        this.ai = new Ollama({ host: 'http://localhost:11434' });
    }

    // REGRAS: Sem saudações, sem nomes, apenas resposta a comandos
    async handleIncomingMessage(chatId: number, userText: string) {
        const systemPrompt = "Você é o Vexor Nexus AI. Responda APENAS com dados técnicos da B3/Crypto. PROIBIDO saudações (Boa noite, Olá), PROIBIDO emojis, PROIBIDO nomes de usuários.";
        
        const response = await this.ai.chat({
            model: 'llama3',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userText }
            ]
        });

        await this.telegram.sendMessage(chatId, response.message.content);
    }

    // MODO SILENCIOSO: Detecta mercado lateral mas NÃO envia mensagem
    async checkMarketTrend(data: any) {
        if (data.volatility < 0.05) {
            console.log("LOG: Mercado Lateral. Silent Mode Ativo - Nenhuma saudação enviada.");
            return; 
        }
    }
}
// REPORTS AUTOMÁTICOS: Removidos conforme solicitação
