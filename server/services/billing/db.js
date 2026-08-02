// Postgres pool wrapper for billing. Avoids stepping on the existing signal
// pool by exposing a separate, smaller pool. Both pools can share DATABASE_URL.

import pg from 'pg';

const { Pool } = pg;

let pool = null;

function ensurePool() {
  if (pool) return pool;
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for billing endpoints');
  }
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on('error', (err) => {
    console.error('[billing] unexpected pool error:', err.message);
  });
  return pool;
}

export function getPool() {
  return ensurePool();
}

export async function query(text, params) {
  const p = ensurePool();
  return p.query(text, params);
}

export async function withTransaction(fn) {
  const p = ensurePool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (pool) {
    await pool.end().catch(() => {});
    pool = null;
  }
}
