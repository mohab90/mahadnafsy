'use strict';
/**
 * Bank reconciliation and closing a period, on a real MariaDB (these were regular expressions over routes/finance-operations.js and routes/accounting.js:
 * `BANK_RECONCILIATION_SOD`, `Math.abs(difference) >= 0.01`, `PERIOD_CLOSE_SOD`, `PERIOD_CLOSE_APPROVAL_REQUIRED`, `status='consumed'`): a reconciliation is approved only at
 * zero difference and never by whoever made it; items move the difference until it is zero; a period closes only on an approved request, never by the person who asked or
 * the one who approved, and the request is spent by the closing. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-bankclose-it';
let pool; let finance; let accounting;

async function call(router, path, { email, body = {}, params = {} }) {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods.post);
  assert.ok(layer, path);
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, set() { return this; } };
  const req = { params, body, query: {}, headers: {}, tenantId: T, user: { uid: `u-${email}`, email }, staffRecord: null, isSuperAdmin: true, ip: '127.0.0.1', get: () => undefined };
  for (const handle of layer.route.stack.map(entry => entry.handle).filter(fn => !['requireAuth', 'requireAdminOrStaff'].includes(fn.name))) {
    let advanced = false;
    await handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return res;
}
const A = 'a-bank@example.test'; const B = 'b-bank@example.test'; const C = 'c-bank@example.test';

async function clean() {
  await pool.query('DELETE FROM journal_entry_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE tenant_id=?)', [T]).catch(() => {});
  for (const table of ['journal_entries', 'bank_reconciliation_items', 'bank_reconciliations', 'accounting_close_requests', 'accounting_periods', 'financial_audit_log', 'tenant_chart_of_accounts', 'tenant_settings']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  finance = require('../../routes/finance-operations');
  accounting = require('../../routes/accounting');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [T, T]);
  await pool.query("INSERT INTO tenant_chart_of_accounts (tenant_id, code, name, type, is_active) VALUES (?, '1100', 'النقدية', 'asset', 1), (?, '4100', 'إيراد', 'revenue', 1)", [T, T]);
  // 1,000 into the bank in October
  const [res] = [await pool.query("INSERT INTO journal_entries (id, tenant_id, ref_type, entry_date, description, total_debit, total_credit, posted_by, branch_id) VALUES ('je-bk-1', ?, 'manual', '2026-10-10', 'إيداع', 1000, 1000, 'x', 'branch-online-egypt')", [T])];
  await pool.query("INSERT INTO journal_entry_lines (id, entry_id, account_code, account_name, debit, credit) VALUES (UUID(), 'je-bk-1', '1100', 'النقدية', 1000, 0), (UUID(), 'je-bk-1', '4100', 'إيراد', 0, 1000)");
  void res;
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('a reconciliation is approved only at zero difference, items move the difference, and never by whoever made it', { skip }, async () => {
  const made = await call(finance, '/api/admin/finance/bank-reconciliations', { email: A, body: { period_start: '2026-10-01', period_end: '2026-10-31', opening_balance: 0, statement_closing_balance: 1050, account_code: '1100', branch: 'ONLINE_EGYPT' } });
  assert.equal(made.statusCode, 201, JSON.stringify(made.body));
  assert.deepEqual([made.body.ledger_movement, made.body.ledger_closing_balance, made.body.difference_amount], [1000, 1000, 50], 'the ledger says 1,000, the statement 1,050');
  const early = await call(finance, '/api/admin/finance/bank-reconciliations/:id/approve', { email: B, params: { id: made.body.id }, body: { branch: 'ONLINE_EGYPT' } });
  assert.equal(early.statusCode, 409, 'a difference blocks the approval');
  const bad = await call(finance, '/api/admin/finance/bank-reconciliations/:id/items', { email: A, params: { id: made.body.id }, body: { item_date: '2026-10-31', amount: 50, item_type: 'nonsense', branch: 'ONLINE_EGYPT' } });
  assert.equal(bad.statusCode, 400);
  const item = await call(finance, '/api/admin/finance/bank-reconciliations/:id/items', { email: A, params: { id: made.body.id }, body: { item_date: '2026-10-31', amount: 50, item_type: 'interest', description: 'فوائد', branch: 'ONLINE_EGYPT' } });
  assert.equal(item.statusCode, 201, JSON.stringify(item.body));
  assert.equal(item.body.difference_amount, 0, 'the interest explains the difference');
  const own = await call(finance, '/api/admin/finance/bank-reconciliations/:id/approve', { email: A, params: { id: made.body.id }, body: { branch: 'ONLINE_EGYPT' } });
  assert.equal(own.statusCode, 409);
  assert.equal(own.body.code, 'BANK_RECONCILIATION_SOD');
  assert.equal((await call(finance, '/api/admin/finance/bank-reconciliations/:id/approve', { email: B, params: { id: made.body.id }, body: { branch: 'ONLINE_EGYPT' } })).statusCode, 200);
  const after = await call(finance, '/api/admin/finance/bank-reconciliations/:id/items', { email: A, params: { id: made.body.id }, body: { item_date: '2026-10-31', amount: 5, item_type: 'other', branch: 'ONLINE_EGYPT' } });
  assert.equal(after.statusCode, 409, 'an approved reconciliation takes no more items');
  const again = await call(finance, '/api/admin/finance/bank-reconciliations', { email: A, body: { period_start: '2026-10-01', period_end: '2026-10-31', opening_balance: 0, statement_closing_balance: 1000, account_code: '1100', branch: 'ONLINE_EGYPT' } });
  assert.equal(again.statusCode, 409, 'one reconciliation for a period');
});

test('a period closes only on an approved request, not by the person who asked nor the one who approved, and the request is spent', { skip }, async () => {
  const period = await call(accounting, '/api/admin/accounting-periods', { email: A, body: { label: '2026-10' } });
  assert.equal(period.statusCode, 200, JSON.stringify(period.body));
  const id = period.body.id;
  const close = email => call(accounting, '/api/admin/accounting-periods/:id/close', { email, params: { id } });
  const none = await close(C);
  assert.equal(none.statusCode, 409);
  assert.equal(none.body.code, 'PERIOD_CLOSE_APPROVAL_REQUIRED');

  const asked = await call(finance, '/api/admin/accounting-periods/:id/close-request', { email: A, params: { id }, body: { note: 'جاهزة' } });
  assert.equal(asked.statusCode, 201, JSON.stringify(asked.body));
  const second = await call(finance, '/api/admin/accounting-periods/:id/close-request', { email: A, params: { id } });
  assert.equal(second.statusCode, 409, 'one active request');
  const review = (email, decision) => call(finance, '/api/admin/accounting-periods/:id/close-request/:requestId/review', { email, params: { id, requestId: asked.body.id }, body: { decision } });
  assert.equal((await review(B, 'maybe')).statusCode, 400);
  const own = await review(A, 'approve');
  assert.equal(own.statusCode, 409);
  assert.equal(own.body.code, 'PERIOD_CLOSE_SOD');
  assert.equal((await review(B, 'approve')).statusCode, 200);

  for (const [email, who] of [[A, 'the one who asked'], [B, 'the one who approved']]) {
    const refused = await close(email);
    assert.equal(refused.statusCode, 409, who);
  }
  const closed = await close(C);
  assert.equal(closed.statusCode, 200, JSON.stringify(closed.body));
  assert.equal((await pool.query('SELECT status FROM accounting_periods WHERE id=?', [id]))[0][0].status, 'closed');
  assert.equal((await pool.query('SELECT status FROM accounting_close_requests WHERE id=?', [asked.body.id]))[0][0].status, 'consumed', 'the approval is spent by the closing');
});
