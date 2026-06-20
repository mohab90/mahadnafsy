#!/usr/bin/env node
// Convert the ledger tables' collation. They couldn't be converted in-place
// because journal_entry_lines.entry_id is part of FK fk_jel_entry → drop the FK,
// convert both tables, re-create the FK. Resilient to a flaky tunnel.
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
  const m = l.trim().match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const conf = { host: env.DB_HOST, port: +env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, connectTimeout: 20000 };
const RECONNECT = new Set(['PROTOCOL_CONNECTION_LOST', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE']);
const IGNORE = new Set([1091 /*FK doesn't exist*/, 1061 /*dup key*/, 1826 /*dup FK*/]);
let conn;
async function connect() { for (let i = 0; i < 10; i++) { try { conn = await mysql.createConnection(conf); return; } catch (e) { console.log('  retry', i + 1, e.code); await new Promise(r => setTimeout(r, 3000)); } } throw new Error('no conn'); }
async function q(sql) { for (let a = 0; a < 8; a++) { try { return await conn.query(sql); } catch (e) { if (IGNORE.has(e.errno)) { console.log('  (skip)', e.sqlMessage); return; } if (RECONNECT.has(e.code)) { try { await conn.end(); } catch {} await connect(); await conn.query('SET FOREIGN_KEY_CHECKS=0').catch(() => {}); continue; } throw e; } } }

await connect();
await q('SET FOREIGN_KEY_CHECKS=0');
const steps = [
  'ALTER TABLE journal_entry_lines DROP FOREIGN KEY fk_jel_entry',
  'ALTER TABLE journal_entries CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'ALTER TABLE journal_entry_lines CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'ALTER TABLE journal_entry_lines ADD CONSTRAINT fk_jel_entry FOREIGN KEY (entry_id) REFERENCES journal_entries (id) ON DELETE CASCADE',
];
for (const s of steps) { console.log('▶', s.slice(0, 70)); await q(s); }
await q('SET FOREIGN_KEY_CHECKS=1');
const [[je]] = await conn.query("SELECT table_collation c FROM information_schema.tables WHERE table_schema=? AND table_name='journal_entries'", [env.DB_NAME]);
const [[jel]] = await conn.query("SELECT table_collation c FROM information_schema.tables WHERE table_schema=? AND table_name='journal_entry_lines'", [env.DB_NAME]);
console.log(`Done — journal_entries=${je.c}, journal_entry_lines=${jel.c}`);
await conn.end();
