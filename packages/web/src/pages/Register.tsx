import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { registerAppwrite } from '../lib/appwrite'
import { setAuth } from '../lib/auth'

export default function RegisterPage() {
  const nav = useNavigate()

  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!email || !name || !password) {
      setError('Todos os campos são obrigatórios')
      return
    }

    if (password.length < 8) {
      setError('A senha deve ter pelo menos 8 caracteres')
      return
    }

    setLoading(true)
    try {
      const { user, session } = await registerAppwrite(email, password, name)
      const auth = {
        userId: user!.id,
        accountId: user!.id,
        accessToken: session!.access_token,
        email: user!.email ?? email
      }
      setAuth(auth)
      nav('/app', { replace: true })
    } catch (err: any) {
      const msg = err?.message || 'Erro ao cadastrar'
      const msgLower = msg.toLowerCase()
      if (msgLower.includes('already exists') || msgLower.includes('already registered') || msgLower.includes('já existe')) {
        nav(`/login?email=${encodeURIComponent(email)}&reason=exists`, { replace: true })
        return
      }
      if (msgLower.includes('email_provider_disabled') || msgLower.includes('email logins are disabled')) {
        setError('Cadastro por email desabilitado. Contate o suporte.')
        return
      }
      if (msgLower.includes('rate limit') || msgLower.includes('rate_limit')) {
        setError('Muitas tentativas. Aguarde alguns minutos e tente novamente.')
        return
      }
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="vexor-auth">
      <div className="vexor-auth__container">
        <div className="vexor-auth__card">
          <div className="vexor-auth__icon">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="1.5" />
              <path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>

          <div className="vexor-auth__header">
            <h1 className="vexor-auth__title">NOVO REGISTRO</h1>
            <p className="vexor-auth__subtitle">PROTOCOLO DE ADESÃO VEXOR</p>
          </div>

          <form onSubmit={onSubmit} className="vexor-auth__form">
            <div className="vexor-auth__field">
              <label className="vexor-auth__label">IDENTIFICAÇÃO (EMAIL)</label>
              <div className="vexor-auth__input-wrapper">
                <svg className="vexor-auth__input-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M15 7a2 2 0 012 2v4a2 2 0 01-2 2H9a2 2 0 01-2-2V9a2 2 0 012-2h6z" stroke="currentColor" strokeWidth="1.5" />
                  <circle cx="9" cy="10" r="1" fill="currentColor" />
                </svg>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="seu@email.com"
                  className="vexor-auth__input"
                />
              </div>
            </div>

            <div className="vexor-auth__field">
              <label className="vexor-auth__label">NOME</label>
              <div className="vexor-auth__input-wrapper">
                <svg className="vexor-auth__input-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M4 20c0-4 4-6 8-6s8 2 8 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="Seu nome"
                  className="vexor-auth__input"
                />
              </div>
            </div>

            <div className="vexor-auth__field">
              <label className="vexor-auth__label">CHAVE DE ACESSO (MÍN. 8 CARACTERES)</label>
              <div className="vexor-auth__input-wrapper">
                <svg className="vexor-auth__input-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M7 11V7a5 5 0 0110 0v4" stroke="currentColor" strokeWidth="1.5" />
                </svg>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={8}
                  required
                  placeholder="••••••••••••"
                  className="vexor-auth__input"
                />
              </div>
            </div>

            {error ? <div className="vexor-auth__error">{error}</div> : null}

            <button type="submit" disabled={loading} className="vexor-auth__submit">
              {loading ? 'PROCESSANDO...' : 'SOLICITAR CREDENCIAIS'}
            </button>
          </form>

          <div className="vexor-auth__footer">
            <Link to="/login" className="vexor-auth__link">
              [ JÁ POSSUI CREDENCIAIS? ACESSAR SISTEMA ]
            </Link>
          </div>
        </div>
      </div>

      <style>{`
        .vexor-auth {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #000;
          font-family: 'Space Grotesk', system-ui, sans-serif;
        }

        .vexor-auth__container {
          width: 100%;
          max-width: 400px;
          padding: 20px;
        }

        .vexor-auth__card {
          background: rgba(0, 0, 0, 0.6);
          border: 1px solid rgba(0, 255, 255, 0.15);
          border-radius: 12px;
          padding: 48px 32px;
          backdrop-filter: blur(10px);
          box-shadow: 
            0 0 60px rgba(0, 255, 255, 0.05),
            inset 0 0 60px rgba(0, 255, 255, 0.02);
        }

        .vexor-auth__icon {
          width: 48px;
          height: 48px;
          margin: 0 auto 24px;
          color: rgba(0, 255, 255, 0.8);
          border: 1px solid rgba(0, 255, 255, 0.2);
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 10px;
          box-shadow: 0 0 20px rgba(0, 255, 255, 0.1);
        }

        .vexor-auth__icon svg {
          width: 100%;
          height: 100%;
        }

        .vexor-auth__header {
          text-align: center;
          margin-bottom: 40px;
        }

        .vexor-auth__title {
          font-family: 'Orbitron', system-ui, sans-serif;
          font-size: 20px;
          font-weight: 500;
          letter-spacing: 0.15em;
          color: rgba(255, 255, 255, 0.95);
          margin: 0 0 8px 0;
        }

        .vexor-auth__subtitle {
          font-size: 10px;
          letter-spacing: 0.25em;
          color: rgba(255, 255, 255, 0.5);
          text-transform: uppercase;
          margin: 0;
        }

        .vexor-auth__form {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .vexor-auth__field {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .vexor-auth__label {
          font-size: 9px;
          letter-spacing: 0.15em;
          color: #00FFFF;
          text-transform: uppercase;
          font-weight: 500;
        }

        .vexor-auth__input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }

        .vexor-auth__input-icon {
          position: absolute;
          left: 14px;
          width: 16px;
          height: 16px;
          color: rgba(255, 255, 255, 0.4);
          z-index: 1;
        }

        .vexor-auth__input {
          width: 100%;
          padding: 14px 14px 14px 40px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 6px;
          color: rgba(255, 255, 255, 0.8);
          font-size: 13px;
          font-family: 'JetBrains Mono', monospace;
          transition: all 0.2s ease;
        }

        .vexor-auth__input::placeholder {
          color: rgba(255, 255, 255, 0.3);
        }

        .vexor-auth__input:focus {
          outline: none;
          border-color: rgba(0, 255, 255, 0.4);
          box-shadow: 0 0 0 1px rgba(0, 255, 255, 0.1), inset 0 0 20px rgba(0, 255, 255, 0.03);
        }

        .vexor-auth__error {
          padding: 12px 16px;
          background: rgba(255, 0, 0, 0.08);
          border: 1px solid rgba(255, 0, 0, 0.2);
          border-radius: 6px;
          font-size: 11px;
          color: rgba(255, 100, 100, 0.9);
        }

        .vexor-auth__submit {
          padding: 16px 24px;
          background: transparent;
          border: 1px solid rgba(0, 255, 255, 0.4);
          border-radius: 6px;
          color: #00FFFF;
          font-family: 'Orbitron', system-ui, sans-serif;
          font-size: 11px;
          font-weight: 500;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          cursor: pointer;
          transition: all 0.2s ease;
          margin-top: 8px;
        }

        .vexor-auth__submit:hover:not(:disabled) {
          background: rgba(0, 255, 255, 0.08);
          border-color: rgba(0, 255, 255, 0.6);
          box-shadow: 0 0 20px rgba(0, 255, 255, 0.15);
        }

        .vexor-auth__submit:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .vexor-auth__footer {
          text-align: center;
          margin-top: 32px;
          padding-top: 24px;
          border-top: 1px solid rgba(255, 255, 255, 0.05);
        }

        .vexor-auth__link {
          font-size: 9px;
          letter-spacing: 0.15em;
          color: rgba(255, 255, 255, 0.4);
          text-decoration: none;
          text-transform: uppercase;
          transition: color 0.2s ease;
        }

        .vexor-auth__link:hover {
          color: rgba(0, 255, 255, 0.7);
        }

        @media (max-width: 480px) {
          .vexor-auth__card {
            padding: 36px 24px;
          }
          
          .vexor-auth__title {
            font-size: 18px;
          }
        }
      `}</style>
    </div>
  )
}
