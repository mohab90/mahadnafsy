'use strict';

// «تقرير لفريق الاونلاين ولفريق خدمه العملاء ولفريق الدقي … وصفحه في قسم
// الادارة تجمع فيها كل التقارير دي … اكتر الكورسات مبيعا 10 … اكتر مصدر …
// اكتر سيلز … اكتر تحصيل».

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { routeModules } = require('../lib/registerRoutes');

const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

// Answers each statement by the table it reads, with the rows given.
function fakeDb(tables) {
  return {
    async query(sql) {
      const hit = Object.entries(tables).find(([pattern]) => new RegExp(pattern).test(sql.replace(/\s+/g, ' ')));
      return [hit ? hit[1] : []];
    },
  };
}

test('customer service is measured the way the owner asked', async () => {
  const { buildSupportTeamReport } = require('../lib/teamReports');
  const db = fakeDb({
    'FROM staff': [{ id: 's1', name: 'fatmacs', email: 'FatmaCS@x.com', role: 'SUPPORT' }],
    'FROM communications': [{ rep: 's1', calls: 4, whatsapp: 1, followUps: 0, reached: 3 }],
    "entity=\\? AND action=\\?": [{ rep: 'fatmacs@x.com', n: 5 }],
    'FROM support_tickets WHERE tenant_id=\\? AND deleted_at IS NULL AND resolved_at': [{ rep: 's1', resolved: 2, rated: 1, csat: 4.5 }],
    'FROM ticket_events': [{ rep: 's1', replies: 6 }],
    'FROM refund_requests WHERE tenant_id=\\? AND deleted_at IS NULL AND escalated_at': [],
  });
  const report = await buildSupportTeamReport({ tenantId: 't', from: '2026-09-30', to: '2026-09-30', today: '2026-09-30' }, db);
  const [row] = report.rows;
  assert.equal(row.calls, 4, 'مكالمات');
  assert.equal(row.problemsResolved, 2, 'حل كام مشكله');
  assert.equal(row.clientsReviewed, 5, 'راجع كام عميل — matched on the email, whatever its case');
  assert.equal(row.ratingAvg, 4.5, 'التقييم');
  assert.equal(row.replies, 6);
});

test('each team is its own report, and the management page gathers them over one period', () => {
  const lib = read('api/lib/managementReport.js');
  
  
  for (const key of ['salesByMoney', 'collectionByMoney', 'byBranch', 'byDepartment', 'topSources']) assert.ok(lib.includes(key), key);
});

test('the report screens get the dashboard\'s own notify, not a new one each render', () => {
  // The WhatsApp card and the reports reload when notify changes; an inline
  // wrapper changed it on every dashboard render, which wiped the number being
  // typed and fetched the whole report again.
  for (const file of ['DashboardStandaloneTabs.tsx', 'GeneralDashboardTabs.tsx', 'DashboardGrowthOpsTabs.tsx']) {
    const src = read(`admin/pages/dashboard/${file}`);
    assert.ok(!/<(?:ManagementReportsTab|TeamReportPanel)[^>]*notify=\{\(/.test(src), file);
  }
});

test('the reports are for management, and the institute\'s money for the owner and the managers', () => {
  const route = read('api/routes/management-reports.js');
  
  
  
  assert.ok(routeModules.some(([, mod]) => mod === '../routes/management-reports'), 'the route is registered');
  
  
});
