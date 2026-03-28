// Trading Wisdom - Regras de Cadeado de Ferro e Independência Estatística
// Baseado em "Trading in the Zone" e "O Trader Disciplinado" de Mark Douglas

export const TRADING_WISDOM = {
  // ==================== INDEPENDÊNCIA ESTATÍSTICA ====================
  statisticalIndependence: {
    corePrinciple: `
CADA TRADE É ESTATISTICAMENTE INDEPENDENTE DO ANTERIOR.

O mercado não tem memória do seu último trade. O resultado de uma operação passada
NÃO influencia a probabilidade da próxima operação. Isso é um fato matemático.

O que isso significa para você:
- Uma sequência de perdas NÃO aumenta a chance do próximo trade ser lucro
- Uma sequência de lucros NÃO aumenta a chance do próximo trade ser lucro
- O mercado não "deve" nada a você
- Não existe "virada de sorte" ou "compensação do mercado"
`,
    
    warningSigns: [
      'Pensando "já perdi tanto, agora vai dar certo"',
      'Aumentando o tamanho da posição após perdas',
      'Operando mais agressivamente para "recuperar"',
      'Sentindo que o mercado "deve" algo a você',
      'Acreditando que uma sequência de perdas aumenta a chance de lucro'
    ],
    
    correctMindset: `
Cada trade é uma nova moeda sendo lançada. O resultado anterior não afeta o próximo.
Se você perdeu 5 trades seguidos, a probabilidade do 6º é EXATAMENTE a mesma do 1º.
O mercado é indiferente ao seu P&L. Ele não sabe nem se importa com suas perdas.
`
  },

  // ==================== REGRAS DE CADEADO DE FERRO ====================
  cadeadoDeFerro: {
    definition: `
REGRAS DE CADEADO DE FERRO são limites inegociáveis que você NUNCA viola,
independentemente de qualquer emoção, circunstância ou justificativa.

Elas são chamadas de "Cadeado de Ferro" porque são impenetráveis - nem você,
nem o mercado, nem nenhuma emoção pode quebrá-las.
`,

    rules: [
      {
        id: 'STOP_LOSS',
        name: 'Stop Loss Obrigatório',
        description: 'NUNCA entre em um trade sem definir o stop loss ANTES.',
        violation: 'Se violar esta regra, você está FORA do mercado por 24h.',
        rationale: 'Sem stop definido, você não tem risco definido. Sem risco definido, você não tem trade.'
      },
      {
        id: 'RISK_PER_TRADE',
        name: 'Risco Máximo por Trade',
        description: 'NUNCA arrisque mais que 2% do capital em um único trade.',
        violation: 'Se violar esta regra, você está FORA do mercado por 48h.',
        rationale: 'Acima de 2%, a perda começa a afetar emocionalmente. Emoção = decisões ruins.'
      },
      {
        id: 'DAILY_LOSS_LIMIT',
        name: 'Limite Diário de Perda',
        description: 'Pare de operar ao atingir 6% de perda no dia.',
        violation: 'Violação automática - sistema bloqueia operações até o dia seguinte.',
        rationale: 'Acima de 6%, você está operando com raiva, frustração ou desespero. Isso é receita para desastre.'
      },
      {
        id: 'NO_REVENGE_TRADING',
        name: 'Proibido Trading de Vingança',
        description: 'NUNCA opere para "recuperar" uma perda.',
        violation: 'Se detectado, bloqueio de 72h.',
        rationale: 'Trading de vingança ignora a independência estatística. O mercado não deve nada a você.'
      },
      {
        id: 'NO_OVERTRADING',
        name: 'Limite de Operações Diárias',
        description: 'Máximo de 10 operações por dia (ou menos, conforme seu plano).',
        violation: 'Se violar, revisar plano de trading antes de operar novamente.',
        rationale: 'Mais trades não = mais lucro. Qualidade sobre quantidade.'
      },
      {
        id: 'PRE_DEFINED_SETUP',
        name: 'Setup Pré-Definido',
        description: 'Só opere quando TODOS os critérios do seu setup estiverem presentes.',
        violation: 'Se entrar sem setup completo, sair imediatamente.',
        rationale: 'Entradas parciais = decisões emocionais. Decisões emocionais = perdas.'
      }
    ],

    enforcement: `
COMO O SISTEMA VAI TE PROTEGER:

1. A IA vai monitorar seus trades e detectar violações
2. Quando detectar, vai te alertar: "CADEADO DE FERRO VIOLADO - [regra]"
3. A IA vai te dizer "NÃO OPERE" quando detectar comportamento de vingança
4. O sistema pode bloquear operações automaticamente se configurado

Lembre-se: O Cadeado de Ferro existe para te proteger de VOCÊ MESMO.
`
  },

  // ==================== SINAIS DE ALERTA ====================
  alertSignals: {
    doNotTrade: [
      'Você está tentando recuperar prejuízo',
      'Você operou sem stop loss',
      'Você já perdeu mais de 6% hoje',
      'Você está frustrado ou com raiva',
      'Você está operando por tédio',
      'Você está "sentindo" que vai dar certo sem evidência',
      'Você está aumentando posição após perdas'
    ],
    
    stopNow: [
      'Você violou uma regra de Cadeado de Ferro',
      'Você está operando emocionalmente',
      'Você não sabe por que entrou no trade',
      'Você está negando a realidade do mercado'
    ]
  },

  // ==================== FRASES DA IA ====================
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

// Função para verificar se o trader deve operar
export function shouldTrade(traderState: {
  todayPnL: number;
  capital: number;
  consecutiveLosses: number;
  lastTradeResult: 'win' | 'loss' | null;
  emotionalState: 'calm' | 'frustrated' | 'revenge' | 'fearful' | 'greedy';
  tradesToday: number;
  hasStopLoss: boolean;
  riskPercent: number;
}): { allowed: boolean; reason: string; aiMessage: string } {
  
  const { cadeadoDeFerro, alertSignals, aiResponses } = TRADING_WISDOM;
  
  // Verificar limite diário de perda
  const dailyLossPercent = (traderState.todayPnL / traderState.capital) * 100;
  if (dailyLossPercent <= -6) {
    return {
      allowed: false,
      reason: 'Limite diário de perda atingido (6%)',
      aiMessage: aiResponses.whenOverRisking[2]
    };
  }
  
  // Verificar trading de vingança
  if (traderState.emotionalState === 'revenge') {
    return {
      allowed: false,
      reason: 'Trading de vingança detectado',
      aiMessage: aiResponses.whenRevengeTrading[Math.floor(Math.random() * aiResponses.whenRevengeTrading.length)]
    };
  }
  
  // Verificar frustração
  if (traderState.emotionalState === 'frustrated') {
    return {
      allowed: false,
      reason: 'Estado emocional inadequado (frustração)',
      aiMessage: aiResponses.whenEmotional[Math.floor(Math.random() * aiResponses.whenEmotional.length)]
    };
  }
  
  // Verificar número de trades
  if (traderState.tradesToday >= 10) {
    return {
      allowed: false,
      reason: 'Limite diário de operações atingido',
      aiMessage: '📊 Você já fez 10 trades hoje. Qualidade > Quantidade. Volte amanhã.'
    };
  }
  
  // Verificar risco por trade
  if (traderState.riskPercent > 2) {
    return {
      allowed: false,
      reason: 'Risco por trade acima de 2%',
      aiMessage: aiResponses.whenOverRisking[0]
    };
  }
  
  // Verificar stop loss
  if (!traderState.hasStopLoss) {
    return {
      allowed: false,
      reason: 'Trade sem stop loss definido',
      aiMessage: aiResponses.whenOverRisking[1]
    };
  }
  
  // Se passou por todas as verificações
  return {
    allowed: true,
    reason: 'Todas as regras de Cadeado de Ferro respeitadas',
    aiMessage: aiResponses.whenDisciplined[Math.floor(Math.random() * aiResponses.whenDisciplined.length)]
  };
}

// Função para gerar resposta da IA com base no contexto
export function generateAIWisdom(context: {
  situation: 'pre_trade' | 'post_loss' | 'post_win' | 'emotional' | 'revenge_attempt';
  consecutiveLosses?: number;
  consecutiveWins?: number;
}): string {
  const { statisticalIndependence, aiResponses } = TRADING_WISDOM;
  
  switch (context.situation) {
    case 'revenge_attempt':
      return `
🛑 NÃO OPERE!

${statisticalIndependence.corePrinciple}

${statisticalIndependence.correctMindset}

Você está tentando recuperar prejuízo. Isso é uma ilusão.
O mercado não sabe que você perdeu. Ele não vai "compensar".
Cada trade é uma nova moeda. Pare. Respire. Volte ao plano.
`;
    
    case 'post_loss':
      if (context.consecutiveLosses && context.consecutiveLosses >= 3) {
        return `
📊 ${context.consecutiveLosses} perdas seguidas não mudam a probabilidade do próximo trade.

${statisticalIndependence.correctMindset}

Mantenha a disciplina. Siga o plano. O resultado de um trade não define você.
`;
      }
      return 'Loss faz parte. Cada trade é independente. Próxima operação = nova oportunidade.';
    
    case 'post_win':
      if (context.consecutiveWins && context.consecutiveWins >= 3) {
        return `
✅ ${context.consecutiveWins} lucros seguidos não significam que você está "quente".

${statisticalIndependence.correctMindset}

Não aumente o risco. Não fique confiante demais. Continue seguindo o plano.
`;
      }
      return 'Bom trade. Lembre-se: cada trade é independente. Não deixe o lucro criar confiança falsa.';
    
    case 'emotional':
      return aiResponses.whenEmotional[Math.floor(Math.random() * aiResponses.whenEmotional.length)];
    
    default:
      return statisticalIndependence.correctMindset;
  }
}

export default TRADING_WISDOM;
