#!/usr/bin/env node
/**
 * What an anonymous visitor can read.
 *
 * A route with no requireAuth answers anybody, and several are additionally
 * cached with `Cache-Control: public`. This lists the columns those routes
 * select that carry something a stranger should not have: a private URL, a
 * credential, someone's contact details, an internal note.
 *
 * It found meeting_link on GET /api/therapists — the real join URL for every
 * therapy session, on a public, publicly-cached response.
 *
 * Candidates, not verdicts: a public course listing selecting `title` is fine,
 * and some contact details are published on purpose. Each one needs the route
 * read before acting.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const walk = (dir, out = []) => {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
};

// Columns worth a second look on an anonymous response.
const SENSITIVE = [
  'meeting_link', 'meeting_url', 'stream_url', 'recording_url', 'join_url',
  'password', 'password_hash', 'secret', 'api_key', 'token', 'hmac',
  'private_key', 'access_token', 'refresh_token', 'webhook_url',
  'client_email', 'client_phone', 'customer_email', 'customer_phone',
  'national_id', 'id_number', 'proof_image', 'admin_note', 'reviewer_note',
  'internal_note', 'notes', 'crm_json', 'firebase_uid', 'session_version',
];

const GUARD = /requireAuth|requireAdmin|requireStaff|requireApiKey|verifyPaymobHmac|requireInternal|requirePermission/;

const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map(line => line.replace(/(^|\s)\/\/.*$/, '$1'))
  .join('\n');

const files = walk(path.join(ROOT, 'api', 'routes'));
const findings = [];
let publicRoutes = 0;
let allRoutes = 0;

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const decl = /router\.(get|post|put|patch|delete)\s*\(\s*'([^']+)'([^\n]*)/g;
  const found = [];
  let match;
  while ((match = decl.exec(source))) {
    found.push({ verb: match[1].toUpperCase(), route: match[2], head: match[3], at: match.index });
  }
  found.forEach((entry, index) => {
    allRoutes += 1;
    const end = index + 1 < found.length ? found[index + 1].at : source.length;
    const body = source.slice(entry.at, end);
    // requireAuth may sit on the declaration line or, for a long list of
    // middleware, on the lines just after it.
    const guardWindow = body.slice(0, 400);
    if (GUARD.test(guardWindow)) return;
    // Several files collect their middleware into a local array and spread it:
    // `router.get('/api/admin/…', ...view, handler)`. Resolve the array before
    // calling the route unguarded, or every one of them reports as public.
    const spreads = [...entry.head.matchAll(/\.\.\.(\w+)/g)].map(m => m[1]);
    if (spreads.some(name => {
      const decl = new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]{0,400}?)\\]`).exec(source);
      return decl && GUARD.test(decl[1]);
    })) return;
    publicRoutes += 1;
    const line = source.slice(0, entry.at).split('\n').length;
    // Comments stripped first. A note explaining why a column is *not* selected
    // mentions it by name and would otherwise report as an exposure — as would
    // the "Password Management" banner above an unrelated route.
    const hits = SENSITIVE.filter(column => new RegExp(`\\b${column}\\b`).test(codeOnly(body)));
    if (!hits.length) return;
    findings.push({
      at: `${rel}:${line}`,
      route: `${entry.verb} ${entry.route}`,
      columns: hits,
      cached: /Cache-Control[^\n]*public/.test(body),
    });
  });
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ allRoutes, publicRoutes, findings }));
  process.exit(0);
}

console.log(`routes declared: ${allRoutes}`);
console.log(`of those, reachable with no auth guard: ${publicRoutes}`);
console.log(`of those, mentioning a sensitive column: ${findings.length}`);
console.log('');
for (const finding of findings) {
  console.log(`  ${finding.route}${finding.cached ? '   [publicly cached]' : ''}`);
  console.log(`      ${finding.at} — ${finding.columns.join(', ')}`);
}
console.log('');
console.log('Candidates. A route may select a column and never answer it, and');
console.log('some contact details are published deliberately — read each one.');
