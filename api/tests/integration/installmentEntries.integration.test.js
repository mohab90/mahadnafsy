'use strict';
/**
 * 7 Nov 2026 (migration 369): the instalments of every plan in installment_entries, so the online manager's overdue / due-soon list is a range read. Against a real MariaDB:
 *   - the migration's own copy of the plans' JSON arrays equals what the JavaScript walk (lib/installmentMath.js planEntries) gives, for plans with unpaid, paid, part-paid,
 *     dateless and many-entry instalments;
 *   - after a plan is written (syncPlanEntries) and after a plan is rebuilt, its rows are its plan's, and a plan that is gone leaves no rows;
 *   - the list read from the rows (dueFromEntries) is the list the plans give (dueInstallments over the plans): the same instalments, the same counts, the scope respected,
 *     a deleted client left out. Runs only with DB_*.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-installments-it';
let pool, entries, math, view, dates, splitStatements;

const clean = async () => { for (const t of ['installment_entries', 'installment_plans', 'subscribers']) await pool.query(`DELETE FROM ${t} WHERE tenant_id=?`, [T]).catch(() => {}); };
const day = offset => dates.addDaysToDateOnly(dates.cairoToday(), offset);
async function plan(id, sub, { dueDates, amounts, paidDates, paidAmounts, count, currency = 'EGP' }) {
  await pool.query(
    `INSERT INTO installment_plans (id, tenant_id, subscriber_id, title, total_amount, currency, installments_count, installment_amounts, due_dates, paid_dates, paid_amounts, payment_ids, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'active')`,
    [id, T, sub, `خطة ${id}`, amounts.reduce((a, b) => a + b, 0), currency, count ?? dueDates.length, JSON.stringify(amounts), JSON.stringify(dueDates), JSON.stringify(paidDates),
      JSON.stringify(paidAmounts || paidDates.map(d => (d ? 1 : null))), JSON.stringify(paidDates.map(d => (d ? `pay-${id}` : null)))]);
}
const rowsOf = async () => (await pool.query('SELECT plan_id, seq, due_date, amount, paid, paid_at FROM installment_entries WHERE tenant_id=? ORDER BY plan_id, seq', [T]))[0]
  .map(r => ({ plan: r.plan_id, seq: r.seq, due: String(r.due_date instanceof Date ? r.due_date.toISOString() : r.due_date).slice(0, 10), amount: Number(r.amount), paid: Number(r.paid), paidAt: r.paid_at ? String(r.paid_at instanceof Date ? r.paid_at.toISOString() : r.paid_at).slice(0, 10) : null }));

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  entries = require('../../lib/installmentEntries');
  math = require('../../lib/installmentMath');
  view = require('../../lib/staffClientsView');
  dates = require('../../lib/dates');
  ({ splitStatements } = require('../../lib/migrationRunner'));
  await clean();
  await pool.query(`INSERT INTO subscribers (id, tenant_id, client_code, name, phone, assigned_cs_id) VALUES
    ('in-s1', ?, 'IN1', 'هبة', '1018880001', 'cs-a'), ('in-s2', ?, 'IN2', 'سلمى', '1018880002', 'cs-b'), ('in-s3', ?, 'IN3', 'منى', '1018880003', 'cs-a')`, [T, T, T]);
  await pool.query("UPDATE subscribers SET deleted_at = NOW() WHERE id = 'in-s3' AND tenant_id = ?", [T]);
  // overdue, paid, part-paid, a gap without a date, a plan far in the future, a deleted client's plan
  await plan('in-p1', 'in-s1', { dueDates: [day(-20), day(-5), day(3), day(40)], amounts: [100, 100, 100, 100], paidDates: [day(-20), null, null, null] });
  await plan('in-p2', 'in-s2', { dueDates: [day(-1), day(0), day(6), day(8)], amounts: [250.5, 250.5, 250.5, 250.5], paidDates: [null, null, null, null], currency: 'SAR' });
  await plan('in-p3', 'in-s1', { dueDates: [day(-3), null, day(2)], amounts: [300, 300, 300], paidDates: [null, null, null], paidAmounts: [100, null, null], count: 3 });
  await plan('in-p4', 'in-s3', { dueDates: [day(-9)], amounts: [50], paidDates: [null] });
  const many = Array.from({ length: 24 }, (_, i) => day(i * 15 - 200));
  await plan('in-p5', 'in-s2', { dueDates: many, amounts: many.map(() => 10), paidDates: many.map((d, i) => (i < 10 ? d : null)) });
});
after(async () => { if (ENABLED) { await clean(); await pool.end(); } });

const expectedRows = async () => {
  const [plans] = await pool.query('SELECT * FROM installment_plans WHERE tenant_id=?', [T]);
  return plans.flatMap(p => math.planEntries(p).map(e => ({ plan: p.id, seq: Number(e.id.split('-').pop()) - 1, due: e.dueDate, amount: e.amount, paid: e.paidAt ? 1 : 0, paidAt: e.paidAt || null })))
    .sort((a, b) => (a.plan < b.plan ? -1 : a.plan > b.plan ? 1 : a.seq - b.seq));
};

test('the migration\'s copy of the plans equals the JavaScript walk of them', { skip }, async () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', '369_v26_installment_entries_backfill.sql'), 'utf8');
  for (const statement of splitStatements(sql)) await pool.query(statement);
  const got = (await rowsOf()).filter(r => r.plan.startsWith('in-'));
  assert.deepEqual(got, await expectedRows());
  assert.equal(got.filter(r => r.plan === 'in-p5').length, 24, 'many entries are all copied');
  assert.equal(got.filter(r => r.plan === 'in-p3').length, 2, 'the instalment without a date is not an entry');
});

test('writing a plan rewrites its rows, a rebuild restores them, and a plan that is gone leaves none', { skip }, async () => {
  await pool.query("UPDATE installment_plans SET paid_dates = ? WHERE id = 'in-p2' AND tenant_id = ?", [JSON.stringify([day(-1), null, null, null]), T]);
  await entries.syncPlanEntries(pool, T, 'in-p2');
  assert.equal((await rowsOf()).find(r => r.plan === 'in-p2' && r.seq === 0).paid, 1);
  await pool.query("DELETE FROM installment_entries WHERE plan_id = 'in-p1' AND tenant_id = ?", [T]);
  await pool.query("INSERT INTO installment_entries (id, plan_id, tenant_id, seq, due_date, amount, paid) VALUES ('in-ghost-1', 'in-ghost', ?, 0, ?, 1, 0)", [T, day(-1)]);
  await entries.rebuildInstallmentEntries(pool, { tenantId: T });
  assert.deepEqual((await rowsOf()), await expectedRows(), 'every plan\'s rows are its plan\'s again, the ghost\'s are gone');
});

test('the list read from the rows is the list the plans give, and the scope and the deleted client are respected', { skip }, async () => {
  await entries.rebuildInstallmentEntries(pool, { tenantId: T });
  const today = dates.cairoToday();
  const soon = day(7);
  for (const scope of [{ where: '1=1', params: [] }, { where: 's.assigned_cs_id = ?', params: ['cs-a'] }, { where: 's.assigned_cs_id = ?', params: ['cs-b'] }]) {
    const [planRows] = await pool.query(
      `SELECT ip.*, s.id AS client_id, s.name, s.phone, ip.title AS course_title FROM installment_plans ip JOIN subscribers s ON s.id = ip.subscriber_id AND s.tenant_id = ip.tenant_id
        WHERE s.tenant_id = ? AND s.deleted_at IS NULL AND (${scope.where})`, [T, ...scope.params]);
    const want = view.dueInstallments(planRows.map(row => ({ clientId: row.client_id, name: row.name, phone: row.phone, plan: math.mapInstallmentPlan(row) })), today, soon);
    const got = await entries.dueFromEntries(pool, T, scope, today, soon, 500);
    const key = r => `${r.clientId}|${r.dueDate}|${r.amount}|${r.currency}`;
    assert.deepEqual(got.overdue.map(key).sort(), want.overdue.map(key).sort(), `${scope.where}: overdue`);
    assert.deepEqual(got.upcoming.map(key).sort(), want.upcoming.map(key).sort(), `${scope.where}: coming within a week`);
    assert.equal(got.overdueCount, want.overdue.length);
    assert.equal(got.upcomingCount, want.upcoming.length);
    assert.ok(!got.overdue.some(r => r.clientId === 'in-s3'), 'a deleted client\'s plan is not listed');
  }
});
