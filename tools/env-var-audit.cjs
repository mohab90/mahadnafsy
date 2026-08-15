// Build-time environment variables the frontend reads but nothing defines.
//
// This is the shape of the video outage: the lecture player decoded URLs with
// import.meta.env.VITE_VIDEO_KEY, no .env file anywhere set it, so the key was
// the empty string and 2,174 lectures silently refused to play. Vite replaces
// an undefined import.meta.env.X with `undefined` at build time — no warning,
// no error, and the type declaration in vite-env.d.ts still claims it is a
// string, so tsc is satisfied too.
const fs = require('fs');
const path = require('path');

const walk = (dir, out = []) => {
  let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['node_modules', 'dist'].includes(e.name)) walk(p, out); }
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
};

const defined = new Set();
for (const app of ['client', 'admin']) {
  for (const f of ['.env', '.env.local', '.env.production', '.env.development']) {
    try {
      fs.readFileSync(path.join(app, f), 'utf8').split(/\r?\n/).forEach(line => {
        const m = line.match(/^\s*(VITE_[A-Z0-9_]+)\s*=/);
        if (m) defined.add(m[1]);
      });
    } catch { /* no such file */ }
  }
}

const used = new Map();
for (const app of ['client', 'admin']) {
  for (const file of walk(app)) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/import\.meta\.env\.(VITE_[A-Z0-9_]+)/g)) {
      if (!used.has(m[1])) used.set(m[1], new Set());
      used.get(m[1]).add(file);
    }
  }
}

console.log('defined in .env files :', defined.size ? [...defined].join(', ') : '(no .env file exists)');
console.log('read in source        :', used.size);
console.log();

let risky = 0;
for (const [name, files] of [...used].sort()) {
  if (defined.has(name)) continue;
  // A `||` right after the read means an undefined value is handled; without
  // one the code runs on undefined.
  const noFallback = [...files].filter(f => {
    const src = fs.readFileSync(f, 'utf8');
    const re = new RegExp('import\\.meta\\.env\\.' + name + '[^\\n]{0,40}\\|\\|');
    return !re.test(src);
  });
  const mark = noFallback.length ? 'NO FALLBACK — runs on undefined' : 'has a fallback';
  console.log(`  ${name.padEnd(26)} ${mark}`);
  [...files].forEach(f => console.log(`      ${f.split(path.sep).join('/')}`));
  risky++;
}
console.log(`\nundefined but read: ${risky}`);
