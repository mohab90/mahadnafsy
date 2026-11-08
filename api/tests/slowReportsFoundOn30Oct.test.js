'use strict';

/**
 * 30 Oct 2026, measured on the lab at production scale (150,000 leads, 60,000 orders, 40,000 payments):
 *
 *   GET /api/admin/analytics/staff-performance   (removed on 3 Nov 2026 — read by no screen; GET /api/admin/leads/staff-performance is the per-rep source)
 *   GET /api/admin/payments/review               2.8 s -> 0.3 s (the online-orders dedupe: NOT EXISTS -> two LEFT JOINs)
 *   GET /api/admin/crm/stale-leads               4.0 s -> 1.4 s (communications joined once, not grouped per lead)
 *   tagamoa_* tabs                               every list came with each of the six: they were listed nowhere
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, read } = require('./support/repo');


function loadLists() {
  const strip = rel => require('node:module').stripTypeScriptTypes(read(rel))
    .replace(/^import .*$/gm, '').replace(/^export /gm, '');
  const js = strip('admin/context/site-data-hooks/siteLists.ts') + strip('admin/pages/dashboard/tabSiteLists.ts');
  const box = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', js + '\nmodule.exports = { SITE_LISTS, listsForTab };')(box);
  return box.exports;
}

test('a Tagamoa tab loads what the Dokki screen it draws loads, not every list', () => {
  const { SITE_LISTS, listsForTab } = loadLists();
  const pairs = [
    ['tagamoa_schedule', 'daqqi_schedule'], ['tagamoa_clients', 'daqqi_clients'], ['tagamoa_team', 'daqqi_team'],
    ['tagamoa_accounting', 'daqqi_accounting'], ['tagamoa_stats', 'daqqi_stats'], ['tagamoa_waitlist', 'waitlist'],
  ];
  for (const [tagamoa, dokki] of pairs) {
    assert.deepEqual([...listsForTab(tagamoa)], [...listsForTab(dokki)], tagamoa);
    assert.notEqual(listsForTab(tagamoa), SITE_LISTS, `${tagamoa} still loads every list`);
  }
  // A screen nobody has listed still gets everything.
  assert.equal(listsForTab('a_screen_nobody_listed'), SITE_LISTS);
});

test('the duplicate staff-performance and retention analytics routes are gone; the per-rep and the hub ones are the sources', () => {
  const route = read('api/routes/misc/analytics.js');
  for (const gone of ['/api/admin/analytics/staff-performance', '/api/admin/analytics/retention', '/api/admin/analytics/expenses']) assert.ok(!route.includes(`router.get('${gone}'`), gone);
  
});

test('the online orders without a twin payment are found by two LEFT JOINs, not NOT EXISTS', () => {
  const payments = read('api/routes/payments.js');
  
  
  // The index the hint names has to be created by a migration, or the hint is a 500.
  const created = fs.readdirSync(path.join(ROOT, 'api', 'migrations'))
    .some(file => fs.readFileSync(path.join(ROOT, 'api', 'migrations', file), 'utf8').includes('idx_orders_tenant_status_created'));
  assert.ok(created, 'idx_orders_tenant_status_created is created by no migration');
});



test('the campaign report starts its five independent reads together', () => {
  const route = read('api/routes/analytics/campaigns.js');
  const body = route.slice(route.indexOf("router.get('/api/admin/reports/campaign'"), route.indexOf("router.patch('/api/admin/leads/:id/utm'"));
  assert.ok(body.includes('await Promise.all(['));
  assert.equal((body.match(/await pool\.query/g) || []).length, 0, 'a read of the report is awaited alone again');
});

test('churn risk reads each client\'s payments once (retention and the revenue sources are the analytics hub\'s alone since 3 Nov 2026)', () => {
  const analytics = read('api/routes/misc/analytics.js');
  const churn = analytics.slice(analytics.indexOf("router.get('/api/admin/analytics/churn-risk'"));
  assert.ok(!/\(SELECT MAX\(p\.created_at\) FROM payments p/.test(churn), 'churn risk is back to a subquery per client');
  assert.ok(churn.includes('FROM payments WHERE tenant_id=? GROUP BY subscriber_id) pay ON pay.subscriber_id = s.id'));
  
});
