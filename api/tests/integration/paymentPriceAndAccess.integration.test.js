'use strict';
/**
 * What a manual payment records as the price, and what it opens, on a real MariaDB through POST /api/admin/subscriber-payments (these were regular expressions over
 * routes/subscriber-payments.js, `resolvedExpected` and `paysForItem` lines): with no price stated the client's own price is taken, else the catalogue's, else the amount
 * paid; a figure a screen sends that is not the server's is refused («السعر اتغير») unless the caller may set a client price and says so on purpose, and then it becomes the
 * client's price; a part of the price opens part of the course, the whole opens it all; a carnet or a book is not the course's money and opens nothing.
 * Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-payprice-it';
let pool; let router; let seq = 0;

const OWNER = { isSuperAdmin: true, staffRecord: null };
const REP = { isSuperAdmin: false, staffRecord: { id: 'st-pp-rep', name: 'مندوب', role: 'sales', permissions_json: '["manage_payments","manage_financial"]' } };

const REP_PENDING = { isSuperAdmin: false, staffRecord: { id: 'st-pp-rep', name: 'مندوب', role: 'sales', permissions_json: '["manage_payments"]' } };

async function post(who, subscriber, payment) {
  const layer = router.stack.find(item => item.route?.path === '/api/admin/subscriber-payments' && item.route.methods.post);
  assert.ok(layer);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  seq += 1;
  const req = { params: {}, body: { subscriber_id: subscriber, payment: { currency: 'EGP', paymentMethod: 'كاش', status: 'paid', transactionId: `TX-PP-${seq}`, ...payment } }, query: {}, headers: {}, tenantId: T, user: { uid: 'u', email: 'boss@example.test' }, ip: '127.0.0.1', get: () => undefined, ...who };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}

async function clean() {
  await pool.query('DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE tenant_id=?)', [T]).catch(() => {});
  for (const table of ['journal_entries', 'payment_audit_log', 'financial_audit_log', 'crm_commissions', 'instructor_fees', 'entitlement_events', 'enrollments', 'client_item_money', 'outbox',
    'installment_plans', 'installment_entries', 'orders', 'payments', 'subscribers', 'courses', 'staff', 'tenant_settings']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}
const sub = (id, phone) => pool.query("INSERT INTO subscribers (id, tenant_id, name, phone, branch, branch_id) VALUES (?, ?, 'عميل', ?, 'ONLINE_EGYPT', 'branch-online-egypt')", [id, T, phone]);
const expected = async id => Number((await pool.query('SELECT course_expected FROM payments WHERE id=?', [id]))[0][0].course_expected);
const access = async (subscriber, course) => (await pool.query('SELECT access_type FROM enrollments WHERE tenant_id=? AND subscriber_id=? AND course_id=?', [T, subscriber, course]))[0][0]?.access_type;

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  router = require('../../routes/subscriber-payments');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [T, T]);
  await pool.query(
    `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES ('st-pp-rep', ?, 'مندوب', 'rep-pp@example.test', '1019400001', 'SALES', 1, '2025-01-01')`, [T]);
  await pool.query(
    `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, price_egp) VALUES
       ('co-pp-1', ?, 'كورس', '', '', '', '', 'GENERAL', 'RECORDED', 3000), ('co-pp-free', ?, 'بلا سعر', '', '', '', '', 'GENERAL', 'RECORDED', 0)`, [T, T]);
  for (let i = 1; i <= 10; i += 1) await pool.query("INSERT INTO course_lectures (id, course_id, title, lecture_type, video_url, sort_order, is_published) VALUES (?, 'co-pp-1', ?, 'RECORDED', '', ?, 1)", [`lec-pp-${i}`, `محاضرة ${i}`, i]);
});
after(async () => {
  if (!ENABLED) return;
  await pool.query("DELETE FROM course_lectures WHERE course_id='co-pp-1'").catch(() => {});
  await clean();
  await pool.end();
});

test('with no price stated the catalogue\'s is recorded, a part of it opens part of the course, and the rest opens all of it', { skip }, async () => {
  await sub('sub-pp-1', '01019400011');
  const first = await post(OWNER, 'sub-pp-1', { amount: 1000, paymentType: 'course', courseId: 'co-pp-1' });
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  assert.equal(await expected(first.body.id), 3000, 'the catalogue price, not the 1,000 paid');
  assert.equal(await access('sub-pp-1', 'co-pp-1'), 'limited', 'a deposit opens the first payment\'s videos, not the course');
  const rest = await post(OWNER, 'sub-pp-1', { amount: 2000, paymentType: 'course', courseId: 'co-pp-1' });
  assert.equal(rest.statusCode, 200, JSON.stringify(rest.body));
  assert.equal(await access('sub-pp-1', 'co-pp-1'), 'full', 'paid up, the whole course');
});

test('a course with no price anywhere records the amount paid as its price, not zero', { skip }, async () => {
  await sub('sub-pp-2', '01019400012');
  const res = await post(OWNER, 'sub-pp-2', { amount: 700, paymentType: 'course', courseId: 'co-pp-free' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(await expected(res.body.id), 700);
  assert.equal(await access('sub-pp-2', 'co-pp-free'), 'full', 'a price nobody knows is not measured: the payment opens the course');
});

test('a price the client already holds wins; a figure from an old screen is refused, and the owner changing it on purpose becomes the client\'s price', { skip }, async () => {
  await sub('sub-pp-3', '01019400013');
  const set = await post(OWNER, 'sub-pp-3', { amount: 500, paymentType: 'course', courseId: 'co-pp-1', courseExpected: 2500, customPrice: true });
  assert.equal(set.statusCode, 200, JSON.stringify(set.body));
  assert.equal(await expected(set.body.id), 2500);
  const { agreedPrice } = require('../../lib/agreedPrice');
  assert.equal(await agreedPrice(pool, { tenantId: T, subscriberId: 'sub-pp-3', courseId: 'co-pp-1', currency: 'EGP' }), 2500, 'it is the client\'s price from now on');
  const next = await post(OWNER, 'sub-pp-3', { amount: 500, paymentType: 'course', courseId: 'co-pp-1' });
  assert.equal(await expected(next.body.id), 2500, 'a payment that states nothing takes the client\'s price');
  const stale = await post(OWNER, 'sub-pp-3', { amount: 500, paymentType: 'course', courseId: 'co-pp-1', courseExpected: 3000 });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.body.code, 'PRICE_CHANGED');
  assert.equal(stale.body.price, 2500, 'told the price the server holds');
  const again = await post(OWNER, 'sub-pp-3', { amount: 500, paymentType: 'course', courseId: 'co-pp-1', courseExpected: 2000, customPrice: true });
  assert.equal(again.statusCode, 200, JSON.stringify(again.body));
  assert.equal(await agreedPrice(pool, { tenantId: T, subscriberId: 'sub-pp-3', courseId: 'co-pp-1', currency: 'EGP' }), 2000);
  const instalment = await post(OWNER, 'sub-pp-3', { amount: 300, paymentType: 'course', courseId: 'co-pp-1', isInstallment: true });
  assert.equal(instalment.statusCode, 200, JSON.stringify(instalment.body));
  assert.equal(await expected(instalment.body.id), 2000, 'an instalment records the client price for the course, never its own amount');
});

test('someone who may not set a client price cannot change one: the browser\'s number is never taken silently', { skip }, async () => {
  await sub('sub-pp-4', '01019400014');
  await pool.query("UPDATE subscribers SET assigned_sales_id='st-pp-rep' WHERE id='sub-pp-4'");
  const refused = await post(REP, 'sub-pp-4', { amount: 500, paymentType: 'course', courseId: 'co-pp-1', courseExpected: 1800, customPrice: true });
  assert.equal(refused.statusCode, 409, JSON.stringify(refused.body));
  assert.equal(refused.body.code, 'PRICE_CHANGED');
  assert.equal(refused.body.price, 3000);
  const [[none]] = await pool.query("SELECT COUNT(*) AS n FROM payments WHERE tenant_id=? AND subscriber_id='sub-pp-4'", [T]);
  assert.equal(Number(none.n), 0, 'nothing was recorded');
});

test('a carnet or a book names a course without being its money: no course price, no course opened', { skip }, async () => {
  await sub('sub-pp-5', '01019400015');
  const carnet = await post(OWNER, 'sub-pp-5', { amount: 200, paymentType: 'carneh', courseId: 'co-pp-1' });
  assert.equal(carnet.statusCode, 200, JSON.stringify(carnet.body));
  assert.equal(await access('sub-pp-5', 'co-pp-1'), undefined, 'the course is not opened');
  const { itemBalances } = require('../../lib/agreedPrice');
  const line = (await itemBalances(pool, { tenantId: T, subscriberId: 'sub-pp-5' })).get('co-pp-1');
  assert.ok(!line || Number(line.paid) === 0, 'and the 200 is not paid on the course');
  const asInstalment = await post(OWNER, 'sub-pp-5', { amount: 100, paymentType: 'book', courseId: 'co-pp-1', isInstallment: true });
  const [[row]] = await pool.query('SELECT is_installment FROM payments WHERE id=?', [asInstalment.body.id]);
  assert.equal(Number(row.is_installment), 0, 'only a course is paid in instalments');
});

test('approving a pending booking measures it the same way: a deposit opens part, a carnet opens nothing', { skip }, async () => {
  const approval = require('../../routes/core/financepay');
  const approve = async id => {
    const layer = approval.stack.find(item => item.route?.path === '/api/admin/payments/:id/status' && item.route.methods.patch);
    const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
    const req = { params: { id }, body: { status: 'paid' }, query: {}, headers: {}, tenantId: T, user: { uid: 'u', email: 'boss@example.test' }, ip: '127.0.0.1', get: () => undefined, ...OWNER };
    for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name))) {
      let advanced = false;
      await handle(req, res, () => { advanced = true; });
      if (!advanced) break;
    }
    return res;
  };
  await sub('sub-pp-6', '01019400016');
  await pool.query("UPDATE subscribers SET assigned_sales_id='st-pp-rep' WHERE id='sub-pp-6'");
  const deposit = await post(REP_PENDING, 'sub-pp-6', { amount: 1000, paymentType: 'course', courseId: 'co-pp-1' });
  assert.equal(deposit.statusCode, 200, JSON.stringify(deposit.body));
  assert.equal(await access('sub-pp-6', 'co-pp-1'), undefined, 'pending, nothing is open yet');
  assert.equal((await approve(deposit.body.id)).statusCode, 200);
  assert.equal(await access('sub-pp-6', 'co-pp-1'), 'limited', 'approved, the deposit opens the first payment\'s videos');

  await sub('sub-pp-7', '01019400017');
  await pool.query("UPDATE subscribers SET assigned_sales_id='st-pp-rep' WHERE id='sub-pp-7'");
  const carnet = await post(REP_PENDING, 'sub-pp-7', { amount: 200, paymentType: 'carneh', courseId: 'co-pp-1' });
  assert.equal((await approve(carnet.body.id)).statusCode, 200);
  assert.equal(await access('sub-pp-7', 'co-pp-1'), undefined, 'approving a carnet opens no course');
});
