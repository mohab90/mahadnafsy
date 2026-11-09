'use strict';

// 3 Nov 2026, «قاعدة العملاء الموحدة … الإجمالي 989 · مشتركون 505 … دي غلط تماما لازم يسمع في القاعدة كل عملاء السيستم»: the screen counted the 500 clients and the
// 500 leads its browser had loaded. Its numbers and its table are the server's now (api/routes/misc/clientDbList.js; the real SQL runs in
// tests/integration/clientDbList.integration.test.js). «قاعدة العملاء» and the Dokki and online client screens stay as they are: they read one table.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = rel => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');







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
  
});
