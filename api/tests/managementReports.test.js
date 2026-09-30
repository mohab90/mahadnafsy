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
  assert.match(lib, /buildTeamDailyReport\(range, db\),\s*buildOnlineTeamReport\(range, db\),\s*buildSupportTeamReport\(range, db\),\s*buildDaqqiTeamReport\(range, db\),/);
  assert.match(lib, /ORDER BY bookings DESC, moneyEgp DESC\s*LIMIT 10/, 'the ten best sellers');
  for (const key of ['salesByMoney', 'collectionByMoney', 'byBranch', 'byDepartment', 'topSources']) assert.ok(lib.includes(key), key);
});

test('the reports are for management, and the institute\'s money for the owner and the managers', () => {
  const route = read('api/routes/management-reports.js');
  assert.match(route, /'\/api\/admin\/reports\/teams\/:team', requireAuth, requireAdminOrStaff,\s*requireAnyPermission\('manage_sales_team', 'view_perf_online', 'view_perf_cx', 'view_perf_daqqi'\)/);
  assert.match(route, /support: \['manage_sales_team', 'view_perf_cx'\]/, 'each team read by its own performance permission');
  assert.match(route, /'\/api\/admin\/reports\/management', requireAuth, requireAdmin,/);
  assert.ok(routeModules.some(([, mod]) => mod === '../routes/management-reports'), 'the route is registered');
  assert.match(read('admin/pages/dashboard/navigation.tsx'), /\{ key: 'management_reports', label: 'تقارير الإدارة'/);
  assert.match(read('admin/pages/dashboard/dashboardShared.tsx'), /management_reports: 'manage_settings',/);
});
