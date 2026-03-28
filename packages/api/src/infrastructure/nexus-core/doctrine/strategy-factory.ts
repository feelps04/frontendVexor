/**
 * VEXOR Doctrine - Strategy Factory (Algoritmo Evolutivo GA)
 * Gera variações de estratégias automaticamente
 * Paper trading 20 sessões antes de capital real
 * Sobrevivem apenas PF > 1.5
 */

import { oracleDB } from '../../oracle-db.js';
import { telegramNotifier } from '../../telegram-notifier.js';
import { nosqlBooks } from '../../nosql-books.js';

interface StrategyGene {
  name: string;
  value: number;
  min: number;
  max: number;
  mutationRate: number;
}

interface Strategy {
  id: string;
  name: string;
  genes: StrategyGene[];
  generation: number;
  parentId: string | null;
  status: 'PAPER' | 'LIVE' | 'DISABLED';
  paperSessions: number;
  profitFactor: number;
  expectancy: number;
  winRate: number;
  totalTrades: number;
  createdAt: Date;
}

interface EvolutionConfig {
  populationSize: number;
  mutationRate: number;
  crossoverRate: number;
  elitismCount: number;
  minPaperSessions: number;
  minProfitFactor: number;
}

class StrategyFactory {
  private population: Strategy[] = [];
  private config: EvolutionConfig = {
    populationSize: 20,
    mutationRate: 0.1,
    crossoverRate: 0.7,
    elitismCount: 2,
    minPaperSessions: 20,
    minProfitFactor: 1.5
  };

  private readonly BASE_GENES: StrategyGene[] = [
    { name: 'stopPercent', value: 2, min: 0.5, max: 5, mutationRate: 0.2 },
    { name: 'targetMultiplier', value: 2, min: 1.5, max: 5, mutationRate: 0.2 },
    { name: 'volumeThreshold', value: 1.5, min: 1.2, max: 3, mutationRate: 0.15 },
    { name: 'rsiOversold', value: 30, min: 20, max: 40, mutationRate: 0.1 },
    { name: 'rsiOverbought', value: 70, min: 60, max: 80, mutationRate: 0.1 },
    { name: 'bbPeriod', value: 20, min: 10, max: 30, mutationRate: 0.05 },
    { name: 'bbStdDev', value: 2, min: 1.5, max: 3, mutationRate: 0.1 },
    { name: 'smaFast', value: 9, min: 5, max: 15, mutationRate: 0.05 },
    { name: 'smaSlow', value: 21, min: 15, max: 30, mutationRate: 0.05 },
    { name: 'trailingStopPercent', value: 1.5, min: 0.5, max: 3, mutationRate: 0.15 }
  ];

  constructor() {
    this.loadPopulation();
  }

  /**
   * Gera nova geração de estratégias
   */
  async evolve(): Promise<Strategy[]> {
    console.log('[StrategyFactory] 🧬 Iniciando evolução...');

    // Carrega estratégias existentes
    await this.loadPopulation();

    // Avalia fitness
    const evaluated = await this.evaluatePopulation();

    // Seleção (torneio)
    const selected = this.select(evaluated);

    // Crossover
    const offspring = this.crossover(selected);

    // Mutação
    const mutated = this.mutate(offspring);

    // Elitismo (mantém melhores)
    const elite = evaluated
      .filter(s => s.status === 'LIVE' && s.profitFactor >= this.config.minProfitFactor)
      .slice(0, this.config.elitismCount);

    // Nova população
    this.population = [...elite, ...mutated];

    // Salva no banco
    await this.savePopulation();

    // Notifica
    await this.notifyEvolution(elite, mutated);

    return this.population;
  }

  /**
   * Carrega população do banco e dos livros NoSQL embedados
   */
  private async loadPopulation(): Promise<void> {
    try {
      // Primeiro tenta carregar dos livros embedados via Ollama
      const books = await nosqlBooks.loadStrategyBooks();
      
      if (books.length > 0) {
        console.log(`[StrategyFactory] 📚 ${books.length} livros carregados do bucket`);
        
        for (const book of books) {
          for (const strategy of book.strategies) {
            // Salva cada estratégia no Oracle
            const id = oracleDB.generateId();
            await oracleDB.insert(`
              INSERT INTO strategies (id, name, genes, generation, strategy_status, paper_sessions, profit_factor, win_rate)
              VALUES (:id, :name, :genes, 1, 'PAPER', 0, :pf, :wr)
            `, {
              id,
              name: strategy.name,
              genes: JSON.stringify(strategy.genes),
              pf: strategy.profitFactor || 1.5,
              wr: strategy.winRate || 0.6
            });
          }
          console.log(`[StrategyFactory] ✅ ${book.strategies.length} estratégias do livro "${book.name}" salvas`);
        }
      }
      
      // Carrega do banco Oracle
      const rows = await oracleDB.query<{
        ID: string;
        NAME: string;
        GENES: string;
        GENERATION: number;
        PARENT_ID: string | null;
        STRATEGY_STATUS: string;
        PAPER_SESSIONS: number;
        PROFIT_FACTOR: number;
        EXPECTANCY: number;
        WIN_RATE: number;
        TOTAL_TRADES: number;
        CREATED_AT: Date;
      }>(`SELECT * FROM strategies WHERE strategy_status != 'DISABLED'`);

      this.population = rows.map(row => ({
        id: row.ID,
        name: row.NAME,
        genes: JSON.parse(row.GENES),
        generation: row.GENERATION,
        parentId: row.PARENT_ID,
        status: row.STRATEGY_STATUS as 'PAPER' | 'LIVE' | 'DISABLED',
        paperSessions: row.PAPER_SESSIONS,
        profitFactor: row.PROFIT_FACTOR,
        expectancy: row.EXPECTANCY,
        winRate: row.WIN_RATE,
        totalTrades: row.TOTAL_TRADES,
        createdAt: row.CREATED_AT
      }));

      console.log(`[StrategyFactory] ${this.population.length} estratégias carregadas`);
    } catch (e) {
      console.error('[StrategyFactory] Erro ao carregar:', e);
      // Cria população inicial
      this.population = this.createInitialPopulation();
    }
  }

  /**
   * Cria população inicial
   */
  private createInitialPopulation(): Strategy[] {
    const population: Strategy[] = [];

    for (let i = 0; i < this.config.populationSize; i++) {
      population.push({
        id: oracleDB.generateId(),
        name: `GEN0_STR${i + 1}`,
        genes: this.BASE_GENES.map(g => ({
          ...g,
          value: g.min + Math.random() * (g.max - g.min)
        })),
        generation: 0,
        parentId: null,
        status: 'PAPER',
        paperSessions: 0,
        profitFactor: 0,
        expectancy: 0,
        winRate: 0,
        totalTrades: 0,
        createdAt: new Date()
      });
    }

    return population;
  }

  /**
   * Avalia fitness da população
   */
  private async evaluatePopulation(): Promise<Strategy[]> {
    const evaluated: Strategy[] = [];

    for (const strategy of this.population) {
      try {
        // Busca métricas do banco
        const rows = await oracleDB.query<{
          PF: number;
          EXP: number;
          WR: number;
          TOTAL: number;
          SESSIONS: number;
        }>(`
          SELECT 
            COALESCE(
              SUM(CASE WHEN pnl > 0 THEN pnl END) / 
              NULLIF(ABS(SUM(CASE WHEN pnl < 0 THEN pnl END)), 0),
              0
            ) as PF,
            0 as EXP,
            AVG(CASE WHEN outcome = 1 THEN 1 ELSE 0 END) as WR,
            COUNT(*) as TOTAL,
            COUNT(DISTINCT TRUNC(closed_at)) as SESSIONS
          FROM trade_history
          WHERE strategy = :name
        `, { name: strategy.name });

        const row = rows[0];
        strategy.profitFactor = row?.PF || 0;
        strategy.expectancy = row?.EXP || 0;
        strategy.winRate = row?.WR || 0;
        strategy.totalTrades = row?.TOTAL || 0;
        strategy.paperSessions = row?.SESSIONS || 0;

        // Verifica se pode ir para LIVE
        if (strategy.status === 'PAPER' && 
            strategy.paperSessions >= this.config.minPaperSessions &&
            strategy.profitFactor >= this.config.minProfitFactor) {
          strategy.status = 'LIVE';
          await this.promoteStrategy(strategy);
        }

        // Verifica se deve ser desativada
        if (strategy.status === 'LIVE' && strategy.profitFactor < 1.0) {
          strategy.status = 'DISABLED';
          await this.disableStrategy(strategy);
        }

        evaluated.push(strategy);
      } catch {
        evaluated.push(strategy);
      }
    }

    return evaluated;
  }

  /**
   * Seleção por torneio
   */
  private select(population: Strategy[]): Strategy[] {
    const selected: Strategy[] = [];

    for (let i = 0; i < population.length; i++) {
      // Torneio de 3
      const candidates = [
        population[Math.floor(Math.random() * population.length)],
        population[Math.floor(Math.random() * population.length)],
        population[Math.floor(Math.random() * population.length)]
      ];

      // Melhor fitness (profit factor)
      const winner = candidates.reduce((best, curr) => 
        curr.profitFactor > best.profitFactor ? curr : best
      );

      selected.push(winner);
    }

    return selected;
  }

  /**
   * Crossover
   */
  private crossover(parents: Strategy[]): Strategy[] {
    const offspring: Strategy[] = [];

    for (let i = 0; i < parents.length; i += 2) {
      const parent1 = parents[i];
      const parent2 = parents[i + 1] || parents[0];

      if (Math.random() < this.config.crossoverRate) {
        // Crossover de ponto único
        const crossPoint = Math.floor(Math.random() * parent1.genes.length);

        const child1Genes = [
          ...parent1.genes.slice(0, crossPoint),
          ...parent2.genes.slice(crossPoint)
        ];

        const child2Genes = [
          ...parent2.genes.slice(0, crossPoint),
          ...parent1.genes.slice(crossPoint)
        ];

        offspring.push(
          this.createChild(child1Genes, parent1, parent2),
          this.createChild(child2Genes, parent2, parent1)
        );
      } else {
        offspring.push(parent1, parent2);
      }
    }

    return offspring;
  }

  /**
   * Cria filho
   */
  private createChild(genes: StrategyGene[], p1: Strategy, p2: Strategy): Strategy {
    return {
      id: oracleDB.generateId(),
      name: `GEN${Math.max(p1.generation, p2.generation) + 1}_${Date.now()}`,
      genes,
      generation: Math.max(p1.generation, p2.generation) + 1,
      parentId: p1.id,
      status: 'PAPER',
      paperSessions: 0,
      profitFactor: 0,
      expectancy: 0,
      winRate: 0,
      totalTrades: 0,
      createdAt: new Date()
    };
  }

  /**
   * Mutação
   */
  private mutate(population: Strategy[]): Strategy[] {
    return population.map(individual => {
      if (Math.random() < this.config.mutationRate) {
        const geneIndex = Math.floor(Math.random() * individual.genes.length);
        const gene = individual.genes[geneIndex];

        // Mutação gaussiana
        const mutation = (Math.random() - 0.5) * 2 * gene.mutationRate;
        gene.value = Math.max(gene.min, Math.min(gene.max, gene.value * (1 + mutation)));
      }

      return individual;
    });
  }

  /**
   * Promove estratégia para LIVE
   */
  private async promoteStrategy(strategy: Strategy): Promise<void> {
    try {
      await oracleDB.update(
        `UPDATE strategies SET strategy_status = 'LIVE' WHERE id = :id`,
        { id: strategy.id }
      );

      await telegramNotifier.sendMessage(
        `🚀 <b>ESTRATÉGIA PROMOVIDA</b>\n\n` +
        `📊 ${strategy.name}\n` +
        `📈 PF: ${strategy.profitFactor.toFixed(2)}\n` +
        `🎯 Win Rate: ${(strategy.winRate * 100).toFixed(1)}%\n` +
        `📅 Sessões: ${strategy.paperSessions}\n\n` +
        `⚡ VEXOR`
      );
    } catch (e) {
      console.error('[StrategyFactory] Erro ao promover:', e);
    }
  }

  /**
   * Desativa estratégia
   */
  private async disableStrategy(strategy: Strategy): Promise<void> {
    try {
      await oracleDB.update(
        `UPDATE strategies SET strategy_status = 'DISABLED' WHERE id = :id`,
        { id: strategy.id }
      );

      await telegramNotifier.sendMessage(
        `🚫 <b>ESTRATÉGIA DESATIVADA</b>\n\n` +
        `📊 ${strategy.name}\n` +
        `📉 PF: ${strategy.profitFactor.toFixed(2)}\n\n` +
        `⚡ VEXOR`
      );
    } catch (e) {
      console.error('[StrategyFactory] Erro ao desativar:', e);
    }
  }

  /**
   * Salva população no banco
   */
  private async savePopulation(): Promise<void> {
    try {
      for (const strategy of this.population) {
        await oracleDB.insert(`
          MERGE INTO strategies d
          USING (SELECT :id as id FROM DUAL) s
          ON (d.id = s.id)
          WHEN MATCHED THEN UPDATE SET
            genes = :genes,
            profit_factor = :pf,
            expectancy = :exp,
            win_rate = :wr,
            total_trades = :total,
            paper_sessions = :sessions,
            strategy_status = :status
          WHEN NOT MATCHED THEN INSERT (
            id, name, genes, generation, parent_id, strategy_status, paper_sessions,
            profit_factor, expectancy, win_rate, total_trades, created_at
          ) VALUES (
            :id, :name, :genes, :gen, :parentId, :status, :sessions,
            :pf, :exp, :wr, :total, :createdAt
          )
        `, {
          id: strategy.id,
          name: strategy.name,
          genes: JSON.stringify(strategy.genes),
          gen: strategy.generation,
          parentId: strategy.parentId,
          status: strategy.status,
          sessions: strategy.paperSessions,
          pf: strategy.profitFactor,
          exp: strategy.expectancy,
          wr: strategy.winRate,
          total: strategy.totalTrades,
          createdAt: strategy.createdAt
        });
      }
    } catch (e) {
      console.error('[StrategyFactory] Erro ao salvar:', e);
    }
  }

  /**
   * Notifica evolução
   */
  private async notifyEvolution(elite: Strategy[], newStrategies: Strategy[]): Promise<void> {
    const message = 
      `🧬 <b>EVOLUÇÃO CONCLUÍDA</b>\n\n` +
      `📊 <b>Elite:</b> ${elite.length} estratégias\n` +
      `🆕 <b>Novas:</b> ${newStrategies.length} estratégias\n` +
      `📈 <b>Geração:</b> ${Math.max(...this.population.map(s => s.generation))}\n\n` +
      `⚡ VEXOR Strategy Factory`;

    await telegramNotifier.sendMessage(message);
  }

  /**
   * Obtém estratégias ativas
   */
  getActiveStrategies(): Strategy[] {
    return this.population.filter(s => s.status === 'LIVE');
  }

  /**
   * Obtém melhor estratégia
   */
  getBestStrategy(): Strategy | null {
    const active = this.getActiveStrategies();
    if (active.length === 0) return null;

    return active.reduce((best, curr) => 
      curr.profitFactor > best.profitFactor ? curr : best
    );
  }

  /**
   * Obtém genes de estratégia
   */
  getStrategyGenes(name: string): StrategyGene[] | null {
    const strategy = this.population.find(s => s.name === name);
    return strategy?.genes || null;
  }
}

// Singleton
export const strategyFactory = new StrategyFactory();
export type { Strategy, StrategyGene, EvolutionConfig };
