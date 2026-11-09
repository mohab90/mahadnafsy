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









test('the commission write is tenant scoped throughout', () => {
  for (const source of [calc, read('lib/paymentCompensation.js')]) {
    const statements = source.match(/(SELECT|INSERT INTO)[\s\S]*?`/g) || [];
    assert.ok(statements.length >= 1);
    for (const statement of statements) {
      assert.match(statement, /tenant_id/, `not tenant scoped: ${statement.slice(0, 60)}`);
    }
  }
});
