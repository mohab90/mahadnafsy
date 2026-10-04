'use strict';
/**
 * General accounting, end to end against a real MariaDB: payments (EGP and
 * SAR) and an expense posted through the same functions the routes use
 * (lib/finance.js), the expense then edited and deleted as the expense screen
 * does it. The trial balance must balance, the P&L must equal what was taken
 * in EGP minus what is still spent, its expense breakdown (read from the
 * expenses table) must agree with its ledger total, and the balance sheet must
 * show no imbalance. Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-ledger-it';
const DAY = '2026-09-15';
let pool, finance, financeRouter, analyticsRouter;

async function clean() {
  await pool.query('DELETE jel FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.entry_id WHERE je.tenant_id=?', [T]).catch(() => {});
  for (const table of ['journal_entries', 'invoices', 'payments', 'expenses', 'subscribers', 'tenant_settings']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
  await pool.query('DELETE FROM tenants WHERE id=?', [T]).catch(() => {});
}
const handler = (router, path) => router.stack.find(l => l.route?.path === path && l.route.methods.get).route.stack.at(-1).handle;
async function get(router, path, query) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } };
  await handler(router, path)({ params: {}, query, body: {}, headers: {}, tenantId: T, user: { uid: 'a' }, staffRecord: null, isSuperAdmin: true, ip: '1', get: () => undefined }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body;
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  finance = require('../../lib/finance');
  financeRouter = require('../../routes/finance');
  analyticsRouter = require('../../routes/analytics/financial');
  await clean();
  await pool.query("INSERT INTO tenants (id, slug, name, status) VALUES (?, ?, 'Ledger IT', 'suspended')", [T, T]);
  const { setTenantSetting } = require('../../lib/tenantSettings');
  await setTenantSetting('content', {
    'exchange.sar_to_egp': '13.2', 'exchange.usd_to_egp': '48.5', 'exchange.source': 'test', 'exchange.updated_at': new Date().toISOString(),
  }, { tenantId: T });
  finance.invalidateFxCache(T);
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone) VALUES ('lg-sub', ?, 'عميلة', '1015000001')", [T]);
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

test('payments and an edited, then deleted, expense leave reports that agree', { skip }, async () => {
  const payments = [['lg-p1', 2000, 'EGP', 'COURSE'], ['lg-p2', 95, 'SAR', 'COURSE'], ['lg-p3', 750, 'EGP', 'CONSULTATION']];
  for (const [id, amount, currency, type] of payments) {
    await pool.query(
      `INSERT INTO payments (id, tenant_id, subscriber_id, amount, currency, payment_type, payment_method, status, date)
       VALUES (?, ?, 'lg-sub', ?, ?, ?, 'cash', 'paid', ?)`, [id, T, amount, currency, type, DAY]);
    assert.ok(await finance.postPaymentJournal({ paymentId: id, amount, currency, payType: type, date: DAY, tenantId: T }), `${id} posted`);
  }
  const takenEgp = 2000 + 95 * 13.2 + 750; // 4,004
  const [[stored]] = await pool.query("SELECT amount_egp FROM payments WHERE id='lg-p2' AND tenant_id=?", [T]);
  assert.equal(Number(stored.amount_egp), 1254, 'the SAR payment is stored at the rate it was posted with');

  // An expense, then the screen's edit (reverse + repost) and a second one kept.
  const rent = { id: 'lg-e1', tenant_id: T, description: 'إيجار', amount: 1500, currency: 'EGP', category: 'RENT', date: DAY };
  const ads = { id: 'lg-e2', tenant_id: T, description: 'إعلانات', amount: 20, currency: 'USD', category: 'MARKETING', date: DAY };
  for (const e of [rent, ads]) {
    await pool.query('INSERT INTO expenses (id, tenant_id, description, amount, currency, category, date, created_at) VALUES (?,?,?,?,?,?,?,NOW())',
      [e.id, T, e.description, e.amount, e.currency, e.category, e.date]);
    assert.ok(await finance.postExpenseJournal(e, 1, 'test', pool, T));
  }
  const [[rentRow]] = await pool.query("SELECT * FROM expenses WHERE id='lg-e1' AND tenant_id=?", [T]);
  assert.ok(await finance.postExpenseJournal(rentRow, -1, 'test', pool, T), 'edit: the old amount comes out');
  await pool.query("UPDATE expenses SET amount=1800, amount_egp=NULL WHERE id='lg-e1' AND tenant_id=?", [T]);
  assert.ok(await finance.postExpenseJournal({ ...rent, amount: 1800 }, 1, 'test', pool, T), 'edit: the new amount goes in');
  // Then deleted, as the screen soft-deletes and reverses.
  const [[edited]] = await pool.query("SELECT * FROM expenses WHERE id='lg-e1' AND tenant_id=?", [T]);
  assert.ok(await finance.postExpenseJournal(edited, -1, 'test', pool, T));
  await pool.query("UPDATE expenses SET deleted_at=NOW() WHERE id='lg-e1' AND tenant_id=?", [T]);
  const spentEgp = 20 * 48.5; // only the ads remain: 970

  const range = { from: '2026-09-01', to: '2026-09-30' };
  const tb = await get(financeRouter, '/api/admin/reports/trial-balance', range);
  assert.equal(tb.totals.balanced, true, JSON.stringify(tb.totals));
  const cash = tb.accounts.find(a => a.account_code === '1100');
  assert.equal(cash.balance, takenEgp - spentEgp, 'cash = taken in − still spent');

  const pnl = await get(analyticsRouter, '/api/admin/financial/pnl', range);
  assert.equal(pnl.totalRevenue, takenEgp);
  assert.equal(pnl.totalExpenses, spentEgp);
  assert.equal(pnl.netProfit, takenEgp - spentEgp);
  const breakdown = pnl.expensesByCategory.reduce((sum, row) => sum + Number(row.total), 0);
  assert.equal(breakdown, pnl.totalExpenses, 'the category breakdown (expenses table) agrees with the ledger total');

  const bs = await get(analyticsRouter, '/api/admin/financial/balance-sheet', { asOf: '2026-09-30' });
  assert.equal(bs.assets.cashAndEquivalents, takenEgp - spentEgp);
  assert.ok(Math.abs(Number(bs.summary.ledgerImbalance || 0)) < 0.01, `balance sheet imbalance ${bs.summary.ledgerImbalance}`);
});
