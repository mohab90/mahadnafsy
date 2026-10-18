// GET every parameterless /api/admin endpoint as one signed-in account; report status, ms, bytes.
const fs = require('fs'), path = require('path');
const root = process.argv[2];
const user = process.argv[3] || 'admin';
const base = 'http://127.0.0.1:3401';
const cookie = fs.readFileSync(`D:/audit_tmp/perf-db/cj_${user}.txt`, 'utf8').split('\n').filter(l => l && !l.startsWith('# ') ).map(l => l.replace(/^#HttpOnly_/, '').split('\t')).filter(p => p.length >= 7).map(p => `${p[5]}=${p[6].trim()}`).join('; ');
const files = []; (function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) { if (f.name !== 'node_modules' && f.name !== 'tests') walk(p); } else if (p.endsWith('.js')) files.push(p); } })(path.join(root, 'api', 'routes'));
const paths = new Set();
for (const f of files) for (const m of fs.readFileSync(f, 'utf8').matchAll(/router\.get\(\s*['"`](\/api\/admin\/[^'"`]*)['"`]/g)) if (!/[:*]/.test(m[1])) paths.add(m[1]);
(async () => {
  const out = [];
  for (const p of [...paths].sort()) {
    const t = []; let status = 0, bytes = 0;
    for (let i = 0; i < 2; i++) {
      const s = process.hrtime.bigint();
      try { const r = await fetch(base + p, { headers: { cookie }, signal: AbortSignal.timeout(15000) }); const b = await r.arrayBuffer(); status = r.status; bytes = b.byteLength; } catch (e) { status = -1; if (!global.__e) { global.__e = 1; console.log("first error:", e.message, e.cause && e.cause.code); } }
      t.push(Number(process.hrtime.bigint() - s) / 1e6);
    }
    out.push({ p, status, bytes, cold: Math.round(t[0]), warm: Math.round(t[1]) });
  }
  fs.writeFileSync(`D:/audit_tmp/perf-db/sweep_${user}.json`, JSON.stringify(out));
  const bad = out.filter(o => o.status >= 500 || o.status === -1);
  console.log(`${out.length} endpoints as ${user}; statuses:`, JSON.stringify(out.reduce((a, o) => (a[o.status] = (a[o.status] || 0) + 1, a), {})));
  console.log('\n5xx:'); bad.forEach(o => console.log(' ', o.status, o.p));
  console.log('\nslowest (warm ms):'); out.sort((a, b) => b.warm - a.warm).slice(0, 15).forEach(o => console.log(String(o.warm).padStart(6), String(o.cold).padStart(6), String(Math.round(o.bytes / 1024)).padStart(6) + 'KB', o.status, o.p));
  console.log('\nbiggest:'); out.sort((a, b) => b.bytes - a.bytes).slice(0, 8).forEach(o => console.log(String(Math.round(o.bytes / 1024)).padStart(7) + 'KB', o.warm + 'ms', o.p));
})();
