'use strict';

// The findings from the 2026-09-22 audit that turned out to be real, each
// pinned where it was fixed. The ones that did not survive checking are listed
// at the bottom with what the code actually does, so the next reader does not
// re-open them.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('a query on a pooled connection is awaited before the handler lets it go', () => {
  // Registration fired two referral updates on `conn` without await and then
  // released it. A query still running on a connection that has gone back to
  // the pool belongs to the next request: its result lands in someone else's
  // session and mysql2 can be left mid-packet.
  const auth = read('api/routes/auth.js');
  const referral = auth.slice(auth.indexOf('Referral attribution'), auth.indexOf('Referral attribution') + 900);
  const calls = referral.split('\n').filter(line => line.includes('conn.query('));
  assert.ok(calls.length >= 2, `expected the referral updates, found ${calls.length}`);
  for (const line of calls) {
    assert.match(line, /await conn\.query\(/, `fired and forgotten on a pooled connection: ${line.trim()}`);
  }
});

test('a Facebook lead is matched to the person, not only to the form entry', () => {
  // The webhook deduplicated on fb_lead_id alone, so the same person filling a
  // second form — or one already in the CRM from a campaign or their own
  // signup — became another lead, split across two reps.
  const events = read('api/lib/facebookLeadEvents.js');
  assert.ok(events.includes('findLeadByContact'), 'the shared contact matcher must decide who this is');
  const insertAt = events.indexOf('INSERT INTO leads');
  const matchAt = events.indexOf('findLeadByContact');
  assert.ok(matchAt > 0 && matchAt < insertAt, 'the match has to happen before the insert');
});

test('merging two records keeps the money, and does not invent any', () => {
  // The merge wrote Math.max of the two deal values, so a customer who had
  // bought twice came out worth the larger purchase. Summing is wrong too:
  // two duplicate rows of one person can each carry that person's whole total.
  // The value is derived from the payments instead, which is the only answer
  // that is right either way.
  const merge = read('api/lib/leadMerge.js');
  assert.ok(!/deal_value=\?,score=\?[\s\S]{0,400}Math\.max\(\.\.\.\[target, \.\.\.sourceRows\]\.map\(row => Number\(row\.deal_value\)/.test(merge)
    || merge.includes('syncLeadDealValue'),
    'the merged deal value must be derived from the payments, not picked between the rows');
  assert.ok(merge.includes('syncLeadDealValue'), 'the merge must re-derive the value it just merged');
});

test('a quiz with no passing score does not pass an empty attempt', () => {
  const grading = read('api/lib/quizGrading.js');
  assert.match(grading, /answeredCount|answers\.length|attempted/,
    'grading must know whether anything was answered at all');
  assert.ok(!/const passed = score >= \(Number\(passingScore\) \|\| 0\);/.test(grading),
    'score 0 against a passing score of 0 must not read as passed');
});

test('nobody sets their own commission or bonus', () => {
  // POST /api/admin/staff writes commission_rate, monthly_bonus and the
  // targets, and manage_staff is held by HR — so an account could raise its
  // own pay by saving its own row.
  const staff = read('api/routes/staff.js');
  assert.ok(staff.includes('OWN_PAY_FIELDS') || staff.includes('editingSelf'),
    'the route must notice when the row being written is the writer\'s own');
  assert.match(staff, /PAY_FIELDS_REQUIRE_OWNER|OWN_PAY_REFUSED/,
    'and refuse the pay fields with a code of its own');
});

// ── Findings that did not survive checking ────────────────────────────────
// Kept as assertions so that if any of them ever becomes true, this file says
// so — and so the report's claims are not re-investigated from scratch.
test('the claims that were already handled stay handled', () => {
  const bulk = read('api/routes/communication-admin.js');
  assert.match(bulk, /phones\.length > 200/, 'bulk WhatsApp had a recipient cap and must keep it');

  const webhook = read('api/lib/webhookSecurity.js');
  assert.ok(webhook.includes('isPrivateAddress') && webhook.includes('dns.lookup'),
    'webhook URLs are resolved and private addresses refused');
  const campaigns = read('api/routes/campaigns.js');
  assert.ok((campaigns.match(/assertSafeWebhookUrl/g) || []).length >= 3,
    'the check runs when a webhook is saved and again when it fires');

  const refunds = read('api/lib/refunds.js');
  assert.match(refunds, /crm_commissions SET status='CANCELLED'/,
    'a refund cancels the commission — it is not left with the rep');
  // This used to assert the opposite — that partial refunds were refused
  // deliberately. They were, until the desk asked for them; what has to stay
  // true is the guard underneath, which is that nothing larger than the
  // payment can be handed back.
  assert.match(refunds, /requestedAmount - paidAmount > 0\.01/,
    'the institute cannot give back more than it took');

  const cohorts = read('api/lib/learningCohorts.js');
  const guard = cohorts.slice(cohorts.indexOf('async function addCohortMember'), cohorts.indexOf('INSERT INTO cohort_members'));
  assert.match(guard, /FROM course_cohorts WHERE tenant_id=\? AND id=\? FOR UPDATE/,
    'the cohort row is locked before its seats are counted, so two joins cannot both take the last one');

  const access = read('api/lib/paymentEntitlementAccess.js');
  assert.match(access, /mode: 'limited'/,
    'an instalment grants access in proportion to what has been paid, not the whole course');
});
