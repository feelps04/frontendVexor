// Oracle Cloud Infrastructure - Generative AI Service
// Integration for market analysis using OCI AI models (Llama, Cohere)

interface GenAIConfig {
  primaryKey: string;
  backupKey: string;
  region: string;
  tenancyId: string;
}

interface MarketAnalysisRequest {
  symbol: string;
  timeframe: string;
  indicators: Record<string, number>;
  sentiment?: string;
  news?: string[];
}

interface MarketAnalysisResponse {
  analysis: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  reasoning: string[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}

let config: GenAIConfig | null = null;

export function initGenAI(env: Record<string, string | undefined>): void {
  config = {
    primaryKey: env.OCI_GENAI_PRIMARY_KEY || '',
    backupKey: env.OCI_GENAI_BACKUP_KEY || '',
    region: env.OCI_REGION || 'sa-saopaulo-1',
    tenancyId: env.OCI_TENANCY_OCID || '',
  };
}

function getApiKey(): string {
  if (!config) throw new Error('GenAI not initialized');
  return config.primaryKey || config.backupKey || '';
}

// OCI Generative AI endpoint for inference
const GENAI_ENDPOINT = 'https://inference.generativeai.sa-saopaulo-1.oci.oraclecloud.com';

export async function analyzeMarket(data: MarketAnalysisRequest): Promise<MarketAnalysisResponse> {
  const apiKey = getApiKey();
  
  if (!apiKey) {
    return getDefaultAnalysis(data);
  }

  try {
    const prompt = buildAnalysisPrompt(data);
    
    const response = await fetch(`${GENAI_ENDPOINT}/20231130/actions/generateText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'opc-request-id': `vexor-${Date.now()}`,
      },
      body: JSON.stringify({
        modelId: 'meta.llama-3-70b-instruct',
        inferenceRequest: {
          prompt: prompt,
          maxTokens: 1024,
          temperature: 0.3,
          topP: 0.9,
        },
      }),
    });

    if (!response.ok) {
      console.error('OCI GenAI error:', response.status, response.statusText);
      return getDefaultAnalysis(data);
    }

    const result = await response.json();
    return parseAnalysisResponse(result, data);
  } catch (error) {
    console.error('OCI GenAI request failed:', error);
    return getDefaultAnalysis(data);
  }
}

function buildAnalysisPrompt(data: MarketAnalysisRequest): string {
  const { symbol, timeframe, indicators, sentiment, news } = data;
  
  let prompt = `Você é um analista de mercado financeiro profissional. Analise os seguintes dados para ${symbol}:

PERÍODO: ${timeframe}
INDICADORES TÉCNICOS:
${Object.entries(indicators).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`;

  if (sentiment) {
    prompt += `\n\nSENTIMENTO DE MERCADO: ${sentiment}`;
  }
  
  if (news && news.length > 0) {
    prompt += `\n\nNOTÍCIAS RELEVANTES:\n${news.map(n => `- ${n}`).join('\n')}`;
  }

  prompt += `

Forneça uma análise estruturada no seguinte formato JSON:
{
  "analysis": "resumo da análise em português",
  "signal": "BUY ou SELL ou HOLD",
  "confidence": número de 0 a 100,
  "reasoning": ["razão 1", "razão 2", "razão 3"],
  "riskLevel": "LOW ou MEDIUM ou HIGH"
}

Responda APENAS com o JSON, sem texto adicional.`;

  return prompt;
}

function parseAnalysisResponse(result: any, data: MarketAnalysisRequest): MarketAnalysisResponse {
  try {
    const text = result.inferenceResponse?.generatedText || result.generatedText || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        analysis: parsed.analysis || 'Análise não disponível',
        signal: ['BUY', 'SELL', 'HOLD'].includes(parsed.signal) ? parsed.signal : 'HOLD',
        confidence: Math.min(100, Math.max(0, Number(parsed.confidence) || 50)),
        reasoning: Array.isArray(parsed.reasoning) ? parsed.reasoning : [],
        riskLevel: ['LOW', 'MEDIUM', 'HIGH'].includes(parsed.riskLevel) ? parsed.riskLevel : 'MEDIUM',
      };
    }
  } catch (e) {
    console.error('Failed to parse GenAI response:', e);
  }
  
  return getDefaultAnalysis(data);
}

function getDefaultAnalysis(data: MarketAnalysisRequest): MarketAnalysisResponse {
  const { indicators } = data;
  
  // Simple rule-based analysis as fallback
  let signal: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
  let confidence = 50;
  const reasoning: string[] = [];
  let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM';

  // RSI analysis
  if (indicators.rsi !== undefined) {
    if (indicators.rsi < 30) {
      signal = 'BUY';
      confidence += 15;
      reasoning.push('RSI em sobrevenda');
    } else if (indicators.rsi > 70) {
      signal = 'SELL';
      confidence += 15;
      reasoning.push('RSI em sobrecompra');
    } else {
      reasoning.push('RSI em zona neutra');
    }
  }

  // MACD analysis
  if (indicators.macd !== undefined && indicators.macdSignal !== undefined) {
    if (indicators.macd > indicators.macdSignal) {
      if (signal !== 'SELL') signal = 'BUY';
      confidence += 10;
      reasoning.push('MACD cruzamento de alta');
    } else {
      reasoning.push('MACD em tendência de baixa');
    }
  }

  // Volume analysis
  if (indicators.volumeRatio !== undefined) {
    if (indicators.volumeRatio > 1.5) {
      confidence += 10;
      reasoning.push('Volume acima da média - confirmação de movimento');
    }
  }

  return {
    analysis: `Análise técnica para ${data.symbol}: ${signal === 'BUY' ? 'Tendência de alta' : signal === 'SELL' ? 'Tendência de baixa' : 'Lateralização'}. Confiança: ${confidence}%`,
    signal,
    confidence: Math.min(100, confidence),
    reasoning,
    riskLevel,
  };
}

// Generate trading signal for social feed
export async function generateTradingSignal(symbol: string, indicators: Record<string, number>): Promise<string> {
  const analysis = await analyzeMarket({ symbol, timeframe: '1D', indicators });
  
  const signalEmoji = analysis.signal === 'BUY' ? '🟢' : analysis.signal === 'SELL' ? '🔴' : '🟡';
  const riskEmoji = analysis.riskLevel === 'LOW' ? '✅' : analysis.riskLevel === 'HIGH' ? '⚠️' : '⚡';
  
  return `${signalEmoji} SINAL: ${analysis.signal}
📊 ${symbol}
🎯 Confiança: ${analysis.confidence}%
${riskEmoji} Risco: ${analysis.riskLevel}

${analysis.analysis}

${analysis.reasoning.map(r => `• ${r}`).join('\n')}

#trading #${symbol.toLowerCase()} #analise`;
}
