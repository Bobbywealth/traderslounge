// Run schema migrations on boot. Idempotent and opt-in.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function isEnabled() {
  return process.env.BILLING_RUN_MIGRATIONS === '1' || process.env.BILLING_RUN_MIGRATIONS === 'true';
}

export async function runMigrationsOnce() {
  if (!isEnabled()) return { skipped: true };
  const pool = getPool();
  const migrationsDir = path.resolve(__dirname, '../../db/migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  const applied = [];
  for (const file of files) {
    const fullPath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(fullPath, 'utf8');
    try {
      await pool.query(sql);
      applied.push(file);
    } catch (err) {
      console.error(`[billing] migration failed: ${file}`, err.message);
      throw err;
    }
  }
  return { skipped: false, applied };
}
