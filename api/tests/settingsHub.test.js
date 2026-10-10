'use strict';
/**
 * مركز الإعدادات (admin/pages/dashboard/tabs/settingsHubConfig.ts): every entry
 * opens a screen or section that exists. The hub used to link five retired
 * routes and leave whole areas out; a link to a section that is not there would
 * open the first section of the screen and look like it worked.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const { SETTINGS_GROUPS, searchSettings } = require(path.join(ROOT, 'admin/pages/dashboard/tabs/settingsHubConfig.ts'));

const ids = (rel, pattern) => new Set([...read(rel).matchAll(pattern)].map(m => m[1]));
const sectionsOf = {
  system_settings: ids('admin/pages/dashboard/tabs/systemSettingsSchema.tsx', /\{ key: '([a-z_]+)',\s+label:/g),
  integrations: ids('admin/pages/dashboard/tabs/IntegrationsTab.tsx', /\{ id: '([a-z_]+)'/g),
  security_center: ids('admin/pages/dashboard/tabs/SecurityCenterTab.tsx', /\{ id: '([a-z_]+)'/g),
  campaigns: ids('admin/pages/dashboard/tabs/CampaignsTab.tsx', /\{ id: '([a-z_]+)'/g),
  content_hub: ids('admin/pages/dashboard/contentHubConfig.ts', /\{ key: '([a-z_]+)', label:/g),
  hr: new Set(read('admin/pages/dashboard/tabs/HRTab.tsx').match(/const HR_SECTIONS = \[([^\]]+)\]/)[1].match(/[a-z_]+/g)),
};
const screens = ids('admin/pages/dashboard/dashboardShared.tsx', /^\s+([a-z_]+):\s+(?:'|\[|null)/gm);

const allLinks = SETTINGS_GROUPS.flatMap(group => group.entries.flatMap(entry =>
  [{ entry, href: entry.href }, ...(entry.links || []).map(link => ({ entry, href: link.href }))]));

test('every link opens a real screen, and a real section of it', () => {
  assert.ok(allLinks.length > 40);
  for (const { entry, href } of allLinks) {
    const [, , tab, section] = href.split('/');
    assert.ok(screens.has(tab), `${entry.title}: ${href} — /dashboard/${tab} is not a screen`);
    if (section) {
      assert.ok(sectionsOf[tab], `${entry.title}: ${href} — ${tab} has no sections`);
      assert.ok(sectionsOf[tab].has(section), `${entry.title}: ${href} — ${tab} has no section «${section}»`);
    }
  }
  for (const group of SETTINGS_GROUPS) {
    for (const entry of group.entries) assert.equal(entry.href.split('/')[2], entry.tab, `${entry.title} is gated as ${entry.tab} but opens ${entry.href}`);
  }
});

test('every section of إعدادات الإدارة is reachable from the hub and sits under a sidebar heading', () => {
  const linked = new Set(allLinks.map(l => l.href.split('/')).filter(p => p[2] === 'system_settings').map(p => p[3]));
  const groups = read('admin/pages/dashboard/tabs/systemSettingsSchema.tsx').match(/SECTION_GROUPS[\s\S]*?\n\];/)[0];
  for (const key of sectionsOf.system_settings) {
    if (key !== 'branches') assert.ok(linked.has(key), `system_settings/${key} is not in the hub`);
    assert.match(groups, new RegExp(`'${key}'`), `${key} is under no sidebar heading`);
  }
});

test('search finds a setting however it is spelled', () => {
  const titles = query => searchSettings(SETTINGS_GROUPS, query).flatMap(g => g.entries.map(e => e.title));
  assert.ok(titles('بصمه').includes('سياسة الحضور والخصومات'));
  assert.ok(titles('paymob').includes('بوابات الدفع'));
  assert.ok(titles('التجمع').includes('الفروع وتفعيل فرع التجمع'));
  assert.ok(titles('تفاصيل المسار').includes('نصوص صفحات الموقع'));
  assert.deepEqual(titles('كلام مش موجود خالص'), []);
});

test('the SaaS setup is hidden unless the build turns it on', () => {
  const settings = read('admin/pages/dashboard/tabs/SystemSettingsTab.tsx');
  assert.match(settings, /\{SAAS_UI && <SaasSetupWizard /);
  assert.match(settings, /\{SAAS_UI && <TenantDomainSection /);
  assert.match(read('admin/lib/productMode.ts'), /SAAS_UI = import\.meta\.env\.VITE_SAAS_UI === '1'/);
});

test('the hub pages open from a link, and the page editors draw inside صفحات الموقع', () => {
  const dashboard = read('admin/pages/Dashboard.tsx');
  assert.match(dashboard, /const page = CONTENT_HUB_TABS\.find\(t => t\.key === tab\)/);
  assert.match(dashboard, /urlTab === 'content_hub' && urlParam/);
  assert.match(dashboard, /activeTab === 'content_hub' && contentHubSubTab\.startsWith\('page_'\)/);
  // /dashboard/hr/<section> opens it; the addresses of the merged tabs open the tab that holds them now.
  const hr = read('admin/pages/dashboard/tabs/HRTab.tsx');
  assert.match(hr, /HR_SECTIONS as readonly string\[\]\)\.includes\(param/);
  assert.match(hr, /useState<HrSection>\(\(\) => sectionFor\(sectionParam\)\)/);
});
