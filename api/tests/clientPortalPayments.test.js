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

// Two things the customer's own dashboard declares and the server never sent.
test('the customer gets back the English name they saved', () => {
  const fromColumn = mapSubscriber({ id: 's1', name: 'عميل', name_en: 'Ahmed Ali', enrollments: [], payments: [] });
  assert.equal(fromColumn.nameEn, 'Ahmed Ali');
  // PUT /api/auth/update-profile writes it into crm_json, so that spelling has
  // to resolve too or the settings field keeps blanking itself.
  const fromCrm = mapSubscriber({
    id: 's1', name: 'عميل', crm_json: JSON.stringify({ nameEn: 'Ahmed Ali' }),
    enrollments: [], payments: [],
  });
  assert.equal(fromCrm.nameEn, 'Ahmed Ali');
});

test('the customer sees the installment plan they are paying, entry by entry', () => {
  const mapped = mapSubscriber({
    id: 's1', name: 'عميل', enrollments: [], payments: [],
    installmentPlans: [{
      id: 'PLAN-1', course_id: 'course-1', course_title: 'دبلوم الإرشاد',
      total_amount: '4000.00', currency: 'EGP', installments_count: 4,
      installment_amounts: JSON.stringify([1000, 1000, 1000, 1000]),
      due_dates: JSON.stringify(['2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01']),
      paid_dates: JSON.stringify(['2026-09-01', null, null, null]),
      paid_amounts: JSON.stringify([1050, null, null, null]),
      created_at: '2026-08-20',
    }],
  });
  assert.equal(mapped.installmentPlans.length, 1);
  const plan = mapped.installmentPlans[0];
  assert.equal(plan.totalAmount, 4000);
  assert.equal(plan.courseTitle, 'دبلوم الإرشاد');
  assert.equal(plan.entries.length, 4, 'every scheduled entry, not just the paid ones');
  assert.equal(plan.entries[0].paidAt, '2026-09-01');
  assert.equal(plan.entries[0].paidAmount, 1050, 'what was actually collected, not what was scheduled');
  assert.equal(plan.entries[1].paidAt, undefined);
  assert.equal(plan.entries[3].dueDate, '2026-12-01');
});

test('a plan with no explicit per-entry amounts still schedules the whole total', () => {
  const mapped = mapSubscriber({
    id: 's1', name: 'عميل', enrollments: [], payments: [],
    installmentPlans: [{
      id: 'PLAN-2', total_amount: '900.00', currency: 'EGP', installments_count: 3,
      due_dates: JSON.stringify(['2026-09-01', '2026-10-01', '2026-11-01']),
      created_at: '2026-08-20',
    }],
  });
  const entries = mapped.installmentPlans[0].entries;
  assert.equal(entries.length, 3);
  assert.equal(entries.reduce((sum, e) => sum + e.amount, 0), 900);
});

test('a subscriber with no plans still reports an empty list rather than undefined', () => {
  const mapped = mapSubscriber({ id: 's1', name: 'عميل', enrollments: [], payments: [] });
  assert.deepEqual(mapped.installmentPlans, []);
});
