// REV-6 — two failure modes that look identical from the outside ("الزرار مش بيعمل حاجة"):
//   * a path declared on more than one router: the first one mounted wins, so a
//     fix applied to the other copy silently never runs
//   * a path the panel calls that no router declares: a permanent 404
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const walk = (dir, filter, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git'].includes(e.name) || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, filter, out); else if (filter.test(e.name)) out.push(p);
  }
  return out;
};
const rel = f => path.relative(ROOT, f).replace(/\\/g, '/');

// ── declared routes ──────────────────────────────────────────────────────────
const declared = new Map(); // "METHOD /path" -> [files]
for (const f of walk(path.join(ROOT, 'api'), /\.js$/)) {
  if (/[\\/]tests[\\/]/.test(f)) continue;
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) {
    const key = `${m[1].toUpperCase()} ${m[2]}`;
    if (!declared.has(key)) declared.set(key, []);
    declared.get(key).push(rel(f));
  }
}

const dupes = [...declared].filter(([, files]) => files.length > 1);

// ── paths the panel and the client call ──────────────────────────────────────
const norm = s => '/' + String(s)
  .replace(/\$\{[^}]*\}/g, ':x')
  .replace(/\?.*$/, '')
  .replace(/^\/?(api\/)?/, '')
  .replace(/^\/+/, '');
const declaredNorm = new Set([...declared.keys()].map(k => {
  const [m, p] = k.split(' ');
  return `${m} ${norm(p).replace(/:[\w]+/g, ':x')}`;
}));

const called = new Map();
for (const app of ['admin', 'client']) {
  for (const f of walk(path.join(ROOT, app), /\.tsx?$/)) {
    const src = fs.readFileSync(f, 'utf8');
    // apiFetch/post/put/... helpers and raw fetch of /api/...
    for (const m of src.matchAll(/(?:apiFetch|post|put|patch|del|adminPost|adminPut|fetch)\(\s*[`'"]((?:\/api)?\/[^`'"]*)[`'"]/g)) {
      if (!/^\/(api\/)?(admin|auth|me|staff|public|content|courses|bundles|lectures|chapters)/.test(m[1])) continue;
      const key = norm(m[1]).replace(/\/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '/:x').replace(/:x/g, ':x');
      if (!called.has(key)) called.set(key, new Set());
      called.get(key).add(rel(f));
    }
  }
}

const declaredPaths = new Set([...declaredNorm].map(k => k.split(' ')[1]));
const missing = [...called].filter(([p]) => {
  const candidate = p.replace(/:[\w]+/g, ':x');
  if (declaredPaths.has(candidate)) return false;
  // allow a declared parameterised path to cover a concrete call
  for (const d of declaredPaths) {
    const re = new RegExp('^' + d.replace(/:x/g, '[^/]+').replace(/\//g, '\\/') + '$');
    if (re.test(candidate)) return false;
  }
  return true;
});

console.log('═'.repeat(78));
console.log('REV-6  سلامة المسارات');
console.log('═'.repeat(78));
console.log(`مسارات معرَّفة: ${declared.size}`);
console.log(`\n── مسارات معرَّفة أكتر من مرة (الأول بس هو اللي يشتغل): ${dupes.length}`);
for (const [key, files] of dupes) console.log(`  ${key}\n      ${files.join('\n      ')}`);

console.log(`\n── مسارات الواجهة بتناديها ومش معرَّفة في السيرفر: ${missing.length}`);
for (const [p, files] of missing) console.log(`  ${p}\n      ${[...files].join(', ')}`);
