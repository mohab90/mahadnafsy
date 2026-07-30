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
  assert.match(orders, /normalizeJourneyState\('order'/);
  assert.match(proofs, /isJourneyState\('order'/);
});

test('customer timeline is shared by client and scoped staff without leaking money', () => {
  const customer = read('routes/public.js');
  const staff = read('routes/admin/subscribers.js');
  const ui = fs.readFileSync(
    path.join(__dirname, '..', '..', 'admin', 'pages', 'unified-client', 'UnifiedClientOverviewTab.tsx'),
    'utf8'
  );
  assert.match(customer, /\/api\/me\/timeline'[\s\S]*listCustomerTimeline/);
  assert.match(staff, /\/api\/staff\/subscribers\/:id\/timeline'[\s\S]*requirePermission\('view_subscribers'\)/);
  assert.match(staff, /hasPermission\(req\.staffRecord, 'view_financial'\)/);
  assert.match(staff, /\{\s*amount:\s*_amount,\s*currency:\s*_currency/);
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
  assert.match(uat, /CRM conversion granted LMS access before payment/);
  assert.match(uat, /checkout retry created a duplicate order/);
  assert.match(uat, /refund did not revoke course access/);
  assert.match(uat, /refund left a paid-only certificate active/);
  assert.match(uat, /DATE_FORMAT\(created_at, '%Y-%m-%d'\) AS cohort_date/);
  assert.doesNotMatch(uat, /new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
});

test('reconciliation makes every broken customer-journey projection critical', () => {
  const reconciliation = require('../lib/reconcileChecks').CHECKS;
  for (const key of [
    'unlinkable_paid_orders',
    'orphan_customer_users',
    'converted_leads_without_subscriber',
  ]) {
    assert.equal(reconciliation.find(check => check.key === key)?.severity, 'critical', key);
  }
});

test('journey analytics keeps payment, learning and certificate stages on one lead cohort', () => {
  const funnel = read('routes/funnel.js');
  assert.match(funnel, /JOIN subscribers s ON s\.lead_id=l\.id AND s\.tenant_id=l\.tenant_id/);
  assert.match(funnel, /JOIN payments p ON p\.subscriber_id=s\.id AND p\.tenant_id=s\.tenant_id/);
  assert.match(funnel, /JOIN lecture_completions lc ON lc\.subscriber_id=s\.id AND lc\.tenant_id=s\.tenant_id/);
  assert.match(funnel, /JOIN course_completions cc ON cc\.subscriber_id=s\.id AND cc\.tenant_id=s\.tenant_id AND cc\.status='active'/);
  assert.doesNotMatch(funnel, /COUNT\(DISTINCT subscriber_id\) FROM payments/);
});

test('abandoned checkout honors suppression and provider acceptance before sent', () => {
  const source = read('lib/abandonedCheckout.js');
  assert.match(source, /filterSuppressed/);
  assert.match(source, /if \(!delivery\?\.ok\) throw new Error/);
  assert.match(source, /markReminder\(order, 'skipped', 'marketing suppressed'/);
});
