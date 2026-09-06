#!/usr/bin/env node
/**
 * Admin and client modules nothing imports.
 *
 * The orphan scan asks whether a file is mentioned anywhere; this one asks the
 * narrower question that matters for deleting code — is this module reached
 * from the application's entry point at all? A component imported only by
 * another unreferenced component is still dead, so reachability is walked
 * transitively rather than counting mentions.
 *
 * Usage: node tools/unreferenced-admin-scan.mjs [--app admin]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const at = args.indexOf('--app');
const APP = at === -1 ? 'admin' : args[at + 1];
const BASE = path.join(ROOT, APP);

const SKIP = new Set(['node_modules', 'dist', '.git', 'public', 'artifacts']);
const EXT = ['.ts', '.tsx', '.js', '.jsx'];

const all = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (EXT.includes(path.extname(entry.name))) all.push(full);
  }
})(BASE);

const norm = (p) => path.relative(ROOT, p).split(path.sep).join('/');

// Resolve an import specifier to a file on disk.
function resolve(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  const tries = [];
  for (const ext of EXT) tries.push(base + ext);
  for (const ext of EXT) tries.push(path.join(base, 'index' + ext));
  tries.push(base);
  for (const candidate of tries) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const importsOf = new Map();
for (const file of all) {
  const src = fs.readFileSync(file, 'utf8');
  const specs = [];
  const re = /(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) specs.push(m[1]);
  importsOf.set(file, specs.map((s) => resolve(file, s)).filter(Boolean));
}

// Entry points: whatever index.html loads, plus the conventional main files.
const roots = all.filter((f) => /(?:^|\/)(main|index|App)\.(tsx|ts|jsx|js)$/.test(norm(f))
  && !norm(f).includes('/components/') && !norm(f).includes('/pages/'));

const reached = new Set();
const queue = [...roots];
while (queue.length) {
  const file = queue.pop();
  if (reached.has(file)) continue;
  reached.add(file);
  for (const next of importsOf.get(file) || []) if (!reached.has(next)) queue.push(next);
}

const dead = all.filter((f) => !reached.has(f));
const lines = (f) => fs.readFileSync(f, 'utf8').split('\n').length;
const deadLines = dead.reduce((sum, f) => sum + lines(f), 0);
const totalLines = all.reduce((sum, f) => sum + lines(f), 0);

console.log(APP + ': ' + all.length + ' modules, ' + totalLines + ' lines');
console.log('entry points: ' + roots.map(norm).join(', '));
console.log('reachable: ' + reached.size + ' modules');
console.log('NOT reachable: ' + dead.length + ' modules, ' + deadLines + ' lines ('
  + (totalLines ? ((deadLines / totalLines) * 100).toFixed(1) : '0') + '% of ' + APP + ')');
console.log('');
for (const file of dead.sort((a, b) => lines(b) - lines(a)).slice(0, 40)) {
  console.log('  ' + String(lines(file)).padStart(5) + '  ' + norm(file));
}
