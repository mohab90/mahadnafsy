'use strict';
/**
 * Does the live schema actually contain everything migrations 144-178 declare?
 *
 * Those migrations record a checksum that no longer matches their file, because
 * production was migrated from a different copy of them than the one in git.
 * Re-running is not an option: eight of them carry 18 data statements including
 * credit-note and financial-document backfills, which would double-apply.
 *
 * So before trusting the recorded state, check the schema directly: parse every
 * structural object the files declare and confirm each one exists in the live
 * database. This is a far wider check than the curated object list in
 * verify-migrations.cjs, and it is what decides whether the drift is cosmetic.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../lib/db');

const DIR = path.join(__dirname, '..', 'migrations');
const FROM = 144, TO = 178;

const files = fs.readdirSync(DIR)
  .filter(f => f.endsWith('.sql'))
  .filter(f => { const n = parseInt(f, 10); return n >= FROM && n <= TO; })
  .sort();

const want = { tables: new Set(), columns: new Set(), indexes: new Set() };

for (const f of files) {
  const sql = fs.readFileSync(path.join(DIR, f), 'utf8').replace(/--[^\n]*/g, '');
  for (const m of sql.matchAll(/CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+`?(\w+)`?/gi)) {
    want.tables.add(m[1].toLowerCase());
  }
  for (const m of sql.matchAll(/ALTER\s+TABLE\s+`?(\w+)`?([\s\S]*?);/gi)) {
    const table = m[1].toLowerCase();
    const body = m[2];
    for (const c of body.matchAll(/ADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?\s+`?(\w+)`?/gi)) {
      want.columns.add(`${table}.${c[1].toLowerCase()}`);
    }
    for (const i of body.matchAll(/ADD\s+(?:UNIQUE\s+)?(?:INDEX|KEY)(?:\s+IF\s+NOT\s+EXISTS)?\s+`?(\w+)`?/gi)) {
      want.indexes.add(`${table}.${i[1].toLowerCase()}`);
    }
  }
  for (const m of sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+`?(\w+)`?\s+ON\s+`?(\w+)`?/gi)) {
    want.indexes.add(`${m[2].toLowerCase()}.${m[1].toLowerCase()}`);
  }
}

(async () => {
  const [t] = await pool.query('SELECT LOWER(table_name) n FROM information_schema.tables WHERE table_schema=DATABASE()');
  const haveTables = new Set(t.map(r => r.n));
  const [c] = await pool.query('SELECT LOWER(table_name) t, LOWER(column_name) c FROM information_schema.columns WHERE table_schema=DATABASE()');
  const haveCols = new Set(c.map(r => `${r.t}.${r.c}`));
  const [i] = await pool.query('SELECT DISTINCT LOWER(table_name) t, LOWER(index_name) i FROM information_schema.statistics WHERE table_schema=DATABASE()');
  const haveIdx = new Set(i.map(r => `${r.t}.${r.i}`));

  const missing = { tables: [], columns: [], indexes: [] };
  for (const x of want.tables) if (!haveTables.has(x)) missing.tables.push(x);
  for (const x of want.columns) if (!haveCols.has(x)) missing.columns.push(x);
  for (const x of want.indexes) if (!haveIdx.has(x)) missing.indexes.push(x);

  console.log(`migrations scanned : ${files.length} (${FROM}-${TO})`);
  console.log(`declared objects   : ${want.tables.size} tables, ${want.columns.size} columns, ${want.indexes.size} indexes`);
  console.log(`missing tables     : ${missing.tables.length}${missing.tables.length ? ' -> ' + missing.tables.join(', ') : ''}`);
  console.log(`missing columns    : ${missing.columns.length}${missing.columns.length ? ' -> ' + missing.columns.join(', ') : ''}`);
  console.log(`missing indexes    : ${missing.indexes.length}${missing.indexes.length ? ' -> ' + missing.indexes.join(', ') : ''}`);
  const total = missing.tables.length + missing.columns.length + missing.indexes.length;
  console.log(total === 0
    ? '\nVERDICT: schema contains every object these files declare — the drift is in the recorded checksum only.'
    : `\nVERDICT: ${total} declared object(s) MISSING — do not re-record checksums, investigate first.`);
  await pool.end().catch(() => {});
  process.exit(total === 0 ? 0 : 1);
})().catch(async e => { console.error('ERR', e.message); await pool.end().catch(() => {}); process.exit(2); });
