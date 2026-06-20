#!/usr/bin/env node
// Normalise installment schedules → installment_entries (Top20 #12).
// Source of truth is the EXISTING installment_plans table, whose schedule lives
// in JSON arrays (installment_amounts / due_dates / paid_dates). This explodes
// each plan into one installment_entries row per installment. Idempotent via the
// (plan_id, seq) unique key.
//
// Usage:  node tools/backfill-crm-json.mjs [--dry-run]
// Reads DB creds from api/.env (same parser as run-migrations.mjs).
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
const DRY = process.argv.includes('--dry-run');
const apiRequire = createRequire(join(ROOT, 'api', 'package.json'));
const { createConnection } = apiRequire('mysql2/promise');

function parseEnv(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.trim().match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}
const toArr = (v) => { try { return Array.isArray(v) ? v : JSON.parse(v || '[]'); } catch { return []; } };

const env = parseEnv(join(ROOT, 'api', '.env'));
const conn = await createConnection({
  host: env.DB_HOST || '127.0.0.1', port: +(env.DB_PORT || 3306),
  user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME,
});

const [plans] = await conn.query(
  'SELECT id, subscriber_id, installment_amounts, due_dates, paid_dates FROM installment_plans'
);
let entries = 0;
for (const p of plans) {
  const amounts = toArr(p.installment_amounts);
  const dues = toArr(p.due_dates);
  const paids = toArr(p.paid_dates); // array of paid dates (or nulls) per installment
  for (let i = 0; i < amounts.length; i++) {
    const paidAt = paids[i] || null;
    entries++;
    if (!DRY) {
      await conn.query(
        `INSERT INTO installment_entries (id, plan_id, seq, due_date, amount, paid, paid_at)
         VALUES (?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE due_date=VALUES(due_date), amount=VALUES(amount),
           paid=VALUES(paid), paid_at=VALUES(paid_at)`,
        [`${p.id}-${i}`, p.id, i, dues[i] || null, Number(amounts[i]) || 0, paidAt ? 1 : 0, paidAt]
      );
    }
  }
}
console.log(`${DRY ? '[dry-run] ' : ''}normalised ${plans.length} plans → ${entries} installment_entries`);
await conn.end();
