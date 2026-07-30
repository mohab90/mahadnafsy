'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mapSubscriber } = require('../lib/mappers');

test('client subscriber payload exposes the canonical payment history with settlement fields', () => {
  const mapped = mapSubscriber({
    id: 'subscriber-1',
    name: 'Client',
    email: 'client@example.com',
    is_active: 1,
    enrollments: [],
    payments: [{
      id: 'payment-1',
      amount: '1200.50',
      currency: 'SAR',
      payment_type: 'COURSE',
      payment_method: 'BANK',
      course_id: 'course-1',
      course_expected: '1500.00',
      status: 'refunded',
      branch: 'ONLINE',
      document_number: 'INV-2026-000001',
      date: '2026-07-30',
    }],
  });

  assert.equal(mapped.paymentHistory.length, 1);
  assert.equal(mapped.paymentHistory[0].amount, 1200.5);
  assert.equal(mapped.paymentHistory[0].currency, 'SAR');
  assert.equal(mapped.paymentHistory[0].courseExpected, 1500);
  assert.equal(mapped.paymentHistory[0].status, 'refunded');
  assert.equal(mapped.paymentHistory[0].branch, 'ONLINE');
  assert.equal(mapped.paymentHistory[0].invoiceNumber, 'INV-2026-000001');
  assert.strictEqual(mapped.payments, mapped.paymentHistory);
});

test('self-service subscriber query loads expected amount and branch from payments', () => {
  const route = fs.readFileSync(path.join(__dirname, '../routes/public.js'), 'utf8');
  assert.match(
    route,
    /p\.certificate_request_id, p\.course_expected, p\.branch, p\.created_at[\s\S]{0,400}FROM payments p[\s\S]{0,300}p\.subscriber_id = \?/
  );
  assert.match(route, /fd\.document_number/);
});
