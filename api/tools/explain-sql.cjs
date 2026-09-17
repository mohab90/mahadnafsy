#!/usr/bin/env node
'use strict';

/**
 * Parse every SQL statement in the API against the real schema.
 *
 * Unit tests read SQL as text. `EXPLAIN` hands it to the database, which
 * resolves every table and column and rejects anything it cannot run — without
 * executing it. That is the difference between "the query looks right" and "the
 * query works", and it is the check nothing had ever run here: the first pass
 * over the 41 files one release touched found four statements MariaDB refuses,
 * two of which were breaking admin screens in production.
 *
 *   node tools/explain-sql.cjs                 # every SELECT in api/
 *   node tools/explain-sql.cjs --changed 1ca54e6   # only what differs from a git ref
 *   node tools/explain-sql.cjs --verbose       # print each failing statement
 *
 * Reads the .env beside it, so it runs where the database is. EXPLAIN only —
 * nothing is executed, and the session is read-only.
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

/**
 * Parameters and interpolated fragments become something the parser accepts.
 * A fragment in a boolean position becomes `1=1`; one being selected becomes
 * NULL; a trailing optional fragment simply goes.
 */
function explainable(sql) {
  let s = sql.replace(/\\`/g, '`');
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
  s = s.replace(/LIMIT\s+\?/gi, 'LIMIT 1').replace(/OFFSET\s+\?/gi, 'OFFSET 0').replace(/INTERVAL\s+\?/gi, 'INTERVAL 1');
  s = s.replace(/\?/g, 'NULL');
  // A plan, never a lock — and both words of the clause go together.
  return s.replace(/\bFOR\s+UPDATE(\s+SKIP\s+LOCKED|\s+NOWAIT)?/gi, '').replace(/\bLOCK\s+IN\s+SHARE\s+MODE\b/gi, '');
}

/** A statement whose table name is built in JS cannot be checked against a schema. */
const tableIsInterpolated = sql => /\b(?:FROM|JOIN|INTO|UPDATE)\s+`?\$\{/i.test(sql);

function collect() {
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
      if (!isSelect(lit.text)) continue;
      if (tableIsInterpolated(lit.text)) { skipped.push(path.basename(file)); continue; }
      statements.push({
        where: `${path.relative(path.join(API_ROOT, '..'), file).split(path.sep).join('/')}:${src.slice(0, lit.start).split('\n').length}`,
        sql: explainable(lit.text),
      });
    }
  }
  return { files: files.length, statements, skipped };
}

// ── running them ───────────────────────────────────────────────────────────

(async () => {
  const { files, statements, skipped } = collect();
  const db = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  });
  await db.query('SET SESSION TRANSACTION READ ONLY');

  const failures = [];
  for (const statement of statements) {
    try { await db.query('EXPLAIN ' + statement.sql); }
    catch (error) { failures.push({ ...statement, error: error.message }); }
  }
  await db.end();

  console.log(`${statements.length - failures.length}/${statements.length} statements parse against ${process.env.DB_NAME} (${files} files)`);
  if (skipped.length) console.log(`  ${skipped.length} skipped — the table name itself is built in JS`);
  for (const f of failures) {
    console.log(`\n  FAIL ${f.where}\n    ${f.error}`);
    if (VERBOSE) console.log(`    ${f.sql.replace(/\s+/g, ' ').slice(0, 400)}`);
  }
  if (failures.length) {
    console.log(`\n${failures.length} failing. Some are this tool's own substitutions rather than real faults —`);
    console.log('a fragment it could not stand in for. Read each one before believing it.');
  }
  process.exit(failures.length ? 1 : 0);
})().catch(error => { console.error('explain-sql: ' + error.message); process.exit(2); });
