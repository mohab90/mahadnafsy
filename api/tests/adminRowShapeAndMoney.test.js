'use strict';
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

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8');
const codeOnly = source => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

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

test('its status and session type are lower-cased, because both enums are upper', () => {
  const source = codeOnly(read('routes/core/staffacct.js'));
  assert.match(source, /status: String\(row\.status \|\| 'PENDING'\)\.toLowerCase\(\)/);
  assert.match(source, /sessionType: String\(row\.session_type \|\| 'INDIVIDUAL'\)\.toLowerCase\(\)/);
  assert.match(read('schema.sql'), /`session_type` enum\('INDIVIDUAL','COUPLE','FAMILY'\)/,
    'if this enum stops being upper case the mapping above needs revisiting');
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
test('an instalment records the plan total, not its own amount', () => {
  // course_expected is what the customer owes for the course, and the
  // collections query reads MAX(course_expected) per course to decide who is
  // still short. Writing one instalment's amount there made expected equal
  // paid the moment that instalment cleared, so a customer part-way through a
  // plan dropped off the outstanding list and was never chased again.
  const source = codeOnly(read('routes/installments.js'));
  const insert = source.slice(source.indexOf('INSERT INTO payments'));
  assert.match(insert.slice(0, 1200), /plan\.total_amount/);
  assert.doesNotMatch(insert.slice(0, 1200), /update\.scheduledAmount/);
});

test('the collections query still reads that column, so the fix reaches it', () => {
  // The two halves only work together; if the query stops reading
  // course_expected this test should fail and be re-thought, not deleted.
  const collections = codeOnly(read('routes/crm-tools.js'));
  assert.match(collections, /MAX\(COALESCE\(course_expected,0\)/);
});

// ── which day a payment belongs to ─────────────────────────────────────────
test('an instalment is dated in Cairo, not in the server timezone', () => {
  // The server runs in UTC. toISOString() on the server clock dated a payment
  // confirmed at 01:30 Cairo to the previous day, filing it and its journal
  // entry in the wrong month — and, if that month is closed, failing the write
  // outright. lib/finance.js records 179 entries already filed a day early.
  const source = codeOnly(read('routes/installments.js'));
  assert.match(source, /const effectiveDate = paidDate \|\| dateOnlyInTimeZone\(\)/);
  assert.doesNotMatch(source, /new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
  assert.match(source, /require\('\.\.\/lib\/dates'\)/);
});

test('the timezone helper still defaults to Cairo', () => {
  assert.match(read('lib/dates.js'), /timeZone = 'Africa\/Cairo'/);
});

// ── the refund approver's two numbers ──────────────────────────────────────
test('the refunds screen counts only money actually received', () => {
  // «المدفوع» and «إجمالي الكورس» sit side by side for whoever approves the
  // refund. The paid figure summed every row in the table — pending payments
  // awaiting review, failed ones and the soft-deleted duplicates from the
  // de-dupe cleanup — in raw currency. A customer who had paid 3,400 once
  // could read 8,800 against a 3,400 course.
  const source = codeOnly(read('routes/finance.js'));
  const at = source.indexOf('AS paid_total');
  assert.ok(at > 0, 'paid_total not found');
  const subquery = source.slice(source.lastIndexOf('(SELECT', at), at);
  assert.match(subquery, /SUM\(px\.amount_egp\)/, 'must sum the EGP column, not the raw amount');
  assert.match(subquery, /px\.status = 'paid'/);
  assert.match(subquery, /px\.deleted_at IS NULL/);
});

test('and its course total is converted rather than mixed', () => {
  // course_expected is in the payment's own currency; price_egp is EGP.
  const source = codeOnly(read('routes/finance.js'));
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
test('approving a payment pays the same commission as recording one', () => {
  // The approval path computed its own: staff.commission_rate read directly,
  // commission_rules never consulted. A role on a 5% rule whose staff row said
  // 10 earned double depending only on which path the payment took. It also
  // stamped the row with the server clock's month, so a payment dated
  // 30 September approved on 1 October landed in October and missed the
  // September payroll run. And it wrote no instructor share at all.
  const source = codeOnly(read('routes/core/financepay.js'));
  assert.match(source, /await recordPaymentCompensation\(\{/);
  assert.doesNotMatch(source, /INSERT INTO crm_commissions/,
    'the second copy of the rule must be gone');
  assert.doesNotMatch(source, /now\.getMonth\(\) \+ 1/,
    'the period must come from the payment date, not the server clock');
});

test('the rule it now calls is the one that reads commission_rules', () => {
  const helper = codeOnly(read('lib/paymentCompensation.js'));
  assert.match(helper, /FROM commission_rules/);
  assert.match(helper, /const period = paymentPeriod\(payment\.date\)/);
});

// ── payroll ────────────────────────────────────────────────────────────────
test('overriding a deduction brings the statutory split with it', () => {
  // The PAID journal takes net_salary from the row and dedSocial/dedTax out of
  // calculation_details. This route rewrote the first and left the second, so
  // overriding a 1,500 deduction to 0 produced: cash 10,000, statutory 1,500,
  // salary expense 11,500 — the whole salary handed over while the ledger
  // recorded a payable to the tax authority that will never be settled. The
  // entry balances, so the unbalanced-journal check cannot catch it.
  const source = codeOnly(read('routes/hr/payroll.js'));
  assert.match(source, /const originalStatutory = originalSocial \+ originalTax/);
  assert.match(source, /if \(originalStatutory > od\)/);
  assert.match(source, /calculation_details=\?/, 'the override must write the details back');
});

test('the payroll journal is dated in Cairo', () => {
  const source = codeOnly(read('routes/hr/payroll.js'));
  assert.match(source, /postJournalEntry\('payroll', runId, dateOnlyInTimeZone\(\)/);
  assert.doesNotMatch(source, /postJournalEntry\('payroll', runId, new Date\(\)/);
});

// ── refunds: the screen matches what the system can do ─────────────────────
test('approving a refund confirms the full amount instead of asking for one', () => {
  // Both routes that open a refund request refuse an amount differing from the
  // payment, and the reversal refuses it again — partial refunds are not
  // enabled anywhere. The dialog nonetheless accepted anything from 1 up to the
  // request, so every entry but the default came back a 409 after the desk had
  // filled it in.
  const panel = codeOnly(read('../admin/pages/dashboard/tabs/financial/FinancialRefundsPanel.tsx'));
  assert.match(panel, /الاسترداد الجزئي غير مُفعّل/);
  assert.match(panel, /refundedAmount = requested/);
  assert.doesNotMatch(panel, /اكتب المبلغ الذي سيُرد فعلياً/);
});

test('and both creation routes still refuse a partial one, which is why', () => {
  // If this ever changes, the dialog above has to change with it.
  const source = codeOnly(read('routes/admin-utils.js'));
  assert.equal((source.match(/Partial refunds are not enabled/g) || []).length, 2,
    'both the customer and the admin route must enforce it');
});

// ── payroll and the exchange rate ──────────────────────────────────────────
test('payroll refuses a stale exchange rate instead of guessing one', () => {
  // getFxToEgp hands over the rates without asking whether the snapshot is
  // usable, unlike toEgp — which every inbound money path uses and which
  // refuses a stale or fallback snapshot outright. So on a day when a 5,000 SAR
  // payment would be rejected, a 5,000 SAR salary still posted to the ledger at
  // the hardcoded fallback of 13. No foreign salary exists today, which is
  // exactly when the trap is cheap to close.
  const source = codeOnly(read('routes/hr/payroll.js'));
  assert.match(source, /const currenciesInPlay = new Set\(/);
  assert.match(source, /if \(!isFxSnapshotUsable\(fxSnapshot, currency\)\)/);
  assert.match(source, /FX_SNAPSHOT_UNAVAILABLE/);
});

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
test('refunding a payment cancels the instructor fee as well as the commission', () => {
  // Only the salesperson's commission was cancelled. A payment whose instructor
  // fee had been approved stayed approved through the refund, and payroll pays
  // approved fees — so the money went back to the customer and out to the
  // instructor for the same enrolment. There is no 'cancelled' in that enum;
  // 'rejected' is its terminal state.
  const source = codeOnly(read('lib/refunds.js'));
  assert.match(source, /UPDATE crm_commissions SET status='CANCELLED'/);
  assert.match(source, /UPDATE instructor_fees SET status='rejected'/);
  assert.match(source, /source_payment_id=\? AND tenant_id=\?/);
  // A fee already paid is left alone — reversing it is a payroll correction.
  assert.match(source, /status IN \('pending','approved','included_in_payroll'\)/);
});

test('and payroll really does pay the status this now clears', () => {
  // The two halves only matter together: if payroll stops consuming approved
  // fees, this cancellation should be re-thought rather than kept by habit.
  const payroll = codeOnly(read('routes/hr/payroll.js'));
  assert.match(payroll, /instructor_fees/);
  assert.match(payroll, /approved_instructor_fees/);
});
