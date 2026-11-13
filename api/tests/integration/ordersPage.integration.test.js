'use strict';
/**
 * 6 Nov 2026: GET /api/admin/orders/page — «الطلبات والمدفوعات» one page at a time, its tabs, totals and head figures counted by the database — against a real MariaDB,
 * on a small ledger worked out by hand, with the old route (GET /api/admin/orders: the merged list the browser used to filter and add up) as the reference.
 *
 * The reference side runs the screen's own arithmetic (admin/pages/dashboard/tabs/orders/ordersDeskMath.ts, bundled with esbuild) over the old merged list; for every
 * filter the pages must give the same tab counts, the same rows and the same per-currency totals. Also: a payment an order already covers is listed once (unless it is
 * still pending), a deleted order or payment is in no count, pages of at most 100, the head figures are the whole book whatever the filters say, a scope that sees
 * nothing answers an empty desk, and an account without view_orders is refused. Runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const ROOT = path.join(__dirname, '..', '..', '..');
const T = 'tenant-orders-page-it';
let pool, pageRouter, listRouter, math;

async function call(router, route, query = {}, user = { uid: 'admin' }) {
  const layer = router.stack.find(l => l.route?.path === route && l.route.methods.get);
  const res = { statusCode: 200, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, set(k, v) { this.headers[k] = v; return this; } };
  await layer.route.stack.at(-1).handle({ params: {}, query, body: {}, headers: {}, tenantId: T, user, staffRecord: null, isSuperAdmin: true, ip: '127.0.0.1', get: () => undefined }, res);
  return res;
}
const page = async (query = {}) => { const res = await call(pageRouter, '/api/admin/orders/page', { pageSize: '100', ...query }); assert.equal(res.statusCode, 200, JSON.stringify(res.body)); return res.body; };

async function clean() {
  for (const t of ['payment_proofs', 'payments', 'orders', 'subscribers', 'staff']) await pool.query(`DELETE FROM ${t} WHERE tenant_id=?`, [T]).catch(() => {});
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  pageRouter = require('../../routes/orders-page');
  listRouter = require('../../routes/orders');
  const esbuild = require(path.join(ROOT, 'admin', 'node_modules', 'esbuild'));
  const bundled = esbuild.buildSync({
    stdin: {
      contents: "export { filterOrders, tabOf, sameMethod } from './pages/dashboard/tabs/orders/ordersDeskMath'; export { normalizeOrders } from './context/site-data-hooks/normalizeOrders';",
      resolveDir: path.join(ROOT, 'admin'), loader: 'ts',
    },
    bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent', nodePaths: [path.join(ROOT, 'admin', 'node_modules')], define: { 'import.meta.env': '{}' },
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', bundled.outputFiles[0].text)(module, module.exports, require);
  math = module.exports;

  await clean();
  await pool.query(`INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES ('op-st-1', ?, 'منى المحاسبة', 'op1@x.test', '1017770001', 'ACCOUNTANT', 1, '2025-01-01')`, [T]);
  await pool.query(`INSERT INTO subscribers (id, tenant_id, client_code, name, phone) VALUES ('op-sub-1', ?, 'OP1', 'هبة', '1017770002'), ('op-sub-2', ?, 'OP2', 'سلمى', '1017770003')`, [T, T]);
  const order = (id, type, status, amount, currency, method, name, txn, at, deleted) =>
    [id, T, type, `item-${id}`, `خدمة ${id}`, amount, currency, method, name, status, txn, at, deleted];
  await pool.query(
    `INSERT INTO orders (id, tenant_id, type, item_id, item_title, amount, currency, payment_method, customer_name, status, transaction_id, created_at, deleted_at) VALUES ?`,
    [[
      order('op-o1', 'COURSE', 'PAID', 1000, 'EGP', 'PAYMOB', 'عميل أ', 'TX-O1', '2026-11-02 10:00:00', null),
      order('op-o2', 'COURSE', 'PENDING', 1500, 'EGP', 'TRANSFER', 'عميل ب', 'TX-O2', '2026-11-03 10:00:00', null),
      order('op-o3', 'BUNDLE', 'PAID', 200, 'SAR', 'CARD', 'عميل ج', null, '2026-11-04 10:00:00', null),
      order('op-o4', 'CONSULTATION', 'FAILED', 300, 'EGP', 'CARD', 'عميل د', null, '2026-11-04 12:00:00', null),
      order('op-o5', 'COURSE', 'REFUNDED', 400, 'EGP', 'TRANSFER', 'عميل هـ', null, '2026-11-01 08:00:00', null),
      order('op-o6', 'COURSE', 'PAID', 999, 'EGP', 'CARD', 'عميل محذوف', null, '2026-11-02 08:00:00', '2026-11-03 00:00:00'),
    ]]);
  const payment = (id, sub, type, status, amount, method, txn, date, staff, deleted) =>
    [id, T, sub, amount, amount, 'EGP', type, method, status, txn, date, staff, deleted];
  await pool.query(
    `INSERT INTO payments (id, tenant_id, subscriber_id, amount, amount_egp, currency, payment_type, payment_method, status, transaction_id, date, staff_id, deleted_at) VALUES ?`,
    [[
      payment('op-p1', 'op-sub-1', 'COURSE', 'paid', 2000, 'CASH', 'TX-O1', '2026-11-01', null, null),        // the order op-o1 already covers it
      payment('op-p2', 'op-sub-1', 'COURSE', 'paid', 700, 'TRANSFER', 'TX-P2', '2026-11-02', null, null),
      payment('op-p3', 'op-sub-2', 'COURSE', 'pending', 500, 'TRANSFER', 'TX-O2', '2026-11-05', null, null), // the pending order op-o2 has this reference, but a payment still waiting is listed
      payment('op-p4', 'op-sub-1', 'CERTIFICATE', 'paid', 100, 'CASH', null, '2026-11-05', 'op-st-1', null),
      payment('op-p5', 'op-sub-2', 'COURSE', 'refunded', 250, 'CASH', null, '2026-11-03', null, null),
      payment('op-p6', 'op-sub-1', 'COURSE', 'paid', 888, 'CASH', null, '2026-11-02', null, '2026-11-03 00:00:00'),
    ]]);
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

const sumByCurrency = rows => rows.reduce((acc, row) => { acc[row.currency] = Math.round(((acc[row.currency] || 0) + row.amount) * 100) / 100; return acc; }, { EGP: 0, SAR: 0, USD: 0 });
const ids = rows => rows.map(row => row.id).sort();

test('the ledger worked out by hand: the three tabs, their sizes and what they add up to', { skip }, async () => {
  const review = await page({ tab: 'review' });
  assert.deepEqual(review.counts, { review: 2, accepted: 4, failed: 3 });
  assert.deepEqual(ids(review.rows), ['op-o2', 'op-p3']);
  assert.deepEqual(review.totals, { EGP: 2000, SAR: 0, USD: 0 });
  assert.equal(review.rows[0].id, 'op-p3', 'the desk\'s own payments come first in «قيد المراجعة»');
  assert.equal(review.rows[0].source, 'crm');

  const accepted = await page({ tab: 'accepted' });
  assert.deepEqual(ids(accepted.rows), ['op-o1', 'op-o3', 'op-p2', 'op-p4']);
  assert.deepEqual(accepted.totals, { EGP: 1800, SAR: 200, USD: 0 });
  assert.ok(!accepted.rows.some(row => row.id === 'op-p1'), 'a payment the order TX-O1 already covers is listed once');

  const failed = await page({ tab: 'failed' });
  assert.deepEqual(ids(failed.rows), ['op-o4', 'op-o5', 'op-p5']);
  assert.deepEqual(failed.totals, { EGP: 950, SAR: 0, USD: 0 });
  for (const body of [review, accepted, failed]) assert.ok(!ids(body.rows).some(id => id === 'op-o6' || id === 'op-p6'), 'a deleted order or payment is in no tab');
});

test('the head of the screen is the whole book, whatever the filters say', { skip }, async () => {
  const filtered = await page({ tab: 'accepted', type: 'certificate', q: 'هبة' });
  const book = await page({ tab: 'accepted' });
  assert.deepEqual(filtered.stats, book.stats, 'the head figures ignore every filter');
  assert.equal(book.stats.total, 9);
  assert.equal(book.stats.paid, 4);
  assert.equal(book.stats.pending, 2);
  assert.equal(book.stats.failed, 1);
  assert.equal(book.stats.refunded, 2);
  assert.deepEqual(book.stats.revenue, { EGP: 1800, SAR: 200, USD: 0 });
  assert.equal(book.stats.daily.length, 7);
  assert.ok(book.facets.staff.includes('منى المحاسبة'));
  assert.ok(book.facets.methods.includes('TRANSFER') && book.facets.methods.includes('CASH'));
});

test('against the old merged list, for every filter: the same rows, the same counts, the same totals', { skip }, async () => {
  const old = math.normalizeOrders(JSON.parse(JSON.stringify((await call(listRouter, '/api/admin/orders', { limit: '500' })).body)));
  assert.equal(old.length, 9, 'five orders and four payments: the payment an order covers is already dropped by the old merge');
  const reference = old;
  const none = { search: '', status: 'all', type: 'all', method: 'all', staff: 'all', from: '', to: '' };
  const methods = (await page({ tab: 'review' })).facets.methods;
  const cases = [
    { name: 'no filter', query: {}, filters: {} },
    { name: 'a type', query: { type: 'certificate' }, filters: { type: 'certificate' } },
    { name: 'another type', query: { type: 'course' }, filters: { type: 'course' } },
    { name: 'a client\'s name', query: { q: 'هبة' }, filters: { search: 'هبة' } },
    { name: 'a service title', query: { q: 'op-o3' }, filters: { search: 'op-o3' } },
    { name: 'who recorded it', query: { staff: 'منى المحاسبة' }, filters: { staff: 'منى المحاسبة' } },
    { name: 'a date range', query: { from: '2026-11-02', to: '2026-11-04' }, filters: { from: '2026-11-02', to: '2026-11-04' } },
    { name: 'one day', query: { from: '2026-11-05', to: '2026-11-05' }, filters: { from: '2026-11-05', to: '2026-11-05' } },
    {
      name: 'a method, every spelling of it',
      query: { methods: methods.filter(raw => math.sameMethod(raw, 'bank_transfer')).join(String.fromCharCode(31)) },
      filters: { method: 'bank_transfer' },
    },
    { name: 'a method nothing was paid with', query: { methods: '' }, filters: { method: 'instapay' } },
  ];
  for (const { name, query, filters } of cases) {
    const filtered = math.filterOrders(reference, { ...none, ...filters });
    for (const tab of ['review', 'accepted', 'failed']) {
      const expected = math.tabOf(filtered, tab);
      const got = await page({ tab, ...query });
      assert.equal(got.total, expected.length, `${name} / ${tab}: how many`);
      assert.equal(got.counts[tab], expected.length, `${name} / ${tab}: the tab's count`);
      assert.deepEqual(ids(got.rows.map(row => ({ id: row.id }))), ids(expected), `${name} / ${tab}: which rows`);
      assert.deepEqual(got.totals, sumByCurrency(expected), `${name} / ${tab}: what they add up to`);
    }
  }
});

test('pages of at most 100: put together they are the tab, newest first, nothing twice', { skip }, async () => {
  const seen = [];
  for (let at = 0; at < 4; at++) {
    const body = await page({ tab: 'accepted', pageSize: '3', page: String(at) });
    assert.ok(body.rows.length <= 3);
    seen.push(...body.rows.map(row => row.id));
  }
  assert.equal(new Set(seen).size, seen.length, 'no row on two pages');
  assert.deepEqual([...seen].sort(), ['op-o1', 'op-o3', 'op-p2', 'op-p4']);
  const times = (await page({ tab: 'accepted' })).rows.map(row => new Date(row.created_at).getTime());
  assert.deepEqual(times, [...times].sort((a, b) => b - a), 'newest first');
  assert.equal((await page({ tab: 'accepted', pageSize: '9999' })).pageSize, 100, 'a page is never more than 100');
  assert.equal((await page({ tab: 'accepted', amount: '700' })).total, 1, 'the rows of one amount, for linking a transfer');
});

test('a branch asks for its own rows, an unknown one is refused, and the door is view_orders', { skip }, async () => {
  const daqqi = await page({ tab: 'accepted', branch: 'DAQQI' });
  assert.equal(daqqi.total, 0, 'the ledger holds nothing of that branch');
  assert.equal(daqqi.stats.total, 0, 'and the head figures are the branch own');
  const unknown = await call(pageRouter, '/api/admin/orders/page', { branch: 'branch-nowhere-it' });
  assert.equal(unknown.statusCode, 400, 'a branch nobody knows is refused, not answered with everything');
  const source = require('node:fs').readFileSync(path.join(__dirname, '..', '..', 'routes', 'orders-page.js'), 'utf8');
  assert.ok(source.includes("requirePermission('view_orders')"), 'the same door as GET /api/admin/orders');
});

test('12 Nov 2026: each row says whether its client is new — nothing paid before that row\'s day — or old; a row with no client says neither', { skip }, async () => {
  const all = [...(await page({ tab: 'accepted' })).rows, ...(await page({ tab: 'review' })).rows, ...(await page({ tab: 'failed' })).rows];
  const flag = id => all.find(row => row.id === id)?.client_is_new;
  // op-sub-1 first paid on 1 Nov (op-p1): what they paid on the 2nd and the 5th is an old client's money.
  assert.equal(flag('op-p2'), false);
  assert.equal(flag('op-p4'), false);
  // op-sub-2 has never had a paid payment: the one waiting is a new client's.
  assert.equal(flag('op-p3'), true);
  // An order that names no client record says neither.
  assert.equal(flag('op-o1'), null);
});

test('13 Nov 2026: what is waiting is listed as it was recorded, and is found by what the transfer says', { skip }, async () => {
  // Two more payments waiting: one taken long ago and typed in just now, one dated today but recorded yesterday.
  await pool.query(
    `INSERT INTO payments (id, tenant_id, subscriber_id, amount, amount_egp, currency, payment_type, payment_method, status, transaction_id, sender_name, from_account, date, created_at) VALUES
       ('op-p8', ?, 'op-sub-1', 300, 300, 'EGP', 'COURSE', 'TRANSFER', 'pending', 'OPREF-88001', 'محمود المحوّل', '01055550001', '2026-08-01', NOW()),
       ('op-p9', ?, 'op-sub-2', 400, 400, 'EGP', 'COURSE', 'TRANSFER', 'pending', 'OPREF-99002', NULL, NULL, CURDATE(), NOW() - INTERVAL 1 DAY)`, [T, T]);
  const review = await page({ tab: 'review' });
  const order = review.rows.filter(row => row.source === 'crm').map(row => row.id);
  assert.ok(order.indexOf('op-p8') < order.indexOf('op-p9'), `the one recorded last is first, whatever day it is dated: ${order.join(', ')}`);
  assert.equal(order[0], 'op-p8');

  const found = async q => ids((await page({ tab: 'review', q })).rows);
  assert.deepEqual(await found('OPREF-88001'), ['op-p8'], 'by the operation number');
  assert.deepEqual(await found('المحوّل'), ['op-p8'], 'by who sent it');
  assert.deepEqual(await found('01055550001'), ['op-p8'], 'by the number it came from');
  assert.ok((await found('01017770003')).includes('op-p9'), 'by the client\'s phone as people say it, with its leading zero');
  assert.ok((await found('OP2')).includes('op-p9'), 'by the client\'s code');
  assert.deepEqual(await found('no-such-thing-xyz'), []);
  await pool.query("DELETE FROM payments WHERE tenant_id=? AND id IN ('op-p8','op-p9')", [T]);
});
