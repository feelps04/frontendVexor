// Gerador de PDF Enterprise - Relatório de Trading
import PDFDocument from 'pdfkit';
import * as fs from 'fs';

interface TradingReport {
  winRate: number;
  trades: number;
  wins: number;
  losses: number;
  pnl: number;
  date: Date;
  symbols: string[];
  performance: { date: string; pnl: number }[];
}

export async function generateTradingPDF(report: TradingReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    
    // Header
    doc.fontSize(24).font('Helvetica-Bold').text('VEXOR ENTERPRISE', { align: 'center' });
    doc.fontSize(14).font('Helvetica').text('Relatório de Trading', { align: 'center' });
    doc.moveDown();
    
    // Data
    doc.fontSize(10).text(`Gerado em: ${report.date.toLocaleString('pt-BR')}`, { align: 'right' });
    doc.moveDown(2);
    
    // Resumo Executivo
    doc.fontSize(16).font('Helvetica-Bold').text('RESUMO EXECUTIVO', { underline: true });
    doc.moveDown();
    
    doc.fontSize(12).font('Helvetica');
    doc.text(`Win Rate: ${(report.winRate * 100).toFixed(1)}%`, { continued: true });
    doc.text(`  |  `, { continued: true });
    doc.text(`Trades: ${report.trades}`, { continued: true });
    doc.text(`  |  `, { continued: true });
    doc.text(`P&L: ${report.pnl >= 0 ? '+' : ''}${report.pnl} pts`);
    doc.moveDown();
    
    doc.text(`Wins: ${report.wins}  |  Losses: ${report.losses}`);
    doc.moveDown(2);
    
    // Performance por Símbolo
    doc.fontSize(16).font('Helvetica-Bold').text('SÍMBOLOS OPERADOS', { underline: true });
    doc.moveDown();
    
    report.symbols.forEach(symbol => {
      doc.fontSize(11).font('Helvetica').text(`• ${symbol}`);
    });
    doc.moveDown(2);
    
    // Gráfico de Performance (simplificado como tabela)
    doc.fontSize(16).font('Helvetica-Bold').text('HISTÓRICO DE PERFORMANCE', { underline: true });
    doc.moveDown();
    
    // Tabela
    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('Data', 50, doc.y, { width: 150 });
    doc.text('P&L', 200, doc.y, { width: 100 });
    doc.moveDown(0.5);
    
    doc.font('Helvetica');
    report.performance.slice(-10).forEach(p => {
      doc.text(p.date, 50, doc.y, { width: 150 });
      doc.text(`${p.pnl >= 0 ? '+' : ''}${p.pnl}`, 200, doc.y, { width: 100 });
      doc.moveDown(0.3);
    });
    doc.moveDown(2);
    
    // Análise
    doc.fontSize(16).font('Helvetica-Bold').text('ANÁLISE', { underline: true });
    doc.moveDown();
    
    doc.fontSize(11).font('Helvetica');
    if (report.winRate >= 0.55) {
      doc.text('Win Rate acima de 55% indica estratégia consistente.');
    } else if (report.winRate >= 0.50) {
      doc.text('Win Rate na média. Considere ajustar gestão de risco.');
    } else {
      doc.text('Win Rate abaixo de 50%. Revisar estratégia urgentemente.');
    }
    doc.moveDown();
    
    if (report.pnl > 0) {
      doc.text(`Lucro consistente de ${report.pnl} pontos no período.`);
    } else {
      doc.text(`Prejuízo de ${Math.abs(report.pnl)} pontos. Revisar stops e alvos.`);
    }
    
    // Footer
    doc.moveDown(3);
    doc.fontSize(8).font('Helvetica-Oblique').text('VEXOR Enterprise - Trading Intelligence System', { align: 'center' });
    doc.text('Documento confidencial - Uso interno', { align: 'center' });
    
    doc.end();
  });
}

// Função para criar relatório de exemplo
export function createSampleReport(): TradingReport {
  const performance = [];
  const today = new Date();
  
  for (let i = 30; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    performance.push({
      date: date.toLocaleDateString('pt-BR'),
      pnl: Math.floor(Math.random() * 40) - 15
    });
  }
  
  return {
    winRate: 0.52,
    trades: 47,
    wins: 24,
    losses: 23,
    pnl: 127,
    date: new Date(),
    symbols: ['WDOFUT', 'WINFUT', 'ABEV3', 'PETR4'],
    performance
  };
}

// Teste local
if (import.meta.url === `file://${process.argv[1]}`) {
  const report = createSampleReport();
  const pdf = await generateTradingPDF(report);
  fs.writeFileSync('trading-report.pdf', pdf);
  console.log('PDF gerado: trading-report.pdf');
}
