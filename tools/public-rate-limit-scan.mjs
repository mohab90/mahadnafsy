#!/usr/bin/env node
/**
 * public-rate-limit-scan.mjs
 *
 * Static guard for the "rate limiting added ad hoc per-endpoint" root cause
 * (RATE-01..04 fixed known instances of this manually; this guard stops the
 * next one from shipping silently). /api/admin and /api/staff already get a
 * blanket adminLimiter/advancedRateLimit at the app.use() mount in server.js,
 * and requireAuth/requireAdmin routes are gated behind a session (a different,
 * separately-mitigated threat model via loginLimiter). Everything else —
 * genuinely public or optionalAuth routes reachable by anonymous callers —
 * must carry a dedicated *Limiter on the same line, or it has zero abuse
 * protection at all.
 *
 * Heuristic: every router.(get|post|put|patch|delete) registration whose
 * path does NOT start with /api/admin or /api/staff, and whose line does NOT
 * contain requireAuth or requireAdmin, must reference an identifier ending
 * in "Limiter" on the same line. Route registrations in this codebase are
 * consistently single-line, matching the style the duplicate-route guard
 * (check #13) and the bulk-rate-limit guard (check #17) already rely on.
 *
 * Usage: node tools/public-rate-limit-scan.mjs [--list]
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

export function scanPublicRateLimitViolations() {
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
      if (/^\/api\/(admin|staff)(\/|$)/.test(routePath)) return;
      if (routePath === '/api/health') return; // reviewed: uptime monitors poll this frequently by design
      if (/\brequireAuth\b|\brequireAdmin\b/.test(line)) return;
      if (/Limiter\b/.test(line)) return;
      violations.push({ file: rel, line: idx + 1, path: routePath, method: m[1] });
    });
  }
  return violations;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').replace(/^([A-Z]):/i, ''));
if (isMain) {
  const violations = scanPublicRateLimitViolations();
  if (process.argv.includes('--list')) {
    for (const v of violations) console.log(`${v.file}:${v.line} — ${v.method.toUpperCase()} ${v.path}`);
  }
  console.log(`public-rate-limit-scan: ${violations.length} public/optionalAuth route(s) missing a dedicated rate limiter`);
}
