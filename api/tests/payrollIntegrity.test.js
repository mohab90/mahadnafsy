'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('monthly payroll calculation is scoped, serialized and a deterministic rebuild', () => {
  const route = read('routes/hr/payroll.js');
  const migration = read('migrations/065_v25_manual_checkout_integrity.sql');
  assert.match(migration, /uniq_payroll_run_scope \(tenant_id, branch_id, month, year\)/);
  assert.match(route, /INSERT IGNORE INTO payroll_runs/);
  assert.match(route, /SELECT id,status FROM payroll_runs[^\n]+FOR UPDATE/);
  assert.match(route, /!\['DRAFT', 'CALCULATED'\]\.includes\(run\.status\)/);
  assert.match(route, /DELETE FROM payroll_items WHERE payroll_run_id=\? AND tenant_id=\?/);
  assert.match(route, /payroll_run_id=NULL WHERE payroll_run_id=\? AND tenant_id=\?/);
  assert.match(route, /\?='branch-other' OR s\.branch_id=\?/);
  assert.match(route, /SUM\(amount_egp\).*total_sales/);
  assert.doesNotMatch(route, /getFxToEgp/);
});

test('payroll enforces approve then pay and journals the payment atomically', () => {
  const route = read('routes/hr/payroll.js');
  assert.match(route, /PAID:\s+\['APPROVED'\]/);
  assert.match(route, /SELECT id, month, year, status[^\n]+FOR UPDATE/);
  assert.match(route, /postJournalEntry\('payroll'[\s\S]*conn, tenantId/);
  assert.match(route, /UPDATE crm_commissions SET status='PAID' WHERE payroll_run_id=\? AND tenant_id=\?/);
  assert.match(route, /status === 'CANCELLED'[\s\S]*status='PENDING',payroll_run_id=NULL/);
  assert.match(route, /CALCULATED: \['CANCELLED'\]/);
});
