// REV-2c — the same page implemented or mounted twice.
//
// Two shapes, both of which make an edit "not take effect":
//   A) one component mounted under two different tab keys — a fix lands on both,
//      but the two entries confuse navigation and permission mapping
//   B) a standalone tab component that no menu can reach while a hub renders its
//      own inline version of the same thing — editing the orphan changes nothing
//      the owner can see
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const D = path.join(ROOT, 'admin/pages/dashboard');
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
};
const rel = f => path.relative(ROOT, f).replace(/\\/g, '/');

// tabKey -> Set(component)
const mounts = new Map();
const add = (key, comp, file) => {
  if (!mounts.has(key)) mounts.set(key, new Map());
  mounts.get(key).set(comp, rel(file));
};

for (const f of walk(D).concat([path.join(ROOT, 'admin/pages/Dashboard.tsx')])) {
  const src = fs.readFileSync(f, 'utf8');
  // { key: 'x', Component: YTab }
  for (const m of src.matchAll(/key:\s*'([a-z_0-9]+)'\s*,\s*Component:\s*(\w+)/g)) add(m[1], m[2], f);
  // activeTab === 'x' && <YTab
  for (const m of src.matchAll(/activeTab\s*===\s*'([a-z_0-9]+)'[\s\S]{0,200}?<(\w+Tab|\w+Panel)\b/g)) add(m[1], m[2], f);
  // if (activeTab === 'x') { return ( <YTab
  for (const m of src.matchAll(/activeTab\s*===\s*'([a-z_0-9]+)'\s*\)\s*\{[\s\S]{0,300}?<(\w+Tab|\w+Panel)\b/g)) add(m[1], m[2], f);
}

// menu-reachable keys
const nav = fs.readFileSync(path.join(D, 'navigation.tsx'), 'utf8');
const hub = fs.readFileSync(path.join(D, 'contentHubConfig.ts'), 'utf8');
const reachable = new Set();
for (const s of [nav.slice(nav.indexOf('DASHBOARD_MENU_GROUPS')), hub]) {
  for (const m of s.matchAll(/key:\s*'([a-z_0-9]+)'/g)) reachable.add(m[1]);
}
for (const f of walk(path.join(ROOT, 'admin'))) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/setActiveTab\(\s*'([a-z_0-9]+)'/g)) reachable.add(m[1]);
}
for (const k of ['staff_home', 'staff_settings', 'my_hr']) reachable.add(k);

// component -> keys
const byComponent = new Map();
for (const [key, comps] of mounts) {
  for (const c of comps.keys()) {
    if (!byComponent.has(c)) byComponent.set(c, new Set());
    byComponent.get(c).add(key);
  }
}

console.log('═'.repeat(78));
console.log('REV-2c  صفحات متكرّرة أو مقطوعة عن القائمة');
console.log('═'.repeat(78));
console.log(`تابات مربوطة بمكوّن: ${mounts.size}`);

const twice = [...byComponent].filter(([, keys]) => keys.size > 1);
console.log(`\n── (أ) نفس المكوّن متركّب تحت أكتر من مفتاح: ${twice.length}`);
for (const [comp, keys] of twice) console.log(`  ${comp}  →  ${[...keys].join(', ')}`);

const orphans = [...mounts].filter(([k]) => !reachable.has(k));
console.log(`\n── (ب) صفحة ليها مكوّن ومفيش أي مدخل أو انتقال يوصلها: ${orphans.length}`);
for (const [k, comps] of orphans.sort()) {
  console.log(`  ${k.padEnd(24)} ${[...comps.keys()].join(', ')}   [${[...comps.values()][0]}]`);
}
