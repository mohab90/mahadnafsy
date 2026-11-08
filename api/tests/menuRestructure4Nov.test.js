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
  
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'routes', 'hr', 'enps.js')), false);
  assert.equal(fs.existsSync(path.join(__dirname, '..', '..', 'admin/pages/dashboard/tabs/EnpsDashboardTab.tsx')), false);
  
});





test('4 Nov 2026: the marketing hub keeps four sections and reads its overview from the server', () => {
  const hub = read('admin/pages/dashboard/tabs/MarketingHubTab.tsx');
  
  for (const gone of ['campaigns', 'notifications_tab', 'performance', "'leads'"]) assert.ok(!hub.includes(`key: ${gone.startsWith("'") ? gone : `'${gone}'`}`), `${gone} is gone from the hub`);
  
  
  const overview = read('admin/pages/dashboard/tabs/marketing-hub-sections/MarketingOverview.tsx');
  
  
  
});

test('4 Nov 2026: الحملات is the messaging hub alone, opening on the inbox; email, SMS and drip screens are gone', () => {
  const campaigns = read('admin/pages/dashboard/tabs/CampaignsTab.tsx');
  assert.equal((campaigns.match(/\{ id: '/g) || []).length, 1);
  
  for (const name of ['EmailCampaignsTab', 'SmsCampaignsTab', 'DripCampaignsTab']) {
    assert.equal(fs.existsSync(path.join(__dirname, '..', '..', `admin/pages/dashboard/tabs/${name}.tsx`)), false, name);
    assert.doesNotMatch(read('admin/pages/dashboard/lazyTabs.tsx'), new RegExp(name));
  }
  
});



test('4 Nov 2026: the merged performance page opens on an overview of the month — absence at its payroll cost, lateness, and the money — each half only for who may read it', () => {
  const hub = read('admin/pages/dashboard/tabs/StaffPerformanceHubTab.tsx');
  
  assert.ok(hub.indexOf("id: 'overview'") < hub.indexOf("id: 'team'"), 'the overview is the first section');
  const overview = read('admin/pages/dashboard/tabs/staff-performance/StaffOverviewSection.tsx');
  
  
  
  
  
});
