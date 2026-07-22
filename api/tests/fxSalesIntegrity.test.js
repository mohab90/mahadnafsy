'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

test('money rows freeze their EGP value and financial reports consume the snapshot', () => {
  const migration = read('migrations/085_v25_money_fx_snapshot.sql');
  const finance = read('lib/finance.js');
  const reports = read('routes/analytics/financial.js');
  const dashboard = read('routes/analytics/dashboard.js');
  assert.match(migration, /ALTER TABLE payments[\s\S]*amount_egp/);
  assert.match(migration, /ALTER TABLE expenses[\s\S]*amount_egp/);
  assert.match(finance, /UPDATE payments SET fx_rate_to_egp=\?,amount_egp=\?/);
  assert.match(finance, /sign < 0[\s\S]*snapshottedEgp/);
  assert.match(reports, /SUM\(amount_egp\)/);
  assert.match(dashboard, /SUM\(amount_egp\)/);
});

test('sales goals, targets, actuals and performance are tenant scoped', () => {
  const route = read('routes/analytics/sales.js');
  const migration = read('migrations/086_v25_sales_targets_tenant_scope.sql');
  assert.match(migration, /uq_sales_goals_tenant_period \(tenant_id, period\)/);
  assert.match(migration, /PRIMARY KEY \(tenant_id, staff_id, period\)/);
  assert.match(route, /FROM sales_goals WHERE tenant_id=\?/);
  assert.match(route, /FROM sales_targets WHERE tenant_id=\?/);
  assert.match(route, /FROM leads WHERE tenant_id=\?/);
  assert.match(route, /FROM payments WHERE tenant_id=\?/);
  assert.match(route, /SUM\(amount_egp\).*actual_revenue/);
  assert.match(route, /requirePermission\('manage_leads'\)/);
});
