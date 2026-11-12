'use strict';
/**
 * «في أخطاء بتظهر عند عملاء في الفلوس، خصوصاً في الدفعات الموزعة على أكتر من تحويل» (12 Nov 2026, the owner; a booking of 4,100 whose note read «التحويل ب 11600»).
 * A payment may be confirmed by several transfers (migration 387); they must add up to it, in its currency; the one that passes keeps the part that is needed and its
 * rest is split off free; short, wrong currency or already used is refused with nothing written; voiding frees all of them; a correction re-checks the cover.
 * Real MariaDB, through the routes (the payment status PATCH, order confirmation, a collection request's approval, the payment correction).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-severaltr-it';
let pool; let payments; let approval; let corrections; let orders; let incoming;

const OWNER = { isSuperAdmin: true, staffRecord: null };
const ACCOUNTS = { isSuperAdmin: false, staffRecord: { id: 'st-sv-acc', name: 'محاسب', role: 'accountant', permissions_json: JSON.stringify(['manage_financial', 'manage_payments', 'confirm_transfers', 'manage_orders']) } };

async function call(router, method, path, { who = OWNER, params = {}, body = {} } = {}) {
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

let seq = 0;
const newPayment = async (amount, { currency = 'EGP', status = 'pending', subscriber = 'sub-sv-1' } = {}) => {
  const id = `pay-sv-${seq += 1}`;
  await pool.query(
    `INSERT INTO payments (id, tenant_id, subscriber_id, amount, currency, payment_type, payment_method, status, date, transaction_id)
     VALUES (?, ?, ?, ?, ?, 'OTHER', 'فودافون كاش', ?, CURDATE(), ?)`, [id, T, subscriber, amount, currency, status, `TXN-SV-${seq}`]);
  return id;
};
const newTransfer = async (amount, { currency = 'EGP', reference } = {}) => {
  const id = `tr-sv-${seq += 1}`;
  await pool.query(
    `INSERT INTO incoming_transfers (id, tenant_id, amount, currency, method, reference, sender_name, received_on)
     VALUES (?, ?, ?, ?, 'فودافون كاش', ?, 'المحوِّل', CURDATE())`, [id, T, amount, currency, reference || `R${seq}`]);
  return id;
};
const approve = (paymentId, transfer, who = OWNER) => call(approval, 'patch', '/api/admin/payments/:id/status',
  { who, params: { id: paymentId }, body: { status: 'paid', paymentMethod: 'فودافون كاش', transfer } });
const rows = async sql => (await pool.query(sql, [T]))[0];
const tiedTo = async paymentId => (await pool.query('SELECT id, amount, payment_id FROM incoming_transfers WHERE tenant_id=? AND payment_id=? ORDER BY id', [T, paymentId]))[0];
const payment = async id => (await pool.query('SELECT status, amount, deleted_at, linked_transfer_id FROM payments WHERE tenant_id=? AND id=?', [T, id]))[0][0];
const ledgerTotal = async () => Number((await pool.query('SELECT COALESCE(SUM(amount),0) AS s FROM incoming_transfers WHERE tenant_id=?', [T]))[0][0].s);

async function clean() {
  await pool.query('DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE tenant_id=?)', [T]).catch(() => {});
  for (const table of ['journal_entries', 'payment_audit_log', 'financial_audit_log', 'crm_commissions', 'instructor_fees', 'incoming_transfers', 'subscriber_requests',
    'notifications', 'outbox', 'orders', 'payments', 'subscribers', 'staff', 'tenant_settings']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  payments = require('../../routes/subscriber-payments');
  approval = require('../../routes/core/financepay');
  corrections = require('../../routes/payment-corrections');
  orders = require('../../routes/orders');
  incoming = require('../../lib/incomingTransfers');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [T, T]);
  await pool.query("INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES ('st-sv-acc', ?, 'محاسب', 'st-sv-acc@example.test', '1019700001', 'ACCOUNTANT', 1, '2025-01-01')", [T]);
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone, branch, branch_id) VALUES ('sub-sv-1', ?, 'عميل', '01019700011', 'ONLINE_EGYPT', 'branch-online-egypt')", [T]);
});
after(async () => { if (!ENABLED) return; await clean(); await pool.end(); });

test('one payment paid by two transfers that add up exactly: both tied, nothing split, the payment keeps the first', { skip }, async () => {
  const id = await newPayment(4100);
  const a = await newTransfer(2000); const b = await newTransfer(2100);
  const res = await approve(id, { transferIds: [a, b] });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual((await tiedTo(id)).map(row => [row.id, Number(row.amount)]).sort(), [[a, 2000], [b, 2100]].sort());
  assert.equal((await payment(id)).status, 'paid');
  assert.equal((await payment(id)).linked_transfer_id, a, 'the screens that read one transfer see the first');
  assert.equal((await rows('SELECT id FROM incoming_transfers WHERE tenant_id=?')).length, 2, 'no remainder');
});

test('three transfers, the last bigger than what is left: it keeps the part needed, the rest is split off and numbering continues', { skip }, async () => {
  const id = await newPayment(5000);
  const a = await newTransfer(2000); const b = await newTransfer(1500); const c = await newTransfer(4000, { reference: 'BIG-77' });
  const before = await ledgerTotal();
  const res = await approve(id, { transferIds: [a, b, c] });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const tied = await tiedTo(id);
  assert.equal(tied.length, 3);
  assert.equal(Number(tied.find(row => row.id === c).amount), 1500, 'keeps only the uncovered part');
  const rest = (await rows("SELECT id, amount, reference, parent_transfer_id, original_amount, payment_id FROM incoming_transfers WHERE tenant_id=? AND reference LIKE 'BIG-77/%'"))[0];
  assert.deepEqual([Number(rest.amount), rest.reference, rest.parent_transfer_id, Number(rest.original_amount), rest.payment_id], [2500, 'BIG-77/باقي 1', c, 4000, null]);
  assert.equal(await ledgerTotal(), before, 'the ledger still holds everything that arrived');
  // The remainder pays another payment in turn: 1,000 of it, and what is left is the next «/باقي».
  const next = await newPayment(1000);
  assert.equal((await approve(next, { transferId: rest.id })).statusCode, 200);
  const left = (await rows("SELECT amount, reference, parent_transfer_id FROM incoming_transfers WHERE tenant_id=? AND payment_id IS NULL AND reference LIKE 'BIG-77/%'"))[0];
  assert.deepEqual([Number(left.amount), left.reference, left.parent_transfer_id], [1500, 'BIG-77/باقي 2', c]);
});

test('transfers that do not cover the payment: refused with the three figures, nothing written', { skip }, async () => {
  const id = await newPayment(4100);
  const a = await newTransfer(2000);
  const res = await approve(id, { transferId: a });
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, 'TRANSFERS_SHORT');
  assert.match(res.body.error, /التحويلات المختارة ٢٬٠٠٠ والدفعة ٤٬١٠٠ — ناقص ٢٬١٠٠، اختار تحويل كمان أو عدّل مبلغ الدفعة/);
  assert.equal((await payment(id)).status, 'pending');
  assert.equal((await tiedTo(id)).length, 0);
  assert.equal(Number((await pool.query('SELECT amount FROM incoming_transfers WHERE id=?', [a]))[0][0].amount), 2000, 'the transfer is untouched');
    // One piastre short is the same payment (the rounding of a wallet's fee).
  const near = await newPayment(100.01);
  const exact = await newTransfer(100);
  assert.equal((await approve(near, { transferId: exact })).statusCode, 200);
});

test('a transfer in another currency than the payment is refused, naming the transfer', { skip }, async () => {
  const id = await newPayment(1000);
  const sar = await newTransfer(1000, { currency: 'SAR', reference: 'SAR-1' });
  const res = await approve(id, { transferIds: [sar] });
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, 'TRANSFER_CURRENCY');
  assert.match(res.body.error, /SAR-1/);
  assert.equal((await payment(id)).status, 'pending');
  assert.equal((await tiedTo(id)).length, 0);
});

test('a transfer already used by another payment is refused, and the payment stays pending', { skip }, async () => {
  const first = await newPayment(700); const second = await newPayment(700);
  const t = await newTransfer(700);
  assert.equal((await approve(first, { transferId: t })).statusCode, 200);
  const res = await approve(second, { transferIds: [t] });
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, 'TRANSFER_ALREADY_LINKED');
  assert.equal((await payment(second)).status, 'pending');
  const missing = await approve(second, { transferIds: ['tr-nope'] });
  assert.equal(missing.statusCode, 404, JSON.stringify(missing.body));
});

test('the same link sent twice is harmless', { skip }, async () => {
  const id = await newPayment(3000);
  const a = await newTransfer(1000); const b = await newTransfer(2500);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await incoming.linkTransfer(conn, { tenantId: T, paymentId: id, link: { transferIds: [a, b] } });
      await conn.commit();
    } finally { conn.release(); }
  }
  const tied = await tiedTo(id);
  assert.deepEqual(tied.map(row => Number(row.amount)).sort((x, y) => x - y), [1000, 2000]);
    const remainders = await pool.query("SELECT amount FROM incoming_transfers WHERE tenant_id=? AND parent_transfer_id=?", [T, b]);
  assert.equal(remainders[0].length, 1, 'one remainder, not two');
  assert.equal(Number(remainders[0][0].amount), 500);
});

test('two reviewers linking the same free transfer to two payments at once: one wins, the other is told why, nobody gets a 500', { skip }, async () => {
  const p1 = await newPayment(900); const p2 = await newPayment(900);
  const t = await newTransfer(900);
  const [r1, r2] = await Promise.all([approve(p1, { transferId: t }), approve(p2, { transferId: t })]);
  const codes = [r1.statusCode, r2.statusCode].sort();
  assert.deepEqual(codes, [200, 409], JSON.stringify([r1.body, r2.body]));
  const loser = r1.statusCode === 409 ? r1 : r2;
  assert.equal(loser.body.code, 'TRANSFER_ALREADY_LINKED');
  assert.equal((await rows('SELECT payment_id FROM incoming_transfers WHERE tenant_id=?')).filter(row => [p1, p2].includes(row.payment_id)).length, 1);
});

test('confirming an order with linkedTransferIds ties them all; short is refused', { skip }, async () => {
  await pool.query(
    `INSERT INTO orders (id, tenant_id, type, item_id, item_title, amount, currency, payment_method, customer_name, status, subscriber_id, created_at)
     VALUES ('ord-sv-1', ?, 'OTHER', 'x', 'خدمة', 4100, 'EGP', 'فودافون كاش', 'عميل', 'pending', 'sub-sv-1', UTC_TIMESTAMP()),
            ('ord-sv-2', ?, 'OTHER', 'x', 'خدمة', 1000, 'EGP', 'فودافون كاش', 'عميل', 'pending', 'sub-sv-1', UTC_TIMESTAMP())`, [T, T]);
  const a = await newTransfer(11600, { reference: 'W-11600' });
  const short = await call(orders, 'post', '/api/admin/orders/:id/confirm-payment', { params: { id: 'ord-sv-1' }, body: { linkedTransferIds: [await newTransfer(2000)] } });
  assert.equal(short.statusCode, 409, JSON.stringify(short.body));
  assert.equal(short.body.code, 'TRANSFERS_SHORT');
  assert.equal(String((await pool.query("SELECT status FROM orders WHERE id='ord-sv-1'"))[0][0].status).toLowerCase(), 'pending', 'nothing written');
  const ok = await call(orders, 'post', '/api/admin/orders/:id/confirm-payment', { params: { id: 'ord-sv-1' }, body: { linkedTransferIds: [a] } });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  const rest = (await rows("SELECT id, amount FROM incoming_transfers WHERE tenant_id=? AND reference='W-11600/باقي 1'"))[0];
  assert.equal(Number(rest.amount), 7500, '«التحويل ب 11600»: 4,100 for this booking, the rest free for the others');
  const second = await call(orders, 'post', '/api/admin/orders/:id/confirm-payment', { params: { id: 'ord-sv-2' }, body: { linkedTransferId: rest.id } });
  assert.equal(second.statusCode, 200, JSON.stringify(second.body));
  const left = (await rows("SELECT amount FROM incoming_transfers WHERE tenant_id=? AND reference='W-11600/باقي 2'"))[0];
  assert.equal(Number(left.amount), 6500);
});

test('a collection request approved with several transfers (one of them typed in) ties them all', { skip }, async () => {
  const a = await newTransfer(1200, { reference: 'REQ-A' });
  const body = { subscriber_id: 'sub-sv-1', payment: { amount: 2000, currency: 'EGP', paymentType: 'other', paymentMethod: 'فودافون كاش', transactionId: 'TXN-REQ-SV' } };
  await pool.query(
    "INSERT INTO subscriber_requests (id, tenant_id, requested_by, requested_by_name, name, phone, amount, currency, body_json, status) VALUES ('req-sv-1', ?, 'st-sv-acc', 'محاسب', 'عميل', '01019700011', 2000, 'EGP', ?, 'pending')",
    [T, JSON.stringify(body)]);
  const res = await call(payments, 'post', '/api/admin/subscriber-requests/:id/approve', {
    params: { id: 'req-sv-1' }, body: { transfer: { transferIds: [a], amount: 800, currency: 'EGP', method: 'فودافون كاش', reference: 'REQ-B', receivedOn: new Date().toISOString().slice(0, 10) } },
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const request = (await pool.query("SELECT status, payment_id FROM subscriber_requests WHERE id='req-sv-1'"))[0][0];
  assert.equal(request.status, 'approved');
  assert.deepEqual((await tiedTo(request.payment_id)).map(row => Number(row.amount)).sort((x, y) => x - y), [800, 1200]);
  // Short: refused, the request stays pending, the typed-in transfer is not left behind.
  await pool.query(
    "INSERT INTO subscriber_requests (id, tenant_id, requested_by, requested_by_name, name, phone, amount, currency, body_json, status) VALUES ('req-sv-2', ?, 'st-sv-acc', 'محاسب', 'عميل', '01019700011', 2000, 'EGP', ?, 'pending')",
    [T, JSON.stringify({ ...body, payment: { ...body.payment, transactionId: 'TXN-REQ-SV2' } })]);
  const short = await call(payments, 'post', '/api/admin/subscriber-requests/:id/approve', {
    params: { id: 'req-sv-2' }, body: { transfer: { amount: 500, currency: 'EGP', method: 'فودافون كاش', reference: 'REQ-C', receivedOn: new Date().toISOString().slice(0, 10) } },
  });
  assert.equal(short.statusCode, 409, JSON.stringify(short.body));
  assert.equal(short.body.code, 'TRANSFERS_SHORT');
  assert.equal((await pool.query("SELECT status FROM subscriber_requests WHERE id='req-sv-2'"))[0][0].status, 'pending');
  assert.equal((await rows("SELECT id FROM incoming_transfers WHERE tenant_id=? AND reference='REQ-C'")).length, 0, 'rolled back whole');
});

test('voiding a payment frees all its transfers; a transfer tied to a payment can be neither deleted nor changed in amount', { skip }, async () => {
  const id = await newPayment(3000);
  const a = await newTransfer(1000); const b = await newTransfer(2000);
  assert.equal((await approve(id, { transferIds: [a, b] })).statusCode, 200);
  const del = await incoming.deleteTransfer(pool, { tenantId: T, transferId: a }).catch(error => error);
  assert.equal(del.code, 'TRANSFER_LINKED');
  await incoming.updateTransfer(pool, { tenantId: T, transferId: a, transfer: { amount: 1, currency: 'USD', method: 'x', reference: 'zzz' } });
  const kept = (await pool.query('SELECT amount, currency, reference FROM incoming_transfers WHERE id=?', [a]))[0][0];
  assert.deepEqual([Number(kept.amount), kept.currency], [1000, 'EGP'], 'amount and currency stay');
  const voided = await call(corrections, 'delete', '/api/admin/payments/:id', { params: { id }, body: { reason: 'اتسجلت بالغلط' } });
  assert.equal(voided.statusCode, 200, JSON.stringify(voided.body));
  assert.equal((await tiedTo(id)).length, 0);
  const free = (await pool.query('SELECT payment_id FROM incoming_transfers WHERE id IN (?, ?)', [a, b]))[0];
  assert.deepEqual(free.map(row => row.payment_id), [null, null]);
});

test('correcting the amount: up without cover is refused untouched; down keeps the cover and splits the rest off the last transfer', { skip }, async () => {
  const id = await newPayment(4100);
  const a = await newTransfer(2000, { reference: 'COR-A' }); const b = await newTransfer(2100, { reference: 'COR-B' });
  assert.equal((await approve(id, { transferIds: [a, b] })).statusCode, 200);
  const before = await rows('SELECT COUNT(*) AS n FROM payments WHERE tenant_id=?');
  const up = await call(corrections, 'patch', '/api/admin/payments/:id', { params: { id }, body: { reason: 'زودنا', amount: 9000 } });
  assert.equal(up.statusCode, 409, JSON.stringify(up.body));
  assert.equal(up.body.code, 'TRANSFERS_SHORT');
  assert.match(up.body.error, /ناقص ٤٬٩٠٠/);
  assert.equal((await payment(id)).deleted_at, null, 'the old payment is untouched');
  assert.equal((await tiedTo(id)).length, 2);
  assert.deepEqual(await rows('SELECT COUNT(*) AS n FROM payments WHERE tenant_id=?'), before, 'no corrected payment was recorded');
  const down = await call(corrections, 'patch', '/api/admin/payments/:id', { params: { id }, body: { reason: 'قللنا', amount: 3000 } });
  assert.equal(down.statusCode, 200, JSON.stringify(down.body));
  const newId = down.body.newId;
  const tied = await tiedTo(newId);
  assert.deepEqual(tied.map(row => Number(row.amount)).sort((x, y) => x - y), [1000, 2000]);
  assert.equal((await tiedTo(id)).length, 0, 'the voided payment holds nothing');
  const rest = (await rows("SELECT amount, payment_id FROM incoming_transfers WHERE tenant_id=? AND reference='COR-B/باقي 1'"))[0];
  assert.deepEqual([Number(rest.amount), rest.payment_id], [1100, null]);
});

test('the old single-transfer call behaves as before: a bigger transfer is split, the payment key is a plain index', { skip }, async () => {
  const id = await newPayment(1850);
  const big = await newTransfer(3000, { reference: 'OLD-7781' });
  assert.equal((await approve(id, { transferId: big })).statusCode, 200);
  assert.equal(Number((await pool.query('SELECT amount FROM incoming_transfers WHERE id=?', [big]))[0][0].amount), 1850);
  assert.equal(Number((await rows("SELECT amount FROM incoming_transfers WHERE tenant_id=? AND reference='OLD-7781/باقي 1'"))[0].amount), 1150);
  const [index] = await pool.query("SELECT non_unique FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='incoming_transfers' AND index_name='idx_incoming_transfers_payment'");
  assert.equal(index.length > 0 && index.every(row => Number(row.non_unique) === 1), true);
});

test('the audit tool lists what is wrong today (short, other currency, tied to a dead payment), writes nothing, and refuses without DB_* settings', { skip }, async () => {
  const { execFile } = require('node:child_process');
  const path = require('node:path');
  const tool = path.join(__dirname, '..', '..', 'tools', 'transfer-cover-audit.cjs');
  const run = (env, args = []) => new Promise(resolve => execFile(process.execPath, [tool, ...args], { env, timeout: 60000 }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr })));
  const short = await newPayment(4100, { status: 'paid' });
  const t1 = await newTransfer(2000, { reference: 'AUD-SHORT' });
  const mixed = await newPayment(500, { status: 'paid' });
  const t2 = await newTransfer(500, { currency: 'USD', reference: 'AUD-USD' });
  const dead = await newPayment(300, { status: 'paid' });
  const t3 = await newTransfer(300, { reference: 'AUD-DEAD' });
  await pool.query('UPDATE incoming_transfers SET payment_id=?, linked_at=NOW() WHERE id=?', [short, t1]);
  await pool.query('UPDATE incoming_transfers SET payment_id=?, linked_at=NOW() WHERE id=?', [mixed, t2]);
  await pool.query('UPDATE incoming_transfers SET payment_id=?, linked_at=NOW() WHERE id=?', [dead, t3]);
  await pool.query('UPDATE payments SET deleted_at=NOW() WHERE id=?', [dead]);
  const before = (await pool.query('SELECT COUNT(*) AS n, SUM(amount) AS s FROM incoming_transfers WHERE tenant_id=?', [T]))[0][0];
  const env = { ...process.env };
  const out = await run(env, ['--json', '--tenant', T]);
  assert.equal(out.code, 1, out.stderr);
  const report = JSON.parse(out.stdout);
  assert.deepEqual(report.short.map(row => [row.payment_id, Number(row.missing), row.client]), [[short, 2100, 'عميل']]);
  assert.deepEqual(report.currency.map(row => [row.payment_id, row.transfer_currency]), [[mixed, 'USD']]);
  assert.deepEqual(report.dead.map(row => [row.transfer_id, row.payment_state]), [[t3, 'deleted']]);
  assert.equal(report.summary.missing_by_currency.EGP, 2100);
  assert.deepEqual((await pool.query('SELECT COUNT(*) AS n, SUM(amount) AS s FROM incoming_transfers WHERE tenant_id=?', [T]))[0][0], before, 'nothing written');
  const bare = await run({ PATH: process.env.PATH, SystemRoot: process.env.SystemRoot });
  assert.equal(bare.code, 2);
  assert.match(bare.stderr, /refusing to run without explicit database settings/);
  await pool.query('UPDATE incoming_transfers SET payment_id=NULL WHERE id IN (?,?,?)', [t1, t2, t3]);
});
