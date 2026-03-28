import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

export default function World3DPage() {
  const { symbol } = useParams()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [selectedSymbol, setSelectedSymbol] = useState(symbol || 'BTC')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationId: number
    let rotation = 0

    function draw() {
      if (!ctx || !canvas) return
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      const centerX = canvas.width / 2
      const centerY = canvas.height / 2
      const radius = Math.min(centerX, centerY) * 0.6

      // Draw globe wireframe
      ctx.strokeStyle = 'rgba(0, 255, 255, 0.3)'
      ctx.lineWidth = 1

      // Horizontal lines
      for (let i = 0; i < 8; i++) {
        const y = centerY + (i - 4) * (radius / 4)
        const r = Math.sqrt(radius * radius - (y - centerY) * (y - centerY))
        ctx.beginPath()
        ctx.ellipse(centerX, y, r * Math.cos(rotation), r * Math.abs(Math.cos(rotation)) * 0.3, 0, 0, Math.PI * 2)
        ctx.stroke()
      }

      // Vertical lines
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2 + rotation
        ctx.beginPath()
        ctx.ellipse(centerX, centerY, radius * Math.abs(Math.sin(angle)), radius, 0, 0, Math.PI * 2)
        ctx.stroke()
      }

      // Draw price nodes
      const nodes = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE']
      nodes.forEach((s, i) => {
        const angle = (i / nodes.length) * Math.PI * 2 + rotation
        const x = centerX + Math.cos(angle) * radius * 0.7
        const y = centerY + Math.sin(angle) * radius * 0.4
        const isSelected = s === selectedSymbol

        ctx.beginPath()
        ctx.arc(x, y, isSelected ? 12 : 8, 0, Math.PI * 2)
        ctx.fillStyle = isSelected ? '#00FFFF' : 'rgba(0, 255, 255, 0.5)'
        ctx.fill()

        ctx.fillStyle = isSelected ? '#000' : '#fff'
        ctx.font = `${isSelected ? 10 : 8}px JetBrains Mono`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(s, x, y)
      })

      rotation += 0.005
      animationId = requestAnimationFrame(draw)
    }

    draw()
    return () => cancelAnimationFrame(animationId)
  }, [selectedSymbol])

  return (
    <div className="world3d-page">
      <header className="world3d-header">
        <Link to="/app" className="back-link">← VOLTAR</Link>
        <h1>🌐 MUNDO 3D</h1>
        <p className="subtitle">Visualização Interativa de Mercado</p>
      </header>

      <div className="world3d-content">
        <canvas ref={canvasRef} width={800} height={500} className="globe-canvas" />

        <div className="symbol-selector">
          <span className="label">SELECIONE ATIVO:</span>
          {['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE'].map(s => (
            <button
              key={s}
              className={`symbol-btn ${selectedSymbol === s ? 'active' : ''}`}
              onClick={() => setSelectedSymbol(s)}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="info-panel">
          <h3>{selectedSymbol}/USDT</h3>
          <p>Clique no canvas para interagir com o globo 3D</p>
        </div>
      </div>

      <style>{`
        .world3d-page { min-height: 100vh; background: #000; color: #fff; font-family: 'Space Grotesk', sans-serif; padding: 20px; }
        .world3d-header { text-align: center; margin-bottom: 20px; padding-top: 20px; position: relative; }
        .world3d-header h1 { font-family: 'Orbitron', sans-serif; font-size: 28px; color: #00FFFF; margin: 10px 0; }
        .world3d-header .subtitle { color: rgba(255,255,255,0.5); font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; }
        .back-link { color: rgba(255,255,255,0.5); text-decoration: none; font-size: 12px; position: absolute; left: 0; top: 0; }
        .back-link:hover { color: #00FFFF; }
        .world3d-content { max-width: 900px; margin: 0 auto; display: flex; flex-direction: column; align-items: center; }
        .globe-canvas { width: 100%; max-width: 800px; border: 1px solid rgba(0,255,255,0.2); border-radius: 16px; background: #000; }
        .symbol-selector { margin-top: 20px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: center; }
        .symbol-selector .label { font-size: 10px; color: rgba(255,255,255,0.5); letter-spacing: 0.1em; }
        .symbol-btn { padding: 8px 16px; background: transparent; border: 1px solid rgba(0,255,255,0.3); border-radius: 6px; color: rgba(255,255,255,0.7); font-family: 'JetBrains Mono', monospace; font-size: 12px; cursor: pointer; transition: all 0.2s; }
        .symbol-btn:hover { border-color: rgba(0,255,255,0.6); color: #fff; }
        .symbol-btn.active { background: rgba(0,255,255,0.2); border-color: #00FFFF; color: #00FFFF; }
        .info-panel { margin-top: 20px; padding: 20px; background: rgba(0,255,255,0.05); border: 1px solid rgba(0,255,255,0.2); border-radius: 12px; text-align: center; }
        .info-panel h3 { font-family: 'Orbitron', sans-serif; font-size: 18px; color: #00FFFF; margin: 0 0 10px 0; }
        .info-panel p { font-size: 12px; color: rgba(255,255,255,0.5); margin: 0; }
      `}</style>
    </div>
  )
}
