'use strict';
/**
 * The collection-sheet comparison (lib/collectionSheetReconcile.js) against a real MariaDB with MADE-UP clients and payments, for every category of the report, October 2026.
 *
 *   tab «آلاء» (employee a)   found under her · under another employee · a certificate recorded as course money and the reverse · another amount · another date ·
 *                             a voided payment · a client with no payment · a client not registered (a lead) · the same row twice · a payment in SAR · three days apart ·
 *                             a still-pending payment · a row dated outside the month
 *   tab «بيان» (employee b)   found by the name (no phone), by the sender's number, and as two payments that add up to the row (a course and a certificate)
 *   tab «غريبة»               names no employee: its row is found, the employee is not compared
 *   the system has payments the tabs lack: employee c has no tab at all; a site payment (no employee) and a September payment are nobody's to list
 *
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
const T = 'tenant-collrec-it';
let pool; let report; let render; let before_; let reconcileLib; let sheetUsed;

let seq = 0;
const stamp = day => (typeof day === 'string' ? day : `2026-10-${String(day).padStart(2, '0')}`) + ' 12:00:00';
async function pay({ client, amount, staff, day, type = 'COURSE', status = 'paid', deleted = false, currency = 'EGP', fx = 1, egp }) {
  await pool.query(
    `INSERT INTO payments (id, tenant_id, subscriber_id, amount, currency, fx_rate_to_egp, amount_egp, payment_type, status, date, payment_method, staff_id, is_installment, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'فودافون كاش', ?, 0, ?)`,
    [`pay-cr-${++seq}`, T, client, amount, currency, fx, egp ?? amount * fx, type, status, stamp(day), staff || null, deleted ? new Date() : null]);
}
const client = (id, phone, name) => pool.query("INSERT INTO subscribers (id, tenant_id, name, phone, branch) VALUES (?, ?, ?, ?, 'ONLINE_EGYPT')", [id, T, name || `عميل تحصيل ${id}`, phone]);
const staff = (id, name) => pool.query(
  `INSERT INTO staff (id, tenant_id, name, email, phone, role, is_active, joined_at, bonus_scheme)
   VALUES (?, ?, ?, ?, ?, 'COLLECTION', 1, '2025-01-01', 'COLLECTION')`, [id, T, name, `${id}@cr.test`, `10160${String(++seq).padStart(5, '0')}`]);

async function clean() {
  for (const table of ['payments', 'leads', 'subscribers', 'staff']) await pool.query(`DELETE FROM ${table} WHERE tenant_id=?`, [T]).catch(() => {});
}

// a parsed row (what lib/collectionSheet.js reads), made up
const srow = (tab, rowNumber, props) => ({
  tab, rowNumber, name: `عميل تحصيل ${rowNumber}`, phones: [], senderPhones: [], text: 'قسط/متكامل', kinds: ['COURSE'], amount: 1000, total: null, left: null,
  day: '2026-10-10', inMonth: true, method: 'فودافون كاش', problems: [], ...props,
});

before(async () => {
  if (!ENABLED) return;
  ({ pool } = require('../../lib/db'));
  const reconcile = require('../../lib/collectionSheetReconcile');
  reconcileLib = reconcile;
  render = require('../../lib/collectionSheetReport');
  await clean();
  await staff('coll-a', 'آلاء تجريبية تحصيل'); await staff('coll-b', 'بيان تجريبية تحصيل'); await staff('coll-c', 'جنى تجريبية تحصيل');
  const phone = n => `0110000${String(n).padStart(4, '0')}`;
  for (let n = 601; n <= 620; n++) await client(`k${n - 600}`, phone(n), n === 609 ? 'عميل تحصيل بالاسم' : undefined);
  await pool.query("INSERT INTO leads (id, tenant_id, name, phone, source, status) VALUES ('lead-cr', ?, 'مهتمة تجريبية', '01100000999', 'test', 'new')", [T]);
  const a = 'coll-a'; const b = 'coll-b';
  await pay({ client: 'k1', amount: 1250, staff: a, day: 5 });
  await pay({ client: 'k2', amount: 1000, staff: b, day: 6 });
  await pay({ client: 'k3', amount: 4600, staff: a, day: 7 });                       // a certificate recorded as course money
  await pay({ client: 'k4', amount: 1800, staff: a, day: 8, type: 'CERTIFICATE' });  // a course payment recorded as a certificate's
  await pay({ client: 'k5', amount: 1500, staff: a, day: 9 });
  await pay({ client: 'k6', amount: 2000, staff: a, day: 10 });
  await pay({ client: 'k7', amount: 900, staff: a, day: 12, deleted: true });
  await pay({ client: 'k9', amount: 800, staff: b, day: 13 });
  await pay({ client: 'k10', amount: 1200, staff: b, day: 13 });
  await pay({ client: 'k11', amount: 2000, staff: b, day: 14 });
  await pay({ client: 'k11', amount: 1500, staff: b, day: 14, type: 'CERTIFICATE' });
  await pay({ client: 'k12', amount: 750, staff: a, day: 15, currency: 'SAR', fx: 4, egp: 3000 });
  await pay({ client: 'k13', amount: 700, staff: a, day: 17, status: 'pending' });
  await pay({ client: 'k14', amount: 600, staff: a, day: 18 });
  await pay({ client: 'k15', amount: 500, staff: a, day: 19 });                      // the system has it, the tab lacks it
  await pay({ client: 'k16', amount: 400, staff: 'coll-c', day: 20 });               // employee c has no tab
  await pay({ client: 'k17', amount: 1100, staff: a, day: 18 });
  await pay({ client: 'k20', amount: 450, staff: a, day: 18, status: 'failed' });     // a payment the system has, and it failed
  await pay({ client: 'k18', amount: 300, day: 21 });                                // the site's own: no employee
  await pay({ client: 'k19', amount: 650, staff: b, day: '2026-09-20' });            // September

  const tabA = [
    srow('آلاء', 1, { phones: ['1100000601'], amount: 1250, day: '2026-10-05' }),
    srow('آلاء', 2, { phones: ['1100000602'], amount: 1000, day: '2026-10-06' }),
    srow('آلاء', 3, { phones: ['1100000603'], text: 'شهادات', kinds: ['CERTIFICATE'], amount: 4600, day: '2026-10-07' }),
    srow('آلاء', 4, { phones: ['1100000604'], amount: 1800, day: '2026-10-08' }),
    srow('آلاء', 5, { phones: ['1100000605'], amount: 1400, day: '2026-10-09' }),
    srow('آلاء', 6, { phones: ['1100000606'], amount: 2000, day: '2026-10-20' }),
    srow('آلاء', 7, { phones: ['1100000607'], amount: 900, day: '2026-10-12' }),
    srow('آلاء', 8, { phones: ['1100000608'], amount: 650, day: '2026-10-13' }),
    srow('آلاء', 9, { name: 'عميلة غير مسجلة', phones: ['1100000999'], amount: 300, day: '2026-10-14' }),
    srow('آلاء', 10, { phones: ['1100000601'], amount: 1250, day: '2026-10-05' }),
    srow('آلاء', 11, { phones: ['1100000612'], amount: 3000, day: '2026-10-15' }),
    srow('آلاء', 12, { phones: ['1100000617'], amount: 1100, day: '2026-10-16' }),
    srow('آلاء', 13, { phones: ['1100000613'], amount: 700, day: '2026-10-17' }),
    srow('آلاء', 14, { name: 'عميلة غير مسجلة ثانية', phones: ['1100000998'], amount: 200, day: '2026-09-16', inMonth: false, problems: ['التاريخ خارج الشهر'] }),
  ];
  const tabB = [
    srow('بيان', 1, { name: 'عميل تحصيل بالاسم', amount: 800, day: '2026-10-13' }),
    srow('بيان', 2, { name: 'اسم لا يطابق احدا', senderPhones: ['1100000610'], amount: 1200, day: '2026-10-13' }),
    srow('بيان', 3, { phones: ['1100000611'], text: 'قسط معالج /شهادة الازهر', kinds: ['CERTIFICATE', 'COURSE'], amount: 3500, day: '2026-10-14' }),
  ];
  const tabX = [srow('غريبة', 1, { phones: ['1100000614'], amount: 600, day: '2026-10-18' }), srow('غريبة', 2, { phones: ['1100000620'], amount: 450, day: '2026-10-18' })];
  const sheet = {
    collectors: [{ tab: 'آلاء', rows: tabA }, { tab: 'بيان', rows: tabB }, { tab: 'غريبة', rows: tabX }],
    unreadable: [{ tab: 'آلاء', rowNumber: 40, reason: 'مفيش مبلغ', cells: ['عميل'] }],
  };
  sheetUsed = sheet;
  before_ = (await pool.query('SELECT COUNT(*) AS n FROM payments WHERE tenant_id=?', [T]))[0][0].n;
  report = await reconcile.reconcileCollectionSheet(pool, { tenantId: T, sheet, year: 2026, month: 10 });
});
after(async () => { if (!ENABLED) return; await clean(); await pool.end(); });

const row = (tab, number) => report.rows.find(item => item.tab === tab && item.rowNumber === number);

test('every row lands in its category and the totals add up', { skip }, () => {
  assert.equal(report.rows.length, 19);
  assert.deepEqual([report.totals.rows, report.totals.FOUND_SAME, report.totals.OTHER_EMPLOYEE, report.totals.TYPE_MISMATCH, report.totals.DIFFERENT, report.totals.NOT_IN_SYSTEM, report.totals.UNPAID_IN_SYSTEM, report.totals.NOT_REGISTERED],
    [19, 7, 1, 2, 2, 3, 2, 2]);
  assert.deepEqual(report.totals.outsideMonth, 1);
  assert.deepEqual(report.totals.TYPE_FLAGS, 2);
});

test('found under the same employee: a payment in SAR is held at its EGP, three days apart is the same payment, a row twice is one payment', { skip }, () => {
  assert.equal(row('آلاء', 1).category, 'FOUND_SAME');
  assert.deepEqual([row('آلاء', 11).category, row('آلاء', 11).payments[0].amountEgp], ['FOUND_SAME', 3000]);
  const near = row('آلاء', 12);
  assert.equal(near.category, 'FOUND_SAME');
  assert.match(near.notes.join(' '), /التاريخ: الشيت 2026-10-16 والسيستم 2026-10-18/);
  assert.equal(row('آلاء', 10).category, 'NOT_IN_SYSTEM', 'the second of two identical rows has no payment of its own');
});

test('found under another employee: named', { skip }, () => {
  const other = row('آلاء', 2);
  assert.equal(other.category, 'OTHER_EMPLOYEE');
  assert.deepEqual(other.payments.map(payment => payment.staff.name), ['بيان تجريبية تحصيل']);
});

test('a certificate recorded as course money, and the reverse', { skip }, () => {
  const certificate = row('آلاء', 3);
  assert.deepEqual([certificate.category, certificate.flags], ['TYPE_MISMATCH', ['TYPE_MISMATCH']]);
  assert.match(certificate.notes.join(' '), /النوع: الشيت CERTIFICATE · السيستم COURSE/);
  const reverse = row('آلاء', 4);
  assert.deepEqual([reverse.category, reverse.payments[0].type], ['TYPE_MISMATCH', 'CERTIFICATE']);
});

test('found but the amount or the date differs: which one', { skip }, () => {
  const amount = row('آلاء', 5);
  assert.equal(amount.category, 'DIFFERENT');
  assert.deepEqual(amount.diffs, [{ field: 'amount', sheet: 1400, system: 1500, gap: -100 }]);
  const date = row('آلاء', 6);
  assert.equal(date.category, 'DIFFERENT');
  assert.deepEqual(date.diffs, [{ field: 'date', sheet: '2026-10-20', system: '2026-10-10', gap: -10 }]);
});

test('not in the system: a voided payment and a client with no payment are said; a payment that is there but pending or failed is its own category; not registered: a lead is said', { skip }, () => {
  assert.match(row('آلاء', 7).notes.join(' '), /لكنها ممسوحة/);
  assert.match(row('آلاء', 8).notes.join(' '), /مفيش له أي دفعة/);
  assert.deepEqual([7, 8].map(number => row('آلاء', number).category), ['NOT_IN_SYSTEM', 'NOT_IN_SYSTEM']);
  const pending = row('آلاء', 13);
  assert.equal(pending.category, 'UNPAID_IN_SYSTEM');
  assert.match(pending.notes.join(' '), /لكنها معلّقة/);
  assert.equal(pending.payments[0].id.startsWith('pay-cr-'), true, 'the payment that is there is shown');
  const failed = row('غريبة', 2);
  assert.equal(failed.category, 'UNPAID_IN_SYSTEM');
  assert.match(failed.notes.join(' '), /لكنها فاشلة/);
  const stranger = row('آلاء', 9);
  assert.equal(stranger.category, 'NOT_REGISTERED');
  assert.match(stranger.notes.join(' '), /lead فقط: مهتمة تجريبية/);
  assert.equal(row('آلاء', 14).category, 'NOT_REGISTERED');
});

test('the client is found by the name when there is no phone, by the sender\'s number, and two payments that add up to a row are one', { skip }, () => {
  const byName = row('بيان', 1);
  assert.deepEqual([byName.client.by, byName.category], ['name', 'FOUND_SAME']);
  const bySender = row('بيان', 2);
  assert.deepEqual([bySender.client.id, bySender.client.by, bySender.category], ['k10', 'sender-phone', 'FOUND_SAME']);
  const pair = row('بيان', 3);
  assert.deepEqual([pair.category, pair.payments.map(payment => payment.type).sort()], ['FOUND_SAME', ['CERTIFICATE', 'COURSE']]);
  assert.match(pair.notes.join(' '), /2 دفعات في السيستم/);
});

test('a tab that names no employee is listed; its row is found and the employee is not compared', { skip }, () => {
  assert.deepEqual(report.tabs.map(item => [item.tab, item.employee?.name || null]), [['آلاء', 'آلاء تجريبية تحصيل'], ['بيان', 'بيان تجريبية تحصيل'], ['غريبة', null]]);
  const unmapped = row('غريبة', 1);
  assert.equal(unmapped.category, 'FOUND_SAME');
  assert.match(unmapped.notes.join(' '), /الموظف ما اتقارنش/);
});

test('the system\'s payments of the collectors that their tab lacks: the site\'s own and a September one are not listed', { skip }, () => {
  const missing = report.missingFromSheet.map(item => [item.employee.name, item.client, item.amount, item.employeeHasTab, item.claimedByTab]).sort();
  assert.deepEqual(missing, [
    ['آلاء تجريبية تحصيل', 'عميل تحصيل k14', 600, true, 'غريبة'],
    ['آلاء تجريبية تحصيل', 'عميل تحصيل k15', 500, true, null],
    ['بيان تجريبية تحصيل', 'عميل تحصيل k2', 1000, true, 'آلاء'],
    ['جنى تجريبية تحصيل', 'عميل تحصيل k16', 400, false, null],
  ].sort());
});

test('totals per collector: sheet vs system, and the difference in exact pieces', { skip }, () => {
  const a = report.perCollector.find(item => item.tab === 'آلاء');
  assert.deepEqual([a.sheetTotal, a.sheetOutsideMonth, a.systemTotal, a.difference], [19950, 200, 16350, 3600]);
  const pieces = Object.fromEntries(a.reasons.map(reason => [reason.kind, [reason.rows, reason.amount]]));
  assert.deepEqual(pieces, { NOT_REGISTERED: [1, 300], NOT_IN_SYSTEM: [3, 2800], UNPAID_IN_SYSTEM: [1, 700], OTHER_EMPLOYEE: [1, 1000], PAIRED_GAP: [7, -100], MISSING_FROM_TAB: [2, -1100] });
  assert.equal(a.reasons.reduce((total, reason) => total + reason.amount, 0), a.difference, 'every pound of the difference is explained');
  const b = report.perCollector.find(item => item.tab === 'بيان');
  assert.deepEqual([b.sheetTotal, b.systemTotal, b.difference], [5500, 6500, -1000]);
  assert.equal(b.reasons.reduce((total, reason) => total + reason.amount, 0), b.difference);
  assert.equal(report.perCollector.find(item => item.tab === 'غريبة').difference, null);
});

test('nothing was written', { skip }, async () => {
  const [[now]] = await pool.query('SELECT COUNT(*) AS n FROM payments WHERE tenant_id=?', [T]);
  assert.equal(now.n, before_);
});

test('the Arabic report and the CSV hold every row', { skip }, () => {
  const markdown = render.renderMarkdown(report);
  for (const heading of ['## الملخص', '## كل موظف تحصيل', '## دفعات موجودة باسم موظف تاني (1)', '## دفعات مبلغها أو تاريخها مختلف (2)', '## شهادة مسجلة كأنها كورس (أو العكس) (2)',
    '## دفعات مش موجودة في السيستم (3)', '## دفعات في السيستم بس فاشلة أو معلّقة (2)', '## عملاء مش مسجلين في السيستم (2)', '## دفعات في السيستم للمحصّلين مش في الشيت (4)', '## صفوف ما اتقراتش (1)']) {
    assert.ok(markdown.includes(heading), heading);
  }
  assert.ok(markdown.includes('معهد الدراسات النفسية'));
  const csv = render.renderCsv(report);
  assert.ok(csv.startsWith(String.fromCharCode(0xFEFF)));
  assert.equal(csv.trim().split('\r\n').length, 1 + report.rows.length);
});

test('staff named in Latin letters and tabs in Arabic: the tabs are mapped by an explicit map (an id, or the exact name); without it they are reported unmapped, loudly', { skip }, async () => {
  await pool.query("UPDATE staff SET name='Alaa  Tajribia' WHERE id='coll-a' AND tenant_id=?", [T]);
  await pool.query("UPDATE staff SET name='bayan tajribia' WHERE id='coll-b' AND tenant_id=?", [T]);
  try {
    const bare = await reconcileLib.reconcileCollectionSheet(pool, { tenantId: T, sheet: sheetUsed, year: 2026, month: 10 });
    assert.deepEqual(bare.tabs.map(item => [item.tab, item.employee, item.via]), [['آلاء', null, null], ['بيان', null, null], ['غريبة', null, null]], 'no fuzzy match across scripts');
    assert.ok(render.renderMarkdown(bare).startsWith('# مطابقة شيت التحصيل') && render.renderMarkdown(bare).includes('## ⚠ تابات مش مربوطة بموظف'), 'said at the top of the report');

    const mapped = await reconcileLib.reconcileCollectionSheet(pool, {
      tenantId: T, sheet: sheetUsed, year: 2026, month: 10,
      // an id; the exact name with its spaces collapsed and another case; a tab name with stray spaces; an entry that matches no one
      tabMap: { ' آلاء ': 'coll-a', 'بيان': 'Bayan   TAJRIBIA', 'غريبة': 'nobody by that name' },
    });
    assert.deepEqual(mapped.tabs.map(item => [item.tab, item.employee?.id || null, item.via]), [['آلاء', 'coll-a', 'map'], ['بيان', 'coll-b', 'map'], ['غريبة', null, null]]);
    assert.match(mapped.tabs[2].mapError, /ما طابقش أي موظف/);
    assert.match(render.renderMarkdown(mapped), /غريبة.*التعيين «nobody by that name» ما طابقش أي موظف/);
    const same = key => mapped.rows.find(item => `${item.tab}|${item.rowNumber}` === key);
    assert.equal(same('آلاء|1').category, 'FOUND_SAME', 'the comparison runs on the mapped employee');
    assert.equal(same('آلاء|2').category, 'OTHER_EMPLOYEE');
    assert.equal(mapped.perCollector.find(item => item.tab === 'آلاء').systemTotal, 16350);
  } finally {
    await pool.query("UPDATE staff SET name='آلاء تجريبية تحصيل' WHERE id='coll-a' AND tenant_id=?", [T]);
    await pool.query("UPDATE staff SET name='بيان تجريبية تحصيل' WHERE id='coll-b' AND tenant_id=?", [T]);
  }
});
