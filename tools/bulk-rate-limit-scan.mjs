#!/usr/bin/env node
/**
 * bulk-rate-limit-scan.mjs
 *
 * Static guard for NOT-04: bulk actions (mass assign/create/send) and data
 * exports are far more expensive per request than an ordinary admin
 * GET/POST, but previously shared the same generic adminLimiter
 * (400 req/min per IP) as everything else under /api/admin — a single
 * session could fire dozens of exports or bulk sends well within that
 * ceiling. Every export/bulk route should also carry a dedicated,
 * per-user-keyed limiter (bulkOperationLimiter, or an equally-scoped one
 * like whatsappSendLimiter).
 *
 * Heuristic: every route registration whose path contains "bulk" or
 * "export" (case-insensitive) must reference an identifier ending in
 * "Limiter" on the same line. Route registrations in this codebase are
 * consistently single-line, matching the style the duplicate-route guard
 * (check #13) already relies on.
 *
 * Usage: node tools/bulk-rate-limit-scan.mjs [--list]
 * Wired into tools/mahad-quality-check.mjs.
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

const ROUTE_RE = /router\.(get|post|put|patch|delete)\(\s*(['"`])(\/api\/[^'"`]+)\2/;

export function scanBulkRateLimitViolations() {
  const files = walk(join(ROOT, 'api/routes'), '.js');
  const violations = [];
  for (const f of files) {
    const rel = f.slice(ROOT.length).replace(/^[\\/]?api[\\/]/, '').replace(/\\/g, '/');
    const src = readFileSync(f, 'utf8');
    const lines = src.split('\n');
    lines.forEach((line, idx) => {
      const m = line.match(ROUTE_RE);
      if (!m) return;
      const routePath = m[3];
      if (!/bulk|export/i.test(routePath)) return;
      if (/Limiter\b/.test(line)) return;
      violations.push({ file: rel, line: idx + 1, path: routePath });
    });
  }
  return violations;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').replace(/^([A-Z]):/i, ''));
if (isMain) {
  const violations = scanBulkRateLimitViolations();
  if (process.argv.includes('--list')) {
    for (const v of violations) console.log(`${v.file}:${v.line} — ${v.path}`);
  }
  console.log(`bulk-rate-limit-scan: ${violations.length} bulk/export route(s) missing a dedicated rate limiter`);
}
