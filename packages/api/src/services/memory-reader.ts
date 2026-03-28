// Memory Reader Service - Lê dados do MMF (Memory Mapped File) do MT5
// Integração com OCI GenAI para análise em tempo real
// Trading Wisdom - Regras de Cadeado de Ferro e Independência Estatística

import { exec } from 'child_process';
import { promisify } from 'util';
// Node.js 18+ tem fetch nativo
const fetch = globalThis.fetch;
import { TRADING_WISDOM, shouldTrade, generateAIWisdom } from './trading-wisdom.js';

const execAsync = promisify(exec);

interface MarketTick {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  volume: number;
  timestamp: number;
}

interface MarketDataBuffer {
  ticks: MarketTick[];
  lastUpdate: number;
  count: number;
}

// Configuração OCI GenAI
const OCI_GENAI_CONFIG = {
  primaryKey: process.env.OCI_GENAI_PRIMARY_KEY || 'sk-k0e35cOHls3M8Wa10pFdmtRqSmvGN6ntZFrl9O56Y4EeyBko',
  endpoint: 'https://inference.generativeai.us-chicago-1.oci.oraclecloud.com/20231130/actions/generateText',
  model: 'meta.llama-3-70b-instruct',
  compartmentId: process.env.OCI_TENANCY_OCID || 'ocid1.tenancy.oc1..aaaaaaaaoavjhejphyhdysk3fpuvzzzuxpcue43mp6jtsajqpz2apxfnxz4a'
};

// Buffer de memória compartilhada (simulado - na VM será MMF real)
let sharedMemory: MarketDataBuffer = {
  ticks: [],
  lastUpdate: Date.now(),
  count: 0
};

// Lê dados do MMF no Windows
export async function readMemoryMappedFile(): Promise<MarketTick[]> {
  try {
    // Na VM Windows, ler do arquivo mapeado em memória
    // O MT5 escreve em: C:\vexor\mt5_data\shared_memory.bin
    
    if (process.platform === 'win32') {
      // Usar PowerShell para ler MMF
      const { stdout } = await execAsync(`
        $mmf = [System.IO.MemoryMappedFiles.MemoryMappedFile]::OpenExisting('MT5_MarketData')
        $reader = $mmf.CreateViewStream(0, 0)
        $buffer = New-Object byte[] 4096
        $reader.Read($buffer, 0, 4096) | Out-Null
        $reader.Dispose()
        [System.Text.Encoding]::UTF8.GetString($buffer)
      `, { shell: 'powershell' });
      
      if (stdout && stdout.trim()) {
        const data = JSON.parse(stdout.trim());
        sharedMemory.ticks = data.ticks || [];
        sharedMemory.lastUpdate = Date.now();
        sharedMemory.count = sharedMemory.ticks.length;
      }
    }
    
    return sharedMemory.ticks;
  } catch (error) {
    // Se MMF não existir, retornar dados simulados para desenvolvimento
    console.log('MMF não disponível, usando dados simulados');
    return generateSimulatedTicks();
  }
}

// Gera ticks simulados para desenvolvimento
function generateSimulatedTicks(): MarketTick[] {
  const symbols = ['WIN$', 'WDO$', 'PETR4', 'VALE3', 'ITUB4', 'BBDC4', 'ABEV3', 'BBAS3'];
  
  return symbols.map(symbol => ({
    symbol,
    bid: Math.random() * 100 + 10,
    ask: Math.random() * 100 + 10,
    last: Math.random() * 100 + 10,
    volume: Math.floor(Math.random() * 10000),
    timestamp: Date.now()
  }));
}

// Envia dados para OCI GenAI para análise
export async function analyzeWithGenAI(ticks: MarketTick[]): Promise<string> {
  const prompt = buildAnalysisPrompt(ticks);
  
  try {
    const response = await fetch(OCI_GENAI_CONFIG.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OCI_GENAI_CONFIG.primaryKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        compartmentId: OCI_GENAI_CONFIG.compartmentId,
        servingMode: 'ON_DEMAND',
        inferenceRequest: {
          model: OCI_GENAI_CONFIG.model,
          prompt,
          maxTokens: 500,
          temperature: 0.7,
          topP: 0.9
        }
      })
    });

    if (!response.ok) {
      throw new Error(`OCI GenAI error: ${response.status}`);
    }

    const data = await response.json() as { generatedText?: string };
    return data.generatedText || 'Análise não disponível';
  } catch (error) {
    console.error('Erro na análise GenAI:', error);
    return fallbackAnalysis(ticks);
  }
}

// Constrói prompt para análise com Trading Wisdom
function buildAnalysisPrompt(ticks: MarketTick[], traderContext?: {
  todayPnL?: number;
  consecutiveLosses?: number;
  emotionalState?: string;
}): string {
  const tickData = ticks.map(t => 
    `${t.symbol}: Bid=${t.bid.toFixed(2)}, Ask=${t.ask.toFixed(2)}, Vol=${t.volume}`
  ).join('\n');

  // Incluir conhecimento de Trading Wisdom no prompt
  const wisdomContext = `
CONHECIMENTO DE TRADING (Mark Douglas):

${TRADING_WISDOM.statisticalIndependence.corePrinciple}

REGRAS DE CADEADO DE FERRO:
${TRADING_WISDOM.cadeadoDeFerro.rules.map(r => `- ${r.name}: ${r.description}`).join('\n')}

SINAIS DE ALERTA - QUANDO DIZER "NÃO OPERE":
${TRADING_WISDOM.alertSignals.doNotTrade.map(s => `- ${s}`).join('\n')}
`;

  let contextInfo = '';
  if (traderContext) {
    contextInfo = `
CONTEXTO DO TRADER:
- PnL hoje: ${traderContext.todayPnL || 0}
- Perdas consecutivas: ${traderContext.consecutiveLosses || 0}
- Estado emocional: ${traderContext.emotionalState || 'neutro'}
`;
  }

  return `<s>[INST] Você é um analista de mercado financeiro especialista com conhecimento profundo de psicologia de trading (Mark Douglas - Trading in the Zone / O Trader Disciplinado).

${wisdomContext}

${contextInfo}

DADOS DE MERCADO EM TEMPO REAL:
${tickData}

Forneça:
1. Análise técnica breve do mercado
2. Se o contexto do trader indicar problema emocional, diga "NÃO OPERE" e explique por quê
3. Lembre o trader sobre independência estatística se ele estiver tentando recuperar perdas
4. Recomendação de ação baseada no Cadeado de Ferro

Seja conciso e objetivo. Responda em português. Priorize a proteção psicológica do trader. [/INST]`;
}

// Análise fallback quando OCI GenAI não está disponível
function fallbackAnalysis(ticks: MarketTick[], traderContext?: {
  todayPnL?: number;
  consecutiveLosses?: number;
  emotionalState?: string;
}): string {
  const avgPrice = ticks.reduce((sum, t) => sum + t.last, 0) / ticks.length;
  const highVolume = ticks.filter(t => t.volume > 5000);
  
  // Incluir sabedoria de trading
  let wisdomMessage = '';
  if (traderContext?.consecutiveLosses && traderContext.consecutiveLosses >= 3) {
    wisdomMessage = `

⚠️ AVISO DE TRADING:
${generateAIWisdom({ situation: 'post_loss', consecutiveLosses: traderContext.consecutiveLosses })}`;
  } else if (traderContext?.emotionalState === 'revenge') {
    wisdomMessage = `

🛑 ALERTA CRÍTICO:
${generateAIWisdom({ situation: 'revenge_attempt' })}`;
  }
  
  return `📊 Análise de Mercado (Local)
  
📈 Tendência: ${avgPrice > 50 ? 'Alta' : 'Baixa'}
🔥 Maior volume: ${highVolume.map(t => t.symbol).join(', ') || 'Nenhum destaque'}
⏰ Última atualização: ${new Date().toLocaleTimeString('pt-BR')}

💡 Recomendação: Monitore os ativos com alto volume para oportunidades de trading.

📝 Lembrete: Cada trade é estatisticamente independente. O mercado não deve nada a você.${wisdomMessage}`;
}

// Inicia o serviço de leitura contínua
export function startMemoryReader(intervalMs: number = 1000): NodeJS.Timeout {
  console.log('🔍 Iniciando leitura de memória MMF...');
  
  return setInterval(async () => {
    try {
      const ticks = await readMemoryMappedFile();
      console.log(`📊 Lidos ${ticks.length} ticks da memória`);
      
      // A cada 10 segundos, fazer análise com IA
      if (sharedMemory.count % 10 === 0 && ticks.length > 0) {
        const analysis = await analyzeWithGenAI(ticks);
        console.log('🤖 Análise IA:', analysis.substring(0, 200) + '...');
      }
    } catch (error) {
      console.error('Erro na leitura:', error);
    }
  }, intervalMs);
}

// Exporta dados atuais da memória
export function getCurrentMemoryData(): MarketDataBuffer {
  return { ...sharedMemory };
}

// Exporta função de verificação de trading
export { shouldTrade, generateAIWisdom, TRADING_WISDOM };

export default {
  readMemoryMappedFile,
  analyzeWithGenAI,
  startMemoryReader,
  getCurrentMemoryData,
  shouldTrade,
  generateAIWisdom,
  TRADING_WISDOM
};
