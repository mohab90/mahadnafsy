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
//
// navigation.tsx is not the whole menu. DashboardNavigation.tsx carries the
// sales and collection bars and the التسجيلات entry, and its items are rendered
// from an array — so there is no literal setActiveTab('registrations') for the
// scan below to find, and this reported a screen as unreachable that staff use
// every day. A list of "dead" screens that names a live one is a list nobody
// can safely act on.
const nav = fs.readFileSync(path.join(D, 'navigation.tsx'), 'utf8');
const nav2 = fs.readFileSync(path.join(D, 'DashboardNavigation.tsx'), 'utf8');
const hub = fs.readFileSync(path.join(D, 'contentHubConfig.ts'), 'utf8');
const reachable = new Set();
for (const s of [nav.slice(nav.indexOf('DASHBOARD_MENU_GROUPS')), nav2, hub]) {
  for (const m of s.matchAll(/key:\s*'([a-z_0-9]+)'/g)) reachable.add(m[1]);
}
for (const f of walk(path.join(ROOT, 'admin'))) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/setActiveTab\(\s*'([a-z_0-9]+)'/g)) reachable.add(m[1]);
  // A screen can also be a section inside another screen — service_hub draws
  // the FAQ manager on `subTab === 'faq'`. Those are reached by clicking, not
  // by a tab key, so the component is live even though no menu names it.
  for (const m of src.matchAll(/subTab\s*===\s*'([a-z_0-9]+)'/g)) reachable.add(m[1]);
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
// The wording matters more than it looks. This list says "no MENU ENTRY names
// this key" — it does not say the feature is unreachable, and the difference
// cost a wrong report: every one of the fourteen turned out to be covered by a
// screen that is in the menu. sales_team is «الفريق» inside sales_hub,
// staff_performance is «الأداء والتارجت» inside hr, online_team is «فريق
// الأونلاين» inside online_hub, cert_pricing is cert_requests opened on its
// pricing tab, and daqqi_attendance data is on daqqi_stats. They are legacy
// standalone keys left behind when those screens were merged into hubs.
//
// So treat this as "keys with no menu entry" — a tidiness list, and a place to
// look for duplicate implementations. It is not a list of dead files, and
// deleting from it without checking the hub first removes working features.
console.log(`\n── (ب) مفتاح ليه مكوّن ومفيش مدخل في القائمة باسمه: ${orphans.length}`);
console.log('     (مش معناه إن الميزة مش موصولة — غالبًا محتواها جوّه شاشة مدمَجة موجودة في القائمة)');
for (const [k, comps] of orphans.sort()) {
  console.log(`  ${k.padEnd(24)} ${[...comps.keys()].join(', ')}   [${[...comps.values()][0]}]`);
}
