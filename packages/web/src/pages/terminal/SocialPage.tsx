import { useState } from 'react'

interface Post {
  id: string
  user: string
  avatar: string
  content: string
  likes: number
  comments: number
  time: string
  liked?: boolean
}

interface User {
  id: string
  name: string
  avatar: string
  status: string
  online: boolean
}

export default function SocialPage() {
  const [posts, setPosts] = useState<Post[]>([
    {
      id: '1',
      user: 'Netwise Financial',
      avatar: 'NF',
      content: 'Análise PETR4: o ativo vai testar o pattern de alta dos últimos meses. Suporte em R$ 24,50 e resistência em R$ 26,00. Aproveitem! 📈 #PETR4 #Trading',
      likes: 124,
      comments: 18,
      time: '2h atrás',
    },
    {
      id: '2',
      user: 'TraderBrasil',
      avatar: 'TB',
      content: 'VALE3 mostrando força no pregão de hoje. Volume acima da média e compra institucional forte. Target: R$ 88 🎯',
      likes: 89,
      comments: 12,
      time: '4h atrás',
    },
    {
      id: '3',
      user: 'InvestPro',
      avatar: 'IP',
      content: 'Dólar fechando em queda hoje após dados do mercado de trabalho nos EUA. Ótimo momento para acumular USDB11. 💱',
      likes: 156,
      comments: 24,
      time: '6h atrás',
    },
    {
      id: '4',
      user: 'CryptoMaster',
      avatar: 'CM',
      content: 'Bitcoin rompeu resistência importante! Próximo alvo: R$ 980. Quem está posicionado? 🚀 #BTC #Bitcoin',
      likes: 234,
      comments: 45,
      time: '8h atrás',
    },
  ])

  const [suggestedUsers] = useState<User[]>([
    { id: '1', name: 'Ana Trader', avatar: 'AT', status: 'Especialista em análise técnica', online: true },
    { id: '2', name: 'Carlos Invest', avatar: 'CI', status: 'Fundamentalista', online: false },
    { id: '3', name: 'Maria Stocks', avatar: 'MS', status: 'Day trader', online: true },
    { id: '4', name: 'Pedro Forex', avatar: 'PF', status: 'Especialista em FX', online: true },
  ])

  const [newPost, setNewPost] = useState('')
  const [activeTab, setActiveTab] = useState<'feed' | 'trending' | 'following'>('feed')

  function handleLike(postId: string) {
    setPosts(posts.map(post => 
      post.id === postId 
        ? { ...post, likes: post.liked ? post.likes - 1 : post.likes + 1, liked: !post.liked }
        : post
    ))
  }

  function handleSubmitPost(e: React.FormEvent) {
    e.preventDefault()
    if (!newPost.trim()) return
    
    const post: Post = {
      id: Date.now().toString(),
      user: 'Você',
      avatar: 'VO',
      content: newPost,
      likes: 0,
      comments: 0,
      time: 'Agora',
    }
    
    setPosts([post, ...posts])
    setNewPost('')
  }

  return (
    <div className="social-page">
      <div className="social-layout">
        {/* Main Feed */}
        <div className="feed-section">
          {/* Create Post */}
          <div className="create-post">
            <div className="post-avatar">VO</div>
            <form onSubmit={handleSubmitPost} className="post-form">
              <textarea
                value={newPost}
                onChange={(e) => setNewPost(e.target.value)}
                placeholder="Compartilhe sua análise ou ideia de trade..."
                rows={3}
              />
              <div className="post-actions">
                <div className="post-tools">
                  <button type="button" className="tool-btn">📊</button>
                  <button type="button" className="tool-btn">📎</button>
                  <button type="button" className="tool-btn">#</button>
                </div>
                <button type="submit" className="btn-post" disabled={!newPost.trim()}>
                  Publicar
                </button>
              </div>
            </form>
          </div>

          {/* Feed Tabs */}
          <div className="feed-tabs">
            <button 
              className={`feed-tab ${activeTab === 'feed' ? 'active' : ''}`}
              onClick={() => setActiveTab('feed')}
            >
              Feed Principal
            </button>
            <button 
              className={`feed-tab ${activeTab === 'trending' ? 'active' : ''}`}
              onClick={() => setActiveTab('trending')}
            >
              Em Alta
            </button>
            <button 
              className={`feed-tab ${activeTab === 'following' ? 'active' : ''}`}
              onClick={() => setActiveTab('following')}
            >
              Seguindo
            </button>
          </div>

          {/* Posts */}
          <div className="posts-list">
            {posts.map(post => (
              <div key={post.id} className="post-card">
                <div className="post-header">
                  <div className="post-avatar">{post.avatar}</div>
                  <div className="post-meta">
                    <span className="post-user">{post.user}</span>
                    <span className="post-time">{post.time}</span>
                  </div>
                </div>
                <p className="post-content">{post.content}</p>
                <div className="post-stats">
                  <button 
                    className={`stat-btn ${post.liked ? 'liked' : ''}`}
                    onClick={() => handleLike(post.id)}
                  >
                    <span className="stat-icon">{post.liked ? '❤️' : '🤍'}</span>
                    <span>{post.likes}</span>
                  </button>
                  <button className="stat-btn">
                    <span className="stat-icon">💬</span>
                    <span>{post.comments}</span>
                  </button>
                  <button className="stat-btn">
                    <span className="stat-icon">🔄</span>
                    <span>Compartilhar</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Sidebar */}
        <div className="social-sidebar">
          {/* Trending Topics */}
          <div className="sidebar-card">
            <h3>Trending Topics</h3>
            <div className="trending-list">
              <div className="trending-item">
                <span className="trending-rank">1</span>
                <div className="trending-info">
                  <span className="trending-tag">#PETR4</span>
                  <span className="trending-posts">2.4k posts</span>
                </div>
              </div>
              <div className="trending-item">
                <span className="trending-rank">2</span>
                <div className="trending-info">
                  <span className="trending-tag">#VALE3</span>
                  <span className="trending-posts">1.8k posts</span>
                </div>
              </div>
              <div className="trending-item">
                <span className="trending-rank">3</span>
                <div className="trending-info">
                  <span className="trending-tag">#Bitcoin</span>
                  <span className="trending-posts">1.2k posts</span>
                </div>
              </div>
              <div className="trending-item">
                <span className="trending-rank">4</span>
                <div className="trending-info">
                  <span className="trending-tag">#DayTrade</span>
                  <span className="trending-posts">890 posts</span>
                </div>
              </div>
            </div>
          </div>

          {/* Suggested Users */}
          <div className="sidebar-card">
            <h3>Quem Seguir</h3>
            <div className="users-list">
              {suggestedUsers.map(user => (
                <div key={user.id} className="user-item">
                  <div className="user-avatar">
                    {user.avatar}
                    {user.online && <span className="online-dot" />}
                  </div>
                  <div className="user-info">
                    <span className="user-name">{user.name}</span>
                    <span className="user-status">{user.status}</span>
                  </div>
                  <button className="btn-follow">Seguir</button>
                </div>
              ))}
            </div>
          </div>

          {/* Community Stats */}
          <div className="sidebar-card">
            <h3>Comunidade</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <span className="stat-value">12.5K</span>
                <span className="stat-label">Traders</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">3.2K</span>
                <span className="stat-label">Online</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">845</span>
                <span className="stat-label">Posts Hoje</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .social-page {
          padding: 20px;
          max-width: 1200px;
          margin: 0 auto;
        }

        .social-layout {
          display: grid;
          grid-template-columns: 1fr 350px;
          gap: 24px;
        }

        .feed-section {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .create-post {
          background: rgba(48, 54, 61, 0.2);
          border-radius: 12px;
          padding: 20px;
          display: flex;
          gap: 16px;
        }

        .post-avatar {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          background: linear-gradient(135deg, #58a6ff 0%, #238636 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 600;
          font-size: 14px;
          color: white;
          flex-shrink: 0;
        }

        .post-form {
          flex: 1;
        }

        .post-form textarea {
          width: 100%;
          padding: 12px;
          background: rgba(13, 17, 23, 0.6);
          border: 1px solid rgba(48, 54, 61, 0.6);
          border-radius: 8px;
          color: #e6edf3;
          font-size: 14px;
          resize: vertical;
          min-height: 80px;
        }

        .post-actions {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 12px;
        }

        .post-tools {
          display: flex;
          gap: 8px;
        }

        .tool-btn {
          background: none;
          border: none;
          font-size: 18px;
          cursor: pointer;
          padding: 8px;
          border-radius: 6px;
          transition: background 0.2s;
        }

        .tool-btn:hover {
          background: rgba(48, 54, 61, 0.4);
        }

        .btn-post {
          padding: 10px 24px;
          background: linear-gradient(135deg, #238636 0%, #2ea043 100%);
          border: none;
          border-radius: 20px;
          color: white;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-post:hover:not(:disabled) {
          background: linear-gradient(135deg, #2ea043 0%, #3fb950 100%);
        }

        .btn-post:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .feed-tabs {
          display: flex;
          gap: 8px;
          background: rgba(48, 54, 61, 0.2);
          padding: 8px;
          border-radius: 10px;
        }

        .feed-tab {
          flex: 1;
          padding: 10px;
          background: none;
          border: none;
          color: #8b949e;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          border-radius: 6px;
          transition: all 0.2s;
        }

        .feed-tab.active {
          background: rgba(88, 166, 255, 0.2);
          color: #58a6ff;
        }

        .posts-list {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .post-card {
          background: rgba(48, 54, 61, 0.2);
          border-radius: 12px;
          padding: 20px;
        }

        .post-header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 12px;
        }

        .post-meta {
          display: flex;
          flex-direction: column;
        }

        .post-user {
          font-weight: 600;
          color: #e6edf3;
          font-size: 14px;
        }

        .post-time {
          font-size: 12px;
          color: #8b949e;
        }

        .post-content {
          color: #e6edf3;
          line-height: 1.5;
          margin-bottom: 16px;
          font-size: 14px;
        }

        .post-stats {
          display: flex;
          gap: 16px;
          padding-top: 12px;
          border-top: 1px solid rgba(48, 54, 61, 0.3);
        }

        .stat-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          background: none;
          border: none;
          color: #8b949e;
          font-size: 13px;
          cursor: pointer;
          transition: color 0.2s;
        }

        .stat-btn:hover {
          color: #e6edf3;
        }

        .stat-btn.liked {
          color: #f85149;
        }

        .stat-icon {
          font-size: 16px;
        }

        .social-sidebar {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .sidebar-card {
          background: rgba(48, 54, 61, 0.2);
          border-radius: 12px;
          padding: 20px;
        }

        .sidebar-card h3 {
          margin: 0 0 16px 0;
          font-size: 14px;
          font-weight: 600;
          color: #e6edf3;
        }

        .trending-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .trending-item {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .trending-rank {
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(88, 166, 255, 0.2);
          color: #58a6ff;
          font-size: 12px;
          font-weight: 600;
          border-radius: 4px;
        }

        .trending-info {
          display: flex;
          flex-direction: column;
        }

        .trending-tag {
          font-weight: 600;
          color: #58a6ff;
          font-size: 14px;
        }

        .trending-posts {
          font-size: 12px;
          color: #8b949e;
        }

        .users-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .user-item {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .user-avatar {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: linear-gradient(135deg, #58a6ff 0%, #238636 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 600;
          color: white;
          position: relative;
        }

        .online-dot {
          position: absolute;
          bottom: 0;
          right: 0;
          width: 10px;
          height: 10px;
          background: #3fb950;
          border-radius: 50%;
          border: 2px solid #0d1117;
        }

        .user-info {
          flex: 1;
          display: flex;
          flex-direction: column;
        }

        .user-name {
          font-weight: 600;
          color: #e6edf3;
          font-size: 13px;
        }

        .user-status {
          font-size: 12px;
          color: #8b949e;
        }

        .btn-follow {
          padding: 6px 16px;
          background: rgba(88, 166, 255, 0.2);
          border: none;
          border-radius: 16px;
          color: #58a6ff;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-follow:hover {
          background: rgba(88, 166, 255, 0.3);
        }

        .stats-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
          text-align: center;
        }

        .stat-item {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .stat-value {
          font-size: 18px;
          font-weight: 700;
          color: #e6edf3;
        }

        .stat-label {
          font-size: 11px;
          color: #8b949e;
        }

        @media (max-width: 768px) {
          .social-layout {
            grid-template-columns: 1fr;
          }
          
          .social-sidebar {
            display: none;
          }
        }
      `}</style>
    </div>
  )
}
