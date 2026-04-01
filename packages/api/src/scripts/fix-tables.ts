/**
 * FIX TABLES - Drop e recria tabelas com reserved words
 */

import * as fs from 'fs';
import { config } from 'dotenv';
import { oracleDB } from '../infrastructure/oracle-db.js';

const rootEnv = 'C:/Users/opc/CascadeProjects/vexor-Oracle/vexor-Oracle-main/.env';
if (fs.existsSync(rootEnv)) {
  config({ path: rootEnv, override: true });
}

async function fixTables() {
  console.log('🔧 Conectando ao Oracle...');
  
  await oracleDB.initialize();
  console.log('✅ Conectado');
  
  // Tabelas para dropar
  const tablesToDrop = [
    'tilt_state',
    'tilt_triggers', 
    'session_metrics',
    'barbell_allocations',
    'trade_notifications',
    'trade_signals',
    'strategy_memory',
    'strategies'
  ];
  
  for (const table of tablesToDrop) {
    try {
      console.log(`🗑️ Dropando ${table}...`);
      await oracleDB.execute(`DROP TABLE ${table} PURGE`);
      console.log(`✅ ${table} dropada`);
    } catch (e: any) {
      if (e.message?.includes('ORA-00942')) {
        console.log(`⚠️ ${table} não existe`);
      } else {
        console.log(`⚠️ Erro ao dropar ${table}: ${e.message}`);
      }
    }
  }
  
  // Recriar tabelas com nomes corretos
  console.log('\n📊 Recriando tabelas...\n');
  
  // tilt_state
  try {
    await oracleDB.execute(`
      CREATE TABLE tilt_state (
        id VARCHAR2(36) PRIMARY KEY,
        tilt_level NUMBER(1),
        score NUMBER,
        indicators_json VARCHAR2(4000),
        actions VARCHAR2(1000),
        detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ tilt_state criada');
  } catch (e: any) {
    console.log('⚠️ tilt_state:', e.message);
  }
  
  // tilt_triggers
  try {
    await oracleDB.execute(`
      CREATE TABLE tilt_triggers (
        id VARCHAR2(36) PRIMARY KEY,
        user_id VARCHAR2(36),
        trigger_col VARCHAR2(100),
        tilt_level NUMBER(1),
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ tilt_triggers criada');
  } catch (e: any) {
    console.log('⚠️ tilt_triggers:', e.message);
  }
  
  // session_metrics
  try {
    await oracleDB.execute(`
      CREATE TABLE session_metrics (
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
    console.log('✅ session_metrics criada');
  } catch (e: any) {
    console.log('⚠️ session_metrics:', e.message);
  }
  
  // barbell_allocations
  try {
    await oracleDB.execute(`
      CREATE TABLE barbell_allocations (
        id VARCHAR2(36) PRIMARY KEY,
        allocation_mode VARCHAR2(20),
        conservative_percent NUMBER,
        asymmetric_percent NUMBER,
        reason VARCHAR2(500),
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ barbell_allocations criada');
  } catch (e: any) {
    console.log('⚠️ barbell_allocations:', e.message);
  }
  
  // trade_notifications
  try {
    await oracleDB.execute(`
      CREATE TABLE trade_notifications (
        id VARCHAR2(36) PRIMARY KEY,
        user_id VARCHAR2(36),
        position_id VARCHAR2(36),
        signal_type VARCHAR2(50),
        message VARCHAR2(4000),
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        delivered NUMBER(1) DEFAULT 0
      )
    `);
    console.log('✅ trade_notifications criada');
  } catch (e: any) {
    console.log('⚠️ trade_notifications:', e.message);
  }
  
  // trade_signals
  try {
    await oracleDB.execute(`
      CREATE TABLE trade_signals (
        id VARCHAR2(36) PRIMARY KEY,
        symbol VARCHAR2(20),
        side VARCHAR2(4),
        entry_price NUMBER,
        exit_price NUMBER,
        stop_price NUMBER,
        target_price NUMBER,
        quantity NUMBER,
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
    console.log('✅ trade_signals criada');
  } catch (e: any) {
    console.log('⚠️ trade_signals:', e.message);
  }
  
  // strategy_memory
  try {
    await oracleDB.execute(`
      CREATE TABLE strategy_memory (
        id VARCHAR2(36) PRIMARY KEY,
        symbol VARCHAR2(20),
        price NUMBER,
        signal_type VARCHAR2(20),
        strength NUMBER,
        hits NUMBER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ strategy_memory criada');
  } catch (e: any) {
    console.log('⚠️ strategy_memory:', e.message);
  }
  
  // strategies
  try {
    await oracleDB.execute(`
      CREATE TABLE strategies (
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
    console.log('✅ strategies criada');
  } catch (e: any) {
    console.log('⚠️ strategies:', e.message);
  }
  
  await oracleDB.close();
  console.log('\n✅ Tabelas corrigidas!');
}

fixTables().catch(console.error);
