import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Heart, MessageCircle, Share2, Send, Plus, Image, Video, 
  Home, Search, User, Bell, Users, Film, MessageSquare,
  TrendingUp, BarChart2, Clock, MoreHorizontal, Bookmark,
  Settings, LogOut, ChevronLeft, ChevronRight, Play, Pause,
  Volume2, VolumeX, X, Check, Verified, Sparkles
} from 'lucide-react';

// Modern CSS with Instagram/Twitter design patterns
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
  
  * { box-sizing: border-box; margin: 0; padding: 0; }
  
  :root {
    --primary: #0095f6;
    --primary-hover: #1877f2;
    --accent: #00ffc8;
    --bg-primary: #000;
    --bg-secondary: #121212;
    --bg-tertiary: #1a1a1a;
    --bg-card: #161616;
    --border: rgba(255,255,255,0.08);
    --text-primary: #fafafa;
    --text-secondary: #a8a8a8;
    --text-muted: #737373;
    --danger: #ed4956;
    --success: #78c257;
    --gradient-start: #405de6;
    --gradient-end: #c13584;
  }
  
  .social-app {
    display: flex;
    width: 100vw;
    height: 100vh;
    background: var(--bg-primary);
    color: var(--text-primary);
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    position: fixed;
    top: 0;
    left: 0;
    overflow: hidden;
  }
  
  /* Sidebar - Twitter style */
  .sidebar {
    width: 275px;
    background: var(--bg-primary);
    border-right: 1px solid var(--border);
    padding: 0 12px;
    display: flex;
    flex-direction: column;
    position: fixed;
    height: 100vh;
    overflow-y: auto;
  }
  
  .sidebar-logo {
    padding: 12px;
    margin-bottom: 4px;
  }
  
  .logo-icon {
    width: 40px;
    height: 40px;
    background: linear-gradient(135deg, var(--gradient-start), var(--gradient-end));
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 18px;
    color: white;
  }
  
  .nav-item {
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 12px;
    border-radius: 9999px;
    cursor: pointer;
    transition: background 0.2s;
    color: var(--text-primary);
    font-size: 20px;
    font-weight: 400;
  }
  
  .nav-item:hover { background: rgba(255,255,255,0.1); }
  .nav-item.active { font-weight: 700; }
  .nav-item svg { width: 26px; height: 26px; }
  
  .compose-btn {
    background: var(--primary);
    color: white;
    border: none;
    border-radius: 9999px;
    padding: 16px 32px;
    font-size: 17px;
    font-weight: 600;
    cursor: pointer;
    margin: 16px 0;
    width: 90%;
    transition: background 0.2s;
  }
  
  .compose-btn:hover { background: var(--primary-hover); }
  
  .user-profile {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    border-radius: 9999px;
    cursor: pointer;
    margin-top: auto;
    margin-bottom: 24px;
    transition: background 0.2s;
  }
  
  .user-profile:hover { background: rgba(255,255,255,0.1); }
  
  .user-avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    font-size: 16px;
  }
  
  .user-info { flex: 1; }
  .user-name { font-weight: 600; font-size: 15px; }
  .user-handle { color: var(--text-muted); font-size: 15px; }
  
  /* Main Content */
  .main-content {
    flex: 1;
    margin-left: 275px;
    margin-right: 320px;
    max-width: 600px;
    border-left: 1px solid var(--border);
    border-right: 1px solid var(--border);
    height: 100vh;
    overflow-y: auto;
  }

  /* Top sticky stack (Stories + Tabs) */
  .top-stack {
    position: sticky;
    top: 0;
    z-index: 50;
    background: rgba(0,0,0,0.92);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--border);
  }
  
  /* Stories - Instagram style */
  .stories-container {
    background: var(--bg-primary);
    padding: 16px 0;
    overflow: hidden;
  }
  
  .stories-scroll {
    display: flex;
    gap: 16px;
    padding: 0 20px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  
  .stories-scroll::-webkit-scrollbar { display: none; }
  
  .story-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    flex-shrink: 0;
  }
  
  .story-avatar-wrapper {
    width: 66px;
    height: 66px;
    border-radius: 50%;
    background: linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%);
    padding: 3px;
    position: relative;
  }
  
  .story-avatar-wrapper.seen {
    background: var(--text-muted);
  }
  
  .story-avatar-wrapper.add-story {
    background: transparent;
    border: 2px dashed var(--text-muted);
  }
  
  .story-avatar {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    border: 3px solid var(--bg-primary);
    background: var(--bg-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    font-size: 20px;
    overflow: hidden;
  }
  
  .story-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  
  .story-add-icon {
    position: absolute;
    bottom: -2px;
    right: -2px;
    width: 22px;
    height: 22px;
    background: var(--primary);
    border-radius: 50%;
    border: 3px solid var(--bg-primary);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .story-username {
    font-size: 12px;
    color: var(--text-primary);
    max-width: 70px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: center;
  }
  
  /* Feed */
  .feed-header {
    display: flex;
    align-items: center;
    justify-content: center;
    border-top: 1px solid var(--border);
    background: transparent;
  }
  
  .feed-tab {
    flex: 1;
    text-align: center;
    padding: 16px;
    font-weight: 600;
    cursor: pointer;
    color: var(--text-secondary);
    position: relative;
    transition: color 0.2s;
  }
  
  .feed-tab.active { color: var(--text-primary); }
  
  .feed-tab.active::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 50px;
    height: 3px;
    background: var(--primary);
    border-radius: 3px;
  }
  
  /* Post Card */
  .post-card {
    border-bottom: 1px solid var(--border);
    background: var(--bg-primary);
  }
  
  .post-header {
    display: flex;
    align-items: center;
    padding: 14px 16px;
    gap: 12px;
  }
  
  .post-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    font-size: 14px;
    flex-shrink: 0;
  }
  
  .post-user-info { flex: 1; }
  .post-username { font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 6px; }
  .post-location { font-size: 12px; color: var(--text-secondary); }
  
  .verified-badge {
    width: 14px;
    height: 14px;
    background: var(--primary);
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  
  .post-options {
    width: 24px;
    height: 24px;
    cursor: pointer;
    color: var(--text-primary);
  }
  
  .post-media {
    width: 100%;
    aspect-ratio: 1;
    background: var(--bg-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    overflow: hidden;
  }
  
  .post-media img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  
  .post-content {
    padding: 8px 16px;
  }
  
  .post-actions {
    display: flex;
    gap: 16px;
    margin-bottom: 8px;
  }
  
  .action-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.1s, color 0.2s;
    color: var(--text-primary);
  }
  
  .action-btn:hover { transform: scale(1.1); }
  .action-btn.liked { color: var(--danger); animation: likeAnim 0.3s ease; }
  .action-btn.saved { color: var(--accent); }
  
  @keyframes likeAnim {
    0% { transform: scale(1); }
    50% { transform: scale(1.3); }
    100% { transform: scale(1); }
  }
  
  .post-stats {
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 8px;
  }
  
  .post-caption {
    font-size: 14px;
    line-height: 1.4;
  }
  
  .post-caption strong { font-weight: 600; }
  
  .post-tags {
    margin-top: 8px;
    color: var(--primary);
    font-size: 14px;
  }
  
  .post-time {
    font-size: 10px;
    color: var(--text-muted);
    text-transform: uppercase;
    margin-top: 8px;
    letter-spacing: 0.2px;
  }
  
  .post-comment-input {
    display: flex;
    align-items: center;
    padding: 12px 16px;
    border-top: 1px solid var(--border);
    gap: 12px;
  }
  
  .comment-input {
    flex: 1;
    background: none;
    border: none;
    color: var(--text-primary);
    font-size: 14px;
    outline: none;
  }
  
  .comment-input::placeholder { color: var(--text-muted); }
  
  .post-btn {
    background: none;
    border: none;
    color: var(--primary);
    font-weight: 600;
    cursor: pointer;
    font-size: 14px;
    opacity: 0.5;
    transition: opacity 0.2s;
  }
  
  .post-btn:not(:disabled) { opacity: 1; }
  
  /* Right Sidebar */
  .right-sidebar {
    width: 320px;
    position: fixed;
    right: 0;
    top: 0;
    height: 100vh;
    padding: 20px 24px;
    overflow-y: auto;
  }
  
  .search-box {
    background: var(--bg-tertiary);
    border-radius: 9999px;
    padding: 12px 20px;
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 20px;
  }
  
  .search-box input {
    background: none;
    border: none;
    color: var(--text-primary);
    font-size: 15px;
    outline: none;
    flex: 1;
  }
  
  .search-box input::placeholder { color: var(--text-muted); }
  
  .widget-card {
    background: var(--bg-tertiary);
    border-radius: 16px;
    margin-bottom: 16px;
    overflow: hidden;
  }
  
  .widget-header {
    padding: 16px 20px;
    font-weight: 700;
    font-size: 20px;
    border-bottom: 1px solid var(--border);
  }
  
  .trending-item {
    padding: 12px 20px;
    cursor: pointer;
    transition: background 0.2s;
  }
  
  .trending-item:hover { background: rgba(255,255,255,0.03); }
  
  .trending-category {
    font-size: 13px;
    color: var(--text-muted);
  }
  
  .trending-topic {
    font-weight: 600;
    font-size: 15px;
    margin: 2px 0;
  }
  
  .trending-posts {
    font-size: 13px;
    color: var(--text-muted);
  }
  
  .suggested-user {
    display: flex;
    align-items: center;
    padding: 12px 20px;
    gap: 12px;
  }
  
  .suggested-info { flex: 1; }
  
  .suggested-name { font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 4px; }
  .suggested-sub { font-size: 13px; color: var(--text-muted); }
  
  .follow-btn {
    background: var(--primary);
    color: white;
    border: none;
    border-radius: 9999px;
    padding: 6px 16px;
    font-weight: 600;
    font-size: 14px;
    cursor: pointer;
    transition: background 0.2s;
  }
  
  .follow-btn:hover { background: var(--primary-hover); }
  .follow-btn.following { background: transparent; border: 1px solid var(--text-muted); color: var(--text-primary); }
  
  /* Bottom Nav - Mobile */
  .bottom-nav {
    display: none;
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: var(--bg-primary);
    border-top: 1px solid var(--border);
    padding: 8px 0;
    z-index: 1000;
  }
  
  .bottom-nav-items {
    display: flex;
    justify-content: space-around;
  }
  
  .bottom-nav-item {
    padding: 12px;
    cursor: pointer;
    color: var(--text-secondary);
    transition: color 0.2s;
  }
  
  .bottom-nav-item.active { color: var(--text-primary); }
  
  /* Story Viewer Modal */
  .story-modal {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.95);
    z-index: 2000;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .story-viewer {
    width: 100%;
    max-width: 420px;
    height: 90vh;
    max-height: 750px;
    background: var(--bg-secondary);
    border-radius: 12px;
    overflow: hidden;
    position: relative;
  }
  
  .story-progress {
    position: absolute;
    top: 12px;
    left: 12px;
    right: 12px;
    display: flex;
    gap: 4px;
    z-index: 10;
  }
  
  .progress-bar {
    flex: 1;
    height: 2px;
    background: rgba(255,255,255,0.3);
    border-radius: 2px;
    overflow: hidden;
  }
  
  .progress-fill {
    height: 100%;
    background: white;
    width: 0%;
    transition: width 0.1s linear;
  }
  
  .story-header {
    position: absolute;
    top: 24px;
    left: 12px;
    right: 12px;
    display: flex;
    align-items: center;
    gap: 10px;
    z-index: 10;
  }
  
  .story-close {
    position: absolute;
    top: 24px;
    right: 12px;
    cursor: pointer;
    z-index: 10;
  }
  
  .story-content {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  .story-content img, .story-content video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  
  /* Animations */
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }
  
  .animate-in { animation: fadeIn 0.3s ease; }
  
  /* Responsive */
  @media (max-width: 1200px) {
    .right-sidebar { display: none; }
    .main-content { margin-right: 0; }
  }
  
  @media (max-width: 900px) {
    .sidebar { display: none; }
    .main-content { margin-left: 0; }
    .bottom-nav { display: block; }
  }
  
  /* AI Badge */
  .ai-badge {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 2px 8px;
    border-radius: 9999px;
    font-size: 10px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  
  /* Signal Card */
  .signal-card {
    background: linear-gradient(135deg, rgba(0,255,200,0.1), rgba(0,150,246,0.1));
    border: 1px solid rgba(0,255,200,0.2);
    border-radius: 12px;
    padding: 16px;
    margin: 16px;
  }
  
  .signal-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
  }
  
  .signal-status {
    font-size: 12px;
    font-weight: 600;
    padding: 4px 12px;
    border-radius: 9999px;
    background: rgba(0,255,200,0.2);
    color: var(--accent);
  }
  
  .signal-metrics {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }
  
  .signal-metric {
    text-align: center;
  }
  
  .metric-value { font-size: 20px; font-weight: 700; color: var(--accent); }
  .metric-label { font-size: 12px; color: var(--text-muted); }
`;

// Types
interface User {
  id: string;
  username: string;
  displayName: string;
  avatar?: string;
  verified?: boolean;
  isAI?: boolean;
}

interface Post {
  id: string;
  userId: string;
  content: string;
  type: string;
  media?: string[];
  tags?: string[];
  createdAt: string;
  user: User;
  likesCount: number;
  commentsCount: number;
  liked?: boolean;
}

interface Story {
  id: string;
  userId: string;
  mediaUrl: string;
  type: string;
  caption?: string;
  expiresAt: string;
  createdAt: string;
  user: User;
}

type Conversation = {
  id: string;
  user: User | null;
  lastMessage?: string;
  lastMessageTime?: string;
  unread?: number;
}

type NotificationItem = {
  id: string;
  type: string;
  from: User | null;
  message: string;
  read: boolean;
  createdAt: string;
}

type Reel = {
  id: string;
  userId: string;
  content: string;
  media?: string[];
  createdAt: string;
  user: User;
  likesCount: number;
}

type Squad = {
  id: string;
  name: string;
  description?: string;
  member_count?: number;
}

export default function SocialPage() {
  const navigate = useNavigate();
  // Use relative URLs to leverage Vite proxy (configured in vite.config.ts)
  const API_BASE = '';

  const [activeSection, setActiveSection] = useState<
    'home' | 'explore' | 'notifications' | 'messages' | 'reels' | 'squads' | 'profile' | 'settings'
  >('home');
  const [activeTab, setActiveTab] = useState('for-you');
  const [posts, setPosts] = useState<Post[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const [newPost, setNewPost] = useState('');
  const [showStoryModal, setShowStoryModal] = useState(false);
  const [activeStoryIndex, setActiveStoryIndex] = useState(0);
  const [storyProgress, setStoryProgress] = useState(0);
  const storyTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [me, setMe] = useState<User | null>(null);
  const [exploreQuery, setExploreQuery] = useState('');
  const [exploreUsers, setExploreUsers] = useState<User[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationUserId, setActiveConversationUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [messageDraft, setMessageDraft] = useState('');
  const [reels, setReels] = useState<Reel[]>([]);
  const [squads, setSquads] = useState<Squad[]>([]);

  // Fetch data
  useEffect(() => {
    fetchData();
    void fetchMe();
  }, []);

  const fetchMe = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/social/me`);
      if (!res.ok) return;
      const data = await res.json();
      if (data?.user) setMe(data.user);
    } catch {
      // ignore
    }
  };

  const fetchData = async () => {
    try {
      const [feedRes, storiesRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/social/feed`),
        fetch(`${API_BASE}/api/v1/social/stories`)
      ]);
      
      if (feedRes.ok) {
        const feedData = await feedRes.json();
        setPosts(feedData.posts || []);
      }
      
      if (storiesRes.ok) {
        const storiesData = await storiesRes.json();
        setStories(storiesData.stories || []);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLike = async (postId: string, liked: boolean) => {
    try {
      await fetch(`${API_BASE}/api/v1/social/posts/${postId}/like`, { method: 'POST' });
      setPosts(posts.map(p => 
        p.id === postId 
          ? { ...p, liked: !liked, likesCount: liked ? p.likesCount - 1 : p.likesCount + 1 }
          : p
      ));
    } catch (error) {
      console.error('Error toggling like:', error);
    }
  };

  const handlePost = async () => {
    if (!newPost.trim()) return;
    
    try {
      const res = await fetch(`${API_BASE}/api/v1/social/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newPost, type: 'text' })
      });
      
      if (res.ok) {
        setNewPost('');
        fetchData();
      }
    } catch (error) {
      console.error('Error posting:', error);
    }
  };

  // Story viewer logic
  useEffect(() => {
    if (showStoryModal && stories.length > 0) {
      setStoryProgress(0);
      storyTimerRef.current = setInterval(() => {
        setStoryProgress(p => {
          if (p >= 100) {
            nextStory();
            return 0;
          }
          return p + 2;
        });
      }, 100);
      
      return () => {
        if (storyTimerRef.current) clearInterval(storyTimerRef.current);
      };
    }
  }, [showStoryModal, activeStoryIndex]);

  const nextStory = () => {
    if (activeStoryIndex < stories.length - 1) {
      setActiveStoryIndex(i => i + 1);
    } else {
      setShowStoryModal(false);
    }
  };

  const prevStory = () => {
    if (activeStoryIndex > 0) {
      setActiveStoryIndex(i => i - 1);
    }
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  };

  const currentUser = {
    username: me?.username || 'operador_01',
    displayName: me?.displayName || 'OPERADOR_01',
    avatar: (me?.username?.[0]?.toUpperCase() || 'O1')
  };

  const openSection = async (section: typeof activeSection) => {
    setActiveSection(section);
    if (section === 'home') {
      setLoading(true);
      await fetchData();
      return;
    }
    if (section === 'notifications') {
      try {
        const res = await fetch(`${API_BASE}/api/v1/social/notifications`);
        if (!res.ok) return;
        const data = await res.json();
        setNotifications(Array.isArray(data?.notifications) ? data.notifications : []);
      } catch {
        setNotifications([]);
      }
      return;
    }
    if (section === 'messages') {
      try {
        const res = await fetch(`${API_BASE}/api/v1/social/conversations`);
        if (!res.ok) return;
        const data = await res.json();
        setConversations(Array.isArray(data?.conversations) ? data.conversations : []);
      } catch {
        setConversations([]);
      }
      return;
    }
    if (section === 'reels') {
      try {
        const res = await fetch(`${API_BASE}/api/v1/social/reels`);
        if (!res.ok) return;
        const data = await res.json();
        setReels(Array.isArray(data?.reels) ? data.reels : []);
      } catch {
        setReels([]);
      }
      return;
    }
    if (section === 'squads') {
      try {
        const res = await fetch(`${API_BASE}/api/v1/social/squads`);
        if (!res.ok) return;
        const data = await res.json();
        setSquads(Array.isArray(data?.squads) ? data.squads : []);
      } catch {
        setSquads([]);
      }
      return;
    }
  };

  const runExploreSearch = async () => {
    try {
      const q = exploreQuery.trim();
      const res = await fetch(`${API_BASE}/api/v1/social/users?q=${encodeURIComponent(q)}`);
      if (!res.ok) return;
      const data = await res.json();
      setExploreUsers(Array.isArray(data?.users) ? data.users : []);
    } catch {
      setExploreUsers([]);
    }
  };

  const openConversation = async (otherUserId: string) => {
    setActiveConversationUserId(otherUserId);
    try {
      const res = await fetch(`${API_BASE}/api/v1/social/messages/${encodeURIComponent(otherUserId)}`);
      if (!res.ok) return;
      const data = await res.json();
      setMessages(Array.isArray(data?.messages) ? data.messages : []);
    } catch {
      setMessages([]);
    }
  };

  const sendMessage = async () => {
    const to = activeConversationUserId;
    const content = messageDraft.trim();
    if (!to || !content) return;
    setMessageDraft('');
    try {
      const res = await fetch(`${API_BASE}/api/v1/social/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, content, type: 'text' }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.message) {
        setMessages((prev) => [...prev, data.message]);
      }
    } catch {
      // ignore
    }
  };

  return (
    <>
      <style>{css}</style>
      
      <div className="social-app">
        {/* Left Sidebar */}
        <aside className="sidebar">
          <div className="sidebar-logo">
            <div className="logo-icon">V</div>
          </div>
          
          <nav>
            <div className={`nav-item ${activeSection === 'home' ? 'active' : ''}`} onClick={() => void openSection('home')}>
              <Home /> <span>Início</span>
            </div>
            <div className={`nav-item ${activeSection === 'explore' ? 'active' : ''}`} onClick={() => void openSection('explore')}>
              <Search /> <span>Explorar</span>
            </div>
            <div className={`nav-item ${activeSection === 'notifications' ? 'active' : ''}`} onClick={() => void openSection('notifications')}>
              <Bell /> <span>Notificações</span>
            </div>
            <div className={`nav-item ${activeSection === 'messages' ? 'active' : ''}`} onClick={() => void openSection('messages')}>
              <MessageSquare /> <span>Mensagens</span>
            </div>
            <div className={`nav-item ${activeSection === 'reels' ? 'active' : ''}`} onClick={() => void openSection('reels')}>
              <Film /> <span>Reels</span>
            </div>
            <div className={`nav-item ${activeSection === 'squads' ? 'active' : ''}`} onClick={() => void openSection('squads')}>
              <Users /> <span>Squads</span>
            </div>
            <div className={`nav-item ${activeSection === 'profile' ? 'active' : ''}`} onClick={() => void openSection('profile')}>
              <User /> <span>Perfil</span>
            </div>
            <div className={`nav-item ${activeSection === 'settings' ? 'active' : ''}`} onClick={() => void openSection('settings')}>
              <Settings /> <span>Configurações</span>
            </div>
          </nav>
          
          <button className="compose-btn" onClick={() => setNewPost('')}>
            <Plus size={20} style={{ marginRight: 8 }} />
            Nova Análise
          </button>
          
          <div className="user-profile">
            <div className="user-avatar">{currentUser.avatar}</div>
            <div className="user-info">
              <div className="user-name">{currentUser.displayName}</div>
              <div className="user-handle">@{currentUser.username}</div>
            </div>
            <MoreHorizontal size={20} />
          </div>
        </aside>
        
        {/* Main Content */}
        <main className="main-content">
          {activeSection === 'home' && (
            <>
              <div className="top-stack">
                {/* Stories */}
                <div className="stories-container">
                  <div className="stories-scroll">
                    {/* Add Story */}
                    <div className="story-item" onClick={() => setShowStoryModal(true)}>
                      <div className="story-avatar-wrapper add-story">
                        <div className="story-avatar">{currentUser.avatar}</div>
                        <div className="story-add-icon">
                          <Plus size={14} />
                        </div>
                      </div>
                      <span className="story-username">Seu story</span>
                    </div>
                    
                    {/* AI User Story */}
                    <div className="story-item" onClick={() => {
                      setActiveStoryIndex(0);
                      setShowStoryModal(true);
                    }}>
                      <div className="story-avatar-wrapper">
                        <div className="story-avatar" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
                          <Sparkles size={24} />
                        </div>
                      </div>
                      <span className="story-username">vexor_core</span>
                    </div>
                    
                    {/* User Stories */}
                    {stories.map((story, i) => (
                      <div key={story.id} className="story-item" onClick={() => {
                        setActiveStoryIndex(i);
                        setShowStoryModal(true);
                      }}>
                        <div className="story-avatar-wrapper">
                          <div className="story-avatar">
                            {story.user.avatar ? (
                              <img src={story.user.avatar} alt={story.user.username} />
                            ) : (
                              story.user.username?.[0]?.toUpperCase() || '?'
                            )}
                          </div>
                        </div>
                        <span className="story-username">{story.user.username}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Feed Header */}
                <div className="feed-header">
                  <div 
                    className={`feed-tab ${activeTab === 'for-you' ? 'active' : ''}`}
                    onClick={() => setActiveTab('for-you')}
                  >
                    Para Você
                  </div>
                  <div 
                    className={`feed-tab ${activeTab === 'following' ? 'active' : ''}`}
                    onClick={() => setActiveTab('following')}
                  >
                    Seguindo
                  </div>
                </div>
              </div>

              {/* Posts */}
              {loading ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                  Carregando...
                </div>
              ) : (
                posts.map((post, index) => (
              <article key={post.id} className="post-card animate-in" style={{ animationDelay: `${index * 0.1}s` }}>
                <header className="post-header">
                  <div className="post-avatar">
                    {post.user.avatar ? (
                      <img src={post.user.avatar} alt={post.user.username} style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />
                    ) : (
                      post.user.username?.[0]?.toUpperCase() || '?'
                    )}
                  </div>
                  <div className="post-user-info">
                    <div className="post-username">
                      {post.user.displayName || post.user.username}
                      {post.user.verified && (
                        <span className="verified-badge">
                          <Check size={10} />
                        </span>
                      )}
                      {post.user.isAI && (
                        <span className="ai-badge">
                          <Sparkles size={10} /> AI
                        </span>
                      )}
                    </div>
                    <div className="post-location">VEXOR Terminal</div>
                  </div>
                  <MoreHorizontal className="post-options" />
                </header>
                
                {/* Signal Card for AI posts */}
                {post.user.isAI && (
                  <div className="signal-card">
                    <div className="signal-header">
                      <TrendingUp size={16} style={{ color: 'var(--accent)' }} />
                      <span className="signal-status">PRONTO PARA EXECUÇÃO</span>
                    </div>
                    <div className="signal-metrics">
                      <div className="signal-metric">
                        <div className="metric-value">42.5</div>
                        <div className="metric-label">RSI</div>
                      </div>
                      <div className="signal-metric">
                        <div className="metric-value">+23%</div>
                        <div className="metric-label">Volume</div>
                      </div>
                      <div className="signal-metric">
                        <div className="metric-value">ALTA</div>
                        <div className="metric-label">MACD</div>
                      </div>
                    </div>
                  </div>
                )}
                
                <div className="post-content">
                  <p className="post-caption" style={{ whiteSpace: 'pre-wrap' }}>
                    <strong>{post.user.username} </strong>
                    {post.content}
                  </p>
                  {post.tags && post.tags.length > 0 && (
                    <div className="post-tags">
                      {post.tags.map(tag => `#${tag}`).join(' ')}
                    </div>
                  )}
                </div>
                
                <div className="post-actions">
                  <button 
                    className={`action-btn ${post.liked ? 'liked' : ''}`}
                    onClick={() => handleLike(post.id, post.liked || false)}
                  >
                    <Heart size={24} fill={post.liked ? 'currentColor' : 'none'} />
                  </button>
                  <button className="action-btn">
                    <MessageCircle size={24} />
                  </button>
                  <button className="action-btn">
                    <Share2 size={24} />
                  </button>
                  <button className="action-btn" style={{ marginLeft: 'auto' }}>
                    <Bookmark size={24} />
                  </button>
                </div>
                
                <div className="post-stats">
                  {post.likesCount.toLocaleString()} curtidas
                </div>
                
                <div className="post-time">{formatTime(post.createdAt)}</div>
                
                <div className="post-comment-input">
                  <input 
                    type="text" 
                    className="comment-input"
                    placeholder="Adicione um comentário..."
                  />
                  <button className="post-btn" disabled>Publicar</button>
                </div>
              </article>
                ))
              )}
            </>
          )}

          {activeSection === 'explore' && (
            <div style={{ padding: 20 }}>
              <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                <input
                  value={exploreQuery}
                  onChange={(e) => setExploreQuery(e.target.value)}
                  placeholder="Buscar usuários..."
                  style={{ flex: 1, padding: '12px 14px', borderRadius: 12, background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                />
                <button
                  onClick={() => void runExploreSearch()}
                  style={{ padding: '12px 16px', borderRadius: 12, background: 'var(--primary)', border: 'none', color: 'white', fontWeight: 600, cursor: 'pointer' }}
                >
                  Buscar
                </button>
              </div>

              <div style={{ display: 'grid', gap: 12 }}>
                {exploreUsers.map((u) => (
                  <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, border: '1px solid var(--border)', borderRadius: 16, background: 'var(--bg-secondary)' }}>
                    <div style={{ width: 36, height: 36, borderRadius: 999, overflow: 'hidden', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {u.avatar ? (
                        <img src={u.avatar} alt={u.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        (u.username?.[0]?.toUpperCase() || '?')
                      )}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700 }}>{u.displayName || u.username}</div>
                      <div style={{ color: 'var(--text-muted)' }}>@{u.username}</div>
                    </div>
                    <button
                      onClick={() => { void openSection('messages').then(() => { if (u.id) void openConversation(u.id) }) }}
                      style={{ padding: '10px 12px', borderRadius: 999, background: 'rgba(255,255,255,0.08)', border: '1px solid var(--border)', color: 'var(--text-primary)', cursor: 'pointer' }}
                    >
                      Mensagem
                    </button>
                  </div>
                ))}
                {exploreUsers.length === 0 && (
                  <div style={{ color: 'var(--text-muted)' }}>Digite um termo e clique em Buscar.</div>
                )}
              </div>
            </div>
          )}

          {activeSection === 'notifications' && (
            <div style={{ padding: 20 }}>
              <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 12 }}>Notificações</div>
              <div style={{ display: 'grid', gap: 10 }}>
                {notifications.map((n) => (
                  <div key={n.id} style={{ padding: 14, borderRadius: 16, border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ fontWeight: 700 }}>
                        {n.from?.displayName || n.from?.username || 'Sistema'}
                      </div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{formatTime(n.createdAt)}</div>
                    </div>
                    <div style={{ color: 'var(--text-secondary)', marginTop: 6 }}>{n.message}</div>
                  </div>
                ))}
                {notifications.length === 0 && (
                  <div style={{ color: 'var(--text-muted)' }}>Sem notificações.</div>
                )}
              </div>
            </div>
          )}

          {activeSection === 'messages' && (
            <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', height: '100%' }}>
              <div style={{ borderRight: '1px solid var(--border)', padding: 12, overflowY: 'auto' }}>
                <div style={{ fontWeight: 800, fontSize: 18, margin: '6px 8px 12px' }}>Mensagens</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {conversations.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => c.user?.id && openConversation(c.user.id)}
                      style={{
                        textAlign: 'left',
                        background: activeConversationUserId && c.user?.id === activeConversationUserId ? 'rgba(88,166,255,0.12)' : 'transparent',
                        border: '1px solid var(--border)',
                        borderRadius: 14,
                        padding: 12,
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ fontWeight: 700 }}>{c.user?.displayName || c.user?.username || 'Usuário'}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.lastMessage || 'Sem mensagens'}
                      </div>
                    </button>
                  ))}
                  {conversations.length === 0 && (
                    <div style={{ color: 'var(--text-muted)', padding: 10 }}>Sem conversas.</div>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <div style={{ padding: 14, borderBottom: '1px solid var(--border)', fontWeight: 800 }}>
                  {activeConversationUserId ? 'Chat' : 'Selecione uma conversa'}
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'grid', gap: 10 }}>
                  {messages.map((m) => (
                    <div key={m.id} style={{ padding: 10, borderRadius: 14, border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                      <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 6 }}>{formatTime(m.created_at || m.createdAt || new Date().toISOString())}</div>
                      <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
                    </div>
                  ))}
                </div>
                <div style={{ padding: 12, borderTop: '1px solid var(--border)', display: 'flex', gap: 10 }}>
                  <input
                    value={messageDraft}
                    onChange={(e) => setMessageDraft(e.target.value)}
                    placeholder="Escreva uma mensagem..."
                    style={{ flex: 1, padding: '12px 14px', borderRadius: 12, background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                  />
                  <button
                    onClick={() => void sendMessage()}
                    style={{ padding: '12px 16px', borderRadius: 12, background: 'var(--primary)', border: 'none', color: 'white', fontWeight: 700, cursor: 'pointer' }}
                  >
                    Enviar
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'reels' && (
            <div style={{ padding: 20 }}>
              <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 12 }}>Reels</div>
              <div style={{ display: 'grid', gap: 12 }}>
                {reels.map((r) => (
                  <div key={r.id} style={{ padding: 14, borderRadius: 16, border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                    <div style={{ fontWeight: 700 }}>{r.user?.displayName || r.user?.username}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>{formatTime(r.createdAt)}</div>
                    <div style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}>{r.content}</div>
                  </div>
                ))}
                {reels.length === 0 && (
                  <div style={{ color: 'var(--text-muted)' }}>Sem reels por enquanto.</div>
                )}
              </div>
            </div>
          )}

          {activeSection === 'squads' && (
            <div style={{ padding: 20 }}>
              <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 12 }}>Squads</div>
              <div style={{ display: 'grid', gap: 12 }}>
                {squads.map((s: any) => (
                  <div key={s.id} style={{ padding: 14, borderRadius: 16, border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                    <div style={{ fontWeight: 800 }}>{s.name}</div>
                    <div style={{ color: 'var(--text-secondary)', marginTop: 6 }}>{s.description || 'Sem descrição'}</div>
                    <div style={{ color: 'var(--text-muted)', marginTop: 10, fontSize: 12 }}>Membros: {s.member_count ?? s.memberCount ?? 0}</div>
                  </div>
                ))}
                {squads.length === 0 && (
                  <div style={{ color: 'var(--text-muted)' }}>Você ainda não participa de squads.</div>
                )}
              </div>
            </div>
          )}

          {activeSection === 'profile' && (
            <div style={{ padding: 20 }}>
              <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 16 }}>
                <div style={{ width: 64, height: 64, borderRadius: 999, background: 'linear-gradient(135deg, #0095f6, #00c6ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 22 }}>
                  {currentUser.avatar}
                </div>
                <div>
                  <div style={{ fontWeight: 900, fontSize: 20 }}>{currentUser.displayName}</div>
                  <div style={{ color: 'var(--text-muted)' }}>@{currentUser.username}</div>
                </div>
              </div>
              <div style={{ color: 'var(--text-secondary)' }}>
                Perfil em construção (já puxando dados reais de `/api/v1/social/me`).
              </div>
            </div>
          )}

          {activeSection === 'settings' && (
            <div style={{ padding: 20 }}>
              <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 12 }}>Configurações</div>
              <div style={{ color: 'var(--text-secondary)' }}>
                Tela de configurações (placeholder). Próximo passo: persistir preferências do Atlas.
              </div>
            </div>
          )}
        </main>
        
        {/* Right Sidebar */}
        <aside className="right-sidebar">
          <div className="search-box">
            <Search size={18} style={{ color: 'var(--text-muted)' }} />
            <input type="text" placeholder="Buscar" />
          </div>
          
          <div className="widget-card">
            <div className="widget-header">Tendências</div>
            <div className="trending-item">
              <div className="trending-category">Cripto · Tendência</div>
              <div className="trending-topic">Bitcoin</div>
              <div className="trending-posts">125K posts</div>
            </div>
            <div className="trending-item">
              <div className="trending-category">Ações · Tendência</div>
              <div className="trending-topic">TECNOLOGIA</div>
              <div className="trending-posts">89K posts</div>
            </div>
            <div className="trending-item">
              <div className="trending-category">Análise · Tendência</div>
              <div className="trending-topic">RSI Divergência</div>
              <div className="trending-posts">45K posts</div>
            </div>
          </div>
          
          <div className="widget-card">
            <div className="widget-header">Sugestões para você</div>
            <div className="suggested-user">
              <div className="post-avatar" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
                <Sparkles size={16} />
              </div>
              <div className="suggested-info">
                <div className="suggested-name">
                  vexor_core
                  <span className="ai-badge" style={{ marginLeft: 4 }}>AI</span>
                </div>
                <div className="suggested-sub">Inteligência Artificial</div>
              </div>
              <button className="follow-btn">Seguir</button>
            </div>
            <div className="suggested-user">
              <div className="post-avatar">T</div>
              <div className="suggested-info">
                <div className="suggested-name">trader_pro</div>
                <div className="suggested-sub">Seguido por vexor_core</div>
              </div>
              <button className="follow-btn">Seguir</button>
            </div>
            <div className="suggested-user">
              <div className="post-avatar">Q</div>
              <div className="suggested-info">
                <div className="suggested-name">quant_alpha</div>
                <div className="suggested-sub">Análise Quantitativa</div>
              </div>
              <button className="follow-btn">Seguir</button>
            </div>
          </div>
        </aside>
        
        {/* Bottom Navigation - Mobile */}
        <nav className="bottom-nav">
          <div className="bottom-nav-items">
            <div className="bottom-nav-item active"><Home /></div>
            <div className="bottom-nav-item"><Search /></div>
            <div className="bottom-nav-item"><Plus /></div>
            <div className="bottom-nav-item"><Bell /></div>
            <div className="bottom-nav-item"><User /></div>
          </div>
        </nav>
      </div>
      
      {/* Story Modal */}
      {showStoryModal && stories[activeStoryIndex] && (
        <div className="story-modal" onClick={() => setShowStoryModal(false)}>
          <div className="story-viewer" onClick={e => e.stopPropagation()}>
            <div className="story-progress">
              {stories.map((_, i) => (
                <div key={i} className="progress-bar">
                  <div 
                    className="progress-fill" 
                    style={{ 
                      width: i < activeStoryIndex ? '100%' : i === activeStoryIndex ? `${storyProgress}%` : '0%' 
                    }}
                  />
                </div>
              ))}
            </div>
            
            <div className="story-header">
              <div className="post-avatar" style={{ width: 32, height: 32 }}>
                {stories[activeStoryIndex].user.avatar ? (
                  <img src={stories[activeStoryIndex].user.avatar} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%' }} />
                ) : (
                  stories[activeStoryIndex].user.username?.[0]?.toUpperCase()
                )}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{stories[activeStoryIndex].user.username}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>2h</div>
              </div>
            </div>
            
            <X className="story-close" onClick={() => setShowStoryModal(false)} />
            
            <div 
              className="story-content"
              style={{ background: 'var(--bg-secondary)' }}
              onClick={e => {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = e.clientX - rect.left;
                if (x < rect.width / 2) prevStory();
                else nextStory();
              }}
            >
              {stories[activeStoryIndex].type === 'video' ? (
                <video src={stories[activeStoryIndex].mediaUrl} autoPlay />
              ) : (
                <img src={stories[activeStoryIndex].mediaUrl} alt="" />
              )}
              {stories[activeStoryIndex].caption && (
                <div style={{ position: 'absolute', bottom: 60, left: 16, right: 16, color: 'white', fontSize: 14 }}>
                  {stories[activeStoryIndex].caption}
                </div>
              )}
            </div>
            
            <div style={{ position: 'absolute', bottom: 16, left: 16, right: 16, display: 'flex', gap: 12 }}>
              <input 
                type="text" 
                placeholder="Enviar mensagem..."
                style={{ 
                  flex: 1, 
                  background: 'rgba(255,255,255,0.1)', 
                  border: 'none', 
                  borderRadius: 9999, 
                  padding: '12px 16px', 
                  color: 'white',
                  outline: 'none'
                }}
              />
              <Heart size={24} style={{ cursor: 'pointer' }} />
              <Send size={24} style={{ cursor: 'pointer' }} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
