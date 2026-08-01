#!/usr/bin/env node
/**
 * schema-source-drift.mjs
 *
 * Guards the invariant that api/schema.sql is a faithful snapshot of what the
 * migrations actually build. If it drifts, creating a NEW environment from
 * schema.sql produces a structurally incomplete database — tables/columns the
 * code expects simply aren't there — while existing environments (built by
 * replaying migrations) are fine. That asymmetry is how a fresh staging/prod
 * build silently comes up broken.
 *
 * Approach (static, no DB needed): replay every migration in numeric filename
 * order, tracking CREATE TABLE / DROP TABLE / RENAME and ALTER TABLE ADD|DROP
 * COLUMN, to derive the expected (table -> columns) set. Then diff that against
 * what api/schema.sql declares.
 *
 * Usage:
 *   node tools/schema-source-drift.mjs            # summary + exit code
 *   node tools/schema-source-drift.mjs --list     # full per-table detail
 *   node tools/schema-source-drift.mjs --json     # machine-readable
 *
 * Exit 0 when schema.sql covers everything the migrations build; 1 otherwise.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const MIG_DIR = join(ROOT, 'api/migrations');
const SCHEMA = join(ROOT, 'api/schema.sql');

const norm = (s) => String(s || '').replace(/[`"']/g, '').trim().toLowerCase();

/** Strip SQL comments so they can't be mistaken for statements. */
function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/(^|\s)--\s.*$/, '').replace(/^\s*--.*$/, ''))
    .join('\n');
}

/**
 * Split a CREATE TABLE body into top-level column/constraint clauses,
 * respecting nested parens (e.g. decimal(10,2), enum('a','b')).
 */
function splitTopLevel(body) {
  const parts = [];
  let depth = 0, cur = '', quote = null;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    // Inside a string literal nothing is structural. Without this a comma in a
    // COMMENT ('queued, sent, or skipped') splits the clause and the fragments
    // are then read as column names — the scanner reported phantom columns
    // called "or" and "as", and the drift gate failed on a correct migration.
    if (quote) {
      cur += ch;
      if (ch === '\\') { cur += body[++i] ?? ''; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; cur += ch; continue; }
    if (ch === '(') { depth++; cur += ch; continue; }
    if (ch === ')') { depth--; cur += ch; continue; }
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

const NON_COLUMN = /^(primary\s+key|unique\b|key\b|index\b|constraint\b|foreign\s+key|fulltext\b|spatial\b|check\b)/i;

/** Extract column names from a CREATE TABLE (...) body. */
function columnsFromBody(body) {
  const cols = new Set();
  for (const clause of splitTopLevel(body)) {
    const c = clause.trim();
    if (!c || NON_COLUMN.test(c)) continue;
    const m = c.match(/^[`"']?([A-Za-z0-9_]+)[`"']?\s+/);
    if (m) cols.add(norm(m[1]));
  }
  return cols;
}

/** Find each CREATE TABLE and return [{ table, body }] using paren matching. */
function parseCreateTables(sql) {
  const out = [];
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?([A-Za-z0-9_]+)[`"']?\s*\(/gi;
  let m;
  while ((m = re.exec(sql))) {
    let depth = 0, i = re.lastIndex - 1, start = -1;
    for (; i < sql.length; i++) {
      if (sql[i] === '(') { if (depth === 0) start = i; depth++; }
      else if (sql[i] === ')') { depth--; if (depth === 0) break; }
    }
    if (start >= 0 && i < sql.length) out.push({ table: norm(m[1]), body: sql.slice(start + 1, i) });
  }
  return out;
}

// Migrations at or below this number are BASELINED by lib/migrationRunner.js on
// a fresh build: recorded as already-applied WITHOUT being executed, on the
// assumption that schema.sql already contains everything they create. Anything
// they build that schema.sql is missing therefore never gets created in a new
// environment — that is the critical class, as opposed to post-baseline drift
// which self-heals because the migration still runs.
const BASELINE_MAX = 33;

// ── 1. Expected schema, derived by replaying migrations in order ─────────────
const expected = new Map(); // table -> Set(columns)
const originTable = new Map();  // table -> first migration number that creates it
const originColumn = new Map(); // "table.col" -> first migration number that adds it
// Tables only ever seen in an ALTER: nothing creates them, so they are stale
// references to a name that doesn't exist (migration 007 ALTERs `lectures` and
// `tickets`; the real tables are course_lectures and support_tickets).
const alterOnly = new Set();
// Tables defined as CREATE TABLE x LIKE y — structure copies with no DDL of
// their own to mirror.
const derivedTables = new Set();
const migFiles = readdirSync(MIG_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort((a, b) => {
    const na = parseInt((a.match(/^(\d+)/) || [])[1] ?? '999999', 10);
    const nb = parseInt((b.match(/^(\d+)/) || [])[1] ?? '999999', 10);
    return na - nb || a.localeCompare(b);
  });

for (const file of migFiles) {
  const sql = stripComments(readFileSync(join(MIG_DIR, file), 'utf8'));
  const migNo = parseInt((file.match(/^(\d+)/) || [])[1] ?? '999999', 10);
  const noteTable = (t) => { if (!originTable.has(t)) originTable.set(t, migNo); };
  const noteCol = (t, c) => { const k = `${t}.${c}`; if (!originColumn.has(k)) originColumn.set(k, migNo); };

  for (const { table, body } of parseCreateTables(sql)) {
    if (!expected.has(table)) expected.set(table, new Set());
    noteTable(table);
    for (const c of columnsFromBody(body)) { expected.get(table).add(c); noteCol(table, c); }
  }

  // CREATE TABLE x LIKE y — the structure is a copy of another table, so there
  // is no DDL to mirror into schema.sql. These migrations run on a fresh build
  // and recreate the copy from whatever the parent looks like then; duplicating
  // the parent's columns into the snapshot would only drift from it.
  const likeRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?([A-Za-z0-9_]+)[`"']?\s+LIKE\s+[`"']?([A-Za-z0-9_]+)[`"']?/gi;
  let lk;
  while ((lk = likeRe.exec(sql))) derivedTables.add(norm(lk[1]));

  // ALTER TABLE [IF EXISTS] <t> ADD [COLUMN] [IF NOT EXISTS] <col>
  const addRe = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?[`"']?([A-Za-z0-9_]+)[`"']?\s+ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?[`"']?([A-Za-z0-9_]+)[`"']?/gi;
  let a;
  while ((a = addRe.exec(sql))) {
    const t = norm(a[1]), c = norm(a[2]);
    if (NON_COLUMN.test(c)) continue;           // ADD INDEX/KEY/CONSTRAINT
    if (!expected.has(t)) { expected.set(t, new Set()); noteTable(t); alterOnly.add(t); }
    expected.get(t).add(c);
    noteCol(t, c);
  }

  // ALTER TABLE [IF EXISTS] <t> DROP [COLUMN] [IF EXISTS] <col>
  const dropColRe = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?[`"']?([A-Za-z0-9_]+)[`"']?\s+DROP\s+(?:COLUMN\s+)?(?:IF\s+EXISTS\s+)?[`"']?([A-Za-z0-9_]+)[`"']?/gi;
  let d;
  while ((d = dropColRe.exec(sql))) {
    const t = norm(d[1]), c = norm(d[2]);
    if (expected.has(t)) expected.get(t).delete(c);
  }

  // DROP TABLE [IF EXISTS] <t>[, <t2>...]
  const dropTblRe = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^;]+);/gi;
  let dt;
  while ((dt = dropTblRe.exec(sql))) {
    for (const raw of dt[1].split(',')) {
      const t = norm(raw);
      if (t) expected.delete(t);
    }
  }

  // RENAME TABLE a TO b  /  ALTER TABLE a RENAME TO b
  const renRe = /(?:RENAME\s+TABLE\s+[`"']?([A-Za-z0-9_]+)[`"']?\s+TO\s+[`"']?([A-Za-z0-9_]+)[`"']?|ALTER\s+TABLE\s+[`"']?([A-Za-z0-9_]+)[`"']?\s+RENAME\s+(?:TO\s+)?[`"']?([A-Za-z0-9_]+)[`"']?)/gi;
  let r;
  while ((r = renRe.exec(sql))) {
    const from = norm(r[1] || r[3]), to = norm(r[2] || r[4]);
    if (from && to && expected.has(from)) {
      expected.set(to, new Set([...expected.get(from), ...(expected.get(to) || [])]));
      expected.delete(from);
    }
  }
}

// ── 2. What schema.sql actually declares ────────────────────────────────────
const actual = new Map();
for (const { table, body } of parseCreateTables(stripComments(readFileSync(SCHEMA, 'utf8')))) {
  if (!actual.has(table)) actual.set(table, new Set());
  for (const c of columnsFromBody(body)) actual.get(table).add(c);
}

// ── 3. Diff ─────────────────────────────────────────────────────────────────
// A table is only genuinely missing if something actually CREATEs it with its
// own DDL. Excluded:
//  - alterOnly: never created, so the ALTER targets a name that doesn't exist
//    and schema.sql is right not to declare it.
//  - derivedTables: CREATE TABLE ... LIKE parent — the migration rebuilds the
//    copy on a fresh database, and copying the parent's columns into the
//    snapshot would just drift from the parent.
const missingTables = [...expected.keys()]
  .filter((t) => !actual.has(t) && !alterOnly.has(t) && !derivedTables.has(t))
  .sort();
const extraTables = [...actual.keys()].filter((t) => !expected.has(t)).sort();
const missingColumns = []; // { table, columns[] }
for (const [t, cols] of expected) {
  if (!actual.has(t)) continue;
  const miss = [...cols].filter((c) => !actual.get(t).has(c)).sort();
  if (miss.length) missingColumns.push({ table: t, columns: miss });
}
missingColumns.sort((a, b) => b.columns.length - a.columns.length || a.table.localeCompare(b.table));
const missingColumnCount = missingColumns.reduce((n, r) => n + r.columns.length, 0);

// Split by whether the creating migration is baselined (skipped on a fresh
// build) — those are the ones a new environment would never get.
const critTables = missingTables.filter((t) => (originTable.get(t) ?? 1e9) <= BASELINE_MAX);
const critColumns = [];
for (const { table, columns } of missingColumns) {
  const cols = columns.filter((c) => (originColumn.get(`${table}.${c}`) ?? 1e9) <= BASELINE_MAX);
  if (cols.length) critColumns.push({ table, columns: cols });
}
const critColumnCount = critColumns.reduce((n, r) => n + r.columns.length, 0);
const withOrigin = (t) => `${t}  (from migration ${String(originTable.get(t) ?? '?').padStart(3, '0')})`;

export function scanSchemaSourceDrift() {
  return {
    expectedTables: expected.size,
    schemaTables: actual.size,
    missingTables,
    extraTables,
    missingColumnCount,
    missingColumns,
    criticalTables: critTables,
    criticalColumnCount: critColumnCount,
    criticalColumns: critColumns,
  };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').replace(/^([A-Z]):/i, ''));
if (!isMain) {
  // imported as a module — skip the CLI report/exit below
} else if (process.argv.includes('--json')) {
  console.log(JSON.stringify({
    expectedTables: expected.size,
    schemaTables: actual.size,
    missingTables,
    extraTables,
    missingColumnCount,
    missingColumns,
  }, null, 2));
} else {
  console.log(`Tables built by migrations : ${expected.size}`);
  console.log(`Tables declared in schema  : ${actual.size}`);
  console.log(`Tables MISSING from schema : ${missingTables.length}`);
  console.log(`Columns MISSING from schema: ${missingColumnCount} (across ${missingColumns.length} tables)`);
  if (extraTables.length) console.log(`Tables only in schema.sql  : ${extraTables.length} (legacy//manual — review)`);
  console.log('');
  console.log(`CRITICAL (built by baselined migrations <= ${BASELINE_MAX}, so a fresh`);
  console.log(`build NEVER creates them): ${critTables.length} table(s), ${critColumnCount} column(s)`);
  if (critTables.length) for (const t of critTables) console.log(`   ! ${withOrigin(t)}`);
  if (critColumns.length) for (const { table, columns } of critColumns) console.log(`   ! ${table}: ${columns.join(', ')}`);
  if (process.argv.includes('--list')) {
    if (missingTables.length) {
      console.log('\n── Missing tables ──');
      for (const t of missingTables) console.log(`  ${withOrigin(t)}`);
    }
    if (missingColumns.length) {
      console.log('\n── Missing columns ──');
      for (const { table, columns } of missingColumns) console.log(`  ${table}: ${columns.join(', ')}`);
    }
    if (extraTables.length) {
      console.log('\n── Only in schema.sql ──');
      for (const t of extraTables) console.log(`  ${t}`);
    }
  } else if (missingTables.length || missingColumnCount) {
    console.log('\nRun with --list for detail.');
  }
}

if (isMain) process.exit(missingTables.length || missingColumnCount ? 1 : 0);
