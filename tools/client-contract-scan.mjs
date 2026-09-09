#!/usr/bin/env node
/**
 * The customer-facing half of the shape problem.
 *
 * mysql2 returns column names exactly as the table spells them, and a route that
 * answers `res.json(rows)` ships snake_case. The client screens read camelCase
 * and cast with `as unknown as X[]`, so a mismatched field is silently undefined
 * — the value renders blank, a filter matches nothing, a total reads zero, and
 * TypeScript never says a word. That class produced the customer's empty
 * consultations list, the community library crash and the invisible payments.
 *
 * For every endpoint the client actually calls, this resolves the route that
 * answers it, whether that route maps its rows or ships them raw, and — where it
 * ships raw — which snake_case columns leave the server. Those are the fields a
 * screen must be reading in snake_case too, or not at all.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return ''; } };

const walk = (dir, out = []) => {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js)$/.test(entry.name)) out.push(full);
  }
  return out;
};

// ── every declared route, with its handler body ─────────────────────────────
const ROUTES = [];
for (const file of walk(path.join(ROOT, 'api', 'routes'))) {
  const source = fs.readFileSync(file, 'utf8');
  const re = /router\.(get|post|put|patch|delete)\s*\(\s*'([^']+)'/g;
  let match;
  const found = [];
  while ((match = re.exec(source))) found.push({ verb: match[1].toUpperCase(), path: match[2], at: match.index });
  found.forEach((route, index) => {
    const end = index + 1 < found.length ? found[index + 1].at : source.length;
    ROUTES.push({ ...route, file: path.relative(ROOT, file).replace(/\\/g, '/'), body: source.slice(route.at, end) });
  });
}

const routeFor = (verb, called) => {
  const wanted = called.startsWith('/api') ? called : `/api${called}`;
  const parts = wanted.split('/');
  return ROUTES.find(route => {
    if (route.verb !== verb) return false;
    const declared = route.path.split('/');
    if (declared.length !== parts.length) return false;
    return declared.every((segment, i) => segment.startsWith(':') || segment === parts[i]);
  }) || null;
};

// ── what the client calls ───────────────────────────────────────────────────
const clientApi = read('client/lib/mysqlapi.ts');
const CALLS = [];
for (const match of clientApi.matchAll(
  /(\w+):\s*(?:async\s*)?\([^)]*\)\s*=>\s*(\w*)\(?\s*[`'"]([/][^`'"]*)[`'"]([\s\S]{0,160}?method:\s*'(\w+)')?/g)) {
  const helper = match[2] || '';
  const verb = (match[5] || ({ post: 'POST', put: 'PUT', patch: 'PATCH', del: 'DELETE' })[helper] || 'GET').toUpperCase();
  CALLS.push({ name: match[1], verb, path: match[3].replace(/\$\{[^}]*\}/g, 'x').replace(/\?.*$/, '') });
}
// Direct fetches in the pages, which bypass the wrapper.
for (const file of walk(path.join(ROOT, 'client'))) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/fetch\(\s*[`'"](\/api\/[^`'"]*)[`'"]([\s\S]{0,200}?method:\s*'(\w+)')?/g)) {
    CALLS.push({
      name: path.basename(file),
      verb: (match[3] || 'GET').toUpperCase(),
      path: match[1].replace(/\$\{[^}]*\}/g, 'x').replace(/\?.*$/, ''),
    });
  }
}

// ── does the route map, or ship raw? ────────────────────────────────────────
const SNAKE = /\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g;
const NOT_COLUMNS = new Set([
  'req_body', 'res_json', 'order_by', 'group_by', 'is_null', 'not_null', 'left_join',
]);

const rawColumns = body => {
  // Only routes that hand rows straight back.
  if (!/res\.json\(\s*(rows|items|list|data)\s*\)/.test(body)) return null;
  const select = body.match(/SELECT([\s\S]*?)FROM/i);
  if (!select) return [];
  return [...new Set([...select[1].matchAll(SNAKE)].map(m => m[1]))]
    .filter(name => !NOT_COLUMNS.has(name));
};

const seen = new Set();
const findings = [];
let resolved = 0;

for (const call of CALLS) {
  const key = `${call.verb} ${call.path}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const route = routeFor(call.verb, call.path);
  if (!route) continue;
  resolved += 1;
  const columns = rawColumns(route.body);
  if (columns && columns.length) {
    findings.push({ key, file: route.file, columns, caller: call.name });
  }
}

console.log(`client calls found: ${seen.size}`);
console.log(`of those, resolved to a declared route: ${resolved}`);
console.log(`of those, shipping raw snake_case rows: ${findings.length}`);
console.log('');
for (const finding of findings) {
  console.log(`  ${finding.key}   (${finding.caller})`);
  console.log(`      ${finding.file} — ${finding.columns.join(', ')}`);
}
console.log('');
console.log('A raw row is only a defect when the screen reads camelCase off it.');
console.log('Check the consumer before acting: some screens read snake_case on');
console.log('purpose, and that is correct as long as both sides agree.');
