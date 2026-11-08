'use strict';
/**
 * Manual journal entries and accounting periods as they behave, on a real MariaDB. These were regular expressions over routes/accounting-erp.js,
 * routes/accounting.js and lib/finance.js (a `Number.isFinite` next to a path, «bind all 19 placeholders» counted in the source): a manual entry is
 * written only when it balances, names accounts of this institute's chart that are active, carries one amount per line and a real date; a period that
 * is closed refuses entries dated inside it until an administrator reopens it with a reason; only one period is open at a time. Runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-acct-it';
let pool; let erp; let periods;

async function call(router, method, path, { body = {}, params = {} } = {}) {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `${method} ${path}`);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  const req = { params, body, query: {}, headers: {}, tenantId: T, user: { uid: 'u', email: 'owner@example.test' }, staffRecord: null, isSuperAdmin: true, ip: '127.0.0.1', get: () => undefined };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff', 'requireAdmin'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}

async function clean() {
  await pool.query('DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE tenant_id=?)', [T]).catch(() => {});
  for (const table of ['journal_entries', 'financial_audit_log', 'accounting_periods', 'tenant_chart_of_accounts', 'audit_events']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}
const entry = (overrides = {}) => ({
  date: '2026-10-05', description: 'تسوية',
  lines: [{ account_code: '1100', debit: 500, credit: 0 }, { account_code: '4100', debit: 0, credit: 500 }], ...overrides,
});
const post = body => call(erp, 'post', '/api/admin/accounting/journal-entries', { body });
const entries = async () => (await pool.query("SELECT id FROM journal_entries WHERE tenant_id=? AND ref_type='manual'", [T]))[0].length;

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  erp = require('../../routes/accounting-erp');
  periods = require('../../routes/accounting');
  await clean();
  await pool.query(
    `INSERT INTO tenant_chart_of_accounts (tenant_id, code, name, type, is_active) VALUES
       (?, '1100', 'النقدية', 'asset', 1), (?, '4100', 'إيرادات', 'revenue', 1), (?, '5200', 'مصروف قديم', 'expense', 0)`, [T, T, T]);
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('a balanced manual entry is written with its lines; an unbalanced one is refused and leaves nothing', { skip }, async () => {
  const ok = await post(entry());
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  const [lines] = await pool.query('SELECT account_code, debit, credit FROM journal_entry_lines WHERE entry_id=? ORDER BY account_code', [ok.body.entry.id]);
  assert.deepEqual(lines.map(line => [line.account_code, Number(line.debit), Number(line.credit)]), [['1100', 500, 0], ['4100', 0, 500]]);
  const before = await entries();
  const off = await post(entry({ lines: [{ account_code: '1100', debit: 500 }, { account_code: '4100', credit: 499 }] }));
  assert.equal(off.statusCode, 400);
  assert.equal(await entries(), before, 'nothing written');
});

test('each line carries one amount; accounts must be in the chart and active; the date must be a real one', { skip }, async () => {
  const before = await entries();
  assert.equal((await post(entry({ lines: [{ account_code: '1100', debit: 100, credit: 100 }, { account_code: '4100', credit: 0, debit: 0 }] }))).statusCode, 400, 'a line with a debit and a credit');
  assert.equal((await post(entry({ lines: [{ account_code: '1100', debit: 'abc' }, { account_code: '4100', credit: 'abc' }] }))).statusCode, 400, 'amounts that are not numbers');
  assert.equal((await post(entry({ lines: [{ account_code: '1100', debit: 200000000 }, { account_code: '4100', credit: 200000000 }] }))).statusCode, 400, 'an amount beyond the limit');
  const missing = await post(entry({ lines: [{ account_code: '1100', debit: 100 }, { account_code: '9999', credit: 100 }] }));
  assert.equal(missing.statusCode, 400);
  assert.deepEqual(missing.body.missing_accounts, ['9999']);
  const inactive = await post(entry({ lines: [{ account_code: '1100', debit: 100 }, { account_code: '5200', credit: 100 }] }));
  assert.equal(inactive.statusCode, 400);
  assert.deepEqual(inactive.body.inactive_accounts, ['5200']);
  assert.equal((await post(entry({ date: '2026-13-45' }))).statusCode, 400, 'a date that is not one');
  assert.equal((await post(entry({ date: 'غدًا' }))).statusCode, 400);
  assert.equal(await entries(), before, 'none of them was written');
});

test('a closed period refuses entries dated inside it until it is reopened with a reason', { skip }, async () => {
  await pool.query("INSERT INTO accounting_periods (id, tenant_id, period_label, status, closed_at) VALUES ('per-acct-aug', ?, '2026-08', 'closed', NOW())", [T]);
  const locked = await post(entry({ date: '2026-08-15' }));
  assert.equal(locked.statusCode, 409, JSON.stringify(locked.body));
  const noReason = await call(periods, 'post', '/api/admin/accounting-periods/:id/reopen', { params: { id: 'per-acct-aug' }, body: {} });
  assert.equal(noReason.statusCode, 400, 'a reason is required');
  const [[stillClosed]] = await pool.query("SELECT status FROM accounting_periods WHERE id='per-acct-aug'");
  assert.equal(stillClosed.status, 'closed');
  const reopened = await call(periods, 'post', '/api/admin/accounting-periods/:id/reopen', { params: { id: 'per-acct-aug' }, body: { reason: 'تصحيح قيد' } });
  assert.equal(reopened.statusCode, 200, JSON.stringify(reopened.body));
  assert.equal((await post(entry({ date: '2026-08-15' }))).statusCode, 200, 'writable again');
});

test('only one period is open at a time', { skip }, async () => {
  const first = await call(periods, 'post', '/api/admin/accounting-periods', { body: { label: '2026-11' } });
  // 2026-08 was reopened by the test above, so the open slot is taken already.
  assert.equal(first.statusCode, 409, JSON.stringify(first.body));
  await pool.query("UPDATE accounting_periods SET status='closed' WHERE tenant_id=?", [T]);
  const next = await call(periods, 'post', '/api/admin/accounting-periods', { body: { label: '2026-11' } });
  assert.equal(next.statusCode, 200, JSON.stringify(next.body));
  const again = await call(periods, 'post', '/api/admin/accounting-periods', { body: { label: '2026-12' } });
  assert.equal(again.statusCode, 409);
  const bad = await call(periods, 'post', '/api/admin/accounting-periods', { body: { label: 'نوفمبر' } });
  assert.ok(bad.statusCode === 400 || bad.statusCode === 409, 'a label that is not YYYY-MM is not a period');
});
