// REV-2b — duplication and dead ends in the dashboard surface itself.
//   A) the same page reachable from more than one menu entry
//   B) a menu entry whose tab nothing renders (click does nothing)
//   C) a rendered tab no menu can reach (dead code, or a page the owner
//      remembers existing and can no longer find)
//   D) the same component mounted under two different tab keys
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const D = path.join(ROOT, 'admin/pages/dashboard');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

const nav = read('admin/pages/dashboard/navigation.tsx');
const hub = read('admin/pages/dashboard/contentHubConfig.ts');

// ── declared tab keys ────────────────────────────────────────────────────────
const tabKeyBlock = nav.slice(nav.indexOf('export type TabKey'), nav.indexOf(';', nav.indexOf('export type TabKey')));
const allTabs = new Set([...tabKeyBlock.matchAll(/'([a-z_0-9]+)'/g)].map(m => m[1]));

// ── menu entries (group items + content-hub sub-tabs + hub actions) ──────────
const menuEntries = []; // {key, where}
const groupsBlock = nav.slice(nav.indexOf('export const DASHBOARD_MENU_GROUPS'));
for (const g of groupsBlock.matchAll(/label:\s*'([^']+)',\s*\n\s*icon[\s\S]*?items:\s*\[([\s\S]*?)\n\s*\],/g)) {
  for (const i of g[2].matchAll(/key:\s*'([a-z_0-9]+)',\s*label:\s*'([^']+)'/g)) {
    menuEntries.push({ key: i[1], label: i[2], where: `قائمة: ${g[1]}` });
  }
}
for (const m of hub.matchAll(/\{\s*key:\s*'([a-z_0-9]+)',\s*label:\s*'([^']+)'/g)) {
  const isAction = hub.indexOf('CONTENT_HUB_ACTIONS') < hub.indexOf(m[0]);
  menuEntries.push({ key: m[1], label: m[2], where: isAction ? 'المحتوى: بطاقات' : 'المحتوى: تابات' });
}

// ── which tabs anything actually renders ─────────────────────────────────────
const renderFiles = fs.readdirSync(D).filter(f => /\.tsx$/.test(f))
  .concat(fs.existsSync(path.join(D, 'tabs')) ? [] : []);
let renderSrc = '';
for (const f of renderFiles) renderSrc += fs.readFileSync(path.join(D, f), 'utf8') + '\n';
renderSrc += read('admin/pages/Dashboard.tsx');
const rendered = new Set();
for (const re of [
  /activeTab\s*===\s*'([a-z_0-9]+)'/g,
  /contentHubSubTab\s*===\s*'([a-z_0-9]+)'/g,
  /^\s{2,}([a-z_0-9]+):\s*\{\s*title:/gm,          // pageConfigs entries
  /\[\s*'([a-z_0-9]+)'\s*,\s*'[^']*'\s*\]/g,       // sub-tab tuples
]) for (const m of renderSrc.matchAll(re)) rendered.add(m[1]);
// Tabs listed in the lazy/standalone tab group files count as rendered.
for (const f of ['dashboardTabGroups.ts', 'lazyTabs.ts', 'DashboardStandaloneTabs.tsx', 'DashboardTabContainer.tsx']) {
  if (!fs.existsSync(path.join(D, f))) continue;
  const s = fs.readFileSync(path.join(D, f), 'utf8');
  for (const m of s.matchAll(/'([a-z_0-9]+)'/g)) if (allTabs.has(m[1])) rendered.add(m[1]);
}

// ── A) same tab from more than one menu entry ────────────────────────────────
const byKey = new Map();
for (const e of menuEntries) {
  if (!byKey.has(e.key)) byKey.set(e.key, []);
  byKey.get(e.key).push(e);
}
const duplicated = [...byKey].filter(([, e]) => e.length > 1);

const menuKeys = new Set(menuEntries.map(e => e.key));
const PERSONAL = new Set(['staff_home', 'staff_settings', 'my_hr', 'ask_ai']);
const deadMenu = menuEntries.filter(e => !rendered.has(e.key));
const unreachable = [...rendered].filter(k => allTabs.has(k) && !menuKeys.has(k) && !PERSONAL.has(k));

console.log('═'.repeat(78));
console.log('REV-2b  تكرار ونهايات ميتة في واجهة اللوحة');
console.log('═'.repeat(78));
console.log(`تابات معرَّفة: ${allTabs.size} | مداخل قوائم: ${menuEntries.length} | تابات بترسم فعلاً: ${rendered.size}`);

console.log(`\n── (أ) نفس الصفحة من أكتر من مدخل: ${duplicated.length}`);
for (const [key, entries] of duplicated) {
  console.log(`  ${key}`);
  for (const e of entries) console.log(`      "${e.label}"  ←  ${e.where}`);
}

console.log(`\n── (ب) مدخل قائمة ومفيش حاجة بترسمه: ${deadMenu.length}`);
for (const e of deadMenu) console.log(`  ${e.key}  "${e.label}"  (${e.where})`);

console.log(`\n── (ج) صفحة بترسم ومفيش مدخل يوصلها: ${unreachable.length}`);
for (const k of unreachable.sort()) console.log(`  ${k}`);
