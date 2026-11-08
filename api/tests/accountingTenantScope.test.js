'use strict';
const { financeRouteSource } = require('./_authRouteSource');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('accounting periods and snapshots are tenant scoped', () => {
  const route = read('routes/accounting.js');
  assert.match(route, /accounting_periods WHERE tenant_id=\?/);
  assert.match(route, /FROM payments p[\s\S]*p\.tenant_id=\? AND p\.status='paid'/);
  assert.match(route, /p\.deleted_at IS NULL/);
  assert.match(route, /tenantId: req\.tenantId/);
  assert.match(route, /accounting-periods'[\s\S]{0,500}resolveFinancialScope\(req\)/);
  assert.match(route, /accounting-periods\/:id\/close[\s\S]{0,500}central financial scope/);
  const integrityParams = route.match(/const \[\[integrity\]\][\s\S]*?\[\s*([\s\S]*?)\s*\]\s*\n\s*\);/);
  assert.ok(integrityParams, 'period-close integrity query must expose its parameter list');
  assert.equal(
    (integrityParams[1].match(/req\.tenantId|startDate|endDate|startUtc|endUtc|Number\(period\.period_label/g) || []).length,
    19,
    'period-close reconciliation query must bind all 19 placeholders in semantic order',
  );
});



test('financial reports and reconciliation scope journal headers by tenant', () => {
  const financeRoute = financeRouteSource();
  const monitoring = read('routes/monitoring.js');
  assert.match(financeRoute, /WHERE je\.tenant_id=\? AND je\.entry_date BETWEEN/);
  assert.match(monitoring, /WHERE je\.tenant_id=\? AND je\.ref_type='payment'/);
  assert.match(monitoring, /je\.tenant_id=p\.tenant_id/);
});

test('reconciliation dashboard connects payments, journals, enrollments, CRM and orders per tenant', () => {
  const route = read('routes/core/payops.js');
  const ui = fs.readFileSync(path.join(__dirname, '..', '..', 'admin', 'pages', 'dashboard', 'tabs', 'financial', 'ReconciliationPanel.tsx'), 'utf8');
  assert.match(route, /reconciliation-dashboard'[\s\S]*requirePermission\('view_financial'\)/);
  assert.match(route, /paid_without_journal[\s\S]*je\.tenant_id=p\.tenant_id/);
  assert.match(route, /paid_without_enrollment[\s\S]*e\.tenant_id=p\.tenant_id/);
  // The converted-lead subquery moved into lib/reconcileChecks so the nightly
  // job and this dashboard stop drifting apart. The property being asserted is
  // unchanged — the subscriber lookup is scoped to the lead's tenant — it just
  // has one home now, so the assertion follows it there rather than requiring
  // the SQL to stay inlined here.
  assert.match(route, /converted_without_subscriber[\s\S]{0,900}NOT \$\{LIVE_SUBSCRIBER_FOR_LEAD\}/);
  assert.match(route, /require\('\.\.\/\.\.\/lib\/reconcileChecks'\)/);
  const { LIVE_SUBSCRIBER_FOR_LEAD } = require('../lib/reconcileChecks');
  assert.match(LIVE_SUBSCRIBER_FOR_LEAD, /s\.tenant_id=l\.tenant_id/,
    'the shared predicate must still scope the subscriber lookup to the lead tenant');
  assert.match(route, /paid_order_without_payment[\s\S]*p\.tenant_id=o\.tenant_id/);
  assert.match(route, /failed_finance_events[\s\S]*FROM finance_outbox[\s\S]*WHERE tenant_id=\?/);
  assert.match(ui, /mysqlAdmin\.adminGet<ReconciliationData>\(`\/admin\/reconciliation-dashboard/);
});


