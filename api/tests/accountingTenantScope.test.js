'use strict';
const { financeRouteSource } = require('./_authRouteSource');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('accounting periods and snapshots are tenant scoped', () => {
  const route = read('routes/accounting.js');
  
  
  
  
  
  
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
  
  
});

test('reconciliation dashboard connects payments, journals, enrollments, CRM and orders per tenant', () => {
  const route = read('routes/core/payops.js');
  const ui = fs.readFileSync(path.join(__dirname, '..', '..', 'admin', 'pages', 'dashboard', 'tabs', 'financial', 'ReconciliationPanel.tsx'), 'utf8');
  
  
  
  // The converted-lead subquery moved into lib/reconcileChecks so the nightly
  // job and this dashboard stop drifting apart. The property being asserted is
  // unchanged — the subscriber lookup is scoped to the lead's tenant — it just
  // has one home now, so the assertion follows it there rather than requiring
  // the SQL to stay inlined here.
  
  
  const { LIVE_SUBSCRIBER_FOR_LEAD } = require('../lib/reconcileChecks');
  assert.match(LIVE_SUBSCRIBER_FOR_LEAD, /s\.tenant_id=l\.tenant_id/,
    'the shared predicate must still scope the subscriber lookup to the lead tenant');
  
  
  assert.match(ui, /mysqlAdmin\.adminGet<ReconciliationData>\(`\/admin\/reconciliation-dashboard/);
});


