'use strict';
// 4 Nov 2026 menu changes: no eNPS page, one page for staff performance and HR analytics, the automation page under التسويق and not repeated in the settings hub.
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const read = file => fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');
const menu = read('admin/pages/dashboard/navigation.tsx');
const groupBlock = key => {
  const start = menu.indexOf(`key: '${key}',\n    label:`);
  assert.ok(start > 0, `group ${key}`);
  return menu.slice(start, menu.indexOf('\n  },', start));
};

test('the eNPS survey is gone from the menu, the screens, the API and the staff profile', () => {
  assert.doesNotMatch(menu, /enps_dashboard/);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'routes', 'hr', 'enps.js')), false);
  assert.equal(fs.existsSync(path.join(__dirname, '..', '..', 'admin/pages/dashboard/tabs/EnpsDashboardTab.tsx')), false);
  assert.doesNotMatch(read('admin/pages/dashboard/my-profile/MyJobFileSection.tsx'), /\/api\/staff\/me\/enps/);
});

test('staff performance and HR analytics are one page with two sections, and the old address redirects', () => {
  assert.match(menu, /key: 'staff_performance', label: 'أداء الموظفين'/);
  assert.doesNotMatch(menu, /hr_analytics/);
  const hub = read('admin/pages/dashboard/tabs/StaffPerformanceHubTab.tsx');
  assert.match(hub, /id: 'team'[^\n]*alsoPermissions: \['view_leads'\]/);
  assert.match(hub, /id: 'hr'[^\n]*permission: 'view_hr'/);
  assert.match(hub, /hr_analytics: 'hr'/);
  assert.match(read('admin/pages/dashboard/shell/useDashboardModel.tsx'), /\['staff_performance', RETIRED_STAFF_PERFORMANCE_TABS\]/);
});

test('the automation page is one door, a section of the marketing hub; the settings hub does not list it and the old address redirects there', () => {
  assert.doesNotMatch(menu, /key: 'automation'/);
  assert.match(read('admin/pages/dashboard/dashboardShared.tsx'), /marketing_hub:\s+\['manage_channel_settings', 'manage_automation'\]/);
  assert.match(read('admin/pages/dashboard/shell/useDashboardModel.tsx'), /\['marketing_hub', \{ automation: 'automation' \}\]/);
  assert.match(read('admin/pages/dashboard/tabs/MarketingHubTab.tsx'), /permission: 'manage_automation'/);
  const hub = read('admin/pages/dashboard/tabs/settingsHubConfig.ts');
  for (const title of ['الأتمتة والقواعد', 'واتساب وماسنجر وانستجرام', 'صندوق الإشعارات']) {
    assert.ok(!hub.includes(`title: '${title}'`), `${title} lives under التسويق only`);
  }
});

test('4 Nov 2026: the marketing hub keeps four sections and reads its overview from the server', () => {
  const hub = read('admin/pages/dashboard/tabs/MarketingHubTab.tsx');
  assert.match(hub, /type SubTab = 'overview' \| 'discounts' \| 'automation' \| 'segmentation';/);
  for (const gone of ['campaigns', 'notifications_tab', 'performance', "'leads'"]) assert.ok(!hub.includes(`key: ${gone.startsWith("'") ? gone : `'${gone}'`}`), `${gone} is gone from the hub`);
  assert.doesNotMatch(hub, /DEFAULT_AUTOMATION_TOGGLES|وضع العرض/, 'the switch panel that sent nothing is gone');
  assert.match(hub, /<AutomationTab notify=\{notify\}/);
  const overview = read('admin/pages/dashboard/tabs/marketing-hub-sections/MarketingOverview.tsx');
  assert.match(overview, /\/admin\/marketing\/overview\?range=/);
  assert.doesNotMatch(overview, /useSiteData/, 'no whole-table load for the overview');
  assert.match(read('api/routes/analytics/sales.js'), /router\.get\('\/api\/admin\/marketing\/overview', requireAuth, requireAdminOrStaff, requirePermission\('manage_channel_settings'\)/);
});

test('4 Nov 2026: الحملات is the messaging hub alone, opening on the inbox; email, SMS and drip screens are gone', () => {
  const campaigns = read('admin/pages/dashboard/tabs/CampaignsTab.tsx');
  assert.equal((campaigns.match(/\{ id: '/g) || []).length, 1);
  assert.match(campaigns, /email_campaigns: 'messaging'/);
  for (const name of ['EmailCampaignsTab', 'SmsCampaignsTab', 'DripCampaignsTab']) {
    assert.equal(fs.existsSync(path.join(__dirname, '..', '..', `admin/pages/dashboard/tabs/${name}.tsx`)), false, name);
    assert.doesNotMatch(read('admin/pages/dashboard/lazyTabs.tsx'), new RegExp(name));
  }
  assert.match(read('admin/pages/dashboard/tabs/MessagingHubTab.tsx'), /useState<View>\('inbox'\)/);
});

test('4 Nov 2026: the inbox readiness counts the official-API number as the company WhatsApp, not the default one the codes use', () => {
  assert.match(read('api/routes/team-inbox.js'), /const receiving = list\.filter\(channel => channel\.kind === 'whatsapp'[^\n]*provider === 'meta'\);/);
});

test('4 Nov 2026: the merged performance page opens on an overview of the month — absence at its payroll cost, lateness, and the money — each half only for who may read it', () => {
  const hub = read('admin/pages/dashboard/tabs/StaffPerformanceHubTab.tsx');
  assert.match(hub, /id: 'overview'[^\n]*alsoPermissions: \['manage_sales_team', 'view_perf_sales'\]/);
  assert.ok(hub.indexOf("id: 'overview'") < hub.indexOf("id: 'team'"), 'the overview is the first section');
  const overview = read('admin/pages/dashboard/tabs/staff-performance/StaffOverviewSection.tsx');
  assert.match(overview, /\/admin\/hr\/attendance\/summary\?month=/);
  assert.match(overview, /\/admin\/reports\/sales-performance\?from=/);
  assert.match(overview, /UNEXCUSED_ABSENCE_DAYS = 2/);
  assert.match(read('api/lib/payrollCalc.js'), /UNEXCUSED_ABSENCE_DAYS = 2/);
  assert.match(overview, /Promise\.allSettled/, 'one half failing for a permission must not hide the other');
});
