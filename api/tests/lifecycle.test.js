'use strict';
/**
 * Unit tests for the customer-journey engine (lib/lifecycle) — pure structure +
 * message-builder checks, no DB. Guards the journey completeness (all events wired)
 * and that every step renders a non-empty branded message. Run: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JOURNEY } = require('../lib/lifecycle');

const SAMPLE = { name: 'أحمد', courseTitle: 'دبلوم العلاج المعرفي', email: 'a@b.com', phone: '201000000000', roleLabel: 'محاضر' };

test('journey wires all 9 customer-journey events', () => {
  const expected = [
    'lead_created', 'payment_received', 'enrolled', 'contact_received',
    'join_us_received', 'checkout_abandoned', 'abandoned_interest',
    'learner_stalled', 'certificate_ready',
  ];
  for (const e of expected) assert.ok(JOURNEY[e], `missing journey event: ${e}`);
  assert.equal(Object.keys(JOURNEY).length, expected.length, 'unexpected journey event count');
});

test('every step has a valid channel and renders a non-empty message', () => {
  for (const [event, steps] of Object.entries(JOURNEY)) {
    assert.ok(Array.isArray(steps) && steps.length > 0, `${event} has no steps`);
    for (const s of steps) {
      assert.ok(['email', 'whatsapp'].includes(s.channel), `${event}.${s.key} invalid channel: ${s.channel}`);
      assert.equal(typeof s.build, 'function', `${event}.${s.key} build is not a function`);
      const msg = s.build(SAMPLE);
      assert.ok(typeof msg === 'string' && msg.trim().length > 0, `${event}.${s.key} produced empty message`);
    }
  }
});

test('builders never throw on an empty context (defensive)', () => {
  for (const [event, steps] of Object.entries(JOURNEY)) {
    for (const s of steps) {
      assert.doesNotThrow(() => s.build({}), `${event}.${s.key} threw on empty ctx`);
    }
  }
});

test('checkout_abandoned is a WhatsApp nudge that personalises name + course', () => {
  const steps = JOURNEY.checkout_abandoned;
  assert.equal(steps[0].channel, 'whatsapp');
  const msg = steps[0].build({ name: 'سارة', courseTitle: 'دبلوم القياس النفسي' });
  assert.ok(msg.includes('سارة'), 'should include the name');
  assert.ok(msg.includes('دبلوم القياس النفسي'), 'should reference the course');
});

test('enrolled event carries both email + whatsapp channels (onboarding)', () => {
  const channels = JOURNEY.enrolled.map(s => s.channel);
  assert.ok(channels.includes('email'));
  assert.ok(channels.includes('whatsapp'));
});
