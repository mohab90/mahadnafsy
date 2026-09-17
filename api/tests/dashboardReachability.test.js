'use strict';
/**
 * A screen with a route, a permission and no way in is not a feature. Four had
 * exactly that — no menu entry, nothing linking to them, not embedded in any
 * screen that is in the menu — and the nav file's history shows none of them
 * ever had one, so it was wiring never finished rather than a regression.
 *
 * These tests pin the three things each one needs to actually work: an entry,
 * a route gate, and the real table behind whatever it counts. Run: npm run test:unit
 */
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const nav = codeOnly(read('admin/pages/dashboard/navigation.tsx'));
const groups = codeOnly(read('admin/pages/dashboard/dashboardTabGroups.ts'));
const permissions = codeOnly(read('admin/pages/dashboard/dashboardShared.tsx'));

const CONNECTED = ['sales_reports', 'sales_team', 'online_team', 'staff_performance'];

test('each newly connected screen has a menu entry', () => {
  for (const key of CONNECTED) {
    assert.match(nav, new RegExp(`key: '${key}', label: '`), `${key} has no way in`);
  }
});

test('and a route gate, or the entry opens nothing', () => {
  // GeneralDashboardTabs renders only inside DashboardContentHubRoutes, which
  // renders only when activeTab is in this set. Missing from it, a menu entry
  // changes the URL and draws an empty page.
  const start = groups.indexOf('export const contentHubRouteTabs');
  const body = groups.slice(start, groups.indexOf(']);', start));
  for (const key of CONNECTED) {
    assert.ok(body.includes(`'${key}'`), `${key} would open a blank page`);
  }
});

test('and a permission, which each already had', () => {
  for (const key of CONNECTED) {
    // Three forms count as a gate: one permission, a list of them where any one
    // opens the tab, and `null` for a tab that is the viewer's own page. What
    // does not count is absence, which the sidebar reads as "hide it".
    assert.match(permissions, new RegExp(`${key}:\\s*('|\\[|null)`), `${key} has no permission gate`);
  }
});

test('a screen that counts rows loads the rows, or it reports the bootstrap page', () => {
  // The bootstrap fetches 500 newest rows. A screen counting out of that array
  // while presenting it as the table is the fault this file already documents
  // for marketing_hub — it reported "500 ليدات جديدة" against 27,000.
  const setBody = name => {
    const start = groups.indexOf(`export const ${name} = new Set`);
    return groups.slice(start, groups.indexOf(']);', start));
  };
  const leadTabs = setBody('fullLeadTabs');
  const crmTabs = setBody('fullCrmDataTabs');

  // sales_team builds a per-rep monthly table from l.assignedSalesId;
  // sales_reports filters leads by range and breaks them down by status.
  for (const key of ['sales_reports', 'sales_team']) {
    assert.ok(leadTabs.includes(`'${key}'`), `${key} counts leads and must load them`);
  }
  // online_team filters both leads and subscribers by branch.
  assert.ok(crmTabs.includes("'online_team'"), 'online_team reads both tables');

  // staff_performance is deliberately NOT here: it takes its per-rep counts
  // from GET /admin/leads/staff-performance, which is why it was moved off the
  // full load in the first place. Putting it back would undo that.
  assert.ok(!leadTabs.includes("'staff_performance'"),
    'staff_performance uses the server aggregate, not the table');
  assert.match(read('admin/pages/dashboard/tabs/StaffPerformanceTab.tsx'),
    /getStaffLeadPerformance/, 'and it must still be asking for it');
});

test('the screens still read what the menu now promises', () => {
  // Each was checked against the group it was filed under; this pins that the
  // screen behind each entry is the one that does that job.
  const renders = codeOnly(read('admin/pages/dashboard/GeneralDashboardTabs.tsx'));
  for (const [key, component] of [
    ['sales_reports', 'SalesReportsTab'],
    ['sales_team', 'SalesTeamTab'],
    ['online_team', 'OnlineTeamMgmtTab'],
    ['staff_performance', 'StaffPerformanceTab'],
  ]) {
    assert.match(renders, new RegExp(`key: '${key}', Component: ${component}`),
      `${key} must still render ${component}`);
  }
});
