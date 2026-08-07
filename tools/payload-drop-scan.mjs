// REV-1c — same question as 1b, but with the false positives removed:
//  * a route that does `req.body[k]` over a list DOES read those keys
//  * the panel's payload is read from a brace-balanced object literal, not a
//    fixed-length regex window that overshoots into neighbouring code
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'tests', '.git'].includes(e.name) || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(p);
  }
  return out;
};
const rel = f => path.relative(ROOT, f).replace(/\\/g, '/');

/** Text of the object literal that starts at the first `{` at/after `from`. */
function objectAt(src, from) {
  const open = src.indexOf('{', from);
  if (open === -1 || open - from > 40) return null;
  let depth = 0;
  for (let i = open; i < src.length && i < open + 6000; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open + 1, i); }
  }
  return null;
}

/** Top-level `key:` names of an object-literal body (skips nested objects). */
function topKeys(body) {
  const keys = [];
  let depth = 0, line = '';
  for (const ch of body) {
    if (ch === '\n') {
      const m = line.match(/^\s*(?:\.\.\.)?\(?\s*([a-zA-Z_]\w*)\s*:/);
      if (depth === 0 && m) keys.push(m[1]);
      line = '';
      continue;
    }
    if (depth === 0) line += ch;
    if ('{(['.includes(ch)) depth++;
    else if ('})]'.includes(ch)) depth--;
  }
  const m = line.match(/^\s*([a-zA-Z_]\w*)\s*:/);
  if (depth === 0 && m) keys.push(m[1]);
  return keys;
}

const routes = new Map();
for (const f of walk(path.join(ROOT, 'api'))) {
  const src = fs.readFileSync(f, 'utf8');
  const decls = [...src.matchAll(/router\.(post|put|patch)\(\s*'([^']+)'/g)];
  for (let i = 0; i < decls.length; i++) {
    const body = src.slice(decls[i].index, i + 1 < decls.length ? decls[i + 1].index : src.length);
    const keys = new Set();
    for (const m of body.matchAll(/req\.body(?:\?)?\.([a-zA-Z_]\w*)/g)) keys.add(m[1]);
    for (const m of body.matchAll(/req\.body(?:\?)?\[\s*'([^']+)'/g)) keys.add(m[1]);
    // Follow single-level aliases: `const b = req.body || {}` then `b.price`.
    for (const alias of new Set([...body.matchAll(/const\s+([a-zA-Z_]\w*)\s*=\s*req\.body\b/g)].map(m => m[1]))) {
      for (const m of body.matchAll(new RegExp(String.raw`\b${alias}(?:\?)?\.([a-zA-Z_]\w*)`, 'g'))) keys.add(m[1]);
      for (const m of body.matchAll(new RegExp(String.raw`\b${alias}\[\s*'([^']+)'`, 'g'))) keys.add(m[1]);
    }
    for (const m of body.matchAll(/const\s*\{([^}]{1,500})\}\s*=\s*req\.body/g))
      for (const k of m[1].split(',')) {
        const n = k.split(/[:=]/)[0].trim();
        if (/^[a-zA-Z_]\w*$/.test(n)) keys.add(n);
      }
    // Dynamic reads mean the route consumes a list it computed itself, and any
    // spread means it takes the whole body — either way, not a dropped-field bug.
    const dynamic = /req\.body\[\s*[a-z_]\w*\s*\]|\.\.\.req\.body|Object\.(keys|entries|assign)\(\s*req\.body|=\s*req\.body\s*;/.test(body);
    routes.set(`${decls[i][1].toUpperCase()} ${decls[i][2]}`, { file: rel(f), keys, dynamic });
  }
}

const apiClient = fs.readFileSync(path.join(ROOT, 'admin/lib/mysqlapi.ts'), 'utf8');
const helpers = new Map();
for (const m of apiClient.matchAll(/(\w+):\s*\(([^)]*)\)\s*=>\s*(post|put|patch)\(\s*[`'"]([^`'"]+)[`'"]/g)) {
  helpers.set(m[1], { method: m[3].toUpperCase(), url: m[4] });
}
const norm = s => '/' + s.replace(/\$\{[^}]*\}/g, ':x').replace(/^\/?(api\/)?/, '').replace(/:[\w]+/g, ':x').replace(/^\/+/, '');
const byNorm = new Map();
for (const [k, v] of routes) {
  const [method, p] = k.split(' ');
  byNorm.set(`${method} ${norm(p)}`, { ...v, key: k });
}

const adminFiles = walk(path.join(ROOT, 'admin'));
const findings = [];
for (const [helper, { method, url }] of helpers) {
  const target = byNorm.get(`${method} ${norm(url)}`);
  if (!target || target.dynamic) continue;
  const sent = new Map();
  for (const f of adminFiles) {
    const src = fs.readFileSync(f, 'utf8');
    const call = new RegExp(`\\b${helper}\\s*\\(`, 'g');
    for (const m of src.matchAll(call)) {
      const obj = objectAt(src, m.index + m[0].length);
      if (!obj) continue;
      for (const k of topKeys(obj)) sent.set(k, rel(f));
    }
  }
  const dropped = [...sent.keys()].filter(k => !target.keys.has(k));
  if (dropped.length) findings.push({ helper, route: target.key, file: target.file, dropped, sent, read: target.keys.size });
}

console.log('═'.repeat(78));
console.log('REV-1c  حقول بتتبعت من اللوحة والراوت مش بيقراها');
console.log('═'.repeat(78));
console.log(`راوتات كتابة: ${routes.size} | منها بتقرأ حقول محددة: ${[...routes.values()].filter(r => !r.dynamic).length}`);
console.log(`دوال API مربوطة براوت: ${[...helpers].filter(([, h]) => byNorm.has(`${h.method} ${norm(h.url)}`)).length} / ${helpers.size}`);
if (!findings.length) console.log('\n  لا يوجد.');
for (const f of findings) {
  console.log(`\n  ${f.route}   [${f.file}]  (الراوت بيقرأ ${f.read} حقل)`);
  for (const k of f.dropped) console.log(`     ✗ ${k}   ← من ${f.sent.get(k)}`);
}
