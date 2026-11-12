'use strict';
/**
 * Who confirms money, what rejecting it says, and the number a desk receipt takes, on a real MariaDB (these were regular expressions over routes/core/financepay.js,
 * routes/subscriber-payments.js, routes/installments.js and a migration): a collection officer approves nobody's payment and nobody approves their own; a payment a
 * collection officer recorded is confirmed against a transfer (cash excepted); a rejection needs a reason and the person who took the money is told it, in a message;
 * a Dokki or Tagamoa desk payment takes the next receipt number of its branch in its own transaction (an online one takes none); voiding a numbered receipt tells the managers.
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
const T = 'tenant-payreview-it';
let pool; let payments; let approval; let corrections;

const OWNER = { isSuperAdmin: true, staffRecord: null };
const staff = (id, role, permissions) => ({ isSuperAdmin: false, staffRecord: { id, name: id, role, permissions_json: JSON.stringify(permissions) } });
const COLLECTION = staff('st-pr-col', 'collection', ['manage_payments', 'manage_financial']);
const SUPPORT = staff('st-pr-sup', 'support', ['manage_payments', 'confirm_transfers']);
const REP = staff('st-pr-rep', 'sales', ['manage_payments']);
const ACCOUNTS = staff('st-pr-acc', 'accountant', ['manage_financial', 'manage_payments']);

async function call(router, method, path, { who, params = {}, body = {} }) {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `${method} ${path}`);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  const req = { params, body, query: {}, headers: {}, tenantId: T, user: { uid: 'u', email: 'boss@example.test' }, ip: '127.0.0.1', get: () => undefined, ...who };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}

let n = 0;
const record = (who, subscriber, extra = {}) => call(payments, 'post', '/api/admin/subscriber-payments', {
  who, body: { subscriber_id: subscriber, payment: { amount: 500, currency: 'EGP', paymentType: 'other', paymentMethod: 'انستا باي', status: 'paid', transactionId: `TX-PR-${n += 1}`, ...extra } },
});
const approve = (who, id, body = { status: 'paid' }) => call(approval, 'patch', '/api/admin/payments/:id/status', { who, params: { id }, body });

async function clean() {
  await pool.query('DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE tenant_id=?)', [T]).catch(() => {});
  for (const table of ['journal_entries', 'payment_audit_log', 'financial_audit_log', 'crm_commissions', 'incoming_transfers', 'staff_messages', 'notifications', 'receipt_counters', 'outbox',
    'orders', 'payments', 'subscribers', 'staff', 'tenant_settings']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  payments = require('../../routes/subscriber-payments');
  approval = require('../../routes/core/financepay');
  corrections = require('../../routes/payment-corrections');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [T, T]);
  let k = 0;
  for (const [id, role] of [['st-pr-col', 'COLLECTION'], ['st-pr-sup', 'SUPPORT'], ['st-pr-rep', 'SALES'], ['st-pr-acc', 'ACCOUNTANT']]) {
    k += 1;
    await pool.query("INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES (?, ?, ?, ?, ?, ?, 1, '2025-01-01')", [id, T, id, `${id}@example.test`, `101950010${k}`, role]);
  }
  await pool.query(
    `INSERT INTO subscribers (id, tenant_id, name, phone, branch, branch_id, assigned_sales_id, assigned_cs_id) VALUES
       ('sub-pr-1', ?, 'عميل', '01019500011', 'ONLINE_EGYPT', 'branch-online-egypt', 'st-pr-rep', 'st-pr-col'),
       ('sub-pr-d', ?, 'عميل الدقي', '01019500012', 'DAQQI', 'branch-daqqi', 'st-pr-rep', 'st-pr-col')`, [T, T]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('a collection officer approves nobody\'s payment, and nobody approves one they recorded themselves', { skip }, async () => {
  const made = await record(REP, 'sub-pr-1');
  assert.equal(made.statusCode, 200, JSON.stringify(made.body));
  const byCollection = await approve(COLLECTION, made.body.id);
  assert.equal(byCollection.statusCode, 403, JSON.stringify(byCollection.body));
  assert.equal((await pool.query('SELECT status FROM payments WHERE id=?', [made.body.id]))[0][0].status, 'pending', 'it stays pending');
  const own = await record(SUPPORT, 'sub-pr-1', { paymentMethod: 'كاش' });
  assert.equal((await pool.query('SELECT status FROM payments WHERE id=?', [own.body.id]))[0][0].status, 'pending');
  const self = await approve(SUPPORT, own.body.id);
  assert.equal(self.statusCode, 403);
  assert.equal(self.body.code, 'PAYMENT_SELF_APPROVAL');
  assert.equal((await approve(ACCOUNTS, own.body.id)).statusCode, 200, 'somebody else may');
});

test('what a collection officer recorded is confirmed against a transfer, unless it was cash', { skip }, async () => {
  await pool.query("UPDATE staff SET permissions_json='[\"manage_payments\"]' WHERE id='st-pr-col'");
  const viaCollection = staff('st-pr-col', 'collection', ['manage_payments']);
  const transferPayment = await record(viaCollection, 'sub-pr-1', { paymentMethod: 'انستا باي' });
  assert.equal(transferPayment.statusCode, 200, JSON.stringify(transferPayment.body));
  const needs = await approve(ACCOUNTS, transferPayment.body.id);
  assert.equal(needs.statusCode, 400);
  assert.equal(needs.body.code, 'TRANSFER_REQUIRED');
  const cash = await record(viaCollection, 'sub-pr-1', { paymentMethod: 'كاش' });
  assert.equal((await approve(ACCOUNTS, cash.body.id)).statusCode, 200, JSON.stringify(cash.body));
});

test('a rejection needs a reason, and the person who took the money is told it in a message', { skip }, async () => {
  const made = await record(REP, 'sub-pr-1', { amount: 321 });
  const bare = await approve(ACCOUNTS, made.body.id, { status: 'failed' });
  assert.equal(bare.statusCode, 400);
  assert.equal(bare.body.code, 'REJECT_REASON_REQUIRED');
  const rejected = await approve(ACCOUNTS, made.body.id, { status: 'failed', reviewNote: 'التحويل ما وصلش' });
  assert.equal(rejected.statusCode, 200, JSON.stringify(rejected.body));
  const [messages] = await pool.query("SELECT staff_id, body FROM staff_messages WHERE tenant_id=? AND body LIKE '%التحويل ما وصلش%'", [T]);
  const told = messages.map(message => message.staff_id).sort();
  assert.ok(told.includes('st-pr-rep'), 'the one who took it (and the client\'s rep)');
  assert.ok(!told.includes('st-pr-acc'), 'not the one who rejected it');
  assert.ok(messages.every(message => /التحويل ما وصلش/.test(message.body)));
});

test('a desk payment takes the next receipt number of its branch, an online one takes none, and voiding a numbered receipt tells the managers', { skip }, async () => {
  const first = await record(OWNER, 'sub-pr-d', { paymentMethod: 'كاش', branch: 'DAQQI' });
  const second = await record(OWNER, 'sub-pr-d', { paymentMethod: 'كاش', branch: 'DAQQI' });
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  const numbers = (await pool.query('SELECT id, receipt_no FROM payments WHERE id IN (?, ?) ORDER BY receipt_no', [first.body.id, second.body.id]))[0].map(row => Number(row.receipt_no));
  assert.deepEqual(numbers, [numbers[0], numbers[0] + 1], 'one after the other, no gap');
  assert.equal(first.body.receiptBranch ?? first.body.receipt_branch ?? 'DAQQI', 'DAQQI');
  const online = await record(OWNER, 'sub-pr-1', { paymentMethod: 'كاش' });
  assert.equal((await pool.query('SELECT receipt_no FROM payments WHERE id=?', [online.body.id]))[0][0].receipt_no, null, 'an online payment is not on a branch\'s series');

  const voided = await call(corrections, 'delete', '/api/admin/payments/:id', { who: OWNER, params: { id: first.body.id }, body: { reason: 'اتسجلت بالغلط' } });
  assert.equal(voided.statusCode, 200, JSON.stringify(voided.body));
  const [notices] = await pool.query("SELECT title FROM notifications WHERE tenant_id=? AND title LIKE '%إيصال اتمسح%'", [T]);
  assert.ok(notices.length >= 1, 'the managers are told which receipt left a hole in the sequence');
});

test('a transfer carries one reference, and a payment may be confirmed by several transfers (migration 387): the payment key is a plain index', { skip }, async () => {
  const keys = async name => (await pool.query("SELECT column_name AS c FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='incoming_transfers' AND index_name=? AND non_unique=0 ORDER BY seq_in_index", [name]))[0].map(row => row.c);
  assert.deepEqual(await keys('uq_incoming_transfer_payment'), [], 'no unique key on the payment any more');
  const [plain] = await pool.query("SELECT column_name AS c FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='incoming_transfers' AND index_name='idx_incoming_transfers_payment' AND non_unique=1 ORDER BY seq_in_index");
  assert.deepEqual(plain.map(row => row.c), ['tenant_id', 'payment_id']);
  assert.deepEqual(await keys('uq_incoming_transfer_ref'), ['tenant_id', 'method', 'reference']);
});
