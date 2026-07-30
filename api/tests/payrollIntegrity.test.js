'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('monthly payroll calculation is scoped, serialized and a deterministic rebuild', () => {
  const route = read('routes/hr/payroll.js');
  const migration = read('migrations/065_v25_manual_checkout_integrity.sql');
  const scopeMigration = read('migrations/151_v25_payroll_scope_integrity.sql');
  assert.match(migration, /uniq_payroll_run_scope \(tenant_id, branch_id, month, year\)/);
  assert.match(route, /INSERT IGNORE INTO payroll_runs/);
  assert.match(route, /SELECT id,status FROM payroll_runs[^\n]+FOR UPDATE/);
  assert.match(route, /!\['DRAFT', 'CALCULATED'\]\.includes\(run\.status\)/);
  assert.match(route, /DELETE FROM payroll_items WHERE payroll_run_id=\? AND tenant_id=\?/);
  assert.match(route, /payroll_run_id=NULL WHERE payroll_run_id=\? AND tenant_id=\?/);
  assert.match(scopeMigration, /CREATE TABLE IF NOT EXISTS payroll_period_locks/);
  assert.match(route, /PAYROLL_SCOPE_OVERLAP/);
  assert.match(route, /\?='branch-all' OR s\.branch_id=\?/);
  assert.match(route, /SUM\(amount_egp\).*total_sales/);
  assert.match(route, /const fxRates = await getFxToEgp\(tenantId\)/);
  assert.match(route, /staff_id IN \(\?\)[\s\S]*GROUP BY staff_id,type,currency/);
  assert.doesNotMatch(route, /FROM instructor_rates WHERE tenant_id=\? AND staff_id=\?/);
  assert.doesNotMatch(route, /FROM lecture_logs/);
  assert.match(route, /instructorEarningsSource: 'approved_instructor_fees'/);
  assert.doesNotMatch(
    route,
    /(?:attendance_logs|salary_advances|consultations|lecture_logs|employee_bonuses|instructor_fees)[\s\S]{0,500}\.catch\(\(\) => \[\[\]\]\)/,
    'financial and attendance source failures must abort payroll instead of being treated as zero'
  );
});

test('payroll enforces approve then pay and journals the payment atomically', () => {
  const route = read('routes/hr/payroll.js');
  assert.match(route, /PAID:\s+\['APPROVED'\]/);
  assert.match(route, /SELECT id,month,year,status,total_amount,currency,calculated_by,approved_by[\s\S]*FOR UPDATE/);
  assert.match(route, /postJournalEntry\('payroll'[\s\S]*conn, tenantId/);
  assert.match(route, /account_code: '1300'[\s\S]*advanceTotal/);
  assert.match(route, /account_code: '2200'[\s\S]*statutoryTotal/);
  assert.match(route, /UPDATE crm_commissions SET status='PAID' WHERE payroll_run_id=\? AND tenant_id=\?/);
  assert.match(route, /status === 'CANCELLED'[\s\S]*status='PENDING',payroll_run_id=NULL/);
  assert.match(route, /CALCULATED: \['CANCELLED'\]/);
});

test('payroll detail exposes persisted bonus and instructor earnings', () => {
  const route = read('routes/hr/payroll.js');
  assert.match(route, /pi\.bonus AS bonus_amount/);
  assert.match(route, /JSON_EXTRACT\(pi\.calculation_details, '\$\.instructorEarnings'\)/);
  assert.doesNotMatch(route, /\b0 AS bonus_amount\b|\b0 AS instructor_earnings\b/);
});
