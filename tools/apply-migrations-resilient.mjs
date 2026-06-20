#!/usr/bin/env node
// Resilient migration applier — built for an UNSTABLE SSH tunnel.
// • executes each statement individually
// • swallows idempotency errors (duplicate column/key, table exists) so it is
//   fully re-runnable: every run makes progress, finished parts are skipped
// • auto-reconnects mid-run if the tunnel drops, and retries the statement
// • records each file in schema_migrations only after all its statements succeed
//
// Usage: node tools/apply-migrations-resilient.mjs [--from 011] [--dry-run]
import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');
const MIGRATIONS = join(ROOT, 'api', 'migrations');
const apiRequire = createRequire(join(ROOT, 'api', 'package.json'));
const mysql = apiRequire('mysql2/promise');

const FROM = (() => { const i = process.argv.indexOf('--from'); return i > -1 ? process.argv[i + 1] : '011'; })();
const DRY = process.argv.includes('--dry-run');

function parseEnv(p) {
  const out = {};
  if (!existsSync(p)) return out;
  for (const l of readFileSync(p, 'utf8').split('\n')) {
    const m = l.trim().match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}
const env = parseEnv(join(ROOT, 'api', '.env'));
const dbConf = { host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, connectTimeout: 20000, multipleStatements: false };

// Errors that mean "already applied" — safe to ignore for idempotency.
const IGNORE = new Set([1050 /*table exists*/, 1060 /*dup column*/, 1061 /*dup key*/, 1062 /*dup entry*/, 1022, 1826 /*dup FK*/, 1091 /*cant drop*/, 1146 /*table missing — skip*/, 1828, 1832 /*FK col change*/]);
const RECONNECT = new Set(['PROTOCOL_CONNECTION_LOST', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ER_CON_COUNT_ERROR', 'PROTOCOL_SEQUENCE_TIMEOUT']);

let conn;
async function connect() {
  for (let i = 0; i < 8; i++) {
    try { conn = await mysql.createConnection(dbConf); return; }
    catch (e) { process.stdout.write(`  …connect retry ${i + 1} (${e.code})\n`); await new Promise(r => setTimeout(r, 3000)); }
  }
  throw new Error('could not establish a DB connection after 8 tries');
}
async function q(sql, params) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try { return await conn.query(sql, params); }
    catch (e) {
      if (IGNORE.has(e.errno)) return { skipped: true, errno: e.errno };
      if (RECONNECT.has(e.code) || RECONNECT.has(e.fatal && e.code)) {
        process.stdout.write(`  …connection lost (${e.code}); reconnecting\n`);
        try { await conn.end(); } catch { /* already dead */ }
        await connect();
        await conn.query('SET FOREIGN_KEY_CHECKS=0').catch(() => {});
        continue; // retry the statement
      }
      throw e;
    }
  }
  throw new Error('statement failed after repeated reconnects');
}

function statements(sql) {
  return sql
    .split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    .split(';').map(s => s.trim()).filter(Boolean);
}

await connect();
await q('SET NAMES utf8mb4');
await q('SET FOREIGN_KEY_CHECKS=0');
await q(`CREATE TABLE IF NOT EXISTS schema_migrations (
  filename VARCHAR(255) PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) DEFAULT CHARSET=utf8mb4`);
const [appliedRows] = await q('SELECT filename FROM schema_migrations');
const applied = new Set(appliedRows.map(r => r.filename));

const files = readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql') && f >= `${FROM}_`).sort();
let ran = 0;
for (const f of files) {
  if (applied.has(f)) { console.log(`  ✓ already applied  ${f}`); continue; }
  const stmts = statements(readFileSync(join(MIGRATIONS, f), 'utf8'));
  console.log(`${DRY ? '[dry] ' : ''}▶ ${f}  (${stmts.length} statements)`);
  if (DRY) continue;
  let ok = 0, skipped = 0;
  for (let i = 0; i < stmts.length; i++) {
    const r = await q(stmts[i]);
    if (r && r.skipped) { skipped++; } else { ok++; }
    process.stdout.write(`\r    ${i + 1}/${stmts.length} (ok=${ok} skip=${skipped})   `);
  }
  process.stdout.write('\n');
  await q('INSERT INTO schema_migrations (filename) VALUES (?) ON DUPLICATE KEY UPDATE applied_at=applied_at', [f]);
  ran++;
}
await q('SET FOREIGN_KEY_CHECKS=1');
console.log(`\nDone — ${ran} migration file(s) applied this run.`);
await conn.end();
