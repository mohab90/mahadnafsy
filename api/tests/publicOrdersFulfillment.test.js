'use strict';
/**
 * Regression coverage for the payment→enrollment path in
 * api/routes/public-orders.js. _finalisePaymobOrderInner is not currently
 * exported or written to accept an injectable connection (unlike
 * lib/periodLock.js or lib/courseCompletion.js), so it cannot be exercised
 * with a mock yet — this is exactly the gap the roadmap's Phase 1 item
 * ("Payment Fulfillment Service") is meant to close: extracting the
 * post-payment steps (ensure subscriber exists → create enrollment → post
 * journal entry → notify) into one exported, injectable function used by
 * every payment entry point (Paymob, manual transfer proof, installments).
 *
 * The test below is intentionally left as `test.todo` rather than skipped
 * silently or faked with a source-text regex: it names the exact known bug
 * (LMS-01 in the issue backlog) so it shows up in every `npm run test:unit`
 * run until Phase 1 lands, and it should be written for real — mock
 * connection, real assertions on the enrollment INSERT — as part of the same
 * commit that fixes the underlying bug, not before.
 */
const { test } = require('node:test');

test.todo(
  'a successful Paymob payment for a customer with no existing subscriber row creates the ' +
  'subscriber AND the enrollment in the same transaction, so the customer sees the course ' +
  'immediately (LMS-01 — currently public-orders.js:277-302 silently skips enrollment when ' +
  '`sub` is falsy; fix + this test land together as part of roadmap Phase 1)'
);

test.todo(
  'a payment recorded through the manual transfer-proof path and one recorded through Paymob ' +
  'both leave payments.status, orders.status, and enrollments in a mutually consistent state ' +
  '(PAY-03 — payment-proofs.js currently writes status=\'PAID\' in uppercase, which every other ' +
  'reader compares against lowercase, producing orders stuck in limbo)'
);
