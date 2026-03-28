/**
 * VEXOR Historical Data Downloader
 * Baixa dados históricos de múltiplos dias/meses da Binance
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

const DATA_DIR = 'C:\\Users\\opc\\CascadeProjects\\vexor-Oracle\\vexor-Oracle-main\\replay_data';

interface Tick {
  symbol: string;
  timestamp: number;
  bid: number;
  ask: number;
  volume: number;
  source: 'binance';
}

async function fetchBinanceKlines(
  symbol: string,
  interval: string = '1m',
  startTime: number,
  endTime: number
): Promise<Tick[]> {
  return new Promise((resolve, reject) => {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=1000`;
    
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const candles = JSON.parse(data) as any[][];
          const ticks: Tick[] = candles.map(candle => {
            const openTime = candle[0];
            const close = parseFloat(candle[4]);
            const volume = parseFloat(candle[5]);
            const spread = close * 0.0001;
            
            return {
              symbol,
              timestamp: openTime,
              bid: close - spread / 2,
              ask: close + spread / 2,
              volume,
              source: 'binance' as const
            };
          });
          resolve(ticks);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function downloadMonths(
  symbols: string[],
  months: number = 6
): Promise<{ totalTicks: number; files: string[] }> {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  
  const now = Date.now();
  const msPerMonth = 30 * 24 * 60 * 60 * 1000;
  const startTime = now - months * msPerMonth;
  
  const allTicks: Tick[] = [];
  const files: string[] = [];
  
  console.log(`[Downloader] Baixando ${months} meses de dados para ${symbols.length} símbolos...`);
  console.log(`[Downloader] Período: ${new Date(startTime).toISOString()} até ${new Date(now).toISOString()}`);
  
  for (const symbol of symbols) {
    console.log(`[Downloader] Baixando ${symbol}...`);
    
    let currentStart = startTime;
    let symbolTicks: Tick[] = [];
    
    // Baixar em chunks de 1000 candles (máximo da API)
    while (currentStart < now) {
      try {
        const ticks = await fetchBinanceKlines(symbol, '1m', currentStart, now);
        
        if (ticks.length === 0) break;
        
        symbolTicks.push(...ticks);
        
        // Avançar para próximo chunk
        const lastTimestamp = ticks[ticks.length - 1].timestamp;
        currentStart = lastTimestamp + 60000; // +1 minuto
        
        console.log(`  ${symbol}: ${symbolTicks.length} ticks acumulados`);
        
        // Rate limit
        await new Promise(r => setTimeout(r, 200));
        
      } catch (e: any) {
        console.error(`  Erro: ${e.message}`);
        break;
      }
    }
    
    allTicks.push(...symbolTicks);
    console.log(`[Downloader] ${symbol}: ${symbolTicks.length} ticks totais`);
  }
  
  // Ordenar por timestamp
  allTicks.sort((a, b) => a.timestamp - b.timestamp);
  
  // Dividir em arquivos por dia
  const ticksByDay: Record<string, Tick[]> = {};
  
  for (const tick of allTicks) {
    const day = new Date(tick.timestamp).toISOString().slice(0, 10).replace(/-/g, '');
    if (!ticksByDay[day]) {
      ticksByDay[day] = [];
    }
    ticksByDay[day].push(tick);
  }
  
  // Salvar cada dia
  for (const [day, ticks] of Object.entries(ticksByDay)) {
    const file = path.join(DATA_DIR, `day_${day}.json`);
    fs.writeFileSync(file, JSON.stringify(ticks, null, 2));
    files.push(file);
  }
  
  // Salvar arquivo consolidado
  const consolidatedFile = path.join(DATA_DIR, `consolidated_${months}months.json`);
  fs.writeFileSync(consolidatedFile, JSON.stringify(allTicks, null, 2));
  
  console.log(`[Downloader] Total: ${allTicks.length} ticks em ${files.length} dias`);
  console.log(`[Downloader] Arquivo consolidado: ${consolidatedFile}`);
  
  return { totalTicks: allTicks.length, files };
}

// Executar se chamado diretamente
if (process.argv[1].includes('download-historical.ts')) {
  const symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT'];
  const months = parseInt(process.argv[2] || '6');
  
  downloadMonths(symbols, months).then(result => {
    console.log(`[Downloader] Concluído: ${result.totalTicks} ticks`);
  }).catch(err => {
    console.error('[Downloader] Erro:', err);
    process.exit(1);
  });
}

export { downloadMonths };
