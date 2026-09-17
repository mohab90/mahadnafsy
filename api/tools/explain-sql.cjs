#!/usr/bin/env node
'use strict';

/**
 * Parse every SQL statement in the API against the real schema.
 *
 * Unit tests read SQL as text. The database resolves every table and column and
 * rejects anything it cannot run — without executing it. That is the difference
 * between "the query looks right" and "the query works", and it is the check
 * nothing had ever run here: the first pass over the 41 files one release
 * touched found four statements MariaDB refuses, two of which were breaking
 * admin screens in production.
 *
 * Reads are checked with EXPLAIN. Writes are checked with PREPARE, which
 * resolves the same names and executes nothing — `PREPARE … 'DELETE FROM
 * payments'` leaves the table exactly as it was. They need the two different
 * verbs because MariaDB refuses a write in a read-only transaction before it
 * ever looks at the statement, so the writes run on a second connection inside
 * a transaction that is rolled back either way. Nothing but PREPARE and
 * DEALLOCATE is ever sent there — there is no EXECUTE in this file, and the
 * test pins that.
 *
 * Writes were the blind spot worth closing: this API has 785 of them, and the
 * two worst faults of the audit were both writes — an UPDATE naming
 * leads.crm_data, a column the table lost, and an INSERT that collided on a
 * unique index and dropped a paid customer on the floor.
 *
 *   node tools/explain-sql.cjs                 # every statement in api/
 *   node tools/explain-sql.cjs --changed 1ca54e6   # only what differs from a git ref
 *   node tools/explain-sql.cjs --verbose       # print each failing statement
 *
 * Reads the .env beside it, so it runs where the database is.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const API_ROOT = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(API_ROOT, '.env') });
const mysql = require('mysql2/promise');

const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose');
const changedAt = args.indexOf('--changed');
const CHANGED_REF = changedAt >= 0 ? args[changedAt + 1] : null;
const ignoreAt = args.indexOf('--ignore');
const IGNORED = ignoreAt >= 0 ? String(args[ignoreAt + 1] || '').split(',').map(s2 => s2.trim()).filter(Boolean) : [];

// ── collecting statements ──────────────────────────────────────────────────

function jsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'tests', '.git', 'migrations'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFiles(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/** Spans of every string literal, so a query is read whole rather than guessed at. */
function literals(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (ch === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i); if (i < 0) break; i += 2; continue; }
    if (ch === '`' || ch === "'" || ch === '"') {
      const start = i; i++;
      let depth = 0;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (ch === '`' && src[i] === '$' && src[i + 1] === '{') { depth++; i += 2; continue; }
        if (ch === '`' && depth > 0 && src[i] === '}') { depth--; i++; continue; }
        if (src[i] === ch && depth === 0) break;
        if (ch !== '`' && src[i] === '\n') break;
        i++;
      }
      out.push({ start, text: src.slice(start + 1, i) });
      i++; continue;
    }
    i++;
  }
  return out;
}

const isSelect = text => /^\s*(?:--[^\n]*\n\s*)*SELECT\b[\s\S]*\bFROM\b/i.test(text);

// A write, not the word: "DELETE" in a message is not a statement, so each one
// has to reach the clause that names its table.
const isWrite = text => /^\s*(?:--[^\n]*\n\s*)*(?:(?:INSERT|REPLACE)\s+(?:IGNORE\s+|LOW_PRIORITY\s+|HIGH_PRIORITY\s+|DELAYED\s+)*INTO\s|UPDATE\s[\s\S]*\bSET\b|DELETE\s[\s\S]*\bFROM\b)/i.test(text);

/**
 * A write carries its fragments where a read never does: the SET list and the
 * VALUES rows. Blanking those leaves `SET  WHERE`, which the parser refuses for
 * a reason that says nothing about the query — and the whole statement, table
 * and WHERE included, would go unchecked behind that complaint. Standing a real
 * column of the real table in their place keeps the rest answerable.
 */
function fillWriteFragments(sql, schema) {
  let s = sql;
  const columnsOf = table => schema.get(String(table).toLowerCase()) || [];

  // `SET branch = CASE id ${whens} END` — the fragment is the whole expression,
  // so the expression goes, and the column being assigned stays checkable.
  s = s.replace(/\bCASE\b[\s\S]{0,120}?\$\{[^}]*\}[\s\S]{0,40}?\bEND\b/gi, 'NULL');

  // UPDATE <table> [alias] [joins] SET ${fields} — qualified by the alias, so a
  // multi-table update does not turn the stand-in into an ambiguous column.
  const update = /^\s*UPDATE\s+`?(\w+)`?(?:\s+(?:AS\s+)?(?!SET\b|JOIN\b|LEFT\b|RIGHT\b|INNER\b|CROSS\b|STRAIGHT_JOIN\b)`?(\w+)`?)?/i.exec(s);
  if (update) {
    const [, table, alias] = update;
    const column = columnsOf(table)[0];
    if (column) s = s.replace(/\bSET\s+\$\{[^}]*\}/i, `SET \`${alias || table}\`.\`${column}\`=NULL`);
  }

  // INSERT INTO <table> (a, b, c) VALUES ${rows} — one row of NULLs, as wide as
  // the column list, which is what makes that column list checkable. `VALUES ?`
  // is the same thing in mysql2's hands: it expands one array of arrays into the
  // rows, so it too arrives at the server as tuples and not as a parameter.
  const insert = /\b(?:INTO|REPLACE)\s+`?(\w+)`?\s*(?:\(([^)]*)\))?/i.exec(s);
  if (insert) {
    const [, table, columnList] = insert;
    const arity = columnList ? columnList.split(',').length : columnsOf(table).length;
    if (arity) s = s.replace(/\bVALUES\s*(?:\$\{[^}]*\}|\?(?!\s*[,)]))/i, `VALUES (${Array(arity).fill('NULL').join(',')})`);
  }
  return s;
}

/**
 * Parameters and interpolated fragments become something the parser accepts.
 * A fragment in a boolean position becomes `1=1`; one being selected becomes
 * NULL; a trailing optional fragment simply goes.
 *
 * `placeholders` keeps `?` as itself: PREPARE takes parameters, so a write is
 * checked in the shape it is actually sent in.
 */
function explainable(sql, { placeholders = false } = {}) {
  let s = sql;
  // A fragment being compared to a parameter: `${column}=?`.
  s = s.replace(/\$\{[^}]*\}\s*(?:=|<>|!=|>=|<=|>|<)\s*\?/g, '1=1');
  s = s.replace(/\bNOT\s*\$\{[^}]*\}/gi, 'NOT 1=1');
  s = s.replace(/\b(WHERE|AND|OR|ON|HAVING)\s*\$\{[^}]*\}/gi, '$1 1=1');
  s = s.replace(/\(\s*\$\{[^}]*\}\s*\)/g, '(1=1)');
  s = s.replace(/IN\s*\(\s*\$\{[^}]*\}\s*\)/gi, 'IN (NULL)');
  s = s.replace(/\$\{[^}]*\}(\s+AS\b)/gi, 'NULL$1');
  s = s.replace(/\$\{[^}]*\?\s*'([^']*)'\s*:\s*''\s*\}/g, (m, fragment) => fragment);
  s = s.replace(/(ORDER\s+BY|GROUP\s+BY)\s*\$\{[^}]*\}/gi, '$1 1');
  // A selected column list: SELECT ${cols} FROM …, or SELECT ${cols}, x FROM …
  s = s.replace(/\bSELECT\s+\$\{[^}]*\}(\s*,)?/gi, (m, comma) => 'SELECT NULL' + (comma || ''));
  s = s.replace(/\$\{[^}]*\}/g, '');
  if (!placeholders) {
    s = s.replace(/LIMIT\s+\?/gi, 'LIMIT 1').replace(/OFFSET\s+\?/gi, 'OFFSET 0').replace(/INTERVAL\s+\?/gi, 'INTERVAL 1');
    s = s.replace(/\?/g, 'NULL');
  }
  // A plan, never a lock — and both words of the clause go together.
  return s.replace(/\bFOR\s+UPDATE(\s+SKIP\s+LOCKED|\s+NOWAIT)?/gi, '').replace(/\bLOCK\s+IN\s+SHARE\s+MODE\b/gi, '');
}

/** A statement whose table name is built in JS cannot be checked against a schema. */
const tableIsInterpolated = sql => /\b(?:FROM|JOIN|INTO|UPDATE)\s+`?\$\{/i.test(sql);

/**
 * Where the JS fragments sit decides how much the result can be trusted.
 *
 * A fragment in the select list or among the joins takes columns and tables
 * with it when this tool stands something else in its place, so the database
 * then reports columns missing that the real query has — that is the tool's
 * doing, not a fault. A fragment in WHERE or HAVING removes a condition and
 * nothing else, so a missing column there is the query's own.
 *
 * A write splits the same way, at the same word: everything before WHERE is
 * structure, and what fillWriteFragments could stand in for is no longer there
 * to count.
 */
function interpolationIsStructural(sql) {
  const from = sql.search(/\bFROM\b/i);
  const where = sql.search(/\bWHERE\b/i);
  const head = sql.slice(0, where > from ? where : sql.length);   // select list + joins, or table + SET
  return head.includes('${');
}

function collect(schema) {
  let files = jsFiles(API_ROOT);
  if (CHANGED_REF) {
    const changed = execSync(`git diff --name-only ${CHANGED_REF}..HEAD -- api`, { encoding: 'utf8', cwd: path.join(API_ROOT, '..') })
      .split('\n').map(f => f.trim()).filter(Boolean).map(f => path.join(API_ROOT, '..', f));
    files = files.filter(f => changed.includes(f));
  }
  const statements = [];
  const skipped = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const lit of literals(src)) {
      // A quote escaped for JavaScript is not escaped for SQL: `COALESCE(x, \'\')`
      // reaches the parser as a backslash and stops it — five statements read as
      // broken that were never broken. Unescaping first also lets the checks
      // below see `FROM \`${table}\`` for what it is.
      const text = lit.text.replace(/\\(['"`])/g, '$1');
      const kind = isSelect(text) ? 'read' : isWrite(text) ? 'write' : null;
      if (!kind) continue;
      if (IGNORED.includes(path.basename(file))) continue;
      if (tableIsInterpolated(text)) { skipped.push(path.basename(file)); continue; }
      const filled = kind === 'write' ? fillWriteFragments(text, schema) : text;
      statements.push({
        kind,
        where: `${path.relative(path.join(API_ROOT, '..'), file).split(path.sep).join('/')}:${src.slice(0, lit.start).split('\n').length}`,
        sql: explainable(filled, { placeholders: kind === 'write' }),
        // A statement assembled from JS fragments cannot be fully reconstructed
        // here, so a *syntax* error on one says more about the substitution than
        // about the query. A missing column or table still counts: no
        // substitution invents those.
        assembled: text.includes('${'),
        structural: interpolationIsStructural(filled),
      });
    }
  }
  return { files: files.length, statements, skipped };
}

// ── running them ───────────────────────────────────────────────────────────

const connect = () => mysql.createConnection({
  host: process.env.DB_HOST, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
});

/** table → its columns in order, for standing in for a fragment. */
async function loadSchema(db) {
  const [rows] = await db.query(
    'SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION');
  const schema = new Map();
  for (const row of rows) {
    const table = String(row.t).toLowerCase();
    if (!schema.has(table)) schema.set(table, []);
    schema.get(table).push(row.c);
  }
  return schema;
}

(async () => {
  const db = await connect();
  await db.query('SET SESSION TRANSACTION READ ONLY');
  const { files, statements, skipped } = collect(await loadSchema(db));

  // The read-only session above refuses a write outright, so the writes get
  // their own connection — and a transaction around them, rolled back at the
  // end, as a second net under a verb that already changes nothing.
  const writeCount = statements.filter(s => s.kind === 'write').length;
  const writeDb = writeCount ? await connect() : null;
  if (writeDb) await writeDb.query('START TRANSACTION');

  const failures = [];
  const unverifiable = [];
  for (const statement of statements) {
    try {
      if (statement.kind === 'write') {
        await writeDb.query('PREPARE explain_sql_probe FROM ' + writeDb.escape(statement.sql));
        await writeDb.query('DEALLOCATE PREPARE explain_sql_probe');
      } else {
        await db.query('EXPLAIN ' + statement.sql);
      }
    } catch (error) {
      const syntax = /You have an error in your SQL syntax/i.test(error.message);
      const toolsOwnDoing = statement.assembled && (syntax || statement.structural);
      (toolsOwnDoing ? unverifiable : failures).push({ ...statement, error: error.message });
    }
  }
  if (writeDb) { await writeDb.query('ROLLBACK'); await writeDb.end(); }
  await db.end();

  const clean = statements.length - failures.length - unverifiable.length;
  console.log(`${clean}/${statements.length} statements parse against ${process.env.DB_NAME} (${files} files, ${writeCount} of them writes)`);
  if (skipped.length) console.log(`  ${skipped.length} skipped — the table name itself is built in JS`);
  if (unverifiable.length) {
    console.log(`  ${unverifiable.length} unverifiable — assembled from JS fragments this tool cannot stand in for`);
    if (VERBOSE) for (const u of unverifiable) console.log(`      ${u.where}`);
  }
  for (const f of failures) {
    console.log(`\n  FAIL ${f.where} (${f.kind})\n    ${f.error}`);
    if (VERBOSE) console.log(`    ${f.sql.replace(/\s+/g, ' ').slice(0, 400)}`);
  }
  if (failures.length) {
    console.log(`\n${failures.length} name a table or column the schema does not have. Those are real.`);
  }
  process.exit(failures.length ? 1 : 0);
})().catch(error => { console.error('explain-sql: ' + error.message); process.exit(2); });
