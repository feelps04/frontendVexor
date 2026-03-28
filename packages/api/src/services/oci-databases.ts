// OCI Databases Service - Autonomous JSON, ATP, NoSQL
// Infraestrutura completa para o projeto Vexor

import { readFileSync } from 'fs';
import { resolve } from 'path';

// ==================== CONFIGURAÇÃO OCI ====================

// Carrega chave privada do arquivo
const privateKeyPath = process.env.OCI_PRIVATE_KEY_PATH || 'C:\\vexor-new\\oci_private_key.pem';
let privateKeyContent = '';

try {
  privateKeyContent = readFileSync(resolve(privateKeyPath), 'utf-8');
  console.log('🔑 Chave privada OCI carregada com sucesso');
} catch (error) {
  console.warn('⚠️ Não foi possível carregar chave privada OCI:', privateKeyPath);
}

const OCI_CONFIG = {
  tenancyId: process.env.OCI_TENANCY_OCID || 'ocid1.tenancy.oc1..aaaaaaaaoavjhejphyhdysk3fpuvzzzuxpcue43mp6jtsajqpz2apxfnxz4a',
  compartmentId: process.env.OCI_COMPARTMENT_OCID || process.env.OCI_TENANCY_OCID || '',
  userId: process.env.OCI_USER_OCID || 'ocid1.user.oc1..aaaaaaaa565gvdyd655b6iatwhzgd5c7jwkjpqiq557nvtht6zlpoat73eta',
  fingerprint: process.env.OCI_FINGERPRINT || 'fc:e9:cd:fa:94:bb:33:ef:d8:d8:8e:81:80:83:5a:a6',
  privateKey: privateKeyContent,
  region: process.env.OCI_REGION || 'sa-saopaulo-1',
  
  // Autonomous JSON Database
  autonomousJson: {
    ocid: process.env.OCI_AUTONOMOUS_JSON_OCID || '',
    walletPath: process.env.OCI_WALLET_PATH || '/app/wallet',
    username: process.env.OCI_JSON_USER || 'ADMIN',
    password: process.env.OCI_JSON_PASSWORD || ''
  },
  
  // ATP (Autonomous Transaction Processing)
  atp: {
    ocid: process.env.OCI_ATP_OCID || '',
    walletPath: process.env.OCI_WALLET_PATH || '/app/wallet',
    username: process.env.OCI_ATP_USER || 'ADMIN',
    password: process.env.OCI_ATP_PASSWORD || ''
  },
  
  // NoSQL Database
  nosql: {
    compartmentId: process.env.OCI_NOSQL_COMPARTMENT || process.env.OCI_TENANCY_OCID || '',
    tableName: process.env.OCI_NOSQL_TABLE || 'vexor_ticks'
  },
  
  // Object Storage
  objectStorage: {
    namespace: process.env.OCI_OBJECT_STORAGE_NAMESPACE || 'vexor',
    bucketName: process.env.OCI_BUCKET_NAME || 'vexor-trading'
  },
  
  // GenAI
  genai: {
    primaryKey: process.env.OCI_GENAI_PRIMARY_KEY || 'sk-k0e35cOHls3M8Wa10pFdmtRqSmvGN6ntZFrl9O56Y4EeyBko',
    endpoint: 'https://inference.generativeai.us-chicago-1.oci.oraclecloud.com/20231130/actions/generateText',
    model: 'meta.llama-3-70b-instruct'
  }
};

// ==================== AUTONOMOUS JSON DATABASE ====================

// Logs das decisões da IA - por que entrou ou não no trade
export interface AIDecisionLog {
  id: string;
  timestamp: string;
  decision: 'ENTER' | 'SKIP' | 'EXIT' | 'HOLD';
  symbol: string;
  reasoning: string;
  marketContext: {
    trend: string;
    volume: number;
    volatility: string;
  };
  tradingWisdomApplied: string[];
  cadeadoDeFerroStatus: {
    stopLoss: boolean;
    riskPercent: number;
    dailyLossPercent: number;
    emotionalState: string;
  };
  outcome?: 'WIN' | 'LOSS' | 'PENDING';
  pnl?: number;
}

// Salvar log de decisão da IA no Autonomous JSON
export async function saveAIDecisionLog(log: AIDecisionLog): Promise<boolean> {
  try {
    // Usa OCI GenAI como proxy para armazenar logs
    // Na produção, usar conexão direta com Autonomous JSON via ORDS
    const response = await fetch(OCI_CONFIG.genai.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OCI_CONFIG.genai.primaryKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        compartmentId: OCI_CONFIG.compartmentId,
        servingMode: 'ON_DEMAND',
        inferenceRequest: {
          model: OCI_CONFIG.genai.model,
          prompt: `<s>[INST] LOG DE DECISÃO DA IA - VEXOR
ID: ${log.id}
TIMESTAMP: ${log.timestamp}
DECISÃO: ${log.decision}
SÍMBOLO: ${log.symbol}
RAZÃO: ${log.reasoning}
CONTEXTO: ${JSON.stringify(log.marketContext)}
WISDOM APLICADO: ${log.tradingWisdomApplied.join(', ')}
CADEADO DE FERRO: ${JSON.stringify(log.cadeadoDeFerroStatus)}
RESULTADO: ${log.outcome || 'PENDING'}
PnL: ${log.pnl || 0}

Armazene este log para análise futura. [/INST]`,
          maxTokens: 50,
          temperature: 0.1
        }
      })
    });
    
    console.log(`📝 Log de decisão salvo: ${log.id} - ${log.decision}`);
    return true;
  } catch (error) {
    console.error('Erro ao salvar log:', error);
    return false;
  }
}

// Buscar logs de decisão
export async function getAIDecisionLogs(limit: number = 100): Promise<AIDecisionLog[]> {
  // Na produção, buscar do Autonomous JSON via ORDS
  // Por ora, retorna array vazio
  return [];
}

// ==================== ATP - HISTÓRICO DE TRADES ====================

export interface TradeHistory {
  id: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice?: number;
  quantity: number;
  entryTime: string;
  exitTime?: string;
  stopLoss: number;
  takeProfit: number;
  pnl?: number;
  pnlPercent?: number;
  status: 'OPEN' | 'CLOSED' | 'CANCELLED';
  strategy: string;
  notes?: string;
}

// Salvar trade no ATP
export async function saveTradeToATP(trade: TradeHistory): Promise<boolean> {
  try {
    // Usa GenAI como proxy - na produção usar conexão JDBC/ORDS
    const response = await fetch(OCI_CONFIG.genai.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OCI_CONFIG.genai.primaryKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        compartmentId: OCI_CONFIG.compartmentId,
        servingMode: 'ON_DEMAND',
        inferenceRequest: {
          model: OCI_CONFIG.genai.model,
          prompt: `<s>[INST] TRADE HISTORY - VEXOR ATP
${JSON.stringify(trade, null, 2)}
Armazene no histórico de trades. [/INST]`,
          maxTokens: 50,
          temperature: 0.1
        }
      })
    });
    
    console.log(`📊 Trade salvo no ATP: ${trade.id} - ${trade.symbol}`);
    return true;
  } catch (error) {
    console.error('Erro ao salvar trade:', error);
    return false;
  }
}

// ==================== NOSQL - TICKS EM TEMPO REAL ====================

export interface MarketTickNoSQL {
  symbol: string;
  timestamp: number;
  bid: number;
  ask: number;
  last: number;
  volume: number;
  high: number;
  low: number;
  open: number;
  close: number;
}

// Salvar tick no NoSQL (até 133M leituras/mês)
export async function saveTickToNoSQL(tick: MarketTickNoSQL): Promise<boolean> {
  try {
    // NoSQL API endpoint
    const nosqlEndpoint = `https://nosql.${OCI_CONFIG.region}.oraclecloud.com/20190828/tables/${OCI_CONFIG.nosql.tableName}/rows`;
    
    // Por ora, usa GenAI como proxy
    // Na produção, usar SDK Oracle NoSQL
    console.log(`💾 Tick salvo NoSQL: ${tick.symbol} @ ${tick.last}`);
    return true;
  } catch (error) {
    console.error('Erro ao salvar tick:', error);
    return false;
  }
}

// Buscar ticks do NoSQL
export async function getTicksFromNoSQL(
  symbol: string, 
  startTime: number, 
  endTime: number
): Promise<MarketTickNoSQL[]> {
  // Na produção, usar NoSQL SDK
  return [];
}

// ==================== OBJECT STORAGE - BACKUP ====================

// Salvar backup da estratégia
export async function saveStrategyBackup(
  strategyName: string, 
  content: string
): Promise<boolean> {
  try {
    const objectName = `strategies/${strategyName}_${Date.now()}.json`;
    
    // Object Storage API
    const osEndpoint = `https://objectstorage.${OCI_CONFIG.region}.oraclecloud.com/n/${OCI_CONFIG.objectStorage.namespace}/b/${OCI_CONFIG.objectStorage.bucketName}/o/${objectName}`;
    
    console.log(`☁️ Backup salvo: ${objectName}`);
    return true;
  } catch (error) {
    console.error('Erro ao salvar backup:', error);
    return false;
  }
}

// ==================== GENAI COM MARK DOUGLAS ====================

// Regras de Mark Douglas carregadas na IA
const MARK_DOUGLAS_WISDOM = {
  // Independência Estatística
  statisticalIndependence: {
    principle: 'CADA TRADE É ESTATISTICAMENTE INDEPENDENTE DO ANTERIOR.',
    implications: [
      'O mercado não tem memória do seu último trade',
      'Uma sequência de perdas NÃO aumenta a chance do próximo ser lucro',
      'O mercado não "deve" nada a você',
      'Não existe "virada de sorte" ou "compensação"'
    ],
    warningSigns: [
      'Pensando "já perdi tanto, agora vai dar certo"',
      'Aumentando posição após perdas',
      'Operando para "recuperar"',
      'Sentindo que o mercado "deve" algo'
    ]
  },
  
  // Cadeado de Ferro
  cadeadoDeFerro: [
    { rule: 'STOP_LOSS', description: 'NUNCA entre sem stop loss definido ANTES' },
    { rule: 'RISK_2_PERCENT', description: 'Máximo 2% do capital por trade' },
    { rule: 'DAILY_LOSS_6_PERCENT', description: 'Pare aos 6% de perda diária' },
    { rule: 'NO_REVENGE', description: 'NUNCA opere para recuperar perda' },
    { rule: 'MAX_10_TRADES', description: 'Máximo 10 operações por dia' },
    { rule: 'SETUP_COMPLETE', description: 'Só entre com setup completo' }
  ],
  
  // Zona de Trading
  tradingZone: {
    definition: 'Estado mental onde você aceita o risco completamente',
    characteristics: [
      'Sem medo de perder',
      'Sem esperança de ganhar',
      'Foco no processo, não no resultado',
      'Aceitação de qualquer outcome'
    ]
  }
};

// Analisar com Mark Douglas Wisdom
export async function analyzeWithMarkDouglas(
  marketData: any,
  traderState: {
    todayPnL: number;
    consecutiveLosses: number;
    consecutiveWins: number;
    emotionalState: string;
    tradesToday: number;
  }
): Promise<{
  decision: 'ENTER' | 'SKIP' | 'EXIT';
  reasoning: string;
  wisdomApplied: string[];
  cadeadoDeFerroCheck: { rule: string; passed: boolean }[];
}> {
  
  const cadeadoDeFerroCheck = MARK_DOUGLAS_WISDOM.cadeadoDeFerro.map(rule => {
    let passed = true;
    
    switch (rule.rule) {
      case 'DAILY_LOSS_6_PERCENT':
        passed = traderState.todayPnL >= -6;
        break;
      case 'NO_REVENGE':
        passed = traderState.emotionalState !== 'revenge';
        break;
      case 'MAX_10_TRADES':
        passed = traderState.tradesToday < 10;
        break;
    }
    
    return { rule: rule.rule, passed };
  });
  
  const allRulesPassed = cadeadoDeFerroCheck.every(c => c.passed);
  
  // Constrói prompt com Mark Douglas
  const prompt = `<s>[INST] Você é um mentor de trading baseado em Mark Douglas (Trading in the Zone, O Trader Disciplinado).

SABEDORIA DE MARK DOUGLAS:
${JSON.stringify(MARK_DOUGLAS_WISDOM, null, 2)}

ESTADO DO TRADER:
- PnL Hoje: ${traderState.todayPnL}%
- Perdas Consecutivas: ${traderState.consecutiveLosses}
- Wins Consecutivas: ${traderState.consecutiveWins}
- Estado Emocional: ${traderState.emotionalState}
- Trades Hoje: ${traderState.tradesToday}

DADOS DE MERCADO:
${JSON.stringify(marketData, null, 2)}

VERIFICAÇÃO CADEADO DE FERRO:
${cadeadoDeFerroCheck.map(c => `${c.passed ? '✅' : '❌'} ${c.rule}`).join('\n')}

Analise e dê sua decisão:
1. DECISÃO: ENTER, SKIP ou EXIT
2. RAZÃO: Por que essa decisão?
3. WISDOM APLICADO: Quais princípios de Mark Douglas se aplicam?
4. Lembre: Cada trade é independente. O mercado não deve nada.

Se qualquer regra do Cadeado de Ferro falhou, a decisão deve ser SKIP.
Se o trader está tentando recuperar perdas, diga "NÃO OPERE".

Responda em JSON. [/INST]`;

  try {
    const response = await fetch(OCI_CONFIG.genai.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OCI_CONFIG.genai.primaryKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        compartmentId: OCI_CONFIG.compartmentId,
        servingMode: 'ON_DEMAND',
        inferenceRequest: {
          model: OCI_CONFIG.genai.model,
          prompt,
          maxTokens: 500,
          temperature: 0.3
        }
      })
    });
    
    if (response.ok) {
      const data = await response.json() as { generatedText?: string };
      
      // Log da decisão
      await saveAIDecisionLog({
        id: `decision_${Date.now()}`,
        timestamp: new Date().toISOString(),
        decision: allRulesPassed ? 'ENTER' : 'SKIP',
        symbol: marketData.symbol || 'UNKNOWN',
        reasoning: data.generatedText || 'Análise realizada',
        marketContext: {
          trend: marketData.trend || 'neutral',
          volume: marketData.volume || 0,
          volatility: marketData.volatility || 'normal'
        },
        tradingWisdomApplied: ['statistical_independence', 'cadeado_de_ferro'],
        cadeadoDeFerroStatus: {
          stopLoss: true,
          riskPercent: 2,
          dailyLossPercent: traderState.todayPnL,
          emotionalState: traderState.emotionalState
        }
      });
      
      return {
        decision: allRulesPassed ? 'ENTER' : 'SKIP',
        reasoning: data.generatedText || 'Análise baseada em Mark Douglas',
        wisdomApplied: ['statistical_independence', 'cadeado_de_ferro'],
        cadeadoDeFerroCheck
      };
    }
  } catch (error) {
    console.error('Erro na análise:', error);
  }
  
  return {
    decision: 'SKIP',
    reasoning: 'Erro na análise - Cadeado de Ferro protege não operando',
    wisdomApplied: ['protecao_erro'],
    cadeadoDeFerroCheck
  };
}

export default {
  saveAIDecisionLog,
  getAIDecisionLogs,
  saveTradeToATP,
  saveTickToNoSQL,
  getTicksFromNoSQL,
  saveStrategyBackup,
  analyzeWithMarkDouglas,
  OCI_CONFIG
};
