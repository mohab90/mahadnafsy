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

test('the automation page sits under التسويق and the settings hub does not list it again', () => {
  assert.match(groupBlock('marketing'), /key: 'automation'/);
  assert.doesNotMatch(groupBlock('settings'), /key: 'automation'/);
  const hub = read('admin/pages/dashboard/tabs/settingsHubConfig.ts');
  for (const title of ['الأتمتة والقواعد', 'واتساب وماسنجر وانستجرام', 'صندوق الإشعارات']) {
    assert.ok(!hub.includes(`title: '${title}'`), `${title} lives under التسويق only`);
  }
});
