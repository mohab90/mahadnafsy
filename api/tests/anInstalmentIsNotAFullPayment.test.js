'use strict';

// «قسط» at the site's checkout charges the first instalment — 25% of the plan
// (lib/enrollmentPricing.js). Confirming that order booked it as the whole
// price: is_installment 0, the instalment as course_expected, full access. So a
// client who had paid a quarter read as paid in full, and the other three
// quarters were never owed. Raised by an outside review on 7 Oct 2026; the
// checkout now writes the plan into the order and every confirmation reads it.

const test = require('node:test');
const assert = require('node:assert/strict');
const { amountDueNow, installmentTotal } = require('../lib/enrollmentPricing');
const { orderPlan } = require('../lib/orderPlan');

const stub = (rel, exports) => {
  const file = require.resolve(rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
const grants = [];
stub('../lib/subscriberProvisioning', { ensureSubscriberForOrder: async () => ({ id: 's-1', tenant_id: 't', lead_id: null, branch: 'ONLINE_EGYPT', branch_id: 'b-1' }) });
stub('../lib/finance', { postPaymentJournal: async () => 'j-1', logPaymentAudit: async () => {} });
stub('../lib/paymentCompensation', { recordPaymentCompensation: async () => {} });
stub('../lib/entitlements', { grantCourseSelections: async input => { grants.push(input); } });
stub('../lib/leadState', { transitionLead: async () => {} });
const { confirmOrderPayment } = require('../lib/orderPaymentConfirmation');

const conn = {
  calls: [],
  async query(sql, params = []) {
    const flat = String(sql).replace(/\s+/g, ' ').trim();
    this.calls.push({ sql: flat, params });
    return /^(INSERT|UPDATE)/.test(flat) ? [{ affectedRows: 1 }] : [[]];
  },
};

const price = 4000;
const plan = installmentTotal(price);
const first = amountDueNow(price, 'installment');

test('the plan is read from the order the checkout wrote', () => {
  assert.deepEqual(orderPlan(JSON.stringify({ payMode: 'installment', planTotal: plan }), first), { installment: true, expected: plan });
  assert.deepEqual(orderPlan(JSON.stringify({ payMode: 'cash', planTotal: null }), 3400), { installment: false, expected: 3400 });
  assert.deepEqual(orderPlan('{}', 3400), { installment: false, expected: 3400 }, 'an older order pays its own amount');
  assert.deepEqual(orderPlan('not json', 3400), { installment: false, expected: 3400 });
});

test('confirming an instalment books an instalment against the plan, and opens what it paid for', async () => {
  conn.calls.length = 0; grants.length = 0;
  await confirmOrderPayment({
    order: {
      id: 'o-1', type: 'COURSE', item_id: 'c-1', item_title: 'دبلومة', amount: first, currency: 'EGP',
      customer_email: 'a@example.com', notes: JSON.stringify({ checkout: 'manual_transfer', payMode: 'installment', planTotal: plan }),
    },
    tenantId: 't', staffId: 'st-1', staffName: 'الحسابات', actorEmail: 'desk@example.com',
  }, conn);
  const insert = conn.calls.find(call => /^INSERT INTO payments/.test(call.sql));
  assert.equal(insert.params[4], first, 'the money taken is the first instalment');
  assert.equal(insert.params[9], 1, 'flagged as an instalment');
  assert.equal(insert.params[10], plan, 'owed against the whole plan');
  const [grant] = grants;
  assert.equal(grant.selections[0].accessType, 'limited', 'a quarter paid is not full access');
  assert.ok(Math.abs(grant.selections[0].paidRatio - first / plan) < 0.001);
});

test('a payment in full still books in full', async () => {
  conn.calls.length = 0; grants.length = 0;
  await confirmOrderPayment({
    order: { id: 'o-2', type: 'COURSE', item_id: 'c-1', amount: 3400, currency: 'EGP', customer_email: 'a@example.com', notes: JSON.stringify({ payMode: 'cash' }) },
    tenantId: 't', actorEmail: 'desk@example.com',
  }, conn);
  const insert = conn.calls.find(call => /^INSERT INTO payments/.test(call.sql));
  assert.equal(insert.params[9], 0);
  assert.equal(insert.params[10], 3400);
  assert.equal(grants[0].selections[0].accessType, 'full');
});

test('the checkout writes the plan, and the card and receipt paths read it too', () => {
  const fs = require('fs');
  const path = require('path');
  const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  assert.match(read('routes/lead-capture-crm.js'), /payMode: normalizedPayMode,\s+planTotal: normalizedPayMode === 'installment' && basePrice \? installmentTotal\(basePrice\) : null/);
  for (const file of ['lib/paymobFinalise.js', 'routes/payment-proofs.js']) {
    const source = read(file);
    assert.match(source, /orderPlan\(/, file);
    assert.match(source, /planAccess\(conn/, file);
    assert.doesNotMatch(source, /'paid',NOW\(\)\)`,[\s\S]{0,40}accessType: 'full'/, file);
  }
});
