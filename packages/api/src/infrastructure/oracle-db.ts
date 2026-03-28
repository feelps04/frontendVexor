/**
 * Oracle Autonomous Database Connection
 * ATP (Autonomous Transaction Processing)
 */

import oracledb from 'oracledb';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { config } from 'dotenv';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env from root first (most important)
const rootEnvPath = 'C:/Users/opc/CascadeProjects/vexor-Oracle/vexor-Oracle-main/.env';
if (fs.existsSync(rootEnvPath)) {
  const result = config({ path: rootEnvPath, override: true });
  console.log(`[Oracle] Loaded ${Object.keys(result.parsed || {}).length} env vars from root .env`);
}

// Also try cwd as fallback
const cwdEnv = resolve(process.cwd(), '.env');
if (cwdEnv !== rootEnvPath && fs.existsSync(cwdEnv)) {
  config({ path: cwdEnv, override: true });
}

// Try thick mode first (more reliable), then thin mode
let clientInitialized = false;
const clientPaths = [
  'C:\\oracle\\instantclient_21_12',
  'C:\\oracle\\instantclient_23_0',
  'C:\\oracle\\instantclient_21_13',
  'C:\\oracle\\instantclient_23_3',
  process.env.ORACLE_CLIENT_LIB
].filter(Boolean);

// Try thick mode first
for (const libDir of clientPaths) {
  try {
    oracledb.initOracleClient({ libDir });
    clientInitialized = true;
    console.log(`[Oracle] Thick mode initialized: ${libDir}`);
    break;
  } catch {}
}

// Fallback to thin mode
if (!clientInitialized) {
  try {
    oracledb.initOracleClient({ thin: true });
    clientInitialized = true;
    console.log('[Oracle] Thin mode initialized');
  } catch (e) {
    console.warn('[Oracle] No Oracle Client available - running without Oracle DB');
  }
}

export interface OracleConfig {
  user: string;
  password: string;
  connectString: string;
  walletPath?: string;
  walletPassword?: string;
}

export class OracleDB {
  private pool: oracledb.Pool | null = null;
  private config: OracleConfig;

  constructor() {
    // Config will be loaded in initialize() after dotenv loads
    this.config = {
      user: 'ADMIN',
      password: '',
      connectString: '',
      walletPath: undefined,
      walletPassword: '',
    };
  }

  async initialize(): Promise<void> {
    if (this.pool) return;

    // Debug: verificar se dotenv carregou
    console.log('[Oracle] ENV check:', {
      hasPassword: !!process.env.OCI_ATP_PASSWORD,
      hasConnectString: !!process.env.OCI_ATP_CONNECT_STRING,
      hasWallet: !!process.env.OCI_WALLET_PATH,
      connectStringPreview: process.env.OCI_ATP_CONNECT_STRING?.substring(0, 50)
    });

    // Read config from env at runtime (after dotenv loads)
    // Support VEXOR_DB_PASS environment variable for secure password storage
    const password = process.env.VEXOR_DB_PASS || process.env.OCI_ATP_PASSWORD || '';
    
    this.config = {
      user: process.env.OCI_ATP_USER || 'ADMIN',
      password: password,
      connectString: process.env.OCI_ATP_CONNECT_STRING || '',
      walletPath: process.env.OCI_WALLET_PATH,
      walletPassword: process.env.OCI_WALLET_PASSWORD || '',
    };

    console.log('[Oracle] Config loaded:', {
      user: this.config.user,
      passwordLength: this.config.password?.length || 0,
      connectStringLength: this.config.connectString?.length || 0,
      walletPath: this.config.walletPath
    });

    if (!this.config.password || !this.config.connectString) {
      console.warn('Oracle ATP credentials not configured. Running in degraded mode.');
      return;
    }

    try {
      // Read wallet files for TLS
      const walletPath = this.config.walletPath;
      let sslConfig: any = {};

      if (walletPath && fs.existsSync(walletPath)) {
        // Use wallet location for thick mode (same as test that worked)
        sslConfig = {
          ssl: true,
          sslServerCertDN: 'CN=adb.sa-saopaulo-1.oraclecloud.com',
          walletLocation: walletPath,
        };
      }

      // Use connect string from env (low service for better availability)
      const connectString = this.config.connectString;

      console.log('[Oracle] Connecting with config:', {
        user: this.config.user,
        passwordLength: this.config.password?.length,
        connectStringPreview: connectString?.substring(0, 100) + '...',
        walletPath,
        hasSSL: !!sslConfig.ssl
      });

      this.pool = await oracledb.createPool({
        user: this.config.user,
        password: this.config.password,
        connectString: connectString,
        poolMin: 2,
        poolMax: 10,
        poolIncrement: 1,
        ...sslConfig,
      });
      console.log('✅ Oracle ATP connection pool created');
      
      // Create tables
      await this.createTables();
    } catch (error) {
      console.error('❌ Failed to create Oracle pool:', error);
      throw error;
    }
  }

  private async createTables(): Promise<void> {
    try {
      // Users table
      await this.execute(`
        CREATE TABLE IF NOT EXISTS users (
          id VARCHAR2(36) PRIMARY KEY,
          email VARCHAR2(255) UNIQUE NOT NULL,
          name VARCHAR2(255),
          password_hash VARCHAR2(255),
          role VARCHAR2(50) DEFAULT 'trader',
          telegram_phone VARCHAR2(50),
          telegram_chat_id VARCHAR2(50),
          country VARCHAR2(10),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          last_login TIMESTAMP,
          is_active NUMBER(1) DEFAULT 1
        )
      `);
      
      // Add telegram_chat_id column if not exists (for existing tables)
      try {
        await this.execute(`ALTER TABLE users ADD telegram_chat_id VARCHAR2(50)`);
      } catch (e) {
        // Column already exists, ignore
      }

      // Sessions table
      await this.execute(`
        CREATE TABLE IF NOT EXISTS sessions (
          id VARCHAR2(36) PRIMARY KEY,
          user_id VARCHAR2(36) NOT NULL,
          token VARCHAR2(500) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          expires_at TIMESTAMP,
          ip_address VARCHAR2(50),
          user_agent VARCHAR2(500),
          is_valid NUMBER(1) DEFAULT 1
        )
      `);

      // Vector documents table (for RAG)
      await this.execute(`
        CREATE TABLE IF NOT EXISTS vector_documents (
          id VARCHAR2(36) PRIMARY KEY,
          content CLOB,
          embedding VARCHAR2(4000),
          source VARCHAR2(255),
          category VARCHAR2(100),
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // RAG learning table
      await this.execute(`
        CREATE TABLE IF NOT EXISTS rag_learning (
          id VARCHAR2(36) PRIMARY KEY,
          query VARCHAR2(500),
          context VARCHAR2(2000),
          response VARCHAR2(1000),
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Open positions
      await this.execute(`
        CREATE TABLE IF NOT EXISTS open_positions (
          id VARCHAR2(36) PRIMARY KEY,
          user_id VARCHAR2(36),
          symbol VARCHAR2(20) NOT NULL,
          side VARCHAR2(4) NOT NULL,
          quantity NUMBER NOT NULL,
          entry_price NUMBER NOT NULL,
          stop_price NUMBER NOT NULL,
          target_price NUMBER NOT NULL,
          trailing_stop NUMBER,
          strategy VARCHAR2(100),
          agents VARCHAR2(4000),
          confidence NUMBER,
          broker VARCHAR2(50),
          pnl NUMBER DEFAULT 0,
          opened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          highest_price NUMBER
        )
      `);

      // Trade history
      await this.execute(`
        CREATE TABLE IF NOT EXISTS trade_history (
          id VARCHAR2(36) PRIMARY KEY,
          user_id VARCHAR2(36),
          symbol VARCHAR2(20) NOT NULL,
          side VARCHAR2(4) NOT NULL,
          quantity NUMBER NOT NULL,
          entry_price NUMBER NOT NULL,
          exit_price NUMBER NOT NULL,
          stop_price NUMBER,
          target_price NUMBER,
          pnl NUMBER NOT NULL,
          pnl_percent NUMBER,
          outcome NUMBER(1),
          close_reason VARCHAR2(20),
          strategy VARCHAR2(100),
          agents VARCHAR2(4000),
          broker VARCHAR2(50),
          opened_at TIMESTAMP,
          closed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          hold_time_ms NUMBER
        )
      `);

      // Trade notifications
      await this.execute(`
        CREATE TABLE IF NOT EXISTS trade_notifications (
          id VARCHAR2(36) PRIMARY KEY,
          user_id VARCHAR2(36),
          position_id VARCHAR2(36),
          signal_type VARCHAR2(50) NOT NULL,
          message VARCHAR2(4000),
          sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          delivered NUMBER(1) DEFAULT 0
        )
      `);

      // Trade signals (for SignalTracker)
      await this.execute(`
        CREATE TABLE IF NOT EXISTS trade_signals (
          id VARCHAR2(36) PRIMARY KEY,
          symbol VARCHAR2(20) NOT NULL,
          side VARCHAR2(4) NOT NULL,
          entry_price NUMBER NOT NULL,
          exit_price NUMBER,
          stop_price NUMBER NOT NULL,
          target_price NUMBER NOT NULL,
          quantity NUMBER NOT NULL,
          strategy VARCHAR2(100),
          confidence NUMBER,
          signal_status VARCHAR2(20) DEFAULT 'ACTIVE',
          outcome VARCHAR2(10),
          pnl NUMBER,
          pnl_percent NUMBER,
          duration_ms NUMBER,
          exit_reason VARCHAR2(50),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          closed_at TIMESTAMP
        )
      `);

      // Learning data
      await this.execute(`
        CREATE TABLE IF NOT EXISTS learning_data (
          id VARCHAR2(36) PRIMARY KEY,
          trade_id VARCHAR2(36),
          strategy VARCHAR2(100),
          agents VARCHAR2(4000),
          regime VARCHAR2(50),
          confidence NUMBER,
          outcome NUMBER(1) NOT NULL,
          features VARCHAR2(4000),
          content VARCHAR2(4000),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Strategy memory
      await this.execute(`
        CREATE TABLE IF NOT EXISTS strategy_memory (
          id VARCHAR2(36) PRIMARY KEY,
          symbol VARCHAR2(20),
          price NUMBER,
          signal_type VARCHAR2(20),
          strength NUMBER,
          hits NUMBER DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Briefing history
      await this.execute(`
        CREATE TABLE IF NOT EXISTS briefing_history (
          id VARCHAR2(36) PRIMARY KEY,
          approved NUMBER(1),
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          items_json VARCHAR2(4000),
          macro_json VARCHAR2(1000),
          risk_json VARCHAR2(1000),
          psych_json VARCHAR2(1000),
          warnings VARCHAR2(2000)
        )
      `);

      // Tilt state
      await this.execute(`
        CREATE TABLE IF NOT EXISTS tilt_state (
          id VARCHAR2(36) PRIMARY KEY,
          tilt_level NUMBER(1),
          score NUMBER,
          indicators_json VARCHAR2(4000),
          actions VARCHAR2(1000),
          detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Strategies
      await this.execute(`
        CREATE TABLE IF NOT EXISTS strategies (
          id VARCHAR2(36) PRIMARY KEY,
          name VARCHAR2(100) UNIQUE,
          genes VARCHAR2(4000),
          generation NUMBER,
          parent_id VARCHAR2(36),
          strategy_status VARCHAR2(20) DEFAULT 'PAPER',
          paper_sessions NUMBER DEFAULT 0,
          profit_factor NUMBER DEFAULT 0,
          expectancy NUMBER DEFAULT 0,
          win_rate NUMBER DEFAULT 0,
          total_trades NUMBER DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Session metrics
      await this.execute(`
        CREATE TABLE IF NOT EXISTS session_metrics (
          id VARCHAR2(36) PRIMARY KEY,
          session_date TIMESTAMP,
          total_trades NUMBER,
          wins NUMBER,
          losses NUMBER,
          win_rate NUMBER,
          total_pnl NUMBER,
          avg_win NUMBER,
          avg_loss NUMBER,
          expectancy NUMBER,
          profit_factor NUMBER,
          max_drawdown NUMBER,
          sharpe_ratio NUMBER,
          avg_hold_time NUMBER
        )
      `);

      // Barbell allocations
      await this.execute(`
        CREATE TABLE IF NOT EXISTS barbell_allocations (
          id VARCHAR2(36) PRIMARY KEY,
          allocation_mode VARCHAR2(20),
          conservative_percent NUMBER,
          asymmetric_percent NUMBER,
          reason VARCHAR2(500),
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Risk state
      await this.execute(`
        CREATE TABLE IF NOT EXISTS risk_state (
          id VARCHAR2(36) PRIMARY KEY,
          daily_pnl NUMBER DEFAULT 0,
          daily_trades NUMBER DEFAULT 0,
          drawdown NUMBER DEFAULT 0,
          var_99 NUMBER DEFAULT 0,
          cvar_99 NUMBER DEFAULT 0,
          exposure NUMBER DEFAULT 0,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      console.log('✅ Oracle tables created');
    } catch (e) {
      console.warn('Table creation warning:', (e as Error).message);
    }
  }

  async getConnection(): Promise<oracledb.Connection> {
    if (!this.pool) {
      console.log('[Oracle] Pool not initialized, calling initialize()...');
      await this.initialize();
    }
    if (!this.pool) {
      console.error('[Oracle] Pool still null after initialize()');
      throw new Error('Oracle pool not initialized');
    }
    return this.pool.getConnection();
  }

  async execute<T = any>(
    sql: string,
    binds: oracledb.BindParameters = {},
    options: oracledb.ExecuteOptions = {}
  ): Promise<{ rows: T[]; outBinds: any }> {
    const conn = await this.getConnection();
    try {
      const result = await conn.execute(sql, binds, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        ...options,
      });
      return {
        rows: result.rows as T[],
        outBinds: result.outBinds,
      };
    } finally {
      await conn.close();
    }
  }

  async executeMany(
    sql: string,
    bindsArray: oracledb.BindParameters[]
  ): Promise<oracledb.Result<any>[]> {
    const conn = await this.getConnection();
    try {
      const results = await conn.executeMany(sql, bindsArray);
      return results;
    } finally {
      await conn.close();
    }
  }

  async query<T = any>(sql: string, binds: oracledb.BindParameters = {}): Promise<T[]> {
    const { rows } = await this.execute<T>(sql, binds);
    return rows;
  }

  async queryOne<T = any>(sql: string, binds: oracledb.BindParameters = {}): Promise<T | null> {
    const rows = await this.query<T>(sql, binds);
    return rows.length > 0 ? rows[0] : null;
  }

  async insert(sql: string, binds: oracledb.BindParameters = {}): Promise<any> {
    const { outBinds } = await this.execute(sql, binds, { autoCommit: true });
    return outBinds;
  }

  async update(sql: string, binds: oracledb.BindParameters = {}): Promise<number> {
    const { rows } = await this.execute(sql, binds, { autoCommit: true });
    return rows?.length ?? 0;
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.close(0);
      this.pool = null;
    }
  }

  // Helper to generate UUID
  generateId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
}

// Singleton instance
export const oracleDB = new OracleDB();

// User operations
export const OracleUserRepository = {
  async create(email: string, name: string, passwordHash: string, role: string = 'trader', telegramPhone?: string, country?: string) {
    const id = oracleDB.generateId();
    await oracleDB.insert(
      `INSERT INTO users (id, email, name, password_hash, role, telegram_phone, country, created_at)
       VALUES (:id, :email, :name, :passwordHash, :role, :telegramPhone, :country, CURRENT_TIMESTAMP)`,
      { id, email, name, passwordHash, role, telegramPhone: telegramPhone || null, country: country || null }
    );
    return { id, email, name, role, telegramPhone, country };
  },

  async findByEmail(email: string) {
    return oracleDB.queryOne<{
      ID: string;
      EMAIL: string;
      NAME: string;
      PASSWORD_HASH: string;
      ROLE: string;
      CREATED_AT: Date;
      LAST_LOGIN: Date | null;
      IS_ACTIVE: number;
      TELEGRAM_PHONE: string;
      COUNTRY: string;
    }>(
      `SELECT id, email, name, password_hash, role, created_at, last_login, is_active, telegram_phone, country
       FROM users WHERE email = :email`,
      { email }
    );
  },

  async findByTelegram(telegramPhone: string) {
    return oracleDB.queryOne<{
      ID: string;
      EMAIL: string;
      NAME: string;
      TELEGRAM_PHONE: string;
    }>(
      `SELECT id, email, name, telegram_phone FROM users WHERE telegram_phone = :telegramPhone`,
      { telegramPhone }
    );
  },

  async findById(id: string) {
    return oracleDB.queryOne<{
      ID: string;
      EMAIL: string;
      NAME: string;
      ROLE: string;
      CREATED_AT: Date;
    }>(
      `SELECT id, email, name, role, created_at FROM users WHERE id = :id`,
      { id }
    );
  },

  async updateLastLogin(id: string) {
    await oracleDB.update(
      `UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = :id`,
      { id }
    );
  },
};

// Session operations
export const OracleSessionRepository = {
  async create(userId: string, token: string, expiresAt: Date, ipAddress?: string, userAgent?: string) {
    const id = oracleDB.generateId();
    await oracleDB.insert(
      `INSERT INTO sessions (id, user_id, token, created_at, expires_at, ip_address, user_agent, is_valid)
       VALUES (:id, :userId, :token, CURRENT_TIMESTAMP, :expiresAt, :ipAddress, :userAgent, 1)`,
      { id, userId, token, expiresAt, ipAddress, userAgent }
    );
    return id;
  },

  async findByToken(token: string) {
    return oracleDB.queryOne<{
      ID: string;
      USER_ID: string;
      TOKEN: string;
      EXPIRES_AT: Date;
      IS_VALID: number;
    }>(
      `SELECT id, user_id, token, expires_at, is_valid
       FROM sessions WHERE token = :token AND is_valid = 1 AND expires_at > CURRENT_TIMESTAMP`,
      { token }
    );
  },

  async invalidate(token: string) {
    await oracleDB.update(
      `UPDATE sessions SET is_valid = 0 WHERE token = :token`,
      { token }
    );
  },
};

// Trade operations
export const OracleTradeRepository = {
  async create(data: {
    userId: string;
    symbol: string;
    side: string;
    quantity: number;
    entryPrice: number;
    setup?: string;
    regime?: string;
    agentsAgreed?: string;
    agentsDisagreed?: string;
  }) {
    const id = oracleDB.generateId();
    await oracleDB.insert(
      `INSERT INTO trades (id, user_id, symbol, side, quantity, entry_price, setup, regime, 
         agents_agreed, agents_disagreed, created_at, status)
       VALUES (:id, :userId, :symbol, :side, :quantity, :entryPrice, :setup, :regime,
         :agentsAgreed, :agentsDisagreed, CURRENT_TIMESTAMP, 'filled')`,
      {
        id,
        userId: data.userId,
        symbol: data.symbol,
        side: data.side,
        quantity: data.quantity,
        entryPrice: data.entryPrice,
        setup: data.setup || null,
        regime: data.regime || null,
        agentsAgreed: data.agentsAgreed || null,
        agentsDisagreed: data.agentsDisagreed || null,
      }
    );
    return id;
  },

  async findByUserId(userId: string, limit: number = 100) {
    return oracleDB.query<{
      ID: string;
      SYMBOL: string;
      SIDE: string;
      QUANTITY: number;
      ENTRY_PRICE: number;
      EXIT_PRICE: number | null;
      PNL: number | null;
      PNL_PERCENT: number | null;
      CREATED_AT: Date;
      CLOSED_AT: Date | null;
    }>(
      `SELECT id, symbol, side, quantity, entry_price, exit_price, pnl, pnl_percent, created_at, closed_at
       FROM trades WHERE user_id = :userId ORDER BY created_at DESC FETCH FIRST :limit ROWS ONLY`,
      { userId, limit }
    );
  },

  async updatePnL(id: string, exitPrice: number, pnl: number, pnlPercent: number) {
    await oracleDB.update(
      `UPDATE trades SET exit_price = :exitPrice, pnl = :pnl, pnl_percent = :pnlPercent,
         closed_at = CURRENT_TIMESTAMP WHERE id = :id`,
      { id, exitPrice, pnl, pnlPercent }
    );
  },
};

// Behavior Log operations
export const OracleBehaviorRepository = {
  async create(data: {
    userId: string;
    patternType: string;
    severity: number;
    description: string;
    recommendation: string;
    llmAnalysis?: string;
    tradesInvolved?: string;
  }) {
    const id = oracleDB.generateId();
    await oracleDB.insert(
      `INSERT INTO behavior_logs (id, user_id, pattern_type, severity, description,
         recommendation, llm_analysis, trades_involved, detected_at)
       VALUES (:id, :userId, :patternType, :severity, :description,
         :recommendation, :llmAnalysis, :tradesInvolved, CURRENT_TIMESTAMP)`,
      {
        id,
        userId: data.userId,
        patternType: data.patternType,
        severity: data.severity,
        description: data.description,
        recommendation: data.recommendation,
        llmAnalysis: data.llmAnalysis || null,
        tradesInvolved: data.tradesInvolved || null,
      }
    );
    return id;
  },

  async findByUserId(userId: string, limit: number = 50) {
    return oracleDB.query<{
      ID: string;
      PATTERN_TYPE: string;
      SEVERITY: number;
      DESCRIPTION: string;
      RECOMMENDATION: string;
      DETECTED_AT: Date;
    }>(
      `SELECT id, pattern_type, severity, description, recommendation, detected_at
       FROM behavior_logs WHERE user_id = :userId ORDER BY detected_at DESC
       FETCH FIRST :limit ROWS ONLY`,
      { userId, limit }
    );
  },
};
