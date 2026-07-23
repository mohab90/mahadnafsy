'use strict';
/**
 * Regression coverage for the payment→enrollment path in
 * api/routes/public-orders.js.
 *
 * Status update (Phase 1 of the roadmap):
 * - LMS-01 (payment succeeds but the customer never gets enrolled because no
 *   subscriber row existed) is fixed: _finalisePaymobOrderInner now calls
 *   lib/subscriberProvisioning.ensureSubscriberForOrder, which is unit-tested
 *   for real in api/tests/subscriberProvisioning.test.js.
 * - PAY-03 (orders.status written as uppercase 'PAID'/'PENDING' while every
 *   reader compares lowercase, leaving paid orders stuck) is fixed across
 *   all five write/read sites — see the commit that closed it.
 *
 * What remains a real gap: _finalisePaymobOrderInner itself is still not
 * exported or written to accept an injectable connection (unlike
 * lib/courseCompletion.js or lib/subscriberProvisioning.js), so the full
 * route-level flow — including the enrollment INSERT, payment INSERT, and
 * journal posting happening atomically in one transaction — still can't be
 * exercised end-to-end with a mock. That refactor (export it, accept an
 * injectable conn) is tracked here rather than done as a side effect of a
 * bug fix that didn't require it.
 */
const { test } = require('node:test');

test.todo(
  '_finalisePaymobOrderInner is exported and accepts an injectable connection so the full ' +
  'payment→enrollment→journal transaction can be tested end-to-end with a mock, the same way ' +
  'completeCourse() and ensureSubscriberForOrder() already are'
);
