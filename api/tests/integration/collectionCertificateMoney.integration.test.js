'use strict';
/**
 * The owner, 11 Nov 2026: certificate payments are COLLECTION, not sales. On a real MariaDB: the online team's report (the collection officer's «اللي اتحصّل») and the owner's
 * daily income count certificate money and say how much of the figure it is; neither mixes it into course money (the pace against the collection target is in
 * overviewBoard.integration.test.js). Rows: an officer's client paid a booking 1000, an instalment 500 and a certificate 300 (all paid), plus a pending certificate 700,
 * a deleted one 800 and a certificate of a client who belongs to nobody.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-collection-cert-it';
let pool;

const { cairoToday, cairoDayStartUtc } = require('../../lib/dates');
const { businessDayBounds } = require('../../lib/dailyIncomeReport');

const TODAY = cairoToday();
const noon = new Date(new Date(cairoDayStartUtc(TODAY)).getTime() + 12 * 3600 * 1000);
let seq = 0;
const payment = (amount, { type = 'COURSE', status = 'paid', installment = 0, sub = 'sub-cc-1', deleted = false } = {}) => pool.query(
  `INSERT INTO payments (id, tenant_id, subscriber_id, date, amount, currency, fx_rate_to_egp, amount_egp, payment_type, course_id, status, branch, payment_method, is_installment, deleted_at, created_at)
   VALUES (?, ?, ?, ?, ?, 'EGP', 1, ?, ?, 'co-cc-1', ?, 'ONLINE_EGYPT', 'كاش', ?, ?, ?)`,
  [`pay-cc-${++seq}`, T, sub, noon, amount, amount, type, status, installment, deleted ? new Date() : null, noon]);

async function clean() {
  for (const table of ['payments', 'courses', 'subscribers', 'staff']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
}

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'IT', 'active')", [T, T]);
  await pool.query("INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES ('st-cc-1', ?, 'مسئولة التحصيل', 'cc1@example.test', '1019800001', 'COLLECTION', 1, '2025-01-01')", [T]);
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone, branch, assigned_cs_id) VALUES ('sub-cc-1', ?, 'عميلها', '1019800010', 'ONLINE_EGYPT', 'st-cc-1'), ('sub-cc-2', ?, 'عميل مفيش مسئول', '1019800011', 'ONLINE_EGYPT', NULL)", [T, T]);
  await pool.query("INSERT INTO courses (id, tenant_id, slug, title, description, short_description, instructor, thumbnail, category, type) VALUES ('co-cc-1', ?, 'co-cc-1', 'دورة', '', '', '', '', 'GENERAL', 'RECORDED')", [T]);
  await payment(1000);
  await payment(500, { installment: 1 });
  await payment(300, { type: 'CERTIFICATE' });
  await payment(700, { type: 'CERTIFICATE', status: 'pending' });
  await payment(800, { type: 'CERTIFICATE', deleted: true });
  await payment(90, { type: 'CERTIFICATE', sub: 'sub-cc-2' });
});
after(async () => {
  if (!ENABLED) return;
  await clean();
  await pool.end();
});

test('the collection officer\'s collected figure counts certificate money and says how much of it it is', { skip }, async () => {
  const { buildOnlineTeamReport } = require('../../lib/teamReports');
  const report = await buildOnlineTeamReport({ tenantId: T, from: TODAY, to: TODAY, today: TODAY });
  const row = report.rows.find(item => item.id === 'st-cc-1');
  assert.equal(row.collectedEgp, 1800, 'booking 1000 + instalment 500 + certificate 300 — not the pending or the deleted one');
  assert.equal(row.certificatesEgp, 300, 'of which certificates');
  assert.equal(row.installments, 1);
  assert.equal(report.totals.certificatesEgp, 300);
  assert.equal(report.totals.collectedEgp, 1800);
});

test('the owner\'s daily income counts certificate money in the total and names it', { skip }, async () => {
  const { buildDailyIncomeReport } = require('../../lib/dailyIncomeReport');
  // The business day runs 19:00 to 19:00; the rows were created at noon Cairo, so they belong to the day that ENDS at 19:00 that day.
  const date = TODAY;
  const { startUtc, endUtc } = businessDayBounds(date);
  assert.ok(new Date(`${startUtc.replace(' ', 'T')}Z`) <= noon && noon < new Date(`${endUtc.replace(' ', 'T')}Z`));
  const report = await buildDailyIncomeReport({ tenantId: T, date });
  assert.equal(report.income.acceptedEgp, 1000 + 500 + 300 + 90, 'every paid payment, certificates included');
  assert.equal(report.income.reviewEgp, 700, 'the pending certificate waits for review like any other');
  assert.equal(report.income.certificatesEgp, 300 + 700 + 90, 'how much of the day\'s total is certificates (paid and under review)');
  assert.equal(report.income.totalEgp, 1000 + 500 + 300 + 90 + 700);
  assert.equal(report.counts.newBookings, 1, 'a certificate is not a booking: course money alone counts as one');
});
