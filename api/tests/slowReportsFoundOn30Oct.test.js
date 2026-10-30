'use strict';

/**
 * 30 Oct 2026, measured on the lab at production scale (150,000 leads, 60,000 orders, 40,000 payments):
 *
 *   GET /api/admin/analytics/staff-performance   4.2 s for a month, 26 s for a year -> 0.2 s, and `leads_converted` stopped
 *                                                 counting each lead once per client-and-task pair of the same rep
 *                                                 (175,448 «converted» for a rep with 1,687)
 *   GET /api/admin/payments/review               2.8 s -> 0.3 s (the online-orders dedupe: NOT EXISTS -> two LEFT JOINs)
 *   GET /api/admin/crm/stale-leads               4.0 s -> 1.4 s (communications joined once, not grouped per lead)
 *   tagamoa_* tabs                               every list came with each of the six: they were listed nowhere
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

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

test('staff performance counts each figure by itself, per person, and joins them to the staff list', () => {
  const route = read('api/routes/misc/analytics.js');
  const body = route.slice(route.indexOf("router.get('/api/admin/analytics/staff-performance'"), route.indexOf("router.get('/api/admin/analytics/expenses'"));
  assert.ok(!/COUNT\(DISTINCT l\.id\)/.test(body), 'the leads were joined next to the clients and tasks again');
  assert.ok(!/LEFT JOIN leads l ON/.test(body));
  for (const alias of ['ls', 'ss', 'rv', 'ts']) assert.ok(body.includes(`) ${alias} ON ${alias}.sid = st.id`), alias);
});

test('the online orders without a twin payment are found by two LEFT JOINs, not NOT EXISTS', () => {
  const payments = read('api/routes/payments.js');
  assert.ok(payments.includes('FORCE INDEX (idx_orders_tenant_status_created)'));
  assert.ok(payments.includes('p1.id IS NULL AND p2.id IS NULL'));
  // The index the hint names has to be created by a migration, or the hint is a 500.
  const created = fs.readdirSync(path.join(ROOT, 'api', 'migrations'))
    .some(file => fs.readFileSync(path.join(ROOT, 'api', 'migrations', file), 'utf8').includes('idx_orders_tenant_status_created'));
  assert.ok(created, 'idx_orders_tenant_status_created is created by no migration');
});

test('the stale leads read each lead\'s newest message once, not through a grouped join', () => {
  const route = read('api/routes/crm-ops.js');
  const body = route.slice(route.indexOf("router.get('/api/admin/crm/stale-leads'"), route.indexOf("router.get('/api/admin/crm/follow-up-due'"));
  assert.ok(!/LEFT JOIN communications c ON/.test(body));
  assert.ok(!/GROUP BY l\.id/.test(body));
  assert.ok(body.includes('SELECT lead_id, MAX(date) AS last_date FROM communications'));
});
