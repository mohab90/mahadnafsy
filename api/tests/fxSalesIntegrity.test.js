'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

const ROUTES = path.join(__dirname, '..', 'routes');
function routeFiles(dir = ROUTES) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? routeFiles(target) : [target];
  }).filter(file => file.endsWith('.js'));
}

test('money rows freeze their EGP value and financial reports consume the snapshot', () => {
  const migration = read('migrations/085_v25_money_fx_snapshot.sql');
  const finance = read('lib/finance.js');
  const reports = read('routes/analytics/financial.js');
  const dashboard = read('routes/analytics/dashboard.js');
  assert.match(migration, /ALTER TABLE payments[\s\S]*amount_egp/);
  assert.match(migration, /ALTER TABLE expenses[\s\S]*amount_egp/);
  assert.match(finance, /UPDATE payments SET fx_rate_to_egp=\?,amount_egp=\?/);
  assert.match(finance, /source = 'static-fallback'/);
  assert.match(finance, /fx\.source, paymentId, tenantId/);
  assert.match(finance, /sign < 0[\s\S]*snapshottedEgp/);
  assert.match(reports, /SUM\(amount_egp\)/);
  assert.match(dashboard, /SUM\(amount_egp\)/);
});

// The snapshot only protects a total that actually reads it.
//
// The payment-review breakdown summed `p.amount` behind `AND p.currency='EGP'`
// instead, so a SAR or USD payment counted as zero although amount_egp holds
// its converted value. The figure sat beside a correct total with nothing to
// say it was measuring something narrower.
//
// Scoped to aggregates: filtering by currency in a WHERE clause is legitimate
// (the FX audit does it deliberately). Doing it inside a SUM over money is the
// error, and it is invisible unless something looks for it.
test('no money aggregate re-derives EGP by filtering on the currency column', () => {
  const offenders = [];
  for (const file of routeFiles()) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/SUM\(\s*CASE[\s\S]{0,400}?END\s*\)/g)) {
      const expression = match[0];
      if (!/\bamount\b/.test(expression)) continue;
      if (!/\bcurrency\b/.test(expression)) continue;
      offenders.push(`${path.relative(ROUTES, file).replace(/\\/g, '/')}: ${expression.replace(/\s+/g, ' ').slice(0, 120)}`);
    }
  }
  assert.deepEqual(offenders, [], 'these sums decide what counts as money from the currency column instead of reading amount_egp');
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
  // Target reads stay open to the sales role (the team leaderboard needs them),
  // but writing a target must not be: manage_leads is a default sales-rep
  // permission, so gating the write on it let a rep set the very target their
  // own scorecard is measured against. Pin the manager-level gate instead.
  assert.match(route, /router\.get\('\/api\/admin\/sales-targets'[\s\S]{0,160}requirePermission\('view_leads'\)/);
  // Writing a target is a sales-management action, not a reporting one:
  // view_reports also opens the company KPI/retention/expense dashboards, so a
  // sales manager gated on it was being handed the whole admin analytics group.
  assert.match(route, /router\.post\('\/api\/admin\/sales-targets'[\s\S]{0,700}requirePermission\('manage_sales_team'\)/);
});
