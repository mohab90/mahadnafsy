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

// ── which route files the server actually mounts ─────────────────────────────
// registerRoutes.js is the only place a router is attached to the app. A file
// full of `router.get(...)` that nothing in that graph requires is not a route:
// every call to it answers 404 while the code sits there looking correct, which
// is the hardest version of "الزرار مش بيعمل حاجة" to diagnose.
const resolveModule = spec => {
  for (const c of [spec, `${spec}.js`, path.join(spec, 'index.js')]) {
    try { if (fs.statSync(c).isFile()) return c; } catch { /* keep trying */ }
  }
  return null;
};
const mounted = new Set();
const follow = file => {
  if (!file) return;
  const key = path.resolve(file);
  if (mounted.has(key)) return;
  mounted.add(key);
  let src; try { src = fs.readFileSync(key, 'utf8'); } catch { return; }
  // registerRoutes holds its module paths as bare strings in a table and calls
  // require() on the variable, so a require(...) regex alone finds nothing
  // there. Every relative module string counts as an edge.
  for (const m of src.matchAll(/'(\.\.?\/[^']+)'/g)) {
    follow(resolveModule(path.resolve(path.dirname(key), m[1])));
  }
};
follow(path.join(ROOT, 'api', 'lib', 'registerRoutes.js'));

// ── declared routes ──────────────────────────────────────────────────────────
const declared = new Map(); // "METHOD /path" -> [files]
const unmounted = new Map(); // file -> route count
for (const f of walk(path.join(ROOT, 'api'), /\.js$/)) {
  if (/[\\/]tests[\\/]/.test(f)) continue;
  if (!mounted.has(path.resolve(f))) {
    const n = (fs.readFileSync(f, 'utf8').match(/router\.(get|post|put|patch|delete)\s*\(\s*'/g) || []).length;
    if (n) unmounted.set(rel(f), n);
    continue;
  }
  const src = fs.readFileSync(f, 'utf8');
  // `router.get  ('/x')` is legal JavaScript and appears in the analytics
  // routers; without \s* before the paren those six routes read as undeclared
  // and every panel calling them was reported as a dead button.
  for (const m of src.matchAll(/router\.(get|post|put|patch|delete)\s*\(\s*'([^']+)'/g)) {
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
  // A panel that builds its filters separately appends them as one expression:
  // `/admin/finance/refunds${query}`. The literal has no `?` to cut at, so the
  // query survives as a `:x` glued to the last segment. A path parameter is
  // always its own segment, so an unslashed trailing `:x` is a query string.
  .replace(/([^/]):x$/, '$1')
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
    // adminGet, adminDelete and adminPatch were missing from this list, so
    // reads and deletes issued through the panel's helper were never checked —
    // exactly the half of a screen that breaks first.
    for (const m of src.matchAll(/(?:apiFetch|post|put|patch|del|adminGet|adminPost|adminPut|adminPatch|adminDelete|fetch)\(\s*[`'"]((?:\/api)?\/[^`'"]*)[`'"]/g)) {
      if (!/^\/(api\/)?(admin|auth|me|staff|public|content|courses|bundles|lectures|chapters)/.test(m[1])) continue;
      const key = norm(m[1]).replace(/\/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '/:x').replace(/:x/g, ':x');
      if (!called.has(key)) called.set(key, new Set());
      called.get(key).add(rel(f));
    }
  }
}

const declaredPaths = new Set([...declaredNorm].map(k => k.split(' ')[1]));
// `:x` means "decided at runtime" on both sides, so it has to match anything on
// the other side. The panel writes `/staff/me/disciplinary/${id}/${action}`
// where action is 'acknowledge' or 'appeal' — both declared, but a one-way
// comparison reads the second `:x` as a literal and calls the route dead.
const covers = (declaredPath, callPath) => {
  const d = declaredPath.split('/'), c = callPath.split('/');
  if (d.length !== c.length) return false;
  return d.every((seg, i) => seg === ':x' || c[i] === ':x' || seg === c[i]);
};
const missing = [...called].filter(([p]) => {
  const candidate = p.replace(/:[\w]+/g, ':x');
  if (declaredPaths.has(candidate)) return false;
  for (const d of declaredPaths) if (covers(d, candidate)) return false;
  return true;
});

console.log('═'.repeat(78));
console.log('REV-6  سلامة المسارات');
console.log('═'.repeat(78));
console.log(`مسارات معرَّفة: ${declared.size}`);

console.log(`\n── ملفات فيها مسارات والسيرفر مش بيركّبها (كل نداء ليها 404): ${unmounted.size}`);
for (const [f, n] of unmounted) console.log(`  ${f}  (${n})`);

console.log(`\n── مسارات معرَّفة أكتر من مرة (الأول بس هو اللي يشتغل): ${dupes.length}`);
for (const [key, files] of dupes) console.log(`  ${key}\n      ${files.join('\n      ')}`);

console.log(`\n── مسارات الواجهة بتناديها ومش معرَّفة في السيرفر: ${missing.length}`);
for (const [p, files] of missing) console.log(`  ${p}\n      ${[...files].join(', ')}`);
