'use strict';
// The public payment catalogue must not contradict the gateway that takes the
// money.
//
// SYS_DEFAULTS.payment_methods listed PayMob as is_active:false while the
// stored sys_payment_gateway setting had active_provider 'paymob' in mode
// 'live' and card payments were arriving. That list is what
// /api/admin/sys-config/public serves, so the catalogue the public pages read
// said a method was off while the gateway was on.
//
// It never broke checkout, because nothing gates payment on the flag — the
// client calls /api/payments/paymob-init directly. That is exactly why it went
// unnoticed: a config that lies and changes nothing produces no symptom until
// somebody trusts it.
//
// Read as text rather than required: _shared.js pulls in the server, which
// exits without JWT_SECRET. The rest of this suite reads sources the same way.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const shared = fs.readFileSync(
  path.join(__dirname, '..', 'routes', 'misc', '_shared.js'), 'utf8');

// Just the payment_methods array out of SYS_DEFAULTS.
const block = (() => {
  const start = shared.indexOf('payment_methods: [');
  assert.ok(start > 0, 'SYS_DEFAULTS.payment_methods was not found');
  const end = shared.indexOf('],', start);
  return shared.slice(start, end);
})();

const entries = [...block.matchAll(/\{\s*key:\s*'([a-z_]+)'[\s\S]*?is_active:\s*(true|false)\s*\}/g)]
  .map(m => ({ key: m[1], active: m[2] === 'true' }));

test('the public payment catalogue is not empty and every entry is well formed', () => {
  assert.ok(entries.length >= 5, `only ${entries.length} payment methods parsed`);
  for (const entry of entries) {
    assert.ok(entry.key, 'a payment method has no key');
    assert.equal(typeof entry.active, 'boolean');
  }
  // Guards the parse itself: if the regex stops matching, every assertion
  // below passes vacuously.
  assert.ok(entries.some(e => e.key === 'cash'), 'the parse found no cash method — it is not reading the list');
});

test('PayMob is listed active, because the gateway is live', () => {
  const paymob = entries.find(e => e.key === 'paymob');
  assert.ok(paymob, 'PayMob is not in the catalogue at all');
  // If PayMob is ever genuinely switched off, this is the test to change —
  // together with sys_payment_gateway, which is the setting that decides it.
  assert.equal(paymob.active, true,
    'the public catalogue says PayMob is inactive while the gateway serves live card payments');
});

test('the default explains which setting actually decides the gateway', () => {
  assert.match(block, /sys_payment_gateway/,
    'the comment naming the authoritative setting is gone, so the next reader will trust this flag');
});
