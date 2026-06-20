#!/usr/bin/env node
// Convert EVERY base table in the DB to utf8mb4 / utf8mb4_unicode_ci.
// Migration 013 only covered the schema.sql tables, leaving runtime-created
// tables (journal_entries, payroll_*, etc.) on the MariaDB default
// (utf8mb4_uca1400_ai_ci) — which makes cross-table string JOINs throw
// "Illegal mix of collations". This converts whatever is left, dynamically.
// Idempotent (already-unified tables are skipped) + resilient to a flaky tunnel.
//
// Usage: node tools/fix-all-collations.mjs [--dry-run]
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiRequire = createRequire(join(ROOT, 'api', 'package.json'));
apiRequire('dotenv').config({ path: join(ROOT, 'api', '.env') });
const mysql = apiRequire('mysql2/promise');
const fs = apiRequire('fs');

const env = {};
for (const l of fs.readFileSync(join(ROOT, 'api', '.env'), 'utf8').split('\n')) {
  const m = l.trim().match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const conf = { host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, connectTimeout: 20000 };
const DRY = process.argv.includes('--dry-run');
const TARGET = 'utf8mb4_unicode_ci';
const RECONNECT = new Set(['PROTOCOL_CONNECTION_LOST', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE']);

let conn;
async function connect() {
  for (let i = 0; i < 10; i++) {
    try { conn = await mysql.createConnection(conf); return; }
    catch (e) { process.stdout.write(`  …connect retry ${i + 1} (${e.code})\n`); await new Promise(r => setTimeout(r, 3000)); }
  }
  throw new Error('no DB connection');
}
async function q(sql, params) {
  for (let a = 0; a < 8; a++) {
    try { return await conn.query(sql, params); }
    catch (e) {
      if (RECONNECT.has(e.code)) { try { await conn.end(); } catch {} await connect(); await conn.query('SET FOREIGN_KEY_CHECKS=0').catch(() => {}); continue; }
      throw e;
    }
  }
  throw new Error('query failed after reconnects');
}

await connect();
await q('SET FOREIGN_KEY_CHECKS=0');
const [tables] = await q(
  `SELECT table_name AS t, table_collation AS c FROM information_schema.tables
   WHERE table_schema=? AND table_type='BASE TABLE' AND table_collation <> ? ORDER BY table_name`,
  [env.DB_NAME, TARGET]
);
console.log(`${DRY ? '[dry-run] ' : ''}tables not yet ${TARGET}: ${tables.length}`);
let done = 0;
for (const { t, c } of tables) {
  console.log(`  ${DRY ? '[would] ' : ''}${t}  (${c} → ${TARGET})`);
  if (DRY) continue;
  try { await q(`ALTER TABLE \`${t}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE ${TARGET}`); done++; }
  catch (e) { console.log(`    ! ${t}: ${e.message}`); }
}
await q('SET FOREIGN_KEY_CHECKS=1');
console.log(`\nDone — converted ${done}/${tables.length} tables.`);
await conn.end();
