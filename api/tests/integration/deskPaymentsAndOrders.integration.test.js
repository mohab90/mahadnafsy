'use strict';
/**
 * Money the desk records and approves, over HTTP on the real app with signed-in
 * staff, against a real MariaDB.
 *
 * Recording (POST /api/admin/subscriber-payments): a settled payment names its
 * method, a pending one may not yet; a rep's «paid» waits for approval; the
 * branch chosen is the branch stored; a course payment names its course; the
 * sender and account travel with it; a reference used before is refused by
 * name — and never with another institute's client's name.
 * Approving (PATCH /api/admin/payments/:id/status): the method can be
 * supplied then and is kept; a rejection needs a reason, not a method; an
 * accountant ties a transfer to it, and a transfer pays one payment only.
 * Orders: reading needs view_orders, the generic edit cannot mark money paid,
 * the person who recorded an order cannot confirm it, and an order is
 * confirmed once. Replaces the source-text checks on routes/subscriber-payments.js,
 * routes/core/financepay.js and routes/orders.js.
 * Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
const skip = !ENABLED && 'no DB_* configured';
const { startApp, signInStaff, ensureTenant } = require('./support/http');

const T = 'tenant-desk-it';
const OTHER = 'tenant-desk-other-it';
const COURSE = 'co-desk-1';
let pool; let app; let admin; let accountant; let rep; let hr; let otherAdmin; let dokki;

const one = async (sql, params) => (await pool.query(sql, params))[0][0];
// Each call a note of its own: two payments identical in every field on one day
// are refused as a double entry (tested below).
let recorded = 0;
const record = (session, payment, subscriber = 'sub-desk-1') => app.call('POST', '/api/admin/subscriber-payments', {
  session,
  body: { subscriber_id: subscriber, payment: { amount: 500, currency: 'EGP', paymentType: 'COURSE', courseId: COURSE, note: `n${++recorded}`, ...payment } },
});
const setStatus = (session, id, body) => app.call('PATCH', `/api/admin/payments/${id}/status`, { session, body });

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  for (const tenant of [T, OTHER]) {
    await ensureTenant(pool, tenant);
    await pool.query(
      `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, price_egp)
       VALUES (?, ?, 'كورس المكتب', '', '', '', '', 'GENERAL', 'RECORDED', 3000)`, [tenant === T ? COURSE : 'co-desk-other', tenant]);
  }
  await pool.query(
    `INSERT INTO subscribers (id, tenant_id, name, phone, email, branch, branch_id, is_active, created_at) VALUES
       ('sub-desk-1', ?, 'عميلة أونلاين', '01033300001', 'desk1@example.test', 'ONLINE_EGYPT', 'branch-online-egypt', 1, UTC_TIMESTAMP()),
       ('sub-desk-other', ?, 'عميلة معهد تاني', '01033300009', 'deskother@example.test', 'ONLINE_EGYPT', 'branch-online-egypt', 1, UTC_TIMESTAMP())`,
    [T, OTHER]);
  app = await startApp(pool);
  admin = await signInStaff(pool, app, { tenantId: T, id: 'st-desk-admin', role: 'ADMIN', name: 'المدير' });
  accountant = await signInStaff(pool, app, { tenantId: T, id: 'st-desk-acc', role: 'ACCOUNTANT', name: 'المحاسب' });
  rep = await signInStaff(pool, app, { tenantId: T, id: 'st-desk-rep', role: 'SALES', name: 'المندوبة' });
  hr = await signInStaff(pool, app, { tenantId: T, id: 'st-desk-hr', role: 'HR', name: 'HR', permissions: ['view_dashboard', 'view_staff'] });
  otherAdmin = await signInStaff(pool, app, { tenantId: OTHER, id: 'st-desk-other', role: 'ADMIN', name: 'مدير تاني' });
  dokki = await signInStaff(pool, app, { tenantId: T, id: 'st-desk-dokki', role: 'DAQQI_MANAGER', name: 'مديرة الدقي', branchId: 'branch-daqqi' });
  await pool.query("UPDATE subscribers SET assigned_sales_id='st-desk-rep' WHERE id='sub-desk-1'");
});

after(async () => {
  if (!ENABLED) return;
  if (app) await app.close();
  await pool.end().catch(() => {});
});

test('a settled payment names its method; a pending one may not know it yet', { skip }, async () => {
  const settled = await record(admin, { status: 'paid' });
  assert.equal(settled.status, 400, settled.text);
  const pending = await record(admin, { id: 'pay-desk-pending', status: 'pending' });
  assert.equal(pending.status, 200, pending.text);
  const row = await one("SELECT status, payment_method FROM payments WHERE id='pay-desk-pending'");
  assert.deepEqual({ ...row }, { status: 'pending', payment_method: null });
  const named = await record(admin, { id: 'pay-desk-named', status: 'paid', paymentMethod: 'cash' });
  assert.equal(named.status, 200, named.text);
  const stored = await one("SELECT status, payment_method FROM payments WHERE id='pay-desk-named'");
  assert.deepEqual({ ...stored }, { status: 'paid', payment_method: 'cash' }, 'the method validated is the method stored');
});

test('a rep\'s «paid» waits for someone who may approve money', { skip }, async () => {
  const res = await record(rep, { id: 'pay-desk-rep', status: 'paid', paymentMethod: 'cash' });
  assert.equal(res.status, 200, res.text);
  const row = await one("SELECT status, staff_id FROM payments WHERE id='pay-desk-rep'");
  assert.equal(row.status, 'pending');
  assert.equal(row.staff_id, 'st-desk-rep', 'recorded as the rep\'s');
  const own = await setStatus(rep, 'pay-desk-rep', { status: 'paid' });
  assert.equal(own.status, 403, 'a rep does not approve money at all');
});

test('the branch chosen on the payment is the one stored; none named is the client\'s, a made-up one is refused', { skip }, async () => {
  const chosen = await record(admin, { id: 'pay-desk-daqqi', status: 'paid', paymentMethod: 'cash', branch: 'DAQQI' });
  assert.equal(chosen.status, 200, chosen.text);
  assert.equal((await one("SELECT branch FROM payments WHERE id='pay-desk-daqqi'")).branch, 'DAQQI');
  assert.equal((await one("SELECT branch FROM subscribers WHERE id='sub-desk-1'")).branch, 'ONLINE_EGYPT', 'the client keeps their own');
  const unnamed = await record(admin, { id: 'pay-desk-unnamed', status: 'paid', paymentMethod: 'cash' });
  assert.equal(unnamed.status, 200, unnamed.text);
  assert.equal((await one("SELECT branch FROM payments WHERE id='pay-desk-unnamed'")).branch, 'ONLINE_EGYPT',
    'no branch named: the client\'s own');
  // A branch that does not exist is the caller's mistake, said as one — it was a 500.
  const nonsense = await record(admin, { status: 'paid', paymentMethod: 'cash', branch: 'MARS' });
  assert.equal(nonsense.status, 400, nonsense.text);
  assert.equal(nonsense.body.code, 'INVALID_BRANCH');
});

test('a branch-bound desk cannot file money under another branch', { skip }, async () => {
  const res = await record(dokki, { status: 'pending', paymentMethod: 'cash', branch: 'TAGAMOA' });
  assert.equal(res.status, 403, res.text);
  const [rows] = await pool.query("SELECT id FROM payments WHERE tenant_id=? AND branch='TAGAMOA'", [T]);
  assert.equal(rows.length, 0);
});

test('a course payment names its course, an amount is a positive number', { skip }, async () => {
  const noCourse = await record(admin, { status: 'paid', paymentMethod: 'cash', courseId: null });
  assert.equal(noCourse.status, 400, noCourse.text);
  for (const amount of [0, -10, 'lots']) {
    const res = await record(admin, { status: 'paid', paymentMethod: 'cash', amount });
    assert.equal(res.status, 400, `${amount}: ${res.text}`);
    assert.equal(res.body.code, 'AMOUNT_INVALID');
  }
});

test('the same payment entered twice on one day is refused as a double entry', { skip }, async () => {
  const twin = { status: 'paid', paymentMethod: 'cash', amount: 777, note: 'مرة واحدة' };
  assert.equal((await record(admin, twin)).status, 200);
  const second = await record(admin, twin);
  assert.equal(second.status, 409, second.text);
  const [rows] = await pool.query("SELECT id FROM payments WHERE tenant_id=? AND amount=777", [T]);
  assert.equal(rows.length, 1);
});

test('the sender and the sending account travel with the payment', { skip }, async () => {
  const res = await record(admin, {
    id: 'pay-desk-sender', status: 'paid', paymentMethod: 'instapay', senderName: 'أحمد المحوّل', fromAccountNumber: '01099988877',
  });
  assert.equal(res.status, 200, res.text);
  const row = await one("SELECT sender_name, from_account FROM payments WHERE id='pay-desk-sender'");
  assert.equal(row.sender_name, 'أحمد المحوّل');
  assert.equal(row.from_account, '01099988877');
});

test('a reference used before is refused by name — and another institute\'s client is never named', { skip }, async () => {
  const first = await record(admin, { id: 'pay-desk-ref1', status: 'paid', paymentMethod: 'instapay', transactionId: 'REF-DESK-777' });
  assert.equal(first.status, 200, first.text);
  const again = await record(admin, { status: 'paid', paymentMethod: 'instapay', transactionId: 'REF-DESK-777' });
  assert.equal(again.status, 409, again.text);
  assert.equal(again.body.code, 'TRANSACTION_REFERENCE_IN_USE');
  assert.match(again.body.error, /عميلة أونلاين/, 'this desk is told whose payment holds it');

  const elsewhere = await app.call('POST', '/api/admin/subscriber-payments', {
    session: otherAdmin,
    body: { subscriber_id: 'sub-desk-other', payment: { amount: 500, currency: 'EGP', paymentType: 'COURSE', courseId: 'co-desk-other', status: 'paid', paymentMethod: 'instapay', transactionId: 'REF-DESK-777' } },
  });
  assert.equal(elsewhere.status, 409, elsewhere.text);
  assert.equal(elsewhere.body.code, 'TRANSACTION_REFERENCE_IN_USE');
  assert.doesNotMatch(elsewhere.body.error, /عميلة أونلاين/, 'another institute\'s client is not this desk\'s to read');
  assert.doesNotMatch(elsewhere.body.error, /500/);
});

test('an approver supplies a missing method, and it is kept', { skip }, async () => {
  const bare = await setStatus(admin, 'pay-desk-pending', { status: 'paid' });
  assert.equal(bare.status, 400, bare.text);
  assert.equal((await one("SELECT status FROM payments WHERE id='pay-desk-pending'")).status, 'pending');
  const supplied = await setStatus(admin, 'pay-desk-pending', { status: 'paid', paymentMethod: 'cash' });
  assert.equal(supplied.status, 200, supplied.text);
  const row = await one("SELECT status, payment_method FROM payments WHERE id='pay-desk-pending'");
  assert.deepEqual({ ...row }, { status: 'paid', payment_method: 'cash' });
});

test('a rejection needs a reason, and no method', { skip }, async () => {
  const pending = await record(admin, { id: 'pay-desk-reject', status: 'pending' });
  assert.equal(pending.status, 200, pending.text);
  const silent = await setStatus(accountant, 'pay-desk-reject', { status: 'failed' });
  assert.equal(silent.status, 400, silent.text);
  const said = await setStatus(accountant, 'pay-desk-reject', { status: 'failed', reviewNote: 'التحويل ماوصلش' });
  assert.equal(said.status, 200, said.text);
  assert.equal((await one("SELECT status FROM payments WHERE id='pay-desk-reject'")).status, 'failed');
});

test('an accountant ties a transfer to the payment, and a transfer pays one payment only', { skip }, async () => {
  for (const id of ['pay-desk-t1', 'pay-desk-t2']) {
    const res = await record(rep, { id, status: 'paid', paymentMethod: 'instapay' });
    assert.equal(res.status, 200, res.text);
  }
  const untied = await setStatus(accountant, 'pay-desk-t1', { status: 'paid' });
  assert.equal(untied.status, 400, untied.text);
  assert.equal(untied.body.code, 'TRANSFER_REQUIRED');
  const tied = await setStatus(accountant, 'pay-desk-t1', {
    status: 'paid', transfer: { amount: 500, currency: 'EGP', method: 'instapay', reference: 'IP-DESK-1', senderName: 'محوّل' },
  });
  assert.equal(tied.status, 200, tied.text);
  const transfer = await one("SELECT id, payment_id FROM incoming_transfers WHERE tenant_id=? AND reference='IP-DESK-1'", [T]);
  assert.equal(transfer.payment_id, 'pay-desk-t1');
  assert.equal((await one("SELECT linked_transfer_id FROM payments WHERE id='pay-desk-t1'")).linked_transfer_id, transfer.id);
  const reused = await setStatus(accountant, 'pay-desk-t2', { status: 'paid', transfer: { transferId: transfer.id } });
  assert.equal(reused.status, 409, reused.text);
  assert.equal((await one("SELECT status FROM payments WHERE id='pay-desk-t2'")).status, 'pending');
});

async function pendingOrder(id, { staffId = 'st-desk-rep', method = 'cash' } = {}) {
  await pool.query(
    `INSERT INTO orders (id, tenant_id, type, item_id, item_title, amount, currency, payment_method, customer_name, status,
                         subscriber_id, course_id, staff_id, created_at)
     VALUES (?, ?, 'course', ?, 'كورس المكتب', 3000, 'EGP', ?, 'عميلة أونلاين', 'pending', 'sub-desk-1', ?, ?, UTC_TIMESTAMP())`,
    [id, T, COURSE, method, COURSE, staffId]);
}

test('orders: reading needs view_orders, and the generic edit cannot mark money paid', { skip }, async () => {
  assert.equal((await app.call('GET', '/api/admin/orders', { session: hr })).status, 403);
  assert.equal((await app.call('GET', '/api/admin/orders', { session: accountant })).status, 200);
  await pendingOrder('ord-desk-1');
  for (const status of ['paid', 'refunded']) {
    const res = await app.call('PATCH', '/api/admin/orders/ord-desk-1', { session: accountant, body: { status } });
    assert.equal(res.status, 409, `${status}: ${res.text}`);
  }
  assert.equal(String((await one("SELECT status FROM orders WHERE id='ord-desk-1'")).status).toLowerCase(), 'pending');
});

test('orders: whoever recorded an order cannot confirm it, and it is confirmed once', { skip }, async () => {
  await pendingOrder('ord-desk-2', { staffId: 'st-desk-acc' });
  const own = await app.call('POST', '/api/admin/orders/ord-desk-2/confirm-payment', { session: accountant, body: {} });
  assert.equal(own.status, 403, own.text);
  const confirmed = await app.call('POST', '/api/admin/orders/ord-desk-1/confirm-payment', { session: accountant, body: {} });
  assert.equal(confirmed.status, 200, confirmed.text);
  assert.equal(String((await one("SELECT status FROM orders WHERE id='ord-desk-1'")).status).toLowerCase(), 'paid');
  const payment = await one('SELECT status, amount FROM payments WHERE tenant_id=? AND id=?', [T, confirmed.body.paymentId]);
  assert.equal(payment.status, 'paid');
  assert.equal(Number(payment.amount), 3000);
  const again = await app.call('POST', '/api/admin/orders/ord-desk-1/confirm-payment', { session: accountant, body: {} });
  assert.equal(again.status, 409, again.text);
});

test('orders: a transfer already paying a payment cannot confirm an order', { skip }, async () => {
  await pendingOrder('ord-desk-3', { method: 'instapay' });
  const transfer = await one("SELECT id FROM incoming_transfers WHERE tenant_id=? AND reference='IP-DESK-1'", [T]);
  const res = await app.call('POST', '/api/admin/orders/ord-desk-3/confirm-payment', {
    session: accountant, body: { linkedTransferId: transfer.id },
  });
  assert.equal(res.status, 409, res.text);
  const untied = await app.call('POST', '/api/admin/orders/ord-desk-3/confirm-payment', { session: accountant, body: {} });
  assert.equal(untied.status, 400, 'a non-cash order needs its transfer');
  assert.equal(untied.body.code, 'TRANSFER_REQUIRED');
});

test('the payments register finds a payment by who sent it, and shows the sender', { skip }, async () => {
  const res = await app.call('GET', `/api/admin/finance/payments-register?status=all&q=${encodeURIComponent('أحمد المحوّل')}`, { session: accountant });
  assert.equal(res.status, 200, res.text);
  const row = res.body.rows.find(r => r.id === 'pay-desk-sender');
  assert.ok(row, 'found by the sender\'s name');
  assert.equal(row.senderName, 'أحمد المحوّل');
});

test('the register\'s total counts paid money only: not a deleted payment, not a refunded one', { skip }, async () => {
  const totalOf = async () => {
    const res = await app.call('GET', '/api/admin/finance/payments-register?status=paid', { session: accountant });
    assert.equal(res.status, 200, res.text);
    return { total: Number(res.body.totalEgp), ids: res.body.rows.map(r => r.id) };
  };
  const before = await totalOf();
  await pool.query(
    `INSERT INTO payments (id, tenant_id, subscriber_id, course_id, amount, currency, amount_egp, payment_type, payment_method,
                           status, date, deleted_at, created_at) VALUES
       ('pay-desk-deleted', ?, 'sub-desk-1', ?, 9100, 'EGP', 9100, 'COURSE', 'cash', 'paid', CURDATE(), UTC_TIMESTAMP(), UTC_TIMESTAMP()),
       ('pay-desk-refunded', ?, 'sub-desk-1', ?, 9200, 'EGP', 9200, 'COURSE', 'cash', 'refunded', CURDATE(), NULL, UTC_TIMESTAMP())`,
    [T, COURSE, T, COURSE]);
  const after = await totalOf();
  assert.equal(after.total, before.total, 'neither moved the total');
  assert.ok(!after.ids.includes('pay-desk-deleted') && !after.ids.includes('pay-desk-refunded'));
});
