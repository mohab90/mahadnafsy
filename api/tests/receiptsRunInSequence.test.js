'use strict';

// «محتاجين نخلي ارقام العمليات اللي هيا ارقام الايصالات تكون مرتبة بتسلسل ولو وقع رقم يظهر
// للمديرين ان في مشكلة في ايصال رقم كذا مش موجود» (13 Oct 2026), for Dokki — and Tagamoa.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { receiptSeriesOf, nextReceiptNo, sequenceProblems, findReceiptGaps } = require('../lib/receiptNumbers');
const read = rel => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');

// A counter table in memory, locked the way FOR UPDATE would.
function fakeDb() {
  const counters = new Map();
  const calls = [];
  return {
    calls,
    counters,
    query: async (sql, params = []) => {
      const flat = String(sql).replace(/\s+/g, ' ').trim();
      calls.push(flat);
      const key = `${params[0]}|${params[1]}`;
      if (/^INSERT IGNORE INTO receipt_counters/.test(flat)) { if (!counters.has(key)) counters.set(key, 0); return [{}]; }
      if (/^SELECT last_no FROM receipt_counters/.test(flat)) return [[{ last_no: counters.get(key) }]];
      if (/^UPDATE receipt_counters SET last_no = \?/.test(flat)) { counters.set(`${params[1]}|${params[2]}`, params[0]); return [{}]; }
      return [[]];
    },
  };
}

test('only the physical branches number their receipts', () => {
  assert.equal(receiptSeriesOf('DAQQI'), 'DAQQI');
  assert.equal(receiptSeriesOf('tagamoa'), 'TAGAMOA');
  assert.equal(receiptSeriesOf('ONLINE_EGYPT'), null);
  assert.equal(receiptSeriesOf('ONLINE_SAUDI'), null);
  assert.equal(receiptSeriesOf(undefined), null);
});

test('Dokki runs 1, 2, 3 and Tagamoa has its own run; online takes no number', async () => {
  const db = fakeDb();
  const taken = [];
  for (const branch of ['DAQQI', 'DAQQI', 'TAGAMOA', 'DAQQI', 'ONLINE_EGYPT', 'TAGAMOA']) {
    taken.push([branch, await nextReceiptNo(db, { tenantId: 't1', branch })]);
  }
  assert.deepEqual(taken, [['DAQQI', 1], ['DAQQI', 2], ['TAGAMOA', 1], ['DAQQI', 3], ['ONLINE_EGYPT', null], ['TAGAMOA', 2]]);
  assert.ok(db.calls.some(call => /FOR UPDATE/.test(call)), 'the counter row is locked until the payment commits');
  assert.equal(db.calls.filter(call => /receipt_counters/.test(call)).length, 15, 'three statements per numbered payment, none for online');
});

test('a tenant has its own run', async () => {
  const db = fakeDb();
  assert.equal(await nextReceiptNo(db, { tenantId: 'a', branch: 'DAQQI' }), 1);
  assert.equal(await nextReceiptNo(db, { tenantId: 'b', branch: 'DAQQI' }), 1);
  assert.equal(await nextReceiptNo(db, { tenantId: 'a', branch: 'DAQQI' }), 2);
});

test('a whole run has no problem; a number with no payment is missing, a deleted one is removed', () => {
  assert.deepEqual(sequenceProblems([{ receiptNo: 1 }, { receiptNo: 2 }, { receiptNo: 3 }]), { highest: 3, count: 3, missing: [], removed: [] });
  const broken = sequenceProblems([{ receiptNo: 1 }, { receiptNo: 2, deleted: true, paymentId: 'p2' }, { receiptNo: 5 }]);
  assert.deepEqual(broken.missing, [3, 4]);
  assert.deepEqual(broken.removed.map(row => row.receiptNo), [2]);
  assert.equal(broken.highest, 5);
  assert.deepEqual(sequenceProblems([]), { highest: 0, count: 0, missing: [], removed: [] });
});

test('the gaps are read per branch, from the payments that carry a number', async () => {
  const asked = [];
  const db = { query: async (sql, params) => {
    asked.push({ sql: String(sql).replace(/\s+/g, ' '), params });
    return [params[1] === 'DAQQI'
      ? [{ id: 'a', receipt_no: 1, deleted_at: null, amount: 100, currency: 'EGP' }, { id: 'c', receipt_no: 3, deleted_at: null, amount: 50, currency: 'EGP' }]
      : [{ id: 'x', receipt_no: 1, deleted_at: null, amount: 10, currency: 'EGP' }]];
  } };
  const result = await findReceiptGaps(db, { tenantId: 't1', branches: ['DAQQI', 'TAGAMOA'] });
  assert.deepEqual(result.map(entry => [entry.branch, entry.missing]), [['DAQQI', [2]], ['TAGAMOA', []]]);
  assert.match(asked[0].sql, /p\.receipt_no IS NOT NULL/);
  assert.equal(asked[0].params[0], 't1');
});

test('the migration numbers what exists in the order it was recorded and starts the counter after it', () => {
  const sql = read('api/migrations/280_v26_branch_receipt_numbers.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS receipt_counters/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS receipt_no INT NULL/);
  assert.match(sql, /ADD UNIQUE KEY IF NOT EXISTS uq_payments_branch_receipt \(tenant_id, branch, receipt_no\)/);
  assert.match(sql, /ROW_NUMBER\(\) OVER \(PARTITION BY tenant_id, branch ORDER BY created_at, `date`, id\)/);
  assert.match(sql, /branch IN \('DAQQI', 'TAGAMOA'\)/);
  assert.match(sql, /ON DUPLICATE KEY UPDATE last_no = GREATEST\(last_no, VALUES\(last_no\)\)/);
});

test('a recorded payment takes its number inside its transaction and answers with it', () => {
  const route = read('api/routes/subscriber-payments.js');
  assert.match(route, /receiptNo = await nextReceiptNo\(conn, \{ tenantId: paymentTenantId, branch: paymentBranch \}\);/);
  assert.match(route, /tenant_id, branch, branch_id, receipt_no\)/);
  assert.match(route, /\.\.\.\(receiptNo \? \{ receiptNo, receiptBranch: receiptSeriesOf\(paymentBranch\) \} : \{\}\)/);
  const installments = read('api/routes/installments.js');
  assert.match(installments, /const receiptNo = await nextReceiptNo\(conn, \{ tenantId: req\.tenantId, branch \}\);/);
  assert.match(installments, /tenant_id, staff_name, created_at, receipt_no\)/);
});

test('the receipt, the register and the managers see the number — and voiding one tells the managers', () => {
  assert.match(read('admin/components/PaymentModal.tsx'), /إيصال رقم \{data\.receiptNo\}/);
  assert.match(read('admin/components/PaymentModal.tsx'), /forgetReceipts\(\);/);
  assert.match(read('admin/lib/mysqlapi.ts'), /noteReceipt\(answer\)/);
  assert.match(read('api/routes/finance-payments-register.js'), /number: r\.receipt_no != null \? Number\(r\.receipt_no\)/);
  assert.match(read('admin/pages/dashboard/tabs/DaqqiScheduleTab.tsx'), /<ReceiptGapsAlert branch=\{physicalBranch\.key\} \/>/);
  const gaps = read('api/routes/misc/receiptGaps.js');
  assert.match(gaps, /GAP_VIEWERS/);
  assert.match(gaps, /boundBranch\(req\)/, "a branch's own manager sees only their branch");
  const corrections = read('api/lib/paymentCorrections.js');
  assert.match(corrections, /await insertNotification\(conn, 'payment', '⚠️ إيصال اتمسح من التسلسل'/);
});

test('the endpoint answers the managers, a branch’s manager sees only their branch, a rep is refused', async () => {
  const stub = (rel, exports) => { const file = require.resolve(rel); require.cache[file] = { id: file, filename: file, loaded: true, exports }; };
  const pass = (req, res, next) => next();
  const askedBranches = [];
  stub('../lib/db', { pool: { query: async (sql, params) => { askedBranches.push(params[1]); return [[{ id: 'a', receipt_no: 1, deleted_at: null, amount: 1, currency: 'EGP' }, { id: 'c', receipt_no: 3, deleted_at: null, amount: 1, currency: 'EGP' }]]; } } });
  stub('../lib/logger', { error() {}, warn() {}, info() {} });
  stub('../middleware/auth', { requireAuth: pass, requireAdminOrStaff: pass, requirePermission: () => pass });
  delete require.cache[require.resolve('../routes/misc/receiptGaps')];
  const router = require('../routes/misc/receiptGaps');
  const layer = router.stack.find(l => l.route && l.route.path === '/api/admin/receipts/gaps');
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  const call = async staffRecord => {
    askedBranches.length = 0;
    const out = {};
    await handler({ tenantId: 't1', staffRecord, isSuperAdmin: false }, { status(code) { out.status = code; return this; }, json(body) { out.body = body; return this; } });
    return out;
  };
  const owner = await call({ id: 'o', role: 'admin' });
  assert.deepEqual(askedBranches, ['DAQQI', 'TAGAMOA']);
  assert.equal(owner.body.problems, 2, 'receipt 2 is missing in each branch');
  assert.deepEqual(owner.body.branches[0].missing, [2]);
  assert.equal(owner.body.branches[0].label, 'الدقي');
  await call({ id: 'm', role: 'daqqi_manager' });
  assert.deepEqual(askedBranches, ['DAQQI'], 'the Dokki manager is shown Dokki only');
  assert.equal((await call({ id: 'r', role: 'sales' })).status, 403);
  assert.equal((await call({ id: 'c', role: 'collection' })).body.code, 'MANAGERS_ONLY');
});
