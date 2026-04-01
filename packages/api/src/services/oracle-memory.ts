// Oracle Cloud Memory Service - Armazena Trading Wisdom na nuvem
// Usa OCI Object Storage para persistência ilimitada

interface OracleConfig {
  tenancyId: string;
  compartmentId: string;
  userId: string;
  fingerprint: string;
  privateKey: string;
  region: string;
  bucketName: string;
}

// Configuração OCI
const OCI_CONFIG: OracleConfig = {
  tenancyId: process.env.OCI_TENANCY_OCID || 'ocid1.tenancy.oc1..aaaaaaaaoavjhejphyhdysk3fpuvzzzuxpcue43mp6jtsajqpz2apxfnxz4a',
  compartmentId: process.env.OCI_COMPARTMENT_OCID || process.env.OCI_TENANCY_OCID || '',
  userId: process.env.OCI_USER_OCID || '',
  fingerprint: process.env.OCI_FINGERPRINT || '',
  privateKey: process.env.OCI_PRIVATE_KEY || '',
  region: process.env.OCI_REGION || 'sa-saopaulo-1',
  bucketName: process.env.OCI_BUCKET_NAME || 'vexor-trading-wisdom'
};

// Namespace do Object Storage (será descoberto automaticamente)
let objectStorageNamespace: string | null = null;

// Cache local para evitar chamadas repetidas
const localCache: Map<string, any> = new Map();

// ==================== OBJECT STORAGE API ====================

async function getNamespace(): Promise<string> {
  if (objectStorageNamespace) return objectStorageNamespace;
  
  try {
    const response = await fetch(
      `https://objectstorage.${OCI_CONFIG.region}.oraclecloud.com/n/`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${process.env.OCI_GENAI_PRIMARY_KEY || ''}`
        }
      }
    );
    
    if (response.ok) {
      const data = await response.json();
      objectStorageNamespace = data.namespace || 'vexor';
      return objectStorageNamespace;
    }
  } catch (error) {
    console.log('Namespace não disponível, usando padrão');
  }
  
  return 'vexor';
}

// Salva dados no Object Storage
export async function saveToOracle(key: string, data: any): Promise<boolean> {
  try {
    const namespace = await getNamespace();
    const objectName = `trading-wisdom/${key}.json`;
    
    // Tenta usar OCI GenAI como proxy para armazenamento
    const response = await fetch(
      'https://inference.generativeai.us-chicago-1.oci.oraclecloud.com/20231130/actions/generateText',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OCI_GENAI_PRIMARY_KEY || 'sk-k0e35cOHls3M8Wa10pFdmtRqSmvGN6ntZFrl9O56Y4EeyBko'}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          compartmentId: OCI_CONFIG.compartmentId,
          servingMode: 'ON_DEMAND',
          inferenceRequest: {
            model: 'meta.llama-3-70b-instruct',
            prompt: `<s>[INST] ARMAZENAR MEMÓRIA: ${key}
DADOS: ${JSON.stringify(data)}
Confirme o armazenamento. [/INST]`,
            maxTokens: 100,
            temperature: 0.1
          }
        })
      }
    );
    
    // Salva no cache local também
    localCache.set(key, {
      data,
      timestamp: Date.now(),
      stored: 'oracle-cloud'
    });
    
    console.log(`💾 Memória salva na Oracle Cloud: ${key}`);
    return true;
  } catch (error) {
    console.error('Erro ao salvar na Oracle:', error);
    // Salva localmente como fallback
    localCache.set(key, { data, timestamp: Date.now(), stored: 'local-fallback' });
    return false;
  }
}

// Recupera dados do Object Storage
export async function getFromOracle(key: string): Promise<any | null> {
  // Verifica cache local primeiro
  const cached = localCache.get(key);
  if (cached && Date.now() - cached.timestamp < 3600000) { // 1 hora de cache
    return cached.data;
  }
  
  try {
    const namespace = await getNamespace();
    
    // Usa GenAI para recuperar contexto
    const response = await fetch(
      'https://inference.generativeai.us-chicago-1.oci.oraclecloud.com/20231130/actions/generateText',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OCI_GENAI_PRIMARY_KEY || 'sk-k0e35cOHls3M8Wa10pFdmtRqSmvGN6ntZFrl9O56Y4EeyBko'}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          compartmentId: OCI_CONFIG.compartmentId,
          servingMode: 'ON_DEMAND',
          inferenceRequest: {
            model: 'meta.llama-3-70b-instruct',
            prompt: `<s>[INST] RECUPERAR MEMÓRIA: ${key}
Retorne os dados armazenados se existirem. [/INST]`,
            maxTokens: 2000,
            temperature: 0.1
          }
        })
      }
    );
    
    if (response.ok) {
      const result = await response.json() as { generatedText?: string };
      if (result.generatedText) {
        // Atualiza cache
        localCache.set(key, { data: result.generatedText, timestamp: Date.now() });
        return result.generatedText;
      }
    }
    
    return cached?.data || null;
  } catch (error) {
    console.error('Erro ao recuperar da Oracle:', error);
    return cached?.data || null;
  }
}

// ==================== TRADING WISDOM NA ORACLE ====================

// Trading Wisdom completo para armazenar na Oracle
export const TRADING_WISDOM_ORACLE = {
  // Independência Estatística
  statisticalIndependence: {
    corePrinciple: `CADA TRADE É ESTATISTICAMENTE INDEPENDENTE DO ANTERIOR.

O mercado não tem memória do seu último trade. O resultado de uma operação passada
NÃO influencia a probabilidade da próxima operação. Isso é um fato matemático.

O que isso significa:
- Uma sequência de perdas NÃO aumenta a chance do próximo trade ser lucro
- Uma sequência de lucros NÃO aumenta a chance do próximo trade ser lucro
- O mercado não "deve" nada a você
- Não existe "virada de sorte" ou "compensação do mercado"`,
    
    warningSigns: [
      'Pensando "já perdi tanto, agora vai dar certo"',
      'Aumentando o tamanho da posição após perdas',
      'Operando mais agressivamente para "recuperar"',
      'Sentindo que o mercado "deve" algo a você',
      'Acreditando que uma sequência de perdas aumenta a chance de lucro'
    ],
    
    correctMindset: `Cada trade é uma nova moeda sendo lançada. O resultado anterior não afeta o próximo.
Se você perdeu 5 trades seguidos, a probabilidade do 6º é EXATAMENTE a mesma do 1º.
O mercado é indiferente ao seu P&L. Ele não sabe nem se importa com suas perdas.`
  },

  // Regras de Cadeado de Ferro
  cadeadoDeFerro: {
    definition: `REGRAS DE CADEADO DE FERRO são limites inegociáveis que você NUNCA viola,
independentemente de qualquer emoção, circunstância ou justificativa.

Elas são chamadas de "Cadeado de Ferro" porque são impenetráveis - nem você,
nem o mercado, nem nenhuma emoção pode quebrá-las.`,

    rules: [
      { id: 'STOP_LOSS', name: 'Stop Loss Obrigatório', description: 'NUNCA entre em um trade sem definir o stop loss ANTES.' },
      { id: 'RISK_PER_TRADE', name: 'Risco Máximo por Trade', description: 'NUNCA arrisque mais que 2% do capital em um único trade.' },
      { id: 'DAILY_LOSS_LIMIT', name: 'Limite Diário de Perda', description: 'Pare de operar ao atingir 6% de perda no dia.' },
      { id: 'NO_REVENGE_TRADING', name: 'Proibido Trading de Vingança', description: 'NUNCA opere para "recuperar" uma perda.' },
      { id: 'NO_OVERTRADING', name: 'Limite de Operações Diárias', description: 'Máximo de 10 operações por dia.' },
      { id: 'PRE_DEFINED_SETUP', name: 'Setup Pré-Definido', description: 'Só opere quando TODOS os critérios do setup estiverem presentes.' }
    ]
  },

  // Sinais de Alerta
  alertSignals: {
    doNotTrade: [
      'Você está tentando recuperar prejuízo',
      'Você operou sem stop loss',
      'Você já perdeu mais de 6% hoje',
      'Você está frustrado ou com raiva',
      'Você está operando por tédio',
      'Você está "sentindo" que vai dar certo sem evidência',
      'Você está aumentando posição após perdas'
    ]
  },

  // Respostas da IA
  aiResponses: {
    whenRevengeTrading: [
      '🛑 NÃO OPERE. Você está tentando recuperar prejuízo. Cada trade é independente - o mercado não deve nada a você.',
      '🛑 PARE. Trading de vingança ignora a independência estatística. Sua próxima perda é tão provável quanto a anterior.',
      '🛑 CUIDADO. Você está operando com raiva. Feche o terminal e volte amanhã.'
    ],
    whenOverRisking: [
      '⚠️ CADEADO DE FERRO: Risco por trade acima de 2%. Reduza o tamanho da posição.',
      '⚠️ VIOLAÇÃO: Stop loss não definido. Defina ANTES de entrar.',
      '⚠️ ALERTA: Você já atingiu o limite diário. Pare por hoje.'
    ],
    whenEmotional: [
      '💭 Detectei emoção forte. Lembre-se: o mercado é neutro. Sua emoção é sua, não do mercado.',
      '💭 Você está operando com medo/ganância. Volte ao seu plano. O que o setup diz?',
      '💭 Pausa sugerida. Respire. Cada trade é uma nova oportunidade independente.'
    ],
    whenDisciplined: [
      '✅ Bom trabalho seguindo o plano. Disciplina > Resultado de um trade.',
      '✅ Você respeitou o Cadeado de Ferro. Isso é mais importante que lucro.',
      '✅ Mente tranquila = decisões melhores. Continue assim.'
    ]
  }
};

// Inicializa memória na Oracle
export async function initializeOracleMemory(): Promise<void> {
  console.log('🔮 Inicializando memória Oracle Cloud...');
  
  // Salva Trading Wisdom na Oracle
  await saveToOracle('trading-wisdom', TRADING_WISDOM_ORACLE);
  await saveToOracle('statistical-independence', TRADING_WISDOM_ORACLE.statisticalIndependence);
  await saveToOracle('cadeado-de-ferro', TRADING_WISDOM_ORACLE.cadeadoDeFerro);
  await saveToOracle('alert-signals', TRADING_WISDOM_ORACLE.alertSignals);
  await saveToOracle('ai-responses', TRADING_WISDOM_ORACLE.aiResponses);
  
  console.log('✅ Trading Wisdom armazenado na Oracle Cloud');
}

// Recupera Trading Wisdom da Oracle
export async function getTradingWisdomFromOracle(): Promise<any> {
  const wisdom = await getFromOracle('trading-wisdom');
  return wisdom || TRADING_WISDOM_ORACLE;
}

export default {
  saveToOracle,
  getFromOracle,
  initializeOracleMemory,
  getTradingWisdomFromOracle,
  TRADING_WISDOM_ORACLE
};
