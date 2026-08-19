'use strict';
// Commission is money owed to a person. It used to be computed in a
// `setImmediate` fired after the payment committed, inside a try whose catch
// only logged a warning — so a deadlock, a dropped connection or a restart
// dropped it with no retry and no record that it was ever owed. These pin the
// properties that stop that happening again.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');
const orders = read('routes/public-orders.js');
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

test('re-running the job cannot pay a commission twice', () => {
  // The outbox retries, so the write has to be idempotent.
  assert.match(calc, /ON DUPLICATE KEY UPDATE commission_amount=VALUES\(commission_amount\)/);
});

test('"nothing to pay" is a result, not a failure', () => {
  // No assigned rep and no configured rate are normal outcomes. Throwing on
  // them would make the outbox retry forever and eventually mark the job dead.
  assert.match(calc, /return \{ written: false, reason: 'no_assigned_sales' \}/);
  assert.match(calc, /return \{ written: false, reason: 'no_rate' \}/);
  assert.match(calc, /return \{ written: false, reason: 'non_positive_amount' \}/);
});

test('the commission write is tenant scoped throughout', () => {
  const statements = calc.match(/(SELECT|INSERT INTO)[\s\S]*?`/g) || [];
  assert.ok(statements.length >= 3);
  for (const statement of statements) {
    assert.match(statement, /tenant_id/, `not tenant scoped: ${statement.slice(0, 60)}`);
  }
});
