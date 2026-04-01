import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { getCurrentUser, supabase } from './lib/appwrite'
import { setAuth } from './lib/auth'
import HomePage from './pages/Home'
import LoginPage from './pages/Login'
import RegisterPage from './pages/Register'
import ForgotPasswordPage from './pages/ForgotPassword'
import ResetPasswordPage from './pages/ResetPassword'
import WorldPage from './pages/World'
import World3DPage from './pages/World3D'
import MarketplacePage from './pages/Marketplace'
import TerminalLayout from './pages/Terminal'
import DashboardPage from './pages/terminal/DashboardPage'
import SectorsPage from './pages/terminal/SectorsPage'
import SectorDetailPage from './pages/terminal/SectorDetailPage'
import SectorAgroPage from './pages/terminal/SectorAgroPage'
import PortfolioPage from './pages/terminal/PortfolioPage'
import ContractsPage from './pages/terminal/ContractsPage'
import SocialPage from './pages/SocialPage'
import PaperTradingPage from './pages/terminal/PaperTradingPage'
import AIStatsPage from './pages/terminal/AIStatsPage'
import VotosPage from './pages/terminal/VotosPage'
import NexusPage from './pages/terminal/NexusPage'
import OpenClawPanel from './components/openclaw/OpenClawPanel'

function AuthCheck({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function checkAuth() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (session) {
          setAuth({
            userId: session.user.id,
            accountId: session.user.id,
            accessToken: session.access_token,
            email: session.user.email ?? ''
          })
        }
      } catch (e) {
        setAuth(null)
      } finally {
        setLoading(false)
      }
    }
    checkAuth()
  }, [])

  if (loading) {
    return (
      <div style={{ 
        minHeight: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        background: '#000',
        color: '#00FFFF'
      }}>
        Carregando...
      </div>
    )
  }

  return <>{children}</>
}

export default function App() {
  return (
    <AuthCheck>
      <Routes>
        <Route path="/" element={<Navigate to="/register" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/test/openclaw" element={<OpenClawPanel />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/logout" element={<Navigate to="/login" replace />} />
        <Route path="/openclaw" element={<OpenClawPanel />} />
        
        <Route path="/world" element={<WorldPage />} />
        <Route path="/world3d" element={<World3DPage />} />
        <Route path="/world3d/:symbol" element={<World3DPage />} />
        
        <Route path="/marketplace/*" element={<MarketplacePage />} />
        
        <Route path="/app" element={<TerminalLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="ai-stats" element={<AIStatsPage />} />
          <Route path="votos" element={<VotosPage />} />
          <Route path="nexus" element={<NexusPage />} />
          <Route path="sector/:sectorId" element={<SectorDetailPage />} />
          <Route path="sector/agro" element={<SectorAgroPage />} />
          <Route path="sectors" element={<SectorsPage />} />
          <Route path="carteira" element={<PortfolioPage />} />
          <Route path="contracts" element={<ContractsPage />} />
          <Route path="social" element={<SocialPage />} />
          <Route path="paper-trading" element={<PaperTradingPage />} />
          <Route path="openclaw" element={<OpenClawPanel />} />
        </Route>
        
        <Route path="/social" element={<SocialPage />} />

        <Route path="*" element={<Navigate to="/register" replace />} />
      </Routes>
    </AuthCheck>
  )
}
