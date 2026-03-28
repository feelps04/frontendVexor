export default function HomePage() {
  return (
    <div className="vexor-root">
      <header className="vexor-header">
        <div className="vexor-header__inner">
          <div className="vexor-brand">
            <div className="vexor-brand__mark" aria-hidden="true">
              <div className="vexor-brand__icon">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="2" y="2" width="20" height="20" rx="4" stroke="currentColor" strokeWidth="1.5"/>
                  <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5"/>
                </svg>
              </div>
            </div>
            <div className="vexor-brand__name">
              VEXOR<span className="vexor-brand__dot">.</span>
            </div>
          </div>

          <nav className="vexor-nav">
            <a href="#">SISTEMA</a>
            <a href="#">PROTOCOLOS</a>
            <a href="#">GUARDIAN</a>
          </nav>

          <div className="vexor-cta">
            <a className="vexor-btn vexor-btn--primary" href="/app">TERMINAL // ACESSO</a>
          </div>
        </div>
      </header>

      <main>
        <section className="vexor-hero">
          <div className="vexor-hero__bg" aria-hidden="true">
            <video className="vexor-bgvideo" src="/fotos/NEXUS-AI_Core.mp4" autoPlay loop muted playsInline preload="auto" />
          </div>
          <div className="vexor-hero__inner">
            <div className="vexor-hero__center">
              <div className="vexor-chip">QUANTUM INTELLIGENCE ENABLED</div>
              <h1 className="vexor-title">
                <span className="vexor-title__line">DOMINE O</span>
                <span className="vexor-title__line vexor-title__line--outline">CAOS.</span>
                <span className="vexor-title__line">PROTEJA O</span>
                <span className="vexor-title__line vexor-title__line--gold">CAPITAL.</span>
              </h1>
              <p className="vexor-subtitle">
                A infraestrutura definitiva para operações financeiras de elite. O Guardian processa terabytes de dados para manter sua vantagem competitiva.
              </p>
              <div className="vexor-hero__buttons">
                <a className="vexor-btn vexor-btn--primary" href="/login">INICIAR CONEXÃO</a>
                <a className="vexor-btn vexor-btn--ghost" href="/app">TERMINAL DE ELITE</a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <style>{`
        .vexor-root {
          min-height: 100vh;
          background: #000;
          color: #fff;
          overflow-x: hidden;
          font-family: 'Space Grotesk', system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        }
        .vexor-header {
          position: sticky;
          top: 0;
          z-index: 50;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(0, 0, 0, 0.7);
          backdrop-filter: blur(12px);
        }
        .vexor-header__inner {
          max-width: 1200px;
          margin: 0 auto;
          padding: 14px 18px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
        }
        .vexor-brand {
          display: flex;
          flex-direction: row;
          align-items: center;
          gap: 10px;
          line-height: 1.1;
        }
        .vexor-brand__mark {
          width: 22px;
          height: 22px;
          border-radius: 4px;
          overflow: hidden;
          border: 1px solid rgba(0, 255, 255, 0.35);
          box-shadow: 0 0 14px rgba(0, 255, 255, 0.15);
          background: rgba(0, 0, 0, 0.4);
          flex: 0 0 auto;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .vexor-brand__icon {
          width: 100%;
          height: 100%;
          color: rgba(0, 255, 255, 0.8);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2px;
        }
        .vexor-brand__icon svg {
          width: 100%;
          height: 100%;
        }
        .vexor-brand__name {
          font-family: Orbitron, system-ui, sans-serif;
          font-weight: 900;
          letter-spacing: 0.18em;
          font-size: 16px;
          color: rgba(255, 255, 255, 0.92);
          text-shadow: 0 0 20px rgba(0, 0, 0, 0.65);
        }
        .vexor-brand__dot {
          color: rgba(0, 255, 255, 0.90);
          text-shadow: 0 0 14px rgba(0, 255, 255, 0.20), 0 0 26px rgba(0, 255, 255, 0.10);
        }
        .vexor-nav {
          display: none;
          gap: 14px;
          font-size: 12px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          opacity: 0.9;
        }
        .vexor-nav a {
          text-decoration: none;
          opacity: 0.8;
        }
        .vexor-nav a:hover {
          opacity: 1;
          text-decoration: underline;
          text-underline-offset: 4px;
        }
        .vexor-cta {
          display: flex;
          gap: 10px;
          align-items: center;
        }
        .vexor-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          height: 38px;
          padding: 0 14px;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(0, 0, 0, 0.20);
          color: #fff;
          text-decoration: none;
          font-weight: 800;
          font-size: 12px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease;
          white-space: nowrap;
        }
        .vexor-btn:hover {
          transform: translateY(-1px);
          background: rgba(255, 255, 255, 0.06);
          border-color: rgba(255, 255, 255, 0.18);
        }
        .vexor-btn--primary {
          border-color: rgba(0, 255, 255, 0.45);
          background: rgba(0, 255, 255, 0.06);
          color: rgba(0, 255, 255, 0.95);
          box-shadow: 0 0 0 1px rgba(0, 255, 255, 0.10), inset 0 0 22px rgba(0, 255, 255, 0.05);
        }
        .vexor-btn--ghost {
          border-color: rgba(255, 255, 255, 0.14);
          background: rgba(255, 255, 255, 0.02);
          color: rgba(255, 255, 255, 0.88);
        }
        .vexor-hero {
          position: relative;
          padding: 88px 0 64px;
          min-height: calc(100vh - 62px);
          display: flex;
          align-items: center;
        }
        .vexor-hero__bg {
          position: absolute;
          inset: 0;
          background: #000;
          filter: blur(0px);
          pointer-events: none;
        }
        .vexor-bgvideo {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          filter: saturate(1.25) contrast(1.05) brightness(0.55);
          transform: scale(1.02);
        }
        .vexor-hero__bg:before {
          content: '';
          position: absolute;
          inset: -40px;
          background:
            radial-gradient(closest-side at 50% 42%, rgba(255, 255, 255, 0.10), rgba(0, 0, 0, 0) 60%),
            conic-gradient(from 180deg, rgba(0, 255, 255, 0.0), rgba(0, 255, 255, 0.18), rgba(197, 160, 89, 0.22), rgba(0, 0, 0, 0));
          opacity: 0.55;
          mask-image: radial-gradient(circle at 50% 45%, rgba(0, 0, 0, 1) 0, rgba(0, 0, 0, 1) 40%, rgba(0, 0, 0, 0) 68%);
          filter: blur(14px);
        }
        .vexor-hero__bg:after {
          content: '';
          position: absolute;
          inset: 0;
          background:
            radial-gradient(900px 520px at 50% 35%, rgba(0, 255, 255, 0.10), rgba(0, 0, 0, 0) 62%),
            radial-gradient(720px 520px at 50% 38%, rgba(197, 160, 89, 0.16), rgba(0, 0, 0, 0) 62%),
            radial-gradient(1200px 700px at 50% 70%, rgba(0, 255, 255, 0.06), rgba(0, 0, 0, 0) 60%),
            linear-gradient(to bottom, rgba(0, 0, 0, 0.92), rgba(0, 0, 0, 0.35) 45%, rgba(0, 0, 0, 0.92));
        }
        .vexor-hero__inner {
          position: relative;
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 18px;
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .vexor-hero__center {
          max-width: 860px;
          text-align: center;
        }
        .vexor-chip {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 7px 10px;
          border-radius: 999px;
          border: 1px solid rgba(0, 255, 255, 0.25);
          background: rgba(0, 255, 255, 0.08);
          color: rgba(0, 255, 255, 0.9);
          font-size: 11px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          font-weight: 900;
        }
        .vexor-title {
          margin: 14px 0 10px;
          font-family: Orbitron, system-ui, sans-serif;
          font-weight: 900;
          font-size: 74px;
          line-height: 0.95;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          text-shadow: 0 0 22px rgba(0, 0, 0, 0.6);
        }
        .vexor-title__line {
          display: block;
          color: rgba(255, 255, 255, 0.96);
          text-shadow: 0 0 18px rgba(255, 255, 255, 0.10), 0 0 22px rgba(0, 0, 0, 0.65);
        }
        .vexor-title__line--outline {
          color: rgba(255, 255, 255, 0.10);
          -webkit-text-stroke: 2px rgba(255, 255, 255, 0.35);
          text-shadow: none;
        }
        .vexor-title__line--gold {
          color: #c5a059;
          text-shadow: 0 0 14px rgba(197, 160, 89, 0.40);
        }
        .vexor-subtitle {
          margin: 14px auto 0;
          opacity: 0.55;
          font-size: 12px;
          line-height: 1.7;
          max-width: 70ch;
        }
        .vexor-hero__buttons {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          margin-top: 22px;
          justify-content: center;
        }
        @media (max-width: 980px) {
          .vexor-title {
            font-size: 48px;
          }
        }

        @media (min-width: 960px) {
          .vexor-nav {
            display: flex;
          }
        }
      `}</style>
    </div>
  )
}
