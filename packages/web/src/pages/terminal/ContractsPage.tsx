export default function ContractsPage() {
  return (
    <div className="contracts-page">
      <div className="contracts-header">
        <h1>Contratos e Derivativos</h1>
        <div className="contracts-summary">
          <div className="summary-item">
            <span className="summary-label">Status</span>
            <span className="summary-value">Indisponível</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Backend</span>
            <span className="summary-value">Sem endpoint</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">P&L</span>
            <span className="summary-value">—</span>
          </div>
        </div>
      </div>

      <div className="contracts-content">
        <div className="contracts-empty">
          <h2>Em breve</h2>
          <p>
            Para sair do fictício como no MetaTrader, esta página precisa de endpoints reais no backend
            (posições derivativas, criação/encerramento, precificação, margem e P&amp;L).
          </p>
          <p>
            Hoje, a API expõe ordens reais para:
          </p>
          <ul>
            <li>BTC: <code>/api/v1/orders/btc</code></li>
            <li>Ações: <code>/api/v1/orders/stock</code></li>
          </ul>
          <p>
            Assim que você tiver os endpoints de derivativos, eu conecto esta tela 100% em dados reais.
          </p>
        </div>
      </div>

      <style>{`
        .contracts-page {
          padding: 20px;
          max-width: 1400px;
          margin: 0 auto;
        }

        .contracts-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
        }

        .contracts-header h1 {
          margin: 0;
          font-size: 24px;
          font-weight: 700;
          color: #e6edf3;
        }

        .contracts-summary {
          display: flex;
          gap: 16px;
        }

        .summary-item {
          display: flex;
          flex-direction: column;
          gap: 4px;
          background: rgba(48, 54, 61, 0.2);
          border: 1px solid rgba(48, 54, 61, 0.4);
          border-radius: 12px;
          padding: 12px 14px;
          min-width: 160px;
        }

        .summary-label {
          font-size: 11px;
          color: #8b949e;
          text-transform: uppercase;
        }

        .summary-value {
          font-size: 20px;
          font-weight: 700;
          color: #e6edf3;
        }

        .summary-value.positive {
          color: #3fb950;
        }

        .summary-value.negative {
          color: #f85149;
        }

        .contracts-tabs {
          display: flex;
          gap: 8px;
          margin-bottom: 24px;
          background: rgba(48, 54, 61, 0.3);
          padding: 6px;
          border-radius: 10px;
        }

        .contract-tab {
          flex: 1;
          padding: 12px 24px;
          background: none;
          border: none;
          color: #8b949e;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          border-radius: 8px;
          transition: all 0.2s;
        }

        .contract-tab.active {
          background: rgba(88, 166, 255, 0.2);
          color: #58a6ff;
        }

        .contract-tab:not(.active):hover {
          color: #e6edf3;
        }

        .empty-state {
          text-align: center;
          padding: 80px 20px;
          background: rgba(48, 54, 61, 0.2);
          border-radius: 12px;
        }

        .empty-state p {
          margin: 0 0 8px 0;
          font-size: 18px;
          color: #e6edf3;
        }

        .empty-state span {
          font-size: 14px;
          color: #8b949e;
        }

        .contracts-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 16px;
        }

        .contract-card {
          background: rgba(48, 54, 61, 0.2);
          border-radius: 12px;
          padding: 20px;
          border-left: 4px solid;
        }

        .contract-card.call {
          border-left-color: #3fb950;
        }

        .contract-card.put {
          border-left-color: #f85149;
        }

        .contract-card.future {
          border-left-color: #58a6ff;
        }

        .contract-header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 16px;
        }

        .contract-type-badge {
          padding: 4px 12px;
          border-radius: 20px;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
        }

        .contract-card.call .contract-type-badge {
          background: rgba(63, 185, 80, 0.2);
          color: #3fb950;
        }

        .contract-card.put .contract-type-badge {
          background: rgba(248, 81, 73, 0.2);
          color: #f85149;
        }

        .contract-card.future .contract-type-badge {
          background: rgba(88, 166, 255, 0.2);
          color: #58a6ff;
        }

        .contract-asset {
          font-size: 18px;
          font-weight: 700;
          color: #e6edf3;
          flex: 1;
        }

        .contract-status {
          font-size: 11px;
          padding: 4px 8px;
          border-radius: 4px;
          text-transform: uppercase;
        }

        .contract-status.active {
          background: rgba(63, 185, 80, 0.2);
          color: #3fb950;
        }

        .contract-details {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          margin-bottom: 16px;
        }

        .detail-row {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .detail-label {
          font-size: 11px;
          color: #8b949e;
          text-transform: uppercase;
        }

        .detail-value {
          font-size: 16px;
          font-weight: 600;
          color: #e6edf3;
        }

        .contract-pnl {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px;
          border-radius: 8px;
          margin-bottom: 16px;
        }

        .contract-pnl.positive {
          background: rgba(63, 185, 80, 0.15);
        }

        .contract-pnl.negative {
          background: rgba(248, 81, 73, 0.15);
        }

        .pnl-label {
          font-size: 12px;
          color: #8b949e;
        }

        .pnl-value {
          font-size: 18px;
          font-weight: 700;
        }

        .contract-pnl.positive .pnl-value {
          color: #3fb950;
        }

        .contract-pnl.negative .pnl-value {
          color: #f85149;
        }

        .contract-actions {
          display: flex;
          gap: 8px;
        }

        .btn-contract {
          flex: 1;
          padding: 10px;
          border: none;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-contract.action {
          background: linear-gradient(135deg, #238636 0%, #2ea043 100%);
          color: white;
        }

        .btn-contract.secondary {
          background: rgba(48, 54, 61, 0.4);
          color: #e6edf3;
        }

        .btn-contract:hover {
          opacity: 0.9;
        }

        .create-form {
          background: rgba(48, 54, 61, 0.2);
          border-radius: 12px;
          padding: 24px;
        }

        .form-section {
          margin-bottom: 24px;
        }

        .form-section h3 {
          margin: 0 0 16px 0;
          font-size: 16px;
          font-weight: 600;
          color: #e6edf3;
        }

        .type-selector {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
        }

        .type-btn {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          padding: 20px;
          background: rgba(48, 54, 61, 0.3);
          border: 2px solid transparent;
          border-radius: 10px;
          color: #8b949e;
          cursor: pointer;
          transition: all 0.2s;
        }

        .type-btn.active {
          border-color: #58a6ff;
          background: rgba(88, 166, 255, 0.1);
          color: #58a6ff;
        }

        .type-btn:hover:not(.active) {
          background: rgba(48, 54, 61, 0.5);
          color: #e6edf3;
        }

        .type-icon {
          font-size: 24px;
        }

        .type-name {
          font-size: 14px;
          font-weight: 600;
        }

        .type-desc {
          font-size: 12px;
        }

        .form-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .form-group label {
          font-size: 12px;
          color: #8b949e;
          text-transform: uppercase;
        }

        .form-group select,
        .form-group input {
          padding: 12px;
          background: rgba(13, 17, 23, 0.6);
          border: 1px solid rgba(48, 54, 61, 0.6);
          border-radius: 8px;
          color: #e6edf3;
          font-size: 14px;
        }

        .summary-box {
          background: rgba(48, 54, 61, 0.3);
          border-radius: 8px;
          padding: 16px;
        }

        .summary-row {
          display: flex;
          justify-content: space-between;
          padding: 8px 0;
          border-bottom: 1px solid rgba(48, 54, 61, 0.3);
        }

        .summary-row:last-child {
          border-bottom: none;
        }

        .premium-value {
          font-size: 20px;
          font-weight: 700;
          color: #58a6ff;
        }

        .btn-create {
          width: 100%;
          padding: 16px;
          background: linear-gradient(135deg, #238636 0%, #2ea043 100%);
          border: none;
          border-radius: 8px;
          color: white;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-create:hover {
          background: linear-gradient(135deg, #2ea043 0%, #3fb950 100%);
        }

        .strategies-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 16px;
        }

        .strategy-card {
          background: rgba(48, 54, 61, 0.2);
          border-radius: 12px;
          padding: 20px;
          border-left: 4px solid;
        }

        .strategy-card.low {
          border-left-color: #3fb950;
        }

        .strategy-card.medium {
          border-left-color: #f0883e;
        }

        .strategy-card.high {
          border-left-color: #f85149;
        }

        .strategy-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }

        .strategy-header h3 {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          color: #e6edf3;
        }

        .risk-badge {
          padding: 4px 10px;
          border-radius: 20px;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
        }

        .risk-badge.low {
          background: rgba(63, 185, 80, 0.2);
          color: #3fb950;
        }

        .risk-badge.medium {
          background: rgba(240, 136, 62, 0.2);
          color: #f0883e;
        }

        .risk-badge.high {
          background: rgba(248, 81, 73, 0.2);
          color: #f85149;
        }

        .strategy-desc {
          font-size: 14px;
          color: #8b949e;
          margin-bottom: 16px;
          line-height: 1.5;
        }

        .strategy-stats {
          margin-bottom: 16px;
        }

        .stat {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .stat-label {
          font-size: 12px;
          color: #8b949e;
        }

        .stat-value {
          font-size: 18px;
          font-weight: 700;
          color: #3fb950;
        }

        .btn-strategy {
          width: 100%;
          padding: 12px;
          background: rgba(88, 166, 255, 0.2);
          border: none;
          border-radius: 6px;
          color: #58a6ff;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-strategy:hover {
          background: rgba(88, 166, 255, 0.3);
        }

        @media (max-width: 768px) {
          .contracts-header {
            flex-direction: column;
            gap: 16px;
            align-items: flex-start;
          }
          
          .contracts-summary {
            width: 100%;
            justify-content: space-between;
          }
          
          .type-selector {
            grid-template-columns: 1fr;
          }
          
          .form-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  )
}
