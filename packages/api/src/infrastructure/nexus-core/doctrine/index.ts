/**
 * VEXOR Doctrine - Export Index
 * Sistema completo de doutrina de trading
 */

export { preOpeningChecklist } from './pre-opening.js';
export type { BriefingResult, ChecklistItem } from './pre-opening.js';

export { probabilityFilters } from './probability-filters.js';
export type { FilterContext, FilterResult } from './probability-filters.js';

export { quantitativeAudit } from './quantitative-audit.js';
export type { SessionMetrics, StrategyAudit } from './quantitative-audit.js';

export { tiltDetector } from './tilt-detector.js';
export type { TiltLevel, TiltState } from './tilt-detector.js';

export { strategyFactory } from './strategy-factory.js';
export type { Strategy, StrategyGene, EvolutionConfig } from './strategy-factory.js';

export { barbellStrategy } from './barbell-strategy.js';
export type { BarbellAllocation, MarketCondition } from './barbell-strategy.js';

console.log('[Doctrine] ✅ VEXOR Doctrine carregada');
