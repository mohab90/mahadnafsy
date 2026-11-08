'use strict';
const { financeRouteSource } = require('./_authRouteSource');
// Four faults found by reading the admin side of two classes already proven on
// the customer side.
//
// Two are the raw-row class: a route hands over a database row spelled the way
// the table spells it, the screen reads camelCase, and the cast to the screen's
// own type means nothing complains. Two are money: what a customer owes, and
// which day a payment belongs to.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { codeOnlyKeepingUrls: codeOnly } = require('./support/repo');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8');

// ── the consultations screen in the admin ──────────────────────────────────
test('an admin consultation is sent in the shape every consultations screen reads', () => {
  // The whole screen was drawing empty: client, doctor and type all «—», the
  // date «بدون تاريخ», the calendar blank in every month, and «تأكيد» never
  // rendered. The therapist portal maps this same table correctly, so the
  // shape already existed in the codebase — this route was the one missed.
  const source = codeOnly(read('routes/core/staffacct.js'));
  for (const field of ['clientName', 'clientPhone', 'therapistName', 'therapistId', 'sessionDate', 'meetingLink']) {
    assert.match(source, new RegExp(field + ':'), field + ' must be mapped');
  }
  assert.doesNotMatch(source, /res\.json\(rows\)/, 'the raw rows must not go out');
});



// ── contact messages ───────────────────────────────────────────────────────
test('a contact message carries its date, its note and a comparable status', () => {
  const source = codeOnly(read('routes/admin-operations.js'));
  const handler = source.slice(source.indexOf("'/api/admin/contact-messages'"));
  assert.match(handler.slice(0, 1600), /createdAt: row\.created_at/);
  assert.match(handler.slice(0, 1600), /adminNote: row\.admin_note/);
  assert.match(handler.slice(0, 1600), /status: String\(row\.status \|\| 'NEW'\)\.toLowerCase\(\)/);
});

test('and the note the desk types is actually saved', () => {
  // The screen has always offered the field; the route wrote only the status,
  // so the note was accepted on screen and dropped on the way past.
  const source = codeOnly(read('routes/admin-operations.js'));
  const patch = source.slice(source.indexOf("router.patch('/api/admin/contact-messages/:id'"));
  const handler = patch.slice(0, patch.indexOf('\n});'));
  assert.match(handler, /req\.body\.adminNote/);
  assert.match(handler, /admin_note=\?/);
  assert.doesNotMatch(handler, /SET status=\? WHERE/, 'status must no longer be the only column written');
});

// ── what an instalment says the customer owes ──────────────────────────────
test('the refunds screen counts only money actually received', () => {
  // «المدفوع» and «إجمالي الكورس» sit side by side for whoever approves the
  // refund. The paid figure summed every row in the table — pending payments
  // awaiting review, failed ones and the soft-deleted duplicates from the
  // de-dupe cleanup — in raw currency. A customer who had paid 3,400 once
  // could read 8,800 against a 3,400 course.
  const source = codeOnly(financeRouteSource());
  const at = source.indexOf('AS paid_total');
  assert.ok(at > 0, 'paid_total not found');
  const subquery = source.slice(source.lastIndexOf('(SELECT', at), at);
  assert.match(subquery, /SUM\(px\.amount_egp\)/, 'must sum the EGP column, not the raw amount');
  assert.match(subquery, /px\.status = 'paid'/);
  assert.match(subquery, /px\.deleted_at IS NULL/);
});

test('and its course total is converted rather than mixed', () => {
  // course_expected is in the payment's own currency; price_egp is EGP.
  const source = codeOnly(financeRouteSource());
  assert.match(source, /COALESCE\(p\.course_expected \* COALESCE\(p\.fx_rate_to_egp, 1\), c\.price_egp\) AS course_total/);
});

// ── the cash-flow forecast ─────────────────────────────────────────────────
test('a monthly charge on the 1st appears in the forecast', () => {
  // The old test compared day-of-month numbers across the week's ends. A week
  // crossing a month boundary runs 28 → 4, so `from.day <= d && to.day >= d`
  // is unsatisfiable for every d — and a charge on the 1st, which always sits
  // just after a boundary, never appeared at all. Rent simply did not exist in
  // the projection.
  const source = codeOnly(read('routes/finance-planning.js'));
  assert.match(source, /const monthlyChargeDay = \(week, dayOfMonth\)/);
  assert.doesNotMatch(source, /getUTCDate\(\) <= Number\(item\.day_of_month/,
    'the day-number comparison must be gone');

  // Replay the shipped helper over the 13 weeks the route builds.
  const body = source.slice(source.indexOf('const monthlyChargeDay'));
  const fn = body.slice(0, body.indexOf('\n    };') + 7);
  // eslint-disable-next-line no-new-func
  const monthlyChargeDay = new Function(`${fn}\nreturn monthlyChargeDay;`)();

  const addDays = (iso, n) => {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const weeks = Array.from({ length: 13 }, (_, i) => ({
    from: addDays('2026-09-07', i * 7), to: addDays('2026-09-07', i * 7 + 6),
  }));
  const occurrences = day => weeks.map(w => monthlyChargeDay(w, day)).filter(Boolean);

  assert.deepEqual(occurrences(1), ['2026-10-01', '2026-11-01', '2026-12-01']);
  assert.equal(occurrences(15).length, 3, 'a mid-month charge was already right and must stay right');
  assert.equal(occurrences(28).length, 3);
  // The 31st does not exist in September or November; it charges on the last day.
  assert.deepEqual(occurrences(31), ['2026-09-30', '2026-10-31', '2026-11-30']);
});

// ── one commission rule, not two ───────────────────────────────────────────




// ── payroll ────────────────────────────────────────────────────────────────




// ── refunds: the screen matches what the system can do ─────────────────────
//
// These two tests used to assert the opposite of what they assert now, and the
// pair of them is the point. Partial refunds were refused in four places — both
// creation routes, the reversal, and the approval dialog — and the dialog had
// been changed to stop asking for a figure that could only have one value.
// Enabling them meant changing all four together; the whole reason a dialog can
// ask the question again is that nothing refuses the answer any more. See
// theDeskCanApproveAPartOfIt.test.js for the rest of that chain.
test('approving a refund asks how much is actually going back', () => {
  const panel = codeOnly(read('../admin/pages/dashboard/tabs/financial/FinancialRefundsPanel.tsx'));
  assert.doesNotMatch(panel, /الاسترداد الجزئي غير مُفعّل/, 'it is enabled now');
  assert.doesNotMatch(panel, /refundedAmount = requested;/, 'so the amount cannot be fixed to the full one');
  assert.match(panel, /defaultValue: String\(requested\)/, 'a full refund is still one Enter away');
});

test('and both creation routes accept up to the payment, not exactly it', () => {
  const source = codeOnly(read('routes/admin-utils.js'));
  assert.equal((source.match(/Partial refunds are not enabled/g) || []).length, 0,
    'the refusal is gone from the customer route and the admin one');
  assert.equal((source.match(/requestedAmount - Number\(payment\.amount \|\| 0\) > 0\.01/g) || []).length, 2,
    'both still refuse more than was paid — that ceiling never moves');
});

// ── payroll and the exchange rate ──────────────────────────────────────────


test('an all-EGP payroll never consults the exchange rate', () => {
  // The guard walks only the currencies actually present, and EGP is usable by
  // definition — so the ordinary run is untouched. If this stops holding, every
  // payroll in the institute stops with it.
  const finance = read('lib/finance.js');
  const fn = finance.slice(finance.indexOf('function isFxSnapshotUsable'));
  const body = fn.slice(0, fn.indexOf('\n}') + 2);
  // eslint-disable-next-line no-new-func
  const isFxSnapshotUsable = new Function(`${body}\nreturn isFxSnapshotUsable;`)();
  assert.equal(isFxSnapshotUsable({ source: 'static-fallback' }, 'EGP'), true);
  assert.equal(isFxSnapshotUsable({ source: 'static-fallback' }, 'SAR'), false,
    'the hardcoded fallback must never be treated as a real rate');
});

// ── a refund takes both shares with it ─────────────────────────────────────



