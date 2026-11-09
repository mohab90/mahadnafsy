'use strict';
/**
 * The sales-sheet comparison (lib/salesSheetReconcile.js) against a real MariaDB with MADE-UP clients, for every category of the report, and the target system
 * applied to both sides. October 2026, the plan migration 381 seeds with the reps' half-month rounds.
 *
 *   rep ريم  (first target 10, tab «ريم»)   sheet round 1: ten health bookings that agree + five that don't (refunded, voided, pending only, unregistered,
 *                                           booked under سلمى) = 15 → 1,500; the system counts the ten → 1,000
 *                                           round 2: eight rows (matched with a different date, a different price, a different course, found by name, by the
 *                                           second phone, paid in SAR, one client booked for two courses)
 *   rep سلمى (first target 10, tab «سلمى»)   one booking that agrees, and the one under her name that ريم's tab claims
 *   tab «غريبة»                               names no one: its row is read, the rep is not compared
 *   the system has two October bookings the sheet never mentions (one by ريم, one with no rep)
 *
 * Runs only with DB_* (or TEST_DB_*).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'NAME']) {
  if (process.env[`TEST_DB_${key}`]) process.env[`DB_${key}`] = process.env[`TEST_DB_${key}`];
}
const ENABLED = !!(process.env.DB_USER && process.env.DB_NAME);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-0123456789';
const skip = !ENABLED && 'no DB_* configured';
const T = 'tenant-recon-it';
let pool; let reconcile; let report; let render;

let seq = 0;
const stamp = day => `2026-10-${String(day).padStart(2, '0')} 12:00:00`;
async function pay({ client, course, amount, staff, day = 10, currency = 'EGP', fx = 1, expected, status = 'paid', deleted = false }) {
  await pool.query(
    `INSERT INTO payments (id, tenant_id, subscriber_id, course_id, amount, currency, fx_rate_to_egp, amount_egp, payment_type, status, course_expected, date,
       payment_method, staff_id, is_installment, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'COURSE', ?, ?, ?, 'كاش', ?, 0, ?)`,
    [`pay-rc-${++seq}`, T, client, course, amount, currency, fx, amount * fx, status, expected ?? null, stamp(day), staff || null, deleted ? new Date() : null]);
}
const client = (id, { phone, phone2 = null, rep = null, name } = {}) => pool.query(
  "INSERT INTO subscribers (id, tenant_id, name, phone, phone2, branch, assigned_sales_id) VALUES (?, ?, ?, ?, ?, 'ONLINE_EGYPT', ?)",
  [id, T, name || `عميل تجريبي ${id}`, phone, phone2, rep]);
const staff = (id, name, extra = {}) => pool.query(
  `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, bonus_scheme, booking_first_target)
   VALUES (?, ?, ?, ?, ?, 'SALES', 1, '2025-01-01', 'SALES_BOOKINGS', ?)`, [id, T, name, `${id}@rc.test`, `10170${String(++seq).padStart(5, '0')}`, extra.firstTarget ?? null]);

async function clean() {
  for (const table of ['refunds', 'employee_bonuses', 'payments', 'client_item_money', 'leads', 'subscribers', 'courses', 'staff', 'tenant_settings']) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
  }
}

// A parsed sheet row (what lib/salesSheet.js reads), made up.
const sheetRow = (tab, rowNumber, props) => ({
  tab, rowNumber, name: `عميل تجريبي ${rowNumber}`, phones: [], course: 'علم نفس متكامل', day: '2026-10-20', price: 4600, deposit: 900, branch: 'ONLINE', discount: null,
  nationalId: null, round: 2, roundByMarker: 2, roundByDate: 2, roundConflict: false, problems: [], ...props,
});
const round1 = day => ({ day: `2026-10-${String(day).padStart(2, '0')}`, round: 1, roundByMarker: 1, roundByDate: 1 });

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  reconcile = require('../../lib/salesSheetReconcile');
  render = require('../../lib/salesSheetReport');
  await clean();
  await pool.query("INSERT IGNORE INTO tenants (id, slug, name, status) VALUES (?, ?, 'Recon IT', 'active')", [T, T]);
  const seeded = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', '381_v26_bonus_plan.sql'), 'utf8').match(/'bonus_plan', '(\{.*\})', 0/)[1]);
  await require('../../lib/tenantSettings').setTenantSetting('bonus_plan', { ...seeded, salesPeriod: 'HALF_MONTH' }, { tenantId: T });
  for (const [id, title, price] of [['c-int', 'علم النفس المتكامل', 4600], ['c-clin', 'علم النفس الاكلينكي', 4140], ['c-health', 'الصحة النفسية', 2800]]) {
    await pool.query(
      `INSERT INTO courses (id, tenant_id, title, description, short_description, instructor, thumbnail, category, type, price_egp)
       VALUES (?, ?, ?, '', '', '', '', 'GENERAL', 'RECORDED', ?)`, [id, T, title, price]);
  }
  await staff('rep-r', 'ريم تجريبية سيلز', { firstTarget: 10 });
  await staff('rep-s', 'سلمى تجريبية سيلز', { firstTarget: 10 });

  // ريم: ten health bookings that agree (days 1–10), phones 0110000020N
  for (let n = 1; n <= 10; n++) {
    await client(`h${n}`, { phone: `011000002${String(n).padStart(2, '0')}`, rep: 'rep-r' });
    await pay({ client: `h${n}`, course: 'c-health', amount: 2800, staff: 'rep-r', day: n, expected: 2800 });
  }
  // five that don't
  await client('x-ref', { phone: '01100000211', rep: 'rep-r' }); await pay({ client: 'x-ref', course: 'c-health', amount: 2800, staff: 'rep-r', day: 11, expected: 2800, status: 'refunded' });
  await client('x-void', { phone: '01100000212', rep: 'rep-r' }); await pay({ client: 'x-void', course: 'c-health', amount: 2800, staff: 'rep-r', day: 12, expected: 2800, deleted: true });
  await client('x-pend', { phone: '01100000213', rep: 'rep-r' }); await pay({ client: 'x-pend', course: 'c-health', amount: 500, staff: 'rep-r', day: 13, expected: 2800, status: 'pending' });
  await pool.query("INSERT INTO leads (id, tenant_id, name, phone, source, status) VALUES ('lead-1', ?, 'مهتمة تجريبية', '01100000214', 'test', 'new')", [T]);
  await client('x-other', { phone: '01100000215', rep: 'rep-s' }); await pay({ client: 'x-other', course: 'c-health', amount: 2800, staff: 'rep-s', day: 15, expected: 2800 });
  // round 2
  await client('m1', { phone: '201100000301', rep: 'rep-r' }); await pay({ client: 'm1', course: 'c-int', amount: 4600, staff: 'rep-r', day: 18, expected: 4600 });
  await client('pr', { phone: '01100000302', rep: 'rep-r' }); await pay({ client: 'pr', course: 'c-int', amount: 4600, staff: 'rep-r', day: 19, expected: 4600 });
  await client('cr', { phone: '01100000303', rep: 'rep-r' }); await pay({ client: 'cr', course: 'c-health', amount: 4140, staff: 'rep-r', day: 20, expected: 4140 });
  await client('nm', { phone: '01100000304', rep: 'rep-r', name: 'عميل تجريبي بالاسم فقط' }); await pay({ client: 'nm', course: 'c-int', amount: 4600, staff: 'rep-r', day: 21, expected: 4600 });
  await client('p2', { phone: '01100000401', phone2: '01100000402', rep: 'rep-r' }); await pay({ client: 'p2', course: 'c-int', amount: 4600, staff: 'rep-r', day: 22, expected: 4600 });
  await client('sar', { phone: '01100000305', rep: 'rep-r' }); await pay({ client: 'sar', course: 'c-int', amount: 575, currency: 'SAR', fx: 8, staff: 'rep-r', day: 23, expected: 575 });
  await client('two', { phone: '01100000306', rep: 'rep-r' });
  await pay({ client: 'two', course: 'c-int', amount: 4600, staff: 'rep-r', day: 24, expected: 4600 });
  await pay({ client: 'two', course: 'c-clin', amount: 4140, staff: 'rep-r', day: 24, expected: 4140 });
  await client('unm', { phone: '01100000307', rep: 'rep-r' }); await pay({ client: 'unm', course: 'c-int', amount: 4600, staff: 'rep-r', day: 25, expected: 4600 });
  // سلمى
  await client('s1', { phone: '01100000308', rep: 'rep-s' }); await pay({ client: 's1', course: 'c-int', amount: 4600, staff: 'rep-s', day: 26, expected: 4600 });
  // the system has two the sheet never mentions
  await client('miss', { phone: '01100000309', rep: 'rep-r' }); await pay({ client: 'miss', course: 'c-int', amount: 4600, staff: 'rep-r', day: 27, expected: 4600 });
  await client('norep', { phone: '01100000310' }); await pay({ client: 'norep', course: 'c-int', amount: 4600, day: 28, expected: 4600 });

  const rim = [];
  for (let n = 1; n <= 10; n++) rim.push(sheetRow('ريم', n, { name: `عميل تجريبي h${n}`, phones: [`11000002${String(n).padStart(2, '0')}`], course: 'صحة نفسية', price: 2800, ...round1(n) }));
  rim.push(
    sheetRow('ريم', 11, { name: 'عميل تجريبي x-ref', phones: ['1100000211'], course: 'صحة نفسية', price: 2800, ...round1(11) }),
    sheetRow('ريم', 12, { name: 'عميل تجريبي x-void', phones: ['1100000212'], course: 'صحة نفسية', price: 2800, ...round1(12) }),
    sheetRow('ريم', 13, { name: 'عميل تجريبي x-pend', phones: ['1100000213'], course: 'صحة نفسية', price: 2800, ...round1(13) }),
    sheetRow('ريم', 14, { name: 'عميلة مجهولة تماما', phones: ['1100000214'], course: 'صحة نفسية', price: 2800, ...round1(14) }),
    sheetRow('ريم', 15, { name: 'عميل تجريبي x-other', phones: ['1100000215'], course: 'صحة نفسية', price: 2800, ...round1(15) }),
    sheetRow('ريم', 16, { name: 'عميل تجريبي m1', phones: ['1100000301'], day: '2026-10-19' }),
    sheetRow('ريم', 17, { name: 'عميل تجريبي pr', phones: ['1100000302'], price: 4000, day: '2026-10-19' }),
    sheetRow('ريم', 18, { name: 'عميل تجريبي cr', phones: ['1100000303'], course: 'اكلينكي', price: 4140, day: '2026-10-20' }),
    sheetRow('ريم', 19, { name: 'عميل تجريبي بالاسم فقط', phones: ['1100000999'], day: '2026-10-21' }),
    sheetRow('ريم', 20, { name: 'عميل تجريبي p2', phones: ['01100000499', '01100000402'], day: '2026-10-22' }),
    sheetRow('ريم', 21, { name: 'عميل تجريبي sar', phones: ['1100000305'], day: '2026-10-23' }),
    sheetRow('ريم', 22, { name: 'عميل تجريبي two', phones: ['1100000306'], course: 'متكامل', day: '2026-10-24' }),
    sheetRow('ريم', 23, { name: 'عميل تجريبي two', phones: ['1100000306'], course: 'اكلينكي', price: 4140, day: '2026-10-24' }));
  const sheet = {
    reps: [
      { tab: 'ريم', rows: rim, unreadable: [] },
      { tab: 'سلمى', rows: [sheetRow('سلمى', 1, { name: 'عميل تجريبي s1', phones: ['1100000308'], day: '2026-10-26' })], unreadable: [] },
      { tab: 'غريبة', rows: [sheetRow('غريبة', 1, { name: 'عميل تجريبي unm', phones: ['1100000307'], day: '2026-10-25' })], unreadable: [] },
    ],
    unreadable: [{ tab: 'ريم', rowNumber: 40, reason: 'مفيش سعر', cells: ['عميل', 'x'] }],
  };
  report = await reconcile.reconcileSalesSheet(pool, { tenantId: T, sheet, year: 2026, month: 10 });
});
after(async () => { if (!ENABLED) return; await clean(); await pool.end(); });

const row = (tab, number) => report.rows.find(item => item.tab === tab && item.rowNumber === number);

test('every row lands in its category, and the totals add up', { skip }, () => {
  assert.equal(report.rows.length, 25);
  assert.deepEqual(report.totals, {
    rows: 25, MATCHED: 18, DIFFERENT: 2, REFUNDED: 1, VOIDED: 1, NO_PAID_BOOKING: 1, NOT_REGISTERED: 1, OTHER_REP: 1, missingFromSheet: 2, systemBookings: 23,
  });
  assert.deepEqual(['x-ref', 'x-void', 'x-pend'].map((id, index) => row('ريم', 11 + index).category), ['REFUNDED', 'VOIDED', 'NO_PAID_BOOKING']);
  assert.equal(row('ريم', 14).category, 'NOT_REGISTERED');
  assert.match(row('ريم', 14).notes.join(' '), /lead فقط: مهتمة تجريبية/, 'a lead with that phone is said');
});

test('under another rep: both reps are named', { skip }, () => {
  const other = row('ريم', 15);
  assert.equal(other.category, 'OTHER_REP');
  assert.deepEqual(other.diffs[0], { field: 'rep', sheet: 'ريم تجريبية سيلز', system: 'سلمى تجريبية سيلز' });
  assert.equal(other.system.rep.name, 'سلمى تجريبية سيلز');
});

test('different: the price, the course; the date and the spelling of the phone are not differences', { skip }, () => {
  const price = row('ريم', 17);
  assert.equal(price.category, 'DIFFERENT');
  assert.deepEqual(price.diffs, [{ field: 'price', sheet: 4000, system: 4600, gap: -600 }]);
  const course = row('ريم', 18);
  assert.equal(course.category, 'DIFFERENT');
  assert.deepEqual(course.diffs.map(diff => diff.field), ['course']);
  const date = row('ريم', 16);
  assert.equal(date.category, 'MATCHED', 'a client stored with the country code is found; one day apart is a note');
  assert.match(date.notes.join(' '), /التاريخ مختلف: الشيت 2026-10-19 والسيستم 2026-10-18 \(\+1 يوم\)/);
});

test('found by the name when the phone is not on file, by the second phone, and a booking in SAR is held at its price in EGP', { skip }, () => {
  assert.deepEqual([row('ريم', 19).client.by, row('ريم', 19).category], ['name', 'MATCHED']);
  assert.deepEqual([row('ريم', 20).client.id, row('ريم', 20).client.by, row('ريم', 20).category], ['p2', 'phone', 'MATCHED']);
  assert.deepEqual([row('ريم', 21).system.agreed, row('ريم', 21).category], [4600, 'MATCHED']);
});

test('one client booked for two courses: each row finds its own course', { skip }, () => {
  assert.deepEqual([row('ريم', 22), row('ريم', 23)].map(item => [item.system.item, item.category]), [['c-int', 'MATCHED'], ['c-clin', 'MATCHED']]);
});

test('a tab that names no employee is listed, and its row is read without comparing the rep', { skip }, () => {
  assert.deepEqual(report.tabs.map(item => [item.tab, item.staff?.name || null]), [['ريم', 'ريم تجريبية سيلز'], ['سلمى', 'سلمى تجريبية سيلز'], ['غريبة', null]]);
  const unmapped = row('غريبة', 1);
  assert.equal(unmapped.category, 'MATCHED');
  assert.match(unmapped.notes.join(' '), /التاب ما اتطابقش|ما اتطابقتش مع موظف/);
});

test('the system\'s October bookings the sheet never mentions, under their rep', { skip }, () => {
  assert.deepEqual(report.missingFromSheet.map(item => [item.clientCode === '' ? item.client : item.client, item.owner?.name || null, item.ownerHasTab]).sort(),
    [['عميل تجريبي miss', 'ريم تجريبية سيلز', true], ['عميل تجريبي norep', null, false]].sort());
});

test('the target system on both sides: the sheet\'s round 1 has 15 bookings, the system\'s 10; the reasons add up to the difference', { skip }, () => {
  const rim = report.perRep.find(item => item.tab === 'ريم');
  assert.equal(rim.staff.firstTarget, 10);
  assert.deepEqual(rim.rowsByRound, { 1: 15, 2: 8 });
  assert.deepEqual(rim.sheet.byMarker.rounds, [{ label: '1–18', bookings: 15, amount: 1500 }, { label: '19–31', bookings: 10.5, amount: 1000 }]);
  assert.equal(rim.sheet.byMarker.amount, 2500);
  assert.deepEqual([rim.sheetMarker.day, rim.systemSplit], [19, 16], 'the sheet marker day is information; the system draws its rounds on the 16th');
  assert.deepEqual(rim.system.rounds.map(round => [round.label, round.bookings, round.amount]), [['1–15', 10, 1000], ['16–31', 14, 1000]]);
  assert.equal(rim.system.amount, 2000);
  assert.equal(rim.difference, 500);
  const reasons = Object.fromEntries(rim.reasons.map(reason => [reason.kind, [reason.rows, reason.weight]]));
  assert.deepEqual(reasons, {
    NOT_REGISTERED: [1, 1], NO_PAID_BOOKING: [1, 1], REFUNDED: [1, 1], VOIDED: [1, 1], OTHER_REP: [1, 1], PRICE: [1, -0.5], MISSING_FROM_TAB: [2, -3],
  });
  assert.equal(rim.reasons.reduce((sum, reason) => sum + reason.weight, 0), rim.sheet.byMarker.bookings - rim.system.bookings, 'every booking of the difference is explained');
  assert.deepEqual(rim.sheet.byFirstTarget, { 10: 2500, 15: 1500, 20: 0 });
  const salma = report.perRep.find(item => item.tab === 'سلمى');
  assert.deepEqual([salma.sheet.byMarker.bookings, salma.system.bookings, salma.missingFromTab], [1.5, 2.5, 0]);
  assert.deepEqual(report.perRep.find(item => item.tab === 'غريبة').system, null);
});

test('nothing was written: no bonus, no change to any payment', { skip }, async () => {
  const [[bonuses]] = await pool.query('SELECT COUNT(*) AS n FROM employee_bonuses WHERE tenant_id=?', [T]);
  assert.equal(Number(bonuses.n), 0);
});

test('the Arabic report and the CSV hold every row', { skip }, () => {
  const markdown = render.renderMarkdown(report);
  for (const heading of ['## الملخص', '## كل سيلز', '## صفوف مختلفة (2)', '## عملاء حصلها استرداد (1)', '## باسم سيلز تاني في السيستم (1)', '## مش مسجلين في السيستم (ما اترفعوش) (1)', '## حجوزات في السيستم مش في الشيت (2)', '## صفوف ما اتقراتش (1)']) {
    assert.ok(markdown.includes(heading), heading);
  }
  assert.ok(markdown.includes('معهد الدراسات النفسية'));
  assert.ok(!markdown.includes('مهاد'));
  const csv = render.renderCsv(report);
  assert.ok(csv.startsWith('﻿'));
  assert.equal(csv.trim().split('\r\n').length, 1 + report.rows.length);
});
