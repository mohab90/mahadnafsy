#!/usr/bin/env node
// Backfill crm_json → relational tables (Top20 #12 / supports #6).
// Reads subscribers.crm_json.installmentPlans and writes them into the
// installment_plans / installment_entries tables (migration 014). Idempotent:
// uses INSERT IGNORE keyed on the original plan/entry ids.
//
// Usage:  node tools/backfill-crm-json.mjs [--dry-run]
// Reads DB creds from api/.env (same parser as run-migrations.mjs).
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createConnection } from 'mysql2/promise';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
const DRY = process.argv.includes('--dry-run');

function parseEnv(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.trim().match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

const env = parseEnv(join(ROOT, 'api', '.env'));
const conn = await createConnection({
  host: env.DB_HOST || '127.0.0.1', port: +(env.DB_PORT || 3306),
  user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME,
});

const [subs] = await conn.query(
  "SELECT id, tenant_id, crm_json FROM subscribers WHERE crm_json LIKE '%installmentPlans%'"
);
let plans = 0, entries = 0;
for (const s of subs) {
  let crm = {};
  try { crm = typeof s.crm_json === 'string' ? JSON.parse(s.crm_json) : (s.crm_json || {}); } catch { continue; }
  for (const p of (crm.installmentPlans || [])) {
    if (!p.id) continue;
    plans++;
    if (!DRY) {
      await conn.query(
        `INSERT IGNORE INTO installment_plans (id, tenant_id, subscriber_id, course_id, bundle_id, total_amount, currency, status)
         VALUES (?,?,?,?,?,?,?,?)`,
        [p.id, s.tenant_id || 'mahad', s.id, p.courseId || null, p.bundleId || null,
         Number(p.total || p.totalAmount || 0), p.currency || 'EGP', p.status || 'active']
      );
    }
    for (const e of (p.entries || p.schedule || [])) {
      if (!e.id) continue;
      entries++;
      if (!DRY) {
        await conn.query(
          `INSERT IGNORE INTO installment_entries (id, plan_id, tenant_id, due_date, amount, paid, paid_at, payment_id)
           VALUES (?,?,?,?,?,?,?,?)`,
          [e.id, p.id, s.tenant_id || 'mahad', e.dueDate || null, Number(e.amount || 0),
           e.paid ? 1 : 0, e.paidAt || null, e.paymentId || null]
        );
      }
    }
  }
}
console.log(`${DRY ? '[dry-run] ' : ''}backfill: ${subs.length} subscribers, ${plans} plans, ${entries} entries`);
await conn.end();
