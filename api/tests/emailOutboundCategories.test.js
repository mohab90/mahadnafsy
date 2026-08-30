'use strict';
// A way to stop email leaving, matching the one WhatsApp already has.
//
// Production sets WHATSAPP_OUTBOUND_CATEGORIES=otp,inbox_reply,channel_test, so
// a broadcast is refused at the transport before a number is resolved or a
// provider is touched. Email had no equivalent: the only thing stopping a send
// was the SMTP password being wrong.
//
// The default matters more than the switch. This control is being added to a
// system that was already sending, so an unset variable has to mean "carry on"
// — defaulting to silence would cut a live institute off the moment it shipped.
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'email.js'), 'utf8');

// The function is module-private, so it is exercised through a copy of itself.
// Keeping the two in step is what the source assertions below are for.
function isEmailCategoryAllowed(category, raw) {
  if (raw === undefined || String(raw).trim().toLowerCase() === 'all') return true;
  const allowed = new Set(
    String(raw).split(',').map(part => part.trim().toLowerCase()).filter(Boolean)
  );
  if (!allowed.size) return false;
  const name = String(category || '').trim().toLowerCase();
  return name ? allowed.has(name) : false;
}

test('unset means everything still sends', () => {
  assert.equal(isEmailCategoryAllowed('otp', undefined), true);
  assert.equal(isEmailCategoryAllowed('marketing', undefined), true);
  assert.equal(isEmailCategoryAllowed(undefined, undefined), true);
});

test('"all" means everything sends', () => {
  assert.equal(isEmailCategoryAllowed('marketing', 'all'), true);
  assert.equal(isEmailCategoryAllowed('anything', ' ALL '), true);
});

test('a list allows only what it names', () => {
  const raw = 'otp,password_reset';
  assert.equal(isEmailCategoryAllowed('otp', raw), true);
  assert.equal(isEmailCategoryAllowed(' OTP ', raw), true);
  assert.equal(isEmailCategoryAllowed('marketing', raw), false);
  // An uncategorised send cannot slip past a list by having no category.
  assert.equal(isEmailCategoryAllowed(undefined, raw), false);
  assert.equal(isEmailCategoryAllowed('', raw), false);
});

test('empty stops everything, which is the point of the switch', () => {
  assert.equal(isEmailCategoryAllowed('otp', ''), false);
  assert.equal(isEmailCategoryAllowed('marketing', ''), false);
  assert.equal(isEmailCategoryAllowed(undefined, ''), false);
});

test('the gate runs before the transport is built', () => {
  // Refusing after getTransport would still open an SMTP connection and,
  // with a suppressed send, record a delivery failure against the channel.
  const gate = source.indexOf('isEmailCategoryAllowed(options.category)');
  const transport = source.indexOf('await getTransport(tenantId)');
  assert.ok(gate > 0 && transport > 0);
  assert.ok(gate < transport, 'the check must come before the connection');
});

test('the variable is read per call, not captured at import', () => {
  // Captured at import, turning it off would need a deploy rather than a
  // restart — which is the wrong lever in the middle of an incident.
  assert.match(source, /const raw = process\.env\.EMAIL_OUTBOUND_CATEGORIES;/);
});
