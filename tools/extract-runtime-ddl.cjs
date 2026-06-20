'use strict';
// Extracts all DDL (CREATE TABLE / ALTER TABLE / CREATE INDEX) embedded in
// api/lib/startupTasks.js template literals and string literals, and emits a
// consolidated idempotent migration file. One-off tool used to make
// migrations/ the schema source of truth instead of runtime DDL.
const fs = require('fs');
const path = require('path');

const API = path.join(__dirname, '..', 'api');
const OUT = path.join(API, 'migrations', '007_consolidated_runtime_schema.sql');

// Scan ALL api JS files — runtime DDL lives in lib/startupTasks.js AND inside
// several route files (refund_requests, payment_links, journal_entries, ...).
const srcFiles = [];
for (const dir of ['lib', 'routes', 'middleware', 'constants']) {
  for (const f of fs.readdirSync(path.join(API, dir))) {
    if (f.endsWith('.js')) srcFiles.push(path.join(API, dir, f));
  }
}
srcFiles.push(path.join(API, 'server.js'));
const src = srcFiles.map(f => fs.readFileSync(f, 'utf8')).join('\n;;FILE;;\n');

const statements = [];
const flagged = [];

// 1) Backtick template literals containing DDL (handles escaped \` inside)
const btRe = /`((?:\\[\s\S]|[^`\\])*)`/g;
let m;
while ((m = btRe.exec(src)) !== null) {
  let body = m[1];
  if (/^\s*(CREATE TABLE|ALTER TABLE|CREATE (UNIQUE )?INDEX)/i.test(body.trim())) {
    if (body.includes('${')) { flagged.push(body.trim()); continue; }
    // Unescape JS template-literal escapes: \` -> ` and \\ -> \
    body = body.replace(/\\(`|\\)/g, '$1');
    statements.push(body.trim());
  }
}

// 2) Single/double-quoted string literals containing DDL (single-line ALTERs)
const qRe = /(['"])((?:\\.|(?!\1)[^\\\n])*)\1/g;
while ((m = qRe.exec(src)) !== null) {
  const body = m[2];
  if (/^\s*(CREATE TABLE|ALTER TABLE|CREATE (UNIQUE )?INDEX)/i.test(body)) {
    statements.push(body.trim());
  }
}

// Dedupe preserving order
const seen = new Set();
const unique = statements.filter(s => {
  const key = s.replace(/\s+/g, ' ');
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

const header = `-- ══════════════════════════════════════════════════════════════
-- 008_consolidated_runtime_schema.sql
-- ══════════════════════════════════════════════════════════════
-- Generated from api/lib/startupTasks.js (tools/extract-runtime-ddl.cjs).
-- Consolidates ALL runtime DDL (tables + column additions) so that
-- schema.sql + migrations/ are the single source of truth for new
-- environments. Statements are idempotent (IF NOT EXISTS / ADD COLUMN
-- IF NOT EXISTS) and safe to run on an existing production database.
--
-- NOTE: startupTasks.js still runs the same DDL at boot for backwards
-- compatibility. New schema changes MUST be added here (as a new
-- numbered migration), NOT in startupTasks.js.
-- ══════════════════════════════════════════════════════════════

SET FOREIGN_KEY_CHECKS = 0;
SET NAMES utf8mb4;

`;

let body = '';
for (const s of unique) {
  body += s.replace(/;\s*$/, '') + ';\n\n';
}

const footer = `SET FOREIGN_KEY_CHECKS = 1;
-- ${unique.length} statements extracted.
`;

fs.writeFileSync(OUT, header + body + footer, 'utf8');
console.log(`Wrote ${unique.length} statements to ${OUT}`);
if (flagged.length) {
  console.log(`\nFLAGGED (contains interpolation — review manually):`);
  flagged.forEach(f => console.log('---\n' + f.slice(0, 200)));
}
