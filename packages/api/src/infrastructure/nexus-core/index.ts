/**
 * NEXUS-CORE - 8 Camadas de Processamento
 * Sistema completo de IA para trading
 */

// ==================== CAMADA 1: FONTES EXTERNAS ====================
export * from './sources/index.js';

// ==================== CAMADA 2: WORKERS ====================
export * from './workers/index.js';

// ==================== CAMADA 3: NORMALIZER ====================
export * from './normalizer/index.js';

// ==================== CAMADA 4: MEMÓRIA ====================
export * from './memory/index.js';

// ==================== CAMADA 5: IA CORE ====================
export * from './ai-core/index.js';

// ==================== CAMADA 6: AGENTES ====================
export * from './agents/index.js';

// ==================== CAMADA 7: RISCO ====================
export * from './risk/index.js';

// ==================== CAMADA 8: EXECUÇÃO ====================
export * from './execution/index.js';
