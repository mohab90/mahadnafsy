#!/usr/bin/env node
/**
 * The same HTTP path declared in more than one file.
 *
 * Express takes the first match, so the later declaration is dead — but it
 * still reads as maintained, still gets edited, and a fix applied to it changes
 * nothing. A whole forum feature was found dead this way: three routes on
 * forum_posts, one of them the live handler for a path whose real data lives in
 * a different table.
 *
 * Mount order comes from server.js, so the winner is decided here rather than
 * guessed. A path declared twice inside one file is reported too — that is the
 * same bug with a shorter distance.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROUTES = path.join(ROOT, 'api', 'routes');

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) files.push(full);
  }
})(ROUTES);

// Mount order: the sequence server.js requires them in.
const server = fs.readFileSync(path.join(ROOT, 'api', 'server.js'), 'utf8');
const mountOrder = [];
for (const m of server.matchAll(/require\(['"]\.\/routes\/([^'"]+)['"]\)/g)) mountOrder.push(m[1]);
const orderOf = (rel) => {
  const name = rel.replace(/^api\/routes\//, '').replace(/\.js$/, '');
  const at = mountOrder.findIndex(entry => entry === name || entry.replace(/\.js$/, '') === name);
  return at === -1 ? Number.MAX_SAFE_INTEGER : at;
};

const declarations = new Map(); // "VERB path" -> [{file, line}]
let total = 0;
for (const file of files) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  lines.forEach((line, index) => {
    // Skip the comment notes left where dead duplicates were removed.
    if (/^\s*\/\//.test(line)) return;
    const m = /router\.(get|post|put|patch|delete)\s*\(\s*'([^']+)'/.exec(line);
    if (!m) return;
    total++;
    const key = `${m[1].toUpperCase()} ${m[2]}`;
    if (!declarations.has(key)) declarations.set(key, []);
    declarations.get(key).push({ file: rel, line: index + 1 });
  });
}

const collisions = [...declarations.entries()].filter(([, places]) => places.length > 1);
console.log(`route-collision-scan: ${total} route declaration(s) across ${files.length} files`);
console.log(`paths declared more than once: ${collisions.length}`);
for (const [key, places] of collisions) {
  const ranked = [...places].sort((a, b) => orderOf(a.file) - orderOf(b.file));
  console.log(`  ${key}`);
  ranked.forEach((place, index) => {
    const mounted = orderOf(place.file);
    const label = index === 0 ? 'WINS  ' : 'dead  ';
    console.log(`      ${label}${place.file}:${place.line}`
      + (mounted === Number.MAX_SAFE_INTEGER ? '   (not mounted directly by server.js)' : ''));
  });
}
