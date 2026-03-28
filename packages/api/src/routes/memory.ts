// Memory Routes - API para dados em tempo real da memória MMF
import { FastifyInstance } from 'fastify';
import { readMemoryMappedFile, analyzeWithGenAI, getCurrentMemoryData } from '../services/memory-reader.js';

export async function memoryRoutes(app: FastifyInstance) {
  // Lê dados atuais da memória
  app.get('/api/v1/memory/ticks', async (request, reply) => {
    try {
      const ticks = await readMemoryMappedFile();
      return {
        success: true,
        data: ticks,
        count: ticks.length,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: 'Erro ao ler memória MMF'
      });
    }
  });

  // Análise de mercado com OCI GenAI
  app.get('/api/v1/memory/analyze', async (request, reply) => {
    try {
      const ticks = await readMemoryMappedFile();
      const analysis = await analyzeWithGenAI(ticks);
      
      return {
        success: true,
        analysis,
        dataPoints: ticks.length,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: 'Erro na análise'
      });
    }
  });

  // Status do buffer de memória
  app.get('/api/v1/memory/status', async (request, reply) => {
    const memoryData = getCurrentMemoryData();
    
    return {
      success: true,
      status: 'active',
      lastUpdate: new Date(memoryData.lastUpdate).toISOString(),
      tickCount: memoryData.count,
      platform: process.platform,
      mmfAvailable: process.platform === 'win32'
    };
  });

  // Dados agregados por símbolo
  app.get('/api/v1/memory/summary', async (request, reply) => {
    try {
      const ticks = await readMemoryMappedFile();
      
      const summary = ticks.reduce((acc, tick) => {
        if (!acc[tick.symbol]) {
          acc[tick.symbol] = {
            symbol: tick.symbol,
            bid: tick.bid,
            ask: tick.ask,
            last: tick.last,
            volume: tick.volume,
            spread: tick.ask - tick.bid,
            count: 1
          };
        } else {
          acc[tick.symbol].volume += tick.volume;
          acc[tick.symbol].count++;
        }
        return acc;
      }, {} as Record<string, any>);

      return {
        success: true,
        summary: Object.values(summary),
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: 'Erro ao gerar resumo'
      });
    }
  });
}
