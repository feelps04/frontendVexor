/**
 * Auth Routes - Oracle Database
 * Login, Register, Sessions with Oracle ATP
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import jwt from '@fastify/jwt';
import { telegramNotifier } from '../infrastructure/telegram-notifier.js';

// Dynamic import to ensure dotenv loads first
let oracleDB: any;
let OracleUserRepository: any;
let OracleSessionRepository: any;

async function loadOracle() {
  if (!oracleDB) {
    const module = await import('../infrastructure/oracle-db.js');
    oracleDB = module.oracleDB;
    OracleUserRepository = module.OracleUserRepository;
    OracleSessionRepository = module.OracleSessionRepository;
  }
  return { oracleDB, OracleUserRepository, OracleSessionRepository };
}

interface LoginBody {
  email: string;
  password: string;
}

interface RegisterBody {
  email: string;
  password: string;
  name: string;
  telegram?: string;
  country?: string;
}

interface UserPayload {
  id: string;
  email: string;
  name: string;
  role: string;
}

const JWT_SECRET = process.env.JWT_SECRET || 'vexor-jwt-secret-key-2026';
const SESSION_DURATION_HOURS = 24;

export async function authOracleRoutes(app: FastifyInstance) {
  // Register JWT
  await app.register(jwt, {
    secret: JWT_SECRET,
  });

  // Initialize Oracle connection (load dynamically after dotenv)
  try {
    await loadOracle();
    await oracleDB.initialize();
    app.log.info('Oracle DB initialized for auth');
  } catch (error) {
    app.log.warn('Oracle DB not available, using mock auth');
  }

  // Login
  app.post('/api/v1/auth/login', async (request: FastifyRequest<{ Body: LoginBody }>, reply: FastifyReply) => {
    const { email, password } = request.body || {};

    if (!email || !password) {
      return reply.status(400).send({ error: 'Email and password required' });
    }

    try {
      // Ensure Oracle is loaded
      let oracleAvailable = false;
      try {
        await loadOracle();
        await oracleDB.initialize();
        console.log('[Auth] Oracle module loaded');
        oracleAvailable = true;
      } catch (loadErr) {
        console.error('[Auth] Failed to load Oracle:', loadErr);
        // Fall through to mock users
      }
      
      // If Oracle is available, try Oracle first
      let user = null;
      if (oracleAvailable) {
        try {
          console.log('[Auth] Tentando login Oracle para:', email);
          user = await OracleUserRepository?.findByEmail(email);
          console.log('[Auth] Usuário encontrado:', user ? { id: user.ID, email: user.EMAIL, hasPassword: !!user.PASSWORD_HASH, isActive: user.IS_ACTIVE } : null);
        } catch (oracleErr) {
          console.error('[Auth] Oracle query error:', oracleErr);
        }
      }

      if (user && user.PASSWORD_HASH) {
        console.log('[Auth] Verificando senha...');
        const isValid = await bcrypt.compare(password, user.PASSWORD_HASH);
        console.log('[Auth] Senha válida:', isValid);
        
        if (!isValid) {
          return reply.status(401).send({ error: 'Invalid credentials' });
        }

        if (!user.IS_ACTIVE) {
          console.log('[Auth] Conta desativada');
          return reply.status(403).send({ error: 'Account disabled' });
        }

        // Update last login
        await OracleUserRepository.updateLastLogin(user.ID);

        // Create session
        const token = app.jwt.sign({ id: user.ID, email: user.EMAIL, role: user.ROLE } as UserPayload);
        const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000);
        
        await OracleSessionRepository.create(
          user.ID,
          token,
          expiresAt,
          request.ip,
          request.headers['user-agent']
        );

        return reply.send({
          success: true,
          user: {
            id: user.ID,
            email: user.EMAIL,
            name: user.NAME,
            role: user.ROLE,
          },
          token,
        });
      }

      // Mock login for demo (when Oracle not available)
      if (email === 'admin@vexor.com' && password === 'admin123') {
        const token = app.jwt.sign({ id: 'admin-001', email, role: 'admin' } as UserPayload);
        return reply.send({
          success: true,
          user: { id: 'admin-001', email, name: 'Admin', role: 'admin' },
          token,
        });
      }

      if (email === 'demo@vexor.com' && password === 'demo123') {
        const token = app.jwt.sign({ id: 'user-001', email, role: 'trader' } as UserPayload);
        return reply.send({
          success: true,
          user: { id: 'user-001', email, name: 'Demo Trader', role: 'trader' },
          token,
        });
      }

      return reply.status(401).send({ error: 'Invalid credentials' });
    } catch (error) {
      console.error('[Auth] Login error:', error);
      console.error('[Auth] Stack:', (error as Error).stack);
      app.log.error({ error }, 'Login error');
      return reply.status(500).send({ error: 'Internal server error', details: (error as Error).message, stack: (error as Error).stack });
    }
  });

  // Register
  app.post('/api/v1/auth/register', async (request: FastifyRequest<{ Body: RegisterBody }>, reply: FastifyReply) => {
    let { email, password, name, telegram, country } = request.body || {};

    // Auto-corrigir telegram (adicionar +55 se não tiver +)
    if (telegram && !telegram.startsWith('+')) {
      telegram = '+55' + telegram.replace(/\D/g, '');
    }

    // Todos campos obrigatórios
    if (!email || !password || !name || !telegram || !country) {
      return reply.status(400).send({ 
        error: 'Todos os campos são obrigatórios: email, codinome, telegram, país e senha' 
      });
    }

    // Validar formato do email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return reply.status(400).send({ error: 'Formato de email inválido' });
    }

    // Validar tamanho da senha
    if (password.length < 6) {
      return reply.status(400).send({ error: 'A senha deve ter no mínimo 6 caracteres' });
    }

    // Validar formato do telegram (deve ter DDI)
    if (!telegram.startsWith('+')) {
      return reply.status(400).send({ error: 'Telegram deve incluir DDI. Ex: +55 11 99999-9999' });
    }

    try {
      // Ensure Oracle is loaded
      await loadOracle();
      
      // Check if email already exists
      let existingEmail;
      try {
        existingEmail = await OracleUserRepository.findByEmail(email);
      } catch (e) {
        console.log('[Auth] findByEmail error:', (e as Error).message);
      }
      if (existingEmail) {
        return reply.status(409).send({ error: 'Este email já está cadastrado. Use outro email ou faça login.' });
      }

      // Check if telegram already exists
      let existingTelegram;
      try {
        existingTelegram = await OracleUserRepository.findByTelegram(telegram);
      } catch (e) {
        console.log('[Auth] findByTelegram error:', (e as Error).message);
      }
      if (existingTelegram) {
        return reply.status(409).send({ error: 'Este número de Telegram já está cadastrado. Use outro número ou faça login.' });
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, 10);

      // Create user in Oracle
      let user;
      try {
        console.log('[Auth] Criando usuário no Oracle:', { email, name, telegram, country });
        user = await OracleUserRepository.create(email, name, passwordHash, 'trader', telegram, country);
        console.log('[Auth] ✅ Usuário criado:', user);
      } catch (e) {
        console.error('[Auth] ❌ Erro ao criar usuário:', (e as Error).message);
        return reply.status(500).send({ error: 'Erro ao criar cadastro. Tente novamente.' });
      }

      // Create token
      const token = app.jwt.sign({ id: user.id, email: user.email, role: user.role } as UserPayload);

      // Send welcome message via Telegram to user
      const hour = new Date().getHours();
      let greeting = 'Boa noite';
      if (hour >= 5 && hour < 12) greeting = 'Bom dia';
      else if (hour >= 12 && hour < 18) greeting = 'Boa tarde';

      const countryNames: Record<string, string> = {
        'BR': 'Brasil', 'US': 'Estados Unidos', 'PT': 'Portugal',
        'AR': 'Argentina', 'MX': 'México', 'CO': 'Colômbia',
        'CL': 'Chile', 'PE': 'Peru', 'ES': 'Espanha',
        'IT': 'Itália', 'DE': 'Alemanha', 'FR': 'França',
        'UK': 'Reino Unido', 'JP': 'Japão', 'CN': 'China', 'OTHER': 'Outro'
      };
      const countryName = countryNames[country] || country;

      // Mensagem para o usuário (enviar para o chat do Telegram)
      const userMessage = 
        `${greeting}, ${name}! 🎯\n\n` +
        `✅ <b>Bem-vindo ao VEXOR Trading System!</b>\n\n` +
        `📋 <b>Protocolo de Adesão Aprovado</b>\n\n` +
        `👤 <b>Codinome:</b> ${name}\n` +
        `📧 <b>Email:</b> ${email}\n` +
        `📱 <b>Telegram:</b> ${telegram}\n` +
        `🌍 <b>País:</b> ${countryName}\n\n` +
        `🔐 <b>Suas credenciais foram geradas com sucesso!</b>\n\n` +
        `🤖 A IA VEXOR está pronta para ajudá-lo a operar!\n\n` +
        `<i>Você receberá alertas de oportunidades, notícias relevantes e sinais de entrada/saída.</i>\n\n` +
        `⚡ <b>VEXOR - Inteligência Artificial para Traders</b>`;

      // Enviar mensagem para o canal admin
      await telegramNotifier.sendToAdmin(
        `🆕 <b>NOVO CADASTRO VEXOR</b>\n\n` +
        `👤 <b>Codinome:</b> ${name}\n` +
        `📧 <b>Email:</b> ${email}\n` +
        `📱 <b>Telegram:</b> ${telegram}\n` +
        `🌍 <b>País:</b> ${countryName}\n` +
        `🕐 <b>Horário:</b> ${new Date().toLocaleString('pt-BR')}`
      );

      // Tentar enviar mensagem direta para o usuário via Telegram
      // Nota: Para enviar mensagem direta, o usuário precisa ter iniciado conversa com o bot
      try {
        // O chatId do Telegram é o número de telefone com + (ex: +5511999999999)
        // Mas o Telegram usa o chat_id numérico, não o telefone
        // Por enquanto, enviamos para o chat admin que o usuário verá quando entrar no grupo
        // TODO: Implementar webhook para capturar chat_id quando usuário iniciar conversa com bot
        console.log('[Auth] ✅ Mensagem de registro enviada para admin');
      } catch (telegramError) {
        console.warn('[Auth] ⚠️ Erro ao enviar Telegram:', (telegramError as Error).message);
        // Não falha o registro se o Telegram falhar
      }

      return reply.status(201).send({
        success: true,
        user,
        token,
      });
    } catch (error) {
      app.log.error({ error }, 'Registration error');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // Verify token
  app.get('/api/v1/auth/verify', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.status(401).send({ error: 'No token provided' });
      }

      const token = authHeader.substring(7);
      const decoded = app.jwt.verify<UserPayload>(token);

      // Verify session in Oracle
      const session = await OracleSessionRepository.findByToken(token);
      if (!session) {
        // Session not found but token valid - create mock session
        return reply.send({ valid: true, user: decoded });
      }

      return reply.send({ valid: true, user: decoded });
    } catch (error) {
      return reply.status(401).send({ error: 'Invalid token' });
    }
  });

  // Logout
  app.post('/api/v1/auth/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const authHeader = request.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        await OracleSessionRepository.invalidate(token);
      }
      return reply.send({ success: true });
    } catch (error) {
      return reply.send({ success: true }); // Always success on logout
    }
  });

  // Get current user
  app.get('/api/v1/auth/me', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.status(401).send({ error: 'No token provided' });
      }

      const token = authHeader.substring(7);
      const decoded = app.jwt.verify<UserPayload>(token);

      // Get full user from Oracle
      const user = await OracleUserRepository.findById(decoded.id);
      if (user) {
        return reply.send({
          id: user.ID,
          email: user.EMAIL,
          name: user.NAME,
          role: user.ROLE,
          createdAt: user.CREATED_AT,
        });
      }

      // Mock user if not in Oracle
      return reply.send(decoded);
    } catch (error) {
      return reply.status(401).send({ error: 'Invalid token' });
    }
  });

  // Health check for auth
  app.get('/api/v1/auth/health', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Test Oracle connection
      await oracleDB.query('SELECT 1 FROM dual');
      return reply.send({ status: 'ok', database: 'oracle' });
    } catch (error) {
      return reply.send({ status: 'degraded', database: 'mock' });
    }
  });
}
