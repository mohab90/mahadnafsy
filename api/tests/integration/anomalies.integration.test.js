'use strict';
/**
 * Flags against each figure's own four-week baseline (api/lib/anomalies.js) on a real MariaDB, a ledger small enough to do by hand. «Today» is Thursday 12 March 2026
 * 11:00 in Cairo (09:00 UTC, working hours); yesterday is Wednesday 11 March and its baseline the Wednesdays 4 March, 25, 18 and 11 February.
 *
 *   collections   yesterday 400 against 2000 / 2400 / 1600 / 2000 (mean 2000)                       → flagged;  a certificate and another tenant's money do not count
 *   lead sources  facebook 45 against 10 / 12 / 8 / 10 (mean 10) → flagged;  instagram 15 against 5s → under twenty, not;  google 30 against a mean of 25 → not twice, not
 *   idle          X: twenty actions a day for five days, seen five minutes ago, last acted 90 minutes ago → flagged
 *                 Y acted ten minutes ago;  Z is not a busy account;  W was last seen thirty minutes ago           → none flagged
 *   endpoints     one whose newer half is nine times its older half → flagged for whoever may read the monitor
 * and what a caller may not read is left out: no presence, no idle names; no monitor, no endpoints.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';

const T = 'tenant-anomaly-it';
const OTHER = 'tenant-anomaly-it-other';
const TODAY = '2026-03-12';
const NOW = Date.parse('2026-03-12T09:00:00Z');
const MIN = 60 * 1000;
let pool; let detect; let seq = 0;

const noon = day => new Date(`${day}T10:00:00Z`);
async function leads(day, source, count, tenant = T) {
  if (!count) return;
  const rows = Array.from({ length: count }, () => [`ld-an-${++seq}`, tenant, 'ليد', `0108${String(seq).padStart(7, '0')}`, source, noon(day)]);
  await pool.query("INSERT INTO leads (id, tenant_id, name, phone, source, status, hidden, created_at) VALUES ?", [rows.map(row => [...row.slice(0, 5), 'new', 0, row[5]])]);
}
const pay = (day, amount, extra = {}) => pool.query(
  `INSERT INTO payments (id, tenant_id, subscriber_id, date, amount, currency, fx_rate_to_egp, amount_egp, payment_type, course_id, status, branch, payment_method, is_installment)
   VALUES (?, ?, 'sub-an-1', ?, ?, 'EGP', 1, ?, ?, 'co-an-1', 'paid', 'ONLINE_EGYPT', 'كاش', 0)`, [`pay-an-${++seq}`, extra.tenant || T, noon(day), amount, amount, extra.type || 'COURSE']);
const logs = async (actor, days, perDay) => {
  const rows = [];
  for (const day of days) for (let i = 0; i < perDay; i++) rows.push([`al-an-${++seq}`, T, 'update', 'leads', 'x', actor, actor, '', '', new Date(`${day}T${String((i % 8) + 6).padStart(2, "0")}:00:00Z`)]);
  if (rows.length) await pool.query('INSERT INTO activity_logs (id, tenant_id, action, entity, label, actor, actor_name, department, details, at) VALUES ?', [rows]);
};
const presence = (key, seenMinutesAgo, actedMinutesAgo) => pool.query(
  `INSERT INTO staff_presence (tenant_id, staff_key, name, role, last_seen_at, last_action_at, last_action_kind, seen_day, first_seen_at) VALUES (?, ?, ?, 'SALES', ?, ?, 'write', '2026-03-12', ?)`,
  [T, key, key, new Date(NOW - seenMinutesAgo * MIN), actedMinutesAgo === null ? null : new Date(NOW - actedMinutesAgo * MIN), new Date(NOW - 120 * MIN)]);

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  detect = require('../../lib/anomalies').detectAnomalies;
  for (const id of ['x', 'y', 'z', 'w']) await pool.query("INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at) VALUES (?, ?, ?, ?, ?, 'SALES', 1, '2025-01-01')", [`st-an-${id}`, T, `موظف ${id.toUpperCase()}`, `${id}@an.test`, `10111111${id.charCodeAt(0)}`]);
  await pool.query("INSERT INTO courses (id, tenant_id, slug, title, description, short_description, instructor, thumbnail, category, type) VALUES ('co-an-1', ?, 'co-an-1', 'دورة', '', '', '', '', 'GENERAL', 'RECORDED')", [T]);
  await pool.query("INSERT INTO subscribers (id, tenant_id, name, phone, branch) VALUES ('sub-an-1', ?, 'عميل', '1018200001', 'ONLINE_EGYPT')", [T]);

  const wednesdays = ['2026-03-04', '2026-02-25', '2026-02-18', '2026-02-11'];
  await pay('2026-03-11', 400); await pay('2026-03-11', 150, { type: 'CERTIFICATE' }); await pay('2026-03-11', 9000, { tenant: OTHER });
  for (const [day, amount] of wednesdays.map((d, i) => [d, [2000, 2400, 1600, 2000][i]])) await pay(day, amount);
  await leads('2026-03-11', 'facebook', 45); await leads('2026-03-11', 'instagram', 15); await leads('2026-03-11', 'google', 30);
  for (const [i, day] of wednesdays.entries()) { await leads(day, 'facebook', [10, 12, 8, 10][i]); await leads(day, 'instagram', 5); await leads(day, 'google', [25, 20, 30, 25][i]); }
  await leads('2026-03-11', 'facebook', 500, OTHER);

  const week = ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-08'];
  await logs('x@an.test', week, 20); await logs('y@an.test', week, 20); await logs('z@an.test', week, 3); await logs('w@an.test', week, 20);
  await presence('st-an-x', 5, 90); await presence('st-an-y', 5, 10); await presence('st-an-z', 5, 200); await presence('st-an-w', 30, 200);

  const perf = require('../../lib/performanceMonitor');
  perf.reset();
  for (let i = 0; i < 20; i++) perf.recordRequest({ method: 'GET', route: '/api/admin/getting-slower', status: 200, ms: 100, bytes: 1 });
  for (let i = 0; i < 20; i++) perf.recordRequest({ method: 'GET', route: '/api/admin/getting-slower', status: 200, ms: 900, bytes: 1 });
});

after(async () => { if (ENABLED) await pool.end().catch(() => {}); });

test('every flag a caller may read, each with a sentence and the screen to act on', { skip }, async () => {
  const flags = await detect(T, { today: TODAY, now: NOW, canSeeMonitor: true, canSeePresence: true });
  assert.deepEqual(flags.map(flag => flag.key).sort(), ['collections-drop', 'idle:st-an-x', 'lead-surge:facebook', 'slower:GET /api/admin/getting-slower']);
  const by = key => flags.find(flag => flag.key === key);
  assert.match(by('collections-drop').text, /400 ج.*2,000 ج/);
  assert.equal(by('collections-drop').to, '/dashboard/financial');
  assert.match(by('lead-surge:facebook').text, /«facebook» جاب 45 ليد.*10/);
  assert.match(by('idle:st-an-x').text, /موظف X.*من 90 دقيقة.*20 إجراء/);
  assert.equal(by('idle:st-an-x').to, '/dashboard/presence_now');
  assert.match(by('slower:GET /api/admin/getting-slower').text, /من 100 لـ 900/);
  for (const flag of flags) assert.ok(flag.text && flag.to.startsWith('/dashboard/') && ['rose', 'amber', 'sky'].includes(flag.tone), flag.key);
});

test('what the caller may not read is left out: no presence, no idle names; no monitor, no endpoints', { skip }, async () => {
  const flags = await detect(T, { today: TODAY, now: NOW, canSeeMonitor: false, canSeePresence: false });
  assert.deepEqual(flags.map(flag => flag.key).sort(), ['collections-drop', 'lead-surge:facebook']);
});

test('a quiet tenant has no flags, and another tenant\'s figures never reach it', { skip }, async () => {
  const flags = await detect('tenant-anomaly-it-empty', { today: TODAY, now: NOW, canSeeMonitor: false, canSeePresence: false });
  assert.deepEqual(flags, []);
});
