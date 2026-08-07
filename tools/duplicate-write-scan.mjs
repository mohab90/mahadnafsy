// REV-2 / REV-3 — two related "why didn't my edit take effect?" classes.
//
// REV-2: the same table+column written from more than one route. Two write paths
//        for one value means two sets of validation and two chances to disagree
//        — the shape of "عدّلته من مكان ومظهرش في مكان تاني".
// REV-3: a route that writes a table whose reads are memoised through cached()
//        but never calls cacheInvalidate() — the save succeeds and the site keeps
//        serving the old value until the TTL expires.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const API = path.join(ROOT, 'api');

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'tests', 'migrations'].includes(e.name) || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
};
const rel = f => path.relative(ROOT, f).replace(/\\/g, '/');
const files = walk(API);

/** Split a file into { route, body } chunks so a finding can name its route. */
function chunks(src, file) {
  const decls = [...src.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)];
  if (!decls.length) return [{ route: `(module) ${rel(file)}`, body: src }];
  const out = [];
  if (decls[0].index > 0) out.push({ route: `(module) ${rel(file)}`, body: src.slice(0, decls[0].index) });
  for (let i = 0; i < decls.length; i++) {
    out.push({
      route: `${decls[i][1].toUpperCase()} ${decls[i][2]}`,
      body: src.slice(decls[i].index, i + 1 < decls.length ? decls[i + 1].index : src.length),
      file: rel(file),
    });
  }
  return out;
}

// ── REV-2: table.column -> set of routes that write it ───────────────────────
const writers = new Map();
const IGNORE_COLS = new Set(['updated_at', 'created_at', 'deleted_at', 'tenant_id', 'id']);
for (const f of files) {
  for (const c of chunks(fs.readFileSync(f, 'utf8'), f)) {
    for (const m of c.body.matchAll(/UPDATE\s+`?(\w+)`?[\s\S]{0,80}?\bSET\b([\s\S]{0,900}?)(?:\bWHERE\b|$)/gi)) {
      const table = m[1].toLowerCase();
      if (['SELECT'].includes(table.toUpperCase())) continue;
      for (const col of m[2].matchAll(/`?([a-z_][a-z0-9_]*)`?\s*=/gi)) {
        const name = col[1].toLowerCase();
        if (IGNORE_COLS.has(name)) continue;
        const key = `${table}.${name}`;
        if (!writers.has(key)) writers.set(key, new Set());
        writers.get(key).add(`${c.route}  [${c.file || rel(f)}]`);
      }
    }
  }
}

// ── REV-3: cached() key prefixes vs cacheInvalidate() calls ──────────────────
const cacheKeys = new Map(); // prefix -> files that read it
const invalidations = new Set();
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/cached\(\s*[`'"]([a-z_]+)/gi)) {
    const k = m[1];
    if (!cacheKeys.has(k)) cacheKeys.set(k, new Set());
    cacheKeys.get(k).add(rel(f));
  }
  for (const m of src.matchAll(/cacheInvalidate\(([^)]*)\)/g)) {
    if (!m[1].trim()) { invalidations.add('*'); continue; }
    for (const q of m[1].matchAll(/[`'"]([a-z_]+)/gi)) invalidations.add(q[1]);
  }
}

console.log('═'.repeat(78));
console.log('REV-2  أعمدة بتتكتب من أكتر من راوت');
console.log('═'.repeat(78));
const multi = [...writers].filter(([, r]) => r.size > 1).sort((a, b) => b[1].size - a[1].size);
console.log(`أعمدة اتفحصت: ${writers.size} | منها بتتكتب من أكتر من مكان: ${multi.length}\n`);
for (const [col, routes] of multi) {
  console.log(`  ${col}  — ${routes.size} مكان`);
  for (const r of routes) console.log(`      ${r}`);
}

console.log('\n' + '═'.repeat(78));
console.log('REV-3  مفاتيح كاش بتتقرأ وما فيش إبطال ليها');
console.log('═'.repeat(78));
if (invalidations.has('*')) console.log('  (فيه cacheInvalidate() بلا وسائط = بيفرّغ كل الكاش)');
const orphan = [...cacheKeys].filter(([k]) => !invalidations.has(k));
console.log(`مفاتيح كاش: ${cacheKeys.size} | بلا إبطال: ${orphan.length}\n`);
for (const [k, fs_] of orphan) console.log(`  ✗ ${k}   ← بتتقرأ في ${[...fs_].join(', ')}`);
