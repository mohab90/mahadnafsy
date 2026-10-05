'use strict';
// Commission is money owed to a person. It used to be computed in a
// `setImmediate` fired after the payment committed, inside a try whose catch
// only logged a warning — so a deadlock, a dropped connection or a restart
// dropped it with no retry and no record that it was ever owed. These pin the
// properties that stop that happening again.
const { checkoutSource } = require('./_authRouteSource');
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');
const orders = checkoutSource();
const scheduler = read('lib/backgroundScheduler.js');
const calc = read('lib/commissionCalc.js');

test('commission is queued inside the payment transaction, not after it', () => {
  // Enqueuing on `conn` is what makes it durable: roll back and the job goes
  // with the payment, commit and the job is committed too.
  const enqueueAt = orders.indexOf("eventType: 'record_commission'");
  assert.ok(enqueueAt > 0, 'the payment flow must enqueue a commission job');
  const commitAt = orders.indexOf('await conn.commit();', orders.indexOf('_finalisePaymobOrderInner'));
  assert.ok(enqueueAt < commitAt, 'the job must be enqueued before the commit, not after');

  const call = orders.slice(enqueueAt - 400, enqueueAt + 400);
  assert.match(call, /\}, conn\)/, 'it must be enqueued on the transaction connection');
});

test('the old fire-and-forget path is gone', () => {
  // A setImmediate that writes crm_commissions is the exact shape of the bug.
  assert.ok(!/crm_commissions/.test(orders),
    'the payment route must not write commissions directly any more');
  assert.ok(!/commission calc error/.test(orders),
    'the swallow-and-log catch must be gone');
});

test('a worker handler exists for the queued job', () => {
  // Without this the job would sit pending forever and the money would still
  // never be recorded — quieter than before, and just as wrong.
  assert.match(scheduler, /record_commission:/);
  assert.match(scheduler, /commissionCalc\.recordCommissionForPayment\(/);
  assert.match(scheduler, /require\('\.\/commissionCalc'\)/);
});

test('the job runs the one compensation rule every payment path runs', () => {
  // A copy of the rule lived here and drifted: no instructor share for an
  // online course payment, and the commission rule of the day the job ran.
  assert.match(calc, /require\('\.\/paymentCompensation'\)/);
  assert.match(calc, /await recordPaymentCompensation\(\{ paymentId, tenantId, actor: 'paymob' \}, conn\);/);
  assert.ok(!/INSERT INTO crm_commissions/.test(calc), 'no second copy of the commission write');
  // Re-running cannot pay twice: the rule's writes are keyed on the payment.
  const rule = read('lib/paymentCompensation.js');
  assert.match(rule, /INSERT INTO crm_commissions[\s\S]*?ON DUPLICATE KEY UPDATE commission_amount=VALUES\(commission_amount\)/);
  assert.match(rule, /INSERT INTO instructor_fees[\s\S]*?ON DUPLICATE KEY UPDATE total_amount=VALUES\(total_amount\)/);
});

test('"nothing to pay" is a result, not a failure', () => {
  // A payment refunded or deleted before the job ran is a normal outcome.
  // Throwing on it would make the outbox retry forever and mark the job dead.
  assert.match(calc, /return \{ written: false, reason: 'payment_not_paid' \}/);
  assert.match(calc, /return \{ written: false, reason: 'non_positive_amount' \}/);
});

test('the commission write is tenant scoped throughout', () => {
  for (const source of [calc, read('lib/paymentCompensation.js')]) {
    const statements = source.match(/(SELECT|INSERT INTO)[\s\S]*?`/g) || [];
    assert.ok(statements.length >= 1);
    for (const statement of statements) {
      assert.match(statement, /tenant_id/, `not tenant scoped: ${statement.slice(0, 60)}`);
    }
  }
});
