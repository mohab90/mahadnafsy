'use strict';

// 3 Nov 2026, «قاعدة العملاء الموحدة … الإجمالي 989 · مشتركون 505 … دي غلط تماما لازم يسمع في القاعدة كل عملاء السيستم»: the screen counted the 500 clients and the
// 500 leads its browser had loaded. Its numbers and its table are the server's now (api/routes/misc/clientDbList.js; the real SQL runs in
// tests/integration/clientDbList.integration.test.js). «قاعدة العملاء» and the Dokki and online client screens stay as they are: they read one table.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = rel => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');

test('the screen asks the server for its counts and its page, and counts nothing from the arrays it holds', () => {
  const tab = read('admin/pages/dashboard/tabs/ClientDbTab.tsx');
  assert.match(tab, /adminGet<typeof summary>\('\/admin\/client-db\/summary'\)/);
  assert.match(tab, /\/admin\/client-db\/page\?\$\{query\.toString\(\)\}/);
  assert.match(tab, /const stats = summary;/);
  assert.doesNotMatch(tab, /allClients/, 'no list built in the browser');
  assert.doesNotMatch(tab, /effectiveSubs|effectiveLeads|listRegistrations/);
  // The tab, its two sister screens and the archive are all still there.
  assert.match(tab, /\['clients', 'قاعدة العملاء'\]/);
  assert.match(tab, /\['accounts', 'تسجيلات الدخول'\]/);
  assert.match(tab, /ArchivedClientsTab/);
});

test('the server counts clients, leads and sign-ups in the caller\'s reach, once each', () => {
  const route = read('api/routes/misc/clientDbList.js');
  assert.match(route, /router\.get\('\/api\/admin\/client-db\/summary', requireAuth, requireAdminOrStaff, requirePermission\('view_client_db'\)/);
  assert.match(route, /router\.get\('\/api\/admin\/client-db\/page', requireAuth, requireAdminOrStaff, requirePermission\('view_client_db'\)/);
  // The caller's own scope, as the search applies it; sign-ups and leads only for whoever holds view_leads.
  assert.match(route, /financialScopeClause\(resolveFinancialScope\(req, \{ allowAssigned: true \}\)/);
  assert.match(route, /leadScope\(req, 'l'\)/);
  assert.match(route, /holds\('view_leads'\)/);
  // A lead that is already a client by number is not counted twice.
  assert.match(route, /s2\.phone_digits = l\.phone_digits/);
  assert.match(read('api/routes/misc.js'), /router\.use\(require\('\.\/misc\/clientDbList'\)\)/);
});

test('a client past the first page can still be booked: the payment window is not asked of a list that does not hold them', () => {
  const tab = read('admin/pages/dashboard/tabs/ClientDbTab.tsx');
  assert.match(tab, /if \(onBook && loaded\) onBook\(/);
  assert.match(tab, /navigate\(`\/client\/\$\{c\.clientCode \|\| c\.id\}`, \{ state: \{ openTab: 'payments' \} \}\)/);
});

test('the unused read routes that were removed stay removed', () => {
  const gone = [
    ['api/routes/crm-ops.js', ['/api/admin/crm/stale-leads', '/api/admin/crm/follow-up-due', '/api/admin/crm/work-queue']],
    ['api/routes/funnel.js', ['/api/admin/action-center', '/api/admin/support-inbox']],
    ['api/routes/analytics/sales.js', ['/api/admin/reports/lead-funnel']],
    ['api/routes/misc/analytics.js', ['/api/admin/analytics/conversion-funnel']],
    ['api/routes/admin/stafflists.js', ['/api/staff/my-collection-clients']],
    ['api/routes/misc/reminders.js', ['/api/admin/leads/due-today']],
    ['api/routes/hr/compensation.js', ['/api/staff/me/payslip']],
    ['api/routes/analytics/leads-scoring.js', ['/api/admin/leads/scoring/leaderboard']],
  ];
  for (const [file, routes] of gone) {
    const source = read(file);
    for (const route of routes) assert.ok(!source.includes(`router.get('${route}'`), `${file} serves ${route} again`);
  }
  // The one write route of the same file is untouched.
  assert.match(read('api/routes/crm-ops.js'), /router\.post\('\/api\/admin\/crm\/bulk-whatsapp'/);
});
