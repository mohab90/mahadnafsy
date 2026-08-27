'use strict';

// A channel outage used to produce one notification per failed message. Bad SMTP
// credentials and a WhatsApp daily cap between June and August 2026 made 4,610 of
// them, 4,267 unread and 55% of every notification in the system, which buried
// the lead and payment notices sitting next to them.
//
// The rule that stops it: a fault belonging to the channel is announced once an
// hour; a fault belonging to one recipient still reaches the rep who owns them.

const test = require('node:test');
const assert = require('node:assert');
const { isSystemicFailure } = require('../lib/outbox');

test('channel-level faults are recognised as systemic', () => {
  const channelFaults = [
    'Invalid login: 535 5.7.8 Error: authentication failed: (reason unavailable)',
    'daily_limit_reached',
    'category_disabled',
    'connect ETIMEDOUT 172.65.255.143:465',
    'connect ENETUNREACH 2606:4700:90:0:f225:a1af:129b:4ba1:465',
    'Connection timeout',
  ];
  for (const fault of channelFaults) {
    assert.strictEqual(isSystemicFailure(fault), true, `should be systemic: ${fault}`);
  }
});

test('faults belonging to one recipient are not systemic', () => {
  // These name something wrong with the customer's own address. Suppressing them
  // would hide the one case a rep can actually fix.
  for (const fault of ['invalid_number', 'recipient not on WhatsApp', 'mailbox full']) {
    assert.strictEqual(isSystemicFailure(fault), false, `should not be systemic: ${fault}`);
  }
});

test('missing or empty errors are not treated as an outage', () => {
  // A blank error is not evidence of anything. Calling it an outage would mute
  // every later failure for an hour on no evidence at all.
  for (const fault of [null, undefined, '', 0]) {
    assert.strictEqual(isSystemicFailure(fault), false);
  }
});
