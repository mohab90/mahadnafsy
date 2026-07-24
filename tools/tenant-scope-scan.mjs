#!/usr/bin/env node
/**
 * tenant-scope-scan.mjs
 *
 * Static guard for the multi-tenant SaaS invariant: every query touching a
 * tenant-scoped table must mention tenant_id somewhere in the same query.
 *
 * The list of tenant-scoped tables is derived automatically from the
 * migrations (any table whose CREATE TABLE or ADD COLUMN mentions
 * tenant_id) — it is not hand-maintained, so a new tenant-scoped table
 * picked up by a migration is covered without editing this file.
 *
 * This is a heuristic (regex-based), matching the style of the other checks
 * in tools/mahad-quality-check.mjs: it flags candidates for review, it does
 * not parse SQL. False positives are possible (e.g. a query joins through a
 * child table whose own tenant_id lives on the parent); real ones vastly
 * outnumber false ones in practice — see the migration-011-vs-028 incident
 * and the four cross-tenant leaks this exact scan surfaced on first run.
 *
 * Usage: node tools/tenant-scope-scan.mjs [--list]
 *   (no args)  prints a one-line summary + count, exit 0 always (informational)
 *   --list     prints every violation with file:line + snippet
 *
 * Wired into tools/mahad-quality-check.mjs as check #14 with a BASELINE that
 * can only decrease — see that file for the enforcement gate.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, extname } from 'path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

function walk(dir, ext, results = []) {
  for (const f of readdirSync(dir)) {
    const full = join(dir, f);
    if (f === 'node_modules' || f === '.git') continue;
    const s = statSync(full);
    if (s.isDirectory()) walk(full, ext, results);
    else if (!ext || extname(f) === ext) results.push(full);
  }
  return results;
}

function buildTenantTables() {
  const migDir = join(ROOT, 'api/migrations');
  const tenantTables = new Set();
  for (const f of readdirSync(migDir).filter(x => x.endsWith('.sql'))) {
    const sql = readFileSync(join(migDir, f), 'utf8');

    const createRe = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?`?([a-zA-Z0-9_]+)`?\s*\(/gi;
    let m;
    while ((m = createRe.exec(sql))) {
      const tableName = m[1];
      let depth = 0, i = createRe.lastIndex - 1, start = -1;
      for (; i < sql.length; i++) {
        if (sql[i] === '(') { if (depth === 0) start = i; depth++; }
        else if (sql[i] === ')') { depth--; if (depth === 0) break; }
      }
      const body = sql.slice(start, i + 1);
      if (/\btenant_id\b/i.test(body)) tenantTables.add(tableName);
    }

    const alterRe = /ALTER TABLE\s+(?:IF EXISTS\s+)?`?([a-zA-Z0-9_]+)`?\s+ADD (?:COLUMN\s+)?(?:IF NOT EXISTS\s+)?`?tenant_id`?/gi;
    while ((m = alterRe.exec(sql))) tenantTables.add(m[1]);
  }
  return tenantTables;
}

function extractQueryCalls(src) {
  const calls = [];
  const callRe = /\b(?:pool|conn)\.query\s*\(/g;
  let m;
  while ((m = callRe.exec(src))) {
    let depth = 1, i = callRe.lastIndex;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
    }
    calls.push({ text: src.slice(callRe.lastIndex, i - 1), offset: m.index });
  }
  return calls;
}

function lineOf(src, offset) {
  return src.slice(0, offset).split('\n').length;
}

export function scanTenantViolations() {
  const TENANT_TABLES = [...buildTenantTables()];
  const TABLE_RE = new RegExp(`\\b(?:FROM|UPDATE|INTO|JOIN)\\s+\`?(${TENANT_TABLES.join('|')})\`?\\b`, 'gi');
  const routeFiles = walk(join(ROOT, 'api/routes'), '.js');
  const violations = [];

  for (const f of routeFiles) {
    const src = readFileSync(f, 'utf8');
    for (const call of extractQueryCalls(src)) {
      const tablesFound = new Set();
      let tm;
      TABLE_RE.lastIndex = 0;
      while ((tm = TABLE_RE.exec(call.text))) tablesFound.add(tm[1].toLowerCase());
      if (tablesFound.size === 0) continue;
      if (!/tenant_id/i.test(call.text)) {
        violations.push({
          file: f.replace(ROOT, '').replace(/\\/g, '/').replace(/^\//, ''),
          line: lineOf(src, call.offset),
          tables: [...tablesFound].join(','),
          snippet: call.text.replace(/\s+/g, ' ').trim().slice(0, 140),
        });
      }
    }
  }
  return { tenantTableCount: TENANT_TABLES.length, violations };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').replace(/^([A-Z]):/i, ''));
if (isMain) {
  const { tenantTableCount, violations } = scanTenantViolations();
  if (process.argv.includes('--list')) {
    for (const v of violations) console.log(`${v.file}:${v.line}  [${v.tables}]\n    ${v.snippet}\n`);
  }
  console.log(`Tenant-scoped tables tracked: ${tenantTableCount}`);
  console.log(`Violations (query on a tenant-scoped table with no tenant_id mention): ${violations.length}`);
}
