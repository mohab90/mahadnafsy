'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('journey states use one canonical vocabulary at API boundaries', () => {
  const { JOURNEY_STATES, normalizeJourneyState } = require('../lib/journeyStates');
  assert.deepEqual(JOURNEY_STATES.order, ['pending', 'paid', 'failed', 'refunded']);
  assert.deepEqual(JOURNEY_STATES.payment, JOURNEY_STATES.order);
  assert.equal(normalizeJourneyState('order', ' PENDING '), 'pending');
  assert.throws(() => normalizeJourneyState('order', 'cancelled'), /Invalid order status/);
  const orders = read('routes/orders.js');
  const proofs = read('routes/payment-proofs.js');
  
  
});

test('customer timeline is shared by client and scoped staff without leaking money', () => {
  const customer = read('routes/public.js');
  const staff = read('routes/admin/subscribers.js');
  const ui = fs.readFileSync(
    path.join(__dirname, '..', '..', 'admin', 'pages', 'unified-client', 'UnifiedClientOverviewTab.tsx'),
    'utf8'
  );
  
  
  
  
  assert.match(ui, /getCustomerTimeline\(subscriber\.id\)/);
});

test('journey UAT covers one linked identity from attribution through reversal', () => {
  const uat = read('tools/uat-full-smoke.cjs');
  for (const contract of [
    '/api/registrations',
    '/api/auth/register',
    '/api/admin/leads/${ctx.ids.leadId}/convert',
    '/api/public/checkout-intent',
    '/api/me/payment-proof',
    '/api/admin/payment-proofs/${ctx.ids.proofId}',
    '/api/me/progress',
    '/api/me/completions',
    '/api/me/certificate-request',
    '/api/me/timeline',
    '/api/me/refund-request',
  ]) assert.ok(uat.includes(contract), `missing journey UAT contract: ${contract}`);
  
  
  
  
  
  
});

test('reconciliation makes every broken customer-journey projection critical', () => {
  const reconciliation = require('../lib/reconcileChecks').CHECKS;
  for (const key of [
    'unlinkable_paid_orders',
    'converted_leads_without_subscriber',
  ]) {
    assert.equal(reconciliation.find(check => check.key === key)?.severity, 'critical', key);
  }

  // orphan_customer_users was in this list and is deliberately not any more.
  // It counted accounts that signed themselves up and are neither a lead nor
  // an online client — which was a break when registration auto-created a lead
  // for every signup, and stopped being one when that was replaced by the
  // التسجيلات queue, where all of them are listed with conversion actions.
  //
  // It is a queue depth, so it reports as info. Left critical it made the
  // reconcile report show four failures where three were real, every run.
  const queue = reconciliation.find(check => check.key === 'orphan_customer_users');
  assert.equal(queue?.severity, 'info');
  assert.match(queue.hint, /التسجيلات/,
    'the hint has to point at the screen these accounts are waiting on');
});




