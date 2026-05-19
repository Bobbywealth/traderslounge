/**
 * Database Service for TradersLounge
 * 
 * This service connects to Netlify Postgres (Neon) for persistent storage.
 * 
 * Setup Instructions:
 * 1. Create a Postgres database in Netlify Dashboard:
 *    - Go to: app.netlify.com → traderslounge → Integrations → Databases
 *    - Click "Create Postgres Database" → Select Neon
 *    - Copy the connection string to Netlify Environment Variables as DATABASE_URL
 * 
 * 2. The DATABASE_URL should look like:
 *    postgresql://username:password@host/dbname?sslmode=require
 * 
 * Note: For frontend-only apps, database calls should go through
 * Netlify Functions (serverless functions). This service is designed
 * to be used in serverless functions, not directly from the client.
 */

import { neon, NeonQueryFunction } from '@neondatabase/serverless';

// Type definitions for our database tables
export interface User {
  id: string;
  email: string;
  name: string;
  plan: 'free' | 'pro' | 'enterprise';
  created_at: Date;
  updated_at: Date;
}

export interface BrokerConnection {
  id: string;
  user_id: string;
  broker_type: 'trade_locker' | 'metatrader4' | 'metatrader5' | 'oanda' | 'binance' | 'other';
  name: string;
  is_demo: boolean;
  is_active: boolean;
  credentials_encrypted: string; // Encrypted JSON
  created_at: Date;
  last_sync_at: Date | null;
}

export interface Trade {
  id: string;
  user_id: string;
  broker_connection_id: string;
  external_trade_id: string;
  symbol: string;
  type: 'buy' | 'sell';
  volume: number;
  open_price: number;
  close_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  open_time: Date;
  close_time: Date | null;
  profit: number;
  commission: number;
  swap: number;
  status: 'open' | 'closed' | 'pending';
  comment: string | null;
  created_at: Date;
}

export interface PerformanceRecord {
  id: string;
  user_id: string;
  date: Date;
  total_pnl: number;
  daily_pnl: number;
  win_count: number;
  loss_count: number;
  total_trades: number;
  win_rate: number;
  created_at: Date;
}

// SQL Schema for initializing the database
export const SCHEMA = `
-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  plan VARCHAR(50) DEFAULT 'free',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Broker connections table
CREATE TABLE IF NOT EXISTS broker_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  broker_type VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  is_demo BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  credentials_encrypted TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_sync_at TIMESTAMP
);

-- Trades table
CREATE TABLE IF NOT EXISTS trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  broker_connection_id UUID REFERENCES broker_connections(id) ON DELETE SET NULL,
  external_trade_id VARCHAR(255),
  symbol VARCHAR(50) NOT NULL,
  type VARCHAR(10) NOT NULL,
  volume DECIMAL(10, 2) NOT NULL,
  open_price DECIMAL(15, 5) NOT NULL,
  close_price DECIMAL(15, 5),
  stop_loss DECIMAL(15, 5),
  take_profit DECIMAL(15, 5),
  open_time TIMESTAMP NOT NULL,
  close_time TIMESTAMP,
  profit DECIMAL(15, 2) DEFAULT 0,
  commission DECIMAL(10, 2) DEFAULT 0,
  swap DECIMAL(10, 2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'open',
  comment TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Performance tracking table
CREATE TABLE IF NOT EXISTS performance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  total_pnl DECIMAL(15, 2) DEFAULT 0,
  daily_pnl DECIMAL(15, 2) DEFAULT 0,
  win_count INTEGER DEFAULT 0,
  loss_count INTEGER DEFAULT 0,
  total_trades INTEGER DEFAULT 0,
  win_rate DECIMAL(5, 2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, date)
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_trades_user_id ON trades(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_broker_connection_id ON trades(broker_connection_id);
CREATE INDEX IF NOT EXISTS idx_trades_open_time ON trades(open_time);
CREATE INDEX IF NOT EXISTS idx_performance_user_date ON performance_records(user_id, date);
CREATE INDEX IF NOT EXISTS idx_broker_connections_user_id ON broker_connections(user_id);
`;

/**
 * Get a database connection
 * @returns Neon Query Function
 */
export function getDb(): NeonQueryFunction<false, false> {
  // For client-side: use VITE_DATABASE_URL (not recommended for production)
  // For server-side (Netlify Functions): use DATABASE_URL
  const connectionString = import.meta.env.VITE_DATABASE_URL as string || 
                          (typeof process !== 'undefined' ? process.env.DATABASE_URL : undefined);
  
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not set. Please configure your Netlify Postgres database.');
  }
  
  return neon(connectionString);
}

/**
 * Initialize database schema
 * Should be called once during setup
 */
export async function initializeDatabase(): Promise<void> {
  const sql = getDb();
  await sql(SCHEMA);
  console.log('Database schema initialized successfully');
}

// User operations
export async function getUser(userId: string): Promise<User | null> {
  const sql = getDb();
  const result = await sql('SELECT * FROM users WHERE id = $1', [userId]);
  return result[0] as User | null;
}

export async function createUser(email: string, name: string): Promise<User> {
  const sql = getDb();
  const result = await sql(
    'INSERT INTO users (email, name) VALUES ($1, $2) RETURNING *',
    [email, name]
  );
  return result[0] as User;
}

// Broker connection operations
export async function saveBrokerConnection(
  userId: string,
  brokerType: string,
  name: string,
  isDemo: boolean,
  encryptedCredentials: string
): Promise<BrokerConnection> {
  const sql = getDb();
  const result = await sql(
    `INSERT INTO broker_connections (user_id, broker_type, name, is_demo, credentials_encrypted)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [userId, brokerType, name, isDemo, encryptedCredentials]
  );
  return result[0] as BrokerConnection;
}

export async function getBrokerConnections(userId: string): Promise<BrokerConnection[]> {
  const sql = getDb();
  const result = await sql(
    'SELECT * FROM broker_connections WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  return result as BrokerConnection[];
}

// Trade operations
export async function saveTrade(trade: Omit<Trade, 'id' | 'created_at'>): Promise<Trade> {
  const sql = getDb();
  const result = await sql(
    `INSERT INTO trades (user_id, broker_connection_id, external_trade_id, symbol, type, volume,
     open_price, close_price, stop_loss, take_profit, open_time, close_time, profit, commission,
     swap, status, comment)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING *`,
    [
      trade.user_id, trade.broker_connection_id, trade.external_trade_id, trade.symbol,
      trade.type, trade.volume, trade.open_price, trade.close_price, trade.stop_loss,
      trade.take_profit, trade.open_time, trade.close_time, trade.profit, trade.commission,
      trade.swap, trade.status, trade.comment
    ]
  );
  return result[0] as Trade;
}

export async function getTrades(userId: string, limit = 100): Promise<Trade[]> {
  const sql = getDb();
  const result = await sql(
    'SELECT * FROM trades WHERE user_id = $1 ORDER BY open_time DESC LIMIT $2',
    [userId, limit]
  );
  return result as Trade[];
}

// Performance operations
export async function savePerformanceRecord(
  record: Omit<PerformanceRecord, 'id' | 'created_at'>
): Promise<PerformanceRecord> {
  const sql = getDb();
  const result = await sql(
    `INSERT INTO performance_records (user_id, date, total_pnl, daily_pnl, win_count,
     loss_count, total_trades, win_rate)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (user_id, date) DO UPDATE SET
       total_pnl = EXCLUDED.total_pnl,
       daily_pnl = EXCLUDED.daily_pnl,
       win_count = EXCLUDED.win_count,
       loss_count = EXCLUDED.loss_count,
       total_trades = EXCLUDED.total_trades,
       win_rate = EXCLUDED.win_rate
     RETURNING *`,
    [
      record.user_id, record.date, record.total_pnl, record.daily_pnl, record.win_count,
      record.loss_count, record.total_trades, record.win_rate
    ]
  );
  return result[0] as PerformanceRecord;
}

export async function getPerformanceHistory(
  userId: string,
  days = 30
): Promise<PerformanceRecord[]> {
  const sql = getDb();
  const result = await sql(
    `SELECT * FROM performance_records 
     WHERE user_id = $1 AND date >= CURRENT_DATE - INTERVAL '${days} days'
     ORDER BY date DESC`,
    [userId]
  );
  return result as PerformanceRecord[];
}
